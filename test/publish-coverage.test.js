'use strict';

// A NOTE THAT REACHED ONE RELAY READ "PUBLISHED TO NINE."
//
// The expanded composer and the highlight popup counted every relay that did not hard-reject
// as a success, and SimplePool.publish() RESOLVES, with "connection failure: …", for a relay
// it could not reach. On top of that the tab posted to Settings' bootstrap relays whenever
// the panel's handover was missing, so an account's own declared relays were never asked, and
// the receipt's link hinted the first two configured relays whether or not they had the note.
//
// These run the real publish routine from composer-core.js and the real targetRelays and
// neventFor from compose.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
const tab = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function liftPublishing() {
  const at = core.indexOf('  const PUBLISH_CAP_MS');
  const end = core.indexOf('\n  return {\n    show, hide');
  assert.ok(at !== -1 && end !== -1, 'the publishing block is gone from composer-core.js');
  const ctx = { Promise, Set, String, URL, setTimeout, clearTimeout, Math, Error };
  vm.createContext(ctx);
  vm.runInContext(core.slice(at, end) + '\nglobalThis.api = { publishFailed, publishRefusal, publishToRelays, groupRefusals };', ctx);
  return ctx.api;
}
const api = liftPublishing();

// A pool whose relays each answer by script. close() is recorded.
function pool(script) {
  const closed = [];
  let round = 0;
  return {
    closed, rounds: () => round,
    close: (urls) => closed.push([...urls]),
    publish: (urls) => { round++; return urls.map((u) => script(u, round)); },
  };
}
const OK = () => Promise.resolve('');
const refuse = (m) => () => Promise.reject(new Error(m));
const unreachable = () => Promise.resolve('connection failure: Error: connection timed out');

test('a relay that could not be reached is not counted as having taken the note', async () => {
  const p = pool((u) => (u === 'wss://b' ? unreachable() : OK()));
  const r = await api.publishToRelays({ pool: p, relays: ['wss://a', 'wss://b', 'wss://c'], signed: {} });
  assert.deepEqual([...r.accepted], ['wss://a', 'wss://c']);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].url, 'wss://b');
  assert.equal(r.total, 3);
});

test('a refusal is kept with its reason, and a paid or members-only relay is named as such', async () => {
  const say = { 'wss://paid': 'blocked: payment required', 'wss://members': 'restricted: not a member',
    'wss://list': 'restricted: pubkey not on the allowlist', 'wss://auth': 'auth-required: sign in',
    'wss://slow': 'rate-limited: slow down', 'wss://odd': 'invalid: bad thing' };
  // Built per relay, on demand: a table of ready promises leaves the unused ones rejecting.
  const p = pool((u) => (u === 'wss://ok' ? OK() : Promise.reject(new Error(say[u]))));
  const r = await api.publishToRelays({ pool: p, relays: ['wss://ok', 'wss://paid', 'wss://members', 'wss://list', 'wss://auth', 'wss://slow', 'wss://odd'], signed: {} });
  const code = Object.fromEntries(r.failed.map((f) => [f.url, f.code]));
  assert.equal(code['wss://paid'], 'payment');
  assert.equal(code['wss://members'], 'payment', 'a members-only refusal reads as one');
  assert.equal(code['wss://list'], 'refused');
  assert.equal(code['wss://auth'], 'auth');
  assert.equal(code['wss://slow'], 'rate');
  assert.equal(code['wss://odd'], 'other');
  assert.match(r.failed.find((f) => f.url === 'wss://odd').text, /bad thing/, "the relay's own words survive for a reason we cannot name");
});

test('one silent relay does not hold the post hostage', async () => {
  const p = pool((u) => (u === 'wss://silent' ? new Promise(() => {}) : OK()));
  const r = await api.publishToRelays({ pool: p, relays: ['wss://good', 'wss://silent'], signed: {}, capMs: 40 });
  assert.deepEqual([...r.accepted], ['wss://good']);
  assert.equal(r.failed[0].code, 'timeout');
  assert.deepEqual(p.closed, [['wss://silent']], 'only the relay that failed is reset');
});

test('when nothing took it the sockets are dropped and it is tried once more', async () => {
  const p = pool((u, round) => (round === 1 ? unreachable() : OK()));
  const r = await api.publishToRelays({ pool: p, relays: ['wss://a', 'wss://b'], signed: {} });
  assert.equal(p.rounds(), 2);
  assert.deepEqual(p.closed, [['wss://a', 'wss://b']]);
  assert.equal(r.accepted.length, 2);
});

test('when nothing ever takes it, it says so and does not loop', async () => {
  const p = pool(() => unreachable());
  const r = await api.publishToRelays({ pool: p, relays: ['wss://a'], signed: {} });
  assert.equal(p.rounds(), 2, 'one retry, not more');
  assert.equal(r.accepted.length, 0);
  assert.equal(r.failed.length, 1);
});

test('two spellings of one relay are asked once', async () => {
  let asked = [];
  const p = { close() {}, publish: (urls) => { asked = [...urls]; return urls.map(OK); } };
  await api.publishToRelays({ pool: p, relays: ['wss://a.example', 'wss://a.example/'], signed: {}, normalize: (u) => u.replace(/\/$/, '') });
  assert.deepEqual(asked, ['wss://a.example']);
});

