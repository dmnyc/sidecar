'use strict';

// Unit coverage for the text side of the nested quote preview in sidepanel.js
// (renderNoteText → resolveQuotePreviews): quoteSnippet and firstQuoteImage.
// The whole point of the snippet is what it DOESN'T include — a 63-char nevent,
// a bare URL, or a several-hundred-char BOLT11 invoice would each eat the entire
// two-line clamp. Invoices are stripped outright, not marked inline: the caller
// (resolveQuotePreviews) renders a "⚡ invoice" caption BELOW the thumbnail, so
// the marker must not also appear in the prose. firstQuoteImage picks the
// thumbnail: a quoted zap receipt is often an image + invoice with no prose.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  // The REAL IMG_EXT, lifted — a local mirror could drift from sidepanel.js and
  // the tests would keep passing against the wrong regex.
  lift(/const IMG_EXT = [^;]+;/, 'IMG_EXT') + '\n' +
  lift(/function quoteSnippet\(text\) \{[\s\S]*?\n  \}/, 'quoteSnippet') + '\n' +
  lift(/function firstQuoteImage\(text\) \{[\s\S]*?\n  \}/, 'firstQuoteImage') + '\n' +
  'globalThis.quoteSnippet = quoteSnippet;' +
  'globalThis.firstQuoteImage = firstQuoteImage;',
  ctx
);

// ---- quoteSnippet ------------------------------------------------------------

test('plain text passes through untouched', () => {
  assert.equal(ctx.quoteSnippet('just words'), 'just words');
});

test('nostr entity refs are stripped, with or without the nostr: prefix', () => {
  const nevent = 'nevent1' + 'q'.repeat(60);
  const npub = 'npub1' + '0'.repeat(58);
  assert.equal(ctx.quoteSnippet('hello nostr:' + nevent + ' world'), 'hello world');
  assert.equal(ctx.quoteSnippet('see ' + npub + ' there'), 'see there');
});

test('BOLT11 invoices are stripped entirely — the caption is the caller\'s job', () => {
  const invoice = 'lnbc100u1p4gr5w4pp535270wj65pvw0p650h5ph262eklrax9tss8qd4me9pcrgymj4pus';
  assert.equal(ctx.quoteSnippet('ping ' + invoice), 'ping');
  // Testnet variant too, and an invoice-only note leaves nothing in the prose.
  assert.equal(ctx.quoteSnippet('lntb100u1' + 'q'.repeat(80)), '');
});

test('bare URLs are stripped too — a long link would eat the whole clamp', () => {
  assert.equal(ctx.quoteSnippet('look https://example.com/a/very/long/path here'), 'look here');
});

test('whitespace is collapsed to single spaces', () => {
  assert.equal(ctx.quoteSnippet('a\n\n  b\t\tc'), 'a b c');
});

test('over-140-char text is hard-capped with an ellipsis', () => {
  const out = ctx.quoteSnippet('x'.repeat(200));
  assert.equal(out.length, 141); // 140 + the ellipsis
  assert.ok(out.endsWith('…'));
});

test('nothing readable left returns empty string — the caller picks the placeholder', () => {
  assert.equal(ctx.quoteSnippet('nostr:nevent1' + 'q'.repeat(60)), '');
  assert.equal(ctx.quoteSnippet('https://blossom.example.com/x.jpg'), '');
  // Image + invoice with no prose: both stripped, '' back — the caller shows
  // the thumbnail and the ⚡ caption, so '(no text)' must not appear.
  assert.equal(ctx.quoteSnippet('https://blossom.example.com/x.jpg \nlnbc100u1' + 'q'.repeat(80)), '');
  assert.equal(ctx.quoteSnippet(''), '');
  assert.equal(ctx.quoteSnippet(null), '');
});

// ---- firstQuoteImage -----------------------------------------------------------

test('firstQuoteImage returns the first image URL in the content', () => {
  const content = 'https://example.com/page\nhttps://blossom.primal.net/abc.jpg';
  assert.equal(ctx.firstQuoteImage(content), 'https://blossom.primal.net/abc.jpg');
});

