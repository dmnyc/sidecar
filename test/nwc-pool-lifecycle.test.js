'use strict';

// Unit coverage for the NWC client's pool lifecycle and timeout wording.
//
// THE BUG (reported 2026-08-04): after a while the wallet stops returning a balance
// and can't transact, and only a full extension reload fixes it.
//
// Cause: the SimplePool was a MODULE-LEVEL singleton, and close() called
// pool().close([relay]) — shutting that relay down in the shared pool. Every
// connect, restore and Rizful quick-start builds a throwaway client to validate the
// connection string with getInfo() and then closes it:
//
//     const client = window.SidecarNWC.makeClient(conn);
//     await client.getInfo();
//     client.close();            // ← closed the relay for EVERYONE
//     await call({ type: 'SIDECAR_SET_NWC', connection: conn });
//
// ensureNwc() then built the real client on the same relay, got the same poisoned
// singleton, and every subscribeMany/publish silently no-op'd. Nothing recovered
// because the singleton lives as long as the page — hence "reset the extension."
//
// Fix: one pool per client. close() can only affect the client it was called on.
//
// Also covers #120: a timeout now names whether the RELAY is unreachable or the
// WALLET is quiet, instead of one generic message for both.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'nwc-client.js'), 'utf8');

const RELAY = 'wss://relay.example';
const WALLET_PK = 'b'.repeat(64);
const SECRET = 'c'.repeat(64);
const CONN = 'nostr+walletconnect://' + WALLET_PK + '?relay=' + encodeURIComponent(RELAY) + '&secret=' + SECRET;

// Builds a context with a fake nostr-tools whose SimplePool records every
// construction and close, so the test can see how many pools exist and which
// relays each one shut.
function harness({ respond, probeOpens = true, publishFails = false } = {}) {
  const pools = [];
  const sockets = [];

  class FakePool {
    constructor(opts) {
      this.opts = opts || null;
      this.id = pools.length;
      this.closedRelays = [];
      this.subs = [];
      this.published = [];
      pools.push(this);
    }
    subscribeMany(relays, filter, handlers) {
      // A pool whose relay was closed silently drops the subscription — this is what
      // made the real bug invisible: no error, just nothing ever arriving.
      const dead = relays.some((r) => this.closedRelays.includes(r));
      const sub = { closed: false, close() { this.closed = true; }, dead };
      this.subs.push(sub);
      if (!dead && respond) {
        setTimeout(() => { if (!sub.closed) handlers.onevent(respond()); }, 1);
      }
      return sub;
    }
    publish(relays, ev) {
      const dead = relays.some((r) => this.closedRelays.includes(r)) || publishFails;
      this.published.push({ ev, dead });
      return dead ? [Promise.reject(new Error('relay closed'))] : [Promise.resolve('ok')];
    }
    close(relays) {
      for (const r of relays) if (!this.closedRelays.includes(r)) this.closedRelays.push(r);
    }
  }

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      sockets.push(this);
      setTimeout(() => {
        if (probeOpens && this.onopen) this.onopen();
        else if (!probeOpens && this.onerror) this.onerror();
      }, 1);
    }
    close() { this.closedByUs = true; }
  }

  const ctx = {
    console, setTimeout, clearTimeout, Promise, URL, Error, JSON, Date, Math,
    Uint8Array, parseInt, TextDecoder,
    WebSocket: FakeWebSocket,
    NostrTools: {
      SimplePool: FakePool,
      nip47: {
        parseConnectionString: () => ({ pubkey: WALLET_PK, relay: RELAY, secret: SECRET }),
      },
      nip04: {
        encrypt: async () => 'CIPHER',
        decrypt: async (_sk, _pk, c) => c,
      },
      finalizeEvent: (ev) => Object.assign({ id: 'evid' }, ev),
    },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  // request() is async: pool() isn't reached until after the first `await encrypt`,
  // so a synchronous read of `pools` sees nothing. touch() issues a request with a
  // 1ms timeout and waits for it to settle, guaranteeing the pool exists.
  // lookupInvoice is the only method that takes a timeout — getBalance/getInfo would
  // hold the full 30s.
  const touch = async (client) => {
    await client.lookupInvoice({ payment_hash: 'x' }, 1).catch(() => {});
  };
  return { ctx, pools, sockets, touch, makeClient: ctx.SidecarNWC.makeClient };
}

