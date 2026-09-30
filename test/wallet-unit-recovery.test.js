'use strict';

// A WALLET THAT RECOVERS STOPS SAYING IT FAILED. When the first balance read fails, the
// card's unit line reads "balance unavailable" and is flagged, so a repaint does not
// cover the failure with a unit. Nothing took the flag down again, so a wallet that failed
// on first load and answered on the next refresh showed its balance above "balance
// unavailable" (reported 2026-09-30).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const bare = src.replace(/^\s*\/\/.*$/gm, '');

function lift(name) {
  const at = bare.indexOf(name);
  assert.ok(at >= 0, name);
  // The body's brace, not a destructured parameter's: refreshWalletBalance takes
  // ({ force = false } = {}).
  const start = bare.indexOf(') {', at) + 2;
  let depth = 0;
  for (let i = start; i < bare.length; i++) {
    if (bare[i] === '{') depth++;
    if (bare[i] === '}' && --depth === 0) return bare.slice(at, i + 1);
  }
  throw new Error(name);
}

function harness({ joke = false } = {}) {
  const unit = { textContent: 'balance unavailable', dataset: { balanceError: '1' } };
  const reset = { removed: false, remove() { this.removed = true; } };
  const ctx = {
    document: {
      querySelector: (sel) => (sel === '.wallet-unit' ? unit : sel === '.wallet-balance' ? {} : null),
      querySelectorAll: (sel) => (sel === '.wallet-reset' ? [reset] : []),
    },
    btcJokeShowing: () => joke,
    denomParts: (sats) => ({ unit: 'sats', text: String(sats) }),
  };
  vm.createContext(ctx);
  vm.runInContext("const isBalanceErrorUnit = (el) => !!el && el.dataset.balanceError === '1';", ctx);
  vm.runInContext(lift('function clearBalanceError('), ctx);
  return { ctx, unit, reset };
}

test('a successful read clears the failure caption and its Reset connections button', () => {
  const { ctx, unit, reset } = harness();
  vm.runInContext('clearBalanceError(105752)', ctx);
  assert.equal(unit.textContent, 'sats');
  assert.equal(unit.dataset.balanceError, undefined, 'the flag is still up, so the next repaint skips the unit again');
  assert.ok(reset.removed, 'the Reset connections button outlived the failure it was for');
});

test('with the Bitcoin-only card up, only the flag goes and its caption is left alone', () => {
  const { ctx, unit } = harness({ joke: true });
  vm.runInContext('clearBalanceError(105752)', ctx);
  assert.equal(unit.dataset.balanceError, undefined);
  assert.equal(unit.textContent, 'balance unavailable', 'the joke repaints the unit when it ends; this must not');
});

test('every successful read clears it, including one whose figure did not change', () => {
  const fn = lift('async function refreshWalletBalance(');
  const clear = fn.indexOf('clearBalanceError(newSats);');
  const gate = fn.indexOf('if (changed || force)');
  assert.ok(clear !== -1, 'the live refresh no longer clears a recovered failure');
  assert.ok(clear < gate, 'cleared only when the figure changed, so an unchanged balance keeps the stale caption');
  const pinned = lift('async function renderPinnedBalanceBar(');
  assert.match(pinned, /clearBalanceError\(balanceCache\.sats\);/, 'a recovery the pinned bar sees is not passed on to the card');
});
