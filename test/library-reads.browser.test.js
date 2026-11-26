'use strict';

// READS: THE LIBRARY'S LIST OF WHAT YOU PUBLISHED AT LENGTH. Run in the real extension against a
// relay on localhost. Your articles and recipes (kind 30023) are listed newest first, one row per
// piece at its newest copy, without the ones you deleted or anyone else's; a picker narrows the list
// to articles or recipes; and a row opens the piece by its address, with where you write, in a
// client that draws it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };
const NOW = () => Math.floor(Date.now() / 1000);
const ELSEWHERE = 'wss://writes.example.com';

const openedUrls = (calls) => calls
  .filter((c) => c.call === 'create' || c.call === 'update')
  .map((c) => (c.call === 'create' ? c.args[0] : c.args[1]).url)
  .filter(Boolean);
const naddrIn = (x, url) => { const m = /(naddr1[0-9a-z]+)/.exec(url || ''); return m ? x.nt.decode(m[1]).data : null; };

async function withExtension(t, o, fn) {
  let x;
  try { x = await startExtension(o); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try { await fn(x); } finally { x.close(); }
}

const PANE = '#modal .bm-scroll:not(.hidden)';
const titles = `[...document.querySelectorAll('${PANE} .rd-title')].map((e) => e.textContent)`;
const openReads = async (x) => {
  await x.evaluate(`document.getElementById('bookmarks-btn').click()`);
  await x.waitFor(`!!document.querySelector('#modal .modal-tab[aria-label="Reads"]')`, 10000);
  await x.evaluate(`document.querySelector('#modal .modal-tab[aria-label="Reads"]').click()`);
};
const piece = (d, title, extra = [], at) => ({ kind: 30023, created_at: at, tags: [['d', d], ['title', title], ...extra], content: '## Body' });

function seed(x) {
  const now = NOW();
  x.put({ kind: 10002, created_at: now - 9000, tags: [['r', x.relay.url], ['r', ELSEWHERE, 'write']], content: '' }, 'me');
  // An article first published long ago and edited today: listed by when it first went out, at its newest copy.
  x.put(piece('essay', 'An old title', [['published_at', String(now - 8000)]], now - 8000), 'me');
  x.put(piece('essay', 'An essay, edited', [['published_at', String(now - 8000)], ['summary', 'What it is about']], now - 10), 'me');
  x.put(piece('pea-soup', 'Pea soup', [['t', 'zapcooking'], ['image', 'https://img.example.com/soup.jpg']], now - 3000), 'me');
  x.put(piece('borscht', 'Old borscht', [['t', 'nostrcooking']], now - 5000), 'me');
  x.put(piece('notes', 'Field notes', [], now - 2000), 'me');
  // Deleted by address after it was written: not listed.
  x.put(piece('gone', 'A deleted piece', [], now - 4000), 'me');
  x.put({ kind: 5, created_at: now - 100, tags: [['a', '30023:' + x.me + ':gone'], ['k', '30023']], content: '' }, 'me');
  // Someone else's: not yours.
  x.put(piece('theirs', 'Bea’s article', [], now - 1000), 'bea');
}

test('Reads lists your articles and recipes, newest first at their newest copy, and the picker narrows it', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    seed(x);
    await x.reload();
    await openReads(x);
    await x.waitFor(`${titles}.length === 4`, 15000);
    assert.equal(await x.evaluate(`document.querySelector('#modal h3').textContent`), 'Reads');
    assert.deepEqual(await x.evaluate(`[...document.querySelectorAll('#modal .modal-tab')].map((t) => t.getAttribute('aria-label'))`),
      ['Bookmarks', 'Reads', 'Highlights', 'Comments', 'Reactions']);
    assert.deepEqual(await x.evaluate(titles), ['Field notes', 'Pea soup', 'Old borscht', 'An essay, edited']);
    assert.equal(await x.evaluate(`document.querySelector('#modal .modal-tab[aria-label="Reads"] .modal-tab-count').textContent`), '4');
    const metas = await x.evaluate(`[...document.querySelectorAll('${PANE} .bm-item .bm-meta')].map((e) => e.textContent.split(' · ')[0])`);
    assert.deepEqual(metas, ['article', 'recipe', 'recipe', 'article']);
    assert.match(await x.evaluate(`document.querySelector('${PANE}').innerText`), /What it is about/, 'the summary is not shown');
    assert.equal(await x.evaluate(`document.querySelectorAll('${PANE} .rd-thumb img').length`), 1, 'the cover is not drawn');

    const pick = (v) => x.evaluate(`(() => { const s = document.querySelector('${PANE} .bm-pick'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); })()`);
    assert.deepEqual(await x.evaluate(`[...document.querySelectorAll('${PANE} .bm-pick option')].map((o) => o.textContent)`), ['All', 'Articles', 'Recipes']);
    await pick('recipes');
    assert.deepEqual(await x.evaluate(titles), ['Pea soup', 'Old borscht']);
    await pick('articles');
    assert.deepEqual(await x.evaluate(titles), ['Field notes', 'An essay, edited']);
    await pick('all');
    assert.equal((await x.evaluate(titles)).length, 4);
    assert.deepEqual(x.errors, []);
  });
});

