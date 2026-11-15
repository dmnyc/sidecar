'use strict';

// YOU CANNOT ZAP YOURSELF FROM YOUR OWN PROFILE SHEET.
//
// Opening your own profile from search used to offer Zap and Pay offer like anyone
// else's. Pressing either would move sats out of your wallet, pay a routing fee, and
// land them at your own address, and the zap would publish a receipt of you paying
// yourself to your relays.
//
// ONLY THE ACCOUNT YOU ARE SIGNED IN AS. A second account in the keystore is another
// key, and paying it from the active account's wallet is a real zap between two keys,
// which is what holding two accounts is for. The first shape of this compared against
// every key the keystore holds, which made it impossible to zap your own other account
// to try the feature; the test below is what stops it going back.
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

test('ONLY THE ACTIVE ACCOUNT IS YOU; A SECOND ACCOUNT YOU HOLD IS ZAPPABLE', () => {
  assert.equal(isSelf(STATE, ME), true, 'the active account');
  assert.equal(isSelf(STATE, ALSO_ME), false,
    'a second account in the keystore is somebody the active wallet can pay');
  assert.equal(isSelf(STATE, STRANGER), false, 'a stranger is still zappable');
  // Switching accounts moves the line with it.
  assert.equal(isSelf({ ...STATE, activePubkey: ALSO_ME }, ALSO_ME), true);
  assert.equal(isSelf({ ...STATE, activePubkey: ALSO_ME }, ME), false);
});

test('no active account or no state degrades to the old behavior rather than breaking zaps', () => {
  // The cheaper of the two mistakes: offering a zap to somebody who might be you costs a
  // routing fee, while withholding it from everybody removes the feature outright.
  assert.equal(isSelf(null, ME), false);
  assert.equal(isSelf({}, ME), false);
  assert.equal(isSelf({ accounts: [] }, ME), false);
  assert.equal(isSelf({ activePubkey: null }, ME), false);
});

test('BOTH CONTROLS TAKE THE NO-WALLET BRANCH, NOT JUST THE ZAP', () => {
  // Two buttons sit in that row and they open their blocks through different code: the
  // zap picks its panel at reveal, the offer picks its branch at click. Switching one
  // leaves the other handing you a send form pointed at your own address.
  const zapPick = bare.match(/zapPanel = \(zapHasWallet && !isSelf\)[\s\S]{0,140}/);
  assert.ok(zapPick, 'the zap panel no longer forces the handoff block for your own profile');
  assert.match(zapPick[0], /zapPayBlock\(zapAddr, isSelf \?/);

  const offerFn = bare.slice(bare.indexOf('async function openOfferPanel(offer, opts)'));
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
  assert.match(zapPick[0], /hint: tSec\('[^']+'\)/, 'the hint still addresses a payer, not you');

  const offerFn = bare.slice(bare.indexOf('async function openOfferPanel(offer, opts)'));
  assert.match(offerFn.slice(0, 900), /offerPayBlock\(offer, isSelf[\s\S]{0,120}hideConnect: true/);
});

test('IT SAYS WHY THERE IS NO AMOUNT FIELD', () => {
  // Everywhere else this block appears it is because no wallet is connected, and the
  // connect line under it says so. On your own profile the wallet is right there, so the
  // absence of a send form needs its own sentence or it reads as the sheet being broken.
  //
  // "Sending", not "payments": the QR directly above this line is a working payment path.
  // What is off is paying OUT of your own wallet.
  assert.match(bare, /note: t\('Sending is off on your own profile\.'\)/);
  const uses = (bare.match(/note: t\('Sending is off on your own profile\.'\)/g) || []).length;
  assert.equal(uses, 2, 'the zap block and the offer block should both carry it, found ' + uses);

  // Rendered under the hint and above the connect slot, and only when asked for.
  assert.match(bare, /options\.note \? \[h\('p', \{ className: 'hint zap-pay-note'/);
  const block = bare.slice(bare.indexOf('function zapPayBlock('));
  const hintAt = block.indexOf("options.hint ||");
  const noteAt = block.indexOf('options.note ?');
  const connectAt = block.indexOf('options.hideConnect ?');
  assert.ok(hintAt < noteAt && noteAt < connectAt, 'the note is not between the hint and the connect slot');
});

test('and the provider is never asked about your own address', () => {
  // Zappability decides whether a button may promise a RECEIPT. The block your own
  // profile opens is a plain lightning: QR that any wallet can pay regardless, so the
  // lookup would be a disclosure bought for a question already answered.
  assert.match(bare, /if \(isSelf\) \{[\s\S]{0,120}zapZappable = true;\s*\n\s*revealZap\(\);\s*\n\s*\} else \{\s*\n\s*lnAddressParams/,
    'the zappability lookup still runs on your own profile');
});

test('the address is still shown and still copies', () => {
  assert.match(bare, /lud\.title = t\('Copy lightning address'\);/);
  const at = bare.indexOf("lud.title = 'Copy lightning address';");
  assert.doesNotMatch(bare.slice(at - 300, at), /if \(isSelf\) return;/,
    'the copy line got swept up in the payment gate');
});

test('the sheet shows the profile\'s CLINK offer, cut in the middle, tap to copy', () => {
  // Under the lightning address, the same 18/6 cut the Profile tab uses for your own offer,
  // off the content paint() already has. It must not depend on the Pay offer button or on
  // there being a lightning address: a profile can carry an offer alone.
  const at = bare.indexOf('const foundOffer = profileOffer(c);');
  assert.ok(at > -1, 'the sheet no longer reads the offer for display');
  const seg = bare.slice(at, at + 900);
  assert.match(seg, /truncMid\(rawOffer, 18, 6\)/);
  assert.match(seg, /copyPlain\(rawOffer\)/);
  assert.match(bare, /rel, lud, offerLine, about\)/, 'the offer line is not in the sheet body under the address');
  assert.doesNotMatch(bare.slice(at - 120, at), /if \(c\.lud16\)/, 'the offer line sits inside the lightning-address branch');
});
