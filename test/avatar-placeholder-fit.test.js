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

// The garnish is the lower-right wedge of a citrus wheel, so its paths fill 6 to 31.2 of
// the 32-unit square and their middle is at 18.6, not 16. Inset and centered as a box, the
// slice still sat toward the lower-right of every circle. The viewBox is shifted by 2.6 on
// both axes to put the slice's own middle at the middle, at the same size.
test('the garnish is drawn centered in its own square, in both cuts', () => {
  const icons = path.join(__dirname, '..', 'icons');
  const files = ['avatar-default.svg', 'avatar-default-dark.svg'].map((f) => fs.readFileSync(path.join(icons, f), 'utf8'));
  for (const svg of files) assert.match(svg, /viewBox="2\.6 2\.6 32 32"/);
  // The same drawing in both, so neither cut drifts from the other.
  const paths = (svg) => (svg.match(/ d="[^"]+"/g) || []).join('');
  assert.equal(paths(files[0]), paths(files[1]));
});
