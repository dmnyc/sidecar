'use strict';

// Sent zaps read as zaps in the wallet list (#253), the other half of #243.
//
// An INCOMING zap can be read straight off the payment: NIP-57 has the wallet keep the
// kind 9734 in the invoice description, so zapFromTx finds it and the row can say
// "Zap from alice". An OUTGOING one carries nothing at all — step 6 has the lnurl server
// issue a description_hash invoice, "the description is this zap request note and this
// note only", so the request is committed to and never travels with the payment. Parsing
// cannot recover it, and a zap you sent rendered as a bare "Sent".
//
// Sidecar signed that request seconds earlier, so the background records the recipient
// against the invoice and the row reads it from there.
//
// Source assertions: txRow builds DOM inside the panel's closure and there is no DOM in
// node. The parsing half is covered by test/zap-description.test.js; what is pinned here
// is the wiring that the two halves meet at.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const background = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

function txRowSource() {
  const start = panel.indexOf('  function txRow(tx, metaMap) {');
  assert.notEqual(start, -1, 'txRow not found');
  let depth = 0;
  for (let i = start; i < panel.length; i++) {
    if (panel[i] === '{') depth++;
    else if (panel[i] === '}' && --depth === 0) return panel.slice(start, i + 1);
  }
  throw new Error('txRow braces never balanced');
}
const txRow = txRowSource();

test('an outgoing zap falls back to the recorded pubkey', () => {
  assert.match(
    txRow,
    /const zapParty = zap \? \(incoming \? zap\.pubkey : zap\.recipient\) : \(!incoming && meta\.zapPubkey\) \|\| '';/,
    'outgoing zaps have no parseable request; the recorded pubkey is the only source'
  );
});

test('the fallback is outgoing-only', () => {
  // payMeta is keyed by an invoice WE paid, so it says nothing about money received —
  // and an incoming zap has the real event to read anyway. Guarding on !incoming keeps a
  // received payment from being labeled with whoever we last paid at that invoice.
  const m = txRow.match(/const zapParty = .*?;/);
  assert.ok(m && /!incoming && meta\.zapPubkey/.test(m[0]), 'the fallback must be gated on !incoming');
});

test('either source makes the row a zap', () => {
  // The label and the details pane both used to branch on `zap` — the parsed event —
  // which is always null for something we sent. Both now branch on isZap, or the
  // recorded pubkey would be found and then ignored.
  assert.match(txRow, /const isZap = !!zap \|\| !!zapParty;/);
  assert.match(txRow, /if \(isZap\) \{/, 'the label branch');
  assert.match(txRow, /const zapWho = isZap \?/, 'the From/To row in the details pane');
});

test('the background records the recipient without spending the approval', () => {
  // recipientFor is non-consuming and MUST be read before the claim below it, which is
  // single-use. Reversed, every labeled zap would lose its auto-zap approval and prompt.
  const i = background.indexOf('ZAPREQ.recipientFor(');
  const j = background.indexOf('ZAPREQ.claim(');
  assert.notEqual(i, -1, 'the background must read the recipient');
  assert.notEqual(j, -1, 'the auto-zap claim should still be there');
  assert.ok(i < j, 'the recipient must be read before the claim consumes the record');
  assert.match(
    background,
    /if \(zapRecipient\) await savePayMetaEntry\(invoice, \{ zapPubkey: zapRecipient \}\);/,
    'and written against the invoice once the payment settles'
  );
});

test('the write sits in the post-payment bookkeeping, not the caller path', () => {
  // Everything after "the money has moved" is deliberately off the reply path — issue
  // #138 was a page hanging on a settled payment because storage writes sat in front of
  // it. A caption must not reintroduce that.
  const moved = background.indexOf('the money has moved');
  // The CALL, not the declaration — savePayMetaEntry is defined up beside the secret
  // store it writes through, which is far earlier in the file than this block.
  const write = background.indexOf('await savePayMetaEntry(invoice, { zapPubkey');
  assert.ok(moved !== -1 && write > moved, 'the metadata write must come after the payment');
});
