'use strict';

// The WebSocket nostr-tools abandons, and the guard that closes it.
//
// This reproduces the bug against the REAL vendored nostr-tools.js rather than a
// description of it, because the whole point is that the library is doing something its
// own API does not admit to. AbstractRelay.connect() creates a socket and, on connect
// timeout, rejects, calls onclose and hands off to handleHardClose — never calling
// close() on the socket it made. The socket stays in CONNECTING and the browser keeps
// the connection.
//
// Chrome caps WebSockets per renderer, so a long-lived panel eventually exhausts the
// budget for the WHOLE BROWSER. Confirmed in the field: Sidecar reported every relay as
// "connect timeout" while the same relays answered in ~200ms from node on the same
// machine, and Jumble — a separate app in another tab — failed to post at the same
// moment. Quitting the browser was the only recovery.
//
// The first test documents the vendored behavior. If a future vendor update fixes it
// upstream that test will fail, which is the correct outcome: the guard can then go.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// A socket that connects forever — the case the library mishandles.
function makeFakeWs(registry) {
  return class FakeWs extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 0; // CONNECTING, and it stays there
      this.closed = false;
      registry.push(this);
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
      if (this.onclose) this.onclose({});
    }
    // Teardown WITHOUT telling nostr-tools. A real close() reaches its onclose handler,
    // which calls handleHardClose, which schedules a reconnect — so tidying up sixty
    // leaked sockets kicks off sixty reconnect cascades and the test never settles.
    dispose() {
      this.closed = true;
      this.readyState = 3;
      this.onclose = null;
      clearTimeout(this._sidecarDeadline);
    }
    send() {}
  };
}

// Load the vendored library into its own realm with our socket in place.
function loadNostrTools(WebSocketImpl) {
  const sandbox = {
    WebSocket: WebSocketImpl,
    URL,
    Event,
    EventTarget,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
    JSON,
    Math,
    Date,
    Promise,
    Error,
    Object,
    Array,
    Symbol,
    TextEncoder,
    TextDecoder,
    crypto,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'), sandbox, {
    filename: 'nostr-tools.js',
  });
  return { NT: sandbox.NostrTools, sandbox };
}

function loadGuard() {
  const sandbox = { setTimeout, clearTimeout, console, Set, WebSocket: undefined };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'ws-guard.js'), 'utf8'), sandbox, {
    filename: 'ws-guard.js',
  });
  return sandbox.SidecarWsGuard;
}

const RELAYS = ['wss://a.example', 'wss://b.example', 'wss://c.example'];

// Closing the pool clears AbstractRelay's reconnect timers, and closing each socket
// fires the guard's settle handler which clears its deadline. Without both, the test
// process passes and then hangs on live timers.
// pool.close() first: it sets skipReconnection on each relay, so the disposal below
// cannot restart anything.
function cleanUp(pool, made) {
  try { pool.close(RELAYS); } catch (_) {}
  made.forEach((s) => { try { s.dispose(); } catch (_) {} });
}

async function drive(NT, opts) {
  // maxWaitForConnection, or each attempt waits the 3s default: SimplePool only honors
  // the shorter per-call maxWait when maxWaitForConnection is already smaller than it
  // (nostr-tools.js:3753), which it never is. Sixty attempts at 3s is a minute of test.
  const pool = new NT.SimplePool(Object.assign({ enableReconnect: true, maxWaitForConnection: 40 }, opts));
  for (let i = 0; i < 20; i++) {
    try {
      await pool.get(RELAYS, { kinds: [1] }, { maxWait: 60 });
    } catch (_) {}
  }
  return pool;
}

// ---- the bug --------------------------------------------------------------------

test('the vendored library leaks a socket on every connect timeout', async () => {
  const made = [];
  const { NT } = loadNostrTools(makeFakeWs(made));
  const pool = await drive(NT);
  await new Promise((r) => setTimeout(r, 200));

  assert.ok(made.length >= 20, 'expected repeated connect attempts, got ' + made.length);
  const leaked = made.filter((s) => !s.closed);
  const leakedCount = leaked.length;
  cleanUp(pool, made);
  assert.equal(
    leakedCount,
    made.length,
    'if this now fails, the vendored library learned to close its own sockets — ' +
      'check nostr-tools.js connect() and consider dropping ws-guard.js'
  );
});

// ---- the guard ------------------------------------------------------------------

