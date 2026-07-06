// Sidecar approval/unlock prompt — opened as a popup window by the service worker when a
// web page calls window.nostr and we need the user to approve (and possibly unlock).

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const promptId = params.get('id');

  const $ = (id) => document.getElementById(id);
  const els = {
    host: $('host'),
    ask: $('ask'),
    preview: $('preview'),
    account: $('account'),
    switchToggle: $('switch-toggle'),
    switchMenu: $('switch-menu'),
    unlock: $('unlock'),
    pin: $('pin'),
    error: $('error'),
    allow: $('allow'),
    trust: $('trust'),
    reject: $('reject'),
    remember: $('remember'),
    rememberBudget: $('remember-budget'),
    budgetAmount: $('budget-amount'),
  };

  function send(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }

  const METHOD_LABELS = {
    getPublicKey: 'see your public key (npub)',
    signEvent: 'sign an event with your key',
    getRelays: 'read your relay list',
    'nip04.encrypt': 'encrypt a message (NIP-04)',
    'nip04.decrypt': 'decrypt a message (NIP-04)',
    'nip44.encrypt': 'encrypt a message (NIP-44)',
    'nip44.decrypt': 'decrypt a message (NIP-44)',
    'webln.getInfo': 'see your wallet info',
    'webln.getBalance': 'see your wallet balance',
    'webln.makeInvoice': 'create a Lightning invoice',
  };

  let data = null;
  let isPayment = false;
  let chosenPubkey = null; // login (getPublicKey) prompts only — see canOfferAccountSwitch in background.js

  function fmtSats(n) {
    return Number(n).toLocaleString('en-US');
  }

  // Human-readable labels for the event kinds sites most commonly ask Sidecar to
  // sign (not exhaustive — see https://nips.nostr.com for the full registry).
  const KIND_LABELS = {
    0: 'Profile metadata', 1: 'Note', 3: 'Follow list', 4: 'Encrypted DM (legacy)',
    5: 'Delete request', 6: 'Repost', 7: 'Reaction', 8: 'Badge award', 9: 'Chat message',
    11: 'Thread', 13: 'Seal', 14: 'Direct message', 15: 'File message', 16: 'Generic repost',
    17: 'Reaction (website)', 20: 'Picture', 21: 'Video', 22: 'Short video',
    1063: 'File metadata', 1111: 'Comment', 1311: 'Live chat message', 1984: 'Report',
    9734: 'Zap request', 9735: 'Zap receipt', 9802: 'Highlight',
    10000: 'Mute list', 10001: 'Pin list', 10002: 'Relay list', 10003: 'Bookmark list',
    10063: 'Blossom server list',
    13194: 'Wallet info', 22242: 'Relay auth', 23194: 'Wallet request', 23195: 'Wallet response',
    24133: 'Remote signing handshake', 27235: 'HTTP auth',
    30000: 'Follow set', 30002: 'Relay set', 30003: 'Bookmark set', 30008: 'Badge set',
    30009: 'Badge definition', 30017: 'Marketplace stall', 30018: 'Marketplace product',
    30023: 'Long-form article', 30024: 'Article draft', 30078: 'App data',
    30311: 'Live event', 30402: 'Classified listing',
    31922: 'Calendar event (date)', 31923: 'Calendar event (time)', 31924: 'Calendar',
    31989: 'Handler recommendation', 31990: 'Handler info',
  };
  // Kinds worth a second look before signing: they either move/delete other
  // events, or normally belong to a wallet's own key rather than a NIP-07 site.
  const KIND_WARNINGS = {
    5: 'Deletes other events — make sure you intended this.',
    23194: "Wallet requests are normally signed by the wallet app's own key, not your identity key. Unusual for a site to ask for this.",
    23195: "Wallet responses are normally signed by the wallet app's own key, not your identity key. Unusual for a site to ask for this.",
    24133: 'This is a remote-signing handshake — approving it could hand control of your account to another app or device.',
  };
  function kindLabel(kind) {
    if (kind == null) return '—';
    return KIND_LABELS[kind] ? kind + ' — ' + KIND_LABELS[kind] : kind + ' (unrecognized kind)';
  }
  function kindWarning(kind) {
    if (kind == null) return null;
    return KIND_WARNINGS[kind] || (!KIND_LABELS[kind] ? 'Unrecognized event kind — review carefully before approving.' : null);
  }

  function renderPreview() {
    if (isPayment) {
      const rows = [];
      rows.push(row('Amount', data.amountSats != null ? fmtSats(data.amountSats) + ' sats' : 'set by invoice'));
      if (data.memo) rows.push(row('Memo', String(data.memo)));
      els.preview.innerHTML = rows.join('');
      els.preview.classList.remove('hidden');
      return;
    }
    if (data.method === 'signEvent') {
      const ev = (data.params && (data.params.event || data.params)) || {};
      const rows = [];
      rows.push(row('Kind', kindLabel(ev.kind)));
      if (Array.isArray(ev.tags)) rows.push(row('Tags', String(ev.tags.length)));
      els.preview.innerHTML = rows.join('');
      const warning = kindWarning(ev.kind);
      if (warning) {
        const warn = document.createElement('div');
        warn.className = 'kind-warn';
        warn.textContent = warning;
        els.preview.appendChild(warn);
      }
      if (ev.content) {
        const pre = document.createElement('pre');
        pre.textContent = String(ev.content);
        els.preview.appendChild(pre);
      }
      els.preview.classList.remove('hidden');
    } else if (data.method === 'nip04.decrypt' || data.method === 'nip44.decrypt') {
      els.preview.innerHTML = row('From', (data.params && data.params.pubkey) || '—');
      els.preview.classList.remove('hidden');
    } else if (data.method === 'nip04.encrypt' || data.method === 'nip44.encrypt') {
      els.preview.innerHTML = row('To', (data.params && data.params.pubkey) || '—');
      els.preview.classList.remove('hidden');
    }
  }

  function row(k, v) {
    return `<div class="row"><span>${k}</span><span>${escapeHtml(v)}</span></div>`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  async function init() {
    const resp = await send({ type: 'SIDECAR_GET_PROMPT_DATA', id: promptId });
    if (!resp || !resp.ok) {
      els.ask.textContent = 'This request has expired.';
      els.allow.classList.add('hidden');
      els.trust.classList.add('hidden');
      els.reject.textContent = 'Close';
      return;
    }
    data = resp.data;
    isPayment = data.scope === 'webln' && data.method === 'sendPayment';
    chosenPubkey = data.activePubkey;

    els.host.textContent = data.host;
    const verb = isPayment ? 'wants to send a Lightning payment' : 'wants to ' + (METHOD_LABELS[data.method] || data.method);
    els.ask.textContent = verb;
    buildAccountCapsule();
    renderPreview();

    if (data.needUnlock) {
      els.unlock.classList.remove('hidden');
      setTimeout(() => els.pin.focus(), 50);
    }

    if (isPayment) {
      // Payment: one Pay button + an optional "remember a budget" toggle.
      els.allow.textContent = data.amountSats != null ? 'Pay ' + fmtSats(data.amountSats) + ' sats' : 'Pay';
      els.trust.classList.add('hidden');
      els.remember.classList.remove('hidden');
      // Suggest a daily budget; the field is disabled until the box is ticked, so
      // it's unambiguous whether a budget is actually being set.
      const suggested = data.amountSats != null ? Math.max(data.amountSats * 5, 5000) : 5000;
      els.budgetAmount.value = String(suggested);
      els.budgetAmount.disabled = true;
      els.rememberBudget.addEventListener('change', () => {
        els.budgetAmount.disabled = !els.rememberBudget.checked;
        if (els.rememberBudget.checked) els.budgetAmount.focus();
      });
      return;
    }

    // A pure unlock (site already trusted, keystore just locked) doesn't need the
    // "Trust this site" choice — it's already remembered.
    if (data.needUnlock && !data.needApproval) {
      els.allow.textContent = 'Unlock & continue';
      els.trust.classList.add('hidden');
    }
  }

  function shortNpub(npub) {
    if (!npub) return '—';
    return npub.length > 20 ? npub.slice(0, 12) + '…' + npub.slice(-6) : npub;
  }

  // All accounts selectable in this prompt: the one it opened with, plus (only
  // for a login prompt — see canOfferAccountSwitch in background.js) any
  // others the user could switch to before approving.
  function accountList() {
    return [
      { pubkey: data.activePubkey, npub: data.npub, name: data.accountName, picture: data.accountPicture },
      ...(data.otherAccounts || []),
    ];
  }

  const CHECK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="switch-row-check"><polyline points="20 6 9 17 4 12"></polyline></svg>';

  // Account capsule (pfp + name + npub), matching the side panel's account card.
  function buildAccountCapsule() {
    const list = accountList();
    const chosen = list.find((a) => a.pubkey === chosenPubkey) || list[0];

    els.account.innerHTML = '';
    const label = document.createElement('div');
    label.className = 'as-label';
    label.textContent = isPayment ? 'Paying from' : 'Signing as';
    const av = document.createElement('img');
    av.className = 'acct-av';
    av.referrerPolicy = 'no-referrer';
    av.onerror = () => { av.onerror = null; av.src = 'icons/avatar-default.svg'; };
    av.src = chosen.picture || 'icons/avatar-default.svg';
    const name = document.createElement('div');
    name.className = 'acct-name';
    name.textContent = chosen.name || shortNpub(chosen.npub);
    const np = document.createElement('div');
    np.className = 'acct-np';
    np.textContent = shortNpub(chosen.npub);
    const meta = document.createElement('div');
    meta.className = 'acct-meta';
    meta.append(name, np);
    const cap = document.createElement('div');
    cap.className = 'acct-capsule';
    cap.append(av, meta);
    els.account.append(label, cap);

    els.switchMenu.innerHTML = '';
    els.switchMenu.classList.add('hidden');
    const canSwitch = !isPayment && Array.isArray(data.otherAccounts) && data.otherAccounts.length > 0;
    if (!canSwitch) {
      els.switchToggle.classList.add('hidden');
      return;
    }
    els.switchToggle.classList.remove('hidden');
    els.switchToggle.onclick = () => {
      if (els.switchMenu.classList.contains('hidden')) {
        buildSwitchMenu(list, chosen.pubkey);
        els.switchMenu.classList.remove('hidden');
      } else {
        els.switchMenu.classList.add('hidden');
      }
    };
  }

  function buildSwitchMenu(list, chosenPk) {
    els.switchMenu.innerHTML = '';
    list.forEach((a) => {
      const isChosen = a.pubkey === chosenPk;
      const row = document.createElement('button');
      row.className = 'switch-row' + (isChosen ? ' active' : '');
      const av = document.createElement('img');
      av.className = 'switch-row-av';
      av.referrerPolicy = 'no-referrer';
      av.onerror = () => { av.onerror = null; av.src = 'icons/avatar-default.svg'; };
      av.src = a.picture || 'icons/avatar-default.svg';
      const info = document.createElement('div');
      info.className = 'switch-row-info';
      const name = document.createElement('div');
      name.className = 'switch-row-name';
      name.textContent = a.name || shortNpub(a.npub);
      const np = document.createElement('div');
      np.className = 'switch-row-npub';
      np.textContent = shortNpub(a.npub);
      info.append(name, np);
      row.append(av, info);
      if (isChosen) row.insertAdjacentHTML('beforeend', CHECK_SVG);
      row.addEventListener('click', () => {
        chosenPubkey = a.pubkey;
        els.switchMenu.classList.add('hidden');
        buildAccountCapsule();
      });
      els.switchMenu.append(row);
    });
  }

  async function decide(action) {
    els.error.textContent = '';
    // Unlock first if needed (Allow once / Trust / Pay only).
    if (data.needUnlock && (action === 'once' || action === 'trust')) {
      const pin = els.pin.value;
      if (!pin) {
        els.error.textContent = 'Enter your PIN.';
        return;
      }
      // SIDECAR_UNLOCK contract (see background.js): branch on result.status, not ok.
      const unlocked = await send({ type: 'SIDECAR_UNLOCK', pin });
      const st = unlocked && unlocked.ok && unlocked.result;
      if (!st || st.status !== 'ok') {
        els.error.textContent =
          st && st.status === 'throttled' ? 'Too many attempts. Try again in ' + Math.ceil(st.waitMs / 1000) + 's.'
          : st && st.status === 'bad' ? 'Incorrect PIN — ' + st.remaining + ' attempt' + (st.remaining === 1 ? '' : 's') + ' left before all data is erased.'
          : st && st.status === 'wiped' ? 'Too many attempts — all data on this device was erased.'
          : (unlocked && unlocked.error) || 'Incorrect PIN';
        els.pin.value = '';
        els.pin.focus();
        return;
      }
    }

    let extra = null;
    // Payment + "remember a budget" checked → set an allowance for this site.
    if (isPayment && action === 'once' && els.rememberBudget.checked) {
      const budgetSats = parseInt(els.budgetAmount.value, 10);
      if (!budgetSats || budgetSats < 1) {
        els.error.textContent = 'Enter a budget in sats, or uncheck the box.';
        return;
      }
      action = 'budget';
      extra = { budgetSats, perPaymentSats: 0 };
    }
    // Picked a different account in the switcher (fresh-login prompts only).
    if (chosenPubkey && chosenPubkey !== data.activePubkey) {
      extra = Object.assign({}, extra, { switchToPubkey: chosenPubkey });
    }

    els.allow.disabled = true;
    els.trust.disabled = true;
    els.reject.disabled = true;
    await send({ type: 'SIDECAR_PROMPT_RESULT', id: promptId, action, extra });
    // Background either navigates this window to the next queued request or closes it.
  }

  els.allow.addEventListener('click', () => decide('once'));
  els.trust.addEventListener('click', () => decide('trust'));
  els.reject.addEventListener('click', () => decide('reject'));
  els.pin &&
    els.pin.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') decide('once');
    });

  init();
})();
