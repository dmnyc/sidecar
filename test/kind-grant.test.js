'use strict';

// Unit coverage for the standing per-kind auto-approve grant (kind-grants.js, #482).
//
// "Always allow this event type for this site" is a persistent signing oracle the
// user opts into from the approval card, so its invariants are the feature's safety:
//   - a grant answers "yes" only for its exact (host, pubkey, kind);
//   - a grant saved with a `d` tag covers only that record; one saved without
//     covers the whole kind. `d` is page-controlled text and may contain '|', so
//     the key must never be parsed to answer a question about it;
//   - kinds that must never carry a standing grant can't have one: the
//     wallet/account-control kinds, the overwrite guard's replaceable kinds,
//     zap requests (the amount tag would make a grant a blank check), and
//     relay auth (already pre-approved when well-formed);
//   - the queue sweep behind a fresh grant settles only entries that were
//     actually waiting on an approval for the same (host, account, kind, d).
//
// kind-grants.js is isolated (talks only to globalThis.chrome), so we load it in
// a vm against a small chrome mock — same approach as test/relax-grant.test.js.

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// Minimal in-memory chrome.storage.local (callback-style like MV3).
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
    _data: data,
  };
}

const local = makeStorageArea();
let KINDS;

before(() => {
  globalThis.self = globalThis;
  globalThis.chrome = { storage: { local } };
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'kind-grants.js'), 'utf8'), { filename: 'kind-grants.js' });
  KINDS = globalThis.SidecarKindGrants;
  assert.ok(KINDS, 'SidecarKindGrants loaded');
});

// Each test starts from a clean grant store so order doesn't matter.
beforeEach(async () => {
  await KINDS.clearAll();
});

const HOST = 'ditto.example';
const pkA = 'a'.repeat(64);
const pkB = 'b'.repeat(64);
const APP_DATA = 30078;

test('grant then has() is true only for that exact (host, pubkey, kind)', async () => {
  await KINDS.grant(HOST, pkA, APP_DATA);
  assert.equal(await KINDS.has(HOST, pkA, APP_DATA), true);
  assert.equal(await KINDS.has(HOST, pkB, APP_DATA), false, 'a different account must not borrow it');
  assert.equal(await KINDS.has('other.host', pkA, APP_DATA), false, 'a different host must not borrow it');
  assert.equal(await KINDS.has(HOST, pkA, 1), false, 'a different kind must not borrow it');
});

test('a grant saved with a d tag covers only that record', async () => {
  await KINDS.grant(HOST, pkA, APP_DATA, 'notif-settings');
  assert.equal(await KINDS.has(HOST, pkA, APP_DATA, 'notif-settings'), true);
  assert.equal(await KINDS.has(HOST, pkA, APP_DATA, 'other-record'), false, 'another record of the same kind is not covered');
  assert.equal(await KINDS.has(HOST, pkA, APP_DATA), false, 'an event with no d is not covered by a record grant');
});

test('a grant saved without a d covers the whole kind, records included', async () => {
  await KINDS.grant(HOST, pkA, APP_DATA);
  assert.equal(await KINDS.has(HOST, pkA, APP_DATA), true, 'bare kind event');
  assert.equal(await KINDS.has(HOST, pkA, APP_DATA, 'anything'), true, 'any record of the kind');
});

test('a d containing | survives storage and matching (the key is never parsed)', async () => {
  const tricky = 'a|b|c';
  await KINDS.grant(HOST, pkA, APP_DATA, tricky);
  assert.equal(await KINDS.has(HOST, pkA, APP_DATA, tricky), true);
  assert.equal(await KINDS.has(HOST, pkA, APP_DATA, 'a'), false);
  const list = await KINDS.listFor(pkA);
  assert.equal(list[0].d, tricky, 'the record name round-trips intact');
});

test('d: "" and omitted d are the same kind-level event', async () => {
  await KINDS.grant(HOST, pkA, APP_DATA, '');
  const list = await KINDS.listFor(pkA);
  assert.equal(list[0].d, null, 'empty d normalizes to a kind-level grant');
  assert.equal(await KINDS.has(HOST, pkA, APP_DATA, ''), true);
});

