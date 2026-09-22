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

// ---- your own offer, on your own profile ----------------------------------------
//
// It was written in the editor and then visible nowhere. profileOffer had exactly one
// caller, the sheet you get when you open SOMEBODY ELSE, so the only way to read back
// what you had published was to reopen the editor and expand a collapsed disclosure. The
// lightning address had a line on the profile the whole time; the offer is the same kind
// of fact and is the one that was missing.

const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const stripComments = (s) =>
  s.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');

test('BOTH WAYS YOU CAN BE PAID SIT ON THE PROFILE, BUILT THE SAME WAY', () => {
  const bare = stripComments(src);
  assert.match(bare, /if \(content\.lud16\) body\.append\(payLine\(content\.lud16, boltIcon\(\), 'Lightning address'\)\);/,
    'the address is no longer a payment line');
  assert.match(bare, /const ownOffer = profileOffer\(content\);/);
  assert.match(bare, /payLine\(ownOffer\.raw, boltIcon\(\), 'CLINK offer', truncMid\(ownOffer\.raw, 18, 6\)\)/,
    'the offer has no line on the profile');

  // THE SAME GLYPH ON BOTH. They drew two different lightning bolts, the panel's filled
  // one for the address and the feather outline for the offer, which also put the two
  // lines a couple of pixels out of alignment: 55x94 and 24x24 at equal height are not
  // equal widths, so the text started at two different offsets.
  assert.equal((bare.match(/payLine\([^)]*boltIcon\(\)/g) || []).length, 2,
    'the two payment lines are not drawing the same icon');
  assert.doesNotMatch(bare, /payLine\([^)]*icon\('zap'\)/, 'the offer line is back on a different bolt');

  // MID-TRUNCATED, and at the same 18/6 the handoff button uses, so an offer reads the
  // same wherever it is shown. 101 characters become 25. The head identifies it at a
  // glance and the tail is what you check a paste against; trailing off after the first
  // forty would give you neither.
  const truncMid = (s, h, t) => (s.length > h + t + 1 ? s.slice(0, h) + '…' + s.slice(-t) : s);
  const raw = 'noffer1qqsrf5h4ya83jk8u6t9jgc76h6kalz3plp9vu7x9m2qd8sczq4jkl2mnpwvhkcmn4d3jkuemvda5k7atww35hgnnzv9ex2';
  assert.equal(truncMid(raw, 18, 6), 'noffer1qqsrf5h4ya8…zv9ex2');
  assert.equal(truncMid(raw, 18, 6).length, 25);
  // The shipped helper takes the same arguments as the one the handoff already passes.
  assert.match(bare, /label: raw\.length > 28 \? raw\.slice\(0, 18\) \+ '…' \+ raw\.slice\(-6\) : raw,/,
    'the handoff label changed its cut, so the two now disagree');

  // THE RAW STRING, not the decoded object. A wallet that is not this one wants the
  // offer exactly as its owner wrote it, and `[object Object]` is what the other
  // property would put on the clipboard.
  assert.doesNotMatch(bare, /payLine\(ownOffer,/, 'the decoded object is being copied instead of the string');

  // Read through profileOffer, so a field that does not decode shows nothing rather than
  // a broken line. Same treatment the sheet gives a stranger's malformed offer.
  assert.match(bare, /function profileOffer\(content\) \{/);
});

test('ONE TAP COPIES AND OPENS THE CODE', () => {
  const fn = lift(/function payLine\(value, iconEl, label, display\) \{[\s\S]*?\n  \}/, 'payLine');
  // THE FULL VALUE IS WHAT TRAVELS. `display` shortens the line and nothing else: a
  // truncated offer on the clipboard or inside the QR is a payment address with a hole
  // in it, which fails at a stranger's wallet rather than here.
  assert.match(fn, /textContent: display \|\| value/);
  assert.doesNotMatch(fn, /copyPlain\(display\)|openPayQr\(display/, 'the shortened string is being copied or encoded');
  // Both halves of the gesture, and the copy first: the clipboard write is the part
  // somebody is most likely to have meant, so it must not wait on a modal building.
  assert.match(fn, /await copyPlain\(value\)/);
  assert.match(fn, /openPayQr\(value, label\)/);
  assert.ok(fn.indexOf('copyPlain') < fn.indexOf('openPayQr'), 'the modal opens before the copy');
  // A failed clipboard write still shows the code. Falling out of the handler would mean
  // a denied permission took the QR with it.
  assert.match(fn, /try \{ await copyPlain\(value\); \} catch \(_\) \{\}/);
  // It is a button, not a div with a click handler: keyboard and screen readers get it
  // for free, and the panel has a dozen of these already.
  assert.match(fn, /h\('button', \{ className: 'profile-meta profile-pay-line'/);
});

test('the code is a lightning URI, for an offer as much as an address', () => {
  const fn = lift(/function openPayQr\(value, label\) \{[\s\S]*?\n  \}/, 'openPayQr');
  // What ShockWallet and Zeus read. The pay block in the profile sheet builds its QR the
  // same way, so the two cannot disagree about what a scanner receives.
  assert.match(fn, /SidecarQR\.draw\(canvas, 'lightning:' \+ value/);
  assert.match(fn, /copyPlain\(value\)/, 'the value in the modal cannot be copied');
  assert.match(fn, /Copied ✓/);
  assert.match(fn, /className: 'modal-x'/, 'the modal cannot be closed');
});

test('a long value gives, and the icons do not', () => {
  const rule = css.slice(css.indexOf('.profile-pay-line {'), css.indexOf('.profile-pay-val'));
  const val = css.slice(css.indexOf('.profile-pay-val {'), css.indexOf('\n', css.indexOf('.profile-pay-val {')));
  // A noffer is about a hundred characters. Without min-width: 0 the span refuses to
  // shrink inside the flex row and the line overflows the panel instead of ellipsizing.
  assert.match(val, /min-width: 0/);
  assert.match(val, /text-overflow: ellipsis/);
  assert.match(val, /white-space: nowrap/);
  // The glyph keeps its metrics; the prose is the only thing that truncates.
  assert.match(rule, /flex-shrink: 0/, 'nothing pins the icons');
  // Button chrome off, or a payment line reads as a form control in a bio.
  assert.match(rule, /border: none/);
  assert.match(rule, /background: none/);
  assert.match(rule, /cursor: pointer/);
});
