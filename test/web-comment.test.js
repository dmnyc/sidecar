'use strict';

// Unit coverage for the web-comment target logic in sidepanel.js:
// normalizeWebUrl() and buildWebComment().
//
// A kind:1111 comment on a webpage is addressed BY the page URL, so normalization
// decides whether two people commenting on the same page land in the same thread.
// Getting it wrong doesn't raise an error — it silently splits the conversation, so
// the rules are pinned here rather than left to manual checking.
//
// The tag shape asserted below was taken from a real Jumble comment, fetched from
// relays and decoded, not inferred from the spec.
//
// One trap this guards against: nostr-tools' utils.normalizeURL — the obvious thing
// to reuse, since Sidecar already imports it for relay URLs — rewrites https:// to
// wss://. Using it here would tag every comment with an address that threads with
// nothing at all.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

const ctx = { console, URL, Date };
vm.createContext(ctx);
vm.runInContext(
  lift(/const WEB_COMMENT_KIND = \d+;/, 'WEB_COMMENT_KIND') + '\n' +
  lift(/const TRACKING_PARAMS = \[[\s\S]*?\];/, 'TRACKING_PARAMS') + '\n' +
  lift(/function normalizeWebUrl\(raw\)\s*\{[\s\S]*?\n  \}/, 'normalizeWebUrl') + '\n' +
  lift(/function buildWebComment\(url, content\)\s*\{[\s\S]*?\n  \}/, 'buildWebComment') + '\n' +
  lift(/const jumbleThreadUrl = [^\n]+\n[^\n]+/, 'jumbleThreadUrl') + '\n' +
  lift(/const jumbleNoteUrl = [^\n]+/, 'jumbleNoteUrl') + '\n' +
  'globalThis.normalizeWebUrl = normalizeWebUrl;' +
  'globalThis.buildWebComment = buildWebComment;' +
  'globalThis.jumbleThreadUrl = jumbleThreadUrl;' +
  'globalThis.jumbleNoteUrl = jumbleNoteUrl;' +
  'globalThis.WEB_COMMENT_KIND = WEB_COMMENT_KIND;',
  ctx
);
const { normalizeWebUrl, buildWebComment, jumbleThreadUrl, jumbleNoteUrl } = ctx;

// The exact URL from the real Jumble comment this was modelled on.
const CNN = 'https://www.cnn.com/2026/07/28/politics/jay-clayton-director-national-intelligence';

test('the reference URL passes through byte-for-byte', () => {
  // If this changes, Sidecar's comments stop threading with Jumble's.
  assert.equal(normalizeWebUrl(CNN).url, CNN);
});

test('the fragment is stripped — NIP-73 requires it, and #section is the same page', () => {
  assert.equal(normalizeWebUrl(CNN + '#comments').url, CNN);
  assert.equal(normalizeWebUrl('https://example.com/a#x').url, 'https://example.com/a');
});

test('tracking params are dropped, so share links do not fork the thread', () => {
  const cases = [
    '?utm_source=twitter', '?utm_medium=social&utm_campaign=x', '?fbclid=abc',
    '?gclid=abc', '?igshid=zzz', '?mc_cid=1&mc_eid=2', '?ttclid=q',
  ];
  for (const q of cases) {
    assert.equal(normalizeWebUrl(CNN + q).url, CNN, 'failed for ' + q);
  }
});

// This is the counterweight: for plenty of sites the query IS the page.
test('a meaningful query is KEPT', () => {
  assert.equal(
    normalizeWebUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ').url,
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  );
  // ...even mixed with tracking noise, which is dropped around it.
  assert.equal(
    normalizeWebUrl('https://www.youtube.com/watch?v=abc&utm_source=x').url,
    'https://www.youtube.com/watch?v=abc'
  );
});

test('query order does not create two threads for one page', () => {
  const a = normalizeWebUrl('https://example.com/p?b=2&a=1').url;
  const b = normalizeWebUrl('https://example.com/p?a=1&b=2').url;
  assert.equal(a, b);
});

