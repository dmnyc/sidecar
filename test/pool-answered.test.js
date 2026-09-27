'use strict';

// "NOBODY ANSWERED" IS NOT "NOTHING THERE", AGAINST THE REAL POOL.
//
// The first overview fix raced every profile and relay-list read against a backstop
// timer, and its tests modeled a failed read as a promise that never settles. The real
// SimplePool never does that. Offline, every connection fails in milliseconds and
// querySync resolves [] long before any backstop, so the browser showed "Not set" (and
// "no relay list", which also deleted the remembered one from disk) while every unit
// test passed.
//
// So these run poolQueryAnswered, lifted from sidepanel.js, on the vendored SimplePool
// with a fake WebSocket per relay. Only the socket is fake.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'), { filename: 'nostr-tools.js' });
const NT = globalThis.NostrTools;

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
const EOSE_LINE = source.match(/const EOSE_CLOSE = '[^']*';/)[0];
const BASE_LINE = source.match(/const BASE_EOSE_TIMEOUT = \d+;/)[0];

const SK = NT.generateSecretKey();
const PK = NT.getPublicKey(SK);
const profile = NT.finalizeEvent({ kind: 0, created_at: 100, tags: [], content: '{"nip05":"d@x.com"}' }, SK);

// Per relay URL: 'fail' (connection error), 'refuse' (CLOSED on the REQ), 'empty'
// (EOSE, nothing), 'silent' (connects, then never answers the REQ), or an array of
// events to send before EOSE.
function fakeSocket(plan) {
  return class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.mode = plan[url.replace(/\/$/, '')];
      setTimeout(() => {
        if (this.mode === 'fail') { this.onerror && this.onerror(); return; }
        this.readyState = 1;
        this.onopen && this.onopen();
      }, 0);
    }
    send(raw) {
      const msg = JSON.parse(raw);
      if (msg[0] !== 'REQ') return;
      const id = msg[1];
      const say = (frame) => setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(frame) }), 0);
      if (this.mode === 'silent') return;
      if (this.mode === 'refuse') return say(['CLOSED', id, 'blocked: not today']);
      for (const ev of Array.isArray(this.mode) ? this.mode : []) say(['EVENT', id, ev]);
      say(['EOSE', id]);
    }
    close() { this.readyState = 3; }
  };
}
function run(plan, filter = { kinds: [0], authors: [PK] }) {
  const WS = fakeSocket(plan);
  WS.OPEN = 1;
  const pool = new NT.SimplePool({ websocketImplementation: WS, enableReconnect: true });
  const poolSubscribeManyEose = (relays, f, params) => pool.subscribeManyEose(relays, f, params);
  // eslint-disable-next-line no-new-func
  const poolQueryAnswered = new Function('poolSubscribeManyEose',
    `${EOSE_LINE}\n${BASE_LINE}\n${lift('function poolQueryAnswered(')}\nreturn poolQueryAnswered;`)(poolSubscribeManyEose);
  return poolQueryAnswered(Object.keys(plan), filter, { maxWait: 500 })
    .finally(() => pool.destroy());
}

test('OFFLINE: EVERY CONNECTION FAILS, AND THAT IS NOT AN ANSWER', async () => {
  const t0 = Date.now();
  const res = await run({ 'wss://a.example': 'fail', 'wss://b.example': 'fail' });
  assert.equal(res.answered, false);
  assert.deepEqual(res.events, []);
  // The reason the backstop never saved the old code: this is fast, not a timeout.
  assert.ok(Date.now() - t0 < 400, 'the real pool resolves well before any maxWait');
});

test('every relay refusing the REQ is not an answer either', async () => {
  const res = await run({ 'wss://a.example': 'refuse', 'wss://b.example': 'fail' });
  assert.equal(res.answered, false);
});

test('a relay that reached EOSE with nothing is a real empty answer', async () => {
  const res = await run({ 'wss://a.example': 'empty', 'wss://b.example': 'fail' });
  assert.equal(res.answered, true, 'one relay answering is enough to say "not there"');
  assert.deepEqual(res.events, []);
});

test('the profile comes back when one relay has it, however the others fail', async () => {
  const res = await run({ 'wss://a.example': 'fail', 'wss://b.example': 'refuse', 'wss://c.example': [profile] });
  assert.equal(res.answered, true);
  assert.equal(res.events.length, 1);
  assert.equal(res.events[0].id, profile.id);
});

test('the EOSE reason it matches is the one the vendored pool actually sends', () => {
  // If nostr-tools is updated and this string changes, every read becomes "couldn't
  // load" forever. Fail here instead.
  const literal = EOSE_LINE.match(/'([^']*)'/)[1];
  const vendored = fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8');
  assert.ok(vendored.includes(`const reason = "${literal}";`), 'subscribeEose no longer closes with "' + literal + '"');
});

// ---- the silent relay: connects, then never answers --------------------------------
//
// The pool's own eoseTimeout fires a synthetic EOSE for it, with the same close reason as
// a real one. It can only fire a full maxWait after the REQ, so anything sooner is real.

test('A RELAY THAT CONNECTS AND SAYS NOTHING IS NOT AN ANSWER', async () => {
  const res = await run({ 'wss://a.example': 'silent', 'wss://b.example': 'fail' });
  assert.equal(res.answered, false, 'its synthetic EOSE must not read as "nothing there"');
});

test('a silent relay beside one that really answered empty is still an answer', async () => {
  const res = await run({ 'wss://a.example': 'silent', 'wss://b.example': 'empty' });
  assert.equal(res.answered, true);
});

test('an event from a slow relay is an answer however late it lands', async () => {
  const res = await run({ 'wss://a.example': 'silent', 'wss://b.example': [profile] });
  assert.equal(res.answered, true);
  assert.equal(res.events.length, 1);
});

test('the same event from two relays comes back once', async () => {
  const res = await run({ 'wss://a.example': [profile], 'wss://b.example': [profile] });
  assert.equal(res.events.length, 1);
});

test('no relays at all is not an answer, and does not hang', async () => {
  const res = await run({});
  assert.deepEqual(res, { events: [], answered: false });
});

test('the default timing line is the vendored relay\'s own EOSE timeout', () => {
  // Without maxWait the synthetic EOSE comes from baseEoseTimeout. If nostr-tools moves
  // it, the line that tells real from synthetic has to move with it.
  const n = BASE_LINE.match(/\d+/)[0];
  const vendored = fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8');
  assert.ok(vendored.includes(`baseEoseTimeout = ${n};`), 'AbstractRelay.baseEoseTimeout is no longer ' + n);
});
