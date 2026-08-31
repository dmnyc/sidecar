'use strict';

// The period quotes that stand in where there is no content.
//
// CURATED RATHER THAN VENDORED, and that was a licensing decision before it was a taste
// one. The open quote corpora do not survive contact with a shipped extension:
// JamesFT/Database-Quotes-JSON and Quotes-500K carry no license at all (so, all rights
// reserved), and the two MIT repos license their CODE — wickedQuotes parses Wikiquote,
// whose text is CC BY-SA and therefore copyleft, and quotable documents nothing about
// where its quotations came from while sourcing author bios from the wiki API.
//
// The underlying WORKS are a different matter, and that is what these tests pin: every
// entry is published pre-1931 and long out of US copyright, so quoting it needs nobody's
// permission. The failure this guards against is someone adding a line they liked from a
// living author, which would quietly put a licensing problem in the extension.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

const block = panel.match(/const PERIOD_QUOTES = \[[\s\S]*?\n  \];/)[0];
const entries = [...block.matchAll(/text: '((?:[^'\\]|\\.)*)',\s*\n?\s*who: '([^']+)'/g)]
  .concat([...block.matchAll(/text:\s*\n?\s*'((?:[^'\\]|\\.)*)',\s*\n\s*who: '([^']+)'/g)]);

test('there are quotes, and each has an attribution', () => {
  assert.ok(entries.length >= 6, 'expected a usable spread, found ' + entries.length);
  for (const [, text, who] of entries) {
    assert.ok(text.trim().length > 0, 'empty quote');
    assert.match(who, /, \d{4}$/, 'every quote names a person and a year: ' + who);
  }
});

test('EVERY QUOTE IS OUT OF COPYRIGHT', () => {
  // The whole reason this is hand-written rather than imported. US copyright: works
  // published before 1931 are public domain. A line from a living author would be a
  // licensing problem shipped in an extension, and it would look exactly like the others.
  for (const [, , who] of entries) {
    const year = Number(who.match(/(\d{4})$/)[1]);
    assert.ok(
      year < 1931,
      who + ' is dated ' + year + ' — past the pre-1931 public-domain line this list relies on'
    );
  }
});

test('they stay short enough for a narrow panel', () => {
  // 360px, and it can be dragged narrower. A quote running to six lines stops being an
  // ornament and becomes a wall.
  for (const [, text, who] of entries) {
    assert.ok(text.length <= 140, who + ' runs to ' + text.length + ' characters');
  }
});

