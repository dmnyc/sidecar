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
  // The input sits in the advanced block, beside the image URLs. The summary says
  // "Advanced" and stops: a disclosure that lists its own contents is a second label for
  // the labels underneath it, and this one was wrapping to two lines to do it.
  assert.match(fn, /sum\.textContent = 'Advanced';/);
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
  assert.match(fn, /!window\.SidecarCLINK\.isNofferString\(draft\.noffer\)/);
  assert.match(fn, /It starts with noffer1/);
});

test('THE SHAPE CHECK IS THE READER’S, RUN, NOT A COPY OF IT RE-TESTED', () => {
  // This test used to pin the panel's own regex literal verbatim and then re-declare the
  // identical literal to run vectors through. That proves a copy behaves like itself and
  // nothing else, and it is how the bug it was guarding survived: the shipped charset was
  // missing bech32's `l`, so the editor refused roughly 95% of real offers, and every
  // vector here happened to avoid the one letter that mattered.
  //
  // So it runs the shipped function now, loaded from clink.js, and the vectors include
  // the character that was missing.
  const ctx = {
    window: {}, console, TextDecoder, TextEncoder, setTimeout, clearTimeout,
    Date, Promise, JSON, Math, Array, Uint8Array, Error, String,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'clink.js'), 'utf8'), ctx);
  const ok = (v) => ctx.window.SidecarCLINK.isNofferString(v);

  assert.equal(ok('noffer1' + 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'.repeat(3)), true);
  assert.equal(ok('noffer1qqsrf5h4ya83jk8u6t9jgc76h6kalz3p'), true, 'an offer containing l is refused');
  assert.equal(ok('noffer1llllllll'), true, 'l is a bech32 character');
  assert.equal(ok('noffer1'), false, 'no data after the separator');
  assert.equal(ok('noffer1bogus'), false, 'b is not a bech32 character');
  assert.equal(ok('lnurl1qpzry9x8'), false, 'an lnurl is not an offer');
  assert.equal(ok('NOFFER1QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L'), true, 'case-blind like bech32');
});

test('an empty field removes the offer from the profile', () => {
  // publishProfile deletes empty-valued keys — pinned so the "cleared as easily as
  // set" promise in the editor's hint stays true.
  const fn = lift(/async function publishProfile\(fields, pin\) \{[\s\S]*?\n  \}/, 'publishProfile');
  assert.match(fn, /if \(v\) merged\[k\] = v;\s*else delete merged\[k\];/);
});
