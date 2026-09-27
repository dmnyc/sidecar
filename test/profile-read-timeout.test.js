'use strict';

// "NOT SET" MUST MEAN NOT SET.
//
// Reported in the wild: an account's NIP-05 and lightning address, set from another
// client, showed as "Not set" in the account overview. Two things in getProfile could
// produce that for an identity that was intact on the relays:
//
//   - It asked only the configured relay set. A profile edited elsewhere often lives
//     only on the relays the account DECLARED (its NIP-65 read list).
//   - When no relay answered inside the timeout it cached an empty profile for the full
//     five minutes, which the overview read as "this account has neither".
//
// The fix reads the user's own accounts from their declared relays (strangers keep the
// configured set: that path serves bookmark authors, reply targets and zap recipients),
// caches nothing when nobody answered, and holds an empty answer only briefly.

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

const OWN = 'a'.repeat(64);
const STRANGER = 'b'.repeat(64);

// The real cacheProfile / cachedProfile / getProfile, with the pool and relay lookups
// stubbed and the per-relay wait shrunk so the backstop fires in milliseconds.
function build({ answer, own = [OWN] }) {
  const calls = { configured: 0, declared: 0, queries: [] };
  const deps = {
    state: { accounts: own.map((pubkey) => ({ pubkey })) },
    relayUrls: async () => { calls.configured++; return ['wss://configured']; },
    readRelayUrls: async () => { calls.declared++; return ['wss://declared', 'wss://configured']; },
    poolGetProfile: (relays, pubkey, params) => { calls.queries.push({ relays, pubkey, params }); return answer(pubkey); },
  };
  const body = `
    const PROFILE_TTL = 5 * 60 * 1000;
    const PROFILE_MISS_TTL = 30 * 1000;
    const PROFILE_MAX_WAIT = 5;
    const PROFILE_TIMED_OUT = Symbol('profile-timeout');
    const _profileCache = new Map();
    const _profileInflight = new Map();
    ${lift('function cacheProfile(')}
    ${lift('function cachedProfile(')}
    ${lift('async function getProfile(')}
    return { getProfile, _profileCache };`;
  // eslint-disable-next-line no-new-func
  const mod = new Function(...Object.keys(deps), body)(...Object.values(deps));
  return Object.assign(mod, { calls });
}

const never = () => new Promise(() => {});

test('NOBODY ANSWERING IS NOT AN EMPTY PROFILE', async () => {
  const m = build({ answer: never });
  assert.equal(await m.getProfile(OWN), null, 'a timeout must come back as "couldn\'t load"');
  assert.equal(m._profileCache.has(OWN), false, 'and must not be cached as an absent profile');
  await m.getProfile(OWN);
  assert.equal(m.calls.queries.length, 2, 'the next open asks again');
});

test('an empty answer is held briefly, not for the full TTL', async () => {
  const m = build({ answer: async () => null });
  const rec = await m.getProfile(OWN);
  assert.deepEqual(rec.content, {});
  const ttl = rec.expiresAt - Date.now();
  assert.ok(ttl <= 30 * 1000 && ttl > 0, 'a miss expires on the short TTL, got ' + ttl);
});

test('a real profile is cached for the full TTL with its fields', async () => {
  const m = build({ answer: async (pk) => ({ pubkey: pk, content: '{"nip05":"d@x.com","lud16":"d@ln.com"}' }) });
  const rec = await m.getProfile(OWN);
  assert.equal(rec.content.nip05, 'd@x.com');
  assert.equal(rec.content.lud16, 'd@ln.com');
  assert.ok(rec.expiresAt - Date.now() > 30 * 1000);
});

test('THE USER\'S OWN ACCOUNT READS FROM ITS DECLARED RELAYS', async () => {
  const m = build({ answer: async () => null });
  await m.getProfile(OWN);
  assert.equal(m.calls.declared, 1);
  assert.equal(m.calls.configured, 0);
  assert.deepEqual(m.calls.queries[0].relays, ['wss://declared', 'wss://configured']);
});

test('a stranger keeps the configured set: no relay-list lookup per bookmark author', async () => {
  const m = build({ answer: async () => null });
  await m.getProfile(STRANGER);
  assert.equal(m.calls.declared, 0);
  assert.equal(m.calls.configured, 1);
});

test('each relay gets a bounded wait, so one slow relay cannot sink the read', async () => {
  const m = build({ answer: async () => null });
  await m.getProfile(OWN);
  assert.equal(m.calls.queries[0].params.maxWait, 5);
  // And in the source, the backstop sits beyond the per-relay wait, not inside it.
  assert.match(lift('async function getProfile('), /PROFILE_MAX_WAIT \* 2/);
  assert.match(bare, /const PROFILE_MISS_TTL = 30 \* 1000;/);
});
