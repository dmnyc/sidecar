'use strict';

// A RELAY THAT NEVER ANSWERS CANNOT HOLD A POST HOSTAGE.
//
// The vendored pool can leave one relay's publish pending forever (an "auth-required"
// answer whose AUTH signing fails is settled by nothing in nostr-tools), and
// publishToRelays waited on every relay with allSettled. A note the other relays had
// already taken left the composer on "Found it. Posting…" with nothing to press. This
// runs the real publishToRelays with one relay that accepts and one that never answers.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');

function lift(decl) {
  const at = panel.indexOf(decl);
  assert.ok(at !== -1, 'sidepanel.js no longer has ' + decl);
  const open = panel.indexOf('{', panel.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < panel.length; i++) {
    if (panel[i] === '{') depth++;
    else if (panel[i] === '}' && --depth === 0) return panel.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

function harness(relayBehaviors) {
  const reset = [];
  let calls = 0;
  const ctx = {
    Promise, Set, String, setTimeout, Error,
    NT: { utils: { normalizeURL: (u) => u } },
    resetPoolRelays: (urls) => reset.push([...urls]),
    poolPublish: (targets) => { calls++; return targets.map((u) => relayBehaviors[u]()); },
    publishFailureMessage: () => 'every relay failed',
  };
  vm.createContext(ctx);
  vm.runInContext([
    panel.match(/const publishFailed = \(r\) =>[\s\S]*?;\n/)[0],
    // The cap as written, shortened from 12 seconds so the test does not wait for it.
    panel.match(/const PUBLISH_RELAY_CAP_MS = \d+;/)[0].replace(/\d+/, '50'),
    lift('function capPublish(p)'),
    lift('async function publishToRelays(relays, signed)'),
    'globalThis.publish = publishToRelays;',
  ].join('\n'), ctx);
  return { publish: ctx.publish, reset, calls: () => calls };
}

test('one silent relay does not stop the post from finishing', async () => {
  const h = harness({
    'wss://good.example': () => Promise.resolve(''),
    'wss://silent.example': () => new Promise(() => {}), // never settles, as the AUTH hang does
  });
  const ok = await h.publish(['wss://good.example', 'wss://silent.example'], { id: 'x' });
  assert.equal(ok, 1, 'the accepting relay was not counted');
  // The silent relay counts as failed, so its connection is reset and the stuck AUTH
  // attempt nostr-tools kept for it goes with it.
  assert.deepEqual(h.reset, [['wss://silent.example']]);
  assert.equal(h.calls(), 1, 'a partial success was sent again');
});

test('when every relay is silent, it gives up and says so instead of waiting forever', async () => {
  const h = harness({ 'wss://silent.example': () => new Promise(() => {}) });
  await assert.rejects(h.publish(['wss://silent.example'], { id: 'x' }), /every relay failed/);
  assert.equal(h.calls(), 2, 'a total failure is retried once on fresh sockets');
});

test('the cap is twelve seconds, reported as a connection failure', () => {
  assert.match(panel, /const PUBLISH_RELAY_CAP_MS = 12000;/);
  assert.match(panel, /res\('connection failure: no answer within 12s'\)/);
  // Both attempts are capped, the first and the fresh-socket retry.
  assert.equal((panel.match(/poolPublish\(targets, signed\)\.map\(capPublish\)/g) || []).length, 2);
});
