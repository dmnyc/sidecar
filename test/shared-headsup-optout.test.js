'use strict';

// The shared-identity "Heads up!" can be silenced for good (#340).
//
// "Got it" only ever collapsed the explainer into a caption that never ended, and
// users who had long since understood the choice asked for the note to go away
// altogether. The opt-out lives in chrome.storage.local beside the dismissal —
// per-browser UI state, not account data — is written by a "Don't show this again"
// action on the card itself, and suppresses BOTH the explainer and the caption in
// BOTH surfaces (prompt window and panel sheet). The confirm and its account picker
// are never silenced: the opt-out answers the explanation, not the question.
//
// The race is fixed on the way past: both flags resolve before the first render,
// where an async read used to re-show a dismissed explainer.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const prompt = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');
const panelHtml = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

for (const [name, src] of [['sidepanel.js', panel], ['prompt.js', prompt]]) {
  test(name + ': opted out, no note at all — in either form', async () => {
    const m = src.match(/async function renderSharedNote\(d(?:ata)?\) \{[\s\S]*?\n  \}/);
    assert.ok(m, 'renderSharedNote not found in ' + name);
    const fn = m[0];
    assert.match(fn, /await sharedHeadsUpReady;/, 'the flags must resolve before a branch is taken');
    assert.match(fn, /if \(sharedHeadsUp\.optedOut\) return;/, 'the opt-out must silence explainer and caption alike');
    // And only the note: the relabel of the switch toggle happens first, so the
    // confirm's own affordances survive the opt-out.
    assert.ok(fn.indexOf("textContent = 'Sign as a different account';") < fn.indexOf('if (sharedHeadsUp.optedOut) return;'),
      'the opt-out must not take the account picker with it');
  });

  test(name + ": the card carries the don't-show-again answer", () => {
    assert.match(src, /Don't show this again/);
    assert.match(src, /chrome\.storage\.local\.set\(\{ sharedHeadsUpOptOut: true \}\)/);
    assert.match(src, /shared-headsup-btn-quiet/, 'the refusal must be the quiet control');
    // Got it still only dismisses — the two answers must not have merged.
    assert.match(src, /chrome\.storage\.local\.set\(\{ sharedHeadsUpDismissed: true \}\)/);
  });

  test(name + ': both flags load together, before anything renders', () => {
    assert.match(src, /chrome\.storage\.local\.get\(\['sharedHeadsUpDismissed', 'sharedHeadsUpOptOut'\]/);
    // The old single-flag read is gone, not merely supplemented.
    assert.doesNotMatch(src, /get\('sharedHeadsUpDismissed',/);
  });
}

test('the opt-out is recoverable, from Settings', () => {
  // A decision like "never show me this again" needs a way back that is not editing
  // storage by hand. The Apps & browsing section restores both flags at once, so the
  // one-time explainer returns as if never seen.
  assert.match(panelHtml, /id="headsup-restore"/);
  assert.match(panel, /headsup-restore'\)\.addEventListener\('click'/);
  assert.match(panel, /chrome\.storage\.local\.remove\(\['sharedHeadsUpDismissed', 'sharedHeadsUpOptOut'\]\)/);
  assert.match(panel, /sharedHeadsUp = \{ dismissed: false, optedOut: false \};/, 'the panel memo must refresh with the store');
});

test('the two answers sit on one row, the quiet one un-filled', () => {
  assert.match(css, /\.shared-headsup-actions \{ display: flex/);
  assert.match(css, /\.shared-headsup-btn-quiet \{[^}]*background: none/);
});
