'use strict';

// "Save 212 as your default" appears under the amount once there is something to save and goes
// again when there is not. In the centered zap card that changed the card's height with every
// digit typed. The line now keeps its place: a no-break space when empty, held by the stylesheet.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const at = source.indexOf('  function zapDefaultSaver(');
const fn = source.slice(at, source.indexOf('  // WHOSE amount.', at));

function saver(defaultSats = 21) {
  const classes = new Set(['hidden']);
  const btn = {
    textContent: '', addEventListener() {},
    classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); }, contains: (n) => classes.has(n) },
  };
  const amount = { value: '', listeners: {}, addEventListener(type, f) { this.listeners[type] = f; } };
  const ctx = { h: () => btn, defaultZapSats: defaultSats, clampZapDefault: (n) => Math.min(Number(n), 1e6), t: (x, v) => x.replace('{{amount}}', v.amount), fmtSats: String, parseInt };
  vm.createContext(ctx);
  vm.runInContext(fn, ctx);
  ctx.zapDefaultSaver(amount, {}, null);
  return { btn, type(v) { amount.value = v; amount.listeners.input(); } };
}

test('with nothing to save, the line is a no-break space, not nothing', () => {
  const s = saver();
  assert.equal(s.btn.textContent, ' ');
  assert.equal(s.btn.classList.contains('hidden'), true);
  s.type('212');
  assert.equal(s.btn.textContent, 'Save {{amount}} as your default'.replace('{{amount}}', '212'));
  assert.equal(s.btn.classList.contains('hidden'), false);
  s.type('');
  assert.equal(s.btn.textContent, ' ', 'it goes back to holding its place');
  s.type('21');
  assert.equal(s.btn.textContent, ' ', 'an amount that is already the default has nothing to save');
});

test('in the zap card the hidden line keeps its height but cannot be seen or clicked', () => {
  const rule = css.match(/\.peek-zap \.zap-save-default\.hidden \{([^}]*)\}/);
  assert.ok(rule, 'the card holds the line');
  assert.match(rule[1], /display:\s*block\s*!important/);
  assert.match(rule[1], /visibility:\s*hidden/);
  assert.match(rule[1], /pointer-events:\s*none/);
  assert.match(css, /\.hidden \{ display: none !important; \}/, 'everywhere else it is still absent');
});
