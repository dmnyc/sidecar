'use strict';

// A zap is not a payment to a lightning address.
//
// The difference is one query parameter. Without `nostr`, the provider issues an
// ordinary invoice and, when it settles, nobody publishes anything: the recipient
// finds sats in their wallet with no idea who sent them, no kind 9735 receipt exists,
// and it counts toward no zap total anywhere. With it, the provider commits the signed
// 9734 to the invoice description and publishes a receipt to the relays named in the
// request. That receipt IS the zap.
//
// The first version of the profile sheet called its button "Zap" and sent a plain
// LNURL payment. These tests exist so that cannot come back.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  let paren = 0;
  let i = source.indexOf('(', at);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

const zapFn = stripComments(lift('async function zapInvoice('));

// ---- what makes it a zap -----------------------------------------------------------

test('THE SIGNED REQUEST IS SENT AS THE nostr PARAMETER', () => {
  // The whole difference between a zap and a payment.
  assert.match(zapFn, /searchParams\.set\('nostr', JSON\.stringify\(signed\)\)/, 'no zap request on the callback');
  assert.match(zapFn, /searchParams\.set\('amount'/, 'no amount on the callback');
});

test('the request is a real 9734, built by the library', () => {
  assert.match(zapFn, /NT\.nip57\.makeZapRequest\(/, 'the zap request is hand-rolled');
});

test('it refuses when the provider cannot produce a receipt', () => {
  // allowsNostr + nostrPubkey is what NIP-57 requires of the provider. Without it
  // the sats would arrive and no receipt would ever exist, which is a payment
  // wearing a zap's label.
  assert.match(zapFn, /meta\.allowsNostr && meta\.nostrPubkey/, 'no provider capability check');
  assert.match(zapFn, /throw new Error/, 'an incapable provider is not refused');
});

test('the receipt is aimed at the RECIPIENT\'s relays', () => {
  // The provider publishes the 9735 to the relays named in the request. Ours would
  // put the receipt somewhere they never read.
  assert.match(zapFn, /readRelayUrls\(recipientPubkey\)/, 'the relays tag is not built from the recipient');
});

test('the callback must be https', () => {
  // It carries the amount and the signed request. An http callback hands both to
  // anyone on the path, and is trivially swapped.
  assert.match(zapFn, /cb\.protocol !== 'https:'/, 'an insecure callback is accepted');
});

// ---- authorship --------------------------------------------------------------------

test('a zap is signed by the owner, through the guarded path', () => {
  assert.match(zapFn, /SIDECAR_OWNER_SIGN/, 'a zap does not use the owner signing path');
  assert.match(zapFn, /expectedPubkey: state\.activePubkey/, 'a zap can be signed by the wrong account');
});

test('PUBLIC ONLY — NO HALF-BUILT PRIVACY MODES', () => {
  // Anonymous (ephemeral signing key) and private (sender encrypted into an `anon`
  // tag) were both removed deliberately. Private is not in NIP-57 — the spec lists
  // it under Future Work — nostr-tools does not implement it, and Sidecar's own
  // zapSender reads only the P tag and the description pubkey, so shipping it would
  // mean making a privacy claim our own notifications could not honour, failing
  // silently for the sender.
  //
  // This asserts the SHAPE, not the ambition: if privacy modes come back they come
  // back together and with a reader, at which point this test should be rewritten
  // rather than deleted.
  assert.doesNotMatch(zapFn, /generateSecretKey/, 'an ephemeral signing key reappeared without a reader');
  assert.doesNotMatch(zapFn, /\['anon'\]/, 'an anon tag reappeared without a reader');
  const sheet = stripComments(lift('async function openProfileSheet('));
  assert.doesNotMatch(sheet, /privacy\.value/, 'a privacy picker reappeared');
});

test('zapSender still cannot read an anonymous zap', () => {
  // The fact that justifies the test above. If this ever starts handling `anon`,
  // the privacy modes have a reader and can return.
  const fn = lift('function zapSender(');
  assert.doesNotMatch(fn, /anon/, 'zapSender learned to read anon zaps — revisit the privacy modes');
});

// ---- the caller ---------------------------------------------------------------------

test('the sheet sends zaps, not payments', () => {
  const sheet = stripComments(lift('async function openProfileSheet('));
  assert.match(sheet, /zapInvoice\(\{/, 'the profile sheet still sends a plain payment');
  assert.doesNotMatch(sheet, /lnAddressToInvoice\(/, 'the profile sheet still calls the plain-payment path');
});

test('A SENT ZAP IS RECORDED IN WALLET HISTORY', () => {
  // NWC history keeps the amount and nothing else, so without this the row reads a
  // bare "Sent" with no counterparty. Both other payment paths already record it:
  // the Send form keys address and note by invoice, and background.js records
  // zapPubkey for a zap a website sent through WebLN.
  const sheet = stripComments(lift('async function openProfileSheet('));
  assert.match(sheet, /savePayMeta\(invoice, \{/, 'a sent zap records nothing');
  // zapPubkey is the field that makes txRow read the row as a zap at all —
  // zapFromTx only finds a zap on something RECEIVED, since an outgoing one is a
  // plain invoice we paid.
  assert.match(sheet, /zapPubkey: pubkey/, 'the recipient is not recorded, so the row says Sent');
  assert.match(sheet, /address: zapAddr/, 'the lightning address is not recorded');
});

test('the fee comes from the payment result, not guessed', () => {
  const sheet = stripComments(lift('async function openProfileSheet('));
  assert.match(sheet, /const res = await client\.payInvoice\(invoice\)/, 'the pay result is discarded');
  assert.match(sheet, /feeMsat: res && res\.fees_paid/, 'the fee is not taken from the payment result');
});

test('the zap control only appears for an address that can be zapped', () => {
  const sheet = stripComments(lift('async function openProfileSheet('));
  assert.match(sheet, /p\.zappable/, 'the sheet offers Zap without checking the provider');
});
