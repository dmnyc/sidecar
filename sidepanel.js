// Sidecar side panel — account manager / lock UI for the NIP-07 signer.
// All key material lives in the service worker; this panel only sends control messages.

(function () {
  'use strict';

  const NT = window.NostrTools;

  // ---- messaging ----
  function bg(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }
  async function call(message) {
    const resp = await bg(message);
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Request failed');
    return resp.result;
  }

  const $ = (id) => document.getElementById(id);
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');

  // ---- flat (line) icons — inherit currentColor ----
  const ICONS = {
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
    trash: '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>',
    key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>',
    feather: '<path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"></path><line x1="16" y1="8" x2="2" y2="22"></line><line x1="17.5" y1="15" x2="9" y2="15"></line>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
    unlock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path>',
    wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line>',
    more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"></circle><circle cx="12" cy="12" r="1.6" fill="currentColor"></circle><circle cx="19" cy="12" r="1.6" fill="currentColor"></circle>',
    'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
    check: '<polyline points="20 6 9 17 4 12"></polyline>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    grip: '<circle cx="9" cy="7" r="1.5" fill="currentColor"></circle><circle cx="15" cy="7" r="1.5" fill="currentColor"></circle><circle cx="9" cy="12" r="1.5" fill="currentColor"></circle><circle cx="15" cy="12" r="1.5" fill="currentColor"></circle><circle cx="9" cy="17" r="1.5" fill="currentColor"></circle><circle cx="15" cy="17" r="1.5" fill="currentColor"></circle>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>',
    x: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
  };
  function icon(name) {
    const wrap = document.createElement('span');
    wrap.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[name] || '') +
      '</svg>';
    return wrap.firstElementChild;
  }

  // ---- toast notifications ----
  function toast(message, type) {
    const t = document.createElement('div');
    t.className = 'toast toast-' + (type === 'error' ? 'error' : 'success');
    t.appendChild(icon(type === 'error' ? 'alert' : 'check'));
    const span = document.createElement('span');
    span.textContent = message;
    t.appendChild(span);
    const host = document.getElementById('toasts');
    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 250);
    }, 3200);
  }

  let state = null;

  // ---- top-level routing ----
  async function refresh() {
    state = await call({ type: 'SIDECAR_GET_STATE' });
    closeAcctMenu();
    [$('view-onboarding'), $('view-lock'), $('view-main'), $('view-settings'), $('view-profile-edit')].forEach(hide);
    if (!state.initialized) {
      show($('view-onboarding'));
      setTimeout(() => $('ob-pin').focus(), 50);
    } else if (state.locked) {
      show($('view-lock'));
      setTimeout(() => $('unlock-pin').focus(), 50);
    } else {
      show($('view-main'));
      const banner = $('post-banner');
      if (banner) hide(banner); // a note link is account-specific; clear on any state change
      renderMain();
      // Re-render the visible tab so account-scoped views (Activity/Profile) follow the switch.
      const activeTab = document.querySelector('.tab.active');
      const name = activeTab && activeTab.dataset.tab;
      if (name === 'activity') renderActivity();
      else if (name === 'profile') renderProfile();
    }
  }

  // ---- onboarding ----
  $('onboarding-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('ob-error');
    err.textContent = '';
    const pin = $('ob-pin').value;
    const pin2 = $('ob-pin2').value;
    if (pin.length < 4) return (err.textContent = 'Use at least 4 characters.');
    if (pin.length > 32) return (err.textContent = 'Use at most 32 characters.');
    if (pin !== pin2) return (err.textContent = 'PINs do not match.');
    try {
      await call({ type: 'SIDECAR_INIT', pin });
      await refresh();
      toast('Keystore created', 'success');
      promptAddFirstAccount();
    } catch (e) {
      err.textContent = e.message;
      toast(e.message, 'error');
    }
  });

  // ---- unlock ----
  $('unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('unlock-error');
    err.textContent = '';
    try {
      await call({ type: 'SIDECAR_UNLOCK', pin: $('unlock-pin').value });
      $('unlock-pin').value = '';
      await refresh();
      toast('Unlocked', 'success');
    } catch (e) {
      err.textContent = e.message;
      $('unlock-pin').value = '';
      toast(e.message, 'error');
    }
  });

  // ---- lock ----
  $('lock-btn').addEventListener('click', async () => {
    await call({ type: 'SIDECAR_LOCK' });
    await refresh();
    toast('Locked', 'success');
  });

  $('compose-fab').addEventListener('click', () => openComposer());

  // Dim the FAB while the content is actively scrolling so it doesn't distract;
  // snap back ~160ms after scrolling stops (mirrors zap.cooking's create FAB).
  (function fabScrollDim() {
    const fab = $('compose-fab');
    const scroller = document.querySelector('#view-main .content');
    if (!fab || !scroller) return;
    let t = null;
    scroller.addEventListener(
      'scroll',
      () => {
        fab.classList.add('is-scrolling');
        if (t) clearTimeout(t);
        t = setTimeout(() => fab.classList.remove('is-scrolling'), 160);
      },
      { passive: true }
    );
  })();

  // ---- settings (gear icon ↔ overlay view) ----
  $('settings-btn').addEventListener('click', () => {
    hide($('view-main'));
    show($('view-settings'));
    renderSettings();
  });
  $('settings-close').addEventListener('click', () => {
    hide($('view-settings'));
    show($('view-main'));
  });

  // ---- header account switcher (dropdown) ----
  function buildAcctMenu() {
    const menu = $('acct-menu');
    menu.innerHTML = '';
    let pendingRow = null;

    function resetRow(row, a) {
      row.classList.remove('acct-row-pending');
      row.querySelector('.acct-row-name').textContent = displayName(a);
      row.querySelector('.acct-row-npub').textContent = shortNpub(a.npub);
    }

    state.accounts.forEach((a) => {
      const isActive = a.pubkey === state.activePubkey;
      const row = h('button', { className: 'acct-row' + (isActive ? ' active' : '') });
      const av = document.createElement('span');
      av.className = 'acct-row-av';
      applyAvatar(av, a);
      const info = h('div', { className: 'acct-row-info' }, [
        h('div', { className: 'acct-row-name', textContent: displayName(a) }),
        h('div', { className: 'acct-row-npub', textContent: shortNpub(a.npub) }),
      ]);
      row.append(av, info);
      if (isActive) {
        const c = icon('check');
        c.classList.add('acct-row-check');
        row.append(c);
      }
      if (!isActive) {
        row.addEventListener('click', async () => {
          if (pendingRow && pendingRow !== row) resetRow(pendingRow, state.accounts.find(x => x.pubkey === pendingRow.dataset.pubkey));
          if (row.classList.contains('acct-row-pending')) {
            closeAcctMenu();
            await call({ type: 'SIDECAR_SET_ACTIVE', pubkey: a.pubkey });
            await refresh();
            toast('Switched to ' + displayName(a), 'success');
          } else {
            row.classList.add('acct-row-pending');
            row.querySelector('.acct-row-name').textContent = 'Switch to ' + displayName(a) + '?';
            row.querySelector('.acct-row-npub').textContent = 'Tap again to confirm';
            pendingRow = row;
            row.dataset.pubkey = a.pubkey;
          }
        });
      }
      menu.append(row);
    });
    const foot = h('button', { className: 'acct-row foot' }, [
      h('span', { className: 'acct-row-name', textContent: 'Manage accounts' }),
    ]);
    foot.addEventListener('click', () => {
      closeAcctMenu();
      document.querySelector('.tab[data-tab="accounts"]').click();
    });
    menu.append(foot);
  }
  function openAcctMenu() {
    buildAcctMenu();
    show($('acct-menu'));
  }
  function closeAcctMenu() {
    hide($('acct-menu'));
  }
  $('acct-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if ($('acct-menu').classList.contains('hidden')) openAcctMenu();
    else closeAcctMenu();
  });
  document.addEventListener('click', (e) => {
    const menu = $('acct-menu');
    if (!menu.classList.contains('hidden') && !menu.contains(e.target) && !$('acct-btn').contains(e.target)) {
      closeAcctMenu();
    }
  });

  // ---- tabs ----
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      document.querySelectorAll('.tabview').forEach((v) => hide(v));
      show($('tab-' + name));
      if (name === 'activity') renderActivity();
      else if (name === 'profile') renderProfile();
    });
  });

  // ---- main / accounts ----
  function shortNpub(npub) {
    return npub && npub.length > 20 ? npub.slice(0, 14) + '…' + npub.slice(-6) : npub || '';
  }

  // Name shown for an account: its kind:0 name, else a shortened npub.
  function displayName(a) {
    return a.name && a.name.trim() ? a.name.trim() : shortNpub(a.npub);
  }

  // Fill an element with an account avatar: its kind:0 picture, or the default garnish.
  function applyAvatar(box, a) {
    box.innerHTML = '';
    box.classList.remove('avatar-ph');
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    if (a && a.picture) {
      img.src = a.picture;
      img.onerror = () => {
        img.src = 'icons/avatar-default.svg';
        img.onerror = null;
        box.classList.add('avatar-ph');
      };
    } else {
      img.src = 'icons/avatar-default.svg';
      box.classList.add('avatar-ph');
    }
    box.appendChild(img);
  }
  // A circular avatar element: the account's kind:0 picture, or the default garnish.
  function avatarEl(a, cls) {
    const box = document.createElement('div');
    box.className = cls;
    applyAvatar(box, a);
    return box;
  }

  // ---- relay pool (fetch + publish) ----
  let _pool = null;
  function getPool() {
    if (!_pool) _pool = new NT.SimplePool();
    return _pool;
  }
  const poolGet = (relays, filter) => getPool().get(relays, filter);

  async function relayUrls(writableOnly) {
    const map = await call({ type: 'SIDECAR_GET_RELAYS' });
    return Object.keys(map).filter((u) => (writableOnly ? map[u].write !== false : true));
  }

  // ---- NIP-65 (kind 10002) relay list, cached per account ----
  const nip65Cache = new Map(); // pubkey -> { read:[], write:[] } | null

  async function getNip65(pubkey) {
    if (!pubkey) return null;
    if (nip65Cache.has(pubkey)) return nip65Cache.get(pubkey);
    let parsed = null;
    try {
      const ev = await Promise.race([
        poolGet(await relayUrls(false), { kinds: [10002], authors: [pubkey] }),
        new Promise((res) => setTimeout(() => res(null), 6000)),
      ]);
      if (ev) {
        const read = [], write = [];
        ev.tags.forEach((t) => {
          if (t[0] !== 'r' || !t[1]) return;
          const marker = t[2];
          if (!marker) { read.push(t[1]); write.push(t[1]); }
          else if (marker === 'read') read.push(t[1]);
          else if (marker === 'write') write.push(t[1]);
        });
        if (read.length || write.length) parsed = { read, write };
      }
    } catch (_) {}
    nip65Cache.set(pubkey, parsed);
    return parsed;
  }

  // Where to publish the active account's events: its NIP-65 write relays if it
  // has them, else the relays configured in Settings.
  async function postRelays() {
    const n = await getNip65(state.activePubkey);
    if (n && n.write.length) return n.write;
    return relayUrls(true);
  }

  // Publish an already-signed event to the account's write relays (NIP-65 → configured).
  async function publishSigned(signed) {
    const relays = await postRelays();
    if (!relays.length) throw new Error('No relays configured (add some in Settings)');
    const results = await Promise.allSettled(getPool().publish(relays, signed));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    if (!ok) throw new Error('Could not publish to any relay');
    return ok;
  }

  const profileFetchAttempted = new Set();

  async function fetchAndStoreProfile(pubkey) {
    try {
      const relayMap = await call({ type: 'SIDECAR_GET_RELAYS' });
      const relays = Object.keys(relayMap || {});
      if (!relays.length) return;
      const ev = await Promise.race([
        poolGet(relays, { kinds: [0], authors: [pubkey] }),
        new Promise((res) => setTimeout(() => res(null), 6000)),
      ]);
      if (!ev) return;
      let meta = {};
      try { meta = JSON.parse(ev.content) || {}; } catch (_) { return; }
      const name = meta.display_name || meta.displayName || meta.name || '';
      const picture = meta.picture || '';
      if (!name && !picture) return;
      await call({ type: 'SIDECAR_SET_PROFILE', pubkey, name, picture });
      state = await call({ type: 'SIDECAR_GET_STATE' });
      if (!state.locked) renderMain();
    } catch (_) {
      /* offline / no profile — keep placeholder */
    }
  }

  function maybeFetchProfile(pubkey) {
    if (profileFetchAttempted.has(pubkey)) return;
    profileFetchAttempted.add(pubkey);
    fetchAndStoreProfile(pubkey);
  }

  function renderMain() {
    const active = state.accounts.find((a) => a.pubkey === state.activePubkey);

    // persistent header chip (current account)
    applyAvatar($('chip-av'), active || {});
    $('chip-name').textContent = active ? displayName(active) : 'No account';

    const head = $('active-account');
    head.innerHTML = '';
    if (active) {
      head.appendChild(avatarEl(active, 'aa-avatar'));
      const info = document.createElement('div');
      info.className = 'aa-info';
      const label = document.createElement('div');
      label.className = 'aa-label';
      label.textContent = displayName(active);
      const npub = document.createElement('div');
      npub.className = 'aa-npub';
      npub.textContent = shortNpub(active.npub);
      info.append(label, npub);
      head.appendChild(info);
    } else {
      head.textContent = 'No active account — add one below.';
    }

    const list = $('account-list');
    list.innerHTML = '';
    state.accounts.forEach((a) => list.appendChild(accountRow(a)));
    makeSortable(list);

    // Lazily pull name + picture from kind:0 for accounts that still lack a
    // real (kind:0-sourced) profile — placeholder cocktail names don't count.
    state.accounts.forEach((a) => {
      if (a.placeholderName || (!a.name && !a.picture)) maybeFetchProfile(a.pubkey);
    });
  }

  function makeSortable(listEl) {
    let dragged = null;
    listEl.addEventListener('dragstart', (e) => {
      dragged = e.target.closest('.item[draggable]');
      if (!dragged) return;
      dragged.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    listEl.addEventListener('dragend', () => {
      if (dragged) dragged.classList.remove('dragging');
      listEl.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach((el) => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      dragged = null;
    });
    listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragged) return;
      const target = e.target.closest('.item[draggable]');
      listEl.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach((el) => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      if (!target || target === dragged) return;
      const mid = target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
      target.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
    });
    listEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!dragged) return;
      const target = e.target.closest('.item[draggable]');
      if (target && target !== dragged) {
        const mid = target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
        listEl.insertBefore(dragged, e.clientY < mid ? target : target.nextSibling);
      }
      listEl.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach((el) => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      const pubkeys = [...listEl.querySelectorAll('.item[data-pubkey]')].map((el) => el.dataset.pubkey);
      await call({ type: 'SIDECAR_REORDER_ACCOUNTS', pubkeys });
    });
  }

  function accountRow(a) {
    const row = document.createElement('div');
    row.className = 'item' + (a.pubkey === state.activePubkey ? ' item-active' : '');
    row.draggable = true;
    row.dataset.pubkey = a.pubkey;

    const grip = document.createElement('span');
    grip.className = 'grip-handle';
    grip.appendChild(icon('grip'));
    row.appendChild(grip);

    row.appendChild(avatarEl(a, 'avatar'));

    const main = document.createElement('div');
    main.className = 'item-main';
    const label = document.createElement('div');
    label.className = 'item-label';
    label.textContent = displayName(a);
    const sub = document.createElement('div');
    sub.className = 'item-sub';
    sub.textContent = shortNpub(a.npub);
    main.append(label, sub);

    const isActive = a.pubkey === state.activePubkey;
    if (!isActive) {
      main.style.cursor = 'pointer';
      main.title = 'Set as active account';
      function resetRow() {
        row.classList.remove('item-pending');
        label.textContent = displayName(a);
        sub.textContent = shortNpub(a.npub);
      }
      main.addEventListener('click', async () => {
        const list = row.parentElement;
        list.querySelectorAll('.item-pending').forEach((el) => {
          if (el !== row && el._resetRow) el._resetRow();
        });
        if (row.classList.contains('item-pending')) {
          await call({ type: 'SIDECAR_SET_ACTIVE', pubkey: a.pubkey });
          await refresh();
          toast('Switched to ' + displayName(a), 'success');
        } else {
          row.classList.add('item-pending');
          label.textContent = 'Set as active?';
          sub.textContent = 'Tap again to confirm';
        }
      });
      row._resetRow = resetRow;
    }

    const actions = document.createElement('div');
    actions.className = 'item-actions';
    if (isActive) {
      const check = icon('check');
      check.classList.add('active-check');
      actions.appendChild(check);
    }
    actions.appendChild(iconButton('Account options', 'more', () => accountMenuModal(a)));

    row.append(main, actions);
    return row;
  }

  function iconButton(title, name, onClick) {
    const b = document.createElement('button');
    b.className = 'icon-btn sm';
    b.title = title;
    b.appendChild(icon(name));
    b.addEventListener('click', onClick);
    return b;
  }

  function labelButton(id, name, text) {
    const b = $(id);
    b.textContent = '';
    b.append(icon(name), h('span', { textContent: text }));
  }
  labelButton('add-generate', 'user-plus', 'Generate new');
  labelButton('add-import', 'download', 'Import nsec');
  $('add-generate').addEventListener('click', () => addAccountModal(true));
  $('add-import').addEventListener('click', () => addAccountModal(false));

  function promptAddFirstAccount() {
    addAccountModal(null, true);
  }

  // ---- modals ----
  let modalCleanup = null;
  function openModal(buildContent, onClose) {
    const modal = $('modal');
    modal.innerHTML = '';
    modalCleanup = onClose || null;
    buildContent(modal);
    show($('modal-overlay'));
    document.documentElement.classList.add('modal-open');
  }
  function closeModal() {
    if (modalCleanup) { try { modalCleanup(); } catch (_) {} modalCleanup = null; }
    hide($('modal-overlay'));
    $('modal').innerHTML = '';
    document.documentElement.classList.remove('modal-open');
  }
  $('modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('modal-overlay')) closeModal();
  });

  function h(tag, props, children) {
    const el = document.createElement(tag);
    if (props) Object.assign(el, props);
    (children || []).forEach((c) => el.append(c));
    return el;
  }

  function addAccountModal(generate, isFirst) {
    openModal((modal) => {
      const title = h('h3', { textContent: isFirst ? 'Add your first account' : 'Add account' });
      const err = h('div', { className: 'error' });
      modal.append(title);

      let chooseGenerate = generate;

      const secretWrap = h('div', { className: generate === false ? '' : 'hidden' });
      const secretInput = h('input', { type: 'password', placeholder: 'nsec1… or 64-char hex' });
      secretWrap.append(h('label', { textContent: 'Private key' }), secretInput);
      // Detailed security rationale only on the dedicated import path; the
      // first-account screen carries a shorter combined note instead.
      if (generate === false) {
        secretWrap.append(
          h('p', {
            className: 'hint',
            textContent:
              'Safer than pasting your nsec into a website: Sidecar keeps it encrypted on this device and signs locally, so sites only ever receive signatures — never your key. A web app you paste into can copy or leak it.',
          })
        );
      }

      if (generate === null) {
        // First-account flow: let them pick generate vs import.
        const choice = h('div', { className: 'row-actions' });
        const genBtn = h('button', { className: 'secondary', textContent: 'Generate new' });
        const impBtn = h('button', { className: 'secondary', textContent: 'Import nsec' });
        genBtn.addEventListener('click', () => {
          chooseGenerate = true;
          secretWrap.classList.add('hidden');
          genBtn.classList.add('chosen');
          impBtn.classList.remove('chosen');
        });
        impBtn.addEventListener('click', () => {
          chooseGenerate = false;
          secretWrap.classList.remove('hidden');
          impBtn.classList.add('chosen');
          genBtn.classList.remove('chosen');
        });
        choice.append(genBtn, impBtn);
        modal.append(choice);
        modal.append(
          h('p', {
            className: 'hint compact',
            textContent:
              'Your name and picture come from your Nostr profile. A new account gets a placeholder name you can change.',
          }),
          h('p', {
            className: 'hint compact',
            textContent:
              'Importing here is safer than pasting your nsec into a website. Sidecar signs locally and never reveals your key to the sites you log into.',
          })
        );
      }

      modal.append(secretWrap);
      modal.append(err);

      const save = h('button', { className: 'primary', textContent: 'Add account' });
      save.addEventListener('click', async () => {
        err.textContent = '';
        try {
          if (chooseGenerate === null) throw new Error('Choose “Generate new” or “Import nsec”.');
          let gen = null;
          if (chooseGenerate) {
            gen = await call({ type: 'SIDECAR_ADD_ACCOUNT', generate: true });
          } else {
            const secret = secretInput.value.trim();
            if (!secret) throw new Error('Enter an nsec or hex private key.');
            await call({ type: 'SIDECAR_ADD_ACCOUNT', secret });
          }
          closeModal();
          await refresh(); // renderMain() then pulls the profile for the new account
          toast('Account added', 'success');
          if (gen && gen.nsec) {
            nsecModal({
              nsec: gen.nsec,
              title: 'Back up your new key',
              intro:
                'Sidecar generated a new account. This nsec is the only way to recover it — save it now. You can view it again later behind your PIN.',
            });
          }
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(h('div', { className: 'actions' }, [save, cancel]));
    });
  }

  function accountMenuModal(a) {
    openModal((modal) => {
      const menuItem = (label, name, onClick, danger) => {
        const b = h('button', { className: 'menu-item' + (danger ? ' danger' : '') });
        b.appendChild(icon(name));
        b.appendChild(h('span', { textContent: label }));
        b.addEventListener('click', onClick);
        return b;
      };
      const list = h('div', { className: 'menu-list' }, [
        menuItem('Copy npub', 'copy', () => {
          navigator.clipboard.writeText(a.npub);
          toast('npub copied', 'success');
          closeModal();
        }),
        menuItem('Back up private key', 'key', () => revealNsecModal(a)),
        menuItem('Rename', 'edit', () => renameModal(a)),
        menuItem('Remove account', 'trash', () => removeModal(a), true),
      ]);
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: displayName(a) }),
        list,
        h('div', { className: 'actions' }, [cancel])
      );
    });
  }

  // Show an nsec with copy + warning (used after generate, and from reveal).
  function nsecModal(opts) {
    openModal((modal) => {
      const box = h('div', { className: 'secret-box', textContent: opts.nsec });
      const copy = h('button', { className: 'secondary', textContent: 'Copy nsec' });
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(opts.nsec);
          toast('nsec copied', 'success');
        } catch (_) {}
      });
      const done = h('button', { className: 'primary', textContent: "I've saved it" });
      done.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: opts.title }),
        opts.intro ? h('p', { className: 'hint', textContent: opts.intro }) : document.createTextNode(''),
        box,
        copy,
        h('p', { className: 'hint warn', textContent: 'Anyone with this key fully controls the account. Store it somewhere safe and never share it.' }),
        h('div', { className: 'actions' }, [done])
      );
    });
  }

  // Reveal an existing account's nsec — PIN-gated step-up.
  function revealNsecModal(a) {
    openModal((modal) => {
      const pin = h('input', { type: 'password', maxLength: 32 });
      const err = h('div', { className: 'error' });
      const go = h('button', { className: 'primary', textContent: 'Reveal' });
      go.addEventListener('click', async () => {
        err.textContent = '';
        if (!pin.value) return (err.textContent = 'Enter your PIN.');
        go.disabled = true;
        go.textContent = 'Revealing…';
        try {
          const r = await call({ type: 'SIDECAR_REVEAL_NSEC', pubkey: a.pubkey, pin: pin.value });
          nsecModal({ nsec: r.nsec, title: 'Private key', intro: 'Back this up somewhere safe.' });
        } catch (e) {
          err.textContent = e.message;
          go.disabled = false;
          go.textContent = 'Reveal';
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Back up private key' }),
        h('p', { className: 'hint', textContent: 'Enter your PIN to reveal the nsec for ' + displayName(a) + '.' }),
        h('label', { textContent: 'PIN' }),
        pin,
        err,
        h('div', { className: 'actions' }, [go, cancel])
      );
    });
  }

  function renameModal(a) {
    openModal((modal) => {
      const input = h('input', { type: 'text', value: a.name || '', placeholder: 'Display name' });
      const err = h('div', { className: 'error' });
      const save = h('button', { className: 'primary', textContent: 'Save' });
      save.addEventListener('click', async () => {
        try {
          await call({ type: 'SIDECAR_RENAME_ACCOUNT', pubkey: a.pubkey, name: input.value.trim() });
          closeModal();
          await refresh();
        } catch (e) {
          err.textContent = e.message;
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Rename account' }),
        h('label', { textContent: 'Name' }),
        input,
        h('p', { className: 'hint', textContent: 'Overrides the name from your Nostr profile on this device.' }),
        err,
        h('div', { className: 'actions' }, [save, cancel])
      );
    });
  }

  function removeModal(a) {
    openModal((modal) => {
      const err = h('div', { className: 'error' });
      const warn = h('p', {
        className: 'hint',
        textContent:
          'Removing ' +
          displayName(a) +
          ' deletes its encrypted key from this device. Make sure you have a backup of the nsec — this cannot be undone.',
      });
      const del = h('button', { className: 'danger', textContent: 'Remove account' });
      del.addEventListener('click', async () => {
        try {
          await call({ type: 'SIDECAR_REMOVE_ACCOUNT', pubkey: a.pubkey });
          closeModal();
          await refresh();
          toast('Account removed', 'success');
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(h('h3', { textContent: 'Remove account?' }), warn, err, h('div', { className: 'actions' }, [del, cancel]));
    });
  }

  // ---- settings ----
  async function renderSettings() {
    // auto-lock
    const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
    $('autolock-select').value = String(settings.autoLockMinutes || 0);
    $('client-select').value = settings.defaultClient || DEFAULT_CLIENT;

    // relays
    const relays = await call({ type: 'SIDECAR_GET_RELAYS' });
    const rlist = $('relay-list');
    rlist.innerHTML = '';
    Object.keys(relays).forEach((url) => {
      const row = h('div', { className: 'item' });
      row.append(h('div', { className: 'item-main' }, [h('div', { className: 'item-sub', textContent: url })]));
      const rm = iconButton('Remove', 'trash', async () => {
        const next = { ...relays };
        delete next[url];
        await call({ type: 'SIDECAR_SET_RELAYS', relays: next });
        renderSettings();
      });
      row.append(h('div', { className: 'item-actions' }, [rm]));
      rlist.append(row);
    });
  }

  // ---- activity tab: connected sites (permission tiers) + signing history ----
  const LEVELS = [
    ['ask', 'Ask every time'],
    ['readonly', 'Read only'],
    ['trusted', 'Trusted'],
    ['blocked', 'Blocked'],
  ];
  const KIND_NAMES = {
    0: 'profile', 1: 'note', 3: 'contacts', 4: 'direct message', 5: 'deletion',
    6: 'repost', 7: 'reaction', 1059: 'gift wrap', 9734: 'zap request',
    10002: 'relay list', 22242: 'relay auth', 24133: 'connect', 27235: 'HTTP auth', 30023: 'article',
  };
  const METHOD_META = {
    getPublicKey: { icon: 'key', label: () => 'Shared public key' },
    signEvent: { icon: 'feather', label: (e) => 'Signed ' + (KIND_NAMES[e.kind] || ('kind ' + e.kind)) },
    getRelays: { icon: 'wifi', label: () => 'Read relay list' },
    'nip04.encrypt': { icon: 'lock', label: () => 'Encrypted a message' },
    'nip04.decrypt': { icon: 'unlock', label: () => 'Decrypted a message' },
    'nip44.encrypt': { icon: 'lock', label: () => 'Encrypted a message' },
    'nip44.decrypt': { icon: 'unlock', label: () => 'Decrypted a message' },
  };

  function relTime(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 604800) return Math.round(s / 86400) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  function siteRow(host, level) {
    const row = h('div', { className: 'item site-item' });
    const main = h('div', { className: 'item-main' }, [h('div', { className: 'item-label', textContent: host })]);
    const sel = document.createElement('select');
    sel.className = 'level-select';
    LEVELS.forEach(([v, l]) => {
      const o = h('option', { value: v, textContent: l });
      if (v === level) o.selected = true;
      sel.append(o);
    });
    sel.addEventListener('change', () => call({ type: 'SIDECAR_SET_LEVEL', host, level: sel.value }));
    const rm = iconButton('Forget site', 'trash', async () => {
      await call({ type: 'SIDECAR_REMOVE_HOST', host });
      renderActivity();
    });
    row.append(main, sel, rm);
    return row;
  }

  function activityRow(e) {
    const meta = METHOD_META[e.method] || { icon: 'feather', label: () => e.method };
    const row = h('div', { className: 'item activity-item' });
    const iconBox = h('div', { className: 'act-icon' });
    iconBox.appendChild(icon(meta.icon));
    const main = h('div', { className: 'item-main' }, [
      h('div', { className: 'item-label', textContent: meta.label(e) }),
      h('div', { className: 'item-sub', textContent: e.host + ' · ' + relTime(e.ts) }),
    ]);
    row.append(iconBox, main);
    return row;
  }

  async function renderActivity() {
    const perms = await call({ type: 'SIDECAR_GET_PERMISSIONS' });
    const sites = $('sites-list');
    sites.innerHTML = '';
    const hosts = Object.keys(perms).sort();
    if (!hosts.length) {
      sites.append(h('p', { className: 'hint', textContent: 'No sites have connected yet.' }));
    }
    hosts.forEach((host) => sites.append(siteRow(host, perms[host].level)));

    const log = await call({ type: 'SIDECAR_GET_ACTIVITY' });
    const list = $('activity-list');
    list.innerHTML = '';
    if (!log.length) {
      list.append(h('p', { className: 'hint', textContent: 'No signing activity yet.' }));
      hide($('activity-more'));
      return;
    }
    const PAGE = 30;
    let shown = 0;
    const more = $('activity-more');
    function renderPage() {
      log.slice(shown, shown + PAGE).forEach((e) => list.append(activityRow(e)));
      shown = Math.min(shown + PAGE, log.length);
      if (shown >= log.length) hide(more);
      else {
        show(more);
        more.textContent = 'Show more (' + (log.length - shown) + ')';
      }
    }
    more.onclick = renderPage;
    renderPage();
  }

  $('activity-clear').addEventListener('click', async () => {
    await call({ type: 'SIDECAR_CLEAR_ACTIVITY' });
    renderActivity();
  });

  // ---- profile (active account): view + edit + publish kind 0 ----
  // Fetch the active account's latest kind:0 (used for both display and edit-merge).
  async function fetchActiveProfile() {
    const pk = state.activePubkey;
    if (!pk) return { content: {}, event: null };
    let event = null;
    try {
      event = await Promise.race([
        poolGet(await relayUrls(false), { kinds: [0], authors: [pk] }),
        new Promise((res) => setTimeout(() => res(null), 6000)),
      ]);
    } catch (_) {
      /* offline */
    }
    let content = {};
    if (event) {
      try {
        content = JSON.parse(event.content) || {};
      } catch (_) {}
    }
    return { content, event };
  }

  async function renderProfile() {
    const view = $('profile-view');
    const active = state.accounts.find((a) => a.pubkey === state.activePubkey);
    view.innerHTML = '';
    if (!active) {
      view.append(h('p', { className: 'hint', textContent: 'No active account.' }));
      return;
    }
    view.append(h('p', { className: 'hint', textContent: 'Loading profile…' }));
    const { content } = await fetchActiveProfile();
    view.innerHTML = '';

    const header = h('div', { className: 'profile-header' });
    if (content.banner) {
      const banner = document.createElement('img');
      banner.className = 'profile-banner';
      banner.alt = '';
      banner.referrerPolicy = 'no-referrer';
      banner.src = content.banner;
      banner.onerror = () => banner.classList.add('profile-banner-ph');
      header.append(banner);
    } else {
      header.append(h('div', { className: 'profile-banner profile-banner-ph' }));
    }
    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn profile-edit-btn';
    editBtn.title = 'Edit profile';
    editBtn.appendChild(icon('edit'));
    editBtn.addEventListener('click', () => openProfileEdit(content));
    header.append(editBtn);
    header.append(avatarEl({ picture: content.picture || active.picture, npub: active.npub }, 'profile-avatar'));
    view.append(header);

    // centered identity + bio
    const body = h('div', { className: 'profile-body' });
    body.append(
      h('div', {
        className: 'profile-name',
        textContent: content.display_name || content.name || active.name || shortNpub(active.npub),
      })
    );
    if (content.nip05) body.append(h('div', { className: 'profile-meta', textContent: content.nip05 }));
    body.append(npubChip(active.npub));

    if (content.about) {
      const about = h('p', { className: 'profile-about' });
      body.append(about);
      renderAbout(about, content.about);
    }
    if (content.lud16) body.append(h('div', { className: 'profile-meta', textContent: '⚡ ' + content.lud16 }));
    if (content.website) {
      const w = h('div', { className: 'profile-meta' });
      const a = document.createElement('a');
      a.href = normalizeUrl(content.website);
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      a.textContent = content.website;
      w.append(a);
      body.append(w);
    }
    view.append(body);

    renderBackupSection(view, active);
  }

  // ---- rich about text: links + npub/nprofile mentions, with show more/less ----
  const normalizeUrl = (u) => (/^https?:\/\//i.test(u) ? u : 'https://' + u);
  const mentionNameCache = new Map(); // pubkey -> name|null
  const TOKEN_RE = /(https?:\/\/[^\s]+)|(?:nostr:)?((?:npub1|nprofile1)[0-9a-z]+)/gi;

  function npubChip(npub) {
    const el = h('div', { className: 'profile-npub', title: 'Copy npub' });
    el.append(icon('copy'), h('span', { textContent: shortNpub(npub) }));
    el.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(npub);
        const span = el.querySelector('span');
        const prev = span.textContent;
        span.textContent = 'Copied ✓';
        setTimeout(() => (span.textContent = prev), 1200);
      } catch (_) {}
    });
    return el;
  }

  async function resolveMentions(mentions) {
    const need = [...new Set(mentions.map((x) => x.pubkey))].filter((pk) => !mentionNameCache.has(pk));
    if (need.length) {
      try {
        const events = await Promise.race([
          getPool().querySync(await relayUrls(false), { kinds: [0], authors: need }),
          new Promise((res) => setTimeout(() => res([]), 6000)),
        ]);
        const latest = {};
        (events || []).forEach((ev) => {
          if (!latest[ev.pubkey] || ev.created_at > latest[ev.pubkey].created_at) latest[ev.pubkey] = ev;
        });
        need.forEach((pk) => {
          let name = null;
          if (latest[pk]) {
            try {
              const m = JSON.parse(latest[pk].content);
              name = m.display_name || m.name || null;
            } catch (_) {}
          }
          mentionNameCache.set(pk, name);
        });
      } catch (_) {}
    }
    mentions.forEach(({ el, pubkey }) => {
      const name = mentionNameCache.get(pubkey);
      if (name) el.textContent = '@' + name;
    });
  }

  function renderAbout(container, text) {
    const bodyEl = h('div', { className: 'about-clamp' });
    const mentions = [];
    let last = 0;
    let m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      if (m.index > last) bodyEl.append(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) {
        const a = document.createElement('a');
        a.href = m[1];
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        a.textContent = m[1];
        bodyEl.append(a);
      } else if (m[2]) {
        const bech = m[2];
        let pubkey = null;
        try {
          const d = NT.nip19.decode(bech);
          pubkey = d.type === 'npub' ? d.data : d.type === 'nprofile' ? d.data.pubkey : null;
        } catch (_) {}
        if (pubkey) {
          const a = document.createElement('a');
          a.className = 'mention';
          a.target = '_blank';
          a.rel = 'noreferrer noopener';
          a.href = 'https://njump.me/' + bech;
          a.textContent = '@' + bech.slice(0, 10) + '…';
          mentions.push({ el: a, pubkey });
          bodyEl.append(a);
        } else {
          bodyEl.append(document.createTextNode(m[0]));
        }
      }
      last = TOKEN_RE.lastIndex;
    }
    if (last < text.length) bodyEl.append(document.createTextNode(text.slice(last)));
    container.append(bodyEl);
    resolveMentions(mentions);

    requestAnimationFrame(() => {
      if (bodyEl.scrollHeight > bodyEl.clientHeight + 4) {
        const toggle = h('button', { className: 'show-toggle', textContent: 'Show more' });
        let expanded = false;
        toggle.addEventListener('click', () => {
          expanded = !expanded;
          bodyEl.classList.toggle('about-clamp', !expanded);
          toggle.textContent = expanded ? 'Show less' : 'Show more';
        });
        container.append(toggle);
      } else {
        bodyEl.classList.remove('about-clamp');
      }
    });
  }

  // ---- image upload (NIP-98 → nostr.build) ----
  async function uploadImage(file, kind) {
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file');
    if (file.size > 10 * 1024 * 1024) throw new Error('Image too large (max 10MB)');
    const url = 'https://nostr.build/api/v2/upload/' + (kind === 'profile' ? 'profile' : 'files');
    const authEvent = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['u', url], ['method', 'POST']],
      content: '',
    };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event: authEvent });
    const token = 'Nostr ' + btoa(JSON.stringify(signed));
    const form = new FormData();
    form.append('file', file);
    const resp = await fetch(url, { method: 'POST', headers: { Authorization: token }, body: form });
    if (!resp.ok) throw new Error('Upload failed (' + resp.status + ')');
    const json = await resp.json().catch(() => null);
    const u = json && json.data && (Array.isArray(json.data) ? json.data[0] && json.data[0].url : json.data.url);
    if (!u) throw new Error('Upload returned no URL');
    return u;
  }

  // ---- note media upload (NIP-98 → nostr.build, images + video) ----
  async function uploadMedia(file) {
    const isImg = file.type.startsWith('image/');
    const isVid = file.type.startsWith('video/');
    if (!isImg && !isVid) throw new Error('Choose an image or video');
    if (file.size > 100 * 1024 * 1024) throw new Error('File too large (max 100MB)');
    const url = 'https://nostr.build/api/v2/upload/files';
    const authEvent = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['u', url], ['method', 'POST']],
      content: '',
    };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event: authEvent });
    const token = 'Nostr ' + btoa(JSON.stringify(signed));
    const form = new FormData();
    form.append('file', file);
    const resp = await fetch(url, { method: 'POST', headers: { Authorization: token }, body: form });
    if (!resp.ok) throw new Error('Upload failed (' + resp.status + ')');
    const json = await resp.json().catch(() => null);
    const u = json && json.data && (Array.isArray(json.data) ? json.data[0] && json.data[0].url : json.data.url);
    if (!u) throw new Error('Upload returned no URL');
    return u;
  }

  // ---- compose a kind:1 note (FAB) with Wisp-style send countdown ----
  const NOTE_COUNTDOWN_SECS = 15;
  const CLIENT_TAG = ['client', 'Sidecar 🍸', 'https://github.com/dmnyc/sidecar', 'wss://relay.damus.io'];
  const IMG_EXT = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?.*)?$/i;
  const VID_EXT = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

  // Web clients that can open a single note. Each maps a NIP-19 nevent → a URL.
  const VIEW_CLIENTS = {
    jumble: { label: 'Jumble', url: (ne) => 'https://jumble.social/notes/' + ne },
    njump: { label: 'njump', url: (ne) => 'https://njump.me/' + ne },
    primal: { label: 'Primal', url: (ne) => 'https://primal.net/e/' + ne },
    coracle: { label: 'Coracle', url: (ne) => 'https://coracle.social/' + ne },
    nostrudel: { label: 'noStrudel', url: (ne) => 'https://nostrudel.ninja/#/n/' + ne },
  };
  const DEFAULT_CLIENT = 'jumble';

  async function neventFor(signed) {
    let relays = [];
    try { relays = (await postRelays()).slice(0, 2); } catch (_) {}
    return NT.nip19.neventEncode({ id: signed.id, author: signed.pubkey, relays });
  }

  // Persistent "your note is live" banner with an open-in-client link.
  async function showPostBanner(signed) {
    const banner = $('post-banner');
    if (!banner) return;
    let nevent;
    try { nevent = await neventFor(signed); } catch (_) { return; }
    const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
    const key = (settings && settings.defaultClient) || DEFAULT_CLIENT;
    const client = VIEW_CLIENTS[key] || VIEW_CLIENTS[DEFAULT_CLIENT];

    banner.innerHTML = '';
    const msg = h('span', { className: 'post-banner-msg', textContent: 'Your note is live.' });
    const open = document.createElement('a');
    open.className = 'post-banner-link';
    open.href = client.url(nevent);
    open.target = '_blank';
    open.rel = 'noreferrer noopener';
    open.append(h('span', { textContent: 'Open in ' + client.label }));
    const close = h('button', { className: 'post-banner-x', title: 'Dismiss' });
    close.append(icon('x'));
    close.addEventListener('click', () => hide(banner));
    banner.append(msg, open, close);
    show(banner);
  }

  // Render composed note content the way a client will: text + inline media + @mentions.
  function renderNotePreview(container, text) {
    const mentions = [];
    let last = 0;
    let m;
    TOKEN_RE.lastIndex = 0;
    const flushText = (s) => { if (s) container.append(document.createTextNode(s)); };
    while ((m = TOKEN_RE.exec(text)) !== null) {
      if (m.index > last) flushText(text.slice(last, m.index));
      if (m[1]) {
        const url = m[1];
        if (IMG_EXT.test(url)) {
          const im = document.createElement('img');
          im.className = 'note-media';
          im.referrerPolicy = 'no-referrer';
          im.src = url;
          container.append(im);
        } else if (VID_EXT.test(url)) {
          const v = document.createElement('video');
          v.className = 'note-media';
          v.controls = true;
          v.src = url;
          container.append(v);
        } else {
          const a = document.createElement('a');
          a.href = url; a.target = '_blank'; a.rel = 'noreferrer noopener';
          a.textContent = url;
          container.append(a);
        }
      } else if (m[2]) {
        const bech = m[2];
        let pubkey = null;
        try {
          const d = NT.nip19.decode(bech);
          pubkey = d.type === 'npub' ? d.data : d.type === 'nprofile' ? d.data.pubkey : null;
        } catch (_) {}
        const a = document.createElement('span');
        a.className = 'mention';
        a.textContent = '@' + bech.slice(0, 10) + '…';
        if (pubkey) mentions.push({ el: a, pubkey });
        container.append(a);
      }
      last = TOKEN_RE.lastIndex;
    }
    flushText(text.slice(last));
    resolveMentions(mentions);
  }

  function openComposer() {
    if (!state.activePubkey) {
      toast('Add an account first', 'error');
      return;
    }
    const draft = { text: '', media: [] };
    const modal = $('modal');
    let timer = null;

    async function doPublish() {
      const content = draft.text.trim();
      const event = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [CLIENT_TAG.slice()],
        content,
      };
      const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event });
      await publishSigned(signed);
      return signed;
    }

    function showEditor() {
      if (timer) { clearInterval(timer); timer = null; }
      modal.innerHTML = '';

      // Write / Preview tab bar
      let preview = false;
      const tabWrite = h('button', { className: 'compose-tab active', textContent: 'Write' });
      const tabPreview = h('button', { className: 'compose-tab', textContent: 'Preview' });
      const tabBar = h('div', { className: 'compose-tabs' }, [tabWrite, tabPreview]);

      const ta = h('textarea', { className: 'compose-text', placeholder: 'What’s on your mind?' });
      ta.value = draft.text;
      ta.addEventListener('input', () => { draft.text = ta.value; updatePostState(); });

      const previewPane = h('div', { className: 'compose-preview hidden' });
      function renderPreview() {
        previewPane.innerHTML = '';
        const bodyText = draft.text.trim();
        if (bodyText) {
          const body = h('div', { className: 'preview-body' });
          renderNotePreview(body, bodyText);
          previewPane.append(body);
        } else {
          previewPane.append(h('p', { className: 'hint', textContent: 'Nothing to preview yet.' }));
        }
      }
      function setMode(p) {
        preview = p;
        tabWrite.classList.toggle('active', !p);
        tabPreview.classList.toggle('active', p);
        ta.classList.toggle('hidden', p);
        thumbs.classList.toggle('hidden', p);
        addBtn.classList.toggle('hidden', p);
        previewPane.classList.toggle('hidden', !p);
        if (p) renderPreview();
      }
      tabWrite.addEventListener('click', () => setMode(false));
      tabPreview.addEventListener('click', () => setMode(true));

      const thumbs = h('div', { className: 'compose-thumbs' });
      function renderThumbs() {
        thumbs.innerHTML = '';
        draft.media.forEach((m, i) => {
          const cell = h('div', { className: 'compose-thumb' });
          const el = m.isVideo ? document.createElement('video') : document.createElement('img');
          el.src = m.url;
          if (m.isVideo) el.muted = true;
          cell.append(el);
          const rm = h('button', { className: 'compose-thumb-x', title: 'Remove' });
          rm.append(icon('trash'));
          rm.addEventListener('click', () => {
            draft.text = draft.text.replace('\n' + m.url, '').replace(m.url, '').trimEnd();
            ta.value = draft.text;
            draft.media.splice(i, 1);
            renderThumbs();
            updatePostState();
          });
          cell.append(rm);
          thumbs.append(cell);
        });
      }
      renderThumbs();

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*,video/*';
      fileInput.style.display = 'none';
      const addBtn = h('button', { className: 'mini compose-add' });
      addBtn.append(icon('camera'), h('span', { textContent: 'Add photo or video' }));
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
          const url = await uploadMedia(file);
          draft.media.push({ url, isVideo: file.type.startsWith('video/') });
          draft.text = (draft.text ? draft.text.trimEnd() + '\n' : '') + url;
          ta.value = draft.text;
          renderThumbs();
          updatePostState();
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
        addBtn.disabled = false;
        lbl.textContent = prev;
        fileInput.value = '';
      });

      const err = h('div', { className: 'error' });
      const post = h('button', { className: 'primary', textContent: 'Post' });
      function updatePostState() { post.disabled = !draft.text.trim() && !draft.media.length; }
      post.addEventListener('click', () => {
        if (post.disabled) return;
        showCountdown();
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);

      // Show which account is posting so the user is never confused about identity.
      const active = state.accounts.find((a) => a.pubkey === state.activePubkey);
      const author = h('div', { className: 'compose-author' });
      author.append(avatarEl(active || {}, 'compose-author-av'));
      author.append(
        h('div', { className: 'compose-author-info' }, [
          h('span', { className: 'compose-author-eyebrow', textContent: 'Posting as' }),
          h('span', { className: 'compose-author-name', textContent: active ? displayName(active) : '—' }),
        ])
      );

      modal.append(
        h('h3', { textContent: 'New note' }),
        author,
        tabBar,
        ta,
        previewPane,
        thumbs,
        addBtn,
        fileInput,
        err,
        h('div', { className: 'actions' }, [post, cancel])
      );
      updatePostState();
      ta.focus();
    }

    function showCountdown() {
      modal.innerHTML = '';
      let remaining = NOTE_COUNTDOWN_SECS;
      const R = 30;
      const C = 2 * Math.PI * R;
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ring.setAttribute('viewBox', '0 0 72 72');
      ring.setAttribute('class', 'countdown-ring');
      ring.innerHTML =
        '<circle cx="36" cy="36" r="' + R + '" class="ring-track"/>' +
        '<circle cx="36" cy="36" r="' + R + '" class="ring-fill" ' +
        'stroke-dasharray="' + C + '" stroke-dashoffset="0" transform="rotate(-90 36 36)"/>';
      const num = h('div', { className: 'countdown-num', textContent: String(remaining) });
      const ringWrap = h('div', { className: 'countdown-wrap' }, [ring, num]);

      const now = h('button', { className: 'primary', textContent: 'Post now' });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });

      async function fire() {
        if (timer) { clearInterval(timer); timer = null; }
        now.disabled = true;
        now.textContent = 'Posting…';
        try {
          const signed = await doPublish();
          closeModal();
          toast('Note published', 'success');
          showPostBanner(signed);
        } catch (e) {
          toast(e.message, 'error');
          showEditor(); // keep the draft so they can retry
        }
      }
      now.addEventListener('click', fire);
      cancel.addEventListener('click', () => { showEditor(); });

      modal.append(
        h('h3', { textContent: 'Posting your note' }),
        h('p', { className: 'hint', textContent: 'Sending in a moment. Post now or cancel to keep editing.' }),
        ringWrap,
        h('div', { className: 'actions' }, [now, cancel])
      );

      const fill = ring.querySelector('.ring-fill');
      timer = setInterval(() => {
        remaining -= 1;
        num.textContent = String(Math.max(remaining, 0));
        fill.setAttribute('stroke-dashoffset', String(C * (1 - remaining / NOTE_COUNTDOWN_SECS)));
        if (remaining <= 0) fire();
      }, 1000);
    }

    openModal(() => showEditor(), () => { if (timer) { clearInterval(timer); timer = null; } });
  }

  // ---- edit profile (full-panel overlay) ----
  function openProfileEdit(current) {
    const draft = { ...current };
    const body = $('profile-edit-body');
    body.innerHTML = '';
    const err = h('div', { className: 'error' });
    const urlInputs = {};
    const setPreviewFns = {};

    const makeUpload = (label, kind, field, isBanner) => {
      const prev = h('div', { className: 'upload-preview' + (isBanner ? ' banner' : '') });
      const overlay = h('span', { className: 'upload-overlay' });
      overlay.append(icon('camera'));
      function setPreview(url) {
        prev.innerHTML = '';
        prev.classList.toggle('empty', !url);
        if (url) {
          const im = document.createElement('img');
          im.referrerPolicy = 'no-referrer';
          im.src = url;
          prev.append(im);
        }
        prev.append(overlay);
        if (capLabel) capLabel.textContent = url ? 'Change ' + label.toLowerCase() : 'Upload ' + label.toLowerCase();
      }

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      const capLabel = h('span', { className: 'upload-cap-label' });
      const capHint = h('span', { className: 'upload-cap-hint', textContent: 'JPG, PNG or GIF' });
      const caption = h('div', { className: 'upload-caption' }, [capLabel, capHint]);

      setPreviewFns[field] = setPreview;
      setPreview(draft[field]);

      const trigger = () => input.click();
      prev.addEventListener('click', trigger);
      caption.addEventListener('click', trigger);

      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        err.textContent = '';
        prev.classList.add('uploading');
        const before = capLabel.textContent;
        capLabel.textContent = 'Uploading…';
        try {
          const u = await uploadImage(file, kind);
          draft[field] = u;
          setPreview(u);
          if (urlInputs[field]) urlInputs[field].value = u;
        } catch (e) {
          err.textContent = e.message;
          capLabel.textContent = before;
          toast(e.message, 'error');
        }
        prev.classList.remove('uploading');
        input.value = '';
      });
      body.append(
        h('label', { className: 'field-label', textContent: label }),
        h('div', { className: 'upload-row' + (isBanner ? ' banner' : ''), role: 'button' }, [prev, caption, input])
      );
    };

    makeUpload('Avatar', 'profile', 'picture', false);
    makeUpload('Banner', 'files', 'banner', true);

    const fieldDefs = [
      ['display_name', 'Display name', 'text'],
      ['name', 'Username', 'text'],
      ['about', 'About', 'textarea'],
      ['nip05', 'NIP-05 identifier', 'text'],
      ['lud16', 'Lightning address', 'text'],
      ['website', 'Website', 'text'],
    ];
    const inputs = {};
    fieldDefs.forEach(([key, label, type]) => {
      body.append(h('label', { className: 'field-label', textContent: label }));
      const el = document.createElement(type === 'textarea' ? 'textarea' : 'input');
      if (type !== 'textarea') el.type = 'text';
      el.value = current[key] || '';
      inputs[key] = el;
      body.append(el);
    });

    // advanced: raw image URLs
    const adv = document.createElement('details');
    adv.className = 'advanced';
    const sum = document.createElement('summary');
    sum.textContent = 'Advanced — image URLs';
    adv.append(sum);
    [['picture', 'Avatar URL'], ['banner', 'Banner URL']].forEach(([field, label]) => {
      adv.append(h('label', { className: 'field-label', textContent: label }));
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = draft[field] || '';
      urlInputs[field] = inp;
      inp.addEventListener('input', () => {
        draft[field] = inp.value.trim();
        if (setPreviewFns[field]) setPreviewFns[field](draft[field]);
      });
      adv.append(inp);
    });
    body.append(adv);

    body.append(h('label', { className: 'field-label', textContent: 'PIN (required to publish)' }));
    const pin = h('input', { type: 'password', maxLength: 32 });
    body.append(pin, err);

    const publish = h('button', { className: 'primary', textContent: 'Publish profile' });
    publish.addEventListener('click', async () => {
      err.textContent = '';
      if (!pin.value) return (err.textContent = 'Enter your PIN to publish.');
      publish.disabled = true;
      publish.textContent = 'Publishing…';
      try {
        const fields = { picture: draft.picture || '', banner: draft.banner || '' };
        fieldDefs.forEach(([k]) => (fields[k] = inputs[k].value));
        await publishProfile(fields, pin.value);
        hide($('view-profile-edit'));
        show($('view-main'));
        renderProfile();
        renderMain();
        toast('Profile published', 'success');
      } catch (e) {
        err.textContent = e.message;
        publish.disabled = false;
        publish.textContent = 'Publish profile';
        toast(e.message, 'error');
      }
    });
    body.append(h('div', { className: 'actions' }, [publish]));

    hide($('view-main'));
    show($('view-profile-edit'));
    const content = $('view-profile-edit').querySelector('.content');
    if (content) content.scrollTop = 0;
  }

  $('profile-edit-close').addEventListener('click', () => {
    hide($('view-profile-edit'));
    show($('view-main'));
  });

  // Fetch-merge-sign-publish: preserve unknown fields, overlay edits, sign (step-up PIN), publish.
  async function publishProfile(fields, pin) {
    const { content } = await fetchActiveProfile();
    const merged = { ...content };
    Object.keys(fields).forEach((k) => {
      const v = (fields[k] || '').trim();
      if (v) merged[k] = v;
      else delete merged[k];
    });
    const event = { kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(merged) };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event, pin });
    await publishSigned(signed);
    await call({
      type: 'SIDECAR_SET_PROFILE',
      pubkey: state.activePubkey,
      name: merged.display_name || merged.name || '',
      picture: merged.picture || '',
    });
    state = await call({ type: 'SIDECAR_GET_STATE' });
  }

  // ---- NIP-78 encrypted backup/restore (profile / follows / mute) ----
  const BACKUP_TYPES = [
    { key: 'profile', label: 'Profile', kind: 0, dtag: 'sidecar:profile-backup' },
    { key: 'follows', label: 'Follows', kind: 3, dtag: 'sidecar:follows-backup' },
    { key: 'mute', label: 'Mute list', kind: 10000, dtag: 'sidecar:mute-backup' },
  ];

  async function fetchLatestEvent(kind) {
    return Promise.race([
      poolGet(await relayUrls(false), { kinds: [kind], authors: [state.activePubkey] }),
      new Promise((res) => setTimeout(() => res(null), 6000)),
    ]).catch(() => null);
  }
  async function fetchBackupEvent(dtag) {
    return Promise.race([
      poolGet(await relayUrls(false), { kinds: [30078], authors: [state.activePubkey], '#d': [dtag] }),
      new Promise((res) => setTimeout(() => res(null), 6000)),
    ]).catch(() => null);
  }

  // Snapshot the active account's latest kind:0/3/10000, encrypt to self, store as NIP-78.
  async function createBackup(t) {
    const src = await fetchLatestEvent(t.kind);
    if (!src) throw new Error('Nothing to back up yet for ' + t.label.toLowerCase());
    const blob = {
      v: 1,
      ts: Math.floor(Date.now() / 1000),
      source: { kind: src.kind, created_at: src.created_at, tags: src.tags, content: src.content },
    };
    // Prefer NIP-44, but it caps plaintext at 65535 bytes — large follow lists
    // exceed that, so fall back to NIP-04 (no hard cap). The `encrypted` tag
    // records which scheme was used so restore decrypts correctly.
    const plaintext = JSON.stringify(blob);
    let ciphertext, algo;
    try {
      ciphertext = await call({ type: 'SIDECAR_OWNER_ENCRYPT', plaintext, nip: 44 });
      algo = 'nip44';
    } catch (_) {
      ciphertext = await call({ type: 'SIDECAR_OWNER_ENCRYPT', plaintext, nip: 4 });
      algo = 'nip04';
    }
    const event = {
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', t.dtag], ['encrypted', algo]],
      content: ciphertext,
    };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event });
    await publishSigned(signed);
  }

  // Decrypt the latest backup and re-publish it as the current event (PIN-gated).
  async function restoreBackup(t, pin) {
    const ev = await fetchBackupEvent(t.dtag);
    if (!ev) throw new Error('No backup found for ' + t.label.toLowerCase());
    const scheme = (ev.tags.find((x) => x[0] === 'encrypted') || [])[1];
    const nip = scheme === 'nip44' ? 44 : 4; // older backups were NIP-04
    const plaintext = await call({ type: 'SIDECAR_OWNER_DECRYPT', ciphertext: ev.content, nip });
    let blob;
    try {
      blob = JSON.parse(plaintext);
    } catch (_) {
      throw new Error('Backup could not be read');
    }
    const s = blob.source || {};
    const event = { kind: s.kind, created_at: Math.floor(Date.now() / 1000), tags: s.tags || [], content: s.content || '' };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event, pin });
    await publishSigned(signed);
  }

  // Plain signed-JSON export of the account's identity events (download, no relays).
  async function exportBundle(active) {
    const events = [];
    for (const k of [0, 3, 10002, 10000]) {
      const ev = await fetchLatestEvent(k);
      if (ev) events.push(ev);
    }
    if (!events.length) throw new Error('Nothing found to export');
    const bundle = { version: 1, exportedAt: new Date().toISOString(), pubkey: active.pubkey, npub: active.npub, events };
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sidecar-backup-' + active.npub.slice(0, 12) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  const KIND_LABELS = { 0: 'Profile', 3: 'Follows', 10000: 'Mute list', 10002: 'Relay list' };
  const kindLabel = (k) => KIND_LABELS[k] || ('kind ' + k);

  // Import a downloaded backup file: verify signatures + ownership, then rebroadcast.
  function importBundleModal(bundle, active) {
    const events = Array.isArray(bundle && bundle.events) ? bundle.events : null;
    if (!events || !events.length) {
      toast('That file has no events to restore', 'error');
      return;
    }
    // Keep only well-formed, validly-signed events authored by the active account.
    const valid = events.filter((ev) => {
      try {
        return ev && ev.pubkey === active.pubkey && NT.verifyEvent(ev);
      } catch (_) {
        return false;
      }
    });
    const foreign = events.filter((ev) => ev && ev.pubkey && ev.pubkey !== active.pubkey).length;

    openModal((modal) => {
      const go = h('button', { className: 'primary', textContent: 'Restore to relays' });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);

      const children = [
        h('h3', { textContent: 'Restore from file' }),
      ];
      if (!valid.length) {
        go.disabled = true;
        children.push(
          h('p', {
            className: 'hint',
            textContent: foreign
              ? 'This backup belongs to a different account, so nothing here can be restored to ' + displayName(active) + '.'
              : 'No valid, signed events were found in this file.',
          })
        );
        modal.append(...children, h('div', { className: 'actions' }, [cancel]));
        return;
      }

      const summary = h('ul', { className: 'restore-list' });
      valid.forEach((ev) => summary.append(h('li', { textContent: kindLabel(ev.kind) })));
      children.push(
        h('p', {
          className: 'hint',
          textContent: 'Re-publishes these already-signed events to your relays as your current data:',
        }),
        summary
      );
      if (foreign) {
        children.push(h('p', { className: 'hint warn', textContent: foreign + ' event(s) from another account were skipped.' }));
      }

      const err = h('div', { className: 'error' });
      go.addEventListener('click', async () => {
        err.textContent = '';
        go.disabled = true;
        go.textContent = 'Restoring…';
        let ok = 0;
        for (const ev of valid) {
          try {
            await publishSigned(ev);
            ok++;
          } catch (_) {}
        }
        closeModal();
        if (ok) {
          toast('Restored ' + ok + ' item(s) to your relays', 'success');
          renderProfile();
          renderMain();
        } else {
          toast('Could not publish to any relay', 'error');
        }
      });

      modal.append(...children, err, h('div', { className: 'actions' }, [go, cancel]));
    });
  }

  function restoreModal(t) {
    openModal((modal) => {
      const pin = h('input', { type: 'password', maxLength: 32 });
      const err = h('div', { className: 'error' });
      const go = h('button', { className: 'primary', textContent: 'Restore' });
      go.addEventListener('click', async () => {
        err.textContent = '';
        if (!pin.value) return (err.textContent = 'Enter your PIN.');
        go.disabled = true;
        go.textContent = 'Restoring…';
        try {
          await restoreBackup(t, pin.value);
          closeModal();
          toast(t.label + ' restored', 'success');
        } catch (e) {
          err.textContent = e.message;
          go.disabled = false;
          go.textContent = 'Restore';
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Restore ' + t.label }),
        h('p', {
          className: 'hint',
          textContent:
            'Re-publishes your latest ' + t.label.toLowerCase() + ' backup as your current ' + t.label.toLowerCase() + '. Requires your PIN.',
        }),
        h('label', { textContent: 'PIN' }),
        pin,
        err,
        h('div', { className: 'actions' }, [go, cancel])
      );
    });
  }

  function renderBackupSection(view, active) {
    const setting = h('div', { className: 'setting backup-setting' });
    setting.append(
      h('h3', { textContent: 'Backup & restore' }),
      h('p', { className: 'hint', textContent: 'Stored on your relays as a NIP-78 record, encrypted to your own key (NIP-44, or NIP-04 for very large lists).' })
    );
    const list = h('div', { className: 'list flat' });
    BACKUP_TYPES.forEach((t) => {
      const status = h('div', { className: 'backup-status', textContent: 'Not backed up yet' });
      const backup = h('button', { className: 'mini', textContent: 'Back up' });
      backup.addEventListener('click', async () => {
        backup.disabled = true;
        backup.textContent = 'Backing up…';
        try {
          await createBackup(t);
          status.textContent = 'Backed up ✓';
          status.classList.add('done');
          toast(t.label + ' backed up', 'success');
        } catch (e) {
          // Keep the row tidy — surface the detail in a toast, not inline.
          toast(e.message, 'error');
        }
        backup.disabled = false;
        backup.textContent = 'Back up';
      });
      const restore = h('button', { className: 'mini ghost', textContent: 'Restore' });
      restore.addEventListener('click', () => restoreModal(t));
      const row = h('div', { className: 'item' }, [
        h('div', { className: 'item-main' }, [h('div', { className: 'item-label', textContent: t.label }), status]),
        h('div', { className: 'item-actions' }, [backup, restore]),
      ]);
      list.append(row);
    });
    setting.append(list);

    const exportWrap = h('div', { className: 'export-block' });
    exportWrap.append(
      h('p', {
        className: 'hint',
        textContent:
          'Or save a signed copy of your profile, follows, and lists as a file — an offline safety copy you can restore here later.',
      })
    );
    const exportBtn = h('button', { className: 'secondary', textContent: 'Download backup file' });
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      try {
        await exportBundle(active);
        toast('Backup file downloaded', 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
      exportBtn.disabled = false;
    });

    const importBtn = h('button', { className: 'secondary', textContent: 'Restore from file' });
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.style.display = 'none';
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        importBundleModal(JSON.parse(text), active);
      } catch (_) {
        toast('That file is not a valid Sidecar backup', 'error');
      }
      fileInput.value = '';
    });

    exportWrap.append(exportBtn, importBtn, fileInput);
    setting.append(exportWrap);
    view.append(setting);
  }

  $('autolock-select').addEventListener('change', async (e) => {
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { autoLockMinutes: Number(e.target.value) } });
  });

  $('client-select').addEventListener('change', async (e) => {
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { defaultClient: e.target.value } });
  });

  $('relay-add').addEventListener('click', async () => {
    const input = $('relay-input');
    let url = input.value.trim();
    if (!url) return;
    if (!/^wss?:\/\//.test(url)) url = 'wss://' + url;
    const relays = await call({ type: 'SIDECAR_GET_RELAYS' });
    relays[url] = { read: true, write: true };
    await call({ type: 'SIDECAR_SET_RELAYS', relays });
    input.value = '';
    renderSettings();
  });

  $('change-pin-btn').addEventListener('click', () => {
    openModal((modal) => {
      const oldP = h('input', { type: 'password', placeholder: 'Current PIN', maxLength: 32 });
      const newP = h('input', { type: 'password', placeholder: 'New PIN', maxLength: 32 });
      const newP2 = h('input', { type: 'password', placeholder: 'Confirm new PIN', maxLength: 32 });
      const err = h('div', { className: 'error' });
      const save = h('button', { className: 'primary', textContent: 'Change PIN' });
      save.addEventListener('click', async () => {
        err.textContent = '';
        if (newP.value.length < 4) return (err.textContent = 'New PIN too short.');
        if (newP.value.length > 32) return (err.textContent = 'Max 32 characters.');
        if (newP.value !== newP2.value) return (err.textContent = 'New PINs do not match.');
        try {
          await call({ type: 'SIDECAR_CHANGE_PIN', oldPin: oldP.value, newPin: newP.value });
          closeModal();
          toast('PIN changed', 'success');
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Change PIN' }),
        oldP,
        newP,
        newP2,
        err,
        h('div', { className: 'actions' }, [save, cancel])
      );
    });
  });

  // ---- boot ----
  document.addEventListener('DOMContentLoaded', refresh);
  if (document.readyState !== 'loading') refresh();
})();
