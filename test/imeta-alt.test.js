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
  lift(/function capAltText\(text\) \{[\s\S]*?\n  \}/, 'capAltText') + '\n' +
  lift(/function buildImetaTag\(url, alt\) \{[\s\S]*?\n  \}/, 'buildImetaTag') + '\n' +
  lift(/function imetaTagsForMedia\(media\) \{[\s\S]*?\n  \}/, 'imetaTagsForMedia') + '\n' +
  lift(/function composeNoteContent\(text, media\) \{[\s\S]*?\n  \}/, 'composeNoteContent') + '\n' +
  lift(/function stripDraftMediaUrls\(text, media\) \{[\s\S]*?\n  \}/, 'stripDraftMediaUrls') + '\n' +
  lift(/function loneImageUrl\(text\) \{[\s\S]*?\n  \}/, 'loneImageUrl') + '\n' +
  lift(/function urlOnBoundary\(lines, url\) \{[\s\S]*?\n  \}/, 'urlOnBoundary') + '\n' +
  // loneImageUrl judges with the REAL extension list, lifted like quoteSnippet's
  // IMG_EXT — a local mirror could drift and the vectors would keep passing.
  lift(/const IMG_EXT = [^;]+;/, 'IMG_EXT') + '\n' +
  'globalThis.ALT_MAX = ALT_MAX;' +
  'globalThis.normalizeAltBreaks = normalizeAltBreaks; globalThis.capAltText = capAltText;' +
  'globalThis.buildImetaTag = buildImetaTag;' +
  'globalThis.imetaTagsForMedia = imetaTagsForMedia;' +
  'globalThis.composeNoteContent = composeNoteContent;' +
  'globalThis.stripDraftMediaUrls = stripDraftMediaUrls;' +
  'globalThis.loneImageUrl = loneImageUrl; globalThis.urlOnBoundary = urlOnBoundary;',
  ctx
);
const { ALT_MAX, normalizeAltBreaks, capAltText, buildImetaTag, imetaTagsForMedia, composeNoteContent, stripDraftMediaUrls, loneImageUrl, urlOnBoundary } = ctx;

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
  // AND THE CUT IS BY CHARACTER, not code unit: an emoji is two code units for one
  // character, and a hard .slice(2000) can land mid-pair and ship half an emoji.
  const astral = 'a'.repeat(ALT_MAX - 1) + '\u{1F389}\u{1F389}';
  const capped = capAltText(astral);
  assert.equal(Array.from(capped).length, ALT_MAX, 'ALT_MAX characters survive');
  assert.ok(!/[\uD800-\uDBFF]$/.test(capped) || /[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(capped),
    'the cap never ends on half a character');
  const astralTag = plain(buildImetaTag('https://example.com/pic.png', astral));
  assert.ok(/[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(astralTag[2]), 'the wire copy ends on a whole character');
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

test('THE ATTACHMENTS MEET THE PROSE ONCE, AT PUBLISH', () => {
  // The editor shows prose only; the URLs ride in the media slot. One function puts
  // them back together — for the note and for the preview, so the review window
  // shows the note that will actually go out rather than the half of it the editor
  // was showing.
  assert.equal(composeNoteContent('hello', [{ url: 'https://x/a.png' }]), 'hello\n\nhttps://x/a.png');
  assert.equal(
    composeNoteContent('hello', [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }]),
    'hello\n\nhttps://x/a.png\nhttps://x/b.png',
    'each attachment on its own line, in strip order'
  );
  assert.equal(composeNoteContent('', [{ url: 'https://x/a.png' }]), 'https://x/a.png', 'media alone is a note');
  assert.equal(composeNoteContent('  hello  ', []), 'hello');
  assert.equal(composeNoteContent('', []), '');
  assert.equal(composeNoteContent('hello'), 'hello', 'no media slot at all');
});

test('AN OLD DRAFT DOES NOT PUBLISH ITS URLS TWICE', () => {
  // Drafts saved before the URLs left the editor carry them in the saved text — the
  // same URLs the media slot holds. Only LINE-BOUNDARY occurrences are migration
  // leftovers and only those are stripped; a URL inside a sentence is authored prose
  // and stays, because silently losing a sentence's URL on restore is the same loss
  // this migration exists to prevent.
  const media = [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }];
  assert.equal(stripDraftMediaUrls('hello\nhttps://x/a.png\nhttps://x/b.png', media), 'hello');
  assert.equal(stripDraftMediaUrls('hello\n\nhttps://x/a.png', [media[0]]), 'hello', 'blank line before the block');
  assert.equal(stripDraftMediaUrls('hello', media), 'hello', 'a clean draft is untouched');
  assert.equal(stripDraftMediaUrls('', media), '');
  assert.equal(
    stripDraftMediaUrls('look at https://x/other.png', [{ url: 'https://x/a.png' }]),
    'look at https://x/other.png',
    'prose carrying a different URL is prose, not an attachment line'
  );
  // The boundary rule, both edges: what the old format never wrote is not migration
  // leftover and must survive the restore.
  assert.equal(
    stripDraftMediaUrls('mirror at https://x/a.png if the first dies', [media[0]]),
    'mirror at https://x/a.png if the first dies',
    'an authored mid-sentence mention stays'
  );
  assert.equal(
    stripDraftMediaUrls('https://x/a.png and https://x/a.png again', [media[0]]),
    'https://x/a.png and https://x/a.png again',
    'twice on one line is ambiguous and stays'
  );
  // A leftover line AND an authored mention of the same URL: the line goes, the
  // sentence keeps its copy.
  assert.equal(
    stripDraftMediaUrls('see https://x/a.png inline\nhttps://x/a.png', [media[0]]),
    'see https://x/a.png inline',
    'only the boundary occurrence is migration leftover'
  );
});

