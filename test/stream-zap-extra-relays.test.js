'use strict';

// The first scan reads a few relays and finds only part of a long stream's receipts. After the
// stream is playing, a second scan reads more relays and the total grows as they answer.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../stream-core');
const { zapRelayUrl, relayHints, extraZapRelays, ZAP_ARCHIVE_RELAYS } = core;

test('only a public wss relay is worth connecting to', () => {
  assert.equal(zapRelayUrl('wss://relay.thing.net/'), 'wss://relay.thing.net');
  assert.equal(zapRelayUrl('WSS://Relay.Thing.NET'), 'wss://relay.thing.net');
  for (const bad of ['ws://relay.thing.net', 'https://relay.thing.net', 'wss://localhost', 'wss://relay.local', 'wss://10.0.0.5', 'wss://192.168.1.2',
    'wss://[::1]', 'wss://user:pw@relay.thing.net', 'wss://relay.thing.net:8080', 'wss://relay.thing.net/path', 'wss://relay.thing.net/?x=1',
    'wss://thing', 'wss://abc.onion', '', null, 7, 'wss://' + 'a'.repeat(120) + '.net']) assert.equal(zapRelayUrl(bad), null, String(bad));
});

test('a zap request names the relays it wants its receipt published to', () => {
  const request = { tags: [['p', 'x'], ['relays', 'wss://one.thing.net', 'wss://two.thing.net/', 'ws://bad.thing.net', 'wss://one.thing.net'], ['relays', 'wss://three.thing.net']] };
  assert.deepEqual(relayHints(request), ['wss://one.thing.net', 'wss://two.thing.net', 'wss://three.thing.net']);
  assert.deepEqual(relayHints(null), []);
  assert.deepEqual(relayHints({ tags: 'x' }), []);
  assert.equal(relayHints({ tags: [['relays', ...Array.from({ length: 50 }, (_, i) => 'wss://r' + i + '.thing.net')]] }).length, 20, 'one request cannot name unlimited relays');
});

test('the second scan takes the archive relays, then the most requested ones, never one already scanned', () => {
  const known = ['wss://a.thing.net', ZAP_ARCHIVE_RELAYS[0]];
  const hints = new Map([['wss://a.thing.net', 99], ['wss://b.thing.net', 5], ['wss://c.thing.net', 9], ['wss://d.thing.net', 9], ['ws://bad.thing.net', 50]]);
  const out = extraZapRelays({ known, hints });
  assert.ok(!out.includes('wss://a.thing.net') && !out.includes(ZAP_ARCHIVE_RELAYS[0]), 'already scanned');
  assert.deepEqual(out.slice(0, ZAP_ARCHIVE_RELAYS.length - 1), ZAP_ARCHIVE_RELAYS.slice(1), 'the archive list leads');
  assert.deepEqual(out.slice(ZAP_ARCHIVE_RELAYS.length - 1), ['wss://c.thing.net', 'wss://d.thing.net', 'wss://b.thing.net'], 'then by how often they were asked for');
  assert.ok(!out.some((u) => u.startsWith('ws:')));
});

test('the second scan is bounded', () => {
  const hints = new Map(Array.from({ length: 40 }, (_, i) => ['wss://r' + i + '.thing.net', i]));
  assert.equal(extraZapRelays({ hints }).length, ZAP_ARCHIVE_RELAYS.length + 5);
  assert.equal(extraZapRelays({ hints, limit: 3 }).length, 3);
  assert.deepEqual(extraZapRelays({ archive: [], hints: new Map() }), []);
});

// ---- the real player: stage two runs after stage one, pulses, and can be stopped ----
const src = fs.readFileSync(path.join(__dirname, '..', 'streams.js'), 'utf8');
const fn = src.slice(src.indexOf('  async function watchZaps('), src.indexOf('  function play('));

