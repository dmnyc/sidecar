'use strict';

// Unit coverage for NWC connection strings across a PIN change.
//
// The NWC store is a separate storage key from the vault, but its contents are
// sealed under the SAME derived key as the account private keys. changePin
// re-wrapped the vault and the notes key and missed this one, so changing a PIN
// left every stored wallet connection as ciphertext under a key that no longer
// existed. Nothing said so: the presence check only looked for the record, so
// the panel kept reporting a connected wallet and the failure surfaced later as
// a raw AES-GCM error from inside the wallet client.
//
// Two properties are pinned here. The re-wrap itself, verified after a simulated
// service-worker restart so an in-memory key can't paper over stale ciphertext
// on disk. And the honesty of the gates for anyone already broken by the old
// behavior: a record that won't open reports as no wallet, with a typed error
// rather than an OperationError.

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// Callback-style area like MV3. Structured-clones in and out so a shared live
// reference can't hide a lost write (see keystore-concurrency.test.js).
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
      yieldABit().then(() => { for (const [k, v] of Object.entries(obj)) data[k] = clone(v); cb && cb(); });
    },
    remove(keys, cb) {
      yieldABit().then(() => { for (const k of (Array.isArray(keys) ? keys : [keys])) delete data[k]; cb && cb(); });
    },
    clear(cb) { yieldABit().then(() => { for (const k of Object.keys(data)) delete data[k]; cb && cb(); }); },
  };
}

const PIN = 'sidecar-test-pin';
const PIN2 = 'a-longer-second-pin';
const NWC_KEY = 'sidecar_nwc_connections';
const CONN = 'nostr+walletconnect://abc?relay=wss%3A%2F%2Frelay.example&secret=deadbeef&lud16=zap%40example.com';
const CONN2 = 'nostr+walletconnect://def?relay=wss%3A%2F%2Frelay2.example&secret=cafebabe';

let KS, keystoreSrc;

