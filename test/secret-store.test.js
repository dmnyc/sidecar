'use strict';

// Unit coverage for the encrypted local stores (drafts / payment metadata) —
// audit M5/S1, the second half of issue #196.
//
// Two layers, both pinned here:
//
//   keystore.js — the "notes key" envelope: one random key, wrapped under the
//     derived key and re-wrapped by changePin. The hazard is the PIN change: if
//     the re-wrap is missed (or interleaves with a first-use wrap write), every
//     draft and payment note becomes ciphertext nobody can open. changePin
//     re-wraps in the SAME storage write as the re-keyed vault, and both writes
//     ride the store chain. These tests reload keystore.js against persisted
//     storage — a simulated service-worker restart — because the in-memory key
//     would otherwise paper over a stale wrap on disk.
//
//   background.js — secretGet/secretPut: envelope reads and writes, the one-time
//     migration off the legacy plaintext keys (the encrypted copy must land
//     before the plaintext is removed), and fail-closed behavior while locked.

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// Callback-style area like MV3, with the two load-bearing properties from
// keystore-concurrency.test.js: yields to the microtask queue (so races are
// deterministic, not timing-dependent) and structured-clones values in and out
// (a shared live reference would make lost-update races impossible to produce).
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

const PIN = 'sidecar-test-pin';

// ---- part 1: the keystore envelope, with real WebCrypto ----
let KS, NostrTools, CRYPTO, keystoreSrc;

