'use strict';

// THE COMPOSE BUTTON READS ALIKE IN EVERY THEME.
//
// The feather is the compose button's only label, and each theme paints the disc and the
// feather its own way: a flat ink, a gradient, a theme rule that overrides the shared one.
// Cast Iron's feather once went so dark it nearly vanished, and nothing caught it, because
// no test looked at the button across themes. This one loads the panel's real stylesheets,
// in the order sidepanel.html links them, into a headless Chrome, puts the real button
// markup under each theme in turn, and reads what the browser computed: the feather's
// stroke and the disc's background, gradient stops included. Then it holds every theme to
// the same band, so one theme cannot quietly drift far below the rest.
//
// The disc of a gradient is scored at its worst stop for the floor (the feather has to
// read wherever it sits) and at the mean of its stops for the spread.
//
// Needs a Chrome or Chromium binary (CHROME_PATH, or one of the usual places); without one
// it skips, like the other browser tests. FAB_CONTRAST_ROOT points it at another checkout.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.FAB_CONTRAST_ROOT || path.join(__dirname, '..');

// Every feather at least this far from its disc, everywhere on the disc. WCAG asks 3:1 of a
// graphic that carries meaning (1.4.11); the feather is the button's only label, so it is
// held to the 4.5:1 asked of text.
const FLOOR = 4.5;
// And no theme's feather more than this many times weaker than the median theme's, which
// is what keeps the themes alike rather than merely legal: with the median near 8.6:1, a
// theme has to stay above roughly 3.5:1.
const MAX_BELOW_MEDIAN = 2.5;

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}
const CHROME = findChrome();

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const panel = read('sidepanel.html');
// The stylesheets the panel loads, in its own order, so a theme added there is measured here.
const sheets = [...panel.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
// The button exactly as the panel draws it.
const fabMarkup = (/<button id="compose-fab"[\s\S]*?<\/button>/.exec(panel) || [''])[0];
const themes = fs.readdirSync(path.join(ROOT, 'themes'))
  .filter((f) => f.endsWith('.css') && f !== 'patterns.css').map((f) => f.replace(/\.css$/, '')).sort();

const PAGE = () => `<!doctype html><html data-theme="speakeasy"><head><meta charset="utf-8">
${sheets.map((s) => `<link rel="stylesheet" href="file://${path.join(ROOT, s)}">`).join('\n')}
<style>/* .fab transitions its box-shadow, and a theme may transition more: read straight after a
theme switch, a transitioned property still reports the PREVIOUS theme's value. */
*, *::before, *::after { transition: none !important; animation: none !important; }</style>
</head><body style="width:360px;height:640px;position:relative">
${fabMarkup}
<script>
const THEMES = ${JSON.stringify(themes)};
const fab = document.getElementById('compose-fab');
const out = {};
for (const t of THEMES) {
  document.documentElement.dataset.theme = t;
  const cs = getComputedStyle(fab);
  const strokes = [...fab.querySelectorAll('path, line, polyline, polygon, circle')].map((n) => getComputedStyle(n).stroke);
  out[t] = { stroke: strokes, image: cs.backgroundImage, color: cs.backgroundColor, opacity: cs.opacity };
}
const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify(out);
document.body.append(pre);
</script></body></html>`;

function measureAll() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-fab-'));
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, PAGE());
  try {
    const r = spawnSync(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
      `--user-data-dir=${path.join(dir, 'profile')}`,
      '--virtual-time-budget=3000', '--window-size=520,900', '--dump-dom', `file://${file}`,
    ], { encoding: 'utf8', timeout: 60000 });
    const m = /<pre id="result">([^<]*)<\/pre>/.exec(r.stdout || '');
    assert.ok(m, 'Chrome did not report: ' + (r.stderr || '').slice(0, 300));
    return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// rgb()/rgba() as the browser serializes them; url(...) layers (patterns) carry no color.
const rgbs = (s) => [...String(s).matchAll(/rgba?\(([^)]+)\)/g)].map((m) => {
  const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { r, g, b, a };
});
const lum = ({ r, g, b }) => {
  const [R, G, B] = [r, g, b].map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
};
const ratioL = (a, b) => { const [hi, lo] = [a, b].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

function score(m) {
  // The feather: every stroke must resolve to a color. A url(#gradient) paint server
  // cannot be scored here, and is exactly what hid Cast Iron's feather's real ink.
  const inks = m.stroke.map((s) => rgbs(s)[0]);
  assert.ok(inks.every(Boolean), 'the feather is not a plain color: ' + m.stroke.join(' | '));
  const ink = lum(inks[0]);
  // The disc: the gradient's stops if it has any, else the flat color.
  let stops = rgbs(m.image).filter((c) => c.a > 0);
  if (!stops.length) stops = rgbs(m.color);
  assert.ok(stops.length, 'no disc color found');
  const ratios = stops.map((c) => ratioL(ink, lum(c)));
  const mean = ratioL(ink, stops.reduce((s, c) => s + lum(c), 0) / stops.length);
  return { worst: Math.min(...ratios), mean };
}

test('the compose feather reads on its disc in every theme, and no theme drifts far below the rest',
  { skip: CHROME ? false : 'no Chrome found', timeout: 90000 }, () => {
    assert.ok(fabMarkup, 'could not find the compose button in sidepanel.html');
    const measured = measureAll();
    const scores = {};
    for (const t of themes) scores[t] = score(measured[t]);
    const table = themes.map((t) => `${t.padEnd(16)} worst ${scores[t].worst.toFixed(2)}  mean ${scores[t].mean.toFixed(2)}`).join('\n');
    if (process.env.FAB_CONTRAST_REPORT) console.log(table);

    const means = themes.map((t) => scores[t].mean).sort((a, b) => a - b);
    const median = means[Math.floor(means.length / 2)];
    for (const t of themes) {
      assert.ok(scores[t].worst >= FLOOR,
        `${t}: the feather is ${scores[t].worst.toFixed(2)}:1 at the weakest point of its disc (floor ${FLOOR}:1)\n${table}`);
      assert.ok(scores[t].mean * MAX_BELOW_MEDIAN >= median,
        `${t}: the feather is ${scores[t].mean.toFixed(2)}:1, more than ${MAX_BELOW_MEDIAN}x below the median theme's ${median.toFixed(2)}:1\n${table}`);
    }
  });
