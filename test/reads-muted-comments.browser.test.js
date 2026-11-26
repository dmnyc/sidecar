'use strict';

// A PIECE'S COMMENT COUNT LEAVES OUT WHOM YOU MUTE. Reads shows how many comments an article or a
// recipe has, in a capsule on its meta line. Comments from a muted person (or ones a muted word,
// hashtag or thread covers, as in the bell) are not counted: not when the mute list is already
// published, and not when you mute someone afterwards, with no reload. A piece left with none loses
// its capsule. Against the REAL extension and a relay on localhost.

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
const capsules = `Object.fromEntries([...document.querySelectorAll('${PANE} .rd-item')].map((r) => [r.querySelector('.rd-title').textContent, (r.querySelector('.rd-comments') || {}).textContent || '']))`;
const openReads = async (x) => {
  await x.evaluate(`document.getElementById('bookmarks-btn').click()`);
  await x.waitFor(`!!document.querySelector('#modal .modal-tab[aria-label="Reads"]')`, 10000);
  await x.evaluate(`document.querySelector('#modal .modal-tab[aria-label="Reads"]').click()`);
  await x.waitFor(`document.querySelectorAll('${PANE} .rd-item').length === 2`, 15000);
};

test('Reads counts comments without the people you mute, and drops the capsule when none are left', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    const now = NOW();
    x.put({ kind: 10002, created_at: now - 9000, tags: [['r', x.relay.url]], content: '' }, 'me');
    x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Bea' }) }, 'bea');
    x.put({ kind: 30023, created_at: now - 10, tags: [['d', 'essay'], ['title', 'An essay']], content: 'x' }, 'me');
    x.put({ kind: 30023, created_at: now - 3000, tags: [['d', 'soup'], ['title', 'Pea soup'], ['t', 'zapcooking']], content: 'x' }, 'me');
    const on = (d) => [['A', '30023:' + x.me + ':' + d], ['K', '30023'], ['p', x.me]];
    x.put({ kind: 1111, created_at: now - 60, tags: on('essay'), content: 'Lovely' }, 'bea');
    x.put({ kind: 1111, created_at: now - 50, tags: on('essay'), content: 'Agreed' }, 'bea');
    x.put({ kind: 1111, created_at: now - 40, tags: on('essay'), content: 'Buy my coin' }, 'cal');
    x.put({ kind: 1111, created_at: now - 30, tags: on('soup'), content: 'Too much salt' }, 'bea');
    // Cal is muted already, on the published list.
    x.put({ kind: 10000, created_at: now - 8000, tags: [['p', x.cal]], content: '' }, 'me');
    await x.reload();

    await openReads(x);
    await x.waitFor(`${capsules}['An essay'] === '2'`, 15000);
    assert.deepEqual(await x.evaluate(capsules), { 'An essay': '2', 'Pea soup': '1' });

    // Mute Bea from her profile card, then look again: no reload.
    await x.evaluate(`document.querySelector('#modal .modal-x').click()`);
    await x.evaluate(`window.SidecarStreamChatAccount.profile(${JSON.stringify(x.bea)})`);
    const BTN = `document.querySelectorAll('#modal .peek-person-actions .icon-btn')[1]`;
    await x.waitFor(`(() => { const b = ${BTN}; return !!b && !b.disabled && !b.classList.contains('pending'); })()`, 15000);
    await x.evaluate(`${BTN}.click()`);
    await x.sleep(500);
    await x.evaluate(`${BTN}.click()`);
    await x.waitFor(`[...document.querySelectorAll('#toasts .toast')].some((e) => e.textContent.includes('Muted'))`, 15000);
    await x.evaluate(`document.querySelector('#modal .modal-x') && document.querySelector('#modal .modal-x').click()`);

    await openReads(x);
    await x.waitFor(`${capsules}['An essay'] === ''`, 15000);
    assert.deepEqual(await x.evaluate(capsules), { 'An essay': '', 'Pea soup': '' }, 'no capsule on a piece with no comments left');
    assert.deepEqual(x.errors, []);
  });
});
