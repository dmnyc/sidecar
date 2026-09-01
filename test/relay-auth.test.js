'use strict';

// Unit coverage for NIP-42 relay auth and the pool-recovery retry.
//
// TWO BUGS, one file, because they share the pool.
//
// 1. Sidecar never answered a relay's AUTH challenge. That does not matter for posting —
//    an EVENT is signed, so a paid relay reads event.pubkey and lets a subscriber's note
//    through without any authentication. It matters for READING: a REQ carries no
//    signature, so a relay restricting reads has to challenge, and an unanswered
//    challenge means the panel gets nothing. relay.nostr.build and nostr.land both do
//    this, and both sit in a real read list — which is part of why the account's own
//    kind:10002 lookup was timing out.
//
// 2. The pool never evicts a relay that dropped. SimplePool removes a relay only from
//    the onclose it installs in ensureRelay, and AbstractRelay.handleHardClose skips
//    onclose entirely when enableReconnect is set (nostr-tools.js:3096). A dropped relay
//    reconnects on a backoff of up to a minute and stays in the map the whole time, so
//    every publish fails until the panel is reloaded and builds a new pool. One dropped
//    connection — a slept laptop, a wifi blip — does this to every relay at once.
//
// The allowlist in (1) is the part worth guarding hardest: answering a challenge tells a
// relay which account is on the connection.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl + ' in sidepanel.js');
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

