'use strict';

// Constellation shows the season's sky: four atlas plates, one per season's evening sky,
// and sky-plate.js marks each page with the season's plate as it loads. Three things
// can quietly break that, and each fails silently, as a panel that shows the wrong sky
// or no sky at all rather than an error:
//   - a month that maps to no plate, or to a plate with no file behind it;
//   - a plate with no rule in patterns.css, so its mark picks nothing;
//   - a page that applies the user's theme without loading sky-plate.js, which would
//     show winter's Orion while the panel beside it showed the season.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Run sky-plate.js as a page would, on a given date, and return the mark it sets.
function plateFor(year, monthIndex) {
  const dataset = {};
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [year, monthIndex, 15, 21, 0])); }
  }
  vm.runInNewContext(read('sky-plate.js'), {
    Date: FixedDate,
    document: { documentElement: { dataset } },
  });
  return dataset.sky;
}

test('every month shows its season’s plate', () => {
  const want = {
    orion: [11, 0, 1],
    leo: [2, 3, 4],
    cygnus: [5, 6, 7],
    andromeda: [8, 9, 10],
  };
  for (const [plate, months] of Object.entries(want)) {
    for (const m of months) assert.equal(plateFor(2026, m), plate, `month ${m + 1}`);
  }
});

test('every plate has its drawing and its rule', () => {
  const css = read('themes/patterns.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\[data-theme="constellation"\]\s*\{\s*--sky-plate:\s*url\(constellation-sky-orion\.svg\);\s*\}/,
    'no default plate: a page without the mark would show no sky');
  assert.match(css, /\[data-theme="constellation"\] body \{[^}]*background-image:\s*var\(--sky-plate\)/,
    'the field does not read --sky-plate');
  const plates = new Set(Array.from({ length: 12 }, (_, m) => plateFor(2026, m)));
  assert.equal(plates.size, 4, 'four seasons, four plates');
  for (const plate of plates) {
    assert.ok(fs.existsSync(path.join(ROOT, 'themes', `constellation-sky-${plate}.svg`)), `no drawing for ${plate}`);
    if (plate === 'orion') continue;
    const rule = new RegExp(`\\[data-theme="constellation"\\]\\[data-sky="${plate}"\\]\\s*\\{\\s*--sky-plate:\\s*url\\(constellation-sky-${plate}\\.svg\\);`);
    assert.match(css, rule, `no rule picks the ${plate} plate`);
  }
});

test('every page that applies the theme marks its sky, before the first paint', () => {
  // A page applies the user's theme if one of its scripts sets data-theme. Found rather
  // than listed, so a new themed page is covered the day it is added.
  const setsTheme = (js) => /setAttribute\(\s*'data-theme'/.test(read(js));
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  let themed = 0;
  for (const page of pages) {
    const html = read(page);
    if (!/themes\/patterns\.css/.test(html)) continue;
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    if (!scripts.some((s) => fs.existsSync(path.join(ROOT, s)) && setsTheme(s))) continue;
    themed += 1;
    const head = html.slice(0, html.indexOf('</head>'));
    assert.match(head, /<script src="sky-plate\.js"><\/script>/,
      `${page} applies the theme but does not load sky-plate.js in its head`);
  }
  assert.ok(themed >= 4, `expected the panel, prompt, composer and tile pages, found ${themed}`);
});
