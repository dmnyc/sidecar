'use strict';

// A NETWORK IS KEPT FOR EACH OF THE LAST FEW ACCOUNTS, not for the active one alone. Up to
// 1.19.1 one copy was kept, so every switch built the new account's network from nothing,
// and switching back built the first one again, a minute or more each way on a large follow
// list with the bar running. And reading a kept network back flashed the bar up as if it
// were being built. Now switching back reads the kept copy, sends no follow-list batches and
// shows no bar; a store from 1.19.1 is read as is; and networks are kept for every account
// you use until they pass a budget of space, the one used longest ago going first.
// Against the REAL extension and a relay on localhost.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep, _internals: { SK } } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 180000 };

const FOLLOWS = Array.from({ length: 12 }, (_, i) => 'g' + i);
FOLLOWS.forEach((name, i) => { SK[name] = (0x40 + i).toString(16).padStart(2, '0').repeat(32); });
SK.zed = '3f'.repeat(32);
SK.other = '5e'.repeat(32);

// A batch of other people's follow lists: what a build asks for, and nothing else does.
const isBatch = (filters) => filters.some((f) => (f.kinds || []).includes(3) && (f.authors || []).length > 1);

async function withExtension(t, fn) {
  let batches = 0;
  const spy = (filters) => { if (isBatch(filters)) batches++; return 0; };
  let x;
  try { x = await startExtension({ relayDelayMs: spy }); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try { await fn(x, () => batches); } finally { x.close(); }
}

// Me: twelve follows who each follow Zed. Other: follows Zed alone.
function seed(x) {
  const now = Math.floor(Date.now() / 1000);
  const pk = (who) => x.nt.pubkey(who);
  x.put({ kind: 3, created_at: now - 9000, tags: FOLLOWS.map((f) => ['p', pk(f)]), content: '' }, 'me');
  x.put({ kind: 3, created_at: now - 9000, tags: [['p', pk('zed')]], content: '' }, 'other');
  FOLLOWS.forEach((f) => x.put({ kind: 3, created_at: now - 8000, tags: [['p', pk('zed')]], content: '' }, f));
  x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Zed' }) }, 'zed');
}

const store = (x) => x.evaluate(`new Promise((r) => chrome.storage.local.get('sidecar_wot', (g) => r(g.sidecar_wot || null)))`);
const setStore = (x, v) => x.evaluate(`new Promise((r) => chrome.storage.local.set({ sidecar_wot: ${JSON.stringify(v)} }, r))`);
const status = (x) => x.evaluate(`(document.getElementById('wot-status') || {}).textContent || ''`);
const barShown = `(() => { const b = document.getElementById('network-status'); return !!b && !b.classList.contains('hidden'); })()`;

// Reloads the panel and watches the foot bar until the network is in, from the first moment.
async function openAndWatch(x, want) {
  await x.reload();
  let bar = false;
  const end = Date.now() + 40000;
  while (Date.now() < end) {
    if (await x.evaluate(barShown)) bar = true;
    if (want.test(await status(x))) break;
    await sleep(150);
  }
  for (let i = 0; i < 8; i++) { if (await x.evaluate(barShown)) bar = true; await sleep(150); }
  return { bar, status: await status(x) };
}

test('switching away and back keeps both networks, and coming back builds nothing', opts, async (t) => {
  await withExtension(t, async (x, batches) => {
    seed(x);
    const me = x.me;
    const other = x.nt.pubkey('other');
    // Me: you, twelve follows and Zed.
    const first = await openAndWatch(x, /Your network: 14 people/);
    assert.match(first.status, /Your network: 14 people/);
    assert.ok(first.bar, 'a real build shows the bar');
    assert.ok(batches() > 0);

    const add = await x.message({ type: 'SIDECAR_ADD_ACCOUNT', secret: SK.other, name: 'Other' });
    assert.ok(add && add.ok !== false, JSON.stringify(add));
    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: other });
    // Other: itself and Zed.
    const second = await openAndWatch(x, /Your network: 2 people/);
    assert.match(second.status, /Your network: 2 people/);
    const both = await store(x);
    assert.deepEqual(Object.keys((both && both.sets) || {}).sort(), [me, other].sort(), 'both networks are kept');

    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: me });
    const before = batches();
    const back = await openAndWatch(x, /Your network: 14 people/);
    assert.match(back.status, /Your network: 14 people/, 'the kept network is back');
    assert.equal(batches(), before, 'coming back asked for follow lists again');
    assert.equal(back.bar, false, 'the bar came up for a network that was only read back');
    assert.deepEqual(x.errors, []);
  });
});

