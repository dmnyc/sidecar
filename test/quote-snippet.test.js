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
