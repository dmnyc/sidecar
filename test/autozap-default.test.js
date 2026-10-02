'use strict';

// The auto-zap default lives twice: background.js, which enforces it and sets it when the
// payment card's offer is accepted, and sidepanel.js, which shows it in Settings. They
// must agree, and they must agree with the 100 sats the documentation promises.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const valueIn = (src) => Number((src.match(/const AUTOZAP_DEFAULT_MAX = (\d+);/) || [])[1]);

test('the auto-zap default is 100 sats, in the worker and the panel alike', () => {
  assert.equal(valueIn(read('background.js')), 100);
  assert.equal(valueIn(read('sidepanel.js')), 100);
  assert.match(read('FEATURES.md'), /default 100 sats/);
});
