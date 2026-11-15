'use strict';

// Phantom Bouquet wears its own cut of the logo, drawn in its dyes: the glass in madder,
// the wordmark in the balance's plum. Three documents pick a logo per theme with no module
// system between them (the panel and composer pages through composer-core.js, the pay card
// in content.js, the approval window in prompt.js), so each is checked here by running it,
// not by reading it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const DYES = { glassTop: '#FBF8F0', glassRim: '#E4DCCA', glass: '#8F3A31', glassLit: '#A3443A', word: '#6B3B5A' };

const fills = (svg) => [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1].toUpperCase()).filter((f) => f !== 'NONE');
const shapes = (svg) => [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);

function loadCore() {
  const I18N = { t: (s) => s, tn: (a, b, n) => (n === 1 ? a : b), fmtNum: String, fmtDate: String, fmtRelative: String, fill: (s) => s };
  const win = { SidecarI18n: I18N };
  const ctx = { window: win, document: { documentElement: { getAttribute: () => null } }, console };
  vm.runInNewContext(read('composer-core.js'), ctx);
  return win.SidecarCore;
}

// content.js is one large content script; lift out the inline logo and its picker and run them.
function loadPayCardLogo() {
  const src = read('content.js');
  const start = src.indexOf('  const LOGO_SVG =');
  const end = src.indexOf('\n  // The quiet state.', start);
  assert.ok(start > 0 && end > start, 'could not find LOGO_SVG and logoSvgFor in content.js');
  return new Function(src.slice(start, end) + '\nreturn { LOGO_SVG, logoSvgFor };')();
}

test('the Phantom Bouquet logo file is the stock logo with only its colors changed', () => {
  const stock = read('icons/sidecar-logo.svg');
  const pb = read('icons/sidecar-logo-phantom-bouquet.svg');
  assert.deepEqual(shapes(pb), shapes(stock), 'every shape must match the official logo');
  assert.deepEqual(fills(pb), [DYES.glassTop, DYES.glassRim, DYES.glassLit, DYES.glass, ...Array(7).fill(DYES.word)]);
});

test('the panel, the composer and the highlight page pick the dyed cut for Phantom Bouquet', () => {
  const core = loadCore();
  assert.equal(core.logoSrcFor('phantom-bouquet'), 'icons/sidecar-logo-phantom-bouquet.svg');
  // Nothing else moves: other light themes keep the dark wordmark, dark themes the stock logo.
  assert.equal(core.logoSrcFor('industria'), 'icons/sidecar-logo-deco.svg');
  assert.equal(core.logoSrcFor('mycelium'), 'icons/sidecar-logo-deco.svg');
  assert.equal(core.logoSrcFor('speakeasy'), 'icons/sidecar-logo.svg');
  assert.equal(core.logoSrcFor(undefined), 'icons/sidecar-logo.svg');
});

test('the pay card draws the same dyed cut for Phantom Bouquet, and leaves other themes alone', () => {
  const { LOGO_SVG, logoSvgFor } = loadPayCardLogo();
  const pb = logoSvgFor('phantom-bouquet');
  assert.deepEqual(fills(pb), fills(read('icons/sidecar-logo-phantom-bouquet.svg')), 'the pay card and the panel must show the same logo');
  assert.deepEqual(shapes(pb), shapes(LOGO_SVG));
  assert.ok(!/#BDA1FF|#5a4a8a|#EA772F|#FFA01B/i.test(pb), 'no stock color may survive on the dyed cut');
  assert.deepEqual(new Set(fills(logoSvgFor('industria'))), new Set(['#FFF', '#D0D1D3', '#EA772F', '#FFA01B', '#5A4A8A']));
  assert.equal(logoSvgFor('speakeasy'), LOGO_SVG);
});

test('the approval window picks the dyed cut for Phantom Bouquet and the dark wordmark for other light themes', () => {
  const src = read('prompt.js');
  const line = src.split('\n').find((l) => l.includes("mark.src ="));
  assert.ok(line, 'could not find the approval window logo swap');
  const pick = new Function('theme', 'const mark = {}; ' + line.trim().replace(/^if \(mark\) /, '') + ' return mark.src;');
  assert.equal(pick('phantom-bouquet'), 'icons/sidecar-logo-phantom-bouquet.svg');
  assert.equal(pick('industria'), 'icons/sidecar-logo-deco.svg');
});
