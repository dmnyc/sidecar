'use strict';

// Idle auto-lock measures time away from the computer, not time since Sidecar last signed.
//
// Reported: someone on the 30-minute setting, reading and scrolling in a client, found Sidecar
// locked “about every 30 minutes”. Only signatures, payments, unlocks and panel typing re-armed
// the timer, so reading for longer than the setting meant the next like or reply waited on a
// PIN. The alarm now asks chrome.idle whether the computer has been idle that long before it
// locks, and counts a screen lock as the start of the away time.
//
// These run the real functions from background.js against a stubbed chrome.idle.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl + ' in background.js');
  const open = source.indexOf('{', source.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}
function liftLine(re, label) {
  const m = source.match(re);
  if (!m) throw new Error('Could not find ' + label);
  return m[0];
}

// idle: undefined = no chrome.idle at all; otherwise { state, throws, lastError }
function harness({ minutes = 30, locked = false, idle, awaySince } = {}) {
  const calls = { locked: 0, alarms: [], queried: [], detection: [] };
  const session = {};
  if (awaySince != null) session.sidecar_away_since = awaySince;
  const chrome = {
    runtime: { lastError: undefined },
    alarms: { create: (name, opts) => calls.alarms.push({ name, ...opts }) },
    storage: { session: {
      remove(k, cb) { delete session[k]; if (cb) cb(); return Promise.resolve(); },
    } },
  };
  if (idle) {
    chrome.idle = {
      queryState(seconds, cb) {
        calls.queried.push(seconds);
        if (idle.throws) throw new Error('unsupported');
        if (idle.lastError) { chrome.runtime.lastError = { message: 'nope' }; cb(undefined); chrome.runtime.lastError = undefined; return; }
        cb(idle.state);
      },
      setDetectionInterval: (s) => calls.detection.push(s),
    };
  }
  const ctx = {
    chrome, Promise, Math, Error, Date,
    KS: { isLocked: () => locked, ensureLoaded: async () => {} },
    sget: async () => ({ sidecar_settings: { autoLockMinutes: minutes } }),
    sgetSession: async (k) => (k in session ? { [k]: session[k] } : {}),
    ssetSession: async (o) => { Object.assign(session, o); },
    lockKeystore: () => { calls.locked++; },
  };
  vm.createContext(ctx);
  vm.runInContext([
    liftLine(/const AUTO_LOCK_ALARM = [^\n]+/, 'AUTO_LOCK_ALARM'),
    liftLine(/const DEFAULT_AUTO_LOCK_MINUTES = [^\n]+/, 'DEFAULT_AUTO_LOCK_MINUTES'),
    lift('function resolveSettings('),
    liftLine(/const IDLE_RECHECK_MINUTES = [^\n]+/, 'IDLE_RECHECK_MINUTES'),
    liftLine(/const IDLE_MAX_SECONDS = [^\n]+/, 'IDLE_MAX_SECONDS'),
    liftLine(/const AWAY_SINCE_KEY = [^\n]+/, 'AWAY_SINCE_KEY'),
    lift('function idleSeconds('),
    lift('function setIdleDetection('),
    lift('function systemIdleState('),
    lift('async function checkAutoLock('),
    lift('async function onAutoLockAlarm('),
    lift('async function onSystemIdleState('),
    lift('function bumpAutoLock('),
  ].join('\n'), ctx);
  return { ctx, calls, session };
}
const MIN = 60000;

test('the alarm does not lock while the computer is in use; it checks again in a minute', async () => {
  const { ctx, calls } = harness({ minutes: 30, idle: { state: 'active' } });
  await ctx.onAutoLockAlarm();
  assert.equal(calls.locked, 0, 'reading in a client must not lock');
  assert.deepEqual(calls.queried, [1800], 'asks about the whole auto-lock window');
  assert.deepEqual(calls.alarms, [{ name: 'sidecar-auto-lock', delayInMinutes: 1 }]);
});

test('the alarm locks when the computer has been idle for the whole window', async () => {
  const { ctx, calls } = harness({ minutes: 30, idle: { state: 'idle' } });
  await ctx.onAutoLockAlarm();
  assert.equal(calls.locked, 1);
  assert.deepEqual(calls.alarms, [], 'nothing re-armed after locking');
});

