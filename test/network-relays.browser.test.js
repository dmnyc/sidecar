'use strict';

// A RELAY THAT TAKES NO CHANCE IS LEFT OUT OF THE BUILD, NOT LEFT TO FAIL IT. Since 1.19.1 a
// batch of follow lists counted only if every relay answered, and a relay that throttles heavy
// reads (it stayed silent on the first 8-second ask, batch after batch) failed every batch it
// slowed: the build failed, tried again ten minutes later, and failed again. Now a relay silent
// on both asks of a batch (24 seconds) is left out of the rest of the build, and the batch
// counts with what the others sent; so is one that never connected. A batch no relay answered
// is still unread, the build is not kept, and Settings names the relays that gave no answer.
// Against the REAL extension, with a second local relay as the slow one, and purplepag.es
// unresolvable so the outcome does not depend on the internet.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep, _internals: { SK, startRelay } } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 240000 };
const NO_PURPLE = ['--host-resolver-rules=MAP purplepag.es ~NOTFOUND'];

// 120 follows, so three batches of 50: two asked at once, then the third.
const FOLLOWS = Array.from({ length: 120 }, (_, i) => 'r' + i);
FOLLOWS.forEach((name, i) => { SK[name] = (0x1000 + i).toString(16).padStart(4, '0').repeat(16); });
SK.zed = '3f'.repeat(32);

const isBatch = (filters) => filters.some((f) => (f.kinds || []).includes(3) && (f.authors || []).length > 1);

// Me follows all 120; each follows Zed, so Zed is in by far more than ten votes.
function seedInto(x, put) {
  const now = Math.floor(Date.now() / 1000);
  const pk = (who) => x.nt.pubkey(who);
  put({ kind: 3, created_at: now - 9000, tags: FOLLOWS.map((f) => ['p', pk(f)]), content: '' }, 'me');
  FOLLOWS.forEach((f) => put({ kind: 3, created_at: now - 8000, tags: [['p', pk('zed')]], content: '' }, f));
}

const networkLog = async (x) => {
  const r = await x.message({ type: 'SIDECAR_GET_DEBUG_LOG' });
  return ((r && (Array.isArray(r) ? r : r.result)) || []).filter((e) => e.tag === 'network').map((e) => e.msg);
};
const status = (x) => x.evaluate(`(document.getElementById('wot-status') || {}).textContent || ''`);

test('a relay silent on both asks is left out, and the build finishes whole from the others', opts, async (t) => {
  // The slow relay holds every batch for a minute: past ask 1 (8s) and ask 2 (16s).
  const slow = await startRelay({ delayMs: (filters) => (isBatch(filters) ? 60000 : 0) });
  let x;
  try { x = await startExtension({ chromeArgs: NO_PURPLE }); } catch (e) { slow.close(); if (e.skip) return t.skip(e.message); throw e; }
  try {
    seedInto(x, (ev, who) => x.put(ev, who));
    await x.message({ type: 'SIDECAR_SET_RELAYS', relays: { [x.relay.url]: { read: true, write: true }, [slow.url]: { read: true, write: true } } });
    const t0 = Date.now();
    await x.reload();
    await x.waitFor(`/Your network: |Couldn/.test((document.getElementById('wot-status') || {}).textContent || '')`, 120000);
    const took = Date.now() - t0;
    // You, 120 follows and Zed.
    assert.match(await status(x), /Your network: 122 people/, 'the build did not finish whole');
    const log = (await networkLog(x)).join('\n');
    assert.match(log, new RegExp('left out of the rest of this build: ' + slow.url.replace(/^wss?:\/\//, '').replace(/\/$/, '').replace(/[.]/g, '\\.') + ' \\(silent on both asks\\)'), log);
    // Left out after the first two batches, so the third never waits on it.
    assert.match(log, /batch 3\/3 ask 1 \d+ms, 20 lists · 1 answered/, log);
    assert.doesNotMatch(log, /batch 3\/3 ask 2/);
    assert.ok(took < 60000, 'took ' + took + 'ms');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); slow.close(); }
});

test('with no relay answering, the build is not kept, and Settings names the relays', opts, async (t) => {
  let x;
  try { x = await startExtension({ chromeArgs: NO_PURPLE, relayDelayMs: (filters) => (isBatch(filters) ? 60000 : 0) }); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    seedInto(x, (ev, who) => x.put(ev, who));
    await x.reload();
    // (The bar counting failed batches too is wot.test.js's: here they all settle at once.)
    await x.waitFor(`/Couldn|Your network: /.test((document.getElementById('wot-status') || {}).textContent || '')`, 120000);
    // Settings, open on the network section.
    await x.evaluate(`document.getElementById('settings-btn').click()`); await sleep(800);
    await x.evaluate(`(() => { const s = document.querySelector('[data-section="notifications"]'); if (!s.classList.contains('open')) s.querySelector('.settings-section-toggle').click(); })()`); await sleep(400);
    const line = await status(x);
    assert.match(line, /Couldn’t reach your relays/);
    const host = x.relay.url.replace(/^wss?:\/\//, '').replace(/\/$/, '');
    assert.ok(line.includes('No answer from ') && line.includes(host), line);
    const kept = await x.evaluate(`new Promise((r) => chrome.storage.local.get('sidecar_wot', (g) => r(g.sidecar_wot || null)))`);
    assert.ok(!kept || !kept.sets || !kept.sets[x.me], 'a build with unread batches was kept');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('a relay left out that held the lists does not leave a thin network behind', opts, async (t) => {
  // The relay with every list stays silent on the batches; another answers at once with
  // nothing. Counting that answer kept a network of nearly no one, for a day.
  const empty = await startRelay();
  let x;
  try { x = await startExtension({ chromeArgs: NO_PURPLE, relayDelayMs: (filters) => (isBatch(filters) ? 60000 : 0) }); } catch (e) { empty.close(); if (e.skip) return t.skip(e.message); throw e; }
  try {
    seedInto(x, (ev, who) => x.put(ev, who));
    await x.message({ type: 'SIDECAR_SET_RELAYS', relays: { [x.relay.url]: { read: true, write: true }, [empty.url]: { read: true, write: true } } });
    await x.reload();
    await x.waitFor(`/Couldn|Your network: /.test((document.getElementById('wot-status') || {}).textContent || '')`, 120000);
    assert.match(await status(x), /Couldn’t reach your relays/);
    const log = (await networkLog(x)).join('\n');
    assert.match(log, /DROPPED: without the relays left out, only 0 of 50 lists/, log);
    const kept = await x.evaluate(`new Promise((r) => chrome.storage.local.get('sidecar_wot', (g) => r(g.sidecar_wot || null)))`);
    assert.ok(!kept || !kept.sets || !kept.sets[x.me], 'a thin network was kept');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); empty.close(); }
});
