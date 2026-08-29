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

// ---------------------------------------------------------------------------------
// WHERE the strike is earned, as opposed to whether the guard works.
//
// The four cases above pin paintBalanceEl itself. What they cannot see is that keying
// the record by slot moved the decision OUT of paintBalanceEl and into its callers:
// under the old element keying, every renderWallet() minted a fresh node and struck by
// accident, so no caller had to think about it. Two routes were relying on that
// accident and lost their animation when it went away — the refresh button, and
// arriving on the wallet from the lock screen.
//
// These are source assertions, which is a blunt instrument, and they are here because
// the alternative is a browser: the call sites are inside renderWallet and refresh(),
// neither of which can be lifted into a vm. They check the one thing that actually
// broke — that the route clears the slot before it re-renders.

const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

test('the refresh button clears the wallet slot before re-rendering', () => {
  const m = panel.match(/refresh\.addEventListener\('click',([^\n]*)\)/);
  assert.ok(m, 'could not find the wallet refresh click handler');
  assert.match(
    m[1],
    /forgetBalancePaint\('wallet'\)/,
    "the refresh button must forget the wallet slot first, or the rebuilt card finds the " +
    'same figure and redraws in silence — a refresh that reports nothing looks broken'
  );
});

test('arriving from the lock screen clears both balance slots', () => {
  // Scoped to the wasLocked branch on purpose. The same refresh() runs when an approval
  // settles, and forgetting unconditionally would restore the very bug #248 fixed.
  const m = panel.match(/if \(wasLocked\) \{([\s\S]*?)\n      \}/);
  assert.ok(m, 'could not find the wasLocked branch in refresh()');
  for (const slot of ['wallet', 'pinned']) {
    assert.match(
      m[1],
      new RegExp("forgetBalancePaint\\('" + slot + "'\\)"),
      `unlocking is a first showing, so the ${slot} balance should strike`
    );
  }
  const unconditional = /wasLocked = false;\s*\n\s*forgetBalancePaint/.test(panel);
  assert.ok(!unconditional, 'forgetting outside the wasLocked branch re-breaks bug B');
});

test('an approval settling does not rebuild a still-valid wallet view', () => {
  // Approving a signature re-syncs the panel, because an approval CAN move the active
  // account. It cannot change what is in a wallet, and a full renderWallet() is a relay
  // round trip plus a teardown that resets the transaction list's paging. The approval
  // path therefore asks refresh() to keep the view, and refresh() decides for itself
  // whether keeping it is safe.
  assert.match(
    panel,
    /if \(!hasHead && wasShowing\) refresh\(\{ keepWallet: true \}\)/,
    'refreshApproval should ask refresh() to keep a still-valid wallet view'
  );

  const branch = panel.match(/const reusable = opts && opts\.keepWallet([\s\S]*?)\n {8}\}/);
  assert.ok(branch, 'could not find the wallet branch in refresh()');
  // Both proofs are load-bearing: the account can genuinely change under an approval
  // (switchToPubkey, detach), and the connect screen has no balance node to patch.
  assert.match(branch[1], /walletRenderedFor === state\.activePubkey/,
    'a changed account must still force a full rebuild');
  assert.match(branch[1], /querySelector\('\.wallet-balance'\)/,
    'the connect screen has nothing to patch and must still rebuild');
  assert.match(branch[1], /refreshWalletBalance\(\);\s*\n\s*refreshTransactionList\(\);/,
    'the reusable path should use the targeted helpers, not a rebuild');
});
