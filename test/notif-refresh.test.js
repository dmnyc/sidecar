'use strict';

// Refreshing the bell sheet.
//
// Notifications normally arrive on a live subscription, so a refresh button looks
// redundant until you hit the cases the live sub cannot cover: the service worker was
// evicted while the panel sat idle, or a relay dropped and reconnected. The sheet opens
// from cache with no round trip, so without this there is no way to ask.
//
// The rule this file protects: the refresh goes back through the SAME addEvent the
// subscriptions use. That function drops your own events, applies the mute list, de-dupes
// by id, prefetches the sender's name and appends to an open sheet. A second copy of it
// would be five behaviors to keep in step, and the ones that fail quietly (a muted sender
// reappearing, a duplicate row) are the ones nobody notices for a release.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// The refetch body, brace-matched from its own arrow. A fixed-length slice kept cutting
// at the `};` of the inner promise callback rather than the end of the function.
function refetchBlock(fn) {
  // The ASSIGNMENT, not any mention of it: `cache.refetching` and `cache.refetchAdded`
  // both appear earlier, inside addEvent, and an indexOf('cache.refetch') lifted that
  // function's tail instead — every assertion below then failed as if the code were gone.
  const at = fn.indexOf('cache.refetch = async');
  if (at === -1) throw new Error('cache.refetch is gone');
  const open = fn.indexOf('{', fn.indexOf('=>', at));
  let depth = 0;
  for (let i = open; i < fn.length; i++) {
    if (fn[i] === '{') depth++;
    else if (fn[i] === '}' && --depth === 0) return fn.slice(at, i + 1);
  }
  throw new Error('unbalanced braces in cache.refetch');
}

// ---- the fetch ---------------------------------------------------------------------

test('THE REFRESH REUSES addEvent, NOT A COPY OF IT', () => {
  const fn = stripComments(lift('async function initNotifSubs('));
  assert.match(fn, /cache\.refetch = async \(\)/, 'the cache carries no refetch for the sheet to call');
  const refetch = refetchBlock(fn);
  assert.match(refetch, /onevent: addEvent/, 'the refresh no longer feeds events through addEvent');
  assert.match(refetch, /buildFilters\(/, 'the refresh builds its own filters instead of the subscription ones');
});

test('the refresh re-reads the relay list', () => {
  // Closing over the list built when the subscription started would mean a relay added
  // or removed while the panel stayed open was invisible to every later refresh.
  const fn = stripComments(lift('async function initNotifSubs('));
  const refetch = refetchBlock(fn);
  assert.match(refetch, /await relayUrls\(false\)/, 'the refresh reuses a stale relay list');
});

test('A RELAY THAT NEVER SENDS EOSE CANNOT HANG THE BUTTON', () => {
  // subscribeManyEose closes itself on EOSE, which is the happy path. A relay that
  // accepts the subscription and then says nothing would otherwise leave the promise
  // pending and the button spinning for as long as the sheet stays open.
  const fn = stripComments(lift('async function initNotifSubs('));
  const refetch = refetchBlock(fn);
  assert.match(refetch, /setTimeout\(finish, \d+\)/, 'nothing caps the wait');
  assert.match(refetch, /onclose: finish/, 'the fetch does not resolve when the subscription closes');
  assert.match(refetch, /if \(!settled\)/, 'finish can resolve twice');
});

// ---- the control ------------------------------------------------------------------

test('the bell sheet has a refresh control', () => {
  const fn = stripComments(lift('async function showNotifModal('));
  assert.match(fn, /className: 'modal-x notif-refresh'/, 'the sheet has no refresh button');
  assert.match(fn, /icon\('refresh'\)/, 'the refresh button carries no glyph');
  assert.match(fn, /cached\.refetch\(\)/, 'the button does not call the cache refetch');
  assert.match(fn, /await initNotifSubs\(\)/, 'a sheet whose subscriptions never started cannot start them');
});

test('IT SAYS SO WHEN NOTHING CAME BACK', () => {
  // Nothing new is the usual answer. A button that goes quiet reads as broken, which is
  // the same reason the wallet's refresh strikes an unchanged balance.
  const fn = stripComments(lift('async function showNotifModal('));
  assert.match(fn, /No new notifications/, 'a refresh that finds nothing gives no feedback');
  assert.match(fn, /if \(!added\) return toast/, 'the feedback is not conditional on anything arriving');
});

test('WHAT ARRIVED IS COUNTED, NOT MEASURED BY LENGTH', () => {
  // The cache is capped at 100. Comparing its length before and after would report "no
  // new notifications" for a full cache that had just rotated new ones in — and would
  // then skip the rebuild, leaving them invisible.
  const add = stripComments(lift('async function initNotifSubs('));
  assert.match(add, /if \(cache\.refetching\) cache\.refetchAdded\+\+/, 'arrivals are not counted');
  assert.match(add, /cache\.refetchAdded = 0/, 'the count is never reset per refresh');
  const sheet = stripComments(lift('async function showNotifModal('));
  assert.match(sheet, /refetchAdded \|\| 0/, 'the button reads something other than the count');
  assert.doesNotMatch(sheet, /after === before/, 'the length comparison came back');
});

test('A REFETCH DOES NOT STREAM HISTORY INTO AN OPEN SHEET', () => {
  // The bug this fixes: refetch replays up to a week through addEvent, and addLive puts
  // an arrival at the TOP because a live event is newer than everything by definition.
  // Refresh therefore showed two-day-old notes above "just now", and left the page
  // indices pointing at the wrong slice of a list that had grown underneath them.
  const add = stripComments(lift('async function initNotifSubs('));
  assert.match(add, /_openNotifBell\.pubkey === a\.pubkey && !cache\.refetching/,
    'a backfill can prepend history to an open sheet again');
  const refetch = refetchBlock(add);
  assert.match(refetch, /cache\.refetching = true/, 'the backfill is not marked as history');
  // In a finally, or one failed refresh leaves every later live notification invisible.
  assert.match(refetch, /finally \{\s*cache\.refetching = false;/, 'the flag can stick on failure');
});

test('IT REBUILDS THE LIST FROM THE SORTED CACHE', () => {
  // The cache is newest-first and the sheet's paging is computed from it at open, so the
  // honest way to show a backfill is to build the list again rather than insert into it.
  const sheet = stripComments(lift('async function showNotifModal('));
  assert.match(sheet, /if \(refreshBtn\.isConnected\) showNotifModal\(a\)/,
    'a refresh that found something does not rebuild the list');
});

test('the spinner stops even if the sheet closed mid-fetch', () => {
  const fn = stripComments(lift('async function showNotifModal('));
  assert.match(fn, /refreshBtn\.isConnected/, 'the button is repainted without checking it is still on screen');
});

// ---- placement --------------------------------------------------------------------

test('THE REFRESH DOES NOT SIT ON TOP OF THE CLOSE BUTTON', () => {
  // It borrows .modal-x for its metrics and overrides only `right`. Same specificity,
  // so source order decides: moved above .modal-x, both buttons stack in one corner.
  const x = css.indexOf('.modal-x {');
  const r = css.indexOf('.notif-refresh {');
  assert.ok(x !== -1 && r !== -1, 'one of the two rules was renamed');
  assert.ok(r > x, '.notif-refresh must come after .modal-x or its offset loses the tie');
  assert.match(css, /\.notif-refresh \{ right: 48px; \}/, 'the refresh no longer clears the close button');
});

test('the spin is dropped under prefers-reduced-motion', () => {
  const at = css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .notif-refresh.spinning');
  assert.ok(at !== -1, 'the refresh spinner ignores prefers-reduced-motion');
});
