'use strict';

// TAPPING QUOTE WITH A DRAFT ALREADY QUOTING SOMETHING. The draft kept its old quote and
// the note just tapped was dropped: Resume brought the old draft back without it, Start
// fresh threw the words away, a full-size composer counted the old quote as work in
// progress and ignored the tap, and an open composer tab said "already open" and nothing
// else. The only way through was the old quote's two-tap trash. placeQuote is the one rule
// all of those routes now share: an explicit Quote takes the quote slot, in place.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function loadCore() {
  const ctx = {
    console, setTimeout, clearTimeout, URL, TextEncoder, TextDecoder,
    navigator: { language: 'en' }, crypto: require('node:crypto').webcrypto,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: { lang: 'en', setAttribute() {}, dir: '' }, querySelectorAll: () => [] },
    chrome: { runtime: { getURL: (p) => p } },
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('nostr-tools.js'), ctx);
  vm.runInContext(read('i18n.js'), ctx);
  vm.runInContext(read('composer-core.js'), ctx);
  return ctx;
}
const core = loadCore();
const SC = core.SidecarCore;
const NT = core.NostrTools;
const plain = (x) => JSON.parse(JSON.stringify(x)); // across the vm's realm

const refA = 'nostr:' + NT.nip19.neventEncode({ id: 'a'.repeat(64), author: 'c'.repeat(64), relays: [] });
const refB = 'nostr:' + NT.nip19.neventEncode({ id: 'b'.repeat(64), author: 'c'.repeat(64), relays: [] });
const pic1 = { url: 'https://img.example/1.jpg' };
const pic2 = { url: 'https://img.example/2.jpg' };

test('a quote goes into a draft that has none, after the pictures', () => {
  const r = SC.placeQuote([pic1, pic2], { quote: refB });
  assert.equal(r.change, 'added');
  assert.deepEqual(plain(r.media), [pic1, pic2, { quote: refB }]);
});

test('a new quote replaces the old one in its place, and the pictures stay put', () => {
  // The quote moved above the pictures: the new one takes that spot, not the end.
  const r = SC.placeQuote([{ quote: refA }, pic1, pic2], { quote: refB });
  assert.equal(r.change, 'replaced');
  assert.deepEqual(plain(r.media), [{ quote: refB }, pic1, pic2]);
});

test('quoting the note the draft already quotes changes nothing', () => {
  const media = [pic1, { quote: refA }];
  const r = SC.placeQuote(media, { quote: refA });
  assert.equal(r.change, null);
  assert.deepEqual(plain(r.media), plain(media));
});

test('the draft it was given is not changed in place', () => {
  const media = [{ quote: refA }, pic1];
  SC.placeQuote(media, { quote: refB });
  assert.deepEqual(plain(media), [{ quote: refA }, pic1]);
});

test('anything that is not a quote entry changes nothing', () => {
  for (const bad of [null, undefined, {}, { quote: 42 }, pic1]) {
    const r = SC.placeQuote([pic1], bad);
    assert.equal(r.change, null);
    assert.deepEqual(plain(r.media), [pic1]);
  }
});

test('a paste still never replaces a quote: only the Quote button does', () => {
  assert.deepEqual(plain(SC.quoteEntriesFromPaste(refB, [{ quote: refA }])), []);
});

// ---- the composer tab, run --------------------------------------------------------------

