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
// BOTH BUTTONS STILL APPEAR. They open the block they would open for somebody with no
// wallet connected: the QR and the copyable address. Withholding the row entirely was
// the first shape of this and it was worse, because handing somebody your zap QR is a
// real reason to open your own sheet. What is withheld is the send form.

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

test('BOTH CONTROLS TAKE THE NO-WALLET BRANCH, NOT JUST THE ZAP', () => {
  // Two buttons sit in that row and they open their blocks through different code: the
  // zap picks its panel at reveal, the offer picks its branch at click. Switching one
  // leaves the other handing you a send form pointed at your own address.
  const zapPick = bare.match(/zapPanel = \(zapHasWallet && !isSelf\)[\s\S]{0,140}/);
  assert.ok(zapPick, 'the zap panel no longer forces the handoff block for your own profile');
  assert.match(zapPick[0], /zapPayBlock\(zapAddr, isSelf \?/);

  const offerFn = bare.slice(bare.indexOf('async function openOfferPanel(offer)'));
  assert.match(offerFn.slice(0, 900), /if \(!zapHasWallet \|\| isSelf\) \{/,
    'the offer still opens its pay form on your own profile');
});

test('the send form is what is withheld, and only that', () => {
  // The buttons themselves must still be revealed. Withholding the row was the first
  // shape of this and it was wrong: showing somebody your own zap QR is the reason to
  // open your own sheet at all.
  for (const fn of ['function revealZap()', 'function revealOffer(offer)']) {
    const at = bare.indexOf(fn);
    assert.ok(at > -1, fn + ' moved');
    assert.doesNotMatch(bare.slice(at, at + 260), /if \(isSelf\) return;/,
      fn + ' withholds the button instead of switching the branch behind it');
  }
});

test('NO CONNECT-A-WALLET LINE ON YOUR OWN PROFILE', () => {
  // The handoff block ends with "Connect a wallet to zap from here", which is addressed
  // to somebody who has none. On your own sheet it is wrong twice over: you are not
  // missing a wallet, and connecting one would not let you do the thing it offers.
  const zapPick = bare.match(/const selfPay = \{[^}]*\}/);
  assert.ok(zapPick, 'selfPay options moved');
  assert.match(zapPick[0], /hideConnect: true/);
  assert.match(zapPick[0], /hint: '[^']+'/, 'the hint still addresses a payer, not you');

  const offerFn = bare.slice(bare.indexOf('async function openOfferPanel(offer)'));
  assert.match(offerFn.slice(0, 900), /offerPayBlock\(offer, isSelf[\s\S]{0,120}hideConnect: true/);
});

test('and the provider is never asked about your own address', () => {
  // Zappability decides whether a button may promise a RECEIPT. The block your own
  // profile opens is a plain lightning: QR that any wallet can pay regardless, so the
  // lookup would be a disclosure bought for a question already answered.
  assert.match(bare, /if \(isSelf\) \{[\s\S]{0,120}zapZappable = true;\s*\n\s*revealZap\(\);\s*\n\s*\} else \{\s*\n\s*lnAddressParams/,
    'the zappability lookup still runs on your own profile');
});

test('the address is still shown and still copies', () => {
  assert.match(bare, /lud\.title = 'Copy lightning address';/);
  const at = bare.indexOf("lud.title = 'Copy lightning address';");
  assert.doesNotMatch(bare.slice(at - 300, at), /if \(isSelf\) return;/,
    'the copy line got swept up in the payment gate');
});