test('a Reads row opens the piece by its address with where you write: an article in your client, a recipe in Zap Cooking', opts, async (t) => {
  await withExtension(t, { settings: { defaultClient: 'yakihonne' } }, async (x) => {
    seed(x);
    await x.reload();
    await openReads(x);
    await x.waitFor(`${titles}.length === 4`, 15000);
    await x.recordTabs();
    const press = async (title) => {
      await x.clearCalls();
      await x.evaluate(`[...document.querySelectorAll('${PANE} .bm-item')].find((r) => r.innerText.includes(${JSON.stringify(title)})).click()`);
      await x.waitFor('window.__calls.some((c) => c.call === "create" || c.call === "update")', 8000);
      const urls = openedUrls(await x.calls());
      assert.equal(urls.length, 1);
      return urls[0];
    };
    const article = await press('An essay, edited');
    assert.match(article, /^https:\/\/yakihonne\.com\/article\/naddr1/);
    const a = naddrIn(x, article);
    assert.deepEqual([a.kind, a.pubkey, a.identifier], [30023, x.me, 'essay']);
    assert.ok(a.relays.map((u) => u.replace(/\/$/, '')).includes(ELSEWHERE), 'the address does not say where you write: ' + JSON.stringify(a.relays));
    assert.match(await press('Old borscht'), /^https:\/\/zap\.cooking\/r\/naddr1/, 'an old-format recipe did not open in Zap Cooking');
    assert.match(await press('Pea soup'), /^https:\/\/zap\.cooking\/r\/naddr1/);
    assert.deepEqual(x.errors, []);
  });
});

test('with a custom client, an article opens in Jumble: a custom address may only know notes', opts, async (t) => {
  const customClients = { 'custom:notes.example': { label: 'Notes', url: 'https://notes.example/e/{ne}', urlForm: 'nevent', profile: 'https://notes.example/p/{np}', profileForm: 'npub' } };
  await withExtension(t, { settings: { defaultClient: 'custom:notes.example', customClients } }, async (x) => {
    seed(x);
    await x.reload();
    await openReads(x);
    await x.waitFor(`${titles}.length === 4`, 15000);
    await x.recordTabs();
    await x.clearCalls();
    await x.evaluate(`[...document.querySelectorAll('${PANE} .bm-item')].find((r) => r.innerText.includes('Field notes')).click()`);
    await x.waitFor('window.__calls.some((c) => c.call === "create" || c.call === "update")', 8000);
    assert.match(openedUrls(await x.calls())[0], /^https:\/\/jumble\.social\/notes\/naddr1/);
    assert.deepEqual(x.errors, []);
  });
});

test('one kind only: no picker; nothing published: says where they will show; a piece published while open appears', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    const now = NOW();
    await x.reload();
    await openReads(x);
    await x.waitFor(`document.querySelector('${PANE}').innerText.includes('Articles and recipes you publish show up here.')`, 15000);
    await x.evaluate(`document.querySelector('#modal .modal-x').click()`);

    x.put(piece('first', 'A first article', [], now - 50), 'me');
    await openReads(x);
    await x.waitFor(`${titles}.length === 1`, 15000);
    assert.equal(await x.evaluate(`document.querySelectorAll('${PANE} .bm-pick').length`), 0, 'a picker over one kind');

    // Published from elsewhere while the sheet is open: the library's live subscription brings it in.
    x.relay.push(x.sign(piece('later', 'A recipe, just now', [['t', 'zapcooking']], NOW()), 'me'));
    await x.waitFor(`${titles}.length === 2`, 15000);
    assert.deepEqual(await x.evaluate(titles), ['A recipe, just now', 'A first article']);
    assert.equal(await x.evaluate(`document.querySelectorAll('${PANE} .bm-pick').length`), 1, 'no picker once there are both');
    assert.deepEqual(x.errors, []);
  });
});
