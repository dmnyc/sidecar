'use strict';

// Unit coverage for demo-funds.js.
//
// This module fabricates numbers that look like money. If it ever activates in a
// store build, or survives a lock, a user could act on a balance that doesn't
// exist. The tests below are mostly about the guards, not the fake data:
//
//   - isOn()/setOn() must fail closed on anything that isn't exactly `true` for the
//     dev flag. Truthy-ish values (1, 'yes', {}) must NOT count.
//   - wrap() must refuse payInvoice/makeInvoice, so real sats can't move while the
//     displayed balance is invented.
//   - clear() must work regardless of dev status — it's called from lockKeystore()
//     unconditionally.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// Minimal chrome.storage.session stand-in, so the guards are exercised against
// something that behaves like the real area (promise-returning get/set/remove).
function makeHarness({ withSession = true } = {}) {
  const store = new Map();
  const session = {
    get: async (k) => (store.has(k) ? { [k]: store.get(k) } : {}),
    set: async (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
    remove: async (k) => { store.delete(k); },
  };
  const sandbox = {
    console,
    chrome: withSession ? { storage: { session } } : { storage: {} },
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'demo-funds.js'), 'utf8'), sandbox);
  return { DEMO: sandbox.SidecarDemoFunds, store };
}

let DEMO, store;
beforeEach(() => { ({ DEMO, store } = makeHarness()); });

test('the module loads and exposes its surface', () => {
  assert.equal(typeof DEMO.isOn, 'function');
  assert.equal(typeof DEMO.setOn, 'function');
  assert.equal(typeof DEMO.clear, 'function');
  assert.equal(typeof DEMO.wrap, 'function');
  assert.equal(DEMO.KEY, 'sidecar_demo_funds');
});

test('off by default', async () => {
  assert.equal(await DEMO.isOn(true), false);
});

test('turning it on in a dev build works and reads back', async () => {
  assert.equal(await DEMO.setOn(true, true), true);
  assert.equal(await DEMO.isOn(true), true);
});

// The central guard. A store build must never see demo mode, whatever is stored.
test('a store build cannot turn it on', async () => {
  assert.equal(await DEMO.setOn(true, false), false);
  assert.equal(store.has(DEMO.KEY), false, 'nothing should have been written');
});

test('a store build reads false even when the key IS set', async () => {
  await DEMO.setOn(true, true);              // set from a dev context
  assert.equal(await DEMO.isOn(true), true);
  assert.equal(await DEMO.isOn(false), false, 'store build must ignore the stored flag');
});

// Fail closed, not open: only an exact `true` counts. A future caller passing a
// truthy-ish value must not accidentally enable this.
test('only an exact true counts as a dev build', async () => {
  for (const notTrue of [1, 'true', 'yes', {}, [], 'development', undefined, null]) {
    assert.equal(await DEMO.setOn(true, notTrue), false, JSON.stringify(notTrue) + ' must not enable');
  }
  await DEMO.setOn(true, true);
  for (const notTrue of [1, 'true', 'yes', {}, [], 'development', undefined, null]) {
    assert.equal(await DEMO.isOn(notTrue), false, JSON.stringify(notTrue) + ' must not read as on');
  }
});

test('turning it off removes the key rather than storing false', async () => {
  await DEMO.setOn(true, true);
  await DEMO.setOn(false, true);
  assert.equal(store.has(DEMO.KEY), false);
  assert.equal(await DEMO.isOn(true), false);
});

test('clear() works and does not need the dev flag — lockKeystore calls it blind', async () => {
  await DEMO.setOn(true, true);
  await DEMO.clear();
  assert.equal(await DEMO.isOn(true), false);
  await assert.doesNotReject(() => DEMO.clear(), 'clearing an already-clear flag must be safe');
});

test('no session storage available → stays off instead of throwing', async () => {
  const { DEMO: d } = makeHarness({ withSession: false });
  assert.equal(await d.isOn(true), false);
  assert.equal(await d.setOn(true, true), false);
  await assert.doesNotReject(() => d.clear());
});

// ---- fabricated data ----------------------------------------------------------

