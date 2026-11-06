'use strict';

// WHERE A POST'S ATTACHMENTS SIT. A quote draft ends on a nostr: reference and the attachments
// were appended after it, which some clients draw below the quoted card. The strip holds the
// quote as a block too, and the strip's order is the post's order.
//
// Everything here runs the real composer-core.js, loaded the way a page loads it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function loadCore(extra = {}) {
  const ctx = {
    console, setTimeout, clearTimeout, URL, TextEncoder, TextDecoder,
    navigator: { language: 'en' }, crypto: require('node:crypto').webcrypto,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: { lang: 'en', setAttribute() {}, dir: '' }, querySelectorAll: () => [] },
    chrome: { runtime: { getURL: (p) => p } },
    ...extra,
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

const nevent = 'nostr:' + NT.nip19.neventEncode({ id: 'd'.repeat(64), author: 'c'.repeat(64), relays: [] });
const nevent2 = 'nostr:' + NT.nip19.neventEncode({ id: 'e'.repeat(64), author: 'c'.repeat(64), relays: [] });
const npub = 'nostr:' + NT.nip19.npubEncode('b'.repeat(64));
const A = 'https://x.example/a.jpg';
const B = 'https://x.example/b.jpg';
const media = [{ url: A }, { url: B }];
// Arrays made inside the vm are another realm's; compare them as plain data.
const plain = (x) => JSON.parse(JSON.stringify(x));
const tagsFor = (m, o) => plain(SC.imetaTagsForMedia(m, o));

// ---- the strip is the order of the post ----

const q1 = { quote: nevent };
const q2 = { quote: nevent2 };

test('pictures only: the words, a blank line, one URL per line (nothing changed)', () => {
  assert.equal(SC.composeNoteContent('look at this', media), 'look at this\n\n' + A + '\n' + B);
  assert.equal(SC.composeNoteContent('', media), A + '\n' + B);
  assert.equal(SC.composeNoteContent('just words', []), 'just words');
});

test('a quote card after the pictures puts the pictures ahead of the quote', () => {
  assert.equal(SC.composeNoteContent('look at this', [...media, q1]), 'look at this\n\n' + A + '\n' + B + '\n\n' + nevent);
});

test('the same cards in the other order put the quote first', () => {
  assert.equal(SC.composeNoteContent('look at this', [q1, ...media]), 'look at this\n\n' + nevent + '\n\n' + A + '\n' + B);
});

test('a quote with no words and no pictures is a postable note', () => {
  assert.equal(SC.composeNoteContent('', [q1]), nevent);
});

test('a quote moved into the strip keeps its tags: the tag text includes the strip\'s quotes', () => {
  const body = SC.noteBodyTags(SC.proseWithQuotes('look at this', [{ url: A }, q1]), NT, []);
  const q = plain(body.q);
  assert.equal(q.length, 1, 'one q tag');
  assert.equal(q[0][0], 'q');
  assert.equal(q[0][1], 'd'.repeat(64));
  assert.deepEqual(plain(body.p).map((t) => t[1]), ['c'.repeat(64)], 'the quoted author is p-tagged');
  // And a quote that stayed in the words is tagged by the words, once.
  const staying = SC.noteBodyTags(SC.proseWithQuotes('look\n\n' + nevent, [{ url: A }]), NT, []);
  assert.equal(plain(staying.q).length, 1);
});

test('a quote in the words AND the same one as a card is tagged once', () => {
  const both = SC.noteBodyTags(SC.proseWithQuotes('look\n\n' + nevent, [q1]), NT, []);
  assert.equal(plain(both.q).length, 1, 'no duplicate q tag');
});

test('a quote card describes no file: it makes no imeta tag', () => {
  assert.deepEqual(tagsFor([{ url: A, alt: 'a cat' }, q1]), [['imeta', 'url ' + A, 'alt a cat']]);
});

