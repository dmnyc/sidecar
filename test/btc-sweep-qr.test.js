'use strict';

// The worker's hand-off for the sweep card's destination scan (scan-qr.html
// ?mode=address): open the scanner, park what it read, let the panel claim it
// once. Lifted out of background.js and run, because the two properties are
// about sequences: a new scan must not be filled from an old one, and a key
// must never be parked where the destination field will show it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const A = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function worker() {
  const cases = bg.match(/\n( *)case 'SIDECAR_OPEN_QR_SCANNER': \{[\s\S]*?(?=\n *\/\/ Sign the rescue sweep)/);
  assert.ok(cases, 'the QR cases in background.js');
  const ctx = {
    Date, Promise, QR_SECRET_TTL_MS: 90000, qrSecret: null, qrScan: null,
    chrome: {
      runtime: { getURL: (p) => 'chrome-extension://sidecar/' + p, lastError: undefined },
      windows: { create: (opts, cb) => cb() },
    },
  };
  vm.createContext(ctx);
  vm.runInContext('this.handle = async function (message) { let result; switch (message.type) {' + cases[0] + '\n} return result; };', ctx);
  return (type, extra) => ctx.handle(Object.assign({ type }, extra));
}

test('a destination scanned in this session is claimed once', async () => {
  const send = worker();
  await send('SIDECAR_OPEN_QR_SCANNER', { mode: 'address' });
  assert.equal((await send('SIDECAR_QR_SCAN', { value: 'bitcoin:' + A })).ok, true);
  assert.equal((await send('SIDECAR_QR_SCAN_CLAIM')).value, 'bitcoin:' + A);
  assert.equal((await send('SIDECAR_QR_SCAN_CLAIM')).value, null);
});

test('opening the scanner drops a destination an earlier scan left unclaimed', async () => {
  const send = worker();
  await send('SIDECAR_QR_SCAN', { value: A }); // parked, and the panel never came for it
  await send('SIDECAR_OPEN_QR_SCANNER', { mode: 'address' });
  assert.equal((await send('SIDECAR_QR_SCAN_CLAIM')).value, null);
});

test('a key scanned as a destination is refused and never parked', async () => {
  const send = worker();
  for (const value of ['nsec1' + 'q'.repeat(58), 'nostr:NSEC1' + 'Q'.repeat(58), 'ncryptsec1' + 'q'.repeat(100)]) {
    assert.equal((await send('SIDECAR_QR_SCAN', { value })).ok, false, value.slice(0, 12));
    assert.equal((await send('SIDECAR_QR_SCAN_CLAIM')).value, null);
  }
});
