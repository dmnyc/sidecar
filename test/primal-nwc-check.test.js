'use strict';

// Primal's wallet only works inside Primal's own apps, so a Primal connection string is
// refused up front. The check used to refuse ANY string with a primal.net relay, which
// also refused a wallet that lists relay.primal.net beside others (cashu.me lists four) and
// that Sidecar would talk to through the first. These run the real isPrimalNwc.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const m = source.match(/  function isPrimalNwc\(connection\)\s*\{[\s\S]*?\n  \}\n/);
if (!m) throw new Error('Could not find isPrimalNwc in sidepanel.js');
const ctx = { URL, URLSearchParams };
vm.createContext(ctx);
vm.runInContext(m[0] + '\nglobalThis.isPrimalNwc = isPrimalNwc;', ctx);
const isPrimalNwc = (c) => ctx.isPrimalNwc(c);

// Placeholder keys: only the shape matters.
const PK = '1'.repeat(64);
const SK = '2'.repeat(64);
const nwc = (query) => `nostr+walletconnect://${PK}?${query}&secret=${SK}`;

test("Primal's own string is refused: one primal.net relay and a primal.net address", () => {
  assert.equal(isPrimalNwc(nwc('relay=wss://relay.primal.net&lud16=someone@primal.net')), true);
});

test('a primal.net address alone marks it, whatever the relays', () => {
  assert.equal(isPrimalNwc(nwc('relay=wss://relay.damus.io&lud16=someone@primal.net')), true);
  assert.equal(isPrimalNwc(nwc('relay=wss://relay.damus.io&lud16=someone@PRIMAL.NET')), true, 'case does not matter');
});

test('a string whose only relays are primal.net is refused, with or without an address', () => {
  assert.equal(isPrimalNwc(nwc('relay=wss://relay.primal.net')), true);
  assert.equal(isPrimalNwc(nwc('relay=wss://relay.primal.net&relay=wss://cache.primal.net')), true);
});

test('a wallet that lists primal.net among other relays is allowed — the cashu.me shape', () => {
  const four = nwc('relay=wss://relay.damus.io&relay=wss://nos.lol&relay=wss://relay.primal.net&relay=wss://relay.primal.net ');
  assert.equal(isPrimalNwc(four), false, 'the stray trailing space on the last relay must not matter either way');
  assert.equal(isPrimalNwc(nwc('relay=wss://relay.primal.net&relay=wss://nos.lol')), false,
    'primal.net first does not make it Primal');
});

test('other wallets and other addresses are untouched', () => {
  assert.equal(isPrimalNwc(nwc('relay=wss://relay.getalby.com/v1&lud16=me@getalby.com')), false);
  assert.equal(isPrimalNwc(nwc('relay=wss://relay.example&lud16=me@notprimal.net')), false, 'a lookalike domain');
  assert.equal(isPrimalNwc(nwc('relay=wss://relay.notprimal.net')), false, 'a lookalike relay host');
});

test('garbage never throws and is never Primal', () => {
  for (const junk of ['', 'nostr+walletconnect://abc', 'nostr+walletconnect://abc?', 'not a string']) {
    assert.equal(isPrimalNwc(junk), false, junk);
  }
});