function liftLine(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

// deps.configured  the global relay map
// deps.nip65       the account's declared list, or null
// deps.active      state.activePubkey
function harness(deps = {}) {
  const signed = [];
  const ctx = {
    console,
    Set,
    Error,
    Promise,
    String,
    signed,
    NT: { utils: { normalizeURL: (u) => String(u).replace(/\/+$/, '') + '/' } },
    state: { activePubkey: 'active' in deps ? deps.active : 'a'.repeat(64) },
    relayUrls: async () => Object.keys(deps.configured || {}),
    // No getNip65 here on purpose: building the allowlist must not touch the network.
    // A test that stubs a query would hide the loop this replaced.
    nip65Cache: new Map(),
    recallNip65: async () => deps.nip65 || null,
    call: async (msg) => {
      if (msg.type !== 'SIDECAR_OWNER_SIGN') throw new Error('unexpected ' + msg.type);
      signed.push(msg);
      return { ...msg.event, id: 'signed', sig: 'sig' };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    [
      liftLine(/const authRelays = new Set\(\);/, 'authRelays'),
      lift('function normalizeRelay('),
      lift('async function refreshAuthRelays('),
      lift('async function signRelayAuth('),
      'globalThis.authRelays = authRelays;',
      'globalThis.refreshAuthRelays = refreshAuthRelays;',
      'globalThis.signRelayAuth = signRelayAuth;',
      // the predicate the pool is constructed with, mirrored so it can be exercised
      'globalThis.mayAuth = (url) => authRelays.has(normalizeRelay(url));',
    ].join('\n'),
    ctx
  );
  return ctx;
}

// ---- who we will identify to ----------------------------------------------------

test('a configured relay is on the allowlist', async () => {
  const ctx = harness({ configured: { 'wss://mine.example': {} } });
  await ctx.refreshAuthRelays();
  assert.equal(ctx.mayAuth('wss://mine.example'), true);
});

test('a declared NIP-65 relay is on the allowlist, read side included', async () => {
  const ctx = harness({ nip65: { read: ['wss://declared-read'], write: ['wss://declared-write'] } });
  await ctx.refreshAuthRelays();
  assert.equal(ctx.mayAuth('wss://declared-read'), true, 'reads are the whole reason for this');
  assert.equal(ctx.mayAuth('wss://declared-write'), true);
});

test('a relay from someone else’s relay hint is NOT on the allowlist', async () => {
  // The disclosure that matters: answering a challenge tells that relay which account
  // is behind the connection. For a relay in your own list that is not news. For one a
  // stranger's event pointed at, it is.
  const ctx = harness({ configured: { 'wss://mine.example': {} } });
  await ctx.refreshAuthRelays();
  assert.equal(ctx.mayAuth('wss://someone-elses-hint.example'), false);
});

test('the allowlist follows the account, replacing rather than accumulating', async () => {
  const ctx = harness({ nip65: { read: ['wss://account-a'], write: [] } });
  await ctx.refreshAuthRelays();
  assert.equal(ctx.mayAuth('wss://account-a'), true);
  // switch accounts: same panel, different declared list
  ctx.recallNip65 = async () => ({ read: ['wss://account-b'], write: [] });
  await ctx.refreshAuthRelays();
  assert.equal(ctx.mayAuth('wss://account-b'), true);
  assert.equal(ctx.mayAuth('wss://account-a'), false, 'the previous account’s relays must not linger');
});

test('a trailing slash does not create a second entry', async () => {
  const ctx = harness({ configured: { 'wss://mine.example': {} } });
  await ctx.refreshAuthRelays();
  assert.equal(ctx.mayAuth('wss://mine.example/'), true, 'NIP-65 tags and hints disagree about this');
});

test('a lookup failure leaves an empty allowlist rather than a stale one', async () => {
  const ctx = harness({ configured: { 'wss://mine.example': {} } });
  await ctx.refreshAuthRelays();
  ctx.relayUrls = async () => { throw new Error('offline'); };
  ctx.recallNip65 = async () => { throw new Error('offline'); };
  await ctx.refreshAuthRelays();
  assert.equal(ctx.mayAuth('wss://mine.example'), false, 'fail closed: say nothing rather than guess');
});

// ---- signing the challenge ------------------------------------------------------

test('the challenge is signed through the service worker, never in the panel', async () => {
  const ctx = harness();
  await ctx.signRelayAuth({ kind: 22242, tags: [['relay', 'wss://x'], ['challenge', 'c']] });
  assert.equal(ctx.signed.length, 1);
  assert.equal(ctx.signed[0].type, 'SIDECAR_OWNER_SIGN');
});

test('the auth event is pinned to the account that is active now', async () => {
  // The 1.5.0 signing-mismatch rule: never let a mid-flight account switch produce a
  // signature from the wrong identity.
  const ctx = harness();
  await ctx.signRelayAuth({ kind: 22242, tags: [] });
  assert.equal(ctx.signed[0].expectedPubkey, 'a'.repeat(64));
});

test('with no active account there is nothing to authenticate as', async () => {
  const ctx = harness({ active: '' });
  await assert.rejects(() => ctx.signRelayAuth({ kind: 22242, tags: [] }), /no active account/);
  assert.equal(ctx.signed.length, 0);
});

// ---- source guards --------------------------------------------------------------

// Line-based: a comment in this file mentions the host permission "(https://*/*)",
// whose "/*" makes the usual block-comment sweep eat most of the source and every
// doesNotMatch below pass vacuously.
const body = source
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
  .join('\n');

test('the pool is built with the allowlist, not with a blanket signer', () => {
  const fn = lift('function getPool(');
  assert.match(fn, /automaticallyAuth:/);
  assert.match(fn, /authRelays\.has\(/, 'a bare signer would authenticate to any relay at all');
});

test('publish and query both carry onauth', () => {
  // The pool's own onauth covers a relay that challenges on connect. A relay that
  // answers a REQ or an EVENT with "auth-required: …" is only retried when onauth
  // arrives in the call's params, so both paths need it.
  assert.match(body, /publish\(targets, signed, authParams\)/);
  assert.match(body, /\.get\(relays, filter, authParams\)/);
});

test('a total publish failure evicts the relays and retries once', () => {
  const fn = lift('async function publishToRelays(');
  const reset = fn.indexOf('resetPoolRelays(targets)');
  const retry = fn.indexOf('publish(targets, signed, authParams)', reset);
  assert.ok(reset !== -1, 'without eviction the retry reuses the same wedged sockets');
  assert.ok(retry > reset, 'evict first, then retry');
});

test('the retry happens only on a total failure', () => {
  // A partial success must never re-send to relays that already accepted the event.
  const fn = lift('async function publishToRelays(');
  assert.match(fn, /if \(!ok\) \{\s*\n\s*resetPoolRelays\(targets\);/);
});

test('resetPoolRelays uses the pool’s own eviction, not a private field poke', () => {
  const fn = lift('function resetPoolRelays(');
  assert.match(fn, /_pool\.close\(/, 'close() both shuts the socket and deletes the map entry');
});

test('building the allowlist issues no relay queries', () => {
  // THE LOOP THIS REPLACED. refreshAuthRelays runs from refresh(), which fires from
  // dozens of places including after every signature. It used to call getNip65(), and a
  // FAILED lookup is deliberately never cached — so every refresh sent another
  // kind:10002 query, which is the traffic that gets an account rate-limited, which
  // makes the lookup fail. nostrelites.org replied with "rate-limited: there is a bug in
  // the client, no one should be making so many requests", which is a fair description.
  const fn = lift('async function refreshAuthRelays(');
  assert.doesNotMatch(fn, /getNip65/, 'the allowlist must read cached state, never query');
  assert.doesNotMatch(fn, /poolGet|getPool/);
  assert.match(fn, /recallNip65|nip65Cache/, 'cached sources only');
});
