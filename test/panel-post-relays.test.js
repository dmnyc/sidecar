'use strict';

// The side panel's composer already posted to the account's own relays and counted only the
// ones that accepted the note. Two things it did not do: its banner's link hinted the first
// two write relays whether or not they had the note, and a partial success said nothing about
// the relays that refused. These run the real publishToRelays, neventFor and showPostBanner
// from sidepanel.js, with the shared row from composer-core.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');

function lift(src, decl) {
  const at = src.indexOf(decl);
  assert.ok(at !== -1, 'missing ' + decl);
  const open = src.indexOf('{', src.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

// The shared core's pieces, run for real.
function coreApi(h, t, tn) {
  const ctx = vm.createContext({ h, t, tn, URL, Promise, setTimeout, clearTimeout });
  vm.runInContext([
    core.slice(core.indexOf('  const PUBLISH_CAP_MS'), core.indexOf('  async function publishToRelays({')),
    lift(core, 'function groupRefusals('), lift(core, 'function refusalLines('),
    lift(core, 'function acceptedLine('), lift(core, 'function relayReportNode('),
    'this.api = { publishRefusal, relayReportNode };',
  ].join('\n'), ctx);
  return ctx.api;
}
const fill = (s, v) => (v ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k]) : s);
const tn = (one, other, n) => fill(n === 1 ? one : other, { count: n });

// ---- the publish reports which relays accepted it ----

function publishHarness(behaviors) {
  const ctx = vm.createContext({
    Promise, Set, String, setTimeout, clearTimeout, Error,
    NT: { utils: { normalizeURL: (u) => u } },
    resetPoolRelays: () => {},
    poolPublish: (targets) => targets.map((u) => behaviors[u]()),
    publishFailureMessage: () => 'every relay failed',
    window: { SidecarCore: coreApi(() => ({}), fill, tn) },
  });
  vm.runInContext([
    panel.match(/const publishFailed = \(r\) =>[\s\S]*?;\n/)[0],
    panel.match(/const PUBLISH_RELAY_CAP_MS = \d+;/)[0].replace(/\d+/, '50'),
    lift(panel, 'function capPublish(p)'),
    lift(panel, 'async function publishToRelays(relays, signed, report)'),
    'this.publish = publishToRelays;',
  ].join('\n'), ctx);
  return ctx;
}

test('the panel publish says which relays accepted it, and why the others did not', async () => {
  const ctx = publishHarness({
    'wss://a': () => Promise.resolve(''),
    'wss://paid': () => Promise.reject(new Error('blocked: payment required')),
    'wss://dead': () => Promise.resolve('connection failure: Error: connection timed out'),
    'wss://b': () => Promise.resolve(''),
  });
  const report = {};
  const ok = await ctx.publish(['wss://a', 'wss://paid', 'wss://dead', 'wss://b'], { id: 'x' }, report);
  assert.equal(ok, 2, 'the count every other caller reads is unchanged');
  assert.deepEqual([...report.accepted], ['wss://a', 'wss://b']);
  assert.deepEqual(Array.from(report.failed, (f) => [f.url, f.code]), [['wss://paid', 'payment'], ['wss://dead', 'timeout']]);
  assert.equal(report.total, 4);
});

test('a caller that passes no report gets exactly what it got before', async () => {
  const ctx = publishHarness({ 'wss://a': () => Promise.resolve('') });
  assert.equal(await ctx.publish(['wss://a'], { id: 'x' }), 1);
});

// ---- the banner's link ----

test("the banner's link hints relays that accepted the note", async () => {
  let encoded;
  const ctx = vm.createContext({
    NT: { nip19: { neventEncode: (o) => { encoded = o; return 'nevent1x'; } } },
    postRelays: async () => ['wss://first-refused', 'wss://second', 'wss://third'],
  });
  vm.runInContext(lift(panel, 'async function neventFor(signed, accepted)') + '\nthis.f = neventFor;', ctx);
  await ctx.f({ id: 'i', pubkey: 'p' }, ['wss://took-1', 'wss://took-2', 'wss://took-3']);
  assert.deepEqual([...encoded.relays], ['wss://took-1', 'wss://took-2']);
  await ctx.f({ id: 'i', pubkey: 'p' });
  assert.deepEqual([...encoded.relays], ['wss://first-refused', 'wss://second'], 'nothing known: the write relays, as before');
});

