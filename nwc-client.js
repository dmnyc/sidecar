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

  const nowSec = () => Math.floor(Date.now() / 1000);

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  const REQUEST_TIMEOUT = 30000;
  const LOOKUP_TIMEOUT = 10000;
  const PROBE_TIMEOUT = 5000;

  // Is the wallet's relay reachable at all? Opens a bare WebSocket and races it
  // against a short timeout. Used only to word a timeout correctly (see #120) —
  // never to decide whether a payment happened.
  //
  // A raw socket rather than SimplePool: nostr-tools doesn't cleanly expose
  // per-relay connect errors, and this needs to distinguish "can't reach the relay"
  // from "relay is fine, the wallet is quiet."
  function probeRelay(url) {
    return new Promise((resolve) => {
      let done = false;
      let ws;
      const finish = (up) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { if (ws) ws.close(); } catch (_) {}
        resolve(up);
      };
      const timer = setTimeout(() => finish(false), PROBE_TIMEOUT);
      try {
        ws = new WebSocket(url);
        ws.onopen = () => finish(true);
        ws.onerror = () => finish(false);
        ws.onclose = () => finish(false); // closed before open ⇒ unreachable
      } catch (_) {
        finish(false); // malformed URL, blocked scheme, etc.
      }
    });
  }

  function makeClient(connectionString) {
    const conn = NT.nip47.parseConnectionString(connectionString); // { pubkey, relay, secret }
    const sk = hexToBytes(conn.secret);
    const walletPubkey = conn.pubkey;
    const relay = conn.relay;

    // ONE POOL PER CLIENT, not a module singleton.
    //
    // This was a real, reproducible way to break the wallet until a full extension
    // reload: the pool used to be module-level, and close() called
    // pool().close([relay]) — closing that relay in the SHARED pool. Every connect,
    // restore and Rizful quick-start creates a throwaway client to validate the
    // string with getInfo() and then closes it, which marked the relay closed for
    // the real client created moments later on the same relay. Balance stopped
    // returning, transactions failed, and nothing recovered because the singleton
    // survived for the life of the page.
    //
    // A pool per client makes close() affect only that client. The cost is one
    // WebSocket per client instead of one shared per relay — negligible, since at
    // most a couple of clients are alive at once and the validation probes are
    // short-lived.
    let _pool = null;
    // enableReconnect, because nostr-tools defaults it to FALSE: without it,
    // handleHardClose closes every subscription and never reopens, so one dropped
    // socket leaves this client permanently dead. Every later request then publishes
    // into a corpse and waits out the full REQUEST_TIMEOUT — which is how a healthy
    // relay got reported as "the relay looks down".
    //
    // Not a complete fix on its own: reconnect backoff starts at 10s and the kind:23195
    // reply is ephemeral, so a request already in flight is still lost. It keeps a
    // long-lived client healthy; getSwNwc's invalidation handles the in-flight case.
    const pool = () => (_pool || (_pool = new NT.SimplePool({ enableReconnect: true })));
    let closed = false;

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
          // A closed client's pool has its relay shut; requesting on it would hang
          // until the timeout and report a false "wallet didn't respond."
          if (closed) throw new Error('This wallet connection was closed');
          const content = await encrypt(JSON.stringify({ method, params: params || {} }));
          const reqEvent = NT.finalizeEvent(
            { kind: 23194, created_at: nowSec(), tags: [['p', walletPubkey]], content },
            sk
          );
          let settled = false;
          let timer = null;
          // Whether any relay accepted the request event. Distinguishes "nobody heard
          // us" (a dead local socket) from "we were heard and nothing came back"
          // (a quiet wallet) when the timeout fires.
          let published = false;
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
          // Name the actual cause instead of one generic timeout for three different
          // failures (#120). A dead relay and a quiet wallet are the same 30-second
          // wait today, which reads as a Sidecar bug either way.
          timer = setTimeout(async () => {
            if (settled) return;
            settled = true;
            try { sub.close(); } catch (_) {}
            const relayUp = await probeRelay(relay);
            let err;
            if (!relayUp) {
              const host = (() => { try { return new URL(relay).host; } catch (_) { return relay; } })();
              err = new Error("Can't reach your wallet's relay (" + host + ") — the relay looks down, not Sidecar.");
              err.relayDown = true;
            } else if (!published) {
              // Third case, and the one that produced a false accusation: the relay
              // answers a fresh probe, but OUR socket never accepted the publish — a
              // connection that died while idle. Blaming the relay or the wallet is
              // wrong; the honest answer is that the link went stale and a retry
              // (which now builds a new client — see closeSwNwc in payAndConfirm)
              // will work.
              err = new Error('Lost the connection to your wallet — please try again.');
              err.staleSocket = true;
            } else {
              err = new Error("Your wallet didn't respond in time — it may be offline or not running.");
              err.walletSilent = true;
            }
            // Still INDETERMINATE for spends: see the rejection contract above. Only
            // walletDenied means the money definitely stayed put.
            reject(err);
          }, timeoutMs || REQUEST_TIMEOUT);
          try {
            await Promise.any(pool().publish([relay], reqEvent));
            published = true;
          } catch (_) {
            /* if no relay accepted, the timeout will reject — with a probed message */
          }
        })().catch(reject);
      });
    }

  // Subscribe to NIP-47 kind:23196 notification events (payment_received,
  // payment_sent). Returns a handle with .close(). The callback receives the
  // decrypted notification object: { notification_type, notification }.
  // Not all wallets send these — the caller should keep a polling fallback.
  function subscribeNotifications(onNotification) {
    // `subClosed`, not `closed` — the client-level `closed` above tracks whether the
    // whole client was torn down, and shadowing it here would make the handle's
    // close() look like it closed the client (or vice versa).
    let subClosed = false;
    let sub = null;
    try {
      sub = pool().subscribeMany(
        [relay],
        { kinds: [23196], authors: [walletPubkey] },
        {
          onevent: async (ev) => {
            if (subClosed || closed) return;
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
        subClosed = true;
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
      // Tears down only THIS client's pool. Safe to call on a validation probe
      // without affecting the live wallet client on the same relay.
      close: () => {
        closed = true;
        try { if (_pool) _pool.close([relay]); } catch (_) {}
        _pool = null;
      },
    };
  }

  root.SidecarNWC = { makeClient };
})(typeof self !== 'undefined' ? self : this);
