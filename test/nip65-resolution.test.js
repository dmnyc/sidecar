'use strict';

// Unit coverage for the NIP-65 lookup's three-way answer: published, absent, or
// unknown-because-the-relays-did-not-answer.
//
// The bug this pins down: getNip65 raced the lookup against a 6s timeout and returned
// plain `null` for BOTH "this account has published no relay list" and "the relays never
// replied". Two callers then did the wrong thing with that null, and both failures were
// silent:
//
//   * postRelays, in NIP-65-only mode, returned an EMPTY publish list. The note went
//     nowhere and the user was told "No relays configured (add some in Settings)" —
//     advice that is wrong twice over, since the relays were configured and it was the
//     lookup that failed.
//
//   * loadNip65Editor fell through to the app's GLOBAL configured relay map (one setting
//     shared by every account) and labeled it "Loaded from your current relay list." One
//     click of Publish would then have signed those defaults over a real, published
//     kind:10002 — a replaceable event, so the real list is simply gone.
//
// The distinction already existed inside the function as `gotEvent`; it was discarded at
// the return. These tests exist so it cannot be discarded again.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

// Brace-matched rather than regex-terminated: several of these functions contain nested
// blocks that a non-greedy /\n  \}/ would stop at, lifting half a function that still
// parses and quietly tests nothing.
function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl + ' in sidepanel.js');
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

function liftLine(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

// deps.event      the kind:10002 the pool returns, or null for "answered, nothing there"
// deps.timeout    true = the pool never resolves, so the 6s race wins
// deps.stored     what is already in chrome.storage.local under sidecar_nip65
// deps.only       nip65-only mode for the active account
// deps.configured the global relay map behind SIDECAR_GET_RELAYS
function harness(deps = {}) {
  const store = deps.stored ? { sidecar_nip65: deps.stored } : {};
  const ctx = {
    console,
    Date,
    Promise,
    Array,
    Set,
    Map,
    Error,
    Symbol,
    // structuredClone on both sides, or the mock hands back a live reference and a
    // dropped write still looks like it landed.
    chrome: {
      runtime: {},
      storage: {
        local: {
          get: (key, cb) => cb(structuredClone(store[key] !== undefined ? { [key]: store[key] } : {})),
          set: (obj, cb) => {
            Object.assign(store, structuredClone(obj));
            cb();
          },
        },
      },
    },
    // The 6s race is real time in the source, so a "timeout" here is a promise that
    // simply never settles; setTimeout is left as the host's.
    setTimeout,
    poolGet: () => (deps.timeout ? new Promise(() => {}) : Promise.resolve(deps.event || null)),
    relayUrls: async (writableOnly) => (writableOnly ? ['wss://configured-write'] : ['wss://configured']),
    nip65OnlyFor: async () => !!deps.only,
    call: async (msg) => {
      if (msg.type === 'SIDECAR_GET_RELAYS') {
        return deps.configured || { 'wss://configured': { read: true, write: true } };
      }
      throw new Error('unexpected ' + msg.type);
    },
    state: { activePubkey: 'a'.repeat(64) },
  };
  vm.createContext(ctx);
  vm.runInContext(
    [
      liftLine(/const NIP65_STORE = '[^']*';/, 'NIP65_STORE'),
      liftLine(/const NIP65_TIMED_OUT = Symbol\([^)]*\);/, 'NIP65_TIMED_OUT'),
      liftLine(/const nip65Cache = new Map\(\);[^\n]*/, 'nip65Cache'),
      lift('async function loadNip65Store('),
      liftLine(/let nip65Writes = Promise\.resolve\(\);/, 'nip65Writes'),
      lift('function rememberNip65('),
      lift('async function recallNip65('),
      lift('function forgetNip65('),
      lift('async function getNip65Info('),
      lift('async function getNip65('),
      lift('class RelayListUnavailable'),
      lift('async function postRelays('),
      lift('async function loadNip65Editor('),
      'globalThis.getNip65Info = getNip65Info;',
      'globalThis.getNip65 = getNip65;',
      'globalThis.postRelays = postRelays;',
      'globalThis.loadNip65Editor = loadNip65Editor;',
      'globalThis.recallNip65 = recallNip65;',
      'globalThis.forgetNip65 = forgetNip65;',
      'globalThis.__store = () => store;',
    ].join('\n'),
    ctx
  );
  ctx.__rawStore = store;
  return ctx;
}

