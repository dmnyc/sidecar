'use strict';

// Reproduces the account-signing mismatch and locks in the fix.
//
// The panel's displayed account and the keystore's active account share one
// stored value, but an open panel can go stale (e.g. Sidecar open in a second
// window switches accounts — the first window is never told). All owner-signing
// (note publish + Blossom/upload auth) goes through the background OWNER_SIGN
// path, which today signs with KS.getActivePubkey() and takes NO account from
// the caller — so a composer showing account B can sign as account A.
//
// The fix: KS.ownerSign(event, expectedPubkey) fails closed — it refuses to sign
// when the caller's expected account no longer matches the active one.
//
// This unit-covers the SIGNING half (the actual defect). The two-window staleness
// is an integration scenario across two panel contexts — see
// test/MANUAL-account-mismatch.md for the manual reproduction.

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// Minimal in-memory chrome.storage area (local + session), callback-style like MV3.
function makeStorageArea() {
  const data = {};
  return {
    get(keys, cb) {
      let out = {};
      if (keys == null) out = { ...data };
      else if (typeof keys === 'string') { if (keys in data) out[keys] = data[keys]; }
      else if (Array.isArray(keys)) { for (const k of keys) if (k in data) out[k] = data[k]; }
      else { for (const k of Object.keys(keys)) out[k] = (k in data) ? data[k] : keys[k]; }
      cb(out);
    },
    set(obj, cb) { Object.assign(data, obj); cb && cb(); },
    remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) delete data[k]; cb && cb(); },
    clear(cb) { for (const k of Object.keys(data)) delete data[k]; cb && cb(); },
  };
}

let KS, NostrTools, pkA, pkB;

before(async () => {
  // The IIFEs resolve their root as `self`; give them one, plus a chrome mock.
  // Node 22 already provides globalThis.crypto (WebCrypto), which crypto.js uses.
  globalThis.self = globalThis;
  globalThis.chrome = { storage: { local: makeStorageArea(), session: makeStorageArea() } };
  for (const f of ['nostr-tools.js', 'crypto.js', 'keystore.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
  }
  NostrTools = globalThis.NostrTools;
  KS = globalThis.SidecarKeystore;
  assert.ok(KS, 'SidecarKeystore loaded');
  assert.ok(NostrTools && NostrTools.finalizeEvent, 'NostrTools loaded');

  await KS.initialize('sidecar-test-pin');
  pkA = (await KS.addAccountFromBytes(NostrTools.generateSecretKey(), 'A')).pubkey; // first add → active
  pkB = (await KS.addAccountFromBytes(NostrTools.generateSecretKey(), 'B')).pubkey;
  assert.notEqual(pkA, pkB);
});

const note = () => ({ kind: 1, created_at: 1, tags: [], content: 'hello' });

test('the bug: owner-signing follows the keystore active account, ignoring caller intent', async () => {
  await KS.setActive(pkA);
  // Exactly what background.js SIDECAR_OWNER_SIGN does today.
  const signed = NostrTools.finalizeEvent(note(), await KS.getPrivkey(await KS.getActivePubkey()));
  assert.equal(signed.pubkey, pkA);
  // A composer that showed B would still have produced an A-signed note. No signal to the caller.
});

test('the fix: KS.ownerSign rejects when expectedPubkey != active account', async () => {
  await KS.setActive(pkA);
  assert.equal(typeof KS.ownerSign, 'function', 'KS.ownerSign must exist');
  await assert.rejects(() => KS.ownerSign(note(), pkB), /account/i,
    'signing as B while A is active must fail closed');
});

test('the fix: KS.ownerSign signs as the active account when expected matches (or is omitted)', async () => {
  await KS.setActive(pkA);
  assert.equal((await KS.ownerSign(note(), pkA)).pubkey, pkA);
  assert.equal((await KS.ownerSign(note())).pubkey, pkA); // omitted = backward compatible
});
