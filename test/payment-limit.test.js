'use strict';

// SIDECAR PAYS AT MOST 99,999,999 SATS AT ONCE, on every surface, and the last check sits under
// all of them. These run the real code:
//   - nwc-client.js refuses a pay_invoice or pay_keysend over the limit without sending a thing
//     to the wallet, marked walletDenied (the money stayed put)
//   - a page's keysend over the limit is refused with the page's message, flagged so the card
//     that says why is shown
//   - the panel's payment forms (zaps, offers, the Send sheet) refuse it with the sentence to show
//   - the page card does not offer to pay an invoice over it
//   - the limit is one number in all four files
// The page's invoice path and both approval cards are run in the real extension by
// test/payment-limit-card.browser.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
function block(src, header) {
  const start = src.indexOf(header);
  assert.notEqual(start, -1, header + ' is gone');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced');
}
const DATA = 'pjq' + 'q'.repeat(200) + 'xyz0234567';

// nwc-client.js as the panel loads it, with nostr-tools stood in for: anything that reaches
// the wallet is recorded instead of sent.
function nwc() {
  const sent = [];
  const nt = {
    nip47: { parseConnectionString: () => ({ pubkey: 'ab'.repeat(32), relay: 'wss://relay.example', secret: 'cd'.repeat(32) }) },
    getPublicKey: () => 'ef'.repeat(32),
    finalizeEvent: (e) => { sent.push(e); return { ...e, id: 'x', sig: 'y' }; },
    nip04: { encrypt: async () => 'cipher' }, nip44: {},
    SimplePool: class { subscribeMany() { return { close() {} }; } subscribe() { return { close() {} }; } publish() { sent.push('publish'); return [Promise.resolve()]; } close() {} },
  };
  // The file attaches itself to `self`, as in the worker and the panel.
  const ctx = { console, setTimeout, clearTimeout, Uint8Array, TextEncoder, TextDecoder, Promise };
  ctx.self = ctx;
  ctx.NostrTools = nt;
  vm.createContext(ctx);
  vm.runInContext(read('nwc-client.js'), ctx);
  return { NWC: ctx.SidecarNWC, sent };
}

test('the NWC client refuses a payment over the limit without sending anything', async () => {
  const { NWC, sent } = nwc();
  assert.equal(NWC.MAX_PAY_SATS, 99999999);
  const c = NWC.makeClient('nostr+walletconnect://x');
  for (const attempt of [
    () => c.payInvoice('lnbc11' + DATA),                              // 1 BTC, from the invoice
    () => c.payInvoice('lnbc1' + DATA, 100000000 * 1000),             // an amountless one, 1 BTC asked
    () => c.payKeysend({ amount: 100000000 * 1000, pubkey: '02' + 'a'.repeat(64) }),
  ]) {
    await assert.rejects(attempt(), (e) => e.overLimit === true && e.walletDenied === true && /99,999,999/.test(e.message));
  }
  assert.deepEqual(sent, [], 'something reached the wallet');
  // The limit itself is payable, as far as this check goes.
  assert.equal(NWC.invoiceMsat('lnbc999999990n1' + DATA), 99999999000);
});

test('a page\'s keysend over the limit is refused, flagged for the card', () => {
  const bg = read('background.js');
  const ctx = {};
  vm.createContext(ctx);
  const lifted = ['const TLV_BOOSTAGRAM', 'const TLV_KEYSEND_PREIMAGE', 'const TLV_MIN_TYPE', 'const TLV_MAX_RECORDS',
    'const TLV_MAX_VALUE_BYTES', 'const TLV_MAX_TOTAL_BYTES', 'const KEYSEND_MAX_SATS', 'const OVER_LIMIT_MESSAGE']
    .map((h) => bg.slice(bg.indexOf(h), bg.indexOf(';\n', bg.indexOf(h)) + 1)).join('\n');
  vm.runInContext(lifted + '\nconst toHex = (b) => "";\n' + block(bg, 'function normalizeKeysend(params) {') + '\nthis.normalizeKeysend = normalizeKeysend;', ctx);
  const dest = '02' + 'a'.repeat(64);
  assert.equal(ctx.normalizeKeysend({ destination: dest, amount: 99999999 }).sats, 99999999);
  assert.throws(() => ctx.normalizeKeysend({ destination: dest, amount: 100000000 }),
    (e) => e.overLimit === true && e.message === "Sidecar can't pay more than 99,999,999 sats at once");
});

