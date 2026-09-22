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
  lift(/function composeNoteContent\(text, media\) \{[\s\S]*?\n  \}/, 'composeNoteContent') + '\n' +
  lift(/function stripDraftMediaUrls\(text, media\) \{[\s\S]*?\n  \}/, 'stripDraftMediaUrls') + '\n' +
  'globalThis.ALT_MAX = ALT_MAX;' +
  'globalThis.normalizeAltBreaks = normalizeAltBreaks;' +
  'globalThis.buildImetaTag = buildImetaTag;' +
  'globalThis.imetaTagsForMedia = imetaTagsForMedia;' +
  'globalThis.composeNoteContent = composeNoteContent;' +
  'globalThis.stripDraftMediaUrls = stripDraftMediaUrls;',
  ctx
);
const { ALT_MAX, normalizeAltBreaks, buildImetaTag, imetaTagsForMedia, composeNoteContent, stripDraftMediaUrls } = ctx;

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
  // same URLs the media slot holds. Stripped on restore, idempotent on drafts saved
  // since, and only a line matching an attachment's OWN url is taken out.
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
    // The panel repaints at three sites (file upload, paste upload, removal); the
    // tab has no image-paste path, so two.
    assert.match(src, /draft\.media\.push\(/, name + ' lost the upload push');
    const taps = name === 'sidepanel.js'
      ? src.match(/scheduleSave\(\);\n\s*updatePostState\(\);\n\s*renderThumbs\(\);/g) || []
      : src.match(/scheduleSave\(\);\n\s*paintCount\(\);\n\s*renderThumbs\(\);/g) || [];
    const want = name === 'sidepanel.js' ? 3 : 2;
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
  const row = core.slice(core.indexOf('function buildAltEditorRow'));
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
    persistFn[0] +
    '\nfunction scheduleSave() { return persistDraft(); }' +
    '\nconst onSaveHandler = ' + handlerSrc + ';' +
    '\nglobalThis.saveTheAlt = (v) => onSaveHandler(v);',
    sandbox
  );

  // Type the description, press Save description, let the write land.
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
  const draft2 = { text: 'another note', media: [{ url: 'https://x/b.png', isVideo: false }] };
  const store2 = {};
  const sandbox2 = {
    draft: draft2, i: 0,
    closeAltEditor: () => {},
    renderThumbs: () => {},
    normalizeAltBreaks, ALT_MAX,
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
    panelSave[0] +
    '\nfunction scheduleSave() { return saveComposeDraft("pk2", draft); }' +
    '\nconst onSaveHandler = ' + handler2 + ';' +
    '\nglobalThis.saveTheAlt = (v) => onSaveHandler(v);',
    sandbox2
  );
  await vm.runInContext('saveTheAlt("a bridge at dusk")', sandbox2);
  await new Promise((r) => setImmediate(r));
  assert.equal(store2.pk2.media[0].alt, 'a bridge at dusk', 'the panel lost the description');
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
