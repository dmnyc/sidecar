'use strict';

// Unit coverage for the timed "relax approvals" grant (relax-grants.js).
//
// The relax window is the user-opted escape hatch from the shared-host per-sign
// confirm: once granted for a (host, account), content signs skip the prompt
// until the timer ends. The safety of the whole feature rests on this module's
// invariants, so they're pinned here:
//   - a grant answers "yes" only for its exact (host, pubkey);
//   - ONE window at a time — relaxing on a new site revokes the prior one so the
//     panel's single countdown always reflects the active site;
//   - it self-expires (lazy on read) and via the alarm hook, and reports the
//     duration so the panel can draw a depleting progress bar;
//   - wallet/account-control kinds are flagged so the caller still prompts for them.
//
// relax-grants.js is isolated (talks only to globalThis.chrome), so we load it in
// a vm against a small chrome mock — same approach as test/owner-sign.test.js.

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// Minimal in-memory chrome.storage area (callback-style like MV3).
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

// chrome.alarms mock: records armed alarms so onAlarm + revoke can be asserted.
function makeAlarms() {
  const map = new Map();
  return {
    create(name, opts) { map.set(name, opts || {}); },
    clear(name) { if (typeof name === 'string') map.delete(name); return Promise.resolve(true); },
    getAll() { return Promise.resolve([...map.keys()].map((name) => ({ name }))); },
  };
}

let RELAX;

before(() => {
  globalThis.self = globalThis;
  globalThis.chrome = {
    storage: { session: makeStorageArea() },
    alarms: makeAlarms(),
    runtime: { sendMessage: () => Promise.resolve() },
  };
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'relax-grants.js'), 'utf8'), { filename: 'relax-grants.js' });
  RELAX = globalThis.SidecarRelax;
  assert.ok(RELAX, 'SidecarRelax loaded');
});

// Each test starts from a clean grant store so order doesn't matter.
beforeEach(async () => {
  await RELAX.revokeAll();
});

const HOST = 'jumble.nostr.com';
const pkA = 'a'.repeat(64);
const pkB = 'b'.repeat(64);

test('grant then has() is true only for that exact (host, pubkey)', async () => {
  await RELAX.grant(HOST, pkA, 60000);
  assert.equal(await RELAX.has(HOST, pkA), true);
  assert.equal(await RELAX.has(HOST, pkB), false, 'a different account must not borrow it');
  assert.equal(await RELAX.has('other.host', pkA), false, 'a different host must not borrow it');
});

test('a new grant takes over: relaxing on a second site revokes the first', async () => {
  await RELAX.grant(HOST, pkA, 60000);
  assert.equal(await RELAX.has(HOST, pkA), true);
  await RELAX.grant('other.host', pkA, 60000);
  assert.equal(await RELAX.has(HOST, pkA), false, 'the first window is revoked');
  assert.equal(await RELAX.has('other.host', pkA), true, 'the new window is active');
  assert.equal((await RELAX.active()).length, 1, 'only one window is active at a time');
});

test('has() self-expires after the window', async () => {
  await RELAX.grant(HOST, pkA, 5); // 5ms
  assert.equal(await RELAX.has(HOST, pkA), true);
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(await RELAX.has(HOST, pkA), false, 'expired grant must read as absent');
  assert.equal((await RELAX.active()).length, 0, 'expired entry is cleaned up on read');
});

test('grant arms an expiry alarm; onAlarm(name) clears it', async () => {
  await RELAX.grant(HOST, pkA, 60000);
  const ours = (await globalThis.chrome.alarms.getAll()).filter((a) => a.name.startsWith(RELAX.ALARM_PREFIX));
  assert.equal(ours.length, 1, 'one alarm armed per grant');
  assert.equal(await RELAX.has(HOST, pkA), true);
  assert.equal(RELAX.onAlarm(ours[0].name), true, 'onAlarm claims its own alarm');
  assert.equal(await RELAX.has(HOST, pkA), false, 'firing the alarm revokes the grant');
  assert.equal(RELAX.onAlarm('sidecar-auto-lock'), false, 'onAlarm ignores unrelated alarms');
});

test('revoke(host, pubkey) ends the active window', async () => {
  await RELAX.grant(HOST, pkA, 60000);
  await RELAX.revoke(HOST, pkA);
  assert.equal(await RELAX.has(HOST, pkA), false);
  assert.equal((await RELAX.active()).length, 0);
});

test('revokeForHost clears a window on that host (the re-login hook)', async () => {
  await RELAX.grant(HOST, pkA, 60000);
  await RELAX.revokeForHost(HOST);
  assert.equal(await RELAX.has(HOST, pkA), false);
});

test('revokeAll clears everything', async () => {
  await RELAX.grant(HOST, pkA, 60000);
  await RELAX.revokeAll();
  assert.equal((await RELAX.active()).length, 0);
});

