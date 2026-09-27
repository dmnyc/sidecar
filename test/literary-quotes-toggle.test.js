'use strict';

// Settings → Appearance → Literary quotes.
//
// The quotes are furniture in three places: an empty list, a list still loading, and the
// end of a list. Turned off, each keeps what it is FOR: the empty state its hint, the
// waiting state its spinner row, and the end of a list nothing at all.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.html'), 'utf8');
const bare = src.replace(/^\s*\/\/.*$/gm, '');

function lift(decl) {
  const at = bare.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = bare.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < bare.length; j++) {
    if (bare[j] === '{') depth++;
    else if (bare[j] === '}' && --depth === 0) return bare.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// A tiny element model: enough to read back class names and text.
function h(tag, props, children) {
  return { tag, ...(props || {}), children: (children || []).filter(Boolean) };
}
const text = (el) => [el.textContent || '', ...(el.children || []).map(text)].join(' ').replace(/\s+/g, ' ').trim();
const classes = (el) => [el.className || '', ...(el.children || []).flatMap(classes)].filter(Boolean);

const Q = { text: 'Only connect.', who: 'E. M. Forster, 1910' };

function build(showQuotes) {
  let drawn = 0;
  const pickQuote = () => { drawn++; return Q; };
  const waitingRow = (label) => h('div', { className: 'recv-waiting' }, [h('span', { textContent: label })]);
  // eslint-disable-next-line no-new-func
  const fns = new Function('h', 'pickQuote', 'waitingRow', 'showQuotes', `
    ${lift('function emptyQuote(')}
    ${lift('function endQuote(')}
    ${lift('function loadingQuote(')}
    return { emptyQuote, endQuote, loadingQuote };`)(h, pickQuote, waitingRow, showQuotes);
  return Object.assign(fns, { drawn: () => drawn });
}

test('on (the default): all three carry the quote and its attribution', () => {
  const m = build(true);
  for (const el of [m.emptyQuote('Hint.'), m.endQuote(), m.loadingQuote('Loading…')]) {
    assert.ok(classes(el).includes('bm-quote'));
    assert.match(text(el), /Only connect\.[\s\S]*E\. M\. Forster/);
  }
});

test('OFF: THE EMPTY STATE KEEPS ITS HINT AND LOSES THE QUOTE', () => {
  const m = build(false);
  const el = m.emptyQuote('Replies, reactions and zaps show up here.');
  assert.equal(text(el), 'Replies, reactions and zaps show up here.');
  assert.ok(!classes(el).includes('bm-quote'));
});

test('off: the waiting state keeps its spinner row', () => {
  const m = build(false);
  const el = m.loadingQuote('Reading your relays…');
  assert.ok(classes(el).includes('recv-waiting'), 'still says it is working');
  assert.equal(text(el), 'Reading your relays…');
});

test('off: the end of a list is an empty element, never null', () => {
  // Callers append the result, and append(null) writes the text "null".
  const el = build(false).endQuote();
  assert.ok(el && typeof el === 'object');
  assert.equal(text(el), '');
});

test('off: no quote is even drawn', () => {
  const m = build(false);
  m.emptyQuote('x'); m.endQuote(); m.loadingQuote('y');
  assert.equal(m.drawn(), 0);
});

test('the switch is wired like On this day: default on, stored as an explicit false', () => {
  assert.match(html, /<input type="checkbox" id="quotes-toggle" \/> <span>Show literary quotes<\/span>/);
  assert.ok(html.indexOf('id="quotes-toggle"') > html.indexOf('id="otd-toggle"'), 'it sits under On this day');
  assert.match(src, /let showQuotes = true;/);
  assert.match(src, /showQuotes = !\(settings && settings\.literaryQuotes === false\);/);
  assert.match(src, /\$\('quotes-toggle'\)\.checked = settings\.literaryQuotes !== false;/);
  assert.match(src, /settings: \{ literaryQuotes: e\.target\.checked \}/);
});