test('a bare origin gets one trailing slash; a path never gains one', () => {
  assert.equal(normalizeWebUrl('https://example.com').url, 'https://example.com/');
  assert.equal(normalizeWebUrl('https://example.com/').url, 'https://example.com/');
  assert.equal(normalizeWebUrl('https://example.com/path/').url, 'https://example.com/path');
});

test('the host is case-folded but the path is not', () => {
  // Hosts are case-insensitive; paths are not, and folding them would point at a
  // different resource on plenty of servers.
  const out = normalizeWebUrl('https://Example.COM/Path/To/Thing').url;
  assert.equal(out, 'https://example.com/Path/To/Thing');
});

// Refusals. Each of these would either be meaningless to another reader or would
// publish something private, so they must fail closed with a reason rather than
// being guessed at.
test('non-web schemes are refused, not normalized', () => {
  for (const bad of [
    'chrome://extensions',
    'about:debugging',
    'moz-extension://abc/sidepanel.html',
    'chrome-extension://abc/sidepanel.html',
    'file:///Users/daniel/secret.txt',
    'data:text/html,<h1>x',
    'javascript:alert(1)',
  ]) {
    const r = normalizeWebUrl(bad);
    assert.ok(r.error, bad + ' must be refused');
    assert.equal(r.url, undefined, bad + ' must not yield a URL');
  }
});

// file:// would publish a path from this machine to a public relay.
test('a local path is never publishable', () => {
  assert.ok(normalizeWebUrl('file:///Users/daniel/Documents/notes.txt').error);
  assert.ok(normalizeWebUrl('http://localhost:3000/admin').error);
  assert.ok(normalizeWebUrl('http://127.0.0.1:8080/').error);
  assert.ok(normalizeWebUrl('http://192.168.1.1/router').error);
});

test('junk input returns an error rather than throwing', () => {
  for (const junk of ['', '   ', 'not a url', null, undefined, 'http://']) {
    const r = normalizeWebUrl(junk);
    assert.ok(r.error, JSON.stringify(junk) + ' should error');
  }
});

// ---- the event ----------------------------------------------------------------

test('the event matches the tag shape a real Jumble comment uses', () => {
  const ev = buildWebComment(CNN, 'hello');
  assert.equal(ev.kind, 1111);
  assert.equal(ev.content, 'hello');
  // Compared as JSON, not deepEqual: the tags are built inside the vm realm, so
  // their prototype differs from the host's Array and assert/strict's deepEqual
  // fails on that alone ("same structure but not reference-equal").
  assert.equal(JSON.stringify(ev.tags), JSON.stringify([
    ['I', CNN],   // uppercase = root scope
    ['K', 'web'], // uppercase = root kind
    ['i', CNN],   // lowercase = parent scope
    ['k', 'web'], // lowercase = parent kind
  ]));
});

test('root and parent are identical for a top-level comment', () => {
  const ev = buildWebComment(CNN, 'x');
  const I = ev.tags.find((t) => t[0] === 'I');
  const i = ev.tags.find((t) => t[0] === 'i');
  assert.equal(I[1], i[1], 'a comment on the page, not a reply to a comment');
});

test('created_at is unix SECONDS', () => {
  const ev = buildWebComment(CNN, 'x');
  assert.ok(ev.created_at > 1_000_000_000 && ev.created_at < 100_000_000_000);
});

// ---- the Jumble links ---------------------------------------------------------

test('the thread link matches the external-content format', () => {
  assert.equal(
    jumbleThreadUrl(CNN),
    'https://jumble.social/external-content?id=' +
      'https%3A%2F%2Fwww.cnn.com%2F2026%2F07%2F28%2Fpolitics%2Fjay-clayton-director-national-intelligence'
  );
});

test('the URL is encoded, so a query in the target cannot break the link', () => {
  const link = jumbleThreadUrl('https://example.com/a?b=1&c=2');
  assert.ok(!link.slice('https://jumble.social/external-content?id='.length).includes('&'),
    'an unencoded & would read as a second Jumble param');
});

test('the note link matches the notes format', () => {
  assert.equal(jumbleNoteUrl('nevent1abc'), 'https://jumble.social/notes/nevent1abc');
});
