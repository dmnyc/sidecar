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
// Both breaks: the panel's tile, and the wide one the full-tab composer lays down.
for (const file of ['wabi-sabi-seams.svg', 'wabi-sabi-seams-wide.svg'])
test('the Wabi-sabi seams leave its body inks readable: ' + file, () => {
  const svg = fs.readFileSync(path.join(THEMES, file), 'utf8');
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

// Mycelium's threads run under every hint in Settings, the Werkstätte case again, over a
// graded loam. The web is solid ink under ONE group opacity, so a crossing is never darker
// than a single strand: the first cut gave each layer its own alpha, and wherever a braid
// ran beside its trunk or a hair crossed a strand, the two stacked into a darker patch.
// This checks that structure holds, then measures a strand over the darkest point of the
// gradient under it, sampled between stops as well as at them.
test('the Mycelium web leaves its body inks above AA', () => {
  const svg = fs.readFileSync(path.join(THEMES, 'mycelium-hyphae.svg'), 'utf8');
  const css = fs.readFileSync(path.join(THEMES, 'mycelium.css'), 'utf8');
  const patterns = fs.readFileSync(path.join(THEMES, 'patterns.css'), 'utf8');
  const token = (name) => {
    const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})'));
    assert.ok(m, 'could not read --' + name + ' from mycelium.css');
    return m[1];
  };

  const web = svg.match(/<g id="web">([\s\S]*?)<\/g>\s*<\/defs>/);
  assert.ok(web, 'could not find the web in the tile');
  assert.ok(!/opacity=/.test(web[1]),
    'the web has to be solid inside: an alpha on any one layer stacks wherever it crosses another');
  const group = svg.match(/<g opacity="([\d.]+)">\s*<use/);
  assert.ok(group, 'the nine copies of the web have to share one group opacity');
  const inks = [...new Set([...web[1].matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]))];
  assert.ok(inks.length, 'could not read the web ink');
  const ink = inks.reduce((a, b) => (lum(b) < lum(a) ? b : a));

  const rule = patterns.match(/\[data-theme="mycelium"\] body \{([\s\S]*?)\n\}/);
  assert.ok(rule, 'could not find the Mycelium body rule in patterns.css');
  const linear = rule[1].slice(rule[1].indexOf('linear-gradient('));
  const stops = [...linear.matchAll(/(#[0-9A-Fa-f]{6}|var\(--bg\))\s+\d+%/g)]
    .map((m) => (m[1] === 'var(--bg)' ? token('bg') : m[1]));
  assert.ok(stops.length >= 2, 'could not read the loam gradient');
  let field = stops[0];
  for (let i = 0; i + 1 < stops.length; i++) {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const px = over(stops[i + 1], stops[i], t);
      if (lum(px) < lum(field)) field = px;
    }
  }
  // Any translucent wash laid over the loam, at full strength on its darkest point. The
  // light from the top right only lightens, so it never wins; a shadow would.
  for (const m of rule[1].matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g)) {
    const hex = '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
    const px = over(hex, field, parseFloat(m[4]));
    if (lum(px) < lum(field)) field = px;
  }

  const darkest = over(ink, field, parseFloat(group[1]));
  for (const name of ['muted', 'faint']) {
    const r = ratio(token(name), darkest);
    assert.ok(r >= 4.5, `--${name} is ${r.toFixed(2)} on a strand over the deepest loam (${darkest}), under AA.`);
  }
});

