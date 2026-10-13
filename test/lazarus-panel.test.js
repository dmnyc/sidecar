'use strict';

// The panel's half of Lazarus (sidepanel.js), EXECUTED rather than read.
//
// The relay outcomes are the part a source assertion cannot vouch for: the bug they
// fix lived in the pool's callback order, not in any line of the panel. On a close
// or a failed connection, nostr-tools' subscribeMap calls oneose and then onclose
// in the same tick, so a query that took the first callback as the answer recorded
// every refused, dropped or unreachable relay as "answered", and a relay list that
// refused the REQ confirmed a current version it never served. So these run the
// panel's functions against the vendored SimplePool itself, over a scripted
// WebSocket that plays each relay: EOSE, CLOSED, a refused connection, a dropped
// one, or silence.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('./helpers/i18n');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'), { filename: 'nostr-tools.js' });
const NT = globalThis.NostrTools;

const lctx = { console };
vm.createContext(lctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lazarus.js'), 'utf8'), lctx);
const L = lctx.SidecarLazarus;

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

const LIFTED = [
  liftLine(/const poolSubscribe = [^\n]+/, 'poolSubscribe'),
  liftLine(/const lazarusRelayLabel = [^\n]+/, 'lazarusRelayLabel'),
  lift('function lazarusQueryRelay('),
  lift('async function lazarusQueryAll('),
  lift('function lazarusRelaySet('),
  lift('function lazarusRelayTags('),
  lift('function lazarusValidEvent('),
  lift('async function lazarusRelayList('),
  lift('async function lazarusApplyList('),
  lift('function lazarusDerive('),
  lift('async function lazarusRound('),
  lift('async function lazarusScan('),
  lift('async function lazarusRetry('),
  lift('async function lazarusDecryptPrivate('),
  lift('async function lazarusDecryptAll('),
  lift('async function lazarusAdopt('),
  // A lifted const is not a property of the context; expose the one called directly.
  'globalThis.poolSubscribe = poolSubscribe;',
].join('\n\n');

// ---- the scripted relays ---------------------------------------------------------
//
// SCRIPTS maps a normalized relay URL to how that relay behaves:
//   mode 'eose'     serves the events matching the filter, then EOSE
//   mode 'closed'   serves `events` (if any), then CLOSED
//   mode 'drop'     serves `events` (if any), then drops the connection
//   mode 'silent'   connects and never answers
//   mode 'refuse'   the connection fails (also the default for an unknown URL)
// A script may be swapped between calls to play a relay that recovers.

function makeRelays() {
  const SCRIPTS = new Map();
  const reqs = []; // every REQ any relay received: [url, filter]
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      const s = SCRIPTS.get(NT.utils.normalizeURL(url)) || { mode: 'refuse' };
      setTimeout(() => {
        if (s.mode === 'refuse') { this.readyState = 3; this.onerror && this.onerror({}); return; }
        this.readyState = 1;
        this.onopen && this.onopen();
      }, 1);
    }
    send(msg) {
      const data = JSON.parse(msg);
      if (data[0] !== 'REQ') return;
      const [, id, filter] = data;
      reqs.push([NT.utils.normalizeURL(this.url), filter]);
      const s = SCRIPTS.get(NT.utils.normalizeURL(this.url));
      setTimeout(() => {
        if (s.mode === 'silent') return;
        let evs = (s.events || []).filter((e) => (!filter.kinds || filter.kinds.includes(e.kind))
          && (filter.until == null || e.created_at <= filter.until));
        evs = evs.sort((a, b) => b.created_at - a.created_at).slice(0, filter.limit || evs.length);
        evs.forEach((e) => this.onmessage({ data: JSON.stringify(['EVENT', id, e]) }));
        if (s.mode === 'eose') this.onmessage({ data: JSON.stringify(['EOSE', id]) });
        else if (s.mode === 'closed') this.onmessage({ data: JSON.stringify(['CLOSED', id, s.reason || 'blocked: not allowed']) });
        else if (s.mode === 'drop') { this.readyState = 3; this.onclose && this.onclose({}); }
      }, 2);
    }
    close() { this.readyState = 3; }
  }
  FakeWS.OPEN = 1;
  const pool = new NT.SimplePool({ enableReconnect: false, websocketImplementation: FakeWS });
  return { SCRIPTS, reqs, pool, set: (url, script) => SCRIPTS.set(NT.utils.normalizeURL(url), script) };
}

// ---- signed events -----------------------------------------------------------------

const SK = NT.generateSecretKey();
const PK = NT.getPublicKey(SK);
const OTHER = NT.generateSecretKey();
let tick = 1_700_000_000;
const signed = (kind, tags, opts = {}) => NT.finalizeEvent({
  kind, tags, content: opts.content || '', created_at: opts.at || ++tick,
}, opts.sk || SK);
const follows = (n, from = 0) => Array.from({ length: n }, (_, i) => ['p', 'f'.repeat(16) + String(from + i).padStart(48, '0')]);

// ---- the harness ---------------------------------------------------------------------

