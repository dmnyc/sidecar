'use strict';

// One way to say "working", across the whole panel.
//
// The panel had grown three answers to the same question: a circular spinner, a shimmering
// line of text, and in one place the word "Loading" with nothing moving at all. Worse, the
// spinner itself existed three times over, at 0.7s, 0.8s and 0.9s, for the same 14px circle.
// A loading indicator is a promise that the app is working; three dialects of it read as
// three different apps.
//
// The rule is by SHAPE, not by surface:
//   a control you clicked        the control's own icon spins in place
//   a region with room for a line  the shared spinner row (waitingRow)
//   a value waiting in place       shimmer, because a spinner does not fit beside a number

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const bare = panel.replace(/^\s*\/\/.*$/gm, '');
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('ONE ROTATION KEYFRAME, NOT THREE', () => {
  const spins = [...cssCode.matchAll(/@keyframes ([\w-]*spin[\w-]*)/g)].map((m) => m[1]);
  assert.deepEqual(spins, ['spin'], 'every spinner turns the same way: found ' + spins.join(', '));
  // The three it replaced, by name, so none of them creeps back.
  for (const dead of ['recv-spin', 'ac-spin', 'profile-refresh-spin']) {
    assert.doesNotMatch(cssCode, new RegExp('animation:[^;]*' + dead), dead + ' is back');
  }
  // And at one duration. Three speeds nobody chose is the thing this fixes.
  const durs = new Set([...cssCode.matchAll(/animation: spin ([\d.]+m?s)/g)].map((m) => m[1]));
  assert.equal(durs.size, 1, 'one duration, found: ' + [...durs].join(', '));
});

test('the two spinner classes share one rule', () => {
  // They were byte-identical apart from the animation name. The class names stay because
  // themes/werkstatte.css squares them by name.
  assert.match(cssCode, /\.recv-spinner,\s*\n\.ac-spinner \{/, 'they must be one rule');
  const werk = fs.readFileSync(path.join(ROOT, 'themes/werkstatte.css'), 'utf8');
  assert.match(werk, /\.ac-spinner/, 'the theme still targets it by name');
  assert.match(werk, /\.recv-spinner/);
});

test('a region that waits uses the shared row, wherever it is', () => {
  assert.match(bare, /function waitingRow\(label\)/);
  const fn = bare.slice(bare.indexOf('function waitingRow('));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /className: 'recv-waiting'/);
  assert.match(body, /className: 'recv-spinner'/);

  // Surfaces that had diverged, now on the same row. Bookmarks is the one they match.
  for (const label of ['Looking for your polls…', 'Counting votes…', 'Fetching the poll…',
                       'Checking your relays…', 'Waiting for payment…', 'Loading price history…']) {
    assert.ok(bare.includes("waitingRow('" + label + "')"), label + ' is not on the shared row');
  }
  assert.match(bare, /waitingRow\(label\)/, 'and the bookmarks/notifications block builds it too');
});

test('nothing builds that row by hand any more', () => {
  // Four copies of the same three lines is four places for it to drift.
  const inline = (bare.match(/className: 'recv-waiting'/g) || []).length;
  assert.equal(inline, 1, 'the row is built in exactly one place, found ' + inline);
});

test('shimmer is for values waiting in place, and nothing else', () => {
  // A count inside a row has no room for a spinner beside it, which is the whole reason
  // this idiom survives. Every other use moved to the row.
  const calls = [...bare.matchAll(/(?:^|[^n] )setWaiting\(([^;]*)\)/g)]
    .map((m) => m[1])
    .filter((c) => c !== 'el, text, waiting'); // the definition, not a call
  assert.ok(calls.length >= 1, 'the in-place idiom is gone entirely');
  for (const c of calls) {
    assert.match(c, /poll-row-count|cell/, 'setWaiting outside an in-place value: ' + c.slice(0, 60));
  }
});

test('no surface claims to be loading without showing it', () => {
  // The wallet price chart said "Loading" and showed nothing moving, so a slow fetch was
  // indistinguishable from a dead one.
  assert.doesNotMatch(bare, /className: 'wallet-chart-loading', textContent: 'Loading…'/,
    'a bare word is not an indicator');
  assert.match(bare, /wallet-chart-loading' \}, \[waitingRow\(/);
});
