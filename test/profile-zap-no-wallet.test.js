'use strict';

// A lightning address you can actually use, when there is no wallet to use it with.
//
// The profile sheet showed the same zap form to everyone. With no wallet connected you
// picked an amount, wrote a note, pressed Send zap, and the wallet lookup failed at the
// end of all that, with an error telling you to go and connect one. The address was on
// the sheet the whole time, in small dim type with a click handler nobody could see.
//
// So the branch is decided before you touch anything. With a wallet, the form. Without
// one, the address as the label of a button that copies it, and a QR beside it, which is
// the same shape the creator's zap card already uses.
//
// Three things here are worth holding:
//
//   1. BOTH answers before EITHER branch. The profile paints twice (cache, then relays)
//      and the wallet lookup lands whenever it lands. A reveal on first-answer-wins would
//      swap the sheet out from under someone already typing an amount into it.
//   2. A failed wallet lookup is NO wallet. Falling through to the form would rebuild the
//      exact dead end this replaces.
//   3. Still gated on zappable. This changes HOW you pay, never WHO you can pay.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

// The sheet, not the whole file: several other places zap, and matching one of those
// instead would prove nothing about this one.
const sheet = (() => {
  const src = stripComments(panel);
  const at = src.indexOf('async function openProfileSheet(');
  assert.ok(at !== -1, 'openProfileSheet moved');
  return src.slice(at, src.indexOf('async function openProfileFor(', at));
})();

test('the sheet asks whether there is a wallet at all', () => {
  assert.match(sheet, /call\(\{ type: 'SIDECAR_HAS_NWC' \}\)/, 'the sheet never asks about a wallet');
  assert.match(sheet, /let zapHasWallet = null;/, 'there is no third state, so "not yet known" reads as "no wallet"');
});

test('A FAILED WALLET LOOKUP IS NO WALLET', () => {
  // The failure mode that matters: if an unreachable background left this null or threw,
  // the reveal would either never fire or fall through to the form, and the form with no
  // wallet behind it is the dead end this whole change exists to remove.
  assert.match(sheet, /\.catch\(\(\) => \{ zapHasWallet = false; \}\)/, 'a failed lookup does not fall back to no-wallet');
  assert.match(sheet, /\.then\(revealZap\)/, 'the reveal does not run after the lookup settles either way');
});

