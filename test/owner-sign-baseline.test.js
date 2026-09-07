'use strict';

// Sidecar's OWN writes get the wipe check that websites already got.
//
// Kinds 0, 3 and 10000 are replaceable: the event being signed wholly overwrites the
// previous one on every relay, so a short or empty list destroys the real one. That is
// the most common data-loss complaint on Nostr, and replaceable-baseline.js exists to
// catch it before the signature.
//
// It ran in exactly one place: the NIP-07 request path. A website publishing a
// truncating kind 3 was always stopped for confirmation, even on a trusted site and
// even mid-relax window — while SIDECAR_OWNER_SIGN, which is how the panel publishes
// the profile, the relay list and now follows and mutes, went straight to KS.ownerSign
// unexamined.
//
// That is the wrong way round. The argument for doing follows and mutes inside Sidecar
// instead of leaving them to a client is that our path is the careful one, and it
// cannot be the careful one while being the only path with no check at all.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

// Comments in this codebase discuss the very identifiers under test, so strip them
// before asserting on code — a doesNotMatch that reads a comment is vacuous.
const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

function handlerBody(name) {
  const at = bg.indexOf("case '" + name + "': {");
  if (at === -1) throw new Error('no handler for ' + name);
  const end = bg.indexOf('\n      case ', at + 10);
  return bg.slice(at, end === -1 ? at + 4000 : end);
}

// ---- the check runs at all ---------------------------------------------------------

test('THE OWNER SIGN PATH RUNS THE WIPE CHECK', () => {
  const body = stripComments(handlerBody('SIDECAR_OWNER_SIGN'));
  assert.match(body, /BASELINE\.check\(/, 'owner signing skips the destructive-overwrite check');
});

test('it runs BEFORE the signature, not after', () => {
  const body = stripComments(handlerBody('SIDECAR_OWNER_SIGN'));
  const check = body.indexOf('BASELINE.check(');
  const sign = body.indexOf('KS.ownerSign(');
  assert.ok(check !== -1 && sign !== -1);
  assert.ok(check < sign, 'the key is used before the event is judged');
});

test('the check is no longer confined to the site request path', () => {
  // It used to appear exactly once, in the NIP-07 handler. Two call sites is the
  // fix; one means a regression put it back.
  const hits = (stripComments(bg).match(/BASELINE\.check\(/g) || []).length;
  assert.ok(hits >= 2, 'BASELINE.check is called in only ' + hits + ' place(s)');
});

// ---- and it fails closed -----------------------------------------------------------

test('A REFUSED SIGN THROWS RATHER THAN SIGNING', () => {
  // The site path can afford to return a verdict and carry on, because the
  // background is already about to raise a prompt it can attach to. Here there is
  // no site, no permission tier and no prompt, so the only safe answer is to
  // refuse and make the caller come back deliberately.
  const body = stripComments(handlerBody('SIDECAR_OWNER_SIGN'));
  assert.match(body, /if \(finding\)/, 'the finding is not acted on');
  assert.match(body, /throw err/, 'a destructive owner sign is not refused');
});

test('the refusal can only be overridden explicitly', () => {
  const body = stripComments(handlerBody('SIDECAR_OWNER_SIGN'));
  assert.match(body, /message\.confirmedDestructive/, 'no explicit override flag');
  // Absent the flag the check must run — a default-true override would be no guard.
  assert.match(body, /!message\.confirmedDestructive/, 'the override is not opt-in');
});

test('the finding reaches the panel, not just its sentence', () => {
  // So a caller can say "Removes all 1,071 accounts you follow" instead of
  // relaying a bare failure and asking the user to take it on faith.
  assert.match(bg, /destructive: e\.destructive/, 'background drops the finding');
  assert.match(panel, /if \(resp && resp\.destructive\) err\.destructive = resp\.destructive/,
    'the panel discards the finding');
});

// ---- what it must not break --------------------------------------------------------

test('the existing owner-sign callers are unchanged', () => {
  // publishProfile (kind 0) and publishNip65 (kind 10002) already used this path.
  // 10002 is not a guarded kind, and kind 0 only trips when fields are being
  // cleared — so neither should need the override, and neither should have been
  // given it defensively.
  assert.doesNotMatch(
    stripComments(panel).slice(panel.indexOf('async function publishNip65(')).slice(0, 2000),
    /confirmedDestructive/,
    'publishNip65 was given a blanket override'
  );
});

test('a broken check can never block a signature by accident', () => {
  // replaceable-baseline.js promises this in its own comments; the guarantee only
  // holds if check() keeps swallowing its own errors.
  const mod = fs.readFileSync(path.join(ROOT, 'replaceable-baseline.js'), 'utf8');
  const fn = mod.slice(mod.indexOf('async function check('));
  assert.match(fn, /catch \(_\) \{\s*\n?\s*return null;/, 'check() no longer fails open');
});
