'use strict';

// THE NETWORK BUILD'S TRACE in the debug log (unpacked builds, behind the bug button). A
// build that hangs or fails says nothing on screen about why, and the why is nearly always
// one relay. Each build logs its start, its own follow list, every batch with each relay's
// outcome, and how it ended: done and kept, or failed and why. Against the REAL extension,
// which the tests load unpacked, so the log is on.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep, _internals: { SK } } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 180000 };

const FOLLOWS = Array.from({ length: 3 }, (_, i) => 'd' + i);
FOLLOWS.forEach((name, i) => { SK[name] = (0x70 + i).toString(16).padStart(2, '0').repeat(32); });
SK.zed = '3f'.repeat(32);

const isBatch = (filters) => filters.some((f) => (f.kinds || []).includes(3) && (f.authors || []).length > 1);

function seed(x) {
  const now = Math.floor(Date.now() / 1000);
  const pk = (who) => x.nt.pubkey(who);
  x.put({ kind: 3, created_at: now - 9000, tags: FOLLOWS.map((f) => ['p', pk(f)]), content: '' }, 'me');
  FOLLOWS.forEach((f) => x.put({ kind: 3, created_at: now - 8000, tags: [['p', pk('zed')]], content: '' }, f));
}

const networkLog = async (x) => { const r = await x.message({ type: 'SIDECAR_GET_DEBUG_LOG' }); return ((r && (Array.isArray(r) ? r : r.result)) || []).filter((e) => e.tag === 'network').map((e) => e.msg); };

test('a build that works logs its follow list, each batch with every relay, and the network it kept', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    seed(x);
    await x.reload();
    await x.waitFor(`/Your network: /.test((document.getElementById('wot-status') || {}).textContent || '')`, 40000).catch(() => {});
    let log = [];
    for (let i = 0; i < 30 && !log.some((m) => /build done/.test(m)); i++) { await sleep(300); log = await networkLog(x); }
    const text = log.join('\n');
    assert.match(text, /: building/);
    assert.match(text, /own follow list 3 follows · \d+ answered/);
    assert.match(text, /reading 3 follow lists in batches of 50 from \d+ relays/);
    assert.match(text, /batch 1\/1 ask 1 \d+ms, 3 lists · \d+ answered/);
    assert.match(text, /build done in \d+s: 4 people from 3 follows, kept/);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('a relay that holds a batch past both asks is named as silent, and the build is logged as failed', opts, async (t) => {
  let x;
  // Every batch of other people's follow lists held for 30 seconds: past ask 1 (8s) and
  // ask 2 (16s), so the relay connected and then said nothing, twice.
  try { x = await startExtension({ relayDelayMs: (filters) => (isBatch(filters) ? 30000 : 0) }); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    seed(x);
    await x.reload();
    let log = [];
    for (let i = 0; i < 160 && !log.some((m) => /build FAILED/.test(m)); i++) { await sleep(300); log = await networkLog(x); }
    const text = log.join('\n');
    assert.match(text, /batch 1\/1 ask 1 \d+ms, 0 lists · \d+ answered · \d+ silent: \S+/, text);
    assert.match(text, /batch 1\/1 ask 2 \d+ms, 0 lists · \d+ answered · \d+ silent: /);
    assert.match(text, /still waiting after 1\ds on /, 'the wait was not reported while it ran');
    assert.match(text, /batch 1\/1 DROPPED/);
    assert.match(text, /build FAILED after \d+s: read 0 of 3 follows/);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('a long session keeps every build in the copied log, and routine reads stay out of it', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    seed(x);
    await x.reload();
    let log = [];
    for (let i = 0; i < 40 && !log.some((m) => /build done/.test(m)); i++) { await sleep(300); log = await networkLog(x); }
    assert.ok(log.some((m) => /build done/.test(m)), 'the build never finished');
    // 700 logged messages roll the 600-line log over: the build's lines leave memory.
    await x.evaluate(`Promise.all(Array.from({ length: 700 }, () => new Promise((r) => chrome.runtime.sendMessage({ type: 'SIDECAR_GET_STATE' }, r))))`);
    // And the panel's routine reads, which used to fill it.
    await x.evaluate(`Promise.all(Array.from({ length: 50 }, () => new Promise((r) => chrome.runtime.sendMessage({ type: 'SIDECAR_GET_SETTINGS' }, r))))`);
    const r = await x.message({ type: 'SIDECAR_GET_DEBUG_LOG' });
    const all = (r && (Array.isArray(r) ? r : r.result)) || [];
    const text = all.filter((e) => e.tag === 'network').map((e) => e.msg).join('\n');
    assert.match(text, /: building/, 'the start of the build was pushed out');
    assert.match(text, /build done/);
    assert.equal(all.filter((e) => e.msg === 'SIDECAR_GET_SETTINGS').length, 0, 'routine reads are in the log');
    for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].ts <= all[i].ts, 'the log is not in order');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
