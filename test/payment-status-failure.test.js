'use strict';

// The payment bar's sub line is one line with an ellipsis, because it also carries a site's host
// name. A failure's message is different: a wallet's own words, or Sidecar's, can run past one line,
// and "The invoice may alrea..." tells the person nothing. A failure may wrap to two lines. These run
// the real render function.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

function lift(decl) {
  const at = panel.indexOf(decl);
  assert.ok(at !== -1, decl + ' is gone');
  let depth = 0;
  for (let i = panel.indexOf('{', at); i < panel.length; i++) {
    if (panel[i] === '{') depth++;
    else if (panel[i] === '}' && --depth === 0) return panel.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

function bar(state) {
  const els = {};
  const el = () => {
    const e = { classes: new Set(), textContent: '', children: [] };
    e.classList = {
      add: (c) => e.classes.add(c), remove: (c) => e.classes.delete(c), contains: (c) => e.classes.has(c),
      toggle: (c, on) => { if (on === undefined ? !e.classes.has(c) : on) e.classes.add(c); else e.classes.delete(c); },
    };
    e.append = (...k) => { e.children.push(...k); };
    return e;
  };
  const get = (id) => els[id] || (els[id] = el());
  const ctx = vm.createContext({
    document: { getElementById: get },
    paymentFlights: new Map(state.flights || []), paymentResult: state.result || null,
    h: () => el(), icon: () => el(), t: (s) => s, I18N: { fmtNum: (n) => String(n) },
  });
  vm.runInContext(lift('function renderPaymentStatus(') + '\nthis.render = renderPaymentStatus;', ctx);
  ctx.render();
  return get('payment-status');
}

test('a failed payment lets its message take a second line', () => {
  const failed = bar({ result: { ok: false, line: 'Payment failed', sub: 'The invoice may already be paid or no longer valid.' } });
  assert.equal(failed.classes.has('is-failed'), true);
});

test('a settled payment and a payment in flight keep the one-line sub', () => {
  assert.equal(bar({ result: { ok: true, line: 'Paid', sub: 'shop.example' } }).classes.has('is-failed'), false);
  assert.equal(bar({ flights: [['a', { label: 'Paying', sub: 'shop.example' }]] }).classes.has('is-failed'), false);
  // A failure beside a payment still in the air is not the headline: the flight is.
  assert.equal(bar({ flights: [['a', { label: 'Paying', sub: 'x' }]], result: { ok: false, line: 'Payment failed', sub: 'x' } }).classes.has('is-failed'), false);
});

test('the failure wrap is two lines then an ellipsis, and the flight host stays on one line', () => {
  const strip = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const failed = strip.match(/\.payment-status\.is-failed \.payment-status-sub\s*\{[^}]*\}/);
  assert.ok(failed, 'the failure rule is gone');
  assert.match(failed[0], /white-space:\s*normal/);
  assert.match(failed[0], /-webkit-line-clamp:\s*2/);
  const base = strip.match(/\.payment-status-sub\s*\{[^}]*\}/);
  assert.match(base[0], /white-space:\s*nowrap/, 'the host line of a payment in flight must stay on one line');
});
