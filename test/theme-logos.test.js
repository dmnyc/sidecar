'use strict';

// A THEME'S OWN CUT OF THE LOGO, in every place that draws one.
//
// Phantom Bouquet, Film Noir, Brownstone, Cast Iron, Par Avion and Industria wear the logo in
// their own inks. Three documents pick a logo per theme with no module system between them (the
// panel and composer pages through composer-core.js, the pay card in content.js, the approval
// window in prompt.js), and each keeps its own table. So the invariants are checked by running
// each one: they agree for every theme in the repo, each cut's file is the stock logo with only
// its colors changed, and the colors stay legible on the theme they were drawn for.
// (phantom-bouquet-logo.test.js pins that theme's exact dyes.)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const STOCK = 'icons/sidecar-logo.svg';
const DECO = 'icons/sidecar-logo-deco.svg';
const fills = (svg) => [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1].toUpperCase()).filter((f) => f !== 'NONE');
const shapes = (svg) => [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
const themes = fs.readdirSync(path.join(ROOT, 'themes')).filter((f) => f.endsWith('.css')).map((f) => f.replace(/\.css$/, ''));

function loadCore() {
  const I18N = { t: (s) => s, tn: (a, b, n) => (n === 1 ? a : b), fmtNum: String, fmtDate: String, fmtRelative: String, fill: (s) => s };
  const win = { SidecarI18n: I18N };
  vm.runInNewContext(read('composer-core.js'), { window: win, document: { documentElement: { getAttribute: () => null } }, console });
  return win.SidecarCore;
}
function loadPayCardLogo() {
  const src = read('content.js');
  const start = src.indexOf('  const LOGO_SVG =');
  const end = src.indexOf('\n  // The quiet state.', start);
  assert.ok(start > 0 && end > start, 'could not find LOGO_SVG and logoSvgFor in content.js');
  return new Function(src.slice(start, end) + '\nreturn { LOGO_SVG, logoSvgFor, LIGHT_CARD_THEMES };')();
}
function approvalWindowPick(lightList) {
  const src = read('prompt.js');
  const start = src.indexOf('    const THEME_LOGOS = {');
  const endMarker = "else if (mark && isLight) mark.src = 'icons/sidecar-logo-deco.svg';";
  const end = src.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start, 'could not find the approval window logo swap');
  const body = src.slice(start, end + endMarker.length).replace("document.querySelector('.brand img')", 'MARK');
  return (theme) => {
    const mark = { src: STOCK };
    new Function('MARK', 'theme', 'isLight', body)(mark, theme, lightList.includes(theme));
    return mark.src;
  };
}

const core = loadCore();
const pay = loadPayCardLogo();
const lights = themes.filter((t) => pay.LIGHT_CARD_THEMES.has(t));
const pick = approvalWindowPick(lights);
// The themes with a cut of their own are the ones the panel sends somewhere other than the stock
// logo or the shared dark wordmark.
const cut = themes.filter((t) => ![STOCK, DECO].includes(core.logoSrcFor(t)));

test('exactly the intended themes wear a cut of their own', () => {
  assert.deepEqual(cut.sort(), ['brownstone', 'cast-iron', 'film-noir', 'industria', 'par-avion', 'phantom-bouquet', 'werkstatte']);
});

test('the three tables agree for every theme in the repo', () => {
  // What the pay card draws for a theme with no cut of its own: the stock logo, or the dark wordmark.
  const generic = new Set([pay.LOGO_SVG, pay.LOGO_SVG.replace(/#BDA1FF/g, '#5a4a8a')]);
  for (const t of themes) {
    assert.equal(pick(t), core.logoSrcFor(t), t + ': the approval window and the panel pick different logos');
    const payHasCut = !generic.has(pay.logoSvgFor(t));
    assert.equal(payHasCut, cut.includes(t), t + ': the pay card and the panel disagree about whether this theme has a cut');
  }
  for (const t of cut) {
    const file = read(core.logoSrcFor(t));
    assert.deepEqual(fills(pay.logoSvgFor(t)), fills(file), t + ': the pay card and the panel must show the same logo');
  }
});

test('a themed cut beats the light-theme wordmark, and everything else is unchanged', () => {
  for (const t of ['par-avion', 'industria']) {
    assert.ok(lights.includes(t), t + ' is a light theme');
    assert.notEqual(core.logoSrcFor(t), DECO, t + ' still shows the shared dark wordmark');
  }
  assert.equal(core.logoSrcFor('mycelium'), DECO);
  assert.equal(core.logoSrcFor('speakeasy'), STOCK);
  assert.equal(core.logoSrcFor('departures'), STOCK);
  assert.equal(pick('departures'), STOCK);
});

test('every cut is the stock logo with only its colors changed, and no stock color survives', () => {
  const stock = read(STOCK);
  for (const t of cut) {
    const file = read(core.logoSrcFor(t));
    assert.deepEqual(shapes(file), shapes(stock), t + ': every shape must match the official logo');
    assert.equal(fills(file).length, fills(stock).length);
    if (t !== 'phantom-bouquet') assert.ok(!/#BDA1FF|#D0D1D3|#EA772F|#FFA01B/i.test(file), t + ': a stock color survived');
  }
});

// The colors of a cut against the theme's own background. Wordmark: 4.5 to 1, readable text.
// Glass: 3 to 1, a graphic. The garnish is checked only on dark themes: on the light ones it is
// white on a cream or plaster ground, as it already is in the shared dark-wordmark logo.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const themeBg = (t) => {
  const css = read('themes/' + t + '.css');
  const at = css.indexOf('[data-theme="' + t + '"] {');
  const m = css.slice(at).match(/--bg:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(m, t + ': no --bg found');
  return m[1];
};

test('each cut stays legible on the theme it was drawn for', () => {
  for (const t of cut.filter((x) => x !== 'phantom-bouquet' && x !== 'cast-iron')) {
    const bg = themeBg(t);
    const f = fills(read(core.logoSrcFor(t))); // garnish, garnish shade, glass lit, glass shade, wordmark x7
    const [garnish, garnishShade, glassLit, glassShade, word] = [f[0], f[1], f[2], f[3], f[4]];
    assert.ok(ratio(word, bg) >= 4.5, t + ' wordmark ' + word + ' on ' + bg + ' is ' + ratio(word, bg).toFixed(1) + ':1');
    assert.ok(ratio(glassLit, bg) >= 3, t + ' glass ' + glassLit + ' on ' + bg);
    assert.ok(ratio(glassShade, bg) >= 3, t + ' glass shade ' + glassShade + ' on ' + bg);
    if (!lights.includes(t)) {
      assert.ok(ratio(garnish, bg) >= 3, t + ' garnish ' + garnish + ' on ' + bg);
      assert.ok(ratio(garnishShade, bg) >= 3, t + ' garnish shade ' + garnishShade + ' on ' + bg);
    }
  }
});

// Cast Iron's logo is cast into the panel's metal, not printed on it: its inks sit just above the
// background on purpose, flat. So it is held to
// a floor of its own, which keeps every part a visible step up from the iron without letting it
// drift back toward a printed, readable-text contrast.
test('cast iron: every part of the logo sits just above the iron, none sinks into it or stands off it', () => {
  const bg = themeBg('cast-iron');
  for (const ink of new Set(fills(read(core.logoSrcFor('cast-iron'))))) {
    const r = ratio(ink, bg);
    assert.ok(r >= 1.3 && r <= 2.5, 'cast-iron ' + ink + ' on ' + bg + ' is ' + r.toFixed(2) + ':1');
  }
});
