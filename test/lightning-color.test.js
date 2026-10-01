'use strict';

// The zap strike's bolt is one lemon yellow in every theme, on the panel and on a web page,
// so a zap looks like the same event everywhere. It used to take each theme's --gold, which
// on the light themes is a dark accent ink and drew the bolt brown, blue, green or black.
// Film Noir, which has no color at all, strikes in white. Every yellow bolt has a thin white
// core down its middle, drawn on top of it rather than as an edge beneath.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const js = strip(fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8'));
const css = strip(fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8'));
const page = strip(fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8'));

test('the panel strikes in lemon yellow in every theme, white in Film Noir', () => {
  const strike = js.slice(js.indexOf('function lightningStrike()'));
  const body = strike.slice(0, strike.indexOf('\n  }\n'));
  assert.match(body, /path\.setAttribute\('stroke', mono \? '#FFFFFF' : \(Math\.random\(\) > 0\.5 \? '#FFD600' : '#FFE234'\)\);/);
  assert.doesNotMatch(body, /var\(--gold\)|var\(--amber\)/, 'a theme token would draw the bolt in that theme\'s ink');
  assert.match(css, /\.lightning-svg \{[^}]*drop-shadow\(0 0 4px rgba\(255, 214, 0, 0\.7\)\)/);
  // The white core is drawn on top of the yellow, not beneath it as an edge.
  assert.match(body, /svg\.appendChild\(path\);\s*if \(!mono\) \{\s*const core = path\.cloneNode\(\);\s*core\.setAttribute\('stroke', '#FFFFFF'\);/);
});

test('the page strikes in the same yellow', () => {
  assert.match(page, /const stroke = monoBolt \? '#ffffff' : Math\.random\(\) > 0\.5 \? '#FFD600' : '#FFE234';/);
  assert.match(page, /'rgba\(255,214,0,\.85\)'/);
  assert.match(page, /svg\.append\(p\);\s*if \(!monoBolt\) \{\s*const core = p\.cloneNode\(\);\s*core\.setAttribute\('stroke', '#ffffff'\);/);
  assert.doesNotMatch(page, /stroke', '#fff8e7'/, 'no wide white edge under the bolt');
});
