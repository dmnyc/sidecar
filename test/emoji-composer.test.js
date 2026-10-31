'use strict';

// The Emoji button in both composers.
//
// The picker and the caret insert were exercised in a real browser; what a source test can
// still hold is the wiring that fails silently when it slips. The expanded page without the
// emoji table has no button at all and says nothing, a pick routed anywhere but the editor
// never reaches the draft, and a button left up over Preview writes into an editor that is
// hidden.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const core = read('composer-core.js');
const panel = read('sidepanel.js');
const page = read('compose.js');
const pageHtml = read('compose.html');

const strip = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('the expanded page loads the emoji table before the core that reads it', () => {
  const table = pageHtml.indexOf('<script src="emoji-data.js">');
  const coreAt = pageHtml.indexOf('<script src="composer-core.js">');
  assert.ok(table > -1, 'compose.html does not load emoji-data.js, so the button never appears');
  assert.ok(table < coreAt);
});

test('a pick goes into the editor at the caret, in both composers', () => {
  assert.match(strip(panel), /buildEmojiPicker\(\{\s*onPick: \(ch\) => mentionEditor\.insertText\(ch\)/);
  assert.match(strip(page), /SC\.buildEmojiPicker\(\{\s*onPick: \(ch\) => editorApi\.insertText\(ch\)/);
  assert.match(strip(core), /\n      insertText,\n/, 'the editor no longer exports insertText');
});

test('the button is mounted in each toolbar and stands down over Preview', () => {
  assert.match(strip(panel), /\[addBtn, gifPicker\.addBtn, emojiPicker\.addBtn, pollAdd, powBtn\]/);
  assert.match(strip(panel), /emojiPicker\.addBtn\.classList\.toggle\('hidden', p \|\| !emojiPicker\.available\)/);
  assert.match(strip(page), /emojiPicker\.addBtn, pollEditor\.addBtn/);
  assert.match(strip(page), /emojiBtn\.classList\.toggle\('hidden', which !== 'write'/);
});

test('without the table there is no button', () => {
  const at = core.indexOf('function buildEmojiPicker(d)');
  const body = strip(core.slice(at, core.indexOf('function buildGifPicker(d)')));
  assert.match(body, /const available = !!groups/);
  assert.match(body, /composeToolBtn\('smile', t\('Emoji'\)\)/);
  assert.match(body, /addBtn\.classList\.toggle\('hidden', !available\)/);
});

test('every toolbar button names an icon that exists', () => {
  // An unknown name draws nothing: icon() falls back to an empty svg, so the button is a
  // blank cell with a tooltip. That happened once, when a glyph was replaced by cutting a
  // span of ICONS that had another button's glyph in it.
  const names = [core, panel, page].flatMap((src) => [...strip(src).matchAll(/composeToolBtn\('([\w-]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...new Set(names)].sort(), ['camera', 'check-square', 'gif', 'pickaxe', 'smile']);
  for (const n of names) {
    assert.match(core, new RegExp("^\\s+(?:'" + n + "'|" + n + "): '<", 'm'), n + ' has no glyph in ICONS');
  }
});
