'use strict';

// A list edit, said in words (list-change.js).
//
// Muting someone signs the WHOLE mute list again, private part sealed to yourself, and the
// approval card could only show that as base64 and "Tags 0". The module turns it into
// "Mutes npub1…" by opening the private part with the account's own key and diffing
// against a local snapshot of the last version Sidecar saw.
//
// What is pinned here:
//   - a diff names what was added, public or private, and what public entry was removed;
//   - a removed PRIVATE entry is counted, never named, because the snapshot keeps only
//     digests of private entries: the list must not be readable back out of storage;
//   - no snapshot ⇒ "what it contains", not a made-up diff;
//   - an unreadable private part ⇒ null (the card falls back), and nothing is recorded;
//   - describe() never throws.

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

const store = {};
const local = {
  get(keys, cb) {
    let out = {};
    if (keys == null) out = { ...store };
    else for (const k of (Array.isArray(keys) ? keys : [keys])) if (k in store) out[k] = store[k];
    cb(out);
  },
  set(obj, cb) { Object.assign(store, obj); cb && cb(); },
  remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k]; cb && cb(); },
};

let L;
const pk = 'a'.repeat(64);
const alice = '1'.repeat(64);
const bob = '2'.repeat(64);
const carol = '3'.repeat(64);

// A stand-in for "sealed to self": the tests are about the diff, not the cipher.
const seal = (tags) => 'sealed:' + Buffer.from(JSON.stringify(tags)).toString('base64');
const decrypt = async (nip, c) => {
  if (nip !== 44 || !c.startsWith('sealed:')) throw new Error('not ours');
  return Buffer.from(c.slice(7), 'base64').toString();
};
const mute = (pub, priv, ts) => ({ kind: 10000, tags: pub, content: priv ? seal(priv) : '', created_at: ts || 1 });
const open = (ev) => L.openPrivate(ev, decrypt);

before(() => {
  globalThis.self = globalThis;
  globalThis.chrome = { storage: { local } };
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'list-change.js'), 'utf8'), { filename: 'list-change.js' });
  L = globalThis.SidecarListChange;
});

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

test('MUTING SOMEONE PRIVATELY READS AS "MUTES" THAT PERSON, NOT AS THE WHOLE LIST', async () => {
  const before = mute([], [['p', alice], ['word', 'spoilers']]);
  assert.equal(await L.record(pk, before, await open(before)), true);

  const after = mute([], [['p', alice], ['word', 'spoilers'], ['p', bob]], 2);
  const d = await L.describe(pk, after, await open(after));
  assert.equal(d.known, true);
  assert.deepEqual(d.added, [{ tag: 'p', value: bob, private: true }]);
  assert.equal(d.addedCount, 1);
  assert.equal(d.removedCount, 0);
  assert.equal(d.total, 3);
  assert.equal(d.privateTotal, 3);
});

test('a public removal is named; a private one is only counted', async () => {
  const before = mute([['p', alice], ['t', 'nsfw']], [['p', bob]]);
  await L.record(pk, before, await open(before));
  const after = mute([['p', alice]], [], 2);
  const d = await L.describe(pk, after, await open(after));
  assert.deepEqual(d.removed, [{ tag: 't', value: 'nsfw', private: false }]);
  assert.equal(d.removedCount, 2);
  assert.equal(d.removedPrivate, 1);
  assert.equal(d.addedCount, 0);
});

test('THE SNAPSHOT NEVER HOLDS A PRIVATE ENTRY IN THE CLEAR', async () => {
  const ev = mute([['p', alice]], [['p', bob], ['word', 'hunter2']]);
  await L.record(pk, ev, await open(ev));
  const saved = JSON.stringify(store);
  assert.ok(saved.includes(alice), 'public entries are kept as is: they are on every relay');
  assert.equal(saved.includes(bob), false);
  assert.equal(saved.includes('hunter2'), false);
});

test('moving an entry from public to private is not an add and a remove', async () => {
  const before = mute([['p', alice]], []);
  await L.record(pk, before, await open(before));
  const after = mute([], [['p', alice]], 2);
  const d = await L.describe(pk, after, await open(after));
  assert.equal(d.addedCount, 0);
  assert.equal(d.removedCount, 0);
});

