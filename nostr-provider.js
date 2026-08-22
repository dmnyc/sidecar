// Sidecar page providers — runs in the PAGE context and defines window.nostr
// (NIP-07) and window.webln (Lightning, backed by Sidecar's NWC wallet).
//
// This is the inversion of the old injected.js: instead of reading an existing
// window.nostr / window.webln, Sidecar now *is* the provider. Each method posts a
// request to the content script (which forwards it to the service worker) and
// resolves when the matching response comes back.

(function () {
  'use strict';

  // Force shadow roots open so the "Pay with Sidecar" detector (content script)
  // can find invoices inside web-component modals like Bitcoin Connect /
  // WalletConnect, which otherwise use a closed shadow root that's invisible to
  // scripts. Scoped to ONLY those payment-modal tag prefixes — a global override
  // broke clients' own web components (and NIP-07 login). Runs at document_start,
  // before the page's components attach their shadow roots.
  try {
    const _attachShadow = Element.prototype.attachShadow;
    const PIERCE = /^(bc-|bci-|wcm-|w3m-)/;
    Element.prototype.attachShadow = function (init) {
      const tag = (this.tagName || '').toLowerCase();
      if (PIERCE.test(tag)) return _attachShadow.call(this, Object.assign({}, init, { mode: 'open' }));
      return _attachShadow.call(this, init);
    };
  } catch (_) {}

  // Notice an invoice the page copies to the clipboard.
  //
  // A zap modal that shows only a QR and a "Copy invoice" button puts the
  // invoice nowhere the DOM scanner can reach — it exists as path geometry
  // inside the QR and as a closure variable, never as text. Copying it is also
  // the plainest statement of intent available: a QR merely appearing is
  // passive, whereas pressing Copy means "I want to pay this".
  //
  // This wraps the WRITE, and Sidecar never reads the clipboard. Reading would
  // need a permission Sidecar deliberately does not hold, and would mean seeing
  // everything the user copies anywhere, on any page. Wrapping the write means
  // only ever seeing what the page itself puts there, at the moment it does,
  // and nothing that is not a BOLT11 is forwarded.
  //
  // navigator.clipboard.write(ClipboardItem[]) is deliberately left alone.
  // Pulling text out of a ClipboardItem means consuming a blob the page may
  // still need, and breaking somebody's copy button to gain a convenience is
  // the wrong trade. Copy buttons overwhelmingly use writeText.
  try {
    const clip = navigator.clipboard;
    const COPIED_INVOICE_RE = /ln(?:bc|tb)[0-9][a-z0-9]{40,}/i;
    if (clip && typeof clip.writeText === 'function') {
      const original = clip.writeText;
      Object.defineProperty(clip, 'writeText', {
        configurable: true,
        writable: true,
        value: function writeText(text) {
          // Observe, then hand over untouched. Anything thrown while looking is
          // swallowed: a copy button must keep working whether or not Sidecar
          // understands what is on it.
          try {
            const m = COPIED_INVOICE_RE.exec(String(text == null ? '' : text));
            if (m) {
              window.postMessage(
                { ext: 'sidecar', kind: 'copied-invoice', invoice: m[0].toLowerCase() },
                '*'
              );
            }
          } catch (_) {}
          return original.apply(clip, arguments);
        },
      });
    }
  } catch (_) {}

  let idCounter = 0;
  const pending = new Map();

  function call(scope, method, params) {
    return new Promise((resolve, reject) => {
      const id = scope[0] + ++idCounter;
      pending.set(id, { resolve, reject });
      window.postMessage({ ext: 'sidecar', scope, kind: 'request', id, method, params }, '*');
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.ext !== 'sidecar' || d.kind !== 'response') return;
    if (d.scope !== 'nostr' && d.scope !== 'webln') return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    const r = d.response;
    if (r && r.ok) p.resolve(r.result);
    else p.reject(new Error((r && r.error) || 'Sidecar request failed'));
  });

  // ---- Bitcoin Connect settlement bridge ----
  // A zap paid from Sidecar's card settles with the page none the wiser: the invoice
  // was read out of the DOM and paid over NWC, so Bitcoin Connect — which only hears
  // about payments its own connectors make — leaves the modal spinning on an invoice
  // that is already settled. Its own launchPaymentModal listens for 'bc:onpaid' on
  // window, and its setPaid() does exactly the two things below, so replaying them
  // resolves the client's pending promise and closes the modal.
  //
  // These are internals, not published API. If they change this quietly stops working
  // and the modal spins as it does today — the failure mode is the status quo, never
  // something worse. Nothing here is a capability the page lacks: any script on the
  // page can dispatch this event itself.
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.ext !== 'sidecar' || d.kind !== 'settled') return;
    try {
      // No modal, no work — this is a no-op on pages that don't use Bitcoin Connect.
      const el = document.querySelector('bc-payment');
      if (!el) return;
      // Only ever claim the invoice the modal is actually showing, and require the
      // match — an unverifiable modal is left alone rather than told a payment
      // settled. Accepting a missing `invoice` attribute as "close enough" would let
      // a modal for one invoice be resolved by a payment for another, and a false
      // "paid" is the one direction a payment UI must not fail in. If a future
      // Bitcoin Connect stops putting the bolt11 here, this stops firing and the
      // modal spins as it does today.
      const shown = (el.getAttribute('invoice') || '').toLowerCase();
      if (!shown || shown !== String(d.invoice || '').toLowerCase()) return;
      el.setAttribute('paid', 'paid'); // drives Bitcoin Connect's own success state
      el.dispatchEvent(
        new CustomEvent('bc:onpaid', {
          bubbles: true,
          composed: true,
          detail: { preimage: String(d.preimage || '') },
        })
      );
    } catch (_) {}
  });

  // ---- window.nostr (NIP-07) ----
  const nostr = {
    getPublicKey: () => call('nostr', 'getPublicKey'),
    signEvent: (event) => call('nostr', 'signEvent', { event }),
    getRelays: () => call('nostr', 'getRelays'),
    nip04: {
      encrypt: (pubkey, plaintext) => call('nostr', 'nip04.encrypt', { pubkey, plaintext }),
      decrypt: (pubkey, ciphertext) => call('nostr', 'nip04.decrypt', { pubkey, ciphertext }),
    },
    nip44: {
      encrypt: (pubkey, plaintext) => call('nostr', 'nip44.encrypt', { pubkey, plaintext }),
      decrypt: (pubkey, ciphertext) => call('nostr', 'nip44.decrypt', { pubkey, ciphertext }),
    },
  };

  // Define window.nostr. A malicious page can still shadow this (same limitation as
  // any web NIP-07 provider); we make it non-writable where the engine allows.
  try {
    Object.defineProperty(window, 'nostr', { value: nostr, configurable: false, writable: false });
  } catch (e) {
    window.nostr = nostr;
  }

  // ---- window.webln (Lightning) ----
  // Only define it if no other WebLN provider is already present, so Sidecar
  // doesn't fight Alby or a wallet the user prefers on this page.
  if (!window.webln) {
    let enabled = false;
    const ensure = () => (enabled ? Promise.resolve() : webln.enable());

    // WebLN makeInvoice accepts a number, a string, or an options object.
    function normInvoice(args) {
      if (args == null) return {};
      if (typeof args === 'number' || typeof args === 'string') return { amount: args };
      return { amount: args.amount != null ? args.amount : args.defaultAmount, memo: args.defaultMemo || args.memo };
    }

    // Minimal event emitter — clients commonly call webln.on(...) right after
    // enabling (e.g. for "accountChanged"). A missing on/off would throw a
    // TypeError and crash the page, so we provide a real (if quiet) emitter.
    const listeners = {};
    const webln = {
      enable: async () => {
        const r = await call('webln', 'enable');
        enabled = !!(r && r.enabled !== false);
        return r || { enabled };
      },
      isEnabled: async () => {
        if (enabled) return true;
        try {
          const r = await call('webln', 'isEnabled');
          enabled = !!(r && r.enabled);
        } catch (_) {}
        return enabled;
      },
      getInfo: () => ensure().then(() => call('webln', 'getInfo')),
      getBalance: () => ensure().then(() => call('webln', 'getBalance')),
      makeInvoice: (args) => ensure().then(() => call('webln', 'makeInvoice', normInvoice(args))),
      sendPayment: (paymentRequest) => ensure().then(() => call('webln', 'sendPayment', { paymentRequest })),
      keysend: () => Promise.reject(new Error('keysend is not supported by Sidecar')),
      signMessage: () => Promise.reject(new Error('signMessage is not supported by Sidecar')),
      verifyMessage: () => Promise.reject(new Error('verifyMessage is not supported by Sidecar')),
      // Raw NIP-47-style passthrough some clients probe for; unsupported for now.
      request: () => Promise.reject(new Error('webln.request is not supported by Sidecar')),
      // Event subscription (no-op sink so callers never hit an undefined method).
      on: (name, cb) => {
        (listeners[name] || (listeners[name] = [])).push(cb);
        return webln;
      },
      off: (name, cb) => {
        if (listeners[name]) listeners[name] = listeners[name].filter((f) => f !== cb);
        return webln;
      },
      emit: (name, data) => {
        (listeners[name] || []).forEach((f) => {
          try { f(data); } catch (_) {}
        });
        return webln;
      },
    };

    try {
      Object.defineProperty(window, 'webln', { value: webln, configurable: true, writable: false });
    } catch (e) {
      window.webln = webln;
    }

    // Discovery handshake: webln.requestProvider() resolves immediately if
    // window.webln already exists, otherwise it waits for this event. We inject
    // asynchronously, so an app that called requestProvider() before we arrived
    // only learns about us via webln:ready.
    try {
      window.dispatchEvent(new Event('webln:ready'));
    } catch (e) {}
  }
})();
