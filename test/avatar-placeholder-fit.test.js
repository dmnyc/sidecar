'use strict';

// The default avatar is the garnish, an orange slice drawn across most of its square, so
// it has to sit inset inside the circle or the circle clips it. `.avatar-ph img` insets
// it, but any avatar whose own `img` rule sets 100% LATER in the stylesheet beats that
// rule at equal specificity and draws the slice full size, clipped: an embedded note's
// author, the profile card from search, search rows, bookmarks, site rows, poll voters.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('every avatar that sets its image full size after the placeholder rule insets the placeholder too', () => {
  const generic = css.search(/^\.avatar-ph img \{/m);
  assert.ok(generic !== -1, 'the generic placeholder rule moved');
  const missing = [];
  for (const m of css.matchAll(/^\.([a-z0-9-]+) img \{[^}]*width: 100%/gm)) {
    const cls = m[1];
    if (!/(?:^|-)(?:av|avatar|face)(?:-|$)/.test(cls)) continue;
    if (m.index < generic) continue; // the generic rule comes later and wins
    if (!new RegExp('\\.' + cls + '\\.avatar-ph img').test(css)) missing.push(cls);
  }
  assert.deepEqual(missing, [], 'these draw the garnish full size, clipped by the circle');
});

// The garnish is the lower-right half of a citrus wheel, cut along the diagonal. Its rind is
// an arc of a circle centered at 16.59,16.59 with a radius of 14.6, and the design frame is the
// drawing's own 32-unit square, so that wheel sits in the middle of the avatar and the slice
// reads as part of it. Centering the wedge's own box (a viewBox at 2.6) pushed the cut edge to
// the middle and made the slice look off center in its circle.
test('the garnish’s wheel is centered in its square, in both cuts', () => {
  const icons = path.join(__dirname, '..', 'icons');
  const files = ['avatar-default.svg', 'avatar-default-dark.svg'].map((f) => fs.readFileSync(path.join(icons, f), 'utf8'));
  for (const svg of files) assert.match(svg, /viewBox="0 0 32 32"/);
  // The same drawing in both, so neither cut drifts from the other.
  const paths = (svg) => (svg.match(/ d="[^"]+"/g) || []).join('');
  assert.equal(paths(files[0]), paths(files[1]));
});

test('the viewBox center is the rind’s circle, measured from the drawing itself', () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'icons', 'avatar-default.svg'), 'utf8');
  const [vx, vy, vw, vh] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  // The rind is the last path. Its outer arc runs through three points on the circle: where it
  // meets the cut at each end, and the corner of the wheel between them.
  const rind = svg.match(/ d="([^"]+)"/g).pop();
  const nums = rind.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const pt = (x, y) => ({ x, y });
  const a = pt(26.9183, 6.26325), b = pt(6.26325, 26.9183), c = pt(26.9183, 26.9183);
  for (const p of [a, b, c]) {
    let found = false;
    for (let i = 0; i + 1 < nums.length; i++) if (Math.abs(nums[i] - p.x) < 1e-3 && Math.abs(nums[i + 1] - p.y) < 1e-3) found = true;
    assert.ok(found, 'the rind no longer passes through ' + p.x + ',' + p.y);
  }
  // The circle through three points.
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const sq = (p) => p.x * p.x + p.y * p.y;
  const cx = (sq(a) * (b.y - c.y) + sq(b) * (c.y - a.y) + sq(c) * (a.y - b.y)) / d;
  const cy = (sq(a) * (c.x - b.x) + sq(b) * (a.x - c.x) + sq(c) * (b.x - a.x)) / d;
  const r = Math.hypot(a.x - cx, a.y - cy);
  // Within a unit: the design frame is whole units, and the wheel is 0.59 off its middle.
  assert.ok(Math.abs(vx + vw / 2 - cx) < 1 && Math.abs(vy + vh / 2 - cy) < 1, `viewBox center ${vx + vw / 2},${vy + vh / 2} is not the circle's ${cx.toFixed(2)},${cy.toFixed(2)}`);
  assert.ok(r < vw / 2 && r < vh / 2, 'the whole wheel fits inside the square');
});
