'use strict';

// Every logo in the app directory and the wallets list ships inside the extension. A card
// that loads its picture from the web loses it whenever that site is down or puts a bot check
// in front of it, which an <img> cannot pass; it happened to a dozen cards in one day. To add
// or refresh one: node scripts/fetch-directory-icons.mjs, then point the card at the file.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../scripts/directory-check-core.js');

const ROOT = path.join(__dirname, '..');

test('every card draws a logo that ships with the extension', () => {
  const cards = core.readDirectory(ROOT);
  assert.ok(cards.length > 60, 'the directory was not read');
  for (const c of cards) {
    if (c.logo) continue; // markup carried in the file
    assert.ok(c.icon, `${c.name} (${c.list}) names no icon, so it would load one from Google`);
    assert.doesNotMatch(c.icon, /^https?:/i, `${c.name} (${c.list}) loads its icon from the web: ${c.icon}`);
    const file = path.join(ROOT, c.icon);
    assert.ok(fs.existsSync(file), `${c.name}: ${c.icon} is missing`);
    assert.ok(core.imageKind(fs.readFileSync(file)), `${c.name}: ${c.icon} is not a picture`);
  }
});

test('a bundled SVG carries no script, event handler or outside reference', () => {
  const dir = path.join(ROOT, 'icons', 'apps');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.svg'))) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(s, /<script/i, f);
    assert.doesNotMatch(s, /\son[a-z]+\s*=/i, f);
    assert.doesNotMatch(s, /(xlink:)?href\s*=\s*["']https?:/i, f);
  }
});
