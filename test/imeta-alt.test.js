'use strict';

// Describing an attached image, so the client that renders the note can say it.
//
// Sidecar shows no images in a published note — every reader's client does that — so
// the whole feature is the write side: a NIP-92 `imeta` tag per described attachment,
// in the shape zap.cooking ships (and Amethyst and Gossip before it). The wire rules
// that matter are the ones a silent mistake breaks for the reader, not the writer:
//
//   - a slot's value is everything after its FIRST space, so a description keeps its
//     own spaces and its line breaks (a parser splitting on any whitespace truncates
//     it — the bug zap.cooking's #749 fixed, where every publish flattened \n to a
//     space and destroyed multi-paragraph descriptions for everyone);
//   - an empty description means no alt slot and NO imeta tag — never empty metadata;
//   - undescribed media emits nothing, so a note of bare URLs publishes exactly as it
//     did before the feature existed.
//
// The vectors below are the mobile-parity spec's lock-in list from that PR, run
// against sidecar's own copy of the code. If one of these fails, the tag sidecar
// writes has drifted from what other clients read.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');
const pageBare = page.replace(/^\s*\/\/.*$/gm, '');
const panelBare = panel.replace(/^\s*\/\/.*$/gm, '');

// The REAL write-side functions, lifted out of composer-core.js — a local mirror could
// drift from the file both composers load, and the tests would keep passing against the
// wrong code.
function lift(pattern, label) {
  const m = core.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in composer-core.js');
  return m[0];
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  lift(/const ALT_MAX = \d+;/, 'ALT_MAX') + '\n' +
  lift(/function normalizeAltBreaks\(text\) \{[\s\S]*?\n  \}/, 'normalizeAltBreaks') + '\n' +
  lift(/function buildImetaTag\(url, alt\) \{[\s\S]*?\n  \}/, 'buildImetaTag') + '\n' +
  lift(/function imetaTagsForMedia\(media\) \{[\s\S]*?\n  \}/, 'imetaTagsForMedia') + '\n' +
  'globalThis.ALT_MAX = ALT_MAX;' +
  'globalThis.normalizeAltBreaks = normalizeAltBreaks;' +
  'globalThis.buildImetaTag = buildImetaTag;' +
  'globalThis.imetaTagsForMedia = imetaTagsForMedia;',
  ctx
);
const { ALT_MAX, normalizeAltBreaks, buildImetaTag, imetaTagsForMedia } = ctx;

// Values built inside the vm carry its Array.prototype, which strict deep-equal
// rightly refuses from out here. The tag shape is data, so taking a plain copy at
// the boundary compares exactly what a relay would receive.
const plain = (v) => JSON.parse(JSON.stringify(v));

test('LINE BREAKS SURVIVE, CAPPED AT ONE PARAGRAPH GAP', () => {
  // The parity spec's lock-in vectors. Flattening any of these is the exact defect
  // zap.cooking's #749 exists to fix: authored paragraphs silently destroyed at
  // publish, for every reader including our own.
  assert.equal(normalizeAltBreaks('two\nlines'), 'two\nlines', 'a single break is the point');
  assert.equal(normalizeAltBreaks('a\n\n\n\n\nb'), 'a\n\nb', 'one blank line is a paragraph; five is a hole');
  assert.equal(normalizeAltBreaks('a\r\nb'), 'a\nb', 'CRLF arrives from Windows editors');
  assert.equal(normalizeAltBreaks('a\rb'), 'a\nb', 'bare CR too');
  assert.equal(normalizeAltBreaks('First paragraph\n\nSecond paragraph'), 'First paragraph\n\nSecond paragraph');
  assert.equal(normalizeAltBreaks('  padded line  \n  more  '), 'padded line\nmore', 'each line trims');
  assert.equal(normalizeAltBreaks('  \n\n  '), '', 'whitespace only is no description');
  assert.equal(normalizeAltBreaks(''), '');
  assert.equal(normalizeAltBreaks(null), '', 'a draft media slot with no alt at all');
});

