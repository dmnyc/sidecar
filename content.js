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

  // Whether this page is signed into Sidecar's signer. Seeded from the persistent
  // site binding on startup, then flipped live the moment the page successfully
  // uses window.nostr. The "Pay with Sidecar" card only shows when this is true:
  // a live invoice on a nostr client you're signed into is a real pay intent; an
  // invoice anywhere else is almost always noise (and invoices are time-sensitive).
  let connectedToSite = false;

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
    function post(response) {
      window.postMessage({ ext: 'sidecar', scope: d.scope, kind: 'response', id: d.id, response }, '*');
    }
    function reply(response) {
      if (replied) return;
      replied = true;
      clearTimeout(timer);
      try {
        post(response);
      } catch (e) {
        // postMessage rejects values it can't structured-clone (DataCloneError).
        // Re-post a clone-safe copy so the page's promise still settles instead
        // of hanging — and never let the failure surface as an uncaught error.
        let safe;
        try { safe = JSON.parse(JSON.stringify(response)); } catch (_) {
          safe = { ok: false, error: 'Sidecar response could not be delivered.' };
        }
        try { post(safe); } catch (_) {}
      }
    }
    const timer = setTimeout(
      () => reply({ ok: false, error: 'Sidecar did not respond (timed out). Try again.' }),
      180000
    );

    try {
      chrome.runtime.sendMessage(
        { type, scope: d.scope, method: d.method, params: d.params, host },
        function (response) {
          let err;
          try { err = chrome.runtime.lastError; } catch (_) {
            return reply({ ok: false, error: 'Sidecar was updated — reload this page to reconnect.' });
          }
          // A successful nostr call means the page is signed in — unlock the pay
          // card and re-scan in case an invoice is already on screen.
          if (!err && d.scope === 'nostr' && response && response.ok && !connectedToSite) {
            connectedToSite = true;
            scheduleScan();
          }
          reply(err ? { ok: false, error: err.message } : response);
        }
      );
    } catch (e) {
      reply({ ok: false, error: 'Sidecar was updated — reload this page to reconnect.' });
    }
  });

  // ===== "Pay with Sidecar" confirmation card =====
  // When the page shows a Lightning invoice (a lightning: link, an input/QR value,
  // or a BOLT11 in the page text — e.g. a zap modal or Bitcoin Connect), present a
  // centered, style-isolated card over a dimmed backdrop showing what's being paid,
  // the amount, and the originating site, with one clear "Pay with Sidecar" action.
  // A corner pill kept getting buried under docked bars; a modal can't be lost.
  let showCard = true; // setting (default on)
  let cardHost = null;
  let shownInvoice = '';
  let dismissedInvoice = '';
  let escHandler = null;

  function invoiceSats(bolt11) {
    const m = /^ln(?:bc|tb)(\d+)([munp]?)/i.exec(bolt11);
    if (!m || !m[1]) return null;
    const F = { m: 1e5, u: 1e2, n: 1e-1, p: 1e-4, '': 1e8 };
    return Math.round(Number(m[1]) * F[m[2].toLowerCase()]);
  }

  // Minimal BOLT11 decode of just the description ('d', tag 13) so the card can
  // show what's being paid (e.g. a zap memo). bech32, no dependencies.
  const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  function invoiceMemo(bolt11) {
    try {
      const s = bolt11.toLowerCase();
      const sep = s.lastIndexOf('1'); // bech32 separator (its data charset omits '1')
      if (sep < 1) return '';
      const words = [];
      for (const c of s.slice(sep + 1)) {
        const v = BECH32.indexOf(c);
        if (v < 0) return '';
        words.push(v);
      }
      const body = words.slice(0, words.length - 6); // drop the 6-word checksum
      const end = body.length - 104; // signature occupies the final 104 words
      let i = 7; // skip the 35-bit (7-word) timestamp
      while (i + 3 <= end) {
        const tag = body[i];
        const len = body[i + 1] * 32 + body[i + 2];
        const start = i + 3;
        if (start + len > end) break;
        if (tag === 13) { // 'd' = description
          let acc = 0, bits = 0;
          const bytes = [];
          for (let k = start; k < start + len; k++) {
            acc = (acc << 5) | body[k];
            bits += 5;
            if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
          }
          return new TextDecoder().decode(new Uint8Array(bytes)).trim();
        }
        i = start + len;
      }
    } catch (_) {}
    return '';
  }

  const INVOICE_RE = /ln(?:bc|tb)[0-9][a-z0-9]{20,}/i;
  // Returns the first BOLT11 invoice found on the page (lowercased), or ''.
  function findPageInvoice() {
    // Pierce shadow DOM — web-component modals (e.g. Bitcoin Connect) render the
    // link inside a shadow root. Scan lightning: links, then input/textarea values
    // (satellite.earth puts a bare lnbc... in a readonly input), then page text.
    const roots = [document];
    for (let i = 0; i < roots.length && i < 2000; i++) {
      let links, fields, all;
      try {
        links = roots[i].querySelectorAll('a[href^="lightning:" i]');
        fields = roots[i].querySelectorAll('input, textarea');
        all = roots[i].querySelectorAll('*');
      } catch (_) {
        continue;
      }
      for (const a of links) {
        const m = INVOICE_RE.exec((a.getAttribute('href') || '').replace(/^lightning:/i, ''));
        if (m) return m[0].toLowerCase();
      }
      for (const f of fields) {
        const m = INVOICE_RE.exec(f.value || f.getAttribute('value') || '');
        if (m) return m[0].toLowerCase();
      }
      for (const el of all) if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    // Fallback: a BOLT11 in the page's visible text (a copyable invoice field).
    const m2 = /ln(?:bc|tb)[0-9][a-z0-9]{40,}/i.exec(document.body ? document.body.innerText : '');
    return m2 ? m2[0].toLowerCase() : '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function bolt(cls) {
    return (
      '<svg class="' + cls + '" viewBox="0 0 55 94" fill="currentColor">' +
      '<path d="M35.563 0V40.406H54.969L21.016 93.75V51.719H0L35.563 0Z"/></svg>'
    );
  }

  const CARD_CSS =
    '.ov{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;' +
    'background:rgba(6,2,16,0.62);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);' +
    'font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;opacity:0;transition:opacity .18s ease;}' +
    '.ov.in{opacity:1;}' +
    '.card{box-sizing:border-box;width:100%;max-width:340px;text-align:center;color:#f1e8f8;padding:26px 24px 18px;' +
    'border-radius:20px;border:1px solid rgba(203,161,78,0.45);' +
    'background:radial-gradient(120% 90% at 50% 0%,rgba(203,161,78,0.16),transparent 58%),linear-gradient(165deg,#23114a,#160a30);' +
    'box-shadow:0 24px 70px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.05);' +
    'transform:translateY(10px) scale(.985);transition:transform .2s cubic-bezier(.2,.8,.2,1);}' +
    '.ov.in .card{transform:none;}' +
    '.brand{display:flex;align-items:center;justify-content:center;gap:6px;color:#cba14e;font-weight:700;font-size:15px;}' +
    '.brand-bolt{height:15px;width:auto;display:block;}' +
    '.eyebrow{margin-top:16px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9a86c4;}' +
    '.amt{margin:7px 0 0;display:flex;align-items:baseline;justify-content:center;gap:6px;}' +
    '.amt .num{font-size:42px;font-weight:800;line-height:1;color:#cba14e;letter-spacing:-.01em;}' +
    '.amt .unit{font-size:15px;font-weight:600;color:#9a86c4;}' +
    '.memo{margin:14px auto 0;max-width:282px;font-size:13.5px;line-height:1.5;color:#e8d5f0;overflow-wrap:anywhere;' +
    'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}' +
    '.site{margin-top:10px;font-size:12px;color:#9a86c4;overflow-wrap:anywhere;}' +
    '.site b{color:#bda1ff;font-weight:600;}' +
    '.pay{margin-top:20px;width:100%;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;' +
    'border:none;border-radius:13px;padding:14px;font-size:15px;font-weight:700;color:#1c0c00;' +
    'background:linear-gradient(180deg,#f6a85a,#ed8a3c 52%,#dd6f23);' +
    'box-shadow:0 8px 22px rgba(221,111,35,0.36),inset 0 1px 0 rgba(255,255,255,0.45);transition:filter .12s ease,transform .12s ease;}' +
    '.pay:hover{filter:brightness(1.05);}' +
    '.pay:active{transform:translateY(1px);}' +
    '.pay.pending{filter:saturate(.55) brightness(.92);cursor:default;}' +
    '.pay-bolt{height:16px;width:auto;display:block;}' +
    '.cancel{margin-top:8px;width:100%;cursor:pointer;border:none;background:none;color:#9a86c4;font-size:13px;padding:9px;border-radius:10px;}' +
    '.cancel:hover{color:#f1e8f8;background:rgba(167,139,250,0.10);}' +
    '.tg{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding-top:14px;' +
    'border-top:1px solid rgba(167,139,250,0.16);cursor:pointer;}' +
    '.tg-label{font-size:12px;color:#9a86c4;}' +
    '.tg-input{position:absolute;opacity:0;width:0;height:0;}' +
    '.tg-track{position:relative;flex-shrink:0;width:38px;height:22px;border-radius:11px;background:#cba14e;transition:background .15s ease;}' +
    '.tg-thumb{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#1c0c00;transition:transform .15s ease;}' +
    '.tg-input:checked~.tg-track .tg-thumb{transform:translateX(16px);}' +
    '.tg-input:not(:checked)~.tg-track{background:rgba(167,139,250,0.25);}' +
    '.tg-input:not(:checked)~.tg-track .tg-thumb{background:#9a86c4;}';

  function removeCard() {
    if (cardHost && cardHost.parentNode) cardHost.parentNode.removeChild(cardHost);
    cardHost = null;
    shownInvoice = '';
    if (escHandler) {
      window.removeEventListener('keydown', escHandler, true);
      escHandler = null;
    }
  }

  function renderCard(invoice) {
    removeCard();
    shownInvoice = invoice;
    const sats = invoiceSats(invoice);
    const memo = invoiceMemo(invoice);
    const site = location.hostname.replace(/^www\./, '');

    const eyebrow = sats != null ? "You're paying" : 'Pay with Sidecar';
    const amountBlock =
      sats != null
        ? '<div class="amt"><span class="num">' + sats.toLocaleString('en-US') + '</span><span class="unit">sats</span></div>'
        : '';
    const memoText = memo || (sats == null ? 'A Lightning invoice — choose the amount in Sidecar.' : '');
    const memoBlock = memoText ? '<div class="memo">' + escapeHtml(memoText) + '</div>' : '';

    cardHost = document.createElement('div');
    cardHost.style.cssText = 'all:initial;';
    const s = cardHost.attachShadow({ mode: 'open' });
    s.innerHTML =
      '<style>' + CARD_CSS + '</style>' +
      '<div class="ov">' +
      '<div class="card" role="dialog" aria-label="Pay with Sidecar">' +
      '<div class="brand">' + bolt('brand-bolt') + '<span>Sidecar</span></div>' +
      '<div class="eyebrow">' + eyebrow + '</div>' +
      amountBlock +
      memoBlock +
      '<div class="site">to an invoice on <b>' + escapeHtml(site) + '</b></div>' +
      '<button class="pay" type="button">' + bolt('pay-bolt') + '<span>Pay with Sidecar</span></button>' +
      '<button class="cancel" type="button">Not now</button>' +
      '<label class="tg"><span class="tg-label">Show this automatically</span>' +
      '<input class="tg-input" type="checkbox" checked>' +
      '<span class="tg-track"><span class="tg-thumb"></span></span></label>' +
      '</div></div>';

    const ov = s.querySelector('.ov');
    const payBtn = s.querySelector('.pay');

    function dismiss() {
      dismissedInvoice = invoice;
      removeCard();
    }

    payBtn.addEventListener('click', () => {
      payBtn.classList.add('pending');
      payBtn.disabled = true;
      payBtn.querySelector('span').textContent = 'Opening Sidecar…';
      try {
        chrome.runtime.sendMessage({ type: 'SIDECAR_PAY_PAGE_INVOICE', invoice }, () => void chrome.runtime.lastError);
      } catch (_) {
        payBtn.querySelector('span').textContent = 'Reload page to pay';
      }
    });
    s.querySelector('.cancel').addEventListener('click', dismiss);
    ov.addEventListener('click', (e) => {
      if (e.target === ov) dismiss();
    });
    s.querySelector('.tg-input').addEventListener('change', (e) => {
      if (!e.target.checked) {
        try {
          chrome.runtime.sendMessage(
            { type: 'SIDECAR_SET_SETTINGS', settings: { showPayButton: false } },
            () => void chrome.runtime.lastError
          );
        } catch (_) {}
        showCard = false;
        removeCard();
      }
    });

    escHandler = (e) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', escHandler, true);

    (document.documentElement || document.body).appendChild(cardHost);
    requestAnimationFrame(() => ov.classList.add('in'));
  }

  function scanForInvoice() {
    if (!showCard || !connectedToSite) return removeCard();
    const invoice = findPageInvoice();
    if (!invoice || invoice === dismissedInvoice) return removeCard();
    if (invoice === shownInvoice && cardHost) return; // already showing this one
    renderCard(invoice);
  }

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanForInvoice, 400);
  }

  // React to events pushed from the worker: setting toggle, and payment success
  // (clear the card — the invoice link often lingers after "Paid").
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'SIDECAR_EVENT') return;
    if (msg.event === 'settings') {
      showCard = msg.showPayButton !== false;
      scanForInvoice();
    } else if (msg.event === 'paid') {
      dismissedInvoice = msg.invoice; // don't resurface even if the link lingers
      if (shownInvoice === msg.invoice) removeCard();
    }
  });

  // Start detection immediately (default on); refine with the saved setting
  // async so a settings-fetch hiccup can't prevent the card from ever appearing.
  function startCard() {
    new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
    scanForInvoice();
  }
  if (document.body) startCard();
  else document.addEventListener('DOMContentLoaded', startCard);

  try {
    chrome.runtime.sendMessage({ type: 'SIDECAR_GET_SETTINGS' }, (s) => {
      if (chrome.runtime.lastError) return; // keep the default (on)
      showCard = !(s && s.showPayButton === false);
      scanForInvoice();
    });
  } catch (_) {}

  // Seed the connection state from the persistent site binding, so a page that
  // shows an invoice immediately on load (before its client re-auths this session)
  // still surfaces the card if we've connected to this site before.
  try {
    chrome.runtime.sendMessage({ type: 'SIDECAR_IS_CONNECTED' }, (r) => {
      if (chrome.runtime.lastError) return;
      if (r && r.connected) {
        connectedToSite = true;
        scanForInvoice();
      }
    });
  } catch (_) {}
})();
