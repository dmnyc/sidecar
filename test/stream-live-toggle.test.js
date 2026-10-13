'use strict';

// LIVE, at the top left of the stream player, shows and hides the stream list. The title keeps
// opening About stream, and the chevron keeps toggling the list. These run the real toggle
// code out of streams.js with the drawing and the network stubbed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'streams.js'), 'utf8');
const CODE = [
  source.match(/  function setFeedExpanded\(on\) \{[\s\S]*?\n  \}\n/)[0],
  source.match(/  function closeFeed\(\) \{[\s\S]*?\n  \}\n  function toggleFeed\(\) \{[\s\S]*?\n  \}\n/)[0],
  source.match(/  browse\.addEventListener\('click', toggleFeed\);\n  titleButton\.addEventListener\('click', [^\n]*\n  feedToggle\.addEventListener\('click', toggleFeed\);\n/)[0],
].join('\n');

function button() {
  const attrs = {}; const events = {};
  return { disabled: false, hidden: false, attrs, events,
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; },
    addEventListener(n, f) { events[n] = f; }, click() { events.click(); } };
}
function page({ locked = false, details = true } = {}) {
  const flags = new Set(); const calls = { discover: 0, closeDetails: 0, toggleDetails: 0, timers: [] };
  const directory = {
    hidden: true,
    classList: { add: (c) => flags.add(c), remove: (c) => flags.delete(c), contains: (c) => flags.has(c) },
    setAttribute() {}, offsetHeight: 0,
  };
  const ctx = {
    enabled: true, locked, browse: button(), titleButton: button(), feedToggle: button(), entry: button(),
    directory, feedCloseTimer: null, root: { hidden: false },
    isLocked: () => ctx.locked, disconnect() {}, updateBackup() {}, positionDirectory() {}, chat: { sync() {} },
    discover() { calls.discover++; },
    details: details ? { close() { calls.closeDetails++; }, toggle() { calls.toggleDetails++; } } : null,
    document: { documentElement: { classList: { toggle() {} }, style: {} }, body: { append() {} } },
    window: { dispatchEvent() {} }, CustomEvent: class { constructor(t) { this.type = t; } },
    getComputedStyle: () => ({ getPropertyValue: () => '0' }),
    setTimeout: (fn, ms) => { calls.timers.push({ fn, ms }); return calls.timers.length; }, clearTimeout() {},
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  ctx.calls = calls; ctx.flags = flags;
  return ctx;
}
const isOpen = (p) => !p.directory.hidden && p.flags.has('is-open');

test('LIVE shows the stream list', () => {
  const p = page();
  p.browse.click();
  assert.equal(isOpen(p), true);
  assert.equal(p.calls.discover, 1, 'and looks for streams');
  assert.equal(p.browse.getAttribute('aria-expanded'), 'true');
});

test('PRESSING LIVE AGAIN HIDES IT', () => {
  const p = page();
  p.browse.click();
  p.browse.click();
  assert.equal(p.flags.has('is-open'), false);
  assert.equal(p.flags.has('is-closing'), true);
  assert.equal(p.browse.getAttribute('aria-expanded'), 'false');
  p.calls.timers.at(-1).fn();
  assert.equal(p.directory.hidden, true, 'and it is gone once the close animation ends');
});

test('LIVE never opens About stream', () => {
  const p = page();
  p.browse.click(); p.browse.click();
  assert.equal(p.calls.toggleDetails, 0);
});

test('the title opens About stream and leaves the list alone', () => {
  const p = page();
  p.titleButton.click();
  assert.equal(p.calls.toggleDetails, 1);
  assert.equal(isOpen(p), false);
  assert.equal(p.calls.discover, 0);
});

test('opening the list closes About, as the chevron always did', () => {
  const p = page();
  p.browse.click();
  assert.equal(p.calls.closeDetails, 1);
});

test('the chevron still toggles the list, and LIVE agrees with it', () => {
  const p = page();
  p.feedToggle.click();
  assert.equal(isOpen(p), true);
  assert.equal(p.browse.getAttribute('aria-expanded'), 'true', 'LIVE shows the list is open');
  p.browse.click();
  assert.equal(p.flags.has('is-open'), false, 'LIVE closes a list the chevron opened');
  p.directory.hidden = true; p.flags.clear();
  p.browse.click();
  p.feedToggle.click();
  assert.equal(p.flags.has('is-open'), false, 'and the chevron closes one LIVE opened');
});

test('locked, or disabled for an approval, LIVE does nothing', () => {
  const p = page({ locked: true });
  p.browse.click();
  assert.equal(isOpen(p), false);
  const q = page();
  q.browse.disabled = true;
  q.browse.click();
  assert.equal(isOpen(q), false);
  assert.equal(q.calls.discover, 0);
});

test('with the feature switched off, LIVE does nothing', () => {
  const p = page();
  p.enabled = false;
  p.browse.click();
  assert.equal(isOpen(p), false);
});

test('without an About panel the title still does something: it falls back to the list', () => {
  const p = page({ details: false });
  p.titleButton.click();
  assert.equal(isOpen(p), true);
});

test('the list\'s state belongs to LIVE and the chevron, and About\'s to the title button, so neither overwrites the other', () => {
  const src = source;
  assert.match(src, /trigger:titleButton,/, 'About is mounted on the title button');
  assert.match(src, /feedToggle\.setAttribute\('aria-expanded', String\(on\)\);\s*browse\.setAttribute\('aria-expanded', String\(on\)\);/);
  assert.match(src, /browse\.disabled = titleButton\.disabled = /, 'locking disables both');
  assert.match(src, /!\[directory, entry, browse, titleButton, feedToggle\]\.some\(/, 'neither is an outside click');
});