test('the trailing quote is found by whole lines at the end', () => {
  assert.deepEqual(plain(SC.splitTrailingQuote('a\nb\n\n' + nevent + '\n')), { head: 'a\nb', tail: nevent });
  assert.deepEqual(plain(SC.splitTrailingQuote(nevent)), { head: '', tail: nevent });
  assert.deepEqual(plain(SC.splitTrailingQuote('a ' + nevent)), { head: 'a ' + nevent, tail: '' });
});

test('taking the trailing quote leaves the words and returns the one card', () => {
  assert.deepEqual(plain(SC.takeTrailingQuote('look at this\n\n' + nevent, [])), { head: 'look at this', quotes: [{ quote: nevent }] });
  // A bare reference, as pasted, is stored in its nostr: form, which is what publishes.
  const bare = nevent.slice('nostr:'.length);
  assert.deepEqual(plain(SC.takeTrailingQuote('hm\n' + bare, [])), { head: 'hm', quotes: [{ quote: nevent }] });
  // The same note written twice is one note.
  assert.deepEqual(plain(SC.takeTrailingQuote('x\n' + nevent + '\n' + nevent, [])).quotes, [{ quote: nevent }]);
});

test('ONE NOTE ONLY: two different notes, or a second quote, are never offered', () => {
  const two = 'both\n\n' + nevent + '\n' + nevent2;
  assert.deepEqual(plain(SC.takeTrailingQuote(two, [])), { head: two, quotes: [] }, 'two notes in the tail stay text');
  const one = 'x\n\n' + nevent;
  assert.deepEqual(plain(SC.takeTrailingQuote(one, [q2])), { head: one, quotes: [] }, 'the strip already holds a quote');
  assert.deepEqual(plain(SC.quoteEntriesFromPaste(nevent2, [q1])), [], 'a second paste does not replace the first');
  assert.deepEqual(plain(SC.quoteEntriesFromPaste(nevent + ' ' + nevent2, [])), [], 'a paste never picks between two notes');
});

test('only a quote that ENDS the post is offered to the strip', () => {
  const none = (text, label) => assert.deepEqual(plain(SC.takeTrailingQuote(text, [])), { head: text, quotes: [] }, label);
  none('quote first, then words\n\n' + nevent + '\n\nand my reply', 'text under the quote');
  none('inline ' + nevent + ' in a sentence', 'a reference on a line of prose');
  none('hello ' + npub, 'a mention is not a quote');
  none('just words', 'no quote at all');
  none('', 'nothing');
});

test('a paste of one note reference is recognized as the quote', () => {
  const bare = nevent.slice('nostr:'.length);
  const note1 = NT.nip19.noteEncode('f'.repeat(64));
  const naddr = NT.nip19.naddrEncode({ kind: 30023, pubkey: 'c'.repeat(64), identifier: 'post', relays: [] });
  assert.deepEqual(plain(SC.quoteEntriesFromPaste(nevent, [])), [{ quote: nevent }]);
  assert.deepEqual(plain(SC.quoteEntriesFromPaste('  ' + bare + '\n', [])), [{ quote: nevent }], 'bare, with stray whitespace');
  assert.deepEqual(plain(SC.quoteEntriesFromPaste(note1, [])), [{ quote: 'nostr:' + note1 }]);
  assert.deepEqual(plain(SC.quoteEntriesFromPaste('nostr:' + naddr, [])), [{ quote: 'nostr:' + naddr }]);
  assert.deepEqual(plain(SC.quoteEntriesFromPaste(nevent + '\n' + nevent, [])), [{ quote: nevent }], 'the same note twice is one');
});

test('anything else pasted stays text', () => {
  for (const text of ['', '   ', 'hello', 'look ' + nevent, nevent + ' is great', npub, 'https://x.example/a.jpg', 'nostr:nevent1notbech32!', nevent + 'x!']) {
    assert.deepEqual(plain(SC.quoteEntriesFromPaste(text, [])), [], JSON.stringify(text));
  }
});