before(() => {
  globalThis.self = globalThis;
  globalThis.chrome = {
    storage: { local: makeSlowStorageArea(), session: makeSlowStorageArea() },
  };
  for (const f of ['nostr-tools.js', 'crypto.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
  }
  NostrTools = globalThis.NostrTools;
  CRYPTO = globalThis.SidecarCrypto;
  keystoreSrc = fs.readFileSync(path.join(ROOT, 'keystore.js'), 'utf8');
  assert.ok(NostrTools && CRYPTO);
});

// A "service worker restart": a fresh closure over the SAME storage areas. The
// session area survives SW eviction in real life (that's its whole job), so the
// new instance re-derives its unlocked state from it.
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

test('a first getNotesKey creates a wrapped key and stays usable', async () => {
  const k = await KS.getNotesKey();
  assert.ok(k, 'expected a CryptoKey while unlocked');
  const sealed = await CRYPTO.encryptString(k, 'draft text');
  assert.equal(await CRYPTO.decryptString(k, sealed), 'draft text');
});

test('locked means no notes key, and lock forgets it', async () => {
  await KS.getNotesKey(); // load it once…
  await KS.lock();
  assert.equal(await KS.getNotesKey(), null, 'locked: envelope operations must be off');
});

test('a PIN change keeps the SAME raw notes key (verified after a restart)', async () => {
  const k1 = await KS.getNotesKey();
  const sealed = await CRYPTO.encryptString(k1, 'the draft that must survive');
  await KS.changePin(PIN, 'a-longer-second-pin');
  // In-memory state would hide a stale wrap — prove the DISK copy is good by
  // unwrapping it from a fresh instance (simulated SW restart).
  const KS2 = freshKeystore();
  await KS2.ensureLoaded();
  const k2 = await KS2.getNotesKey();
  assert.ok(k2, 'the wrapped notes key did not survive the PIN change');
  assert.equal(
    await CRYPTO.decryptString(k2, sealed),
    'the draft that must survive',
    'the notes key changed material in the PIN change — every draft and payment note would be unreadable'
  );
});

// The exact interleaving that the serialization exists for: the FIRST use of
// getNotesKey (its own wrap write) racing changePin's re-wrap. If either escapes
// the store chain, one write can land a wrap keyed to the old PIN after the
// vault has already moved to the new one.
test('a first-use getNotesKey racing changePin still leaves a usable wrap', async () => {
  const [k1] = await Promise.all([KS.getNotesKey(), KS.changePin(PIN, 'third-long-pin')]);
  const sealed = await CRYPTO.encryptString(k1, 'raced draft');
  const KS2 = freshKeystore();
  await KS2.ensureLoaded();
  const k2 = await KS2.getNotesKey();
  assert.ok(k2);
  assert.equal(await CRYPTO.decryptString(k2, sealed), 'raced draft');
});

test('a wrong PIN is rejected before anything is re-wrapped', async () => {
  await KS.getNotesKey();
  await assert.rejects(() => KS.changePin('wrong-pin', 'new-long-pin'), /Incorrect current PIN/);
  const k = await KS.getNotesKey(); // still the pre-change key, still working
  assert.equal(await CRYPTO.decryptString(k, await CRYPTO.encryptString(k, 'x')), 'x');
});

// ---- part 2: background.js secretGet / secretPut, lifted into a vm ----
//
// The crypto here is a mock (key correctness is part 1's job, with real
// WebCrypto); what these pin is the storage choreography around the envelope.

const bgSource = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
function lift(pattern, label) {
  const m = bgSource.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in background.js');
  return m[0];
}

// `locked` and `failDecrypt` are flipped by individual tests.
function makeCtx({ locked, failDecrypt }) {
  const KEY = { sentinel: 'notes key' };
  const area = makeSlowStorageArea();
  const ops = []; // ['set', key] / ['remove', key] — order is asserted below
  const origSet = area.set.bind(area);
  const origRemove = area.remove.bind(area);
  area.set = (obj, cb) => { ops.push(['set', ...Object.keys(obj)]); origSet(obj, cb); };
  area.remove = (keys, cb) => { ops.push(['remove', ...(Array.isArray(keys) ? keys : [keys])]); origRemove(keys, cb); };
  const sget = (keys) => new Promise((res) => area.get(keys, res));
  const sset = (obj) => new Promise((res) => area.set(obj, res));
  const ctx = {
    KS: { isLocked: () => locked, getNotesKey: async () => (locked ? null : KEY) },
    CRYPTO: {
      encryptString: async (k, s) => ({ iv: 'mock', ct: 'ENC(' + s + ')' }),
      decryptString: async (k, enc) => {
        if (failDecrypt) throw new Error('OperationError');
        const m = /^ENC\((.*)\)$/.exec(enc && enc.ct);
        if (!m) throw new Error('OperationError');
        return m[1];
      },
    },
    sget,
    sset,
    chrome: { storage: { local: { remove: (k, cb) => area.remove(k, cb) } } },
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/const SECRET_STORES = \{[\s\S]*?\};/, 'SECRET_STORES') + '\n' +
    lift(/async function secretGet\(name\)\s*\{[\s\S]*?\n\}/, 'secretGet') + '\n' +
    lift(/async function secretPut\(name, value\)\s*\{[\s\S]*?\n\}/, 'secretPut') + '\n' +
    'globalThis.secretGet = secretGet; globalThis.secretPut = secretPut; globalThis.SECRET_STORES = SECRET_STORES;',
    ctx
  );
  return { ctx, area, ops };
}

test('locked reads return null and never touch the legacy plaintext', async () => {
  const { ctx, area } = makeCtx({ locked: true, failDecrypt: false });
  area.set({ sidecar_compose_drafts: { pk1: { text: 'secret' } } }, () => {});
  assert.equal(await ctx.secretGet('drafts'), null);
});

test('an unknown store name is refused', async () => {
  const { ctx } = makeCtx({ locked: false, failDecrypt: false });
  await assert.rejects(() => ctx.secretGet('diary'), /Unknown secret store/);
  await assert.rejects(() => ctx.secretPut('diary', {}), /Unknown secret store/);
});

