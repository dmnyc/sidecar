'use strict';

// The library and the links that leave the panel, against the REAL extension: its own service
// worker, keystore and side panel page, in a real Chrome, reading from a relay on localhost
// (test/helpers/real-extension.js). The faked-worker tests next to this one pin decisions inside
// a function; these pin what happens between them, which is where "I click it and nothing
// happens" and "the panel closed and nothing loaded" live.
//
// Needs a Chrome that can load an unpacked extension over the debugging pipe (CHROME_PATH, or one
// of the usual places); without one the tests skip. Each launches its own Chrome, so a test is
// seconds, not milliseconds.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME } = require('./helpers/real-extension');

const NOW = () => Math.floor(Date.now() / 1000);
const WEB = [['I', 'https://example.com/post'], ['K', 'web'], ['i', 'https://example.com/post'], ['k', 'web']];

// Events for one account: notes by other people, what it reacted to (one note no relay has), a
// bookmark, a highlight, a comment on a page, and a reply to it, which is a notification.
function seed(x) {
  const now = NOW();
  // Names, so a row that names an author does not fall back to a shortened npub.
  x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Bea' }) }, 'bea');
  x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Cal' }) }, 'cal');
  const note1 = x.put({ kind: 1, created_at: now - 7200, tags: [], content: 'A note worth reacting to' }, 'bea');
  const note2 = x.put({ kind: 1, created_at: now - 7300, tags: [], content: 'Another note' }, 'bea');
  const image = x.put({ kind: 1, created_at: now - 7500, tags: [], content: 'https://i.example.com/pic.jpg' }, 'cal');
  const missing = x.sign({ kind: 1, created_at: now - 7400, tags: [], content: 'A note no relay has' }, 'bea');   // signed, never put
  const react = (note, who, content, ago) => x.put({ kind: 7, created_at: now - ago, tags: [['e', note.id], ['p', who === 'cal' ? x.cal : x.bea], ['k', '1']], content }, 'me');
  react(note1, 'bea', '+', 100);
  react(note2, 'bea', '🔥', 200);
  react(missing, 'bea', '😂', 300);
  react(image, 'cal', '🤙', 400);
  x.put({ kind: 10003, created_at: now - 50, tags: [['e', note1.id]], content: '' }, 'me');
  x.put({ kind: 9802, created_at: now - 900, tags: [['r', 'https://example.com/post', 'source']], content: 'A highlighted passage' }, 'me');
  const comment = x.put({ kind: 1111, created_at: now - 3600, tags: WEB, content: 'My comment on a page' }, 'me');
  const reply = x.put({ kind: 1, created_at: now - 600, tags: [['e', note1.id, '', 'root'], ['p', x.me]], content: 'Replying to you, Tester' }, 'bea');
  return { note1, note2, image, missing, comment, reply };
}

// The page's helpers, as expressions to evaluate.
const click = (selector) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.click(); return true; })()`;
const text = (selector) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e ? e.innerText : ''; })()`;
const rows = (pane = '#modal .bm-scroll:not(.hidden)') => `document.querySelectorAll('${pane} .bm-item').length`;
const openLibrary = (x) => x.evaluate(click('#bookmarks-btn'));
const tab = (i) => `(() => { const t = document.querySelectorAll('#modal .modal-tab')[${i}]; if (!t) return false; t.click(); return true; })()`;
const TAB = { bookmarks: 0, highlights: 1, comments: 2, reactions: 3 };

// A bookmark row has no trash can: Remove bookmark is the last item in its ⋮ menu, which is built on the first press.
const rowMore = (row) => `${row}.querySelector('.item-actions .notif-more-btn')`;
const rowRemove = (row) => `${row}.querySelector('.notif-more .notif-more-item:last-child')`;
const openRowMenu = (x, row) => x.evaluate(`(() => { const p = ${row}.querySelector('.notif-more'); if (!p || p.classList.contains('hidden')) ${rowMore(row)}.click(); })()`);

// The URL a tab call opened, whichever call it was: create({url}) or update(id, {url}).
const openedUrls = (calls) => calls
  .filter((c) => c.call === 'create' || c.call === 'update')
  .map((c) => (c.call === 'create' ? c.args[0] : c.args[1]).url)
  .filter(Boolean);
const idIn = (x, url) => { const m = /(nevent1[0-9a-z]+)/.exec(url); return m ? x.nt.decode(m[1]).data.id : null; };

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };
async function withExtension(t, o, fn) {
  let x;
  try { x = await startExtension(o); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try { await fn(x); } finally { x.close(); }
}

test('the library shows its four lists from the real worker and a real relay, and nothing throws', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    seed(x);
    await x.reload();
    await openLibrary(x);
    await x.waitFor(`${text('#modal .bm-scroll')}.includes('A note worth reacting to')`);
    assert.deepEqual(await x.evaluate(`[...document.querySelectorAll('#modal .modal-tab')].map((t) => t.getAttribute('aria-label'))`),
      ['Bookmarks', 'Highlights', 'Comments', 'Reactions']);
    await x.evaluate(tab(TAB.highlights));
    await x.waitFor(`${rows()} === 1`);
    assert.match(await x.evaluate(text('#modal .bm-scroll:not(.hidden)')), /A highlighted passage/);
    await x.evaluate(tab(TAB.comments));
    await x.waitFor(`${rows()} === 1`);
    const comments = await x.evaluate(text('#modal .bm-scroll:not(.hidden)'));
    assert.match(comments, /example\.com/);
    assert.match(comments, /My comment on a page/);
    await x.evaluate(tab(TAB.reactions));
    await x.waitFor(`${rows()} === 4`);
    const reactions = await x.evaluate(text('#modal .bm-scroll:not(.hidden)'));
    assert.doesNotMatch(reactions, /https?:|npub1|nostr:/, 'a reacted-to note reads as words, not as an address');
    assert.match(reactions, /A note worth reacting to/);
    assert.match(reactions, /Image/, 'a note that was only a picture says so');
    assert.deepEqual(x.errors, []);
  });
});

