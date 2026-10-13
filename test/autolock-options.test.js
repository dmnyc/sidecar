'use strict';

// The Auto-lock picker: 5, 15 and 30 minutes, an hour, 8 and 24 hours, then "When browser closes",
// the longest wait, last. 1 minute is retired for new picks, but an account that chose it keeps it:
// the picker shows a stored value it no longer offers rather than moving a lock timer by itself.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const options = (html) => {
  const at = html.indexOf('<select id="autolock-select">');
  const block = html.slice(at, html.indexOf('</select>', at));
  return [...block.matchAll(/<option value="(\d+)"[^>]*>([^<]*)<\/option>/g)].map((m) => [Number(m[1]), m[2]]);
};
const EXPECTED = [[5, 'After 5 minutes'], [15, 'After 15 minutes'], [30, 'After 30 minutes'], [60, 'After 1 hour'],
  [480, 'After 8 hours'], [1440, 'After 24 hours'], [0, 'When browser closes']];

test('the picker offers the agreed choices in order, with the longest wait last', () => {
  assert.deepEqual(options(read('sidepanel.html')), EXPECTED);
});

test('the layout reference page lists the same choices', () => {
  assert.deepEqual(options(read('docs/streaming/layout.html')), EXPECTED);
});

test('nothing still calls the last choice "Until browser closes" or offers one minute', () => {
  for (const f of ['sidepanel.html', 'help.html', 'docs/streaming/layout.html', 'CHANGELOG.md']) {
    const text = read(f);
    const current = f === 'CHANGELOG.md' ? text.slice(0, text.indexOf('## [1.15.9]')) : text;
    assert.doesNotMatch(current, /Until browser closes/, f);
  }
  assert.doesNotMatch(read('sidepanel.html'), /<option value="1" data-i18n="After 1 minute"/);
});

test('an account that never chose still gets 15 minutes', () => {
  assert.match(read('background.js'), /const DEFAULT_AUTO_LOCK_MINUTES = 15;/);
});

// ---- a stored choice the list no longer offers stays visible and in force ----
const src = read('sidepanel.js');
const at = src.indexOf('  function ensureAutoLockOption(');
const fn = src.slice(at, src.indexOf('  async function renderSettings()', at));

function picker() {
  const opts = EXPECTED.map(([value, text]) => ({ value: String(value), textContent: text, dataset: {}, remove() { opts.splice(opts.indexOf(this), 1); } }));
  const select = { get options() { return opts; }, insertBefore(option, before) { const i = before ? opts.indexOf(before) : opts.length; opts.splice(i, 0, option); } };
  const ctx = {
    h: (tag, props) => ({ tag, dataset: {}, remove() { opts.splice(opts.indexOf(this), 1); }, ...props }),
    tn: (one, other, n) => (n === 1 ? one : other).replace('{{count}}', n),
  };
  vm.createContext(ctx);
  vm.runInContext(fn, ctx);
  return { select, opts, ensure: (m) => ctx.ensureAutoLockOption(select, m), values: () => opts.map((o) => Number(o.value)) };
}

test('a one-minute setting is shown, first, and nothing else changes', () => {
  const p = picker();
  p.ensure(1);
  assert.deepEqual(p.values(), [1, 5, 15, 30, 60, 480, 1440, 0]);
  assert.equal(p.opts[0].textContent, 'After 1 minute');
  assert.equal(p.opts[0].dataset.legacy, '1');
});

test('a value between choices lands in order, and one above them lands before the last', () => {
  const p = picker();
  p.ensure(7);
  assert.deepEqual(p.values(), [5, 7, 15, 30, 60, 480, 1440, 0]);
  const q = picker();
  q.ensure(2880);
  assert.deepEqual(q.values(), [5, 15, 30, 60, 480, 1440, 2880, 0]);
  assert.equal(q.opts[6].textContent, 'After 2880 minutes');
});

test('offered values, and "when the browser closes", add nothing', () => {
  for (const m of [5, 15, 30, 60, 480, 1440, 0]) {
    const p = picker();
    p.ensure(m);
    assert.deepEqual(p.values(), [5, 15, 30, 60, 480, 1440, 0], String(m));
  }
});

test('the extra entry goes away once a different value is stored, and is never duplicated', () => {
  const p = picker();
  p.ensure(1);
  p.ensure(1);
  assert.equal(p.values().filter((v) => v === 1).length, 1);
  p.ensure(30);
  assert.deepEqual(p.values(), [5, 15, 30, 60, 480, 1440, 0]);
});

test('Settings uses it before it sets the picker', () => {
  const call = src.indexOf("ensureAutoLockOption($('autolock-select')");
  const set = src.indexOf("$('autolock-select').value = String(settings.autoLockMinutes || 0);");
  assert.ok(call > 0 && set > call, 'the entry must exist before the value is assigned, or the select shows nothing');
});
