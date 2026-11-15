'use strict';

// The worker's SIDECAR_BTC_SIGN_INPUTS handler, lifted out of background.js
// and run against a scriptable keystore. What it must never do is sign bytes
// the caller chose: the untweaked form signs under the Nostr key itself, so a
// signature over a requested 32 bytes would be one over any event id, around
// the wipe guard SIDECAR_OWNER_SIGN applies to the panel's own events.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../bitcoin.js').SidecarBitcoin;

const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const h = (s) => B.hexToBytes(s);
const G = { x: 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n, y: 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n };
const SK = B.bigIntToBytes(6n, 32);
const PUB = B.bytesToHex(B.bigIntToBytes(B.scalarMult(6n, G).x, 32));

function handler({ active = PUB, locked = false } = {}) {
  const block = bg.match(/\n( *)case 'SIDECAR_BTC_SIGN_INPUTS': \{\n[\s\S]*?\n\1\}\n/);
  assert.ok(block, 'the SIDECAR_BTC_SIGN_INPUTS case in background.js');
  const ctx = {
    Error,
    self: { SidecarBitcoin: B },
    KS: {
      getActivePubkey: async () => active,
      getPrivkey: async () => {
        if (locked) throw new Error('Keystore is locked');
        return SK.slice();
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext('this.handle = async function (message) { let result; switch (message.type) {' + block[0] + '} return result; };', ctx);
  // What chrome.runtime messaging does to a message on its way to the worker.
  return (message) => ctx.handle(JSON.parse(JSON.stringify(message)));
}

function plan() {
  return B.planSweep([
    { txidHex: 'cd'.repeat(32), vout: 0, valueSats: 40000n, form: 'untweaked' },
    { txidHex: 'ab'.repeat(32), vout: 3, valueSats: 25000n, form: 'tweaked' },
  ], B.destScriptFor('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'), 2);
}

test('a sweep request comes back signed, and the signatures spend the coins it names', async () => {
  const p = plan();
  const result = await handler()({ type: 'SIDECAR_BTC_SIGN_INPUTS', pubkey: PUB, sweep: B.sweepRequest(p) });
  const scripts = {
    tweaked: B.p2trScript(B.tweakedPubkeyFrom(PUB, await B.tapTweakInt(h(PUB)))),
    untweaked: B.p2trScript(h(PUB)),
  };
  const spent = p.plan.map((u) => ({ valueSats: u.valueSats, script: scripts[u.form] }));
  assert.equal(result.sigs.length, 2);
  for (let i = 0; i < result.sigs.length; i++) {
    assert.equal(await B.schnorrVerify(h(result.sigs[i]), await B.sighashAll(p.tx, i, spent), spent[i].script.subarray(2)), true);
  }
});

test('a bare hash is refused — not even a Nostr event id gets signed', async () => {
  // A kind 3 with no follows: the wipe SIDECAR_OWNER_SIGN stops for confirmation.
  const wipe = [0, PUB, 1794000000, 3, [], ''];
  const eventId = B.bytesToHex(await B.sha256(new TextEncoder().encode(JSON.stringify(wipe))));
  const handle = handler();
  for (const message of [
    { type: 'SIDECAR_BTC_SIGN_INPUTS', pubkey: PUB, inputs: [{ hash: eventId, form: 'untweaked' }] },
    { type: 'SIDECAR_BTC_SIGN_INPUTS', pubkey: PUB, sweep: { inputs: [{ hash: eventId, form: 'untweaked' }], outputs: [] } },
  ]) {
    await assert.rejects(handle(message), /malformed sweep request/);
  }
});

test('a request from a switched or locked account is refused', async () => {
  const sweep = B.sweepRequest(plan());
  await assert.rejects(handler({ active: 'ab'.repeat(32) })({ type: 'SIDECAR_BTC_SIGN_INPUTS', pubkey: PUB, sweep }), /switched accounts/);
  await assert.rejects(handler({ locked: true })({ type: 'SIDECAR_BTC_SIGN_INPUTS', pubkey: PUB, sweep }), /locked/);
});
