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

test('a bookmark’s trash asks once in place: any other tap lets go, Escape lets go, the second tap removes', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    const s = seed(x);
    await x.reload();
    await x.recordTabs();
    await openLibrary(x);
    const row = `document.querySelector('#modal .bm-scroll .bm-item')`;
    const trash = `${row}.querySelector('.item-actions .icon-btn:last-child')`;
    await x.waitFor(`${text('#modal .bm-scroll')}.includes('A note worth reacting to')`);
    const resting = await x.evaluate(`${row}.querySelector('.bm-meta').textContent`);
    const armed = () => x.evaluate(`${trash}.classList.contains('del-confirm')`);
    const meta = () => x.evaluate(`${row}.querySelector('.bm-meta').textContent`);
    const layout = () => x.evaluate(`${row}.getBoundingClientRect().height`);
    const before = await layout();

    // One tap arms it, in place: the trash goes red, and the date line says what to do. Nothing is added to the row.
    await x.evaluate(`${trash}.click()`);
    assert.equal(await armed(), true);
    assert.equal(await meta(), 'Tap again to confirm');
    assert.ok(Math.abs((await layout()) - before) < 2, 'the row does not grow');
    // A second tap straight after, as a double-tap would be, removes nothing.
    await x.evaluate(`${trash}.click()`);
    assert.equal(await armed(), true);
    assert.equal(await x.evaluate(rows('#modal .bm-scroll')), 1);

    // A tap on the row lets go, and does not open the client behind the question.
    await x.sleep(500);
    await x.clearCalls();
    await x.evaluate(`${row}.querySelector('.bm-main').click()`);
    assert.equal(await armed(), false);
    assert.equal(await meta(), resting, 'the date line comes back');
    await x.sleep(300);
    assert.deepEqual(openedUrls(await x.calls()), []);

    // A tap elsewhere in the sheet lets go.
    await x.evaluate(`${trash}.click()`);
    await x.evaluate(`document.querySelector('#modal .modal-tabs').click()`);
    assert.equal(await armed(), false);

    // Escape lets go and does not close the sheet.
    await x.evaluate(`${trash}.click()`);
    await x.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    assert.equal(await armed(), false);
    assert.equal(await x.evaluate(`!document.getElementById('modal-overlay').classList.contains('hidden')`), true);

    // The second tap, a moment later, removes it: the list is published again without the note.
    await x.evaluate(`${trash}.click()`);
    await x.sleep(500);
    await x.evaluate(`${trash}.click()`);
    await x.waitFor(`document.querySelectorAll('#modal .bm-scroll .bm-item').length === 0`, 15000);
    const lists = x.relay.events.filter((e) => e.kind === 10003).sort((a, b) => b.created_at - a.created_at);
    assert.ok(lists.length >= 1);
    assert.ok(!lists[0].tags.some((tg) => tg[0] === 'e' && tg[1] === s.note1.id), 'the newest list no longer holds the note');
    assert.deepEqual(x.errors, []);
  });
});