function liftBraces(src, decl) {
  const at = src.indexOf(decl);
  assert.ok(at !== -1, decl + ' is gone');
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

function tab(draft, { busy = false, receipt = false } = {}) {
  const calls = { toast: [], saved: 0, thumbs: 0 };
  const ctx = {
    SC, draft, receiptShown: receipt,
    busy: () => busy,
    closeAltEditor() {}, paintCount() {}, showTab() {},
    scheduleSave: () => { calls.saved++; },
    renderThumbs: () => { calls.thumbs++; },
    toast: (m) => calls.toast.push(m),
    t: (s) => s,
  };
  vm.createContext(ctx);
  vm.runInContext(liftBraces(read('compose.js'), 'function takeQuote(') + ';globalThis.takeQuote = takeQuote;', ctx);
  return { ctx, calls };
}

test('the tab swaps its quote for the tapped note, keeps the words, and says so', () => {
  const draft = { text: 'my words', media: [pic1, { quote: refA }], poll: null };
  const { ctx, calls } = tab(draft);
  ctx.takeQuote(refB);
  assert.equal(draft.text, 'my words');
  assert.deepEqual(plain(draft.media), [pic1, { quote: refB }]);
  assert.equal(calls.saved, 1, 'saved');
  assert.equal(calls.thumbs, 1, 'the strip is redrawn');
  assert.deepEqual(calls.toast, ['Your draft now quotes this note.']);
});

test('the tab adds a quote to a draft without one, without a toast', () => {
  const draft = { text: '', media: [pic1], poll: null };
  const { ctx, calls } = tab(draft);
  ctx.takeQuote(refB);
  assert.deepEqual(plain(draft.media), [pic1, { quote: refB }]);
  assert.deepEqual(calls.toast, []);
});

test('the tab takes nothing while posting, onto a receipt, into a poll, or that is not a reference', () => {
  for (const [opts, draft, ref] of [
    [{ busy: true }, { text: '', media: [{ quote: refA }], poll: null }, refB],
    [{ receipt: true }, { text: '', media: [{ quote: refA }], poll: null }, refB],
    [{}, { text: '', media: [], poll: { options: ['a', 'b'] } }, refB],
    [{}, { text: '', media: [{ quote: refA }], poll: null }, 'https://evil.example'],
    [{}, { text: '', media: [{ quote: refA }], poll: null }, refA + ' ' + refB],
  ]) {
    const before = plain(draft.media);
    const { ctx, calls } = tab(draft, opts);
    ctx.takeQuote(ref);
    assert.deepEqual(plain(draft.media), before);
    assert.equal(calls.saved, 0);
  }
});

// ---- the wiring -------------------------------------------------------------------------

test('the tab listens for Sidecar’s own pages only, never a web page', () => {
  const src = read('compose.js');
  const at = src.indexOf("msg.type === 'SIDECAR_COMPOSE_QUOTE'");
  assert.ok(at > -1);
  const guard = src.slice(at, at + 260);
  assert.match(guard, /sender\.id !== chrome\.runtime\.id/);
  assert.match(guard, /startsWith\(chrome\.runtime\.getURL\(''\)\)\) return;/);
});

test('every panel route hands a tapped quote on: resume, the busy slot, and the open tab', () => {
  const src = read('sidepanel.js');
  const resume = liftBraces(src, 'function resumeFrom(');
  assert.match(resume, /placeQuote\(draft\.media, arriving\)/);
  assert.match(src, /slotBusy && !slot\.poll\)[\s\S]{0,400}placeQuote\(slot\.media, quote\)/);
  assert.match(src, /type: 'SIDECAR_COMPOSE_QUOTE', ref: quote\.quote/);
  assert.match(liftBraces(src, 'function showDraftChooser('), /Resume keeps your draft and quotes this note instead\./);
});

// ---- the panel's Resume, run ------------------------------------------------------------

function panelResume(initialText, saved) {
  const src = read('sidepanel.js');
  const ctx = {
    initialText, opts: {}, replyTo: null, draft: null, powForThisPost: null,
    quoteEntriesFromPaste: SC.quoteEntriesFromPaste, placeQuote: SC.placeQuote,
    stripDraftMediaUrls: SC.stripDraftMediaUrls, showEditor() {},
  };
  vm.createContext(ctx);
  vm.runInContext([
    liftBraces(src, 'function seedFrom('), liftBraces(src, 'function quoteFrom('),
    liftBraces(src, 'function resumeFrom('),
    'resumeFrom(' + JSON.stringify(saved) + '); globalThis.out = draft;',
  ].join('\n'), ctx);
  return plain(ctx.out);
}

test('Resume after tapping Quote keeps the words and pictures and swaps in the new quote', () => {
  const d = panelResume('\n\n' + refB, { text: 'my words', media: [{ quote: refA }, pic1] });
  assert.equal(d.text, 'my words');
  assert.deepEqual(d.media, [{ quote: refB }, pic1]);
});

test('Resume after tapping Quote on a draft with no quote adds it', () => {
  const d = panelResume('\n\n' + refB, { text: 'my words', media: [pic1] });
  assert.deepEqual(d.media, [pic1, { quote: refB }]);
});

test('Resume from Saved drafts, or with a text prefill, leaves the draft as it was', () => {
  assert.deepEqual(panelResume('', { text: 'x', media: [{ quote: refA }] }).media, [{ quote: refA }]);
  assert.deepEqual(panelResume('Just setting up', { text: 'x', media: [{ quote: refA }] }).media, [{ quote: refA }]);
});

test('Resume into a poll draft adds no quote', () => {
  const d = panelResume('\n\n' + refB, { text: '', media: [], poll: { options: ['a', 'b'] } });
  assert.deepEqual(d.media, []);
});
