'use strict';

// The expanded composer's Preview tab stays current while you change the attachments.
//
// The thumbnail strip stays on screen over Preview, so a person can remove, add or upload an
// attachment while looking at it. The preview was drawn once, when the tab opened, so a
// removed image stayed in it until the person went back to the editor and out again. It is
// drawn from one function now, and renderThumbs, which every attachment change goes through,
// calls it.
//
// This guards the wiring. The behavior was run in a browser against the real page: two
// uploads, Preview, remove one: the preview showed two images before the change and one
// after, where on the previous code it still showed two.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'compose.js'), 'utf8');
const bare = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('every attachment change repaints the preview, through renderThumbs', () => {
  const fn = bare.slice(bare.indexOf('function renderThumbs()'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /paintPreview\(\);/, 'renderThumbs no longer repaints the preview');
});

test('the preview is drawn by one function, which does nothing while another tab shows', () => {
  assert.match(bare, /let paintPreview = \(\) => \{\};/, 'a no-op until the tabs exist, so an early renderThumbs is safe');
  const at = bare.indexOf('\n    paintPreview = () => {');
  assert.ok(at > -1, 'paintPreview is assigned in buildTabs');
  const body = bare.slice(at, bare.indexOf('\n    };', at));
  assert.match(body, /if \(pane\.classList\.contains\('hidden'\)\) return;/, 'hidden preview: no work');
  assert.match(body, /SC\.composeNoteContent\(draft\.text, draft\.media\)/, 'drawn from the draft, as it will publish');
  // Opening the tab goes through the same function, so the two can never disagree.
  const show = bare.slice(bare.indexOf('showTab = (which) => {'), at);
  assert.match(show, /paintPreview\(\);/);
  assert.doesNotMatch(show, /composeNoteContent/, 'showTab must not carry a second copy of the drawing');
});
