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
  const I18N = window.SidecarI18n;
  const { t, tn } = I18N;
  const NT = window.NostrTools;
  const $ = (id) => document.getElementById(id);

  const BG_TIMEOUT_MS = 15000;

  // Lifted from the panel unchanged. A page that talks to the worker needs exactly this
  // much: a timeout, lastError read inside the callback, and a synchronous throw caught
  // for the case where the extension context has gone away under us.
  function bg(message, timeoutMs) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, arg) => { if (!done) { done = true; clearTimeout(timer); fn(arg); } };
      const timer = setTimeout(
        () => finish(reject, new Error(t('Sidecar’s background worker did not respond.'))),
        timeoutMs || BG_TIMEOUT_MS
      );
      try {
        chrome.runtime.sendMessage(message, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) return finish(reject, new Error(err.message || t('Sidecar’s background worker is unavailable.')));
          finish(resolve, resp);
        });
      } catch (e) {
        finish(reject, e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
  async function call(message) {
    const resp = await bg(message);
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || t('Request failed'));
    return resp.result;
  }

  // ---- the smallest toast that is still a toast ----
  //
  // The panel's class names, so styles.css dresses this without a rule of its own. The
  // panel's version also dedupes repeats and holds a progress kind open; neither has a
  // caller here, and copying them would be copying maintenance rather than behavior.
  function toast(message, kind) {
    const host = $('toasts');
    const el = h('div', { className: 'toast toast-' + (kind === 'error' ? 'error' : 'success') });
    el.append(icon(kind === 'error' ? 'alert' : 'check'));
    el.append(h('span', { textContent: message }));
    host.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const dismiss = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
    const timer = setTimeout(dismiss, 3600);
    el.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
    return el;
  }

  // ---- state ----
  let state = null;
  let draft = { text: '', media: [], poll: null };
  let dkey = null;
  let saveTimer = null;
  let posting = false;
  let followCache = null;
  let handoverRelays = null;
  // WHAT THIS TAB IS ANSWERING, or null for a plain note. Read from the draft rather
  // than from the URL: the id in the query says WHICH draft to open, and the draft is
  // what actually carries the target. A tab told to open a reply whose draft has since
  // been posted or dropped falls back to a plain note rather than inventing a thread.
  let replyTo = null;
  let reduceMotion = false;
  let countdown = null;

  const shortNpub = (npub) =>
    (typeof npub === 'string' && npub.length > 20 ? npub.slice(0, 10) + '…' + npub.slice(-4) : npub || '');

  const THEME_ALIASES = { 'art-deco': 'industria' };
  const VALID_THEMES = ['speakeasy', 'metropolis', 'film-noir', 'brownstone', 'nixie', 'cast-iron', 'wabi-sabi', 'constellation', 'jazz-age', 'departures',
    'industria', 'aegean', 'bauhaus', 'populuxe', 'par-avion', 'werkstatte', 'ukiyo-e', 'mycelium', 'ben-day', 'turnstile'];
  // Light themes whose composer bar is drawn dark, so it takes the light wordmark. Above
  // applyTheme, which reads it and can run before anything below this line has.
  const { COMPOSE_DARK_BAR_THEMES } = window.SidecarCore;
  function applyTheme(settings, pubkey) {
    const by = (settings && settings.themeBy) || null;
    let name = (by && pubkey && by[pubkey]) || (settings && settings.theme) || 'speakeasy';
    name = THEME_ALIASES[name] || name;
    if (!VALID_THEMES.includes(name)) name = 'speakeasy';
    document.documentElement.setAttribute('data-theme', name);
    // For the next load's first paint (compose-boot.js), before any message is answered.
    try { localStorage.setItem('sidecar_compose_theme', name); } catch (_) {}
    // The wordmark is baked lavender for a dark field and disappears on marble or
    // eggshell, so the six light themes get the dark-wordmark cut. Same function the
    // panel uses, from the same set, so a new theme is registered once.
    // Ben Day is a light theme but draws this bar black (themes/ben-day.css), so its bar
    // takes the light wordmark, the one the help pages' dark bar uses in every theme.
    const logo = $('compose-logo');
    if (logo) logo.src = COMPOSE_DARK_BAR_THEMES.has(name) ? 'icons/sidecar-logo.svg' : logoSrcFor(name);
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
      textContent: t('Also search every Nostr name? This uses a third-party index (api.nostrarchives.com) that sees what you type and who you follow.'),
    }));
    const yes = h('button', { className: 'na-ask-yes', type: 'button', textContent: t('Search everyone') });
    const no = h('button', { className: 'na-ask-no', type: 'button', textContent: t('Just my follows') });
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
    const hasContent = !!((draft.text && draft.text.trim()) || (draft.media && draft.media.length)
      || (draft.poll && draft.poll.options && draft.poll.options.some((o) => o.trim())));
    if (hasContent) {
      all[dkey] = { ...(all[dkey] || {}), text: draft.text, media: draft.media, savedAt: Date.now() };
      // Written back on every save. The spread above preserves it when it is already
      // there, but a slot this tab created from scratch would otherwise hold a reply
      // with no target, and the panel would reopen it as a plain note.
      if (replyTo) all[dkey].replyTo = replyTo;
      if (draft.poll) all[dkey].poll = draft.poll;
      else if (all[dkey]) delete all[dkey].poll;
      // The difficulty travels with the note, the same as the text does, so cancelling out
      // of this tab and reopening the panel's composer finds the rung still chosen.
      if (draft.pow) all[dkey].pow = draft.pow;
    }
    // A REPLY WITH NOTHING TYPED YET STILL KEEPS ITS SLOT, because the slot is where the
    // target lives and the target is the one thing here that cannot be reconstructed.
    // Deleting it on the first save of an untouched reply is the same shape of bug the
    // panel's handoff had: reload the tab and the parent note is simply gone.
    else if (replyTo) {
      all[dkey] = { ...(all[dkey] || {}), text: '', media: [], replyTo, savedAt: Date.now() };
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
    status.textContent = (state && state.locked) ? t('Sidecar is locked.') : '';
  }

  // THE DRAFT SLOT THIS TAB OWNS. A reply lives in its own slot, keyed by the note it
  // answers, exactly as the panel keys it: one account can hold a plain draft and a
  // reply to each of several notes at once, and they must not overwrite each other.
  // Mirrors draftKey() in sidepanel.js; pinned to it by test.
  function slotFor(pubkey) {
    return replyId ? pubkey + '|r:' + replyId : pubkey;
  }

  // Which note this tab is answering. Seeded from the URL it was opened with and
  // REASSIGNABLE, because an already-open tab cannot be navigated to a new one: doing
  // that needs the "tabs" permission, which this extension deliberately does not ask
  // for, and chrome.tabs.update fails silently without it. So the panel sends a message
  // and the tab re-keys itself instead. `let`, not `const`, for exactly that.
  let replyId = (() => {
    try {
      const v = new URLSearchParams(location.search).get('reply') || '';
      // A draft key is built from this, so it has to be a note id and nothing else.
      return /^[0-9a-f]{64}$/i.test(v) ? v.toLowerCase() : null;
    } catch (_) { return null; }
  })();

  // The note being answered, drawn above the tabs. Deliberately NOT the panel's
  // buildReplyBlock: that one reaches for five panel-only helpers, and what this needs
  // is a face, a name and the text, all of which this file already knows how to get.
  function paintReplyTarget() {
    const box = document.getElementById('compose-reply-target');
    if (!box) return;
    box.innerHTML = '';

    // IT SAYS SO WHEN IT CANNOT FIND WHAT IT WAS SENT TO ANSWER.
    //
    // This tab is only ever given a ?reply= by the panel pressing Expand on a reply, so
    // an id with no draft behind it means the handoff did not arrive. Silence there is
    // what made this so hard to place: the tab looked like an ordinary new note, which
    // is also exactly what it looks like when nothing is wrong, so there was no way to
    // tell a broken handoff from a tab somebody opened themselves.
    //
    // Not dev-only. A user who presses Expand and gets a blank note needs to know their
    // reply is not attached to anything, before they write it and post it as a note.
    if (!replyTo && replyId) {
      box.classList.remove('hidden');
      box.classList.add('reply-target-lost');
      box.append(
        h('div', { className: 'reply-target-name', textContent: t('The note you were answering could not be loaded') }),
        h('div', { className: 'reply-target-body', textContent:
          t('This will post as a new note, not a reply. Close this tab and reply from the panel instead.') }),
        h('div', { className: 'reply-target-body reply-target-dbg', textContent: 'slot ' + dkey }),
      );
      return;
    }

    if (!replyTo) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.classList.remove('reply-target-lost');

    const av = h('span', { className: 'avatar reply-target-av' });
    applyAvatar(av, null);
    const name = h('span', { className: 'reply-target-name', textContent: t('Loading…') });
    box.append(h('div', { className: 'reply-target-who' }, [av, name]));

    const body = h('div', { className: 'reply-target-body' });
    // NO CAP HERE. The panel truncates at 240 because it has 360px to work with; this
    // tab is the room the panel does not have, so the note it is answering is shown
    // whole and the CSS lets it scroll if it is very long.
    // composer.renderNoteText, NOT SC.renderNoteText. It is returned by installComposer,
    // not exported on the core: the core's own comment says so, listing "a reply's
    // context strip" among the callers. SC.renderNoteText is undefined, and calling it
    // throws mid-paint with the page half built.
    composer.renderNoteText(body, replyTo.content || '', Infinity);
    SC.makeMediaExpandable(box, body);
    box.append(body);
    box.classList.add('is-open');

    fetchPreviewProfile(replyTo.pubkey).then((p) => {
      if (!box.isConnected) return;
      if (p && p.name) name.textContent = p.name;
      // Same fallback the mention resolver two hundred lines down already uses, rather
      // than SC.shortNpub, which the core passes in as a dep and does not export.
      else {
        try { name.textContent = shortNpub(NT.nip19.npubEncode(replyTo.pubkey)); }
        catch (_) { name.textContent = replyTo.pubkey.slice(0, 10) + '\u2026'; }
      }
      if (p && p.picture) applyAvatar(av, p);
    }).catch(() => {});
  }

  // ---- the other drafts, one tap away ----
  //
  // A reply in progress used to hide the note you were writing, and the only way back was
  // through the panel. "Saved drafts" sits at the far end of the Write / Preview row and
  // lists every other draft this account holds, built by composer-core so the panel's
  // list is the same one. A tap does what the panel's switch message does: what is on
  // screen goes back to its own slot first, then the key moves. No "New note" entry: a
  // reply is a reply, and a new note starts from the panel's button.
  const draftHasContent = SC.draftHasContent;
  function busy() { return posting || mining || !!countdown; }

  async function readAllDrafts() {
    try { return (await call({ type: 'SIDECAR_SECRET_GET', store: 'drafts' })) || {}; }
    catch (_) { return {}; }
  }

  // NOT THE DRAFT THE PANEL HAS OPEN. Listed here it could be deleted while the panel
  // is writing it, and the panel's next autosave would put it straight back. The panel
  // leaves its key in session storage; it is believed only while a side panel is open,
  // so one closed without tidying up cannot hide a draft. A browser without
  // getContexts lists everything, which is how this worked before.
  async function draftOpenInPanel() {
    try {
      if (!chrome.runtime.getContexts || !chrome.storage.session) return null;
      const panels = await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] });
      if (!panels || !panels.length) return null;
      const got = await chrome.storage.session.get('sidecar_panel_compose');
      return (got && got.sidecar_panel_compose) || null;
    } catch (_) { return null; }
  }

  // The folder, its count, and the list if it is the one showing. Called whenever the set
  // of drafts could have changed: a switch, an account change, a post, coming back.
  async function paintSavedDrafts() {
    const btn = $('compose-drafts-btn');
    if (!btn || !state || !state.activePubkey) return;
    const inPanel = await draftOpenInPanel();
    const others = SC.otherDraftEntries(await readAllDrafts(), state.activePubkey, dkey)
      .filter((e) => e.key !== inPanel);
    const pane = $('compose-drafts-pane');
    const listing = !pane.classList.contains('hidden');
    // Not while the list is up: the list is what it opens, and "Back to your draft" is
    // the way out of it, as in the panel.
    btn.classList.toggle('hidden', !others.length || listing);
    document.querySelector('.compose-sheet').classList.toggle('has-drafts-btn', !!others.length && !listing);
    $('compose-drafts-count').textContent = I18N.fmtNum(others.length);
    // Said in words, because the count is the button's only text and would otherwise be
    // its whole name to a screen reader: "2".
    btn.setAttribute('aria-label', tn('{{count}} saved draft', '{{count}} saved drafts', others.length));
    if (!listing) return;
    if (!others.length) { showTab('write'); return; }
    pane.innerHTML = '';
    const back = h('button', { className: 'ghost compose-drafts-back', type: 'button', textContent: t('Back to your draft') });
    back.addEventListener('click', () => showTab('write'));
    pane.append(h('h3', { className: 'compose-drafts-title', textContent: t('Saved drafts') }));
    pane.append(SC.buildSavedDraftList({
      entries: others,
      nameFor: (pk) => fetchPreviewProfile(pk).then((p) => (p && p.name) || null),
      onPick: (entry) => switchToDraft(entry.replyId),
      onDelete: async (entry) => {
        // A pending save writes the whole store back, so it lands first rather than
        // putting the deleted draft back a moment later.
        await flushDraft();
        const all = await readAllDrafts();
        delete all[entry.key];
        await call({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: all });
        toast(t('Draft deleted.'), 'success');
        paintSavedDrafts();
      },
    }));
    pane.append(back);
  }

  // The one way this tab moves between drafts, for a chip and for the panel's message
  // alike. Leaving a reply with something in it says where it went, since the editor it
  // was in is about to show something else.
  async function switchToDraft(want) {
    if (busy() || want === replyId) return;
    const leavingReply = !!replyTo && draftHasContent(draft);
    await flushDraft();
    replyId = want;
    // The address follows, so a reload opens the draft on screen rather than the one
    // the tab was first opened on.
    try {
      history.replaceState(null, '', location.pathname + (want ? '?reply=' + want : ''));
    } catch (_) {}
    await reopenDraft();
    showTab('write');
    if (leavingReply) toast(t('Your reply is saved.'), 'info');
  }

  // RELOAD FROM WHATEVER SLOT dkey NOW NAMES. The account switch does this inline for
  // its own reasons; this is the same work for the other thing that moves a slot, which
  // is the panel pointing this tab at a different draft.
  async function reopenDraft() {
    dkey = slotFor(state.activePubkey);
    handoverRelays = null;
    const saved = await loadDraft();
    draft.text = SC.stripDraftMediaUrls(saved && saved.text, saved && saved.media);
    draft.media = (saved && Array.isArray(saved.media)) ? saved.media : [];
    replyTo = (saved && saved.replyTo && saved.replyTo.id) ? saved.replyTo : null;
    if (saved && Array.isArray(saved.expandRelays)) handoverRelays = saved.expandRelays;
    draft.poll = (saved && saved.poll) || null;
    if (pollEditor) pollEditor.paint();
    paintReplyTarget();
    closeAltEditor();
    powForThisPost = await seedPow(saved);
    repaintPow();
    editorSetText(draft.text);
    renderThumbs();
    paintCount();
    paintSavedDrafts();
  }

  function paintWho() {
    const acct = (state.accounts || []).find((a) => a.pubkey === state.activePubkey) || {};
    $('compose-name').textContent = acct.name || shortNpub(acct.npub) || t('Your account');
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
    dkey = slotFor(state.activePubkey);
    handoverRelays = null; // a different account can publish somewhere else entirely
    followCache = null;
    const saved = await loadDraft();
    // Strip the attachment URLs an older draft carried in its text: they live in the
    // media slot alone now, or publishing would append them a second time.
    draft.text = SC.stripDraftMediaUrls(saved && saved.text, saved && saved.media);
    draft.media = (saved && Array.isArray(saved.media)) ? saved.media : [];
    // The slot moved with the account, so what it is answering moves too. Replying to
    // one note from two accounts is two drafts, and the new account may not have one.
    replyTo = (saved && saved.replyTo && saved.replyTo.id) ? saved.replyTo : null;
    draft.poll = (saved && saved.poll) || null;
    if (pollEditor) pollEditor.paint();
    paintReplyTarget();
    // The row edits a slot of the PREVIOUS account's draft, which was just swapped
    // under it — the same reason the editor itself is rewritten below.
    closeAltEditor();
    // Per account, so it re-seeds with everything else the account decides, and from the
    // new account's own draft if that draft carries a rung.
    powForThisPost = await seedPow(saved);
    repaintPow();
    editorSetText(draft.text);
    renderThumbs();
    paintSavedDrafts(); // another account, another set of drafts
    paintCount();
    const acct = (state.accounts || []).find((a) => a.pubkey === state.activePubkey) || {};
    toast(t('Now writing as {{name}}', { name: acct.name || shortNpub(acct.npub) || t('another account') }), 'success');
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
      title: t('Posting your note'),
      preview,
      confirmLabel: t('Post now'),
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
    // Back on this draft's own view, which is what the review window hands back to, and
    // the folder goes with the rest: a post is decided, so there is nothing to switch to,
    // and a control left showing that does nothing reads as broken.
    if (on) { showTab('write'); $('compose-drafts-btn').classList.add('hidden'); }
    document.querySelector('.compose-sheet').classList.toggle('is-reviewing', on);
    $('compose-slot').classList.toggle('hidden', on);
    $('compose-tabs').classList.toggle('hidden', on);
    $('compose-actions').classList.toggle('hidden', on);
    // The whole footer, not its two buttons. Hiding those alone left the character count
    // dangling under the countdown's own row, attached to nothing.
    document.querySelector('.compose-foot').classList.toggle('hidden', on);
    // Nothing to switch to while a post is decided, and back when it is canceled.
    if (!on) paintSavedDrafts();
  }

  async function doPost() {
    if (posting) return;
    const text = (draft.text || '').trim();
    // Media alone is a postable note: the URLs live in the media slot, not in the
    // text, so the prose being empty no longer means the note is.
    if (!text && !draft.media.length) return;
    posting = true;
    paintCount();
    $('compose-drafts-btn').classList.add('hidden');
    const status = $('compose-status');
    try {
      // THREADING FIRST, from the same builder the panel uses. NIP-10 readers take the
      // first e marked root as the thread and NIP-22 scope is read positionally, so
      // these lead; the client tag and imeta follow.
      const reply = replyTo ? SC.replyTags(replyTo, state.activePubkey) : null;
      // A POLL IS ITS OWN KIND, and never a reply: a 1068 answering a note is not a
      // shape anything threads, which is why the editor refuses to offer one there.
      const asPoll = draft.poll && !replyTo;
      let template = {
        kind: asPoll ? SC.POLL_KIND : reply ? reply.kind : 1,
        created_at: Math.floor(Date.now() / 1000),
        // One imeta per DESCRIBED attachment (NIP-92, as zap.cooking writes it),
        // describing the same URLs composeNoteContent appends to the content, in
        // the same order. Undescribed media emits nothing, so a note of bare URLs
        // is byte-identical to what it published before alt text existed.
        tags: [
          ...(reply ? reply.tags : []),
          ['client', 'Sidecar'],
          ...(asPoll ? SC.buildPollTags(draft.poll, Math.floor(Date.now() / 1000), await targetRelays()) : []),
          ...SC.imetaTagsForMedia(draft.media),
        ],
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
        setMining(true, powForThisPost.bits);
        const mined = await composer.minePow(
          { ...template, pubkey: state.activePubkey },
          powForThisPost.bits,
          (p) => paintMineProgress(p.best)
        );
        // The pubkey is dropped again: the signer sets it from the key it signs with, and
        // sending our own copy invites the two to disagree about the one field neither of
        // them should be guessing at.
        const { pubkey: _mined, ...rest } = mined.event;
        template = rest;
        mineDone();
      }
      status.textContent = t('Signing…');
      const signed = await call({
        type: 'SIDECAR_OWNER_SIGN', event: template, expectedPubkey: state.activePubkey,
      });
      status.textContent = t('Publishing…');
      const relays = await targetRelays();
      if (!relays.length) throw new Error(t('No relays configured (add some in Settings)'));
      const results = await Promise.allSettled(pool().publish(relays, signed));
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      if (!ok) throw new Error(t('No relay accepted the note. It is still saved as a draft.'));
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
      // WHAT WENT OUT, for the receipt, before the draft forgets it.
      const what = signed.kind === SC.POLL_KIND ? 'poll' : replyTo ? 'reply' : 'note';
      // ALL of it goes, the poll and the target included, so the save below deletes the
      // slot. Clearing only the text left a posted poll's options behind, saved as a
      // draft one tap from going out twice, and a reply's slot kept its target.
      draft.text = '';
      draft.media = [];
      draft.poll = null;
      replyTo = null;
      await persistDraft();
      editorSetText('');
      renderThumbs();
      status.textContent = '';
      await showPosted(signed, ok, what);
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
        toast(t('Sidecar is locked. Unlock it, then press Post again.'), 'error');
      } else toast(e.message || t('Could not post'), 'error');
    }
    setMining(false);
    posting = false;
    paintCount();
    paintLocked();
    paintSavedDrafts();
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
      post.textContent = t('Stop mining');
      post.className = 'secondary compose-post';
      post.disabled = false;
      return;
    }
    if (state && state.locked) {
      // Inert, and saying so. There is no route from this page to the unlock, so a button
      // that looked pressable would be the third thing today that does nothing when it is.
      post.textContent = t('Unlock to post');
      post.className = 'secondary compose-post';
      post.disabled = true;
      return;
    }
    post.textContent = t('Post');
    post.className = 'primary compose-post';
    const n = (draft.text || '').trim().length;
    if (draft.poll) {
      // A poll needs its question, where a plain note can be an image on its own: the
      // content IS the question, and a 1068 with empty content is a set of options
      // nobody can interpret. Two filled options is the other floor, and a custom end
      // time nobody has picked yet is not postable either. Same three as the panel.
      const endsOk = draft.poll.ends.kind !== 'at' || draft.poll.ends.at > 0;
      post.disabled = posting || !n || !SC.pollDraftIsPostable(draft.poll) || !endsOk;
      return;
    }
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
  // MINING TAKES THE CARD, the way publishing does one step later. It used to leave the
  // editor on screen and switch off everything in it: the editor itself, the toolbar, the
  // tabs, the ALT row's buttons, the ALT field. That was a whole function spent
  // neutralizing a surface that had no business being there, and it still left the note
  // you had written sitting under a mine that had already snapshotted it, which reads as
  // though it were still being edited.
  //
  // The panel never had this problem because its mining pane takes over the screen, and
  // this page already knows the move: showPosted turns the card into the receipt on the
  // same argument, that a tab has nothing underneath it. So mining gets the same
  // treatment one step earlier.
  //
  // HIDDEN, NOT REPLACED, which is the one way this differs from the receipt. The receipt
  // empties the sheet because it never comes back; a mine can be stopped, and can fail,
  // and the editor has to return with the draft and the caret exactly as they were. So
  // the card's own children are hidden by a class and the mining panel sits beside them,
  // and setMining(false) on every exit path from doPost is what puts them back.
  let mining = false;
  let mineCard = null;
  function setMining(on, bits) {
    if (mining === on) return;
    mining = on;
    paintPostButton();
    const sheet = document.querySelector('.compose-sheet');
    if (!on) {
      sheet.classList.remove('is-mining');
      if (mineCard) { clearInterval(mineCard._tick); mineCard.remove(); mineCard = null; }
      return;
    }
    if (editorApi) editorApi.close(); // no mention dropdown left hanging over a hidden box
    // THE PANEL'S OWN MINING PANE, IN THIS PAGE'S CARD. Same classes, not a parallel set:
    // .mining-glyph, .mining-line and the hint are the panel's, so the two screens cannot
    // drift into looking like different features, and the reasoning already written into
    // those rules comes with them. Chiefly the pulse, which is deliberate and which a
    // rotation quietly undid: mining is a search with no position in it, so anything that
    // sweeps or turns implies progress toward a finish that does not exist.
    //
    // The elapsed seconds come with it too. Without them the screen reads as frozen at
    // exactly the difficulty where somebody most needs to see it is alive, and the line
    // is tabular so the count does not jitter the text beside it.
    mineCard = h('div', { className: 'compose-mining' });
    const glyph = icon('pickaxe');
    glyph.classList.add('mining-glyph');
    const line = h('div', { className: 'mining-line' });
    const note = h('p', { className: 'hint', textContent: t('Stopping keeps your draft.') });
    const stop = h('button', { className: 'secondary', type: 'button', textContent: t('Stop mining') });
    stop.addEventListener('click', () => composer.powCancel());
    mineCard.append(
      h('h2', { className: 'compose-done-title', textContent: t('Mining proof of work') }),
      h('div', { className: 'mining-body' }, [glyph, line, note]),
      h('div', { className: 'compose-done-actions' }, [stop])
    );

    const startedAt = Date.now();
    let best = 0;
    const paint = () => {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      line.textContent = bits + ' bits · ' + secs + 's' + (best ? ' · best ' + best : '');
    };
    paint();
    // Its own clock rather than only painting when the worker reports, for the reason the
    // panel gives: reports arrive per block of attempts, so on a slow machine they can be
    // seconds apart, and a screen that moved only with them would look stopped.
    const timer = setInterval(paint, 1000);
    mineCard._tick = timer;
    mineCard._progress = (b) => { if (b > best) best = b; paint(); };
    sheet.append(mineCard);
    sheet.classList.add('is-mining');
  }
  // Every attempt is independent, so there is no progress to report and nothing that could
  // honestly fill a bar. The best difficulty found so far is the one true number, and it
  // is the one the panel shows too.
  function paintMineProgress(best) {
    if (mineCard && mineCard._progress) mineCard._progress(best);
  }

  // THE WORK IS DONE BUT THE POST IS NOT, which is the panel's own wording for this and
  // its own handling. Signing and the relays still have to happen, and dropping the card
  // the instant the nonce is found put the editor back on screen for that second or two:
  // reported as "after mining stopped I saw the post preview briefly", which is exactly
  // what it was, and reads as the note having been handed back rather than sent.
  //
  // So the card stays until the receipt replaces it, with Stop taken away rather than
  // left offering to cancel a mine that has already finished. setMining(false) in the
  // tail of doPost still runs, and on the success path it now finds a card the receipt
  // has already detached, which costs nothing.
  function mineDone() {
    if (!mineCard) return;
    clearInterval(mineCard._tick);
    mineCard._progress = null;
    const stop = mineCard.querySelector('.compose-done-actions button');
    if (stop) stop.disabled = true;
    const line = mineCard.querySelector('.mining-line');
    if (line) line.textContent = t('Found it. Posting…');
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

  async function showPosted(signed, relayCount, what) {
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
    // Defensively, though setMining(false) already ran: is-mining hides every child of
    // the sheet but the close box, so a receipt painted under it would be invisible.
    sheet.classList.remove('is-mining');
    sheet.classList.add('compose-done');
    const mark = h('span', { className: 'compose-done-mark' });
    mark.append(icon('check'));
    sheet.append(
      mark,
      h('h2', { className: 'compose-done-title', textContent: what === 'poll' ? t('Your poll is live.')
        : what === 'reply' ? t('Your reply is live.') : t('Your note is live.') }),
      h('p', {
        className: 'compose-done-sub',
        textContent: tn('Published to {{count}} relay.', 'Published to {{count}} relays.', relayCount),
      })
    );

    const row = h('div', { className: 'compose-done-actions' });
    if (href) {
      const open = document.createElement('a');
      open.className = 'primary compose-done-open';
      open.href = href;
      open.target = '_blank';
      open.rel = 'noreferrer noopener';
      open.textContent = t('Open in {{client}}', { client: label });
      row.append(open);
    }
    const again = h('button', { className: 'mini ghost', type: 'button', textContent: t('Write another') });
    // A NEW NOTE, not this page again. After a reply the address still names the note it
    // answered, and reloading it opened another reply to the same note.
    again.addEventListener('click', () => window.location.replace(location.pathname));
    row.append(again);
    sheet.append(row);

    const done = h('button', { className: 'compose-cancel', type: 'button', textContent: t('Close this tab') });
    done.addEventListener('click', () => window.close());
    sheet.append(done);
  }

  // ---- thumbnails for what has been uploaded ----
  function renderThumbs() {
    const host = $('compose-thumbs');
    host.innerHTML = '';
    // A POLL AND ATTACHMENTS ARE ONE OR THE OTHER, and every change to the attachments
    // comes through here: an upload, a paste, a removal, a draft loaded. The Poll button
    // stood its ground after an upload, because nothing here told it to.
    if (pollEditor) pollEditor.paintEitherOr();
    // Where a dragged thumb will land, across renderThumbs' rebuilds.
    let dragFrom = -1;
    draft.media.forEach((m, i) => {
      const cell = h('div', { className: 'compose-thumb' });
      const el = document.createElement(m.isVideo ? 'video' : 'img');
      // Many media hosts reject a chrome-extension:// referrer and answer 403, which
      // renders as a broken thumb rather than as an error anyone can act on.
      el.referrerPolicy = 'no-referrer';
      // A VIDEO IS NEVER DECODED FOR THE STRIP: metadata is the header alone, and the
      // cover below is opaque so no frame is ever painted. Same treatment as the panel,
      // from the same builder, because two strips drawing a video two ways is the kind
      // of difference nobody notices until somebody reports one of them.
      if (m.isVideo) { el.preload = 'metadata'; el.muted = true; }
      el.src = m.url;
      // The cell is what drags; an img's own native drag would hijack the gesture.
      el.draggable = false;
      cell.append(el);
      // Before the remove button and the steppers, so those stay on top of it.
      if (m.isVideo) {
        cell.append(SC.videoThumbCover(m.url));
        SC.primeVideoThumb(el, cell);
      }
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
          title: m.alt ? t('Edit the image description') : t('Add a description'),
          type: 'button',
        });
        alt.textContent = m.alt ? '✓ ALT' : '+ ALT';
        alt.addEventListener('click', () => openAltEditor(i));
        cell.append(alt);
      }
      // THE STRIP REORDERS BY MORE THAN DRAG. HTML5 drag-and-drop never fires
      // on touch, so a touchscreen had no way to reorder at all and a keyboard
      // had none either; the steppers are the cheapest reorder there is, and
      // they are buttons, which touch and Tab both reach. The ends hide theirs,
      // because a disabled arrow is a control answering "you can't".
      if (draft.media.length > 1) {
        const step = (dir, label) => {
          const b = h('button', { className: 'compose-thumb-move ' + (dir < 0 ? 'left' : 'right'), title: label, type: 'button' });
          b.append(icon(dir < 0 ? 'arrow-left' : 'arrow-right'));
          b.addEventListener('click', () => {
            const to = i + dir;
            if (to < 0 || to >= draft.media.length) return;
            closeAltEditor(); // flush first: the row's slot is still where it was opened
            const movedItem = draft.media.splice(i, 1)[0];
            draft.media.splice(to, 0, movedItem);
            scheduleSave();
            renderThumbs();
          });
          return b;
        };
        if (i > 0) cell.append(step(-1, t('Move earlier')));
        if (i < draft.media.length - 1) cell.append(step(1, t('Move later')));
      }
      const rm = h('button', { className: 'compose-thumb-x', title: t('Remove'), type: 'button' });
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

  // The poll editor, from composer-core, the same one the panel builds. Held here so
  // the draft load and the publish path can both reach it.
  let pollEditor = null;
  // Set by buildToolbar: uploads files into the attachments, as the Media button does.
  let uploadFiles = async () => {};

  // ---- the toolbar: media, a poll, and a proof of work for this note ----
  function buildToolbar() {
    const row = $('compose-actions');
    const err = $('compose-err');

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,video/*';
    fileInput.style.display = 'none';
    const addBtn = h('button', { className: 'mini compose-add', type: 'button' });
    addBtn.append(icon('camera'), h('span', { textContent: t('Media') }));
    addBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) await uploadFiles([file]);
      fileInput.value = '';
    });
    // The Media button and a pasted image take the one path.
    uploadFiles = async (files) => {
      err.textContent = '';
      addBtn.disabled = true;
      const lbl = addBtn.querySelector('span');
      const prev = lbl.textContent;
      lbl.textContent = t('Uploading…');
      addBtn.classList.add('is-uploading'); // the whole button sweeps (styles.css)
      try {
        for (const file of files) {
          const url = await composer.uploadMedia(file, state.activePubkey);
          // Into the media slot only. The URL is appended to the content at publish
          // (SC.composeNoteContent), so nothing touches the editor here — and since no
          // input event fires, both the autosave and the Post button (media alone is
          // postable) have to be told by hand.
          draft.media.push({ url, isVideo: file.type.startsWith('video/') });
        }
        scheduleSave();
        paintCount();
        renderThumbs();
      } catch (e) {
        err.textContent = e.message;
        toast(e.message, 'error');
      }
      addBtn.disabled = false;
      addBtn.classList.remove('is-uploading');
      lbl.textContent = prev;
    };

    // Cycles Off, 16, 18, 20, 22 and back, the same ladder and the same labels as the
    // panel. "PoW 18" and "PoW off" are the same width, so cycling never makes the row
    // opposite it jump.
    const powBtn = h('button', { className: 'mini compose-add', type: 'button' });
    const powLabel = h('span');
    powBtn.append(icon('pickaxe'), powLabel);
    function paintPow() {
      const lvl = powForThisPost.on ? SC.powLevelFor(powForThisPost.bits) : null;
      powLabel.textContent = lvl ? t('PoW {{bits}}', { bits: lvl.bits }) : t('PoW off');
      powBtn.title = lvl ? lvl.cost() : t('Off. Tap to mine one into this post.');
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

    pollEditor = SC.buildPollEditor({
      poll: () => draft.poll || null,
      setPoll: (p) => { draft.poll = p; },
      // Both, always. They were two calls in the panel and two sites only saved, which
      // is how one of them stopped repainting Post.
      changed: () => { paintCount(); scheduleSave(); },
      // A reply CAN be a poll here as much as it cannot in the panel: same rule, same
      // reason, that a kind 1068 answering a note is not a shape anything threads.
      isReply: () => !!replyTo,
      hasMedia: () => !!(draft.media && draft.media.length),
      mediaBtn: () => addBtn,
    });
    row.append(addBtn, pollEditor.addBtn, powBtn, fileInput);
    // Below the toolbar rather than inside it: the editor is a form, and the row is a
    // row of buttons.
    row.after(pollEditor.wrap);
  }

  // ---- Write / Preview ----
  //
  // The same renderer the panel previews with, so what this shows and what that shows
  // cannot disagree about a mention, an embed or a link card.
  let showTab = () => {};
  function buildTabs() {
    const write = $('tab-write');
    const prev = $('tab-preview');
    const pane = $('compose-preview');
    const list = $('compose-drafts-pane');
    const slot = $('compose-slot');
    showTab = (which) => {
      // THE LIST TAKES THE EDITOR'S PLACE AT THE EDITOR'S SIZE, measured before the
      // editor is hidden, so the card does not jump when you open it.
      if (which === 'drafts' && !slot.classList.contains('hidden') && slot.offsetHeight) {
        list.style.minHeight = slot.offsetHeight + 'px';
      }
      write.classList.toggle('active', which === 'write');
      prev.classList.toggle('active', which === 'preview');
      // The list is not a third view of this draft, so the row naming the two views
      // steps aside while it is up.
      $('compose-tabs').classList.toggle('hidden', which === 'drafts');
      slot.classList.toggle('hidden', which !== 'write');
      pane.classList.toggle('hidden', which !== 'preview');
      list.classList.toggle('hidden', which !== 'drafts');
      // The toolbar edits this draft, so it stands down while another draft is being
      // chosen rather than offering to attach a photo to a list.
      $('compose-actions').classList.toggle('hidden', which === 'drafts');
      // And Post goes with it. From a list of other drafts it would publish the one you
      // cannot see; Cancel and the setting beside it still apply, so they stay.
      $('compose-post').classList.toggle('hidden', which === 'drafts');
      // Invisible rather than gone: it is the spacer that holds Cancel to the right.
      $('compose-count').style.visibility = which === 'drafts' ? 'hidden' : '';
      if (which === 'drafts') { paintSavedDrafts(); return; }
      if (which !== 'preview') return;
      pane.innerHTML = '';
      // What will actually go out: the prose and, appended at the end, the
      // attachments — the preview and the published note are rendered from the one
      // composed string.
      const body = SC.composeNoteContent(draft.text, draft.media);
      if (!body) {
        pane.append(h('p', { className: 'hint', textContent: t('Nothing to preview yet.') }));
        return;
      }
      const box = h('div', { className: 'preview-body' });
      composer.renderNotePreview(box, body);
      pane.append(box);
    };
    write.addEventListener('click', () => showTab('write'));
    prev.addEventListener('click', () => showTab('preview'));
    const folder = $('compose-drafts-btn');
    folder.prepend(icon('folder'));
    folder.addEventListener('click', () => { if (!busy()) showTab('drafts'); });
  }

  async function boot() {
    // The language file first, as every page does, then the static markup.
    try { await I18N.ready; } catch (_) {}
    I18N.applyDom();
    state = await call({ type: 'SIDECAR_GET_STATE' });
    if (!state || !state.activePubkey) {
      document.body.innerHTML = '';
      document.body.append(h('p', { className: 'hint compose-empty', textContent: t('Open Sidecar and unlock it, then expand the composer again.') }));
      document.documentElement.classList.remove('compose-booting');
      return;
    }
    const settings = await call({ type: 'SIDECAR_GET_SETTINGS' }).catch(() => ({}));
    applyTheme(settings, state.activePubkey);
    reduceMotion = !!(settings && settings.reduceBalanceMotion);

    paintWho();
    paintLocked();

    dkey = slotFor(state.activePubkey);
    const saved = await loadDraft();
    // Same strip as the account switch: a draft saved before the URLs left the editor
    // carries them in its text, and publishing must not append them twice.
    if (saved) draft.text = SC.stripDraftMediaUrls(saved.text, saved.media);
    if (saved && Array.isArray(saved.media)) draft.media = saved.media;
    // The relay set the panel worked out, left beside the draft when you pressed expand.
    if (saved && Array.isArray(saved.expandRelays)) handoverRelays = saved.expandRelays;
    // THE TARGET COMES OFF THE DRAFT, not off the URL. The query said which slot to
    // open; the slot is what carries what is being answered. A tab pointed at a reply
    // whose draft was posted or dropped in the meantime finds nothing here and stays a
    // plain note, which is the safe direction to fail: a note that should have been a
    // reply is visible, a reply silently published as a note is not.
    replyTo = (saved && saved.replyTo && saved.replyTo.id) ? saved.replyTo : null;
    paintReplyTarget();
    paintSavedDrafts();
    // A reply started in the panel while this tab sat in the background shows up when
    // you come back to it.
    window.addEventListener('focus', () => { paintSavedDrafts(); });
    // The poll rides in the same slot as the text, so a poll started in the panel and
    // expanded here arrives whole. Painted after buildToolbar has made the editor.
    draft.poll = (saved && saved.poll) || null;

    editorApi = composer.createMentionEditor({
      placeholder: t('What’s on your mind?'),
      onChange: (text) => { draft.text = text; paintCount(); scheduleSave(); },
      // A URL pasted on its own becomes a real attachment: cut from the prose,
      // into the strip, appended at publish — as if it had been uploaded.
      onAttachUrl: (url) => {
        SC.removeUrlFromEditor(editorApi.editor, url);
        // CONVERT, NEVER DUPLICATE: pasting a URL that is already attached takes
        // the prose line and keeps the existing entry — and its description —
        // rather than appending the image a second time.
        if (!draft.media.some((m) => m && m.url === url)) {
          draft.media.push({ url, isVideo: SC.urlIsVideo(url) });
        }
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
    // PASTE, AS THE PANEL HANDLES IT. An image on the clipboard is uploaded into the
    // attachments, and anything else goes in as plain text. Left to the browser, a
    // contenteditable takes the image as an inline picture at its own size, never
    // uploaded and never published, and rich text keeps its fonts and colors.
    editorApi.editor.addEventListener('paste', (e) => {
      const images = Array.from((e.clipboardData && e.clipboardData.items) || [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      e.preventDefault();
      if (!images.length) {
        const plain = e.clipboardData && e.clipboardData.getData('text/plain');
        if (plain) document.execCommand('insertText', false, plain);
        return;
      }
      // A poll and its attachments are one or the other; the Media button is hidden
      // for the same reason.
      if (draft.poll) { toast(t('A poll can’t carry attachments.'), 'error'); return; }
      uploadFiles(images);
    });
    // After the toolbar, because that is what builds the poll editor: a poll restored
    // from the slot above has nothing to paint into until it exists.
    paintCount();
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
      // SWITCH TO ANOTHER DRAFT, sent by the panel when Expand is pressed while this tab
      // is already open on something else. Focusing it without this showed whatever was
      // already here, which is how a reply arrived looking like a blank new note.
      if (msg && msg.type === 'SIDECAR_COMPOSE_OPEN') {
        const want = typeof msg.replyId === 'string' && /^[0-9a-f]{64}$/i.test(msg.replyId)
          ? msg.replyId.toLowerCase() : null;
        if (want === replyId) return;   // already here
        // Whatever is on screen belongs to the slot it was typed in, so it goes back
        // there before the key moves. Same rule as the account switch.
        switchToDraft(want).catch(() => {});
        return;
      }
      if (!msg || msg.type !== 'SIDECAR_EVENT') return;
      if (msg.event !== 'locked' && msg.event !== 'unlocked') return;
      if (state) state.locked = msg.event === 'locked';
      paintLocked();
      if (msg.event === 'unlocked') {
        toast(t('Unlocked. Your draft is still here.'), 'success');
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

    // WRITE HERE NEXT TIME. The panel's switch writes the same setting, so this one
    // follows storage rather than only its own clicks: flipping it in either place shows
    // in the other without a reload.
    const tabDefault = $('compose-default-toggle');
    call({ type: 'SIDECAR_GET_SETTINGS' })
      .then((s) => { tabDefault.checked = !!(s && s.composeInTab === true); })
      .catch(() => {});
    tabDefault.addEventListener('change', () => {
      call({ type: 'SIDECAR_SET_SETTINGS', settings: { composeInTab: tabDefault.checked } }).catch(() => {});
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.sidecar_settings) return;
      tabDefault.checked = (changes.sidecar_settings.newValue || {}).composeInTab === true;
    });
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

  // The card was held back by compose-boot.js until it had a theme and a draft in it.
  const shown = () => document.documentElement.classList.remove('compose-booting');
  boot().then(shown, (e) => {
    shown();
    document.body.innerHTML = '';
    document.body.append(h('p', { className: 'hint compose-empty', textContent: e.message || t('Sidecar could not open the composer.') }));
  });
})();
