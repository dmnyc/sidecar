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
    const map = await call({ type: 'SIDECAR_GET_RELAYS' });
    return Object.keys(map || {}).filter((u) => map[u].write !== false);
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
      const relays = await targetRelays();
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
      const relays = await targetRelays();
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

  // The global name search and its one-time consent ask. Both live in the panel, and the
  // honest answer for this page is that it does not offer them: the ask is a privacy
  // decision with a paragraph attached, and re-rendering that paragraph here would be a
  // second place for it to drift. Follows still autocomplete, which is the common case.
  const na = {
    available: () => false,
    setting: async () => true, // "decided", so the ask never renders
    suggest: async () => [],
    askEl: () => h('div'),
    decide: async () => {},
  };

  // Proof of work for THIS note, seeded from Settings and never written back, the same
  // way the panel treats it. Off unless the account turned it on.
  let powForThisPost = { on: false, bits: SC.POW_DEFAULT_BITS };

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
    relayUrls: () => targetRelays(),
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
    if (!next || !next.activePubkey) return;
    const moved = next.activePubkey !== state.activePubkey;
    state = next;
    paintWho();
    if (!moved) return;
    // The draft follows the account, because the slot is keyed by it. What is on screen
    // belongs to the account that was active when it was typed, so it is written back
    // there before the key moves rather than being carried across into someone else's.
    await flushDraft();
    dkey = state.activePubkey;
    handoverRelays = null; // a different account can publish somewhere else entirely
    followCache = null;
    const saved = await loadDraft();
    draft.text = (saved && saved.text) || '';
    draft.media = (saved && Array.isArray(saved.media)) ? saved.media : [];
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
    // is a thing people post.
    $('compose-post').disabled = posting || (!n && !draft.media.length);
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
    const text = (draft.text || '').trim();
    if (!text && !draft.media.length) return;
    let on = true, secs = 5;
    try {
      const s = (await call({ type: 'SIDECAR_GET_SETTINGS' })) || {};
      on = s.noteCountdown !== false;
      if (Number.isInteger(s.noteCountdownSecs)) secs = s.noteCountdownSecs;
    } catch (_) { /* a settings read that failed must not stop a post */ }
    if (!on) return doPost();

    const pane = $('compose-countdown');
    const preview = h('div', { className: 'countdown-preview' });
    const body = h('div', { className: 'preview-body' });
    composer.renderNotePreview(body, text);
    preview.append(body);

    const acct = (state.accounts || []).find((a) => a.pubkey === state.activePubkey) || {};
    const av = h('span', { className: 'avatar compose-author-av' });
    applyAvatar(av, acct);
    const author = h('div', { className: 'compose-author' }, [
      av,
      h('div', { className: 'compose-author-info' }, [
        h('span', { className: 'compose-author-eyebrow', textContent: 'Posting as' }),
        h('span', { className: 'compose-author-name', textContent: acct.name || shortNpub(acct.npub) || '\u2014' }),
      ]),
    ]);

    const restore = () => {
      if (countdown) { countdown.stop(); countdown = null; }
      pane.innerHTML = '';
      pane.classList.add('hidden');
      setReviewing(false);
    };
    setReviewing(true);
    pane.classList.remove('hidden');
    countdown = composer.showPostCountdown({
      modal: pane, author, secs,
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
    $('compose-slot').classList.toggle('hidden', on);
    $('compose-tabs').classList.toggle('hidden', on);
    $('compose-actions').classList.toggle('hidden', on);
    $('compose-post').classList.toggle('hidden', on);
    $('compose-close').classList.toggle('hidden', on);
  }

  async function doPost() {
    if (posting) return;
    const text = (draft.text || '').trim();
    if (!text) return;
    posting = true;
    paintCount();
    const status = $('compose-status');
    try {
      let template = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['client', 'Sidecar']],
        content: text,
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
        toast('Sidecar is locked. Unlock it in the panel, then press Post again.', 'error');
      } else toast(e.message || 'Could not post', 'error');
    }
    setMining(false);
    posting = false;
    paintCount();
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
    const post = $('compose-post');
    post.textContent = on ? 'Stop mining' : 'Post';
    post.classList.toggle('secondary', on);
    post.classList.toggle('primary', !on);
    post.disabled = false;
    if (editorApi) {
      editorApi.editor.contentEditable = on ? 'false' : 'true';
      editorApi.editor.classList.toggle('is-locked', on);
      if (on) editorApi.close(); // no mention dropdown left open over a box nobody can type in
    }
    // Everything that would change what is being mined, or start a second mine on the one
    // worker. Cancel and the close box stay live: leaving is always allowed, and it takes
    // the worker with the page.
    document.querySelectorAll('#compose-actions button, .compose-tab').forEach((b) => {
      b.disabled = on;
    });
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
    draft.media.forEach((m, i) => {
      const cell = h('div', { className: 'compose-thumb' });
      const el = document.createElement(m.isVideo ? 'video' : 'img');
      // Many media hosts reject a chrome-extension:// referrer and answer 403, which
      // renders as a broken thumb rather than as an error anyone can act on.
      el.referrerPolicy = 'no-referrer';
      el.src = m.url;
      if (m.isVideo) el.muted = true;
      cell.append(el);
      const rm = h('button', { className: 'compose-thumb-x', title: 'Remove', type: 'button' });
      rm.append(icon('trash'));
      rm.addEventListener('click', () => {
        // The URL lives in the text, so removing the thumb has to remove the line too.
        const ed = editorApi.editor;
        const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
        let wn;
        while ((wn = walker.nextNode())) {
          if (wn.textContent.includes(m.url)) {
            wn.textContent = wn.textContent.replace('\n' + m.url, '').replace(m.url, '');
            break;
          }
        }
        draft.media.splice(i, 1);
        editorApi.sync();
        renderThumbs();
      });
      cell.append(rm);
      host.append(cell);
    });
  }

  // On its own line, with the break decided from the SERIALIZED text rather than the DOM:
  // a URL glued to a bech32 or a hashtag corrupts both when the note is parsed.
  function appendMediaUrl(url) {
    const ed = editorApi.editor;
    const existing = composer.serializeEditor(ed);
    const sep = existing && !/\n$/.test(existing) ? '\n' : '';
    ed.append(document.createTextNode(sep + url));
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
        draft.media.push({ url, isVideo: file.type.startsWith('video/') });
        appendMediaUrl(url);
        editorApi.sync();
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
    powBtn.addEventListener('click', () => {
      const order = [null, ...SC.POW_LEVELS.map((l) => l.bits)];
      const at = order.indexOf(powForThisPost.on ? powForThisPost.bits : null);
      const next = order[(at + 1) % order.length];
      powForThisPost = next == null ? { on: false, bits: powForThisPost.bits } : { on: true, bits: next };
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
      const body = (draft.text || '').trim();
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

    dkey = state.activePubkey;
    const saved = await loadDraft();
    if (saved && saved.text) draft.text = saved.text;
    if (saved && Array.isArray(saved.media)) draft.media = saved.media;
    // The relay set the panel worked out, left beside the draft when you pressed expand.
    if (saved && Array.isArray(saved.expandRelays)) handoverRelays = saved.expandRelays;

    editorApi = composer.createMentionEditor({
      placeholder: 'What’s on your mind?',
      onChange: (text) => { draft.text = text; paintCount(); scheduleSave(); },
    });
    editorApi.editor.classList.add('compose-editor-lg');
    $('compose-slot').append(editorApi.wrap);
    editorApi.setText(draft.text);
    buildToolbar();
    buildTabs();
    renderThumbs();
    paintCount();
    editorApi.focus();

    $('compose-post').addEventListener('click', () => {
      if (mining) return composer.powCancel();
      if (countdown) return; // the review window owns the screen while it runs
      reviewThenPost();
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