test('transactions are shaped like NWC results the panel already renders', async () => {
  const txs = DEMO.buildTransactions(Date.now());
  assert.ok(txs.length >= 10, 'enough rows to exercise paging');
  for (const tx of txs) {
    assert.ok(tx.type === 'incoming' || tx.type === 'outgoing');
    assert.equal(typeof tx.amount, 'number');
    assert.ok(tx.amount > 0);
    // The panel divides amount by 1000, so these must be msats.
    assert.equal(tx.amount % 1000, 0, 'amounts should be whole sats expressed as msats');
    assert.equal(typeof tx.settled_at, 'number');
    assert.ok(tx.settled_at > 1_000_000_000, 'settled_at must be unix SECONDS, not ms');
    assert.ok(tx.settled_at < 100_000_000_000, 'a ms timestamp here would render as the year 5138');
    assert.ok(tx.created_at <= tx.settled_at);
    assert.equal(tx.payment_hash.length, 64);
    assert.equal(tx.preimage.length, 64);
  }
});

test('transactions look recent relative to now, not to a hardcoded date', () => {
  const now = Date.UTC(2030, 0, 1); // arbitrary future "now"
  const txs = DEMO.buildTransactions(now);
  const newest = Math.max(...txs.map((t) => t.settled_at)) * 1000;
  assert.ok(now - newest < 60 * 60 * 1000, 'newest row should be within the hour of the given now');
  const oldest = Math.min(...txs.map((t) => t.settled_at)) * 1000;
  assert.ok(now - oldest < 30 * 24 * 3600 * 1000, 'oldest row should still be within a month');
});

// The first version of this data was all round numbers with a memo on every row,
// which read as generated at a glance. These assert the shape that fixed it, since
// it's the kind of thing that quietly degrades when someone adds a row.
test('amounts mix round zap-sized values with irregular ones', () => {
  const sats = DEMO.buildTransactions(Date.now()).map((t) => t.amount / 1000);
  const round = sats.filter((v) => v % 100 === 0);
  const irregular = sats.filter((v) => v % 100 !== 0);
  assert.ok(round.length >= 3, 'zaps really are round numbers — some should be');
  assert.ok(irregular.length >= 3, 'fiat-denominated and order amounts are not round');
});

test('most rows carry no memo, as a real NWC list does', () => {
  const txs = DEMO.buildTransactions(Date.now());
  const bare = txs.filter((t) => !t.description);
  assert.ok(bare.length >= 3, 'bare zaps have no description — txRow shows Received/Sent');
  assert.ok(bare.length < txs.length, 'but not all of them, or the list has no texture');
});

test('both directions are represented, with fees only on outgoing', () => {
  const txs = DEMO.buildTransactions(Date.now());
  assert.ok(txs.some((t) => t.type === 'incoming'));
  assert.ok(txs.some((t) => t.type === 'outgoing'));
  for (const t of txs) {
    if (t.type === 'incoming') assert.equal(t.fees_paid, 0, 'receiving costs nothing');
    else assert.ok(t.fees_paid > 0, 'an outgoing payment pays a routing fee');
  }
});

// Percentage alone is the wrong test: routing has an effective ~1 sat floor, so a
// 100 sat payment legitimately pays 1%. Either the fee is at the floor, or it's a
// small fraction of the amount.
test('routing fees stay plausible — at the 1 sat floor, or well under 1%', () => {
  for (const t of DEMO.buildTransactions(Date.now())) {
    if (t.type !== 'outgoing') continue;
    const feeSats = t.fees_paid / 1000;
    const pct = (t.fees_paid / t.amount) * 100;
    assert.ok(
      feeSats <= 1 || pct < 0.5,
      'fee on ' + (t.amount / 1000) + ' sats was ' + feeSats + ' sats (' + pct.toFixed(2) + '%)'
    );
  }
});

test('hashes look like hex rather than an arithmetic pattern', () => {
  for (const t of DEMO.buildTransactions(Date.now())) {
    assert.match(t.payment_hash, /^[0-9a-f]{64}$/);
    assert.match(t.preimage, /^[0-9a-f]{64}$/);
    // The old generator emitted long ascending runs like "0123456789abcdef".
    assert.ok(!/0123456789/.test(t.payment_hash), 'hash should not read as a counter');
  }
});

// These rows are screenshotted for the store listings. An earlier version used real
// handles at real providers, which put someone else's service — and a real person's
// name — into Sidecar's marketing. Every counterparty must be ours.
test('no real wallet providers or third-party domains appear', () => {
  const text = DEMO.buildTransactions(Date.now()).map((t) => t.description).join(' ').toLowerCase();
  for (const host of [
    'getalby.com', 'walletofsatoshi.com', 'primal.net', 'zbd.gg', 'strike.me',
    'coinos.io', 'minibits.cash', 'blink.sv', 'zeusln.app', 'nostrplebs.com',
  ]) {
    assert.ok(!text.includes(host), 'demo data must not reference ' + host);
  }
});

