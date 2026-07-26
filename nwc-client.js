// Sidecar NWC (NIP-47) client — talks to an external Lightning wallet service
// (Alby Hub, Coinos, Mutiny, …) over the wallet's own relay. Sidecar holds no funds.
//
// Built entirely on the bundled nostr-tools (window.NostrTools): no new deps.
// Runs in the side-panel page context (needs WebSocket + a live page).
//
// Protocol: encrypt a {method,params} request to the wallet's pubkey (NIP-04),
// publish as a kind:23194 event tagged ['p', walletPubkey], then await the
// kind:23195 response tagged ['e', requestId]. 23195 is ephemeral (relays don't
// store it), so we subscribe BEFORE publishing.

(function (root) {
  'use strict';
  const NT = root.NostrTools;

  let _pool = null;
  const pool = () => (_pool || (_pool = new NT.SimplePool()));
  const nowSec = () => Math.floor(Date.now() / 1000);

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  const REQUEST_TIMEOUT = 30000;
  const LOOKUP_TIMEOUT = 10000;

  function makeClient(connectionString) {
    const conn = NT.nip47.parseConnectionString(connectionString); // { pubkey, relay, secret }
    const sk = hexToBytes(conn.secret);
    const walletPubkey = conn.pubkey;
    const relay = conn.relay;

    const encrypt = (text) => NT.nip04.encrypt(sk, walletPubkey, text);
    const decrypt = (cipher) => NT.nip04.decrypt(sk, walletPubkey, cipher);

    // Rejection contract, which matters for pay_invoice: a rejected request does
    // NOT mean the wallet did nothing. Once the kind:23194 request is published the
    // wallet may act on it, and our ability to hear the kind:23195 answer is a
    // separate, fallible thing — 23195 is ephemeral, so relays don't replay it if
    // the connection blips. Only `err.walletDenied` (the wallet explicitly answered
    // with an error) means no money moved. Every other rejection — timeout, dropped
    // relay, undecryptable response — is INDETERMINATE, and a caller that spends
    // money must verify with lookup_invoice before reporting failure.
    function request(method, params, timeoutMs) {
      return new Promise((resolve, reject) => {
        (async () => {
          const content = await encrypt(JSON.stringify({ method, params: params || {} }));
          const reqEvent = NT.finalizeEvent(
            { kind: 23194, created_at: nowSec(), tags: [['p', walletPubkey]], content },
            sk
          );
          let settled = false;
          let timer = null;
          // nostr-tools ≥2.20 subscriptions take a single filter object, not an array.
          const sub = pool().subscribeMany(
            [relay],
            { kinds: [23195], authors: [walletPubkey], '#e': [reqEvent.id] },
            {
              onevent: async (ev) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try { sub.close(); } catch (_) {}
                try {
                  const res = JSON.parse(await decrypt(ev.content));
                  if (res.error) {
                    // The wallet answered, and the answer was no. This is the ONLY
                    // failure we can be certain left the money where it was — see
                    // the rejection contract above.
                    const err = new Error(res.error.message || res.error.code || 'Wallet error');
                    err.walletDenied = true;
                    reject(err);
                  } else resolve(res.result);
                } catch (e) {
                  reject(new Error('Could not read wallet response'));
                }
              },
            }
          );
          timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { sub.close(); } catch (_) {}
            reject(new Error('Wallet did not respond (timed out)'));
          }, timeoutMs || REQUEST_TIMEOUT);
          try {
            await Promise.any(pool().publish([relay], reqEvent));
          } catch (_) {
            /* if no relay accepted, the timeout will reject */
          }
        })().catch(reject);
      });
    }

  // Subscribe to NIP-47 kind:23196 notification events (payment_received,
  // payment_sent). Returns a handle with .close(). The callback receives the
  // decrypted notification object: { notification_type, notification }.
  // Not all wallets send these — the caller should keep a polling fallback.
  function subscribeNotifications(onNotification) {
    let closed = false;
    let sub = null;
    try {
      sub = pool().subscribeMany(
        [relay],
        { kinds: [23196], authors: [walletPubkey] },
        {
          onevent: async (ev) => {
            if (closed) return;
            try {
              const payload = JSON.parse(await decrypt(ev.content));
              onNotification(payload);
            } catch (_) { /* ignore un-decryptable notifications */ }
          },
        }
      );
    } catch (_) { /* wallet or relay may not support notifications — that's fine */ }
    return {
      close() {
        closed = true;
        try { if (sub) sub.close(); } catch (_) {}
      },
    };
  }

  return {
      walletPubkey,
      relay,
      getInfo: () => request('get_info'),
      getBalance: () => request('get_balance'), // → { balance } in msat
      payInvoice: (invoice, amountMsat) =>
        request('pay_invoice', amountMsat ? { invoice, amount: amountMsat } : { invoice }),
      makeInvoice: (amountMsat, description) =>
        request('make_invoice', { amount: amountMsat, description: description || '' }),
      listTransactions: (params) => request('list_transactions', params || { limit: 20, unpaid: false }),
      // Short timeout: a lookup is a status poll, and one that hangs for the full 30s
      // would stall the watcher that's meant to be checking on a payment in flight.
      // Failing fast just means the next poll asks again.
      lookupInvoice: (params, timeoutMs) => request('lookup_invoice', params, timeoutMs || LOOKUP_TIMEOUT),
      subscribeNotifications,
      close: () => { try { pool().close([relay]); } catch (_) {} },
    };
  }

  root.SidecarNWC = { makeClient };
})(typeof self !== 'undefined' ? self : this);