// ---- the banner ----

function el(tag) {
  const e = { tag, children: [], classes: new Set(), listeners: {}, textContent: '', open: false };
  e.classList = {
    add: (...c) => c.forEach((x) => e.classes.add(x)), remove: (c) => e.classes.delete(c),
    toggle: (c, on) => (on ? e.classes.add(c) : e.classes.delete(c)), contains: (c) => e.classes.has(c),
  };
  e.append = (...k) => { e.children.push(...k); };
  e.addEventListener = (type, fn) => { e.listeners[type] = fn; };
  Object.defineProperty(e, 'innerHTML', { get: () => '', set: () => { e.children = []; } });
  return e;
}
const texts = (n) => [n.textContent, ...(n.children || []).flatMap(texts)].filter(Boolean);

function bannerHarness() {
  const banner = el('div');
  const timers = { set: 0, cleared: 0 };
  const h = (tag, props, kids) => { const e = el(tag); Object.assign(e, props || {}); if (kids) e.append(...kids); return e; };
  const ctx = vm.createContext({
    $: (id) => (id === 'post-banner' ? banner : null),
    call: async () => ({}),
    resolveClient: () => ({ url: (n) => 'https://client.example/' + n, label: 'Jumble' }),
    neventFor: async (signed, accepted) => 'nevent1' + ((accepted || []).join(',') || 'none'),
    h, icon: () => el('svg'), show: () => {}, hide: () => {},
    document: { createElement: (tag) => el(tag) },
    POLL_KIND: 1068, t: fill, state: { activePubkey: 'pk' },
    dismissPostBanner: () => {}, openPollResults: () => {},
    setTimeout: () => { timers.set++; return 1; }, clearTimeout: () => { timers.cleared++; },
    _postBannerTimer: null,
    window: { SidecarCore: coreApi(h, fill, tn) },
  });
  vm.runInContext(lift(panel, 'async function showPostBanner(signed, isReply, report)') + '\nthis.runBanner = showPostBanner;', ctx);
  return { ctx, banner, timers };
}

test('when every relay accepted it, the banner is the one row it always was', async () => {
  const b = bannerHarness();
  await b.ctx.runBanner({ kind: 1, pubkey: 'pk' }, true, { accepted: ['wss://a', 'wss://b'], failed: [], total: 2 });
  assert.ok(!b.banner.classes.has('post-banner-stacked'));
  assert.deepEqual(b.banner.children.map((k) => k.tag), ['span', 'a', 'button'], 'message, link, dismiss');
});

test('when some refused, the shared row goes under the message and opens onto the detail', async () => {
  const b = bannerHarness();
  await b.ctx.runBanner({ kind: 1, pubkey: 'pk' }, true, {
    accepted: ['wss://relay.azzamo.net', 'wss://nostr.land', 'wss://filter.nostr.wine'],
    failed: [{ url: 'wss://feed.zap.cooking', code: 'refused', text: 'restricted: read-only' }, { url: 'wss://nos.lol', code: 'timeout', text: '' }],
    total: 5,
  });
  assert.ok(b.banner.classes.has('post-banner-stacked'), 'a row with words takes the stacked layout');
  const row = b.banner.children.find((k) => k.tag === 'details');
  assert.ok(row && row.classes.has('post-banner-relays'), 'the row is in the banner');
  assert.equal(row.children[0].textContent, 'Published to 3 relays.');
  const said = texts(row);
  assert.ok(said.includes('Accepted it: relay.azzamo.net, nostr.land, filter.nostr.wine.'), JSON.stringify(said));
  assert.ok(said.includes('Refused by feed.zap.cooking: restricted: read-only'), JSON.stringify(said));
  assert.ok(said.includes('nos.lol timed out.'), JSON.stringify(said));
  // Opening it stops the minute's countdown, so it does not vanish while being read.
  const before = b.timers.cleared;
  row.open = true;
  b.ctx._postBannerTimer = 7;
  row.listeners.toggle();
  assert.ok(b.timers.cleared > before, 'the auto-dismiss is cancelled when the row is opened');
});

test('the composer hands the report to the banner', () => {
  assert.match(panel, /lastPublishReport = \{\};\n\s*await publishSigned\(signed, lastPublishReport\);/);
  assert.match(panel, /showPostBanner\(signed, !!replyTo, lastPublishReport\);/);
});
