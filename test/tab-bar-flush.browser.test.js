'use strict';

// TABS OVER A SCROLLING LIST SIT ON IT, against the real extension and measured. The bell's
// All and Polls tabs and the Library's tabs had a band of empty sheet under their line (the
// bar's 14px margin, the sheet's 9px gap and the list's 4px), and the line stopped 8px short of
// the rows on the side where they start. Now the list starts at the line, and the line runs
// exactly as wide as the rows below it: with a scrollbar and without, and right to left.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 180000 };

// The bar, the first row under it and the list's top, in whole pixels.
const measure = (rowSel) => `(() => {
  const bar = document.querySelector('#modal .modal-tabs').getBoundingClientRect();
  const rowEl = document.querySelector('#modal ${rowSel}');
  const row = rowEl.getBoundingClientRect();
  const list = rowEl.closest('.notif-scroll, .bm-scroll').getBoundingClientRect();
  const r = Math.round;
  return { gap: r(list.top - bar.bottom), left: r(row.left - bar.left), right: r(row.right - bar.right) };
})()`;

async function setUp(x, replies) {
  const now = Math.floor(Date.now() / 1000);
  x.put({ kind: 3, created_at: now - 9000, tags: [['p', x.bea]], content: '' }, 'me');
  x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Bea' }) }, 'bea');
  const mine = x.put({ kind: 1, created_at: now - 7200, tags: [], content: 'A note of mine' }, 'me');
  // A poll of yours, which is what gives the bell its All and Polls tabs.
  x.put({ kind: 1068, created_at: now - 7000, tags: [['option', 'a', 'A'], ['option', 'b', 'B'], ['polltype', 'singlechoice']], content: 'Poll?' }, 'me');
  const ids = [];
  for (let i = 0; i < replies; i++) ids.push(x.put({ kind: 1, created_at: now - 600 + i, tags: [['e', mine.id, '', 'root'], ['p', x.me]], content: 'Reply ' + i }, 'bea').id);
  x.put({ kind: 10003, created_at: now - 50, tags: ids.map((id) => ['e', id]), content: '' }, 'me');
  await x.reload();
  for (let i = 0; i < 15; i++) {
    await x.evaluate(`document.getElementById('notif-bell-btn').click()`);
    await sleep(1500);
    if (await x.evaluate(`!!document.querySelector('#modal .modal-tabs') && document.querySelectorAll('#modal .notif-item').length >= ${Math.min(replies, 3)}`)) return;
    await x.evaluate(`(() => { const m = document.querySelector('#modal .modal-x'); if (m) m.click(); })()`);
    await sleep(600);
  }
  throw new Error('the bell never showed its tabs');
}

const flush = { gap: 0, left: 0, right: 0 };

test('the bell’s list starts at its tab bar, and the bar is as wide as the rows', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await setUp(x, 8);
    assert.equal(await x.evaluate(`(() => { const s = document.querySelector('#modal .notif-scroll'); return s.scrollHeight > s.clientHeight; })()`), true, 'the list should scroll here');
    assert.deepEqual(await x.evaluate(measure('.notif-item')), flush, 'with a scrollbar');
    await x.evaluate(`document.documentElement.dir = 'rtl'`);
    await sleep(300);
    assert.deepEqual(await x.evaluate(measure('.notif-item')), flush, 'right to left');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('the same with a list too short to scroll, and in the Library', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await setUp(x, 1);
    assert.deepEqual(await x.evaluate(measure('.notif-item')), flush, 'without a scrollbar');
    await x.evaluate(`document.querySelector('#modal .modal-x').click()`);
    await sleep(800);
    await x.evaluate(`document.getElementById('bookmarks-btn').click()`);
    await x.waitFor(`!!document.querySelector('#modal .bm-scroll:not(.hidden) .bm-item')`, 15000);
    assert.deepEqual(await x.evaluate(measure('.bm-scroll:not(.hidden) .bm-item')), flush, 'the Library');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
