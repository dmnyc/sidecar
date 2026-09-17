'use strict';

// WHOSE PROFILE IS THIS, REALLY.
//
// SimplePool.get() resolves with whatever the first relay hands back, and a relay is not
// obliged to honor the filter it was sent. Every single-author kind:0 read in the panel
// used to file the content it got under the pubkey it had ASKED for, with no check that
// the event was actually authored by them. The shared profile cache is read by the wallet
// list, notifications, mentions, the profile sheet and the zap form, so one loose answer
// becomes that person's identity across the whole panel for the full 5 minute TTL.
//
// Two of the six sites were worse than a wrong name. fetchAndStoreProfile writes through
// to SIDECAR_SET_PROFILE, which is on disk and outlives any reload. And the note zap form
// reads lud16 off that event to decide WHICH LIGHTNING ADDRESS TO PAY.
//
// Found while working out why a zap to one person rendered under another's name in the
// transaction list. It was not proven to be the cause of that, and is a real defect on a
// money path either way.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const bare = panel.replace(/^\s*\/\/.*$/gm, '');

function lift(src, decl) {
  const at = src.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// The real function, run against a stubbed pool rather than asserted about as text.
function build(poolGet) {
  const src = lift(bare, 'async function poolGetProfile(');
  // eslint-disable-next-line no-new-func
  return new Function('poolGet', src + '; return poolGetProfile;')(poolGet);
}

const ALICE = 'a'.repeat(64);
const MALLORY = 'm'.repeat(64);

test('AN EVENT BY SOMEONE ELSE IS NOT THIS PERSON\'S PROFILE', async () => {
  const fn = build(async () => ({ pubkey: MALLORY, content: '{"name":"Mallory","lud16":"m@example.com"}' }));
  assert.equal(await fn([], ALICE), null, 'a mismatched author must read as a miss, not as Alice');
});

test('their own event still comes back', async () => {
  const ev = { pubkey: ALICE, content: '{"name":"Alice"}' };
  const fn = build(async () => ev);
  assert.equal(await fn([], ALICE), ev);
});

test('nothing found is still nothing found', async () => {
  for (const empty of [null, undefined, '']) {
    const fn = build(async () => empty);
    assert.equal(await fn([], ALICE), null);
  }
});

test('the filter it sends is still the one that was asked for', async () => {
  let got = null;
  const fn = build(async (relays, filter) => { got = filter; return null; });
  await fn(['wss://r'], ALICE);
  assert.deepEqual(got, { kinds: [0], authors: [ALICE] });
});

test('EVERY SINGLE-AUTHOR PROFILE READ GOES THROUGH IT', () => {
  // The guard is worth nothing if the next one added calls poolGet directly. The helper
  // is the only place that filter shape may appear.
  const direct = bare.split('\n').filter((l) => /kinds: \[0\], authors: \[/.test(l));
  assert.equal(direct.length, 1, 'a single-author kind:0 read is bypassing poolGetProfile:\n' + direct.join('\n'));
  assert.match(direct[0], /const ev = await poolGet\(relays, \{ kinds: \[0\], authors: \[pubkey\] \}, params\);/);

  // And the six callers are all still routed through it.
  assert.ok((bare.match(/poolGetProfile\(/g) || []).length >= 7, 'callers were dropped rather than converted');
});

test('the batch paths keep indexing by the author they got, not the one they wanted', () => {
  // These were never exposed to this: they map results by ev.pubkey and then read the key
  // they asked for, so a stranger's event lands in the map and is never looked up. If one
  // is ever rewritten to zip two lists together instead, it grows the same bug.
  for (const fnName of ['async function prefetchNotifProfiles(', 'async function resolveMentions(']) {
    const fn = lift(bare, fnName);
    assert.match(fn, /\[ev\.pubkey\]|\(ev\.pubkey\)|newest\.set\(ev\.pubkey/,
      fnName + ' no longer keys its results by the event author');
  }
});