test('every reaction row opens in the client, including one whose note no relay returns, and the sheet survives', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    const s = seed(x);
    await x.reload();
    await x.recordTabs();
    await openLibrary(x);
    await x.evaluate(tab(TAB.reactions));
    await x.waitFor(`${rows()} === 4`);
    // Newest first: the like, the fire, the laugh at the missing note, the one at the picture.
    const expected = [s.note1.id, s.note2.id, s.missing.id, s.image.id];
    for (let i = 0; i < expected.length; i++) {
      await x.clearCalls();
      await x.evaluate(`document.querySelectorAll('#modal .bm-scroll:not(.hidden) .bm-item')[${i}].click()`);
      await x.waitFor('window.__calls.some((c) => c.call === "create" || c.call === "update")');
      const urls = openedUrls(await x.calls());
      assert.equal(urls.length, 1, 'row ' + i + ' opened exactly one address');
      assert.match(urls[0], /^https:\/\/jumble\.social\/notes\/nevent1/);
      assert.equal(idIn(x, urls[0]), expected[i], 'row ' + i + ' opens the note it reacted to');
    }
    // Opening a link must not take the sheet or its contents with it.
    assert.equal(await x.evaluate(`!document.getElementById('modal-overlay').classList.contains('hidden')`), true);
    assert.equal(await x.evaluate(rows()), 4);
    // And closing and reopening still finds the library full.
    await x.evaluate(click('#modal .modal-x'));
    await x.waitFor(`document.getElementById('modal-overlay').classList.contains('hidden')`);
    await openLibrary(x);
    await x.evaluate(tab(TAB.reactions));
    await x.waitFor(`${rows()} === 4`);
    assert.deepEqual(x.errors, []);
  });
});

test('a notification link opens its note in the client', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    const s = seed(x);
    await x.reload();
    await x.recordTabs();
    await x.evaluate(click('#notif-bell-btn'));
    await x.waitFor(`document.querySelectorAll('#modal .notif-item').length >= 1`, 15000);
    await x.clearCalls();
    await x.evaluate(`document.querySelector('#modal .notif-item.notif-clickable').click()`);
    await x.waitFor('window.__calls.some((c) => c.call === "create" || c.call === "update")');
    const urls = openedUrls(await x.calls());
    assert.equal(urls.length, 1);
    assert.equal(idIn(x, urls[0]), s.reply.id, 'it opens the reply that notified');
    assert.deepEqual(x.errors, []);
  });
});

test('tabs pressed at once, the sheet closed and reopened mid-load: every list still arrives and nothing throws', opts, async (t) => {
  // Slow relay, so every list is still in flight while the sheet is being pushed around.
  await withExtension(t, { relayDelayMs: 600 }, async (x) => {
    seed(x);
    await x.reload();
    for (let round = 0; round < 3; round++) {
      await openLibrary(x);
      for (const i of [1, 2, 3, 1, 2, 3, 0, 3]) await x.evaluate(tab(i));
      await x.evaluate(click('#modal .modal-x'));       // away before anything answered
    }
    await openLibrary(x);
    await x.evaluate(tab(TAB.reactions));
    await x.waitFor(`${rows()} === 4`, 15000);
    await x.evaluate(tab(TAB.comments));
    await x.waitFor(`${rows()} === 1`, 15000);
    await x.evaluate(tab(TAB.highlights));
    await x.waitFor(`${rows()} === 1`, 15000);
    await x.evaluate(tab(TAB.bookmarks));
    await x.waitFor(`${text('#modal .bm-scroll:not(.hidden)')}.includes('A note worth reacting to')`, 15000);
    assert.deepEqual(x.errors, [], 'no page exception along the way');
  });
});

test('a library opened a second time is on screen before any relay answers', opts, async (t) => {
  let delay = 0;
  await withExtension(t, { relayDelayMs: () => delay }, async (x) => {
    seed(x);
    await x.reload();
    await openLibrary(x);
    await x.evaluate(tab(TAB.reactions));
    await x.waitFor(`${rows()} === 4`);
    await x.waitFor(`${text('#modal .bm-scroll:not(.hidden)')}.includes('A note worth reacting to')`);
    await x.evaluate(click('#modal .modal-x'));
    // From here every relay takes four seconds to answer anything.
    delay = 4000;
    await openLibrary(x);
    await x.evaluate(tab(TAB.reactions));
    // Rows, with the notes' words and the authors' names, well inside those four seconds.
    await x.waitFor(`${rows()} === 4`, 1500);
    const painted = await x.evaluate(text('#modal .bm-scroll:not(.hidden)'));
    assert.match(painted, /A note worth reacting to/, 'the note is read from memory, not asked for again');
    assert.match(painted, /Bea/, 'and so is its author');
    assert.doesNotMatch(painted, /Reading your relays/);
    assert.deepEqual(x.errors, []);
  });
});