test('BOTH ANSWERS BEFORE EITHER BRANCH, AND ONLY ONCE', () => {
  const fn = sheet.slice(sheet.indexOf('function revealZap('), sheet.indexOf('function revealZap(') + 400);
  // The guard itself, not merely the word: an assignment further down matches /zapShown/
  // just as happily as the check that makes it mean something.
  assert.match(fn, /if \(zapShown \|\|/, 'the reveal can run twice and rebuild the sheet under the user');
  assert.match(fn, /zapZappable/, 'the reveal does not wait to learn the address is zappable');
  assert.match(fn, /zapHasWallet === null/, 'the reveal runs before the wallet answer arrives');
  assert.match(fn, /modal\.isConnected/, 'the reveal paints into a sheet that may already be closed');
});

test('BOTH BRANCHES SIT BEHIND THE SAME ZAP BUTTON', () => {
  // The button is the constant; what it opens is the variable. Dropping the QR and the
  // address straight onto the sheet turned a profile you had only opened to read into a
  // payment page, which is a different sheet from the one you asked for.
  // `&& !isSelf`: your own profile takes the handoff branch whatever your wallet says,
  // since paying yourself is not a payment. What is asserted here is unchanged, that the
  // send form is reached only by having a wallet and the QR is the other branch.
  assert.match(sheet, /zapPanel = \(zapHasWallet && !isSelf\)\s*\n?\s*\? zapForm\s*\n?\s*: zapPayBlock\(zapAddr/,
    'the two branches are no longer chosen by whether a wallet exists');
  // The Zap button is still unconditional; it just shares a row with Pay offer now, and
  // goes in first because a zap is the route most profiles can take.
  assert.match(sheet, /payRow\.prepend\(zapBtn\);/, 'the Zap button is not always shown');
  assert.match(sheet, /zapWrap\.append\(zapPanel\);/, 'the panel it opens is no longer attached');
  assert.match(sheet, /className: 'recv-out peek-zap-pay hidden'/, 'the pay block is exposed on load again');
  assert.match(sheet, /zapPanel\.classList\.toggle\('hidden'\)/, 'the button no longer opens whichever panel applies');
  // Focus belongs to the form alone; the other panel is a QR and a button.
  assert.match(sheet, /zapPanel === zapForm && !zapForm\.classList\.contains\('hidden'\)/,
    'opening the pay block tries to focus an amount field that is not there');

  const block = sheet.slice(sheet.indexOf('function zapPayBlock('), sheet.indexOf('function revealZap('));
  // `value` rather than `addr` since the block took a second caller: a CLINK offer goes
  // into the same lightning: URI, which is what ShockWallet and Zeus read. An address
  // passed alone still becomes the value, so this branch is unchanged.
  assert.match(block, /SidecarQR\.draw\(canvas, 'lightning:' \+ value/, 'the QR is gone or is not a lightning URI');
  assert.match(block, /const value = options\.value \|\| addr;/, 'an address alone must still work');
  // The address IS the button. A label above a button is two things where one will do, and
  // the small dim line that used to carry it is exactly what nobody found.
  assert.match(block, /className: 'secondary peek-zap-addr',\s*\n\s*textContent: label,/,
    'the address is no longer the label of the button that copies it');
  assert.match(block, /copyPlain\(value\)/, 'the button does not copy the address');
  // label and value are the same thing for an address, and differ only for an offer,
  // which is long enough that nobody reads it across to another device.
  assert.match(block, /const label = options\.label \|\| addr;/);
  assert.match(block, /Copied ✓/, 'copying gives no confirmation');
  assert.match(block, /Connect a wallet to zap from here →/, 'nothing says why the form is absent');
});

test('the connect line goes where it points', () => {
  // It named the Wallet tab and left you to find it. It is a button now, on the same
  // borderless gold link the account card uses for "Add wallet", and it closes the sheet
  // before switching: a tab changed behind an open modal is a tab nobody sees happen.
  const block = sheet.slice(sheet.indexOf('function zapPayBlock('), sheet.indexOf('function revealZap('));
  assert.match(block, /className: 'account-stat-add-link zap-noconnect'/, 'the connect line is not a link');
  assert.match(block, /closeModal\(\);\s*\n\s*const tab = document\.querySelector\('\.tab\[data-tab="wallet"\]'\)/,
    'the sheet is not closed before the tab switches, so nothing appears to happen');
  assert.match(block, /if \(tab\) tab\.click\(\)/, 'it does not open the wallet tab');
});

test('the QR is not hanging off the Zap button', () => {
  assert.match(css, /\.peek-zap-pay \{ margin-top: 14px; \}/, 'the QR sits flush against the button again');
});

test('THE QR SAYS PAY, BECAUSE THAT IS WHAT IT DOES', () => {
  // Worth stating plainly: a lightning: address QR is LNURL-pay in whatever wallet reads
  // it. No zap request is attached, so the provider publishes no kind 9735 and the money
  // arrives as an anonymous payment that appears as a zap to nobody. The first draft of
  // this hint said "zap", which was the copy promising what the protocol was not doing.
  //
  // The second line may say zap, because connecting a wallet is exactly what puts a signed
  // 9734 in front of the invoice.
  const block = sheet.slice(sheet.indexOf('function zapPayBlock('), sheet.indexOf('function revealZap('));
  assert.match(block, /'Scan or copy to pay from any wallet\.'/, 'the QR hint does not say what it does');
  assert.doesNotMatch(block, /to zap from any wallet/, 'the hint calls a plain LNURL payment a zap');
});

test('it still only offers to pay someone who can be paid', () => {
  // The gate is unchanged on purpose: this changes how you pay, not who you can pay. An
  // address with no allowsNostr can take money but can never produce a receipt.
  assert.match(sheet, /if \(!p\.zappable\) return;/, 'the zappable gate went away');
});

test('a long address stays readable and copyable', () => {
  // It is the button's label now, and a lightning address has no length limit. Truncated
  // with an ellipsis it cannot be read off the screen, which is half of what it is for.
  assert.match(css, /\.peek-zap-addr \{[^}]*overflow-wrap: anywhere/s, 'a long address will be clipped');
  assert.match(css, /\.peek-zap-addr \{[^}]*white-space: normal/s, 'a long address cannot wrap');
  assert.doesNotMatch(css, /\.peek-zap-addr \{[^}]*text-overflow: ellipsis/s, 'the address is truncated');
});