function harness(deps = {}) {
  const relays = makeRelays();
  const calls = [];
  const ctx = {
    console, Promise, Set, Map, Array, Object, JSON, Math, String, Error, setTimeout, clearTimeout,
    NT,
    // A generous timeout by default: a scripted relay answers in milliseconds, but the
    // full suite runs files in parallel, and a loaded machine once let a 250ms budget
    // expire first, recording an answered relay as timed out. Only the silence test
    // wants a short one, and sets it. Unscripted relays refuse at once, so no test
    // waits on this.
    self: { SidecarLazarus: Object.assign({}, L, { RELAY_TIMEOUT: deps.timeout || 3000 }) },
    getPool: () => relays.pool,
    authRelays: new Set((deps.auth || []).map((u) => NT.utils.normalizeURL(u))),
    normalizeRelay: (u) => { try { return NT.utils.normalizeURL(u); } catch (_) { return String(u); } },
    signRelayAuth: async () => { throw new Error('tests do not authenticate'); },
    LAZARUS_SCAN_RELAYS: deps.archival || [],
    LAZARUS_CONCURRENCY: 8,
    relayUrls: async (writable) => (writable ? (deps.configuredWrite || deps.configured || []) : (deps.configured || [])),
    nip65Cache: new Map(),
    recallNip65: async () => deps.saved || null,
    nip65OnlyFor: async () => !!deps.nip65Only,
    call: async (msg) => { calls.push(msg); return deps.call ? deps.call(msg) : null; },
    // lazarusAdopt's world
    seedBaseline: (pk, ev) => calls.push({ type: 'seed', pk, ev }),
    followCountCache: new Map(),
    followListCache: 'stale', followListPubkey: 'stale',
    forgetWot: () => calls.push({ type: 'forgetWot' }),
    _muteLists: new Map(), _muteListPromises: new Map(),
    emptyMuteSet: () => ({ pubkeys: new Set(), hashtags: new Set(), words: [], threads: new Set(), size: 0 }),
    pruneNameMuted: (pk) => calls.push({ type: 'prune', pk }),
    cacheProfile: (pk, content) => calls.push({ type: 'cacheProfile', pk, content }),
    rememberNip65: (pk, list) => calls.push({ type: 'remember', pk, list }),
    refreshAuthRelays: async (...args) => { calls.push({ type: 'refreshAuth', args }); },
    _bmCache: { pubkey: PK },
    state: null,
  };
  ctx.globalThis = ctx;
  withI18n(ctx); // the panel code formats counts through I18N
  vm.createContext(ctx);
  vm.runInContext(lift('function collectMuteTags('), ctx);
  vm.runInContext(LIFTED, ctx);
  return { ctx, calls, ...relays };
}

const W = 'wss://write.example';
const R = 'wss://read.example';
const C = 'wss://configured.example';
const A = 'wss://archive.example';
const listEvent = (tags) => signed(10002, tags);

// ---- one relay, one outcome, against the real pool -----------------------------------

test('AN EOSE IS AN ANSWER, WITH OR WITHOUT EVENTS', async () => {
  const h = harness();
  h.set(A, { mode: 'eose', events: [signed(3, follows(2))] });
  h.set(W, { mode: 'eose', events: [] });
  const withEvents = await h.ctx.lazarusQueryRelay(NT.utils.normalizeURL(A), { kinds: [3], authors: [PK] });
  assert.equal(withEvents.outcome, 'answered');
  assert.equal(withEvents.events.length, 1);
  assert.equal((await h.ctx.lazarusQueryRelay(NT.utils.normalizeURL(W), { kinds: [3], authors: [PK] })).outcome, 'answered');
});

test('A RELAY THAT REFUSES THE REQUEST FAILED; IT DID NOT ANSWER', async () => {
  // subscribeMap fires oneose before onclose on a CLOSED: the old query took the
  // first callback and called this relay "answered".
  const h = harness();
  h.set(A, { mode: 'closed', reason: 'blocked: paid relay' });
  assert.equal((await h.ctx.lazarusQueryRelay(NT.utils.normalizeURL(A), { kinds: [3], authors: [PK] })).outcome, 'failed');
});

test('A REFUSED OR DROPPED CONNECTION FAILED', async () => {
  const h = harness();
  h.set(W, { mode: 'drop' });
  assert.equal((await h.ctx.lazarusQueryRelay('wss://nobody.example/', { kinds: [3], authors: [PK] })).outcome, 'failed');
  assert.equal((await h.ctx.lazarusQueryRelay(NT.utils.normalizeURL(W), { kinds: [3], authors: [PK] })).outcome, 'failed');
});

test('EVENTS THAT ARRIVED BEFORE A FAILURE ARE KEPT', async () => {
  const h = harness();
  h.set(A, { mode: 'closed', events: [signed(3, follows(3))] });
  const res = await h.ctx.lazarusQueryRelay(NT.utils.normalizeURL(A), { kinds: [3], authors: [PK] });
  assert.equal(res.outcome, 'failed');
  assert.equal(res.events.length, 1, 'a real signed version is a candidate whatever the relay did next');
});

test('SILENCE TIMES OUT; THE POOL\'S SYNTHETIC EOSE IS NOT AN ANSWER', async () => {
  // A silent relay gets a fake EOSE after eoseTimeout. Here the relay's own default
  // is shorter than the scan's timeout, so without a maxWait past the timer the
  // fake EOSE would arrive first and read as an answer.
  const h = harness({ timeout: 300 });
  h.set(A, { mode: 'silent' });
  const relay = await h.pool.ensureRelay(NT.utils.normalizeURL(A));
  relay.baseEoseTimeout = 50;
  assert.equal((await h.ctx.lazarusQueryRelay(NT.utils.normalizeURL(A), { kinds: [3], authors: [PK] })).outcome, 'timed out');
});

test('A URL THE POOL CANNOT PARSE FAILS ONE RELAY, NOT THE SCAN', async () => {
  const h = harness();
  const res = await h.ctx.lazarusQueryRelay('wss://bad host.example', { kinds: [3], authors: [PK] });
  assert.equal(res.outcome, 'failed');
  // And the set builder drops it before it is ever dialed.
  assert.deepEqual([...h.ctx.lazarusRelaySet(['wss://bad host', 'ftp://x', 'nos.lol', 'wss://nos.lol/', 42])], ['wss://nos.lol/']);
});

test('THE AUTH-REQUIRED RETRY IS OFFERED ONLY TO ALLOWLISTED RELAYS', () => {
  // The scan reaches archival relays outside the account's own list. Answering a
  // challenge there would tell each of them who is behind the connection.
  const seen = [];
  const h = harness({ auth: [W] });
  h.ctx.getPool = () => ({ subscribe: (r, f, p) => { seen.push(p); return { close() {} }; } });
  h.ctx.poolSubscribe([NT.utils.normalizeURL(W)], {}, {});
  h.ctx.poolSubscribe([NT.utils.normalizeURL(A)], {}, { onauth: () => 'mine' });
  assert.equal(seen[0].onauth, h.ctx.signRelayAuth);
  assert.equal(seen[1].onauth, undefined, 'a caller cannot widen the allowlist either');
});

// ---- the relay list lookup -------------------------------------------------------------