const PK = 'a'.repeat(64);
const listEvent = {
  pubkey: PK,
  created_at: 1,
  tags: [
    ['r', 'wss://declared-both'],
    ['r', 'wss://declared-read', 'read'],
    ['r', 'wss://declared-write', 'write'],
  ],
};
const REMEMBERED = { read: ['wss://old-read'], write: ['wss://old-write'], at: 123 };

// ---- the three-way answer ------------------------------------------------------

test('a relay list that comes back is resolved and not stale', async () => {
  const ctx = harness({ event: listEvent });
  const info = await ctx.getNip65Info(PK);
  assert.equal(info.resolved, true);
  assert.equal(info.stale, false);
  assert.deepEqual([...info.list.write], ['wss://declared-both', 'wss://declared-write']);
});

test('relays that answer with nothing is resolved — the account has no list', async () => {
  const ctx = harness({ event: null });
  const info = await ctx.getNip65Info(PK);
  assert.equal(info.resolved, true, 'an answer of "none" is still an answer');
  assert.equal(info.list, null);
});

test('a lookup that times out is NOT resolved', async () => {
  const ctx = harness({ timeout: true });
  const info = await ctx.getNip65Info(PK);
  assert.equal(info.resolved, false, 'the whole point: a timeout is not evidence of absence');
});

test('a timeout falls back to the last list we genuinely saw, flagged stale', async () => {
  const ctx = harness({ timeout: true, stored: { [PK]: REMEMBERED } });
  const info = await ctx.getNip65Info(PK);
  assert.equal(info.resolved, false);
  assert.equal(info.stale, true);
  assert.deepEqual([...info.list.write], ['wss://old-write']);
});

test('a successful lookup is remembered for the next failure', async () => {
  const ctx = harness({ event: listEvent });
  await ctx.getNip65Info(PK);
  const kept = await ctx.recallNip65(PK);
  assert.deepEqual([...kept.write], ['wss://declared-both', 'wss://declared-write']);
});

test('a remembered list belonging to another account is never served for this one', async () => {
  const ctx = harness({ timeout: true, stored: { ['b'.repeat(64)]: REMEMBERED } });
  const info = await ctx.getNip65Info(PK);
  assert.equal(info.list, null, 'the store is keyed per pubkey');
  assert.equal(info.stale, false);
});

// ---- postRelays: the failure that lost notes -----------------------------------

test('nip65-only with an unresolved lookup and nothing remembered refuses to publish', async () => {
  const ctx = harness({ timeout: true, only: true });
  await assert.rejects(() => ctx.postRelays(), /Could not load your relay list/);
});

test('the refusal never resolves to an empty relay list', async () => {
  const ctx = harness({ timeout: true, only: true });
  const targets = await ctx.postRelays().catch(() => 'threw');
  assert.equal(targets, 'threw', 'returning [] is what published notes into the void');
});

test('nip65-only with a remembered list publishes to the declared relays', async () => {
  const ctx = harness({ timeout: true, only: true, stored: { [PK]: REMEMBERED } });
  assert.deepEqual([...(await ctx.postRelays())], ['wss://old-write']);
});

test('nip65-only never falls back to the relays the account opted out of', async () => {
  const ctx = harness({ timeout: true, only: true, stored: { [PK]: REMEMBERED } });
  const targets = await ctx.postRelays();
  assert.ok(!targets.includes('wss://configured-write'), 'that would break the setting silently');
});

test('without nip65-only a fresh account still publishes to configured relays', async () => {
  const ctx = harness({ event: null });
  assert.deepEqual([...(await ctx.postRelays())], ['wss://configured-write']);
});

test('without nip65-only the declared and configured sets are unioned', async () => {
  const ctx = harness({ event: listEvent });
  const targets = await ctx.postRelays();
  assert.deepEqual([...targets], ['wss://declared-both', 'wss://declared-write', 'wss://configured-write']);
});

// ---- the editor: the failure that could overwrite a real list -------------------

test('a published list is labeled published', async () => {
  const ctx = harness({ event: listEvent });
  const res = await ctx.loadNip65Editor(PK);
  assert.equal(res.state, 'published');
  assert.equal(res.relays.length, 3);
});

test('an unresolved lookup with nothing remembered yields no relays at all', async () => {
  const ctx = harness({ timeout: true });
  const res = await ctx.loadNip65Editor(PK);
  assert.equal(res.state, 'unknown');
  assert.deepEqual([...res.relays], [], 'pre-filling here is what let defaults overwrite a real list');
});