test('one source, three uses', () => {
  // The point of generalizing it: the same furniture for an empty bookmark list, a new
  // account's empty notifications, and the bottom of a list with no more to give.
  assert.match(panel, /function pickQuote\(\) \{/);
  assert.match(panel, /function emptyQuote\(hint, q\)/);
  assert.match(panel, /function endQuote\(q\)/);
  // Bookmarks: empty, and the end of the list.
  assert.match(panel, /scroll\.append\(emptyQuote\('Bookmark a note from any Nostr client/);
  assert.match(panel, /scroll\.append\(endQuote\(panelQuote\)\);/);
  // Notifications: empty for a new account, and the caught-up note.
  assert.match(panel, /emptyQuote\('Replies, reactions and zaps show up here\.', panelQuote\)/);
  assert.match(panel, /sub,\s*\n\s*endQuote\(panelQuote\),/);
});

test('the empty state still says what to do', () => {
  // The quote is furniture, not the answer. Someone looking at an empty list needs to
  // know how it gets filled.
  const fn = panel.slice(panel.indexOf('function emptyQuote(hint, q)'));
  assert.match(fn.slice(0, fn.indexOf('\n  }')), /hint \? h\('p', \{ className: 'hint'/);
});

test('the end-of-list variant is quieter than the empty state', () => {
  // At the bottom of a full list it is a full stop, not a page — and it must not read as
  // another row.
  assert.match(css, /\.bm-end \{[^}]*border-top: 1px solid var\(--border\);/);
  assert.match(css, /\.bm-end \.bm-quote \{[^}]*color: var\(--muted\);/);
});

test('the same quote never appears twice running', () => {
  // Two panels showing the same line at once reads as a bug, not a coincidence — which is
  // how it was reported. Independent draws from a short list collide constantly.
  const vm = require('node:vm');
  const src = panel.match(/const PERIOD_QUOTES = \[[\s\S]*?\n  \];/)[0] +
    '\n' + panel.match(/  let _lastQuote = -1;\n  function pickQuote\(\) \{[\s\S]*?\n  \}/)[0];
  const ctx = { Math, Array };
  vm.createContext(ctx);
  vm.runInContext('(function () {\n' + src + '\nthis.pick = pickQuote;\n}).call(this)', ctx);

  let prev = null;
  for (let n = 0; n < 400; n++) {
    const q = ctx.pick();
    assert.notEqual(q.who, prev, 'repeated ' + q.who + ' back to back');
    prev = q.who;
  }
});

test('the pool is wide enough that repeats are not obvious', () => {
  assert.ok(entries.length >= 8, 'only ' + entries.length + ' quotes — collisions get noticeable');
});

// ---- the end of a list that arrived after the empty state ------------------------

test('a bell that opens empty still gets an end note once it fills', () => {
  // The reported sequence: open the bell on an account with nothing, get the empty-state
  // quote, then a live notification arrives. clearEmptyMessage takes the quote away, the
  // item is prepended — and the list used to just stop at the last row.
  //
  // The cause was that the end note was built inline in loadMore, which only runs via
  // `if (events.length) loadMore()`. A modal that opened empty never called it.
  assert.match(panel, /function showEndNote\(\) \{/, 'the end note must be reachable on its own');
  assert.match(panel, /_openNotifBell = \{ pubkey: a\.pubkey, list, buildItem, clearEmptyMessage, showEndNote, addLive \}/);
  // The live path now goes through addLive, which sorts the arrival AND closes the list
  // off. Asserting the call plus addLive's own showEndNote keeps the same guarantee.
  assert.match(panel, /_openNotifBell\.addLive\(ev\);/, 'a live arrival must be routed, not prepended blind');
  const addLive = panel.slice(panel.indexOf('function addLive(ev)'));
  assert.match(addLive.slice(0, addLive.indexOf('\n      }')), /showEndNote\(\);/,
    'and it must still close the list off');
});

test('the end note is refused when it would be wrong', () => {
  // Two ways to get this wrong, and both look plausible. A pending "Load more" means this
  // is not the end, so the note would be a lie. An empty list has no end to mark — the
  // empty state already says so, and two quotes stacked reads as a mistake.
  const fn = panel.slice(panel.indexOf('function showEndNote()'));
  const body = fn.slice(0, fn.indexOf('\n      }'));
  assert.match(body, /if \(endNote \|\| moreBtn\) return;/, 'not while more can be loaded');
  // Now also true when the only rows are out-of-network: those live in their own
  // collapsed group, so the bell is not empty and the end note still belongs.
  assert.match(body, /if \(!list\.children\.length && !offNet\.length\) return;/, 'not on a genuinely empty bell');
});

test('loadMore delegates rather than duplicating it', () => {
  // Two copies of this would drift, and the inline one is what caused the bug.
  const fn = panel.slice(panel.indexOf('function loadMore()'));
  const body = fn.slice(0, fn.indexOf('\n      }'));
  assert.match(body, /showEndNote\(\);/);
  assert.doesNotMatch(body, /notif-end-title/, 'the note must be built in one place only');
});

test('A PANEL KEEPS THE QUOTE IT STARTED WITH', () => {
  // Reported: the bell opened empty, a notification landed a moment later, and the quote
  // was swapped for a different one at the bottom of the list before it had been read.
  // A quote you cannot finish reading is worse than no quote.
  //
  // So the quote is drawn ONCE per opening and handed to both renderers, rather than each
  // of them drawing its own.
  for (const fn of ['emptyQuote', 'endQuote']) {
    const src = panel.slice(panel.indexOf('function ' + fn + '('));
    const head = src.slice(0, src.indexOf('\n  }'));
    assert.match(head, /q = q \|\| pickQuote\(\);/, fn + ' must accept a quote instead of always drawing one');
  }
  // The bell is the surface where both can appear in sequence, so it must pass one.
  assert.match(panel, /const panelQuote = pickQuote\(\);/);
  assert.match(panel, /emptyQuote\('Replies, reactions and zaps show up here\.', panelQuote\)/);
  assert.match(panel, /endQuote\(panelQuote\),/);
  // Bookmarks follow the same rule.
  assert.match(panel, /emptyQuote\('Bookmark a note from any Nostr client and it shows up here\.', panelQuote\)/);
  assert.match(panel, /scroll\.append\(endQuote\(panelQuote\)\);/);
  // And nothing draws its own mid-render.
  assert.doesNotMatch(panel, /endQuote\(\)\)/, 'no bare endQuote() call should remain');
});