test('THE NEWEST RELAY LIST WINS, NOT THE FIRST TO ARRIVE; UNMARKED MEANS BOTH', async () => {
  const h = harness({ configured: [C, A] });
  h.set(C, { mode: 'eose', events: [listEvent([['r', 'wss://old.example']])] });
  h.set(A, { mode: 'eose', events: [listEvent([['r', W], ['r', R, 'read']])] }); // newer
  const list = await h.ctx.lazarusRelayList(PK);
  assert.equal(list.state, 'known');
  assert.deepEqual([...list.write], [W]);
  assert.deepEqual([...list.read], [W, R]);
});

test('ANSWERED WITH NOTHING IS "NONE"; NOBODY ANSWERING IS "UNKNOWN"', async () => {
  const none = harness({ configured: [C] });
  none.set(C, { mode: 'eose', events: [] });
  assert.equal((await none.ctx.lazarusRelayList(PK)).state, 'none');
  // Every relay refusing at once used to read as "none" too.
  const unknown = harness({ configured: [C] });
  unknown.set(C, { mode: 'closed' });
  assert.equal((await unknown.ctx.lazarusRelayList(PK)).state, 'unknown');
  // A saved copy is a source: nobody answering, but Sidecar holds the list.
  const saved = harness({ configured: [C], saved: { read: [R], write: [W] } });
  const s = await saved.ctx.lazarusRelayList(PK);
  assert.equal(s.state, 'known');
  assert.equal(s.saved, true);
});

test('A FORGED OR FOREIGN RELAY LIST IS NOT THE ACCOUNT\'S', async () => {
  const h = harness({ configured: [C] });
  h.set(C, { mode: 'eose', events: [signed(10002, [['r', 'wss://evil.example']], { sk: OTHER })] });
  // matchFilters in the pool drops the foreign author before the panel sees it;
  // either way, it must never become the list.
  assert.equal((await h.ctx.lazarusRelayList(PK)).state, 'none');
});

// ---- the scan --------------------------------------------------------------------------

test('A WRITE RELAY THAT REFUSES THE REQUEST NEVER CONFIRMS CURRENT', async () => {
  const h = harness({ configured: [C] });
  h.set(C, { mode: 'eose', events: [listEvent([['r', W]])] });
  h.set(W, { mode: 'closed', reason: 'auth-required: sign in' });
  h.set(A, { mode: 'eose', events: [signed(3, follows(10))] });
  h.ctx.LAZARUS_SCAN_RELAYS = [A];
  const { scan } = await h.ctx.lazarusScan(PK, 3);
  assert.equal(scan.writeAnswered, false, 'a refused REQ is silence, not confirmation');
  assert.equal(scan.outcomes.get(NT.utils.normalizeURL(W)), 'failed');
  assert.equal(scan.failedScan, false);
  assert.equal(L.rank(scan.candidates, 3, { currentConfirmed: scan.writeAnswered }).currentUnconfirmed, true);
});

test('AN UNKNOWN RELAY LIST GETS NO STAND-INS', async () => {
  const h = harness({ configured: [C] });
  h.set(C, { mode: 'closed' });
  h.set(A, { mode: 'eose', events: [signed(3, follows(4))] });
  h.ctx.LAZARUS_SCAN_RELAYS = [A];
  const { scan } = await h.ctx.lazarusScan(PK, 3);
  assert.equal(scan.list.state, 'unknown');
  assert.deepEqual([...scan.writeRelays], [], 'defaults must never stand in for a list that could not be read');
  assert.equal(scan.writeAnswered, false);
  assert.match(scan.listNote, /couldn’t be read/);
});

test('NO RELAY LIST: THE CONFIGURED WRITE RELAYS STAND IN, LABELED; NOT WITH NIP-65 ONLY', async () => {
  const setup = (h) => {
    h.set(C, { mode: 'eose', events: [] });
    h.set('wss://readonly.example', { mode: 'eose', events: [] });
  };
  const h = harness({ configured: [C, 'wss://readonly.example'], configuredWrite: [C] });
  setup(h);
  const { scan } = await h.ctx.lazarusScan(PK, 3);
  assert.deepEqual([...scan.writeRelays], [NT.utils.normalizeURL(C)], 'read-only relays do not judge a write');
  assert.equal(scan.writeDefaults, true);
  assert.match(scan.listNote, /stand in/);

  const strict = harness({ configured: [C, 'wss://readonly.example'], configuredWrite: [C], nip65Only: true });
  setup(strict);
  const { scan: s2 } = await strict.ctx.lazarusScan(PK, 3);
  assert.deepEqual([...s2.writeRelays], []);
  assert.ok(!s2.asked.includes(NT.utils.normalizeURL('wss://readonly.example')), 'NIP-65 only leaves the configured relays out of the scan');
});

test('A MALFORMED URL IN THE RELAY LIST DOES NOT ABORT THE SCAN', async () => {
  const h = harness({ configured: [C] });
  h.set(C, { mode: 'eose', events: [listEvent([['r', 'wss://bad host.example'], ['r', W]])] });
  h.set(W, { mode: 'eose', events: [signed(3, follows(5))] });
  const { scan } = await h.ctx.lazarusScan(PK, 3);
  assert.equal(scan.writeAnswered, true);
  assert.equal(scan.candidates.length, 1);
});

test('A RETRY MERGES: A RECOVERED WRITE RELAY CONFIRMS CURRENT', async () => {
  const h = harness({ configured: [C] });
  const v = signed(3, follows(8));
  h.set(C, { mode: 'eose', events: [listEvent([['r', W]])] });
  h.set(W, { mode: 'drop', events: [v] });
  const { scan } = await h.ctx.lazarusScan(PK, 3);
  assert.equal(scan.writeAnswered, false);
  assert.ok(scan.failedRelays.includes(NT.utils.normalizeURL(W)));
  h.set(W, { mode: 'eose', events: [v, signed(3, follows(9))] });
  const fresh = await h.ctx.lazarusRetry(scan);
  assert.equal(scan.writeAnswered, true, 'the verdict is recomputed from the merged outcomes');
  assert.ok(!scan.failedRelays.includes(NT.utils.normalizeURL(W)));
  assert.equal(fresh.length, 1, 'only the version not already shown is new');
  assert.equal(scan.candidates.length, 2);
});

