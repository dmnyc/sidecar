'use strict';

// The spam check sorts the bell even when there is no network to sort by, in the real
// extension. The model was only ever asked about the network's strangers, so while the
// network was still building (or had failed, or come back empty) it was not asked at all,
// and a reply-spam campaign from throwaway keys sat at the top of the bell scoring 1.0.
//
// Here the network never finishes in time: the relay holds back the follow lists it is
// built from. A stranger who writes like a person stays in the list; a bot's replies go
// into the collapsed group, named for what it holds. A bot reply arriving while the bell is
// open joins them. And once the network does arrive, the open bell sorts by it.
//
// The replies are the model's own reference bundles (fixtures/nspam), not anything sent to
// anyone: a person's three that score 0 and a bot's three that score 1.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startExtension, CHROME, sleep, _internals } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 180000 };
const fixtures = fs.readFileSync(path.join(__dirname, 'fixtures', 'nspam', 'parity_fixtures.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
const PERSON = fixtures[16];
const BOT = fixtures[13];

// Holds back follow lists (kind 3) for `ms`: everyone's, or with `others`, everyone's but yours.
// Your own key is known before the extension starts.
const ME = CHROME ? _internals.nostrTools().pubkey('me') : '';
const holdFollows = (ms, { others = false } = {}) => (filters) => (filters.some((f) => (f.kinds || []).includes(3)
  && (f.authors || []).length && !(others && f.authors.includes(ME))) ? ms : 0);

const rows = `(() => {
  const all = [...document.querySelectorAll('#modal .notif-item[data-pubkey]')];
  const grouped = (r) => !!r.closest('.notif-offnet');
  return {
    listed: all.filter((r) => !grouped(r)).map((r) => r.dataset.pubkey),
    group: (document.querySelector('#modal .notif-offnet-toggle span') || {}).textContent || '',
  };
})()`;
const groupLabel = `(document.querySelector('#modal .notif-offnet-toggle span') || {}).textContent || ''`;

async function setUp(x) {
  const now = Math.floor(Date.now() / 1000);
  // You follow Bea. Cal and Dan are strangers.
  x.put({ kind: 3, created_at: now - 9000, tags: [['p', x.bea]], content: '' }, 'me');
  x.put({ kind: 3, created_at: now - 9000, tags: [], content: '' }, 'bea');
  const mine = x.put({ kind: 1, created_at: now - 7200, tags: [], content: 'A note of mine' }, 'me');
  const reply = (who, content, i) => x.put({ kind: 1, created_at: now - 600 - i * 600, tags: [['e', mine.id, '', 'root'], ['p', x.me]], content }, who);
  PERSON.notes.forEach((n, i) => reply('cal', n.content, i));
  BOT.notes.forEach((n, i) => reply('dan', n.content, i));
  await x.reload();
  return { mine, now };
}

// The group sits at the end of the list, so read to the end: Load more until it is gone.
async function readToEnd(x) {
  for (let k = 0; k < 6 && await x.evaluate(`!!document.querySelector('#modal .notif-load-more')`); k++) {
    await x.evaluate(`document.querySelector('#modal .notif-load-more').click()`);
    await sleep(1500);
  }
  return x.evaluate(rows);
}

test('with no network to sort by, the spam check sets a bot aside and leaves a person in the list', opts, async (t) => {
  let x;
  // Every follow list held back, yours too: the network comes back empty, which sorts nobody.
  try { x = await startExtension({ relayDelayMs: holdFollows(120000) }); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    const { mine } = await setUp(x);
    let seen = null;
    for (let i = 0; i < 15; i++) {
      await x.evaluate(`document.getElementById('notif-bell-btn').click()`);
      await sleep(1200);
      seen = await readToEnd(x);
      if (/likely spam/.test(seen.group)) break;
      await x.evaluate(`(() => { const b = document.querySelector('#modal .modal-x'); if (b) b.click(); })()`);
      await sleep(800);
    }
    assert.equal(seen.group, '3 likely spam', 'the bot’s replies were not set aside: ' + JSON.stringify(seen));
    assert.ok(!seen.listed.includes(x.dan), 'a bot reply is in the list');
    assert.equal(seen.listed.filter((pk) => pk === x.cal).length, 3, 'the person’s replies left the list');

    // A bot reply arriving while the bell is open joins the group, not the top of the list.
    // Stamped when it is sent: the bell's live subscription asks only for what is newer than
    // its own opening, which a loaded machine can put seconds after the test began.
    x.relay.push(x.sign({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [['e', mine.id, '', 'root'], ['p', x.me]], content: BOT.notes[1].content + ' ' }, 'dan'));
    await x.waitFor(`/^4 likely spam$/.test(${groupLabel})`, 10000);
    assert.ok(!(await x.evaluate(rows)).listed.includes(x.dan), 'the live bot reply went to the top of the list');

    // Opened, the group says why it is there, and each row is marked.
    await x.evaluate(`document.querySelector('#modal .notif-offnet-toggle').click()`);
    await sleep(500);
    const note = await x.evaluate(`(document.querySelector('#modal .notif-offnet-note') || {}).textContent || ''`);
    assert.match(note, /^Your network isn’t loaded yet, so a spam check set these aside\. Nothing is hidden\./);
    const marks = await x.evaluate(`[...document.querySelectorAll('#modal .notif-offnet .notif-item[data-pubkey]')].map((r) => (r.querySelector('.notif-spam-mark') || {}).textContent || '')`);
    assert.deepEqual(marks, ['Likely spam', 'Likely spam', 'Likely spam', 'Likely spam']);
    if (process.env.BELL_SPAM_SHOT) await x.screenshot(process.env.BELL_SPAM_SHOT, { width: 360, height: 900 });
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('when the network arrives with the bell open, the bell sorts by it', opts, async (t) => {
  let x;
  // Others' follow lists held back past the build's first 8-second ask, so the network comes
  // in on its second ask (16 seconds), well after the bell opens. Longer than both and the
  // network is never read whole, and a partial one is not sorted by.
  try { x = await startExtension({ relayDelayMs: holdFollows(12000, { others: true }) }); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await setUp(x);
    await sleep(5000); // the model is warm by now; the network is not
    await x.evaluate(`document.getElementById('notif-bell-btn').click()`);
    await sleep(1200);
    const early = await readToEnd(x);
    assert.equal(early.group, '3 likely spam', 'before the network: ' + JSON.stringify(early));
    // Without reopening: the network lands and the open sheet is sorted by it.
    await x.waitFor(`/from outside your network/.test(${groupLabel})`, 40000);
    const late = await readToEnd(x);
    assert.ok(!late.listed.includes(x.dan));
    assert.equal(late.listed.filter((pk) => pk === x.cal).length, 3, 'the person was not lifted back into the list');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