// Constellation cannot protect its prose the way the fields above do, by capping them.
// Its stars are the point of the plate, gold symbols up to 85% and white points of light,
// and a ceiling that kept --muted at AA over them would put every star under 17%. So the
// theme letters its prose the way a map is lettered, with a halo of the ground round every
// glyph. This checks the halo is there, covers the prose that sits on the chart, and is
// made of --bg, the color the contrast floors are measured against, in every layer.
test('Constellation haloes the prose that sits on its chart', () => {
  const css = fs.readFileSync(path.join(THEMES, 'constellation.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find((m) => /text-shadow:/.test(m[2]) && /\.hint\b/.test(m[1]));
  assert.ok(rule, 'no text-shadow rule for .hint in constellation.css: prose on the chart has no halo');
  const selectors = rule[1].split(',').map((s) => s.trim().replace(/^\[data-theme="constellation"\]\s*/, ''));
  for (const sel of ['.hint', '.tabview h2', '.tabview h3']) {
    assert.ok(selectors.includes(sel), `${sel} sits on the chart and is missing from the halo rule`);
  }
  const shadow = rule[2].match(/text-shadow:\s*([^;]+);/)[1];
  const layers = shadow.split(/,(?![^(]*\))/).map((s) => s.trim());
  assert.ok(layers.length >= 2, 'one blurred layer is too thin to hide a star behind a glyph');
  for (const layer of layers) {
    assert.ok(/var\(--bg\)/.test(layer), `halo layer "${layer}" is not made of --bg`);
  }
});

// Film Noir's field is strips of a 35mm print (scripts/gen-film-noir-film.py), and
// every hint in Settings sits straight on it. Both sheets: the panel's, and the one the
// full-tab composer covers itself with. The print is aged by darkening, so the
// only light marks are the lip under each perforation, the dust and scratches, and the
// grain; this stacks the strongest of each on the brightest film fill, which is a pixel
// the panel rarely contains but the one that bounds all the rest. It also holds the two
// structural promises the generator makes: the perforations are punched darker than the
// film, and everything in the emulsion except the grain is black.
for (const sheet of ['film-noir-strips.svg', 'film-noir-strips-wide.svg'])
test('the Film Noir film leaves its hints readable: ' + sheet, () => {
  const read = (f) => fs.readFileSync(path.join(THEMES, f), 'utf8');
  const frames = read(sheet);
  const emulsion = read('film-noir-emulsion.svg');
  const damage = read('film-noir-damage.svg');
  const css = read('film-noir.css');
  const token = (name) => {
    const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})'));
    assert.ok(m, 'could not read --' + name + ' from film-noir.css');
    return m[1];
  };

  const fills = [...frames.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
  assert.ok(fills.length >= 3, 'could not read the film, window and perforation fills');
  const film = fills.reduce((a, b) => (lum(b) > lum(a) ? b : a));
  const hole = frames.match(/<g fill="(#[0-9A-Fa-f]{6})">\s*<rect/);
  assert.ok(hole && lum(hole[1]) < lum(film),
    'the perforations have to be darker than the film: a hint over a lit one loses contrast');

  const alphas = (src) => [...src.matchAll(/(?:stroke|fill)-opacity="([\d.]+)"/g)].map((m) => parseFloat(m[1]));
  // The lip is the white edge under each perforation. The strips' other translucent
  // paint is the black shadow one casts on another, which darkens and so is not a lip;
  // anything translucent that is not white has to be black.
  const lip = Math.max(...[...frames.matchAll(/stroke="#FFFFFF" stroke-opacity="([\d.]+)"/gi)].map((m) => parseFloat(m[1])));
  for (const m of frames.matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{6})" (?:fill|stroke)-opacity/g)) {
    assert.ok(/^#(000000|ffffff)$/i.test(m[1]), `${sheet} paints a translucent ${m[1]}: only a white lip or a black shadow`);
  }
  const dust = Math.max(...alphas(damage));

  // The grain's strength is its group opacity times the most its color matrix can put in
  // the alpha channel: the sum of the row's positive weights plus its offset.
  const grainGroup = emulsion.match(/<g id="grain" opacity="([\d.]+)">/);
  const grainFilter = emulsion.match(/<filter id="grain"[\s\S]*?values="([^"]*)"/);
  assert.ok(grainGroup && grainFilter, 'could not read the grain layer from the emulsion');
  const row = grainFilter[1].trim().split(/\s+/).map(Number).slice(15, 20);
  const grainMax = Math.min(1, Math.max(0, row.slice(0, 4).reduce((s, v) => s + Math.max(0, v), 0) + row[4]));
  const grain = parseFloat(grainGroup[1]) * grainMax;

  const outside = emulsion.replace(/<defs>[\s\S]*?<\/defs>/, '').replace(/<g id="grain"[\s\S]*?<\/g>/, '');
  for (const m of outside.matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g)) {
    assert.equal(m[1].toLowerCase(), '#000000',
      `the emulsion lightens with ${m[1]}: everything that ages the print has to darken it`);
  }

  const brightest = over('#ffffff', over('#ffffff', over('#ffffff', film, lip), dust), grain);
  for (const [name, floor] of [['muted', 4.5], ['faint', 3]]) {
    const r = ratio(token(name), brightest);
    assert.ok(r >= floor,
      `--${name} is ${r.toFixed(2)} on the brightest pixel the film can make (${brightest}), ` +
      `under ${floor}. The damage and grain alphas are a measured ceiling.`);
  }
});

// The panel and the full-tab composer lay two sheets of the same film. Same inks, so
// neither can be the one that is lighter.
test('both Film Noir sheets use the same inks', () => {
  const read = (f) => fs.readFileSync(path.join(THEMES, f), 'utf8');
  const inks = (src) => [...new Set([...src.matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toLowerCase()))].sort();
  const tall = inks(read('film-noir-strips.svg'));
  assert.ok(tall.length >= 4, 'could not read the strips\' inks');
  assert.deepEqual(inks(read('film-noir-strips-wide.svg')), tall);
});

