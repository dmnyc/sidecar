'use strict';

// Pressing the stream's bolt a second time closes the zap sheet it opened. Only that: a sheet
// opened from a chat comment, another host's sheet, a closing sheet and any other dialog are
// all replaced by the stream's sheet as before.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'streams.css'), 'utf8');
const LISTENER = source.match(/  window\.addEventListener\('sidecar-stream-zap'[\s\S]*?\n  \}\);\n/);
const HELPERS = source.match(/  function streamZapSheetOpenFor\(pubkey\) \{[\s\S]*?\n  setStreamZapBolt\(false\);\n/);
if (!LISTENER || !HELPERS) throw new Error('Could not find the bolt listener in sidepanel.js');
const BLOCK = [HELPERS[0] + LISTENER[0]];

const HOST = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const EVENT = { id: 'e', address: 'k' };

function el(initial = []) {
  const flags = new Set(initial);
  return {
    classList: { add: (c) => flags.add(c), remove: (c) => flags.delete(c), contains: (c) => flags.has(c) },
    dataset: {}, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
  };
}

// A page with the modal in a given state, and the listener installed.
function page({ open = false, classes = [], scope, host, locked = false, approval = false } = {}) {
  const els = { modal: el(classes), 'view-lock': el(locked ? [] : ['hidden']), 'view-approval': el(approval ? [] : ['hidden']), 'stream-zap': el() };
  if (scope) els.modal.dataset.zapScope = scope;
  if (host) els.modal.dataset.zapHost = host;
  const root = el(open ? ['modal-open'] : []);
  const calls = [];
  let handler;
  const ctx = {
    $: (id) => els[id],
    document: { documentElement: root },
    window: { addEventListener: (name, fn) => { if (name === 'sidecar-stream-zap') handler = fn; } },
    closeModal: () => calls.push(['close']),
    openProfileSheet: (pk, opts) => calls.push(['open', pk, opts]),
  };
  vm.createContext(ctx);
  vm.runInContext(BLOCK[0], ctx);
  return { els, calls, press: (pubkey = HOST) => handler({ detail: { pubkey, event: EVENT } }) };
}
const open = (p) => p.calls.filter((c) => c[0] === 'open');
const closes = (p) => p.calls.filter((c) => c[0] === 'close');

test('with nothing open, the bolt opens the stream zap sheet', () => {
  const p = page();
  p.press();
  assert.equal(open(p).length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(open(p)[0][2])), { zap: true, streamEvent: EVENT });
  assert.equal(closes(p).length, 0);
});

test('PRESSING IT AGAIN CLOSES THE SHEET and does not rebuild it', () => {
  const p = page({ open: true, classes: ['stream-zap-modal'], scope: 'stream', host: HOST });
  p.press();
  assert.equal(closes(p).length, 1);
  assert.equal(open(p).length, 0);
});

test('a sheet opened from a chat comment is replaced by the stream sheet, not closed', () => {
  const p = page({ open: true, classes: ['stream-zap-modal'], scope: 'comment', host: HOST });
  p.press();
  assert.equal(closes(p).length, 0);
  assert.equal(open(p).length, 1);
});

test('another host\'s zap sheet is replaced, not closed', () => {
  const p = page({ open: true, classes: ['stream-zap-modal'], scope: 'stream', host: OTHER });
  p.press(HOST);
  assert.equal(closes(p).length, 0);
  assert.equal(open(p).length, 1);
});

test('a sheet that is already closing is opened again', () => {
  const p = page({ open: true, classes: ['stream-zap-modal', 'is-closing'], scope: 'stream', host: HOST });
  p.press();
  assert.equal(closes(p).length, 0);
  assert.equal(open(p).length, 1);
});

test('any other dialog is never mistaken for the zap sheet', () => {
  const p = page({ open: true, classes: [], scope: 'stream', host: HOST }); // leftover data, no sheet class
  p.press();
  assert.equal(closes(p).length, 0);
  assert.equal(open(p).length, 1);
  const q = page({ open: false, classes: ['stream-zap-modal'], scope: 'stream', host: HOST }); // class left behind, nothing open
  q.press();
  assert.equal(closes(q).length, 0);
  assert.equal(open(q).length, 1);
});

test('a locked panel or a pending approval ignores the bolt, as before', () => {
  for (const state of [{ locked: true }, { approval: true }]) {
    const p = page({ open: true, classes: ['stream-zap-modal'], scope: 'stream', host: HOST, ...state });
    p.press();
    assert.equal(p.calls.length, 0);
  }
});

test('a malformed host is ignored', () => {
  const p = page({ open: true, classes: ['stream-zap-modal'], scope: 'stream', host: HOST });
  p.press('not-a-pubkey');
  assert.equal(p.calls.length, 0);
});

test('the bolt starts out reporting that its sheet is closed, and the helper sets either state', () => {
  const p = page();
  assert.equal(p.els['stream-zap'].attrs['aria-expanded'], 'false');
  const ctx = { $: (id) => p.els[id] };
  vm.createContext(ctx);
  vm.runInContext(source.match(/  function setStreamZapBolt\(open\) \{[\s\S]*?\n  \}\n/)[0] + '\nglobalThis.set = setStreamZapBolt;', ctx);
  ctx.set(true);
  assert.equal(p.els['stream-zap'].attrs['aria-expanded'], 'true');
  ctx.set(false);
  assert.equal(p.els['stream-zap'].attrs['aria-expanded'], 'false');
});

test('the sheet records its host and scope, lights the bolt only for the stream\'s own, and puts it back on close', () => {
  const card = source.slice(source.indexOf('async function openProfileSheet('), source.indexOf('async function openProfileFor('));
  assert.match(card, /if \(options\?\.zap\) modal\.classList\.add\('stream-zap-modal'\);\s*if \(options\?\.zap\) \{\s*modal\.dataset\.zapHost = pubkey;\s*modal\.dataset\.zapScope = options\.chatEvent \? 'comment' : 'stream';\s*[^\n]*\n\s*setStreamZapBolt\(!options\.chatEvent\);/);
  assert.match(card, /\}, options\?\.zap \? \(\) => setStreamZapBolt\(false\) : undefined\);\s*\}\s*$/, 'closing the sheet clears the bolt');
});

test('every other dialog that opens clears what a zap sheet left behind', () => {
  const fn = source.slice(source.indexOf('  function openModal('), source.indexOf('  function openModal(') + 900);
  assert.match(fn, /delete modal\.dataset\.zapHost; delete modal\.dataset\.zapScope;\s*setStreamZapBolt\(false\);/);
});

test('the pressed bolt looks pressed', () => {
  assert.match(css, /#stream-zap\[aria-expanded="true"\] \{ color:var\(--gold\); background:var\(--hover-medium\); \}/);
});