test('no snapshot: the card says what the list holds, not what changed', async () => {
  const ev = mute([['p', alice]], [['p', bob]]);
  const d = await L.describe(pk, ev, await open(ev));
  assert.equal(d.known, false);
  assert.equal(d.addedCount, 2);
  assert.equal(d.privateTotal, 1);
});

test('AN UNREADABLE PRIVATE PART FALLS BACK, AND IS NOT RECORDED AS EMPTY', async () => {
  const ev = { kind: 10000, tags: [], content: 'c29tZXRoaW5nIGVsc2U=', created_at: 1 };
  const priv = await open(ev);
  assert.equal(priv, null);
  assert.equal(await L.describe(pk, ev, priv), null);
  assert.equal(await L.record(pk, ev, priv), false);
  assert.deepEqual(Object.keys(store), []);
});

test('kind 3 legacy relay JSON in content is not a sealed list', async () => {
  const ev = { kind: 3, tags: [['p', alice]], content: '{"wss://r":{"read":true}}' };
  assert.deepEqual(await open(ev), []);
});

test('the seed from relays never clobbers a newer snapshot', async () => {
  const signed = mute([['p', alice], ['p', bob]], null, 20);
  await L.record(pk, signed, []);
  const stale = mute([['p', alice]], null, 10);
  assert.equal(await L.record(pk, stale, [], { ifNewer: true }), false);
  const d = await L.describe(pk, mute([['p', alice], ['p', bob], ['p', carol]], null, 30), []);
  assert.equal(d.addedCount, 1);
});

test('addressable sets are kept apart by their d-tag', async () => {
  const a = { kind: 30000, tags: [['d', 'friends'], ['p', alice]], content: '', created_at: 1 };
  const b = { kind: 30000, tags: [['d', 'work'], ['p', bob]], content: '', created_at: 1 };
  await L.record(pk, a, []);
  await L.record(pk, b, []);
  const d = await L.describe(pk, { ...a, tags: [['d', 'friends'], ['p', alice], ['p', carol]] }, []);
  assert.deepEqual(d.added.map((e) => e.value), [carol]);
  assert.equal(d.total, 2, 'the d tag is not an entry');
});

test('a long import lists a handful by name and counts the rest', async () => {
  await L.record(pk, mute([], null), []);
  const many = [];
  for (let i = 0; i < 40; i++) many.push(['p', String(i).padStart(64, '0')]);
  const d = await L.describe(pk, mute(many, null, 2), []);
  assert.equal(d.added.length, L.SHOW_MAX);
  assert.equal(d.addedCount, 40);
});

test('not a list, or no account: nothing to say, and never a throw', async () => {
  assert.equal(await L.describe(pk, { kind: 1, tags: [], content: 'hi' }, []), null);
  assert.equal(await L.describe('', mute([], null), []), null);
  assert.equal(await L.describe(pk, null, []), null);
});

test('forgetting an account drops its snapshots and only its snapshots', async () => {
  await L.record(pk, mute([['p', alice]], null), []);
  await L.record('b'.repeat(64), mute([['p', alice]], null), []);
  store.unrelated = 1;
  await L.forget(pk);
  assert.equal(Object.keys(store).filter((k) => k.includes(pk)).length, 0);
  assert.equal(Object.keys(store).length, 2);
});

test('both approval surfaces draw the change and tuck the raw event behind it', () => {
  for (const f of ['prompt.js', 'sidepanel.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(src, /appendListChange\((els\.preview|box), data\.listChange/, f);
    assert.match(src, /appendEventContent\([^)]*\{ tucked: !!data\.listChange \}\)/, f);
  }
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  assert.match(bg, /listChange,\n/, 'the prompt payload carries it');
  assert.match(bg, /'replaceable-baseline\.js', 'list-change\.js'/, 'the worker loads it');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.ok(manifest.background.scripts.includes('list-change.js'), 'Firefox loads it too');
});
