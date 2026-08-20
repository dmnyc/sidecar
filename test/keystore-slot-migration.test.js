'use strict';

// The v1 → v2 keystore migration.
//
// v1 encrypted every payload directly under the PIN-derived key: account private
// keys, the verifier, the notes-key wrap, and the NWC connection strings. Each was
// its own re-wrap site that changePin had to remember, and it forgot one, which is
// how a PIN change came to silently destroy every stored wallet connection.
//
// v2 puts one random DEK under all of it and wraps the DEK in slots, one per
// unlock factor. Changing the PIN re-seals 32 bytes; adding a passkey later is the
// same operation. No payload ciphertext moves, so there is no list to forget.
//
// Getting the migration wrong costs every private key in the vault, so this file
// leans on the paranoid cases: that a corrupt store aborts instead of writing,
// that nothing is written until the new ciphertext has been read back and
// compared, that a wrong PIN cannot trigger it, and that a backup of the old store
// survives exactly one unlock cycle.

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
const NOTES = 'sidecar_notes_key';
const NWC = 'sidecar_nwc_connections';
const BACKUP = 'sidecar_keystore_v1_backup';
const CONN = 'nostr+walletconnect://abc?relay=wss%3A%2F%2Frelay.example&secret=deadbeef';
const CONN2 = 'nostr+walletconnect://def?relay=wss%3A%2F%2Frelay2.example&secret=cafebabe';

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

// Build a v1 store by hand — exactly the shape the shipped v1 code wrote.
async function seedV1({ count = 2, withNotes = true, withNwc = true, pin = PIN } = {}) {
  const kdf = C.newKdf();
  const key = await C.deriveKey(pin, kdf);
  const store = { version: 1, kdf, accounts: {}, verifier: await C.makeVerifier(key), order: [] };
  const made = [];
  for (let i = 0; i < count; i++) {
    const sk = NT.generateSecretKey();
    const pubkey = NT.getPublicKey(sk);
    store.accounts[pubkey] = {
      pubkey, name: 'acct-' + i, picture: 'https://example/' + i + '.png',
      enc: await C.encryptBytes(key, sk), createdAt: 1000 + i,
    };
    store.order.push(pubkey);
    made.push({ pubkey, sk: Uint8Array.from(sk) });
  }
  const write = { [STORE]: store, sidecar_active_pubkey: made[0] ? made[0].pubkey : null };
  let notesRaw = null;
  if (withNotes) {
    notesRaw = C.randomBytes(32);
    write[NOTES] = { v: 1, enc: await C.encryptBytes(key, notesRaw) };
  }
  if (withNwc && made.length) {
    const all = {};
    all[made[0].pubkey] = await C.encryptString(key, CONN);
    if (made[1]) all[made[1].pubkey] = await C.encryptString(key, CONN2);
    write[NWC] = all;
  }
  await sset(write);
  return { accounts: made, notesRaw };
}

beforeEach(async () => {
  globalThis.chrome.storage.local.clear(() => {});
  globalThis.chrome.storage.session.clear(() => {});
  KS = freshKeystore();
});

// ---- a fresh keystore is born on v2 ----

test('a new keystore initializes at v2 with a pin slot and no bare kdf', async () => {
  await KS.initialize(PIN);
  const store = await sget(STORE);
  assert.equal(store.version, 2);
  assert.equal(store.slots.length, 1);
  assert.equal(store.slots[0].type, 'pin');
  assert.ok(store.slots[0].wrapped.ct, 'the DEK is sealed in the slot');
  assert.equal(store.kdf, undefined, 'no top-level kdf: the KDF belongs to the slot');
});

test('the wrap is the PIN check — a wrong PIN cannot open a v2 store', async () => {
  await KS.initialize(PIN);
  await KS.lock();
  KS = freshKeystore();
  await assert.rejects(() => KS.unlock('not-the-right-pin'), /Incorrect PIN/);
  assert.equal(KS.isLocked(), true);
});

// ---- migrating a real v1 store ----

test('unlocking a v1 store migrates it and returns every private key intact', async () => {
  const { accounts } = await seedV1({ count: 3 });
  await KS.unlock(PIN);

  const store = await sget(STORE);
  assert.equal(store.version, 2, 'store is now v2');
  assert.ok(store.slots && store.slots[0].type === 'pin');

  for (const { pubkey, sk } of accounts) {
    const got = await KS.getPrivkey(pubkey);
    assert.deepEqual(Uint8Array.from(got), sk, 'private key survived byte-for-byte');
  }
});