async function run({ extra, history, sessions = new Map() }) {
  const log = [], timers = [], scans = [];
  const out = { hidden: true, replaceChildren() {}, removeAttribute() {}, setAttribute() {}, classList: { toggle(n, on) { log.push({ counting: !!on }); } } };
  const ctx = {
    zapSessions: sessions, ZAP_EXTRA_DEADLINE: 30000, ZAP_EXTRA_BATCH: 5, SidecarI18n: { fmtNum: String }, t: (x) => x,
    setZapDigits(el, text) { log.push({ text }); }, shineZap() {}, window: { dispatchEvent() {} }, CustomEvent: class {},
    document: { getElementById: () => out }, AbortController, fetch: () => {}, relays: [], generation: 1, zapAbort: null, zapPool: null, zapRetryTimer: null,
    NostrTools: { SimplePool: class { subscribeMany() { return { close() {} }; } destroy() {} } },
    SidecarStreams: {
      ZapTotals: class { constructor() { this.count = 4; this.msats = 4000; } },
      zapTotalMark: core.zapTotalMark, zapTotalUncertain: core.zapTotalUncertain, ZAP_QUORUM: core.ZAP_QUORUM, relayHints: core.relayHints,
      zapProvider: async () => ({ nostrPubkey: 'p' }), extraZapRelays: () => extra, relayPage: async () => ({ events: [], complete: true }),
      zapHistory: async (args) => { scans.push(args); return history({ ...args, __log: log }, scans.length); },
    },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {},
  };
  vm.createContext(ctx);
  vm.runInContext(fn, ctx);
  await ctx.watchZaps({ host: 'a'.repeat(64), key: 'k', relays: [] }, 1);
  return { log, timers, scans, ctx };
}
const counting = (log) => log.filter((e) => 'counting' in e).map((e) => e.counting);

test('after the first scan, the extra relays are read five at a time, and the total pulses until they finish', async () => {
  const extra = Array.from({ length: 7 }, (_, i) => 'wss://a' + i + '.thing.net');
  const r = await run({ extra, history: async (args, n) => ({ complete: true, answered: n === 1 ? 6 : args.sources.length, truncated: false }) });
  assert.equal(r.scans.length, 3, 'the first scan, then two batches');
  assert.deepEqual(r.scans[1].sources, extra.slice(0, 5));
  assert.deepEqual(r.scans[2].sources, extra.slice(5));
  assert.match(src, /ZAP_EXTRA_BATCH=5/, 'the test context matches the player');
  assert.equal(counting(r.log).at(-1), false, 'done pulsing at the end');
  assert.ok(counting(r.log).includes(true), 'it pulsed while the extra relays were read');
  assert.equal([...r.ctx.zapSessions.values()][0].extended, true);
});

test('with no extra relays there is no second scan', async () => {
  const r = await run({ extra: [], history: async () => ({ complete: true, answered: 6, truncated: false }) });
  assert.equal(r.scans.length, 1);
});

test('a session that already read the extra relays does not read them again', async () => {
  const extra = ['wss://a1.thing.net'];
  const history = async () => ({ complete: true, answered: 6, truncated: false });
  const sessions = new Map();
  const first = await run({ extra, history, sessions });
  assert.equal(first.scans.length, 2);
  const second = await run({ extra, history, sessions });
  assert.equal(second.scans.length, 1, 'only the first scan runs again');
});

test('the total pulses while the extra relays are being read', async () => {
  let during;
  const r = await run({ extra: ['wss://a1.thing.net'], history: async (args, n) => {
    if (n === 1) return { complete: true, answered: 6, truncated: false };
    during = counting(args.__log).at(-1);
    return { complete: true, answered: 1, truncated: false };
  } });
  void r;
  assert.equal(during, true);
});

test('the second scan has a deadline of its own and stopping the player stops it', async () => {
  const extra = ['wss://a1.thing.net', 'wss://a2.thing.net'];
  let stopSignal;
  const r = await run({ extra, history: async (args, n) => { if (n === 2) stopSignal = args.signal; return { complete: true, answered: 6, truncated: false }; } });
  assert.ok(r.timers.some((t) => t.ms === 30000), 'a deadline was set');
  assert.ok(stopSignal, 'the second scan got a signal of its own');
  assert.equal(stopSignal.aborted, false);
  r.timers.find((t) => t.ms === 30000).f();
  assert.equal(stopSignal.aborted, true, 'the deadline stops the second scan');
});

test('the pulse is continuous from the first scan through the second', async () => {
  const r = await run({ extra: ['wss://a1.thing.net'], history: async () => ({ complete: true, answered: 6, truncated: false }) });
  const seq = counting(r.log);
  const lastTrue = seq.lastIndexOf(true);
  assert.ok(lastTrue >= 0);
  assert.ok(!seq.slice(0, lastTrue).includes(false), 'it never switches off and on again between the scans: ' + JSON.stringify(seq));
  assert.equal(seq.at(-1), false);
});

test('with no extra relays the pulse ends with the first scan', async () => {
  const r = await run({ extra: [], history: async () => ({ complete: true, answered: 6, truncated: false }) });
  assert.equal(counting(r.log).at(-1), false);
});