test('an event that arrives while the library is open reaches its list without a reload', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    const s = seed(x);
    await x.reload();
    await openLibrary(x);
    await x.evaluate(tab(TAB.reactions));
    await x.waitFor(`${rows()} === 4`);
    await x.sleep(800);   // the live subscription opens behind the first paint
    // Another device reacts: the list gains a row on its own, at the top.
    const fresh = x.push({ kind: 7, created_at: NOW(), tags: [['e', s.note2.id], ['p', x.bea], ['k', '1']], content: '🎉' }, 'me');
    await x.waitFor(`${rows()} === 5`, 8000);
    assert.equal(await x.evaluate(`document.querySelector('#modal .bm-scroll:not(.hidden) .bm-item .cm-reaction-mark').textContent`), '🎉');
    // It arrives for a list that is not showing too, and is there when that list is opened.
    await x.evaluate(tab(TAB.comments));
    await x.waitFor(`${rows()} === 1`);
    x.push({ kind: 1111, created_at: NOW(), tags: WEB, content: 'A second comment, from elsewhere' }, 'me');
    await x.waitFor(`${rows()} === 2`, 8000);
    // Deleted elsewhere: the row goes.
    x.push({ kind: 5, created_at: NOW(), tags: [['e', fresh.id], ['k', '7']], content: '' }, 'me');
    await x.evaluate(tab(TAB.reactions));
    await x.waitFor(`${rows()} === 4`, 8000);
    assert.deepEqual(x.errors, []);
  });
});

test('removing a bookmark lives in its ⋮ menu and asks once: any other tap lets go, Escape lets go, the second tap removes', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    const s = seed(x);
    await x.reload();
    await x.recordTabs();
    await openLibrary(x);
    const row = `document.querySelector('#modal .bm-scroll .bm-item')`;
    await x.waitFor(`${text('#modal .bm-scroll')}.includes('A note worth reacting to')`);
    // The main view carries no trash can: the row's one control is the ⋮.
    assert.equal(await x.evaluate(`${row}.querySelectorAll('.item-actions button').length`), 1);
    assert.equal(await x.evaluate(`!!document.querySelector('#modal .bm-scroll svg[data-icon="trash"]')`), false);
    await openRowMenu(x, row);
    const item = rowRemove(row);
    assert.equal(await x.evaluate(`${item}.textContent`), 'Remove bookmark');
    const armed = () => x.evaluate(`${item}.classList.contains('armed')`);
    const label = () => x.evaluate(`${item}.textContent`);

    // One tap arms it, in place: the item goes red and says what to do.
    await x.evaluate(`${item}.click()`);
    assert.equal(await armed(), true);
    assert.equal(await label(), 'Tap again to confirm');
    // A second tap straight after, as a double-tap would be, removes nothing.
    await x.evaluate(`${item}.click()`);
    assert.equal(await armed(), true);
    assert.equal(await x.evaluate(rows('#modal .bm-scroll')), 1);

    // A tap on the row lets go, and does not open the client behind the question.
    await x.sleep(500);
    await x.clearCalls();
    await x.evaluate(`${row}.querySelector('.bm-main').click()`);
    assert.equal(await armed(), false);
    assert.equal(await label(), 'Remove bookmark', 'the words come back');
    await x.sleep(300);
    assert.deepEqual(openedUrls(await x.calls()), []);

    // A tap elsewhere in the sheet lets go.
    await x.evaluate(`${item}.click()`);
    await x.evaluate(`document.querySelector('#modal .modal-tabs').click()`);
    assert.equal(await armed(), false);

    // Escape lets go and does not close the sheet.
    await x.evaluate(`${item}.click()`);
    await x.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    assert.equal(await armed(), false);
    assert.equal(await x.evaluate(`!document.getElementById('modal-overlay').classList.contains('hidden')`), true);

    // The second tap, a moment later, removes it: the list is published again without the note.
    await x.evaluate(`${item}.click()`);
    await x.sleep(500);
    await x.evaluate(`${item}.click()`);
    await x.waitFor(`document.querySelectorAll('#modal .bm-scroll .bm-item').length === 0`, 15000);
    const lists = x.relay.events.filter((e) => e.kind === 10003).sort((a, b) => b.created_at - a.created_at);
    assert.ok(lists.length >= 1);
    assert.ok(!lists[0].tags.some((tg) => tg[0] === 'e' && tg[1] === s.note1.id), 'the newest list no longer holds the note');
    assert.deepEqual(x.errors, []);
  });
});

