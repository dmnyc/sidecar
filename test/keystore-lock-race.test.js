'use strict';

// The lock() race, and earning the v1-backup drop on a PIN change.
//
// lock() used to stand outside every chain while unlock, changePin, initialize,
// and the service-worker rehydration (ensureLoaded) all established unlocked
// state across awaits. Whichever side landed last won: an explicit lock could be
// silently undone — keys back in memory, session key back in storage — with no
// PIN entered. lock() and ensureLoaded() now ride the same serialization chain
// as the state-setting operations; these tests pin the interleavings with a
// storage mock that genuinely yields, so the await points the race lives at are
// really crossed.
//
// The other half: changePin's v1 migration writes a backup of the old store
// under the OLD pin, and nothing on that path ever cleared it — it sat on disk
// until some later unlock happened to. The old pin may be exactly what the user
// is rotating away from, so the backup is now dropped the moment the new pin
// proves it can open what was written. Never unconditionally: that backup is
// the last readable copy if the re-wrap somehow came out broken.

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

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
const STORE = 'sidecar_keystore';
const BACKUP = 'sidecar_keystore_v1_backup';
const SESSION = 'sidecar_session';

let KS, C, NT, keystoreSrc;

before(() => {
  globalThis.self = globalThis;
  globalThis.chrome = { storage: { local: makeSlowStorageArea(), session: makeSlowStorageArea() } };
  for (const f of ['nostr-tools.js', 'crypto.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
  }
  C = globalThis.SidecarCrypto;
  NT = globalThis.NostrTools;
  keystoreSrc = fs.readFileSync(path.join(ROOT, 'keystore.js'), 'utf8');
});

function freshKeystore() {
  vm.runInThisContext(keystoreSrc, { filename: 'keystore.js' });
  return globalThis.SidecarKeystore;
}

const sget = (k) => new Promise((r) => globalThis.chrome.storage.local.get(k, (o) => r(o[k])));
const sset = (o) => new Promise((r) => globalThis.chrome.storage.local.set(o, r));
const sessGet = (k) => new Promise((r) => globalThis.chrome.storage.session.get(k, (o) => r(o[k])));

// Build a v1 store by hand — exactly the shape the shipped v1 code wrote. Accounts
// only: the race tests don't care about notes/NWC, and the backup tests only need
// the migration to run.
async function seedV1({ count = 2 } = {}) {
  const kdf = C.newKdf();
  const key = await C.deriveKey(PIN, kdf);
  const store = { version: 1, kdf, accounts: {}, verifier: await C.makeVerifier(key), order: [] };
  const made = [];
  for (let i = 0; i < count; i++) {
    const sk = NT.generateSecretKey();
    const pubkey = NT.getPublicKey(sk);
    store.accounts[pubkey] = {
      pubkey, name: 'acct-' + i, picture: '',
      enc: await C.encryptBytes(key, sk), createdAt: 1000 + i,
    };
    store.order.push(pubkey);
    made.push({ pubkey, sk: Uint8Array.from(sk) });
  }
  await sset({ [STORE]: store, sidecar_active_pubkey: made[0].pubkey });
  return { accounts: made };
}

beforeEach(async () => {
  globalThis.chrome.storage.local.clear(() => {});
  globalThis.chrome.storage.session.clear(() => {});
  KS = freshKeystore();
});

// ---- a lock that lands while unlocked state is being established ----

test('a lock landing mid-rehydration does not come back unlocked', async () => {
  await KS.initialize(PIN);
  await KS.generateAccount('one');
  KS = freshKeystore();               // SW eviction: dek gone, session key live
  assert.equal(KS.isLocked(), true);

  const rehydrate = KS.ensureLoaded();
  await KS.lock();                    // the user locks while it is in flight
  await rehydrate;

  assert.equal(KS.isLocked(), true, 'the lock wins — no DEK resurrected from the pre-lock session value');
  assert.equal(await sessGet(SESSION), undefined, 'session storage stays cleared');
});

test('a lock landing mid-unlock does not come back unlocked', async () => {
  const { accounts } = await seedV1({ count: 1 });
  const unlocking = KS.unlock(PIN);  // the long, migrating path
  await KS.lock();                    // lands while the unlock is in flight
  await unlocking;

  assert.equal(KS.isLocked(), true, 'the lock wins');
  assert.equal(await sessGet(SESSION), undefined, 'the unlock did not re-persist the session key after the lock');
  // And the store itself is fine — the next unlock works normally.
  KS = freshKeystore();
  await KS.unlock(PIN);
  assert.deepEqual(Uint8Array.from(await KS.getPrivkey(accounts[0].pubkey)), accounts[0].sk);
});

test('a rehydration after a lock stays locked (the common order, not just the race)', async () => {
  await KS.initialize(PIN);
  await KS.generateAccount('one');
  await KS.lock();
  KS = freshKeystore();
  await KS.ensureLoaded();
  assert.equal(KS.isLocked(), true);
  assert.equal(await sessGet(SESSION), undefined);
});

// ---- changePin's v1 migration and the old-pin backup ----

test('changePin on a v1 store drops the old-pin backup once the new pin opens the result', async () => {
  const { accounts } = await seedV1({ count: 2 });
  await KS.changePin(PIN, PIN2);

  assert.equal(await sget(BACKUP), undefined, 'no old-pin ciphertext of the vault left on disk');

  KS = freshKeystore();
  await KS.unlock(PIN2);
  assert.deepEqual(Uint8Array.from(await KS.getPrivkey(accounts[0].pubkey)), accounts[0].sk,
    'the migrated store is what survived, and it is readable');
  await assert.rejects(() => freshKeystore().unlock(PIN), /Incorrect PIN/, 'the old pin is really gone');
});

test('a re-wrap that comes out unreadable keeps the backup', async () => {
  const real = globalThis.chrome.storage.local;
  const sabotaged = makeSlowStorageArea();
  const rawSet = sabotaged.set.bind(sabotaged);
  // Corrupt the pin slot of whatever v2 store gets written, as a re-wrap that
  // nothing can open. The accounts are intact — only the slot is broken.
  sabotaged.set = (obj, cb) => {
    if (obj && obj[STORE] && obj[STORE].version === 2 && obj[STORE].slots) {
      obj = structuredClone(obj);
      obj[STORE].slots[0].wrapped.ct = C.bytesToBase64(C.randomBytes(48));
    }
    return rawSet(obj, cb);
  };
  try {
    globalThis.chrome.storage.local = sabotaged;
    await seedV1({ count: 1 });       // seeded through the same area changePin reads
    await KS.changePin(PIN, PIN2);
    assert.ok(await sget(BACKUP), 'the old-pin backup is kept — it is the only readable copy left');
    assert.equal((await sget(STORE)).version, 2, 'the sabotage took: a v2 store whose slot will not open');
  } finally {
    globalThis.chrome.storage.local = real;
  }
});
