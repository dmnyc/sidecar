'use strict';

// The welcome page's apps catalog (#339's additions and the shape every entry
// keeps). The catalog is the directory a new user browses before they have any
// other client, so an entry with a missing field is a card that renders wrong in
// front of the newest possible audience — and a broken icon is a card with a hole
// in it. These are shape checks over the source, the same way the rest of the
// suite reads files that only run in a page.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'welcome.js'), 'utf8');

const CATS = ['social', 'media', 'gaming', 'commerce', 'tools', 'other'];
const ENTRIES = [...src.matchAll(/\{\n\s+name: '([^']+)',\n\s+url: '([^']+)',\n\s+domain: '([^']+)',\n\s+cat: '([^']+)',/g)]
  .map((m) => ({ name: m[1], url: m[2], domain: m[3], cat: m[4] }));

test('every catalog entry carries the fields a card renders', () => {
  assert.ok(ENTRIES.length > 10, 'the scan found almost nothing, so it is probably broken');
  for (const e of ENTRIES) {
    assert.ok(CATS.includes(e.cat), e.name + ' has a category the filter pills do not know: ' + e.cat);
    assert.ok(e.url.startsWith('https://'), e.name + ' links somewhere unsafe');
    assert.ok(e.url.includes(e.domain), e.name + "'s url and domain disagree");
  }
});

test('the #339 additions are present, in their categories', () => {
  const by = (n) => ENTRIES.find((e) => e.name === n);
  assert.deepEqual(
    ['Brainstorm', 'NymChat', 'Shakespeare'].map((n) => by(n) && by(n).cat),
    ['tools', 'social', 'tools']
  );
  assert.equal(by('NymChat').domain, 'nymchat.app');
  // NymChat has nothing hotlinkable on its site, so its icon is bundled — the Circl
  // precedent. The file is part of the extension and must not be forgotten on a
  // re-pack.
  assert.match(src, /icon: 'icons\/apps\/nym\.png'/);
  assert.ok(fs.existsSync(path.join(ROOT, 'icons/apps/nym.png')), 'the bundled NymChat icon is missing');
});