test('active() reports host, pubkey, expiresAt, and duration (for the progress bar)', async () => {
  await RELAX.grant(HOST, pkA, 60000);
  const list = await RELAX.active();
  assert.equal(list.length, 1);
  assert.equal(list[0].host, HOST);
  assert.equal(list[0].pubkey, pkA);
  assert.equal(list[0].duration, 60000);
  assert.ok(list[0].expiresAt > Date.now());
});

test('grant duration is capped at MAX_MS', async () => {
  await RELAX.grant(HOST, pkA, 9999999999);
  const list = await RELAX.active();
  assert.ok(list[0].expiresAt - Date.now() <= RELAX.MAX_MS + 500, 'capped at MAX_MS');
});

test('isControlKind flags wallet/account-control kinds only', () => {
  for (const k of [24133, 23194, 23195]) assert.equal(RELAX.isControlKind(k), true, 'control kind ' + k);
  assert.equal(RELAX.isControlKind(1), false, 'a normal note is relaxable');
  assert.equal(RELAX.isControlKind(null), false, 'non-signEvent methods (null kind) are relaxable');
});

// ---- replaceable kinds never relax ---------------------------------------------
//
// The bug: a relax window could be granted from a profile-edit prompt. The
// destructive check suppresses the offer when THIS event looks like a wipe, but it is
// per-event and the window is not — an ordinary complete profile edit isn't
// destructive, so it offered "auto-sign the next 30 minutes", and the NEXT profile
// write in that window went through unwarned. Approving a write also makes it the new
// baseline, so the comparison the guard relies on is gone by then.

test('isReplaceableKind flags the wipeable kinds', () => {
  for (const k of [0, 3, 10000]) {
    assert.equal(RELAX.isReplaceableKind(k), true, 'replaceable kind ' + k);
  }
  assert.equal(RELAX.isReplaceableKind(1), false, 'a note replaces nothing');
  assert.equal(RELAX.isReplaceableKind(1111), false, 'a comment replaces nothing');
  assert.equal(RELAX.isReplaceableKind(null), false);
});

test('kind 0 never relaxes — the reported case', () => {
  // A profile edit on an ask-tier site offered a 30-minute auto-sign window.
  assert.equal(RELAX.neverRelaxes(0), true);
});

test('neverRelaxes covers both control and replaceable kinds', () => {
  for (const k of [24133, 23194, 23195, 0, 3, 10000]) {
    assert.equal(RELAX.neverRelaxes(k), true, 'kind ' + k + ' must never relax');
  }
});

test('neverRelaxes leaves ordinary content relaxable', () => {
  // The feature still has to work for what it was built for: notes, reactions,
  // reposts, comments, DMs — the high-frequency signing a session actually produces.
  for (const k of [1, 6, 7, 1111, 9734, 30023, 4, 14]) {
    assert.equal(RELAX.neverRelaxes(k), false, 'kind ' + k + ' should stay relaxable');
  }
  assert.equal(RELAX.neverRelaxes(null), false, 'encrypt/decrypt carry no kind');
  assert.equal(RELAX.neverRelaxes(undefined), false);
});

test('the replaceable set agrees with replaceable-baseline.js', () => {
  // Two files hold this list: relax-grants.js can't import the baseline module (it is
  // loaded first by background.js's importScripts, and stays dependency-free so it can
  // be tested against a bare chrome mock). If the destructive guard ever starts
  // tracking a fourth kind, this fails until relax excludes it too — otherwise that
  // kind would be wipeable inside a relax window.
  const baselineSrc = fs.readFileSync(path.join(ROOT, 'replaceable-baseline.js'), 'utf8');
  const m = baselineSrc.match(/const TRACKED = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'could not find TRACKED in replaceable-baseline.js');
  // TRACKED is built from named constants (KIND_PROFILE &c.) — resolve each.
  const kinds = m[1].split(',').map((name) => {
    const t = name.trim();
    if (/^\d+$/.test(t)) return Number(t);
    const dm = baselineSrc.match(new RegExp('const ' + t + ' = (\\d+)'));
    assert.ok(dm, 'could not resolve ' + t);
    return Number(dm[1]);
  });
  assert.deepEqual(kinds.slice().sort((a, b) => a - b), [0, 3, 10000],
    'baseline tracks a different set than expected');
  for (const k of kinds) {
    assert.equal(RELAX.neverRelaxes(k), true,
      'baseline guards kind ' + k + ' but relax would let a window cover it');
  }
});

test('a re-grant for the same pair replaces the window (no duplicate alarms)', async () => {
  await RELAX.grant(HOST, pkA, 60000);
  await RELAX.grant(HOST, pkA, 60000);
  const ours = (await globalThis.chrome.alarms.getAll()).filter((a) => a.name.startsWith(RELAX.ALARM_PREFIX));
  assert.equal(ours.length, 1, 're-grant clears the old alarm before arming a new one');
});
