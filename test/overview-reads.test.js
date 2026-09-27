'use strict';

// The rest of the account overview's reads, held to the rule #378 set for the profile:
// "nobody answered" is never a claim about the account.
//
//   getFollowCount       showed 0 for an account following hundreds whenever its relays
//                        were slow or the panel was offline, and cached the 0.
//   fetchAndStoreProfile read the configured relays for your own account's name and
//                        picture, ignoring NIP-65 only and missing a profile that lived
//                        only on the relays the account declared.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const bare = src.replace(/^\s*\/\/.*$/gm, '');

function lift(decl) {
  const at = bare.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = bare.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < bare.length; j++) {
    if (bare[j] === '{') depth++;
    else if (bare[j] === '}' && --depth === 0) return bare.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

const PK = 'a'.repeat(64);
const pk = (c) => c.repeat(64);
const follows = (n, author = PK) => ({
  pubkey: author,
  created_at: 1,
  tags: Array.from({ length: n }, (_, i) => ['p', String(i).padStart(64, '0')]),
});

// ---- getFollowCount ----------------------------------------------------------------

function followHarness(answer) {
  const calls = { queries: 0, seeded: 0 };
  const deps = {
    followCountCache: new Map(),
    readRelayUrls: async () => ['wss://declared'],
    poolQueryAnswered: async (relays, filter, params) => { calls.queries++; calls.last = { relays, filter, params }; return answer(); },
    seedBaseline: () => { calls.seeded++; },
  };
  // eslint-disable-next-line no-new-func
  const getFollowCount = new Function(...Object.keys(deps), `${lift('async function getFollowCount(')}; return getFollowCount;`)(...Object.values(deps));
  return { getFollowCount, cache: deps.followCountCache, calls };
}

test('NOBODY ANSWERING IS NOT "FOLLOWS NOBODY"', async () => {
  const h = followHarness(() => ({ events: [], answered: false }));
  assert.equal(await h.getFollowCount(PK), null, 'drawn as a dash, not 0');
  assert.equal(h.cache.has(PK), false, 'and not cached for the session');
  await h.getFollowCount(PK);
  assert.equal(h.calls.queries, 2, 'the next open asks again');
});

test('relays that answered with no kind:3 is a real 0, and is cached', async () => {
  const h = followHarness(() => ({ events: [], answered: true }));
  assert.equal(await h.getFollowCount(PK), 0);
  assert.equal(h.cache.get(PK), 0);
});

test('a follow list is counted by distinct people', async () => {
  const ev = follows(3);
  ev.tags.push(ev.tags[0]); // a duplicate p-tag is one person
  const h = followHarness(() => ({ events: [ev], answered: true }));
  assert.equal(await h.getFollowCount(PK), 3);
  assert.equal(h.calls.seeded, 1, 'still seeds the overwrite baseline');
});

test('a follow list signed by someone else is not this account\'s', async () => {
  const h = followHarness(() => ({ events: [follows(500, pk('m'))], answered: true }));
  assert.equal(await h.getFollowCount(PK), 0);
});

test('the newest of the account\'s own lists wins', async () => {
  const older = { ...follows(9), created_at: 1 };
  const newer = { ...follows(4), created_at: 2 };
  const h = followHarness(() => ({ events: [newer, older], answered: true }));
  assert.equal(await h.getFollowCount(PK), 4);
});

test('the count still reads the account\'s own relays, one event per relay', async () => {
  const h = followHarness(() => ({ events: [], answered: true }));
  await h.getFollowCount(PK);
  assert.deepEqual(h.calls.last.relays, ['wss://declared']);
  assert.deepEqual(h.calls.last.filter, { kinds: [3], authors: [PK], limit: 1 });
  assert.equal(h.calls.last.params.maxWait, 8000);
});

// ---- fetchAndStoreProfile --------------------------------------------------------------

test('THE ACCOUNT ROW READS THE ACCOUNT\'S OWN RELAYS, NOT THE CONFIGURED SET', async () => {
  const asked = [];
  const deps = {
    readRelayUrls: async (who) => { asked.push(who); return ['wss://declared', 'wss://purplepag.es']; },
    poolGetProfile: async (relays) => { deps.poolGetProfile.relays = relays; return null; },
    seedBaseline: () => {},
    call: async (msg) => { throw new Error('unexpected ' + msg.type); },
    renderMain: () => {},
    state: {},
  };
  // eslint-disable-next-line no-new-func
  const fetchAndStoreProfile = new Function(...Object.keys(deps), `${lift('async function fetchAndStoreProfile(')}; return fetchAndStoreProfile;`)(...Object.values(deps));
  assert.equal(await fetchAndStoreProfile(PK), false, 'no event is still retryable');
  assert.deepEqual(asked, [PK], 'the relay set is resolved for this account');
  assert.deepEqual(deps.poolGetProfile.relays, ['wss://declared', 'wss://purplepag.es'],
    'readRelayUrls decides, so NIP-65 only drops the configured set here as it does for the overview');
});

test('and it no longer asks for the global relay map at all', () => {
  assert.doesNotMatch(lift('async function fetchAndStoreProfile('), /SIDECAR_GET_RELAYS/);
});

// ---- getting back what failed ---------------------------------------------------------
//
// Offline, the rows say "Couldn't load" and Following shows a dash, and nothing is cached.
// That is only half the fix if nothing ever asks again: in the browser, Wi-Fi came back
// and Following sat on its dash until the panel was reopened.

test('the retry tap retries everything that failed, Following included', () => {
  const retry = lift('function retryLink(');
  assert.match(retry, /addEventListener\('click', retryFailed\)/, 'not just the identity rows');
  const fn = lift('function retryFailed(');
  assert.match(fn, /if \(identityFailed\) loadIdentity\(\);/);
  assert.match(fn, /if \(followsFailed\) loadFollows\(\);/);
});

test('each loader records whether it failed, from its own answer', () => {
  assert.match(lift('async function loadIdentity('), /identityFailed = !rec;/);
  assert.match(lift('function loadFollows('), /followsFailed = n == null;/);
});

test('THE NETWORK COMING BACK RETRIES WITHOUT A TAP', () => {
  assert.match(lift('async function loadStats('), /overviewOnline = \(\) => \{ if \(drawer\.isConnected\) retryFailed\(\); \};/);
});

test('one online listener for the panel, not one per render', () => {
  // The drawer is rebuilt on every renderMain. A listener per build would pile up
  // closures over detached drawers; a slot holds only the one on screen.
  const listeners = bare.match(/addEventListener\('online'/g) || [];
  assert.equal(listeners.length, 1);
  assert.match(bare, /window\.addEventListener\('online', \(\) => \{ if \(overviewOnline\) overviewOnline\(\); \}\);/);
});
