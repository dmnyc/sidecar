'use strict';

// What the bookmarks modal shows while it is still reading.
//
// It opened on a bare spinner, which threw away the one moment the quote is actually
// read: the modal is empty, there is nothing else on screen, and the relays take a
// second. The quote goes there instead, with the spinner line underneath it.
//
// The catch is the one already reported against the bell. An account with no bookmarks
// goes from this screen straight to the empty one, and if each drew its own quote the
// line would change halfway through being read. So the loading screen draws it and the
// list that lands is handed the same one.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  let paren = 0;
  let i = source.indexOf('(', at);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// ---- the quote that was already on screen ------------------------------------------------

test('THE LOADING QUOTE IS THE ONE THAT STAYS', () => {
  // Reported once already for the bell: a quote swapped out mid-read is worse than no
  // quote. An empty account goes from the loading screen straight to the empty one, so
  // those two have to be showing the same line.
  const src = stripComments(source);
  assert.match(src, /const waitQuote = pickQuote\(\)/, 'the loading screen draws no quote');
  assert.match(src, /loadingQuote\('Reading your relays…', waitQuote\)/, 'the spinner is still bare');
  assert.match(
    src,
    /fillBookmarks\(scroll, gone, _bmCache\.evs, _bmCache\.events, waitQuote\)/,
    'the list that lands picks its own quote, so the line changes on arrival'
  );
  const fill = stripComments(lift('async function fillBookmarks('));
  assert.match(fill, /const panelQuote = q \|\| pickQuote\(\)/, 'the handed-in quote is ignored');
});

test('the loading block is the empty block, spinner included', () => {
  const f = stripComments(lift('function loadingQuote('));
  assert.match(f, /className: 'bm-empty'/, 'it is furniture of its own rather than the empty state');
  assert.match(f, /className: 'bm-quote'/, 'no quote');
  // The spinner moved into waitingRow, which every region-sized wait in the panel now
  // shares. What matters here is that this block still HAS one, not where it is built.
  assert.match(f, /waitingRow\(label\)/, 'no spinner, so nothing says it is still working');
  const row = stripComments(lift('function waitingRow('));
  assert.match(row, /className: 'recv-spinner'/, 'and the shared row is what carries it');
  assert.match(f, /q = q \|\| pickQuote\(\)/, 'a caller cannot hand in the line to keep');
  assert.match(css, /\.bm-empty \.recv-waiting \{[^}]*justify-content: center/, 'the spinner row hangs left');
});
