'use strict';

// THE STORE GALLERY CARRIES NO BUILD STRING.
//
// The first-run screen printed "Version 1.17.1 (6cb4c92)" in the first gallery image, so that image
// was out of date with every release. A person never keeps seeing it: the chip fades out four
// seconds after the screen loads. The capture photographs sooner than that, so before each
// photograph it puts the chip in the same faded state (FADE_VERSION in capture.js). This loads the
// panel's own stylesheet and the panel's own slot for the chip into a real Chrome, runs that very
// snippet, and reads what the browser computes.
//
// Needs a Chrome or Chromium binary (CHROME_PATH, or one of the usual places); without one
// it skips, like the other browser tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.STORE_SCREENSHOTS_VERSION_ROOT || path.join(__dirname, '..');
const { FADE_VERSION } = require(path.join(ROOT, 'scripts', 'store-screenshots', 'capture.js'));
const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const CHROME = candidates.find((p) => fs.existsSync(p)) || null;

function page() {
  // The slots are the panel's own, from sidepanel.html: one on the first-run screen, one on the lock screen.
  const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  const slots = [...html.matchAll(/<div id="(onboarding-version|lock-version)" class="pre-version-row"><\/div>/g)].map((m) => m[0]);
  return `<!doctype html><html data-theme="speakeasy"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${ROOT}/styles.css">
<!-- The fade is a 700ms transition, and headless Chrome's virtual clock does not run transitions to the end,
     so the computed opacity would still read 1. This reads where the rule ends up, not how it gets there. -->
<style>.version-chip { transition: none !important; }</style></head>
<body style="width:360px;height:300px;margin:0">${slots.join('')}
<script>
(async () => {
  const out = { slots: ${slots.length} };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Built the way the panel builds it (versionChip in sidepanel.js): a button in each slot.
  for (const slot of document.querySelectorAll('.pre-version-row')) {
    const chip = document.createElement('button');
    chip.className = 'pre-version version-chip';
    chip.textContent = 'Version 1.17.2 (abc1234)';
    slot.append(chip);
  }
  const chips = () => [...document.querySelectorAll('.pre-version-row .version-chip')];
  const seen = () => chips().map((c) => getComputedStyle(c).opacity);
  await wait(50);
  out.before = seen();
  eval(${JSON.stringify(FADE_VERSION)});
  await wait(900);
  out.after = seen();
  out.stillThere = chips().length;
  out.faded = chips().map((c) => c.classList.contains('faded'));
  const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify(out); document.body.append(pre);
})().catch((e) => { const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify({ error: String(e && e.stack || e) }); document.body.append(pre); });
</script></body></html>`;
}

function measure() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-shot-version-'));
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, page());
  try {
    const r = spawnSync(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
      `--user-data-dir=${path.join(dir, 'profile')}`, '--virtual-time-budget=10000', '--window-size=420,400',
      '--dump-dom', `file://${file}`,
    ], { encoding: 'utf8', timeout: 60000 });
    const m = /<pre id="result">([\s\S]*?)<\/pre>/.exec(r.stdout || '');
    assert.ok(m, 'Chrome did not report: ' + (r.stderr || '').slice(0, 300));
    const out = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    assert.ok(!out.error, out.error);
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

test('THE CAPTURE FADES THE VERSION CHIP OUT BEFORE EACH PHOTOGRAPH, AND LEAVES IT IN THE PAGE', opts, () => {
  const r = measure();
  assert.equal(r.slots, 2, 'the panel has a slot on the first-run screen and one on the lock screen');
  assert.deepEqual(r.faded, [true, true], 'the step marks both chips faded, as the panel does after four seconds');
  assert.deepEqual(r.before, ['1', '1'], 'without the step the chips are fully visible, as the old gallery showed');
  assert.deepEqual(r.after, ['0', '0'], 'after it they are not');
  assert.equal(r.stillThere, 2, 'faded, not removed: the product keeps the chip and so does the page');
});