test('THE TAG IS ONE imeta ROW PER DESCRIBED IMAGE, alt LAST-VALUE-WHOLE', () => {
  const url = 'https://i.nostr.build/eS5EHNjnkLY9cJ4iQ47pOO.png';
  const tag = plain(buildImetaTag(url, 'TV test pattern'));
  // The interop vector: the shape Amethyst publishes and every reader parses.
  assert.deepEqual(tag, ['imeta', 'url ' + url, 'alt TV test pattern']);
  // A slot's value is everything after the first space — commas, colons and further
  // spaces belong to the description, not to phantom slots.
  assert.deepEqual(
    plain(buildImetaTag(url, 'A photo: one, two, three')),
    ['imeta', 'url ' + url, 'alt A photo: one, two, three']
  );
});

test('NO DESCRIPTION, NO TAG — NEVER EMPTY METADATA', () => {
  const url = 'https://example.com/pic.png';
  assert.equal(buildImetaTag(url, ''), null);
  assert.equal(buildImetaTag(url, '   '), null);
  assert.equal(buildImetaTag(url, ' \n \n '), null, 'breaks alone are not a description');
  assert.equal(buildImetaTag(url, null), null);
  assert.equal(buildImetaTag('', 'a description'), null, 'no URL, nothing to describe');
});

test('MULTI-PARAGRAPH ALT RIDES THE WIRE BYTE-IDENTICAL', () => {
  // The full example from zap.cooking's PR, built here and round-tripped the way a
  // relay sees it: JSON-escaped on publish, parsed back by any client. A \n inside the
  // slot string is the no-invention option — no escape scheme for another client to
  // lack a decoder for.
  const url = 'https://i.nostr.build/eS5EHNjnkLY9cJ4iQ47pOO.png';
  const alt = 'A screenshot of a Nostr post about web accessibility.\n\nBelow it, a quoted post.';
  const tag = plain(buildImetaTag(url, alt));
  const back = JSON.parse(JSON.stringify(tag));
  assert.deepEqual(back, tag);
  assert.equal(back[2].slice(4), alt, 'the alt slot returns exactly what was authored');
});

test('THE CAP APPLIES AT PUBLISH, NOT ONLY IN THE EDITOR', () => {
  // A draft restored into a composer whose editor never opens still publishes — so
  // buildImetaTag carries the same ceiling the field enforces, or a hand-edited draft
  // walks past it.
  const long = 'x'.repeat(ALT_MAX + 500);
  const tag = plain(buildImetaTag('https://example.com/pic.png', long));
  assert.equal(tag[2].length, 'alt '.length + ALT_MAX);
  assert.ok(ALT_MAX === 2000, 'the ceiling is the one zap.cooking authors against');
});

test('UNDESCRIBED MEDIA EMITS NOTHING, IN DRAFT ORDER', () => {
  const a = 'https://example.com/a.png';
  const b = 'https://example.com/b.png';
  const c = 'https://example.com/c.png';
  assert.deepEqual(plain(imetaTagsForMedia([])), []);
  assert.deepEqual(plain(imetaTagsForMedia(undefined)), []);
  // Only the described one, and where the draft put it — a note of bare URLs publishes
  // byte-identical to what it published before this feature existed.
  assert.deepEqual(plain(imetaTagsForMedia([{ url: a }, { url: b, alt: 'second' }, { url: c }])), [
    ['imeta', 'url ' + b, 'alt second'],
  ]);
  // Media whose description was cleared in the editor (alt deleted from the slot).
  const cleared = { url: a, alt: '' };
  assert.deepEqual(plain(imetaTagsForMedia([cleared])), []);
});

// ---- the wiring: both composers write the tag, from one copy of the code ----

