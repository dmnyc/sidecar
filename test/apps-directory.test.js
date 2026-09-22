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

// name -> desc, read separately because desc does not always follow cat directly: some
// entries carry an icon, a flush flag or a comment in between.
const DESCS = Object.fromEntries(
  [...src.matchAll(/name: '([^']+)',[\s\S]*?desc: '((?:[^'\\]|\\.)*)',/g)].map((m) => [m[1], m[2]])
);

test('every catalog entry carries the fields a card renders', () => {
  assert.ok(ENTRIES.length > 10, 'the scan found almost nothing, so it is probably broken');
  for (const e of ENTRIES) {
    assert.ok(CATS.includes(e.cat), e.name + ' has a category the filter pills do not know: ' + e.cat);
    assert.ok(e.url.startsWith('https://'), e.name + ' links somewhere unsafe');
    assert.ok(e.url.includes(e.domain), e.name + "'s url and domain disagree");
  }
});

test('NO CARD DESCRIPTION RUNS PAST FOUR LINES', () => {
  // A hard cap, stated 2026-09-22. Three of the #339 additions shipped at five lines
  // and made their rows taller than everything around them.
  //
  // MEASURED, not guessed. Rendering the real page at 1280px and counting line boxes
  // with a Range put the boundary between 96 characters (still four lines) and 130
  // (five). 110 is the ceiling that sits inside that gap and matches the one the panel
  // hints already use, and the whole catalog fits under it with the longest at 108.
  //
  // Character count is a proxy for a thing only a browser can measure, so it is
  // deliberately a little tight. A desc that trips this is not necessarily five lines,
  // but it is close enough to the edge to be worth rewriting.
  for (const e of ENTRIES) {
    const desc = DESCS[e.name];
    assert.ok(desc, e.name + ' has no desc the scan could find');
    assert.ok(desc.length <= 110,
      e.name + "'s description is " + desc.length + ' characters, which risks a fifth line: ' + desc);
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

// ---- the open slot at the end of the grid ----------------------------------------

test('THE OPEN SLOT IS LAST, AND SURVIVES EVERY FILTER', () => {
  const css = fs.readFileSync(path.join(ROOT, 'welcome.css'), 'utf8');

  // Appended after the cards, so it is the last thing in the grid rather than sorted
  // into the middle of a category.
  const at = src.indexOf("grid.appendChild(slot)");
  assert.ok(at > src.indexOf('sorted.forEach'), 'the slot is not appended after the cards');
  assert.match(src, /slot\.className = 'card app-slot';/);
  assert.match(src, /slot\.href = 'https:\/\/github\.com\/dmnyc\/sidecar\/issues';/,
    'the slot points somewhere other than the issues tracker');
  assert.match(src, /slot\.rel = 'noopener';/, 'a target=_blank link without noopener');
  assert.match(src, /'Your app could be here'/);

  // THE ONE THAT WOULD BREAK QUIETLY. The slot carries no data-cat, so the filter's
  // `card.dataset.cat === cat` is false for it under every category. Without the
  // :not() it disappears the moment anything but All is picked, and nothing would
  // fail: the grid would simply be one card shorter in five of the six views.
  assert.match(src, /querySelectorAll\('\.card:not\(\.app-slot\)'\)/,
    'the filter no longer skips the open slot, so it vanishes under every category');

  // Dashed and unfilled, so it reads as a space rather than as an app nobody knows.
  const rule = css.slice(css.indexOf('.app-slot {'), css.indexOf('.app-slot:hover'));
  assert.match(rule, /border-style: dashed/);
  assert.match(rule, /background: none/);
});
