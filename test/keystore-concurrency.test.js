'use strict';

// Reproduces the lost-update race in the keystore and locks in the fix.
//
// Every keystore mutator does load → mutate → write of the WHOLE store object.
// With no serialization, two overlapping writers each save a snapshot taken before
// the other's change and one update vanishes.
//
// This was found in the wild, not theorized: after importing three accounts from a
// vault, the avatar backfill fires one setProfile per account at once and one or
// more pictures silently fail to persist. Which account loses depends on relay
// timing, so it presents as "sometimes the avatars don't load".
//
// The reason it matters beyond avatars: addAccountFromBytes has the same shape, so a
// lost write there loses a PRIVATE KEY, and changePin re-encrypts every key under a
// new derived key — losing or interleaving that write is how a vault ends up keyed to
// a PIN nobody has.
//
// The storage mock below inserts an await between read and write, which is what makes
// the interleaving deterministic rather than timing-dependent. Real chrome.storage is
// async too; the delay only removes the flakiness from the test.

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// Callback-style area like MV3. Two properties are load-bearing, and the first draft
// of this mock got the second one wrong:
//
//  1. get/set yield to the microtask queue before completing. Without that, Node runs
//     a whole load-mutate-write to completion before the next caller starts and no
//     interleaving occurs.
//  2. Values are STRUCTURED-CLONED in and out, which is what real chrome.storage
//     does. Handing every caller the same live object reference — as a naive mock
//     does — means all writers mutate one shared object, writing it back is
//     idempotent, and the lost-update race silently cannot happen. The mock passed
//     with and without the fix until this was corrected.
function makeSlowStorageArea() {
  const data = {};
  const yieldABit = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const clone = (v) => (v === undefined ? v : structuredClone(v));
  return {
    get(keys, cb) {
      yieldABit().then(() => {
        let out = {};
        if (keys == null) out = clone(data);
        else if (typeof keys === 'string') { if (keys in data) out[keys] = clone(data[keys]); }
        else if (Array.isArray(keys)) { for (const k of keys) if (k in data) out[k] = clone(data[k]); }
        else { for (const k of Object.keys(keys)) out[k] = (k in data) ? clone(data[k]) : keys[k]; }
        cb(out);
      });
    },
    set(obj, cb) {
      yieldABit().then(() => {
        for (const [k, v] of Object.entries(obj)) data[k] = clone(v);
        cb && cb();
      });
    },
    remove(keys, cb) {
      yieldABit().then(() => {
        for (const k of (Array.isArray(keys) ? keys : [keys])) delete data[k];
        cb && cb();
      });
    },
    clear(cb) { yieldABit().then(() => { for (const k of Object.keys(data)) delete data[k]; cb && cb(); }); },
  };
}

let KS, NostrTools;

before(() => {
  globalThis.self = globalThis;
  globalThis.chrome = { storage: { local: makeSlowStorageArea(), session: makeSlowStorageArea() } };
  for (const f of ['nostr-tools.js', 'crypto.js', 'keystore.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
  }
  NostrTools = globalThis.NostrTools;
  KS = globalThis.SidecarKeystore;
  assert.ok(KS && NostrTools);
});

let pks;
beforeEach(async () => {
  globalThis.chrome.storage.local.clear(() => {});
  globalThis.chrome.storage.session.clear(() => {});
  await KS.initialize('sidecar-test-pin');
  pks = [];
  for (let i = 0; i < 3; i++) {
    pks.push((await KS.addAccountFromBytes(NostrTools.generateSecretKey(), 'acct' + i)).pubkey);
  }
});

// The exact production scenario: three accounts restored from a vault, then the
// avatar backfill fires one setProfile per account with no coordination.
test('three concurrent setProfile writes all persist', async () => {
  await Promise.all(pks.map((pk, i) =>
    KS.setProfile(pk, { name: 'acct' + i, picture: 'https://example.com/' + i + '.jpg' })
  ));
  const state = await KS.getState();
  for (let i = 0; i < 3; i++) {
    const a = state.accounts.find((x) => x.pubkey === pks[i]);
    assert.equal(a.picture, 'https://example.com/' + i + '.jpg',
      'account ' + i + ' lost its picture — this is the lost-update race');
  }
});

test('ten concurrent writes all persist', async () => {
  const extra = [];
  for (let i = 0; i < 7; i++) {
    extra.push((await KS.addAccountFromBytes(NostrTools.generateSecretKey(), 'x' + i)).pubkey);
  }
  const all = pks.concat(extra);
  await Promise.all(all.map((pk, i) => KS.setProfile(pk, { picture: 'p' + i })));
  const state = await KS.getState();
  const missing = all.filter((pk, i) =>
    state.accounts.find((x) => x.pubkey === pk).picture !== 'p' + i);
  assert.equal(missing.length, 0, missing.length + ' of ' + all.length + ' writes were lost');
});

// A private key is at stake here, not a picture.
test('concurrent account adds do not lose an account', async () => {
  const before = (await KS.getState()).accounts.length;
  await Promise.all(Array.from({ length: 5 }, () =>
    KS.addAccountFromBytes(NostrTools.generateSecretKey(), 'concurrent')
  ));
  const after = (await KS.getState()).accounts.length;
  assert.equal(after, before + 5, 'an account (and its private key) was lost');
});

test('mixed mutators interleaved do not clobber each other', async () => {
  await Promise.all([
    KS.setProfile(pks[0], { picture: 'pic0' }),
    KS.renameAccount(pks[1], 'renamed'),
    KS.setActive(pks[2]),
    KS.setProfile(pks[2], { picture: 'pic2' }),
  ]);
  const state = await KS.getState();
  assert.equal(state.accounts.find((x) => x.pubkey === pks[0]).picture, 'pic0');
  assert.equal(state.accounts.find((x) => x.pubkey === pks[1]).name, 'renamed');
  assert.equal(state.accounts.find((x) => x.pubkey === pks[2]).picture, 'pic2');
  assert.equal(state.activePubkey, pks[2]);
});

test('a removal concurrent with writes to other accounts keeps both effects', async () => {
  await Promise.all([
    KS.setProfile(pks[0], { picture: 'kept' }),
    KS.removeAccount(pks[1]),
  ]);
  const state = await KS.getState();
  assert.equal(state.accounts.length, 2, 'the removal did not stick, or took an extra account');
  assert.equal(state.accounts.find((x) => x.pubkey === pks[0]).picture, 'kept');
  assert.equal(state.accounts.find((x) => x.pubkey === pks[1]), undefined);
});

// A rejection inside the chain must not stop later writers — otherwise one bad call
// silently wedges every subsequent keystore write for the life of the worker.
test('a failed write does not poison the queue for later writes', async () => {
  const results = await Promise.allSettled([
    KS.setProfile('0'.repeat(64), { picture: 'nope' }), // no such account → rejects
    KS.setProfile(pks[0], { picture: 'after-failure' }),
  ]);
  assert.equal(results[0].status, 'rejected', 'writing to a missing account should reject');
  assert.equal(results[1].status, 'fulfilled', 'the following write must still run');
  const state = await KS.getState();
  assert.equal(state.accounts.find((x) => x.pubkey === pks[0]).picture, 'after-failure');
});

test('callers still see their own rejection', async () => {
  await assert.rejects(() => KS.setProfile('f'.repeat(64), { picture: 'x' }), /No such account/);
});