test('migration preserves account metadata and ordering', async () => {
  const { accounts } = await seedV1({ count: 3 });
  const before = await sget(STORE);
  await KS.unlock(PIN);
  const after = await sget(STORE);

  assert.deepEqual(after.order, before.order, 'order preserved');
  for (const { pubkey } of accounts) {
    assert.equal(after.accounts[pubkey].name, before.accounts[pubkey].name);
    assert.equal(after.accounts[pubkey].picture, before.accounts[pubkey].picture);
    assert.equal(after.accounts[pubkey].createdAt, before.accounts[pubkey].createdAt);
    assert.notEqual(after.accounts[pubkey].enc.ct, before.accounts[pubkey].enc.ct, 're-sealed under the DEK');
  }
});

test('migration carries the notes key across, same raw bytes', async () => {
  const { notesRaw } = await seedV1({ count: 1 });
  // Seal something with the pre-migration notes key.
  const preKey = await C.importKeyRaw(C.bytesToBase64(notesRaw));
  const sealed = await C.encryptString(preKey, 'a draft that must survive');

  await KS.unlock(PIN);
  const post = await KS.getNotesKey();
  assert.ok(post, 'notes key available after migration');
  assert.equal(await C.decryptString(post, sealed), 'a draft that must survive');
});

test('migration carries every NWC connection across', async () => {
  const { accounts } = await seedV1({ count: 2 });
  await KS.unlock(PIN);
  assert.equal(await KS.getNwc(accounts[0].pubkey), CONN);
  assert.equal(await KS.getNwc(accounts[1].pubkey), CONN2);
});

test('migration survives a service-worker restart', async () => {
  const { accounts } = await seedV1({ count: 2 });
  await KS.unlock(PIN);
  KS = freshKeystore();              // SW eviction
  await KS.unlock(PIN);              // now the v2 path
  assert.deepEqual(Uint8Array.from(await KS.getPrivkey(accounts[0].pubkey)), accounts[0].sk);
  assert.equal(await KS.getNwc(accounts[0].pubkey), CONN);
});

test('an NWC record already orphaned under v1 is carried over, not dropped', async () => {
  const { accounts } = await seedV1({ count: 1, withNwc: false });
  // A record sealed under a key nobody holds — the pre-#218 PIN-change casualty.
  const orphanKey = await C.deriveKey('a-key-that-is-gone', C.newKdf());
  await sset({ [NWC]: { [accounts[0].pubkey]: await C.encryptString(orphanKey, CONN) } });
  const before = (await sget(NWC))[accounts[0].pubkey];

  await KS.unlock(PIN);

  const after = (await sget(NWC))[accounts[0].pubkey];
  assert.deepEqual(after, before, 'left exactly as found rather than deleted');
  assert.equal(await KS.hasNwc(accounts[0].pubkey), false, 'and honestly reported as no wallet');
});

// ---- refusing to migrate ----

test('a wrong PIN does not migrate anything', async () => {
  await seedV1({ count: 2 });
  const before = await sget(STORE);
  await assert.rejects(() => KS.unlock('completely-wrong-pin'), /Incorrect PIN/);
  const after = await sget(STORE);
  assert.equal(after.version, 1, 'still v1');
  assert.deepEqual(after, before, 'byte-identical — nothing was touched');
  assert.equal(await sget(BACKUP), undefined, 'and no backup was written');
});

test('a store with one undecryptable account aborts and writes nothing', async () => {
  const { accounts } = await seedV1({ count: 3 });
  // Corrupt one account's ciphertext, as a bad disk or a partial write would.
  const store = await sget(STORE);
  const victim = accounts[1].pubkey;
  store.accounts[victim].enc.ct = C.bytesToBase64(C.randomBytes(48));
  await sset({ [STORE]: store });

  await assert.rejects(() => KS.unlock(PIN));

  const after = await sget(STORE);
  assert.equal(after.version, 1, 'store must still be v1');
  assert.equal(await sget(BACKUP), undefined, 'nothing half-written');
  assert.equal(KS.isLocked(), true, 'and the keystore did not come up unlocked');
  // The two healthy accounts are untouched and still openable by the old key.
  const oldKey = await C.deriveKey(PIN, after.kdf);
  for (const i of [0, 2]) {
    const bytes = await C.decryptBytes(oldKey, after.accounts[accounts[i].pubkey].enc);
    assert.deepEqual(Uint8Array.from(bytes), accounts[i].sk, 'healthy account still readable');
  }
});

