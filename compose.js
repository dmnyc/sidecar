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

  const composer = SC.installComposer({
    NT,
    applyAvatar,
    cachedProfile,
    fetchPreviewProfile,
    getFollowList,
    cachedFollowList: () => followCache,
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
    const hasContent = !!(draft.text && draft.text.trim());
    if (hasContent) all[dkey] = { ...(all[dkey] || {}), text: draft.text, savedAt: Date.now() };
    else delete all[dkey];
    await call({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: all });
  }
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { persistDraft().catch(() => {}); }, 400);
  }

  function paintCount() {
    const n = (draft.text || '').trim().length;
    $('compose-count').textContent = n ? n + (n === 1 ? ' character' : ' characters') : '';
    $('compose-post').disabled = posting || !n;
  }

  async function doPost() {
    if (posting) return;
    const text = (draft.text || '').trim();
    if (!text) return;
    posting = true;
    paintCount();
    const status = $('compose-status');
    status.textContent = 'Signing…';
    try {
      const template = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['client', 'Sidecar']],
        content: text,
      };
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
      draft.text = '';
      await persistDraft();
      editorSetText('');
      status.textContent = '';
      toast('Note published to ' + ok + (ok === 1 ? ' relay' : ' relays'), 'success');
    } catch (e) {
      status.textContent = '';
      toast(e.message || 'Could not post', 'error');
    }
    posting = false;
    paintCount();
  }

  let editorApi = null;
  function editorSetText(t) { if (editorApi) editorApi.setText(t); }

  async function boot() {
    state = await call({ type: 'SIDECAR_GET_STATE' });
    if (!state || !state.activePubkey) {
      document.body.innerHTML = '';
      document.body.append(h('p', { className: 'hint compose-empty', textContent: 'Open Sidecar and unlock it, then expand the composer again.' }));
      return;
    }
    const settings = await call({ type: 'SIDECAR_GET_SETTINGS' }).catch(() => ({}));
    applyTheme(settings, state.activePubkey);

    const acct = (state.accounts || []).find((a) => a.pubkey === state.activePubkey) || {};
    $('compose-name').textContent = acct.name || shortNpub(acct.npub) || 'Your account';
    applyAvatar($('compose-av'), acct);

    dkey = state.activePubkey;
    const saved = await loadDraft();
    if (saved && saved.text) draft.text = saved.text;
    // The relay set the panel worked out, left beside the draft when you pressed expand.
    if (saved && Array.isArray(saved.expandRelays)) handoverRelays = saved.expandRelays;

    editorApi = composer.createMentionEditor({
      placeholder: 'What’s on your mind?',
      onChange: (text) => { draft.text = text; paintCount(); scheduleSave(); },
    });
    editorApi.editor.classList.add('compose-editor-lg');
    $('compose-slot').append(editorApi.wrap);
    editorApi.setText(draft.text);
    paintCount();
    editorApi.focus();

    $('compose-post').addEventListener('click', doPost);
    $('compose-close').addEventListener('click', () => {
      persistDraft().catch(() => {}).then(() => window.close());
    });
    // A tab can be closed without pressing anything. The 400ms debounce is short, but a
    // close inside it would lose the last sentence, which is the one you just wrote.
    window.addEventListener('beforeunload', () => {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      persistDraft().catch(() => {});
    });
  }

  boot().catch((e) => {
    document.body.innerHTML = '';
    document.body.append(h('p', { className: 'hint compose-empty', textContent: e.message || 'Sidecar could not open the composer.' }));
  });
})();