// ---- the reported bug -----------------------------------------------------------

test('each client gets its OWN pool', async () => {
  const h = harness();
  const a = h.makeClient(CONN);
  const b = h.makeClient(CONN);
  await h.touch(a);
  await h.touch(b);
  assert.equal(h.pools.length, 2, 'a module-level singleton would give 1');
});

test('closing a validation probe does not poison the real client — THE BUG', async () => {
  // Reproduces the exact sequence from the connect / restore / Rizful paths.
  const h = harness();
  const probe = h.makeClient(CONN);
  await h.touch(probe);
  probe.close();                       // the throwaway validation client

  const live = h.makeClient(CONN);     // the real client, same relay
  await h.touch(live);

  const livePool = h.pools[h.pools.length - 1];
  assert.deepEqual(livePool.closedRelays, [],
    "the live client's relay must not be closed by the probe");
  assert.ok(livePool.subs.length, 'the live client should have subscribed');
  assert.ok(!livePool.subs[0].dead, 'its subscription must not be dead-on-arrival');
});

test('close() shuts down only the calling client', async () => {
  const h = harness();
  const a = h.makeClient(CONN);
  const b = h.makeClient(CONN);
  await h.touch(a);
  await h.touch(b);
  a.close();
  const [poolA, poolB] = h.pools;
  assert.deepEqual(poolA.closedRelays, [RELAY], 'A closed its own relay');
  assert.deepEqual(poolB.closedRelays, [], "B's relay is untouched");
});

test('a closed client rejects immediately instead of hanging to the timeout', async () => {
  // Without this, a request on a closed client waits the full 30s and then reports
  // "wallet didn't respond" — a false accusation against a working wallet.
  const h = harness();
  const c = h.makeClient(CONN);
  c.close();
  await assert.rejects(() => c.getBalance(), /closed/i);
});

test('close() is idempotent', async () => {
  const h = harness();
  const c = h.makeClient(CONN);
  await h.touch(c);
  c.close();
  c.close();
  assert.deepEqual(h.pools[0].closedRelays, [RELAY], 'no duplicate relay entries');
});

test('close() before any request never constructs a pool', () => {
  const h = harness();
  const c = h.makeClient(CONN);
  c.close();
  assert.equal(h.pools.length, 0, 'the pool is lazy; nothing to tear down');
});

// ---- #120: the timeout names the cause -----------------------------------------

test('a timeout with an unreachable relay blames the relay, and names its host', async () => {
  const h = harness({ probeOpens: false });
  const c = h.makeClient(CONN);
  await assert.rejects(
    () => c.lookupInvoice({ payment_hash: 'x' }, 1),   // 1ms timeout so the test doesn't wait
    (err) => {
      assert.match(err.message, /Can't reach your wallet's relay/);
      assert.match(err.message, /relay\.example/, 'the host has to be named to be actionable');
      assert.equal(err.relayDown, true);
      assert.ok(!err.walletDenied, 'a dead relay is INDETERMINATE, never wallet-denied');
      return true;
    }
  );
});