test('BOTH PUBLISHERS EMIT THE TAGS FROM THE SHARED HELPER', () => {
  // The panel assembles its tags from parts; the tab starts from a template. Either
  // one publishing without the helper is a note whose images ship undescribed, and
  // nothing else would catch it.
  assert.match(panelBare, /tags\.push\(\.\.\.imetaTagsForMedia\(draft\.media\)\);/);
  assert.match(pageBare, /tags: \[\['client', 'Sidecar'\], \.\.\.SC\.imetaTagsForMedia\(draft\.media\)\]/);
});

test('THE CHIP IS ON EVERY IMAGE THUMB IN BOTH COMPOSERS', () => {
  // "+ ALT" until described, "✓ ALT" after, accent-colored so a strip of images shows
  // at a glance which ones still need the words. Videos are out of scope — sidecar
  // writes IMAGE alt text, and the chip says which media it edits.
  for (const [name, src] of [['sidepanel.js', panelBare], ['compose.js', pageBare]]) {
    assert.ok(src.includes("compose-thumb-alt' + (m.alt ? ' has-alt' : '')"), name + ' never builds the chip');
    assert.ok(src.includes("m.alt ? '✓ ALT' : '+ ALT'"), name + ' never labels the chip');
    // And only on a still: the chip sits inside the not-a-video branch.
    const at = src.indexOf("compose-thumb-alt' + (m.alt ? ' has-alt' : '')");
    const branch = src.slice(src.lastIndexOf('if (!m.isVideo)', at), at);
    assert.ok(branch.length > 0 && branch.length < 400, name + ' offers the chip outside the image branch');
  }
});

test('THE ROW EDITS ONE SLOT AND THE DRAFT KEEPS WHAT IT WROTE', () => {
  // Drafts persist the media array whole (sidecar has always serialized it as it
  // stands), so `alt` rides along — what must not happen is a save path that rebuilds
  // the media entry and drops the field, or a remove that leaves the row editing a
  // slot that no longer exists.
  for (const [name, src] of [['sidepanel.js', panelBare], ['compose.js', pageBare]]) {
    assert.ok(src.includes('media: draft.media'), name + ' saves the media array whole');
    assert.match(src, /closeAltEditor\(\); \/\/ the row edits a media slot that no longer exists/,
      name + ' closes the row when its image is removed');
  }
  // Both take the row from the core — a second copy is a second wire format waiting
  // to drift.
  assert.match(panelBare, /altRow = buildAltEditorRow\(\{/, 'the panel builds the shared row');
  assert.match(pageBare, /altRow = SC\.buildAltEditorRow\(\{/, 'the tab builds the shared row');
});

test('A DECIDED NOTE IS NOT EDITABLE UNDER THE REVIEW WINDOW', () => {
  // The tab's review window leaves the thumbnails on screen; an open ALT row under it
  // would offer a live Save against a note Post already snapshotted. The panel's
  // countdown takes over the whole modal, so it has nothing to close.
  const reviewing = pageBare.slice(pageBare.indexOf('function setReviewing(on)'));
  const body = reviewing.slice(0, reviewing.indexOf('\n  }'));
  assert.match(body, /if \(on\) closeAltEditor\(\);/);
});

test('THE CORE EXPORTS THE WHOLE WRITE SIDE, AND THE PANEL TAKES IT', () => {
  // The functions are pure, so they travel on the global like IMG_EXT rather than
  // through installComposer — and a name forgotten at the panel's destructure is a
  // ReferenceError on the first chip tap, which is exactly what the seam tests exist
  // to make loud.
  for (const name of ['ALT_MAX', 'normalizeAltBreaks', 'buildImetaTag', 'imetaTagsForMedia', 'buildAltEditorRow']) {
    assert.ok(core.includes(name + ',') || new RegExp('\\b' + name + '\\b').test(core.slice(core.indexOf('return {'))),
      'composer-core.js never exports ' + name);
  }
  assert.match(
    panel,
    /const \{ ALT_MAX, normalizeAltBreaks, imetaTagsForMedia, buildAltEditorRow \} = window\.SidecarCore;/
  );
});
