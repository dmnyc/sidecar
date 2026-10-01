'use strict';

// Departures sets the view title on a flap. The flap must be exactly as tall as every
// other theme's title: choosing Departures in the gallery, which sits under the Settings
// title, otherwise moves the whole page under your finger.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'themes', 'departures.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('the title flap adds no height of its own', () => {
  const at = css.indexOf('[data-theme="departures"] #view-profile-edit > .content > h2 {');
  assert.ok(at > -1, 'the title rule moved');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.match(rule, /padding: 0 12px;/, 'no padding above or below the flap');
  assert.doesNotMatch(rule, /line-height/, 'the shared line box, not one of its own');
  assert.doesNotMatch(rule, /border(-top|-bottom)?:/, 'no border to add height');
});

// Turnstile frames its title in tile, which a border would add to its height. The frame is
// a border-image drawn outside the box instead, with no border width of its own.
test('Turnstile\'s title tablet adds no height of its own either', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'themes', 'turnstile.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const at = t.indexOf('[data-theme="turnstile"] #view-profile-edit > .content > h2 {');
  assert.ok(at > -1, 'the title rule moved');
  const rule = t.slice(at, t.indexOf('}', at));
  assert.match(rule, /padding: 0 12px;/);
  assert.match(rule, /border-image: url\(turnstile-green\.svg\) 8 \/ 8px \/ 8px round;/, 'the frame is outset, not a border');
  assert.doesNotMatch(rule, /line-height|border(-width|-top|-bottom)?:/);
});

