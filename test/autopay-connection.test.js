'use strict';

// Auto-pay must require a connected site — a regression guard for the fuzzpic
// class of page: any page can embed a Lightning invoice, and an invoice under
// the auto-zap cap must still be a prompt, not a payment, unless Sidecar is
// actually connected to that site.
//
// tryZapAutopay lives inside background.js, so the function is lifted out by
// regex and run in a vm with stubs for everything it touches — the same pattern
// as test/notif-mute.test.js. The stubs record what they were asked to do, so
// the tests can assert not just that a payment didn't happen, but where the
// decision turned.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in background.js');
  return m[0];
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  lift(/async function tryZapAutopay\(invoiceRaw, host, originWindowId, tabId\) \{[\s\S]*?\n\}\n/, 'tryZapAutopay')
    // The gate under test, plus its helper — everything else is a stub.
    + lift(/async function getSiteAccount\(host\) \{[\s\S]*?\n\}\n/, 'getSiteAccount')
    + [
      // A fake storage.local holding the site bindings the tests seed.
      'var __store = {};',
      'function sget(k){ return Promise.resolve({ [k]: __store[k] }); }',
      'function sset(o){ Object.assign(__store, o); return Promise.resolve(); }',
      // The site-account map key, same as background.js.
      'var SITE_ACCTS_KEY = "sidecar_site_accounts";',
      'function getSiteAccountFull(){}',
      // tryZapAutopay's collaborators, all observable stubs.
      'function autoZapLimits(){ return { perZap: 1000 }; }',
      'function invoiceSats(){ return 21; }', // always under the cap
      'function dlog(){}',
      'var PERMS = { getLevel: async () => "once" };',
      // peek answers true by default: the zap-request gate must NOT be what
      // declines in these tests — that would prove nothing about the new gate.
      'var __peek = true;',
      'var ZAPREQ = { peek: async () => __peek };',
      'var __paid = [];',
      'function notifyTabAutopaying(){}',
      'function notifyTabPaid(){}',
      'function notifyTabPayFailed(){}',
      'async function payInvoiceCore(inv, host, who){ __paid.push({ inv, host, who }); return {}; }',
      // resolveSiteAccount's active-account fallback is the thing the gate has
      // to survive, so the stub reproduces its real semantics: use the binding
      // only when its account still exists, else fall back to the active one.
      'var __active = "acct-active";',
      'var __bindingAccountExists = true;',
      'var KS = { isLocked: () => false, hasAccount: async () => __bindingAccountExists };',
      'async function resolveSiteAccount(host){ var b = await getSiteAccount(host); return b && __bindingAccountExists ? b : __active; }',
    ].join('\n'),
  ctx
);

const INV = 'lnbc210n1qinvoice';

async function probe(host) {
  const r = await ctx.tryZapAutopay(INV, host, 1, 7);
  return r;
}

beforeEach(() => {
  ctx.__store = {};
  ctx.__paid = [];
  ctx.__peek = true;
  ctx.__bindingAccountExists = true;
});

test('a site with no binding never auto-pays, however small the invoice', async () => {
  // fuzzpic.com shape: never signed in, so no site account. The active-account
  // fallback must not stand in for a connection — and the zap-request stub is
  // answering YES, so the binding check is the only thing declining.
  const r = await probe('fuzzpic.com');
  assert.equal(r.paid, false);
  assert.equal(r.handled, false);
  assert.deepEqual(ctx.__paid, [], 'no payment call was made');
});

test('a binding to the paying account proceeds to the normal gates', async () => {
  ctx.__store[ctx.SITE_ACCTS_KEY] = { 'snort.social': 'acct-active' };
  const r = await probe('snort.social');
  assert.deepEqual(ctx.__paid.map((p) => p.host), ['snort.social'], 'payment went through');
  assert.equal(r.paid, true);
});

test('a binding whose account no longer exists declines rather than paying from the fallback', async () => {
  // Fail closed: a stale binding (its account was deleted) makes
  // resolveSiteAccount fall back to the active account, and that fallback must
  // not stand in for a connection. A payment is the wrong place to find out the
  // two disagree.
  ctx.__bindingAccountExists = false;
  ctx.__store[ctx.SITE_ACCTS_KEY] = { 'example.com': 'acct-other' };
  const r = await probe('example.com');
  assert.equal(r.paid, false);
  assert.deepEqual(ctx.__paid, []);
});

test('a bound site with no matching zap request still declines', async () => {
  ctx.__store[ctx.SITE_ACCTS_KEY] = { 'snort.social': 'acct-active' };
  ctx.__peek = false;
  const r = await probe('snort.social');
  assert.equal(r.paid, false);
  assert.deepEqual(ctx.__paid, [], 'connection alone was never sufficient');
});
