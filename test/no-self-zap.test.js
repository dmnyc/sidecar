'use strict';

// YOU CANNOT ZAP YOURSELF FROM YOUR OWN PROFILE SHEET.
//
// Opening your own profile from search used to offer Zap and Pay offer like anyone
// else's. Pressing either would move sats out of your wallet, pay a routing fee, and
// land them at your own address, and the zap would publish a receipt of you paying
// yourself to your relays.
//
// EVERY KEY THE KEYSTORE HOLDS COUNTS, not just the active one. A second account is
// equally you, and the comparison being against state.activePubkey rather than the
// whole list is the shape this test exists to catch.
//
// Neither button is DRAWN, rather than drawn and disabled: a control that does nothing
// reads as broken software, and there is nothing to explain that the name and face at
// the top of the sheet have not already said.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const bare = panel.replace(/^\s*\/\/.*$/gm, '');

const SRC = panel.match(/const isSelf = [^\n]*;/)[0];
function isSelf(state, pubkey) {
  const ctx = { state, pubkey };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nglobalThis.out = isSelf;', ctx);
  return ctx.out;
}

const ME = 'a'.repeat(64);
const ALSO_ME = 'b'.repeat(64);
const STRANGER = 'c'.repeat(64);
const STATE = { activePubkey: ME, accounts: [{ pubkey: ME }, { pubkey: ALSO_ME }] };

test('EVERY ACCOUNT YOU HOLD IS YOU, NOT JUST THE ACTIVE ONE', () => {
  assert.equal(isSelf(STATE, ME), true, 'the active account');
  assert.equal(isSelf(STATE, ALSO_ME), true,
    'a second account you hold is equally you; comparing against activePubkey misses it');
  assert.equal(isSelf(STATE, STRANGER), false, 'a stranger is still zappable');
});

test('a missing account list degrades to the old behavior rather than breaking zaps', () => {
  // Deliberate, and the cheaper of the two mistakes. This sheet is reachable only from
  // the panel's own search, so the list is populated in practice; if it somehow were
  // not, offering a zap to somebody who might be you costs a routing fee, while
  // withholding it from everybody removes the feature outright.
  assert.equal(isSelf(null, ME), false);
  assert.equal(isSelf({}, ME), false);
  assert.equal(isSelf({ accounts: [] }, ME), false);
});

test('BOTH PAYMENT CONTROLS ARE GATED, NOT JUST THE ZAP', () => {
  // Two buttons sit in that row and they are revealed by different functions off
  // different answers: the zap off a lightning address the provider says is zappable,
  // the offer off a noffer in the kind 0. Gating one leaves the other.
  for (const fn of ['function revealZap()', 'function revealOffer(offer)']) {
    const at = bare.indexOf(fn);
    assert.ok(at > -1, fn + ' moved');
    const body = bare.slice(at, at + 260);
    assert.match(body, /if \(isSelf\) return;/, fn + ' does not check isSelf');
  }
});

test('and the provider is never asked about your own address', () => {
  // Resolving a lightning address hands a third party the fact that somebody is looking
  // at it. Buying that disclosure for a button that will not be drawn is a request with
  // no purchaser.
  assert.match(bare, /if \(!isSelf\) \{\s*\n\s*lnAddressParams\(c\.lud16\)/,
    'the zappability lookup still runs on your own profile');
});

test('the address is still shown and still copies', () => {
  // Only PAYING is withheld. Reading your own lightning address off your own profile,
  // and copying it, is what that line is for and has nothing to do with self-payment.
  assert.match(bare, /lud\.title = 'Copy lightning address';/);
  const at = bare.indexOf("lud.title = 'Copy lightning address';");
  assert.doesNotMatch(bare.slice(at - 300, at), /if \(isSelf\) return;/,
    'the copy line got swept up in the payment gate');
});
