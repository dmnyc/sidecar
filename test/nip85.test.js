'use strict';

// NIP-85 trust provider lists (kind 10040), as the approval card reads them (nip85.js).
//
// What matters here is that the card never under-reports what a list holds: rows group by
// provider so one service is one entry, malformed rows are dropped rather than failing the
// card, and encrypted rows are reported as present, never as an empty list.

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
let N;

const P1 = 'a'.repeat(64);
const P2 = 'B'.repeat(64);
const R1 = 'wss://nip85.brainstorm.world';

before(() => {
  globalThis.self = globalThis;
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'nip85.js'), 'utf8'), { filename: 'nip85.js' });
  N = globalThis.SidecarNip85;
  assert.ok(N, 'SidecarNip85 loaded');
});

test('rows keep well-formed entries and drop the rest', () => {
  const ev = { kind: 10040, content: '', tags: [
    ['30382:rank', P1, R1],
    ['30382:followers', P1],
    ['p', P1],
    ['rank', P1, R1],
    ['30382:rank', 'not-a-key', R1],
    'junk',
  ] };
  assert.deepEqual(N.rows(ev), [
    { type: '30382:rank', pubkey: P1, relay: R1 },
    { type: '30382:followers', pubkey: P1, relay: '' },
  ]);
});

test('providers group one service into one entry, keys lowercased', () => {
  const ev = { kind: 10040, content: '', tags: [
    ['30382:rank', P1, R1],
    ['30382:followers', P1, R1],
    ['30382:rank', P1, R1],
    ['30383:rank', P2, 'wss://other.example'],
  ] };
  const g = N.providers(ev);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0], { pubkey: P1, relay: R1, types: ['30382:rank', '30382:followers'] });
  assert.equal(g[1].pubkey, P2.toLowerCase());
});

test('an empty list has no providers and no private rows', () => {
  const ev = { kind: 10040, content: '', tags: [] };
  assert.deepEqual(N.providers(ev), []);
  assert.equal(N.hasPrivateRows(ev), false);
});

test('encrypted content counts as private rows', () => {
  assert.equal(N.hasPrivateRows({ kind: 10040, content: 'AgV0ZXN0Li4u', tags: [] }), true);
  assert.equal(N.hasPrivateRows({ kind: 10040, content: '   ', tags: [] }), false);
});

test('malformed events read as empty rather than throwing', () => {
  assert.deepEqual(N.rows(null), []);
  assert.deepEqual(N.providers({ kind: 10040 }), []);
  assert.equal(N.hasPrivateRows(undefined), false);
});

test('typeLabel drops the kind only for scores about users', () => {
  assert.equal(N.typeLabel('30382:rank'), 'rank');
  assert.equal(N.typeLabel('30383:rank'), '30383:rank');
});

test('relayHost shows the host, and falls back to the raw value', () => {
  assert.equal(N.relayHost(R1), 'nip85.brainstorm.world');
  assert.equal(N.relayHost('not a url'), 'not a url');
  assert.equal(N.relayHost(''), '');
});
