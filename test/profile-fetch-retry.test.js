'use strict';

// Unit coverage for maybeFetchProfile()'s retry policy in sidepanel.js.
//
// The bug it fixes: the old version added the pubkey to an "attempted" Set BEFORE
// fetching, and never removed it on failure. So one transient miss — a relay timeout,
// three concurrent queries competing right after a vault import, a profile that hasn't
// propagated yet — permanently blocked that account's avatar for the rest of the panel
// session.
//
// It presented as a storage bug, and the giveaway was Daniel's observation that
// reloading the extension fixed it: a reload builds a fresh Set, so the fetch got a
// second chance it should have had without one.
//
// The policy has to hold two things at once:
//   - a FAILED fetch is retryable, or a cold relay permanently costs an avatar;
//   - a DEFINITIVE answer is not, or an account whose kind:0 genuinely has no picture
//     gets re-queried forever. fetchAndStoreProfile returns true for "answered" and
//     false for "ask again", which is what makes that distinction possible.
// And it must stay bounded: renderMain() runs on plenty of events, so unbounded
// retries would turn a burst of renders into a burst of relay queries.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

// `outcomes` is consumed one per call: true = settled, false = retryable.
// `nowRef.t` lets a test advance the clock past the cooldown.
function harness(outcomes, nowRef) {
  const calls = [];
  const ctx = {
    console,
    Date: { now: () => nowRef.t },
    // Stand in for the real fetch; records each call and returns the next outcome.
    fetchAndStoreProfile: async (pubkey) => {
      calls.push(pubkey);
      const v = outcomes.length ? outcomes.shift() : true;
      return v;
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/const profileFetchState = new Map\(\);[\s\S]*?const PROFILE_FETCH_COOLDOWN_MS = \d+;/, 'fetch state') + '\n' +
    lift(/function maybeFetchProfile\(pubkey\)\s*\{[\s\S]*?\n  \}/, 'maybeFetchProfile') + '\n' +
    'globalThis.maybeFetchProfile = maybeFetchProfile;' +
    'globalThis.profileFetchState = profileFetchState;' +
    'globalThis.MAX = PROFILE_FETCH_MAX_TRIES;' +
    'globalThis.COOLDOWN = PROFILE_FETCH_COOLDOWN_MS;',
    ctx
  );
  return { ctx, calls };
}

const PK = 'a'.repeat(64);
const flush = () => new Promise((r) => setImmediate(r));

test('a settled fetch is never repeated', async () => {
  const nowRef = { t: 1_000_000 };
  const { ctx, calls } = harness([true], nowRef);
  ctx.maybeFetchProfile(PK);
  await flush();
  nowRef.t += ctx.COOLDOWN * 10; // well past any cooldown
  ctx.maybeFetchProfile(PK);
  await flush();
  assert.equal(calls.length, 1, 'a definitive answer must not be re-queried');
});

// The actual bug.
test('a FAILED fetch is retried — this is what the old Set prevented', async () => {
  const nowRef = { t: 1_000_000 };
  const { ctx, calls } = harness([false, true], nowRef);
  ctx.maybeFetchProfile(PK);
  await flush();
  assert.equal(calls.length, 1);
  nowRef.t += ctx.COOLDOWN + 1;
  ctx.maybeFetchProfile(PK);
  await flush();
  assert.equal(calls.length, 2, 'a transient failure must get another chance');
  // ...and once it succeeds, it stops.
  nowRef.t += ctx.COOLDOWN + 1;
  ctx.maybeFetchProfile(PK);
  await flush();
  assert.equal(calls.length, 2, 'settled after the retry succeeded');
});

test('retries are capped, so a permanently dead relay cannot be hammered', async () => {
  const nowRef = { t: 1_000_000 };
  const { ctx, calls } = harness([false, false, false, false, false, false], nowRef);
  for (let i = 0; i < 6; i++) {
    nowRef.t += ctx.COOLDOWN + 1;
    ctx.maybeFetchProfile(PK);
    await flush();
  }
  assert.equal(calls.length, ctx.MAX, 'should stop at PROFILE_FETCH_MAX_TRIES, got ' + calls.length);
});

// renderMain() can fire several times in quick succession; without a cooldown each one
// would launch another relay query.
test('a burst of renders inside the cooldown produces ONE fetch', async () => {
  const nowRef = { t: 1_000_000 };
  const { ctx, calls } = harness([false, false, false], nowRef);
  for (let i = 0; i < 25; i++) {
    ctx.maybeFetchProfile(PK); // no clock advance — all inside the cooldown
    await flush();
  }
  assert.equal(calls.length, 1, '25 renders should not mean 25 relay queries');
});

test('the cooldown is respected precisely at its boundary', async () => {
  const nowRef = { t: 1_000_000 };
  const { ctx, calls } = harness([false, false, false], nowRef);
  ctx.maybeFetchProfile(PK);
  await flush();
  nowRef.t += ctx.COOLDOWN - 1;      // one ms short
  ctx.maybeFetchProfile(PK);
  await flush();
  assert.equal(calls.length, 1, 'must not retry before the cooldown elapses');
  nowRef.t += 2;                      // now past it
  ctx.maybeFetchProfile(PK);
  await flush();
  assert.equal(calls.length, 2);
});

test('accounts are tracked independently — one failing does not block another', async () => {
  const nowRef = { t: 1_000_000 };
  const PK2 = 'b'.repeat(64);
  const { ctx, calls } = harness([false, true], nowRef);
  ctx.maybeFetchProfile(PK);   // fails
  await flush();
  ctx.maybeFetchProfile(PK2);  // succeeds, same instant
  await flush();
  assert.deepEqual(calls, [PK, PK2], 'each pubkey has its own tries/cooldown');
});

// The Profile screen's refresh button deletes the entry; that must fully reset it,
// including a spent try budget.
test('clearing the entry restores a full retry budget', async () => {
  const nowRef = { t: 1_000_000 };
  const { ctx, calls } = harness([false, false, false, true], nowRef);
  for (let i = 0; i < 4; i++) {
    nowRef.t += ctx.COOLDOWN + 1;
    ctx.maybeFetchProfile(PK);
    await flush();
  }
  assert.equal(calls.length, ctx.MAX, 'budget spent');
  ctx.profileFetchState.delete(PK);   // what the refresh button does
  ctx.maybeFetchProfile(PK);
  await flush();
  assert.equal(calls.length, ctx.MAX + 1, 'refresh must get a fresh attempt');
});