test("two refusals with different words are two groups, so each relay's own reason survives", () => {
  const g = api.groupRefusals([
    { url: 'wss://a.example', code: 'refused', text: 'restricted: read-only' },
    { url: 'wss://b.example', code: 'refused', text: 'restricted: read-only' },
    { url: 'wss://c.example', code: 'refused', text: 'blocked: not on the list' },
  ]);
  assert.equal(g.length, 2);
  assert.deepEqual([...g[0].hosts], ['a.example', 'b.example']);
  assert.equal(g[0].text, 'restricted: read-only');
  assert.equal(g[1].text, 'blocked: not on the list');
});

test('refusals group by reason, biggest group first, with the relay hosts', () => {
  const g = api.groupRefusals([
    { url: 'wss://a.example/', code: 'payment', text: '' },
    { url: 'wss://b.example', code: 'refused', text: '' },
    { url: 'wss://c.example', code: 'payment', text: '' },
  ]);
  assert.equal(g[0].code, 'payment');
  assert.deepEqual([...g[0].hosts], ['a.example', 'c.example']);
  assert.equal(g[1].code, 'refused');
});

// ---- the tab's own relay set ----

function tabHarness({ account, handover, accountThrows }) {
  const at = tab.indexOf('  async function targetRelays()');
  const end = tab.indexOf('  const signAuth');
  assert.ok(at !== -1 && end !== -1, 'targetRelays is gone from compose.js');
  const ctx = {
    Promise, Object, console,
    state: { activePubkey: 'a'.repeat(64) },
    handoverRelays: handover || null,
    call: async (m) => {
      if (m.type !== 'SIDECAR_GET_ACCOUNT_RELAYS') throw new Error('unexpected ' + m.type);
      if (accountThrows) throw new Error('worker asleep');
      return account;
    },
  };
  vm.createContext(ctx);
  vm.runInContext(tab.slice(at, end) + '\nglobalThis.targetRelays = targetRelays;', ctx);
  return ctx;
}

test("the tab posts to the account's own relays, not only to Sidecar's defaults", async () => {
  const account = {
    'wss://declared-1': { read: true, write: true },
    'wss://read-only': { read: true, write: false },
    'wss://declared-2': { read: false, write: true },
    'wss://nos.lol': { read: true, write: true },
  };
  const r = await tabHarness({ account }).targetRelays();
  assert.deepEqual([...r], ['wss://declared-1', 'wss://declared-2', 'wss://nos.lol']);
});

test('the panel\'s handover is merged in, not chosen over the account', async () => {
  const account = { 'wss://declared': { read: true, write: true } };
  const r = await tabHarness({ account, handover: ['wss://declared', 'wss://handover-only'] }).targetRelays();
  assert.deepEqual([...r], ['wss://declared', 'wss://handover-only']);
});

test('with the worker unreachable the handover still answers, and nothing falls back to Settings', async () => {
  const ctx = tabHarness({ accountThrows: true, handover: ['wss://h'] });
  assert.deepEqual([...(await ctx.targetRelays())], ['wss://h']);
  const none = tabHarness({ accountThrows: true });
  assert.deepEqual([...(await none.targetRelays())], [], 'an empty set refuses loudly instead of posting somewhere unasked');
});

// ---- the receipt's link ----

test('the link hints the relays that took the note, not the first two configured', async () => {
  const at = tab.indexOf('  async function neventFor(signed, accepted)');
  const end = tab.indexOf('  async function showPosted(');
  assert.ok(at !== -1 && end !== -1, 'neventFor is gone from compose.js');
  let encoded;
  const ctx = {
    NT: { nip19: { neventEncode: (o) => { encoded = o; return 'nevent1x'; } } },
    targetRelays: async () => ['wss://first', 'wss://second', 'wss://third'],
  };
  vm.createContext(ctx);
  vm.runInContext(tab.slice(at, end) + '\nglobalThis.neventFor = neventFor;', ctx);
  await ctx.neventFor({ id: 'i', pubkey: 'p' }, ['wss://took-1', 'wss://took-2', 'wss://took-3']);
  assert.deepEqual([...encoded.relays], ['wss://took-1', 'wss://took-2']);
  await ctx.neventFor({ id: 'i', pubkey: 'p' }, []);
  assert.deepEqual([...encoded.relays], ['wss://first', 'wss://second'], 'with nothing known to have taken it, the configured ones');
});

// ---- the two copies of the rule agree ----

test("the panel's publishFailed and the shared one give the same answer on every shape", () => {
  const panelRule = panel.match(/const publishFailed = \(r\) =>[\s\S]*?;\n/)[0];
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(panelRule + '\nglobalThis.panelFailed = publishFailed;', ctx);
  const shapes = [
    { status: 'fulfilled', value: '' },
    { status: 'fulfilled', value: 'ok' },
    { status: 'fulfilled', value: undefined },
    { status: 'fulfilled', value: 'connection failure: boom' },
    { status: 'fulfilled', value: 'connection failure:' },
    { status: 'rejected', reason: new Error('restricted') },
    { status: 'rejected', reason: 'text' },
  ];
  for (const s of shapes) {
    assert.equal(api.publishFailed(s), ctx.panelFailed(s), JSON.stringify(s));
  }
});