test('an unresolved lookup never shows the global configured map', async () => {
  const ctx = harness({
    timeout: true,
    configured: { 'wss://someone-elses': { read: true, write: true } },
  });
  const res = await ctx.loadNip65Editor(PK);
  assert.ok(
    !res.relays.some((r) => r.url === 'wss://someone-elses'),
    'sidecar_relays is one global setting, not this account'
  );
});

test('a remembered list is offered but marked as remembered', async () => {
  const ctx = harness({ timeout: true, stored: { [PK]: REMEMBERED } });
  const res = await ctx.loadNip65Editor(PK);
  assert.equal(res.state, 'remembered');
  assert.equal(res.relays.length, 2);
});

test('a genuinely unpublished account is seeded from configured relays, and says so', async () => {
  const ctx = harness({ event: null });
  const res = await ctx.loadNip65Editor(PK);
  assert.equal(res.state, 'none', 'there is no list to overwrite, so seeding is safe here');
  assert.equal(res.relays[0].url, 'wss://configured');
});

test('read and write markers survive the round trip into editor rows', async () => {
  const ctx = harness({ event: listEvent });
  const res = await ctx.loadNip65Editor(PK);
  const byUrl = Object.fromEntries(res.relays.map((r) => [r.url, r]));
  assert.deepEqual(
    [byUrl['wss://declared-read'].read, byUrl['wss://declared-read'].write],
    [true, false]
  );
  assert.deepEqual(
    [byUrl['wss://declared-both'].read, byUrl['wss://declared-both'].write],
    [true, true]
  );
});

test('retrying drops the remembered list so the next load is a real lookup', async () => {
  const ctx = harness({ timeout: true, stored: { [PK]: REMEMBERED } });
  assert.notEqual(await ctx.recallNip65(PK), null);
  await ctx.forgetNip65(PK);
  assert.equal(await ctx.recallNip65(PK), null);
});

// ---- the lookup sweep: where a fresh session is allowed to ask ------------------
//
// A cold cache plus an account whose kind:10002 lives only outside the configured set
// was unreachable: the lookup never asked anywhere it had not been told to. The relays
// remembered from an earlier session (read AND write: lists get PUBLISHED to write
// relays) now get a lookup of their own.
//
// Its OWN lookup, not a merged relay set. get() waits for every relay it asked, so one
// remembered relay that hangs would push a merged query past the 6s race; a timeout is
// never cached, so every later call would sit out the full six seconds all session.

// A pool that answers per relay set: `byFirst` maps the first relay of a query to what
// that query returns ('hang' for a promise that never settles).
function sweep(ctx, byFirst) {
  const seen = [];
  ctx.poolGet = async (relays) => {
    seen.push([...relays]);
    const r = byFirst[relays[0]];
    return r === 'hang' ? new Promise(() => {}) : (r || null);
  };
  return seen;
}

const newer = { ...listEvent, created_at: 2, tags: [['r', 'wss://newer']] };

test('a fresh session sweeps the relays it remembered, read AND write, as a SEPARATE lookup', async () => {
  const ctx = harness({ stored: { [PK]: REMEMBERED } });
  const seen = sweep(ctx, {});
  await ctx.getNip65Info(PK);
  assert.deepEqual(seen, [['wss://configured'], ['wss://old-read', 'wss://old-write']]);
});

test('with nothing remembered the sweep is the configured set alone', async () => {
  const ctx = harness();
  const seen = sweep(ctx, {});
  await ctx.getNip65Info(PK);
  assert.deepEqual(seen, [['wss://configured']]);
});

test('another account\'s remembered list stays out of this lookup', async () => {
  const ctx = harness({ stored: { ['b'.repeat(64)]: REMEMBERED } });
  const seen = sweep(ctx, {});
  await ctx.getNip65Info(PK);
  assert.deepEqual(seen, [['wss://configured']]);
});

test('a remembered relay that is also configured is asked once, in the configured half', async () => {
  const ctx = harness({ stored: { [PK]: { read: ['wss://configured'], write: ['wss://old-write'], at: 1 } } });
  const seen = sweep(ctx, {});
  await ctx.getNip65Info(PK);
  assert.deepEqual(seen, [['wss://configured'], ['wss://old-write']]);
});

