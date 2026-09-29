'use strict';

// A SHADOW THAT FALLS SIDEWAYS HAS TO FALL BEHIND THE NEIGHBOR.
//
// splitGlyphs gives every character of the balance its own box, and each box is painted
// in order with its own copy of the balance's text-shadow. So a shadow offset sideways,
// like Film Noir's title-card extrusion falling down and to the left, was drawn over the
// face of the glyph beside it, and the figure read as overlapping letters rather than
// one piece of lettering standing off the screen (reported 2026-09-29).
//
// The fix is z-order: a shadow falling left needs each glyph above the one to its right
// (z-index: calc(var(--n) - var(--i))), a shadow falling right the reverse. This checks
// every theme, so a new one with an extrusion cannot ship the overlap again. A shadow
// with no sideways offset (Cast Iron's emboss, Nixie's glow) cannot reach a neighbor's
// face and needs nothing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const THEMES = path.join(__dirname, '..', 'themes');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// The largest sideways offset, in px, of any layer of a text-shadow value. A shadow
// under 2px sideways stays inside the glyph's own side bearing.
function sideways(value) {
  let most = 0;
  for (const layer of value.split(/,(?![^(]*\))/)) {
    const nums = layer.match(/-?\d*\.?\d+px/g) || [];
    if (nums.length >= 2) {
      const x = parseFloat(nums[0]);
      if (Math.abs(x) > Math.abs(most)) most = x;
    }
  }
  return most;
}

for (const file of fs.readdirSync(THEMES).filter((f) => f.endsWith('.css'))) {
  const css = strip(fs.readFileSync(path.join(THEMES, file), 'utf8'));
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1];
    const shadow = (m[2].match(/text-shadow\s*:\s*([^;]+)/) || [])[1];
    if (!shadow || !/\.wallet-balance\b(?![-\w])/.test(sel)) continue;
    const x = sideways(shadow);
    if (Math.abs(x) < 2) continue;
    test(file + ': a balance shadow falling ' + (x < 0 ? 'left' : 'right') + ' stacks the glyphs so it falls behind', () => {
      const want = x < 0 ? /z-index:\s*calc\(var\(--n\)\s*-\s*var\(--i\)\)/ : /z-index:\s*var\(--i\)/;
      const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .find((r) => /\.wallet-balance\s+\.bal-glyph/.test(r[1]) && want.test(r[2]));
      assert.ok(rule, file + ' draws each glyph\'s shadow over the glyph beside it');
      assert.match(rule[2], /position:\s*relative/, 'z-index does nothing on an unpositioned glyph');
    });
  }
}

test('the check sees Film Noir, the theme that had the overlap', () => {
  const css = strip(fs.readFileSync(path.join(THEMES, 'film-noir.css'), 'utf8'));
  const balance = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find((r) => /\.wallet-balance\s*$/.test(r[1].trim()) && /text-shadow/.test(r[2]));
  assert.ok(balance, 'Film Noir no longer shadows the balance, so this test checks nothing');
  assert.ok(sideways(balance[2].match(/text-shadow\s*:\s*([^;]+)/)[1]) < -2);
});
