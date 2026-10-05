'use strict';

// The lock screen paints Sleepy Hollow's moving sky as separate fixed layers, and their
// order is the picture: the great tree's limbs pass IN FRONT of the drifting clouds, and
// the falling leaves and the candle are in front of the tree. Negative z-indexes stack low
// to high. The tree once sat at -2 under clouds at -1, commented as "above the clouds",
// and every wisp crossed its branches.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'themes', 'sleepy-hollow.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// The z-index in the first rule whose selector is exactly this one.
function zIndex(selector) {
  const at = css.indexOf(selector + ' {');
  assert.ok(at !== -1, 'no rule for ' + selector);
  const body = css.slice(at, css.indexOf('}', at));
  const m = /z-index:\s*(-?\d+)/.exec(body);
  assert.ok(m, selector + ' sets no z-index');
  return Number(m[1]);
}

test('the tree stands in front of the drifting clouds, and the leaves and candle in front of the tree', () => {
  const clouds = zIndex('[data-theme="sleepy-hollow"] #view-lock::before');
  const tree = zIndex('[data-theme="sleepy-hollow"] #view-lock::after');
  const leaves = zIndex('[data-theme="sleepy-hollow"] .lock-leaves');
  const candle = zIndex('[data-theme="sleepy-hollow"] .lock-ember');
  assert.ok(clouds < tree, `the clouds (${clouds}) paint over the tree (${tree})`);
  assert.ok(tree < leaves, `the tree (${tree}) paints over the falling leaves (${leaves})`);
  assert.ok(tree < candle, `the tree (${tree}) paints over the candle (${candle})`);
  // All stay under the lock form, which is in normal flow at z-index auto.
  for (const z of [clouds, tree, leaves, candle]) assert.ok(z < 0);
});
