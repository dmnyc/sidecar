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
    decryptNote: $('decrypt-note'),
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

  // Whether the one-time multi-account "Heads up!" explainer has been dismissed
  // (shared with the panel via chrome.storage.local).
  let sharedHeadsUpDismissed = false;
  chrome.storage.local.get('sharedHeadsUpDismissed', (r) => {
    sharedHeadsUpDismissed = !!(r && r.sharedHeadsUpDismissed);
  });

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
    62: 'Request to vanish',
    1018: 'Poll response', 1063: 'File metadata', 1068: 'Poll', 1111: 'Comment',
    1222: 'Voice message', 1244: 'Voice message reply', 1311: 'Live chat message',
    1337: 'Code snippet', 1984: 'Report', 1985: 'Label',
    4454: 'DM device key', 4455: 'DM key transfer', 4550: 'Community post approval',
    9041: 'Zap goal', 9321: 'Nutzap', 9734: 'Zap request', 9735: 'Zap receipt', 9802: 'Highlight',
    10000: 'Mute list', 10001: 'Pin list', 10002: 'Relay list', 10003: 'Bookmark list',
    10004: 'Communities list', 10005: 'Public chats list', 10006: 'Blocked relays list',
    10007: 'Search relays list', 10008: 'Profile badges', 10009: 'Groups list',
    10012: 'Favorite relays list', 10015: 'Interests list', 10020: 'Media follows',
    10030: 'Emoji list', 10044: 'DM encryption key', 10050: 'DM relay list',
    10063: 'Blossom server list',
    13194: 'Wallet info', 22242: 'Relay auth', 23194: 'Wallet request', 23195: 'Wallet response',
    24133: 'Remote signing handshake', 24242: 'Blossom authorization', 27235: 'HTTP auth',
    30000: 'Follow set', 30002: 'Relay set', 30003: 'Bookmark set', 30004: 'Curation set',
    30005: 'Video set', 30008: 'Badge set', 30009: 'Badge definition', 30015: 'Interest set',
    30017: 'Marketplace stall', 30018: 'Marketplace product', 30023: 'Long-form article',
    30024: 'Article draft', 30030: 'Emoji set', 30040: 'Publication index',
    30041: 'Publication content', 30078: 'App data', 30311: 'Live event',
    30312: 'Interactive room', 30313: 'Conference event', 30315: 'User status',
    30402: 'Classified listing', 30403: 'Classified listing draft', 30818: 'Wiki article',
    31234: 'Draft event', 31922: 'Calendar event (date)', 31923: 'Calendar event (time)',
    31924: 'Calendar', 31925: 'Calendar RSVP', 31989: 'Handler recommendation',
    31990: 'Handler info', 34235: 'Video (addressable)', 34236: 'Short video (addressable)',
    34550: 'Community definition', 39089: 'Starter pack', 39092: 'Media starter pack',
    39701: 'Web bookmark',
  };
  // Kinds worth a second look before signing: they either move/delete other
  // events, or normally belong to a wallet's own key rather than a NIP-07 site.
  const KIND_WARNINGS = {
    5: 'Deletes other events — make sure you intended this.',
    62: 'Asks relays to delete all of your events — make sure you intended this.',
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

  // The renderable note text for an event: kind:1 → its content; kind 6/16 reposts →
  // the embedded original event's content (a repost's content field is that event's
  // JSON). Falls back to the raw content if it isn't a parseable embedded event.
  function noteTextForEvent(ev) {
    if (ev.kind === 6 || ev.kind === 16) {
      try { const inner = JSON.parse(ev.content); if (inner && typeof inner.content === 'string') return inner.content; } catch (_) {}
    }
    return String(ev.content == null ? '' : ev.content);
  }

  // Popup-local, NO-NETWORK "formatted" render. The side panel uses the composer's
  // real renderer (resolving @names + fetching embeds from relays); the popup has no
  // relay/profile access, so here we only do what's free: inline media, linkify URLs,
  // preserve line breaks, and show mentions/embeds as compact tokens (names and embed
  // cards are NOT resolved — that would mean the signing prompt hitting relays).
  const LN_RE = /(https?:\/\/[^\s]+)|(?:nostr:)?(npub1[0-9a-z]{58}|nprofile1[0-9a-z]{50,}|note1[0-9a-z]{58}|nevent1[0-9a-z]{50,}|naddr1[0-9a-z]{50,})/gi;
  const LN_IMG = /\.(?:jpg|jpeg|png|gif|webp|avif)(?:\?\S*)?$/i;
  const LN_VID = /\.(?:mp4|mov|webm|m3u8)(?:\?\S*)?$/i;
  function renderLightNote(container, text) {
    let last = 0, m;
    LN_RE.lastIndex = 0;
    const flush = (s) => { if (s) container.appendChild(document.createTextNode(s)); };
    while ((m = LN_RE.exec(text)) !== null) {
      if (m.index > last) flush(text.slice(last, m.index));
      if (m[1]) {
        const url = m[1];
        if (LN_IMG.test(url)) {
          const im = document.createElement('img');
          im.className = 'ev-media'; im.referrerPolicy = 'no-referrer'; im.loading = 'lazy'; im.src = url;
          im.onerror = () => im.replaceWith(document.createTextNode(url));
          container.appendChild(im);
        } else if (LN_VID.test(url)) {
          const v = document.createElement('video');
          v.className = 'ev-media'; v.controls = true; v.src = url;
          container.appendChild(v);
        } else {
          const a = document.createElement('a');
          a.href = url; a.target = '_blank'; a.rel = 'noreferrer noopener'; a.textContent = url;
          container.appendChild(a);
        }
      } else if (m[2]) {
        const bech = m[2];
        const span = document.createElement('span');
        if (/^n(?:pub|profile)1/.test(bech)) {
          span.className = 'ev-mention';
          span.textContent = '@' + bech.slice(0, 10) + '…';
        } else {
          span.className = 'ev-ref';
          span.textContent = bech.startsWith('naddr1') ? '[article]' : '[note]';
        }
        container.appendChild(span);
      }
      last = LN_RE.lastIndex;
    }
    flush(text.slice(last));
  }

  // Event-content preview: short by default (keeps the "Signing as" account card in
  // view), expandable, with a Formatted/Raw toggle for note-like kinds (1, and 6/16
  // reposts). "Formatted" is the lightweight render above; "Raw" is the exact signed
  // content. Other kinds show Raw only.
  function appendEventContent(container, ev) {
    const raw = String(ev.content == null ? '' : ev.content);
    const noteLike = ev.kind === 1 || ev.kind === 6 || ev.kind === 16;
    // Views: Formatted (lightweight render, note-like only), Raw (the content string),
    // JSON (the whole event pretty-printed — exactly what's being signed).
    const eventJson = () => { try { return JSON.stringify(ev, null, 2); } catch (_) { return raw; } };
    const modes = noteLike ? ['formatted', 'raw', 'json'] : ['raw', 'json'];
    const LABEL = { formatted: 'Formatted', raw: 'Raw', json: 'JSON' };
    let mode = modes[0];
    let expanded = false;

    const view = document.createElement('div');
    const paintView = () => {
      view.className = 'evpreview' + (expanded ? '' : ' clamped') + (mode === 'formatted' ? '' : ' mono');
      view.innerHTML = '';
      if (mode === 'formatted') renderLightNote(view, noteTextForEvent(ev));
      else if (mode === 'json') view.textContent = eventJson();
      else view.textContent = raw;
    };
    paintView();
    container.appendChild(view);

    const controls = document.createElement('div');
    controls.className = 'evpreview-controls';

    // Mode buttons (Formatted / Raw / JSON) — the active one is highlighted.
    const modeRow = document.createElement('div');
    modeRow.className = 'evpreview-modes';
    const btns = {};
    const syncModes = () => { for (const md of modes) btns[md].classList.toggle('active', md === mode); };
    for (const md of modes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'evpreview-mode';
      b.textContent = LABEL[md];
      b.addEventListener('click', () => {
        if (mode === md) return;
        mode = md; paintView(); syncModes();
      });
      btns[md] = b;
      modeRow.appendChild(b);
    }
    syncModes();
    controls.appendChild(modeRow);

    // Show more/less — always available on every mode; toggles the clamp so the
    // preview stays compact (keeping the account card in view) but can expand.
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'evpreview-toggle';
    more.textContent = 'Show more';
    more.addEventListener('click', () => {
      expanded = !expanded;
      view.classList.toggle('clamped', !expanded);
      more.textContent = expanded ? 'Show less' : 'Show more';
    });
    controls.appendChild(more);
    container.appendChild(controls);
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
      if (ev.content) appendEventContent(els.preview, ev);
      els.preview.classList.remove('hidden');
    } else if (data.method === 'nip04.decrypt' || data.method === 'nip44.decrypt') {
      els.preview.innerHTML = row('From', peerLabel());
      els.preview.classList.remove('hidden');
    } else if (data.method === 'nip04.encrypt' || data.method === 'nip44.encrypt') {
      els.preview.innerHTML = row('To', peerLabel());
      els.preview.classList.remove('hidden');
    }
  }

  // The encrypt/decrypt counterparty as a recognizable npub (translated by the
  // background), truncated like the account capsule; falls back to the raw hex.
  function peerLabel() {
    if (data.peerNpub) return shortNpub(data.peerNpub);
    return (data.params && data.params.pubkey) || '—';
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
      // The request is already purged from the background queue, so routing Close
      // through decide('reject') — the reject button's normal binding — is a no-op:
      // the background has nothing to settle for this id and never closes the window.
      // Swap in a fresh node (cloneNode drops the old listener) and close directly.
      const close = els.reject.cloneNode(true);
      close.textContent = 'Close';
      els.reject.replaceWith(close);
      els.reject = close;
      els.reject.addEventListener('click', () => window.close());
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

    // Decrypt-burst note: a client loading a DM inbox fires many decrypt requests
    // at once. Allowing covers that whole burst and briefly lets this site keep
    // decrypting, so the signer isn't hammered with one prompt per message — be
    // upfront that "Allow" here is broader than a single message.
    if (data.method === 'nip04.decrypt' || data.method === 'nip44.decrypt') {
      els.decryptNote.textContent =
        'Allowing lets ' + data.host + ' decrypt your messages for about a minute — enough to load a conversation or inbox without asking for each one.';
      els.decryptNote.classList.remove('hidden');
    }

    // Shared-identity confirm: this host is signed in with more than one of your
    // accounts, so make the "who's posting" choice explicit and relabel the
    // switcher for the signing (not login) context. This confirms on EVERY
    // content sign to a shared host, not just a detected mismatch — the client's
    // own switcher can flip identities with zero signal to Sidecar, so "Trust
    // this site" can't skip it here (the same signature that's fine now could be
    // wrong next time), and showing it anyway would over-promise.
    renderSharedNote(data);

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

  // Shared-identity confirm: this host is signed in with more than one of your
  // accounts, so make the "who's posting" choice explicit and relabel the switcher
  // for the signing (not login) context. "Trust this site" is hidden — this
  // confirms on EVERY content sign to a shared host (the client's own switcher can
  // flip identities with zero signal to Sidecar), so trust can't skip it. The first
  // such confirm shows a one-time "Heads up!" explainer; later ones show a compact
  // "Multiple accounts used" caption.
  function renderSharedNote(d) {
    const prev = $('shared-note-box');
    if (prev) prev.remove();
    if (!d.sharedIdentity) return;
    els.switchToggle.textContent = 'Sign as a different account';
    els.trust.classList.add('hidden');
    let note;
    if (sharedHeadsUpDismissed) {
      note = document.createElement('div');
      note.id = 'shared-note-box';
      note.className = 'shared-caption';
      note.textContent = 'Multiple accounts used';
    } else {
      note = document.createElement('div');
      note.id = 'shared-note-box';
      note.className = 'shared-headsup';
      const title = document.createElement('div');
      title.className = 'shared-headsup-title';
      title.textContent = 'Heads up!';
      const body = document.createElement('p');
      body.className = 'shared-headsup-body';
      body.textContent =
        "You're signed in here with more than one account. A client's own account switcher can't tell Sidecar which one you picked, so confirm who's posting each time.";
      const got = document.createElement('button');
      got.className = 'shared-headsup-btn';
      got.textContent = 'Got it';
      got.addEventListener('click', () => {
        sharedHeadsUpDismissed = true;
        chrome.storage.local.set({ sharedHeadsUpDismissed: true });
        renderSharedNote(d);
      });
      note.append(title, body, got);
    }
    els.account.parentNode.insertBefore(note, els.account);
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
