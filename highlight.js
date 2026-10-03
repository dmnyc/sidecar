'use strict';

// ---- the highlight popup ----
//
// Opened by the "Highlight with Sidecar" context-menu item with nothing but an id in its
// address. The passage, the page it came from and where the active account writes are
// asked of the worker (SIDECAR_HIGHLIGHT_GET), so none of it sits in the window's URL.
//
// Signing goes through SIDECAR_OWNER_SIGN with expectedPubkey, the same door the
// expanded composer uses: if the account changes while this window is open, the
// signature is refused rather than made as somebody else. Publishing is this page's own
// SimplePool, to the write relays the worker worked out for that account.
(function () {
  const SC = window.SidecarCore;
  const { h, icon, logoSrcFor, avatarPhSrc, COMPOSE_DARK_BAR_THEMES } = SC;
  const I18N = window.SidecarI18n;
  const { t, tn } = I18N;
  const NT = window.NostrTools;
  const HL = window.SidecarHighlight;
  const $ = (id) => document.getElementById(id);

  const id = new URLSearchParams(location.search).get('id') || '';
  let state = null;
  let hl = null;
  let posting = false;
  // The Nostr note the page was showing, when its address carries one (see
  // nostrRefFromUrl), and the lookup that fills in its author when the reference lacks
  // one. Post waits for that lookup, which gives up after a few seconds.
  let nostrRef = null;
  let refReady = Promise.resolve();

  function bg(message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(t('Sidecar’s background worker did not respond.'))), 15000);
      try {
        chrome.runtime.sendMessage(message, (resp) => {
          clearTimeout(timer);
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message || t('Sidecar’s background worker is unavailable.')));
          resolve(resp);
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
  async function call(message) {
    const resp = await bg(message);
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || t('Request failed'));
    return resp.result;
  }

  const THEME_ALIASES = { 'art-deco': 'industria' };
  const VALID_THEMES = ['speakeasy', 'metropolis', 'film-noir', 'brownstone', 'nixie', 'cast-iron', 'wabi-sabi', 'constellation', 'jazz-age', 'departures',
    'industria', 'aegean', 'bauhaus', 'populuxe', 'par-avion', 'werkstatte', 'ukiyo-e', 'mycelium', 'ben-day', 'turnstile'];
  function applyTheme(settings, pubkey) {
    const by = (settings && settings.themeBy) || null;
    let name = (by && pubkey && by[pubkey]) || (settings && settings.theme) || 'speakeasy';
    name = THEME_ALIASES[name] || name;
    if (!VALID_THEMES.includes(name)) name = 'speakeasy';
    document.documentElement.setAttribute('data-theme', name);
    const logo = $('compose-logo');
    // Guarded: a build without the dark-bar list (the 1.15 line) still paints its logo.
    const darkBar = COMPOSE_DARK_BAR_THEMES && COMPOSE_DARK_BAR_THEMES.has(name);
    if (logo) logo.src = darkBar ? 'icons/sidecar-logo.svg' : logoSrcFor(name);
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
      img.src = avatarPhSrc();
      box.classList.add('avatar-ph');
    }
    box.append(img);
  }

  const shortNpub = (npub) =>
    (typeof npub === 'string' && npub.length > 20 ? npub.slice(0, 10) + '…' + npub.slice(-4) : npub || '');

  function paintWho() {
    const acct = (state.accounts || []).find((a) => a.pubkey === state.activePubkey) || {};
    $('hl-name').textContent = acct.name || shortNpub(acct.npub) || t('Your account');
    applyAvatar($('hl-av'), acct);
  }

  // One line under the card says what is wrong, and the button is lit only when Post
  // could actually work. A locked store is said here rather than discovered at Post.
  function paint() {
    const err = $('hl-err');
    let problem = '';
    if (!hl) problem = t('This highlight has expired. Select the text again.');
    else if (HL.tooLong(hl.text)) {
      problem = t('That selection is too long for a highlight. Select a shorter passage.');
    }
    err.textContent = problem;
    const status = $('hl-status');
    if (!posting) status.textContent = state && state.locked ? t('Sidecar is locked. Unlock it, then press Post again.') : '';
    $('hl-post').disabled = posting || !!problem || !state || !!state.locked;
  }

  async function refreshState() {
    if (posting) return;
    try { state = await call({ type: 'SIDECAR_GET_STATE' }); } catch (_) { return; }
    if (state && state.activePubkey) paintWho();
    paint();
  }

  function close() {
    // The passage is dropped from the worker when the window goes, posted or not.
    call({ type: 'SIDECAR_HIGHLIGHT_DROP', id }).catch(() => {});
    window.close();
  }

  async function post() {
    if (posting || !hl || !state) return;
    posting = true;
    paint();
    const status = $('hl-status');
    $('hl-err').textContent = '';
    try {
      let clientTag = true;
      try {
        const s = await call({ type: 'SIDECAR_GET_SETTINGS' });
        clientTag = !(s && s.showClientTag === false);
      } catch (_) { /* default on, matching the composer */ }
      await refReady; // the note's author and paragraph, if still being looked up
      // The paragraph goes out only if it was shown and not left out.
      const withContext = !$('hl-context').classList.contains('hidden') && !$('hl-context-off').checked;
      const template = HL.buildTemplate({
        text: hl.text, url: hl.url, context: withContext ? hl.context : '', comment: $('hl-comment').value, clientTag,
        nostrRef,
      });
      status.textContent = t('Signing…');
      const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event: template, expectedPubkey: state.activePubkey });
      status.textContent = t('Publishing…');
      const relays = hl.relays || [];
      if (!relays.length) throw new Error(t('No relays configured (add some in Settings)'));
      const ws = (window.SidecarWsGuard && window.SidecarWsGuard.impl()) || undefined;
      const pool = new NT.SimplePool({ websocketImplementation: ws });
      const results = await Promise.allSettled(pool.publish(relays, signed));
      try { pool.close(relays); } catch (_) {}
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      if (!ok) throw new Error(t('No relay accepted the highlight.'));
      call({ type: 'SIDECAR_HIGHLIGHT_DROP', id }).catch(() => {});
      await showPosted(signed, ok, relays);
    } catch (e) {
      status.textContent = '';
      if (/is locked/i.test((e && e.message) || '')) {
        if (state) state.locked = true;
        $('hl-err').textContent = t('Sidecar is locked. Unlock it, then press Post again.');
      } else {
        $('hl-err').textContent = builderError((e && e.message) || '') || (e && e.message) || t('Could not post');
      }
    }
    posting = false;
    if (!document.querySelector('.compose-done')) paint();
  }

  // The event builder's refusals, in English because it is a module with no language of
  // its own, said in the reader's.
  function builderError(message) {
    return ({
      'Nothing selected': t('Select some text on the page first.'),
      'Selection too long': t('That selection is too long for a highlight. Select a shorter passage.'),
      'Not a web page': t('Highlights can only be made on web pages.'),
    })[message] || '';
  }

  // The paragraph the passage sits in, with the passage marked, shown only when there is
  // one the event would carry. Built from text nodes and a <mark>, never from markup.
  function paintContext() {
    const box = $('hl-context');
    const passage = HL.tidy(hl.text);
    const ctx = HL.contextFor(passage, hl.context);
    box.classList.toggle('hidden', !ctx);
    if (!ctx) return;
    const at = ctx.indexOf(passage);
    const para = $('hl-context-text');
    para.replaceChildren(
      document.createTextNode(ctx.slice(0, at)),
      h('mark', { textContent: passage }),
      document.createTextNode(ctx.slice(at + passage.length))
    );
    const off = $('hl-context-off');
    const label = box.querySelector('.hl-context-label');
    const sync = () => {
      box.classList.toggle('is-off', off.checked);
      label.textContent = off.checked ? t('The paragraph around it won’t be posted') : t('Posted with the paragraph around it');
    };
    off.addEventListener('change', sync);
    sync();
  }

  // A short-lived read of one event or profile from the account's relays and the
  // reference's own hint, never longer than `ms`.
  async function readOne(filter, ms) {
    const relays = [...new Set([...(hl.relays || []), ...(nostrRef && nostrRef.relay ? [nostrRef.relay] : [])])];
    if (!relays.length) return null;
    const ws = (window.SidecarWsGuard && window.SidecarWsGuard.impl()) || undefined;
    const pool = new NT.SimplePool({ websocketImplementation: ws });
    try {
      return await Promise.race([pool.get(relays, filter), new Promise((r) => setTimeout(() => r(null), ms))]);
    } catch (_) {
      return null;
    } finally {
      try { pool.close(relays); } catch (_) {}
    }
  }

  // Who wrote the note, for the p tag and for the source line, and their name to show.
  // A note is always read: its own text is where the paragraph comes from (see
  // noteParagraph). Not found, the highlight goes out without one.
  async function resolveRef() {
    if (nostrRef.tag === 'e') {
      const ev = await readOne({ ids: [nostrRef.id] }, 4000);
      if (ev && ev.id === nostrRef.id) {
        if (!nostrRef.author) nostrRef.author = ev.pubkey;
        nostrRef.kind = ev.kind;
        hl.context = HL.noteParagraph(ev.content, hl.text);
        paintContext();
      }
    }
    paintRefSource(null);
    if (!nostrRef.author) return;
    const profile = await readOne({ kinds: [0], authors: [nostrRef.author] }, 4000);
    let name = '';
    try {
      const meta = profile ? JSON.parse(profile.content || '{}') : {};
      name = String(meta.display_name || meta.name || '').trim();
    } catch (_) {}
    paintRefSource(name);
  }

  // The source line for a Nostr note: what it is and who wrote it, so it is plain before
  // posting that this highlight links to the note rather than to the page.
  function paintRefSource(name) {
    let who = name;
    if (!who && nostrRef.author) {
      try { who = shortNpub(NT.nip19.npubEncode(nostrRef.author)); } catch (_) {}
    }
    const article = nostrRef.kind === 30023;
    $('hl-source-title').textContent = who
      ? (article ? t('Nostr article by {{name}}', { name: who }) : t('Nostr note by {{name}}', { name: who }))
      : (article ? t('A Nostr article') : t('A Nostr note'));
  }

  async function showPosted(signed, relayCount, relays) {
    let href = null;
    let label = null;
    try {
      const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
      const client = SC.installComposer({ noteActivity: () => {} }).resolveClient(settings, signed.pubkey);
      href = client.url(NT.nip19.neventEncode({ id: signed.id, author: signed.pubkey, kind: signed.kind, relays: relays.slice(0, 2) }));
      label = client.label;
    } catch (_) { /* no link is better than a broken one */ }

    const sheet = document.querySelector('.compose-sheet');
    sheet.innerHTML = '';
    sheet.classList.add('compose-done');
    const mark = h('span', { className: 'compose-done-mark' });
    mark.append(icon('check'));
    sheet.append(
      mark,
      h('h2', { className: 'compose-done-title', textContent: t('Your highlight is live.') }),
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
    sheet.append(row);
    const done = h('button', { className: 'compose-cancel', type: 'button', textContent: t('Close') });
    done.addEventListener('click', () => window.close());
    sheet.append(done);
  }

  async function boot() {
    try { await I18N.ready; } catch (_) {}
    I18N.applyDom();
    $('hl-x').append(icon('x'));
    $('hl-x').addEventListener('click', close);
    $('hl-cancel').addEventListener('click', close);
    $('hl-post').addEventListener('click', post);
    window.addEventListener('focus', refreshState);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshState(); });

    try {
      state = await call({ type: 'SIDECAR_GET_STATE' });
      const settings = await call({ type: 'SIDECAR_GET_SETTINGS' }).catch(() => ({}));
      if (state && state.activePubkey) {
        applyTheme(settings, state.activePubkey);
        paintWho();
      } else {
        state = null;
        $('hl-name').textContent = t('No account yet');
      }
      try { hl = await call({ type: 'SIDECAR_HIGHLIGHT_GET', id }); } catch (_) { hl = null; }
      if (hl) {
        $('hl-quote').textContent = HL.tidy(hl.text);
        $('hl-source-title').textContent = hl.title || '';
        try { $('hl-source-host').textContent = new URL(hl.url).host; } catch (_) {}
        nostrRef = HL.nostrRefFromUrl(hl.url, NT.nip19.decode);
        // The page's paragraph for a note is the client's drawing of it, cards and all.
        if (nostrRef && nostrRef.tag === 'e') hl.context = '';
        paintContext();
        if (nostrRef) {
          paintRefSource(null); // at once, and again when the author's name arrives
          refReady = resolveRef().catch(() => {});
        }
      } else {
        $('hl-quote').classList.add('hidden');
      }
    } finally {
      document.documentElement.classList.remove('compose-booting');
    }
    paint();
    $('hl-comment').focus();
  }

  boot();
})();
