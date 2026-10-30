'use strict';

// THE GENERIC NAME THAT OUTLIVED ITS WELCOME.
//
// Pasting an nsec into a cold install showed the real name and picture in the import
// modal's preview (the shared kind:0 cache, read the fast way), and then the account
// sat on its placeholder for another six to twenty seconds while the backfill
// refetched everything the slow way: the NIP-65 list first, then kind:0, each a
// six-second window on a pool still opening its sockets, and a fifteen-second
// cooldown before the retry. The answer was in memory when Import was clicked.
//
// The fix is one rule plus its wiring: a COMPLETE cached profile, name and picture
// both, is stored the moment the backfill runs. Half a profile and a confirmed miss
// walk the full path exactly as before. The wide read still runs even on a hit,
// because it seeds the kind:0 baseline the overwrite guard reads and may find a
// fresher copy on the declared relays.
//
// The rule is lifted and run; the wiring is held against the source and run through
// the same harness overview-reads.test.js uses for this function.

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

// ---- the rule, lifted and run ---------------------------------------------------

const ctx = { console, Date, Math, Number, Set, Map, Array };
vm.createContext(ctx);
vm.runInContext(
  'const _profileCache = new Map();\n' +
  lift(/const PROFILE_TTL = [^;]*;/, 'PROFILE_TTL') + '\n' +
  lift(/function cacheProfile\(pubkey, content\)\s*\{[\s\S]*?\n  \}/, 'cacheProfile') + '\n' +
  lift(/function cachedProfile\(pubkey\)\s*\{[\s\S]*?\n  \}/, 'cachedProfile') + '\n' +
  lift(/function cachedCompleteProfile\(pubkey\)\s*\{[\s\S]*?\n  \}/, 'cachedCompleteProfile') + '\n' +
  'globalThis.cacheProfile = cacheProfile;' +
  'globalThis._profileCache = _profileCache;' +
  'globalThis.cachedCompleteProfile = cachedCompleteProfile;',
  ctx
);
const { cacheProfile, _profileCache, cachedCompleteProfile } = ctx;

const NAME = 'Felix the Curator';
const PIC = 'https://example.test/felix.png';

test('A COMPLETE CACHED PROFILE IS A SHORTCUT, CASE BY CASE', () => {
  cacheProfile('pk', { name: NAME, picture: PIC });
  const hit = cachedCompleteProfile('pk');
  assert.deepEqual({ name: hit.name, picture: hit.picture }, { name: NAME, picture: PIC },
    'the preview answer, second-hand');

  cacheProfile('named', { name: NAME });
  assert.equal(cachedCompleteProfile('named'), null, 'a name with no picture is not a shortcut');
  cacheProfile('pictured', { picture: PIC });
  assert.equal(cachedCompleteProfile('pictured'), null, 'a picture with no name is not a shortcut');
  cacheProfile('miss', {});
  assert.equal(cachedCompleteProfile('miss'), null, 'a confirmed miss is not a shortcut');

  cacheProfile('old', { name: NAME, picture: PIC });
  _profileCache.get('old').expiresAt = Date.now() - 1;
  assert.equal(cachedCompleteProfile('old'), null, 'neither is an expired one');
});

// ---- the wiring, against the source and through the harness ----------------------

const bare = source.replace(/^\s*\/\/.*$/gm, '');

function liftFn(decl) {
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

function harness(cached = {}) {
  const seen = { stored: [], asked: [], rendered: 0 };
  const deps = {
    cachedProfile: (pk) => (Object.prototype.hasOwnProperty.call(cached, pk)
      ? { name: cached[pk].name || '', picture: cached[pk].picture || '', expiresAt: Date.now() + 1000 }
      : null),
    readRelayUrls: async (who) => { seen.asked.push(who); return ['wss://declared']; },
    poolGetProfile: async () => null, // the wide read finds nothing; the chain is what matters
    seedBaseline: () => {},
    call: async (msg) => {
      if (msg.type === 'SIDECAR_SET_PROFILE') seen.stored.push(msg);
      else if (msg.type === 'SIDECAR_GET_STATE') return { locked: false };
      else throw new Error('unexpected ' + msg.type);
    },
    renderMain: () => { seen.rendered++; },
    state: {},
  };
  // eslint-disable-next-line no-new-func
  const fetchAndStoreProfile = new Function(...Object.keys(deps),
    `${liftFn('function cachedCompleteProfile(')}\n${liftFn('async function fetchAndStoreProfile(')}; return fetchAndStoreProfile;`
  )(...Object.values(deps));
  return { fetchAndStoreProfile, seen };
}

test('THE PREVIEW ANSWER IS STORED BEFORE THE RELAYS ARE ASKED', async () => {
  const h = harness({ [PK]: { name: NAME, picture: PIC } });
  assert.equal(await h.fetchAndStoreProfile(PK), false,
    'the wide read still answers for itself, miss included');
  assert.deepEqual(h.seen.stored, [{ type: 'SIDECAR_SET_PROFILE', pubkey: PK, name: NAME, picture: PIC }]);
  assert.deepEqual(h.seen.asked, [PK], 'and the read still runs, for the baseline it seeds');
  assert.equal(h.seen.rendered, 1, 'the row repaints with the real name');
});

test('HALF A PROFILE TAKES THE SLOW ROAD', async () => {
  const h = harness({ [PK]: { name: NAME } });
  assert.equal(await h.fetchAndStoreProfile(PK), false);
  assert.deepEqual(h.seen.stored, [], 'nothing settled from half an answer');
  assert.deepEqual(h.seen.asked, [PK], 'the full path ran');
  assert.equal(h.seen.rendered, 0);
});

test('THE SHORTCUT SITS AHEAD OF THE CHAIN, WHICH IS WHOLE BEHIND IT', () => {
  const fn = liftFn('async function fetchAndStoreProfile(');
  const shortcut = fn.indexOf('cachedCompleteProfile(pubkey)');
  const relays = fn.indexOf('readRelayUrls(pubkey)');
  assert.ok(shortcut > -1 && relays > -1 && shortcut < relays, 'cache first, relays second');
  assert.match(fn, /seedBaseline\(pubkey, ev\)/, 'the kind:0 baseline still gets seeded');
  assert.match(fn, /poolGetProfile\(relays, pubkey\)/, 'the wide read is unchanged');
});