test('every counterparty lightning address is at a domain we control', () => {
  for (const tx of DEMO.buildTransactions(Date.now())) {
    const d = tx.description || '';
    if (!d.includes('@')) continue;
    assert.match(d, /@sidecar\.top$/, 'unexpected counterparty domain: ' + d);
  }
});

// The receive address is held to the same rule as the counterparties, and for a
// sharper reason: it's encoded into a QR that gets published in store screenshots,
// so a third-party address here would be scannable by anyone reading a listing.
test('the demo receive address is well-formed and at a domain we control', () => {
  assert.match(DEMO.DEMO_LUD16, /^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/i);
  assert.match(DEMO.DEMO_LUD16, /@sidecar\.top$/, 'a scannable QR must not point off-domain');
});

test('getInfo advertises the demo address, so the receive card has one', async () => {
  const info = await DEMO.wrap(null).getInfo();
  assert.equal(info.lud16, DEMO.DEMO_LUD16);
  assert.equal(info.alias, 'Demo wallet');
});

test('the invoice stub cannot be mistaken for a payable bolt11', () => {
  for (const tx of DEMO.buildTransactions(Date.now())) {
    assert.ok(tx.invoice.startsWith('lnbcDEMO'), 'got ' + tx.invoice);
    assert.ok(!/^lnbc[0-9]/.test(tx.invoice), 'must not parse as a real amount-carrying invoice');
  }
});

test('output is stable across calls at the same instant — screenshots stay diffable', () => {
  const t = 1_800_000_000_000;
  assert.deepEqual(DEMO.buildTransactions(t), DEMO.buildTransactions(t));
});

// ---- the client decorator ------------------------------------------------------

test('wrap() serves fake reads', async () => {
  const c = DEMO.wrap(null);
  const b = await c.getBalance();
  assert.equal(b.balance, DEMO.DEMO_BALANCE_MSAT);
  const list = await c.listTransactions({ limit: 5, offset: 0 });
  assert.equal(list.transactions.length, 5);
});

test('wrap() honors limit and offset, so "Show more" paginates', async () => {
  const c = DEMO.wrap(null);
  const first = await c.listTransactions({ limit: 4, offset: 0 });
  const second = await c.listTransactions({ limit: 4, offset: 4 });
  assert.equal(first.transactions.length, 4);
  assert.equal(second.transactions.length, 4);
  assert.notDeepEqual(first.transactions[0], second.transactions[0]);
});

// The most important behavior in the file: a fabricated balance must not be
// spendable, because the user might act on it.
test('wrap() REFUSES to move money', async () => {
  let realPayCalled = false;
  const real = { payInvoice: () => { realPayCalled = true; return Promise.resolve({}); } };
  const c = DEMO.wrap(real);
  await assert.rejects(() => c.payInvoice('lnbc1...'), /[Dd]emo funds/);
  await assert.rejects(() => c.makeInvoice({ amount: 1000 }), /[Dd]emo funds/);
  assert.equal(realPayCalled, false, 'the real client must never be reached');
});

test('the refusal is tagged so callers can tell it apart from a wallet error', async () => {
  const c = DEMO.wrap(null);
  const err = await c.payInvoice('lnbc1...').then(() => null, (e) => e);
  assert.equal(err.demoBlocked, true);
});

test('wrap() marks itself, so a caller can assert which client it holds', () => {
  assert.equal(DEMO.wrap(null).isDemo, true);
});

test('wrap() survives a null client — demo mode is for when nothing is connected', async () => {
  const c = DEMO.wrap(null);
  await assert.doesNotReject(() => c.getBalance());
  assert.equal(typeof c.close, 'function');
  assert.doesNotThrow(() => c.close());
});

test('wrap() passes non-money methods through to the real client', async () => {
  let closed = false;
  const real = { close: () => { closed = true; }, lookupInvoice: async () => ({ state: 'settled' }) };
  const c = DEMO.wrap(real);
  c.close();
  assert.equal(closed, true);
  assert.deepEqual(await c.lookupInvoice({}), { state: 'settled' });
});