test('A RETRY ASKS FOR AN UNKNOWN RELAY LIST AGAIN, AND ITS WRITE SET TAKES OVER', async () => {
  const h = harness({ configured: [C] });
  h.set(C, { mode: 'closed' });
  const { scan } = await h.ctx.lazarusScan(PK, 3);
  assert.equal(scan.list.state, 'unknown');
  h.set(C, { mode: 'eose', events: [listEvent([['r', W, 'write']])] });
  h.set(W, { mode: 'eose', events: [signed(3, follows(3))] });
  await h.ctx.lazarusRetry(scan);
  assert.equal(scan.list.state, 'known');
  assert.ok(scan.asked.includes(NT.utils.normalizeURL(W)), 'the list\'s own relays join the retry');
  assert.equal(scan.writeAnswered, true);
});

test('PAGING STOPS AT A PAGE WITH NOTHING OLDER, EVEN A FULL ONE', async () => {
  // Fifty versions at one second fill every page with the same events: a cursor
  // that never moves used to leave "Load older versions" up forever.
  const h = harness({ configured: [A] });
  const sameSecond = Array.from({ length: 50 }, (_, i) => signed(3, follows(1, i), { at: 1_600_000_000 }));
  h.set(A, { mode: 'eose', events: sameSecond });
  const { scan } = await h.ctx.lazarusScan(PK, 3);
  assert.equal(scan.pages.size, 1, 'a full first page may hold more');
  await h.ctx.lazarusRound(scan, [...scan.pages].map(([relay, until]) => ({ relay, until })));
  assert.equal(scan.pages.size, 0, 'nothing older came back, so the relay is exhausted');
});

test('A PAGE THAT FAILS KEEPS ITS CURSOR AND NEVER UN-ANSWERS THE RELAY', async () => {
  const h = harness({ configured: [A] });
  const evs = Array.from({ length: 60 }, (_, i) => signed(3, follows(1, i), { at: 1_600_000_000 + i }));
  h.set(A, { mode: 'eose', events: evs });
  const { scan } = await h.ctx.lazarusScan(PK, 3);
  const cursor = scan.pages.get(NT.utils.normalizeURL(A));
  h.set(A, { mode: 'closed' });
  await h.ctx.lazarusRound(scan, [...scan.pages].map(([relay, until]) => ({ relay, until })));
  assert.equal(scan.pages.get(NT.utils.normalizeURL(A)), cursor);
  assert.ok(scan.pageFailed.has(NT.utils.normalizeURL(A)));
  assert.equal(scan.outcomes.get(NT.utils.normalizeURL(A)), 'answered');
  h.set(A, { mode: 'eose', events: evs });
  await h.ctx.lazarusRound(scan, [...scan.pages].map(([relay, until]) => ({ relay, until })));
  assert.equal(scan.candidates.length, 60);
  assert.equal(scan.pages.size, 0);
});

test('A CLOSED SCREEN DIALS NOTHING NEW, AND RECORDS WHAT IT DIALED', async () => {
  const h = harness();
  h.set(A, { mode: 'eose', events: [] });
  const session = { closed: false, touched: new Set() };
  await h.ctx.lazarusQueryRelay(NT.utils.normalizeURL(A), { kinds: [3], authors: [PK] }, session);
  assert.ok(session.touched.has(NT.utils.normalizeURL(A)));
  session.closed = true;
  const before = h.reqs.length;
  const res = await h.ctx.lazarusQueryRelay(NT.utils.normalizeURL(A), { kinds: [3], authors: [PK] }, session);
  assert.equal(res.outcome, 'failed');
  assert.equal(h.reqs.length, before);
});

// ---- decryption: the live path, with the order the old muteTags tests pinned ------------

const decryptHarness = (answer) => {
  const tried = [];
  const h = harness({ call: (msg) => { tried.push(msg.nip); return answer(msg); } });
  return { h, tried };
};

test('DECRYPT: NIP-44 FIRST, AND THE ITEMS PASS THE KIND\'S FILTER', async () => {
  const { h, tried } = decryptHarness(() => JSON.stringify([['p', 'a'.repeat(64)], ['word', 'spam'], ['relay', 'wss://x'], 'junk']));
  const c = L.candidate(signed(10000, [], { content: 'ciphertext-without-iv' }), 10000);
  await h.ctx.lazarusDecryptPrivate(c);
  assert.deepEqual(tried, [44]);
  assert.equal(c.decrypted.length, 2, 'the p and the word are mutes; a relay tag and a string are not');
});

test('DECRYPT: A "?iv=" CIPHERTEXT TRIES NIP-04 FIRST', async () => {
  const { h, tried } = decryptHarness((msg) => { if (msg.nip === 4) return JSON.stringify([['p', 'b'.repeat(64)]]); throw new Error('wrong scheme'); });
  const c = L.candidate(signed(10000, [], { content: 'ct?iv=iv' }), 10000);
  await h.ctx.lazarusDecryptPrivate(c);
  assert.deepEqual(tried, [4]);
  assert.equal(c.decrypted.length, 1);
});

test('DECRYPT: UNREADABLE OR NOT A LIST STAYS UNCOUNTED', async () => {
  const locked = decryptHarness(() => { throw new Error('Keystore is locked'); });
  const c1 = L.candidate(signed(10000, follows(1), { content: 'ct' }), 10000);
  await locked.h.ctx.lazarusDecryptPrivate(c1);
  assert.equal(c1.decrypted, null);
  const note = decryptHarness(() => '"a client note, not tags"');
  const c2 = L.candidate(signed(10000, [], { content: 'ct' }), 10000);
  await note.h.ctx.lazarusDecryptPrivate(c2);
  assert.deepEqual(note.tried, [44, 4], 'both schemes tried, neither produced tags');
  assert.equal(c2.decrypted, null);
});

// ---- after the restore: local copies take the restored version ---------------------------

test('ADOPT: A RESTORED MUTE LIST REBUILDS THE MUTE SET, PRIVATE ITEMS INCLUDED', async () => {
  const h = harness();
  const ev = signed(10000, [['p', 'c'.repeat(64)], ['t', 'NSFW']], { content: 'ct' });
  const c = L.candidate(ev, 10000);
  c.decrypted = L.privateItems([['word', 'Spam'], ['p', 'd'.repeat(64)]], 10000);
  await h.ctx.lazarusAdopt(c, ev, PK);
  const muted = h.ctx._muteLists.get(PK);
  assert.equal(muted.pubkeys.size, 2);
  assert.ok(muted.hashtags.has('nsfw'));
  assert.deepEqual([...muted.words], ['spam']);
  assert.equal(await h.ctx._muteListPromises.get(PK), muted, 'the next load reads the restore, not a relay');
  assert.ok(h.calls.some((x) => x.type === 'prune'));
  assert.ok(h.calls.some((x) => x.type === 'seed' && x.ev === ev), 'the wipe check measures against the restore');
});

