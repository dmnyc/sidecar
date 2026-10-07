'use strict';

// The expanded composer's first paint: the last theme it drew with, set in the head, and
// the card held back until boot has built it, so a refresh does not flash the default
// theme and an empty card first.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function run(stored) {
  const attrs = {};
  const classes = new Set();
  const timers = [];
  vm.runInNewContext(read('compose-boot.js'), {
    localStorage: { getItem: () => stored },
    document: { documentElement: {
      setAttribute: (k, v) => { attrs[k] = v; },
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    } },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
  });
  return { attrs, classes, timers };
}

test('the stored theme is set before the first paint, and only a theme-shaped one', () => {
  assert.equal(run('turnstile').attrs['data-theme'], 'turnstile');
  assert.equal(run(null).attrs['data-theme'], undefined);
  assert.equal(run('x" onload="').attrs['data-theme'], undefined);
});

test('the card is held back, and lets go on its own if boot never does', () => {
  const r = run('speakeasy');
  assert.ok(r.classes.has('compose-booting'));
  assert.equal(r.timers.length, 1);
  assert.ok(r.timers[0].ms <= 3000);
  r.timers[0].fn();
  assert.ok(!r.classes.has('compose-booting'), 'the fallback does not reveal the card');
});

test('loaded in the head, after the stylesheets, and lifted by boot on every exit', () => {
  const html = read('compose.html');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /<script src="compose-boot\.js"><\/script>/);
  const css = read('styles.css');
  // The bar's close box too: it is painted in the theme's colors and wired by boot.
  assert.match(css, /html\.compose-booting \.compose-sheet,\s*html\.compose-booting \.compose-brand,\s*html\.compose-booting \.compose-topbar \.compose-x \{ visibility: hidden; \}/);
  const page = read('compose.js');
  assert.match(page, /localStorage\.setItem\('sidecar_compose_theme', name\)/);
  assert.match(page, /boot\(\)\.then\(shown, \(e\) => \{\s*shown\(\);/);
  // The locked/empty exit replaces the body, but the mark is on <html>, so it is lifted too.
  assert.match(page, /expand the composer again\.'\) \}\)\);\s*document\.documentElement\.classList\.remove\('compose-booting'\);/);
});