// ---- the wiring: both composers write the tag, from one copy of the code ----

test('BOTH PUBLISHERS EMIT THE TAGS FROM THE SHARED HELPER', () => {
  // The panel assembles its tags from parts; the tab starts from a template. Either
  // one publishing without the helper is a note whose images ship undescribed, and
  // nothing else would catch it.
  assert.match(panelBare, /tags\.push\(\.\.\.imetaTagsForMedia\(draft\.media\)\);/);
  assert.match(pageBare, /tags: \[\['client', 'Sidecar'\], \.\.\.SC\.imetaTagsForMedia\(draft\.media\)\]/);
});

test('THE STRIP REORDERS BY MORE THAN DRAG', () => {
  // HTML5 drag-and-drop never fires on touch, so a touchscreen could not reorder
  // attachments at all and a keyboard had no path either. The steppers are buttons
  // — reachable by touch and Tab both — they splice the same array the drag does,
  // and the ends hide theirs rather than disabling an arrow.
  assert.match(core, /'arrow-right':/, 'the right arrow never existed');
  for (const [name, src] of [['sidepanel.js', panelBare], ['compose.js', pageBare]]) {
    const at = src.indexOf('compose-thumb-move');
    assert.ok(at > -1, name + ' never builds the steppers');
    const block = src.slice(at - 2200, at + 900);
    assert.match(block, /if \(draft\.media\.length > 1\) \{/, name + ' offers steppers on a single thumb');
    assert.match(block, /closeAltEditor\(\); \/\/ flush first/, name + ' moves the row\'s slot before flushing it');
    assert.match(block, /draft\.media\.splice\(i, 1\)\[0\]/, name + ' never splices');
    assert.match(block, /if \(i > 0\) cell\.append\(step\(-1/, name + ' shows a left arrow at the first slot');
    assert.match(block, /if \(i < draft\.media\.length - 1\) cell\.append\(step\(1/, name + ' shows a right arrow at the last slot');
  }
  const sheet = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(sheet, /\.compose-thumb-move\.left \{ left: 3px; \}/);
  assert.match(sheet, /\.compose-thumb-move\.right \{ right: 3px; \}/);
});

test('A POLL AND ITS ATTACHMENTS ARE ONE OR THE OTHER', () => {
  // A kind:1068 carrying appended image URLs and imeta tags is a shape no NIP-88
  // client renders, and the tag push in doPublish once claimed it could not arrive
  // while nothing enforced it. Each side's button stands down while the other holds
  // the draft, and every media mutation repaints the pair.
  assert.match(panelBare, /function paintEitherOr\(\) \{/);
  assert.match(panelBare, /pollAdd\.classList\.toggle\('hidden', !!draft\.poll \|\| !!replyTo \|\| !!\(draft\.media && draft\.media\.length\)\)/);
  assert.match(panelBare, /addBtn\.classList\.toggle\('hidden', !!draft\.poll\);/, 'Media stays offered under an open poll');
  // In preview mode the clauses compose with the preview hide.
  assert.match(panelBare, /addBtn\.classList\.toggle\('hidden', p \|\| !!draft\.poll\);/);
  assert.match(panelBare, /pollAdd\.classList\.toggle\('hidden', p \|\| !!draft\.poll \|\| !!replyTo \|\| !!\(draft\.media && draft\.media\.length\)\);/);
  // And every way media changes repaints, so the excluded button never lingers.
  assert.equal((panelBare.match(/paintEitherOr\(\);/g) || []).length, 6,
    'paintPoll + the media mutations (uploads, removal, attach, stepper) must repaint the pair');
});

test('ATTACHING AN ALREADY-ATTACHED URL CONVERTS, NEVER DUPLICATES', () => {
  // Pasting the same URL twice and accepting both used to append the image twice —
  // two identical thumbnails, the URL twice in the published content, two imeta
  // tags for one picture. Accepting a URL the draft already holds now takes the
  // prose line and keeps the existing entry, description included.
  for (const [name, src] of [['sidepanel.js', panelBare], ['compose.js', pageBare]]) {
    assert.match(src, /if \(!draft\.media\.some\(\(m\) => m && m\.url === url\)\) \{/,
      name + ' appends a duplicate attachment');
  }
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
    assert.match(src, /closeAltEditor\(false\); \/\/ the row edits a media slot that no longer exists/,
      name + ' closes the row when its image is removed — without flushing into the spliced array');
  }
  // Both take the row from the core — a second copy is a second wire format waiting
  // to drift.
  assert.match(panelBare, /altRow = buildAltEditorRow\(\{/, 'the panel builds the shared row');
  assert.match(pageBare, /altRow = SC\.buildAltEditorRow\(\{/, 'the tab builds the shared row');
});

test('THE PUBLISHERS COMPOSE; THE UPLOADS NEVER TOUCH THE EDITOR', () => {
  // The note that publishes — and the preview the review window shows — is the
  // composed string, prose and attachments together. The upload path pushes into the
  // media slot and leaves the editor alone.
  assert.match(panelBare, /const content = composeNoteContent\(prose, draft\.media\);/);
  assert.match(panelBare, /composer\.renderNotePreview\(body, composeNoteContent\(draft\.text, draft\.media\)\)|composeNoteContent\(draft\.text, draft\.media\)/);
  assert.match(panelBare, /const preview = stripDraftMediaUrls\(saved\.text, saved\.media\)/, 'the chooser previews the stripped text');
  for (const [name, src] of [['sidepanel.js', panelBare], ['compose.js', pageBare]]) {
    assert.ok(!src.includes('appendMediaUrl'), name + ' still appends URLs into the editor');
    // A single thumb does not need reordering; more than one drags.
    assert.match(src, /cell\.draggable = draft\.media\.length > 1;/, name + ' never offers the drag');
    assert.match(src, /draft\.media\.splice\(dragFrom, 1\)\[0\]/, name + ' never reorders on drop');
    // The drawer, built once and re-read from the live draft — the draft is rebound
    // when the account moves, so a captured array would go stale.
    assert.match(src, /buildMediaDrawer\(\(\) => draft\.media\)/, name + ' never builds the reference drawer');
    assert.match(src, /mediaDrawer\.sync\(\)/, name + ' never syncs the drawer');
    // An upload fires no editor input, so the autosave is told by hand — and so is
    // the Post button, since media alone is postable: without this, a first upload
    // into an empty composer leaves Post inert and a last removal leaves it lit.
    // The panel repaints at four sites (file upload, paste upload, removal, and the
    // pasted-URL conversion); the tab likewise, minus the image-paste upload.
    assert.match(src, /draft\.media\.push\(/, name + ' lost the upload push');
    const taps = name === 'sidepanel.js'
      ? src.match(/scheduleSave\(\);\n\s*updatePostState\(\);\n\s*renderThumbs\(\);/g) || []
      : src.match(/scheduleSave\(\);\n\s*paintCount\(\);\n\s*renderThumbs\(\);/g) || [];
    const want = name === 'sidepanel.js' ? 4 : 3;
    assert.equal(taps.length, want, name + ' repaints the button at every media change (found ' + taps.length + ')');
  }
});

test('THE REFERENCE DRAWER SAYS WHERE THE ATTACHMENTS GO', () => {
  // Collapsed it is one line — the whole point of taking the URLs out of the editor
  // is that nobody should have to look at them to write — and that line must say
  // where they went, because the composer no longer shows it.
  const at = core.indexOf('function buildMediaDrawer');
  assert.ok(at > -1, 'composer-core.js never builds the drawer');
  const fn = core.slice(at, core.indexOf('\n  }\n', at));
  assert.match(fn, /added to the end of your post/);
  assert.match(fn, /attachment/, 'the count, in words');
  // And the copy affordance rides the row, in the icon slot: a URL in a reference
  // drawer that cannot leave it is a tease.
  assert.match(fn, /compose-media-copy/);
  assert.match(fn, /navigator\.clipboard\.writeText\(m\.url\)/);
});

test('A DECIDED NOTE IS NOT EDITABLE UNDER THE REVIEW WINDOW', () => {
  // The tab's review window leaves the thumbnails on screen; an open ALT row under it
  // would offer a live Save against a note Post already snapshotted. The panel's
  // countdown takes over the whole modal, so it has nothing to close.
  const reviewing = pageBare.slice(pageBare.indexOf('function setReviewing(on)'));
  const body = reviewing.slice(0, reviewing.indexOf('\n  }'));
  assert.match(body, /if \(on\) closeAltEditor\(\);/);
  // And the rest of the card stands down with the editor: the review window renders
  // the final post itself, so the preview pane, the thumbnails and the attachments'
  // drawer would each be the same note a second time.
  assert.match(body, /classList\.toggle\('is-reviewing', on\)/);
  const sheet = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const rule = sheet.slice(sheet.indexOf('.compose-sheet.is-reviewing'));
  assert.match(rule.slice(0, rule.indexOf('}')), /\.compose-preview[\s\S]*\.compose-thumbs[\s\S]*\.compose-media-note[\s\S]*display: none/,
    'one class stands the whole card down, drawer included');
});

test('THE METER HOLDS ITS WIDTH SO THE SAVE BUTTON HOLDS ITS', () => {
  // Save is the quietest thing in the row — a ghost at its natural width, pushed to
  // the end — so anything beside it that changes width changes the button. Nothing
  // does: the ring is a fixed 20px, the count beside it holds a fixed box of four
  // tabular digits in the stylesheet whether it says 2000 or 12, and neither grows
  // a word.
  // The last stretch of the cap turns amber with the ring; the count holds a fixed
  // box of four tabular digits in the stylesheet whether it says 2000 or 12.
  const rowStart = core.indexOf('function buildAltEditorRow');
  const row = core.slice(rowStart, core.indexOf('const POW_LEVELS', rowStart));
  assert.match(row, /\[ring, count, save\]/, 'the meter and the count are in the row from the start');
  assert.match(row, /stroke-dashoffset/, 'the fill is a dash offset');
  assert.match(row, /'ghost compose-alt-save'/, 'saving a description is not a primary act');
  assert.ok(!row.includes("' left'"), 'the count carries no word');
  const sheet = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const at = sheet.indexOf('.compose-alt-count {');
  assert.ok(at > -1, 'the count was never styled');
  assert.match(sheet.slice(at, at + 200), /min-width: 4ch/, 'the count holds a fixed box of digits');
});

test('THE ALT SAVES WITH THE DRAFT, THROUGH THE REAL HANDLERS', async () => {
  // The whole chain, driven through the page's own code: the editor row's onSave
  // exactly as compose.js wires it, into persistDraft exactly as compose.js writes
  // it, through the store's JSON round trip. The slot is shared with the panel, so
  // the one thing this cannot survive is a writer that rebuilds the media entries —
  // this is the tripwire for that.
  const onSaveBody = page.match(/onSave: \(value\) => \{[\s\S]*?\n      \},/);
  assert.ok(onSaveBody, 'could not find the tab onSave handler');
  const persistFn = page.match(/  async function persistDraft\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(persistFn, 'could not find the tab persistDraft');
  const saveIntoFn = page.match(/function saveAltInto\(slot, value\) \{[\s\S]*?\n    \}/);
  assert.ok(saveIntoFn, 'could not find the tab saveAltInto');

  // Minimal DOM: enough of an element for the row builder to build and for the Save
  // button to be found and clicked.
  function makeEl(tag) {
    const el = {
      tagName: String(tag).toUpperCase(), children: [], listeners: {},
      className: '', textContent: '', value: '', attrs: {}, parentNode: null,
      classList: {
        _s: new Set(),
        add(...c) { c.forEach((x) => this._s.add(x)); },
        remove(...c) { c.forEach((x) => this._s.delete(x)); },
        toggle(c, on) { (on === undefined ? !this._s.has(c) : on) ? this._s.add(c) : this._s.delete(c); },
        contains(c) { return this._s.has(c); },
      },
      append(...kids) { kids.forEach((k) => { k.parentNode = el; el.children.push(k); }); },
      after() {},
      remove() { el.parentNode = null; },
      addEventListener(t, fn) { (el.listeners[t] = el.listeners[t] || []).push(fn); },
      click() { (el.listeners.click || []).forEach((fn) => fn({})); },
      setAttribute(k, v) { el.attrs[k] = v; },
      querySelector(sel) { return sel === '.ring-fill' ? makeEl('circle') : makeEl('div'); },
      querySelectorAll() { return []; },
      focus() {},
      get isConnected() { return true; },
      set innerHTML(v) { el.children = []; if (v.includes('<svg')) el.firstElementChild = makeEl('svg'); },
      get innerHTML() { return ''; },
    };
    return el;
  }
  const ctx2 = { document: { createElement: makeEl, createElementNS: () => makeEl('svg') } };
  ctx2.window = ctx2;
  ctx2.requestAnimationFrame = () => {};
  vm.createContext(ctx2);
  vm.runInContext(core + '\n;globalThis.SC = window.SidecarCore;', ctx2);

  // The shared draft, and the handler body lifted verbatim out of compose.js.
  const draft = { text: 'a note', media: [{ url: 'https://x/a.png', isVideo: false }] };
  const store = {};
  const sandbox = {
    SC: ctx2.SC, draft, i: 0,
    closeAltEditor: () => {},
    renderThumbs: () => {},
    dkey: 'pk1',
    call: async (m) => {
      if (m.type === 'SIDECAR_SECRET_GET') return JSON.parse(JSON.stringify(store));
      if (m.type === 'SIDECAR_SECRET_SET') { store.pk1 = JSON.parse(JSON.stringify(m.value)).pk1; return true; }
      return null;
    },
  };
  vm.createContext(sandbox);
  const handlerSrc = onSaveBody[0].replace(/^onSave: /, '').replace(/,\s*$/, '');
  vm.runInContext(
    persistFn[0] + '\n' + saveIntoFn[0] +
    '\nfunction scheduleSave() { return persistDraft(); }' +
    '\nconst onSaveHandler = ' + handlerSrc + ';' +
    '\nglobalThis.saveTheAlt = (v) => onSaveHandler(v);' +
    // The autosave path: the row debounces half a second and calls onChange —
    // the same slot, no Save press, no close.
    '\nglobalThis.typeTheAlt = (v) => saveAltInto(0, v);',
    sandbox
  );

  // Type the description without ever pressing Save — the autosave path — then let
  // the write land.
  await vm.runInContext('typeTheAlt("a bowl of soup, typed")', sandbox);
  await new Promise((r) => setImmediate(r));
  assert.equal(
    JSON.parse(JSON.stringify(store.pk1)).media[0].alt,
    'a bowl of soup, typed',
    'typing alone never reached the store'
  );

  // Then the explicit commit: Save description, the way out.
  await vm.runInContext('saveTheAlt("a bowl of soup")', sandbox);
  await new Promise((r) => setImmediate(r));

  // What the store now holds is what a reopen gets.
  const restored = store.pk1;
  assert.ok(restored, 'the draft never landed in the store');
  assert.equal(restored.media[0].alt, 'a bowl of soup', 'the store lost the description');
  assert.equal(restored.text, 'a note', 'the prose is still there');

  // And the panel: its own onSave handler and its own saveComposeDraft, driven the
  // same way, because the slot is shared and either writer dropping the field is a
  // loss the other composer gets blamed for.
  const panelOnSave = panel.match(/onSave: \(value\) => \{[\s\S]*?\n          \},/);
  assert.ok(panelOnSave, 'could not find the panel onSave handler');
  const panelSave = panel.match(/  function saveComposeDraft\(key, draft\) \{[\s\S]*?\n  \}\n/);
  assert.ok(panelSave, 'could not find the panel saveComposeDraft');
  const panelSaveInto = panel.match(/function saveAltInto\(slot, value\) \{[\s\S]*?\n        \}/);
  assert.ok(panelSaveInto, 'could not find the panel saveAltInto');
  const draft2 = { text: 'another note', media: [{ url: 'https://x/b.png', isVideo: false }] };
  const store2 = {};
  const sandbox2 = {
    draft: draft2, i: 0,
    closeAltEditor: () => {},
    renderThumbs: () => {},
    normalizeAltBreaks, capAltText, ALT_MAX,
    pruneReplyDrafts: () => {}, REPLY_DRAFT_MAX: 20,
    call: async (m) => {
      if (m.type === 'SIDECAR_SECRET_GET') return JSON.parse(JSON.stringify(store2));
      if (m.type === 'SIDECAR_SECRET_SET') { store2.pk2 = JSON.parse(JSON.stringify(m.value)).pk2; return true; }
      return null;
    },
  };
  vm.createContext(sandbox2);
  const handler2 = panelOnSave[0].replace(/^onSave: /, '').replace(/,\s*$/, '');
  vm.runInContext(
    panelSave[0] + '\n' + panelSaveInto[0] +
    '\nfunction scheduleSave() { return saveComposeDraft("pk2", draft); }' +
    '\nconst onSaveHandler = ' + handler2 + ';' +
    '\nglobalThis.saveTheAlt = (v) => onSaveHandler(v);',
    sandbox2
  );
  await vm.runInContext('saveTheAlt("a bridge at dusk")', sandbox2);
  await new Promise((r) => setImmediate(r));
  assert.equal(store2.pk2.media[0].alt, 'a bridge at dusk', 'the panel lost the description');
});

test('THE ROW AUTOSAVES AS IT TYPES, AND EVERY EXIT COMMITS', () => {
  // The old row committed only on Save description, and the composer's own promise —
  // closing is safe, everything already saved — broke for exactly this field: typing
  // a description and walking away discarded it while the text beside it survived.
  // The input event schedules the save, and all three exits (Save, Escape, trash)
  // route through commit, which flushes any pending autosave before closing.
  // The old row committed only on Save description, and the composer's own promise —
  // closing is safe, everything already saved — broke for exactly this field: typing
  // a description and walking away discarded it while the text beside it survived.
  // The input event schedules the save, and all three exits (Save, Escape, trash)
  // route through commit, which flushes any pending autosave before closing.
  const rowStart = core.indexOf('function buildAltEditorRow');
  const row = core.slice(rowStart, core.indexOf('const POW_LEVELS', rowStart));
  assert.match(row, /field\.addEventListener\('input', \(\) => \{ paintMeter\(\); scheduleAutosave\(\); \}\);/,
    'typing never schedules the save');
  for (const exit of ["save.addEventListener('click', () => commit(field.value));",
    "rm.addEventListener('click', () => commit(''));",
    'commit(field.value);']) {
    assert.ok(row.includes(exit), 'an exit does not commit: ' + exit);
  }
  assert.ok(!row.includes('onCancel'), 'a way out that skips the commit is back');
  // AND THE PAGES CAN FLUSH ON THEIR OWN CLOSE PATHS: the row commits its three own
  // exits, but pages close it for theirs (chip toggle, review window, account move)
  // and a close that skips the flush drops the last half-second of typing. The one
  // exception is carved out explicitly: removal passes false, because the slot is
  // gone and flushing would write one image's words onto another.
  assert.match(row, /row\.flushPending = \(\) => \{/, 'the row never exposes its pending save');
  for (const [name, src] of [['sidepanel.js', panelBare], ['compose.js', pageBare]]) {
    assert.match(src, /function closeAltEditor\(flush\) \{/, name + ' cannot flush on close');
    assert.match(src, /if \(flush !== false && altRow\.flushPending\) altRow\.flushPending\(\);/, name + ' never calls the flush');
    assert.match(src, /closeAltEditor\(false\); \/\/ the row edits a media slot that no longer exists/,
      name + ' flushes into a spliced array');
    // Drag reorders flush BEFORE the splice, while the row's slot is still valid.
    const drag = src.slice(src.indexOf("closeAltEditor(); // flush first: the row's slot is still where it was opened"));
    assert.ok(drag.indexOf('closeAltEditor(); // flush first') < drag.indexOf('draft.media.splice(dragFrom, 1)'),
      name + ' flushes the row after moving its slot under it');
  }
  // The panel's Post press and the tab's account switch are the two closes whose
  // flush actually reaches a published note or a persisted draft.
  assert.match(panelBare, /closeAltEditor\(\); \/\/ the description commits before the note is snapshotted/);
  assert.match(pageBare, /closeAltEditor\(\); \/\/ the old account's draft takes the tail with it/,
    'the tab closes the row after the old draft was already persisted');
});

test('A URL PASTED ON ITS OWN IS AN ATTACHMENT WAITING TO BE OFFERED', () => {
  // The paste, not the editor, is what is judged: the whole paste has to be exactly
  // one image URL. Anything riding inside a larger chunk of text is prose and stays
  // prose. The offer stays up while the URL still stands as its own line — typing
  // the caption that goes with the picture must not lose the offer — and goes only
  // when the line does.
  assert.equal(loneImageUrl('https://example.com/pic.png'), 'https://example.com/pic.png');
  assert.equal(loneImageUrl('  https://example.com/pic.png  '), 'https://example.com/pic.png', 'paste edges are trim');
  assert.equal(loneImageUrl('https://example.com/PICT.PNG'), 'https://example.com/PICT.PNG', 'extensions are case-blind');
  assert.equal(loneImageUrl('https://example.com/pic.jpeg'), 'https://example.com/pic.jpeg');
  assert.equal(loneImageUrl('https://example.com/pic.webp?v=2'), 'https://example.com/pic.webp?v=2', 'a query rides along');
  assert.equal(loneImageUrl('https://example.com/pic'), null, 'no extension, no offer');
  assert.equal(loneImageUrl('look at https://example.com/pic.png'), null, 'prose stays prose');
  assert.equal(loneImageUrl('https://example.com/pic.png and text'), null);
  assert.equal(loneImageUrl('https://example.com/a.png\nhttps://example.com/b.png'), null, 'two URLs is a chunk');
  assert.equal(loneImageUrl('ftp://example.com/pic.png'), null, 'not a web URL');
  assert.equal(loneImageUrl('https://example.com/clip.mp4'), null, 'sidecar writes image alt text; video stays out of scope');
  assert.equal(loneImageUrl(''), null);
  assert.equal(loneImageUrl(null), null);
});

test('THE ATTACHMENT OFFER IS WIRED IN BOTH COMPOSERS, GUARDED IN THE THIRD', () => {
  // The offer exists where a draft can hold an attachment, and only there: the note
  // composers hand in the conversion, the page-comment box does not, and the core
  // stays silent without one. Accepting cuts the URL from the prose, puts it in the
  // strip, and saves — the same path an upload takes.
  assert.match(core, /const onAttachUrl = \(opts && opts\.onAttachUrl\) \|\| null;/);
  assert.match(core, /if \(!onAttachUrl\) return;/, 'an editor without a draft never offers');
  // And a no is possible: the ✕ dismisses for that url only, and the dismissal
  // expires when the line does, so a deliberate no is not a forever no.
  assert.match(core, /if \(!url \|\| attachDismissed\.has\(url\)\) return;/, 'a dismissed url re-offers');
  assert.match(core, /attachDismissed\.delete\(offeredUrl\);/, 'the dismissal never expires');
  assert.match(core, /'Keep it as text'/, 'the refusal is unnamed');
  assert.match(core, /const url = loneImageUrl\(e\.clipboardData && e\.clipboardData\.getData\('text\/plain'\)\);/);
  assert.match(core, /urlOnBoundary\(serializeEditor\(editor\)\.split\('\\n'\), url\)/, 'the paste must have landed on a line boundary');
  assert.match(core, /attachRow\.classList\.remove\('hidden'\)/);
  assert.match(core, /Attach this image/);
  // And it stays visible, in both senses: seated above the editor where the eye
  // starts, and still standing while the user types beside the pasted line.
  assert.match(core, /wrap\.prepend\(attachRow\)/, 'the offer sits below the fold');
  assert.match(core, /function refreshAttachOffer/, 'no re-check on input');
  assert.match(core, /refreshAttachOffer\(\);/, 'input never re-checks the offer');
  assert.match(core, /urlOnBoundary\(serializeEditor\(editor\)\.split\('\\n'\), offeredUrl\)/, 'the offer does not survive its line becoming a sentence');
  for (const [name, src] of [['sidepanel.js', panelBare], ['compose.js', pageBare]]) {
    assert.ok(src.includes('onAttachUrl: (url) => {'), name + ' never hands in the conversion');
    assert.match(src, /removeUrlFromEditor\(/, name + ' never cuts the URL from the prose');
    assert.match(src, /draft\.media\.push\(\{ url, isVideo: false \}\)/, name + ' never adds the attachment');
    assert.match(src, /\.sync\(\); \/\/ re-emit after the direct DOM cut/, name + ' never re-emits the prose');
  }
  // And the detection travels on the global with the rest of the write side, so the
  // vectors above ran against the code the pages actually load.
  assert.match(
    panel,
    /const \{ loneImageUrl, removeUrlFromEditor \} = window\.SidecarCore;/
  );
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
    /const \{ ALT_MAX, normalizeAltBreaks, capAltText, imetaTagsForMedia, buildAltEditorRow \} = window\.SidecarCore;/
  );
});

test('GLUED TO THE END OF A PARAGRAPH IS STILL A BOUNDARY', () => {
  // Pasting a picture after a block of text without pressing return glues the URL
  // to the last word. That is attach intent as much as a lone line is — the offer
  // stands whenever the URL sits at an END of a line, and stays silent only when
  // words sit on both sides of it (a URL inside a sentence stays in the sentence).
  const u = 'https://example.com/pic.png';
  assert.equal(urlOnBoundary([u], u), true, 'its own line');
  assert.equal(urlOnBoundary(['my note' + u], u), true, 'glued to the end, no space, no return');
  assert.equal(urlOnBoundary(['my note ' + u], u), true, 'after a space at the end of the line');
  assert.equal(urlOnBoundary([u + ' and then the caption'], u), true, 'glued to the start');
  assert.equal(urlOnBoundary(['look at ' + u + ' now'], u), false, 'words on both sides: a sentence');
  assert.equal(urlOnBoundary([u + u], u), false, 'twice on one line is ambiguous');
  assert.equal(urlOnBoundary(['no url here', '   '], u), false, 'nowhere on the page');
});

test('A THUMBNAIL THAT LOSES THE UPLOAD RACE IS RETRIED, THEN MARKED', () => {
  // The strip renders the instant an upload returns, and a host can still be writing
  // the file: an img tries exactly once, so losing that race left a blank cell that
  // stayed blank until something else repainted the strip. The URL is in the draft
  // either way and is appended at publish, so a silent blank is a note about to ship a
  // link nobody checked.
  const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(panel, /const THUMB_RETRIES = 2;/);
  assert.match(panel, /const THUMB_RETRY_MS = 600;/);
  assert.match(panel, /el\.addEventListener\('error', \(\) => \{/);
  assert.match(panel, /if \(tries >= THUMB_RETRIES\) \{/);
  assert.match(panel, /cell\.classList\.add\('is-broken'\);/);

  // THE RETRY QUERY GOES ON THE ELEMENT, NEVER ON THE DRAFT. A browser that cached the
  // 404 will not refetch the same URL, but m.url is the string that gets published and
  // has to stay exactly as the host gave it.
  assert.match(panel, /el\.src = m\.url \+ \(m\.url\.includes\('\?'\) \? '&' : '\?'\) \+ 'retry=' \+ tries;/);
  assert.doesNotMatch(panel, /m\.url = m\.url \+|m\.url \+= /, 'the retry query is written back into the draft');

  // Recovering clears the mark, or a thumbnail that loaded on the second try keeps a
  // warning about a problem it no longer has.
  //
  // The event is now chosen by media type: 'load' is an <img> event and a <video> never
  // fires it, so a video cell could not clear its broken state at all. Same property
  // under test, now true for both.
  assert.match(panel, /el\.addEventListener\(m\.isVideo \? 'loadedmetadata' : 'load', \(\) => \{\s*cell\.classList\.remove\('is-broken'\);/);

  // And a strip that repainted while a retry was pending does not write into a dead cell.
  assert.match(panel, /if \(!cell\.isConnected\) return;/);

  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(css, /\.compose-thumb\.is-broken \{[^}]*border: 1px dashed var\(--amber\)/s,
    'a failed thumbnail is indistinguishable from a loading one');
});
