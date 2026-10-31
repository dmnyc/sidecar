'use strict';

// An upload in progress runs angled stripes across the whole Media button. The label's shimmer alone could not
// be seen on a light theme, where both of its inks are dark, and the disabled button's
// dimming took most of what was left.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const count = (s, re) => (s.match(re) || []).length;

test('both composers mark the button while it uploads, and clear it after', () => {
  const panel = read('sidepanel.js');
  assert.equal(count(panel, /addBtn\.classList\.add\('is-uploading'\)/g), 2, 'the panel has two upload paths');
  assert.equal(count(panel, /addBtn\.classList\.remove\('is-uploading'\)/g), 2);
  const tab = read('compose.js');
  assert.equal(count(tab, /addBtn\.classList\.add\('is-uploading'\)/g), 1);
  assert.equal(count(tab, /addBtn\.classList\.remove\('is-uploading'\)/g), 1);
});

test('the uploading button keeps its strength and runs stripes, held still under reduced motion', () => {
  const css = read('styles.css');
  assert.match(css, /\.compose-add\.is-uploading:disabled \{ opacity: 1; \}/);
  assert.match(css, /\.compose-add\.is-uploading::after \{[^}]*repeating-linear-gradient\(-45deg[^}]*animation: upload-stripes/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.compose-add\.is-uploading::after \{ animation: none;/);
  assert.match(css, /html\.reduce-balance-motion \.compose-add\.is-uploading::after \{ animation: none;/);
});

test('the Media button is an icon, so an upload cannot reach for a label that is not there', () => {
  // It used to find its label with querySelector('span') and shimmer it. The button has no
  // label now; a leftover lookup would be null and throw on the first upload, in both.
  for (const f of ['compose.js', 'sidepanel.js']) {
    const src = read(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(src, /addBtn\.querySelector\('span'\)/, f + ' still looks for the Media label');
    assert.doesNotMatch(src, /setWaiting\(lbl,/, f + ' still shimmers the Media label');
    assert.doesNotMatch(src, /lbl\.classList\.(add|remove)\('t-shimmer'\)/, f + ' still shimmers the Media label');
  }
});
