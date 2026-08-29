'use strict';

// Unit coverage for WHEN a balance is allowed to strike.
//
// THE REPORT (2026-08-29): signing an event while sitting on the Wallet tab re-ran the
// balance animation, on a balance that had not moved. Same thing when a wallet modal
// closed.
//
// Cause: `paintedSats` was a WeakMap keyed on the balance ELEMENT, so "has this figure
// changed?" was really asking "is this the same DOM node?". Any rebuild of the wallet
// card produced a fresh node with no record, `prev` came back undefined, and `animate`
// was trivially true. The pinned bar never showed the bug because its node lives for the
// life of the panel, which is also why this went unnoticed for so long — the surface that
// is visible on most tabs was the one surface that behaved.
//
// And the card is rebuilt constantly. refreshApproval() calls refresh() the moment the
// approval queue empties, and refresh() re-renders whatever tab is active; every wallet
// modal that closes (send, receive, budgets, disconnect) calls renderWallet() too.
//
// The record is now keyed by (slot, account). These tests pin the four cases that keying
// has to get right, because "don't animate" and "do animate" are both wrong answers in
// half of them.

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

function makeEl(id) {
  return {
    id: id || '',
    children: [],
    append(...nodes) { this.children.push(...nodes); },
    prepend(...nodes) { this.children.unshift(...nodes); },
    get textContent() { return this.children.map((c) => c.textContent).join(''); },
    set textContent(v) {
      this.children = [];
      if (v !== '') this.children.push({ textContent: String(v), className: '', style: '' });
    },
  };
}

function run(pubkey) {
  const ctx = {
    reduceBalanceMotion: false,
    state: { activePubkey: pubkey || 'npub-a' },
    Map,
    Array,
    Math,
    String,
    h: (tag, props) => Object.assign({ tag, textContent: '', className: '', style: '' }, props),
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/  const STRIKE_DELAY_MOD_MS[\s\S]*?\n  \};\n/, 'glyphBeat')
      + lift(/  \/\/ The strike dice[\s\S]*?\n  \}\n/, 'ironDiceStyle')
      + lift(/  const paintedSats = new Map\(\); \/\/ slot -> \{ pubkey, key \}\n/, 'paintedSats record')
      + lift(/  function balanceSlot\(el\) \{[\s\S]*?\n  \}\n/, 'balanceSlot')
      + lift(/  function forgetBalancePaint\(slot\) \{[\s\S]*?\n  \}\n/, 'forgetBalancePaint')
      + lift(/  function splitGlyphs\(el, text, strike\) \{[\s\S]*?\n  \}\n/, 'splitGlyphs')
      + lift(/  function paintBalanceEl\(el, parts, symClass\) \{[\s\S]*?\n  \}\n/, 'paintBalanceEl'),
    ctx
  );
  return ctx;
}

// A glyph carries .bal-in only when the paint decided to animate.
const struck = (el) => el.children.some((c) => (c.className || '').includes('bal-in'));

const SATS = { text: '21,458', sym: '', sats: 21458 };
const MORE = { text: '30,000', sym: '', sats: 30000 };

test('a rebuilt wallet card does not re-strike an unchanged balance', () => {
  const ctx = run();
  const first = makeEl();
  ctx.paintBalanceEl(first, SATS, 'wallet-fiat-sym');
  assert.ok(struck(first), 'the first paint strikes — the figure is arriving');

  // What renderWallet() does: a brand-new node, same figure. This is the bug.
  const rebuilt = makeEl();
  ctx.paintBalanceEl(rebuilt, SATS, 'wallet-fiat-sym');
  assert.equal(rebuilt.textContent, '21,458', 'it still has to be painted');
  assert.ok(!struck(rebuilt), 'but it must not animate — nothing about the balance changed');
});

test('a rebuilt card still strikes when the balance actually moved', () => {
  const ctx = run();
  ctx.paintBalanceEl(makeEl(), SATS, 'wallet-fiat-sym');
  const rebuilt = makeEl();
  ctx.paintBalanceEl(rebuilt, MORE, 'wallet-fiat-sym');
  assert.ok(struck(rebuilt), 'a real change is exactly what the animation is for');
});

test('the two surfaces keep separate records', () => {
  const ctx = run();
  const card = makeEl();
  const pinned = makeEl('pinned-balance-amt');
  ctx.paintBalanceEl(card, SATS, 'wallet-fiat-sym');
  ctx.paintBalanceEl(pinned, SATS, 'pinned-fiat-sym');
  assert.ok(struck(pinned), 'the pinned bar has its own first paint to strike for');

  // Repaint the card only; the pinned record must not have been consumed by it.
  const rebuilt = makeEl();
  ctx.paintBalanceEl(rebuilt, SATS, 'wallet-fiat-sym');
  assert.ok(!struck(rebuilt));
});

test('switching accounts strikes, even onto an identical figure', () => {
  // Under element keying this came for free, because the switch rebuilt the card. Keyed
  // by slot it has to be said out loud, or two accounts holding the same balance would
  // switch between each other in total silence.
  const ctx = run('npub-a');
  ctx.paintBalanceEl(makeEl(), SATS, 'wallet-fiat-sym');
  ctx.state.activePubkey = 'npub-b';
  const other = makeEl();
  ctx.paintBalanceEl(other, SATS, 'wallet-fiat-sym');
  assert.ok(struck(other), 'a different account is a different figure, whatever it reads');
});

test('forgetBalancePaint makes the next paint strike again', () => {
  // What entering the Wallet tab does, and what masking/unmasking does via
  // restrikeBalances: the numerals really are appearing, so they earn the animation.
  const ctx = run();
  ctx.paintBalanceEl(makeEl(), SATS, 'wallet-fiat-sym');
  ctx.forgetBalancePaint('wallet');
  const arriving = makeEl();
  ctx.paintBalanceEl(arriving, SATS, 'wallet-fiat-sym');
  assert.ok(struck(arriving));
});
