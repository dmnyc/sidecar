'use strict';

// Every local image a shipped page loads has to exist AND survive packaging. The help
// guide's illustrations live in screenshots/, and a size pass once added that directory
// to the package's strip list on the belief that it held store captures: the repo stayed
// fine, every test stayed green, and every image in the packaged guide broke. So this
// reads the strip list out of scripts/package.sh and checks each page against it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function strippedDirs() {
  const sh = read('scripts/package.sh');
  const at = sh.indexOf('rm -rf "${STAGE}"/.[!.]*');
  assert.ok(at !== -1, 'the package strip line moved; update this test to read it');
  const line = sh.slice(at, sh.indexOf('\n', sh.indexOf('\\\n', at) + 2));
  return [...line.matchAll(/"\$\{STAGE\}\/([\w-]+)"/g)].map((m) => m[1]);
}

test('every local image a shipped page loads exists and is packaged', () => {
  const stripped = strippedDirs();
  assert.ok(stripped.includes('test') && stripped.includes('docs'), 'the strip list did not parse');
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  const bad = [];
  let seen = 0;
  for (const page of pages) {
    for (const m of read(page).matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)) {
      const src = m[1];
      if (/^(?:https?:|data:|\/\/)/.test(src) || src.includes('{{')) continue;
      seen++;
      if (!fs.existsSync(path.join(ROOT, src))) bad.push(`${page}: ${src} does not exist`);
      else if (stripped.includes(src.split('/')[0])) bad.push(`${page}: ${src} is stripped by package.sh`);
    }
  }
  assert.ok(seen >= 15, 'the scan found the help guide\'s images');
  assert.deepEqual(bad, []);
});
