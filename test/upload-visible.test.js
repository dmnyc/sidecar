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

test('the expanded composer keeps the Media label while it uploads, as the panel does', () => {
  // Swapping in "Uploading…" made the button 23px wider and took 8px each off GIF, Poll
  // and PoW: the whole row moved the moment an upload started. The label shimmers in
  // place instead, and the stripes say it is busy.
  const tab = read('compose.js');
  assert.doesNotMatch(tab, /textContent = t\('Uploading…'\)/, 'the label is swapped again');
  assert.equal(count(tab, /lbl\.classList\.add\('t-shimmer'\)/g), 1);
  assert.equal(count(tab, /lbl\.classList\.remove\('t-shimmer'\)/g), 1);
});
