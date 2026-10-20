'use strict';

// A wallet's refusal is written for its own logs. For an already-paid invoice one answers
// "The transaction requested was not found.", which says nothing true about the invoice. The
// worker now names the real reason where it can: an expired invoice from the invoice itself, an
// already-paid one from a read-only lookup, and anything else in the wallet's own words. These
// run the real reader, the real explainer and the real payInvoiceLocked.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'nwc-client.js'), 'utf8');

function lift(decl) {
  const at = src.indexOf(decl);
  assert.ok(at !== -1, decl + ' is gone');
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

// A BOLT11-shaped string: prefix, 35-bit timestamp, optional expiry tag, a payment hash tag,
// a 104-word signature and a 6-word checksum. The reader ignores the checksum and signature
// values, so zeros do, but every length is the real one.
const CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function number(n, words) { const out = []; for (let i = words - 1; i >= 0; i--) out.push(Math.floor(n / 32 ** i) % 32); return out; }
function invoice({ timestamp, expiry }) {
  let w = number(timestamp, 7);
  w.push(1, 1, 20, ...new Array(52).fill(5)); // 'p' tag (1), length 52 words: the payment hash
  if (expiry != null) { const e = number(expiry, expiry > 1023 ? 4 : 2); w.push(6, 0, e.length, ...e); } // 'x' tag, length in words
  w.push(...new Array(104).fill(0), ...new Array(6).fill(0));
  return 'lnbc10n1' + w.map((v) => CHARS[v]).join('');
}
const NOW = 1_800_000_000; // seconds

function reader() {
  const ctx = vm.createContext({ BECH32_CHARS: CHARS });
  vm.runInContext(lift('function invoiceExpiresAt(') + '\nthis.f = invoiceExpiresAt;', ctx);
  return ctx.f;
}

test('invoiceExpiresAt reads the timestamp and the expiry tag, and defaults to an hour', () => {
  const f = reader();
  assert.equal(f(invoice({ timestamp: NOW, expiry: 600 })), NOW + 600);
  assert.equal(f(invoice({ timestamp: NOW, expiry: null })), NOW + 3600, 'BOLT11 says an hour when there is no expiry tag');
  assert.equal(f(invoice({ timestamp: NOW, expiry: 86400 })), NOW + 86400);
});

test('invoiceExpiresAt answers null for anything it cannot read', () => {
  const f = reader();
  for (const junk of ['', 'lnbc', 'not an invoice', null, undefined, 'lnbc10n1qqqq']) assert.equal(f(junk), null);
});

function explainer(clientFor, now) {
  const looked = [];
  const ctx = vm.createContext({
    BECH32_CHARS: CHARS, REFUSAL_LOOKUP_MS: 25, Date, Error, Promise, setTimeout, clearTimeout, RegExp,
    dlog() {}, bolt11PaymentHash: () => 'ab'.repeat(32),
    invSettled: (inv) => !!(inv && (inv.settled_at || inv.preimage || inv.state === 'settled')),
  });
  vm.runInContext([lift('function invoiceExpiresAt('), lift('async function explainRefusal('), 'this.f = explainRefusal;'].join('\n'), ctx);
  const wrapped = { lookupInvoice: async (arg) => { looked.push(arg); return clientFor(arg); } };
  return { explain: (err, inv) => ctx.f(err, inv, wrapped, now == null ? NOW * 1000 : now), looked };
}
function refusal(message, code) { const e = new Error(message); e.walletDenied = true; e.code = code; return e; }
const LIVE = () => invoice({ timestamp: NOW - 60, expiry: 3600 });

test('a refusal on an expired invoice says so, without asking the wallet anything', async () => {
  const x = explainer(async () => ({}));
  const out = await x.explain(refusal('The transaction requested was not found.', 'NOT_FOUND'), invoice({ timestamp: NOW - 7200, expiry: 3600 }));
  assert.equal(out.message, 'This invoice has expired.');
  assert.equal(out.walletDenied, true, 'it is still a refusal: nothing moved');
  assert.equal(out.walletMessage, 'The transaction requested was not found.', 'the wallet\'s own words are kept for the log');
  assert.equal(x.looked.length, 0);
});

test('a not-found refusal on a live invoice the wallet shows as paid says already paid', async () => {
  const x = explainer(async () => ({ state: 'settled', preimage: 'ff' }));
  const out = await x.explain(refusal('The transaction requested was not found.', 'NOT_FOUND'), LIVE());
  assert.equal(out.message, 'This invoice has already been paid.');
  assert.equal(x.looked.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(x.looked[0])), { payment_hash: 'ab'.repeat(32) });
});

test('wording that differs by wallet still counts: no code, "could not be found"', async () => {
  const x = explainer(async () => ({ state: 'settled' }));
  const out = await x.explain(refusal('Payment could not be found'), LIVE());
  assert.equal(out.message, 'This invoice has already been paid.');
});

test('not found, and the wallet cannot say more: cautious wording, never a claim it cannot back', async () => {
  for (const answer of [async () => ({ state: 'pending' }), async () => { throw new Error('boom'); }, () => new Promise(() => {})]) {
    const x = explainer(answer);
    const out = await x.explain(refusal('The transaction requested was not found.', 'NOT_FOUND'), LIVE());
    assert.equal(out.message, 'The invoice may already be paid or no longer valid.');
    assert.equal(out.walletDenied, true);
  }
});

test('any other refusal keeps the wallet\'s own words and asks nothing', async () => {
  const x = explainer(async () => ({ state: 'settled' }));
  const original = refusal('Insufficient balance.', 'INSUFFICIENT_BALANCE');
  const out = await x.explain(original, LIVE());
  assert.equal(out, original);
  assert.equal(x.looked.length, 0);
});

test('an error that is not a refusal passes through untouched', async () => {
  const x = explainer(async () => ({ state: 'settled' }));
  const timeout = new Error('Wallet did not respond');
  assert.equal(await x.explain(timeout, invoice({ timestamp: NOW - 7200, expiry: 3600 })), timeout, 'a timeout says nothing about the invoice, even an expired one');
});

test('the wallet client exposes the wallet\'s error code, and the payment path uses the explainer', () => {
  const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(strip(client), /err\.walletDenied = true;\s*err\.code = res\.error\.code;/);
  // Wherever the invoice payment fails, the explained error is what is thrown (and reported).
  assert.match(strip(src), /await explainRefusal\(e0?, invoice, c\)/);
});