// ---- two blocks: the pictures, and the note, pinned at one end ----

const I1 = { url: A }, I2 = { url: B }, I3 = { url: 'https://x.example/c.jpg' };
const order = (list) => list.map((m) => (m.quote ? 'Q' : m.url === A ? 'a' : m.url === B ? 'b' : 'c')).join('');

test('the note goes to the front or the back, past all the pictures at once', () => {
  assert.equal(order(SC.moveQuoteEntry([I1, I2, q1], 2, -1)), 'Qab');
  assert.equal(order(SC.moveQuoteEntry([q1, I1, I2], 0, 1)), 'abQ');
  assert.equal(order(SC.moveQuoteEntry([I1, q1], 1, -1)), 'Qa');
  // Nowhere to go: unchanged.
  assert.equal(order(SC.moveQuoteEntry([q1, I1], 0, -1)), 'Qa');
  assert.equal(order(SC.moveQuoteEntry([I1, q1], 1, 1)), 'aQ');
  assert.equal(order(SC.moveQuoteEntry([q1], 0, -1)), 'Q');
  // Only the note moves this way.
  assert.equal(order(SC.moveQuoteEntry([I1, I2], 0, 1)), 'ab');
});

test('pictures reorder among themselves and never past the note', () => {
  assert.equal(order(SC.movePicture([I1, I2, I3, q1], 0, 2)), 'bcaQ', 'the note stays last');
  assert.equal(order(SC.movePicture([q1, I1, I2, I3], 3, 1)), 'Qcab', 'the note stays first');
  assert.equal(order(SC.movePicture([I1, I2, I3], 2, 0)), 'cab', 'no note: plain reorder');
  assert.equal(order(SC.movePicture([I1, I2, q1], 0, 2)), 'abQ', 'dropping onto the note moves nothing');
  assert.equal(order(SC.movePicture([I1, I2, q1], 2, 0)), 'abQ', 'dragging the note moves nothing');
});

test('a picture offers a step only toward another picture', () => {
  const can = (list, i, d) => SC.canMovePicture(list, i, d);
  assert.equal(can([I1, I2, q1], 1, 1), false, 'the next slot is the note');
  assert.equal(can([I1, I2, q1], 1, -1), true);
  assert.equal(can([q1, I1, I2], 1, -1), false, 'the previous slot is the note');
  assert.equal(can([I1, I2], 0, -1), false, 'the end');
  assert.equal(can([I1, q1], 0, 1), false, 'a lone picture beside a note has nothing to step past');
  assert.equal(SC.pictureCount([I1, q1, I2]), 2);
});

test('a new attachment lands among the pictures, on the pictures side of the note', () => {
  const run = (list) => { SC.addMedia(list, I3); return order(list); };
  assert.equal(run([I1, q1]), 'acQ', 'the note is last: the picture goes in ahead of it');
  assert.equal(run([q1, I1]), 'Qac', 'the note is first: the picture goes at the end');
  assert.equal(run([q1]), 'cQ', 'a lone note: the pictures-then-note order that was already chosen');
  assert.equal(run([I1]), 'ac');
  assert.equal(run([]), 'c');
});

test('a draft saved with a quote card round-trips and fingerprints on it', async () => {
  const draft = { text: 'x', media: [{ url: A }, q1] };
  const restored = JSON.parse(JSON.stringify(draft));
  assert.equal(SC.composeNoteContent(restored.text, restored.media), SC.composeNoteContent(draft.text, draft.media));
  // Stripping a saved draft's URLs leaves its quote card alone.
  assert.equal(SC.stripDraftMediaUrls('x', restored.media), 'x');
  const withQuote = await SC.postFingerprint('p', draft);
  const without = await SC.postFingerprint('p', { text: 'x', media: [{ url: A }] });
  assert.notEqual(withQuote, without, 'a quote card is part of what makes a post the same post');
});