test('a grant persists across a worker restart (storage.local, not memory)', async () => {
  await KINDS.grant(HOST, pkA, APP_DATA, 'settings');
  // Reload the module fresh, as a restarted service worker would, against the
  // same storage area.
  const api = { chrome: { storage: { local } }, self: {} };
  const ctx = vm.createContext(api);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'kind-grants.js'), 'utf8'), ctx, { filename: 'kind-grants.js' });
  const fresh = api.self.SidecarKindGrants;
  assert.equal(await fresh.has(HOST, pkA, APP_DATA, 'settings'), true, 'the grant outlives the worker');
  assert.equal(await fresh.has(HOST, pkA, APP_DATA, 'other'), false);
});

test('control and replaceable kinds can never carry a grant', async () => {
  for (const k of [24133, 23194, 23195, 0, 3, 10000, 10040, 10001, 10002, 10003, 10050, 5]) {
    assert.equal(KINDS.isGrantableKind(k), false, 'kind ' + k + ' must never be grantable');
    assert.equal(await KINDS.has(HOST, pkA, k), false, 'kind ' + k + ' must be refused by has()');
  }
});

test('grant() throws for an ungrantable kind, so no surface can mint one', async () => {
  await assert.rejects(() => KINDS.grant(HOST, pkA, 3), /cannot carry a standing grant/);
  await assert.rejects(() => KINDS.grant(HOST, pkA, 9734), /cannot carry a standing grant/);
  await assert.rejects(() => KINDS.grant(HOST, pkA, 22242), /cannot carry a standing grant/);
});

test('zap requests and relay auth are not grantable; ordinary content kinds are', () => {
  assert.equal(KINDS.isGrantableKind(9734), false, 'a zap request carries the amount — a grant would be a blank check');
  assert.equal(KINDS.isGrantableKind(22242), false, 'well-formed relay auth is already pre-approved; a grant would cover malformed ones');
  for (const k of [1, 6, 7, 14, 1111, 30023, APP_DATA]) {
    assert.equal(KINDS.isGrantableKind(k), true, 'kind ' + k + ' should be grantable');
  }
  assert.equal(KINDS.isGrantableKind(null), false, 'encrypt/decrypt carry no kind and can never match');
});

test('revoke removes exactly the grant it names', async () => {
  await KINDS.grant(HOST, pkA, APP_DATA, 'settings');
  await KINDS.grant(HOST, pkA, APP_DATA, 'other');
  await KINDS.revoke(HOST, pkA, APP_DATA, 'settings');
  assert.equal(await KINDS.has(HOST, pkA, APP_DATA, 'settings'), false);
  assert.equal(await KINDS.has(HOST, pkA, APP_DATA, 'other'), true, 'the sibling record grant survives');
});

test('revokeForHost clears that host only; clearAccount clears the account', async () => {
  await KINDS.grant(HOST, pkA, 1);
  await KINDS.grant('other.host', pkA, 1);
  await KINDS.grant(HOST, pkB, 1);
  await KINDS.revokeForHost(pkA, HOST);
  assert.equal(await KINDS.has(HOST, pkA, 1), false);
  assert.equal(await KINDS.has('other.host', pkA, 1), true, 'another host keeps its grant');
  assert.equal(await KINDS.has(HOST, pkB, 1), true, 'another account keeps its grant');
  await KINDS.clearAccount(pkA);
  assert.equal(await KINDS.has('other.host', pkA, 1), false);
  assert.equal(await KINDS.has(HOST, pkB, 1), true, 'other accounts are untouched');
});

test('listFor returns one account’s grants, newest first, with the fields the row needs', async () => {
  await KINDS.grant(HOST, pkA, APP_DATA, 'settings');
  await new Promise((r) => setTimeout(r, 5));
  await KINDS.grant(HOST, pkA, 1);
  await KINDS.grant('other.host', pkB, 7);
  const list = await KINDS.listFor(pkA);
  assert.equal(list.length, 2);
  assert.equal(list[0].kind, 1, 'newest first');
  assert.equal(list[0].host, HOST);
  assert.equal(list[1].d, 'settings');
  assert.equal((await KINDS.listFor(pkB)).length, 1);
});

test('dTagOf reads the d tag and reports null when absent', () => {
  assert.equal(KINDS.dTagOf({ tags: [['d', 'notbffs'], ['client', 'x']] }), 'notbffs');
  assert.equal(KINDS.dTagOf({ tags: [['client', 'x']] }), null);
  assert.equal(KINDS.dTagOf({ tags: [] }), null);
  assert.equal(KINDS.dTagOf({}), null);
  assert.equal(KINDS.dTagOf(null), null);
});

