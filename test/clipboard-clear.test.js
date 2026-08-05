'use strict';

// Unit coverage for the timed clipboard clear in sidepanel.js (copySecret /
// copyPlain / cancelClipboardClear).
//
// The exposure this pins shut: the reveal modal auto-hides a secret after 30s,
// but a COPY of it used to live on the clipboard forever — OS clipboard history
// and cross-device sync retain it indefinitely. copySecret() schedules a clear;
// what these tests really guard is the clear's aim. Wiping the secret is the
// easy part — the dangerous failure is wiping something ELSE: a value the user
// copied after the secret. So every assertion is one of two claims: the secret
// is cleared when it's still the thing on the clipboard, and nothing is cleared
// when it isn't (a later copyPlain, a manual Ctrl+C-style cancel, a readable
// clipboard holding different content).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

const SECRET = 'nsec1testsecretvalue000000000000000000000000';

// Builds a context with a scripted clipboard and hand-cranked timers, so the
// scheduling is exercised without a DOM or real time.
//   readText: undefined → readText rejects (the no-clipboardRead reality);
//             a function → resolves with its return value.
function harness({ readText } = {}) {
  const writes = [];
  const timers = new Map();
  let nextTimerId = 1;
  const ctx = {
    console,
    navigator: {
      clipboard: {
        writeText: async (text) => { writes.push(text); },
        readText: async () => {
          if (!readText) throw new Error('clipboardRead not granted');
          return readText();
        },
      },
    },
    setTimeout: (fn, ms) => {
      const id = nextTimerId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => { timers.delete(id); },
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/const CLIPBOARD_CLEAR_S = \d+;/, 'CLIPBOARD_CLEAR_S') + '\n' +
    lift(/let clipClearTimer = null;/, 'clipClearTimer') + '\n' +
    lift(/function cancelClipboardClear\(\)[\s\S]*?\n  \}/, 'cancelClipboardClear') + '\n' +
    lift(/async function copyPlain\([\s\S]*?\n  \}/, 'copyPlain') + '\n' +
    lift(/async function copySecret\([\s\S]*?\n  \}/, 'copySecret') + '\n' +
    'globalThis.copyPlain = copyPlain;' +
    'globalThis.copySecret = copySecret;' +
    'globalThis.cancelClipboardClear = cancelClipboardClear;' +
    'globalThis.CLIPBOARD_CLEAR_S = CLIPBOARD_CLEAR_S;',
    ctx
  );
  // Run every armed timer callback (insertion order) and settle its promise.
  async function fireTimers() {
    const due = [...timers.values()];
    timers.clear();
    for (const t of due) await t.fn();
  }
  return { ctx, writes, timers, fireTimers };
}

// ---- the clear fires when the secret is still on the clipboard -----------------

test('copySecret writes the secret and schedules one clear at the announced delay', async () => {
  const { ctx, writes, timers } = harness();
  await ctx.copySecret(SECRET);
  assert.deepEqual(writes, [SECRET]);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].ms, ctx.CLIPBOARD_CLEAR_S * 1000);
});

test('unreadable clipboard (no clipboardRead) → the clear happens blind', async () => {
  const { ctx, writes, fireTimers } = harness();
  await ctx.copySecret(SECRET);
  await fireTimers();
  assert.deepEqual(writes, [SECRET, '']);
});

test('readable clipboard still holding the secret → cleared', async () => {
  const { ctx, writes, fireTimers } = harness({ readText: () => SECRET });
  await ctx.copySecret(SECRET);
  await fireTimers();
  assert.deepEqual(writes, [SECRET, '']);
});

test('a failed clear write (panel unfocused/closed) is swallowed', async () => {
  const { ctx, fireTimers } = harness();
  await ctx.copySecret(SECRET);
  ctx.navigator.clipboard.writeText = async () => { throw new Error('Document is not focused'); };
  await fireTimers(); // must not reject
});

// ---- nothing is cleared when the secret is no longer the thing there -----------

test('readable clipboard holding something else → left alone', async () => {
  const { ctx, writes, fireTimers } = harness({ readText: () => 'lnbc1invoicecopiedelsewhere' });
  await ctx.copySecret(SECRET);
  await fireTimers();
  assert.deepEqual(writes, [SECRET]); // no '' write
});

test('a later copyPlain cancels the pending clear (the public value replaced the secret)', async () => {
  const { ctx, writes, timers, fireTimers } = harness();
  await ctx.copySecret(SECRET);
  await ctx.copyPlain('npub1publicvalue');
  assert.equal(timers.size, 0);
  await fireTimers();
  assert.deepEqual(writes, [SECRET, 'npub1publicvalue']);
});

test('cancelClipboardClear (the manual-copy listener) disarms the timer', async () => {
  const { ctx, writes, timers, fireTimers } = harness();
  await ctx.copySecret(SECRET);
  ctx.cancelClipboardClear();
  assert.equal(timers.size, 0);
  await fireTimers();
  assert.deepEqual(writes, [SECRET]);
});

test('a second copySecret replaces the first timer — one pending clear, for the new secret', async () => {
  const { ctx, writes, timers, fireTimers } = harness();
  await ctx.copySecret(SECRET);
  await ctx.copySecret('nsec1secondsecret0000000000000000000000000');
  assert.equal(timers.size, 1);
  await fireTimers(); // blind clear — aimed at the latest copy
  assert.deepEqual(writes, [SECRET, 'nsec1secondsecret0000000000000000000000000', '']);
});
