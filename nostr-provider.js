// Sidecar NIP-07 provider — runs in the PAGE context and defines window.nostr.
//
// This is the inversion of the old injected.js: instead of reading an existing
// window.nostr, Sidecar now *is* the provider. Each method posts a request to the
// content script (which forwards it to the extension's service worker for signing) and
// resolves when the matching response comes back.

(function () {
  'use strict';

  let idCounter = 0;
  const pending = new Map();

  function call(method, params) {
    return new Promise((resolve, reject) => {
      const id = 'n' + ++idCounter;
      pending.set(id, { resolve, reject });
      window.postMessage(
        { ext: 'sidecar', scope: 'nostr', kind: 'request', id, method, params },
        '*'
      );
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.ext !== 'sidecar' || d.scope !== 'nostr' || d.kind !== 'response') return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    const r = d.response;
    if (r && r.ok) p.resolve(r.result);
    else p.reject(new Error((r && r.error) || 'Sidecar request failed'));
  });

  const nostr = {
    getPublicKey: () => call('getPublicKey'),
    signEvent: (event) => call('signEvent', { event }),
    getRelays: () => call('getRelays'),
    nip04: {
      encrypt: (pubkey, plaintext) => call('nip04.encrypt', { pubkey, plaintext }),
      decrypt: (pubkey, ciphertext) => call('nip04.decrypt', { pubkey, ciphertext }),
    },
    nip44: {
      encrypt: (pubkey, plaintext) => call('nip44.encrypt', { pubkey, plaintext }),
      decrypt: (pubkey, ciphertext) => call('nip44.decrypt', { pubkey, ciphertext }),
    },
  };

  // Define window.nostr. A malicious page can still shadow this (same limitation as
  // any web NIP-07 provider); we make it non-writable where the engine allows.
  try {
    Object.defineProperty(window, 'nostr', { value: nostr, configurable: false, writable: false });
  } catch (e) {
    window.nostr = nostr;
  }
})();
