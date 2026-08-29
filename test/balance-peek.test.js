'use strict';

// Unit coverage for the balance peek.
//
// Revealing a masked balance is permanent by default and always was: the eye flips
// `hideBalances` and writes it to settings, so the amounts stay up until you mask them
// again. `autoHideBalances` is the opt-in for anyone who would rather a glance expire —
// on, a reveal lasts 30 seconds and then masks itself.
//
// The thing worth pinning is not the timer, it is the SPLIT the timer forced. A reveal
// that expires and a preference that persists cannot be the same variable — if the eye
// still wrote the setting while peeking, the expiry would have to write the user's real
// choice back over itself half a minute later. So `hideBalances` is what the panel is
// showing, `hideBalancesPref` is what the user chose, and the two come apart for exactly
// the length of a peek. Most of what follows asserts that a peek does NOT touch the
// preference, in each of the ways a peek can end — and that with the opt-in off, none of
// this machinery runs at all.

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

const lifted = [
  lift(/const BALANCE_PEEK_MS = \d+;/, 'BALANCE_PEEK_MS'),
  lift(/\n {2}function beginBalancePeek\(\) \{[\s\S]*?\n {2}\}\n/, 'beginBalancePeek'),
  lift(/\n {2}function endBalancePeek\(\) \{[\s\S]*?\n {2}\}\n/, 'endBalancePeek'),
  lift(/\n {2}async function setHideBalancesPref\(v\) \{[\s\S]*?\n {2}\}\n/, 'setHideBalancesPref'),
  lift(/\n {2}async function onBalanceEye\(\) \{[\s\S]*?\n {2}\}\n/, 'onBalanceEye'),
].join('\n');

// A hand-run clock, so the 30 seconds are asserted rather than waited out.
function harness(pref, autoHide = true) {
  const clock = { now: 0, next: 1, timers: new Map() };
  const ctx = {
    hideBalances: pref,
    hideBalancesPref: pref,
    autoHideBalances: autoHide,
    _balancePeekTimer: null,
    syncs: 0,
    toasts: [],
    writes: [],
    syncHideControls: () => { ctx.syncs++; },
    toast: (m) => { ctx.toasts.push(m); },
    call: async (msg) => { ctx.writes.push(msg); return {}; },
    setTimeout: (fn, ms) => {
      const id = clock.next++;
      clock.timers.set(id, { fn, at: clock.now + ms });
      return id;
    },
    clearTimeout: (id) => { clock.timers.delete(id); },
  };
  vm.createContext(ctx);
  vm.runInContext('(function () {\n' + lifted + '\nthis.api = { beginBalancePeek, endBalancePeek, setHideBalancesPref, onBalanceEye, BALANCE_PEEK_MS };\n}).call(this)', ctx);
  ctx.advance = (ms) => {
    clock.now += ms;
    for (const [id, t] of [...clock.timers]) {
      if (t.at <= clock.now) { clock.timers.delete(id); t.fn(); }
    }
  };
  ctx.pending = () => clock.timers.size;
  return ctx;
}

test('the reveal expires after 30 seconds, and says so', async () => {
  const c = harness(true);
  await c.api.onBalanceEye();
  assert.equal(c.hideBalances, false, 'the eye reveals');
  assert.equal(c.pending(), 1, 'and arms the expiry');

  c.advance(c.api.BALANCE_PEEK_MS - 1);
  assert.equal(c.hideBalances, false, 'still revealed a millisecond short of the window');

  c.advance(1);
  assert.equal(c.hideBalances, true, 'masked again on its own');
  assert.deepEqual(c.toasts, ['Balances hidden again'], 'the snap back is announced');
});

test('a peek never writes the preference, however it ends', async () => {
  // Expired.
  let c = harness(true);
  await c.api.onBalanceEye();
  c.advance(c.api.BALANCE_PEEK_MS);
  assert.equal(c.hideBalancesPref, true);
  assert.deepEqual(c.writes, [], 'nothing persisted by a peek that ran its course');

  // Ended early by the eye.
  c = harness(true);
  await c.api.onBalanceEye();
  await c.api.onBalanceEye();
  assert.equal(c.hideBalances, true, 'the second tap re-masks');
  assert.equal(c.hideBalancesPref, true);
  assert.deepEqual(c.writes, [], 'nothing persisted by a peek the user closed');
  assert.deepEqual(c.toasts, [], 'and nothing announced — the user did it');
  assert.equal(c.pending(), 0, 'the expiry is dropped, not left to fire on a masked panel');
});

test('the eye masks durably, because masking more is the safe direction', async () => {
  const c = harness(false);
  await c.api.onBalanceEye();
  assert.equal(c.hideBalances, true);
  assert.equal(c.hideBalancesPref, true);
  // Field by field rather than deepEqual: the message is built inside the vm realm, so
  // it does not share a prototype with anything constructed out here.
  assert.equal(c.writes.length, 1);
  assert.equal(c.writes[0].type, 'SIDECAR_SET_SETTINGS');
  assert.equal(c.writes[0].settings.hideBalances, true);
  assert.equal(c.pending(), 0, 'masking arms no timer');
});

test('turning the preference off during a peek leaves balances visible for good', async () => {
  const c = harness(true);
  await c.api.onBalanceEye();
  await c.api.setHideBalancesPref(false); // the Settings row, mid-peek
  assert.equal(c.pending(), 0, 'the peek expiry is cancelled, not left armed');
  c.advance(c.api.BALANCE_PEEK_MS * 2);
  assert.equal(c.hideBalances, false, 'no stale timer re-masks a wallet the user unmasked');
  assert.equal(c.hideBalancesPref, false);
});

test('a second peek replaces the first rather than stacking', async () => {
  const c = harness(true);
  await c.api.onBalanceEye();        // peek
  await c.api.onBalanceEye();        // close it
  await c.api.onBalanceEye();        // peek again
  assert.equal(c.pending(), 1, 'one expiry outstanding, not two');
  c.advance(c.api.BALANCE_PEEK_MS);
  assert.equal(c.hideBalances, true);
  assert.deepEqual(c.toasts, ['Balances hidden again'], 'and it fires once');
});

// ---- the opt-in is off, which is what nearly every user gets -----------------------

test('by default a reveal lasts until the user masks it', async () => {
  const c = harness(true, false);
  await c.api.onBalanceEye();
  assert.equal(c.hideBalances, false, 'revealed');
  assert.equal(c.pending(), 0, 'nothing armed to take it away again');
  assert.equal(c.hideBalancesPref, false, 'and the reveal IS the preference now');
  assert.equal(c.writes.length, 1);
  assert.equal(c.writes[0].settings.hideBalances, false, 'written down, because it was a decision');

  c.advance(c.api.BALANCE_PEEK_MS * 10);
  assert.equal(c.hideBalances, false, 'still up ten windows later');
  assert.deepEqual(c.toasts, [], 'and nothing has announced itself');
});

test('by default the eye is a plain two-way toggle', async () => {
  const c = harness(true, false);
  await c.api.onBalanceEye();   // reveal
  await c.api.onBalanceEye();   // mask
  assert.equal(c.hideBalances, true);
  assert.equal(c.hideBalancesPref, true);
  assert.equal(c.writes.length, 2, 'both directions persist, as they did before the timeout existed');
  assert.equal(c.writes[1].settings.hideBalances, true);
});
