'use strict';

// The library sheet's Comments tab, and the doorway a row is to the comment's own page.
//
// A webpage comment is a NIP-22 kind 1111 whose scope tag (uppercase I) is a web
// address; the query asks the account's relays for its own 1111s and keeps only the
// web ones. A comment on a Nostr thread answers a note, and the row names that note
// (hydrated by id) instead of leaving the sentence bare. And because most clients
// render a kind 1111 nowhere at all, opening a row opens Sidecar's own page for the
// comment (thread.html) rather than betting on a client.
//
// The pane lives behind a modal and a relay round-trip, so these pin the query, the rows
// and the doorway in the source; saved-hub.browser.test.js runs the sheet and the click,
// and thread-page.browser.test.js runs the page itself.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');

const sheet = src.slice(src.indexOf('const SAVED_PAGE'), src.indexOf('function commentParentId'));
const fetchPart = src.slice(src.indexOf('async function fetchComments'), src.indexOf('function commentPage'));
const fillPart = src.slice(src.indexOf('async function fillComments'), src.indexOf('// ---- one comment, read in its own tab'));

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
  assert.match(fillPart, /fetchEventsByIds\(parentIds, undefined, \{ offline: quick \}\)/);
  assert.match(fillPart, /cm-ref/, 'the parent rides on the row as a reference line');
  assert.ok(fillPart.includes("t('Replying to {{name}}'"), 'the parent is named when its author is known');
});

test('opening a row opens the comment’s own page, never a client', () => {
  assert.match(fillPart, /openThreadTab\(ev\)/);
  assert.ok(!fillPart.includes('preferredClient()'), 'the row no longer bets on a client');
  const open = src.slice(src.indexOf('async function openThreadTab'), src.indexOf('// ---- the account\'s own reactions'));
  assert.match(open, /chrome\.runtime\.getURL\('thread\.html'\) \+ '\?id=' \+ ev\.id/, 'the comment goes in the address by its id');
  assert.match(open, /\^\[0-9a-f\]\{64\}\$/, 'and only a real id does');
  assert.match(open, /SIDECAR_THREAD_OPEN/, 'an open thread tab is told, not navigated (that needs the tabs permission)');
  assert.ok(!open.includes('innerHTML'));
});

test('the capsule stops at 99+, in the bell badge’s own template', () => {
  const vm = require('node:vm');
  const c = vm.createContext({});
  vm.runInContext('const t = (s, p) => s.replace("{{count}}", p.count); const I18N = { fmtNum: String };\n' +
    sheet.slice(sheet.indexOf('const tabCount'), sheet.indexOf('const setTabCount')) + '\nthis.tabCount = tabCount;', c);
  assert.deepEqual([5, 99, 100, 424].map(c.tabCount), ['5', '99', '99+', '99+']);
});

test('the failure quote and the empty line are the comments tab’s own', () => {
  assert.match(fillPart, /Couldn’t read your comments from your relays\./);
  assert.match(fillPart, /Comment on a web page through Sidecar and it shows up here\./);
  assert.match(fillPart, /loadSavedList\(pane, gone, _cmCache, fetchComments/, 'the shared loader, on this list’s own cache');
});
