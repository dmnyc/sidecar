'use strict';

// The panel/prompt message transport (#224).
//
// The bug was not a failed request. It was a request that could never fail: the old body
// was `new Promise((resolve) => chrome.runtime.sendMessage(message, resolve))` — no
// reject anywhere in it — so the promise had exactly one way to finish, Chrome invoking
// the callback. MV3 kills the service worker at ~30s idle, and a worker torn down
// mid-request never invokes it. Every `await call(...)` behind it then hung forever with
// no timeout, no error and no log. That is the wallet wedging: blank tab, panel reload no
// help, fixed only by switching accounts.
//
// Both surfaces are covered here because they had the same body and the same hole —
// sidepanel.js bg() and prompt.js send(). Lifted into a vm against a scriptable chrome,
// because "the callback is never invoked" cannot be observed any other way.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const prompt = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');

function lift(source, pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label);
  return m[0];
}

// `behavior` decides what the fake chrome does with the callback.
function harness(source, pattern, label, timeoutName, behavior) {
  const clock = { now: 0, next: 1, timers: new Map() };
  const ctx = {
    Promise, Error, String, clearTimeout: (id) => clock.timers.delete(id),
    setTimeout: (fn, ms) => {
      const id = clock.next++;
      clock.timers.set(id, { fn, at: clock.now + ms });
      return id;
    },
    chrome: {
      runtime: {
        lastError: undefined,
        sendMessage(msg, cb) { behavior(msg, cb, ctx.chrome.runtime); },
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    '(function () {\n' + lift(source, pattern, label) + '\nthis.fn = ' + label + ';\nthis.TIMEOUT = ' + timeoutName + ';\n}).call(this)',
    ctx
  );
  ctx.advance = (ms) => {
    clock.now += ms;
    for (const [id, t] of [...clock.timers]) if (t.at <= clock.now) { clock.timers.delete(id); t.fn(); }
  };
  ctx.pending = () => clock.timers.size;
  return ctx;
}

const BG = (behavior) =>
  harness(panel, /  const BG_TIMEOUT_MS = \d+;\n  function bg\(message, timeoutMs\) \{[\s\S]*?\n  \}/, 'bg', 'BG_TIMEOUT_MS', behavior);
const SEND = (behavior) =>
  harness(prompt, /  const SEND_TIMEOUT_MS = \d+;\n  function send\(message, timeoutMs\) \{[\s\S]*?\n  \}/, 'send', 'SEND_TIMEOUT_MS', behavior);

for (const [name, make] of [['sidepanel bg()', BG], ['prompt send()', SEND]]) {
  test(name + ': a callback that never fires rejects instead of hanging forever', async () => {
    // THE BUG. The worker is torn down mid-request and Chrome never calls back.
    const c = make(() => {});
    const p = c.fn({ type: 'SIDECAR_HAS_NWC' });
    let settled = 'no';
    p.then(() => (settled = 'resolved'), () => (settled = 'rejected'));

    c.advance(c.TIMEOUT - 1);
    await null;
    assert.equal(settled, 'no', 'still waiting a millisecond short of the timeout');

    c.advance(1);
    await p.then(() => null, (e) => e);
    assert.equal(settled, 'rejected', 'the old body could never reach this state');
    const err = await p.catch((e) => e);
    assert.match(err.message, /did not respond/);
  });

  test(name + ': lastError is read, and becomes the rejection', async () => {
    // Reading it inside the callback is what marks it handled — unread, Chrome logs
    // "Unchecked runtime.lastError" that nobody sees and the caller got a bare undefined.
    let sawRead = false;
    const c = make((msg, cb, runtime) => {
      Object.defineProperty(runtime, 'lastError', {
        configurable: true,
        get() { sawRead = true; return { message: 'Could not establish connection.' }; },
      });
      cb(undefined);
    });
    const err = await c.fn({ type: 'X' }).catch((e) => e);
    assert.ok(sawRead, 'lastError must be read inside the callback');
    assert.match(err.message, /Could not establish connection/);
  });

  test(name + ': a normal reply still resolves, and disarms the timer', async () => {
    const c = make((msg, cb) => cb({ ok: true, result: { has: true } }));
    const resp = await c.fn({ type: 'SIDECAR_HAS_NWC' });
    assert.deepEqual(resp, { ok: true, result: { has: true } });
    assert.equal(c.pending(), 0, 'a resolved request must not leave a timer armed');
  });

  test(name + ': a synchronous throw rejects rather than escaping', async () => {
    // sendMessage throws synchronously when the extension context is gone.
    const c = make(() => { throw new Error('Extension context invalidated.'); });
    const err = await c.fn({ type: 'X' }).catch((e) => e);
    assert.match(err.message, /Extension context invalidated/);
  });

  test(name + ': it settles exactly once', async () => {
    // A late callback after the timeout must not resolve an already-rejected promise.
    let cb;
    const c = make((msg, f) => { cb = f; });
    const p = c.fn({ type: 'X' });
    let outcome = null;
    p.then(() => (outcome = 'resolved'), () => (outcome = 'rejected'));
    c.advance(c.TIMEOUT);
    await p.catch(() => {});
    cb({ ok: true, result: 'late' }); // the worker woke up and answered anyway
    await null;
    assert.equal(outcome, 'rejected', 'the late answer must not overwrite the verdict');
  });
}

test('the timeout is generous enough not to cut real work short', () => {
  // Deliberately not aggressive: the bug is "never fires", so any finite timeout catches
  // it. The slowest thing the panel sends is PBKDF2 at 600k rounds on unlock/init/PIN
  // change, and SIDECAR_FETCH_OG, which carries its own 8s abort in the worker. Payments
  // do not come through here at all — the panel holds its own NWC client.
  const ms = Number(panel.match(/const BG_TIMEOUT_MS = (\d+);/)[1]);
  assert.ok(ms >= 20000, 'too tight would abort a slow PBKDF2 or OG fetch: ' + ms);
  assert.equal(ms, Number(prompt.match(/const SEND_TIMEOUT_MS = (\d+);/)[1]), 'both surfaces should agree');
});

// ---- what the surfaces do now that a request can fail ---------------------------
//
// Making the transport able to reject is only half of #224. Before, a hang and a
// rejection both ended the same way — nothing painted, nothing said. These pin the
// places where that had to change.

test('the wallet paints something before it can hang', () => {
  // Everything above renderWallet's first await only handles the no-account case, so on
  // a fresh panel a hung await left the tab exactly as it found it: empty, no spinner,
  // no error. The placeholder is DELAYED because renderWallet runs on every tab switch
  // and every zap — an immediate one would flash on the fast path, which is nearly all
  // of them.
  const fn = panel.slice(panel.indexOf('async function renderWallet()'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /const slow = setTimeout\(/, 'a delayed placeholder before the await');
  assert.match(body, /'Loading wallet…'/);
  assert.match(body, /\} finally \{\s*\n\s*clearTimeout\(slow\);/, 'and it must be disarmed on every path');
});

test('a failed wallet load says so and offers the one action that helps', () => {
  assert.match(panel, /function walletLoadFailed\(view, e\) \{/);
  const fn = panel.slice(panel.indexOf('function walletLoadFailed'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /textContent: 'Try again'/, 'the recovery people actually found was switching accounts');
  assert.match(body, /renderWallet\(\)/);
  // Both roads to a blank tab are covered: the first await, and the unawaited
  // renderWalletConnected that follows it.
  assert.match(panel, /\{ if \(seq === walletRenderSeq\) walletLoadFailed\(view, e\); \}/);
});

test('a stuck approval gives the buttons back', () => {
  // The worst state this window can reach. decide() disables allow/trust/reject BEFORE
  // sending, so a transport that never settled left an approval the user could neither
  // grant nor refuse, on a site waiting for an answer.
  const fn = prompt.slice(prompt.indexOf('const chips = els.relaxRow'));
  const body = fn.slice(0, fn.indexOf('// Background either'));
  assert.match(body, /setDisabled\(true\);/);
  assert.match(body, /catch \(e\) \{[\s\S]*?setDisabled\(false\);/, 'the controls must come back on failure');
  assert.match(body, /els\.error\.textContent =/);
});

test('a transport failure is not reported as a wrong PIN', () => {
  // It spends none of the attempts, and telling someone their PIN was wrong when it was
  // not is how they burn the ones they have.
  const i = prompt.indexOf("unlocked = await send({ type: 'SIDECAR_UNLOCK', pin })");
  assert.notEqual(i, -1);
  const around = prompt.slice(i, i + 400);
  assert.match(around, /catch \(e\) \{[\s\S]*?els\.pinError\.textContent = \(e && e\.message\)/);
});

test('init() cannot fail silently into a blank window', () => {
  assert.match(prompt, /init\(\)\.catch\(\(e\) => \{/);
  const fn = prompt.slice(prompt.indexOf('init().catch('));
  assert.match(fn, /els\.reject\.textContent = 'Close'/, 'and must leave a way out');
});