test('a network kept by 1.19.1 is read as it is, with no build and no bar', opts, async (t) => {
  await withExtension(t, async (x, batches) => {
    seed(x);
    const keys = ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc'];
    await setStore(x, { pubkey: x.me, algo: 2, keys, seen: 3, qualified: 1, ts: Date.now() });
    const r = await openAndWatch(x, /Your network: 3 people/);
    assert.match(r.status, /Your network: 3 people/);
    assert.equal(batches(), 0, 'it built the network again');
    assert.equal(r.bar, false);
    assert.deepEqual(x.errors, []);
  });
});

test('every account you use keeps its network: five ordinary ones all stay', opts, async (t) => {
  await withExtension(t, async (x) => {
    seed(x);
    const now = Date.now();
    const others = ['1', '2', '3', '4'].map((d) => d.repeat(64));
    const sets = Object.fromEntries(others.map((pk, i) => [pk, { pubkey: pk, algo: 2, keys: ['dddddddddddddddd'], seen: 1, qualified: 0, ts: now - 60000, used: now - 5000 + i }]));
    await setStore(x, { sets });
    await openAndWatch(x, /Your network: 14 people/);
    await sleep(500);
    const kept = Object.keys(((await store(x)) || {}).sets || {}).sort();
    assert.deepEqual(kept, [x.me, ...others].sort(), 'kept ' + JSON.stringify(kept));
    assert.deepEqual(x.errors, []);
  });
});

test('past the space budget, the network used longest ago goes first', opts, async (t) => {
  await withExtension(t, async (x) => {
    seed(x);
    // Two networks of 90,000 people, about 1.7 MB each: with this account's they pass 3 MB.
    const a = '1'.repeat(64), b = '2'.repeat(64);
    await x.evaluate(`(() => {
      const now = Date.now();
      const big = (pk, used, salt) => ({ pubkey: pk, algo: 2, keys: Array.from({ length: 90000 }, (_, i) => (salt + i.toString(16)).padStart(16, '0')), seen: 90000, qualified: 0, ts: now - 60000, used });
      return new Promise((r) => chrome.storage.local.set({ sidecar_wot: { sets: { ${JSON.stringify(a)}: big(${JSON.stringify(a)}, now - 2000, 'a'), ${JSON.stringify(b)}: big(${JSON.stringify(b)}, now - 1000, 'b') } } }, r));
    })()`);
    await openAndWatch(x, /Your network: 14 people/);
    await sleep(800);
    const kept = Object.keys(((await store(x)) || {}).sets || {}).sort();
    assert.deepEqual(kept, [x.me, b].sort(), 'kept ' + JSON.stringify(kept));
    assert.deepEqual(x.errors, []);
  });
});

