'use strict';

// Removing Sidecar opens sidecar.top/uninstall. The address is bare: nothing about the
// browser, the version or the install goes with it. Runs the block from background.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const block = bg.slice(bg.indexOf('// ---- the page an uninstall opens ----'), bg.indexOf('// ---- side panel open on toolbar click ----'));

function run(runtime) {
  vm.runInNewContext(block, { chrome: { runtime } });
}

test('the uninstall page is set at worker start, with a bare address', () => {
  assert.ok(block.length > 0, 'the uninstall block is missing from background.js');
  const calls = [];
  run({ setUninstallURL: (url) => { calls.push(url); return Promise.resolve(); } });
  assert.deepEqual(calls, ['https://sidecar.top/uninstall']);
  assert.doesNotMatch(calls[0], /[?#]/, 'the address carries a query or fragment');
});

test('a refusal or a browser without it does not stop the worker', async () => {
  run({ setUninstallURL: () => Promise.reject(new Error('nope')) });
  run({});
  run({ setUninstallURL: () => { throw new Error('sync'); } });
  await new Promise((r) => setImmediate(r)); // an unhandled rejection would fail the run
});
