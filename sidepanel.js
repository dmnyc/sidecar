// Sidecar side panel — account manager / lock UI for the NIP-07 signer.
// All key material lives in the service worker; this panel only sends control messages.

(function () {
  'use strict';

  const NT = window.NostrTools;

  // Default "max per zap" (sats) for the auto-approve-zaps setting, used wherever
  // a stored value is missing or invalid.
  const AUTOZAP_DEFAULT_MAX = 100;

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
    'arrow-down': '<line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline>',
    'arrow-up': '<line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline>',
    'chevron-down': '<polyline points="6 9 12 15 18 9"></polyline>',
    'arrow-up-right': '<line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline>',
    'arrow-down-left': '<line x1="17" y1="7" x2="7" y2="17"></line><polyline points="17 17 7 17 7 7"></polyline>',
    refresh: '<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>',
    'eye-off': '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>',
    pin: '<path d="M12 17v5"></path><path d="M9 10.76V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6.76a2 2 0 0 0 .59 1.42l1.12 1.12A2 2 0 0 1 18 14.59V16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-1.41a2 2 0 0 1 .29-1.29l1.12-1.12A2 2 0 0 0 9 10.76Z"></path>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>',
  };
  function icon(name) {
    const wrap = document.createElement('span');
    wrap.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[name] || '') +
      '</svg>';
    return wrap.firstElementChild;
  }

  // Filled lightning bolt (from wordswithzaps' bolt-yellow.svg). Inherits color
  // via currentColor; sized inline with text by the .bolt-ico class.
  function boltIcon(cls) {
    const wrap = document.createElement('span');
    wrap.innerHTML =
      '<svg class="bolt-ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 55 94" fill="currentColor">' +
      '<path d="M35.563 0V40.406H54.969L21.016 93.75V51.719H0L35.563 0Z"></path></svg>';
    return wrap.firstElementChild;
  }

  // ---- PIN / passphrase strength + confirmation UI ----
  // The keystore is encrypted at rest under a key derived from this secret, so its
  // length is the practical floor on that protection. Require a non-trivial minimum
  // and give live feedback: a green check appears in the first box once it's long
  // enough, and a second green check (or a red x on mismatch) as the confirmation
  // is typed. The proceed button stays disabled until both are satisfied.
  const MIN_PIN_LEN = 8;
  const MAX_PIN_LEN = 32;

  function pinMeetsLength(v) {
    return v.length >= MIN_PIN_LEN && v.length <= MAX_PIN_LEN;
  }

  function setPinIndicator(ind, state) {
    ind.classList.remove('ok', 'bad');
    ind.textContent = '';
    if (state === 'ok') { ind.classList.add('ok'); ind.appendChild(icon('check')); }
    else if (state === 'bad') { ind.classList.add('bad'); ind.appendChild(icon('x')); }
  }

  // Wrap a password <input> so a check/x indicator can sit at its right edge.
  // Works whether the input is already in the DOM or still detached (in which case
  // the caller appends the returned wrapper). Returns the indicator element.
  function addPinIndicator(input) {
    const wrap = document.createElement('div');
    wrap.className = 'pin-field';
    if (input.parentNode) input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const ind = document.createElement('span');
    ind.className = 'pin-indicator';
    ind.setAttribute('aria-hidden', 'true');
    wrap.appendChild(ind);
    return ind;
  }

  // Live-validate a create/confirm PIN pair and gate a submit button. Call after
  // both inputs are in the DOM. Returns validate(), which also reports validity.
  // The green check on the confirm box shows the instant it matches; the red x is
  // held back until the user pauses typing (MISMATCH_DELAY), so it doesn't flash
  // red while a matching value is still being entered.
  const PIN_MISMATCH_DELAY = 700; // ms of idle before flagging a mismatch
  function attachPinValidation(pinInput, confirmInput, submitBtn) {
    const pinInd = addPinIndicator(pinInput);
    const confInd = confirmInput ? addPinIndicator(confirmInput) : null;
    let mismatchTimer = null;
    const clearMismatchTimer = () => { if (mismatchTimer) { clearTimeout(mismatchTimer); mismatchTimer = null; } };
    function validate() {
      const pinOk = pinMeetsLength(pinInput.value);
      setPinIndicator(pinInd, pinOk ? 'ok' : null);
      let ready = pinOk;
      if (confInd) {
        const cv = confirmInput.value;
        clearMismatchTimer();
        if (!cv) {
          setPinIndicator(confInd, null);            // nothing typed yet
        } else if (cv === pinInput.value) {
          setPinIndicator(confInd, pinOk ? 'ok' : null); // contents match; green once the PIN is long enough
        } else {
          // Genuine mismatch — defer the red so it doesn't appear mid-keystroke.
          setPinIndicator(confInd, null);
          mismatchTimer = setTimeout(() => {
            if (confirmInput.value && confirmInput.value !== pinInput.value) setPinIndicator(confInd, 'bad');
          }, PIN_MISMATCH_DELAY);
        }
        ready = pinOk && cv.length > 0 && cv === pinInput.value;
      }
      if (submitBtn) submitBtn.disabled = !ready;
      return ready;
    }
    pinInput.addEventListener('input', validate);
    if (confirmInput) confirmInput.addEventListener('input', validate);
    validate();
    return validate;
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

  // ---- nsec paste guard ----
  // A secret key should only ever land in the key-import field. Block a paste of
  // an nsec anywhere else in the panel (note composer, PIN, wallet send, profile
  // fields, …) so it can't be leaked into the wrong box by a slip of the cursor.
  const NSEC_RE = /nsec1[a-z0-9]{20,}/i;
  document.addEventListener(
    'paste',
    (e) => {
      let text = '';
      try {
        text = ((e.clipboardData || window.clipboardData) || {}).getData('text') || '';
      } catch (_) {}
      if (!NSEC_RE.test(text)) return;
      const t = e.target;
      if (t && t.closest && t.closest('.nsec-field')) return; // the one allowed home
      e.preventDefault();
      e.stopPropagation();
      toast('That looks like a secret key. For safety, paste your nsec only into the key import field.', 'error');
    },
    true
  );

  let state = null;
  let hideBalances = false;
  let _firstPostSeenPubkeys = null;
  let balanceCache = { pubkey: null, sats: null }; // last known balance for instant display
  const _notifCache = new Map(); // pubkey → { events: Event[], liveSub: Closeable|null }
  const _notifProfiles = new Map(); // sender pubkey → display name string
  const _muteLists = new Map(); // pubkey → Set<pubkey> (resolved mute set)
  const _muteListPromises = new Map(); // pubkey → Promise<Set> (dedupe in-flight loads)
  const _ownNoteIds = new Map(); // pubkey → Set<eventId> (this account's own recent kind:1 ids)
  const _ownNoteIdsPromises = new Map(); // pubkey → Promise<Set> (dedupe in-flight loads)
  let _notifSeenAt = {}; // pubkey → unix timestamp, persisted to chrome.storage.local
  let _notifSeenLoaded = false;
  let _postBannerTimer = null; // auto-dismiss for #post-banner

  // Privacy masking is done in CSS (-webkit-text-security on `.balances-hidden`),
  // which masks each glyph at its real width so toggling never reflows. We always
  // render the true value; this helper just toggles the container class.
  function applyHideBalances() {
    const main = document.getElementById('view-main');
    if (main) main.classList.toggle('balances-hidden', hideBalances);
  }

  // Collapse the balance card into a slim sticky header as the wallet content
  // scrolls (mirrors zap.cooking). We watch a tiny sentinel placed *above* the
  // card with an IntersectionObserver rather than reading scrollTop: collapsing
  // the card resizes the layout, and a scrollTop threshold would feed that change
  // back into itself and flip the state every frame. The sentinel sits above the
  // card, so the card's resize never moves it — no feedback loop, no flicker.
  let walletCardObserver = null;
  function observeWalletCard(card, sentinel, spacer) {
    if (walletCardObserver) { walletCardObserver.disconnect(); walletCardObserver = null; }
    const root = document.querySelector('.content');
    if (!root || !('IntersectionObserver' in window)) return;
    // Defer until the card has laid out so we can measure its collapse delta.
    requestAnimationFrame(() => {
      // How much height the card loses when collapsed. A bottom spacer grows by
      // exactly this amount while compact, so collapsing never changes the total
      // scroll height. Without it, collapsing shrinks the document, the scroll
      // clamps at the bottom, the sentinel re-enters view, and it flickers —
      // worst on a short page like a wallet with no transactions.
      card.classList.remove('compact');
      const expandedH = card.offsetHeight;
      card.classList.add('compact');
      const compactH = card.offsetHeight;
      card.classList.remove('compact');
      const delta = Math.max(0, expandedH - compactH);
      walletCardObserver = new IntersectionObserver(
        (entries) => {
          const compact = !entries[0].isIntersecting;
          card.classList.toggle('compact', compact);
          if (spacer) spacer.style.height = compact ? delta + 'px' : '0px';
        },
        { root, rootMargin: '48px 0px 0px 0px', threshold: 0 }
      );
      walletCardObserver.observe(sentinel);
    });
  }

  // Background broadcasts (e.g. a WebLN payment paid via the service worker
  // while the panel is open) — refresh the wallet if it's the visible tab.
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'SIDECAR_EVENT') return;
    if (msg.event === 'walletChanged' && state && !state.locked) {
      const active = document.querySelector('.tab.active');
      if (active && active.dataset.tab === 'wallet') renderWallet();
    }
  });

  // ---- top-level routing ----
  async function refresh() {
    // A pending signing approval is modal — it stays put until the user decides,
    // so don't let an incidental refresh navigate away from it.
    if (pendingApproval) {
      closeModal();
      showApproval();
      return;
    }
    state = await call({ type: 'SIDECAR_GET_STATE' });
    const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
    hideBalances = !!(settings && settings.hideBalances);
    applyHideBalances();
    closeAcctMenu();
    [$('view-onboarding'), $('view-lock'), $('view-main'), $('view-settings'), $('view-profile-edit'), $('view-approval')].forEach(hide);
    if (!state.initialized) {
      // Clear any stale PIN left in the inputs (e.g. after a reset) — the panel is
      // an SPA, so values would otherwise persist across the view switch.
      $('ob-pin').value = '';
      $('ob-pin2').value = '';
      $('ob-error').textContent = '';
      show($('view-onboarding'));
      setTimeout(() => $('ob-pin').focus(), 50);
    } else if (state.locked) {
      if (nwc) { try { nwc.close(); } catch (_) {} nwc = null; nwcPubkey = null; }
      balanceCache = { pubkey: null, sats: null };
      show($('view-lock'));
      setTimeout(() => $('unlock-pin').focus(), 50);
    } else {
      show($('view-main'));
      dismissPostBanner(); // a note link is account-specific; clear on any state change
      renderMain();
      initNotifSubs();
      // Re-render the visible tab so account-scoped views (Activity/Profile) follow the switch.
      const activeTab = document.querySelector('.tab.active');
      const name = activeTab && activeTab.dataset.tab;
      if (name === 'activity') renderActivity();
      else if (name === 'profile') renderProfile();
      else if (name === 'wallet') renderWallet();
    }
  }


  // ---- onboarding ----
  attachPinValidation($('ob-pin'), $('ob-pin2'), $('ob-submit'));
  $('onboarding-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('ob-error');
    err.textContent = '';
    const pin = $('ob-pin').value;
    const pin2 = $('ob-pin2').value;
    if (pin.length < MIN_PIN_LEN) return (err.textContent = `Use at least ${MIN_PIN_LEN} characters.`);
    if (pin.length > MAX_PIN_LEN) return (err.textContent = `Use at most ${MAX_PIN_LEN} characters.`);
    if (pin !== pin2) return (err.textContent = 'PINs do not match.');
    try {
      await call({ type: 'SIDECAR_INIT', pin });
      await refresh();
      toast('Keystore created', 'success');
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

  $('compose-fab').addEventListener('click', () => {
    const balloon = $('first-post-balloon');
    const isFirstTime = balloon && !balloon.classList.contains('hidden') && state?.activePubkey;
    if (isFirstTime) {
      _firstPostSeenPubkeys = _firstPostSeenPubkeys || new Set();
      _firstPostSeenPubkeys.add(state.activePubkey);
      chrome.storage.local.set({ firstPostTipSeenPubkeys: [..._firstPostSeenPubkeys] });
      balloon.classList.add('hidden');
      openComposer('Just setting up my #Sidecar 🍸');
    } else {
      openComposer();
    }
  });

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

  // ---- notification bell (topbar) ----
  $('notif-bell-btn').addEventListener('click', () => {
    if (!state?.activePubkey) return;
    const a = state.accounts.find((acc) => acc.pubkey === state.activePubkey);
    if (a) showNotifModal(a);
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
      else if (name === 'wallet') renderWallet();
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

  // Derive the public key (hex) from a pasted nsec/hex secret, locally, so the
  // import modal can preview which account it belongs to before saving. The raw
  // secret is already in the panel's input; this only computes the public half.
  // Returns '' for anything that isn't a valid secret yet.
  function pubkeyFromSecret(secret) {
    try {
      let sk = null;
      if (/^nsec1/i.test(secret)) {
        const d = NT.nip19.decode(secret);
        if (d.type !== 'nsec') return '';
        sk = d.data; // Uint8Array
      } else if (/^[0-9a-f]{64}$/i.test(secret)) {
        sk = new Uint8Array(32);
        for (let i = 0; i < 32; i++) sk[i] = parseInt(secret.substr(i * 2, 2), 16);
      } else {
        return '';
      }
      return NT.getPublicKey(sk) || '';
    } catch (_) {
      return '';
    }
  }

  // Fetch just name + picture from kind 0 for a preview (without storing it).
  async function fetchPreviewProfile(pubkey) {
    try {
      const relays = await relayUrls(false);
      if (!relays.length) return null;
      const ev = await Promise.race([
        poolGet(relays, { kinds: [0], authors: [pubkey] }),
        new Promise((r) => setTimeout(() => r(null), 6000)),
      ]);
      if (!ev) return null;
      const m = JSON.parse(ev.content) || {};
      return { name: m.display_name || m.displayName || m.name || '', picture: m.picture || '' };
    } catch (_) {
      return null;
    }
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

  async function publishToRelays(relays, signed) {
    if (!relays.length) throw new Error('No relays configured (add some in Settings)');
    const results = await Promise.allSettled(getPool().publish(relays, signed));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    if (!ok) {
      const detail = results.map((r, i) => `${relays[i]}: ${r.reason?.message || r.reason || 'rejected'}`).join(' | ');
      throw new Error(`Could not publish to any relay — ${detail}`);
    }
    return ok;
  }

  // Publish an already-signed event to the account's write relays (NIP-65 → configured).
  async function publishSigned(signed) {
    return publishToRelays(await postRelays(), signed);
  }

  // Build and publish a NIP-65 (kind:10002) relay list from the editor's model:
  // [{ url, read, write }]. A relay with both markers gets a plain ['r', url]
  // tag (per spec, no marker = both); otherwise the single applicable marker.
  // Relays with neither checked are dropped instead of leaking a stray marker.
  async function publishNip65(pubkey, relayList) {
    const active = relayList.filter((r) => r.read || r.write);
    const tags = active.map((r) => {
      if (r.read && r.write) return ['r', r.url];
      return r.write ? ['r', r.url, 'write'] : ['r', r.url, 'read'];
    });
    const event = { kind: 10002, created_at: Math.floor(Date.now() / 1000), tags, content: '' };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event });

    // Publish to the union of: relays that already carry the account's prior
    // list (so anyone relying on it still sees the update), the relays now
    // marked write in the NEW list (so it lands where the account claims to
    // write), and the app's configured relays as a safety net.
    const prior = nip65Cache.get(pubkey);
    const newWrite = active.filter((r) => r.write).map((r) => r.url);
    const fallback = await relayUrls(true);
    const targets = [...new Set([...(prior ? prior.write : []), ...newWrite, ...fallback])];
    const ok = await publishToRelays(targets, signed);
    nip65Cache.delete(pubkey); // invalidate so getNip65()/postRelays() refetch fresh
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

  // ---- notification bell ----

  async function loadNotifSeen() {
    if (_notifSeenLoaded) return;
    _notifSeenLoaded = true;
    try {
      const r = await new Promise((res) => chrome.storage.local.get('sidecar_notif_seen', res));
      _notifSeenAt = (r && r.sidecar_notif_seen) || {};
    } catch (_) {}
  }

  async function saveNotifSeen(pubkey, ts) {
    _notifSeenAt[pubkey] = ts;
    try {
      await new Promise((res) =>
        chrome.storage.local.set({ sidecar_notif_seen: _notifSeenAt }, res)
      );
    } catch (_) {}
  }

  function notifUnseenCount(pubkey) {
    const cache = _notifCache.get(pubkey);
    if (!cache || !cache.events.length) return 0;
    const seenAt = _notifSeenAt[pubkey] || 0;
    return cache.events.filter((ev) => ev.created_at > seenAt).length;
  }

  function refreshBell() {
    const btn = $('notif-bell-btn');
    if (!btn) return;
    const pubkey = state?.activePubkey;
    const count = pubkey ? notifUnseenCount(pubkey) : 0;
    const badge = btn.querySelector('.notif-badge');
    if (!badge) return;
    badge.textContent = count > 99 ? '99+' : count > 0 ? String(count) : '';
    badge.classList.toggle('hidden', count === 0);
  }

  function relativeTime(ts) {
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 7 * 86400) return Math.floor(diff / 86400) + 'd ago';
    return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function notifLabel(ev) {
    if (ev.kind === 9735) {
      let sats = '';
      try {
        const descTag = ev.tags.find((t) => t[0] === 'description');
        if (descTag) {
          const inner = JSON.parse(descTag[1]);
          const amtTag = inner.tags && inner.tags.find((t) => t[0] === 'amount');
          if (amtTag) sats = Math.round(parseInt(amtTag[1], 10) / 1000) + ' sats';
        }
      } catch (_) {}
      return { glyph: '⚡', text: sats ? 'zapped ' + sats : 'zapped you' };
    }
    if (ev.kind === 6) return { glyph: '🔁', text: 'reposted your note' };
    if (ev.kind === 7) {
      const r = (ev.content || '').trim();
      const glyph = r === '+' ? '❤️' : r === '-' ? '👎' : r.length <= 4 && r ? r : '❤️';
      return { glyph, text: 'reacted to your note' };
    }
    // kind 1
    const hasQ = ev.tags.some((t) => t[0] === 'q' && t[1]); // NIP-18 quote repost
    if (hasQ) return { glyph: '🗨️', text: 'quoted your note' };
    const hasE = ev.tags.some((t) => t[0] === 'e');
    return hasE
      ? { glyph: '💬', text: 'replied to your note' }
      : { glyph: '@', text: 'mentioned you' };
  }

  // The actual zapper for a kind:9735 receipt — the receipt's own pubkey is the
  // LNURL zap service, not the person. Prefer the `P` tag, then the embedded zap
  // request's pubkey; fall back to the receipt pubkey. For non-zaps, just the author.
  function zapSender(ev) {
    if (ev.kind !== 9735) return ev.pubkey;
    const P = ev.tags.find((t) => t[0] === 'P' && t[1]);
    if (P) return P[1];
    const desc = ev.tags.find((t) => t[0] === 'description');
    if (desc) {
      try { const r = JSON.parse(desc[1]); if (r && r.pubkey) return r.pubkey; } catch (_) {}
    }
    return ev.pubkey;
  }

  // Resolve where a notification should open, as a full client URL — always
  // something the client can actually render. A reply/mention opens the note
  // itself; a reaction/repost/zap opens the note (or article) it refers to.
  // Crucially, a *profile* zap (no e/a tag — zapping a person, not a note) opens
  // a PROFILE rather than the kind:9735 receipt, which clients like Jumble show
  // as "note not found". For zaps we also read the embedded zap request, since
  // the e/a/p tags and the zapper live there. Returns '' when there's no sensible
  // target (card just isn't clickable then).
  function notifLink(ev, client, acctPubkey) {
    try {
      // kind 1 (reply/mention) → the note itself.
      if (ev.kind === 1) {
        return client.url(NT.nip19.neventEncode({ id: ev.id, author: ev.pubkey, relays: [] }));
      }

      let tags = ev.tags;
      let zapper = '';
      if (ev.kind === 9735) {
        zapper = zapSender(ev);
        const descTag = ev.tags.find((t) => t[0] === 'description');
        if (descTag) {
          try {
            const req = JSON.parse(descTag[1]);
            if (req && Array.isArray(req.tags)) tags = ev.tags.concat(req.tags);
          } catch (_) {}
        }
      }

      // A referenced note (reacted/reposted/zapped note, or reply target).
      const eTag = tags.filter((t) => t[0] === 'e' && t[1]).pop();
      if (eTag) {
        const pTag = tags.find((t) => t[0] === 'p' && t[1]); // note author = recipient
        return client.url(NT.nip19.neventEncode({ id: eTag[1], author: pTag ? pTag[1] : acctPubkey, relays: [] }));
      }

      // A referenced addressable event (e.g. a long-form article).
      const aTag = tags.filter((t) => t[0] === 'a' && t[1]).pop();
      if (aTag) {
        const parts = aTag[1].split(':');
        const kind = parseInt(parts[0], 10);
        if (parts[1] && !Number.isNaN(kind)) {
          return client.url(NT.nip19.naddrEncode({ kind, pubkey: parts[1], identifier: parts[2] || '', relays: [] }));
        }
      }

      // No note/article — a profile zap. Open a profile (renders everywhere):
      // the zapper if we know them, else the recipient.
      if (ev.kind === 9735) {
        const recipient = (tags.find((t) => t[0] === 'p' && t[1]) || [])[1];
        const who = zapper || recipient || acctPubkey;
        if (who) return client.profile(NT.nip19.npubEncode(who));
      }
    } catch (_) {}
    return '';
  }

  function notifAuthorName(pubkey) {
    const cached = _notifProfiles.get(pubkey);
    if (typeof cached === 'string' && cached) return cached;
    try { return NT.nip19.npubEncode(pubkey).slice(0, 12) + '…'; } catch (_) { return pubkey.slice(0, 8) + '…'; }
  }

  function prefetchNotifProfile(pubkey, relays) {
    if (_notifProfiles.has(pubkey)) return;
    _notifProfiles.set(pubkey, ''); // mark as loading
    poolGet(relays, { kinds: [0], authors: [pubkey] }).then((ev) => {
      if (!ev) return;
      const m = JSON.parse(ev.content) || {};
      _notifProfiles.set(pubkey, m.display_name || m.displayName || m.name || '');
    }).catch(() => {});
  }

  const IMG_RE = /https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|avif)(?:\?\S*)?/gi;
  const AV_RE = /https?:\/\/\S+\.(?:mp4|mov|webm|m3u8|mp3|wav|m4a|ogg)(?:\?\S*)?/gi;

  // Pull media URLs out of note content so they can render as previews instead
  // of as raw links in the text snippet.
  function extractMedia(content) {
    const images = content.match(IMG_RE) || [];
    const av = content.match(AV_RE) || [];
    return { images, av };
  }

  function cleanSnippet(content) {
    return content
      .replace(/nostr:(npub1\S+|nprofile1\S+)/g, (_, entity) => {
        try {
          const decoded = NT.nip19.decode(entity);
          const pk = decoded.type === 'npub' ? decoded.data : decoded.data && decoded.data.pubkey;
          if (pk) {
            const name = _notifProfiles.get(pk);
            if (name) return '@' + name;
            return '@' + entity.slice(0, 12) + '…';
          }
        } catch (_) {}
        return '@…';
      })
      .replace(/nostr:note1\S+/g, '[note]')
      .replace(/nostr:nevent1\S+/g, '[note]')
      .replace(/nostr:naddr1\S+/g, '[article]')
      .replace(IMG_RE, '') // shown as thumbnails
      .replace(AV_RE, '') // shown as a media chip
      .replace(/https?:\/\/([^\s/]+)\S*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Load an account's mute list (kind 10000) — newest replaceable event across
  // relays, including both public p-tag mutes and private mutes encrypted in the
  // content. Private mutes may be NIP-04 (legacy NIP-51) or NIP-44 (newer clients
  // like Jumble) encrypted to self — try the format the ciphertext looks like,
  // then fall back to the other. Deduped per pubkey via a promise cache; when it
  // resolves it also drops any already-cached events from muted authors.
  function loadMuteList(pubkey, relays) {
    if (_muteListPromises.has(pubkey)) return _muteListPromises.get(pubkey);
    const p = (async () => {
      const muted = new Set();
      try {
        const evs = await getPool().querySync(relays, { kinds: [10000], authors: [pubkey] });
        const ev = (evs || []).sort((x, y) => y.created_at - x.created_at)[0];
        if (ev) {
          ev.tags.filter((t) => t[0] === 'p' && t[1]).forEach((t) => muted.add(t[1]));
          if (ev.content) {
            // NIP-04 ciphertext is "<base64>?iv=<base64>"; NIP-44 is a single
            // base64 blob. Try the matching scheme first, then the other.
            const order = ev.content.includes('?iv=') ? [4, 44] : [44, 4];
            for (const nip of order) {
              try {
                const plain = await call({ type: 'SIDECAR_OWNER_DECRYPT', ciphertext: ev.content, nip });
                const privateTags = JSON.parse(plain);
                if (Array.isArray(privateTags)) {
                  privateTags.filter((t) => t[0] === 'p' && t[1]).forEach((t) => muted.add(t[1]));
                  break;
                }
              } catch (_) {}
            }
          }
        }
      } catch (_) {}
      _muteLists.set(pubkey, muted);
      // Drop any events that slipped into the cache before the list was ready.
      const cache = _notifCache.get(pubkey);
      if (cache && muted.size) {
        const before = cache.events.length;
        cache.events = cache.events.filter((e) => !muted.has(e.pubkey));
        if (cache.events.length !== before && pubkey === state?.activePubkey) refreshBell();
      }
      return muted;
    })();
    _muteListPromises.set(pubkey, p);
    return p;
  }

  // The account's most recent kind:1 note ids (not bounded by the notification
  // backfill window — a repost/quote happening now can reference a much older
  // note). Reposts (kind:6) and NIP-18 quote reposts (kind:1 with a `q` tag)
  // reference the original note by id via an `e`/`q` tag — a `p` tag naming the
  // author is only a convention, not required, so some clients omit it. Knowing
  // our own note ids lets the subscription match on the `e`/`q` tag directly and
  // catch those reposts/quotes even when the author isn't tagged.
  function loadOwnNoteIds(pubkey, relays) {
    if (_ownNoteIdsPromises.has(pubkey)) return _ownNoteIdsPromises.get(pubkey);
    const p = (async () => {
      const ids = new Set();
      try {
        const evs = await getPool().querySync(relays, { kinds: [1], authors: [pubkey], limit: 150 });
        (evs || [])
          .sort((x, y) => y.created_at - x.created_at)
          .slice(0, 150)
          .forEach((e) => ids.add(e.id));
      } catch (_) {}
      _ownNoteIds.set(pubkey, ids);
      return ids;
    })();
    _ownNoteIdsPromises.set(pubkey, p);
    return p;
  }

  async function initNotifSubs() {
    if (!state || !state.accounts || state.accounts.length === 0) return;
    await loadNotifSeen();
    const relays = await relayUrls(false);
    if (!relays.length) return;
    const since = Math.floor(Date.now() / 1000) - 7 * 24 * 3600; // notification backfill window

    for (const a of state.accounts) {
      if (_notifCache.has(a.pubkey)) continue;

      // Load mutes and own note ids BEFORE subscribing so addEvent filters from
      // the first event and the repost/quote filters below are ready. Cap the
      // wait so a slow relay can't stall notifications — the fetches keep
      // running and mutes prune the cache once it lands.
      const [, ownIds] = await Promise.all([
        Promise.race([loadMuteList(a.pubkey, relays), new Promise((r) => setTimeout(r, 5000))]),
        Promise.race([loadOwnNoteIds(a.pubkey, relays), new Promise((r) => setTimeout(() => r(new Set()), 5000))]),
      ]);

      const cache = { events: [], liveSub: null };
      _notifCache.set(a.pubkey, cache);

      const addEvent = (ev) => {
        if (ev.pubkey === a.pubkey) return;
        const muted = _muteLists.get(a.pubkey);
        if (muted && muted.has(ev.pubkey)) return;
        if (cache.events.some((e) => e.id === ev.id)) return;
        cache.events.push(ev);
        cache.events.sort((x, y) => y.created_at - x.created_at);
        if (cache.events.length > 100) cache.events.length = 100;
        prefetchNotifProfile(ev.pubkey, relays);
        if (a.pubkey === state?.activePubkey) refreshBell();
      };

      // Mentions/replies/reactions/zaps tagging the account, plus reposts
      // (kind:6, `e` tag) and quote reposts (kind:1, `q` tag) of the account's
      // own notes — matched by id so they're caught even without a `p` tag.
      const ownIdList = [...ownIds];
      function buildFilters(sinceTs, limit) {
        const base = { kinds: [1, 6, 7, 9735], '#p': [a.pubkey], since: sinceTs };
        const list = [limit ? Object.assign({ limit }, base) : base];
        if (ownIdList.length) {
          const repost = { kinds: [6], '#e': ownIdList, since: sinceTs };
          const quote = { kinds: [1], '#q': ownIdList, since: sinceTs };
          list.push(limit ? Object.assign({ limit }, repost) : repost);
          list.push(limit ? Object.assign({ limit }, quote) : quote);
        }
        return list;
      }

      const liveSince = Math.floor(Date.now() / 1000);
      try {
        getPool().subscribeManyEose(relays, buildFilters(since, 50), { onevent: addEvent });
      } catch (_) {}
      try {
        cache.liveSub = getPool().subscribeMany(
          relays,
          buildFilters(liveSince),
          { onevent: addEvent }
        );
      } catch (_) {}
    }
  }

  async function showNotifModal(a) {
    const seenAt = _notifSeenAt[a.pubkey] || 0;
    const cache = _notifCache.get(a.pubkey) || { events: [] };
    const now = Math.floor(Date.now() / 1000);
    await saveNotifSeen(a.pubkey, now);
    refreshBell();

    const client = await preferredClient();
    const relays = await relayUrls(false);

    // Final guard: ensure the mute list has resolved, then filter the view.
    await Promise.race([loadMuteList(a.pubkey, relays), new Promise((r) => setTimeout(r, 3000))]);
    const muted = _muteLists.get(a.pubkey);
    const events = muted && muted.size ? cache.events.filter((e) => !muted.has(e.pubkey)) : cache.events;
    const PAGE = 25;

    // Resolve display names for the senders AND any @-mentions inside note
    // content, so tagged usernames render as names instead of raw npubs.
    const need = new Set();
    events.forEach((e) => {
      need.add(zapSender(e)); // the zapper for zaps, the author otherwise
      if (e.kind === 1 && e.content) {
        const re = /nostr:(npub1[0-9a-z]+|nprofile1[0-9a-z]+)/g;
        let mm;
        while ((mm = re.exec(e.content)) !== null) {
          try {
            const d = NT.nip19.decode(mm[1]);
            const pk = d.type === 'npub' ? d.data : d.data && d.data.pubkey;
            if (pk) need.add(pk);
          } catch (_) {}
        }
      }
    });
    const uncached = [...need].filter((pk) => !_notifProfiles.get(pk));
    uncached.forEach((pk) => prefetchNotifProfile(pk, relays));
    if (uncached.length) await new Promise((r) => setTimeout(r, 700));

    function buildItem(ev) {
      const isNew = ev.created_at > seenAt;
      const { glyph, text } = notifLabel(ev);

      // Where this notification opens (a renderable note/article/profile URL), or
      // '' when there's no sensible target.
      const linkTarget = notifLink(ev, client, a.pubkey);

      // The whole card is the click target — open it in the preferred client.
      const item = linkTarget
        ? h('a', {
            className: 'notif-item notif-clickable' + (isNew ? ' notif-new' : ''),
            href: linkTarget,
            target: '_blank',
            rel: 'noreferrer noopener',
            title: 'Open in ' + client.label,
          })
        : h('div', { className: 'notif-item' + (isNew ? ' notif-new' : '') });

      // Top row: glyph · name (truncated) · time · arrow
      const right = h('div', { className: 'notif-top-right' }, [
        h('span', { className: 'notif-time', textContent: relativeTime(ev.created_at) }),
      ]);
      if (linkTarget) {
        const arrow = h('span', { className: 'notif-link' });
        arrow.appendChild(icon('arrow-up-right'));
        right.appendChild(arrow);
      }
      const topRow = h('div', { className: 'notif-top' }, [
        h('span', { className: 'notif-glyph', textContent: glyph }),
        h('span', { className: 'notif-author', textContent: notifAuthorName(zapSender(ev)) }),
        right,
      ]);
      item.appendChild(topRow);

      // Action row
      item.appendChild(h('div', { className: 'notif-action', textContent: text }));

      if (ev.kind === 1 && ev.content) {
        const cleaned = cleanSnippet(ev.content);
        if (cleaned) {
          const snippet = cleaned.length > 140 ? cleaned.slice(0, 140) + '…' : cleaned;
          item.appendChild(h('p', { className: 'notif-content', textContent: snippet }));
        }

        const { images, av } = extractMedia(ev.content);
        if (images.length) {
          const media = h('div', { className: 'notif-media' });
          images.slice(0, 3).forEach((src) => {
            const img = document.createElement('img');
            img.className = 'notif-thumb';
            img.src = src;
            img.alt = '';
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            img.onerror = () => img.remove();
            media.appendChild(img);
          });
          item.appendChild(media);
        }
        if (av.length) {
          const isVideo = /\.(?:mp4|mov|webm|m3u8)(?:\?|$)/i.test(av[0]);
          item.appendChild(
            h('div', { className: 'notif-media-chip', textContent: (isVideo ? '🎬 ' : '🎵 ') + (isVideo ? 'Video' : 'Audio') })
          );
        }
      }
      return item;
    }

    openModal((modal) => {
      modal.classList.add('modal-sheet');

      const xBtn = h('button', { className: 'modal-x', title: 'Close' });
      xBtn.appendChild(icon('x'));
      xBtn.addEventListener('click', closeModal);
      modal.appendChild(xBtn);

      const heading = h('div', { className: 'notif-modal-head' });
      heading.append(
        avatarEl(a, 'notif-modal-av'),
        h('div', {}, [
          h('div', { className: 'notif-modal-title', textContent: 'Notifications' }),
          h('div', { className: 'notif-modal-sub', textContent: displayName(a) }),
        ])
      );
      modal.appendChild(heading);

      if (!events.length) {
        modal.appendChild(h('p', { className: 'hint', textContent: 'No recent notifications found.' }));
        return;
      }

      const scroll = h('div', { className: 'notif-scroll' });
      const list = h('div', { className: 'notif-list' });
      scroll.appendChild(list);
      modal.appendChild(scroll);

      let shown = 0;
      let moreBtn = null;
      let endNote = null;

      function loadMore() {
        const next = events.slice(shown, shown + PAGE);
        next.forEach((ev) => list.appendChild(buildItem(ev)));
        shown += next.length;
        if (shown >= events.length) {
          if (moreBtn) { moreBtn.remove(); moreBtn = null; }
          if (!endNote) {
            const sub = h('p', { className: 'notif-end-sub' });
            let profileUrl = '';
            try { profileUrl = client.profile(NT.nip19.npubEncode(a.pubkey)); } catch (_) {}
            sub.appendChild(document.createTextNode('Visit '));
            if (profileUrl) {
              const link = document.createElement('a');
              link.className = 'notif-end-link';
              link.href = profileUrl;
              link.target = '_blank';
              link.rel = 'noreferrer noopener';
              link.textContent = client.label;
              sub.appendChild(link);
            } else {
              sub.appendChild(document.createTextNode(client.label));
            }
            sub.appendChild(document.createTextNode(' for more history.'));
            endNote = h('div', { className: 'notif-end' }, [
              h('p', { className: 'notif-end-title', textContent: "You're all caught up." }),
              sub,
            ]);
            scroll.appendChild(endNote);
          }
        } else if (!moreBtn) {
          moreBtn = h('button', { className: 'notif-load-more', textContent: 'Load more' });
          moreBtn.addEventListener('click', loadMore);
          scroll.appendChild(moreBtn);
        }
      }

      loadMore();
    });
  }

  // Sparkle hero shown in the empty (no-account) state — a classy welcome that
  // carries the brand and points at the add buttons below.
  const SPARK_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c.7 6.4 5.6 11.3 12 12-6.4.7-11.3 5.6-12 12-.7-6.4-5.6-11.3-12-12C6.4 11.3 11.3 6.4 12 0Z"/></svg>';
  function buildWelcome() {
    const wrap = h('div', { className: 'welcome' });
    const sparks = h('div', { className: 'welcome-sparks' });
    ['s1', 's2', 's3', 's4', 's5'].forEach((c) => {
      const sp = document.createElement('span');
      sp.className = 'spark ' + c;
      sp.innerHTML = SPARK_SVG;
      sparks.append(sp);
    });
    const mark = h('div', { className: 'welcome-mark' });
    const img = document.createElement('img');
    img.src = 'icons/sidecar-mark.svg';
    img.alt = '';
    mark.append(img);
    wrap.append(
      sparks,
      mark,
      h('h2', { className: 'welcome-title', textContent: 'Welcome to Sidecar' }),
      h('p', {
        className: 'welcome-sub',
        textContent: 'A classy Nostr signer and Lightning wallet that lives in your browser sidebar.',
      }),
      h('p', { className: 'welcome-cta', textContent: 'Create a new account or import your nsec to begin.' })
    );
    return wrap;
  }

  function renderMain() {
    const active = state.accounts.find((a) => a.pubkey === state.activePubkey);

    // No accounts yet → the switcher chip has nothing to show or switch to (its
    // dropdown would only offer "Manage accounts", the tab you're already on),
    // and the "Accounts" heading is noise next to the welcome hero. Hide both;
    // the topbar actions stay anchored right (margin-left:auto).
    const hasAccounts = state.accounts.length > 0;
    // Empty state: keep a dimmed placeholder avatar in the top-left for balance,
    // but make the chip inert (no name, no chevron, no dropdown) until an account exists.
    $('acct-btn').disabled = !hasAccounts;
    $('accounts-heading').classList.toggle('hidden', !hasAccounts);

    // "Pinned and open" tip sits below the add buttons (where it won't get lost),
    // shown only while onboarding.
    let tip = $('welcome-tip');
    if (!hasAccounts && !tip) {
      tip = h('div', { id: 'welcome-tip', className: 'welcome-tip' }, [
        icon('pin'),
        h('span', { textContent: 'For the best experience, keep Sidecar pinned and open in your sidebar.' }),
      ]);
      document.querySelector('#tab-accounts .add-actions').insertAdjacentElement('afterend', tip);
    } else if (hasAccounts && tip) {
      tip.remove();
    }

    // No accounts → gate the rest of the app: the Activity/Profile/Wallet tabs and
    // the compose FAB are dimmed and inert until an account exists. Snap back to
    // the Accounts tab if a gated tab was active (e.g. after removing the last one).
    ['activity', 'profile', 'wallet'].forEach((name) => {
      const t = document.querySelector('.tab[data-tab="' + name + '"]');
      if (t) t.disabled = !hasAccounts;
    });
    $('compose-fab').disabled = !hasAccounts;
    const balloon = $('first-post-balloon');
    if (balloon) {
      const showBalloon = hasAccounts &&
        !!state.activePubkey &&
        _firstPostSeenPubkeys !== null &&
        !_firstPostSeenPubkeys.has(state.activePubkey);
      balloon.classList.toggle('hidden', !showBalloon);
    }
    if (!hasAccounts) {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      const acc = document.querySelector('.tab[data-tab="accounts"]');
      if (acc) acc.classList.add('active');
      document.querySelectorAll('.tabview').forEach((v) => hide(v));
      show($('tab-accounts'));
    }

    // persistent header chip (current account)
    applyAvatar($('chip-av'), active || {});
    $('chip-name').textContent = active ? displayName(active) : 'No account';
    refreshBell();

    // The active account already shows in the header chip and is marked (check +
    // highlight) in the list below, so the big "booth" card was a third copy.
    // Keep this slot only for the empty-state welcome hero.
    const head = $('active-account');
    head.innerHTML = '';
    head.classList.toggle('welcome-mode', !hasAccounts);
    head.classList.toggle('hidden', hasAccounts);
    if (!hasAccounts) head.appendChild(buildWelcome());

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
  $('add-generate').addEventListener('click', () => generateAccount());
  $('add-import').addEventListener('click', () => importAccountModal());
  $('explore-apps-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  });

  // ---- first-post tip balloon (once per imported nsec) ----
  (function initFirstPostBalloon() {
    const balloon = $('first-post-balloon');
    if (!balloon) return;
    chrome.storage.local.get('firstPostTipSeenPubkeys', ({ firstPostTipSeenPubkeys }) => {
      _firstPostSeenPubkeys = new Set(Array.isArray(firstPostTipSeenPubkeys) ? firstPostTipSeenPubkeys : []);
      if (state?.accounts) renderMain();
    });
    balloon.addEventListener('click', () => {
      if (state?.activePubkey) {
        _firstPostSeenPubkeys = _firstPostSeenPubkeys || new Set();
        _firstPostSeenPubkeys.add(state.activePubkey);
        chrome.storage.local.set({ firstPostTipSeenPubkeys: [..._firstPostSeenPubkeys] });
      }
      balloon.classList.add('hidden');
      openComposer('Just setting up my #Sidecar 🍸');
    });
  })();

  // ---- modals ----
  let modalCleanup = null;
  function openModal(buildContent, onClose) {
    const modal = $('modal');
    modal.innerHTML = '';
    modal.classList.remove('modal-sheet'); // reset full-height variant; opt back in per modal
    modalCleanup = onClose || null;
    buildContent(modal);
    show($('modal-overlay'));
    document.documentElement.classList.add('modal-open');
  }
  // These modals are built from loose inputs + buttons (not a <form>), so Enter
  // wouldn't submit. Treat Enter in a text input as a click on the primary action.
  // (Textareas keep Enter for newlines.)
  $('modal').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    const primary = $('modal').querySelector('button.primary');
    if (primary && !primary.disabled) {
      e.preventDefault();
      primary.click();
    }
  });
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

  // Generate is instant — create the key, then surface the one-time backup modal.
  async function generateAccount() {
    try {
      const gen = await call({ type: 'SIDECAR_ADD_ACCOUNT', generate: true });
      // Make the new account active BEFORE anything can publish to it. Generate
      // only auto-activates the very first account; without this the setup wizard
      // would publish its kind:0 to whatever account was already active — which
      // once overwrote an unrelated existing profile.
      if (gen && gen.pubkey) await call({ type: 'SIDECAR_SET_ACTIVE', pubkey: gen.pubkey });
      await refresh(); // renderMain() then pulls the profile for the new account
      toast('Account created', 'success');
      if (gen && gen.nsec) {
        nsecModal({
          nsec: gen.nsec,
          title: 'Back up your new key',
          intro:
            'Sidecar generated a new account. This nsec is the only way to recover it — save it now. You can view it again later behind your PIN.',
          // A brand-new key has no profile yet — once they've backed it up, run a
          // short setup wizard (name → photo → bio), which publishes what they
          // fill in and lands them on the Profile tab to complete the rest.
          onDone: () => profileSetupWizard(gen.pubkey),
        });
      }
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function importAccountModal() {
    openModal((modal) => {
      modal.append(h('h3', { textContent: 'Import account' }));
      const err = h('div', { className: 'error' });
      const secretInput = h('input', { type: 'password', className: 'nsec-field', placeholder: 'nsec1… or 64-char hex' });
      modal.append(h('label', { textContent: 'Private key' }), secretInput);

      // Live preview: once the pasted key is valid, show whose account it is
      // (npub + kind 0 name/picture) so the user can confirm before importing.
      const pav = h('span', { className: 'ip-av' });
      const pname = h('div', { className: 'ip-name' });
      const pnpub = h('div', { className: 'ip-npub' });
      const preview = h('div', { className: 'import-preview hidden' }, [
        pav,
        h('div', { className: 'ip-info' }, [pname, pnpub]),
      ]);
      modal.append(preview);

      let previewSeq = 0;
      let previewTimer = null;
      async function updatePreview() {
        const pubkey = pubkeyFromSecret(secretInput.value.trim());
        const seq = ++previewSeq;
        if (!pubkey) return preview.classList.add('hidden');
        const npub = NT.nip19.npubEncode(pubkey);
        applyAvatar(pav, {});
        pname.textContent = 'Fetching profile…';
        pnpub.textContent = shortNpub(npub);
        preview.classList.remove('hidden');
        const prof = await fetchPreviewProfile(pubkey);
        if (seq !== previewSeq) return; // a newer key superseded this fetch
        if (prof && (prof.name || prof.picture)) {
          applyAvatar(pav, { picture: prof.picture, name: prof.name });
          pname.textContent = prof.name || shortNpub(npub);
        } else {
          pname.textContent = 'No profile found';
        }
      }
      secretInput.addEventListener('input', () => {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(updatePreview, 350);
      });

      modal.append(
        h('p', {
          className: 'hint',
          textContent:
            'Your nsec stays encrypted on this device. Sidecar signs locally, so sites only get signatures, never your key. Much safer than pasting it into a website.',
        })
      );
      modal.append(err);

      const save = h('button', { className: 'primary', textContent: 'Import account' });
      save.addEventListener('click', async () => {
        err.textContent = '';
        try {
          const secret = secretInput.value.trim();
          if (!secret) throw new Error('Enter an nsec or hex private key.');
          await call({ type: 'SIDECAR_ADD_ACCOUNT', secret });
          closeModal();
          await refresh();
          toast('Account added', 'success');
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(h('div', { className: 'actions' }, [save, cancel]));
      setTimeout(() => secretInput.focus(), 50);
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
  // The key auto-hides after 30s so it can't be left exposed on screen; viewing
  // it again goes back through the PIN-gated reveal.
  const NSEC_REVEAL_TIMEOUT_S = 30;
  function nsecModal(opts) {
    let remaining = NSEC_REVEAL_TIMEOUT_S;
    let timer = null;
    openModal(
      (modal) => {
        // Scannable QR for QR sign-in on mobile clients (e.g. Wisp). nsec is
        // case-sensitive bech32, so encode it as-is (lowercase, byte mode).
        const canvas = document.createElement('canvas');
        canvas.className = 'recv-qr modal-qr';
        try { new window.QRious({ element: canvas, value: opts.nsec, size: 220, level: 'M' }); } catch (_) {}

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
        const countdown = h('p', {
          className: 'hint',
          textContent: 'Hiding in ' + remaining + 's. Reveal again with your PIN.',
        });
        timer = setInterval(() => {
          remaining -= 1;
          if (remaining <= 0) return closeModal(); // cleanup clears the timer
          countdown.textContent = 'Hiding in ' + remaining + 's. Reveal again with your PIN.';
        }, 1000);
        modal.append(
          h('h3', { textContent: opts.title }),
          opts.intro ? h('p', { className: 'hint', textContent: opts.intro }) : document.createTextNode(''),
          canvas,
          h('p', { className: 'hint', textContent: 'Scan to sign in on a mobile client that supports QR login.' }),
          box,
          copy,
          h('p', { className: 'hint warn', textContent: 'Anyone with this key fully controls the account. Store it somewhere safe and never share it.' }),
          countdown,
          h('div', { className: 'actions' }, [done])
        );
      },
      () => {
        if (timer) { clearInterval(timer); timer = null; }
        // Runs on any close (button, X, or the 30s auto-hide). Defer to a fresh
        // tick: onDone opens the setup wizard (another modal), and this
        // closeModal still nulls modalCleanup and clears #modal right after this
        // callback returns — running it inline would tear the wizard back down.
        if (opts.onDone) setTimeout(opts.onDone, 0);
      }
    );
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
    // version + update check
    const build = window.SIDECAR_BUILD || {};
    const ver = build.version || (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
    $('settings-version').textContent = ver
      ? 'Version ' + ver + (build.commit && build.commit !== 'dev' ? ' (' + build.commit + ')' : '')
      : '';
    $('check-update-status').textContent = '';

    // auto-lock
    const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
    $('autolock-select').value = String(settings.autoLockMinutes || 0);
    $('client-select').value = settings.defaultClient || DEFAULT_CLIENT;
    $('paybutton-toggle').checked = settings.showPayButton !== false; // default on
    $('clienttag-toggle').checked = settings.showClientTag !== false; // default on
    $('autozap-toggle').checked = settings.autoZap === true;
    $('autozap-max').value = String(settings.autoZapMaxSats || AUTOZAP_DEFAULT_MAX);
    $('autozap-max-row').classList.toggle('hidden', !$('autozap-toggle').checked);

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

  function siteRow(host, level, boundPk) {
    const boundAcct = boundPk ? state.accounts.find((a) => a.pubkey === boundPk) : null;
    const isActiveBound = boundPk && boundPk === state.activePubkey;

    const row = h('div', { className: 'item site-item' });
    const main = h('div', { className: 'item-main' });
    main.append(h('div', { className: 'item-label', textContent: host }));
    if (boundAcct) {
      const who = h('div', { className: 'site-bound' + (isActiveBound ? '' : ' site-bound-other') });
      who.append(avatarEl(boundAcct, 'site-bound-av'));
      who.append(h('span', { textContent: 'Signs in as ' + displayName(boundAcct) }));
      main.append(who);
    }
    row.append(main);

    // Controls go on their own row below the host so the "Signs in as" line
    // always gets full width and never wraps mid-phrase.
    const controls = h('div', { className: 'site-controls' });
    row.append(controls);

    if (boundPk && !isActiveBound) {
      // Bound to a different account: the obvious path to switch profiles here.
      const active = state.accounts.find((a) => a.pubkey === state.activePubkey);
      const btn = h('button', {
        className: 'switch-site-btn',
        textContent: 'Use ' + (active ? displayName(active) : 'this account'),
        title: 'Switch ' + host + ' to the active account',
      });
      btn.addEventListener('click', () => switchSiteModal(host, boundAcct, active));
      controls.append(btn);
      return row;
    }

    // Bound to the active account (or unbound): tier selector + forget.
    const sel = document.createElement('select');
    sel.className = 'level-select';
    LEVELS.forEach(([v, l]) => {
      const o = h('option', { value: v, textContent: l });
      if (v === level) o.selected = true;
      sel.append(o);
    });
    sel.addEventListener('change', () => call({ type: 'SIDECAR_SET_LEVEL', host, level: sel.value }));
    // Forget needs a deliberate step — first tap swaps the controls for an inline
    // "Forget this site?" confirm so a stray click can't wipe a site's trust.
    const rm = iconButton('Forget site', 'trash', () => {
      controls.innerHTML = '';
      const msg = h('span', { className: 'confirm-msg', textContent: 'Forget this site?' });
      const yes = h('button', { className: 'mini del-confirm', textContent: 'Forget' });
      const no = h('button', { className: 'mini ghost', textContent: 'Cancel' });
      no.addEventListener('click', () => renderActivity());
      yes.addEventListener('click', async () => {
        await call({ type: 'SIDECAR_REMOVE_HOST', host });
        renderActivity();
      });
      controls.append(msg, yes, no);
    });
    controls.append(sel, rm);
    return row;
  }

  // Explain + confirm switching a site from its bound account to the active one.
  // Detaching alone isn't enough — the web client caches the old pubkey, so the
  // user must sign out and back in for Sidecar to re-bind it.
  function switchSiteModal(host, boundAcct, active) {
    const activeName = active ? displayName(active) : 'the active account';
    openModal((modal) => {
      const p = h('p', { className: 'hint' }, [
        document.createTextNode(host + ' is signing in as '),
        h('b', { textContent: displayName(boundAcct) }),
        document.createTextNode('. To use '),
        h('b', { textContent: activeName }),
        document.createTextNode(' instead:'),
      ]);
      const go = h('button', { className: 'primary', textContent: 'Detach ' + host });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      go.addEventListener('click', async () => {
        await call({ type: 'SIDECAR_CLEAR_BINDING', host });
        closeModal();
        toast('Detached. Sign out of ' + host + ' and back in as ' + activeName + '.', 'success');
        renderActivity();
      });
      modal.append(
        h('h3', { textContent: 'Switch ' + host }),
        p,
        h('ol', { className: 'restore-list' }, [
          h('li', { textContent: 'Detach the site below.' }),
          h('li', { textContent: 'On ' + host + ', sign out and sign back in.' }),
        ]),
        h('div', { className: 'actions' }, [go, cancel])
      );
    });
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
    const [perms, bindings] = await Promise.all([
      call({ type: 'SIDECAR_GET_PERMISSIONS' }),
      call({ type: 'SIDECAR_GET_SITE_BINDINGS' }),
    ]);
    const sites = $('sites-list');
    sites.innerHTML = '';
    // Union of the active account's permissioned hosts and every bound host, so
    // a site pinned to a different account still shows up (and can be switched).
    const hosts = [...new Set([...Object.keys(perms), ...Object.keys(bindings)])].sort();
    sites.classList.toggle('empty', !hosts.length);
    const sitesMore = $('sites-more');
    if (!hosts.length) {
      listState(sites, 'No sites have connected yet.');
      hide(sitesMore);
    } else {
      // The list can get long — show a handful, then paginate (like the log below).
      const SITES_PAGE = 6;
      let shownSites = 0;
      const renderSitesPage = () => {
        hosts.slice(shownSites, shownSites + SITES_PAGE).forEach((host) =>
          sites.append(siteRow(host, perms[host] ? perms[host].level : 'ask', bindings[host] || null))
        );
        shownSites = Math.min(shownSites + SITES_PAGE, hosts.length);
        if (shownSites >= hosts.length) hide(sitesMore);
        else {
          show(sitesMore);
          sitesMore.textContent = 'Show more (' + (hosts.length - shownSites) + ')';
        }
      };
      sitesMore.onclick = renderSitesPage;
      renderSitesPage();
    }

    const log = await call({ type: 'SIDECAR_GET_ACTIVITY' });
    const list = $('activity-list');
    list.innerHTML = '';
    if (!log.length) {
      listState(list, 'No signing activity yet.');
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

  // Skeleton placeholder mirroring the centered profile layout while kind:0 loads.
  function profileSkeleton() {
    const sk = h('div', { className: 'profile-skeleton' });
    sk.append(h('div', { className: 'sk sk-banner' }));
    sk.append(h('div', { className: 'sk sk-avatar' }));
    sk.append(h('div', { className: 'sk sk-line sk-name' }));
    sk.append(h('div', { className: 'sk sk-line sk-sub' }));
    sk.append(h('div', { className: 'sk sk-line sk-bio1' }));
    sk.append(h('div', { className: 'sk sk-line sk-bio2' }));
    return sk;
  }

  async function renderProfile() {
    const view = $('profile-view');
    const active = state.accounts.find((a) => a.pubkey === state.activePubkey);
    view.innerHTML = '';
    if (!active) {
      view.append(h('p', { className: 'hint', textContent: 'No active account.' }));
      return;
    }
    view.append(profileSkeleton());
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

    // Following count (fetched from the account's kind:3). Followers are out of
    // scope for now — they require an aggregating index, not a single event.
    const followNum = h('strong', { textContent: '…' });
    const backupJump = h('button', { className: 'profile-backup-jump', title: 'Backup & restore' });
    backupJump.innerHTML =
      '<svg viewBox="0 0 22 22" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M10.9851 0C7.6057 0 4.58375 1.52106 2.56398 3.91405L0.855461 2.20784V7.70159H6.35666L4.78529 6.13235C6.22953 4.30005 8.46896 3.12232 10.9851 3.12232C15.3417 3.12232 18.8734 6.64928 18.8734 11C18.8734 15.3507 15.3417 18.8776 10.9851 18.8776C6.88814 18.8776 3.52149 15.7583 3.13471 11.7682H0C0.395343 17.4845 5.16066 22 10.9851 22C17.0685 22 22 17.0751 22 11C22 4.92486 17.0685 0 10.9851 0Z"/></svg>';
    backupJump.addEventListener('click', () => {
      const el = view.querySelector('.backup-setting');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const followStat = h('div', { className: 'profile-stats' }, [
      h('span', { className: 'profile-stat' }, [followNum, document.createTextNode(' following')]),
      backupJump,
    ]);
    body.append(followStat);
    getFollowCount(active.pubkey).then((n) => {
      followNum.textContent = n == null ? '—' : n.toLocaleString('en-US');
    });

    const editBtn = h('button', { className: 'secondary profile-edit-cta' });
    editBtn.append(icon('edit'), h('span', { textContent: 'Edit profile' }));
    editBtn.addEventListener('click', () => openProfileEdit(content));
    body.append(editBtn);

    if (content.about) {
      const about = h('p', { className: 'profile-about' });
      body.append(about);
      renderAbout(about, content.about);
    }
    if (content.lud16) body.append(h('div', { className: 'profile-meta' }, [boltIcon(), document.createTextNode(' ' + content.lud16)]));
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

    renderNip65Section(view, active);
    renderBackupSection(view, active);
  }

  // ---- rich about text: links + npub/nprofile mentions, with show more/less ----
  const normalizeUrl = (u) => (/^https?:\/\//i.test(u) ? u : 'https://' + u);
  const mentionNameCache = new Map(); // pubkey -> name|null
  const TOKEN_RE = /(https?:\/\/[^\s]+)|(?:nostr:)?((?:npub1|nprofile1)[0-9a-z]+)/gi;

  // Follow list cache for @mention autocomplete (invalidated on account switch)
  let followListCache = null;
  let followListPubkey = null;
  let followListInflight = null; // dedupe concurrent loads (rapid @-keystrokes)

  // Lightweight follow COUNT (unique p-tags on the account's kind:3) — avoids the
  // heavy kind:0 profile batch that getFollowList() does, since the profile just
  // needs a number. Cached per pubkey. A completed query with no follow list means
  // they aren't following anyone yet → 0 (common for a fresh account); only a
  // thrown error returns null, which the UI renders as "—".
  const followCountCache = new Map(); // pubkey -> number|null
  async function getFollowCount(pubkey) {
    if (!pubkey) return null;
    if (followCountCache.has(pubkey)) return followCountCache.get(pubkey);
    let count = null;
    try {
      const ev = await getPool().get(await relayUrls(false), { kinds: [3], authors: [pubkey] }, { maxWait: 8000 });
      if (ev) {
        const set = new Set(ev.tags.filter((t) => t[0] === 'p' && t[1] && t[1].length === 64).map((t) => t[1]));
        count = set.size;
      } else {
        count = 0;
      }
    } catch (_) {}
    followCountCache.set(pubkey, count);
    return count;
  }

  // ---- Nostr Archives profile API ----
  // Global username search + bulk metadata, used to (A) find people to @mention
  // who aren't in your follow list and (B) resolve follow-list names the relays
  // didn't return. Best-effort: any error or rate-limit falls back to relay data.
  // See docs/username-search-plan.md. Approved endpoints only.
  const NA_BASE = 'https://api.nostrarchives.com';
  const isHex64 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);
  let naCooldownUntil = 0; // epoch ms; a 429 backs us off until this time
  const naAvailable = () => Date.now() >= naCooldownUntil;
  function naBackoff(retryAfter) {
    const secs = Math.min(3600, Math.max(30, Number(retryAfter) || 60));
    naCooldownUntil = Date.now() + secs * 1000;
  }
  const naName = (p) => p.display_name || p.preferred_name || p.name || null;

  // Global username search → [{pubkey, name, picture}]. Returns [] on any failure.
  async function naSuggest(query) {
    if (!query || query.length < 2 || !naAvailable()) return [];
    try {
      const resp = await fetch(NA_BASE + '/v1/search/suggest?q=' + encodeURIComponent(query) + '&limit=8', {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.status === 429) { naBackoff(resp.headers.get('retry-after')); return []; }
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.suggestions || [])
        .filter((s) => s && isHex64(s.pubkey))
        .map((s) => {
          const pk = s.pubkey.toLowerCase();
          let name = naName(s);
          if (!name) { try { name = shortNpub(NT.nip19.npubEncode(pk)); } catch (_) { name = pk.slice(0, 10) + '…'; } }
          return { pubkey: pk, name, picture: s.picture || null };
        });
    } catch (_) { return []; }
  }

  // Bulk profile metadata for a set of pubkeys → Map(pubkey → {name, picture}).
  // Chunks to the API's 500-pubkey limit; stops early on a rate-limit.
  async function naMetadata(pubkeys) {
    const out = new Map();
    const ids = [...new Set((pubkeys || []).filter(isHex64).map((p) => p.toLowerCase()))];
    if (!ids.length || !naAvailable()) return out;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      try {
        const resp = await fetch(NA_BASE + '/v1/profiles/metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pubkeys: chunk }),
          signal: AbortSignal.timeout(8000),
        });
        if (resp.status === 429) { naBackoff(resp.headers.get('retry-after')); break; }
        if (!resp.ok) continue;
        const data = await resp.json();
        (data.profiles || []).forEach((p) => {
          if (p && isHex64(p.pubkey)) out.set(p.pubkey.toLowerCase(), { name: naName(p), picture: p.picture || null });
        });
      } catch (_) { /* keep whatever resolved so far */ }
    }
    return out;
  }

  // Fire-and-forget: fill in names/pictures the relays didn't return, mutating the
  // cached follow-list objects in place so those follows become searchable by name
  // on the next keystroke. Never blocks the initial dropdown.
  async function enrichFollowNames(list, missingPubkeys) {
    if (!missingPubkeys.length) return;
    const meta = await naMetadata(missingPubkeys);
    if (!meta.size) return;
    const byPk = new Map(list.map((c) => [c.pubkey, c]));
    meta.forEach((m, pk) => {
      const c = byPk.get(pk);
      if (c && m.name) { c.name = m.name; if (!c.picture && m.picture) c.picture = m.picture; }
    });
  }

  async function getFollowList() {
    if (followListCache && followListPubkey === state.activePubkey) return followListCache;
    if (followListInflight) return followListInflight; // a load is already running
    if (!state.activePubkey) return [];
    followListInflight = (async () => {
    try {
      const relays = await relayUrls(false);
      // maxWait bounds each relay's own connect+EOSE wait individually (they
      // run in parallel) instead of racing the WHOLE fetch against an external
      // timeout — the previous approach discarded every result the moment the
      // race lost, even if most relays had already answered, so one slow relay
      // could wipe the entire follow list down to zero. Not cached on failure,
      // so the next @-mention attempt retries instead of being stuck all session.
      const ev = await getPool().get(relays, { kinds: [3], authors: [state.activePubkey] }, { maxWait: 8000 });
      if (!ev) return [];
      const pubkeys = (ev.tags || [])
        .filter((t) => t[0] === 'p')
        .map((t) => t[1])
        .filter((pk) => pk && pk.length === 64);
      if (!pubkeys.length) {
        followListPubkey = state.activePubkey;
        return (followListCache = []);
      }
      const profiles = await getPool().querySync(relays, { kinds: [0], authors: pubkeys }, { maxWait: 10000 });
      const byPk = {};
      (profiles || []).forEach((p) => {
        if (!byPk[p.pubkey] || p.created_at > byPk[p.pubkey].created_at) byPk[p.pubkey] = p;
      });
      const list = pubkeys.map((pk) => {
        let name = null, picture = null;
        const prof = byPk[pk];
        if (prof) {
          try {
            const c = JSON.parse(prof.content);
            name = c.display_name || c.name || null;
            picture = c.picture || null;
          } catch (_) {}
        }
        // Keep follows with no resolvable profile (no relay had their kind:0,
        // or the profile fetch just missed them) — fall back to a short npub
        // so they're still selectable instead of silently vanishing from
        // @mention results.
        if (!name) {
          try { name = shortNpub(NT.nip19.npubEncode(pk)); } catch (_) { name = pk.slice(0, 10) + '…'; }
        }
        return { pubkey: pk, name, picture };
      });
      followListPubkey = state.activePubkey;
      followListCache = list;
      // Background: fill names the relays didn't return via Nostr Archives, so
      // those follows become searchable by name. Mutates the cached objects in
      // place; not awaited, so the first dropdown render stays instant.
      enrichFollowNames(list, pubkeys.filter((pk) => !byPk[pk]));
      return followListCache;
    } catch (_) {
      return [];
    }
    })();
    try { return await followListInflight; }
    finally { followListInflight = null; }
  }

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

  // Render note text into `container`: inline images/videos, links, and
  // resolved nostr:npub/nprofile mentions — like renderNotePreview, but compact
  // for a quoted-note card (no OG link cards, no recursion into nested note
  // embeds). Once the visible-text budget (`maxLen`) is hit, the preview stops
  // cleanly at the "…" — nothing after the cut renders, so a mention or image
  // further down the note can't leak past the ellipsis.
  function renderNoteText(container, text, maxLen) {
    const mentions = [];
    let last = 0;
    let used = 0;
    let truncated = false;
    let m;
    PREVIEW_RE.lastIndex = 0;
    const pushText = (s) => {
      if (!s || truncated) return;
      if (used + s.length > maxLen) {
        container.append(document.createTextNode(s.slice(0, Math.max(0, maxLen - used)) + '…'));
        truncated = true;
      } else {
        container.append(document.createTextNode(s));
        used += s.length;
      }
    };
    while ((m = PREVIEW_RE.exec(text)) !== null) {
      if (m.index > last) pushText(text.slice(last, m.index));
      // Text before this token filled the budget → stop; don't render the token
      // (mention/link/media) that sits past the truncation point.
      if (truncated) break;
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
        let d = null;
        try { d = NT.nip19.decode(bech); } catch (_) {}
        if (d && (d.type === 'npub' || d.type === 'nprofile')) {
          const pubkey = d.type === 'npub' ? d.data : d.data.pubkey;
          const span = h('span', { className: 'mention', textContent: '@' + bech.slice(0, 10) + '…' });
          if (pubkey) mentions.push({ el: span, pubkey });
          container.append(span);
        } else {
          // Nested note/nevent/naddr ref — link out rather than recurse into
          // another embed card inside this one.
          const a = document.createElement('a');
          a.href = 'https://njump.me/' + bech;
          a.target = '_blank'; a.rel = 'noreferrer noopener';
          a.textContent = 'quoted note';
          container.append(a);
        }
      }
      last = PREVIEW_RE.lastIndex;
    }
    if (last < text.length) pushText(text.slice(last));
    resolveMentions(mentions);
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

  // ---- Blossom upload (BUD-02, kind:24242) with graceful fallback ----
  // Mirrors zap.cooking: try the user's own Blossom servers (kind:10063) first,
  // then fall back to the nostr.build NIP-98 flow below. No hardcoded server, so
  // users without a Blossom list keep the existing behavior unchanged.
  const BLOSSOM_AUTH_KIND = 24242;
  const BLOSSOM_SERVER_LIST_KIND = 10063;
  const BLOSSOM_CACHE_TTL = 5 * 60 * 1000;
  const BLOSSOM_UPLOAD_TIMEOUT = 30000;
  const _blossomServerCache = new Map(); // pubkey -> { servers, expiresAt }

  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function fetchBlossomServers(pubkey) {
    const cached = _blossomServerCache.get(pubkey);
    if (cached && cached.expiresAt > Date.now()) return cached.servers;
    let servers = [];
    try {
      const relays = await relayUrls(false);
      const ev = await poolGet(relays, { kinds: [BLOSSOM_SERVER_LIST_KIND], authors: [pubkey] });
      if (ev) {
        servers = ev.tags
          .filter((t) => t[0] === 'server' && t[1] && t[1].startsWith('https://'))
          .map((t) => t[1].replace(/\/$/, ''));
      }
    } catch (_) {}
    _blossomServerCache.set(pubkey, { servers, expiresAt: Date.now() + BLOSSOM_CACHE_TTL });
    return servers;
  }

  async function uploadToBlossom(file, servers) {
    const buffer = await file.arrayBuffer();
    const hash = await sha256Hex(buffer);
    const now = Math.floor(Date.now() / 1000);
    const authEvent = {
      kind: BLOSSOM_AUTH_KIND,
      created_at: now,
      tags: [['t', 'upload'], ['x', hash], ['expiration', String(now + 300)]],
      content: 'Upload file',
    };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event: authEvent });
    const authorization = 'Nostr ' + btoa(JSON.stringify(signed));
    let lastError;
    for (const server of servers) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), BLOSSOM_UPLOAD_TIMEOUT);
      try {
        const resp = await fetch(server + '/upload', {
          method: 'PUT',
          body: file,
          headers: { Authorization: authorization, 'Content-Type': file.type || 'application/octet-stream' },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json().catch(() => null);
        if (data && data.url) return data.url;
        throw new Error('No URL in Blossom response');
      } catch (e) {
        clearTimeout(timer);
        console.warn('[Blossom] upload to ' + server + ' failed:', e);
        lastError = e;
      }
    }
    throw lastError || new Error('All Blossom servers failed');
  }

  // Returns a hosted URL via Blossom, or null when Blossom isn't usable (no
  // active account, no server list, or every server failed) — caller then falls
  // back to nostr.build.
  async function tryBlossomFirst(file) {
    if (!state.activePubkey) return null;
    try {
      const servers = await fetchBlossomServers(state.activePubkey);
      if (!servers.length) return null;
      return await uploadToBlossom(file, servers);
    } catch (e) {
      console.warn('[Upload] Blossom failed, falling back to nostr.build:', e);
      return null;
    }
  }

  // ---- image upload (Blossom → nostr.build via NIP-98) ----
  async function uploadImage(file, kind) {
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file');
    if (file.size > 10 * 1024 * 1024) throw new Error('Image too large (max 10MB)');
    const blossomUrl = await tryBlossomFirst(file);
    if (blossomUrl) return blossomUrl;
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

  // ---- note media upload (Blossom → nostr.build via NIP-98, images + video) ----
  async function uploadMedia(file) {
    const isImg = file.type.startsWith('image/');
    const isVid = file.type.startsWith('video/');
    if (!isImg && !isVid) throw new Error('Choose an image or video');
    if (file.size > 100 * 1024 * 1024) throw new Error('File too large (max 100MB)');
    const blossomUrl = await tryBlossomFirst(file);
    if (blossomUrl) return blossomUrl;
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
  const CLIENT_TAG = ['client', 'Sidecar', 'https://github.com/dmnyc/sidecar', 'wss://nos.lol'];
  // ---- About / zap-the-creator ----
  const GITHUB_URL = 'https://github.com/dmnyc/sidecar';
  const CREATOR_NPUB = 'npub1aeh2zw4elewy5682lxc6xnlqzjnxksq303gwu2npfaxd49vmde6qcq4nwx';
  const CREATOR_LN = 'daniel@breez.tips';
  const IMG_EXT = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?.*)?$/i;
  const VID_EXT = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

  // Web clients that can open a single note. Each maps a NIP-19 nevent → a URL.
  const VIEW_CLIENTS = {
    jumble: { label: 'Jumble', url: (ne) => 'https://jumble.social/notes/' + ne, profile: (np) => 'https://jumble.social/users/' + np },
    primal: { label: 'Primal', url: (ne) => 'https://primal.net/e/' + ne, profile: (np) => 'https://primal.net/p/' + np },
    coracle: { label: 'Coracle', url: (ne) => 'https://coracle.social/' + ne, profile: (np) => 'https://coracle.social/' + np },
    nostrudel: { label: 'noStrudel', url: (ne) => 'https://nostrudel.ninja/#/n/' + ne, profile: (np) => 'https://nostrudel.ninja/#/u/' + np },
    yakihonne: { label: 'YakiHonne', url: (ne) => 'https://yakihonne.com/note/' + ne, profile: (np) => 'https://yakihonne.com/profile/' + np },
    njump: { label: 'njump', url: (ne) => 'https://njump.me/' + ne, profile: (np) => 'https://njump.me/' + np },
  };
  const DEFAULT_CLIENT = 'jumble';

  async function preferredClient() {
    const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
    const key = (settings && settings.defaultClient) || DEFAULT_CLIENT;
    return VIEW_CLIENTS[key] || VIEW_CLIENTS[DEFAULT_CLIENT];
  }

  // Resolve a kind:0 display name for an npub (best-effort, for the About credit).
  async function fetchProfileName(npub) {
    try {
      const hex = NT.nip19.decode(npub).data;
      const ev = await Promise.race([
        poolGet(await relayUrls(false), { kinds: [0], authors: [hex] }),
        new Promise((r) => setTimeout(() => r(null), 5000)),
      ]);
      if (!ev) return null;
      const c = JSON.parse(ev.content);
      return c.display_name || c.name || null;
    } catch (_) {
      return null;
    }
  }

  async function neventFor(signed) {
    let relays = [];
    try { relays = (await postRelays()).slice(0, 2); } catch (_) {}
    return NT.nip19.neventEncode({ id: signed.id, author: signed.pubkey, relays });
  }

  // Persistent "your note is live" banner with an open-in-client link.
  function dismissPostBanner() {
    if (_postBannerTimer) { clearTimeout(_postBannerTimer); _postBannerTimer = null; }
    const banner = $('post-banner');
    if (banner) hide(banner);
  }

  async function showPostBanner(signed) {
    const banner = $('post-banner');
    if (!banner) return;
    let nevent;
    try { nevent = await neventFor(signed); } catch (_) { return; }
    const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
    const key = (settings && settings.defaultClient) || DEFAULT_CLIENT;
    const client = VIEW_CLIENTS[key] || VIEW_CLIENTS[DEFAULT_CLIENT];

    if (_postBannerTimer) clearTimeout(_postBannerTimer); // only one note's link shown at a time

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
    close.addEventListener('click', dismissPostBanner);
    banner.append(msg, open, close);
    show(banner);
    _postBannerTimer = setTimeout(dismissPostBanner, 60000);
  }

  // Render composed note content the way a client will: text + inline media + @mentions.
  // Composer preview: inline media / links, profile mentions (@name), and nostr
  // event refs (note1/nevent/naddr) rendered as embed cards fetched from the
  // user's own relays.
  // npub1/note1 are always exactly 63 chars (5+58); use {58} to prevent the regex
  // from greedily consuming adjacent lowercase words as bech32 characters.
  const PREVIEW_RE = /(https?:\/\/[^\s]+)|(?:nostr:)?(npub1[0-9a-z]{58}|nprofile1[0-9a-z]{50,}|note1[0-9a-z]{58}|nevent1[0-9a-z]{50,}|naddr1[0-9a-z]{50,})/gi;
  function renderNotePreview(container, text) {
    const mentions = [];
    const embeds = [];
    let last = 0;
    let m;
    PREVIEW_RE.lastIndex = 0;
    const flushText = (s) => { if (s) container.append(document.createTextNode(s)); };
    while ((m = PREVIEW_RE.exec(text)) !== null) {
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
          if (url.startsWith('https://')) {
            const card = document.createElement('a');
            card.className = 'link-card loading';
            card.textContent = 'Loading preview…';
            container.append(card);
            fetchOgMeta(url).then((meta) => renderLinkCard(card, url, meta));
          }
        }
      } else if (m[2]) {
        const bech = m[2];
        let d = null;
        try { d = NT.nip19.decode(bech); } catch (_) {}
        if (d && (d.type === 'npub' || d.type === 'nprofile')) {
          const pubkey = d.type === 'npub' ? d.data : d.data.pubkey;
          const a = h('span', { className: 'mention', textContent: '@' + bech.slice(0, 10) + '…' });
          if (pubkey) mentions.push({ el: a, pubkey });
          container.append(a);
        } else if (d && (d.type === 'note' || d.type === 'nevent' || d.type === 'naddr')) {
          const card = h('div', { className: 'note-embed loading', textContent: 'Loading nostr event…' });
          embeds.push({ el: card, ref: embedRef(d) });
          container.append(card);
        } else {
          flushText(bech);
        }
      }
      last = PREVIEW_RE.lastIndex;
    }
    flushText(text.slice(last));
    resolveMentions(mentions);
    resolveEmbeds(embeds);
  }

  // Decode a nostr entity into a relay filter (+ any relay hints) for fetching.
  function embedRef(d) {
    if (d.type === 'note') return { filter: { ids: [d.data] } };
    if (d.type === 'nevent') return { filter: { ids: [d.data.id] }, relays: d.data.relays || [] };
    return {
      filter: { kinds: [d.data.kind], authors: [d.data.pubkey], '#d': [d.data.identifier] },
      relays: d.data.relays || [],
    };
  }

  async function resolveEmbeds(embeds) {
    for (const { el, ref } of embeds) {
      let ev = null;
      try {
        const relays = [...new Set([...(await relayUrls(false)), ...(ref.relays || [])])];
        ev = await Promise.race([
          poolGet(relays, ref.filter),
          new Promise((r) => setTimeout(() => r(null), 6000)),
        ]);
      } catch (_) {}
      if (!ev) {
        el.classList.remove('loading');
        el.classList.add('embed-missing');
        el.textContent = 'nostr event (not found)';
        continue;
      }
      renderEmbedCard(el, ev);
    }
  }

  function renderEmbedCard(el, ev) {
    el.classList.remove('loading');
    el.textContent = '';
    const av = h('span', { className: 'embed-av' });
    applyAvatar(av, {});
    const name = h('span', { className: 'embed-name', textContent: shortNpub(NT.nip19.npubEncode(ev.pubkey)) });
    const head = h('div', { className: 'embed-head' }, [
      av,
      h('div', { className: 'embed-who' }, [
        name,
        h('span', { className: 'embed-time', textContent: relTime((ev.created_at || 0) * 1000) }),
      ]),
    ]);
    const titleTag = (ev.tags || []).find((t) => t[0] === 'title');
    const text = (titleTag && titleTag[1]) || ev.content || '';
    const body = h('div', { className: 'embed-body' });
    renderNoteText(body, text, 280);
    el.append(head, body);
    fetchPreviewProfile(ev.pubkey).then((p) => {
      if (!p) return;
      if (p.picture) applyAvatar(av, { picture: p.picture });
      if (p.name) name.textContent = '@' + p.name;
    });
  }

  // ---- OG / link preview cards ----
  const ogCache = new Map(); // url → { title, description, image, site } | null

  async function fetchOgMeta(url) {
    if (ogCache.has(url)) return ogCache.get(url);
    ogCache.set(url, null); // mark in-flight so parallel calls don't double-fetch
    try {
      const meta = await call({ type: 'SIDECAR_FETCH_OG', url });
      ogCache.set(url, meta);
      return meta;
    } catch (_) { return null; }
  }

  function decodeHtml(s) {
    if (!s) return s;
    const t = document.createElement('textarea');
    t.innerHTML = s;
    return t.value;
  }

  function renderLinkCard(container, url, meta) {
    container.classList.remove('loading');
    if (!meta) { container.remove(); return; }
    container.innerHTML = '';
    const body = h('div', { className: 'link-card-body' });
    if (meta.site) body.append(h('div', { className: 'link-card-site', textContent: decodeHtml(meta.site) }));
    if (meta.title) body.append(h('div', { className: 'link-card-title', textContent: decodeHtml(meta.title) }));
    if (meta.description) body.append(h('div', { className: 'link-card-desc', textContent: decodeHtml(meta.description) }));
    const isHttps = (s) => typeof s === 'string' && s.startsWith('https://');
    if (isHttps(meta.image)) {
      const img = document.createElement('img');
      img.className = 'link-card-img';
      img.referrerPolicy = 'no-referrer';
      img.src = meta.image;
      img.onerror = () => img.remove();
      container.append(img);
    }
    container.append(body);
    container.href = url;
    container.target = '_blank';
    container.rel = 'noreferrer noopener';
  }

  // Serialize a contenteditable editor div to plain nostr text.
  // Text nodes → text, BR → \n, block divs → \n prefix, pill spans → their data-bech32.
  //   (NBSP used after pills to prevent browser whitespace collapse) → regular space.
  function serializeEditor(el) {
    let out = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent.replace(/ /g, ' ');
      } else if (node.nodeName === 'BR') {
        out += '\n';
      } else if (node.dataset && node.dataset.bech32) {
        out += node.dataset.bech32;
      } else {
        const isBlock = node.nodeName === 'DIV' || node.nodeName === 'P';
        if (isBlock && out && !out.endsWith('\n')) out += '\n';
        node.childNodes.forEach(walk);
      }
    };
    el.childNodes.forEach(walk);
    return out;
  }

  // ---- composer draft autosave (per account, in chrome.storage.local) ----
  function loadComposeDraft(pubkey) {
    return new Promise((res) => {
      chrome.storage.local.get('sidecar_compose_drafts', (r) => {
        const all = (r && r.sidecar_compose_drafts) || {};
        res(all[pubkey] || null);
      });
    });
  }
  function saveComposeDraft(pubkey, draft) {
    const hasContent = !!((draft.text && draft.text.trim()) || (draft.media && draft.media.length));
    chrome.storage.local.get('sidecar_compose_drafts', (r) => {
      const all = (r && r.sidecar_compose_drafts) || {};
      if (hasContent) all[pubkey] = { text: draft.text, media: draft.media, savedAt: Date.now() };
      else delete all[pubkey];
      chrome.storage.local.set({ sidecar_compose_drafts: all });
    });
  }
  function clearComposeDraft(pubkey) {
    chrome.storage.local.get('sidecar_compose_drafts', (r) => {
      const all = (r && r.sidecar_compose_drafts) || {};
      if (!all[pubkey]) return;
      delete all[pubkey];
      chrome.storage.local.set({ sidecar_compose_drafts: all });
    });
  }

  async function openComposer(initialText) {
    if (!state.activePubkey) {
      toast('Add an account first', 'error');
      return;
    }
    const pubkey = state.activePubkey;
    let draft = { text: initialText || '', media: [] };
    const modal = $('modal');
    let timer = null;
    let saveTimer = null;
    let published = false;
    let enteredEditor = false;

    function persistDraft() { saveComposeDraft(pubkey, draft); }
    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(persistDraft, 400);
    }

    async function doPublish() {
      const content = draft.text.trim();
      const pTags = [];
      const seenPks = new Set();
      const mentionRe = /nostr:(npub1[0-9a-z]+|nprofile1[0-9a-z]+)/g;
      let mm;
      while ((mm = mentionRe.exec(content)) !== null) {
        try {
          const d = NT.nip19.decode(mm[1]);
          const pk = d.type === 'npub' ? d.data : d.data.pubkey;
          if (pk && !seenPks.has(pk)) { seenPks.add(pk); pTags.push(['p', pk]); }
        } catch (_) {}
      }
      // The "client" tag (attributes the note to Sidecar) is opt-out via Settings.
      const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
      const tags = settings && settings.showClientTag === false ? [...pTags] : [CLIENT_TAG.slice(), ...pTags];
      const event = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content,
      };
      const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event });
      await publishSigned(signed);
      return signed;
    }

    function showEditor() {
      if (timer) { clearInterval(timer); timer = null; }
      enteredEditor = true;
      modal.innerHTML = '';

      // Write / Preview tab bar
      let preview = false;
      const tabWrite = h('button', { className: 'compose-tab active', textContent: 'Write' });
      const tabPreview = h('button', { className: 'compose-tab', textContent: 'Preview' });
      const tabBar = h('div', { className: 'compose-tabs' }, [tabWrite, tabPreview]);

      const editor = h('div', { className: 'compose-text compose-editor is-empty', contentEditable: 'true' });
      editor.dataset.placeholder = "What’s on your mind?";
      if (draft.text) { editor.textContent = draft.text; editor.classList.remove('is-empty'); }

      const editorWrap = h('div', { className: 'compose-editor-wrap' });
      editorWrap.append(editor);

      // ---- @mention autocomplete ----
      let acDropdown = null, acResults = [], acIndex = 0;
      let acSeq = 0, acSuggestTimer = null; // guard stale async + debounce global search

      function getCaretContext() {
        const sel = window.getSelection();
        if (!sel.rangeCount) return null;
        const range = sel.getRangeAt(0);
        if (!range.collapsed) return null;
        const node = range.startContainer;
        if (node.nodeType !== Node.TEXT_NODE || !editor.contains(node)) return null;
        const before = node.textContent.slice(0, range.startOffset);
        const match = before.match(/@([^\s@]*)$/);
        if (!match) return null;
        return { node, query: match[1] };
      }

      function closeAcDropdown() {
        if (acDropdown) { acDropdown.remove(); acDropdown = null; }
        acResults = []; acIndex = 0;
      }

      function updateAcActiveItem() {
        if (!acDropdown) return;
        acDropdown.querySelectorAll('.ac-item').forEach((el, i) => el.classList.toggle('active', i === acIndex));
      }

      function selectAcItem(contact, query) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        const node = range.startContainer;
        if (node.nodeType !== Node.TEXT_NODE) return;
        const offset = range.startOffset;
        const atStart = Math.max(0, offset - (query.length + 1));
        // Auto-insert a leading space when @ immediately follows a non-whitespace char.
        const charBeforeAt = atStart > 0 ? node.textContent[atStart - 1] : '';
        const needsLeadingSpace = charBeforeAt && !/\s/.test(charBeforeAt);
        range.setStart(node, atStart);
        range.setEnd(node, offset);
        range.deleteContents();
        const pill = document.createElement('span');
        pill.className = 'mention-pill';
        pill.contentEditable = 'false';
        pill.dataset.bech32 = 'nostr:' + NT.nip19.npubEncode(contact.pubkey);
        pill.textContent = '@' + contact.name;
        if (needsLeadingSpace) range.insertNode(document.createTextNode(' '));
        range.collapse(false);
        range.insertNode(pill);
        // NBSP after pill: never collapsed by the browser, normalized to space by serializer.
        const trailingSpace = document.createTextNode(' ');
        range.setStartAfter(pill);
        range.insertNode(trailingSpace);
        range.setStartAfter(trailingSpace);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        closeAcDropdown();
        draft.text = serializeEditor(editor);
        syncEmptyClass();
        updatePostState();
        scheduleSave();
      }

      // Anchor the dropdown just under the caret line rather than the bottom of
      // the (tall) editor box. Falls back to the CSS default if no caret rect.
      function positionAcDropdown() {
        if (!acDropdown) return;
        try {
          const sel = window.getSelection();
          if (!sel.rangeCount) return;
          const r = sel.getRangeAt(0).getBoundingClientRect();
          if (!r || (!r.top && !r.bottom)) return;
          const wrap = editorWrap.getBoundingClientRect();
          acDropdown.style.top = Math.round(r.bottom - wrap.top + 4) + 'px';
        } catch (_) {}
      }

      // `loading` shows a "Searching Nostr…" footer while the global lookup runs,
      // and keeps the dropdown open even when there are no local matches yet.
      function renderAcResults(items, ctx, loading) {
        acResults = items;
        if (!acResults.length && !loading) { closeAcDropdown(); return; }
        acIndex = Math.max(0, Math.min(acIndex, Math.max(0, acResults.length - 1)));
        if (!acDropdown) {
          acDropdown = h('div', { className: 'ac-dropdown' });
          editorWrap.append(acDropdown);
        }
        positionAcDropdown();
        acDropdown.innerHTML = '';
        acResults.forEach((c, i) => {
          const item = h('div', { className: 'ac-item' + (i === acIndex ? ' active' : '') });
          const av = h('span', { className: 'ac-item-av' });
          applyAvatar(av, c.picture ? { picture: c.picture } : {});
          item.append(av, h('span', { className: 'ac-item-name', textContent: '@' + c.name }));
          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const fresh = getCaretContext();
            selectAcItem(c, fresh ? fresh.query : ctx.query);
          });
          acDropdown.append(item);
        });
        if (loading) {
          acDropdown.append(h('div', { className: 'ac-loading' }, [
            h('span', { className: 'ac-spinner' }),
            h('span', { textContent: acResults.length ? 'Searching more…' : 'Searching Nostr…' }),
          ]));
        }
      }

      // Two async sources feed the dropdown: your follow list (instant from
      // cache, else a slow first relay load) and a global Nostr search. NEVER
      // block the UI on the follow list — the first load hits relays and can take
      // many seconds. Paint immediately (with a spinner), then repaint as each
      // source resolves. `paint()` renders the deduped union + loading state.
      async function updateAcDropdown() {
        const ctx = getCaretContext();
        if (!ctx || ctx.query.length === 0) { closeAcDropdown(); return; }
        const seq = ++acSeq;
        const q = ctx.query.toLowerCase();
        const willSearchGlobal = ctx.query.length >= 2 && naAvailable();

        const matchFollows = (list) => list.filter((c) => c.name && c.name.toLowerCase().includes(q));
        let followMatches = [];
        let globals = [];
        let globalPending = willSearchGlobal;
        const paint = () => {
          if (seq !== acSeq) return;
          const seen = new Set(followMatches.map((c) => c.pubkey));
          const merged = followMatches.slice();
          for (const g of globals) { if (!seen.has(g.pubkey)) { seen.add(g.pubkey); merged.push(g); } }
          renderAcResults(merged.slice(0, 8), ctx, globalPending);
        };

        // Follows: use the cache synchronously if present; otherwise load in the
        // background and repaint when ready (no await here).
        const cached = (followListCache && followListPubkey === state.activePubkey) ? followListCache : null;
        if (cached) followMatches = matchFollows(cached);
        paint(); // instant feedback: local matches (maybe none) + spinner if searching
        if (!cached) {
          getFollowList().then((list) => { if (seq === acSeq) { followMatches = matchFollows(list); paint(); } });
        }

        // Global search across all of Nostr so you can tag people you don't
        // follow. Debounced; best-effort — a failure/rate-limit just clears the
        // spinner and leaves the follow matches.
        if (willSearchGlobal) {
          if (acSuggestTimer) clearTimeout(acSuggestTimer);
          acSuggestTimer = setTimeout(async () => {
            const res = await naSuggest(ctx.query);
            if (seq !== acSeq) return; // query changed since
            globals = res;
            globalPending = false;
            paint();
          }, 250);
        }
      }

      function syncEmptyClass() {
        const isEmpty = !editor.textContent.trim() && !editor.querySelector('[data-bech32]');
        editor.classList.toggle('is-empty', isEmpty);
        if (isEmpty) editor.innerHTML = '';
      }

      editor.addEventListener('input', () => {
        draft.text = serializeEditor(editor);
        syncEmptyClass();
        updatePostState();
        updateAcDropdown();
        scheduleSave();
      });

      editor.addEventListener('keydown', (e) => {
        if (!acDropdown) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); acIndex = Math.min(acIndex + 1, acResults.length - 1); updateAcActiveItem(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); acIndex = Math.max(acIndex - 1, 0); updateAcActiveItem(); }
        else if (e.key === 'Enter' || e.key === 'Tab') {
          if (acResults[acIndex]) { e.preventDefault(); const ctx = getCaretContext(); selectAcItem(acResults[acIndex], ctx ? ctx.query : ''); }
        } else if (e.key === 'Escape') { e.preventDefault(); closeAcDropdown(); }
      });

      editor.addEventListener('blur', () => setTimeout(closeAcDropdown, 150));

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
        editorWrap.classList.toggle('hidden', p);
        thumbs.classList.toggle('hidden', p);
        addBtn.classList.toggle('hidden', p);
        previewPane.classList.toggle('hidden', !p);
        if (p) { closeAcDropdown(); renderPreview(); }
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
            const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
            let wn;
            while ((wn = walker.nextNode())) {
              if (wn.textContent.includes(m.url)) {
                wn.textContent = wn.textContent.replace('\n' + m.url, '').replace(m.url, '');
                break;
              }
            }
            draft.media.splice(i, 1);
            draft.text = serializeEditor(editor);
            syncEmptyClass();
            renderThumbs();
            updatePostState();
            scheduleSave();
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
          const t = editor.textContent;
          const urlNode = document.createTextNode((t.length && !/\s$/.test(t) ? '\n' : '') + url);
          editor.append(urlNode);
          draft.text = serializeEditor(editor);
          syncEmptyClass();
          renderThumbs();
          updatePostState();
          scheduleSave();
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
        addBtn.disabled = false;
        lbl.textContent = prev;
        fileInput.value = '';
      });

      editor.addEventListener('paste', async (e) => {
        const imageFiles = Array.from(e.clipboardData?.items ?? [])
          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter((f) => f !== null);
        if (imageFiles.length === 0) {
          e.preventDefault();
          const plain = e.clipboardData.getData('text/plain');
          if (plain) document.execCommand('insertText', false, plain);
          return;
        }
        e.preventDefault();
        addBtn.disabled = true;
        const lbl = addBtn.querySelector('span');
        const prev = lbl.textContent;
        lbl.textContent = 'Uploading…';
        try {
          for (const file of imageFiles) {
            const url = await uploadMedia(file);
            draft.media.push({ url, isVideo: false });
            const t = editor.textContent;
            const urlNode = document.createTextNode((t.length && !/\s$/.test(t) ? '\n' : '') + url);
            editor.append(urlNode);
          }
          draft.text = serializeEditor(editor);
          syncEmptyClass();
          renderThumbs();
          updatePostState();
          scheduleSave();
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
        addBtn.disabled = false;
        lbl.textContent = prev;
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
        editorWrap,
        previewPane,
        thumbs,
        addBtn,
        fileInput,
        err,
        h('div', { className: 'actions' }, [post, cancel])
      );
      updatePostState();
      editor.focus();
    }

    function showCountdown() {
      modal.innerHTML = '';
      let remaining = NOTE_COUNTDOWN_SECS;

      // Full-size countdown ring, centered below the note preview.
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

      // Same identity strip as the editor — who's posting shouldn't be ambiguous
      // right before it actually publishes.
      const active = state.accounts.find((acc) => acc.pubkey === state.activePubkey);
      const author = h('div', { className: 'compose-author' });
      author.append(avatarEl(active || {}, 'compose-author-av'));
      author.append(
        h('div', { className: 'compose-author-info' }, [
          h('span', { className: 'compose-author-eyebrow', textContent: 'Posting as' }),
          h('span', { className: 'compose-author-name', textContent: active ? displayName(active) : '—' }),
        ])
      );

      // The note exactly as it will be published, for a last review.
      const previewScroll = h('div', { className: 'countdown-preview' });
      const previewBody = h('div', { className: 'preview-body' });
      const bodyText = draft.text.trim();
      if (bodyText) renderNotePreview(previewBody, bodyText);
      else previewBody.append(h('p', { className: 'hint', textContent: 'Empty note.' }));
      previewScroll.append(previewBody);

      const now = h('button', { className: 'primary', textContent: 'Post now' });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });

      async function fire() {
        if (timer) { clearInterval(timer); timer = null; }
        now.disabled = true;
        now.textContent = 'Posting…';
        try {
          const signed = await doPublish();
          published = true;
          clearComposeDraft(pubkey);
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
        author,
        h('p', { className: 'hint', textContent: 'Review before it posts.' }),
        previewScroll,
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

    // Offer to resume a saved draft (or start fresh) before opening the editor.
    function showDraftChooser(saved) {
      modal.innerHTML = '';
      // Collapse horizontal whitespace and cap long blank-line runs, but keep
      // real newlines — this preview renders with white-space: pre-wrap, and
      // "Resume draft" loads the exact saved text, so the preview should look
      // like what's about to be restored instead of flattening it to one line.
      const snippet = (saved.text || '').trim().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
      const preview = snippet.length > 160 ? snippet.slice(0, 160) + '…' : snippet;
      const when = saved.savedAt ? ' from ' + relativeTime(Math.floor(saved.savedAt / 1000)) : '';
      const mediaNote = saved.media && saved.media.length
        ? saved.media.length + ' attachment' + (saved.media.length > 1 ? 's' : '')
        : '';

      const resume = h('button', { className: 'primary', textContent: 'Resume draft' });
      resume.addEventListener('click', () => {
        draft = { text: saved.text || '', media: (saved.media || []).slice() };
        showEditor();
      });
      const fresh = h('button', { className: 'ghost', textContent: 'Start fresh' });
      fresh.addEventListener('click', () => {
        clearComposeDraft(pubkey);
        draft = { text: initialText || '', media: [] };
        showEditor();
      });

      const parts = [
        h('h3', { textContent: 'Resume your draft?' }),
        h('p', { className: 'hint', textContent: 'You have an unsaved draft' + when + '.' }),
      ];
      if (preview) parts.push(h('div', { className: 'draft-preview', textContent: preview }));
      if (mediaNote) parts.push(h('p', { className: 'draft-preview-meta', textContent: mediaNote }));
      parts.push(h('div', { className: 'actions' }, [resume, fresh]));
      modal.append(...parts);
    }

    const saved = await loadComposeDraft(pubkey);
    const hasSaved = !!(saved && ((saved.text && saved.text.trim()) || (saved.media && saved.media.length)));

    openModal(
      () => { if (hasSaved) showDraftChooser(saved); else showEditor(); },
      () => {
        if (timer) { clearInterval(timer); timer = null; }
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        // Persist on close only once the user has actually edited — closing the
        // chooser without choosing must not overwrite the saved draft.
        if (!published && enteredEditor) persistDraft();
      }
    );
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

  // First-run profile setup for a freshly generated key: a short, skippable
  // wizard (name → photo → bio). On exit it publishes whatever was filled in
  // (kind:0) and lands on the Profile tab to finish the rest. The keystore is
  // unlocked from account creation, so signing needs no PIN. Every exit path —
  // Finish, "I'll do this later", the X, or the backdrop — runs `commit` once
  // (guarded), which publishes BEFORE closing so the profile never flashes the
  // interim auto-generated cocktail name.
  function profileSetupWizard(newPubkey) {
    const draft = { display_name: '', picture: '', about: '' };
    const STEPS = 3;
    let step = 1;
    let committing = false;

    async function commit() {
      if (committing) return;
      committing = true;
      // Only send fields the user actually filled in. publishProfile deletes any
      // empty field it's handed, so passing blanks would wipe metadata rather
      // than leave it untouched — keep this purely additive.
      const fields = {};
      if (draft.display_name.trim()) fields.display_name = draft.display_name.trim();
      if (draft.picture) fields.picture = draft.picture;
      if (draft.about.trim()) fields.about = draft.about.trim();
      const hasContent = Object.keys(fields).length > 0;
      // Safety net: publishProfile signs with whatever account is active. Only
      // publish if the active account is still the one this wizard was opened
      // for — never risk overwriting a different account's profile.
      const targetOk = !newPubkey || state.activePubkey === newPubkey;
      if (hasContent && !targetOk) {
        toast('Profile setup skipped — active account changed.', 'error');
      } else if (hasContent) {
        const primaryBtn = $('modal').querySelector('button.primary');
        if (primaryBtn) { primaryBtn.disabled = true; primaryBtn.textContent = 'Saving…'; }
        // Publish and wait for the store to update BEFORE navigating/closing, so
        // the Profile tab renders the chosen name, not the interim cocktail name.
        try {
          await publishProfile(fields, null); // keystore unlocked → no step-up PIN
        } catch (e) {
          toast(e.message, 'error');
        }
      }
      const tab = document.querySelector('.tab[data-tab="profile"]');
      if (tab) tab.click();
      renderMain();
      closeModal();
      if (hasContent && targetOk) toast('Profile saved', 'success');
    }

    openModal(
      (modal) => {
        const xBtn = h('button', { className: 'modal-x', title: 'Skip' });
        xBtn.appendChild(icon('x'));
        xBtn.addEventListener('click', commit);
        const body = h('div', { className: 'setup-modal' });
        modal.append(xBtn, body);

        const head = (title, sub) => {
          const parts = [
            h('div', { className: 'setup-progress', textContent: 'Step ' + step + ' of ' + STEPS }),
            h('h3', { textContent: title }),
          ];
          if (sub) parts.push(h('p', { className: 'hint', textContent: sub }));
          return parts;
        };

        const footer = (primaryLabel, onPrimary) => {
          const row = h('div', { className: 'actions setup-actions' });
          if (step > 1) {
            const back = h('button', { className: 'ghost', textContent: 'Back' });
            back.addEventListener('click', () => { step -= 1; render(); });
            row.append(back);
          }
          const primary = h('button', { className: 'primary', textContent: primaryLabel });
          primary.addEventListener('click', onPrimary);
          row.append(primary);
          const later = h('button', { className: 'setup-skip', textContent: "I'll do this later" });
          later.addEventListener('click', commit);
          return h('div', {}, [row, later]);
        };

        function render() {
          body.innerHTML = '';
          if (step === 1) renderName();
          else if (step === 2) renderPhoto();
          else renderBio();
        }

        function renderName() {
          const input = h('input', { type: 'text', placeholder: 'e.g. Gatsby' });
          input.value = draft.display_name;
          input.addEventListener('input', () => { draft.display_name = input.value; });
          body.append(
            ...head('What should people call you?', 'Your display name — you can change it any time.'),
            h('label', { className: 'field-label', textContent: 'Display name' }),
            input,
            footer('Continue', () => { step = 2; render(); })
          );
          setTimeout(() => input.focus(), 30);
        }

        function renderPhoto() {
          const prev = h('div', { className: 'upload-preview' });
          const overlay = h('span', { className: 'upload-overlay' });
          overlay.append(icon('camera'));
          const fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.accept = 'image/*';
          fileInput.style.display = 'none';
          const capLabel = h('span', { className: 'upload-cap-label' });
          const capHint = h('span', { className: 'upload-cap-hint', textContent: 'JPG, PNG or GIF' });
          const setPreview = (url) => {
            prev.innerHTML = '';
            prev.classList.toggle('empty', !url);
            if (url) {
              const im = document.createElement('img');
              im.referrerPolicy = 'no-referrer';
              im.src = url;
              prev.append(im);
            }
            prev.append(overlay);
            capLabel.textContent = url ? 'Change photo' : 'Upload a photo';
          };
          setPreview(draft.picture);
          const trigger = () => fileInput.click();
          prev.addEventListener('click', trigger);
          const caption = h('div', { className: 'upload-caption' }, [capLabel, capHint]);
          caption.addEventListener('click', trigger);
          fileInput.addEventListener('change', async () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            prev.classList.add('uploading');
            const before = capLabel.textContent;
            capLabel.textContent = 'Uploading…';
            try {
              const u = await uploadImage(file, 'profile');
              draft.picture = u;
              setPreview(u);
            } catch (e) {
              capLabel.textContent = before;
              toast(e.message, 'error');
            }
            prev.classList.remove('uploading');
            fileInput.value = '';
          });
          body.append(
            ...head('Add a photo', 'Optional — a picture helps people recognize you.'),
            h('div', { className: 'upload-row', role: 'button' }, [prev, caption, fileInput]),
            footer('Continue', () => { step = 3; render(); })
          );
        }

        function renderBio() {
          const ta = document.createElement('textarea');
          ta.value = draft.about;
          ta.placeholder = 'A sentence or two about you.';
          ta.addEventListener('input', () => { draft.about = ta.value; });
          body.append(
            ...head('Write a short bio', 'Optional — you can flesh out your profile next.'),
            h('label', { className: 'field-label', textContent: 'About' }),
            ta,
            footer('Finish', commit)
          );
        }

        render();
      },
      commit
    );
  }

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

  // ---- wallet (NWC) backup to relays — NIP-78, encrypted to self ----
  // Mirrors zap.cooking: the connection string is a spendable secret, so it is
  // encrypted to the account's own key (NIP-44, NIP-04 fallback) and stored as a
  // replaceable kind:30078 record that can be restored on another device.
  const NWC_BACKUP_DTAG = 'sidecar:nwc-backup';

  async function hasNwcBackup() {
    return !!(await fetchBackupEvent(NWC_BACKUP_DTAG));
  }

  async function backupNwcToRelays() {
    const { connection } = await call({ type: 'SIDECAR_GET_NWC' });
    if (!connection) throw new Error('No wallet connected to back up');
    let ciphertext, algo;
    try {
      ciphertext = await call({ type: 'SIDECAR_OWNER_ENCRYPT', plaintext: connection, nip: 44 });
      algo = 'nip44';
    } catch (_) {
      ciphertext = await call({ type: 'SIDECAR_OWNER_ENCRYPT', plaintext: connection, nip: 4 });
      algo = 'nip04';
    }
    const event = {
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', NWC_BACKUP_DTAG], ['encryption', algo]],
      content: ciphertext,
    };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event });
    await publishSigned(signed);
  }

  async function restoreNwcFromRelays() {
    const ev = await fetchBackupEvent(NWC_BACKUP_DTAG);
    if (!ev) throw new Error('No wallet backup found on your relays');
    const scheme = (ev.tags.find((x) => x[0] === 'encryption') || [])[1];
    const nip = scheme === 'nip04' ? 4 : 44;
    const connection = await call({ type: 'SIDECAR_OWNER_DECRYPT', ciphertext: ev.content, nip });
    if (!connection || !connection.startsWith('nostr+walletconnect://')) {
      throw new Error('Backup could not be read');
    }
    // Validate with a getInfo round-trip before saving, like manual connect.
    const client = window.SidecarNWC.makeClient(connection);
    await client.getInfo();
    client.close();
    await call({ type: 'SIDECAR_SET_NWC', connection });
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

  // ---- NIP-65 relay list editor (Profile tab) ----
  // Loads the account's published read/write relays; if none exist yet, seeds
  // the editor from Sidecar's own configured relays as a starting point.
  async function loadNip65Editor(pubkey) {
    const n = await getNip65(pubkey);
    if (n) {
      const urls = [...new Set([...n.read, ...n.write])];
      return urls.map((url) => ({ url, read: n.read.includes(url), write: n.write.includes(url) }));
    }
    const configured = await call({ type: 'SIDECAR_GET_RELAYS' });
    return Object.keys(configured).map((url) => ({
      url,
      read: configured[url].read !== false,
      write: configured[url].write !== false,
    }));
  }

  function renderNip65Section(view, active) {
    const setting = h('div', { className: 'setting nip65-setting' });
    setting.append(
      h('h3', { textContent: 'Relays' }),
      h('p', {
        className: 'hint',
        textContent:
          'Your public relay list (NIP-65) — tells other Nostr apps where to find your notes and where to send you replies and DMs. Keep it small and reliable.',
      })
    );

    const status = h('p', { className: 'hint compact nip65-status', textContent: 'Loading…' });
    const list = h('div', { className: 'list flat nip65-list' });
    const warn = h('p', { className: 'hint warn nip65-warn' });
    const addInput = h('input', { type: 'text', placeholder: 'wss://relay.example.com' });
    const addBtn = h('button', { className: 'secondary', textContent: 'Add' });
    const err = h('div', { className: 'error' });
    const publishBtn = h('button', { className: 'primary', textContent: 'Publish relay list' });

    setting.append(
      status,
      list,
      warn,
      h('div', { className: 'row-actions' }, [addInput, addBtn]),
      err,
      h('div', { className: 'actions nip65-publish' }, [publishBtn])
    );
    view.append(setting);

    let relayList = [];

    function updateWarn() {
      if (!relayList.some((r) => r.write)) {
        warn.textContent = 'No write relays selected — other apps may not find your new notes.';
      } else if (!relayList.some((r) => r.read)) {
        warn.textContent = 'No read relays selected — you may not see replies or mentions here.';
      } else {
        warn.textContent = '';
      }
    }

    function renderRows() {
      if (!relayList.length) {
        listState(list, 'No relays yet — add one below.');
        updateWarn();
        return;
      }
      list.innerHTML = '';
      relayList.forEach((r, i) => {
        const readCb = h('input', { type: 'checkbox' });
        readCb.checked = r.read;
        readCb.addEventListener('change', () => { r.read = readCb.checked; updateWarn(); });
        const writeCb = h('input', { type: 'checkbox' });
        writeCb.checked = r.write;
        writeCb.addEventListener('change', () => { r.write = writeCb.checked; updateWarn(); });

        const rm = iconButton('Remove', 'trash', () => {
          relayList.splice(i, 1);
          renderRows();
        });
        rm.classList.add('nip65-rm');

        // Stacked layout: the URL wraps on its own line, then a toggles row —
        // the sidebar is too narrow to keep the URL and Read/Write on one line.
        const row = h('div', { className: 'item nip65-row' }, [
          h('div', { className: 'nip65-url', textContent: r.url }),
          h('div', { className: 'nip65-controls' }, [
            h('label', { className: 'nip65-chip' }, [readCb, document.createTextNode('Read')]),
            h('label', { className: 'nip65-chip' }, [writeCb, document.createTextNode('Write')]),
            rm,
          ]),
        ]);
        list.append(row);
      });
      updateWarn();
    }

    addBtn.addEventListener('click', () => {
      let url = addInput.value.trim();
      if (!url) return;
      if (!/^wss?:\/\//i.test(url)) url = 'wss://' + url;
      url = url.replace(/\/+$/, ''); // drop trailing slash so wss://x and wss://x/ dedupe
      if (!/^wss?:\/\/[^/]+/i.test(url)) { err.textContent = "That doesn't look like a relay URL."; return; }
      if (relayList.some((r) => r.url === url)) { addInput.value = ''; return; }
      err.textContent = '';
      relayList.push({ url, read: true, write: true });
      addInput.value = '';
      renderRows();
    });

    publishBtn.addEventListener('click', async () => {
      err.textContent = '';
      if (!relayList.length) { err.textContent = 'Add at least one relay first.'; return; }
      if (!relayList.some((r) => r.read || r.write)) {
        err.textContent = 'Check Read or Write on at least one relay first.';
        return;
      }
      publishBtn.disabled = true;
      publishBtn.textContent = 'Publishing…';
      try {
        await publishNip65(active.pubkey, relayList);
        status.textContent = 'Published ✓';
        status.classList.add('done');
        toast('Relay list published', 'success');
      } catch (e) {
        err.textContent = e.message;
        toast(e.message, 'error');
      }
      publishBtn.disabled = false;
      publishBtn.textContent = 'Publish relay list';
    });

    loadNip65Editor(active.pubkey)
      .then((initial) => {
        relayList = initial;
        status.textContent = relayList.length ? 'Loaded from your current relay list.' : 'Not published yet.';
        renderRows();
      })
      .catch(() => {
        status.textContent = 'Could not load your current relay list.';
        renderRows();
      });
  }

  // ---- Follow-list recovery (Powered by Mutable — ported from github.com/dmnyc/mutable) ----
  // kind:3 is replaceable, so a buggy client publishing an empty/short list
  // overwrites your follows everywhere. Relays don't delete old versions though —
  // they just stop serving them as "current". Scanning a broad relay set with a
  // limit>1 turns them up, so the user can republish a healthy earlier version.
  // Cast a WIDE net when scanning for old versions — coverage beats reliability
  // here (dead relays just time out). Includes the big general relays where a
  // user likely published over the years, plus archival/cache relays that keep
  // historical events. Queried on top of the user's own configured + NIP-65 relays.
  const FOLLOW_SCAN_RELAYS = [
    'wss://purplepag.es',        // aggregates kind:0/3/10002
    'wss://relay.primal.net',
    'wss://cache0.primal.net',   // Primal caches keep historical events
    'wss://cache1.primal.net',
    'wss://cache2.primal.net',
    'wss://nos.lol',
    'wss://relay.snort.social',
    'wss://relay.damus.io',      // dying, but historically the biggest default → old copies live here
    'wss://nostr.wine',
    'wss://offchain.pub',
    'wss://nostr.mom',
    'wss://relay.noswhere.com',
  ];
  // Where a RESTORED list is republished (in addition to the account's own write
  // relays) — writable, broad-reach relays only, so the restore actually lands.
  const FOLLOW_PUBLISH_RELAYS = ['wss://purplepag.es', 'wss://nos.lol', 'wss://offchain.pub', 'wss://nostr.mom'];

  async function scanFollowListHistory(pubkey) {
    const configured = await relayUrls(false);
    const n = await getNip65(pubkey);
    const nip65 = n ? [...n.read, ...n.write] : [];
    const relays = [...new Set([...configured, ...nip65, ...FOLLOW_SCAN_RELAYS])];

    const byId = new Map();
    const responding = new Set();
    await Promise.all(
      relays.map(async (relay) => {
        try {
          const evs = await Promise.race([
            getPool().querySync([relay], { kinds: [3], authors: [pubkey], limit: 20 }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000)),
          ]);
          if (evs && evs.length) responding.add(relay);
          (evs || []).forEach((ev) => {
            if (ev.kind !== 3 || ev.pubkey !== pubkey) return;
            let c = byId.get(ev.id);
            if (!c) {
              const set = new Set(ev.tags.filter((t) => t[0] === 'p' && t[1] && t[1].length === 64).map((t) => t[1]));
              c = { event: ev, eventId: ev.id, createdAt: ev.created_at, followCount: set.size, foundOnRelays: [] };
              byId.set(ev.id, c);
            }
            if (!c.foundOnRelays.includes(relay)) c.foundOnRelays.push(relay);
          });
        } catch (_) {}
      })
    );

    const candidates = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
    const current = candidates[0] || null;
    const recommended = pickRecommendedRecovery(candidates, current);
    return { current, candidates, recommended, respondingRelays: [...responding] };
  }

  function pickRecommendedRecovery(candidates, current) {
    const ranked = [...candidates]
      .sort((a, b) => b.followCount - a.followCount || b.createdAt - a.createdAt)
      .filter((c) => c.followCount > 0);
    const currentCount = current ? current.followCount : 0;
    const currentId = current ? current.eventId : null;
    for (const c of ranked) {
      if (c.eventId === currentId) continue;
      if (c.followCount > currentCount) return c;
    }
    return null;
  }

  async function recoverFollowList(candidate) {
    const preserved = candidate.event.tags.filter((t) => t[0] === 'p' && t[1] && t[1].length === 64);
    const event = {
      kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      tags: preserved,
      content: candidate.event.content || '',
    };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event });
    const targets = [...new Set([...(await postRelays()), ...FOLLOW_PUBLISH_RELAYS])];
    return publishToRelays(targets, signed);
  }

  function mutableAttribution() {
    const a = h('a', {
      className: 'mutable-credit',
      href: 'https://mutable.top',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    const logo = document.createElement('img');
    logo.className = 'mutable-logo';
    logo.src = 'icons/apps/mutable.svg';
    logo.alt = '';
    a.append(logo, h('span', { textContent: 'Powered by Mutable' }));
    return a;
  }

  function followRecoveryModal(active) {
    openModal((modal) => {
      const xBtn = h('button', { className: 'modal-x', title: 'Close' });
      xBtn.appendChild(icon('x'));
      xBtn.addEventListener('click', closeModal);
      const body = h('div', { className: 'recovery-modal' });
      modal.append(xBtn, body);

      let lastRes = null;
      const clear = () => { body.innerHTML = ''; };
      const spinner = (text) =>
        h('div', { className: 'recv-waiting' }, [h('span', { className: 'recv-spinner' }), h('span', { textContent: text })]);

      function showIntro() {
        clear();
        const scan = h('button', { className: 'primary', textContent: 'Scan relays' });
        scan.addEventListener('click', runScan);
        body.append(
          h('h3', { textContent: 'Restore follow list' }),
          h('p', {
            className: 'hint',
            textContent:
              'If another app wiped or shrank your follows, scan your relays for older versions of your follow list and republish a healthy one.',
          }),
          h('div', { className: 'actions' }, [scan]),
          mutableAttribution()
        );
      }

      async function runScan() {
        clear();
        body.append(h('h3', { textContent: 'Scanning…' }), spinner('Checking your relays for older versions…'));
        try {
          lastRes = await scanFollowListHistory(active.pubkey);
          showResults();
        } catch (e) {
          showError(e.message);
        }
      }

      function showResults() {
        clear();
        const res = lastRes;
        // Empty (0-follow) versions are the damage, not something worth restoring — hide them.
        const shown = res.candidates.filter((c) => c.followCount > 0);
        if (!shown.length) {
          const retry = h('button', { className: 'secondary', textContent: 'Scan again' });
          retry.addEventListener('click', runScan);
          body.append(
            h('h3', { textContent: 'No versions found' }),
            h('p', { className: 'hint', textContent: 'No follow-list versions with follows turned up on your relays.' }),
            h('div', { className: 'actions' }, [retry])
          );
          return;
        }
        body.append(
          h('h3', { textContent: 'Choose a version to restore' }),
          h('p', {
            className: 'hint',
            textContent:
              'Found ' + shown.length + ' version' + (shown.length === 1 ? '' : 's') +
              ' across ' + res.respondingRelays.length + ' relay' + (res.respondingRelays.length === 1 ? '' : 's') + '.',
          })
        );
        const list = h('div', { className: 'list flat recovery-list' });
        shown.forEach((c) => {
          const isCurrent = res.current && c.eventId === res.current.eventId;
          const isRec = res.recommended && c.eventId === res.recommended.eventId;
          const badges = [];
          if (isCurrent) badges.push(h('span', { className: 'recovery-badge cur', textContent: 'Current' }));
          if (isRec) badges.push(h('span', { className: 'recovery-badge rec', textContent: 'Recommended' }));
          const meta = h('div', { className: 'recovery-meta' }, [
            h('div', { className: 'recovery-count' }, [
              h('strong', { textContent: c.followCount.toLocaleString('en-US') }),
              document.createTextNode(' following'),
            ]),
            h('div', {
              className: 'recovery-sub',
              textContent: relativeTime(c.createdAt) + ' · ' + c.foundOnRelays.length + ' relay' + (c.foundOnRelays.length === 1 ? '' : 's'),
            }),
            badges.length ? h('div', { className: 'recovery-badges' }, badges) : document.createTextNode(''),
          ]);
          const row = h('div', { className: 'item recovery-row' + (isRec ? ' rec' : '') }, [meta]);
          if (!isCurrent && c.followCount > 0) {
            const pick = h('button', { className: 'mini', textContent: 'Restore' });
            pick.addEventListener('click', () => showConfirm(c));
            row.append(h('div', { className: 'item-actions' }, [pick]));
          }
          list.append(row);
        });
        body.append(list, mutableAttribution());
      }

      function showConfirm(c) {
        clear();
        const restore = h('button', { className: 'primary', textContent: 'Restore' });
        restore.addEventListener('click', () => runRestore(c));
        const back = h('button', { className: 'ghost', textContent: 'Back' });
        back.addEventListener('click', showResults);
        body.append(
          h('h3', { textContent: 'Restore this version?' }),
          h('p', { className: 'hint warn', textContent: 'This replaces your current follow list everywhere and cannot be automatically undone.' }),
          h('div', { className: 'recovery-confirm' }, [
            h('div', { className: 'recovery-count-lg' }, [
              h('strong', { textContent: c.followCount.toLocaleString('en-US') }),
              document.createTextNode(' accounts followed'),
            ]),
            h('div', {
              className: 'recovery-sub',
              textContent: new Date(c.createdAt * 1000).toLocaleString() + ' · ' + relativeTime(c.createdAt),
            }),
          ]),
          h('div', { className: 'actions' }, [restore, back])
        );
      }

      async function runRestore(c) {
        clear();
        body.append(h('h3', { textContent: 'Restoring…' }), spinner('Publishing your follow list…'));
        try {
          const ok = await recoverFollowList(c);
          // Invalidate cached follow data so the profile count + @mention list
          // reflect the restore.
          followCountCache.delete(active.pubkey);
          followListCache = null;
          followListPubkey = null;
          showDone(ok, c);
          toast('Follow list restored', 'success');
        } catch (e) {
          showError(e.message);
        }
      }

      function showDone(ok, c) {
        clear();
        const done = h('button', { className: 'primary', textContent: 'Done' });
        done.addEventListener('click', () => { closeModal(); renderProfile(); });
        body.append(
          h('h3', { textContent: 'Follow list restored' }),
          h('p', {
            className: 'hint',
            textContent:
              'Republished ' + c.followCount.toLocaleString('en-US') + ' follows to ' + ok + ' relay' + (ok === 1 ? '' : 's') + '.',
          }),
          h('div', { className: 'actions' }, [done])
        );
      }

      function showError(msg) {
        clear();
        const retry = h('button', { className: 'secondary', textContent: 'Try again' });
        retry.addEventListener('click', lastRes ? showResults : runScan);
        body.append(
          h('h3', { textContent: 'Something went wrong' }),
          h('p', { className: 'error', textContent: msg || 'Please try again.' }),
          h('div', { className: 'actions' }, [retry])
        );
      }

      showIntro();
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
      const status = h('div', { className: 'backup-status', textContent: 'Not backed up' });
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

    // Follow-list recovery — scan relays for an older kind:3 and republish it.
    const recoveryWrap = h('div', { className: 'export-block recovery-block' });
    recoveryWrap.append(
      h('p', {
        className: 'hint',
        textContent: 'Lost follows to a buggy client? Scan your relays for an older version of your follow list and restore it.',
      })
    );
    const recoveryBtn = h('button', { className: 'secondary', textContent: 'Restore follow list' });
    recoveryBtn.addEventListener('click', () => followRecoveryModal(active));
    recoveryWrap.append(recoveryBtn, mutableAttribution());
    setting.append(recoveryWrap);

    view.append(setting);
  }

  // ====================== Wallet (NWC / NIP-47) ======================
  let nwc = null; // active SidecarNWC client for the current account
  let nwcPubkey = null; // which account the client belongs to
  const fmtSats = (n) => Math.round(n).toLocaleString('en-US');
  const msatToSat = (m) => Math.floor((m || 0) / 1000);

  // Shared sats cap + a numeric-only, capped amount input used by send/receive/zap.
  const MAX_SATS = 100000000; // 100M
  function satsInput(placeholder) {
    const el = h('input', { type: 'text', inputMode: 'numeric', placeholder: placeholder });
    el.addEventListener('input', () => {
      let v = el.value.replace(/[^0-9]/g, '');
      if (v) v = String(Math.min(parseInt(v, 10), MAX_SATS));
      el.value = v;
    });
    return el;
  }
  const isLnInvoice = (v) => /^ln(bc|tb)[0-9]/i.test(v);
  const isLnAddress = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

  // Build (or reuse) the NWC client for the active account from its stored string.
  async function ensureNwc() {
    const pk = state.activePubkey;
    if (nwc && nwcPubkey === pk) return nwc;
    if (nwc) { try { nwc.close(); } catch (_) {} nwc = null; nwcPubkey = null; }
    const { connection } = await call({ type: 'SIDECAR_GET_NWC' });
    if (!connection) return null;
    nwc = window.SidecarNWC.makeClient(connection);
    nwcPubkey = pk;
    return nwc;
  }

  let walletRenderSeq = 0;
  async function renderWallet() {
    const view = $('wallet-view');
    const seq = ++walletRenderSeq;
    if (!state.activePubkey) {
      view.innerHTML = '';
      view.append(h('p', { className: 'hint', textContent: 'No active account.' }));
      return;
    }
    const { has } = await call({ type: 'SIDECAR_HAS_NWC' });
    // Bail if another renderWallet() started during the await — otherwise both
    // would clear + append a card, leaving two overlapping sticky cards.
    if (seq !== walletRenderSeq) return;
    view.innerHTML = '';
    if (!has) {
      renderWalletConnect(view);
      return;
    }
    renderWalletConnected(view);
  }

  function renderWalletConnect(view) {
    view.append(h('h2', { textContent: 'Wallet' }));
    view.append(
      h('p', {
        className: 'hint',
        textContent:
          'Connect a Lightning wallet with Nostr Wallet Connect (NWC). Paste a connection string from Alby Hub, Rizful, YakiHonne, or any NWC-capable wallet. Sidecar never holds your funds.',
      })
    );
    const input = h('textarea', { className: 'compose-text nwc-input', placeholder: 'nostr+walletconnect://…' });
    const err = h('div', { className: 'error' });
    const connect = h('button', { className: 'primary wallet-connect-btn', textContent: 'Connect wallet' });
    connect.addEventListener('click', async () => {
      const conn = input.value.trim();
      if (!conn) return (err.textContent = 'Paste a connection string.');
      if (!conn.startsWith('nostr+walletconnect://')) return (err.textContent = "That doesn't look like an NWC string.");
      err.textContent = '';
      connect.disabled = true;
      connect.textContent = 'Connecting…';
      try {
        // Validate by parsing + a getInfo round-trip before saving.
        const client = window.SidecarNWC.makeClient(conn);
        await client.getInfo();
        client.close();
        await call({ type: 'SIDECAR_SET_NWC', connection: conn });
        toast('Wallet connected', 'success');
        renderWallet();
      } catch (e) {
        err.textContent = e.message || 'Could not reach that wallet.';
        toast('Could not connect wallet', 'error');
        connect.disabled = false;
        connect.textContent = 'Connect wallet';
      }
    });
    view.append(input, err, connect);

    // Restore a previously backed-up connection from the user's relays. Kept in
    // its own block (with its own status line) so its messages don't land in the
    // middle of the connect form.
    const restoreBlock = h('div', { className: 'wallet-restore-block' });
    restoreBlock.append(h('div', { className: 'wallet-or', textContent: 'or' }));
    const restore = h('button', { className: 'secondary', textContent: 'Restore from Nostr' });
    const restoreNote = h('p', { className: 'hint compact', textContent: 'Bring back a wallet you backed up to your relays.' });
    restore.addEventListener('click', async () => {
      restore.disabled = true;
      restore.textContent = 'Checking relays…';
      try {
        await restoreNwcFromRelays();
        toast('Wallet restored', 'success');
        renderWallet();
      } catch (e) {
        toast(e.message, 'error');
        restore.disabled = false;
        restore.textContent = 'Restore from Nostr';
      }
    });
    restoreBlock.append(restore, restoreNote);
    view.append(restoreBlock);

    // Help users who don't have an NWC-capable wallet yet.
    const find = h('a', {
      className: 'explore-link wallet-find-link',
      href: '#',
      textContent: 'Need a wallet? See suggestions →',
    });
    find.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('wallets.html') });
    });
    view.append(find);
  }

  async function renderWalletConnected(view) {
    // Balance card — show the last-known balance instantly, refresh below.
    const cached = balanceCache.pubkey === state.activePubkey && balanceCache.sats != null;
    // Sentinel above the card; its visibility (not scrollTop) drives the collapse.
    const sentinel = h('div', { className: 'wallet-sentinel' });
    view.append(sentinel);
    const card = h('div', { className: 'wallet-card' });
    // When collapsed, tapping the card (outside its buttons) scrolls back to top.
    card.addEventListener('click', (e) => {
      if (card.classList.contains('compact') && !e.target.closest('button')) {
        document.querySelector('.content').scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    const bal = h('div', {
      className: 'wallet-balance' + (cached ? '' : ' loading'),
      textContent: cached ? fmtSats(balanceCache.sats) : '…',
    });
    const unit = h('div', { className: 'wallet-unit', textContent: 'sats' });
    const refresh = h('button', { className: 'wallet-refresh', title: 'Refresh' });
    refresh.appendChild(icon('refresh'));
    refresh.addEventListener('click', () => renderWallet());
    // Privacy toggle on the balance card (masks balance, history, budgets).
    const eye = h('button', { className: 'wallet-eye', title: hideBalances ? 'Show balances' : 'Hide balances' });
    eye.appendChild(icon(hideBalances ? 'eye-off' : 'eye'));
    eye.addEventListener('click', async () => {
      hideBalances = !hideBalances;
      await call({ type: 'SIDECAR_SET_SETTINGS', settings: { hideBalances } });
      applyHideBalances();
      eye.innerHTML = '';
      eye.appendChild(icon(hideBalances ? 'eye-off' : 'eye'));
      eye.title = hideBalances ? 'Show balances' : 'Hide balances';
    });
    card.append(eye, refresh, h('div', { className: 'wallet-bal-label', textContent: 'Balance' }), bal, unit);
    view.append(card);

    // Actions
    const actions = h('div', { className: 'wallet-actions' });
    const sendBtn = h('button', { className: 'primary' }, [icon('arrow-up-right'), h('span', { textContent: 'Send' })]);
    const recvBtn = h('button', { className: 'secondary' }, [icon('arrow-down-left'), h('span', { textContent: 'Receive' })]);
    sendBtn.addEventListener('click', () => sendModal());
    recvBtn.addEventListener('click', () => receiveModal());
    actions.append(sendBtn, recvBtn);
    view.append(actions);

    // Transactions
    const txWrap = h('div', { className: 'setting' });
    txWrap.append(h('h3', { textContent: 'Recent transactions' }));
    const txList = h('div', { className: 'list flat' });
    txWrap.append(txList);
    view.append(txWrap);

    // Backup to relays (detection mirrors zap.cooking)
    view.append(renderWalletBackup());

    // Per-site WebLN spending budgets
    view.append(renderSitePayments());

    // Disconnect
    const disc = h('button', { className: 'ghost wallet-disconnect', textContent: 'Disconnect wallet' });
    disc.addEventListener('click', () => disconnectModal());
    view.append(disc);

    // Self-custody disclaimer (bottom of the wallet screen).
    view.append(
      h('p', { className: 'wallet-disclaimer' }, [
        h('strong', { textContent: 'IMPORTANT: ' }),
        document.createTextNode(
          'Sidecar never holds user funds. You manage your own wallet and are responsible for securing it properly.'
        ),
      ])
    );

    // Bottom spacer that absorbs the card's collapse delta so the page height
    // stays constant when the balance card compacts (prevents scroll flicker).
    // The collapse observer is attached later, once content has loaded — see below.
    const spacer = h('div', { className: 'wallet-spacer' });
    view.append(spacer);

    // Load data
    let client = null;
    try { client = await ensureNwc(); } catch (_) {}
    if (!client) { view.innerHTML = ''; renderWalletConnect(view); return; }
    try {
      const b = await client.getBalance();
      balanceCache = { pubkey: state.activePubkey, sats: msatToSat(b && b.balance) };
      bal.textContent = fmtSats(balanceCache.sats);
    } catch (_) {
      if (!cached) { bal.textContent = '—'; unit.textContent = 'balance unavailable'; }
    }
    bal.classList.remove('loading');
    // Attach the collapse observer only after the balance and transactions have
    // loaded — while content is still resizing, an active observer would cross the
    // collapse trigger repeatedly and flicker (worst on the loading "…" state).
    await loadTransactions(txList, client);
    observeWalletCard(card, sentinel, spacer);
  }

  // Centered placeholder for list cards (loading / empty / error) so the text
  // sits in the middle of the card instead of jammed in the top-left corner.
  function listState(listEl, text) {
    listEl.innerHTML = '';
    listEl.append(h('p', { className: 'list-state', textContent: text }));
  }

  // Locally-recorded payment metadata (counterparty/comment/fee), keyed by the
  // BOLT11 invoice. NWC's list_transactions doesn't carry who we paid, so for
  // lightning-address sends we stash the address here and match it back by
  // invoice when rendering history. Capped to the most recent entries.
  const PAY_META_KEY = 'sidecar_pay_meta';
  function getPayMeta() {
    return new Promise((res) => {
      try {
        chrome.storage.local.get(PAY_META_KEY, (o) => res((o && o[PAY_META_KEY]) || {}));
      } catch (_) { res({}); }
    });
  }
  async function savePayMeta(invoice, meta) {
    if (!invoice) return;
    try {
      const all = await getPayMeta();
      all[invoice] = Object.assign({}, all[invoice], meta, { ts: Date.now() });
      const keys = Object.keys(all);
      if (keys.length > 300) {
        keys
          .sort((a, b) => (all[a].ts || 0) - (all[b].ts || 0))
          .slice(0, keys.length - 300)
          .forEach((k) => delete all[k]);
      }
      chrome.storage.local.set({ [PAY_META_KEY]: all });
    } catch (_) {}
  }

  const satsLabel = (n) => fmtSats(n) + (Math.round(n) === 1 ? ' sat' : ' sats');
  // fees_paid is in msats; show it rounded to the nearest whole sat.
  function fmtFeeMsat(msat) {
    return msat == null ? null : satsLabel(Math.round(msat / 1000));
  }
  function truncMid(s, head, tail) {
    s = String(s || '');
    head = head || 10; tail = tail || 8;
    return s.length > head + tail + 1 ? s.slice(0, head) + '…' + s.slice(-tail) : s;
  }

  async function loadTransactions(listEl, client) {
    const PAGE = 15;
    let offset = 0;
    let loading = false;
    const metaMap = await getPayMeta();
    const host = listEl.parentNode; // append the "Show more" button below the card
    const more = h('button', { className: 'ghost show-more-btn' });
    hide(more);
    more.textContent = 'Show more';
    if (host) host.append(more);

    listState(listEl, 'Loading…');

    async function loadPage() {
      if (loading) return;
      loading = true;
      try {
        const res = await client.listTransactions({ limit: PAGE, offset, unpaid: false });
        const txns = (res && res.transactions) || [];
        if (offset === 0) {
          if (!txns.length) { listState(listEl, 'No transactions yet.'); hide(more); return; }
          listEl.innerHTML = '';
        }
        txns.forEach((tx) => listEl.append(txRow(tx, metaMap)));
        offset += txns.length;
        // A full page back suggests there may be more to fetch.
        if (txns.length >= PAGE) { show(more); more.textContent = 'Show more'; }
        else hide(more);
      } catch (e) {
        if (offset === 0) listState(listEl, 'Could not load transactions.');
        hide(more);
      } finally {
        loading = false;
      }
    }
    more.addEventListener('click', () => { more.textContent = 'Loading…'; loadPage(); });
    loadPage();
  }

  function txDetailRow(label, value, copyValue, prose) {
    if (value == null || value === '') return null;
    const val = h('span', { className: 'tx-d-val' + (prose ? ' prose' : ''), textContent: String(value) });
    if (copyValue) {
      val.classList.add('copyable');
      val.title = 'Copy';
      val.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(String(copyValue));
          const old = val.textContent;
          val.textContent = 'Copied';
          val.classList.add('copied');
          setTimeout(() => { val.textContent = old; val.classList.remove('copied'); }, 1000);
        } catch (_) {}
      });
    }
    return h('div', { className: 'tx-d-row' }, [
      h('span', { className: 'tx-d-label', textContent: label }),
      val,
    ]);
  }

  function txRow(tx, metaMap) {
    const incoming = tx.type === 'incoming';
    const sats = msatToSat(tx.amount);
    const meta = (metaMap && tx.invoice && metaMap[tx.invoice]) || {};
    const counterparty = incoming ? '' : meta.address || '';

    const row = h('div', { className: 'item tx-row' });
    const ic = h('span', { className: 'tx-icon ' + (incoming ? 'in' : 'out') });
    ic.append(icon(incoming ? 'arrow-down' : 'arrow-up'));
    const label = counterparty || tx.description || (incoming ? 'Received' : 'Sent');
    const main = h('div', { className: 'item-main' }, [
      h('div', { className: 'item-label', textContent: label }),
      h('div', { className: 'item-sub', textContent: tx.settled_at ? relTime(tx.settled_at * 1000) : 'pending' }),
    ]);
    const amt = h('div', { className: 'tx-amt ' + (incoming ? 'in' : 'out'), textContent: (incoming ? '+' : '−') + fmtSats(sats) });
    const caret = h('span', { className: 'tx-caret' });
    caret.append(icon('chevron-down'));
    const head = h('div', { className: 'tx-head' }, [ic, main, amt, caret]);

    // Expandable invoice/payment details — built lazily on first open.
    const details = h('div', { className: 'tx-details hidden' });
    let built = false;
    function buildDetails() {
      const fee = tx.fees_paid != null ? tx.fees_paid : meta.feeMsat;
      const when = tx.settled_at || tx.created_at;
      const note = meta.comment || (tx.description && tx.description !== counterparty ? tx.description : '');
      const rows = [
        txDetailRow(incoming ? 'From' : 'To', counterparty),
        txDetailRow('Note', note, null, true),
        txDetailRow('Amount', satsLabel(sats)),
        incoming ? null : txDetailRow('Fee', fmtFeeMsat(fee)),
        txDetailRow('Date', when ? new Date(when * 1000).toLocaleString() : null),
        txDetailRow('Payment hash', tx.payment_hash ? truncMid(tx.payment_hash, 12, 8) : null, tx.payment_hash),
        txDetailRow('Preimage', tx.preimage ? truncMid(tx.preimage, 12, 8) : null, tx.preimage),
        txDetailRow('Invoice', tx.invoice ? truncMid(tx.invoice, 12, 10) : null, tx.invoice),
      ].filter(Boolean);
      if (!rows.length) {
        rows.push(h('div', { className: 'tx-d-row' }, [h('span', { className: 'tx-d-label', textContent: 'No extra details.' })]));
      }
      rows.forEach((r) => details.append(r));
      built = true;
    }

    head.addEventListener('click', () => {
      if (!built) buildDetails();
      const nowHidden = details.classList.toggle('hidden');
      row.classList.toggle('open', !nowHidden);
    });

    row.append(head, details);
    return row;
  }

  // Backup the NWC connection to relays, with detection of an existing backup.
  // Export the raw NWC connection string — PIN-gated step-up, then a copyable
  // reveal that auto-hides (mirrors the nsec reveal).
  function exportNwcModal() {
    if (!state.activePubkey) { toast('No active account', 'error'); return; }
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
          const r = await call({ type: 'SIDECAR_REVEAL_NWC', pubkey: state.activePubkey, pin: pin.value });
          if (!r.connection) throw new Error('No wallet connection saved for this account');
          nwcRevealModal(r.connection);
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
        h('h3', { textContent: 'Export wallet connection' }),
        h('p', { className: 'hint', textContent: 'Enter your PIN to reveal the NWC connection string for this account.' }),
        h('label', { textContent: 'PIN' }),
        pin,
        err,
        h('div', { className: 'actions' }, [go, cancel])
      );
      setTimeout(() => pin.focus(), 50);
    });
  }

  function nwcRevealModal(connection) {
    let remaining = NSEC_REVEAL_TIMEOUT_S;
    let timer = null;
    openModal(
      (modal) => {
        // Scannable QR — NWC URIs are case-sensitive, so don't uppercase, and use
        // level 'L' for the extra capacity these longer strings need.
        const canvas = document.createElement('canvas');
        canvas.className = 'recv-qr modal-qr';
        try { new window.QRious({ element: canvas, value: connection, size: 220, level: 'L' }); } catch (_) {}

        const box = h('div', { className: 'secret-box', textContent: connection });
        const copy = h('button', { className: 'secondary', textContent: 'Copy connection string' });
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(connection);
            toast('Connection string copied', 'success');
          } catch (_) {}
        });
        const done = h('button', { className: 'primary', textContent: "I've saved it" });
        done.addEventListener('click', closeModal);
        const countdown = h('p', {
          className: 'hint',
          textContent: 'Hiding in ' + remaining + 's. Reveal again with your PIN.',
        });
        timer = setInterval(() => {
          remaining -= 1;
          if (remaining <= 0) return closeModal();
          countdown.textContent = 'Hiding in ' + remaining + 's. Reveal again with your PIN.';
        }, 1000);
        modal.append(
          h('h3', { textContent: 'Wallet connection string' }),
          h('p', { className: 'hint', textContent: 'Scan in an NWC-compatible app, or copy the string below to connect the same wallet.' }),
          canvas,
          box,
          copy,
          h('p', { className: 'hint warn', textContent: 'This string can spend from your wallet up to its limits. Store it safely and never share it.' }),
          countdown,
          h('div', { className: 'actions' }, [done])
        );
      },
      () => { if (timer) { clearInterval(timer); timer = null; } }
    );
  }

  function renderWalletBackup() {
    const wrap = h('div', { className: 'setting wallet-backup' });
    wrap.append(h('h3', { textContent: 'Backup' }));
    wrap.append(h('p', { className: 'hint', textContent: 'Encrypt your wallet connection to your own key and store it on your relays (NIP-78). Restore it on another device or after a reset.' }));

    const status = h('span', { className: 'backup-status', textContent: 'Checking…' });
    const back = h('button', { className: 'secondary', textContent: 'Back up' });
    const restore = h('button', { className: 'secondary', textContent: 'Restore' });
    back.addEventListener('click', async () => {
      back.disabled = true;
      back.textContent = 'Backing up…';
      try {
        await backupNwcToRelays();
        status.textContent = 'Backed up ✓';
        status.classList.add('done');
        toast('Wallet backed up', 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
      back.disabled = false;
      back.textContent = 'Back up';
    });
    restore.addEventListener('click', async () => {
      restore.disabled = true;
      restore.textContent = 'Restoring…';
      try {
        await restoreNwcFromRelays();
        toast('Wallet restored', 'success');
        renderWallet();
      } catch (e) {
        toast(e.message, 'error');
        restore.disabled = false;
        restore.textContent = 'Restore';
      }
    });
    const exportBtn = h('button', { className: 'wallet-export-link', textContent: 'Export connection string' });
    exportBtn.append(icon('key'));
    exportBtn.addEventListener('click', exportNwcModal);
    hide(exportBtn); // shown only when a connection exists for the active account

    const card = h('div', { className: 'wallet-backup-card' }, [
      h('div', { className: 'wallet-backup-head' }, [
        h('span', { className: 'item-label', textContent: 'Wallet connection' }),
        status,
      ]),
      h('div', { className: 'wallet-backup-actions' }, [back, restore]),
      exportBtn,
    ]);
    wrap.append(card);

    hasNwcBackup()
      .then((has) => {
        status.textContent = has ? 'Backed up ✓' : 'Not backed up';
        status.classList.toggle('done', has);
      })
      .catch(() => {
        status.textContent = 'Not backed up';
      });
    // Only offer export when this account actually has a connection saved.
    call({ type: 'SIDECAR_HAS_NWC', pubkey: state.activePubkey })
      .then((r) => { if (r && r.has) show(exportBtn); })
      .catch(() => {});
    return wrap;
  }

  // Per-site WebLN spending budgets: sites allowed to pay from the wallet without
  // a prompt, up to a daily allowance. Lets the user review and revoke them.
  function renderSitePayments() {
    const wrap = h('div', { className: 'setting wallet-budgets' });
    wrap.append(h('h3', { textContent: 'Site payments' }));
    wrap.append(h('p', { className: 'hint', textContent: 'Sites allowed to pay from your wallet without asking, up to a daily budget. Revoke any time.' }));
    const list = h('div', { className: 'list flat' });
    wrap.append(list);
    listState(list, 'Loading…');
    call({ type: 'SIDECAR_GET_BUDGETS' })
      .then((budgets) => {
        const hosts = Object.keys(budgets || {}).sort();
        if (!hosts.length) { list.classList.add('empty'); listState(list, 'No sites have a spending budget.'); return; }
        list.classList.remove('empty');
        list.innerHTML = '';
        hosts.forEach((host) => list.append(budgetRow(host, budgets[host])));
      })
      .catch(() => listState(list, 'Could not load budgets.'));
    return wrap;
  }

  function budgetRow(host, b) {
    const row = h('div', { className: 'item' });
    const sub = h('div', { className: 'item-sub' }, [
      h('span', { className: 'amt-hide', textContent: fmtSats(b.remainingSats) }),
      document.createTextNode(' of '),
      h('span', { className: 'amt-hide', textContent: fmtSats(b.budgetSats) }),
      document.createTextNode(' sats left today'),
    ]);
    const main = h('div', { className: 'item-main' }, [
      h('div', { className: 'item-label', textContent: host }),
      sub,
    ]);
    const edit = iconButton('Edit budget', 'edit', () => editBudgetModal(host, b));
    const rm = iconButton('Revoke budget', 'trash', async () => {
      await call({ type: 'SIDECAR_REVOKE_BUDGET', host });
      renderWallet();
    });
    row.append(main, h('div', { className: 'item-actions' }, [edit, rm]));
    return row;
  }

  function editBudgetModal(host, b) {
    openModal((modal) => {
      const err = h('div', { className: 'error' });
      const input = h('input', { type: 'text', inputMode: 'numeric', value: String(b.budgetSats || 0) });
      const save = h('button', { className: 'primary', textContent: 'Save budget' });
      save.addEventListener('click', async () => {
        err.textContent = '';
        const budgetSats = parseInt(input.value, 10);
        if (!budgetSats || budgetSats < 1) {
          err.textContent = 'Enter a daily budget in sats.';
          return;
        }
        try {
          await call({ type: 'SIDECAR_SET_BUDGET', host, budgetSats, perPaymentSats: b.perPaymentSats || 0 });
          closeModal();
          renderWallet();
          toast('Budget updated', 'success');
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Edit budget' }),
        h('p', {
          className: 'hint',
          textContent:
            'Daily amount ' + host + ' can spend without a prompt. Saving resets the remaining amount for today.',
        }),
        h('label', { textContent: 'Daily budget (sats)' }),
        input,
        err,
        h('div', { className: 'actions' }, [save, cancel])
      );
      setTimeout(() => input.focus(), 50);
    });
  }

  function sendModal() {
    openModal((modal) => {
      const input = h('textarea', { className: 'compose-text', placeholder: 'Lightning invoice (lnbc…) or lightning address' });
      const amountLabel = h('label', { className: 'hidden', textContent: 'Amount (sats)' });
      const amount = satsInput('Amount in sats');
      amount.classList.add('hidden');
      const comment = h('input', { className: 'send-comment', type: 'text', maxLength: 280, placeholder: 'Comment (optional)' });
      const err = h('div', { className: 'error' });
      const pay = h('button', { className: 'primary', textContent: 'Pay' });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);

      // Auto-detect: only a lightning address needs an amount (invoices carry it).
      function detect() {
        const v = input.value.replace(/^lightning:/i, '').trim();
        const needsAmount = isLnAddress(v) && !isLnInvoice(v);
        amount.classList.toggle('hidden', !needsAmount);
        amountLabel.classList.toggle('hidden', !needsAmount);
      }
      input.addEventListener('input', detect);

      pay.addEventListener('click', async () => {
        const val = input.value.replace(/^lightning:/i, '').trim();
        if (!val) return (err.textContent = 'Paste an invoice or lightning address.');
        err.textContent = '';
        const note = comment.value.trim();
        let address = ''; // lightning address, when sending to one
        try {
          const client = await ensureNwc();
          let invoice = val;
          if (isLnInvoice(val)) {
            // BOLT11 — amount is already in the invoice.
          } else if (isLnAddress(val)) {
            const sats = parseInt(amount.value, 10);
            if (!sats || sats < 1) return (err.textContent = 'Enter an amount in sats.');
            address = val;
            pay.disabled = true;
            pay.textContent = 'Paying…';
            invoice = await lnAddressToInvoice(val, sats * 1000, note || 'Sidecar payment');
          } else {
            return (err.textContent = 'Enter a BOLT11 invoice (lnbc…) or a lightning address.');
          }
          pay.disabled = true;
          pay.textContent = 'Paying…';
          const res = await client.payInvoice(invoice);
          // Record what NWC history won't keep: who we paid, the note, the fee —
          // keyed by invoice so txRow can match it back.
          const feeMsat = res && res.fees_paid;
          if (address || note || feeMsat != null) {
            await savePayMeta(invoice, { address, comment: note, feeMsat });
          }
          closeModal();
          toast('Payment sent' + (feeMsat != null ? ' · fee ' + fmtFeeMsat(feeMsat) : ''), 'success');
          renderWallet();
        } catch (e) {
          err.textContent = e.message;
          pay.disabled = false;
          pay.textContent = 'Pay';
        }
      });
      modal.append(
        h('h3', { textContent: 'Send' }),
        input,
        amountLabel,
        amount,
        comment,
        err,
        h('div', { className: 'actions' }, [pay, cancel])
      );
    });
  }

  const RECEIVE_PRESETS = [100, 1000, 5000, 10000];

  function receiveModal() {
    let pollTimer = null;
    const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

    openModal((modal) => {
      const xClose = h('button', { className: 'modal-x', title: 'Close' });
      xClose.append(icon('x'));
      xClose.addEventListener('click', closeModal);
      modal.append(xClose, h('h3', { textContent: 'Receive' }));

      // Tabs: Invoice (always) + Lightning address (added if the profile has lud16).
      const tabs = h('div', { className: 'compose-tabs' });
      const tabInvoice = h('button', { className: 'compose-tab active', textContent: 'Invoice' });
      tabs.append(tabInvoice);
      modal.append(tabs);
      const body = h('div');
      modal.append(body);

      function showInvoiceMode() {
        stopPoll();
        body.innerHTML = '';
        const presets = h('div', { className: 'amount-presets' });
        const amount = satsInput('Amount in sats');
        const chipLabel = (n) => (n >= 1000 ? n / 1000 + 'K' : String(n));
        RECEIVE_PRESETS.forEach((p) => {
          const b = h('button', { className: 'preset-chip', textContent: chipLabel(p) });
          b.addEventListener('click', () => {
            amount.value = String(p);
            presets.querySelectorAll('.preset-chip').forEach((c) => c.classList.remove('active'));
            b.classList.add('active');
          });
          presets.append(b);
        });
        const memo = h('input', { type: 'text', placeholder: 'Note (optional)' });
        const err = h('div', { className: 'error' });
        const create = h('button', { className: 'primary', textContent: 'Create invoice' });
        create.addEventListener('click', async () => {
          const sats = parseInt(amount.value, 10);
          if (!sats || sats < 1) return (err.textContent = 'Enter an amount in sats.');
          err.textContent = '';
          create.disabled = true;
          create.textContent = 'Creating…';
          try {
            const client = await ensureNwc();
            const res = await client.makeInvoice(sats * 1000, memo.value.trim());
            const invoice = res && (res.invoice || res.payment_request || res.bolt11);
            if (!invoice) throw new Error('Wallet returned no invoice');
            // Swap the whole form for the invoice + QR; the corner ✕ cancels.
            showInvoice(body, invoice);
            // Poll for settlement so we can show a success state.
            const lookupArg = res.payment_hash ? { payment_hash: res.payment_hash } : { invoice };
            pollTimer = setInterval(async () => {
              try {
                const inv = await client.lookupInvoice(lookupArg);
                if (inv && (inv.settled_at || inv.preimage || inv.state === 'settled')) {
                  stopPoll();
                  showReceiveSuccess(body, sats);
                  renderWallet();
                }
              } catch (_) {}
            }, 2500);
          } catch (e) {
            err.textContent = e.message;
            create.disabled = false;
            create.textContent = 'Create invoice';
          }
        });
        body.append(
          h('label', { textContent: 'Amount (sats)' }),
          presets,
          amount,
          h('label', { textContent: 'Note' }),
          memo,
          err,
          h('div', { className: 'actions' }, [create])
        );
      }

      function showAddressMode(lud16) {
        stopPoll();
        body.innerHTML = '';
        const out = h('div', { className: 'recv-out' });
        const canvas = document.createElement('canvas');
        canvas.className = 'recv-qr';
        try { new window.QRious({ element: canvas, value: 'lightning:' + lud16, size: 220, level: 'M' }); } catch (_) {}
        const copy = h('button', { className: 'secondary', textContent: lud16 });
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(lud16);
            copy.textContent = 'Copied ✓';
            setTimeout(() => (copy.textContent = lud16), 1200);
          } catch (_) {}
        });
        out.append(canvas, copy, h('p', { className: 'hint', textContent: 'Your reusable lightning address — anyone can pay it any amount.' }));
        body.append(out);
      }

      tabInvoice.addEventListener('click', () => {
        tabs.querySelectorAll('.compose-tab').forEach((t) => t.classList.remove('active'));
        tabInvoice.classList.add('active');
        showInvoiceMode();
      });
      showInvoiceMode();

      // If the active account advertises a lightning address, add an Address tab.
      fetchActiveProfile().then(({ content }) => {
        const lud16 = content && content.lud16;
        if (!lud16) return;
        const tabAddress = h('button', { className: 'compose-tab', textContent: 'Address' });
        tabAddress.addEventListener('click', () => {
          tabs.querySelectorAll('.compose-tab').forEach((t) => t.classList.remove('active'));
          tabAddress.classList.add('active');
          showAddressMode(lud16);
        });
        tabs.append(tabAddress);
      });
    }, stopPoll);
  }

  function showReceiveSuccess(container, sats) {
    container.innerHTML = '';
    const wrap = h('div', { className: 'recv-success' });
    const badge = h('div', { className: 'recv-check' });
    badge.append(icon('check'));
    wrap.append(
      badge,
      h('div', { className: 'recv-success-title', textContent: 'Payment received' }),
      h('div', { className: 'recv-success-amt', textContent: '+' + fmtSats(sats) + ' sats' })
    );
    const done = h('button', { className: 'primary', textContent: 'Done' });
    done.addEventListener('click', closeModal);
    container.append(wrap, h('div', { className: 'actions' }, [done]));
  }

  function showInvoice(container, invoice) {
    container.innerHTML = '';
    const out = h('div', { className: 'recv-out' });
    const canvas = document.createElement('canvas');
    canvas.className = 'recv-qr';
    try {
      new window.QRious({ element: canvas, value: invoice.toUpperCase(), size: 220, level: 'M' });
    } catch (_) {}
    // Show a short middle-ellipsis of the invoice; the full string is on Copy.
    const short = invoice.length > 36 ? invoice.slice(0, 22) + '…' + invoice.slice(-10) : invoice;
    const copy = h('button', { className: 'secondary recv-copy', textContent: 'Copy invoice' });
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(invoice);
        copy.textContent = 'Copied ✓';
        setTimeout(() => (copy.textContent = 'Copy invoice'), 1200);
      } catch (_) {}
    });
    const waiting = h('div', { className: 'recv-waiting' }, [h('span', { className: 'recv-spinner' }), h('span', { textContent: 'Waiting for payment…' })]);
    out.append(canvas, h('div', { className: 'recv-bolt', textContent: short }), copy, waiting);
    container.append(out);
  }

  function disconnectModal() {
    openModal((modal) => {
      const go = h('button', { className: 'danger', textContent: 'Disconnect' });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      go.addEventListener('click', async () => {
        await call({ type: 'SIDECAR_CLEAR_NWC' });
        if (nwc) { try { nwc.close(); } catch (_) {} nwc = null; nwcPubkey = null; }
        closeModal();
        toast('Wallet disconnected', 'success');
        renderWallet();
      });
      modal.append(
        h('h3', { textContent: 'Disconnect wallet?' }),
        h('p', { className: 'hint', textContent: "Removes this account's saved NWC connection from Sidecar. Your wallet and funds are unaffected." }),
        h('div', { className: 'actions' }, [go, cancel])
      );
    });
  }

  // Resolve a lightning address (user@domain) to a BOLT11 invoice via LNURL-pay.
  async function lnAddressToInvoice(addr, msats, comment) {
    const [name, domain] = addr.split('@');
    if (!name || !domain) throw new Error('Invalid lightning address');
    const meta = await (await fetch('https://' + domain + '/.well-known/lnurlp/' + name)).json();
    if (meta.tag !== 'payRequest' || !meta.callback) throw new Error('Not a valid lightning address');
    if (msats < meta.minSendable || msats > meta.maxSendable) {
      throw new Error('Amount must be ' + Math.ceil(meta.minSendable / 1000) + '–' + Math.floor(meta.maxSendable / 1000) + ' sats');
    }
    const cb = new URL(meta.callback);
    cb.searchParams.set('amount', String(msats));
    if (comment && meta.commentAllowed > 0) cb.searchParams.set('comment', comment.slice(0, meta.commentAllowed));
    const res = await (await fetch(cb.toString())).json();
    if (!res.pr) throw new Error(res.reason || 'No invoice returned');
    return res.pr;
  }

  // Chrome already checks the Web Store for updates every few hours on its own;
  // requestUpdateCheck() is the one sanctioned way to trigger that early from a
  // user-initiated button click (not a timer). It only fetches the update —
  // installing it still waits for the background worker/browser to restart, or
  // an explicit chrome.runtime.reload() (which we don't call here, since that
  // would abruptly tear down an in-progress unlock/signing/wallet flow).
  async function checkForUpdates(btn, statusEl) {
    const prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Checking…';
    statusEl.textContent = '';
    try {
      const result = await chrome.runtime.requestUpdateCheck();
      const status = result && result.status;
      if (status === 'update_available') {
        const v = result.version ? ' (v' + result.version + ')' : '';
        statusEl.textContent = 'Update found' + v + ' — it installs the next time Sidecar restarts.';
      } else if (status === 'throttled') {
        statusEl.textContent = 'Checked recently — try again in a few minutes.';
      } else {
        statusEl.textContent = "You're on the latest version.";
      }
    } catch (_) {
      statusEl.textContent = 'Could not check for updates.';
    }
    btn.disabled = false;
    btn.textContent = prevLabel;
  }

  // ---- About + zap the creator (opened from the Sidecar logo) ----
  function aboutModal() {
    openModal((modal) => {
      const build = window.SIDECAR_BUILD || {};
      const ver = build.version || (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
      const verText = 'Version ' + ver + (build.commit && build.commit !== 'dev' ? ' (' + build.commit + ')' : '');

      const xClose = h('button', { className: 'modal-x', title: 'Close' });
      xClose.append(icon('x'));
      xClose.addEventListener('click', closeModal);

      const logo = h('img', { className: 'about-logo', src: 'icons/sidecar-logo.svg', alt: 'Sidecar' });
      const creator = h('a', {
        className: 'about-creator-link', textContent: shortNpub(CREATOR_NPUB),
        href: '#', target: '_blank', rel: 'noopener noreferrer',
      });
      // Open the creator's profile in the user's preferred client; resolve their
      // current kind:0 name instead of a hardcoded handle.
      preferredClient().then((client) => { creator.href = client.profile(CREATOR_NPUB); }).catch(() => {});
      fetchProfileName(CREATOR_NPUB).then((name) => { if (name) creator.textContent = '@' + name.replace(/^@/, ''); });

      const repo = h('a', { className: 'about-link', textContent: 'GitHub', href: GITHUB_URL, target: '_blank', rel: 'noopener noreferrer' });
      const issues = h('a', { className: 'about-link', textContent: 'Report an issue', href: GITHUB_URL + '/issues', target: '_blank', rel: 'noopener noreferrer' });
      const zap = h('button', { className: 'about-link about-link-btn' }, [document.createTextNode('Zap the creator '), boltIcon()]);
      zap.addEventListener('click', () => { closeModal(); creatorZapModal(); });

      const updateBtn = h('button', { className: 'about-update-btn', textContent: 'Check for updates' });
      const updateStatus = h('p', { className: 'hint about-update-status' });
      updateBtn.addEventListener('click', () => checkForUpdates(updateBtn, updateStatus));

      modal.append(
        xClose,
        h('div', { className: 'about-modal' }, [
          logo,
          h('p', { className: 'about-description', textContent: 'A classy multi-account Nostr signer with a built-in Lightning wallet. Your keys stay encrypted on this device.' }),
          h('div', { className: 'about-creator' }, [document.createTextNode('Created by '), creator]),
          ver ? h('div', { className: 'about-version', textContent: verText }) : document.createTextNode(''),
          updateBtn,
          updateStatus,
          h('div', { className: 'about-links' }, [repo, issues, zap]),
        ])
      );
    });
  }

  async function creatorZapModal() {
    const { has } = await call({ type: 'SIDECAR_HAS_NWC' });
    openModal((modal) => {
      const xClose = h('button', { className: 'modal-x', title: 'Close' });
      xClose.append(icon('x'));
      xClose.addEventListener('click', closeModal);
      modal.append(xClose, h('h3', {}, [document.createTextNode('Zap the creator '), boltIcon()]));

      const qr = h('div', { className: 'recv-out' });
      const canvas = document.createElement('canvas');
      canvas.className = 'recv-qr';
      try { new window.QRious({ element: canvas, value: 'lightning:' + CREATOR_LN, size: 200, level: 'M' }); } catch (_) {}
      const copy = h('button', { className: 'secondary', textContent: CREATOR_LN });
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(CREATOR_LN);
          copy.textContent = 'Copied ✓';
          setTimeout(() => (copy.textContent = CREATOR_LN), 1200);
        } catch (_) {}
      });
      qr.append(canvas, copy, h('p', { className: 'hint', textContent: 'Scan to zap from any wallet.' }));
      modal.append(qr);

      // No connected wallet: leave the QR/address only, with a gentle nudge.
      if (!has) {
        modal.append(h('p', { className: 'hint zap-noconnect', textContent: 'Connect a wallet in the Wallet tab to zap from here.' }));
        return;
      }

      // Inline send via the connected NWC wallet.
      const err = h('div', { className: 'error' });
      const message = h('input', { type: 'text', placeholder: 'Message (optional)', value: 'Thanks for Sidecar! 🍸', maxLength: 200 });
      const amount = satsInput('sats');
      const send = h('button', { className: 'primary', textContent: 'Zap' });
      send.addEventListener('click', async () => {
        const sats = parseInt(amount.value, 10);
        if (!sats || sats < 1) return (err.textContent = 'Enter an amount in sats.');
        err.textContent = '';
        send.disabled = true;
        send.textContent = 'Sending…';
        try {
          const client = await ensureNwc();
          if (!client) throw new Error('Wallet unavailable — reconnect in the Wallet tab.');
          const invoice = await lnAddressToInvoice(CREATOR_LN, sats * 1000, message.value.trim() || 'Sidecar zap');
          await client.payInvoice(invoice);
          closeModal();
          toast('Thank you! Zap sent', 'success');
        } catch (e) {
          err.textContent = e.message;
          send.disabled = false;
          send.textContent = 'Zap';
        }
      });
      modal.append(
        h('label', { textContent: 'Message' }),
        message,
        h('div', { className: 'zap-inline' }, [amount, send]),
        err
      );
    });
  }

  // Footer logo on every screen (main tabs + settings) opens the About card.
  document.querySelectorAll('.brand-foot').forEach((foot) => {
    foot.classList.add('brand-foot-btn');
    foot.title = 'About Sidecar';
    foot.addEventListener('click', aboutModal);
  });

  $('autolock-select').addEventListener('change', async (e) => {
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { autoLockMinutes: Number(e.target.value) } });
  });

  $('client-select').addEventListener('change', async (e) => {
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { defaultClient: e.target.value } });
  });

  $('paybutton-toggle').addEventListener('change', async (e) => {
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { showPayButton: e.target.checked } });
  });

  $('clienttag-toggle').addEventListener('change', async (e) => {
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { showClientTag: e.target.checked } });
  });

  $('autozap-toggle').addEventListener('change', async (e) => {
    const on = e.target.checked;
    $('autozap-max-row').classList.toggle('hidden', !on);
    const max = Math.max(1, parseInt($('autozap-max').value, 10) || AUTOZAP_DEFAULT_MAX);
    $('autozap-max').value = String(max);
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { autoZap: on, autoZapMaxSats: max } });
  });

  $('autozap-max').addEventListener('change', async (e) => {
    const max = Math.max(1, parseInt(e.target.value, 10) || AUTOZAP_DEFAULT_MAX);
    e.target.value = String(max);
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { autoZapMaxSats: max } });
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

  $('check-update-btn').addEventListener('click', () => {
    checkForUpdates($('check-update-btn'), $('check-update-status'));
  });

  // Danger zone: wipe all Sidecar data. Type-to-confirm, since it's irreversible
  // and destroys keys. The destructive button is .danger (not .primary), so the
  // modal's Enter-to-submit shortcut won't fire it — a deliberate click is required.
  $('reset-all-btn').addEventListener('click', () => {
    openModal((modal) => {
      const err = h('div', { className: 'error' });
      const warn = h('p', {
        className: 'hint',
        textContent:
          'This erases everything on this device: all accounts and private keys, wallet connections, per-site permissions, and settings. It cannot be undone — any account without a backed-up nsec is lost for good.',
      });
      const confirmInput = h('input', { type: 'text', placeholder: 'Type RESET to confirm' });
      const del = h('button', { className: 'danger', textContent: 'Erase everything' });
      del.disabled = true;
      const matches = () => confirmInput.value.trim().toUpperCase() === 'RESET';
      confirmInput.addEventListener('input', () => { del.disabled = !matches(); });
      del.addEventListener('click', async () => {
        if (!matches()) return;
        try {
          await call({ type: 'SIDECAR_RESET_ALL' });
          closeModal();
          await refresh(); // no keystore now → onboarding
          toast('Sidecar reset', 'success');
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Reset Sidecar?' }),
        warn,
        h('label', { textContent: 'Confirm' }),
        confirmInput,
        err,
        h('div', { className: 'actions' }, [del, cancel])
      );
      setTimeout(() => confirmInput.focus(), 50);
    });
  });

  $('change-pin-btn').addEventListener('click', () => {
    openModal((modal) => {
      const oldP = h('input', { type: 'password', placeholder: 'Current PIN', maxLength: MAX_PIN_LEN });
      const newP = h('input', { type: 'password', placeholder: 'New PIN', maxLength: MAX_PIN_LEN });
      const newP2 = h('input', { type: 'password', placeholder: 'Confirm new PIN', maxLength: MAX_PIN_LEN });
      const err = h('div', { className: 'error' });
      const save = h('button', { className: 'primary', textContent: 'Change PIN' });
      save.addEventListener('click', async () => {
        err.textContent = '';
        if (newP.value.length < MIN_PIN_LEN) return (err.textContent = `New PIN must be at least ${MIN_PIN_LEN} characters.`);
        if (newP.value.length > MAX_PIN_LEN) return (err.textContent = `Max ${MAX_PIN_LEN} characters.`);
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
      // Live strength/match feedback on the new-PIN pair; gates the Change button.
      attachPinValidation(newP, newP2, save);
    });
  });

  // ---- inline signing approval ----
  // The service worker keeps a "sidepanel" port open while this panel is visible and,
  // when it is, pushes approval requests here (SIDECAR_PANEL_APPROVAL) instead of
  // opening a popup window. We render them inline and reply with SIDECAR_PROMPT_RESULT.
  let pendingApproval = null; // { id, data }

  const APPROVAL_METHOD_LABELS = {
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

  const isPaymentApproval = (data) => data.scope === 'webln' && data.method === 'sendPayment';

  function renderApprovalPreview(data) {
    const box = $('approval-preview');
    box.innerHTML = '';
    const row = (k, v) =>
      h('div', { className: 'row' }, [h('span', { textContent: k }), h('span', { textContent: v })]);
    if (isPaymentApproval(data)) {
      box.append(row('Amount', data.amountSats != null ? fmtSats(data.amountSats) + ' sats' : 'set by invoice'));
      if (data.memo) box.append(row('Memo', String(data.memo)));
    } else if (data.method === 'signEvent') {
      const ev = (data.params && (data.params.event || data.params)) || {};
      box.append(row('Kind', String(ev.kind ?? '—')));
      if (Array.isArray(ev.tags)) box.append(row('Tags', String(ev.tags.length)));
      if (ev.content) box.append(h('pre', { textContent: String(ev.content) }));
    } else if (data.method === 'nip04.decrypt' || data.method === 'nip44.decrypt') {
      box.append(row('From', (data.params && data.params.pubkey) || '—'));
    } else if (data.method === 'nip04.encrypt' || data.method === 'nip44.encrypt') {
      box.append(row('To', (data.params && data.params.pubkey) || '—'));
    } else {
      hide(box);
      return;
    }
    show(box);
  }

  function showApproval() {
    if (!pendingApproval) return;
    const data = pendingApproval.data;
    closeAcctMenu();
    // Overlay on top of whatever's showing — don't hide the base view.
    show($('view-approval'));

    const payment = isPaymentApproval(data);
    $('approval-host').textContent = data.host;
    $('approval-ask').textContent = payment
      ? 'wants to send a Lightning payment'
      : 'wants to ' + (APPROVAL_METHOD_LABELS[data.method] || data.method);

    const acct = $('approval-account');
    acct.innerHTML = '';
    acct.append(h('div', { className: 'approval-as', textContent: payment ? 'Paying from' : 'Signing as' }));
    acct.append(
      h('div', { className: 'active-account approval-capsule' }, [
        avatarEl({ picture: data.accountPicture }, 'aa-avatar'),
        h('div', { className: 'aa-info' }, [
          h('div', { className: 'aa-label', textContent: data.accountName || shortNpub(data.npub) }),
          h('div', { className: 'aa-npub', textContent: shortNpub(data.npub) }),
        ]),
      ])
    );

    renderApprovalPreview(data);

    $('approval-error').textContent = '';
    const allow = $('approval-allow');
    const trust = $('approval-trust');
    const pin = $('approval-pin');
    pin.value = '';
    if (data.needUnlock) {
      show($('approval-unlock'));
      setTimeout(() => pin.focus(), 50);
    } else {
      hide($('approval-unlock'));
    }

    // Payment: one Pay button + an optional "remember a budget" toggle (no Trust).
    const remember = $('approval-remember');
    const rememberBudget = $('approval-remember-budget');
    const budgetAmount = $('approval-budget-amount');
    if (payment) {
      allow.textContent = data.amountSats != null ? 'Pay ' + fmtSats(data.amountSats) + ' sats' : 'Pay';
      hide(trust);
      show(remember);
      rememberBudget.checked = false;
      budgetAmount.value = String(data.amountSats != null ? Math.max(data.amountSats * 5, 5000) : 5000);
      budgetAmount.disabled = true;
      rememberBudget.onchange = () => {
        budgetAmount.disabled = !rememberBudget.checked;
        if (rememberBudget.checked) budgetAmount.focus();
      };
    } else {
      hide(remember);
      // A pure unlock (site already trusted, keystore just locked) has nothing to
      // approve — relabel and drop the "Trust this site" choice.
      if (data.needUnlock && !data.needApproval) {
        allow.textContent = 'Unlock & continue';
        hide(trust);
      } else {
        allow.textContent = 'Allow once';
        show(trust);
      }
    }
  }

  async function decideApproval(action) {
    if (!pendingApproval) return;
    const { id, data } = pendingApproval;
    const err = $('approval-error');
    err.textContent = '';
    // Unlock first if needed (Allow once / Trust only).
    if (data.needUnlock && (action === 'once' || action === 'trust')) {
      const pin = $('approval-pin').value;
      if (!pin) {
        err.textContent = 'Enter your PIN.';
        return;
      }
      const resp = await bg({ type: 'SIDECAR_UNLOCK', pin });
      if (!resp || !resp.ok) {
        err.textContent = (resp && resp.error) || 'Incorrect PIN';
        $('approval-pin').value = '';
        $('approval-pin').focus();
        return;
      }
    }
    let extra = null;
    // Payment + "remember a budget" checked → set an allowance for this site.
    if (isPaymentApproval(data) && action === 'once' && $('approval-remember-budget').checked) {
      const budgetSats = parseInt($('approval-budget-amount').value, 10);
      if (!budgetSats || budgetSats < 1) {
        err.textContent = 'Enter a budget in sats, or uncheck the box.';
        return;
      }
      action = 'budget';
      extra = { budgetSats, perPaymentSats: 0 };
    }
    await bg({ type: 'SIDECAR_PROMPT_RESULT', id, action, extra });
    pendingApproval = null;
    $('approval-pin').value = '';
    refresh(); // back to the normal view (now unlocked, if we just unlocked)
  }

  $('approval-allow').addEventListener('click', () => decideApproval('once'));
  $('approval-trust').addEventListener('click', () => decideApproval('trust'));
  $('approval-reject').addEventListener('click', () => decideApproval('reject'));
  // Tapping the dimmed backdrop (outside the card) rejects, like closing the popup.
  $('view-approval').addEventListener('click', (e) => {
    if (e.target === $('view-approval')) decideApproval('reject');
  });
  $('approval-pin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') decideApproval('once');
  });
  // Numeric-only, capped budget input (static element, so not built via satsInput).
  $('approval-budget-amount').addEventListener('input', (e) => {
    let v = e.target.value.replace(/[^0-9]/g, '');
    if (v) v = String(Math.min(parseInt(v, 10), MAX_SATS));
    e.target.value = v;
  });

  // Keep a live port to the worker so inline approvals always reach us. MV3
  // recycles the service worker (~30s idle; Chrome also force-drops ports after
  // ~5 min), which silently kills the port — without reconnecting, the panel
  // goes deaf and a page's request hangs until a refresh. So we re-establish the
  // connection whenever it drops. (Reconnecting also wakes a sleeping worker.)
  function connectApprovalPort() {
    let port;
    try {
      port = chrome.runtime.connect({ name: 'sidepanel' });
    } catch (_) {
      setTimeout(connectApprovalPort, 1000);
      return;
    }
    port.onMessage.addListener((msg) => {
      if (msg && msg.type === 'SIDECAR_PANEL_APPROVAL') {
        closeModal();
        pendingApproval = { id: msg.id, data: msg.data };
        showApproval();
      }
    });
    port.onDisconnect.addListener(() => {
      // The worker that owned any in-flight approval is gone, so a showing card
      // is now stale (the page is failed via the content-script timeout). Drop it.
      if (pendingApproval) {
        pendingApproval = null;
        hide($('view-approval'));
      }
      setTimeout(connectApprovalPort, 250);
    });
  }
  connectApprovalPort();

  // ---- boot ----
  document.addEventListener('DOMContentLoaded', refresh);
  if (document.readyState !== 'loading') refresh();
})();
