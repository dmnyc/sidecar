'use strict';

// A zap notification should say how much.
//
// It already tried, but only from the `amount` tag on the embedded kind:9734 — which
// NIP-57 makes OPTIONAL, and which plenty of wallets omit. Measured on a real inbox:
// 140 receipts, 86 with an amount tag, and all 140 carrying a bolt11. So 39% displayed
// as a bare "zapped you" with the number sitting one tag over.
//
// The fallback needs no invoice parser. The amount is in the bolt11's human-readable
// part, and the separator is the LAST '1' — bech32 excludes '1' from its data charset
// for exactly this reason. That detail is the whole test: matching digits directly
// would read the separator of an amountless `lnbc1…` as an amount.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

const ctx = { console, JSON, Number, Math, String, parseInt, fmtSats: (n) => Math.round(n).toLocaleString('en-US') };
vm.createContext(ctx);
vm.runInContext(
  [
    source.match(/const BOLT11_MSAT = \{[^}]*\};/)[0],
    lift('function msatsFromBolt11('),
    lift('function zapAmountText('),
    lift('function zapMsats('),
    'globalThis.msatsFromBolt11 = msatsFromBolt11;',
    'globalThis.zapAmountText = zapAmountText;',
    'globalThis.zapMsats = zapMsats;',
  ].join('\n'),
  ctx
);
const { msatsFromBolt11, zapAmountText, zapMsats } = ctx;

// ---- reading the invoice ----------------------------------------------------------

test('real invoices decode to their real amounts', () => {
  // All three taken from live zap receipts and callbacks during this work.
  assert.equal(msatsFromBolt11('lnbc10u1p4fwghhpp53rpj8nwzmg8st0cn2632c20asqdn9qcn'), 1e6, '10u = 1000 sats');
  assert.equal(msatsFromBolt11('lnbc1u1pncldc4pp5wnhaphp'), 1e5, '1u = 100 sats');
  assert.equal(msatsFromBolt11('lnbc210n1p4fw9khpp5370xwu2gu0cwyrz'), 21000, '210n = 21 sats');
});

test('every multiplier converts correctly', () => {
  assert.equal(msatsFromBolt11('lnbc1m1xxxx'), 1e8, 'm = milli-BTC');
  assert.equal(msatsFromBolt11('lnbc1u1xxxx'), 1e5, 'u = micro-BTC');
  assert.equal(msatsFromBolt11('lnbc1n1xxxx'), 1e2, 'n = nano-BTC');
  assert.equal(msatsFromBolt11('lnbc10p1xxxx'), 1, 'p = pico-BTC; 10p is the smallest real unit');
});

test('AN AMOUNTLESS INVOICE READS AS ZERO, NOT AS ONE', () => {
  // The trap. In `lnbc1p3xnhl2…` that 1 is the bech32 separator, not an amount. A regex
  // matching digits after the prefix would call this 1 pico-BTC and print "<1 sat" for
  // an invoice that names no amount at all.
  assert.equal(msatsFromBolt11('lnbc1p3xnhl2pp5abcdef'), 0);
  assert.equal(msatsFromBolt11('lnbc1pvjluezpp5qqqsyq'), 0);
});

test('other chains are accepted, since the prefix is not the point', () => {
  assert.equal(msatsFromBolt11('lntb10u1xxxx'), 1e6, 'testnet');
  assert.equal(msatsFromBolt11('lnbcrt10u1xxxx'), 1e6, 'regtest');
});

test('no multiplier means whole BTC', () => {
  assert.equal(msatsFromBolt11('lnbc21xxxx'), 2e11, 'lnbc2 = 2 BTC');
});

test('garbage returns zero rather than throwing', () => {
  for (const bad of ['', null, undefined, 'not an invoice', 'lnbc', '1', 'lnbcxu1yyy', 'lnbc0u1yyy']) {
    assert.equal(msatsFromBolt11(bad), 0, JSON.stringify(bad));
  }
});

test('case is ignored, because QR-friendly invoices are uppercased', () => {
  // The donate page uppercases the bolt11 so it packs into alphanumeric QR mode; the
  // same string can arrive here.
  assert.equal(msatsFromBolt11('LNBC10U1P4FWGHHPP5'), 1e6);
});

// ---- choosing a source ------------------------------------------------------------

const withDesc = (amountMsat, bolt11) => ({
  kind: 9735,
  tags: [
    ['description', JSON.stringify({ kind: 9734, tags: amountMsat ? [['amount', String(amountMsat)]] : [] })],
    ...(bolt11 ? [['bolt11', bolt11]] : []),
  ],
});

test('the amount tag wins when present', () => {
  assert.equal(zapMsats(withDesc(21000, 'lnbc10u1xxxx')), 21000, 'tag first, invoice second');
});

test('THE INVOICE IS USED WHEN THE TAG IS ABSENT', () => {
  // The 54-of-140 case: this is the whole point of the change.
  assert.equal(zapMsats(withDesc(null, 'lnbc1u1pncldc4pp5')), 1e5);
});

test('a malformed description still falls through to the invoice', () => {
  const ev = { kind: 9735, tags: [['description', 'not json'], ['bolt11', 'lnbc10u1xxxx']] };
  assert.equal(zapMsats(ev), 1e6);
});

test('a zero or negative amount tag is not trusted over the invoice', () => {
  assert.equal(zapMsats(withDesc(0, 'lnbc10u1xxxx')), 1e6);
});

test('neither source means no amount, and that is a real answer', () => {
  assert.equal(zapMsats({ kind: 9735, tags: [] }), 0);
  assert.equal(zapAmountText(0), '', 'so the label falls back to "zapped you"');
});

// ---- the words --------------------------------------------------------------------

test('amounts read naturally', () => {
  assert.equal(zapAmountText(21000), '21 sats');
  assert.equal(zapAmountText(1000), '1 sat', 'singular, not "1 sats"');
  assert.equal(zapAmountText(1234000), '1,234 sats', 'grouped, like the wallet');
  assert.equal(zapAmountText(21000000), '21,000 sats');
});

test('a sub-sat zap says so instead of rounding to nothing', () => {
  // Someone did zap you; "0 sats" reads as a bug.
  assert.equal(zapAmountText(1), '<1 sat');
  assert.equal(zapAmountText(999), '<1 sat');
});

// ---- what was deliberately NOT changed ---------------------------------------------

test('the sent-zap gate still refuses a record with no amount', () => {
  // zap-requests.js looks like the same bug and is not. It matches a payment we are
  // about to make against a request Sidecar just signed — host + account + EXACT amount
  // + window. A record that would match any amount is not a safeguard, and reading the
  // invoice there would weaken a security gate to improve a label.
  const zr = fs.readFileSync(path.join(ROOT, 'zap-requests.js'), 'utf8');
  assert.match(zr, /if \(!Number\.isFinite\(msat\) \|\| msat <= 0\) return false;/);
  // Comments stripped: the prose in that file explains why the gate ignores the
  // BOLT11, so an unstripped search matches the very reasoning it is checking for.
  const code = zr.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
  assert.doesNotMatch(code, /bolt11/i, 'the gate must not start trusting the invoice');
});
