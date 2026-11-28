'use strict';

// THE NETWORK IS READ WHOLE OR NOT KEPT. A build counted a batch of follow lists as read the
// moment ANY relay answered, so one quick relay holding a few lists passed it while the
// relays holding the rest were still quiet. The network came out at a third of its size,
// looked whole, and was kept for a day: real people's replies sorted as strangers. Now a
// batch with a relay that connected and said nothing is asked again, and if it is still
// quiet nothing is kept and nothing is sorted by it. The build shows in a bar at the foot of
// the panel and of Settings, and a follow joins the network at once. Against the REAL
// extension and relays on localhost.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep, _internals: { startRelay, SK } } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 180000 };

// Twelve follows, each of whom follows Zed, so Zed is in the network by their votes (ten
// needed) and only if their lists were read.
const FOLLOWS = Array.from({ length: 12 }, (_, i) => 'f' + i);
FOLLOWS.forEach((name, i) => { SK[name] = (0x20 + i).toString(16).padStart(2, '0').repeat(32); });
SK.zed = '3f'.repeat(32);

// A batch of other people's follow lists: what the build asks for, and nothing else does.
const isBatch = (filters) => filters.some((f) => (f.kinds || []).includes(3) && (f.authors || []).length > 1);

async function setUp(x, holder) {
  const now = Math.floor(Date.now() / 1000);
  const pk = (who) => x.nt.pubkey(who);
  x.put({ kind: 3, created_at: now - 9000, tags: FOLLOWS.map((f) => ['p', pk(f)]), content: '' }, 'me');
  x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Zed' }) }, 'zed');
  // Two lists on the quick relay; the other ten only on `holder`.
  FOLLOWS.forEach((f, i) => {
    const ev = x.nt.sign({ kind: 3, created_at: now - 8000, tags: [['p', pk('zed')]], content: '' }, f);
    (i < 2 ? x.relay.events : holder.events).push(ev);
  });
  const mine = x.put({ kind: 1, created_at: now - 7200, tags: [], content: 'A note of mine' }, 'me');
  // A reaction, so the spam check (which reads replies) has nothing to say about it.
  x.put({ kind: 7, created_at: now - 600, tags: [['e', mine.id], ['p', x.me], ['k', '1']], content: '+' }, 'zed');
  await x.message({ type: 'SIDECAR_SET_RELAYS', relays: { [x.relay.url]: { read: true, write: true }, [holder.url]: { read: true, write: true } } });
  await x.reload();
}

const stored = (x) => x.evaluate(`new Promise((r) => chrome.storage.local.get('sidecar_wot', (g) => r(g.sidecar_wot || null)))`);
const bar = (id) => `(() => { const b = document.getElementById('${id}'); return b && !b.classList.contains('hidden') ? b.textContent.trim() : ''; })()`;

test('a relay that stays quiet on the follow lists: nothing is kept, nothing is sorted, and the bar says so', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  const quiet = await startRelay({ delayMs: (filters) => (isBatch(filters) ? 120000 : 0) });
  try {
    await setUp(x, quiet);
    // The bar comes up while the build runs, with the shared spinner.
    let barSeen = false;
    for (let i = 0; i < 60 && !barSeen; i++) { barSeen = (await x.evaluate(bar('network-status'))).startsWith('Building network'); if (!barSeen) await sleep(250); }
    const spinner = barSeen && await x.evaluate(`!!document.querySelector('#network-status .toast-spin')`);
    // The line stays short; the count of follows read goes in the capsule beside it.
    let capsule = '';
    for (let i = 0; i < 40 && !capsule; i++) { capsule = await x.evaluate(`(() => { const c = document.querySelector('#network-status .network-status-count'); return c && !c.classList.contains('hidden') ? c.textContent : ''; })()`); if (!capsule) await sleep(250); }
    const barLine = await x.evaluate(`(document.querySelector('#network-status .network-status-line') || {}).textContent || ''`);
    // The build ends (8s, then a 16s second ask), read from Settings' own line.
    await x.waitFor(`(() => { const t = (document.getElementById('wot-status') || {}).textContent || ''; return t && !t.startsWith('Working out'); })()`, 60000);
    await sleep(500);
    assert.equal(await stored(x), null, 'a partial network was kept');
    // Zed is not sorted outside a network that was never read.
    await x.evaluate(`document.getElementById('notif-bell-btn').click()`);
    await x.waitFor(`/Zed/.test((document.querySelector('#modal .notif-list') || {}).textContent || '')`, 15000);
    assert.ok(!(await x.evaluate(`!!document.querySelector('#modal .notif-offnet')`)), 'someone was sorted outside a partial network');
    // The bar showed the work, and ends saying the network could not be read.
    assert.ok(barSeen, 'no network bar while the build ran');
    assert.ok(spinner, 'no spinner in the bar');
    assert.match(capsule, /^\d+\/12$/, 'the capsule reads ' + JSON.stringify(capsule));
    assert.equal(barLine, 'Building network…');
    assert.ok((await x.evaluate(bar('network-status'))).startsWith('Couldn’t reach your relays'), 'the bar did not say the network could not be read');
    assert.deepEqual(x.errors, []);
  } finally { quiet.close(); x.close(); }
});

test('relays that all answer: the whole network is kept, and the bar ends on its size', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  const second = await startRelay();
  try {
    await setUp(x, second);
    // You, twelve follows and Zed.
    await x.waitFor(`/Your network: 14 people/.test((document.getElementById('wot-status') || {}).textContent || '')`, 40000);
    const kept = await stored(x);
    assert.ok(kept && kept.keys.length === 14, 'the network kept is ' + (kept && kept.keys.length));
    assert.equal(await x.evaluate(bar('network-status')), 'Your network: 14 people.');
    // Settings shows the same bar at its foot.
    await x.evaluate(`document.getElementById('settings-btn').click()`);
    await sleep(500);
    assert.equal(await x.evaluate(bar('network-status-settings')), 'Your network: 14 people.');
    // And it goes away on its own.
    await x.waitFor(`!${bar('network-status-settings')}`, 10000);
    assert.deepEqual(x.errors, []);
  } finally { second.close(); x.close(); }
});
