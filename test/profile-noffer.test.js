'use strict';

// A CLINK noffer on the profile, written the way the clients that read it expect.
//
// The field key is not formally standardised: `noffer` is what bxrd.app writes and
// what zapcooking's editor reads, with `offer` / `clink_offer` as tolerated
// alternates. Sidecar matches that contract exactly — same placement (the advanced
// block beside the image URLs), same tolerant read, same write-under-`noffer` — so
// an offer generated in Zeus and pasted here is an offer every CLINK reader can pay.
//
// The one thing Sidecar adds is consolidation: publishing writes `noffer` and clears
// the alternates, because the same offer under two keys is a stale duplicate the day
// one of them is edited elsewhere.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(pattern, label) {
  const m = src.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

test('the editor reads the offer tolerantly and writes it under noffer', () => {
  const fn = lift(/function openProfileEdit\(current\) \{[\s\S]*?\n  \}/, 'openProfileEdit');
  // All three keys are read, in the standard's de-facto priority order.
  assert.match(fn, /current\.noffer[\s\S]*?current\.offer[\s\S]*?current\.clink_offer/);
  // The input sits in the advanced block, beside the image URLs.
  assert.match(fn, /Advanced — image URLs, CLINK offer/);
  assert.match(fn, /textContent: 'CLINK offer'/);
  assert.match(fn, /nofferInp\.placeholder = 'noffer1…';/);
  // And the publish carries it with the alternates cleared.
  assert.match(fn, /fields\.noffer = draft\.noffer;/);
  assert.match(fn, /fields\.offer = '';/);
  assert.match(fn, /fields\.clink_offer = '';/);
});

test('a malformed offer is refused at publish, by shape only', () => {
  // The prefix and the bech32 charset, nothing deeper: the TLVs belong to the
  // wallet that made the offer, and a stricter check would reject offers from
  // clients that encode differently. A wrong string here is a payment address
  // that silently fails at a stranger's wallet — that is worth refusing, once,
  // in plain words.
  const fn = lift(/function openProfileEdit\(current\) \{[\s\S]*?\n  \}/, 'openProfileEdit');
  assert.match(fn, /\/\^noffer1\[qpzry9x8gf2tvdw0s3jn54khce6mua7\]\+\$\/i\.test\(draft\.noffer\)/);
  assert.match(fn, /it starts with noffer1/);
});

test('the shape check accepts real offers and rejects the near-misses', () => {
  // The shipped literal is pinned verbatim first — that is the drift guard — and
  // the vectors below run on the identical literal, character for character.
  assert.match(src, /\^noffer1\[qpzry9x8gf2tvdw0s3jn54khce6mua7\]\+\$\/i/, 'the shipped shape check drifted');
  const ok = (v) => /^noffer1[qpzry9x8gf2tvdw0s3jn54khce6mua7]+$/i.test(v);
  // 32-byte service pubkey + short id, bech32 chars only.
  assert.equal(ok('noffer1' + 'qpzry9x8gf2tvdw0s3jn54khce6mua7'.repeat(3)), true);
  assert.equal(ok('noffer1'), false, 'no data after the separator');
  assert.equal(ok('noffer1bogus'), false, 'b is not a bech32 character');
  assert.equal(ok('lnurl1qpzry9x8'), false, 'an lnurl is not an offer');
  assert.equal(ok('NOFFER1QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7'), true, 'case-blind like bech32');
});

test('an empty field removes the offer from the profile', () => {
  // publishProfile deletes empty-valued keys — pinned so the "cleared as easily as
  // set" promise in the editor's hint stays true.
  const fn = lift(/async function publishProfile\(fields, pin\) \{[\s\S]*?\n  \}/, 'publishProfile');
  assert.match(fn, /if \(v\) merged\[k\] = v;\s*else delete merged\[k\];/);
});
