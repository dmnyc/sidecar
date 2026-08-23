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
