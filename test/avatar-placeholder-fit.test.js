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
