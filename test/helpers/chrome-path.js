'use strict';

// THE BROWSER TESTS NEVER DRIVE THE CHROME YOU BROWSE WITH. On a Mac, a headless copy of the
// installed Google Chrome counts as the same app: the app switcher and new-tab requests go to
// the copy, which has no windows, and the real browser stops opening tabs while a test runs.
// Chrome for Testing is an app of its own. Install it once:
//
//   npx @puppeteer/browsers install chrome@stable --path ~/.cache/sidecar-test-browsers
//
// Order: CHROME_PATH if set; Chrome for Testing under SIDECAR_TEST_BROWSERS or
// ~/.cache/sidecar-test-browsers (the newest build); Chromium; on Linux (CI, no desktop to
// disturb) google-chrome. The installed Google Chrome on a Mac only with
// SIDECAR_ALLOW_BRANDED_CHROME=1. No browser found: the tests skip, as before.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BINARIES = [
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-linux64/chrome',
  'chrome-win64/chrome.exe',
];

const versionOf = (dir) => (dir.match(/(\d+(?:\.\d+)*)$/) || [, '0'])[1].split('.').map(Number);
const newestFirst = (a, b) => {
  const x = versionOf(a), y = versionOf(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] || 0) !== (x[i] || 0)) return (y[i] || 0) - (x[i] || 0);
  return 0;
};

function chromeForTesting() {
  const roots = [process.env.SIDECAR_TEST_BROWSERS, path.join(os.homedir(), '.cache', 'sidecar-test-browsers')].filter(Boolean);
  for (const root of roots) {
    const dir = path.join(root, 'chrome');
    let builds = [];
    try { builds = fs.readdirSync(dir).sort(newestFirst); } catch (_) { continue; }
    for (const b of builds) {
      for (const rel of BINARIES) {
        const p = path.join(dir, b, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

function findChrome() {
  if (process.env.CHROME_PATH) return fs.existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  const cft = chromeForTesting();
  if (cft) return cft;
  const others = ['/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  if (process.platform !== 'darwin') others.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable');
  if (process.env.SIDECAR_ALLOW_BRANDED_CHROME === '1') others.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  return others.find((p) => fs.existsSync(p)) || null;
}

module.exports = { findChrome };
