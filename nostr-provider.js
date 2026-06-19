// Sidecar page providers — runs in the PAGE context and defines window.nostr
// (NIP-07) and window.webln (Lightning, backed by Sidecar's NWC wallet).
//
// This is the inversion of the old injected.js: instead of reading an existing
// window.nostr / window.webln, Sidecar now *is* the provider. Each method posts a
// request to the content script (which forwards it to the service worker) and
// resolves when the matching response comes back.

(function () {
  'use strict';

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
    };

    try {
      Object.defineProperty(window, 'webln', { value: webln, configurable: true, writable: false });
    } catch (e) {
      window.webln = webln;
    }
  }
})();
