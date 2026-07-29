'use strict';

// Unit coverage for ensureNwc() in sidepanel.js — which wallet the panel is actually
// talking to.
//
// The bug: the client was cached under `state.activePubkey` alone. Swapping wallets
// inside one account (Restore, or connecting a different string) doesn't change the
// account, so ensureNwc() returned a client still pointed at the PREVIOUS wallet.
// Balance and history came back for the wallet that had just been replaced — a
// restored wallet holding 400 sats displayed 0. Disconnect nulls the client by hand,
// which is why removing and re-importing the very same string appeared to fix it.
//
// Nothing about that failure looks like a bug from the outside: no error, no empty
// state, just a confidently wrong number. Hence these.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const CONN_1 = 'nostr+walletconnect://w1?relay=wss%3A%2F%2Fr.example&secret=s1';
const CONN_2 = 'nostr+walletconnect://w2?relay=wss%3A%2F%2Fr.example&secret=s2';

// `var` so the mutable module state lands on the context's global object and the
// assertions can read it back after each call.
function harness({ pubkey, connection }) {
  const made = [];      // connection string per client constructed
  const closed = [];    // clients torn down
  const monitors = [];  // start/stop of the balance monitor
  const ctx = {
    console,
    state: { activePubkey: pubkey },
    call: async (msg) => {
      if (msg.type === 'SIDECAR_GET_NWC') return { connection: ctx.__conn };
      throw new Error('unexpected call ' + msg.type);
    },
    window: {
      SidecarNWC: {
        makeClient: (conn) => {
          made.push(conn);
          const c = { conn, close: () => closed.push(conn) };
          return c;
        },
      },
    },
    stopWalletMonitor: () => monitors.push('stop'),
    startWalletMonitor: () => monitors.push('start'),
    __conn: connection,
  };
  vm.createContext(ctx);
  vm.runInContext(
    'var nwc = null, nwcPubkey = null, nwcConn = null;' +
    'var balanceCache = { pubkey: null, sats: null };' +
    lift(/  async function ensureNwc\(\)\s*\{[\s\S]*?\n  \}/, 'ensureNwc') + '\n' +
    'globalThis.ensureNwc = ensureNwc;',
    ctx
  );
  return {
    ctx, made, closed, monitors,
    setConn: (c) => { ctx.__conn = c; },
    setPubkey: (p) => { ctx.state.activePubkey = p; },
    seedBalance: (pk, sats) => vm.runInContext(
      `balanceCache = { pubkey: ${JSON.stringify(pk)}, sats: ${sats} };`, ctx
    ),
    balance: () => vm.runInContext('balanceCache', ctx),
  };
}

// ---- caching ------------------------------------------------------------------

test('the same account and the same connection reuses one client', async () => {
  const h = harness({ pubkey: PK_A, connection: CONN_1 });
  const a = await h.ctx.ensureNwc();
  const b = await h.ctx.ensureNwc();
  assert.equal(h.made.length, 1, 'a second client would mean a leaked socket per call');
  assert.equal(a, b, 'same client instance');
});

test('a NEW connection on the SAME account rebuilds the client — the bug', async () => {
  const h = harness({ pubkey: PK_A, connection: CONN_1 });
  const first = await h.ctx.ensureNwc();
  h.setConn(CONN_2);                       // Restore / connect a different wallet
  const second = await h.ctx.ensureNwc();
  assert.notEqual(first, second, 'kept talking to the wallet that was replaced');
  assert.deepEqual([...h.made], [CONN_1, CONN_2]);
  assert.deepEqual([...h.closed], [CONN_1], 'the old client must be closed, not leaked');
});

test('switching account rebuilds the client', async () => {
  const h = harness({ pubkey: PK_A, connection: CONN_1 });
  await h.ctx.ensureNwc();
  h.setPubkey(PK_B);
  h.setConn(CONN_2);
  await h.ctx.ensureNwc();
  assert.deepEqual([...h.made], [CONN_1, CONN_2]);
});

test('the client is rebuilt for a new connection even when the string only just changed', async () => {
  // Guards the exact report: restoring a string that MATCHED a previous backup still
  // has to rebuild, because what matters is the string in use, not its provenance.
  const h = harness({ pubkey: PK_A, connection: CONN_1 });
  await h.ctx.ensureNwc();
  h.setConn(CONN_2);
  await h.ctx.ensureNwc();
  h.setConn(CONN_1);                       // restored back to the original
  await h.ctx.ensureNwc();
  assert.deepEqual([...h.made], [CONN_1, CONN_2, CONN_1]);
});

// ---- the stale balance --------------------------------------------------------

test('a balance from the previous wallet is dropped when the connection changes', async () => {
  const h = harness({ pubkey: PK_A, connection: CONN_1 });
  await h.ctx.ensureNwc();
  h.seedBalance(PK_A, 0);                  // the replaced wallet's balance
  h.setConn(CONN_2);
  await h.ctx.ensureNwc();
  assert.equal(h.balance().sats, null, 'a wrong number is worse than no number');
  assert.equal(h.balance().pubkey, null);
});

test('the balance is NOT dropped when nothing changed', async () => {
  const h = harness({ pubkey: PK_A, connection: CONN_1 });
  await h.ctx.ensureNwc();
  h.seedBalance(PK_A, 400);
  await h.ctx.ensureNwc();                 // same account, same connection
  assert.equal(h.balance().sats, 400, 'clearing every call would flicker the balance');
});

// ---- no wallet ----------------------------------------------------------------

test('no connection returns null and tears down any live client', async () => {
  const h = harness({ pubkey: PK_A, connection: CONN_1 });
  await h.ctx.ensureNwc();
  h.setConn(undefined);                    // disconnected
  const r = await h.ctx.ensureNwc();
  assert.equal(r, null);
  assert.deepEqual([...h.closed], [CONN_1], 'the old client kept polling a wallet that is gone');
  assert.equal(h.monitors.filter((m) => m === 'stop').length, 2);
});

test('no connection and no client is a quiet null', async () => {
  const h = harness({ pubkey: PK_A, connection: undefined });
  assert.equal(await h.ctx.ensureNwc(), null);
  assert.equal(h.made.length, 0);
});

// ---- the monitor -------------------------------------------------------------

test('the balance monitor follows the client it belongs to', async () => {
  const h = harness({ pubkey: PK_A, connection: CONN_1 });
  await h.ctx.ensureNwc();
  h.setConn(CONN_2);
  await h.ctx.ensureNwc();
  // Each rebuild stops the old monitor before starting one on the new client;
  // otherwise the old wallet keeps pushing balance updates over the new one.
  assert.deepEqual([...h.monitors], ['stop', 'start', 'stop', 'start']);
});
