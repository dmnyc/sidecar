'use strict';

// Motion on the panel's four busiest surfaces: every modal, the account menu, toasts, and
// the tab bar's underline.
//
// The CSS is the easy half. What is checked here is the four things that were wrong in the
// first attempt at it, each of which is invisible in a screenshot and obvious in use:
//
//   1. closeModal() emptied the card and hid the overlay immediately. .hidden is
//      display:none, so a close animation added on top of that plays inside an element
//      nobody can see. The whole teardown has to wait for the dip.
//   2. Deferring the teardown creates a worse bug than it fixes, because
//      `closeModal(); openSomethingElse()` is a real pattern here: About to Donate, the
//      confirm sheets, the mark on the About card. The timer must not fire into a modal
//      that opened after it was scheduled.
//   3. The account menu's open/closed test asked about .hidden, which stays false for the
//      150ms the menu is dipping out. Clicking the button in that window closed an
//      already-closing menu instead of reopening it.
//   4. The tab underline measured once at startup. The panel can open on onboarding or the
//      lock screen with the main view hidden, and a hidden bar measures zero, which parks
//      the mark at the origin at zero width until the first click.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const panelHtml = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
const bareCss = css.replace(/\/\*[\s\S]*?\*\//g, '');

const closeModalFn = (() => {
  const src = stripComments(panel);
  const at = src.indexOf('function closeModal()');
  assert.ok(at !== -1, 'closeModal moved');
  return src.slice(at, src.indexOf('\n  }', at));
})();

test('THE MODAL TEARDOWN WAITS FOR THE DIP, ALL OF IT', () => {
  // Hiding the overlay on the spot would mean the close animation plays inside a
  // display:none element: correct in the computed styles, invisible on screen.
  assert.match(closeModalFn, /classList\.add\('is-closing'\)/, 'the card never enters the closing state');
  const timerAt = closeModalFn.indexOf('setTimeout');
  assert.ok(timerAt !== -1, 'the teardown is not deferred at all');
  for (const step of ["modal.innerHTML = ''", "hide($('modal-overlay'))", "classList.remove('modal-open')"]) {
    assert.ok(closeModalFn.indexOf(step) > timerAt,
      step + ' still runs immediately, so the dip happens where it cannot be seen');
  }
});

test('A CLOSE FOLLOWED BY AN OPEN DOES NOT WIPE THE NEW MODAL', () => {
  // The pattern is real and there are several of it. Without the generation check this
  // timer fires 150ms later and empties the node, hides the overlay and drops modal-open
  // out from under whatever opened in between.
  assert.match(closeModalFn, /const gen = modalGeneration;/, 'the close captures no generation');
  assert.match(closeModalFn, /if \(gen !== modalGeneration\) return;/, 'the deferred teardown is unguarded');
  assert.match(stripComments(panel), /modalGeneration\+\+;/, 'nothing ever bumps the generation');

  // And the pattern it protects is still in the code, so this is not a guard against
  // something hypothetical.
  const reopeners = [...stripComments(panel).matchAll(/closeModal\(\); *[a-zA-Z_$][\w$]*\(/g)];
  assert.ok(reopeners.length >= 3,
    'close-then-open disappeared; if it is really gone the guard can go too, but check first');
});

test('the account menu knows the difference between closing and closed', () => {
  const src = stripComments(panel);
  assert.match(src, /const acctMenuOpen = \(\) => \{/, 'there is no single open test');
  assert.match(src, /!menu\.classList\.contains\('is-closing'\)/, 'the closing window counts as open again');
  // Both the toggle and the click-outside have to use it, or one of them keeps the old bug.
  assert.match(src, /if \(acctMenuOpen\(\)\) closeAcctMenu\(\);/, 'the toggle does not use the shared test');
  assert.match(src, /if \(acctMenuOpen\(\) && !menu\.contains\(e\.target\)/, 'the click-outside does not use it');
});

test('THE TRAVELING UNDERLINE IS ONE MECHANISM, ON EVERY BAR THAT HAS ONE', () => {
  const src = stripComments(panel);

  // Three bars carried the identical mark: the main tabs, the Activity sub-tabs
  // (Connected sites / Recent activity), and the theme gallery's Dark and Light. Each drew
  // a 2px gradient at a 16% inset from an ::after on whichever item was active, so each
  // blinked from one position to the next. One of them getting a traveling mark and the
  // other two keeping the blink is worse than none of them having it, because then the
  // panel disagrees with itself.
  assert.match(src, /function wireTabSlider\(nav, itemSelector\)/, 'the shared mechanism is gone');
  for (const [nav, item] of [
    ["document.querySelector\\('\\.tabs'\\)", '\\.tab'],
    ["\\$\\('activity-subtabs'\\)", '\\.modal-tab'],
    ["document.querySelector\\('\\.theme-modes'\\)", '\\.theme-mode'],
  ]) {
    assert.match(src, new RegExp('wireTabSlider\\(' + nav + ", '" + item + "'\\)"),
      item.replace(/\\/g, '') + ' is not wired to the shared slider');
  }

  // And no bar may still draw its own, or it gets two marks.
  assert.doesNotMatch(bareCss, /active::after/, 'a bar still draws a per-item underline as well');

  // First paint and resize must not animate: the mark sliding in from zero width every
  // time the panel is dragged wider reads as a state change that did not happen.
  assert.match(src, /new ResizeObserver\(\(\) => \{ if \(nav\.offsetWidth\) move\(null, false\); \}\)/,
    'the underline is measured once and never again, so a hidden bar parks it at zero');
  assert.match(src, /void slider\.offsetWidth;/, 'no reflow, so restoring the transition replays the jump');

  // The theme bar's selection also changes on open, where there is no click to delegate
  // from, so it has to be able to reach the mover without a click.
  // The theme bar is the one that fires its own handler BEFORE the bar's delegated one,
  // because the button is the click target and the bar is its ancestor. Moving without
  // animation there snapped the mark to the new segment and left the delegated move with
  // nothing to travel, so this bar alone did not animate. The flag is the whole fix: false
  // while painting the gallery, true on a tap.
  assert.match(src, /function showThemeMode\(mode, animate\)/, 'showThemeMode cannot tell a tap from a paint');
  assert.match(src, /modes\.moveSlider\(null, !!animate\)/, 'the theme bar snaps instead of traveling');
  assert.match(src, /showThemeMode\(b\.dataset\.mode, true\)/, 'a tap on the theme bar does not animate');
  assert.match(src, /showThemeMode\(active\.dataset\.mode \|\| 'dark'\)\;/, 'painting the gallery animates the mark across');
  assert.match(src, /nav\.moveSlider = move;/, 'the mover is unreachable from outside the wiring');

  // All three containers need their own positioning context or the mark measures against
  // the wrong box.
  assert.match(bareCss, /\.tabs, \.modal-tabs, \.theme-modes \{ position: relative; \}/,
    'a bar is missing its positioning context');
});

test('every surface that now moves can be told not to', () => {
  // The panel already held this line before any of this landed: eleven reduced-motion
  // blocks across the stylesheet. Four more surfaces move now, and each one needs its own.
  for (const sel of ['.modal', '.acct-menu', '.toast', '.tab-slider']) {
    const guards = [...bareCss.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([^}]*)\}/g)]
      .map((m) => m[1]);
    assert.ok(guards.some((g) => g.includes(sel)),
      sel + ' moves but has no prefers-reduced-motion guard');
  }
});

test('the timings live in one place and the code reads them from it', () => {
  // A duration repeated in JS drifts from the one in CSS the first time either is tuned.
  assert.match(stripComments(panel), /getPropertyValue\('--modal-close-dur'\)/, 'the modal close delay is hardcoded');
  assert.match(stripComments(panel), /getPropertyValue\('--dropdown-close-dur'\)/, 'the menu close delay is hardcoded');
  const root = bareCss.slice(bareCss.indexOf(':root {'), bareCss.indexOf('\n}', bareCss.indexOf(':root {')));
  for (const token of ['--modal-open-dur', '--modal-close-dur', '--dropdown-close-dur', '--toast-open', '--tabs-dur']) {
    assert.ok(root.includes(token), token + ' is not defined in :root');
  }
});
