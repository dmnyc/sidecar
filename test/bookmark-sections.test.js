'use strict';

// Unit coverage for bookmarkSections() — the shaping behind the Bookmarks tab.
//
// The fetch is network and the rows are DOM, but the ORDER is the part users
// feel: the flat list first, categories after, newest copy of each list win.
// Replaceable events arrive as copies from every relay, and an older copy of
// the flat list beating the newer one is the same stale-read bug the backup
// export had — so the rule is pinned here, not left to the query's mood.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

const m = source.match(/function bookmarkSections\(evs\) \{[\s\S]*?\n  \}/);
if (!m) throw new Error('Could not find bookmarkSections in sidepanel.js');
const bookmarkSections = new vm.Script('(function(){' + m[0] + '\nreturn bookmarkSections;\n})()').runInNewContext({});

const ev = (kind, created_at, d, ids) => ({
  kind,
  created_at,
  tags: (d ? [['d', d]] : []).concat(ids.map((id) => ['e', id])),
});

test('flat list alone: one untitled section', () => {
  const s = bookmarkSections([ev(10003, 100, null, ['a', 'b'])]);
  assert.equal(s.length, 1);
  assert.equal(s[0].title, '');
  assert.equal(s[0].ev.kind, 10003);
});

test('flat first, then categories sorted by name', () => {
  const s = bookmarkSections([
    ev(30001, 100, 'tools', ['t1']),
    ev(10003, 100, null, ['f1']),
    ev(30001, 100, 'articles', ['a1']),
  ]);
  assert.deepEqual([...s.map((x) => x.title)], ['', 'articles', 'tools']); // spread: realm array → local
});

test('newest copy of the flat list wins over an older one', () => {
  const s = bookmarkSections([ev(10003, 100, null, ['old']), ev(10003, 200, null, ['new'])]);
  assert.equal(s.length, 1);
  assert.deepEqual([...s[0].ev.tags.map((t) => t[1])], ['new']);
});

test('newest copy wins per category, not across categories', () => {
  const s = bookmarkSections([
    ev(30001, 500, 'a', ['a-old']),
    ev(30001, 100, 'b', ['b-new']),
    ev(30001, 900, 'a', ['a-new']),
  ]);
  assert.deepEqual([...s.map((x) => x.ev.tags.find((t) => t[0] === 'e')[1])], ['a-new', 'b-new']); // tags[0] is the d-tag
});

test('a 30001 without a d-tag is its own untitled section, not the flat list', () => {
  const s = bookmarkSections([ev(10003, 100, null, ['flat']), ev(30001, 100, null, ['cat'])]);
  assert.equal(s.length, 2);
  assert.equal(s[0].ev.kind, 10003);
  assert.deepEqual([...s[1].ev.tags.map((t) => t[1])], ['cat']);
});

test('no bookmark events at all: no sections', () => {
  assert.equal(bookmarkSections([]).length, 0);
  assert.equal(bookmarkSections(null).length, 0);
});

test('a bookmark set (30003) is a section, named by its title tag and by its d tag only without one', () => {
  const set = (d, title, ids) => ({ kind: 30003, created_at: 100, tags: [['d', d]].concat(title ? [['title', title]] : []).concat(ids.map((id) => ['e', id])) });
  const s = bookmarkSections([set('r1', 'Recipes', ['x']), set('plain', '', ['y']), ev(10003, 100, null, ['f'])]);
  assert.deepEqual([...s.map((x) => x.title)], ['', 'plain', 'Recipes']);
  assert.equal(s[2].ev.kind, 30003);
  assert.deepEqual([...s.map((x) => x.key)], ['F|', 'S|plain', 'S|r1'], 'each list has its own key, and a set is not an older 30001 of the same name');
});

test('a set and an older generic list of one name are two lists, and the newest copy of each wins', () => {
  const s = bookmarkSections([
    { kind: 30003, created_at: 100, tags: [['d', 'a'], ['e', 'set-old']] },
    { kind: 30003, created_at: 300, tags: [['d', 'a'], ['e', 'set-new']] },
    { kind: 30001, created_at: 200, tags: [['d', 'a'], ['e', 'legacy']] },
  ]);
  assert.equal(s.length, 2);
  assert.deepEqual([...s.flatMap((x) => x.ev.tags.filter((t) => t[0] === 'e').map((t) => t[1]))].sort(), ['legacy', 'set-new']);
});

