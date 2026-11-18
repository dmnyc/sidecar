'use strict';

// What the approval card says about text an app wants sealed. See sealed-summary.js.
// The card used to print the text, and an app that stores a wallet connection made that a
// wall of characters with the connection's secret in it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../sealed-summary.js');
const { describe } = globalThis.SidecarSealedSummary;

const SECRET = '67c20fe6bec53f11becbd4e3382a602d3b362bdf2086ebd029d854ccdb8938d4';
const WALLET = 'nostr+walletconnect://2bb5d1d87f50066cc6066b41815d565abebb81a43996e90be52fa4f253cab8e8'
  + '?relay=wss%3A%2F%2Frelay.example.com&relay=wss://relay2.example.com&secret=' + SECRET;

test('a wallet connection is named by its relays and the secret is never reported', () => {
  const d = describe(WALLET);
  assert.equal(d.kind, 'wallet');
  assert.deepEqual(d.hosts, ['relay.example.com', 'relay2.example.com']);
  const everything = JSON.stringify(d);
  assert.ok(!everything.includes(SECRET), 'the secret leaked into the description');
  assert.ok(!everything.includes('2bb5d1d8'), 'the wallet key leaked into the description');
});

test('a wallet connection with no relay still says what it is', () => {
  assert.deepEqual(describe('nostr+walletconnect://abc?secret=' + SECRET), { kind: 'wallet', hosts: [] });
});

test('a signer link and a private key are named, not read out', () => {
  assert.equal(describe('bunker://abc?relay=wss://relay.example.com&secret=xyz').kind, 'signer');
  const nsec = 'nsec1' + 'q'.repeat(58);
  const d = describe(nsec);
  assert.equal(d.kind, 'private-key');
  assert.ok(!JSON.stringify(d).includes(nsec));
});

test('a lone web address names its host', () => {
  assert.deepEqual(describe('https://example.com/path?x=1'), { kind: 'link', host: 'example.com' });
  // A sentence that contains an address is prose, and is shown as written.
  assert.equal(describe('see https://example.com for more'), null);
});

test('JSON is described by its shape, with the names of the first fields', () => {
  assert.deepEqual(describe('{"theme":"dark","relays":["a"],"lang":"en"}'),
    { kind: 'object', count: 3, names: ['theme', 'relays', 'lang'], more: 0 });
  const many = describe(JSON.stringify({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }));
  assert.equal(many.count, 6);
  assert.equal(many.names.length, 4);
  assert.equal(many.more, 2);
  assert.deepEqual(describe('[1,2,3]'), { kind: 'list', count: 3 });
});

test('braces that are not JSON are left as text', () => {
  assert.equal(describe('{not json at all'), null);
  assert.equal(describe('[draft] hello there'), null);
});

test('one long unbroken run is encoded data', () => {
  assert.deepEqual(describe('A'.repeat(88)), { kind: 'encoded', length: 88 });
  assert.equal(describe('A'.repeat(39)), null);
});

test('plain text a person can read is shown as it is', () => {
  for (const t of ['hello', 'Dinner at 7? Bring wine.', 'a few words with spaces '.repeat(10), '', '   ', null, undefined]) {
    assert.equal(describe(t), null, JSON.stringify(t));
  }
});

test('ciphertext is named as a sealed message, in both of its shapes', () => {
  assert.deepEqual(describe('YSBzZWFsZWQgbWVzc2FnZSBvZiBzb21lIGxlbmd0aA==?iv=MDEyMzQ1Njc4OWFiY2RlZg=='), { kind: 'sealed' });
  assert.deepEqual(describe('Ag' + 'B'.repeat(130)), { kind: 'sealed' });
  // Not ciphertext: a long run that does not open like either, and a short one that does.
  assert.deepEqual(describe('C'.repeat(88)), { kind: 'encoded', length: 88 });
  assert.equal(describe('Ag' + 'B'.repeat(20)), null);
});
