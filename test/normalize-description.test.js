'use strict';

// Unit coverage for normalizeDescription() in sidepanel.js.
//
// Also covers parseZapRequest, which normalizeDescription now delegates to.
//
// coinos NWC returns tx.description as a structured array
// ([["text/plain","…"],["text/identifier","…"]]) instead of a plain string.
// The normalizer extracts the text/plain value from either shape (array or
// JSON-stringified array) and leaves plain strings untouched.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// Extract both functions from sidepanel.js and eval them in isolation. parseZapRequest
// has to come along: normalizeDescription delegates to it, and lifting only the one that
// changed leaves a ReferenceError that looks like a logic failure.
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
function lift(re, label) {
  const m = source.match(re);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}
const ctx = { JSON, Array, String };
vm.createContext(ctx);
vm.runInContext(
  lift(/function parseZapRequest\(desc\)\s*\{[\s\S]*?\n  \}/, 'parseZapRequest') + '\n' +
  lift(/function zapFromTx\(tx\)\s*\{[\s\S]*?\n  \}/, 'zapFromTx') + '\n' +
  lift(/function normalizeDescription\(desc\)\s*\{[\s\S]*?\n  \}/, 'normalizeDescription'),
  ctx
);
const normalizeDescription = ctx.normalizeDescription;
const parseZapRequest = ctx.parseZapRequest;
const zapFromTx = ctx.zapFromTx;

test('returns empty string for null/undefined', () => {
  assert.equal(normalizeDescription(null), '');
  assert.equal(normalizeDescription(undefined), '');
});

test('passes through plain strings', () => {
  assert.equal(normalizeDescription('Paying alice@coinos.io'), 'Paying alice@coinos.io');
  assert.equal(normalizeDescription(''), '');
});

test('extracts text/plain from an array descriptor', () => {
  const arr = [['text/plain', 'Paying thedaniel@coinos.io'], ['text/identifier', 'thedaniel@coinos.io']];
  assert.equal(normalizeDescription(arr), 'Paying thedaniel@coinos.io');
});

test('extracts text/plain from a JSON-stringified array', () => {
  const json = JSON.stringify([['text/plain', 'Coffee tip'], ['text/identifier', 'barista@coinos.io']]);
  assert.equal(normalizeDescription(json), 'Coffee tip');
});

test('returns empty string when text/plain is absent', () => {
  const arr = [['text/identifier', 'someone@coinos.io']];
  assert.equal(normalizeDescription(arr), '');
});

test('handles array with empty text/plain value', () => {
  const arr = [['text/plain', ''], ['text/identifier', 'x@coinos.io']];
  assert.equal(normalizeDescription(arr), '');
});

test('does not misparse non-JSON strings starting with [', () => {
  assert.equal(normalizeDescription('[not json'), '[not json');
});

test('returns string representation for unexpected types', () => {
  assert.equal(normalizeDescription(42), '42');
  assert.equal(normalizeDescription(true), 'true');
});

// ---- zap requests (#243) ----------------------------------------------------------
// NIP-57 has the wallet store the kind 9734 event verbatim in the invoice description,
// so tx.description arrives as a stringified event. The reported symptom was the wallet
// printing that JSON: the old normalizer parsed the string, found an object rather than
// an array, and returned the original text unchanged.

const ZAP = JSON.stringify({
  kind: 9734,
  pubkey: 'f'.repeat(64),
  content: 'Onward 🫡',
  tags: [['p', 'a'.repeat(64)], ['e', 'b'.repeat(64)], ['amount', '21000']],
});

test('a zap request reduces to what the zapper typed', () => {
  assert.equal(normalizeDescription(ZAP), 'Onward 🫡');
});

test('a zap with no comment yields empty, so the caller can fall back', () => {
  // The common case by a distance: most zaps carry no message at all. Empty is the right
  // answer because txRow falls back to a label it builds from the pubkey — returning the
  // event, or the word "zap", would both be worse than nothing.
  const silent = JSON.stringify({ kind: 9734, pubkey: 'f'.repeat(64), content: '', tags: [] });
  assert.equal(normalizeDescription(silent), '');
});

test('parseZapRequest pulls out the parties and the zapped event', () => {
  const z = parseZapRequest(ZAP);
  assert.equal(z.pubkey, 'f'.repeat(64));
  assert.equal(z.recipient, 'a'.repeat(64));
  assert.equal(z.eventId, 'b'.repeat(64));
  assert.equal(z.content, 'Onward 🫡');
});

test('parseZapRequest ignores anything that is not a kind 9734', () => {
  assert.equal(parseZapRequest(JSON.stringify({ kind: 1, content: 'a note' })), null);
  assert.equal(parseZapRequest('a plain note'), null);
  assert.equal(parseZapRequest('[["text/plain","hi"]]'), null);
  assert.equal(parseZapRequest(''), null);
  assert.equal(parseZapRequest(null), null);
});

test('a JSON object that is not a zap still passes through untouched', () => {
  // The pre-#243 behavior for non-zap objects, kept deliberately: some wallets put
  // structured notes here and the raw string is a better guess than an empty row.
  const other = '{"memo":"invoice 12"}';
  assert.equal(normalizeDescription(other), other);
});

test('a zap request with malformed tags does not throw', () => {
  const rough = JSON.stringify({ kind: 9734, pubkey: 'f'.repeat(64), content: 'hi', tags: ['p', null, ['e']] });
  const z = parseZapRequest(rough);
  assert.equal(z.content, 'hi');
  assert.equal(z.recipient, '');
  assert.equal(z.eventId, '');
});

// ---- where the zap request actually lives ------------------------------------------
// NIP-57 puts the 9734 in the invoice description and some wallets do exactly that.
// NIP-47 also allows a `metadata` object on a transaction, and others put it there
// instead — which is why the first cut of this fix showed nothing for real zaps from
// Primal and Wisp: the parsing was right and it was reading the wrong field.
// A third group sends only the comment and keeps the event, and for those there is no
// pubkey in the payload at all; showing the comment is then the best available answer.

const EV = { kind: 9734, pubkey: 'f'.repeat(64), content: 'gm', tags: [['p', 'a'.repeat(64)]] };

test('finds the zap request in the description', () => {
  assert.equal(zapFromTx({ description: JSON.stringify(EV) }).pubkey, 'f'.repeat(64));
});

test('finds it in metadata, however the wallet nests it', () => {
  // Already an object here, not a string — metadata arrives parsed.
  assert.equal(zapFromTx({ metadata: EV }).pubkey, 'f'.repeat(64));
  assert.equal(zapFromTx({ metadata: { nostr: EV } }).pubkey, 'f'.repeat(64));
  assert.equal(zapFromTx({ metadata: { zap_request: EV } }).pubkey, 'f'.repeat(64));
  assert.equal(zapFromTx({ metadata: { zapRequest: EV } }).pubkey, 'f'.repeat(64));
});

test('returns null when the wallet kept the event to itself', () => {
  // The degraded case, and it is a wallet limit rather than a bug: no pubkey anywhere in
  // the payload, so the row falls back to the comment.
  assert.equal(zapFromTx({ description: 'gm' }), null);
  assert.equal(zapFromTx({ description: 'gm', metadata: { memo: 'gm' } }), null);
  assert.equal(zapFromTx({}), null);
  assert.equal(zapFromTx(null), null);
});
