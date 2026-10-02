'use strict';

// NIP-84 highlights from the page's context menu: the kind:9802 the popup builds, and the
// worker wiring that keeps what you selected away from web pages.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
require('../highlight-event.js');
const HL = globalThis.SidecarHighlight;

const tagsNamed = (ev, name) => ev.tags.filter((t) => t[0] === name);

test('A HIGHLIGHT IS A 9802 WHOSE CONTENT IS THE PASSAGE, SOURCED TO THE PAGE', () => {
  const ev = HL.buildTemplate({
    text: '  The quick brown fox.  ', url: 'https://example.com/a?x=1#:~:text=quick', clientTag: true, now: 1700000000000,
  });
  assert.equal(ev.kind, 9802);
  assert.equal(ev.content, 'The quick brown fox.');
  assert.equal(ev.created_at, 1700000000);
  // The fragment is where you were on the page, not the page.
  assert.deepEqual(tagsNamed(ev, 'r'), [['r', 'https://example.com/a?x=1', 'source']]);
  assert.deepEqual(tagsNamed(ev, 'client'), [['client', 'Sidecar']]);
  assert.equal(tagsNamed(ev, 'comment').length, 0);
  assert.equal(tagsNamed(ev, 'alt').length, 1);
});

test('the client tag follows the setting', () => {
  const ev = HL.buildTemplate({ text: 'x', url: 'https://example.com/', clientTag: false });
  assert.equal(tagsNamed(ev, 'client').length, 0);
});

test('A COMMENT MAKES IT A QUOTE HIGHLIGHT, its links marked mention, never source', () => {
  const ev = HL.buildTemplate({
    text: 'passage', url: 'https://example.com/post',
    comment: 'Agreed, see https://other.org/x. And https://example.com/post too.',
  });
  assert.deepEqual(tagsNamed(ev, 'comment'), [['comment', 'Agreed, see https://other.org/x. And https://example.com/post too.']]);
  assert.deepEqual(tagsNamed(ev, 'r'), [
    ['r', 'https://example.com/post', 'source'],
    ['r', 'https://other.org/x', 'mention'],
  ]);
  // A blank comment is no comment.
  assert.equal(tagsNamed(HL.buildTemplate({ text: 'p', url: 'https://e.com/', comment: ' \n ' }), 'comment').length, 0);
});

test('the surrounding paragraph is context only when it contains the passage and adds to it', () => {
  const url = 'https://example.com/';
  const withCtx = HL.buildTemplate({ text: 'brown fox', url, context: 'The quick brown fox jumps.' });
  assert.deepEqual(tagsNamed(withCtx, 'context'), [['context', 'The quick brown fox jumps.']]);
  assert.equal(tagsNamed(HL.buildTemplate({ text: 'brown fox', url, context: 'brown fox' }), 'context').length, 0);
  assert.equal(tagsNamed(HL.buildTemplate({ text: 'brown fox', url, context: 'something else' }), 'context').length, 0);
  assert.equal(tagsNamed(HL.buildTemplate({ text: 'fox', url, context: 'fox ' + 'a'.repeat(HL.MAX_CONTEXT) }), 'context').length, 0);
});

test('LINE BREAKS SURVIVE: a quoted list or verse is not flattened', () => {
  const ev = HL.buildTemplate({ text: 'one  \r\ntwo\n\n\n\nthree', url: 'https://example.com/' });
  assert.equal(ev.content, 'one\ntwo\n\nthree');
});

test('A PASSAGE OVER THE LIMIT IS REFUSED, NEVER CUT: a shortened quote is a misquote', () => {
  const long = 'a'.repeat(HL.MAX_TEXT + 1);
  assert.equal(HL.tooLong(long), true);
  assert.equal(HL.tooLong('a'.repeat(HL.MAX_TEXT)), false);
  assert.throws(() => HL.buildTemplate({ text: long, url: 'https://example.com/' }), /too long/);
});

test('only web pages can be a source, and an empty selection is nothing', () => {
  for (const url of ['chrome://extensions/', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', '']) {
    assert.throws(() => HL.buildTemplate({ text: 'x', url }), /web page/, url);
  }
  assert.throws(() => HL.buildTemplate({ text: '   ', url: 'https://example.com/' }), /Nothing selected/);
});

test('THE WORKER: one selection item, and the passage is for extension pages only', () => {
  const bg = read('background.js');
  assert.match(bg, /id: 'sidecar-highlight', title: t\('Highlight with Sidecar'\), contexts: \['selection'\]/);
  assert.match(bg, /info\.menuItemId === 'sidecar-highlight'/);
  // Not in the content-script allowlist: a page that could ask would learn what you
  // selected on another site.
  const allow = /const CONTENT_OK = new Set\(\[([\s\S]*?)\]\);/.exec(bg)[1];
  assert.doesNotMatch(allow, /HIGHLIGHT/);
  assert.match(bg, /case 'SIDECAR_HIGHLIGHT_GET':/);
  assert.match(bg, /case 'SIDECAR_HIGHLIGHT_DROP':/);
  // Handed over by id, not in the address.
  assert.match(bg, /highlight\.html\?id=' \+ id/);
});

test('the popup loads the builder before itself, and signs through the owner door', () => {
  const html = read('highlight.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.indexOf('highlight-event.js') < scripts.indexOf('highlight.js'));
  const js = read('highlight.js');
  assert.match(js, /type: 'SIDECAR_OWNER_SIGN', event: template, expectedPubkey: state\.activePubkey/);
});
