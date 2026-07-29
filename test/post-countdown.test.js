'use strict';

// Unit coverage for postCountdownSetting() — the gate that decides whether the review
// window appears before something irreversible is published.
//
// The countdown itself is DOM work and isn't unit-testable here, but WHETHER it runs
// is pure logic, and it fails in the dangerous direction if it gets this wrong: a
// missing countdown means a note or comment goes out with no chance to catch it. So
// the default has to be on, and anything unreadable has to resolve to on as well.
//
// Comments deliberately read the SAME setting as notes. The toggle is worded "Review
// countdown before posting" and covers everything publishable; a second switch would
// drift out of step with the first.

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

function harness(settings, { throws } = {}) {
  const ctx = {
    console,
    call: async (msg) => {
      if (msg.type !== 'SIDECAR_GET_SETTINGS') throw new Error('unexpected ' + msg.type);
      if (throws) throw new Error('locked');
      return settings;
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/const NOTE_COUNTDOWN_PRESETS = \[[^\]]*\];/, 'NOTE_COUNTDOWN_PRESETS') + '\n' +
    lift(/const NOTE_COUNTDOWN_DEFAULT = \d+;/, 'NOTE_COUNTDOWN_DEFAULT') + '\n' +
    lift(/async function postCountdownSetting\(\)\s*\{[\s\S]*?\n  \}/, 'postCountdownSetting') + '\n' +
    'globalThis.postCountdownSetting = postCountdownSetting;' +
    'globalThis.PRESETS = NOTE_COUNTDOWN_PRESETS;' +
    'globalThis.DEFAULT_SECS = NOTE_COUNTDOWN_DEFAULT;',
    ctx
  );
  return ctx;
}

// ---- the default is ON ---------------------------------------------------------

test('a user who has never touched the setting gets the countdown', async () => {
  const ctx = harness({});
  const r = await ctx.postCountdownSetting();
  assert.equal(r.on, true, 'absent must mean on, not off');
  assert.equal(r.secs, ctx.DEFAULT_SECS);
});

test('only an explicit false turns it off', async () => {
  assert.equal((await harness({ noteCountdown: false }).postCountdownSetting()).on, false);
  for (const v of [true, undefined, null, 0, '', 'no']) {
    // Anything that isn't literally `false` keeps the guard on. A stored 0 or ''
    // from some future migration must not silently disable it.
    const r = await harness({ noteCountdown: v }).postCountdownSetting();
    assert.equal(r.on, true, 'noteCountdown=' + JSON.stringify(v) + ' should stay on');
  }
});

test('unreadable settings fail toward showing the countdown', async () => {
  // A locked keystore or a dead message port must not be a silent way to skip the
  // review window — the whole point is that publishing is irreversible.
  const r = await harness(null, { throws: true }).postCountdownSetting();
  assert.equal(r.on, true);
  assert.equal(r.secs, 15);
});

test('a null settings object does not throw', async () => {
  const r = await harness(null).postCountdownSetting();
  assert.equal(r.on, true);
});

// ---- the duration -------------------------------------------------------------

test('a stored preset is honored', async () => {
  const ctx = harness({ noteCountdownSecs: 5 });
  for (const secs of ctx.PRESETS) {
    assert.equal((await harness({ noteCountdownSecs: secs }).postCountdownSetting()).secs, secs);
  }
});

test('a value outside the presets falls back to the default', async () => {
  // Guards against a hand-edited or migrated setting producing a 0-second countdown,
  // which would look like the feature is on while giving no time to react.
  for (const bad of [0, -5, 1, 999, 7.5, '10', null, undefined, NaN]) {
    const r = await harness({ noteCountdownSecs: bad }).postCountdownSetting();
    assert.equal(r.secs, 15, 'noteCountdownSecs=' + JSON.stringify(bad));
  }
});

test('every preset is a usable number of seconds', async () => {
  const ctx = harness({});
  for (const s of ctx.PRESETS) {
    assert.equal(typeof s, 'number');
    assert.ok(s >= 3, 'a countdown under 3s leaves no time to cancel: ' + s);
  }
  assert.ok(ctx.PRESETS.includes(ctx.DEFAULT_SECS), 'the default must be selectable');
});

// ---- one setting, not two -----------------------------------------------------

test('comments and notes read the same setting key', () => {
  // Structural, on purpose. If someone adds a `commentCountdown` later, the two
  // controls will disagree and the Settings pane will carry two switches for one
  // idea — the thing this design decision was made to avoid.
  assert.ok(!/commentCountdown/.test(source),
    'a separate comment countdown setting was introduced');
  // Both post paths go through the shared resolver rather than reading settings inline.
  const readers = source.match(/noteCountdown\b/g) || [];
  assert.ok(readers.length <= 3,
    'noteCountdown is read in ' + readers.length + ' places; it should be the resolver + settings UI only');
});

test('the shared countdown is used by both callers', () => {
  const uses = source.match(/showPostCountdown\(\{/g) || [];
  assert.equal(uses.length, 2, 'expected exactly the note composer and the comment modal');
});
