'use strict';

// #208: the injected pay card had two variants, and one of them offered a switch that
// turned off a different feature than the one it named.
//
// Manual card: an invoice was found on the page and the user decides whether to pay.
// Auto card:   Auto Zaps is on, the zap is already going out, and the card is a receipt.
//
// Both rendered "Don't show this prompt again". It writes showPayButton: false, which
// gates only the manual scan-and-show path; the auto card came straight off the worker's
// `autopaying` event and never consulted the setting. So ticking it on an auto-zap
// receipt kept every future auto-zap card coming AND silently removed the manual "Pay
// with Sidecar" card, which the user had not asked to lose.
//
// The first fix gated the row on the variant. #270 removed the variant instead: a zap
// already going out gets a corner indicator, not a card, so the card IS the manual path.
// One back door survives that and is gated separately, because it is the same bug: a
// FAILED auto-zap reopens the card to offer the retry, which would have put the switch
// back in front of someone who reached it from the auto path.
//
// These are source assertions rather than DOM ones: renderCard builds its markup as a
// string inside a content script that expects `chrome`, a shadow root and a live page,
// and none of that can be stood up in node.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
const code = content.replace(/^\s*\/\/.*$/gm, '');

function lift(src, decl) {
  const at = src.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

test('THE CARD HAS NO VARIANT LEFT FOR THE TOGGLE TO MISLEAD', () => {
  const card = lift(code, 'function renderCard(');
  assert.match(card, /function renderCard\(invoice, errorText\)/,
    'renderCard took an `auto` flag again, which is the shape #208 grew out of');
  assert.doesNotMatch(card, /Auto-zapping/, 'the card is describing a spend already underway');
  assert.doesNotMatch(card, /class="card' \+ \(auto/, 'the auto variant is back on the card');
});

test('a zap already going out gets the indicator, and the indicator has no settings on it', () => {
  // The whole reason the fix holds structurally now. A corner pill reports; it does not
  // offer, so there is no row on it that could write a setting at all.
  const pill = lift(code, 'function renderFlightPill(');
  assert.doesNotMatch(pill, /tg-showcard-input/, 'the indicator grew the toggle that caused #208');
  assert.doesNotMatch(pill, /tg-autozap/, 'the indicator is offering a decision it is past');
  assert.doesNotMatch(pill, /tg-input/, 'the indicator grew a settings control');
});

test('its change listener tolerates the row being absent', () => {
  // The row is unconditional today and has been conditional before. Without the optional
  // call, suppressing it throws while wiring the card up and takes every other handler on
  // it down with it: pay, cancel, dismiss.
  assert.match(
    content,
    /querySelector\('\.tg-showcard-input'\)\?\.addEventListener/,
    'the listener must stay optional-chained, since the row has been conditional before'
  );
});

test('NEITHER ROW APPEARS ON THE CARD REOPENED TO REPORT A FAILURE', () => {
  // The surviving back door. renderCard(invoice, errorText) is how a payment that failed
  // comes back from the corner indicator to offer its retry, and an auto-zap reaches it
  // the same way a manual one does. Both rows are about a decision for future payments,
  // and the prompt in front of you is a failure report.
  const card = lift(code, 'function renderCard(');
  assert.match(card, /const canOfferAutoZap = !errorText &&/,
    'the Auto Zaps offer is back on the error card');
  assert.match(card, /\(errorText\s*\?\s*''\s*:\s*'<label class="tg">[\s\S]*?tg-showcard-input/,
    'the show-card toggle is back on the error card, which is the #208 shape again');
});

test('the Auto Zaps offer is still only made where there is a decision to attach it to', () => {
  const card = lift(code, 'function renderCard(');
  assert.match(card, /autoZapOffer > 0 && sats != null && sats <= autoZapOffer;/);
  assert.match(card, /tg-autozap-input/, 'the offer row left the card');
});

test('showPayButton still gates only the manual path', () => {
  // The asymmetry that made the bug possible. If the auto path ever starts honouring
  // showCard, the reasoning above changes and this test should be revisited rather than
  // deleted.
  assert.match(content, /if \(!showCard \|\| !connectedToSite\) return removeCard\(\);/);
  const at = content.indexOf("msg.event === 'autopaying'");
  const autoPath = content.slice(at, content.indexOf('} else if', at));
  assert.ok(
    !/showCard/.test(autoPath),
    'the autopaying handler should not consult showCard. If it starts to, #208 needs rereading'
  );
});