test('A HANGING REMEMBERED RELAY CANNOT SINK A LOOKUP THE CONFIGURED SET ANSWERED', async () => {
  // The regression a merged relay set would cause: configured answers, a remembered
  // relay hangs, and the whole lookup times out. Split, the configured answer stands
  // (after the remembered half's own timeout) and is cached for the session.
  const ctx = harness({ stored: { [PK]: REMEMBERED } });
  sweep(ctx, { 'wss://configured': listEvent, 'wss://old-read': 'hang' });
  const info = await ctx.getNip65Info(PK);
  assert.equal(info.resolved, true);
  assert.equal(info.stale, false);
  assert.deepEqual([...info.list.read], ['wss://declared-both', 'wss://declared-read']);
  const again = await ctx.getNip65Info(PK);
  assert.equal(again.resolved, true, 'cached: the next call does not wait again');
});

test('a list findable ONLY on the remembered relays is found', async () => {
  const ctx = harness({ stored: { [PK]: REMEMBERED } });
  sweep(ctx, { 'wss://configured': 'hang', 'wss://old-read': listEvent });
  const info = await ctx.getNip65Info(PK);
  assert.equal(info.resolved, true);
  assert.deepEqual([...info.list.write], ['wss://declared-both', 'wss://declared-write']);
});

test('when both halves answer, the newer list wins', async () => {
  for (const [c, r] of [[listEvent, newer], [newer, listEvent]]) {
    const ctx = harness({ stored: { [PK]: REMEMBERED } });
    sweep(ctx, { 'wss://configured': c, 'wss://old-read': r });
    const info = await ctx.getNip65Info(PK);
    assert.deepEqual([...info.list.read], ['wss://newer']);
  }
});

test('the remembered half can add a list but never declare "no list"', async () => {
  // Configured hangs, remembered answers empty: that is not evidence the account has no
  // list (its old relays may simply have dropped it), so the answer stays unresolved and
  // falls back to the remembered list.
  const ctx = harness({ stored: { [PK]: REMEMBERED } });
  sweep(ctx, { 'wss://configured': 'hang', 'wss://old-read': null });
  const info = await ctx.getNip65Info(PK);
  assert.equal(info.resolved, false);
  assert.equal(info.stale, true);
  assert.deepEqual([...info.list.read], ['wss://old-read']);
});

// ---- the source guards ---------------------------------------------------------

// Comment stripping, line-based ON PURPOSE.
//
// The obvious /\/\*[\s\S]*?\*\// sweep is unusable against this file: a comment on
// sidepanel.js:7727 mentions the host permission "(https://*/*)", whose "/*" opens a
// block comment that then runs to the next "*/" 160k characters later. More than half
// the source vanishes and every doesNotMatch below passes vacuously.
//
// Dropping whole-line comments is enough here — the prose that trips these guards is
// always on its own line — and it cannot eat code.
function stripComments(src) {
  return src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join('\n');
}

const body = stripComments(source);

test('the editor no longer claims a fallback is your current relay list', () => {
  assert.doesNotMatch(
    body,
    /Loaded from your current relay list/,
    'that wording covered both a real list and a failed lookup'
  );
});

test('postRelays reads the resolved flag rather than a bare list', () => {
  const fn = lift('async function postRelays(');
  assert.match(fn, /getNip65Info\(/);
  assert.match(fn, /info\.resolved/);
});

test('loadNip65Editor only reaches for the global relay map once a lookup succeeded', () => {
  const fn = lift('async function loadNip65Editor(');
  const guard = fn.indexOf('if (!info.resolved)');
  const fallback = fn.indexOf('SIDECAR_GET_RELAYS');
  assert.ok(guard !== -1 && guard < fallback, 'the unresolved bail must come first');
});

// ---- the write race ------------------------------------------------------------

test('two accounts resolving at once do not clobber each other in the store', async () => {
  // Switching accounts while the first lookup is still in flight lands both writes on
  // the same shared object. Unserialized, both read the same snapshot and the second
  // set() silently drops the first account's entry.
  const ctx = harness({ event: listEvent });
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  await Promise.all([ctx.getNip65Info(A), ctx.getNip65Info(B)]);
  assert.notEqual(await ctx.recallNip65(A), null, 'account A was dropped by account B');
  assert.notEqual(await ctx.recallNip65(B), null, 'account B was dropped by account A');
});
