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
  assert.match(html, /<div id="lock-clock" class="lock-clock" aria-hidden="true"><\/div>/);
  assert.match(css, /\.lock-clock \{ display: none; \}/);
  assert.match(theme, /\[data-theme="departures"\] #view-lock \.lock-clock \{[^}]*display: block;/);
});