before(() => {
  globalThis.self = globalThis;
  globalThis.chrome = {
    storage: { local: makeSlowStorageArea(), session: makeSlowStorageArea() },
  };
  for (const f of ['nostr-tools.js', 'crypto.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
  }
  keystoreSrc = fs.readFileSync(path.join(ROOT, 'keystore.js'), 'utf8');
});

// A "service worker restart": a fresh closure over the same storage areas.
function freshKeystore() {
  vm.runInThisContext(keystoreSrc, { filename: 'keystore.js' });
  return globalThis.SidecarKeystore;
}

beforeEach(async () => {
  globalThis.chrome.storage.local.clear(() => {});
  globalThis.chrome.storage.session.clear(() => {});
  KS = freshKeystore();
  await KS.initialize(PIN);
  await KS.unlock(PIN);
});

function storageGet(key) {
  return new Promise((resolve) => globalThis.chrome.storage.local.get(key, (r) => resolve(r[key])));
}

test('a connection string round-trips with no PIN change', async () => {
  const { pubkey } = await KS.generateAccount('one');
  await KS.setNwc(pubkey, CONN);
  assert.equal(await KS.getNwc(pubkey), CONN);
  assert.equal(await KS.hasNwc(pubkey), true);
});

test('a PIN change keeps the connection readable', async () => {
  const { pubkey } = await KS.generateAccount('one');
  await KS.setNwc(pubkey, CONN);
  await KS.changePin(PIN, PIN2);
  assert.equal(await KS.getNwc(pubkey), CONN, 'still decrypts under the new derived key');
  assert.equal(await KS.hasNwc(pubkey), true);
});

test('the re-wrap is on disk, not just in memory (verified after a restart)', async () => {
  const { pubkey } = await KS.generateAccount('one');
  await KS.setNwc(pubkey, CONN);
  await KS.changePin(PIN, PIN2);
  KS = freshKeystore();          // simulated SW eviction
  await KS.unlock(PIN2);
  assert.equal(await KS.getNwc(pubkey), CONN);
});

test('every account is re-wrapped, not just the active one', async () => {
  const a = await KS.generateAccount('one');
  const b = await KS.generateAccount('two');
  await KS.setNwc(a.pubkey, CONN);
  await KS.setNwc(b.pubkey, CONN2);
  await KS.changePin(PIN, PIN2);
  KS = freshKeystore();
  await KS.unlock(PIN2);
  assert.equal(await KS.getNwc(a.pubkey), CONN);
  assert.equal(await KS.getNwc(b.pubkey), CONN2);
});

// Under the key-slot layout a PIN change moves the wrap around the DEK and
// nothing else, so the NWC ciphertext is EXPECTED to stay byte-identical. That is
// the property that makes the whole class of "which payloads did changePin
// remember?" bugs impossible, so it is worth asserting directly rather than just
// observing that the string still decrypts.
test('a PIN change moves the slot wrap and leaves payload ciphertext alone', async () => {
  const { pubkey } = await KS.generateAccount('one');
  await KS.setNwc(pubkey, CONN);
  const beforeNwc = (await storageGet(NWC_KEY))[pubkey];
  const beforeSlot = (await storageGet('sidecar_keystore')).slots.find((s) => s.type === 'pin');
  const beforeAcct = (await storageGet('sidecar_keystore')).accounts[pubkey].enc;

  await KS.changePin(PIN, PIN2);

  const afterNwc = (await storageGet(NWC_KEY))[pubkey];
  const afterSlot = (await storageGet('sidecar_keystore')).slots.find((s) => s.type === 'pin');
  const afterAcct = (await storageGet('sidecar_keystore')).accounts[pubkey].enc;

  assert.notEqual(beforeSlot.wrapped.ct, afterSlot.wrapped.ct, 'the DEK wrap must be re-sealed');
  assert.notEqual(beforeSlot.kdf.salt, afterSlot.kdf.salt, 'a new PIN gets a fresh KDF salt');
  assert.equal(afterNwc.ct, beforeNwc.ct, 'payload ciphertext must NOT be rewritten');
  assert.equal(afterAcct.ct, beforeAcct.ct, 'account ciphertext must NOT be rewritten either');
  assert.equal(await KS.getNwc(pubkey), CONN, 'and it still reads back');
});

test('two PIN changes in a row stay readable', async () => {
  const { pubkey } = await KS.generateAccount('one');
  await KS.setNwc(pubkey, CONN);
  await KS.changePin(PIN, PIN2);
  await KS.changePin(PIN2, 'a-third-long-pin');
  KS = freshKeystore();
  await KS.unlock('a-third-long-pin');
  assert.equal(await KS.getNwc(pubkey), CONN);
});

test('a PIN change with no wallet connected writes no NWC record', async () => {
  await KS.generateAccount('one');
  await KS.changePin(PIN, PIN2);
  assert.equal(await storageGet(NWC_KEY), undefined, 'nothing to re-wrap, nothing written');
});

test('a rejected PIN change leaves the connection alone', async () => {
  const { pubkey } = await KS.generateAccount('one');
  await KS.setNwc(pubkey, CONN);
  await assert.rejects(() => KS.changePin('wrong-pin-entirely', PIN2), /Incorrect current PIN/);
  assert.equal(await KS.getNwc(pubkey), CONN);
});

// ---- already-broken records: anyone who changed their PIN before the fix ----

// Seal a record under a key nobody holds, reproducing the pre-fix on-disk state.
async function plantUnreadable(pubkey) {
  const C = globalThis.SidecarCrypto;
  const orphanKey = await C.deriveKey('some-key-that-is-gone', C.newKdf());
  const all = (await storageGet(NWC_KEY)) || {};
  all[pubkey] = await C.encryptString(orphanKey, CONN);
  await new Promise((r) => globalThis.chrome.storage.local.set({ [NWC_KEY]: all }, r));
}

test('an unreadable record throws a typed error, not an OperationError', async () => {
  const { pubkey } = await KS.generateAccount('one');
  await plantUnreadable(pubkey);
  await assert.rejects(() => KS.getNwc(pubkey), (e) => {
    assert.equal(e.code, 'NWC_UNREADABLE');
    assert.match(e.message, /Reconnect your wallet/);
    return true;
  });
});

test('an unreadable record reports as no wallet, so gates fail closed', async () => {
  const { pubkey } = await KS.generateAccount('one');
  await plantUnreadable(pubkey);
  assert.equal(await KS.hasNwc(pubkey), false, 'a wallet that cannot be opened is not a wallet');
});

test('reconnecting overwrites a broken record', async () => {
  const { pubkey } = await KS.generateAccount('one');
  await plantUnreadable(pubkey);
  await KS.setNwc(pubkey, CONN2);
  assert.equal(await KS.getNwc(pubkey), CONN2);
  assert.equal(await KS.hasNwc(pubkey), true);
});

test('a PIN change preserves a broken record rather than dropping it', async () => {
  const { pubkey } = await KS.generateAccount('one');
  await plantUnreadable(pubkey);
  const before = (await storageGet(NWC_KEY))[pubkey];
  await KS.changePin(PIN, PIN2);
  const after = (await storageGet(NWC_KEY))[pubkey];
  assert.deepEqual(after, before, 'left exactly as found; we do not delete user data here');
});

test('one broken record does not stop a good one from re-wrapping', async () => {
  const a = await KS.generateAccount('one');
  const b = await KS.generateAccount('two');
  await KS.setNwc(b.pubkey, CONN2);
  await plantUnreadable(a.pubkey);
  await KS.changePin(PIN, PIN2);
  KS = freshKeystore();
  await KS.unlock(PIN2);
  assert.equal(await KS.getNwc(b.pubkey), CONN2, 'the healthy account survived');
  assert.equal(await KS.hasNwc(a.pubkey), false);
});

test('while locked, presence is still the answer (nothing can be decrypted)', async () => {
  const { pubkey } = await KS.generateAccount('one');
  await KS.setNwc(pubkey, CONN);
  await KS.lock();
  assert.equal(await KS.hasNwc(pubkey), true, 'locked: presence is all we can honestly report');
});
