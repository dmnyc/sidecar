'use strict';

// A LIBRARY ROW'S ⋮ MENU HAS ROOM FOR ITS LABELS. The menu's labels never wrap: one that does not fit
// is cut off with an ellipsis. Opened inside the row's text column, beside a cover and the actions, the
// menu was about 179px wide, and French, Greek, Hungarian and Russian lost the end of Copy event ID or
// Copy event JSON. It opens on a line of its own under the row now, across the row's full width.
// Against the REAL extension at panel width, with a relay on localhost.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };
const NOW = () => Math.floor(Date.now() / 1000);

async function withExtension(t, o, fn) {
  let x;
  try { x = await startExtension(o); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try { await fn(x); } finally { x.close(); }
}

const PANE = '#modal .bm-scroll:not(.hidden)';
const ROWS = `document.querySelectorAll('${PANE} .bm-item')`;

for (const language of ['fr', 'el', 'hu', 'ru']) {
  test(`every label in a Reads row’s ⋮ fits, in ${language}`, opts, async (t) => {
    await withExtension(t, { settings: { language } }, async (x) => {
      const now = NOW();
      x.put({ kind: 10002, created_at: now - 9000, tags: [['r', x.relay.url]], content: '' }, 'me');
      x.put({ kind: 30023, created_at: now - 10, tags: [['d', 'essay'], ['title', 'An essay'], ['summary', 'What it is about']], content: 'x' }, 'me');
      x.put({ kind: 30023, created_at: now - 3000, tags: [['d', 'soup'], ['title', 'Pea soup'], ['t', 'zapcooking']], content: 'x' }, 'me');
      await x.reload();
      await x.evaluate(`document.getElementById('bookmarks-btn').click()`);
      await x.waitFor(`!!document.querySelectorAll('#modal .modal-tab')[1]`, 10000);
      await x.evaluate(`document.querySelectorAll('#modal .modal-tab')[1].click()`);
      await x.waitFor(`${ROWS}.length === 2`, 15000);
      for (const i of [0, 1]) {
        await x.evaluate(`${ROWS}[${i}].querySelector('.notif-more-btn').click()`);
        const r = await x.evaluate(`(() => {
          const row = ${ROWS}[${i}];
          const panel = row.querySelector('.notif-more');
          const items = [...panel.querySelectorAll('.notif-more-item')];
          return {
            cut: items.filter((e) => { const s = e.querySelector('span'); return s.scrollWidth > s.clientWidth + 1; }).map((e) => e.textContent),
            heights: [...new Set(items.map((e) => Math.round(e.getBoundingClientRect().height)))],
            menu: panel.getBoundingClientRect().width, row: row.getBoundingClientRect().width,
          };
        })()`);
        assert.deepEqual(r.cut, [], 'cut off: ' + JSON.stringify(r.cut));
        assert.equal(r.heights.length, 1, 'rows of different heights: ' + JSON.stringify(r.heights));
        assert.ok(r.menu > r.row * 0.75, `the menu is ${r.menu}px in a ${r.row}px row`);
        await x.evaluate(`${ROWS}[${i}].querySelector('.notif-more-btn').click()`);
      }
      assert.deepEqual(x.errors, []);
    });
  });
}
