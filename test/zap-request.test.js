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

// ---- the two privacy modes ---------------------------------------------------------

test('a public zap is signed by the owner, through the guarded path', () => {
  assert.match(zapFn, /SIDECAR_OWNER_SIGN/, 'a public zap does not use the owner signing path');
  assert.match(zapFn, /expectedPubkey: state\.activePubkey/, 'a public zap can be signed by the wrong account');
});

test('AN ANONYMOUS ZAP IS SIGNED BY A THROWAWAY KEY', () => {
  // The anonymity has to come from the key, not from a tag. A client that ignores
  // the `anon` tag must still be unable to tell who sent it — it simply sees a
  // pubkey that exists for this one zap and never again.
  assert.match(zapFn, /NT\.generateSecretKey\(\)/, 'no ephemeral key for anonymous zaps');
  assert.match(zapFn, /NT\.finalizeEvent\(template, sk\)/, 'the anonymous request is not signed locally');
  // And it must NOT reach the owner key on that branch.
  const anonBranch = zapFn.slice(zapFn.indexOf('if (anonymous)'), zapFn.indexOf('} else {'));
  assert.doesNotMatch(anonBranch, /SIDECAR_OWNER_SIGN/, 'an anonymous zap is signed by the real key');
});

test('the anon tag is a label, and the key is the mechanism', () => {
  // `anon` is a convention, not part of NIP-57. If it were doing the work, a client
  // that ignored it would expose the sender.
  assert.match(zapFn, /template\.tags\.push\(\['anon'\]\)/, 'no anon marker for clients that read it');
});

// ---- the caller ---------------------------------------------------------------------

test('the sheet sends zaps, not payments', () => {
  const sheet = stripComments(lift('async function openProfileSheet('));
  assert.match(sheet, /zapInvoice\(\{/, 'the profile sheet still sends a plain payment');
  assert.doesNotMatch(sheet, /lnAddressToInvoice\(/, 'the profile sheet still calls the plain-payment path');
  assert.match(sheet, /anonymous: privacy\.value === 'anon'/, 'the privacy choice is not passed through');
});

test('the zap control only appears for an address that can be zapped', () => {
  const sheet = stripComments(lift('async function openProfileSheet('));
  assert.match(sheet, /p\.zappable/, 'the sheet offers Zap without checking the provider');
});
