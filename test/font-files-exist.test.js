'use strict';

// Every font file the code names has to ship. A missing one fails quietly, as a
// fallback face rather than an error: the pay card's lettering, a theme's display type
// or the backup sheet's embedded fonts simply stop appearing. The pay card lost Ben Day's
// and Turnstile's lettering that way when their TTFs were converted to woff2 and the
// background's font list still named the old files. Tests that match the list's text go
// on passing through that, so this one reads the disk.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FONT = /\b(?:fonts\/)?([\w.-]+\.(?:ttf|otf|woff2?))\b/g;
const sources = [
  ...fs.readdirSync(ROOT).filter((f) => /\.(js|css|html)$/.test(f)),
  ...fs.readdirSync(path.join(ROOT, 'themes')).filter((f) => f.endsWith('.css')).map((f) => path.join('themes', f)),
];

test('every font file named in the code ships in fonts/', () => {
  const missing = [];
  let seen = 0;
  for (const f of sources) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(FONT)) {
      seen++;
      if (!fs.existsSync(path.join(ROOT, 'fonts', m[1]))) missing.push(`${f}: ${m[0]}`);
    }
  }
  assert.ok(seen > 20, 'the scan found the font references it exists to check');
  assert.deepEqual(missing, []);
});
