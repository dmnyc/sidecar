'use strict';

// Unit coverage for the fiat currency symbol surviving a balance paint.
//
// THE REPORT (2026-08-24): the currency symbol stopped appearing when the balance is
// tapped through to local currency. It had shipped in v1.6.0 and worked through
// v1.8.0.
//
// Cause: paintBalanceEl appended the symbol span and then called splitGlyphs, whose
// first statement is `el.textContent = ''`. Setting textContent removes every child,
// so the symbol was created and destroyed one line later. Never released — splitGlyphs
// arrived after the last tag.
//
// It cost a second thing, quieter. The early return in paintBalanceEl compares
// el.textContent against sym + text to decide whether a repaint can be skipped. With
// the symbol always missing that comparison could never be true in fiat, so the guard
// never fired and every repaint rebuilt the figure — the mid-animation teardown the
// guard exists to prevent.
//
// Fix: build the figure first, prepend the symbol after. Which then makes the element
// hold a non-glyph child, so glyph parity moved off :nth-child(even) and onto a
// .bal-alt class published by splitGlyphs (Bauhaus alternates drop/rise on it).

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

// The one DOM behavior this bug turned on: assigning textContent drops all children.
// Everything else here is the minimum the two lifted functions touch.
function makeEl() {
  const el = {
    children: [],
    append(...nodes) { this.children.push(...nodes); },
    prepend(...nodes) { this.children.unshift(...nodes); },
    get textContent() { return this.children.map((c) => c.textContent).join(''); },
    set textContent(v) {
      this.children = [];
      if (v !== '') this.children.push({ textContent: String(v), className: '', style: '' });
    },
  };
  return el;
}

function run() {
  const ctx = {
    reduceBalanceMotion: false,
    // The paint record is per (surface, account) now, so both have to exist here.
    // These tests all drive the wallet card as one account; balance-peek and
    // balance-restrike cover what happens when either half of that key moves.
    state: { activePubkey: 'npub-test' },
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
      // The trailing newline is load-bearing: this line ends in a // comment, and without
      // it the next lifted chunk is concatenated onto the same line and commented out.
      + lift(/  const paintedSats = new Map\(\); \/\/ slot -> \{ pubkey, key \}\n/, 'paintedSats record')
      + lift(/  function balanceSlot\(el\) \{[\s\S]*?\n  \}\n/, 'balanceSlot')
      + lift(/  function splitGlyphs\(el, text, strike\) \{[\s\S]*?\n  \}\n/, 'splitGlyphs')
      + lift(/  function paintBalanceEl\(el, parts, symClass\) \{[\s\S]*?\n  \}\n/, 'paintBalanceEl'),
    ctx
  );
  return ctx;
}

const glyphs = (el) => el.children.filter((c) => (c.className || '').includes('bal-glyph'));

test('the fiat currency symbol survives the paint that builds the figure', () => {
  const ctx = run();
  const el = makeEl();
  ctx.paintBalanceEl(el, { text: '12.34', sym: '$', sats: 5000 }, 'wallet-fiat-sym');

  const sym = el.children.filter((c) => c.className === 'wallet-fiat-sym');
  assert.equal(sym.length, 1, 'the symbol span must still be in the element');
  assert.equal(sym[0].textContent, '$');
  assert.equal(el.children[0], sym[0], 'and it must lead, not trail the digits');
  assert.equal(el.textContent, '$12.34');
});

test('sats mode paints no symbol span at all', () => {
  const ctx = run();
  const el = makeEl();
  ctx.paintBalanceEl(el, { text: '21,458', sym: '', sats: 21458 }, 'wallet-fiat-sym');
  assert.equal(el.children.filter((c) => c.className === 'wallet-fiat-sym').length, 0);
  assert.equal(el.textContent, '21,458');
});

test('the repaint guard fires in fiat — an unchanged figure is left alone', () => {
  const ctx = run();
  const el = makeEl();
  const parts = { text: '12.34', sym: '$', sats: 5000 };
  ctx.paintBalanceEl(el, parts, 'wallet-fiat-sym');
  const before = el.children;
  ctx.paintBalanceEl(el, parts, 'wallet-fiat-sym');
  assert.equal(el.children, before, 'the second paint must not rebuild the DOM');
});

test('glyph parity is published, so it does not shift when a symbol shares the parent', () => {
  const ctx = run();
  const withSym = makeEl();
  const without = makeEl();
  ctx.paintBalanceEl(withSym, { text: '12.34', sym: '$', sats: 1 }, 'wallet-fiat-sym');
  ctx.paintBalanceEl(without, { text: '12.34', sym: '', sats: 2 }, 'wallet-fiat-sym');

  const alt = (el) => glyphs(el).map((g) => g.className.includes('bal-alt'));
  assert.deepEqual(alt(withSym), alt(without),
    'the same figure must alternate identically in fiat and in sats');
  // and it is genuinely alternating, not all-false
  assert.deepEqual(alt(without), [false, true, false, true, false]);
});

test('a balance change re-animates; a denomination toggle does not', () => {
  const ctx = run();
  const el = makeEl();
  ctx.paintBalanceEl(el, { text: '21,458', sym: '', sats: 21458 }, 'wallet-fiat-sym');
  assert.ok(glyphs(el).every((g) => g.className.includes('bal-in')), 'first paint strikes');

  // same sats, different denomination — repaint, no strike
  ctx.paintBalanceEl(el, { text: '12.34', sym: '$', sats: 21458 }, 'wallet-fiat-sym');
  assert.ok(glyphs(el).every((g) => !g.className.includes('bal-in')), 'a toggle must not strike');

  // a real change strikes again
  ctx.paintBalanceEl(el, { text: '99.99', sym: '$', sats: 30000 }, 'wallet-fiat-sym');
  assert.ok(glyphs(el).every((g) => g.className.includes('bal-in')), 'a new balance strikes');
});
