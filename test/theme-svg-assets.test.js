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

// Same constraint for Ukiyo-e's field, and more so, because every hint in Settings sits
// directly on it. It is three layers (themes/patterns.css): a sky graded from blue to
// yellow, the waves over it, and a band of Prussian blue across the top. The waves are a
// transparent tile, so the rings land on whatever the gradient is at that height, and
// the band darkens the top of the panel on top of both. So this measures the ring over
// the gradient at every point along it, not just at its stops (luminance can dip between
// two stops), and the band over the darkest of those, which is a pixel the panel may not
// actually contain but is the one that bounds all the rest.
test('the Ukiyo-e field leaves its body inks above AA', () => {
  const svg = fs.readFileSync(path.join(THEMES, 'ukiyo-e-seigaiha.svg'), 'utf8');
  const css = fs.readFileSync(path.join(THEMES, 'ukiyo-e.css'), 'utf8');
  const patterns = fs.readFileSync(path.join(THEMES, 'patterns.css'), 'utf8');
  const token = (name) => {
    const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})'));
    assert.ok(m, 'could not read --' + name + ' from ukiyo-e.css');
    return m[1];
  };
  const rule = patterns.match(/\[data-theme="ukiyo-e"\] body \{([\s\S]*?)\n\}/);
  assert.ok(rule, 'could not find the Ukiyo-e body rule in patterns.css');
  const band = rule[1].match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\) 0/);
  const sky = rule[1].match(/linear-gradient\(180deg, (#[0-9A-Fa-f]{6}) 0%[^)]*\)/);
  const ring = svg.match(/stroke="(#[0-9A-Fa-f]{6})" stroke-opacity="([\d.]+)"/);
  assert.ok(band && sky && ring, 'could not read the band, the sky and the ring ink');
  const stops = [...sky[0].matchAll(/(#[0-9A-Fa-f]{6}) \d+%/g)].map((m) => m[1]);
  assert.ok(stops.length >= 2, 'the sky gradient has fewer than two stops');
  assert.equal(stops[0].toLowerCase(), token('bg').toLowerCase(),
    'the sky starts at the theme\'s --bg, which the flat surfaces paint with');

  // The waves are painted over the sky, so the tile must not paint a ground of its own:
  // anything filled outside the masks would hide the gradient behind a flat color.
  const body = svg.replace(/<defs>[\s\S]*?<\/defs>/, '');
  assert.ok(!/fill="#/.test(body), 'the wave tile has to stay transparent outside its masks');

  let darkest = stops[0];
  for (let i = 0; i + 1 < stops.length; i++) {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const px = over(stops[i + 1], stops[i], t);
      const onRing = over(ring[1], px, parseFloat(ring[2]));
      if (lum(onRing) < lum(darkest)) darkest = onRing;
    }
  }
  const bandHex = '#' + [1, 2, 3].map((i) => Number(band[i]).toString(16).padStart(2, '0')).join('');
  darkest = over(bandHex, darkest, parseFloat(band[4]));
  for (const name of ['muted', 'faint']) {
    const r = ratio(token(name), darkest);
    assert.ok(r >= 4.5, `--${name} is ${r.toFixed(2)} against the darkest pixel the field can make (${darkest}), under AA.`);
  }
});

// Wabi-sabi is the dark-theme version of the same problem, where the field gets BRIGHTER
// than --bg instead of darker. Its seams are solid, so there is no alpha to pin: the gold
// in the gradient stops is the pixel, and every hint in Settings can land on it. The
// specks under them are translucent, but under one group opacity, so they cannot stack.
//
// The first version drew the seams at 20% gold with pools at 20% on top, and where the
// two overlapped they stacked to 36% or more: patches twice as bright as the seams,
// putting --muted at 3.3 wherever one sat. That is why the seams are solid now, and the
// last assertion keeps them that way.
test('the Wabi-sabi seams leave its body inks readable', () => {
  const svg = fs.readFileSync(path.join(THEMES, 'wabi-sabi-seams.svg'), 'utf8');
  const css = fs.readFileSync(path.join(THEMES, 'wabi-sabi.css'), 'utf8');
  const token = (name) => {
    const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})'));
    assert.ok(m, 'could not read --' + name + ' from wabi-sabi.css');
    return m[1];
  };
  const bg = token('bg');

  // Every stop, since a gradient between two stops is never brighter than the brighter one.
  const golds = [...svg.matchAll(/stop-color="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
  const speckAlpha = svg.match(/<g opacity="([\d.]+)">/);
  const specks = [...new Set([...svg.matchAll(/<circle[^>]*fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]))];
  assert.ok(golds.length >= 2 && speckAlpha && specks.length,
    'could not read the seam golds and the speck layer from the tile');

  const pixels = [
    ...golds.map((hex) => ({ hex, what: 'a seam gold' })),
    ...specks.map((hex) => ({ hex: over(hex, bg, parseFloat(speckAlpha[1])), what: 'a speck' })),
  ];
  const brightest = pixels.reduce((a, b) => (lum(b.hex) > lum(a.hex) ? b : a));

  // --muted carries the hints, so it keeps AA. --faint is the lowest-emphasis ink, and
  // holding it to AA here would leave the seams barely brighter than --bg itself: it is
  // 4.60 on flat --bg, and 4.5 is the whole of that margin. So it keeps 3:1, the
  // threshold for large text and UI components.
  for (const [name, floor] of [['muted', 4.5], ['faint', 3]]) {
    const r = ratio(token(name), brightest.hex);
    assert.ok(
      r >= floor,
      `--${name} is ${r.toFixed(2)} against ${brightest.what} (${brightest.hex}), the ` +
      `brightest pixel in the tile, under ${floor}. The tile's brightness is a measured ` +
      `ceiling: raising it spends contrast every hint in Settings is using. Flat --bg ` +
      `would give ${ratio(token(name), bg).toFixed(2)}.`
    );
  }

  const seamGroup = svg.match(/<g[^>]*url\(#gold\)[^>]*>/);
  assert.ok(seamGroup, 'could not find the seam group in the tile');
  assert.ok(!/opacity/.test(seamGroup[0]),
    'the seams have to stay solid: translucent seams stack wherever two overlap, and the ' +
    'overlaps read as patches brighter than the seams around them');
});

// Mycelium's threads run under every hint in Settings, the Werkstätte case again. The
// darkest pixel is where a thread crosses the field, so the thread's ink and alpha are
// the ceiling this pins.
test('the Mycelium threads leave its body inks above AA', () => {
  const svg = fs.readFileSync(path.join(THEMES, 'mycelium-hyphae.svg'), 'utf8');
  const css = fs.readFileSync(path.join(THEMES, 'mycelium.css'), 'utf8');
  const token = (name) => {
    const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})'));
    assert.ok(m, 'could not read --' + name + ' from mycelium.css');
    return m[1];
  };
  const bg = token('bg');
  const inks = [
    ...svg.matchAll(/stroke="(#[0-9A-Fa-f]{6})" stroke-opacity="([\d.]+)"/g),
    ...svg.matchAll(/fill="(#[0-9A-Fa-f]{6})" fill-opacity="([\d.]+)"/g),
  ].map((m) => ({ hex: m[1], alpha: parseFloat(m[2]) }));
  assert.ok(inks.length >= 2, 'could not read the thread and spore inks from the tile');
  // Threads cross, so two layers of the strongest ink is the honest worst case.
  let darkest = bg;
  for (const ink of inks) {
    const px = over(ink.hex, over(ink.hex, bg, ink.alpha), ink.alpha);
    if (lum(px) < lum(darkest)) darkest = px;
  }
  for (const name of ['muted', 'faint']) {
    const r = ratio(token(name), darkest);
    assert.ok(r >= 4.5, `--${name} is ${r.toFixed(2)} where two threads cross (${darkest}), under AA.`);
  }
});