test('ADOPT: PRIVATE MUTES THE PANEL COULDN\'T READ ARE LEFT TO THE LOADER', async () => {
  const h = harness();
  h.ctx._muteLists.set(PK, 'old');
  const ev = signed(10000, [], { content: 'ct' });
  await h.ctx.lazarusAdopt(L.candidate(ev, 10000), ev, PK);
  assert.equal(h.ctx._muteLists.has(PK), false);
});

test('ADOPT: A RESTORED RELAY LIST IS CACHED AND REMEMBERED, NOT FORGOTTEN', async () => {
  // Forgetting it sent the next lookup to whichever relay answered first, which
  // can be one still serving the clobbered list.
  const h = harness();
  const ev = listEvent([['r', W], ['r', R, 'read']]);
  await h.ctx.lazarusAdopt(L.candidate(ev, 10002), ev, PK);
  const cached = h.ctx.nip65Cache.get(PK);
  assert.deepEqual([...cached.write], [W]);
  assert.deepEqual([...cached.read], [W, R]);
  const remembered = h.calls.find((x) => x.type === 'remember');
  assert.ok(remembered && remembered.list === cached);
  assert.deepEqual(h.calls.find((x) => x.type === 'refreshAuth').args, [], 'the allowlist is rebuilt for whoever is active now');
});

test('ADOPT: FOLLOWS AND PROFILE TAKE THE RESTORED VERSION', async () => {
  const h = harness();
  const f = signed(3, [...follows(3), ...follows(1)]);
  await h.ctx.lazarusAdopt(L.candidate(f, 3), f, PK);
  assert.equal(h.ctx.followCountCache.get(PK), 3);
  assert.equal(h.ctx.followListCache, null);
  const p = signed(0, [], { content: JSON.stringify({ name: 'Me', picture: 'https://x/p.png' }) });
  await h.ctx.lazarusAdopt(L.candidate(p, 0), p, PK);
  assert.equal(h.calls.find((x) => x.type === 'cacheProfile').content.name, 'Me');
  assert.ok(h.calls.some((x) => x.type === 'SIDECAR_SET_PROFILE' && x.name === 'Me'));
});