test('an envelope is decrypted and returned; legacy is not consulted', async () => {
  const { ctx, area, ops } = makeCtx({ locked: false, failDecrypt: false });
  area.set({ sidecar_drafts_enc: { v: 1, enc: { iv: 'mock', ct: 'ENC({"pk1":{"text":"hi"}})' } } }, () => {});
  area.set({ sidecar_compose_drafts: { pk1: { text: 'legacy' } } }, () => {});
  ops.length = 0; // the seeding writes above are not the read's business
  const out = await ctx.secretGet('drafts');
  assert.equal(out.pk1.text, 'hi');
  assert.equal(ops.length, 0, 'no writes or removes should happen on a clean read');
});

test('a corrupt envelope without legacy is null — and is NOT deleted', async () => {
  const { ctx, area } = makeCtx({ locked: false, failDecrypt: true });
  area.set({ sidecar_drafts_enc: { v: 1, enc: { iv: 'x', ct: 'garbage' } } }, () => {});
  assert.equal(await ctx.secretGet('drafts'), null);
  const left = await new Promise((res) => area.get('sidecar_drafts_enc', res));
  assert.ok(left.sidecar_drafts_enc, 'the corrupt envelope must stay on disk for possible recovery');
});

test('a corrupt envelope falls back to a still-present legacy copy', async () => {
  const { ctx, area } = makeCtx({ locked: false, failDecrypt: true });
  area.set({ sidecar_drafts_enc: { v: 1, enc: { iv: 'x', ct: 'garbage' } } }, () => {});
  area.set({ sidecar_pay_meta: { lnbc123: { ts: 1 } } }, () => {});
  const out = await ctx.secretGet('paymeta');
  assert.equal(out.lnbc123.ts, 1, 'data still on disk should not be shown as empty');
});

test('legacy plaintext migrates: envelope first, plaintext removed after', async () => {
  const { ctx, area, ops } = makeCtx({ locked: false, failDecrypt: false });
  area.set({ sidecar_pay_meta: { lnbc1: { ts: 1 }, lnbc2: { ts: 2 } } }, () => {});
  const out = await ctx.secretGet('paymeta');
  assert.deepEqual(Object.keys(out).sort(), ['lnbc1', 'lnbc2']);
  const stored = await new Promise((res) => area.get('sidecar_pay_meta_enc', res));
  assert.ok(stored.sidecar_pay_meta_enc && stored.sidecar_pay_meta_enc.enc,
    'the encrypted copy must be on disk');
  assert.match(stored.sidecar_pay_meta_enc.enc.ct, /lnbc1/, 'and contain the migrated data');
  const legacy = await new Promise((res) => area.get('sidecar_pay_meta', res));
  assert.equal(legacy.sidecar_pay_meta, undefined, 'the plaintext must be gone');
  const setIdx = ops.findIndex((o) => o[0] === 'set' && o.includes('sidecar_pay_meta_enc'));
  const rmIdx = ops.findIndex((o) => o[0] === 'remove' && o.includes('sidecar_pay_meta'));
  assert.ok(setIdx >= 0 && rmIdx > setIdx, 'encrypted copy lands BEFORE the plaintext is removed');
});

test('no envelope and no legacy is an empty store, not an error', async () => {
  const { ctx } = makeCtx({ locked: false, failDecrypt: false });
  // Object.keys, not deepEqual on the object itself: it comes from the vm
  // context, whose realm has its own Object.prototype.
  assert.deepEqual(Object.keys(await ctx.secretGet('drafts')), []);
});

test('secretPut refuses while locked, writes an envelope while unlocked', async () => {
  const locked = makeCtx({ locked: true, failDecrypt: false });
  await assert.rejects(() => locked.ctx.secretPut('drafts', { a: 1 }), /locked/);

  const open = makeCtx({ locked: false, failDecrypt: false });
  await open.ctx.secretPut('drafts', { pk1: { text: 'typed draft' } });
  const stored = await new Promise((res) => open.area.get('sidecar_drafts_enc', res));
  assert.ok(stored.sidecar_drafts_enc && stored.sidecar_drafts_enc.v === 1);
  // And what put writes, get reads back:
  const round = await open.ctx.secretGet('drafts');
  assert.equal(round.pk1.text, 'typed draft');
});
