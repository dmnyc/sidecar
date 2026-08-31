'use strict';

// Arming an account row used to be a trap.
//
// Clicking a non-active account in the Accounts tab does not switch to it — it arms a
// confirm, rewriting the row's own two lines to "Set as active?" / "Tap again to
// confirm". That two-tap gate is deliberate and stays. What was missing is the way OUT:
// the second tap performs the switch, so it cannot also be the cancel, and the only
// things that cleared an armed row were arming a DIFFERENT row or leaving the tab.
// Neither is available or discoverable when you have one other account and you have just
// changed your mind.
//
// The fix puts a cancel in the row's action slot for exactly as long as the row is armed,
// replacing the "..." menu button rather than joining it. That is the panel's own grammar
// (see CLAUDE.md): .item-actions is flex-shrink: 0, so one icon swapped for another costs
// no width, where a second button would take it from the name beside it.
//
// Source assertions: accountRow builds DOM inside a closure over the panel's whole state,
// and there is no DOM in node. The behavior was exercised in a browser harness against
// the real function — arm shows the cancel, cancel restores the menu and fires no switch,
// a second tap still switches, arming another row restores the first row's menu.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

// Just the accountRow function, so nothing below matches some other row builder.
function accountRowSource() {
  const start = panel.indexOf('  function accountRow(a) {');
  assert.notEqual(start, -1, 'accountRow not found in sidepanel.js');
  let depth = 0;
  for (let i = start; i < panel.length; i++) {
    if (panel[i] === '{') depth++;
    else if (panel[i] === '}' && --depth === 0) return panel.slice(start, i + 1);
  }
  throw new Error('accountRow braces never balanced');
}
const row = accountRowSource();

test('an armed row offers a cancel', () => {
  assert.match(
    row,
    /const cancelBtn = iconButton\('Cancel', 'x',/,
    'the armed row needs a cancel in its action slot'
  );
  // It must not bubble into the row's own activate handler, which would confirm the
  // switch the user is trying to back out of — the worst possible outcome for this button.
  const btn = row.slice(row.indexOf('const cancelBtn'));
  assert.match(
    btn.slice(0, btn.indexOf('});')),
    /e\.stopPropagation\(\)/,
    'cancel must not bubble — without this it could confirm the switch it is canceling'
  );
});

test('the cancel replaces the menu rather than joining it', () => {
  // Both directions, and replaceChild rather than append: the slot holds exactly one
  // button at a time. A second button in a ~360px panel takes width from the name.
  assert.match(
    row,
    /actions\.replaceChild\(cancelBtn, moreBtn\)/,
    'arming must swap the menu out for the cancel'
  );
  assert.match(
    row,
    /actions\.replaceChild\(moreBtn, cancelBtn\)/,
    'resetting must swap the cancel back out for the menu'
  );
  assert.doesNotMatch(row, /actions\.appendChild\(cancelBtn\)/, 'the cancel is a swap, not an addition');
});

test('the swap-back lives in resetRow, so every path out restores the menu', () => {
  // resetRow is also what other rows call through row._resetRow when they arm. If the
  // swap-back lived in the cancel handler instead, arming a second row would clear the
  // first row's text but strand it showing a cancel for a confirm that is no longer live.
  const reset = row.slice(row.indexOf('function resetRow()'));
  const body = reset.slice(0, reset.indexOf('\n      }'));
  assert.match(body, /replaceChild\(moreBtn, cancelBtn\)/, 'resetRow must restore the menu button');
  assert.match(row, /row\._resetRow = resetRow;/, 'other rows reset this one through _resetRow');
});

test('the action slot is built before the confirm wiring that swaps it', () => {
  // Ordering hazard: the confirm closes over moreBtn and actions. They used to be created
  // after this block, which put them in the temporal dead zone at definition time — it
  // happens to work because the handlers only run after accountRow returns, but it reads
  // as a bug and breaks the moment anything calls them earlier.
  assert.ok(
    row.indexOf('const moreBtn = iconButton(') < row.indexOf('const cancelBtn = iconButton('),
    'moreBtn must be created before the cancel that replaces it'
  );
  assert.ok(
    row.indexOf('const isActive =') < row.indexOf("actions.className = 'item-actions'"),
    'isActive is read while building the slot, so it must be declared first'
  );
});

// ---- the OTHER surface: the header dropdown --------------------------------------
//
// Two places render an account switcher and both arm a two-tap confirm. This one was
// left alone at first on the reasoning that it already had an escape — it closes on
// outside click and is rebuilt on open. True, and beside the point: the way out has to be
// visible in the row that is asking.
//
// It also could not simply copy the Accounts tab, because the row WAS a <button> with the
// click handler on it. That ruled out the trailing slot twice over: a <button> inside a
// <button> is invalid, and a cancel inside the clickable region would bubble into the
// row's own handler, find acct-row-pending, and confirm the switch it exists to call off.
//
// So the row became a container and the handler moved inward to .acct-row-main — the
// shape the Accounts tab always had. The cancel now sits exactly where the check sits.

function acctMenuSource() {
  const start = panel.indexOf('  function buildAcctMenu() {');
  assert.notEqual(start, -1, 'buildAcctMenu not found');
  let depth = 0;
  for (let i = start; i < panel.length; i++) {
    if (panel[i] === '{') depth++;
    else if (panel[i] === '}' && --depth === 0) return panel.slice(start, i + 1);
  }
  throw new Error('buildAcctMenu braces never balanced');
}
const menu = acctMenuSource();

test('the dropdown row is a container, not the button itself', () => {
  // The whole reason the trailing slot is usable.
  assert.match(menu, /const row = h\('div', \{ className: 'acct-row'/);
  assert.match(menu, /const main = h\(isActive \? 'div' : 'button', \{ className: 'acct-row-main' \}/);
  assert.match(menu, /main\.addEventListener\('click'/, 'the switch handler moved inward');
  assert.doesNotMatch(menu, /row\.addEventListener\('click'/, 'and must not be on the row again');
});

test('the switchable row stays a real button, so it stays keyboard-reachable', () => {
  // It was a <button> before this change and got focus and Enter for free. Losing that to
  // a styling rearrangement would be a bad trade, which is why main is a button rather
  // than the row carrying a role. The ACTIVE row is a div: it does nothing, and a
  // focusable element that ignores you is worse than one that is not there.
  assert.match(menu, /isActive \? 'div' : 'button'/);
});

test('the cancel goes in the slot beside the check, as a sibling of the clickable part', () => {
  assert.match(menu, /function armCancel\(row, a\) \{/);
  assert.match(menu, /cancel\.classList\.add\('acct-row-cancel'\);/);
  assert.match(menu, /row\.append\(cancel\);/, 'appended to the row, not to the clickable main');
  assert.doesNotMatch(menu, /main\.append\(cancel\)/, 'inside main it would bubble into the switch');
});

test('THE DROPDOWN CANCEL MUST NOT CONFIRM THE SWITCH', () => {
  const fn = menu.slice(menu.indexOf('function armCancel'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.match(body, /e\.stopPropagation\(\);/);
  assert.match(body, /resetRow\(row, a\);/);
});

test('clearing a row takes its cancel with it', () => {
  // resetRow is what other rows call when THEY arm, so a stale cancel would be left in
  // the slot of a row that is no longer asking anything.
  const fn = menu.slice(menu.indexOf('function resetRow(row, a)'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.match(body, /row\.querySelector\('\.acct-row-cancel'\)/);
  assert.match(body, /if \(c\) c\.remove\(\);/);
  assert.match(body, /if \(pendingRow === row\) pendingRow = null;/, 'and the pending marker is cleared');
});
