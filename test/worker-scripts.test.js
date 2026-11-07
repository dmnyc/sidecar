'use strict';

// Chrome and Firefox load the background's modules from two different lists:
// Chrome's service worker through the importScripts call at the top of
// background.js, Firefox's event page through manifest background.scripts. A
// module added to one list and not the other works in one browser and is
// simply absent in the other. bitcoin.js shipped in the Firefox list only, so
// on Chrome every on-chain sweep stopped at "The bitcoin module is not loaded".
// This runs the real importScripts statement against a recorder and holds it
// to the manifest's list, in the manifest's order.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// The one intended difference: the worker imports jsqr.js on demand, where it
// decodes a QR; Firefox's event page has no importScripts and loads it up front.
const LAZY_IN_WORKER = new Set(['jsqr.js']);

test('the Chrome worker imports every module the Firefox background loads, in the same order', () => {
  const block = read('background.js').match(/if \(typeof importScripts === 'function'\) \{\n\s*importScripts\([^)]*\);\n\}/);
  assert.ok(block, 'the importScripts block at the top of background.js');
  const loaded = [];
  vm.runInNewContext(block[0], { importScripts: (...files) => loaded.push(...files) });
  const firefox = JSON.parse(read('manifest.json')).background.scripts
    .filter((f) => f !== 'background.js' && !LAZY_IN_WORKER.has(f));
  assert.deepEqual(loaded, firefox);
});
