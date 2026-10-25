'use strict';

// A payment that arrives while the wallet is open raised a toast and moved the balance, but the
// history only caught up when the wallet was reopened: the notification handler refreshed the
// balance and never the list.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const at = source.indexOf('  function startWalletMonitor(client, connection) {');
const fn = source.slice(at, source.indexOf('  // Build (or reuse) the NWC client', at));

function monitor({ locked = false } = {}) {
  const calls = [], toasts = [];
  let push;
  const ctx = {
    state: { locked }, nwcNotifSub: null, nwcPollTimer: null,
    stopWalletMonitor() {}, setInterval: () => 1, clearInterval() {},
    window: { SidecarNWC: { wakesByPush: () => false } }, balanceOnScreen: () => true, NWC_POLL_MS: 60000,
    refreshWalletBalance: () => calls.push('balance'), refreshTransactionList: () => calls.push('list'),
    toast: (m) => toasts.push(m), t: (x, v) => (v ? x.replace('{{amount}}', v.amount) : x), fmtSats: String, msatToSat: (m) => m / 1000,
  };
  vm.createContext(ctx);
  vm.runInContext(fn, ctx);
  ctx.startWalletMonitor({ subscribeNotifications: (cb) => { push = cb; return { close() {} }; } }, 'nostr+walletconnect://w?relay=wss%3A%2F%2Fr.example&secret=s');
  return { calls, toasts, push: (type, amount) => push({ notification_type: type, notification: { amount } }) };
}

test('a payment received while the wallet is open refreshes the history as well as the balance', () => {
  const m = monitor();
  m.push('payment_received', 21000);
  assert.deepEqual(m.calls, ['balance', 'list']);
  assert.equal(m.toasts.length, 1);
});

test('a payment sent refreshes the history too', () => {
  const m = monitor();
  m.push('payment_sent', 5000);
  assert.deepEqual(m.calls, ['balance', 'list']);
  assert.equal(m.toasts.length, 0, 'sending raises no received toast');
});

test('other notifications and a locked panel refresh nothing', () => {
  const a = monitor();
  a.push('something_else', 1);
  assert.deepEqual(a.calls, []);
  const b = monitor({ locked: true });
  b.push('payment_received', 1000);
  assert.deepEqual(b.calls, []);
});
