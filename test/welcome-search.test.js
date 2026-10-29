'use strict';

// The Welcome page's word search. Every typed word has to appear in a card's name, address,
// description or category, in any order and any case, and it combines with the category pills.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'welcome.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'welcome.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'welcome.css'), 'utf8');

const start = source.indexOf("let activeCat = 'all';");
const funcs = source.slice(start, source.indexOf("document.getElementById('filters').addEventListener"));
const wiring = source.slice(source.indexOf("const searchBox = document.getElementById('search');"), source.indexOf('// First-run nudge'));

function app(cat, name, domain, desc, label) {
  const c = { dataset: { cat, search: [name, domain, desc, label].join(' ').toLowerCase() }, hidden: false };
  c.classList = { toggle(n, on) { assert.equal(n, 'hidden-cat'); c.hidden = !!on; } };
  return c;
}
const CARDS = () => [
  app('social', 'Jumble', 'jumble.social', 'A clean relay-first feed: browse any relay like a channel.', 'Social'),
  app('media', 'Wavlake', 'wavlake.com', 'Music streaming where artists get paid directly: play, boost, and zap.', 'Media'),
  app('commerce', 'Shopstr', 'shopstr.market', 'A permissionless marketplace: buy and sell for Bitcoin over Lightning.', 'Commerce'),
  app('commerce', 'Geyser', 'geyser.fund', 'Crowdfunding for Bitcoin and Nostr projects, powered by Lightning.', 'Commerce'),
];

function page(cards = CARDS()) {
  const none = { hidden: true, textContent: '' };
  const slot = { hidden: false };
  const listeners = {};
  const box = { value: '', addEventListener(type, f) { listeners[type] = f; } };
  const ctx = {
    document: { querySelectorAll: () => cards, getElementById: (id) => (id === 'no-match' ? none : id === 'search' ? box : null) },
    t: (text, vars) => (vars ? text.replace('{{query}}', vars.query) : text),
  };
  vm.createContext(ctx);
  vm.runInContext(funcs, ctx);
  vm.runInContext(wiring, ctx);
  return { ctx, cards, none, slot, box, listeners, type: (v) => { box.value = v; listeners.input(); }, key: (k) => listeners.keydown({ key: k }),
    setCat: (c) => { vm.runInContext('activeCat = ' + JSON.stringify(c), ctx); ctx.applyFilters(); }, shown: () => cards.filter((c) => !c.hidden).map((c) => c.dataset.search.split(' ')[0]) };
}

test('every typed word must appear, in any order and any case', () => {
  const p = page();
  p.type('LIGHTNING bitcoin');
  assert.deepEqual(p.shown(), ['shopstr', 'geyser']);
  p.type('bitcoin lightning shop');
  assert.deepEqual(p.shown(), ['shopstr']);
  p.type('zzz');
  assert.deepEqual(p.shown(), []);
});

test('it looks in the name, the address, the description and the category', () => {
  const p = page();
  p.type('jumble'); assert.deepEqual(p.shown(), ['jumble']);
  p.type('wavlake.com'); assert.deepEqual(p.shown(), ['wavlake']);
  p.type('boost'); assert.deepEqual(p.shown(), ['wavlake']);
  p.type('media'); assert.deepEqual(p.shown(), ['wavlake']);
  p.type('comm'); assert.deepEqual(p.shown(), ['shopstr', 'geyser'], 'part of a word counts');
});

test('it works with the category pills, and clearing the box restores them', () => {
  const p = page();
  p.setCat('commerce');
  assert.deepEqual(p.shown(), ['shopstr', 'geyser']);
  p.type('geyser');
  assert.deepEqual(p.shown(), ['geyser']);
  p.type('jumble');
  assert.deepEqual(p.shown(), [], 'a social app does not show under Commerce');
  p.type('');
  assert.deepEqual(p.shown(), ['shopstr', 'geyser']);
  p.setCat('all');
  assert.equal(p.shown().length, 4);
});

test('extra spaces are ignored, and a box of spaces matches everything', () => {
  const p = page();
  p.type('  bitcoin    lightning  ');
  assert.deepEqual(p.shown(), ['shopstr', 'geyser']);
  p.type('     ');
  assert.equal(p.shown().length, 4);
});

test('when nothing matches the page says so, with what was typed, and the message goes away after', () => {
  const p = page();
  p.type('Nonexistent   thing');
  assert.equal(p.none.hidden, false);
  assert.equal(p.none.textContent, 'No apps match “nonexistent thing”. Try fewer words, or a different category.');
  p.type('jumble');
  assert.equal(p.none.hidden, true);
  assert.equal(p.none.textContent, '');
});

test('Escape clears the box, and only when there is something in it', () => {
  const p = page();
  p.type('jumble');
  p.key('a');
  assert.deepEqual(p.shown(), ['jumble']);
  p.key('Escape');
  assert.equal(p.box.value, '');
  assert.equal(p.shown().length, 4);
  p.key('Escape');
  assert.equal(p.shown().length, 4);
});

test('the typed text goes through the translator as a value, never into the sentence', () => {
  assert.match(source, /t\('No apps match “\{\{query\}\}”\. Try fewer words, or a different category\.', \{ query: searchWords\.join\(' '\) \}\)/);
});

test('a card carries what is searched, and the open slot is never filtered', () => {
  assert.match(source, /a\.dataset\.search = \[app\.name, app\.domain, app\.desc, labels\[app\.cat\]\]\.join\(' '\)\.toLowerCase\(\);/);
  assert.match(source, /querySelectorAll\('\.card:not\(\.app-slot\)'\)\.forEach\(card => \{\s*const match = cardMatches/);
});

test('the page has the box, the message, and styles for both', () => {
  assert.match(html, /<input id="search" type="search" placeholder="Search apps" data-i18n-placeholder="Search apps" aria-label="Search apps" data-i18n-aria-label="Search apps"/);
  assert.match(html, /<p class="no-match" id="no-match" role="status" hidden><\/p>/);
  assert.match(css, /\.search input \{/);
  assert.match(css, /\.no-match\[hidden\] \{ display: none; \}/);
  assert.ok(html.indexOf('id="search"') < html.indexOf('id="filters"'), 'the box sits above the pills');
});
