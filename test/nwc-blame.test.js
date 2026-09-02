'use strict';

// Never accuse a relay of being down on evidence that cannot support it.
//
// probeRelay() proves exactly one thing: we could not open a WebSocket in five seconds.
// The wallet path used to turn that into "the relay looks down, not Sidecar" — a claim
// it has no standing to make, and one that explicitly absolves the very thing that was
// broken.
//
// Reported when every NWC relay went down at once, Alby and Rizful together, while both
// answered in ~200ms from outside the browser. Chrome had run out of WebSocket
// connections. Two unrelated operators failing simultaneously is near-proof of a local
// cause, and that signal was sitting right there.
//
// The fix probes CONTROLS — relays the user already talks to — before blaming anyone.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'nwc-client.js'), 'utf8');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// up: the set of relay URLs that will open. Everything else times out.
function harness(up) {
  const probed = [];
  const ctx = {
    console, URL, Array, Promise, Object,
    probeRelay(url) { probed.push(url); return Promise.resolve(up.includes(url)); },
    probed,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(
    [
      'let controlRelays = [];',
      lift('function setControlRelays('),
      lift('async function isLocalSocketFailure('),
      'globalThis.setControlRelays = setControlRelays;',
      'globalThis.isLocalSocketFailure = isLocalSocketFailure;',
    ].join('\n'),
    ctx
  );
  return ctx;
}

const WALLET = 'wss://relay.getalby.com/v1';

test('every relay failing is reported as a LOCAL failure', async () => {
  // The actual incident: Alby and Rizful both "down", browser out of sockets.
  const ctx = harness([]);
  ctx.setControlRelays(['wss://nos.lol', 'wss://relay.primal.net']);
  assert.equal(await ctx.isLocalSocketFailure(WALLET), true);
});

test('one relay failing while others work still blames that relay', async () => {
  // The case the original message was written for, and it must survive.
  const ctx = harness(['wss://nos.lol', 'wss://relay.primal.net']);
  ctx.setControlRelays(['wss://nos.lol', 'wss://relay.primal.net']);
  assert.equal(await ctx.isLocalSocketFailure(WALLET), false);
});

test('a single working control is enough to clear the browser', async () => {
  const ctx = harness(['wss://relay.primal.net']);
  ctx.setControlRelays(['wss://nos.lol', 'wss://relay.primal.net']);
  assert.equal(await ctx.isLocalSocketFailure(WALLET), false, 'something opened, so sockets are available');
});

test('with no controls it declines to guess', async () => {
  // No evidence either way. Falling through to the relay-specific message is the
  // existing behavior; inventing a local-failure claim would repeat the original sin
  // in the opposite direction.
  const ctx = harness([]);
  ctx.setControlRelays([]);
  assert.equal(await ctx.isLocalSocketFailure(WALLET), false);
  assert.deepEqual([...ctx.probed], [], 'and it probes nothing');
});

test('the wallet relay is never used as its own control', async () => {
  // Probing the thing under test proves nothing, and would make every wallet-relay
  // outage look like a browser failure.
  const ctx = harness([]);
  ctx.setControlRelays([WALLET, 'wss://relay.getalby.com/v1']);
  assert.equal(await ctx.isLocalSocketFailure(WALLET), false);
  assert.deepEqual([...ctx.probed], [], 'same host — nothing left to control against');
});

test('controls are capped, so a long relay list is not a probe storm', async () => {
  const ctx = harness([]);
  ctx.setControlRelays(['wss://a.example', 'wss://b.example', 'wss://c.example', 'wss://d.example']);
  await ctx.isLocalSocketFailure(WALLET);
  assert.ok(ctx.probed.length <= 2, 'probed ' + ctx.probed.length);
});

test('a malformed control url is skipped rather than thrown on', async () => {
  const ctx = harness([]);
  ctx.setControlRelays(['not a url', 'wss://nos.lol']);
  assert.equal(await ctx.isLocalSocketFailure(WALLET), true);
  assert.deepEqual([...ctx.probed], ['wss://nos.lol']);
});

test('setControlRelays ignores anything that is not a list of strings', async () => {
  const ctx = harness([]);
  ctx.setControlRelays(null);
  assert.equal(await ctx.isLocalSocketFailure(WALLET), false);
  ctx.setControlRelays(['wss://nos.lol', 42, null]);
  assert.equal(await ctx.isLocalSocketFailure(WALLET), true);
  assert.deepEqual([...ctx.probed], ['wss://nos.lol']);
});

// ---- the wording, and where it surfaces -------------------------------------------

const body = source.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');

test('the local-failure path does not name a relay', () => {
  const m = body.match(/localSocketFailure = true/);
  assert.ok(m, 'the local branch must exist');
  const msg = body.match(/new Error\("Your browser can't open new connections[^"]*"\)/);
  assert.ok(msg, 'expected a message about the browser');
  assert.doesNotMatch(msg[0], /relay/i, 'naming a relay here is the bug');
});

test('the relay-down claim is now guarded by the control check', () => {
  // Ordering matters: the local check has to run BEFORE the accusation, or the
  // accusation still wins.
  const local = body.indexOf('isLocalSocketFailure(relay)');
  const blame = body.indexOf('the relay looks down');
  assert.ok(local !== -1 && blame !== -1);
  assert.ok(local < blame, 'check locally before blaming the operator');
});

test('the panel surfaces the local failure distinctly', () => {
  // Otherwise it falls through to "balance unavailable", which says nothing.
  const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  assert.match(panel, /localSocketFailure\s*\n?\s*\?\s*'browser out of connections'/);
  assert.match(panel, /e\.localSocketFailure \|\| e\.relayDown/, 'and still toasts the full sentence');
});

test('controls come from relays the user already uses', () => {
  // A hardcoded control list would tell new hosts about the user for no reason.
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  assert.match(bg, /setControlRelays\(Object\.keys\(await getConfiguredRelays\(\)\)\)/);
});

// ---- recovery: a way out that is not "restart Chrome" ------------------------------

test('the panel can throw away every connection it holds', () => {
  // Recovery from socket exhaustion. Both halves matter: the panel's own pool AND the
  // worker's wallet client, which lives in a different context and holds its own.
  const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  const at = panel.indexOf('async function resetConnections(');
  assert.ok(at !== -1, 'resetConnections not found');
  const fn = panel.slice(at, panel.indexOf('\n  }', at));
  assert.match(fn, /resetPoolRelays\(\[\]\)/, 'empty list means every relay in the pool');
  assert.match(fn, /SIDECAR_RESET_CONNECTIONS/, 'the worker holds its own and must be told');
});

test('the worker rebuilds its wallet client rather than reusing a dead one', () => {
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const at = bg.indexOf("case 'SIDECAR_RESET_CONNECTIONS'");
  assert.ok(at !== -1);
  assert.match(bg.slice(at, at + 260), /closeSwNwc\(\)/);
});

test('reset is not reachable from a web page', () => {
  // A site being able to drop the user's relay connections is a denial-of-service
  // primitive, however small.
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const ok = bg.match(/const CONTENT_OK = new Set\(\[[\s\S]*?\]\);/)[0];
  assert.doesNotMatch(ok, /SIDECAR_RESET_CONNECTIONS/);
});

test('the button is only offered for failures reconnecting could fix', () => {
  // walletSilent means the wallet answered nothing — a new socket does not help, and
  // a button that cannot work is its own small lie.
  const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  const guard = panel.match(/if \(e && \(e\.localSocketFailure \|\| e\.relayDown \|\| e\.staleSocket\)\) \{/);
  assert.ok(guard, 'expected the narrower guard for the button');
  assert.doesNotMatch(guard[0], /walletSilent/);
});
