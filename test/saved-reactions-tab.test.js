'use strict';

// The Saved sheet's Reactions tab (the heart).
//
// A reaction is only a marker on the note it reacted to, so the tab queries the
// account's own kind 7s, hydrates every e-tag target in one batch, and shows the
// two together: the mark, then the author and the opening of the note's text. The
// row opens the TARGET, not the reaction — the note renders in every client, while
// a lone kind 7 renders in almost none.
//
// The pane lives behind a modal and a relay round-trip, so nothing here runs the
// code; these tests pin the query, the hydration and the rows in the source.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');

const fetchPart = src.slice(src.indexOf('async function fetchReactions'), src.indexOf('async function fillReactions'));
const fillPart = src.slice(src.indexOf('async function fillReactions'), src.indexOf('// Session cache per account'));

test('the reactions query asks the account’s relays for its own kind 7s', () => {
  assert.match(fetchPart, /postRelays\(\)/);
  assert.match(fetchPart, /readRelayUrls\(pubkey\)/);
  assert.match(fetchPart, /kinds: \[7\], authors: \[pubkey\], limit: 200/);
  assert.match(fetchPart, /maxWait: 6000/);
});

test('both kinds of target hydrate: notes by id, profiles by name', () => {
  assert.match(fillPart, /tg\[0\] === 'e' && HEX_ID\.test\(tg\[1\]/, 'note targets gather for one batch fetch');
  assert.match(fillPart, /fetchEventsByIds\(\[\.\.\.noteIds\]\)/);
  assert.ok(fillPart.includes("/^[0-9a-f]{64}$/.test(tg[1] || '')"), 'profile targets gather too');
  assert.match(fillPart, /profilesFor\(/);
});

test('a reaction row shows the mark and opens the note it reacted to', () => {
  assert.match(fillPart, /reactionMark\(ev\)/, 'the mark is drawn by the helper that shares reactionDisplay with the notification list');
  assert.match(fillPart, /kind: note\.kind/, 'the row opens the note, not the reaction');
  assert.match(fillPart, /t\('Open in \{\{client\}\}', \{ client: client\.label \}\)/, 'the row names the client it opens');
  assert.ok(!fillPart.includes('innerHTML'), 'target text goes through textContent, never markup');
});

test('reaction rows page in screens and feed the shared count writer', () => {
  assert.match(fillPart, /paged\(list, evs, makeRow\)/);
  assert.match(fillPart, /setTabCount\(tab, n\)/);
  assert.match(fillPart, /loadSavedList\(pane, gone, _rctCache, fetchReactions/);
});
