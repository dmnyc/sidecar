'use strict';

// Noticing an invoice the page copies to its own clipboard.
//
// A zap modal that shows only a QR and a "Copy invoice" button (slidestr.net is
// one) puts the invoice nowhere the DOM scanner can reach: it exists as path
// geometry inside the QR and as a closure variable, never as text. Wrapping
// navigator.clipboard.writeText catches it at the moment the page writes it.
//
// Sidecar never READS the clipboard — that would need a permission it does not
// hold and would mean seeing everything the user copies anywhere. The wrapper
// only sees what the page itself writes.
//
// The overriding requirement is that a copy button keeps working. Sidecar is a
// guest in someone else's page here, and breaking Copy to gain a convenience
// would be a bad trade, so most of what follows is about the wrapper staying out
// of the way: passing the call through untouched, returning what the original
// returned, and surviving anything odd it is handed.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const providerSrc = fs.readFileSync(path.join(ROOT, 'nostr-provider.js'), 'utf8');
const contentSrc = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

// The wrapper as it ships, lifted out of the provider IIFE.
function liftWrapper() {
  const m = providerSrc.match(/const clip = navigator\.clipboard;[\s\S]*?\n    \}\n  \} catch \(_\) \{\}/);
  assert.ok(m, 'clipboard wrapper not found in nostr-provider.js');
  return m[0].replace(/\n  \} catch \(_\) \{\}$/, '');
}

const INVOICE =
  'lnbc210n1pnxyz00pp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsdqqcqzzsxqyz5vq';

let ctx;

// A fresh page-world stand-in per test: a clipboard whose writeText records how
// it was called, and a window that records what got posted.
function makeContext({ writeText } = {}) {
  const calls = [];
  const posted = [];
  const clipboard = {
    writeText:
      writeText ||
      function (text) {
        calls.push({ text, receiver: this });
        return Promise.resolve('original-return');
      },
  };
  const c = {
    calls,
    posted,
    clipboard,
    navigator: { clipboard },
    window: { postMessage: (msg) => posted.push(msg) },
    Object,
    String,
    Promise,
  };
  vm.createContext(c);
  vm.runInContext(liftWrapper(), c);
  return c;
}

beforeEach(() => { ctx = makeContext(); });

// ---- the part that must never regress: the page's copy still works ----

test('the original writeText is still called, with the same text', async () => {
  await ctx.clipboard.writeText('just some text');
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0].text, 'just some text');
});

test('what the original returned is passed straight back', async () => {
  const out = await ctx.clipboard.writeText('hello');
  assert.equal(out, 'original-return');
});

test('the original is invoked on the clipboard, not on some detached receiver', async () => {
  // Getting this wrong is an "Illegal invocation" TypeError in a real browser.
  await ctx.clipboard.writeText('hello');
  assert.equal(ctx.calls[0].receiver, ctx.clipboard);
});

test('a rejecting writeText still rejects, unchanged', async () => {
  const boom = new Error('denied');
  const c = makeContext({ writeText: () => Promise.reject(boom) });
  await assert.rejects(() => c.clipboard.writeText(INVOICE), (e) => e === boom);
});

test('text that cannot be stringified does not break the copy', async () => {
  const hostile = { toString() { throw new Error('nope'); } };
  await ctx.clipboard.writeText(hostile);
  assert.equal(ctx.calls.length, 1, 'the copy still went through');
  assert.equal(ctx.posted.length, 0, 'and nothing was reported');
});

test('null and undefined are copied without incident', async () => {
  await ctx.clipboard.writeText(null);
  await ctx.clipboard.writeText(undefined);
  assert.equal(ctx.calls.length, 2);
  assert.equal(ctx.posted.length, 0);
});

test('a page with no clipboard API does not throw on load', () => {
  const c = { navigator: {}, window: { postMessage() {} }, Object, String, Promise };
  vm.createContext(c);
  assert.doesNotThrow(() => vm.runInContext(liftWrapper(), c));
});

// ---- what it reports ----

test('copying an invoice reports it', async () => {
  await ctx.clipboard.writeText(INVOICE);
  assert.equal(ctx.posted.length, 1);
  assert.equal(ctx.posted[0].ext, 'sidecar');
  assert.equal(ctx.posted[0].kind, 'copied-invoice');
  assert.equal(ctx.posted[0].invoice, INVOICE);
});

test('an invoice is reported lowercased, as the QR-cased form is common', async () => {
  await ctx.clipboard.writeText(INVOICE.toUpperCase());
  assert.equal(ctx.posted[0].invoice, INVOICE);
});

test('an invoice embedded in surrounding text is still found', async () => {
  await ctx.clipboard.writeText('pay me: ' + INVOICE + ' thanks');
  assert.equal(ctx.posted.length, 1);
  assert.equal(ctx.posted[0].invoice, INVOICE);
});

test('ordinary copied text is never reported', async () => {
  for (const text of [
    'hello world',
    'npub1xyz',
    'a password probably',
    'https://example.com/lnbc-not-an-invoice',
    'lnbc1',                       // too short to be real
    'lnbc210n1pnxyz00pp5short',    // under the length floor
  ]) {
    ctx.posted.length = 0;
    await ctx.clipboard.writeText(text);
    assert.equal(ctx.posted.length, 0, 'must not report: ' + text);
  }
});

test('nothing but the invoice crosses the boundary', async () => {
  await ctx.clipboard.writeText('secret note ' + INVOICE + ' more secrets');
  const blob = JSON.stringify(ctx.posted[0]);
  assert.equal(blob.includes('secret'), false, 'surrounding clipboard text must not be forwarded');
});

// ---- the receiving side re-checks rather than trusting ----

test('content.js re-validates a copied invoice instead of trusting the page', () => {
  const handler = contentSrc.match(/if \(d\.kind === 'copied-invoice'\) \{[\s\S]*?\n    \}/);
  assert.ok(handler, 'copied-invoice handler not found in content.js');
  const body = handler[0];
  // The provider runs in the page world, so this channel is page-controlled.
  assert.match(body, /INVOICE_TEXT_RE\.exec/, 'must re-run the invoice regex');
  assert.match(body, /invoiceExpired\(/, 'must re-check expiry');
  assert.match(body, /toLowerCase\(\)/, 'must normalize case');
});

test('a copied invoice expires, so a card cannot outlive the modal', () => {
  assert.match(contentSrc, /const COPIED_TTL_MS = /, 'copied invoices need their own ceiling');
  const route = contentSrc.match(/if \(copiedInvoice\) \{[\s\S]*?\n    \}/);
  assert.ok(route, 'the copied-invoice fallback was not found in findPageInvoice');
  assert.match(route[0], /copiedInvoice === dismissedInvoice/, 'a dismissed invoice must not linger');
  assert.match(route[0], /COPIED_TTL_MS/, 'the ceiling must actually be applied');
  assert.match(route[0], /invoiceExpired\(copiedInvoice\)/, "the BOLT11's own expiry still applies");
});

test('the copied invoice is the last resort, after the DOM routes', () => {
  const fn = contentSrc.match(/function findPageInvoice\(\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, 'findPageInvoice not found');
  const body = fn[0];
  // A visible invoice or an explicit lightning: link describes the same payment
  // more directly, and is re-derived fresh on every scan.
  assert.ok(
    body.indexOf('copiedInvoice') > body.indexOf('lightning:'),
    'the clipboard fallback must come after the lightning: link route'
  );
  assert.ok(
    body.indexOf('copiedInvoice') > body.indexOf('hasPayIntent'),
    'the clipboard fallback must come after the input/pay-intent route'
  );
});
