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
  };
  function icon(name) {
    const wrap = document.createElement('span');
    wrap.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[name] || '') +
      '</svg>';
    return wrap.firstElementChild;
  }

  let state = null;

  // ---- top-level routing ----
  async function refresh() {
    state = await call({ type: 'SIDECAR_GET_STATE' });
    [$('view-onboarding'), $('view-lock'), $('view-main'), $('view-settings')].forEach(hide);
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
      promptAddFirstAccount();
    } catch (e) {
      err.textContent = e.message;
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
    } catch (e) {
      err.textContent = e.message;
      $('unlock-pin').value = '';
    }
  });

  // ---- lock ----
  $('lock-btn').addEventListener('click', async () => {
    await call({ type: 'SIDECAR_LOCK' });
    await refresh();
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

  // ---- tabs ----
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      document.querySelectorAll('.tabview').forEach((v) => hide(v));
      show($('tab-' + name));
      if (name === 'activity') renderActivity();
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

  // A circular avatar element: the account's kind:0 picture, or the anon placeholder.
  function avatarEl(a, cls) {
    const box = document.createElement('div');
    box.className = cls;
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    if (a.picture) {
      img.src = a.picture;
      img.onerror = () => {
        img.src = 'icons/anon.svg';
        img.onerror = null;
        box.classList.add('avatar-ph');
      };
    } else {
      img.src = 'icons/anon.svg';
      box.classList.add('avatar-ph');
    }
    box.appendChild(img);
    return box;
  }

  // ---- kind:0 profile import (name + picture) ----
  let _pool = null;
  const poolGet = (relays, filter) => {
    if (!_pool) _pool = new NT.SimplePool();
    return _pool.get(relays, filter);
  };
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

    // Lazily pull name + picture from kind:0 for any account missing them.
    state.accounts.forEach((a) => {
      if (!a.name && !a.picture) maybeFetchProfile(a.pubkey);
    });
  }

  function accountRow(a) {
    const row = document.createElement('div');
    row.className = 'item' + (a.pubkey === state.activePubkey ? ' item-active' : '');

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
  }
  function closeModal() {
    hide($('modal-overlay'));
    $('modal').innerHTML = '';
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
        h('p', { className: 'hint', textContent: 'Your name and picture are loaded from your Nostr profile (kind 0).' }),
        err
      );

      const save = h('button', { className: 'primary', textContent: 'Add account' });
      save.addEventListener('click', async () => {
        err.textContent = '';
        try {
          if (chooseGenerate === null) throw new Error('Choose “Generate new” or “Import nsec”.');
          if (chooseGenerate) {
            await call({ type: 'SIDECAR_ADD_ACCOUNT', generate: true });
          } else {
            const secret = secretInput.value.trim();
            if (!secret) throw new Error('Enter an nsec or hex private key.');
            await call({ type: 'SIDECAR_ADD_ACCOUNT', secret });
          }
          closeModal();
          await refresh(); // renderMain() then pulls the profile for the new account
        } catch (e) {
          err.textContent = e.message;
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
          closeModal();
        }),
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
        } catch (e) {
          err.textContent = e.message;
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
        } catch (e) {
          err.textContent = e.message;
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