test('firstQuoteImage skips non-image URLs and returns null when there are none', () => {
  assert.equal(ctx.firstQuoteImage('see https://example.com/now'), null);
  assert.equal(ctx.firstQuoteImage(''), null);
  assert.equal(ctx.firstQuoteImage(null), null);
});

// ---- renderNoteText glue whitespace ------------------------------------------------
// The renderer's containers (.embed-body / .preview-body) are white-space:
// pre-wrap, so every \n the author put around a block-level item (media, the
// quote box) rendered as a full empty line stacked on the item's own margins —
// the "extra space between items" in the composer preview. pushBlock trims the
// whitespace off the text node before a block and out of the run after it;
// inline refs (mentions, plain links) keep their separating spaces, and
// paragraph breaks inside one prose run survive. The real renderNoteText runs
// here against a minimal DOM shim; nip19.decode is stubbed to null so every
// nostr ref takes the quote-inline branch.

function makeContainer() {
  const kids = [];
  return { kids, append: (...k) => { kids.push(...k); }, get lastChild() { return kids[kids.length - 1] || null; } };
}

const rctx = {
  Node: { TEXT_NODE: 3 },
  document: {
    createElement: (tag) => ({ nodeType: 1, tag }),
    createTextNode: (textContent) => ({ nodeType: 3, textContent }),
  },
  h: (tag) => ({ nodeType: 1, tag }),
  NT: { nip19: { decode: () => null } },
  resolveMentions: () => {},
  resolveQuotePreviews: () => {},
};
vm.createContext(rctx);
vm.runInContext(
  lift(/const IMG_EXT = [^;]+;/, 'IMG_EXT') + '\n' +
  lift(/const VID_EXT = [^;]+;/, 'VID_EXT') + '\n' +
  lift(/const PREVIEW_RE = [^;]+;/, 'PREVIEW_RE') + '\n' +
  lift(/  function renderNoteText\(container, text, maxLen\) \{[\s\S]*?\n  \}/, 'renderNoteText') + '\n' +
  'globalThis.renderNoteText = renderNoteText;',
  rctx
);

const NEVENT = 'nostr:nevent1' + 'q'.repeat(60);
const render = (text) => {
  const c = makeContainer();
  rctx.renderNoteText(c, text, 280);
  return c.kids;
};

test('newlines around a quote box and media render as no text nodes at all', () => {
  // The screenshot case: prose, nested quote ref, badge image URL, newline
  // separators. Before the fix this produced two blank lines (one after the
  // prose, one between the quote box and the image) on top of the margins.
  const kids = render('Badge Master\n\n' + NEVENT + ' \nhttps://blossom.example.com/badge.png');
  assert.equal(kids.length, 3);
  assert.equal(kids[0].nodeType, 3);
  assert.equal(kids[0].textContent, 'Badge Master'); // trailing \n\n trimmed
  assert.equal(kids[1].tag, 'a');
  assert.equal(kids[1].className, 'quote-inline loading');
  assert.equal(kids[2].tag, 'img');
  assert.ok(!kids.some((k) => k.nodeType === 3 && !k.textContent.trim()), 'no whitespace-only text nodes');
});

test('glue between two block items disappears entirely', () => {
  const kids = render(NEVENT + ' \nhttps://blossom.example.com/x.jpg');
  assert.equal(kids.length, 2);
  assert.equal(kids[0].tag, 'a');
  assert.equal(kids[1].tag, 'img');
});

test('trailing whitespace after a final block item is dropped', () => {
  const kids = render('words\n' + NEVENT + '\n\n');
  assert.equal(kids.length, 2);
  assert.equal(kids[0].textContent, 'words');
  assert.equal(kids[1].tag, 'a');
});

test('spaces around inline links are kept — words must not glue to the link', () => {
  const kids = render('see https://example.com/page now');
  assert.equal(kids.length, 3);
  assert.equal(kids[0].textContent, 'see ');
  assert.equal(kids[1].tag, 'a');
  assert.equal(kids[2].textContent, ' now');
});

test('paragraph breaks inside a prose run survive — that is the author\'s structure', () => {
  const kids = render('one\n\ntwo');
  assert.equal(kids.length, 1);
  assert.equal(kids[0].textContent, 'one\n\ntwo');
});
