'use strict';

// data-theme sits on <html> itself (sidepanel.js and compose.js set it on
// document.documentElement), so a selector that qualifies html and then names
// [data-theme] after a space looks for a second, nested element that never exists.
// The rule matches nothing and fails silently: Sleepy Hollow's plate variables went
// undefined that way and every internal view lost its background. Both conditions
// belong on the one compound: html:not(.x)[data-theme="…"], never html:not(.x) [data-theme="…"].

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const sheets = ['styles.css', ...fs.readdirSync(path.join(ROOT, 'themes'))
  .filter((f) => f.endsWith('.css'))
  .map((f) => path.join('themes', f))];

test('no selector puts [data-theme] in a descendant of a qualified html', () => {
  const bad = [];
  for (const f of sheets) {
    const css = stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    for (const m of css.matchAll(/\bhtml(?:[.:[][^\s,{]*)?\s+\[data-theme\b[^,{]*/g)) {
      bad.push(`${f}: ${m[0].trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});
