'use strict';

// The Saved sheet's Comments tab, and the enlarged view a row opens.
//
// A webpage comment is a NIP-22 kind 1111 whose scope tag (uppercase I) is a web
// address; the query asks the account's relays for its own 1111s and keeps only the
// web ones. A comment on a Nostr thread answers a note, and the row names that note
// (hydrated by id) instead of leaving the sentence bare. And because most clients
// render a kind 1111 nowhere at all, opening a row shows Sidecar's own enlarged
// view — the parent it answers, the comment in full, its replies — rather than
// betting on a client.
//
// The pane lives behind a modal and a relay round-trip, so nothing here runs the
// code; these tests pin the decisions the query, the rows, the thread sheet and the
// tab wiring depend on, in the source itself.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');

const sheet = src.slice(src.indexOf('const SAVED_PAGE'), src.indexOf('function commentParentId'));
const fetchPart = src.slice(src.indexOf('async function fetchComments'), src.indexOf('function commentPage'));
const fillPart = src.slice(src.indexOf('async function fillComments'), src.indexOf('async function fetchCommentReplies'));
const thread = src.slice(src.indexOf('async function openCommentThread'), src.indexOf('// ---- the account\'s own reactions'));
const repliesQuery = src.slice(src.indexOf('async function fetchCommentReplies'), src.indexOf('async function openCommentThread'));

test('the comments query asks the account’s relays for its own 1111s, like highlights do', () => {
  assert.match(fetchPart, /postRelays\(\)/);
  assert.match(fetchPart, /readRelayUrls\(pubkey\)/);
  assert.match(fetchPart, /kinds: \[1111\], authors: \[pubkey\], limit: 100/);
  assert.match(fetchPart, /maxWait: 6000/);
});

test('a webpage comment is kept only when its scope tag is a web address', () => {
  assert.ok(fetchPart.includes("tg[0] === 'I'"), 'the uppercase I tag is the NIP-73 scope');
  assert.ok(fetchPart.includes('/^https?:'), 'http(s) is the web scope; Nostr scopes stay out');
  // The scope tag is also where the row's page host comes from.
  assert.match(src, /function commentPage\(ev\)[\s\S]*?new URL\(scope\[1\]\)\.host/);
});

test('a row names the note it answers, hydrated by the last e tag', () => {
  // NIP-22 reads lowercase e tags root-to-leaf, so the last one is the parent.
  assert.match(src, /function commentParentId\(ev\)[\s\S]*?es\[es\.length - 1\]\[1\]/);
  assert.match(fillPart, /commentParentId\(ev\)/);
  assert.match(fillPart, /fetchEventsByIds\(parentIds\)/);
  assert.match(fillPart, /cm-ref/, 'the parent rides on the row as a reference line');
  assert.ok(fillPart.includes("t('Replying to {{name}}'"), 'the parent is named when its author is known');
});

test('opening a row shows Sidecar’s enlarged view, and Reply rides the composer page', () => {
  assert.match(fillPart, /openCommentThread\(ev\)/);
  assert.ok(!fillPart.includes('preferredClient()'), 'the row no longer bets on a client');
  assert.match(thread, /fetchEventsByIds\(\[parentId\]\)/, 'the sheet hydrates the parent too');
  assert.match(repliesQuery, /kinds: \[1111\], '#e': \[id\], limit: 100/, 'replies query the indexed e tags');
  assert.match(repliesQuery, /\(tg\[0\] === 'e' \|\| tg\[0\] === 'i'\) && tg\[1\] === id/, 'and filter i-only replies by hand');
  assert.match(thread, /jumbleThreadUrl\(pageUrl\)/, 'a web-rooted comment points at the page’s thread');
  assert.match(thread, /kind: e\.kind/, 'events open with their own kind, whatever a client supports');
  assert.match(thread, /t\('Open in \{\{client\}\}', \{ client: client\.label \}\)/, 'the open button names the client');
  assert.match(thread, /handOffToTab\(state\.activePubkey \+ '\|r:' \+ ev\.id, ev\)/, 'Reply rides the dedicated composer page, target whole');
  assert.match(thread, /openCommentThread\(r, ev\)/, 'a reply row opens its own enlarged view, with this comment behind it');
  assert.ok(!thread.includes('innerHTML'), 'comment text goes through textContent, never markup');
});

test('the Comments tab is icon-only and filled lazily', () => {
  assert.match(sheet, /iconTab\(t\('Comments'\), 'comment'\)/);
  assert.match(sheet, /which === 'comments' && !cmFilled/, 'filled lazily, once');
  assert.match(sheet, /fillComments\(cmPane/, 'the pane is handed to the filler');
});

test('the capsule caps at two digits and the list pages in screens', () => {
  assert.match(sheet, /tabCount = \(n\) => n > 99/, 'a heart with 424 is not a number a capsule can carry');
  assert.ok(sheet.includes("t('{{count}}+', { count: I18N.fmtNum(99) })"), 'the + form is the bell badge template, already translated');
  assert.match(sheet, /show-more-btn/, 'rows append under a Show more button, like the wallet history does');
  assert.match(sheet, /t\('Yours'\)/, 'the heading covers four content types, not just bookmarks');
  assert.match(fillPart, /paged\(list, evs, makeRow\)/, 'rows append in screens, not hundreds at once');
});

test('the tab count and the failure quote follow the highlights pane', () => {
  assert.match(fillPart, /modal-tab-count/);
  assert.match(fillPart, /Couldn’t read your comments from your relays\./);
  assert.match(fillPart, /Comment on a web page through Sidecar and it shows up here\./);
});