test('the panel\'s payment forms refuse an amount over the limit, with the sentence to show', () => {
  const panel = read('sidepanel.js');
  const ctx = {
    self: { SidecarNWC: { MAX_PAY_SATS: 99999999 } },
    tSec: (s, p) => s.replace(/\{\{(\w+)\}\}/g, (m, k) => p[k]),
    fmtSats: (n) => n.toLocaleString('en-US'),
    setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  const start = panel.indexOf('  // MORE THAN SIDECAR PAYS is not a larger send');
  const end = panel.indexOf('\n  }\n', panel.indexOf('  function largeSendGate(')) + 4;
  vm.runInContext(panel.slice(start, end) + '\nthis.largeSendGate = largeSendGate;', ctx);
  const attrs = {};
  const button = { textContent: '', disabled: false, classList: { toggle() {} }, setAttribute: (k, v) => { attrs[k] = v; } };
  let shown = '';
  let n = 0;
  const gate = ctx.largeSendGate(button, { sats: () => n, label: () => 'Pay', confirmLabel: 'Confirm', refuse: (m) => { shown = m; } });
  n = 100000000;
  assert.equal(gate.pass(n), false);
  assert.equal(gate.pass(n), false, 'a second press must not confirm it');
  assert.equal(shown, 'Sidecar can’t pay more than 99,999,999 sats at once.');
  assert.equal(button.textContent, 'Pay', 'over the limit the button must not offer to confirm');
  assert.equal(attrs['aria-disabled'], 'true', 'over the limit the button must look unavailable');
  // Said as soon as the amount is entered, not only on the press.
  shown = '';
  gate.paint();
  assert.equal(shown, 'Sidecar can’t pay more than 99,999,999 sats at once.');
  // Just under: a large send as before, confirmed by the second press, and available again.
  n = 99999999;
  gate.paint();
  assert.equal(attrs['aria-disabled'], 'false');
  assert.equal(gate.pass(n), false);
  assert.equal(gate.pass(n), true);
});

test('the page card does not offer to pay an invoice over the limit, or one with no amount', () => {
  const content = read('content.js');
  const ctx = { Date, Math };
  vm.createContext(ctx);
  vm.runInContext([
    'const BECH32 = ' + JSON.stringify('qpzry9x8gf2tvdw0s3jn54khce6mua7l') + ';',
    block(content, '  function invoiceSats(bolt11) {'),
    'function invoiceExpired() { return false; }',
    content.slice(content.indexOf('  const MAX_PAY_SATS = '), content.indexOf(';\n', content.indexOf('  const MAX_PAY_SATS = ')) + 1),
    block(content, '  function notOffered(bolt11) {'),
    'this.notOffered = notOffered;',
  ].join('\n'), ctx);
  assert.equal(ctx.notOffered('lnbc11' + DATA), true, '1 BTC offered');
  assert.equal(ctx.notOffered('lnbc999999990n1' + DATA), false, '99,999,999 sats not offered');
  assert.equal(ctx.notOffered('lnbc2120n1' + DATA), false);
  assert.equal(ctx.notOffered('lnbc1' + DATA), true, 'an invoice with no amount offered');
});

test('the limit is one number everywhere it is written', () => {
  const nums = {
    'nwc-client.js': /const MAX_PAY_SATS = (\d+);/.exec(read('nwc-client.js')),
    'background.js': /const KEYSEND_MAX_SATS = (\d+);/.exec(read('background.js')),
    'content.js': /const MAX_PAY_SATS = (\d+);/.exec(read('content.js')),
  };
  for (const [f, m] of Object.entries(nums)) assert.equal(m && m[1], '99999999', f);
  assert.match(read('sidepanel.js'), /const MAX_PAY_SATS = self\.SidecarNWC\.MAX_PAY_SATS;/);
});
