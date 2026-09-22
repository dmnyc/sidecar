'use strict';

// ---- the expanded composer ----
//
// The panel is a 360px strip. That is the right size for approving a signature and the
// wrong size for writing anything you would want to read back, so this is the same
// composer in a tab, at a size and a type scale you can actually think in.
//
// IT IS THE SAME DRAFT, not a copy. Both ends read and write the one slot in the
// background's encrypted draft store, keyed by account, so expanding mid-sentence carries
// the sentence and closing the tab leaves it where the panel will find it. Nothing is
// handed across in a URL or a message, because a handover has a moment where the text
// exists in one place only and that is the moment a tab gets closed.
//
// What it does NOT share is the panel's relay pool. That pool carries reconnect handling,
// NIP-42 auth, relay health and the notification subscriptions, none of which this page
// has any use for. It publishes through its own SimplePool instead, to the relay list the
// panel worked out and left with the draft.
(function () {
  const SC = window.SidecarCore;
  const { h, icon, logoSrcFor, avatarPhSrc } = SC;
  const NT = window.NostrTools;
  const $ = (id) => document.getElementById(id);

  const BG_TIMEOUT_MS = 15000;

  // Lifted from the panel unchanged. A page that talks to the worker needs exactly this
  // much: a timeout, lastError read inside the callback, and a synchronous throw caught
  // for the case where the extension context has gone away under us.
  function bg(message, timeoutMs) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, arg) => { if (!done) { done = true; clearTimeout(t); fn(arg); } };
      const t = setTimeout(
        () => finish(reject, new Error('Sidecar’s background worker did not answer.')),
        timeoutMs || BG_TIMEOUT_MS
      );
      try {
        chrome.runtime.sendMessage(message, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) return finish(reject, new Error(err.message || 'Sidecar’s background worker is unavailable.'));
          finish(resolve, resp);
        });
      } catch (e) {
        finish(reject, e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
  async function call(message) {
    const resp = await bg(message);
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Request failed');
    return resp.result;
  }

  // ---- the smallest toast that is still a toast ----
  //
  // The panel's class names, so styles.css dresses this without a rule of its own. The
  // panel's version also dedupes repeats and holds a progress kind open; neither has a
  // caller here, and copying them would be copying maintenance rather than behavior.
  function toast(message, kind) {
    const host = $('toasts');
    const t = h('div', { className: 'toast toast-' + (kind === 'error' ? 'error' : 'success') });
    t.append(icon(kind === 'error' ? 'alert' : 'check'));
    t.append(h('span', { textContent: message }));
    host.append(t);
    requestAnimationFrame(() => t.classList.add('show'));
    const dismiss = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); };
    const timer = setTimeout(dismiss, 3600);
    t.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
    return t;
  }

  // ---- state ----
  let state = null;
  let draft = { text: '', media: [] };
  let dkey = null;
  let saveTimer = null;
  let posting = false;
  let followCache = null;
  let handoverRelays = null;
  let reduceMotion = false;
  let countdown = null;

  const shortNpub = (npub) =>
    (typeof npub === 'string' && npub.length > 20 ? npub.slice(0, 10) + '…' + npub.slice(-4) : npub || '');

  const THEME_ALIASES = { 'art-deco': 'industria' };
  const VALID_THEMES = ['speakeasy', 'film-noir', 'brownstone', 'nixie', 'cast-iron', 'metropolis',
    'industria', 'aegean', 'bauhaus', 'populuxe', 'par-avion', 'werkstatte'];
  function applyTheme(settings, pubkey) {
    const by = (settings && settings.themeBy) || null;
    let name = (by && pubkey && by[pubkey]) || (settings && settings.theme) || 'speakeasy';
    name = THEME_ALIASES[name] || name;
    if (!VALID_THEMES.includes(name)) name = 'speakeasy';
    document.documentElement.setAttribute('data-theme', name);
    // The wordmark is baked lavender for a dark field and disappears on marble or
    // eggshell, so the six light themes get the dark-wordmark cut. Same function the
    // panel uses, from the same set, so a new theme is registered once.
    const logo = $('compose-logo');
    if (logo) logo.src = logoSrcFor(name);
  }

  // ---- relays, and the one page-local pool ----
  //
  // The panel computes the write set for an account: its NIP-65 list, the configured
  // relays, or the declared set alone when the account asked for NIP-65 only. That is a
  // real piece of reasoning with a relay round trip in it, so the panel does it once when
  // you press expand and leaves the answer with the draft rather than having this page
  // re-derive it. A page opened cold falls back to the configured list, which is what the
  // panel falls back to as well.
  let _pool = null;
  function pool() {
    if (!_pool) {
      const ws = (window.SidecarWsGuard && window.SidecarWsGuard.impl()) || undefined;
      _pool = new NT.SimplePool({ enableReconnect: true, websocketImplementation: ws });
    }
    return _pool;
  }
  async function targetRelays() {
    if (handoverRelays && handoverRelays.length) return handoverRelays;
    return relayUrls(true);
  }

  // READING IS NOT PUBLISHING, and conflating the two cost the uploader its Blossom
  // server. relayUrls(false) means every configured relay, read-only ones included, and
  // that is what the core asks for when it looks up a profile, an embed, or the kind
  // 10063 server list. Answering all of those with the PUBLISH set meant the list was
  // looked for on two or three write relays and, not found, the upload fell through to
  // nostr.build without a word.
  //
  // targetRelays stays what it was: where this note goes, which is the handover set the
  // panel worked out, and has no business deciding where a lookup happens.
  async function relayUrls(writableOnly) {
    const map = await call({ type: 'SIDECAR_GET_RELAYS' });
    return Object.keys(map || {}).filter((u) => (writableOnly ? map[u].write !== false : true));
  }

  // ---- what the shared editor needs from whichever page it is drawing into ----
  const profileCache = new Map();
  function cachedProfile(pubkey) { return profileCache.get(pubkey) || null; }
  // The preview's mention resolver writes back what it looked up, so the second mention
  // of the same person costs nothing.
  function cacheProfile(pubkey, content) {
    profileCache.set(pubkey, {
      pubkey,
      name: (content && (content.display_name || content.name)) || null,
      picture: (content && content.picture) || null,
    });
  }
  async function fetchPreviewProfile(pubkey) {
    if (profileCache.has(pubkey)) return profileCache.get(pubkey);
    try {
      const relays = await relayUrls(false);
      const ev = await pool().get(relays, { kinds: [0], authors: [pubkey] });
      const meta = ev ? JSON.parse(ev.content) : null;
      const p = meta ? { pubkey, name: meta.display_name || meta.name || null, picture: meta.picture || null } : null;
      profileCache.set(pubkey, p);
      return p;
    } catch (_) { return null; }
  }
  function applyAvatar(box, a) {
    box.innerHTML = '';
    box.classList.remove('avatar-ph');
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    if (a && a.picture) {
      img.src = a.picture;
      img.onerror = () => { img.src = avatarPhSrc(); img.onerror = null; box.classList.add('avatar-ph'); };
    } else {
      // The garnish is drawn in white for a dark disc, so a light theme takes the other
      // cut. Reads the live data-theme attribute, which applyTheme has already set.
      img.src = avatarPhSrc();
      box.classList.add('avatar-ph');
    }
    box.append(img);
  }

  // The follow list, once, in the background. The editor is built to work without it:
  // it paints local matches immediately and repaints when this resolves, so a slow relay
  // costs the first keystroke nothing.
  async function getFollowList() {
    if (followCache) return followCache;
    try {
      const relays = await relayUrls(false);
      const ev = await pool().get(relays, { kinds: [3], authors: [state.activePubkey] });
      const pubkeys = (ev ? ev.tags : []).filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]).slice(0, 400);
      if (!pubkeys.length) return (followCache = []);
      const metas = await pool().querySync(relays, { kinds: [0], authors: pubkeys });
      const byKey = new Map();
      for (const m of metas) {
        const prev = byKey.get(m.pubkey);
        if (!prev || m.created_at > prev.created_at) byKey.set(m.pubkey, m);
      }
      followCache = pubkeys.map((pk) => {
        let meta = {};
        try { meta = JSON.parse((byKey.get(pk) || {}).content || '{}'); } catch (_) {}
        const entry = { pubkey: pk, name: meta.display_name || meta.name || null, picture: meta.picture || null };
        profileCache.set(pk, entry);
        return entry;
      }).filter((c) => c.name);
      return followCache;
    } catch (_) { return (followCache = []); }
  }

  // ---- the global name search, at full parity with the panel ----
  //
  // This used to be a stub — follows only — on the theory that the consent ask was
  // panel UI and this page should not ask its own question. What that actually
  // bought was two composers with two memories: a name the sidebar found in a
  // keystroke did not exist in the tab unless the account followed it. The ask is
  // not panel UI; it belongs to the decision, and the decision is stored
  // browser-wide, so this page renders the same one-time ask, writes the same
  // setting, and searches the same index — api.nostrarchives.com, the one
  // centralized service whose trade (it sees what you type and who you follow,
  // which the relays never see together) the user is asked about exactly once.
  const NA_BASE = 'https://api.nostrarchives.com';
  const isHex64 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);
  // Tri-state memo: undefined = never asked, true/false = decided. Read straight
  // from storage rather than through call(), so autocomplete keystrokes cannot wake
  // the service worker; after that it is memoized, and storage.onChanged keeps this
  // document current — the one thing the panel's memo cannot do for itself, because
  // the decision changed in Settings is a decision changed in a DIFFERENT document
  // from the one writing this note.
  let naSettingMemo;
  let naSettingLoaded = false;
  function naSetting() {
    if (naSettingLoaded) return Promise.resolve(naSettingMemo);
    return new Promise((resolve) =>
      chrome.storage.local.get('sidecar_settings', (r) => {
        naSettingLoaded = true;
        naSettingMemo = ((r && r.sidecar_settings) || {}).nostrArchives;
        resolve(naSettingMemo);
      }));
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.sidecar_settings) return;
    naSettingLoaded = true;
    naSettingMemo = (changes.sidecar_settings.newValue || {}).nostrArchives;
  });
  // Either button on the ask writes the decision. The memo is set first,
  // optimistically: if the write somehow fails, showing the ask again right after
  // a deliberate "Just my follows" would be worse than re-asking next session.
  async function naDecide(on) {
    naSettingLoaded = true;
    naSettingMemo = on;
    try { await call({ type: 'SIDECAR_SET_SETTINGS', settings: { nostrArchives: on } }); } catch (_) {}
  }
  // The ask itself, rendered where the search spinner would sit in the dropdown.
  // mousedown + preventDefault like the result rows: a plain click would blur the
  // composer first and close the dropdown before the decision lands.
  function naAskEl(onDecided) {
    const row = h('div', { className: 'na-ask' });
    row.addEventListener('mousedown', (e) => e.preventDefault());
    row.append(h('p', {
      className: 'na-ask-text',
      textContent: 'Also search every Nostr name? This uses a third-party index (api.nostrarchives.com) that sees what you type and who you follow.',
    }));
    const yes = h('button', { className: 'na-ask-yes', type: 'button', textContent: 'Search everyone' });
    const no = h('button', { className: 'na-ask-no', type: 'button', textContent: 'Just my follows' });
    const pick = (on) => (e) => { e.preventDefault(); e.stopPropagation(); onDecided(on); };
    yes.addEventListener('mousedown', pick(true));
    no.addEventListener('mousedown', pick(false));
    row.append(h('div', { className: 'na-ask-actions' }, [yes, no]));
    return row;
  }
  let naCooldownUntil = 0; // epoch ms; a 429 backs us off until this time
  const naAvailable = () => Date.now() >= naCooldownUntil;
  function naBackoff(retryAfter) {
    const secs = Math.min(3600, Math.max(30, Number(retryAfter) || 60));
    naCooldownUntil = Date.now() + secs * 1000;
  }
  const naName = (p) => p.display_name || p.preferred_name || p.name || null;

  // Global username search → [{pubkey, name, picture}]. Returns [] on any failure.
  async function naSuggest(query) {
    if (!query || query.length < 2 || !naAvailable()) return [];
    if ((await naSetting()) !== true) return [];
    try {
      const resp = await fetch(NA_BASE + '/v1/search/suggest?q=' + encodeURIComponent(query) + '&limit=8', {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.status === 429) { naBackoff(resp.headers.get('retry-after')); return []; }
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.suggestions || [])
        .filter((s) => s && isHex64(s.pubkey))
        .map((s) => {
          const pk = s.pubkey.toLowerCase();
          let name = naName(s);
          if (!name) { try { name = shortNpub(NT.nip19.npubEncode(pk)); } catch (_) { name = pk.slice(0, 10) + '…'; } }
          return { pubkey: pk, name, picture: s.picture || null };
        });
    } catch (_) { return []; }
  }

  const na = {
    available: naAvailable,
    setting: naSetting,
    decide: naDecide,
    askEl: naAskEl,
    suggest: naSuggest,
  };

  // Proof of work for THIS note. The draft's own rung if it carries one, otherwise the
  // account's standing setting, and never written back to Settings either way: the button
  // in the editor is a decision about this post, not about the account.
  let powForThisPost = { on: false, bits: SC.POW_DEFAULT_BITS };
  let repaintPow = () => {};
  async function seedPow(saved) {
    if (saved && saved.pow && typeof saved.pow.bits === 'number') {
      return { on: !!saved.pow.on, bits: saved.pow.bits };
    }
    return composer.powSetting(state.activePubkey);
  }

  const composer = SC.installComposer({
    NT,
    applyAvatar,
    cachedProfile,
    cacheProfile,
    fetchPreviewProfile,
    getFollowList,
    cachedFollowList: () => followCache,
    // The relay reads the preview and the uploader make, answered by this page's own
    // pool. The core never learns which sockets it is using, which is the whole reason
    // the panel could keep its reconnect handling and its auth and this page could not
    // accidentally inherit them.
    call,
    poolGet: (relays, filter, params) => pool().get(relays, filter, params),
    poolQuerySync: (relays, filter, params) => pool().querySync(relays, filter, params),
    relayUrls,
    activePubkey: () => state.activePubkey,
    // Settings → Reduce motion. The countdown's digits re-enter per glyph, which is
    // exactly the kind of thing that setting is for.
    reduceBalanceMotion: () => reduceMotion,
    naAskEl: na.askEl,
    naAvailable: na.available,
    naDecide: na.decide,
    naSetting: na.setting,
    naSuggest: na.suggest,
    noteActivity: () => { chrome.runtime.sendMessage({ type: 'SIDECAR_ACTIVITY' }).catch(() => {}); },
    shortNpub,
  });

  // ---- the draft, shared with the panel ----
  function loadDraft() {
    return call({ type: 'SIDECAR_SECRET_GET', store: 'drafts' })
      .then((all) => (all && all[dkey]) || null)
      .catch(() => null);
  }
  async function persistDraft() {
    const all = (await call({ type: 'SIDECAR_SECRET_GET', store: 'drafts' })) || {};
    // Media counts as content on its own: an upload with no words yet is still work, and
    // dropping it because the caption had not been written is the kind of thing that makes
    // a draft store worse than none.
    const hasContent = !!((draft.text && draft.text.trim()) || (draft.media && draft.media.length));
    if (hasContent) {
      all[dkey] = { ...(all[dkey] || {}), text: draft.text, media: draft.media, savedAt: Date.now() };
      // The difficulty travels with the note, the same as the text does, so cancelling out
      // of this tab and reopening the panel's composer finds the rung still chosen.
      if (draft.pow) all[dkey].pow = draft.pow;
    }
    else delete all[dkey];
    await call({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: all });
  }
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { persistDraft().catch(() => {}); }, 400);
  }
  // Write now rather than at the end of the debounce, and drop the pending one so the two
  // cannot race to put different text in the same slot.
  function flushDraft() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    return persistDraft().catch(() => {});
  }

  // ---- the store is locked, and this page can do nothing about it ----
  //
  // NO BUTTON, because there is nothing behind one. chrome.sidePanel.open was the obvious
  // candidate and it does not work from here: the API wants a user gesture and declines
  // the click on an extension tab page, so an Unlock button did nothing at all when
  // pressed. A control that lies about being a control is worse than the sentence it
  // replaced.
  //
  // And no PIN field either. SIDECAR_UNLOCK enumerates its callers in a comment because
  // the throttle and the 21st-strike wipe are enforced behind it; a fourth surface taking
  // a PIN deserves a security look rather than a paragraph in a layout commit.
  //
  // So: the Post button says what is needed and is inert, and the status line beside it
  // says why. One statement, twice as honest as the banner and a dead button were.
  function paintLocked() {
    paintPostButton();
    const status = $('compose-status');
    if (posting) return; // it is mid-flight and has something more urgent to say
    status.textContent = (state && state.locked) ? 'Sidecar is locked.' : '';
  }

  function paintWho() {
    const acct = (state.accounts || []).find((a) => a.pubkey === state.activePubkey) || {};
    $('compose-name').textContent = acct.name || shortNpub(acct.npub) || 'Your account';
    applyAvatar($('compose-av'), acct);
  }

  // WHO THIS IS BEING WRITTEN AS CAN CHANGE UNDER THE TAB.
  //
  // state is read once at boot and the panel is a different document: switch accounts
  // there and this page went on showing the old name and avatar, went on writing the old
  // account's draft slot, and then failed at Post with a bare error, because owner-sign
  // refuses when expectedPubkey is not the account it would sign with. Failing closed is
  // right. Failing closed with no explanation, after the note was written, is not.
  //
  // The panel disables its own account switcher while a mine runs for the same reason. It
  // cannot disable it on this page's behalf, so this page watches instead.
  async function refreshWho() {
    if (posting) return; // mid-publish is the one moment a swap underneath would be worse
    let next;
    try { next = await call({ type: 'SIDECAR_GET_STATE' }); } catch (_) { return; }
    // A locked store still answers with its accounts, and the lock can land while the tab
    // sits open: fifteen idle minutes is shorter than a long note.
    if (!next || !next.activePubkey) return;
    const moved = next.activePubkey !== state.activePubkey;
    state = next;
    paintWho();
    paintLocked();
    if (!moved) return;
    // The description commits FIRST: its tail lives in the row's textarea until
    // flushed, and flushDraft below is the old account's last chance to take it.
    closeAltEditor(); // the old account's draft takes the tail with it
    // The draft follows the account, because the slot is keyed by it. What is on screen
    // belongs to the account that was active when it was typed, so it is written back
    // there before the key moves rather than being carried across into someone else's.
    await flushDraft();
    dkey = state.activePubkey;
    handoverRelays = null; // a different account can publish somewhere else entirely
    followCache = null;
    const saved = await loadDraft();
    // Strip the attachment URLs an older draft carried in its text: they live in the
    // media slot alone now, or publishing would append them a second time.
    draft.text = SC.stripDraftMediaUrls(saved && saved.text, saved && saved.media);
    draft.media = (saved && Array.isArray(saved.media)) ? saved.media : [];
    // The row edits a slot of the PREVIOUS account's draft, which was just swapped
    // under it — the same reason the editor itself is rewritten below.
    closeAltEditor();
    // Per account, so it re-seeds with everything else the account decides, and from the
    // new account's own draft if that draft carries a rung.
    powForThisPost = await seedPow(saved);
    repaintPow();
    editorSetText(draft.text);
    renderThumbs();
    paintCount();
    const acct = (state.accounts || []).find((a) => a.pubkey === state.activePubkey) || {};
    toast('Now writing as ' + (acct.name || shortNpub(acct.npub) || 'another account'), 'success');
  }

  function paintCount() {
    const n = (draft.text || '').trim().length;
    $('compose-count').textContent = n ? n + (n === 1 ? ' character' : ' characters') : '';
    // Media alone is a postable note, the same as in the panel: an image with no caption
    // is a thing people post. The button itself is decided in one place.
    paintPostButton();
  }

  // THE LAST LOOK BEFORE IT GOES OUT, if the account asked for one.
  //
  // noteCountdown defaults on and the panel has honored it since it existed. This page
  // published the instant Post was pressed, which is a setting somebody turned on and one
  // of two composers quietly ignoring it.
  //
  // It renders into its own container rather than over the card, so canceling puts the
  // editor back exactly as it was. Taking over the sheet the way the panel takes over its
  // modal would mean rebuilding the editor afterwards around a lost caret.
  async function reviewThenPost() {
    if (posting) return;
    // Belt and braces for the route the button no longer offers. Starting a countdown, or
    // worse a mine, against a store that cannot sign is a minute spent on nothing: that
    // is what pressing Post used to buy, and it is the reason the button went inert.
    if (state && state.locked) return;
    const text = (draft.text || '').trim();
    if (!text && !draft.media.length) return;
    // Through the core, not read again here. This page had its own copy with its own
    // default of five seconds, where the panel defaults to fifteen: the same account got
    // three times less time to catch a mistake depending on which composer it was in.
    const { on, secs } = await composer.postCountdownSetting();
    if (!on) return doPost();

    const pane = $('compose-countdown');
    const preview = h('div', { className: 'countdown-preview' });
    const body = h('div', { className: 'preview-body' });
    // The note that will go out, attachments appended — not just the prose the
    // editor was showing.
    composer.renderNotePreview(body, SC.composeNoteContent(text, draft.media));
    preview.append(body);

    const restore = () => {
      if (countdown) { countdown.stop(); countdown = null; }
      pane.innerHTML = '';
      pane.classList.add('hidden');
      setReviewing(false);
    };
    setReviewing(true);
    pane.classList.remove('hidden');
    countdown = composer.showPostCountdown({
      // NO AUTHOR STRIP. The panel passes one because its countdown replaces the whole
      // modal, editor and header and all, so nothing else on screen says who is posting.
      // Here the card's own header stays up: a second face and a second name six lines
      // below the first is the same sentence twice.
      modal: pane, secs,
      title: 'Posting your note',
      preview,
      confirmLabel: 'Post now',
      onFire: () => { restore(); doPost(); },
      onCancel: restore,
    });
  }

  // The editor and its toolbar go inert while the review window is up, for the same reason
  // they do while a mine runs: what is being reviewed was decided when Post was pressed.
  function setReviewing(on) {
    // One class on the card, and everything that could show the note stands down:
    // the review window renders the final post itself, so the preview pane, the
    // thumbnails and the attachments' drawer would each be the same note a second
    // time, and a second rendering is not a second look.
    if (on) closeAltEditor(); // nothing left to edit: the note was decided at Post
    document.querySelector('.compose-sheet').classList.toggle('is-reviewing', on);
    $('compose-slot').classList.toggle('hidden', on);
    $('compose-tabs').classList.toggle('hidden', on);
    $('compose-actions').classList.toggle('hidden', on);
    // The whole footer, not its two buttons. Hiding those alone left the character count
    // dangling under the countdown's own row, attached to nothing.
    document.querySelector('.compose-foot').classList.toggle('hidden', on);
  }

  async function doPost() {
    if (posting) return;
    const text = (draft.text || '').trim();
    // Media alone is a postable note: the URLs live in the media slot, not in the
    // text, so the prose being empty no longer means the note is.
    if (!text && !draft.media.length) return;
    posting = true;
    paintCount();
    const status = $('compose-status');
    try {
      let template = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        // One imeta per DESCRIBED attachment (NIP-92, as zap.cooking writes it),
        // describing the same URLs composeNoteContent appends to the content, in
        // the same order. Undescribed media emits nothing, so a note of bare URLs
        // is byte-identical to what it published before alt text existed.
        tags: [['client', 'Sidecar'], ...SC.imetaTagsForMedia(draft.media)],
        content: SC.composeNoteContent(text, draft.media),
      };
      // MINE FIRST, THEN SIGN. The event id commits to the pubkey, so the nonce has to be
      // found against the key that will sign it, and signing afterwards recomputes the id
      // without touching created_at or the tags the miner wrote.
      if (powForThisPost.on) {
        // THE POST BUTTON BECOMES THE WAY OUT. A mine at 22 bits is ten seconds and
        // sometimes a minute, and the panel offers a Stop for exactly that reason; here
        // the only button that could be pressed is the one that started it, so it changes
        // into what it now does.
        setMining(true);
        status.textContent = 'Mining ' + powForThisPost.bits + ' bits…';
        const mined = await composer.minePow(
          { ...template, pubkey: state.activePubkey },
          powForThisPost.bits,
          (p) => { status.textContent = 'Mining ' + powForThisPost.bits + ' bits, best ' + p.best + '…'; }
        );
        // The pubkey is dropped again: the signer sets it from the key it signs with, and
        // sending our own copy invites the two to disagree about the one field neither of
        // them should be guessing at.
        const { pubkey: _mined, ...rest } = mined.event;
        template = rest;
        setMining(false);
      }
      status.textContent = 'Signing…';
      const signed = await call({
        type: 'SIDECAR_OWNER_SIGN', event: template, expectedPubkey: state.activePubkey,
      });
      status.textContent = 'Publishing…';
      const relays = await targetRelays();
      if (!relays.length) throw new Error('No relays configured (add some in Settings)');
      const results = await Promise.allSettled(pool().publish(relays, signed));
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      if (!ok) throw new Error('No relay accepted the note. It is still saved as a draft.');
      // The draft goes only once the note is actually out. A cleared draft plus a failed
      // publish is the one outcome worth engineering against.
      // TELL THE PANEL, if one is open. It filters the notification bell against its own
      // memory of what this account has posted, and that memory is a different document:
      // without this, replies to a note written here stay out of notifications until the
      // panel next re-queries its own notes from relays.
      try {
        chrome.runtime.sendMessage({
          type: 'SIDECAR_EVENT', event: 'notePublished', pubkey: signed.pubkey, id: signed.id,
        }).catch(() => {});
      } catch (_) { /* nobody listening is the normal case */ }
      draft.text = '';
      draft.media = [];
      await persistDraft();
      editorSetText('');
      renderThumbs();
      status.textContent = '';
      await showPosted(signed, ok);
    } catch (e) {
      status.textContent = '';
      // A stop is the user's own decision, and the editor coming back is the answer.
      if (e && e.canceled) { /* nothing to say */ }
      // A LOCKED KEYSTORE IS NOT A FAILURE, IT IS A STEP. The worker answers "Keystore is
      // locked" or "Sidecar is locked" depending on which guard refused, and either one
      // read as a fault here: a toast, a written note, and nothing saying what to do about
      // it. The unlock lives in the panel and this page cannot host it, so the least it
      // can do is name where it is. The draft is already safe, which is the other half of
      // why this is survivable.
      else if (/is locked/i.test(e.message || '')) {
        // It locked between the banner painting and Post being pressed, or the banner was
        // never shown because the state read failed. Same offer either way.
        // It locked between the last paint and Post being pressed. The button and the
        // status line say so from here on; the toast is for the attempt that just failed.
        if (state) state.locked = true;
        toast('Sidecar is locked. Unlock it, then press Post again.', 'error');
      } else toast(e.message || 'Could not post', 'error');
    }
    setMining(false);
    posting = false;
    paintCount();
    paintLocked();
  }

  // ---- what the one button currently is ----
  //
  // There is exactly one primary control on this page, so it has to say which of the
  // three things it is doing rather than saying Post and doing something else. Decided in
  // one function because three of them setting label, class and disabled independently is
  // how a button ends up saying Post while a mine is running.
  //
  // LOCKED IS THE ONE THAT WAS BAD. Post stayed lit, so pressing it sat through the whole
  // review countdown and then a full proof-of-work mine, which is as much as a minute,
  // before the signer refused and a toast said the store was locked. A note vanishing for
  // a minute into no feedback at all is worse than any of the things that could follow.
  function paintPostButton() {
    const post = $('compose-post');
    if (mining) {
      post.textContent = 'Stop mining';
      post.className = 'secondary compose-post';
      post.disabled = false;
      return;
    }
    if (state && state.locked) {
      // Inert, and saying so. There is no route from this page to the unlock, so a button
      // that looked pressable would be the third thing today that does nothing when it is.
      post.textContent = 'Unlock to post';
      post.className = 'secondary compose-post';
      post.disabled = true;
      return;
    }
    post.textContent = 'Post';
    post.className = 'primary compose-post';
    const n = (draft.text || '').trim().length;
    post.disabled = posting || (!n && !draft.media.length);
  }

  // Post and Stop are the same button in two states, because there is only ever one of
  // them on screen and only one thing it could sensibly do at a time.
  //
  // AND THE EDITOR GOES INERT WITH IT. minePow works on a snapshot of the template taken
  // when Post was pressed, so anything typed while it runs is not in the note that
  // publishes. At 22 bits that is ten seconds and sometimes a minute of typing into a box
  // whose contents no longer matter, and the note goes out as the old text while the
  // screen shows the new one. The panel cannot reach this state because its mining pane
  // takes over the screen; here the editor is simply still there, so it is turned off.
  let mining = false;
  function setMining(on) {
    if (mining === on) return;
    mining = on;
    paintPostButton();
    if (editorApi) {
      editorApi.editor.contentEditable = on ? 'false' : 'true';
      editorApi.editor.classList.toggle('is-locked', on);
      if (on) editorApi.close(); // no mention dropdown left open over a box nobody can type in
    }
    // Everything that would change what is being mined, or start a second mine on the one
    // worker. Cancel and the close box stay live: leaving is always allowed, and it takes
    // the worker with the page. The ALT row's buttons go with them — the description it
    // edits rides in the same draft the mine already snapshotted.
    document.querySelectorAll('#compose-actions button, .compose-tab, .compose-alt-row button').forEach((b) => {
      b.disabled = on;
    });
    const altField = document.querySelector('.compose-alt-text');
    if (altField) altField.readOnly = on;
  }

  let editorApi = null;
  function editorSetText(t) { if (editorApi) editorApi.setText(t); }

  // ---- what the page becomes once the note is out ----
  //
  // The panel drops a banner because the composer it posted from is a modal that closes
  // and there is a whole app underneath to go back to. A tab has nothing underneath: the
  // card IS the page, and leaving an empty editor sitting there says a note was lost
  // rather than published. So the card becomes the receipt.
  //
  // A LINK, because Sidecar is a companion and not a client. It cannot show you the note
  // in a thread with its replies, and the client this account already chose can.
  async function neventFor(signed) {
    let relays = [];
    try { relays = (await targetRelays()).slice(0, 2); } catch (_) {}
    return NT.nip19.neventEncode({ id: signed.id, author: signed.pubkey, relays });
  }

  async function showPosted(signed, relayCount) {
    const sheet = document.querySelector('.compose-sheet');
    let href = null;
    let label = null;
    try {
      const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
      // The account that SIGNED it, not whatever is active by the time this paints. They
      // can differ if the panel switched while the tab was open.
      const client = composer.resolveClient(settings, signed.pubkey || state.activePubkey);
      href = client.url(await neventFor(signed));
      label = client.label;
    } catch (_) { /* no link is better than a broken one */ }

    sheet.innerHTML = '';
    sheet.classList.add('compose-done');
    const mark = h('span', { className: 'compose-done-mark' });
    mark.append(icon('check'));
    sheet.append(
      mark,
      h('h2', { className: 'compose-done-title', textContent: 'Your note is live.' }),
      h('p', {
        className: 'compose-done-sub',
        textContent: 'Published to ' + relayCount + (relayCount === 1 ? ' relay.' : ' relays.'),
      })
    );

    const row = h('div', { className: 'compose-done-actions' });
    if (href) {
      const open = document.createElement('a');
      open.className = 'primary compose-done-open';
      open.href = href;
      open.target = '_blank';
      open.rel = 'noreferrer noopener';
      open.textContent = 'Open in ' + label;
      row.append(open);
    }
    const again = h('button', { className: 'mini ghost', type: 'button', textContent: 'Write another' });
    again.addEventListener('click', () => window.location.reload());
    row.append(again);
    sheet.append(row);

    const done = h('button', { className: 'compose-cancel', type: 'button', textContent: 'Close this tab' });
    done.addEventListener('click', () => window.close());
    sheet.append(done);
  }

  // ---- thumbnails for what has been uploaded ----
  function renderThumbs() {
    const host = $('compose-thumbs');
    host.innerHTML = '';
    // Where a dragged thumb will land, across renderThumbs' rebuilds.
    let dragFrom = -1;
    draft.media.forEach((m, i) => {
      const cell = h('div', { className: 'compose-thumb' });
      const el = document.createElement(m.isVideo ? 'video' : 'img');
      // Many media hosts reject a chrome-extension:// referrer and answer 403, which
      // renders as a broken thumb rather than as an error anyone can act on.
      el.referrerPolicy = 'no-referrer';
      el.src = m.url;
      // The cell is what drags; an img's own native drag would hijack the gesture.
      el.draggable = false;
      if (m.isVideo) el.muted = true;
      cell.append(el);
      // THE ORDER ON THE STRIP IS THE ORDER IN THE NOTE. The URLs leave the editor
      // and are appended at publish in this array's order, so with more than one
      // attachment the thumbs drag.
      cell.draggable = draft.media.length > 1;
      cell.addEventListener('dragstart', (e) => {
        dragFrom = i;
        cell.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(i)); } catch (_) {}
      });
      cell.addEventListener('dragover', (e) => {
        if (dragFrom === -1 || dragFrom === i) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        cell.classList.add('drop-target');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drop-target');
        if (dragFrom === -1 || dragFrom === i) return;
        closeAltEditor(); // flush first: the row's slot is still where it was opened
        const moved = draft.media.splice(dragFrom, 1)[0];
        draft.media.splice(i, 0, moved);
        dragFrom = -1;
        scheduleSave();
        renderThumbs();
      });
      cell.addEventListener('dragend', () => {
        dragFrom = -1;
        cell.classList.remove('dragging');
        host.querySelectorAll('.drop-target').forEach((t) => t.classList.remove('drop-target'));
      });
      if (!m.isVideo) {
        // Same chip the panel's composer wears: + ALT until the image is described,
        // ✓ ALT once it is. The tag itself only goes out for described images.
        const alt = h('button', {
          className: 'compose-thumb-alt' + (m.alt ? ' has-alt' : ''),
          title: m.alt ? 'Edit the image description' : 'Add a description',
          type: 'button',
        });
        alt.textContent = m.alt ? '✓ ALT' : '+ ALT';
        alt.addEventListener('click', () => openAltEditor(i));
        cell.append(alt);
      }
      const rm = h('button', { className: 'compose-thumb-x', title: 'Remove', type: 'button' });
      rm.append(icon('trash'));
      rm.addEventListener('click', () => {
        // The URL lives in the media slot alone now; taking the thumb off is just
        // taking the attachment off the note.
        draft.media.splice(i, 1);
        closeAltEditor(false); // the row edits a media slot that no longer exists
        scheduleSave();
        paintCount();
        renderThumbs();
      });
      cell.append(rm);
      host.append(cell);
    });
    mediaDrawer.sync();
  }

  // The attachments' reference drawer, seated between the strip and whatever row
  // comes next: collapsed it is one line saying where the attachments go.
  const mediaDrawer = SC.buildMediaDrawer(() => draft.media);
  $('compose-thumbs').after(mediaDrawer.wrap);

  // ---- the ALT editor, one image at a time ----
  //
  // The same inline row the panel seats under its thumbnail strip, built by the same
  // function in the core. It sits outside #compose-slot, so the review window's
  // setReviewing closes it rather than leaving a live editor under a note that is
  // already decided.
  let altRow = null;
  let altIndex = -1; // the slot the open row edits, so its own chip toggles it shut
  function closeAltEditor(flush) {
    if (altRow) {
      // THE TAIL OF THE DESCRIPTION RIDES ALONG, unless the caller says the slot
      // is gone or moved — flushing into a spliced array would write one image's
      // words onto another.
      if (flush !== false && altRow.flushPending) altRow.flushPending();
      altRow.remove();
      altRow = null;
    }
    altIndex = -1;
  }
  function openAltEditor(i) {
    const m = draft.media[i];
    if (!m) return;
    if (altRow && altIndex === i) { closeAltEditor(); return; }
    closeAltEditor();
    altIndex = i;
    // Commits as it types (the row debounces half a second) and on every way out —
    // the same autosave promise the text in the editor keeps.
    function saveAltInto(slot, value) {
      const cur = draft.media[slot];
      if (!cur) return;
      // Normalized once here and again on publish (buildImetaTag), because a draft
      // can publish without the editor ever being opened.
      const cleaned = SC.capAltText(SC.normalizeAltBreaks(value));
      if (cleaned) cur.alt = cleaned; else delete cur.alt;
      scheduleSave();
      renderThumbs();
    }
    altRow = SC.buildAltEditorRow({
      url: m.url,
      alt: m.alt,
      onChange: (value) => saveAltInto(i, value),
      onSave: (value) => {
        closeAltEditor();
        saveAltInto(i, value);
      },
    });
    mediaDrawer.wrap.after(altRow);
  }

  // ---- the toolbar: media, and a proof of work for this note ----
  function buildToolbar() {
    const row = $('compose-actions');
    const err = $('compose-err');

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,video/*';
    fileInput.style.display = 'none';
    const addBtn = h('button', { className: 'mini compose-add', type: 'button' });
    addBtn.append(icon('camera'), h('span', { textContent: 'Media' }));
    addBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      err.textContent = '';
      addBtn.disabled = true;
      const lbl = addBtn.querySelector('span');
      const prev = lbl.textContent;
      lbl.textContent = 'Uploading…';
      try {
        const url = await composer.uploadMedia(file, state.activePubkey);
        // Into the media slot only. The URL is appended to the content at publish
        // (SC.composeNoteContent), so nothing touches the editor here — and since no
        // input event fires, both the autosave and the Post button (media alone is
        // postable) have to be told by hand.
        draft.media.push({ url, isVideo: file.type.startsWith('video/') });
        scheduleSave();
        paintCount();
        renderThumbs();
      } catch (e) {
        err.textContent = e.message;
        toast(e.message, 'error');
      }
      addBtn.disabled = false;
      lbl.textContent = prev;
      fileInput.value = '';
    });

    // Cycles Off, 16, 18, 20, 22 and back, the same ladder and the same labels as the
    // panel. "PoW 18" and "PoW off" are the same width, so cycling never makes the row
    // opposite it jump.
    const powBtn = h('button', { className: 'mini compose-add', type: 'button' });
    const powLabel = h('span');
    powBtn.append(icon('pickaxe'), powLabel);
    function paintPow() {
      const lvl = powForThisPost.on ? SC.powLevelFor(powForThisPost.bits) : null;
      powLabel.textContent = lvl ? 'PoW ' + lvl.bits : 'PoW off';
      powBtn.title = lvl ? lvl.cost : 'Off. Tap to mine one into this post.';
      powBtn.classList.toggle('compose-add-on', !!lvl);
    }
    repaintPow = paintPow;
    powBtn.addEventListener('click', () => {
      const order = [null, ...SC.POW_LEVELS.map((l) => l.bits)];
      const at = order.indexOf(powForThisPost.on ? powForThisPost.bits : null);
      const next = order[(at + 1) % order.length];
      powForThisPost = next == null ? { on: false, bits: powForThisPost.bits } : { on: true, bits: next };
      draft.pow = powForThisPost;
      scheduleSave();
      paintPow();
    });
    paintPow();

    row.append(addBtn, powBtn, fileInput);
  }

  // ---- Write / Preview ----
  //
  // The same renderer the panel previews with, so what this shows and what that shows
  // cannot disagree about a mention, an embed or a link card.
  function buildTabs() {
    const write = $('tab-write');
    const prev = $('tab-preview');
    const pane = $('compose-preview');
    const slot = $('compose-slot');
    const show_ = (previewing) => {
      write.classList.toggle('active', !previewing);
      prev.classList.toggle('active', previewing);
      slot.classList.toggle('hidden', previewing);
      pane.classList.toggle('hidden', !previewing);
      if (!previewing) return;
      pane.innerHTML = '';
      // What will actually go out: the prose and, appended at the end, the
      // attachments — the preview and the published note are rendered from the one
      // composed string.
      const body = SC.composeNoteContent(draft.text, draft.media);
      if (!body) {
        pane.append(h('p', { className: 'hint', textContent: 'Nothing to preview yet.' }));
        return;
      }
      const box = h('div', { className: 'preview-body' });
      composer.renderNotePreview(box, body);
      pane.append(box);
    };
    write.addEventListener('click', () => show_(false));
    prev.addEventListener('click', () => show_(true));
  }

  async function boot() {
    state = await call({ type: 'SIDECAR_GET_STATE' });
    if (!state || !state.activePubkey) {
      document.body.innerHTML = '';
      document.body.append(h('p', { className: 'hint compose-empty', textContent: 'Open Sidecar and unlock it, then expand the composer again.' }));
      return;
    }
    const settings = await call({ type: 'SIDECAR_GET_SETTINGS' }).catch(() => ({}));
    applyTheme(settings, state.activePubkey);
    reduceMotion = !!(settings && settings.reduceBalanceMotion);

    paintWho();
    paintLocked();

    dkey = state.activePubkey;
    const saved = await loadDraft();
    // Same strip as the account switch: a draft saved before the URLs left the editor
    // carries them in its text, and publishing must not append them twice.
    if (saved) draft.text = SC.stripDraftMediaUrls(saved.text, saved.media);
    if (saved && Array.isArray(saved.media)) draft.media = saved.media;
    // The relay set the panel worked out, left beside the draft when you pressed expand.
    if (saved && Array.isArray(saved.expandRelays)) handoverRelays = saved.expandRelays;

    editorApi = composer.createMentionEditor({
      placeholder: 'What’s on your mind?',
      onChange: (text) => { draft.text = text; paintCount(); scheduleSave(); },
      // A URL pasted on its own becomes a real attachment: cut from the prose,
      // into the strip, appended at publish — as if it had been uploaded.
      onAttachUrl: (url) => {
        SC.removeUrlFromEditor(editorApi.editor, url);
        draft.media.push({ url, isVideo: false });
        editorApi.sync(); // re-emit after the direct DOM cut, so the draft agrees
        scheduleSave();
        paintCount();
        renderThumbs();
      },
    });
    editorApi.editor.classList.add('compose-editor-lg');
    $('compose-slot').append(editorApi.wrap);
    editorApi.setText(draft.text);
    buildToolbar();
    // THE DRAFT'S OWN RUNG FIRST, then the account's. Seeding from Settings alone meant an
    // account that had asked for 20 bits got none of them here, and seeding from Settings
    // over a draft meant a rung chosen in the panel a second before pressing Expand was
    // thrown away on arrival. Both are the same mistake: the difficulty is a decision
    // about this note, and it travels with it.
    powForThisPost = await seedPow(saved);
    repaintPow();
    buildTabs();
    renderThumbs();
    paintCount();
    editorApi.focus();

    $('compose-post').addEventListener('click', () => {
      if (mining) return composer.powCancel();
      if (countdown) return; // the review window owns the screen while it runs
      reviewThenPost();
    });

    // THE PANEL BESIDE THIS TAB NEVER TAKES ITS FOCUS. Unlocking there would otherwise
    // leave this page still saying Unlock to post until something else happened to it,
    // so the worker says so instead. It already broadcast the lock for the same reason.
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== 'SIDECAR_EVENT') return;
      if (msg.event !== 'locked' && msg.event !== 'unlocked') return;
      if (state) state.locked = msg.event === 'locked';
      paintLocked();
      if (msg.event === 'unlocked') {
        toast('Unlocked. Your draft is still here.', 'success');
        // AND SAVED, NOW THAT THE STORE ANSWERS. A save attempted while the store was
        // locked fails, and persistDraft swallows it on purpose — but everything typed
        // since the lock existed only in this page's memory, so the unlock is the
        // moment it can finally land. Without this flush, closing the tab the wrong
        // way (a crash, a discarded tab, a browser quit) loses the last stretch of
        // the note while the earlier text, saved before the lock, looks fine.
        flushDraft();
      }
    });
    // Two ways out, the same way out. The corner box is where every sheet in the panel
    // puts one; the word in the footer is for anyone reading the row rather than the
    // corner. Both keep the draft, because neither is a decision to throw it away.
    const leave = () => { flushDraft().then(() => window.close()); };
    const x = $('compose-x');
    x.append(icon('x'));
    x.addEventListener('click', leave);
    $('compose-close').addEventListener('click', leave);
    // A tab can be closed without pressing anything, and the 400ms debounce means the
    // last sentence is the one at risk. Cancel and the close box chain their close off
    // the save, so they were never the problem.
    //
    // VISIBILITYCHANGE IS THE ONE THAT ARRIVES. beforeunload fires as the document is
    // being torn down, and persistDraft is an async round trip through the worker: the
    // page can be gone before the write lands, which is why the guidance everywhere is
    // not to start async work there. Hiding a tab fires visibilitychange first and the
    // document stays alive afterwards, so the write completes. Switching tabs saves too,
    // which costs one storage write and means the draft is already safe by the time
    // anything closes.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushDraft();
      else refreshWho();
    });
    // Focus as well as visibility: a second window can be raised over this one without
    // the tab ever having been hidden.
    window.addEventListener('focus', refreshWho);
    // Kept as a backstop for the paths visibilitychange can miss, and harmless when the
    // write does not land, since by then the other one usually has.
    window.addEventListener('beforeunload', flushDraft);
  }

  boot().catch((e) => {
    document.body.innerHTML = '';
    document.body.append(h('p', { className: 'hint compose-empty', textContent: e.message || 'Sidecar could not open the composer.' }));
  });
})();
