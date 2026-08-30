'use strict';

// Two guards over the SVG a theme paints its field with, both of them written after the
// failure they describe.
//
// 1. THE FILE HAS TO PARSE. themes/werkstatte-grid.svg shipped for an hour with a `--`
//    inside its XML comment, which is illegal, and every token in that theme's prose
//    starts with one. Nothing said so: the browser drops an unparseable SVG background
//    silently, `curl` returns 200, and the CSS is perfectly valid. The panel just has no
//    field. This is the cheapest possible check and it covers every theme.
//
// 2. THE FIELD CANNOT SPEND THE TEXT'S CONTRAST. test/theme-contrast.test.js measures
//    each ink against the flat --bg TOKEN, which is the color before the pattern is
//    drawn on it. Nothing measured an ink against the pattern, and in Werkstätte that is
//    the constraint the whole theme is shaped around: prose sits directly on the body
//    background (.content, .setting and .hint carry no surface), so lattice ink comes
//    straight out of every hint's ratio. At 15% it put --muted at 3.71 and --faint at
//    3.34, both under AA, on a palette that clears AA comfortably when flat.
//
//    So the alphas in that file are a measured ceiling, not a design value, and this
//    pins them. Anyone raising them to make the grid more visible gets a failure naming
//    the ink they broke instead of a theme that looks fine to them and is unreadable at
//    a glance to someone else.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const THEMES = path.join(ROOT, 'themes');

function srgb(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function lum(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
// Straight source-over, which is what the browser does with a translucent fill on an
// opaque background. Measured against a real raster it lands within one 8-bit step.
function over(fg, bg, alpha) {
  const px = (hex) => {
    const h = hex.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
  };
  const f = px(fg), b = px(bg);
  return '#' + [0, 1, 2]
    .map((i) => Math.round(f[i] * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0'))
    .join('');
}

const svgs = fs.readdirSync(THEMES).filter((f) => f.endsWith('.svg'));

test('every theme SVG is well-formed', () => {
  assert.ok(svgs.length >= 10, 'expected the theme SVGs to be found');
  for (const name of svgs) {
    const src = fs.readFileSync(path.join(THEMES, name), 'utf8');
    // A double hyphen inside a comment is the specific way this broke, and it is the one
    // an author writing about CSS custom properties will reach for without thinking.
    for (const comment of src.match(/<!--[\s\S]*?-->/g) || []) {
      const body = comment.slice(4, -3);
      assert.ok(
        !body.includes('--'),
        `${name}: '--' inside an XML comment makes the file unparseable, and a background ` +
        `that fails to parse fails silently. Write the token name without its dashes.`
      );
    }
    // Several of these lead with a licence or design comment before the root element —
    // aegean-pattern.svg and par-avion-map.svg both do — so strip the prologue first
    // rather than demanding <svg on line one.
    const prologue = src.replace(/^\s*(<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|\s)*/, '');
    assert.ok(prologue.startsWith('<svg'), `${name}: no <svg root element`);
    assert.ok(/<\/svg>\s*$/.test(src), `${name}: no closing </svg>`);
    // A tag-balance count was tried here and removed. Node ships no XML parser, and
    // counting <tag> against </tag> and /> flagged brownstone-pattern.svg, which parses
    // perfectly — regex cannot tell a self-closing tag from a slash inside an attribute.
    // A guard that fails on a shipped, working file is worse than no guard: it gets
    // muted, and then it is not there for the real one. The '--' check above is narrow
    // on purpose, because it is the failure that actually happened and it has no false
    // positives.
  }
});

test('the Werkstatte lattice leaves its body inks above AA', () => {
  const svg = fs.readFileSync(path.join(THEMES, 'werkstatte-grid.svg'), 'utf8');
  const css = fs.readFileSync(path.join(THEMES, 'werkstatte.css'), 'utf8');

  const token = (name) => {
    const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})'));
    assert.ok(m, 'could not read --' + name + ' from werkstatte.css');
    return m[1];
  };
  const bg = token('bg');

  // Every translucent ink the tile paints, so the darkest possible pixel is whichever
  // element carries the largest alpha rather than whichever one we remembered about.
  const inks = [...svg.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g)].map((m) => ({
    hex: '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join(''),
    alpha: parseFloat(m[4]),
  }));
  assert.ok(inks.length, 'no rgba() inks found in the tile');

  let darkest = bg;
  for (const ink of inks) {
    const px = over(ink.hex, bg, ink.alpha);
    if (lum(px) < lum(darkest)) darkest = px;
  }

  // The two inks that actually land on the field. --text and --text-2 clear it by miles;
  // these two are the ones with something to lose.
  for (const name of ['muted', 'faint']) {
    const r = ratio(token(name), darkest);
    assert.ok(
      r >= 4.5,
      `--${name} is ${r.toFixed(2)} against the lattice's darkest pixel (${darkest}), ` +
      `under AA. The tile's alphas are a measured ceiling — raising them spends contrast ` +
      `that every hint in Settings is using. Flat --bg would give ` +
      `${ratio(token(name), bg).toFixed(2)}.`
    );
  }
});
