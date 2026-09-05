'use strict';

// Spending limits under a burst of payments.
//
// Budgets were written for zaps, which arrive at whatever pace a person clicks. One
// Podcasting 2.0 boost arrives as several keysends back to back — one per recipient in the
// show's value split — and that is a different problem:
//
//   - covers() answers a question and consume() acts on it much later (the background does
//     the debit in its un-awaited bookkeeping tail, after the payment lock has released).
//     Between those two moments every other split reads a balance nobody has debited yet.
//     reserve() collapses them into one step.
//   - covers() used to answer "yes" to zero and to negative amounts, and consume(-5) grew
//     the allowance by five. No BOLT11 invoice can express either, so it sat unreachable
//     until keysend started taking its amount straight from the page.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'wallet-budgets.js'), 'utf8');

const PK = 'pubkey1';
const HOST = 'boostmebitch.com';

// A storage mock that actually yields. Resolving synchronously would hide the very
// interleaving these tests exist to catch.
function load() {
  const store = {};
  const ctx = {
    chrome: {
      storage: {
        local: {
          get: (keys, cb) => setTimeout(() => cb({ ...store }), 0),
          set: (obj, cb) => setTimeout(() => { Object.assign(store, obj); cb(); }, 0),
        },
      },
    },
    setTimeout,
    Date,
    Math,
    Object,
    Number,
    Promise,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return ctx.SidecarBudgets;
}

test('four splits cannot all clear a budget with room for two', async () => {
  const B = load();
  await B.setBudget(PK, HOST, { budgetSats: 100, perPaymentSats: 0 });

  // A boost fires its splits without waiting for each other.
  const results = await Promise.all([
    B.reserve(PK, HOST, 50),
    B.reserve(PK, HOST, 50),
    B.reserve(PK, HOST, 50),
    B.reserve(PK, HOST, 50),
  ]);

  assert.equal(results.filter(Boolean).length, 2, 'exactly two 50-sat splits fit in 100 sats');
  const rec = await B.getBudget(PK, HOST);
  assert.equal(rec.remainingSats, 0, 'and the balance reflects both, with no lost decrement');
});

test('covers() is not a substitute for reserving', async () => {
  const B = load();
  await B.setBudget(PK, HOST, { budgetSats: 100, perPaymentSats: 0 });
  // The read-only question still answers honestly...
  assert.equal(await B.covers(PK, HOST, 50), true);
  await B.reserve(PK, HOST, 100);
  // ...and stops saying yes once the allowance is actually spent.
  assert.equal(await B.covers(PK, HOST, 50), false);
});

test('a zero-sat payment is not covered by an exhausted budget', async () => {
  const B = load();
  await B.setBudget(PK, HOST, { budgetSats: 100, perPaymentSats: 0 });
  await B.reserve(PK, HOST, 100); // spend it all
  assert.equal(await B.covers(PK, HOST, 0), false);
  assert.equal(await B.reserve(PK, HOST, 0), false);
});

test('a negative amount cannot be reserved, consumed, or used to grow the budget', async () => {
  const B = load();
  await B.setBudget(PK, HOST, { budgetSats: 100, perPaymentSats: 0 });
  await B.reserve(PK, HOST, 60);

  assert.equal(await B.covers(PK, HOST, -5), false);
  assert.equal(await B.reserve(PK, HOST, -5), false);
  await B.consume(PK, HOST, -5);
  await B.refund(PK, HOST, -5);

  const rec = await B.getBudget(PK, HOST);
  assert.equal(rec.remainingSats, 40, 'nothing above put sats back');
});

test('a fractional amount is not spendable', async () => {
  const B = load();
  await B.setBudget(PK, HOST, { budgetSats: 100, perPaymentSats: 0 });
  assert.equal(await B.reserve(PK, HOST, 10.5), false);
  assert.equal((await B.getBudget(PK, HOST)).remainingSats, 100);
});

test('the per-payment cap still applies to a reservation', async () => {
  const B = load();
  await B.setBudget(PK, HOST, { budgetSats: 1000, perPaymentSats: 100 });
  assert.equal(await B.reserve(PK, HOST, 101), false);
  assert.equal(await B.reserve(PK, HOST, 100), true);
});

test('a refund puts back exactly what was reserved, and never more than the budget', async () => {
  const B = load();
  await B.setBudget(PK, HOST, { budgetSats: 100, perPaymentSats: 0 });
  await B.reserve(PK, HOST, 40);
  await B.refund(PK, HOST, 40);
  assert.equal((await B.getBudget(PK, HOST)).remainingSats, 100);

  // A refund larger than what was taken cannot mint an allowance.
  await B.refund(PK, HOST, 500);
  assert.equal((await B.getBudget(PK, HOST)).remainingSats, 100);
});

test('a site with no budget reserves nothing', async () => {
  const B = load();
  assert.equal(await B.reserve(PK, 'never-seen.example', 10), false);
});

test('a routing fee is debited on top of the reservation', async () => {
  // Reserving happens before the payment, so it books the amount and cannot know the fee.
  // On keysend that gap is not a rounding error: the first live boost paid a 1 sat fee on a
  // 1 sat leg. The background books it afterwards with consume(); this is that arithmetic.
  const B = load();
  await B.setBudget(PK, HOST, { budgetSats: 100, perPaymentSats: 0 });
  assert.equal(await B.reserve(PK, HOST, 33), true);
  const feeMsat = 1000; // what pay_keysend reported
  await B.consume(PK, HOST, Math.ceil(feeMsat / 1000));
  assert.equal((await B.getBudget(PK, HOST)).remainingSats, 66, '33 paid + 1 fee, not 33 alone');
});

test('a sub-sat fee still costs a sat rather than nothing', async () => {
  const B = load();
  await B.setBudget(PK, HOST, { budgetSats: 100, perPaymentSats: 0 });
  await B.reserve(PK, HOST, 10);
  await B.consume(PK, HOST, Math.ceil(400 / 1000)); // 0.4 sat of routing
  assert.equal((await B.getBudget(PK, HOST)).remainingSats, 89, 'rounded up, never floored to free');
});
