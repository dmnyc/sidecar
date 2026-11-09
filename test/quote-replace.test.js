'use strict';

// TAPPING QUOTE WITH A DRAFT IN PROGRESS. The note just tapped was dropped: Resume brought
// the old draft back without it, Start fresh threw the words away, a full-size composer
// counted the draft as work in progress and ignored the tap, and an open composer tab said
// "already open" and nothing else. Now the quote always opens in a fresh note, and a draft
// with anything of its own in it is set aside under Saved drafts (shelveNoteDraft), since
// the note being written may have nothing to do with the one just chosen. A draft holding
// nothing but an older quote is re-pointed instead (placeQuote): there is nothing to keep.

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

// ---- setting a note aside ------------------------------------------------------------

const PK = 'f'.repeat(64);

test('a draft has work of its own when it has words, a picture, or a typed poll option', () => {
  assert.equal(SC.draftHasWork({ text: 'hi', media: [] }), true);
  assert.equal(SC.draftHasWork({ text: '', media: [pic1] }), true);
  assert.equal(SC.draftHasWork({ text: '', media: [], poll: { options: ['Tea', ''] } }), true);
  // Nothing to lose: an older quote alone, blank space, an untouched poll, nothing.
  assert.equal(SC.draftHasWork({ text: '  ', media: [{ quote: refA }] }), false);
  assert.equal(SC.draftHasWork({ text: '', media: [], poll: { options: ['', ''] } }), false);
  assert.equal(SC.draftHasWork(null), false);
});

test('setting the note aside moves it to its own slot and empties the note slot', () => {
  const all = { [PK]: { text: 'my words', media: [{ quote: refA }], expandRelays: ['wss://r.example'], savedAt: 1 } };
  const key = SC.shelveNoteDraft(all, PK, 5000);
  assert.equal(key, PK + '|n:5000');
  assert.equal(all[PK], undefined);
  assert.deepEqual(plain(all[key]), { text: 'my words', media: [{ quote: refA }], savedAt: 5000 });
});

test('two set aside in the same millisecond do not write over each other', () => {
  const all = { [PK + '|n:5000']: { text: 'first', savedAt: 5000 }, [PK]: { text: 'second' } };
  assert.equal(SC.shelveNoteDraft(all, PK, 5000), PK + '|n:5001');
  assert.equal(all[PK + '|n:5000'].text, 'first');
});

test('an empty note slot keeps nothing', () => {
  const all = { [PK]: { text: '', media: [] } };
  assert.equal(SC.shelveNoteDraft(all, PK, 5000), null);
  assert.deepEqual(Object.keys(all), []);
});

test('only the newest notes set aside are kept, and replies are not touched', () => {
  const all = { [PK + '|r:' + 'a'.repeat(64)]: { text: 'a reply', savedAt: 1 } };
  for (let i = 0; i < SC.SHELVED_NOTE_MAX; i++) all[PK + '|n:' + i] = { text: 'n' + i, savedAt: 100 + i };
  all[PK] = { text: 'newest' };
  SC.shelveNoteDraft(all, PK, 9999);
  const shelf = Object.keys(all).filter((k) => k.includes('|n:'));
  assert.equal(shelf.length, SC.SHELVED_NOTE_MAX);
  assert.equal(all[PK + '|n:0'], undefined, 'the oldest was kept');
  assert.equal(all[PK + '|n:9999'].text, 'newest');
  assert.ok(all[PK + '|r:' + 'a'.repeat(64)], 'a reply was pruned');
});

test('picking a note set aside swaps it with the note slot, so neither is lost', () => {
  const all = { [PK]: { text: 'current' }, [PK + '|n:10']: { text: 'older', savedAt: 10 } };
  assert.equal(SC.unshelveNoteDraft(all, PK, PK + '|n:10', 7000), true);
  assert.equal(all[PK].text, 'older');
  assert.equal(all[PK + '|n:10'], undefined);
  assert.equal(all[PK + '|n:7000'].text, 'current');
});