// ---- the screens, clicked through ----------------------------------------------------
//
// A small fake DOM: enough for h(), classList, click listeners and text, so every screen
// of the recovery modal is built and walked with the real scan, core and pool
// underneath. It cannot say a screen looks right. It does say each one draws without
// throwing, and offers the buttons the flow depends on.

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.listeners = {};
    this._text = '';
    this._cls = new Set();
    this.disabled = false;
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const s = this._cls;
    return {
      add: (...c) => c.forEach((x) => s.add(x)),
      remove: (...c) => c.forEach((x) => s.delete(x)),
      contains: (c) => s.has(c),
      toggle: (c, force) => { const on = force === undefined ? !s.has(c) : !!force; if (on) s.add(c); else s.delete(c); return on; },
    };
  }
  setAttribute(k, v) { this.attrs = this.attrs || {}; this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs && k in this.attrs ? this.attrs[k] : null; }
  append(...kids) {
    kids.forEach((k) => {
      const node = typeof k === 'string' ? { textContent: k, children: [] } : k;
      node.parent = this;
      this.children.push(node);
    });
  }
  appendChild(k) { this.append(k); return k; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  // Bubbles, like the real thing, along the path as it stood when the click began: a
  // handler that clears the screen does not cut the path short, stopPropagation does.
  click() {
    if (this.disabled) return;
    const ev = { target: this, stopped: false, preventDefault() {}, stopPropagation() { this.stopped = true; } };
    const path = [];
    for (let n = this; n; n = n.parent) path.push(n);
    for (const n of path) {
      (n.listeners && n.listeners.click || []).forEach((f) => f(ev));
      if (ev.stopped) break;
    }
  }
  set innerHTML(_) { this.children = []; this._text = ''; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  querySelectorAll(sel) {
    const cls = sel.replace(/^\./, '');
    const out = [];
    const walk = (n) => (n.children || []).forEach((c) => { if (c._cls && c._cls.has(cls)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
}
const all = (root) => { const out = []; const walk = (n) => (n.children || []).forEach((c) => { out.push(c); walk(c); }); walk(root); return out; };
const button = (root, text) => all(root).find((e) => e.tagName === 'BUTTON' && (e.textContent === text || e.title === text));
const waitFor = async (pred, what) => {
  for (let i = 0; i < 1000; i++) { if (pred()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('timed out waiting for ' + what);
};

function modalHarness(deps = {}) {
  const base = harness(deps);
  const { ctx } = base;
  const modal = new FakeEl('div');
  let onClose = null;
  ctx.document = { createElement: (t) => new FakeEl(t) };
  ctx.h = (tag, props, children) => {
    const el = new FakeEl(tag);
    if (props) Object.assign(el, props);
    (children || []).forEach((c) => el.append(c));
    return el;
  };
  ctx.icon = (name) => Object.assign(new FakeEl('svg'), { iconName: name });
  ctx.openModal = (build, close) => { modal.innerHTML = ''; onClose = close || null; build(modal); };
  ctx.closeModal = () => { const f = onClose; onClose = null; if (f) f(); };
  ctx.waitingRow = (label) => ctx.h('div', { className: 'recv-waiting', textContent: label });
  ctx.relativeTime = () => 'now';
  ctx.renderProfile = () => {};
  ctx.published = [];
  ctx.poolPublish = (targets, ev) => targets.map((t) => {
    ctx.published.push([t, ev]);
    return deps.publish ? deps.publish(t, ev) : Promise.resolve('');
  });
  ctx.resetPoolRelays = (urls) => base.calls.push({ type: 'reset', urls });
  ctx._pool = base.pool;
  // The real wipe-check module, so the refusal screen shows the sentence the panel builds
  // from the finding's data. No I18N in this harness, so describe() speaks English.
  ctx.window = {};
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'replaceable-baseline.js'), 'utf8').replace(/\bself\.SidecarBaseline\b/, 'window.SidecarBaseline'), ctx);
  vm.runInContext([
    liftLine(/const describeFinding = \(f\) =>\n[^\n]+/, 'describeFinding'),
    // What Lazarus says in English, translated where the panel shows it.
    lift('function lzName('),
    lift('function lzYour('),
    lift('function lzYourCurrent('),
    lift('function lzYourCurrentCap('),
    lift('function lzCountOf('),
    lift('function lzNote('),
    lift('function lzOutcome('),
    liftLine(/const LZ_NUM = [^\n]+/, 'LZ_NUM'),
    lift('function lzBold('),
    lift('function iconButton('),
    liftLine(/const publishFailed = \(r\) =>\n[^\n]+\n[^\n]+/, 'publishFailed'),
    lift('function lazarusAttribution('),
    lift('function lazarusModal('),
  ].join('\n\n'), ctx);
  return { ...base, modal };
}

// The account signs whatever it is asked to, unless `refuse` says otherwise. The event
// is cloned first, as chrome.runtime messaging clones it on the way to the worker.
const signer = (opts = {}) => (msg) => {
  if (msg.type !== 'SIDECAR_OWNER_SIGN') return null;
  if (opts.refuse && opts.refuse(msg)) {
    const destructive = { kind: 3, type: 'shrink', from: 100, to: 20, lost: 80, name: '', message: 'the background’s English' };
    throw Object.assign(new Error(destructive.message), { destructive });
  }
  return NT.finalizeEvent(structuredClone(msg.event), SK);
};

async function scanTo(h, chipName) {
  h.ctx.lazarusModal({ pubkey: PK });
  button(h.modal, chipName).click();
  button(h.modal, 'Scan relays').click();
  await waitFor(() => /Choose a version to restore|No relay answered/.test(h.modal.textContent), 'the results');
}

test('SCREENS: SCAN, RECOMMEND, RESTORE, DONE, AND THE CONNECTIONS ARE RELEASED', async () => {
  const pre = signed(3, follows(100));
  const clobbered = signed(3, follows(20));
  const h = modalHarness({ configured: [C], call: signer() });
  h.set(C, { mode: 'eose', events: [listEvent([['r', W]])] });
  h.set(W, { mode: 'eose', events: [clobbered] });
  h.set(A, { mode: 'eose', events: [clobbered, pre] });
  h.ctx.LAZARUS_SCAN_RELAYS = [A];
  await scanTo(h, 'Follow list');
  assert.match(h.modal.textContent, /Highlighted: the fullest version/);
  assert.equal(h.modal.querySelectorAll('recovery-badge').filter((b) => b.textContent === 'Recommended').length, 1);
  assert.ok(h.modal.querySelectorAll('lazarus-outcomes')[0].querySelectorAll('lazarus-relay').length >= 3, 'each relay\'s outcome is listed');
  // The recommended row's restore control is an icon, not a word (CLAUDE.md, row controls).
  const recRow = h.modal.querySelectorAll('recovery-row').find((r) => r.classList.contains('rec'));
  const restore = button(recRow, 'Restore this version');
  assert.ok(restore && restore.children[0].iconName === 'rotate-ccw');
  assert.equal(recRow.querySelectorAll('item-actions')[0].textContent, '', 'no words in the inline action slot');
  restore.click();
  assert.match(h.modal.textContent, /Adds 80, removes 0 against your current list/);
  button(h.modal, 'Publish restore').click();
  await waitFor(() => /Version restored/.test(h.modal.textContent), 'the done screen');
  assert.match(h.modal.textContent, /Accepted by write\.example\./);
  assert.doesNotMatch(h.modal.textContent, /\.\./, 'no doubled full stop');
  const sign = h.calls.find((x) => x.type === 'SIDECAR_OWNER_SIGN');
  assert.equal(sign.confirmedDestructive, false, 'a restore that removes nothing leaves the wipe check on');
  assert.equal(h.ctx.followCountCache.get(PK), 100, 'the local copy took the restored version');
  button(h.modal, 'Done').click();
  await waitFor(() => h.calls.some((x) => x.type === 'reset'), 'the release');
  const released = h.calls.find((x) => x.type === 'reset').urls;
  assert.ok(released.includes(NT.utils.normalizeURL(A)), 'the archival relay opened for the scan is let go');
});

test('SCREENS: A SHRINK TAKES ITS OWN CONFIRMATION, WHICH ALSO ANSWERS THE WIPE CHECK', async () => {
  const older = signed(3, follows(30));
  const current = signed(3, [...follows(25), ...follows(10, 900)]);
  const h = modalHarness({ configured: [C], call: signer() });
  h.set(C, { mode: 'eose', events: [listEvent([['r', W]])] });
  h.set(W, { mode: 'eose', events: [current, older] });
  await scanTo(h, 'Follow list');
  const row = h.modal.querySelectorAll('recovery-row').find((r) => /30 following/.test(r.textContent));
  button(row, 'Restore this version').click();
  button(h.modal, 'Continue').click();
  assert.match(h.modal.textContent, /10 of the items in your current follow list aren’t in this version/);
  button(h.modal, 'Publish restore (removes 10)').click();
  await waitFor(() => /Version restored/.test(h.modal.textContent), 'the done screen');
  assert.equal(h.calls.find((x) => x.type === 'SIDECAR_OWNER_SIGN').confirmedDestructive, true);
});

test('SCREENS: THE WIPE CHECK\'S REFUSAL IS SHOWN, AND GOING AHEAD IS ITS OWN CLICK', async () => {
  const pre = signed(3, follows(100));
  const clobbered = signed(3, follows(20));
  const h = modalHarness({ configured: [C], call: signer({ refuse: (m) => !m.confirmedDestructive }) });
  h.set(C, { mode: 'eose', events: [listEvent([['r', W]])] });
  h.set(W, { mode: 'eose', events: [clobbered, pre] });
  await scanTo(h, 'Follow list');
  button(h.modal.querySelectorAll('recovery-row').find((r) => r.classList.contains('rec')), 'Restore this version').click();
  button(h.modal, 'Publish restore').click();
  await waitFor(() => /This restore removes data/.test(h.modal.textContent), 'the wipe check screen');
  assert.match(h.modal.textContent, /Drops your follows from 100 to 20\./, 'the finding itself, not a bare failure');
  button(h.modal, 'Restore anyway').click();
  await waitFor(() => /Version restored/.test(h.modal.textContent), 'the done screen');
});

test('SCREENS: A FAILED SCAN LEADS WITH THE RETRY AND STILL LISTS WHAT ARRIVED', async () => {
  const early = signed(3, follows(12));
  const h = modalHarness({ configured: [C] });
  h.set(C, { mode: 'closed' });
  h.set(A, { mode: 'drop', events: [early] });
  h.ctx.LAZARUS_SCAN_RELAYS = [A];
  await scanTo(h, 'Follow list');
  assert.match(h.modal.textContent, /No relay answered/);
  assert.match(h.modal.textContent, /The 1 version below arrived before the relays went quiet/);
  assert.equal(h.modal.querySelectorAll('recovery-row').length, 1, 'the version is listed, not only counted');
  const retry = button(h.modal, 'Retry the relays that failed');
  assert.ok(retry.classList.contains('primary'));
  h.set(C, { mode: 'eose', events: [listEvent([['r', A]])] });
  h.set(A, { mode: 'eose', events: [early] });
  retry.click();
  await waitFor(() => /Choose a version to restore/.test(h.modal.textContent), 'the merged results');
});

test('SCREENS: A FAILED PUBLISH RETRIES THE VERSION YOU CHOSE, NOT THE CLOBBERED ONE', async () => {
  // The retry used to restore scan.candidates.find(id === currentId): the current,
  // clobbered version, republished over the list it was meant to repair.
  let down = true;
  const pre = signed(3, follows(100));
  const clobbered = signed(3, follows(20));
  const h = modalHarness({
    configured: [C], call: signer(),
    publish: () => Promise.resolve(down ? 'connection failure: down' : ''),
  });
  h.set(C, { mode: 'eose', events: [listEvent([['r', W]])] });
  h.set(W, { mode: 'eose', events: [clobbered, pre] });
  await scanTo(h, 'Follow list');
  button(h.modal.querySelectorAll('recovery-row').find((r) => r.classList.contains('rec')), 'Restore this version').click();
  button(h.modal, 'Publish restore').click();
  await waitFor(() => /No write relay accepted the restore/.test(h.modal.textContent), 'the failure screen');
  down = false;
  button(h.modal, 'Try publishing again').click();
  await waitFor(() => /Version restored/.test(h.modal.textContent), 'the done screen');
  const last = h.ctx.published[h.ctx.published.length - 1][1];
  assert.equal(last.tags.length, 100, 'the retry published the chosen version');
});

test('SCREENS: A VERSION NEWER THAN THE REVIEW BECOMES CURRENT AND THE DELTA IS ASKED AGAIN', async () => {
  const pre = signed(3, follows(100));
  const clobbered = signed(3, follows(20));
  const h = modalHarness({ configured: [C], call: signer() });
  h.set(C, { mode: 'eose', events: [listEvent([['r', W]])] });
  h.set(W, { mode: 'eose', events: [clobbered, pre] });
  await scanTo(h, 'Follow list');
  button(h.modal.querySelectorAll('recovery-row').find((r) => r.classList.contains('rec')), 'Restore this version').click();
  h.set(W, { mode: 'eose', events: [signed(3, [...follows(20), ...follows(5, 700)]), clobbered, pre] }); // edited meanwhile
  button(h.modal, 'Publish restore').click();
  await waitFor(() => /changed while you reviewed/.test(h.modal.textContent), 'the recheck');
  assert.match(h.modal.textContent, /Adds 80, removes 5 against your current list/, 'recomputed against the newer version');
  assert.equal(h.calls.filter((x) => x.type === 'SIDECAR_OWNER_SIGN').length, 0, 'nothing was signed');
});

test('SCREENS: ONE KIND IS CHOSEN ACROSS EVERY TIER, AND KEYS ASK THE INTENT QUESTION', async () => {
  const h = modalHarness({ configured: [C] });
  h.ctx.lazarusModal({ pubkey: PK });
  button(h.modal, 'Follow list').click();
  button(h.modal, 'Profile').click();
  assert.equal(h.modal.querySelectorAll('lazarus-chip').filter((c) => c.classList.contains('on')).length, 1);
  // The relay lists sit under a heading that says what to do, not one pointing at a
  // warning the picker never shows.
  assert.deepEqual(h.modal.querySelectorAll('lazarus-tier').map((t) => t.textContent),
    ['Most worth recovering', 'Also yours', 'Check before restoring']);

  const keys = modalHarness({ configured: [C] });
  keys.set(C, { mode: 'eose', events: [listEvent([['r', W]]), signed(10044, []), signed(10044, [['n', 'a'.repeat(64)]], { at: 1_600_000_000 })] });
  keys.set(W, { mode: 'eose', events: [] });
  await scanTo(keys, 'Encryption keys');
  const past = keys.modal.querySelectorAll('recovery-row').find((r) => !/Current/.test(r.textContent));
  button(past, 'Restore this version').click();
  assert.match(keys.modal.textContent, /Do you want direct messages encrypted to these keys again\?/);
  assert.match(keys.modal.textContent, /Your current empty version announces that you do not use NIP-4e/);
  assert.ok(button(keys.modal, 'Yes, restore these keys'), 'the answer is the button itself');
});

test('SCREENS: UNREADABLE CURRENT PRIVATE ITEMS ARE NEVER "NOTHING WOULD CHANGE"', async () => {
  // Same public mutes on both sides, but the current version also carries encrypted
  // mutes this panel can't read. A restore replaces them, so the screen must not say
  // nothing would change and grey out the button; it takes the shrink path instead.
  const conv = NT.nip44.v2.utils.getConversationKey(SK, PK);
  const older = signed(10000, follows(3));
  const current = signed(10000, follows(3), { content: NT.nip44.v2.encrypt(JSON.stringify(follows(5, 50)), conv) });
  const h = modalHarness({
    configured: [C],
    call: (msg) => {
      if (msg.type === 'SIDECAR_OWNER_DECRYPT') throw new Error('Keystore is locked');
      return signer()(msg);
    },
  });
  h.set(C, { mode: 'eose', events: [listEvent([['r', W]])] });
  h.set(W, { mode: 'eose', events: [current, older] });
  await scanTo(h, 'Mute list');
  const row = h.modal.querySelectorAll('recovery-row').find((r) => !/Current/.test(r.textContent));
  button(row, 'Restore this version').click();
  assert.doesNotMatch(h.modal.textContent, /Nothing would change/);
  const go = button(h.modal, 'Continue');
  assert.ok(go && !go.disabled, 'the restore is offered, through the shrink confirmation');
  go.click();
  assert.match(h.modal.textContent, /has encrypted items Sidecar couldn’t read/);
});

test('SCREENS: A VERSION OPENS TO THE RELAYS HOLDING IT, WRITE RELAYS FIRST', async () => {
  // The spec's UI contract lists found-on relays per version; a count alone can't
  // say whether the version you are about to restore sits on your own relays.
  const pre = signed(3, follows(100));
  const clobbered = signed(3, follows(20));
  const h = modalHarness({ configured: [C], call: signer() });
  h.set(C, { mode: 'eose', events: [listEvent([['r', W]])] });
  h.set(W, { mode: 'eose', events: [clobbered, pre] });
  h.set(A, { mode: 'eose', events: [clobbered, pre] });
  h.set('wss://zeta.example', { mode: 'eose', events: [pre] });
  h.ctx.LAZARUS_SCAN_RELAYS = ['wss://zeta.example', A];
  await scanTo(h, 'Follow list');
  const recRow = () => h.modal.querySelectorAll('recovery-row').find((r) => r.classList.contains('rec'));
  const panel = () => recRow().querySelectorAll('recovery-relays')[0];
  const toggle = () => button(recRow(), '3 relays');
  assert.ok(toggle(), 'the relay count is the toggle, and never splits from its word');
  assert.equal(toggle().getAttribute('aria-expanded'), 'false');
  assert.ok(panel().classList.contains('hidden'));

  toggle().click();
  assert.equal(toggle().getAttribute('aria-expanded'), 'true');
  assert.ok(!panel().classList.contains('hidden'));
  const rows = panel().querySelectorAll('lazarus-relay');
  assert.deepEqual(rows.map((r) => r.children[0].textContent), ['write.example', 'archive.example', 'zeta.example']);
  assert.equal(rows[0].children[1].textContent, 'write', 'the account\'s own write relay is marked, and first');

  // Choosing a version is not opening it: the restore icon stops its click.
  const other = h.modal.querySelectorAll('recovery-row').find((r) => !r.classList.contains('rec') && button(r, 'Restore this version'));
  assert.equal(other, undefined, 'only the recommended version is restorable here');
  button(recRow(), 'Restore this version').click();
  assert.match(h.modal.textContent, /Restore this version\?/);
  button(h.modal, 'Back').click();
  // An opened row stays open across the round trip; the restore click toggled nothing.
  assert.ok(!panel().classList.contains('hidden'), 'the row the user opened is still open');
  toggle().click();
  assert.ok(panel().classList.contains('hidden'));
});

test('SCREENS: THE RESTORE ICON NEVER OPENS ITS ROW', async () => {
  const pre = signed(3, follows(100));
  const clobbered = signed(3, follows(20));
  const h = modalHarness({ configured: [C], call: signer() });
  h.set(C, { mode: 'eose', events: [listEvent([['r', W]])] });
  h.set(W, { mode: 'eose', events: [clobbered, pre] });
  await scanTo(h, 'Follow list');
  const recRow = () => h.modal.querySelectorAll('recovery-row').find((r) => r.classList.contains('rec'));
  button(recRow(), 'Restore this version').click();
  button(h.modal, 'Back').click();
  assert.ok(recRow().querySelectorAll('recovery-relays')[0].classList.contains('hidden'),
    'a click that bubbled to the head would have opened the row behind the confirm screen');
});

test('SCREENS: UNCOUNTABLE VERSIONS ARE CALLED OUT, AND AN UNCOUNTABLE CURRENT IS NOT "NO IMPROVEMENT"', async () => {
  // Spec 0.6.2 leaves a version of unknown size out of the ranking, so the answer
  // rests on the others; the partially-counted marker exists to warn of that.
  const mute = (tags, content, at) => signed(10000, tags, { content, at });
  const skipped = modalHarness({ configured: [C] });
  skipped.set(C, { mode: 'eose', events: [listEvent([['r', W]])] });
  skipped.set(W, { mode: 'eose', events: [mute(follows(5), '', 1_700_100_300), mute(follows(5, 50), 'garbage', 1_700_100_200), mute(follows(6), '', 1_700_100_100)] });
  await scanTo(skipped, 'Mute list');
  assert.match(skipped.modal.textContent, /Versions that couldn’t be counted were left out, so this may be wrong\./);
  assert.match(skipped.modal.textContent, /No recoverable improvement found/);

  const unknown = modalHarness({ configured: [C] });
  unknown.set(C, { mode: 'eose', events: [listEvent([['r', W]])] });
  unknown.set(W, { mode: 'eose', events: [mute(follows(2), 'garbage', 1_700_100_300), mute(follows(60), '', 1_700_100_100)] });
  await scanTo(unknown, 'Mute list');
  assert.match(unknown.modal.textContent, /Your current version couldn’t be counted, so nothing is recommended\./);
  assert.doesNotMatch(unknown.modal.textContent, /No recoverable improvement found/, 'unknown is not the same answer as none');
  assert.doesNotMatch(unknown.modal.textContent, /were left out/, 'one warning, not two');
});

test('SCREENS: THE CREDIT NAMES THE SPEC VERSION THE CORE IMPLEMENTS', () => {
  // Read from the core, not written into the label, so a version bump in
  // lazarus.js can't leave the screen claiming the old one.
  const h = modalHarness({ configured: [C] });
  h.ctx.lazarusModal({ pubkey: PK });
  const credit = h.modal.querySelectorAll('lazarus-credit')[0];
  assert.equal(credit.textContent, 'Follows the Lazarus recovery spec (' + L.SPEC_VERSION + ').');
  assert.equal(L.SPEC_VERSION, '0.6.2-draft');
});
