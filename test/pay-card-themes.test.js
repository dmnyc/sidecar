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

// Read off the stylesheets rather than listed here, so a hole opened in either one is
// covered the day it is added. It was a hand-written list before, which meant the guard
// was only ever as current as whoever last remembered to extend it: the in-flight
// indicator's {CARD_SUCCESS} went into PILL_CSS without this file knowing PILL_CSS
// existed, and got away with it purely because the card happened to use the same key.
function interpolatedKeys() {
  const keys = new Set();
  for (const name of ['PILL_CSS', 'CARD_CSS']) {
    const start = src.indexOf('const ' + name + ' =');
    if (start === -1) throw new Error(name + ' not found in content.js');
    const sheet = src.slice(start, src.indexOf("';", src.indexOf('}', start)));
    for (const m of sheet.matchAll(/\{(CARD_\w+)\}/g)) keys.add(m[1]);
  }
  return [...keys];
}

test('each palette carries every CARD_* key the css interpolates', () => {
  // CARD_EXTRA is the one optional hole: getThemeColors defaults it to nothing (the test
  // below pins that), so a palette without it is a theme with no shape of its own.
  const required = interpolatedKeys().filter((k) => k !== 'CARD_EXTRA');
  // A floor, so an accidentally narrowed scan reads as a pass. The two stylesheets
  // between them have never held fewer holes than this.
  assert.ok(required.length >= 18, 'only found ' + required.length + ' interpolation holes');
  for (const e of themeColorEntries()) {
    for (const k of required) {
      assert.ok(e.body.includes(k + ':'),
        `${e.key} is missing ${k}`);
    }
  }
});

test('CARD_EXTRA is appended to both templates and empty unless a theme sets it', () => {
  // The card and the pill are shared templates; a theme that is shape rather than color
  // (Ben Day's keylines and square corners) adds CSS through CARD_EXTRA. A theme that
  // does not set it must render exactly as before, and a template that forgot the
  // placeholder would silently drop the theme's shape.
  for (const name of ['PILL_CSS', 'CARD_CSS']) {
    const i = src.indexOf('const ' + name + ' =');
    const body = src.slice(i, src.indexOf("';\n", i) + 2);
    assert.match(body, /'\{CARD_EXTRA\}';$/, name + ' does not end with the {CARD_EXTRA} placeholder');
  }
  assert.match(src, /return Object\.assign\(\{ CARD_EXTRA: '' \}, themeColors\[cardTheme\] \|\| themeColors\.speakeasy\);/,
    'a theme without CARD_EXTRA would leave the placeholder in the stylesheet');
  // The extra is CSS for a shadow root: it may not reach out of it or load anything. The
  // one url() allowed is an inlined data: image, which fetches nothing.
  for (const { key, body } of themeColorEntries()) {
    if (!/CARD_EXTRA:/.test(body)) continue;
    const rest = body.replace(/url\("' \+ BEN_DAY_WASH \+ '"\)/g, '');
    assert.doesNotMatch(rest, /url\(|@import|@font-face|:host|::part/,
      key + ': CARD_EXTRA may style the card, not fetch into or reach out of the page');
  }
});

test('a lettered card reaches the page only while it is up, and never as a fetchable file', () => {
  // Ben Day letters the amount and the Pay button in Bangers. The card is in someone
  // else's page, so the face has to be registered with document.fonts, which the page
  // can see. Three things keep that from becoming a way to detect Sidecar.
  // 1. The file is not web-accessible: the bytes come from the background.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.ok(!manifest.web_accessible_resources, 'a web-accessible resource can be probed for by any site');
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  assert.match(bg, /'SIDECAR_CARD_FONT',\n\s*\]\);/, 'content scripts can no longer ask for the card font');
  // The face comes from a fixed list keyed by theme, never a path the page could name.
  const font = bg.slice(bg.indexOf("case 'SIDECAR_CARD_FONT': {"));
  assert.match(font.slice(0, 1800), /if \(!own\(CARD_FONTS, theme\) \|\| !own\(CARD_FONTS\[theme\], face\)\) throw/);
  assert.match(font.slice(0, 1800), /fetch\(chrome\.runtime\.getURL\(CARD_FONTS\[theme\]\[face\]\)\)/);
  // 2. It is registered when a card opens, not at load.
  assert.match(src, /appendChild\(cardHost\);\n\s*mountCardFont\(\);/);
  // 3. It is removed when the card goes, whatever took it down.
  const rm = src.slice(src.indexOf('function removeCard()'));
  assert.match(rm.slice(0, rm.indexOf('\n  }\n')), /unmountCardFont\(\);/);
  // And a late answer does not register it behind a card that already closed.
  assert.match(src, /if \(cardHost && shownMode === 'card' && cardTheme === theme\) add\(\);/);
});

