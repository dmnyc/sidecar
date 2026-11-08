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

// The live-update tick, lifted with its guard variable and driven by injected
// stubs — the real one runs on a five-minute interval in the panel.
function tickHarness({ visibility = 'visible', cache, getFollowCount, activePubkey = PK } = {}) {
  const repaints = [];
  const asked = [];
  const read = getFollowCount || ((pk) => { asked.push(pk); return Promise.resolve(0); });
  const chunk = lift(/let followRefreshInFlight = false;[\s\S]*?setInterval\(refreshStaleFollowCounts, 60 \* 1000\);/, 'the live-update tick')
    .replace('setInterval(refreshStaleFollowCounts, 60 * 1000);', '')
    .replace('let followRefreshInFlight = false;', '');
  const deps = {
    isDevBuild: () => false,
    followRefreshInFlight: false,
    document: { visibilityState: visibility },
    state: { activePubkey },
    followCountCache: cache,
    FOLLOW_COUNT_TTL: 5 * 60 * 1000,
    getFollowCount: read,
    repaintFollowCounts: () => repaints.push('repaint'),
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function(...Object.keys(deps), chunk + '; return refreshStaleFollowCounts;')(...Object.values(deps));
  return { tick: fn, repaints, asked, cache };
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

// ---- live update -------------------------------------------------------------

test('THE LIVE TICK RE-READS ONLY STALE ENTRIES AND REPAINTS', async () => {
  const cache = new Map();
  cache.set(PK, { v: 3, at: Date.now() - 6 * 60 * 1000 });            // stale
  cache.set('f'.repeat(64), { v: 9, at: Date.now() });                // fresh
  const asked = [];
  // Emulates the real reader's contract: answers AND lands fresh in the cache.
  const w = tickHarness({ cache, getFollowCount: (pk) => { asked.push(pk); cache.set(pk, { v: 7, at: Date.now() }); return Promise.resolve(7); } });
  w.tick();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(asked, [PK], 'only the stale account re-queries');
  assert.equal(w.repaints.length, 1, 'the figures repaint with the new numbers');
  assert.equal(w.cache.get(PK).v, 7, 'the re-read landed fresh');
  w.tick(); // now everything is fresh
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(asked, [PK], 'a second tick with nothing stale asks nobody');
});

test('A HIDDEN PANEL DOES NO RELAY CHATTER', async () => {
  const cache = new Map();
  cache.set(PK, { v: 3, at: Date.now() - 6 * 60 * 1000 });
  const asked = [];
  const w = tickHarness({ visibility: 'hidden', cache, getFollowCount: (pk) => { asked.push(pk); return Promise.resolve(3); } });
  w.tick();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(asked, []);
  assert.equal(w.repaints.length, 0);
});

test('AN EMPTY CACHE QUERIES NOTHING AND REPAINTS NOTHING', () => {
  const w = tickHarness({ cache: new Map(), getFollowCount: () => Promise.resolve(1) });
  w.tick();
  assert.equal(w.repaints.length, 0);
});

test('ONE CYCLE NEVER OVERLAPS THE LAST', async () => {
  const cache = new Map();
  cache.set(PK, { v: 3, at: Date.now() - 6 * 60 * 1000 });
  let release;
  const gate = new Promise((r) => { release = r; });
  const w = tickHarness({ cache, getFollowCount: () => { w.asked.push(PK); return gate; } });
  w.tick();
  w.tick(); // the first cycle is still waiting on its read
  release();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(w.asked, [PK], 'the overlapping tick was skipped');
});

// ---- the Profile tab's refresh handler, run for real --------------------------
//
// The handler is inline in renderProfile, so the arrow function is sliced out of the
// source by its anchor and run against stubs. `muted` is what paintMuteCount hands
// back: the real one is async and settles on its own relay read.
function profileRefreshHarness({ followRead, muteRead } = {}) {
  const anchor = bare.indexOf("const refreshBtn = h('button', { className: 'profile-backup-jump'");
  if (anchor === -1) throw new Error('Could not find the Profile refresh button');
  const fnAt = bare.indexOf('async () => {', bare.indexOf("refreshBtn.addEventListener('click'", anchor));
  const open = bare.indexOf('{', fnAt);
  let depth = 0, end = -1;
  for (let j = open; j < bare.length; j++) {
    if (bare[j] === '{') depth++;
    else if (bare[j] === '}' && --depth === 0) { end = j + 1; break; }
  }
  const fnSrc = bare.slice(fnAt, end);
  const cls = new Set();
  const btn = { disabled: false, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) } };
  const painted = [];
  const deps = {
    refreshBtn: btn,
    active: { pubkey: PK },
    followCountCache: new Map([[PK, { v: 5, at: Date.now() }]]),
    _muteListPromises: new Map([[PK, Promise.resolve()]]),
    getFollowCount: followRead || (async () => 7),
    paintMuteCount: () => { painted.push('mute'); return (muteRead || (async () => {}))(); },
    setWaiting: (el, text) => { el.text = text; return el; },
    I18N: { fmtNum: String },
    followNum: {}, muteNum: {}, muteStat: {},
    toast: () => {}, t: (s) => s,
  };
  // eslint-disable-next-line no-new-func
  const handler = new Function(...Object.keys(deps), `return (${fnSrc});`)(...Object.values(deps));
  return { handler, btn, cls, deps, painted };
}

test('THE PROFILE REFRESH IS NOT DONE UNTIL THE MUTE FIGURE IS', async () => {
  // paintMuteCount used to be fired and forgotten: the spinner stopped and the button
  // re-armed while the muted figure was still sweeping, and a second press started a
  // second mute read racing the first.
  let release;
  const gate = new Promise((r) => { release = r; });
  const w = profileRefreshHarness({ muteRead: () => gate });
  const done = w.handler();
  await new Promise((r) => setImmediate(r));
  assert.equal(w.deps.followNum.text, '7', 'the follow figure has landed');
  assert.equal(w.btn.disabled, true, 'the button stays disabled while the mute read is out');
  assert.ok(w.cls.has('spinning'), 'and the spinner keeps turning');
  await w.handler(); // a second press now is ignored
  assert.deepEqual(w.painted, ['mute'], 'no second mute read starts');
  release();
  await done;
  assert.equal(w.btn.disabled, false);
  assert.ok(!w.cls.has('spinning'));
});

test('THE PROFILE REFRESH RE-ARMS EVEN WHEN A READ THROWS', async () => {
  const w = profileRefreshHarness({ muteRead: async () => { throw new Error('boom'); } });
  await w.handler();
  assert.equal(w.btn.disabled, false);
  assert.ok(!w.cls.has('spinning'));
});

test('THE LIVE TICK POLLS ONLY THE ACTIVE ACCOUNT', async () => {
  // A cached entry for an account that is no longer on screen — switched away from, or
  // removed — would otherwise be re-read every cycle for as long as the panel is open.
  const cache = new Map();
  cache.set(PK, { v: 3, at: Date.now() - 6 * 60 * 1000 });
  cache.set('e'.repeat(64), { v: 8, at: Date.now() - 6 * 60 * 1000 });
  const asked = [];
  const w = tickHarness({ cache, getFollowCount: (pk) => { asked.push(pk); cache.set(pk, { v: 4, at: Date.now() }); return Promise.resolve(4); } });
  w.tick();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(asked, [PK], 'the other account is left alone');
});
