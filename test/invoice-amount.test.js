'use strict';

// AN INVOICE'S AMOUNT IS READ FROM ITS PREFIX ONLY, up to the last '1'. Read without that
// anchor, a whole-bitcoin invoice ("lnbc11p…", 1 BTC) took the separator as a digit and the
// data's first letter, almost always 'p', as the unit: 11 pico-bitcoin, 0 sats. The payment
// card said "Pay 0 sats" and the 10,000-sat "Confirm amount above" was skipped. An invoice
// with no amount read as 0 rather than unknown. Both parsers that had it are run here, as
// they are written: background.js (the payment flow) and content.js (the pay card on pages).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
function lift(file, header) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const start = src.indexOf(header);
  assert.notEqual(start, -1, header + ' not in ' + file);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return Function('return (' + src.slice(src.indexOf('function', start), i + 1) + ')')();
  }
  throw new Error('unbalanced');
}
const PARSERS = {
  'background.js': lift('background.js', 'function invoiceSats(bolt11) {'),
  'content.js': lift('content.js', '  function invoiceSats(bolt11) {'),
};

// Real shapes: the data after the separator starts with the timestamp, here 'pj…'.
const DATA = 'pjq' + 'x'.repeat(40);
const CASES = [
  ['lnbc2120n1' + DATA, 212, 'nano'],
  ['lnbc210u1' + DATA, 21000, 'micro'],
  ['lnbc10m1' + DATA, 1000000, 'milli'],
  ['lnbc11' + DATA, 100000000, '1 BTC: no unit'],
  ['lnbc101' + DATA, 1000000000, '10 BTC'],
  ['lnbc21' + DATA, 200000000, '2 BTC'],
  ['lnbc1' + DATA, null, 'no amount'],
  ['lightning:LNBC2120N1' + DATA.toUpperCase(), 212, 'a lightning: link, in capitals'],
  ['lnbc', null, 'no separator'],
  ['not an invoice', null, 'not an invoice'],
];

for (const [file, invoiceSats] of Object.entries(PARSERS)) {
  test(`${file} reads an invoice's amount from its prefix`, () => {
    for (const [inv, want, why] of CASES) assert.equal(invoiceSats(inv), want, `${why}: ${inv.slice(0, 16)}…`);
  });
}
