'use strict';

// A balance read backwards in Arabic and Hebrew: 48,422 came out as 224,84.
//
// splitGlyphs deals each character of a figure into its own inline-block span, and the
// bidi algorithm treats an inline-block as an opaque object, so on a right-to-left page
// the row laid itself out from the right. The countdown digits (30 read 03) and the sign
// of a transaction amount ("21,000+") went the same way. A test that reads the stylesheet
// would pass on a rule that does nothing, so this one loads the real styles.css into a
// real Chrome under dir="rtl" and measures where the characters land.
//
// Needs a Chrome or Chromium binary (CHROME_PATH, or one of the usual places); without
// one it skips, like the other browser tests. RTL_FIGURES_ROOT points it at another
// checkout, which is how it was shown to fail on the stylesheet before the fix.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.RTL_FIGURES_ROOT || path.join(__dirname, '..');

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

// The page builds the same markup splitGlyphs does (one .bal-glyph span per character) and
// reports, for each figure, its characters in the order they are painted left to right.
const PAGE = (dir, theme) => `<!doctype html><html dir="${dir}" data-theme="${theme}"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${ROOT}/fonts.css">
<link rel="stylesheet" href="file://${ROOT}/styles.css">
<link rel="stylesheet" href="file://${ROOT}/themes/${theme}.css">
<link rel="stylesheet" href="file://${ROOT}/themes/patterns.css">
</head><body style="width:360px">
<div class="wallet-card"><div class="wallet-balance" id="wallet"></div></div>
<div class="pinned-balance"><div class="pinned-balance-amt-wrap"><span class="pinned-balance-amt" id="pinned"></span></div></div>
<div class="countdown-wrap"><div class="countdown-num" id="count"></div></div>
<div><div class="tx-amt in" id="tx">+21,000</div></div>
<div class="wallet-chart-meta"><span class="wallet-chart-lowhigh" id="range">$87,000 – $91,000</span></div>
<script>
function glyphs(el, text) {
  [...text].forEach((ch, i) => {
    const s = document.createElement('span');
    s.className = 'bal-glyph' + (/[0-9]/.test(ch) ? '' : ' bal-sep') + (i % 2 ? ' bal-alt' : '');
    s.style.cssText = '--i:' + i + ';--n:' + text.length;
    s.textContent = ch;
    s.setAttribute('data-glyph', ch);
    el.append(s);
  });
}
glyphs(document.getElementById('wallet'), '48,422');
glyphs(document.getElementById('pinned'), '48,422');
glyphs(document.getElementById('count'), '30');
// Painted order of the glyph spans, left to right. Reading each one's left edge is enough
// because a figure's glyphs sit side by side.
const painted = (id) => [...document.getElementById(id).querySelectorAll('.bal-glyph')]
  .map((g) => [g.getBoundingClientRect().left, g.textContent]).sort((a, b) => a[0] - b[0]).map((x) => x[1]).join('');
// Same for a text node: where its first and last characters landed.
const ends = (id) => {
  const n = document.getElementById(id).firstChild, r = document.createRange();
  r.setStart(n, 0); r.setEnd(n, 1); const a = r.getBoundingClientRect().left;
  r.setStart(n, n.length - 1); r.setEnd(n, n.length); const b = r.getBoundingClientRect().left;
  return a < b ? 'start-left' : 'start-right';
};
const out = document.createElement('pre'); out.id = 'result';
out.textContent = JSON.stringify({ wallet: painted('wallet'), pinned: painted('pinned'), count: painted('count'), tx: ends('tx'), range: ends('range') });
document.body.append(out);
</script></body></html>`;

function measure(dir, theme) {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-rtl-'));
  const file = path.join(dirPath, 'page.html');
  fs.writeFileSync(file, PAGE(dir, theme));
  try {
    const r = spawnSync(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
      `--user-data-dir=${path.join(dirPath, 'profile')}`,
      '--virtual-time-budget=2000', '--window-size=520,900', '--dump-dom', `file://${file}`,
    ], { encoding: 'utf8', timeout: 60000 });
    const m = /<pre id="result">([^<]*)<\/pre>/.exec(r.stdout || '');
    assert.ok(m, 'Chrome did not report: ' + (r.stderr || '').slice(0, 300));
    return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } finally {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

// speakeasy and cast-iron both make the glyphs inline-block; nixie does not reverse its
// balance but still reversed the countdown, so it is in for the figure that differs.
for (const theme of ['speakeasy', 'cast-iron', 'nixie']) {
  test(`${theme}: figures keep their order on a right-to-left page`, { skip: CHROME ? false : 'no Chrome found', timeout: 90000 }, () => {
    const rtl = measure('rtl', theme);
    assert.equal(rtl.wallet, '48,422', 'wallet card balance');
    assert.equal(rtl.pinned, '48,422', 'pinned balance bar');
    assert.equal(rtl.count, '30', 'countdown digits');
    assert.equal(rtl.tx, 'start-left', 'the sign leads a transaction amount');
    assert.equal(rtl.range, 'start-left', 'the chart range reads low to high');
    // And a left-to-right page is untouched.
    const ltr = measure('ltr', theme);
    assert.deepEqual({ ...ltr }, { ...rtl });
  });
}
