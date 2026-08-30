'use strict';

// The injected pay card has two variants, and one of them was offering a switch that
// turned off a different feature than the one it named (#208).
//
// Manual card: an invoice was found on the page and the user decides whether to pay.
// Auto card:   Auto Zaps is on, the zap is already going out, and the card is a receipt.
//
// Both rendered "Don't show this prompt again". It writes showPayButton: false, which
// gates only the manual scan-and-show path — the auto card comes straight off the
// worker's `autopaying` event and never reads the setting. So ticking it on an auto-zap
// receipt kept every future auto-zap card coming AND silently removed the manual "Pay
// with Sidecar" card, which the user had not asked to lose.
//
// These are source assertions rather than DOM ones: renderCard builds its markup as a
// string inside a content script that expects `chrome`, a shadow root and a live page,
// and none of that can be stood up in node. What is checked is the shape that was wrong
// — that the toggle is conditional on the variant, and that the listener survives its
// absence.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

test('the show-card toggle is not rendered on an auto card', () => {
  const m = content.match(/\(auto\s*\?\s*''\s*:\s*'<label class="tg">[\s\S]*?tg-showcard-input[\s\S]*?\)/);
  assert.ok(
    m,
    "the \"Don't show this prompt again\" toggle must be gated on `auto`. It writes " +
    'showPayButton: false, which the auto card never consults — so on that card it ' +
    'disables the manual pay card instead of doing what it says (#208).'
  );
});

test('its change listener tolerates the row being absent', () => {
  // Without the optional call, suppressing the row throws while wiring the card up, and
  // takes every other handler on it down — pay, cancel, dismiss.
  assert.match(
    content,
    /querySelector\('\.tg-showcard-input'\)\?\.addEventListener/,
    'the listener must be optional-chained now that the element is conditional'
  );
});

test('the Auto Zaps offer row is still suppressed on an auto card too', () => {
  // The pattern this fix copied. Pinned so the two stay consistent: both rows are about
  // a decision, and an auto card is past the point of deciding.
  assert.match(content, /const canOfferAutoZap = !auto &&/);
});

test('showPayButton still gates only the manual path', () => {
  // The asymmetry that made the bug possible. If the auto path ever starts honouring
  // showCard, the reasoning above changes and this test should be revisited rather than
  // deleted.
  assert.match(content, /if \(!showCard \|\| !connectedToSite\) return removeCard\(\);/);
  const autoPath = content.match(/msg\.event === 'autopaying'[\s\S]{0,400}/)[0];
  assert.ok(
    !/showCard/.test(autoPath),
    'the autopaying handler should not consult showCard — if it starts to, #208 needs rereading'
  );
});
