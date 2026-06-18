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
      renderMain();
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
    state.accounts.forEach((a) => {
      const row = h('button', { className: 'acct-row' + (a.pubkey === state.activePubkey ? ' active' : '') });
      const av = document.createElement('span');
      av.className = 'acct-row-av';
      applyAvatar(av, a);
      const info = h('div', { className: 'acct-row-info' }, [
        h('div', { className: 'acct-row-name', textContent: displayName(a) }),
        h('div', { className: 'acct-row-npub', textContent: shortNpub(a.npub) }),
      ]);
      row.append(av, info);
      if (a.pubkey === state.activePubkey) {
        const c = icon('check');
        c.classList.add('acct-row-check');
        row.append(c);
      }
      row.addEventListener('click', async () => {
        closeAcctMenu();
        if (a.pubkey !== state.activePubkey) {
          await call({ type: 'SIDECAR_SET_ACTIVE', pubkey: a.pubkey });
          await refresh();
          toast('Switched to ' + displayName(a), 'success');
        }
      });
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

  // Publish an already-signed event to the configured (write) relays.
  async function publishSigned(signed) {
    const relays = await relayUrls(true);
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

    // Lazily pull name + picture from kind:0 for any account missing them.
    state.accounts.forEach((a) => {
      if (!a.name && !a.picture) maybeFetchProfile(a.pubkey);
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
    main.style.cursor = 'pointer';
    main.title = 'Make active';
    const label = document.createElement('div');
    label.className = 'item-label';
    label.textContent = displayName(a);
    const sub = document.createElement('div');
    sub.className = 'item-sub';
    sub.textContent = shortNpub(a.npub);
    main.append(label, sub);
    main.addEventListener('click', async () => {
      if (a.pubkey !== state.activePubkey) {
        await call({ type: 'SIDECAR_SET_ACTIVE', pubkey: a.pubkey });
        await refresh();
      }
    });

    const actions = document.createElement('div');
    actions.className = 'item-actions';
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
  function openModal(buildContent) {
    const modal = $('modal');
    modal.innerHTML = '';
    buildContent(modal);
    show($('modal-overlay'));
    document.documentElement.classList.add('modal-open');
  }
  function closeModal() {
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
      }

      modal.append(secretWrap);
      modal.append(
        h('p', {
          className: 'hint',
          textContent:
            'Your name and picture come from your Nostr profile, if you have one. A new account gets a placeholder name you can change anytime.',
        }),
        err
      );

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
    }
    log.slice(0, 100).forEach((e) => list.append(activityRow(e)));
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
    header.append(avatarEl({ picture: content.picture || active.picture, npub: active.npub }, 'profile-avatar'));
    view.append(header);

    // identity block: name / nip05 / npub on the left, flat pencil edit on the right
    const idMain = h('div', { className: 'profile-id-main' });
    idMain.append(
      h('div', {
        className: 'profile-name',
        textContent: content.display_name || content.name || active.name || shortNpub(active.npub),
      })
    );
    if (content.nip05) idMain.append(h('div', { className: 'profile-meta', textContent: content.nip05 }));
    idMain.append(npubChip(active.npub));

    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn profile-edit-btn';
    editBtn.title = 'Edit profile';
    editBtn.appendChild(icon('edit'));
    editBtn.addEventListener('click', () => openProfileEdit(content));
    view.append(h('div', { className: 'profile-id' }, [idMain, editBtn]));

    if (content.about) {
      const about = h('p', { className: 'profile-about' });
      view.append(about);
      renderAbout(about, content.about);
    }
    if (content.lud16) view.append(h('div', { className: 'profile-meta', textContent: '⚡ ' + content.lud16 }));
    if (content.website) {
      const w = h('div', { className: 'profile-meta' });
      const a = document.createElement('a');
      a.href = normalizeUrl(content.website);
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      a.textContent = content.website;
      w.append(a);
      view.append(w);
    }

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
      function setPreview(url) {
        prev.innerHTML = '';
        if (url) {
          const im = document.createElement('img');
          im.referrerPolicy = 'no-referrer';
          im.src = url;
          prev.append(im);
        } else {
          const ic = icon('camera');
          ic.classList.add('upload-ph-icon');
          prev.append(ic);
        }
      }
      setPreviewFns[field] = setPreview;
      setPreview(draft[field]);

      const btn = h('button', { className: 'secondary upload-btn', textContent: 'Upload ' + label.toLowerCase() });
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      btn.addEventListener('click', () => input.click());
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        err.textContent = '';
        btn.disabled = true;
        const t = btn.textContent;
        btn.textContent = 'Uploading…';
        try {
          const u = await uploadImage(file, kind);
          draft[field] = u;
          setPreview(u);
          if (urlInputs[field]) urlInputs[field].value = u;
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
        btn.disabled = false;
        btn.textContent = t;
        input.value = '';
      });
      body.append(h('label', { className: 'field-label', textContent: label }), h('div', { className: 'upload-row' }, [prev, btn, input]));
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
    const ciphertext = await call({ type: 'SIDECAR_OWNER_ENCRYPT', plaintext: JSON.stringify(blob) });
    const event = {
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', t.dtag], ['encrypted', 'nip04']],
      content: ciphertext,
    };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event });
    await publishSigned(signed);
  }

  // Decrypt the latest backup and re-publish it as the current event (PIN-gated).
  async function restoreBackup(t, pin) {
    const ev = await fetchBackupEvent(t.dtag);
    if (!ev) throw new Error('No backup found for ' + t.label.toLowerCase());
    const plaintext = await call({ type: 'SIDECAR_OWNER_DECRYPT', ciphertext: ev.content });
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
    const setting = h('div', { className: 'setting' });
    setting.append(
      h('h3', { textContent: 'Backup & restore' }),
      h('p', { className: 'hint', textContent: 'Encrypted to your own key and stored on your relays (NIP-78).' })
    );
    const list = h('div', { className: 'list flat' });
    BACKUP_TYPES.forEach((t) => {
      const status = h('div', { className: 'item-sub', textContent: '' });
      const backup = h('button', { className: 'mini', textContent: 'Back up' });
      backup.addEventListener('click', async () => {
        status.textContent = '';
        backup.disabled = true;
        backup.textContent = 'Backing up…';
        try {
          await createBackup(t);
          status.textContent = 'Backed up just now ✓';
          toast(t.label + ' backed up', 'success');
        } catch (e) {
          status.textContent = e.message;
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
    const exportBtn = h('button', { className: 'secondary', textContent: 'Download signed JSON…' });
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      try {
        await exportBundle(active);
      } catch (e) {
        alert(e.message);
      }
      exportBtn.disabled = false;
    });
    setting.append(exportBtn);
    view.append(setting);
  }

  $('autolock-select').addEventListener('change', async (e) => {
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { autoLockMinutes: Number(e.target.value) } });
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
