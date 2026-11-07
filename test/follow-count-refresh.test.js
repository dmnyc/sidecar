'use strict';

// Following or unfollowing someone used to leave two figures stale: the
// Overview drawer's count and the Profile tab's. writeFollow already refreshed
// followCountCache, so the data was right and nothing was showing it. The first
// cut of this fix dispatched a DOM event on document — which never reaches
// listeners on DESCENDANT elements, so the repaint was dead in the real panel
// while the tests stayed green (the reviewer caught it in a real browser). The
// contract now: writeFollow calls repaintFollowCounts() whenever the cached
// figure moved — a no-op follow that CORRECTS a stale cache moves it too — and
// every live figure registers a repainter that reads the fresh cache, keeps
// itself only while its element is connected, and no-ops otherwise.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const bare = src.replace(/^\s*\/\/.*$/gm, '');

function lift(pattern, label) {
  const m = bare.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

const PK = 'a'.repeat(64);
const tag = (c) => ['p', c.repeat(64)];

// The overview-reads pattern: slice a whole function out of the file by its
// declaration and closing brace.
function liftFn(decl) {
  const at = bare.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl + ' in sidepanel.js');
  const open = bare.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < bare.length; j++) {
    if (bare[j] === '{') depth++;
    else if (bare[j] === '}' && --depth === 0) return bare.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// writeFollow, run for real against stubs. listTags is the kind:3 the relays
// answer with; `prior` seeds the cache the way an earlier session read left it.
// repaintFollowCounts is injected so the test sees exactly when the writer
// announces.
function writeHarness({ listTags, followListCache = null, prior } = {}) {
  const repaints = [];
  const deps = {
    t: (s) => s,
    state: { activePubkey: PK },
    listRelays: async () => ['wss://x'],
    poolQuerySync: async () => listTags
      ? [{ pubkey: PK, created_at: 1, kind: 3, tags: listTags, content: '' }]
      : [],
    call: async (m) => ({ ...m.event, id: 'signed', sig: 'sig' }),
    publishSigned: async () => {},
    seedBaseline: () => {},
    followCountCache: new Map(),
    followListCache,
    followListPubkey: followListCache ? PK : null,
    forgetWot: () => {},
    repaintFollowCounts: () => repaints.push('repaint'),
  };
  if (prior !== undefined) deps.followCountCache.set(PK, { v: prior, at: Date.now() });
  // eslint-disable-next-line no-new-func
  const writeFollow = new Function(...Object.keys(deps), `${liftFn('async function writeFollow(')}; return writeFollow;`)(...Object.values(deps));
  return { writeFollow, cache: deps.followCountCache, repaints };
}

test('FOLLOWING SOMEONE REFRESHES THE CACHE AND REPAINTS', async () => {
  const h = writeHarness({ listTags: [tag('1'), tag('2')] });
  const changed = await h.writeFollow(PK, '3'.repeat(64), false);
  assert.equal(changed, true);
  assert.equal(h.cache.get(PK).v, 3, 'two follows plus the new one');
  assert.equal(h.repaints.length, 1, 'the figures holding the old number are told');
});

test('UNFOLLOWING DOES THE SAME', async () => {
  const h = writeHarness({ listTags: [tag('1'), tag('2'), tag('3')] });
  const changed = await h.writeFollow(PK, '3'.repeat(64), true);
  assert.equal(changed, true);
  assert.equal(h.cache.get(PK).v, 2);
  assert.equal(h.repaints.length, 1);
});

test('A TRUE NO-OP SAYS NOTHING', async () => {
  const h = writeHarness({ listTags: [tag('1'), tag('2')], prior: 2 });
  const changed = await h.writeFollow(PK, '1'.repeat(64), false);
  assert.equal(changed, false, 'the list already carried this follow');
  assert.deepEqual(h.repaints, [], 'nothing moved, so nothing is announced');
});

test('A NO-OP THAT CORRECTS A STALE CACHE STILL REPAINTS', async () => {
  // The cache says 150, the relay list says 151 and already carries the
  // target: nothing was published, but the number the screen is holding was
  // wrong and just got fixed. That has to reach the figures.
  const h = writeHarness({ listTags: [tag('1'), tag('2')], prior: 150 });
  const changed = await h.writeFollow(PK, '1'.repeat(64), false);
  assert.equal(changed, false);
  assert.equal(h.cache.get(PK).v, 2, 'the cache now matches the list');
  assert.equal(h.repaints.length, 1, 'the correction is announced');
});

// ---- the repaint registry ----------------------------------------------------

function registryHarness() {
  const set = new Set();
  // The lifted block declares the set itself; strip that line so the test's
  // own set is the one the functions close over.
  const chunk = lift(/const followCountRepainters = new Set\(\);[\s\S]*?function repaintFollowCounts\(\) \{[\s\S]*?\n  \}/, 'the repaint registry')
    .replace('const followCountRepainters = new Set();', '');
  // eslint-disable-next-line no-new-func
  const fns = new Function('followCountRepainters', chunk + '; return { registerFollowRepainter, repaintFollowCounts };')(set);
  return { ...fns, set };
}

test('A REPAINTER RUNS WHILE ITS ELEMENT IS CONNECTED', () => {
  const r = registryHarness();
  const el = { isConnected: true };
  let ran = 0;
  r.registerFollowRepainter(el, () => ran++);
  r.repaintFollowCounts();
  assert.equal(ran, 1);
  r.repaintFollowCounts();
  assert.equal(ran, 2, 'registered once, fires on every announcement');
});

test('A REPAINTER ON A DETACHED ELEMENT IS SKIPPED AND PRUNED', () => {
  const r = registryHarness();
  const gone = { isConnected: false };
  const live = { isConnected: true };
  let ranGone = 0, ranLive = 0;
  r.registerFollowRepainter(gone, () => ranGone++);
  r.registerFollowRepainter(live, () => ranLive++);
  r.repaintFollowCounts();
  assert.equal(ranGone, 0, 'a dead render never repaints');
  assert.equal(ranLive, 1);
  assert.equal(r.set.size, 1, 'the dead repainter did not pile up');
});

// ---- wiring ------------------------------------------------------------------

test('BOTH SURFACES REGISTER A REPAINTER, AND THE WRITERS ANNOUNCE', () => {
  // The mechanism above is behavioral; these pin the two wiring sites and the
  // second writer (a Lazarus restore also moves the cached count).
  assert.match(bare, /registerFollowRepainter\(drawer, \(\) => \{/);
  assert.match(bare, /registerFollowRepainter\(followNum, \(\) => \{/);
  assert.match(bare, /repaintFollowCounts\(\); \/\/ the restore just moved the number/);
  const writer = bare.slice(bare.indexOf('async function writeFollow('), bare.indexOf('async function isFollowing('));
  assert.match(writer, /repaintFollowCounts\(\)/);
});
