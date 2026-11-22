'use strict';

// A CLICK ENDS WITH THE NOTE ON SCREEN. With "Reuse an open client tab" on, a bell row (and
// every other Open in <client>) loaded the note into any tab showing the client's site, in
// any window, and asked that window for focus. A minimized window stayed minimized and an
// installed app's window took the note out of sight, so the click looked like nothing at
// all. The panel's own openInClient runs here against a fake set of windows and tabs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const panel = fs.readFileSync(require.resolve('../sidepanel'), 'utf8');
const start = panel.indexOf('  async function openInClient(');
const source = panel.slice(start, panel.indexOf('  // Open one of Sidecar', start));

// windows: [{ id, type, state, focused }]; tabs: [{ id, windowId, url }]
function harness({ windows, tabs, reuse = true, updateFails = false }) {
  const log = [];
  const winById = new Map(windows.map((w) => [w.id, w]));
  const ofType = (types) => windows.filter((w) => !types || types.includes(w.type));
  const chrome = {
    tabs: {
      query: (q, cb) => { const r = tabs.slice(); if (cb) { cb(r); return undefined; } return Promise.resolve(r); },
      update: (id, props, cb) => {
        log.push(['tabs.update', id, props]);
        if (updateFails) { const e = Promise.reject(new Error('No tab with id: ' + id)); if (cb) { cb(undefined); return undefined; } return e; }
        if (cb) { cb({ id }); return undefined; }
        return Promise.resolve({ id });
      },
      create: (props, cb) => { log.push(['tabs.create', props.url]); if (cb) cb({ id: 99 }); return Promise.resolve({ id: 99 }); },
    },
    windows: {
      getAll: (q = {}) => Promise.resolve(ofType(q.windowTypes)),
      getLastFocused: (q = {}) => Promise.resolve(ofType(q.windowTypes).find((w) => w.focused) || ofType(q.windowTypes)[0]),
      get: (id) => Promise.resolve(winById.get(id)),
      update: (id, props, cb) => { log.push(['windows.update', id, props]); if (cb) cb({ id }); return Promise.resolve({ id }); },
    },
    runtime: { lastError: undefined },
  };
  const ctx = { chrome, URL, window: { open: (u) => log.push(['window.open', u]) }, call: async () => ({ reuseClientTab: reuse }), console };
  vm.createContext(ctx);
  vm.runInContext(source + '\nthis.openInClient = openInClient;', ctx);
  return { open: async (url) => { await ctx.openInClient(url); await new Promise((r) => setTimeout(r, 20)); return JSON.parse(JSON.stringify(log)); } }; // the sandbox's objects, as plain data
}

const NOTE = 'https://jumble.social/notes/nevent1abc';
const here = { id: 1, type: 'normal', state: 'normal', focused: true };

test('a client tab in a minimized window: the window is restored, not only focused', async () => {
  const log = await harness({
    windows: [here, { id: 2, type: 'normal', state: 'minimized', focused: false }],
    tabs: [{ id: 10, windowId: 1, url: 'https://example.com/' }, { id: 20, windowId: 2, url: 'https://jumble.social/' }],
  }).open(NOTE);
  assert.deepEqual(log.find((l) => l[0] === 'tabs.update'), ['tabs.update', 20, { active: true, url: NOTE }]);
  const w = log.find((l) => l[0] === 'windows.update');
  assert.equal(w[1], 2);
  assert.equal(w[2].focused, true);
  assert.equal(w[2].state, 'normal', 'a minimized window has to be brought back, or the click shows nothing');
});

test('a client open as an installed app is not reused: the note opens in a tab', async () => {
  const log = await harness({
    windows: [here, { id: 3, type: 'app', state: 'normal', focused: false }],
    tabs: [{ id: 30, windowId: 3, url: 'https://jumble.social/' }],
  }).open(NOTE);
  assert.deepEqual(log, [['tabs.create', NOTE]]);
});

test('with client tabs in two windows, the one in the window in use is reused', async () => {
  const log = await harness({
    windows: [{ id: 2, type: 'normal', state: 'normal', focused: false }, here],
    tabs: [{ id: 20, windowId: 2, url: 'https://jumble.social/a' }, { id: 10, windowId: 1, url: 'https://jumble.social/b' }],
  }).open(NOTE);
  assert.deepEqual(log.find((l) => l[0] === 'tabs.update'), ['tabs.update', 10, { active: true, url: NOTE }]);
});

test('a reused tab that is gone by the time of the click: the note opens in a new tab', async () => {
  const log = await harness({
    windows: [here],
    tabs: [{ id: 10, windowId: 1, url: 'https://jumble.social/' }],
    updateFails: true,
  }).open(NOTE);
  assert.deepEqual(log.filter((l) => l[0] === 'tabs.create'), [['tabs.create', NOTE]]);
});

test('no client tab open, or reuse turned off: a new tab, as before', async () => {
  assert.deepEqual(await harness({ windows: [here], tabs: [{ id: 10, windowId: 1, url: 'https://example.com/' }] }).open(NOTE), [['tabs.create', NOTE]]);
  assert.deepEqual(await harness({ windows: [here], tabs: [{ id: 10, windowId: 1, url: 'https://jumble.social/' }], reuse: false }).open(NOTE), [['tabs.create', NOTE]]);
});

test('a client tab in a normal window that is already showing: reused and focused, nothing else changed', async () => {
  const log = await harness({ windows: [here], tabs: [{ id: 10, windowId: 1, url: 'https://jumble.social/' }] }).open(NOTE);
  assert.deepEqual(log, [['tabs.update', 10, { active: true, url: NOTE }], ['windows.update', 1, { focused: true }]]);
});