test('a list’s description (or Zap Cooking’s summary) rides along, and the flat list has none', () => {
  const s = bookmarkSections([
    ev(10003, 100, null, ['f']),
    { kind: 30003, created_at: 100, tags: [['d', 'a'], ['title', 'A'], ['description', '  For later  '], ['e', 'x']] },
    { kind: 30001, created_at: 100, tags: [['d', 'b'], ['summary', 'From recipes'], ['e', 'y']] },
  ]);
  assert.deepEqual([...s.map((x) => x.desc)], ['', 'For later', 'From recipes']);
  assert.deepEqual([...s.map((x) => x.d)].slice(1), ['a', 'b']);
});

// ---- bookmarkEntries: what one list holds that the tab can show ----
const me = source.match(/function bookmarkEntries\(tags, privateTags, opts\) \{[\s\S]*?\n  \}/);
if (!me) throw new Error('Could not find bookmarkEntries in sidepanel.js');
const entriesIn = new vm.Script('(function(){' + me[0] + '\nreturn bookmarkEntries;\n})()').runInNewContext({});
// Out of the other realm, so arrays compare by what they hold.
const bookmarkEntries = (...a) => JSON.parse(JSON.stringify(entriesIn(...a)));
const H = (c) => c.repeat(64);
const PK = H('b');

test('entries: notes, addresses, web addresses and hashtags are read; anything else is not', () => {
  const got = bookmarkEntries([
    ['e', H('a'), 'wss://relay.example'], ['a', '30023:' + PK + ':essay'], ['r', 'https://example.org/x'], ['t', 'Cooking'],
    ['p', PK], ['e', 'not-an-id'], ['r', 'javascript:alert(1)'], ['a', 'nonsense'], ['t', ''], ['e'], 'junk', null,
  ], []);
  assert.deepEqual(got.map((x) => [x.type, x.value, x.priv]), [
    ['e', H('a'), false], ['a', '30023:' + PK + ':essay', false], ['r', 'https://example.org/x', false], ['t', 'Cooking', false],
  ]);
  assert.equal(got[0].hint, 'wss://relay.example');
});

test('entries: the private half follows the public, and one saved in both is the public one', () => {
  const got = bookmarkEntries([['e', H('a')], ['t', 'Soup']], [['e', H('a')], ['e', H('c')], ['t', 'soup'], ['r', 'https://p.example/']]);
  assert.deepEqual(got.map((x) => [x.type, x.value, x.priv]), [
    ['e', H('a'), false], ['t', 'Soup', false], ['e', H('c'), true], ['r', 'https://p.example/', true],
  ]);
});

test('entries: nothing, or something that is not a list, is no entries', () => {
  assert.deepEqual(bookmarkEntries(null, undefined), []);
  assert.deepEqual(bookmarkEntries('x', { a: 1 }), []);
});

test('entries: hashtags are read from the main list only; in a set a t tag is a category', () => {
  const tags = [['e', H('a')], ['t', 'cooking']];
  assert.deepEqual(bookmarkEntries(tags, [['t', 'soup']]).map((x) => x.type), ['e', 't', 't']);
  assert.deepEqual(bookmarkEntries(tags, [['t', 'soup']], { hashtags: false }).map((x) => x.type), ['e']);
});

test('a mute pack, or any list that holds people or words, is not a bookmark list', () => {
  const pack = (d, extra) => ({ kind: 30001, created_at: 100, tags: [['d', d], ['name', 'Pack'], ...extra] });
  const s = bookmarkSections([
    pack('bots', [['p', H('c')], ['t', 'bot'], ['L', 'mutable'], ['l', 'community-pack', 'mutable']]),
    pack('words', [['word', 'gm'], ['e', H('d')]]),
    pack('people', [['p', H('c')], ['e', H('d')]]),
    { kind: 30003, created_at: 100, tags: [['d', 'faves'], ['e', H('a')]] },
    pack('mine', [['e', H('b')]]),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(s.map((x) => x.d))), ['faves', 'mine']);
});

test('the newest copy of a list decides whether it is a shelf, so an older bookmark version does not come back', () => {
  const s = bookmarkSections([
    { kind: 30001, created_at: 100, tags: [['d', 'x'], ['e', H('a')]] },
    { kind: 30001, created_at: 200, tags: [['d', 'x'], ['p', H('c')]] },
  ]);
  assert.equal(s.length, 0);
});