// ---- the queue sweep behind a fresh grant --------------------------------------
//
// A burst queued behind the card that granted it must settle without one prompt
// per sibling — but only entries genuinely waiting on an approval, and only ones
// the grant actually covers.

function queueEntry(over) {
  return Object.assign({
    id: 'p_' + Math.random().toString(36).slice(2),
    host: HOST,
    method: 'signEvent',
    state: 'queued',
    data: {
      activePubkey: pkA,
      needApproval: true,
      needUnlock: false,
      params: { event: { kind: APP_DATA, tags: [['d', 'settings']], content: '{}' } },
    },
  }, over);
}

test('matchTargets settles the covered siblings queued behind the grant', () => {
  const head = queueEntry({ id: 'head' });
  const sibling = queueEntry({ id: 'sibling' });
  const otherD = queueEntry({ id: 'otherD', data: { activePubkey: pkA, needApproval: true, needUnlock: false, params: { event: { kind: APP_DATA, tags: [['d', 'other']], content: '{}' } } } });
  const targets = KINDS.matchTargets([head, sibling, otherD], HOST, pkA, APP_DATA, 'settings');
  assert.deepEqual(targets, ['head', 'sibling'], 'the grant covers exactly the same-record entries');
});

test('matchTargets skips entries not waiting on an approval', () => {
  const unlocked = queueEntry({ id: 'needsPin', data: { activePubkey: pkA, needApproval: true, needUnlock: true, params: { event: { kind: APP_DATA, tags: [['d', 'settings']], content: '{}' } } } });
  const noAsk = queueEntry({ id: 'noAsk', data: { activePubkey: pkA, needApproval: false, needUnlock: false, params: { event: { kind: APP_DATA, tags: [['d', 'settings']], content: '{}' } } } });
  const tombstone = queueEntry({ id: 'dead', state: 'interrupted' });
  const otherAccount = queueEntry({ id: 'otherPk', data: { activePubkey: pkB, needApproval: true, needUnlock: false, params: { event: { kind: APP_DATA, tags: [['d', 'settings']], content: '{}' } } } });
  const otherMethod = queueEntry({ id: 'encrypt', method: 'nip44.encrypt', data: { activePubkey: pkA, needApproval: true, needUnlock: false, params: { plaintext: 'x', pubkey: pkB } } });
  assert.deepEqual(
    KINDS.matchTargets([unlocked, noAsk, tombstone, otherAccount, otherMethod], HOST, pkA, APP_DATA, 'settings'),
    [],
    'an unlock owed, an already-auto entry, a tombstone, another account, and an encrypt are never swept'
  );
});

test('matchTargets honors the d axis of the fresh grant', () => {
  const named = queueEntry({ id: 'named' });
  const bare = queueEntry({ id: 'bare', data: { activePubkey: pkA, needApproval: true, needUnlock: false, params: { event: { kind: APP_DATA, tags: [], content: '{}' } } } });
  assert.deepEqual(KINDS.matchTargets([named, bare], HOST, pkA, APP_DATA, 'settings'), ['named'],
    'a record grant sweeps only that record');
  assert.deepEqual(KINDS.matchTargets([named, bare], HOST, pkA, APP_DATA, null), ['named', 'bare'],
    'a kind-level grant sweeps both');
});

// ---- the replaceable set agrees with replaceable-baseline.js --------------------

test('the replaceable set agrees with replaceable-baseline.js', () => {
  // Two files hold this list (kind-grants.js can't import the baseline module and
  // stays dependency-free for the chrome mock). If the destructive guard ever
  // starts tracking another kind, this fails until standing grants exclude it too
  // — otherwise "always allow" would permanently silence the wipe warning.
  const baselineSrc = fs.readFileSync(path.join(ROOT, 'replaceable-baseline.js'), 'utf8');
  const m = baselineSrc.match(/const TRACKED = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'could not find TRACKED in replaceable-baseline.js');
  const kinds = m[1].split(',').map((name) => {
    const t = name.trim();
    if (/^\d+$/.test(t)) return Number(t);
    const dm = baselineSrc.match(new RegExp('const ' + t + ' = (\\d+)'));
    assert.ok(dm, 'could not resolve ' + t);
    return Number(dm[1]);
  });
  for (const k of kinds) {
    assert.equal(KINDS.isGrantableKind(k), false,
      'baseline guards kind ' + k + ' but a standing grant could cover it');
  }
});