// ---- the one-cycle backup ----

test('the v1 backup is written by the migration and cleared on the next unlock', async () => {
  await seedV1({ count: 2 });
  const original = await sget(STORE);

  await KS.unlock(PIN);
  const backup = await sget(BACKUP);
  assert.ok(backup, 'backup present immediately after migrating');
  assert.deepEqual(backup, original, 'and it is the untouched v1 store');

  KS = freshKeystore();
  await KS.unlock(PIN);              // a later, non-migrating unlock
  assert.equal(await sget(BACKUP), undefined, 'backup cleared once v2 read back cleanly');
});

// ---- changePin ----

test('changePin on a v1 store migrates it', async () => {
  const { accounts } = await seedV1({ count: 2 });
  await KS.changePin(PIN, PIN2);

  const store = await sget(STORE);
  assert.equal(store.version, 2);

  KS = freshKeystore();
  await KS.unlock(PIN2);
  assert.deepEqual(Uint8Array.from(await KS.getPrivkey(accounts[0].pubkey)), accounts[0].sk);
  assert.equal(await KS.getNwc(accounts[0].pubkey), CONN, 'wallet survived the v1 changePin path');
  await assert.rejects(() => freshKeystore().unlock(PIN), /Incorrect PIN/);
});

test('changePin on a v2 store re-seals only the slot', async () => {
  await KS.initialize(PIN);
  const { pubkey } = await KS.generateAccount('one');
  await KS.setNwc(pubkey, CONN);

  const before = await sget(STORE);
  await KS.changePin(PIN, PIN2);
  const after = await sget(STORE);

  assert.equal(after.accounts[pubkey].enc.ct, before.accounts[pubkey].enc.ct, 'account untouched');
  assert.notEqual(after.slots[0].wrapped.ct, before.slots[0].wrapped.ct, 'slot re-sealed');
  assert.equal(after.verifier.ct, before.verifier.ct, 'verifier untouched — the DEK did not change');

  KS = freshKeystore();
  await KS.unlock(PIN2);
  assert.equal(await KS.getNwc(pubkey), CONN);
});

test('a rejected changePin leaves a v1 store on v1', async () => {
  await seedV1({ count: 1 });
  await assert.rejects(() => KS.changePin('wrong-current-pin', PIN2), /Incorrect current PIN/);
  assert.equal((await sget(STORE)).version, 1);
});

// ---- verifyPin across both layouts ----

test('verifyPin works on v1 and on v2', async () => {
  await seedV1({ count: 1 });
  assert.equal(await KS.verifyPin(PIN), true, 'v1');
  assert.equal(await KS.verifyPin('nope-not-this-one'), false, 'v1, wrong');
  await KS.unlock(PIN);              // migrates
  assert.equal(await KS.verifyPin(PIN), true, 'v2');
  assert.equal(await KS.verifyPin('nope-not-this-one'), false, 'v2, wrong');
});

// ---- the property the whole design exists for ----

test('every payload store rides on the DEK, so a PIN change rewrites none of them', async () => {
  await KS.initialize(PIN);
  const { pubkey } = await KS.generateAccount('one');
  await KS.setNwc(pubkey, CONN);
  await KS.getNotesKey();

  const before = {
    acct: (await sget(STORE)).accounts[pubkey].enc.ct,
    nwc: (await sget(NWC))[pubkey].ct,
    notes: (await sget(NOTES)).enc.ct,
  };
  await KS.changePin(PIN, PIN2);
  const after = {
    acct: (await sget(STORE)).accounts[pubkey].enc.ct,
    nwc: (await sget(NWC))[pubkey].ct,
    notes: (await sget(NOTES)).enc.ct,
  };

  assert.deepEqual(after, before, 'no payload ciphertext moved anywhere');

  // And all three are still readable through the new PIN after a restart.
  KS = freshKeystore();
  await KS.unlock(PIN2);
  assert.ok(await KS.getPrivkey(pubkey));
  assert.equal(await KS.getNwc(pubkey), CONN);
  assert.ok(await KS.getNotesKey());
});
