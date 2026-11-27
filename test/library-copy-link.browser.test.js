'use strict';

// COPY LINK IN EVERY LIBRARY LIST. A row's ⋮ copies the place a tap on the row opens: a bookmarked
// note or article in your client (a recipe in Zap Cooking), a bookmarked web page itself, a hashtag
// as your client's search, and a highlight in your client. A comment's row opens Sidecar's own page
// for it, an address inside this extension nobody else can open, so its link is the comment in your
// client. Against the REAL extension and a relay on localhost.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };
const NOW = () => Math.floor(Date.now() / 1000);
const WEB = [['I', 'https://example.com/post'], ['K', 'web'], ['i', 'https://example.com/post'], ['k', 'web']];

async function withExtension(t, o, fn) {
  let x;
  try { x = await startExtension(o); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try { await fn(x); } finally { x.close(); }
}

const PANE = '#modal .bm-scroll:not(.hidden)';
const rowOf = (match) => `[...document.querySelectorAll('${PANE} .bm-item')].find((r) => r.innerText.includes(${JSON.stringify(match)}))`;
const openedUrls = (calls) => calls
  .filter((c) => c.call === 'create' || c.call === 'update')
  .map((c) => (c.call === 'create' ? c.args[0] : c.args[1]).url)
  .filter(Boolean);

// A list repaints when a slower relay answers, and for that moment its rows are gone: each step
// waits for the row and tries again if a repaint took it.
async function onRow(x, match, fn) {
  for (let i = 0; ; i++) {
    await x.waitFor(`!!${rowOf(match)}`, 15000);
    try { return await fn(); } catch (e) { if (i >= 3 || !/Cannot read properties of (undefined|null)/.test(e.message)) throw e; await x.sleep(300); }
  }
}
async function copiedLink(x, match) {
  return onRow(x, match, () => copyOnce(x, match));
}
async function copyOnce(x, match) {
  const row = rowOf(match);
  await x.evaluate(`(() => { const p = ${row}.querySelector('.notif-more'); if (!p || p.classList.contains('hidden')) ${row}.querySelector('.item-actions .notif-more-btn').click(); })()`);
  const labels = await x.evaluate(`[...${row}.querySelectorAll('.notif-more-item')].map((e) => e.textContent)`);
  assert.ok(labels.includes('Copy link'), `${match}: ${JSON.stringify(labels)}`);
  await x.evaluate(`window.__copied = null; navigator.clipboard.writeText = async (s) => { window.__copied = s; };`);
  await x.evaluate(`[...${row}.querySelectorAll('.notif-more-item')].find((e) => e.textContent === 'Copy link').click()`);
  await x.waitFor('window.__copied !== null', 5000);
  return x.evaluate('window.__copied');
}
// Opening a row in your client can close the Library, so a tab is reached by opening it again if need be.
// A close can also land late, after the tab was picked, so the tab is checked again once a close
// would have finished, and picked again in a reopened Library if it went.
async function openTab(x, i) {
  const tab = `document.querySelectorAll('#modal:not(.is-closing) .modal-tab')[${i}]`;
  for (let tries = 0; tries < 5; tries++) {
    await x.sleep(300);
    if (!(await x.evaluate(`!!${tab}`))) {
      await x.waitFor(`!document.querySelector('#modal.is-closing')`, 5000);
      await x.evaluate(`document.getElementById('bookmarks-btn').click()`);
    }
    await x.waitFor(`!!${tab}`, 10000);
    await x.evaluate(`${tab}.click()`);
    await x.sleep(500);
    if (await x.evaluate(`!!${tab} && ${tab}.getAttribute('aria-selected') === 'true'`)) return;
  }
  throw new Error('the Library would not stay open on tab ' + i);
}
// Opening can wait on a lookup first (an article asks for its author's relays), and the Library
// closes only after the client opens. So this waits for the open itself, then for the close to
// finish, before the next step reaches for a tab: a fixed pause let a late close land after it.
async function tapped(x, match) {
  await x.clearCalls();
  await onRow(x, match, () => x.evaluate(`${rowOf(match)}.querySelector('.bm-main').click()`));
  let urls = [];
  for (let i = 0; i < 100 && !urls.length; i++) { await x.sleep(150); urls = openedUrls(await x.calls()); }
  await x.sleep(600);
  return urls;
}

test('every Library list’s ⋮ copies where its row opens', opts, async (t) => {
  await withExtension(t, { settings: { defaultClient: 'yakihonne' } }, async (x) => {
    const now = NOW();
    x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Bea' }) }, 'bea');
    const note = x.put({ kind: 1, created_at: now - 7200, tags: [], content: 'A note worth keeping' }, 'bea');
    x.put({ kind: 30023, created_at: now - 7000, tags: [['d', 'on-soup'], ['title', 'On soup, at length']], content: 'x' }, 'bea');
    x.put({ kind: 10003, created_at: now - 50, content: '', tags: [
      ['e', note.id], ['a', '30023:' + x.bea + ':on-soup'], ['r', 'https://example.org/recipe'], ['t', 'cooking'],
    ] }, 'me');
    const hl = x.put({ kind: 9802, created_at: now - 900, tags: [['r', 'https://example.com/post', 'source']], content: 'A highlighted passage' }, 'me');
    const comment = x.put({ kind: 1111, created_at: now - 3600, tags: WEB, content: 'My comment on a page' }, 'me');
    await x.reload();
    await x.recordTabs();

    // Bookmarks: the copy is exactly where a tap goes.
    for (const match of ['A note worth keeping', 'On soup, at length', 'example.org', '#cooking']) {
      await openTab(x, 0);
      const link = await copiedLink(x, match);
      assert.deepEqual(await tapped(x, match), [link], match);
    }
    await openTab(x, 0);
    assert.equal(await copiedLink(x, 'example.org'), 'https://example.org/recipe');
    assert.match(await copiedLink(x, 'On soup, at length'), /^https:\/\/yakihonne\.com\/article\/naddr1/);

    // Highlights: the highlight in your client, as a tap opens it.
    await openTab(x, 2);
    const hlLink = await copiedLink(x, 'A highlighted passage');
    assert.equal(x.nt.decode(/(nevent1[0-9a-z]+)/.exec(hlLink)[1]).data.id, hl.id);
    assert.deepEqual(await tapped(x, 'A highlighted passage'), [hlLink]);

    // Comments: the comment in your client, not the extension's own page a tap opens.
    await openTab(x, 3);
    const cmLink = await copiedLink(x, 'My comment on a page');
    assert.match(cmLink, /^https:\/\//);
    const data = x.nt.decode(/(nevent1[0-9a-z]+)/.exec(cmLink)[1]).data;
    assert.deepEqual([data.id, data.kind], [comment.id, 1111]);
    assert.deepEqual(x.errors, []);
  });
});
