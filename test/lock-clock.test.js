'use strict';

// Departures' station clock on the lock screen: drawn and run only there, and stopped
// whenever the views change, so no timer outlives the lock screen.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const js = strip(fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8'));
const css = strip(fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8'));
const theme = strip(fs.readFileSync(path.join(ROOT, 'themes', 'departures.css'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');

test('the clock stops on the line that hides every view', () => {
  assert.match(js, /\$\('view-approval'\)\]\.forEach\(hide\);\s*stopLockClock\(\);/);
});

test('it starts only as the lock screen shows, and only under Departures', () => {
  assert.match(js, /show\(\$\('view-lock'\)\);\s*startLockClock\(\);/);
  const start = js.slice(js.indexOf('function startLockClock('), js.indexOf('function stopLockClock('));
  assert.match(start, /stopLockClock\(\);/, 'a restart clears the running timer first');
  assert.match(start, /getAttribute\('data-theme'\) !== 'departures'\) return;/);
});

test('it steps on the second, and the timer is cleared when it stops', () => {
  const start = js.slice(js.indexOf('function startLockClock('), js.indexOf('function stopLockClock('));
  assert.match(start, /setTimeout\(tick, 1000 - now\.getMilliseconds\(\)\)/);
  const stop = js.slice(js.indexOf('function stopLockClock('));
  assert.match(stop.slice(0, 200), /clearTimeout\(lockClockTimer\); lockClockTimer = null;/);
});

test('the slot is hidden in every theme but Departures, and hidden from screen readers', () => {
  assert.match(html, /<div class="lock-station" aria-hidden="true"><div id="lock-clock" class="lock-clock"><\/div><div id="lock-board" class="lock-board"><\/div><\/div>/);
  assert.match(css, /\.lock-station \{ display: none; \}/);
  assert.match(theme, /\[data-theme="departures"\] #view-lock \.lock-station \{[^}]*display: block;/);
});

test('the board turns between two pages of the next eight departures', () => {
  assert.match(js, /const BOARD_PAGE_MS = 20000;/);
  const start = js.slice(js.indexOf('function startLockClock('), js.indexOf('function stopLockClock('));
  assert.match(start, /Math\.floor\(now\.getTime\(\) \/ BOARD_PAGE_MS\) % 2/);
  assert.match(start, /boardRows\(now, 8\)/);
  assert.match(start, /rows\.slice\(page \* 4, page \* 4 \+ 4\), rows\[0\]/);
});

test('the next train takes the yellow edge in its last five minutes', () => {
  const paint = js.slice(js.indexOf('function paintBoard('), js.indexOf('function startLockClock('));
  assert.match(paint, /next\.at - now <= 5 \* 6e4/);
  assert.match(paint, /line\.classList\.toggle\('lb-boarding', !!boarding && d === next\)/);
  assert.doesNotMatch(paint, /lb-status/);
});

test('with motion reduced the second hand is left out and nothing flips', () => {
  assert.match(theme, /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.lock-clock \.lc-sec \{ display: none; \}/);
  assert.match(theme, /html\.reduce-balance-motion\[data-theme="departures"\] \.lock-clock \.lc-sec \{ display: none; \}/);
  const paint = js.slice(js.indexOf('function paintBoard('), js.indexOf('function startLockClock('));
  assert.match(paint, /if \(reduceBalanceMotion\) return;/);
});
