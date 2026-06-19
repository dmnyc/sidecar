// Sidecar content script — bridges the page's window.nostr (nostr-provider.js) to the
// extension service worker. Injects the provider at document_start, then relays each
// request to the background, attaching the TRUSTED host (taken from location here, never
// from the page), and posts the response back to the page.

(function () {
  'use strict';

  // Inject the page-context provider as early as possible.
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('nostr-provider.js');
  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  const host = location.hostname; // trusted origin identity, set by the content script

  const SCOPE_TO_TYPE = {
    nostr: 'SIDECAR_NOSTR_RPC',
    webln: 'SIDECAR_WEBLN_RPC',
  };

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.ext !== 'sidecar' || d.kind !== 'request') return;
    const type = SCOPE_TO_TYPE[d.scope];
    if (!type) return;

    // Always answer the page exactly once. If the service worker dies mid-request
    // (MV3 recycles it) the callback may never fire, which would hang the page's
    // window.nostr/webln promise — so a timeout guarantees a (failed) response.
    let replied = false;
    function reply(response) {
      if (replied) return;
      replied = true;
      clearTimeout(timer);
      window.postMessage({ ext: 'sidecar', scope: d.scope, kind: 'response', id: d.id, response }, '*');
    }
    const timer = setTimeout(
      () => reply({ ok: false, error: 'Sidecar did not respond (timed out). Try again.' }),
      180000
    );

    chrome.runtime.sendMessage(
      { type, scope: d.scope, method: d.method, params: d.params, host },
      function (response) {
        const err = chrome.runtime.lastError;
        reply(err ? { ok: false, error: err.message } : response);
      }
    );
  });

  // ===== "Pay with Sidecar" pill =====
  // When the page shows a Lightning invoice (a lightning: link, e.g. a zap modal
  // or Bitcoin Connect), float a discoverable pill so users don't have to find
  // the right-click. Style-isolated in a shadow root; pays via the same flow.
  let showPill = true; // setting (default on)
  let pillHost = null;
  let shownInvoice = '';
  let dismissedInvoice = '';

  function invoiceSats(bolt11) {
    const m = /^ln(?:bc|tb)(\d+)([munp]?)/i.exec(bolt11);
    if (!m || !m[1]) return null;
    const F = { m: 1e5, u: 1e2, n: 1e-1, p: 1e-4, '': 1e8 };
    return Math.round(Number(m[1]) * F[m[2].toLowerCase()]);
  }

  function findPageInvoice() {
    const links = document.querySelectorAll('a[href^="lightning:" i]');
    for (const a of links) {
      if (!a.offsetParent && a.getClientRects().length === 0) continue; // not rendered
      const m = /ln(?:bc|tb)[0-9][a-z0-9]+/i.exec((a.getAttribute('href') || '').replace(/^lightning:/i, ''));
      if (m) return m[0].toLowerCase();
    }
    return '';
  }

  function removePill() {
    if (pillHost && pillHost.parentNode) pillHost.parentNode.removeChild(pillHost);
    pillHost = null;
    shownInvoice = '';
  }

  function renderPill(invoice) {
    removePill();
    shownInvoice = invoice;
    const sats = invoiceSats(invoice);
    const label = sats != null ? 'Pay ' + sats.toLocaleString('en-US') + ' sats with Sidecar' : 'Pay invoice with Sidecar';
    pillHost = document.createElement('div');
    pillHost.style.cssText = 'all:initial;position:fixed;z-index:2147483647;bottom:18px;right:18px;';
    const s = pillHost.attachShadow({ mode: 'open' });
    s.innerHTML =
      '<style>' +
      '.pill{display:flex;align-items:stretch;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;' +
      'border-radius:12px;overflow:hidden;border:1px solid rgba(203,161,78,0.5);box-shadow:0 10px 30px rgba(0,0,0,0.55);}' +
      '.pay{cursor:pointer;border:none;padding:12px 15px;font-size:14px;font-weight:600;color:#1c0c00;' +
      'background:linear-gradient(180deg,#f29248,#ea772f 55%,#d4621f);}' +
      '.pay:hover{filter:brightness(1.06);}' +
      '.x{cursor:pointer;border:none;padding:0 11px;background:#160a30;color:#9a86c4;font-size:17px;line-height:1;}' +
      '.x:hover{color:#f1e8f8;}' +
      '</style>' +
      '<div class="pill"><button class="pay" type="button">⚡ ' + label + '</button>' +
      '<button class="x" type="button" title="Dismiss">×</button></div>';
    s.querySelector('.pay').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'SIDECAR_PAY_PAGE_INVOICE', invoice }, () => void chrome.runtime.lastError);
    });
    s.querySelector('.x').addEventListener('click', () => {
      dismissedInvoice = invoice;
      removePill();
    });
    (document.documentElement || document.body).appendChild(pillHost);
  }

  function scanForInvoice() {
    if (!showPill) return removePill();
    const inv = findPageInvoice();
    if (!inv || inv === dismissedInvoice) return removePill();
    if (inv === shownInvoice && pillHost) return; // already showing it
    renderPill(inv);
  }

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanForInvoice, 400);
  }

  // React to the setting toggle pushed from the panel.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'SIDECAR_EVENT' && msg.event === 'settings') {
      showPill = msg.showPayButton !== false;
      scanForInvoice();
    }
  });

  chrome.runtime.sendMessage({ type: 'SIDECAR_GET_SETTINGS' }, (s) => {
    if (chrome.runtime.lastError) return;
    showPill = !(s && s.showPayButton === false);
    const obs = new MutationObserver(scheduleScan);
    const start = () => {
      obs.observe(document.documentElement, { childList: true, subtree: true });
      scanForInvoice();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  });
})();
