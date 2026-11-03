'use strict';

// The lock screen said "Locked since your browser closed" after the lock button was pressed.
//
// On Never, the only lock Sidecar had no hand in is the browser closing, so the line was chosen
// from the setting alone, and the lock button on Never got it too. The background now records why
// it locked, in session storage, which a browser close clears, and the panel reads the browser
// close as "no reason on record". These run the real lockKeystore from background.js and the real
// lockLede from sidepanel.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function lift(source, file, decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl + ' in ' + file);
  const open = source.indexOf('{', source.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}
const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const keyLine = (src, name) => { const m = src.match(new RegExp("const " + name + " = '[^']+';")); if (!m) throw new Error('no ' + name); return m[0]; };

function lockHarness() {
  const session = {};
  const events = [];
  const ctx = {
    KS: { lock: async () => {} },
    SIGNER: { clearCache() {} },
    RELAX: { revokeAll: () => Promise.resolve(), },
    ZAPREQ: { clear: () => Promise.resolve() },
    markPendingUnlocks() {}, closeSwNwc() {}, syncRelaxBadge() {},
    AUTO_LOCK_ALARM: 'a', WEBLN_READ_GRANT_KEY: 'w',
    qrSecret: null,
    chrome: {
      runtime: { lastError: undefined, sendMessage: (m) => { events.push({ ...m, reasonThen: session.sidecar_lock_reason }); return Promise.resolve(); } },
      alarms: { clear() {} },
      storage: { session: {
        remove(k, cb) { delete session[k]; if (cb) cb(); },
        set(o) { Object.assign(session, o); return Promise.resolve(); },
      } },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(keyLine(bg, 'AWAY_SINCE_KEY') + keyLine(bg, 'LOCK_REASON_KEY') + lift(bg, 'background.js', 'async function lockKeystore(') + ';this.lockKeystore = lockKeystore;', ctx);
  return { ctx, session, events };
}

function ledeFn(theme) {
  const ctx = {
    t: (s) => s,
    document: { documentElement: { getAttribute: () => theme } },
  };
  vm.createContext(ctx);
  vm.runInContext(keyLine(panel, 'LOCK_REASON_KEY') + lift(panel, 'sidepanel.js', 'function lockLede(') + ';this.lockLede = lockLede;', ctx);
  return ctx.lockLede;
}

const BROWSER = 'Locked since your browser closed. Enter your PIN to unlock.';
const PLAIN = 'Enter your PIN to unlock.';

test('the lock button records a manual lock before the panel is told', async () => {
  const { ctx, session, events } = lockHarness();
  await ctx.lockKeystore();
  assert.equal(session.sidecar_lock_reason, 'manual');
  assert.equal(events[0].reasonThen, 'manual', 'written before the locked event goes out');
});

test('the idle timer records an auto lock', async () => {
  const { ctx, session } = lockHarness();
  await ctx.lockKeystore(true);
  assert.equal(session.sidecar_lock_reason, 'auto');
});

test('on Never, a manual lock reads as a plain prompt, not as a browser close', () => {
  const lede = ledeFn('speakeasy');
  assert.equal(lede({ autoLockMinutes: 0 }, 'manual'), PLAIN);
  assert.equal(lede({ autoLockMinutes: 0 }, 'auto'), PLAIN);
});

test('on Never with no reason on record, the browser closed', () => {
  const lede = ledeFn('speakeasy');
  assert.equal(lede({ autoLockMinutes: 0 }, undefined), BROWSER);
});

test('a timed lock never claims the browser closed', () => {
  const lede = ledeFn('speakeasy');
  assert.equal(lede({ autoLockMinutes: 30 }, undefined), PLAIN);
  assert.equal(lede({ autoLockMinutes: 30 }, 'manual'), PLAIN);
});

test('Ben Day’s caption picks the same way', () => {
  const lede = ledeFn('ben-day');
  assert.equal(lede({ autoLockMinutes: 0 }, 'manual'), 'Enter your PIN to unlock…');
  assert.equal(lede({ autoLockMinutes: 0 }, undefined), 'Locked since your browser closed. Enter your PIN to unlock…');
});