test('picking anything but a note set aside changes nothing', () => {
  const all = { [PK]: { text: 'current' }, [PK + '|r:' + 'a'.repeat(64)]: { text: 'r' } };
  const before = plain(all);
  for (const k of [PK, PK + '|r:' + 'a'.repeat(64), PK + '|n:404', 'x'.repeat(64) + '|n:1', null]) {
    assert.equal(SC.unshelveNoteDraft(all, PK, k, 1), false);
  }
  assert.deepEqual(plain(all), before);
});

test('Saved drafts lists notes set aside with the notes, before the replies', () => {
  const all = {
    [PK]: { text: 'note', savedAt: 5 },
    [PK + '|n:9']: { text: 'set aside', savedAt: 9 },
    [PK + '|r:' + 'a'.repeat(64)]: { text: 'reply', savedAt: 20 },
    ['e'.repeat(64) + '|n:1']: { text: 'another account', savedAt: 30 },
  };
  const got = plain(SC.otherDraftEntries(all, PK, 'none'));
  assert.deepEqual(got.map((e) => e.key), [PK + '|n:9', PK, PK + '|r:' + 'a'.repeat(64)]);
  assert.deepEqual(got.map((e) => [e.shelved, e.reply, e.replyId]),
    [[true, false, null], [false, false, null], [false, true, 'a'.repeat(64)]]);
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

function tab(draft, store, { busy = false, receipt = false, replyId = null } = {}) {
  const calls = { toast: [], saved: 0, thumbs: 0, reopened: 0, flushed: 0, written: null };
  const ctx = {
    SC, draft, receiptShown: receipt, replyId, dkey: PK, pollEditor: null,
    busy: () => busy,
    closeAltEditor() {}, paintCount() {}, showTab() {},
    scheduleSave: () => { calls.saved++; },
    renderThumbs: () => { calls.thumbs++; },
    flushDraft: async () => { calls.flushed++; },
    readAllDrafts: async () => JSON.parse(JSON.stringify(store)),
    call: async (msg) => { calls.written = msg.value; },
    reopenDraft: async () => { calls.reopened++; },
    toast: (m) => calls.toast.push(m),
    t: (s) => s,
  };
  vm.createContext(ctx);
  vm.runInContext(liftBraces(read('compose.js'), 'async function takeQuote(') + ';globalThis.takeQuote = takeQuote;', ctx);
  return { ctx, calls };
}

test('the tab sets the note in progress aside and opens the tapped quote in a fresh one', async () => {
  const draft = { text: 'my words', media: [pic1, { quote: refA }], poll: null };
  const { ctx, calls } = tab(draft, { [PK]: { text: 'my words', media: [pic1, { quote: refA }] } });
  await ctx.takeQuote(refB);
  assert.equal(calls.flushed, 1, 'the words on screen were not saved first');
  const w = plain(calls.written);
  const shelved = Object.keys(w).filter((k) => k.startsWith(PK + '|n:'));
  assert.equal(shelved.length, 1);
  assert.equal(w[shelved[0]].text, 'my words');
  assert.deepEqual(w[shelved[0]].media, [pic1, { quote: refA }]);
  assert.equal(w[PK].text, '');
  assert.deepEqual(w[PK].media, [{ quote: refB }]);
  assert.equal(calls.reopened, 1, 'the editor was not reloaded from the fresh slot');
  assert.deepEqual(calls.toast, ['Your draft is in Saved drafts.']);
});

test('the tab re-points a draft holding only an older quote, with nothing set aside', async () => {
  const draft = { text: '', media: [{ quote: refA }], poll: null };
  const { ctx, calls } = tab(draft, {});
  await ctx.takeQuote(refB);
  assert.deepEqual(plain(draft.media), [{ quote: refB }]);
  assert.equal(calls.written, null);
  assert.equal(calls.saved, 1);
  assert.deepEqual(calls.toast, []);
});

test('the tab takes nothing while posting, onto a receipt, into a reply, or that is not a reference', async () => {
  for (const [opts, ref] of [
    [{ busy: true }, refB], [{ receipt: true }, refB], [{ replyId: 'a'.repeat(64) }, refB],
    [{}, 'https://evil.example'], [{}, refA + ' ' + refB],
  ]) {
    const draft = { text: 'words', media: [{ quote: refA }], poll: null };
    const { ctx, calls } = tab(draft, { [PK]: { text: 'words' } }, opts);
    await ctx.takeQuote(ref);
    assert.deepEqual(plain(draft.media), [{ quote: refA }]);
    assert.equal(calls.written, null);
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

test('every panel route sets the note aside: the panel composer, the tab slot, and the open tab', () => {
  const src = read('sidepanel.js');
  assert.match(src, /hasSaved && !replyTo && quoteFrom\(initialText\)\)[\s\S]{0,200}draftHasWork\(saved\)[\s\S]{0,200}shelveNoteDraft\(all, dkey, Date\.now\(\)\)/);
  assert.match(src, /quote && !\(opts && opts\.replyTo\)\)[\s\S]{0,200}draftHasWork\(slot\) \? shelveNoteDraft\(all, dk, Date\.now\(\)\)/);
  assert.match(src, /type: 'SIDECAR_COMPOSE_QUOTE', ref: quote\.quote/);
  // Gone with the chooser's quote line: Resume no longer changes the draft.
  assert.doesNotMatch(liftBraces(src, 'function resumeFrom('), /placeQuote|quoteFrom/);
});

test('a note set aside comes back through the note slot, in both composers', () => {
  const panel = liftBraces(read('sidepanel.js'), 'async function switchToSavedDraft(');
  assert.match(panel, /if \(entry\.shelved\)[\s\S]{0,200}unshelveNoteDraft\(all, pubkey, entry\.key, Date\.now\(\)\)/);
  const page = read('compose.js');
  assert.match(page, /onPick: \(entry\) => \(entry\.shelved \? unshelve\(entry\.key\) : switchToDraft\(entry\.replyId\)\)/);
  assert.match(liftBraces(page, 'async function unshelve('), /SC\.unshelveNoteDraft\(all, state\.activePubkey, key, Date\.now\(\)\)/);
});

test('notes set aside belong to whichever composer has the note open', () => {
  assert.match(read('sidepanel.js'), /!\(e\.shelved && tabKey === pubkey\)/);
  assert.match(read('compose.js'), /!\(e\.shelved && inPanel === state\.activePubkey\)/);
});

// ---- the tab's Saved drafts list, run ----------------------------------------------------

test('the tab puts the open draft’s strip, drawer and dev fields away while Saved drafts is up', () => {
  const els = {};
  const el = (id) => els[id] || (els[id] = {
    id, style: {}, offsetHeight: 200, _c: new Set(['hidden'].filter(() => id === 'compose-drafts-pane')),
    classList: {
      toggle(c, on) { const s = els[id]._c; if (on === undefined) on = !s.has(c); on ? s.add(c) : s.delete(c); },
      contains(c) { return els[id]._c.has(c); },
    },
    addEventListener() {}, prepend() {}, append() {},
  });
  const drawer = el('drawer');
  const calls = { alt: 0, gif: 0 };
  const ctx = {
    $: el, mediaDrawer: { wrap: drawer }, emojiBtn: null, SC: { emojiGroups: () => [], composeNoteContent: () => '' },
    closeGifPicker: () => { calls.gif++; }, closeAltEditor: () => { calls.alt++; }, closeEmojiPicker() {},
    paintSavedDrafts() {}, busy: () => false, icon: () => ({}), h: () => ({}), t: (s) => s,
    draft: { text: '', media: [] }, composer: {},
  };
  vm.createContext(ctx);
  vm.runInContext('let showTab, paintPreview;\n' + liftBraces(read('compose.js'), 'function buildTabs(')
    + '\nbuildTabs(); globalThis.show = showTab;', ctx);
  const away = () => ['compose-thumbs', 'drawer', 'compose-dev'].map((id) => el(id).classList.contains('drafts-away'));
  ctx.show('drafts');
  assert.deepEqual(away(), [true, true, true]);
  assert.equal(calls.alt, 1, 'the ALT row was left open over the list');
  ctx.show('write');
  assert.deepEqual(away(), [false, false, false]);
  ctx.show('preview');
  assert.deepEqual(away(), [false, false, false], 'Preview still shows the strip');
  assert.match(read('styles.css'), /\.drafts-away \{ display: none !important; \}/);
});