test('the guard closes what the library abandoned', async () => {
  const made = [];
  const guard = loadGuard();
  const Guarded = guard.impl(makeFakeWs(made), 50); // 50ms deadline instead of 15s
  const { NT } = loadNostrTools(Guarded);
  const pool = await drive(NT, { websocketImplementation: Guarded });
  await new Promise((r) => setTimeout(r, 300)); // past the deadline

  assert.ok(made.length >= 20, 'sanity: the same attempts happened');
  const stillOpen = made.filter((s) => !s.closed).map((s) => s.url);
  cleanUp(pool, made);
  assert.deepEqual(stillOpen, [], 'every abandoned socket must be closed');
});

test('a socket that opens is left alone', async () => {
  // The guard exists only to clean up the connect path. An OPEN socket belongs to the
  // library, and closing one it still wanted would turn a slow relay into a broken one.
  const made = [];
  const guard = loadGuard();
  const Guarded = guard.impl(makeFakeWs(made), 30);
  const ws = new Guarded('wss://opens.example');
  ws.readyState = 1; // OPEN
  ws.dispatchEvent(new Event('open'));
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(ws.closed, false, 'an open socket must survive its own deadline');
});

test('settling clears the deadline rather than leaving a timer per socket', async () => {
  const guard = loadGuard();
  const made = [];
  const Guarded = guard.impl(makeFakeWs(made), 30);
  const ws = new Guarded('wss://x.example');
  assert.equal(guard.pendingCount(), 1);
  ws.readyState = 1;
  ws.dispatchEvent(new Event('open'));
  assert.equal(guard.pendingCount(), 0, 'an opened socket must leave the pending set');
});

test('the pending set is bounded even if the deadline never fires', async () => {
  // The deadline bounds the leak RATE; this bounds the total. Without it a fast enough
  // burst still exhausts the browser before any deadline expires.
  const guard = loadGuard();
  const made = [];
  const Guarded = guard.impl(makeFakeWs(made), 60_000); // deadline far away on purpose
  for (let i = 0; i < guard.MAX_PENDING + 10; i++) new Guarded('wss://burst' + i + '.example');
  assert.ok(
    guard.pendingCount() <= guard.MAX_PENDING,
    'pending ' + guard.pendingCount() + ' exceeded the cap ' + guard.MAX_PENDING
  );
  assert.ok(made.some((s) => s.closed), 'the oldest sockets should have been reaped');
  made.forEach((s) => { try { s.dispose(); } catch (_) {} });
});

test('reaping takes the oldest first', async () => {
  const guard = loadGuard();
  const made = [];
  const Guarded = guard.impl(makeFakeWs(made), 60_000);
  for (let i = 0; i < guard.MAX_PENDING + 5; i++) new Guarded('wss://order' + i + '.example');
  const closed = made.filter((s) => s.closed).map((s) => s.url);
  assert.ok(closed.includes('wss://order0.example'), 'the longest-pending socket goes first');
  assert.ok(!closed.includes('wss://order' + (guard.MAX_PENDING + 4) + '.example'), 'not the newest');
  made.forEach((s) => { try { s.dispose(); } catch (_) {} });
});

// ---- wiring ---------------------------------------------------------------------

test('both pools use the guard', () => {
  // The panel's pool and the one nwc-client builds PER WALLET CLIENT. The second leaks
  // faster, because every connect, restore and quick-start makes another pool.
  const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  const nwc = fs.readFileSync(path.join(ROOT, 'nwc-client.js'), 'utf8');
  assert.match(panel, /websocketImplementation: guardedWs/);
  assert.match(nwc, /websocketImplementation: \(self\.SidecarWsGuard/);
});

test('ws-guard.js is loaded everywhere a pool is built', () => {
  // Three loaders, because the extension has three: the panel page, the Chrome service
  // worker's importScripts, and the Firefox event page's manifest background.scripts.
  // Missing one leaves that surface leaking with no symptom until it exhausts sockets.
  const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  assert.match(html, /<script src="ws-guard\.js"><\/script>/);

  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const imports = bg.match(/importScripts\([^)]*\)/)[0];
  assert.match(imports, /'ws-guard\.js'/);

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const scripts = manifest.background.scripts;
  assert.ok(scripts.includes('ws-guard.js'), 'Firefox event page would still leak');
  assert.ok(
    scripts.indexOf('ws-guard.js') < scripts.indexOf('nwc-client.js'),
    'must load before the consumer that reads self.SidecarWsGuard'
  );
});
