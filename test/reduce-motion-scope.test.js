'use strict';

// "Reduce motion" means Sidecar's animations — all of them.
//
// It used to scope itself to balances and countdowns, so the loudest thing in the app —
// a lightning bolt drawn across the whole panel, and across the page — kept firing at
// someone who had just asked for less movement. The separate "Payment animation" switch
// stays, because wanting no bolt is not the same as wanting no animation anywhere; it is
// now the narrower of the two rather than the only one that reaches the bolt.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const background = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');

test('the panel bolt is gated by Reduce motion as well as its own switch', () => {
  const fn = panel.slice(panel.indexOf('function lightningStrike()'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /if \(!zapFlash\) return;/, 'its own switch');
  assert.match(body, /if \(reduceBalanceMotion\) return;/, 'and Reduce motion');
  // The OS preference was already honored and must stay — it is a third, independent
  // reason to skip, not a substitute for either.
  assert.match(body, /prefers-reduced-motion: reduce/);
});

test('the page bolt is gated too, and still decided in the background', () => {
  // BOTH halves, or the setting is only half true: the in-panel bolt covers payments
  // started here, the page bolt covers a zap from a client's own UI.
  const fn = background.slice(background.indexOf('async function notifyTabsPaidByHost'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /if \(settings\.zapFlash === false\) return;/);
  assert.match(body, /if \(settings\.reduceBalanceMotion === true\) return;/);
  // It must NOT move into the content script. The page-facing settings read is clamped
  // to showPayButton deliberately; widening it hands every visited site another config
  // bit to fingerprint, which is a worse trade than the flash.
  const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  assert.doesNotMatch(content, /reduceBalanceMotion/, 'the page must not learn this setting');
});

test('the narrower switch is disabled rather than left doing nothing', () => {
  // The shape of #208: a control that reads as live and changes nothing when flipped.
  // With Reduce motion on, the bolt is already suppressed, so this one is inert.
  assert.match(panel, /function syncFlashRow\(\) \{/);
  const fn = panel.slice(panel.indexOf('function syncFlashRow()'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /flash\.disabled = reduceBalanceMotion;/);
  assert.match(body, /flash\.title = reduceBalanceMotion \?/, 'and it should say why');
  // Kept in sync in both places it can change: the settings render, and the switch above.
  assert.ok((panel.match(/syncFlashRow\(\);/g) || []).length >= 2, 'render + on change');
});

test('the copy no longer scopes the toggle to balances and countdowns', () => {
  const i = html.indexOf('<h3>Reduce motion</h3>');
  assert.notEqual(i, -1);
  const block = html.slice(i, i + 400);
  assert.match(block, /lightning bolt on payments/, 'the hint must name what it now covers');
  assert.doesNotMatch(
    block,
    /Turn off balance and countdown animations/,
    'the old label promised less than the toggle now does'
  );
});