test('a bookmarked note and a comment of yours are drawn as content: wrapped, cut after two and three lines', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    const now = NOW();
    x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Bea' }) }, 'bea');
    const long = 'The quick brown fox jumps over the lazy dog while a long and winding sentence keeps going well past what one line can hold, so a row has to wrap it';
    const note = x.put({ kind: 1, created_at: now - 7200, tags: [], content: long }, 'bea');
    x.put({ kind: 10003, created_at: now - 50, tags: [['e', note.id]], content: '' }, 'me');
    x.put({ kind: 1111, created_at: now - 3600, tags: WEB, content: long + ' ' + long + ' ' + long }, 'me');
    await x.reload();
    await openLibrary(x);
    const metrics = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); const c = getComputedStyle(e); const lh = parseFloat(c.lineHeight); return { clamp: c.webkitLineClamp, lines: Math.round(e.clientHeight / lh), tall: e.scrollHeight > e.clientHeight, size: c.fontSize }; })()`;
    await x.waitFor(`!!document.querySelector('#modal .bm-scroll .bm-text')`);
    const bookmark = await x.evaluate(metrics('#modal .bm-scroll .bm-text'));
    assert.deepEqual([bookmark.clamp, bookmark.lines, bookmark.tall], ['2', 2, true], 'a note: two lines, then cut');
    await x.evaluate(tab(TAB.comments));
    await x.waitFor(`!!document.querySelector('#modal .bm-scroll:not(.hidden) .bm-text')`);
    const comment = await x.evaluate(metrics('#modal .bm-scroll:not(.hidden) .bm-text'));
    assert.deepEqual([comment.clamp, comment.lines, comment.tall], ['3', 3, true], 'your comment: three lines, then cut');
    // Short words are not padded out to the clamp.
    assert.equal(bookmark.size, '13px');
    assert.deepEqual(x.errors, []);
  });
});

test('bookmark sets from other clients show as lists: a picker names them, each shows its own notes, removal touches one list', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    const now = NOW();
    x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Bea' }) }, 'bea');
    const main = x.put({ kind: 1, created_at: now - 7000, tags: [], content: 'In the main list' }, 'bea');
    const soup = x.put({ kind: 1, created_at: now - 7100, tags: [], content: 'A soup worth keeping' }, 'bea');
    const both = x.put({ kind: 1, created_at: now - 7200, tags: [], content: 'In two lists at once' }, 'bea');
    x.put({ kind: 10003, created_at: now - 100, tags: [['e', main.id], ['e', both.id]], content: '' }, 'me');
    x.put({ kind: 30003, created_at: now - 90, tags: [['d', 'recipes-slug'], ['title', 'Recipes'], ['e', soup.id], ['e', both.id]], content: 'private-ciphertext-kept' }, 'me');
    await x.reload();
    await openLibrary(x);
    const picker = `document.querySelector('#modal select.bm-pick')`;
    await x.waitFor(`!!${picker}`);
    // Named by its title, not its d tag, after "All bookmarks" and the main list.
    assert.deepEqual(await x.evaluate(`[...${picker}.options].map((o) => o.textContent)`), ['All bookmarks', 'Bookmarks (2)', 'Recipes (2)']);
    // All: both lists, stacked under their names; a note in two lists is in both.
    const all = await x.evaluate(text('#modal .bm-scroll'));
    assert.match(all, /In the main list/);
    assert.match(all, /A soup worth keeping/);
    assert.equal(await x.evaluate(`document.querySelectorAll('#modal .bm-scroll .bm-item').length`), 4);
    assert.equal(await x.evaluate(`[...document.querySelectorAll('#modal .bm-cat, #modal .bm-title')].map((e) => e.textContent).join('|')`), 'Bookmarks|Recipes');
    // One list: just its own notes, and no heading, since the picker names it.
    await x.evaluate(`(() => { const s = ${picker}; s.value = 'S|recipes-slug'; s.dispatchEvent(new Event('change')); })()`);
    await x.waitFor(`document.querySelectorAll('#modal .bm-scroll .bm-item').length === 2`);
    assert.equal(await x.evaluate(`document.querySelectorAll('#modal .bm-cat').length`), 0);
    assert.doesNotMatch(await x.evaluate(text('#modal .bm-scroll')), /In the main list/);
    // The choice survives closing the sheet.
    await x.evaluate(click('#modal .modal-x'));
    await openLibrary(x);
    await x.waitFor(`!!${picker} && ${picker}.value === 'S|recipes-slug'`);
    // Removing from the set republishes the SET, keeping its d and title tags and its content, and leaves the main list alone.
    const soupRow = `[...document.querySelectorAll('#modal .bm-scroll .bm-item')].find((r) => r.textContent.includes('A soup worth keeping'))`;
    await x.waitFor(`!!(${soupRow})`);
    await openRowMenu(x, soupRow);
    await x.evaluate(`${rowRemove(soupRow)}.click()`);
    await x.sleep(500);
    await x.evaluate(`${rowRemove(soupRow)}.click()`);
    await x.waitFor(`!(${soupRow})`, 15000);
    const sets = x.relay.events.filter((e) => e.kind === 30003).sort((a, b) => b.created_at - a.created_at);
    assert.ok(sets[0].tags.some((tg) => tg[0] === 'd' && tg[1] === 'recipes-slug'), 'the d tag stays');
    assert.ok(sets[0].tags.some((tg) => tg[0] === 'title' && tg[1] === 'Recipes'), 'the title stays');
    assert.ok(!sets[0].tags.some((tg) => tg[0] === 'e' && tg[1] === soup.id), 'the note is gone from the set');
    assert.ok(sets[0].tags.some((tg) => tg[0] === 'e' && tg[1] === both.id), 'the others stay');
    assert.equal(sets[0].content, 'private-ciphertext-kept', 'private items it holds are carried through untouched');
    assert.equal(x.relay.events.filter((e) => e.kind === 10003).length, 1, 'the main list was not republished');
    assert.deepEqual(x.errors, []);
  });
});

test('two lists with the same name are told apart in the picker, and a list’s own description shows under its name', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    const now = NOW();
    x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Bea' }) }, 'bea');
    const n1 = x.put({ kind: 1, created_at: now - 7000, tags: [], content: 'First kept note' }, 'bea');
    const n2 = x.put({ kind: 1, created_at: now - 7100, tags: [], content: 'Second kept note' }, 'bea');
    x.put({ kind: 10003, created_at: now - 100, tags: [['e', n1.id]], content: '' }, 'me');
    // A set called Bookmarks, as another client's default list is, with its own description.
    x.put({ kind: 30003, created_at: now - 90, tags: [['d', 'bookmarks-slug'], ['title', 'Bookmarks'], ['description', 'Things from the other app'], ['e', n2.id]], content: '' }, 'me');
    await x.reload();
    await openLibrary(x);
    const picker = `document.querySelector('#modal select.bm-pick')`;
    await x.waitFor(`!!${picker}`);
    const labels = await x.evaluate(`[...${picker}.options].map((o) => o.textContent)`);
    // Same name, same count: the set also carries its d tag. The main list has none, and stays plain.
    assert.equal(labels[1], 'Bookmarks (1)');
    assert.equal(labels[2], 'Bookmarks (1) · bookmarks-slug');
    await x.evaluate(`(() => { const s = ${picker}; s.value = 'S|bookmarks-slug'; s.dispatchEvent(new Event('change')); })()`);
    await x.waitFor(`!!document.querySelector('#modal .bm-cat-desc')`);
    assert.equal(await x.evaluate(`document.querySelector('#modal .bm-cat-desc').textContent`), 'Things from the other app');
    assert.deepEqual(x.errors, []);
  });
});

// A named list in the library, as another client writes it, with everything a rename must not lose.
function seedSet(x, { d = 'recipes-slug', title = 'Recipes', extra = [] } = {}) {
  const now = NOW();
  x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Bea' }) }, 'bea');
  const main = x.put({ kind: 1, created_at: now - 7000, tags: [], content: 'In the main list' }, 'bea');
  const soup = x.put({ kind: 1, created_at: now - 7100, tags: [], content: 'A soup worth keeping' }, 'bea');
  x.put({ kind: 10003, created_at: now - 100, tags: [['e', main.id]], content: '' }, 'me');
  const set = x.put({ kind: 30003, created_at: now - 90, tags: [['d', d], ['title', title], ['description', 'For the kitchen'], ['image', 'https://img.example/c.jpg'], ['e', soup.id], ...extra], content: 'private-ciphertext-kept' }, 'me');
  return { main, soup, set };
}
// A list's title row keeps what can be done to it behind one ⋮: open it, press the item with these words.
const listMenu = (label) => `(() => { const row = document.querySelector('#modal .bm-title-row'); const b = row.querySelector('.notif-more-btn'); if (!document.querySelector('#modal .bm-title-menu')) b.click(); const i = [...document.querySelectorAll('#modal .bm-title-menu .notif-more-item')].find((e) => e.textContent === ${JSON.stringify(label)}); i.click(); })()`;
const pickList = (key) => `(() => { const s = document.querySelector('#modal select.bm-pick'); s.value = ${JSON.stringify(key)}; s.dispatchEvent(new Event('change')); })()`;

test('a named list is renamed in its title row: the new name is published, and everything else in the list is carried over', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    const s = seedSet(x);
    await x.reload();
    await openLibrary(x);
    await x.waitFor(`!!document.querySelector('#modal select.bm-pick')`);
    // The All view heads the named list with its own title row (pencil and trash), and the main list has none.
    assert.equal(await x.evaluate(`document.querySelectorAll('#modal .bm-title-row').length`), 1);
    assert.equal(await x.evaluate(`document.querySelector('#modal .bm-title-row .bm-title').textContent`), 'Recipes');
    // One ⋮ and no trash can of its own; its menu offers Rename and Delete, Delete in red.
    assert.equal(await x.evaluate(`document.querySelectorAll('#modal .bm-title-row .icon-btn').length`), 0);
    assert.equal(await x.evaluate(`document.querySelectorAll('#modal .bm-title-row .notif-more-btn').length`), 1);
    await x.evaluate(`document.querySelector('#modal .bm-title-row .notif-more-btn').click()`);
    assert.deepEqual(await x.evaluate(`[...document.querySelectorAll('#modal .bm-title-menu .notif-more-item')].map((e) => e.textContent + (e.classList.contains('bm-danger') ? ' (red)' : ''))`), ['Rename list', 'Delete list (red)']);
    await x.evaluate(`document.querySelector('#modal .bm-title-row .notif-more-btn').click()`);
    assert.equal(await x.evaluate(`!!document.querySelector('#modal .bm-title-menu')`), false, 'the ⋮ closes it again');
    assert.equal(await x.evaluate(`document.querySelectorAll('#modal .bm-cat').length`), 1, 'only the main list keeps a plain heading');
    // The pencil works from there, too: no need to pick the list first.
    await x.evaluate(listMenu('Rename list'));
    assert.equal(await x.evaluate(`!!document.querySelector('#modal .bm-title-input')`), true);
    assert.equal(await x.evaluate(`!!document.querySelector('#modal .bm-title-menu')`), false, 'choosing an item closes the menu');
    await x.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await x.evaluate(pickList('S|recipes-slug'));
    await x.waitFor(`!!document.querySelector('#modal .bm-title-row')`);
    assert.equal(await x.evaluate(`document.querySelector('#modal .bm-title').textContent`), 'Recipes');
    // Escape lets go and leaves the sheet open.
    await x.evaluate(listMenu('Rename list'));
    await x.evaluate(`document.querySelector('#modal .bm-title-input').value = 'Nope'`);
    await x.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    assert.equal(await x.evaluate(`document.querySelector('#modal .bm-title').textContent`), 'Recipes');
    assert.equal(await x.evaluate(`!document.getElementById('modal-overlay').classList.contains('hidden')`), true);
    assert.equal(x.relay.events.filter((e) => e.kind === 30003).length, 1, 'cancel publishes nothing');
    // An empty name publishes nothing either.
    await x.evaluate(listMenu('Rename list'));
    await x.evaluate(`(() => { const i = document.querySelector('#modal .bm-title-input'); i.value = '   '; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await x.sleep(300);
    assert.equal(x.relay.events.filter((e) => e.kind === 30003).length, 1);
    // Another client adds a note to the list while the sheet is open: the rename must start from THAT copy.
    const late = x.put({ kind: 1, created_at: NOW() - 50, tags: [], content: 'Added elsewhere meanwhile' }, 'bea');
    x.relay.events.push(x.sign({ kind: 30003, created_at: NOW() - 5, tags: [...s.set.tags, ['e', late.id]], content: s.set.content }, 'me'));
    await x.evaluate(listMenu('Rename list'));
    await x.evaluate(`(() => { const i = document.querySelector('#modal .bm-title-input'); i.value = 'Soups'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await x.waitFor(`document.querySelector('#modal .bm-title') && document.querySelector('#modal .bm-title').textContent === 'Soups'`, 15000);
    const sets = x.relay.events.filter((e) => e.kind === 30003).sort((a, b) => b.created_at - a.created_at);
    const now = sets[0];
    assert.deepEqual(now.tags.filter((tg) => tg[0] === 'title'), [['title', 'Soups']]);
    assert.deepEqual(now.tags[0], ['d', 'recipes-slug']);
    assert.equal(now.tags[1][0], 'title', 'the title sits right after the d tag');
    assert.ok(now.tags.some((tg) => tg[0] === 'description' && tg[1] === 'For the kitchen'));
    assert.ok(now.tags.some((tg) => tg[0] === 'image'));
    assert.ok(now.tags.some((tg) => tg[0] === 'e' && tg[1] === s.soup.id));
    assert.ok(now.tags.some((tg) => tg[0] === 'e' && tg[1] === late.id), 'a note added elsewhere meanwhile is not erased');
    assert.equal(now.content, 'private-ciphertext-kept');
    assert.equal(x.relay.events.filter((e) => e.kind === 10003).length, 1, 'the main list was not touched');
    assert.deepEqual(x.errors, []);
  });
});

test('deleting a list asks in words first, Cancel is the default, and the deletion replaces the list and requests its removal', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    const s = seedSet(x);
    await x.reload();
    await openLibrary(x);
    await x.waitFor(`!!document.querySelector('#modal select.bm-pick')`);
    await x.evaluate(pickList('S|recipes-slug'));
    await x.waitFor(`!!document.querySelector('#modal .bm-title-row')`);
    await x.evaluate(listMenu('Delete list'));
    const box = `document.querySelector('#modal .bm-delete-box')`;
    assert.match(await x.evaluate(`${box}.textContent`), /Recipes/);
    assert.match(await x.evaluate(`${box}.textContent`), /not deleted/);
    // The safe button has the focus, and Delete ignores a tap straight away.
    assert.equal(await x.evaluate(`document.activeElement && document.activeElement.textContent`), 'Cancel');
    // A tap straight away does nothing.
    await x.evaluate(`${box}.querySelector('.del-confirm').click()`);
    await x.sleep(300);
    assert.equal(x.relay.events.filter((e) => e.kind === 5).length, 0);
    assert.equal(await x.evaluate(`!!${box}`), true);
    // Escape closes the box and nothing is published.
    await x.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    assert.equal(await x.evaluate(`!!${box}`), false);
    assert.equal(await x.evaluate(`!document.getElementById('modal-overlay').classList.contains('hidden')`), true);
    assert.equal(x.relay.events.filter((e) => e.kind === 5).length, 0);
    // Ask again and confirm.
    await x.evaluate(listMenu('Delete list'));
    await x.sleep(600);
    await x.evaluate(`${box}.querySelector('.del-confirm').click()`);
    await x.waitFor(`!document.querySelector('#modal .bm-title-row')`, 15000);
    const sets = x.relay.events.filter((e) => e.kind === 30003).sort((a, b) => b.created_at - a.created_at);
    assert.deepEqual(sets[0].tags, [['d', 'recipes-slug']], 'the list is replaced by an empty one');
    assert.equal(sets[0].content, '');
    const req = x.relay.events.find((e) => e.kind === 5);
    assert.ok(req, 'a deletion request was published');
    assert.ok(req.tags.some((tg) => tg[0] === 'a' && tg[1] === '30003:' + x.me + ':recipes-slug'), 'it names the list by address');
    assert.equal(x.relay.events.filter((e) => e.kind === 10003).length, 1, 'the main list was not touched');
    assert.equal(x.relay.events.filter((e) => e.kind === 1).length, 2, 'no note was deleted');
    // The main list is still there, and with one list left there is no picker.
    await x.waitFor(`${text('#modal .bm-scroll')}.includes('In the main list')`);
    assert.equal(await x.evaluate(`!!document.querySelector('#modal select.bm-pick')`), false);
    assert.deepEqual(x.errors, []);
  });
});

test('another app’s own shelves, and the main list, are never offered for rename or delete', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    seedSet(x, { d: 'nostrcooking-bookmarks', title: 'Saved' });
    await x.reload();
    await openLibrary(x);
    await x.waitFor(`!!document.querySelector('#modal select.bm-pick')`);
    await x.evaluate(pickList('S|nostrcooking-bookmarks'));
    await x.sleep(300);
    assert.equal(await x.evaluate(`!!document.querySelector('#modal .bm-title-row')`), false);
    await x.evaluate(pickList('F|'));
    await x.sleep(300);
    assert.equal(await x.evaluate(`!!document.querySelector('#modal .bm-title-row')`), false);
  });
});

// Everything a list can hold, as other clients write it: private entries encrypted to the account's own key
// (both schemes), an article and a hashtag and a web address in the open, and a note nobody has.
async function seedMixed(x) {
  const now = NOW();
  x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Bea' }) }, 'bea');
  const open = x.put({ kind: 1, created_at: now - 7000, tags: [], content: 'A public note in the open' }, 'bea');
  const hidden = x.put({ kind: 1, created_at: now - 7100, tags: [], content: 'A note only the owner knows is saved' }, 'bea');
  const old = x.put({ kind: 1, created_at: now - 7200, tags: [], content: 'A note saved under the older scheme' }, 'bea');
  const ghost = x.sign({ kind: 1, created_at: now - 7300, tags: [], content: 'Nobody has this' }, 'bea');
  const article = x.put({ kind: 30023, created_at: now - 6000, tags: [['d', 'on-soup'], ['title', 'On soup, at length']], content: 'Long body of an article' }, 'bea');
  const coord = '30023:' + x.bea + ':on-soup';
  const seal = async (nip, tags) => {
    const r = await x.message({ type: 'SIDECAR_OWNER_ENCRYPT', nip, plaintext: JSON.stringify(tags), expectedPubkey: x.me });
    return r && (r.result || r.ciphertext || r.data);
  };
  const modern = await seal(44, [['e', hidden.id], ['r', 'https://private.example/page']]);
  const legacy = await seal(4, [['e', old.id]]);
  assert.ok(modern && legacy, 'the worker sealed both: ' + JSON.stringify([modern, legacy]));
  x.put({ kind: 10003, created_at: now - 100, tags: [['e', open.id], ['a', coord], ['r', 'https://example.org/recipe'], ['t', 'cooking'], ['e', ghost.id]], content: modern }, 'me');
  x.put({ kind: 30003, created_at: now - 90, tags: [['d', 'older'], ['title', 'Older list']], content: legacy }, 'me');
  return { open, hidden, old, ghost, article, coord, modern, legacy };
}

test('a library shows all of what was saved: private entries (both schemes), articles, web addresses and hashtags, and says what it could not find', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    const s = await seedMixed(x);
    await x.reload();
    await x.recordTabs();
    await openLibrary(x);
    await x.waitFor(`${text('#modal .bm-scroll')}.includes('On soup, at length')`);
    const body = await x.evaluate(text('#modal .bm-scroll'));
    for (const want of ['A public note in the open', 'A note only the owner knows is saved', 'A note saved under the older scheme', 'On soup, at length', 'example.org', 'private.example', '#cooking']) {
      assert.ok(body.includes(want), 'shows: ' + want);
    }
    assert.ok(!/\bnull\b/.test(body), 'no stray word where a part is absent');
    // The ghost: counted, with its own line, and not drawn as a row of its own.
    assert.match(body, /1 saved item couldn’t be found on your relays\./);
    assert.ok(!body.includes('Unknown author'));
    // Private entries wear a lock and cannot be removed here; public ones can, from their ⋮. No row has a trash can on it.
    assert.equal(await x.evaluate(`!!document.querySelector('#modal .bm-item .item-actions svg[data-icon="trash"]')`), false);
    const state = await x.evaluate(`[...document.querySelectorAll('#modal .bm-item')].map((r) => { const b = r.querySelector('.item-actions .notif-more-btn'); if (b) b.click(); return { lock: !!r.querySelector('.bm-lock'), items: [...r.querySelectorAll('.notif-more .notif-more-item')].map((i) => i.textContent) }; })`);
    const priv = state.filter((r) => r.lock);
    assert.equal(priv.length, 3, 'three private entries: two in the main list, one in the older list');
    assert.ok(priv.every((r) => !r.items.includes('Remove bookmark')), 'a private entry is shown and not removable here');
    assert.ok(state.filter((r) => !r.lock).every((r) => r.items.includes('Remove bookmark')), 'a public entry can be removed from its menu');

    // Each opens where it should: a note and an article in the client, a web address in a new tab, a hashtag as a search.
    const open = async (match) => {
      await x.clearCalls();
      await x.evaluate(`[...document.querySelectorAll('#modal .bm-item')].find((r) => r.innerText.includes(${JSON.stringify(match)})).click()`);
      await x.waitFor(`true`);
      await x.sleep(400);
      return openedUrls(await x.calls());
    };
    const article = await open('On soup, at length');
    assert.equal(article.length, 1);
    const naddr = /(naddr1[0-9a-z]+)/.exec(article[0]);
    assert.ok(naddr, 'the article opens by address: ' + article[0]);
    assert.deepEqual({ ...x.nt.decode(naddr[1]).data, relays: undefined }, { identifier: 'on-soup', pubkey: x.bea, kind: 30023, relays: undefined });
    assert.deepEqual(await open('example.org'), ['https://example.org/recipe']);
    assert.ok((await open('#cooking'))[0].includes('cooking'));
    assert.ok(idIn(x, (await open('A note only the owner knows'))[0]) === s.hidden.id);

    // Removing a public entry republishes the list without it and keeps the private half exactly as it was.
    const row = `[...document.querySelectorAll('#modal .bm-item')].find((r) => r.innerText.includes('example.org'))`;
    await openRowMenu(x, row);
    await x.evaluate(`${rowRemove(row)}.click()`);
    await x.sleep(500);
    await x.evaluate(`${rowRemove(row)}.click()`);
    await x.waitFor(`!${text('#modal .bm-scroll')}.includes('example.org')`, 15000);
    const latest = x.relay.events.filter((e) => e.kind === 10003).sort((a, b) => b.created_at - a.created_at)[0];
    assert.ok(!latest.tags.some((tg) => tg[0] === 'r'), 'the web address is gone from the list');
    assert.ok(latest.tags.some((tg) => tg[0] === 'a' && tg[1] === s.coord), 'the article stays');
    assert.ok(latest.tags.some((tg) => tg[0] === 't' && tg[1] === 'cooking'), 'the hashtag stays');
    assert.equal(latest.content, s.modern, 'the private half is carried over as it was');
    assert.deepEqual(x.errors, []);
  });
});

test('a list whose private half will not read says so instead of looking shorter than it is', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    const s = seedSet(x);   // its content is not ciphertext this account can open
    await x.reload();
    await openLibrary(x);
    await x.waitFor(`!!document.querySelector('#modal select.bm-pick')`);
    await x.evaluate(pickList('S|recipes-slug'));
    await x.waitFor(`${text('#modal .bm-scroll')}.includes('Some private items couldn’t be read.')`);
    assert.ok((await x.evaluate(text('#modal .bm-scroll'))).includes('A soup worth keeping'));
    assert.deepEqual(x.errors, []);
  });
});

test('a mute pack published as a generic list is not a bookmark list: its hashtags, people and muted threads stay out', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    const now = NOW();
    x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Bea' }) }, 'bea');
    const kept = x.put({ kind: 1, created_at: now - 7000, tags: [], content: 'A note that was bookmarked' }, 'bea');
    const muted = x.put({ kind: 1, created_at: now - 7100, tags: [], content: 'A thread that was muted, not bookmarked' }, 'bea');
    x.put({ kind: 10003, created_at: now - 100, tags: [['e', kept.id], ['t', 'cooking']], content: '' }, 'me');
    x.put({ kind: 30001, created_at: now - 90, tags: [['d', 'bots'], ['p', x.bea], ['e', muted.id], ['t', 'bot'], ['name', 'Chatty bots'], ['L', 'mutable'], ['l', 'community-pack', 'mutable']], content: '' }, 'me');
    // A set carrying a category tag does not turn it into a hashtag bookmark.
    x.put({ kind: 30003, created_at: now - 80, tags: [['d', 'soups'], ['title', 'Soups'], ['e', kept.id], ['t', 'category']], content: '' }, 'me');
    await x.reload();
    await openLibrary(x);
    await x.waitFor(`${text('#modal .bm-scroll')}.includes('A note that was bookmarked')`);
    const body = await x.evaluate(text('#modal .bm-scroll'));
    assert.ok(!body.includes('Chatty bots') && !body.includes('#bot') && !body.includes('A thread that was muted'));
    assert.ok(!body.includes('#category'), 'a set’s category tag is not a bookmark');
    assert.ok(body.includes('#cooking'), 'the main list’s hashtag is');
    assert.equal(await x.evaluate(`[...document.querySelectorAll('#modal select.bm-pick option')].map((o) => o.value).join()`), 'ALL,F|,S|soups');
    assert.deepEqual(x.errors, []);
  });
});
