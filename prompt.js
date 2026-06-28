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

  function fmtSats(n) {
    return Number(n).toLocaleString('en-US');
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
      rows.push(row('Kind', String(ev.kind ?? '—')));
      if (Array.isArray(ev.tags)) rows.push(row('Tags', String(ev.tags.length)));
      els.preview.innerHTML = rows.join('');
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

  // Account capsule (pfp + name + npub), matching the side panel's account card.
  function buildAccountCapsule() {
    els.account.innerHTML = '';
    const label = document.createElement('div');
    label.className = 'as-label';
    label.textContent = isPayment ? 'Paying from' : 'Signing as';
    const av = document.createElement('img');
    av.className = 'acct-av';
    av.referrerPolicy = 'no-referrer';
    av.onerror = () => { av.onerror = null; av.src = 'icons/avatar-default.svg'; };
    av.src = data.accountPicture || 'icons/avatar-default.svg';
    const name = document.createElement('div');
    name.className = 'acct-name';
    name.textContent = data.accountName || shortNpub(data.npub);
    const np = document.createElement('div');
    np.className = 'acct-np';
    np.textContent = shortNpub(data.npub);
    const meta = document.createElement('div');
    meta.className = 'acct-meta';
    meta.append(name, np);
    const cap = document.createElement('div');
    cap.className = 'acct-capsule';
    cap.append(av, meta);
    els.account.append(label, cap);
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
      const unlocked = await send({ type: 'SIDECAR_UNLOCK', pin });
      if (!unlocked || !unlocked.ok) {
        els.error.textContent = (unlocked && unlocked.error) || 'Incorrect PIN';
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
