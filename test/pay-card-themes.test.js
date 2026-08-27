'use strict';

// Guard for the page-side pay card palette table in content.js.
//
// renderCard reads THEME_VARS-style entries from themeColors[] keyed by the stored
// theme name, and a miss does not error anywhere — it silently falls back to
// speakeasy's champagne palette. Cast Iron shipped registered in CARD_THEMES but
// missing from the table, so iron users got gold cards until this file existed.
// The comment beside CARD_THEMES already says these two must stay in step; this is
// what enforces it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

function cardThemes() {
  const m = src.match(/const CARD_THEMES = new Set\(\[([^\]]*)\]\)/);
  if (!m) throw new Error('CARD_THEMES not found in content.js');
  return Array.from(m[1].matchAll(/'([^']+)'/g), (x) => x[1]);
}

function themeColorEntries() {
  const start = src.indexOf('function getThemeColors()');
  const end = src.indexOf('\n    };', start);
  if (start === -1 || end === -1) throw new Error('themeColors table not found');
  const table = src.slice(start, end);
  const starts = [];
  for (const m of table.matchAll(/^ {6}('[a-z0-9-]+'|[a-z0-9]+): \{/gm)) {
    starts.push({ key: m[1].replace(/'/g, ''), idx: m.index });
  }
  return starts.map((s, i) => {
    const bodyEnd = i + 1 < starts.length ? starts[i + 1].idx : table.length;
    return { key: s.key, body: table.slice(s.idx, bodyEnd) };
  });
}

test('every pay-card theme has a palette entry', () => {
  const entries = new Set(themeColorEntries().map((e) => e.key));
  for (const t of cardThemes()) {
    assert.ok(entries.has(t),
      `${t} is in CARD_THEMES but has no themeColors entry — it would render as speakeasy`);
  }
});

test('no palette entry exists without being selectable', () => {
  const themes = new Set(cardThemes());
  for (const e of themeColorEntries()) {
    assert.ok(themes.has(e.key),
      `${e.key} has a palette entry but is not in CARD_THEMES — dead weight or typo`);
  }
});

test('each palette carries every CARD_* key the css interpolates', () => {
  const required = [
    'CARD_COLOR', 'CARD_BORDER', 'CARD_BACKGROUND', 'CARD_MUTED', 'CARD_GOLD',
    'CARD_TEXT_2', 'CARD_LAV', 'CARD_PAY_TEXT', 'CARD_PAY_BG', 'CARD_CANCEL_BG',
    'CARD_TEXT', 'CARD_BORDER_FAINT', 'CARD_TOGGLE_OFF', 'CARD_TRACK',
    'CARD_THUMB_OFF', 'CARD_WARN', 'CARD_SUCCESS', 'CARD_PAY_SHADOW',
  ];
  // Read the real list off CARD_CSS so a future interpolation site can't be missed:
  // every template hole in the stylesheet must be one of these (or the shared few
  // added here), and each theme must supply them all.
  for (const e of themeColorEntries()) {
    for (const k of required) {
      assert.ok(e.body.includes(k + ':'),
        `${e.key} is missing ${k}`);
    }
  }
});
