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
    if (logo) logo.src = COMPOSE_DARK_BAR_THEMES.has(name) ? 'icons/sidecar-logo.svg' : logoSrcFor(name);
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
      const template = HL.buildTemplate({
        text: hl.text, url: hl.url, context: hl.context, comment: $('hl-comment').value, clientTag,
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
        $('hl-err').textContent = (e && e.message) || t('Could not post');
      }
    }
    posting = false;
    if (!document.querySelector('.compose-done')) paint();
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
