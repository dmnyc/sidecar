'use strict';

// A long modal's scrollbar stays inside the card's rounded corners.
//
// The card scrolls itself (overflow: auto on .modal), and Chrome paints the custom
// scrollbar down its full inside edge without clipping it to the corners, so the thumb
// poked out past the curve. The fix insets the track by the corner radius, which only
// works while the two numbers agree: this pins them together, so changing the radius
// without the inset brings the bug back and fails here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

test('THE MODAL SCROLLBAR TRACK IS INSET BY THE CARD\'S CORNER RADIUS', () => {
  const card = css.match(/\n\.modal \{[^}]*\}/);
  assert.ok(card, 'the .modal rule moved');
  const radius = card[0].match(/border-radius:\s*(\d+)px/);
  assert.ok(radius, 'the card lost its border-radius');
  assert.match(card[0], /overflow:\s*auto/, 'the card no longer scrolls itself; recheck whether the inset is needed');
  const inset = css.match(/\.modal::-webkit-scrollbar-track \{ margin: (\d+)px 0; \}/);
  assert.ok(inset, 'the scrollbar inset is gone, so the thumb runs past the rounded corners again');
  assert.equal(inset[1], radius[1], 'the inset must match the corner radius');
});