// Ben Day's dots are solid, and prose sits on them: the dot's color is the darkest pixel a
// hint can land on anywhere in the field, so every body ink is measured against it.
test('the Ben Day dots leave its body inks above AA', () => {
  const css = fs.readFileSync(path.join(THEMES, 'ben-day.css'), 'utf8');
  const token = (name) => {
    const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})'));
    assert.ok(m, 'could not read --' + name + ' from ben-day.css');
    return m[1];
  };
  for (const file of ['ben-day-dots.svg', 'ben-day-dots-yellow.svg', 'ben-day-dots-wash.svg']) {
    const svg = fs.readFileSync(path.join(THEMES, file), 'utf8');
    assert.ok(!/opacity=/.test(svg), file + ': the dots have to be solid, or this measures the wrong color');
    const fills = [...new Set([...svg.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]))];
    assert.equal(fills.length, 1, file + ': expected the dots in one ink');
    for (const name of ['text', 'text-2', 'muted', 'faint']) {
      const r = ratio(token(name), fills[0]);
      assert.ok(r >= 4.5, `${file}: --${name} measures ${r.toFixed(2)}:1 on a dot (${fills[0]}), under AA`);
    }
  }
});

// Jazz Age's panel is a velvet curtain with its lights multiplied onto it, and prose sits
// on it. Measured at the worst point there could be: the brightest fold of the curtain
// under the room's light and every beam at full strength, added together at one spot.
test('the Jazz Age curtain leaves its body inks above AA', () => {
  const light = fs.readFileSync(path.join(THEMES, 'jazz-age-stage.svg'), 'utf8');
  const curtain = fs.readFileSync(path.join(THEMES, 'jazz-age-curtain.svg'), 'utf8');
  const css = fs.readFileSync(path.join(THEMES, 'jazz-age.css'), 'utf8');
  const token = (name) => {
    const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})'));
    assert.ok(m, 'could not read --' + name + ' from jazz-age.css');
    return m[1];
  };
  const hex = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').substr(i, 2), 16));
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const folds = [...curtain.matchAll(/stop-color="(#[0-9A-Fa-f]{6})"/g)].map((m) => hex(m[1]));
  assert.ok(folds.length >= 6, 'could not read the curtain folds');
  const sheen = folds.reduce((a, b) => (lum(b) > lum(a) ? b : a));
  const ambient = light.match(/<rect width="\d+" height="\d+" fill="rgb\((\d+),(\d+),(\d+)\)"\/>/);
  assert.ok(ambient, 'the light map lost its room light');
  const peaks = [...light.matchAll(/<linearGradient id="[^"]+"[^>]*><stop offset="0" stop-color="rgb\((\d+),(\d+),(\d+)\)" stop-opacity="([\d.]+)"/g)]
    .map((m) => ({ rgb: [+m[1], +m[2], +m[3]], a: +m[4] }));
  assert.ok(peaks.length >= 3, 'expected three beams, found ' + peaks.length);
  let lit = [+ambient[1], +ambient[2], +ambient[3]];
  for (const { rgb, a } of peaks) lit = lit.map((v, i) => Math.min(255, v + rgb[i] * a));
  const shown = sheen.map((v, i) => Math.round((v * lit[i]) / 255));
  const shownHex = '#' + shown.map((v) => v.toString(16).padStart(2, '0')).join('');
  assert.match(fs.readFileSync(path.join(THEMES, 'patterns.css'), 'utf8'),
    /\[data-theme="jazz-age"\] body \{[^}]*url\(jazz-age-stage\.svg\), url\(jazz-age-curtain\.svg\)[^}]*background-blend-mode: multiply, normal;/,
    'the panel curtain is no longer lit by multiplying its light map');
  for (const name of ['text', 'text-2', 'muted', 'faint', 'gold']) {
    const r = ratio(token(name), shownHex);
    assert.ok(r >= 4.5, `--${name} measures ${r.toFixed(2)}:1 on the brightest lit fold (${shownHex}), under AA`);
  }
});

// The Jazz Age lock screen's lights are far brighter than the panel's, which is only
// sound because nothing low on that screen is lettered on the open floor: each line over
// the pool has a surface of its own. If one of these loses its background, the lights take its contrast.
test('every line over the Jazz Age lock screen pool sits on a surface of its own', () => {
  const css = fs.readFileSync(path.join(THEMES, 'jazz-age.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /#view-lock \{\s*background:\s*url\(jazz-age-lamps\.svg\)[^;]*url\(jazz-age-lock\.svg\)[^;]*url\(jazz-age-curtain\.svg\)[^;]*;\s*background-blend-mode: normal, multiply, normal;/, 'the lock stage moved');
  const surfaced = css.slice(css.indexOf('[data-theme="jazz-age"] #view-lock .unlock-forgot,'));
  const rule = surfaced.slice(0, surfaced.indexOf('}'));
  for (const sel of ['#view-lock .unlock-forgot', '.pre-version-row .version-chip']) {
    assert.ok(rule.includes(sel), sel + ' has no surface under the lock screen lights');
  }
  assert.match(rule, /background: #[0-9A-Fa-f]{6};/, 'the lock screen text surfaces are not opaque');
  assert.match(css, /#view-lock \.stack \{[^}]*background: rgba\(22, 16, 14, 0\.9\d\)/, 'the PIN form lost its card');
});
