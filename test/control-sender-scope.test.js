'use strict';

// Regression cover for the 1.9.0 wallet outage.
//
// SIDECAR_GET_NWC is gated on the sender being the side panel. The gate lived in
// handleControl(), which is a TOP-LEVEL declaration — it does not close over the
// onMessage listener's `sender`, and the listener never passed one. So `sender`
// was an undeclared identifier at that point.
//
// The guard was written as `typeof sender.url !== 'string'`, which reads like a
// null-check and isn't: `typeof` only makes a BARE undeclared name safe, so the
// property access threw ReferenceError every single time. handleControl's own
// try/catch turned that into a tidy { ok: false } response, so nothing crashed
// and nothing logged — SIDECAR_GET_NWC simply failed for everyone, in every
// browser. ensureNwc() is its only caller and the only path that builds the
// wallet client, so every install reported "no wallet" while the connection
// string sat intact and decryptable on disk.
//
// Two layers here. Structural checks that `sender` is threaded from the listener
// into handleControl, and a behavioral check that runs the real gate expression
// lifted out of background.js against several senders — including a missing one,
// which must deny rather than throw.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

const PANEL_URL = 'chrome-extension://ngmdaeibdldkcblgnklodlenhgnfdimj/sidepanel.html';
const PROMPT_URL = 'chrome-extension://ngmdaeibdldkcblgnklodlenhgnfdimj/prompt.html';

// ---- structural: the wiring that was missing ----

test('handleControl declares a sender parameter', () => {
  const m = source.match(/async function handleControl\(([^)]*)\)/);
  assert.ok(m, 'handleControl not found in background.js');
  const params = m[1].split(',').map((s) => s.trim());
  assert.ok(
    params.includes('sender'),
    'handleControl must take `sender` — it is a top-level function and cannot ' +
      'close over the listener\'s. Got: (' + m[1] + ')'
  );
});

test('the onMessage listener passes sender into handleControl', () => {
  const m = source.match(/handleControl\(([^)]*)\)\s*;/);
  assert.ok(m, 'no handleControl(...) call site found');
  const args = m[1].split(',').map((s) => s.trim());
  assert.ok(args.includes('sender'), 'call site must forward `sender`. Got: (' + m[1] + ')');
});

// Note: `typeof sender.url` is NOT banned outright. Inside the onMessage
// listener `sender` is a real parameter, so the pattern is safe there and is
// used legitimately (see the fromExtPage check). What made it a bug was the
// scope, not the syntax — which is what the two tests above and the
// missing-sender case below actually pin down.

// ---- behavioral: run the real gate against real senders ----

// Lift the guard out of the SIDECAR_GET_NWC case so the test exercises shipped
// code rather than a copy that can drift away from it.
function liftGate() {
  const block = source.match(/case 'SIDECAR_GET_NWC': \{[\s\S]*?\n\s*break;/);
  assert.ok(block, 'SIDECAR_GET_NWC case not found');
  const guard = block[0].match(/const senderUrl = [\s\S]*?\n\s*\}/);
  assert.ok(guard, 'sender guard not found inside the SIDECAR_GET_NWC case');
  return guard[0];
}

// Returns 'allowed' | 'denied', or rethrows anything that is not the deny error
// — a ReferenceError here is the original bug and must fail the test loudly.
function runGate(sender) {
  const ctx = {
    sender,
    chrome: { runtime: { getURL: (p) => 'chrome-extension://ngmdaeibdldkcblgnklodlenhgnfdimj/' + p } },
    result: null,
  };
  vm.createContext(ctx);
  try {
    vm.runInContext('(function () {\n' + liftGate() + '\nreturn "allowed";\n})()', ctx);
    return 'allowed';
  } catch (e) {
    if (e instanceof ReferenceError) throw e;
    assert.match(e.message, /Not allowed from this context/);
    return 'denied';
  }
}

test('the side panel is allowed through', () => {
  assert.equal(runGate({ url: PANEL_URL }), 'allowed');
});

test('another extension page is denied', () => {
  assert.equal(runGate({ url: PROMPT_URL }), 'denied');
});

test('a missing sender denies instead of throwing ReferenceError', () => {
  assert.equal(runGate(undefined), 'denied');
});

test('a sender with no url denies', () => {
  assert.equal(runGate({}), 'denied');
});

test('a non-string url denies', () => {
  assert.equal(runGate({ url: 42 }), 'denied');
});

test('a page merely prefixed with the panel path is denied', () => {
  assert.equal(
    runGate({ url: 'chrome-extension://ngmdaeibdldkcblgnklodlenhgnfdimj/sidepanel.html.evil' }),
    'denied'
  );
});
