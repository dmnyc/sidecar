'use strict';

// Guard for the hand-stamped display type: cast-iron.css's struck-type chapter names
// the headings that get the embossed mask/lip treatment, and sidepanel.js's
// STAMPED_TYPE_SELECTOR is the narrower subset that additionally receives per-character
// strike dice — headlines only, by decision: navigation subheads live in tight flex rows
// where a letter-level pose fights the layout instead of adding to it.
//
// These lists were transcribed by hand on both sides, which means they can drift
// silently. This file pins them together: every stamped headline must carry the CSS
// treatment (or it poses without shade or lip), and the nav surfaces whose pose was
// deliberately removed must stay out of the JS list.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function struckTypeHeadingsFromCss() {
  const css = fs.readFileSync(path.join(ROOT, 'themes', 'cast-iron.css'), 'utf8');
  // The struck-type chapter carries three rules; the HEADING one opens at `.headline`
  // and closes at `.relax-label`. (The figures rules before it name balances, which
  // splitGlyphs handles directly — they are not part of this list.)
  const start = css.indexOf('[data-theme="cast-iron"] .headline,');
  const end = css.indexOf('}', css.indexOf('.relax-label {', start));
  assert.ok(start > -1 && end > start, 'struck-type heading rule not found in cast-iron.css');
  const sels = css.slice(start, end).split('\n')
    .filter((line) => line.trim().startsWith('[data-theme="cast-iron"]'))
    .map((line) => line.trim()
      .replace('[data-theme="cast-iron"]', '')
      .replace(/[{,]\s*$/, '')
      .trim())
    .filter(Boolean);
  return [...new Set(sels)].sort();
}

function stampedSelectorsFromJs() {
  const js = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  const m = js.match(/const STAMPED_TYPE_SELECTOR = \[([\s\S]*?)\]\.join\(','\)/);
  if (!m) throw new Error('STAMPED_TYPE_SELECTOR not found in sidepanel.js');
  return Array.from(m[1].matchAll(/'([^']+)'/g), (x) => x[1]).sort();
}

test('every stamped headline carries the cast-iron struck-type treatment', () => {
  const css = struckTypeHeadingsFromCss();
  assert.ok(css.length > 0, 'the CSS heading list should not be empty');
  for (const sel of stampedSelectorsFromJs()) {
    assert.ok(css.includes(sel),
      `${sel} gets strike dice but no emboss/mask treatment in cast-iron.css`);
  }
});

test('navigation subheads are deliberately excluded from the pose', () => {
  const js = stampedSelectorsFromJs();
  for (const nav of ['.settings-section-title', '.tabview h3', '.modal h3', '.relax-label']) {
    assert.ok(!js.includes(nav),
      `${nav} was reverted to square type on purpose — keep it out of the pose list`);
  }
});

test('STAMPED_TYPE_SELECTOR is wired into boot exactly once via initStampedType', () => {
  const js = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  assert.equal(js.match(/initStampedType\(\)/g).length, 2,
    'one definition, one call — extra calls would stack observers');
});