test('without chrome.idle, or when it fails, the alarm locks as it always did', async () => {
  for (const idle of [undefined, { throws: true }, { lastError: true }, { state: undefined }]) {
    const { ctx, calls } = harness({ minutes: 15, idle });
    await ctx.onAutoLockAlarm();
    assert.equal(calls.locked, 1, JSON.stringify(idle));
  }
});

test('"When browser closes" never locks on the alarm or on idle events', async () => {
  const { ctx, calls } = harness({ minutes: 0, idle: { state: 'idle' } });
  await ctx.onAutoLockAlarm();
  await ctx.onSystemIdleState('idle');
  await ctx.onSystemIdleState('locked');
  assert.equal(calls.locked, 0);
});

test('the idle event locks once the computer has been idle for the setting', async () => {
  const { ctx, calls } = harness({ minutes: 15, idle: { state: 'idle' } });
  await ctx.onSystemIdleState('idle');
  assert.equal(calls.locked, 1);
});

test('a screen lock starts the away time; Sidecar locks when the setting has passed since', async () => {
  const { ctx, calls, session } = harness({ minutes: 15, idle: { state: 'locked' } });
  const t0 = Date.now();
  await ctx.onSystemIdleState('locked');
  assert.equal(calls.locked, 0, 'a two-minute coffee break does not need the PIN');
  assert.ok(Math.abs(session.sidecar_away_since - t0) < 1000, 'away from the moment the screen locked');
  assert.ok(Math.abs(calls.alarms.at(-1).delayInMinutes - 15) < 0.1, 'checks again when the setting has passed');
  await ctx.checkAutoLock(15, 'locked', t0 + 15 * MIN + 1);
  assert.equal(calls.locked, 1);
});

test('coming back clears the away time', async () => {
  const { ctx, calls, session } = harness({ minutes: 15, awaySince: Date.now() - 10 * MIN, idle: { state: 'active' } });
  await ctx.onSystemIdleState('active');
  assert.equal('sidecar_away_since' in session, false);
  assert.equal(calls.locked, 0);
});

test('an idle event while already locked does nothing (no second "locked" toast)', async () => {
  const { ctx, calls } = harness({ minutes: 15, locked: true, idle: { state: 'idle' } });
  await ctx.onSystemIdleState('idle');
  assert.equal(calls.locked, 0);
});

// Chrome clamps idle intervals to 4 hours (kMaxThreshold in extensions/browser/api/idle).
test('8 and 24 hours: idle for 4 hours starts the away time, and the lock waits for the full setting', async () => {
  for (const minutes of [480, 1440]) {
    const { ctx, calls, session } = harness({ minutes, idle: { state: 'idle' } });
    const now = Date.now();
    await ctx.checkAutoLock(minutes, 'idle', now);
    assert.equal(calls.locked, 0, minutes + ': 4 hours away is not ' + minutes / 60 + ' hours');
    assert.equal(session.sidecar_away_since, now - 4 * 60 * MIN, 'away since 4 hours ago');
    assert.equal(calls.alarms.at(-1).delayInMinutes, minutes - 240);
    await ctx.checkAutoLock(minutes, 'idle', now + (minutes - 240) * MIN);
    assert.equal(calls.locked, 1, minutes + ': locks when the full setting has passed');
  }
});

test('arming the timer sets the idle interval, capped at 4 hours, and clears old away time', async () => {
  for (const [minutes, seconds] of [[5, 300], [60, 3600], [1440, 14400]]) {
    const { ctx, calls, session } = harness({ minutes, awaySince: 1, idle: { state: 'active' } });
    ctx.bumpAutoLock();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(calls.alarms, [{ name: 'sidecar-auto-lock', delayInMinutes: minutes }]);
    assert.deepEqual(calls.detection, [seconds]);
    assert.equal('sidecar_away_since' in session, false);
  }
});

test('the idle listener is registered at the top level, so it can wake the worker', () => {
  // A listener added inside a function would be missing when the browser restarts an evicted
  // worker to deliver the event. Checked on the source because there is no worker to start here.
  assert.match(source, /^if \(chrome\.idle && chrome\.idle\.onStateChanged\) \{\n  chrome\.idle\.onStateChanged\.addListener/m);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'), /"idle"/);
});