test('a timeout with a reachable relay blames the wallet', async () => {
  const h = harness({ probeOpens: true });
  const c = h.makeClient(CONN);
  await assert.rejects(
    () => c.lookupInvoice({ payment_hash: 'x' }, 1),
    (err) => {
      assert.match(err.message, /wallet didn't respond/i);
      assert.equal(err.walletSilent, true);
      assert.ok(!err.relayDown);
      assert.ok(!err.walletDenied);
      return true;
    }
  );
});

test('a reachable relay that never accepted the publish blames the CONNECTION', async () => {
  // The third case, and the one that produced a false accusation in the field: the
  // relay answers a fresh probe, but our own socket died while idle so the request
  // was never accepted. Reported as the wallet being quiet, it sent the user to
  // check a wallet that was fine; reported as the relay being down, it accused a
  // healthy relay.
  const h = harness({ probeOpens: true, publishFails: true });
  const c = h.makeClient(CONN);
  await assert.rejects(
    () => c.lookupInvoice({ payment_hash: 'x' }, 1),
    (err) => {
      assert.match(err.message, /lost the connection/i);
      assert.equal(err.staleSocket, true);
      assert.ok(!err.relayDown, 'must not accuse the relay — the probe reached it');
      assert.ok(!err.walletSilent, 'must not accuse the wallet — it was never asked');
      assert.ok(!err.walletDenied, 'still indeterminate for spends');
      return true;
    }
  );
});

test('an unreachable relay still blames the relay even when the publish fails', async () => {
  // Ordering guard: a dead relay ALSO fails to accept the publish, so the staleSocket
  // branch must not shadow relayDown. The probe is the stronger signal and wins.
  const h = harness({ probeOpens: false, publishFails: true });
  const c = h.makeClient(CONN);
  await assert.rejects(() => c.lookupInvoice({ payment_hash: 'x' }, 1), (err) => {
    assert.equal(err.relayDown, true);
    assert.ok(!err.staleSocket);
    return true;
  });
});

test('neither timeout claims the money stayed put', async () => {
  // The rejection contract: only walletDenied means no money moved. A caller that
  // spends must still verify with lookup_invoice after either of these.
  for (const probeOpens of [true, false]) {
    const h = harness({ probeOpens });
    const c = h.makeClient(CONN);
    await assert.rejects(() => c.lookupInvoice({ payment_hash: 'x' }, 1), (err) => {
      assert.notEqual(err.walletDenied, true);
      return true;
    });
  }
});

test('the probe opens a socket to the wallet relay, then closes it', async () => {
  const h = harness({ probeOpens: true });
  const c = h.makeClient(CONN);
  await c.lookupInvoice({ payment_hash: 'x' }, 1).catch(() => {});
  const probeSocket = h.sockets.find((s) => s.url === RELAY);
  assert.ok(probeSocket, 'the probe must target the connection string relay');
  assert.ok(probeSocket.closedByUs, 'the probe must not leak a socket');
});

test('no probe runs on the happy path', async () => {
  // The probe is diagnostic only. Running it on every success would add a socket
  // per request for no reason.
  const h = harness({ respond: () => ({ content: JSON.stringify({ result: { balance: 1000 } }) }) });
  const c = h.makeClient(CONN);
  const res = await c.getBalance();
  assert.deepEqual(res, { balance: 1000 });
  assert.equal(h.sockets.length, 0, 'a successful request should open no probe socket');
});

// ---- the wallet-denied path is untouched ---------------------------------------

test('a wallet error still sets walletDenied', async () => {
  const h = harness({
    respond: () => ({ content: JSON.stringify({ error: { code: 'INSUFFICIENT_BALANCE', message: 'Not enough' } }) }),
  });
  const c = h.makeClient(CONN);
  await assert.rejects(() => c.payInvoice('lnbc1'), (err) => {
    assert.equal(err.message, 'Not enough');
    assert.equal(err.walletDenied, true, 'the ONE case where money definitely did not move');
    return true;
  });
});

// ---- the notification subscription --------------------------------------------

test('the notification handle close() does not close the client', () => {
  // subscribeNotifications used to declare its own `closed`, shadowing the
  // client-level flag — so closing the notification handle looked like closing the
  // whole client to any later reader of that variable.
  const h = harness();
  const c = h.makeClient(CONN);
  const handle = c.subscribeNotifications(() => {});
  handle.close();
  assert.deepEqual(h.pools[0].closedRelays, [], 'the client itself is still open');
});

test('the client-level close is not shadowed', () => {
  assert.match(source, /let subClosed = false;/,
    'the notification subscription must not reuse the name `closed`');
});

test('the pool is built with reconnect ENABLED', async () => {
  // The root cause of the reported dead-socket failure: nostr-tools defaults
  // enableReconnect to false, so handleHardClose closed every subscription and never
  // reopened. One dropped socket left the client permanently dead, and every later
  // request burned the full timeout publishing into a corpse. Recovery only happened
  // by accident, when the service worker was evicted and cleared the cache.
  const h = harness({ probeOpens: true });
  const c = h.makeClient(CONN);
  await h.touch(c);
  assert.equal(h.pools.length, 1);
  assert.equal(h.pools[0].opts && h.pools[0].opts.enableReconnect, true);
});
