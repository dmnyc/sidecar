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

// THE ⋮ ON A PIECE: copy where it opens and its address, and delete it. No Edit: editing a published
// piece is deferred, and other clients handle it for now.
const rowOf = (title) => `[...document.querySelectorAll('${PANE} .bm-item')].find((r) => r.innerText.includes(${JSON.stringify(title)}))`;
const menuItems = (title) => `[...${rowOf(title)}.querySelectorAll('.notif-more-item')]`;
const openMenu = (x, title) => x.evaluate(`${rowOf(title)}.querySelector('.item-actions .notif-more-btn').click()`);

test('a piece’s ⋮ copies its link and address and deletes it in two taps, by address; there is no Edit', opts, async (t) => {
  await withExtension(t, { settings: { defaultClient: 'yakihonne' } }, async (x) => {
    seed(x);
    await x.reload();
    await openReads(x);
    await x.waitFor(`${titles}.length === 4`, 15000);
    await openMenu(x, 'An essay, edited');
    const labels = await x.evaluate(`${menuItems('An essay, edited')}.map((e) => e.textContent)`);
    // The link and the address lead, and the two identifiers sit together.
    assert.deepEqual(labels.slice(0, 4), ['Copy link', 'Copy article address', 'Copy event ID', 'Copy event JSON'], JSON.stringify(labels));
    assert.equal(labels[labels.length - 1], 'Delete article');
    assert.ok(!labels.some((l) => /edit/i.test(l)), 'an Edit item: ' + JSON.stringify(labels));

    const item = (label) => `${menuItems('An essay, edited')}.find((e) => e.textContent === ${JSON.stringify(label)})`;
    const copied = async (label) => {
      await x.evaluate(`window.__copied = null; navigator.clipboard.writeText = async (s) => { window.__copied = s; };`);
      await x.evaluate(`${item(label)}.click()`);
      await x.waitFor('window.__copied !== null', 5000);
      return x.evaluate('window.__copied');
    };
    assert.match(await copied('Copy link'), /^https:\/\/yakihonne\.com\/article\/naddr1/);
    await openMenu(x, 'An essay, edited');
    const addr = x.nt.decode(await copied('Copy article address')).data;
    assert.deepEqual([addr.kind, addr.pubkey, addr.identifier], [30023, x.me, 'essay']);

    // First tap arms; a tap on the row lets go without opening the piece; the second tap deletes.
    await openMenu(x, 'An essay, edited');
    const del = `${menuItems('An essay, edited')}.pop()`;
    await x.evaluate(`${del}.click()`);
    assert.equal(await x.evaluate(`${del}.textContent`), 'Tap again to confirm');
    await x.sleep(500);
    await x.recordTabs();
    await x.clearCalls();
    await x.evaluate(`${rowOf('An essay, edited')}.querySelector('.bm-main').click()`);
    await x.sleep(300);
    assert.deepEqual(openedUrls(await x.calls()), [], 'an armed row opened the piece');
    assert.equal(await x.evaluate(`${del}.textContent`), 'Delete article');
    assert.equal(x.relay.events.filter((e) => e.kind === 5 && e.created_at > NOW() - 60 && e.tags.some((tg) => tg[1] === '30023:' + x.me + ':essay')).length, 0);

    await x.evaluate(`${del}.click()`);
    await x.sleep(500);
    await x.evaluate(`${del}.click()`);
    await x.waitFor(`${titles}.length === 3`, 10000);
    assert.ok(!(await x.evaluate(titles)).includes('An essay, edited'));
    const essay = x.relay.events.filter((e) => e.kind === 30023 && e.tags.some((tg) => tg[0] === 'd' && tg[1] === 'essay')).sort((a, b) => b.created_at - a.created_at)[0];
    const req = x.relay.events.find((e) => e.kind === 5 && e.pubkey === x.me && e.tags.some((tg) => tg[0] === 'a' && tg[1] === '30023:' + x.me + ':essay'));
    assert.ok(req, 'no deletion request by address');
    assert.ok(req.tags.some((tg) => tg[0] === 'e' && tg[1] === essay.id), 'the request does not name the listed copy');
    assert.ok(req.tags.some((tg) => tg[0] === 'k' && tg[1] === '30023'));
    // Nothing republished: no new or emptied copy of the piece.
    assert.equal(x.relay.events.filter((e) => e.kind === 30023 && e.tags.some((tg) => tg[0] === 'd' && tg[1] === 'essay')).length, 2);

    // A recipe says recipe.
    await openMenu(x, 'Pea soup');
    assert.equal(await x.evaluate(`${menuItems('Pea soup')}[1].textContent`), 'Copy recipe address');
    assert.equal(await x.evaluate(`${menuItems('Pea soup')}.pop().textContent`), 'Delete recipe');

    // Reopened, the list still leaves it out: the relays have the request.
    await x.evaluate(`document.querySelector('#modal .modal-x').click()`);
    await openReads(x);
    await x.waitFor(`${titles}.length === 3`, 15000);
    assert.deepEqual(x.errors, []);
  });
});

test('a piece with comments shows how many in a capsule; one without shows none', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    seed(x);
    const now = NOW();
    const essay = '30023:' + x.me + ':essay';
    const comment = (A, content, at) => ({ kind: 1111, created_at: at, content, tags: [['A', A], ['K', '30023'], ['P', x.me], ['a', A], ['k', '30023'], ['p', x.me]] });
    x.put(comment(essay, 'Loved it', now - 60), 'bea');
    x.put(comment(essay, 'Same here', now - 50), 'bea');
    // A comment on a piece by someone else is not counted on yours.
    x.put(comment('30023:' + 'f'.repeat(64) + ':essay', 'Elsewhere', now - 40), 'bea');
    await x.reload();
    await openReads(x);
    await x.waitFor(`${titles}.length === 4`, 15000);
    await x.waitFor(`!!${rowOf('An essay, edited')}.querySelector('.rd-comments')`, 10000);
    assert.equal(await x.evaluate(`${rowOf('An essay, edited')}.querySelector('.rd-comments').textContent`), '2');
    assert.equal(await x.evaluate(`${rowOf('An essay, edited')}.querySelector('.rd-comments').getAttribute('aria-label')`), '2 comments');
    assert.equal(await x.evaluate(`document.querySelectorAll('${PANE} .rd-comments').length`), 1, 'a zero capsule');
    assert.deepEqual(x.errors, []);
  });
});