test('switching accounts mid-build: each network is its own, the bar follows the account on screen, and the new one builds by itself', opts, async (t) => {
  // Hold Me's follow-list batches for five seconds, so the switch lands mid-build.
  const meFollows = new Set();
  let x;
  const delay = (filters) => (isBatch(filters) && filters.some((f) => (f.authors || []).some((a) => meFollows.has(a))) ? 5000 : 0);
  try { x = await startExtension({ relayDelayMs: delay }); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    FOLLOWS.forEach((f) => meFollows.add(x.nt.pubkey(f)));
    seed(x);
    // Other follows Zed and Hal; Hal is the one who must not turn up in Me's network.
    SK.hal = '6f'.repeat(32);
    const now = Math.floor(Date.now() / 1000);
    x.put({ kind: 3, created_at: now - 100, tags: [['p', x.nt.pubkey('zed')], ['p', x.nt.pubkey('hal')]], content: '' }, 'other');
    const me = x.me;
    const other = x.nt.pubkey('other');
    await x.message({ type: 'SIDECAR_ADD_ACCOUNT', secret: SK.other, name: 'Other' });
    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: me });
    await x.reload();
    await x.waitFor(`(document.getElementById('network-status') || {}).textContent && document.getElementById('network-status').textContent.includes('Building network')`, 20000);

    // Switch while Me's batches are held.
    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: other });
    const lines = new Set();
    let otherStatus = '';
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      const b = await x.evaluate(`(() => { const b = document.getElementById('network-status'); return b && !b.classList.contains('hidden') ? b.textContent.trim() : ''; })()`);
      if (b) lines.add(b);
      otherStatus = await status(x);
      const kept = (await store(x)) || {};
      if (/Your network: 3 people/.test(otherStatus) && kept.sets && kept.sets[me]) break;
      await sleep(200);
    }
    // Other built on its own (Other, Zed, Hal), with no bell opened.
    assert.match(otherStatus, /Your network: 3 people/, 'the account on screen did not get its network: ' + otherStatus);
    // The bar never ended on Me's count while Other was on screen.
    assert.ok(![...lines].some((l) => /14 people/.test(l)), 'the bar showed the other account\'s count: ' + JSON.stringify([...lines]));
    // Me's network was finished and kept for Me, with none of Other's follows in it.
    const kept = (await store(x)).sets;
    assert.ok(kept[me], 'the build for the account switched away from was lost');
    assert.equal(kept[me].keys.length, 14);
    assert.ok(!kept[me].keys.includes(x.nt.pubkey('hal').slice(0, 16)), 'another account\'s follow went into this network');
    assert.ok(kept[other] && kept[other].keys.includes(x.nt.pubkey('hal').slice(0, 16)));
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('right after a switch, the bar never shows the account switched away from', opts, async (t) => {
  // Hold Other's own follow list for two seconds, so its build sits at its start for a while:
  // the moment the last build's "done of total" showed, before the first batch came back.
  let x;
  let otherPk = null;
  const delay = (filters) => (otherPk && filters.some((f) => (f.kinds || []).includes(3) && (f.authors || []).length === 1 && f.authors[0] === otherPk) ? 2000 : 0);
  try { x = await startExtension({ relayDelayMs: delay }); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    seed(x);
    const other = x.nt.pubkey('other');
    await x.message({ type: 'SIDECAR_ADD_ACCOUNT', secret: SK.other, name: 'Other' });
    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: x.me });
    otherPk = other;
    // Me builds: twelve follows, fourteen people. Switch the moment it ends, while the bar
    // still reports Me's network.
    await openAndWatch(x, /Your network: 14 people/);
    const bar = `(() => { const b = document.getElementById('network-status'); return b && !b.classList.contains('hidden') ? b.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`;
    assert.match(await x.evaluate(bar), /14 people/, 'the result line was not up to begin with');
    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: other });
    // From the moment the panel shows Other as the account: before that it has not heard of
    // the switch, and Me's line is still rightly Me's.
    await x.waitFor(`(document.getElementById('acct-btn') || {}).title.includes('Other')`, 10000);

    const seen = [];
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      const b = await x.evaluate(bar);
      if (b && seen[seen.length - 1] !== b) seen.push(b);
      if (/Your network: 2 people/.test(await status(x))) break;
      await sleep(60);
    }
    assert.match(await status(x), /Your network: 2 people/);
    // Seen only after the switch landed: once the panel is on Other, nothing of Me's.
    const meLines = seen.filter((l) => /14 people|12\s*\/\s*12|\/\s*12\b/.test(l));
    assert.deepEqual(meLines, [], 'the bar showed the account switched away from: ' + JSON.stringify(seen));
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('the bell opened right after a switch sorts by the kept network and shows its size at the foot', opts, async (t) => {
  // Me's build is held for a minute, so it is still running when the panel switches to
  // Other: Other's kept network used to wait behind it, and the bell opened with none.
  let x;
  const meFollows = new Set();
  const delay = (filters) => (isBatch(filters) && filters.some((f) => (f.authors || []).some((a) => meFollows.has(a))) ? 60000 : 0);
  try { x = await startExtension({ relayDelayMs: delay }); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    FOLLOWS.forEach((f) => meFollows.add(x.nt.pubkey(f)));
    seed(x);
    const other = x.nt.pubkey('other');
    await x.message({ type: 'SIDECAR_ADD_ACCOUNT', secret: SK.other, name: 'Other' });
    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: x.me });
    // Other's network is kept: 3 people.
    const now = Date.now();
    await setStore(x, { sets: { [other]: { pubkey: other, algo: 2, keys: ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', other.slice(0, 16)], seen: 2, qualified: 0, ts: now - 60000, used: now - 60000 } } });
    await x.reload();
    await x.waitFor(`(document.getElementById('network-status') || {}).textContent && document.getElementById('network-status').textContent.includes('Building network')`, 20000);

    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: other });
    await x.waitFor(`(document.getElementById('acct-btn') || {}).title.includes('Other')`, 10000);
    await x.evaluate(`document.getElementById('notif-bell-btn').click()`);
    await x.waitFor(`!!document.querySelector('#modal .notif-rebuild-foot')`, 5000).catch(() => {});
    const foot = await x.evaluate(`(() => { const f = document.querySelector('#modal .notif-rebuild-foot'); return f ? f.textContent : null; })()`);
    assert.ok(foot, 'the bell had no network line at its foot');
    assert.match(foot, /Your network: 3 people\./);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
