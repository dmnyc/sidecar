'use strict';

// A STRANGER'S RELAY LIST DOES NOT SEND THIS BROWSER INTO YOUR NETWORK. Opening someone's
// profile reads it from the relays they write to, and their list is theirs to write: it
// named a private address (a tailnet IP, a home router) and the panel connected to it. Now
// a private, local, onion or unencrypted address from someone else's list is skipped, while
// your own relays, a local one included, work as before. Against the REAL extension: your
// relay is on localhost and in Settings; theirs is another localhost relay only they list.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep, _internals: { startRelay } } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 150000 };

test('opening the profile of someone whose list names a private address does not connect to it', opts, async (t) => {
  const theirs = await startRelay();
  let connected = 0;
  theirs.log.push = function (f) { connected++; return Array.prototype.push.call(this, f); };
  let x;
  try { x = await startExtension(); } catch (e) { theirs.close(); if (e.skip) return t.skip(e.message); throw e; }
  try {
    const now = Math.floor(Date.now() / 1000);
    x.put({ kind: 0, created_at: now - 500, tags: [], content: JSON.stringify({ name: 'Beatrix Lists' }) }, 'bea');
    // Bea writes to a relay on this machine, which only her list names.
    x.put({ kind: 10002, created_at: now - 500, tags: [['r', theirs.url, 'write']], content: '' }, 'bea');
    x.put({ kind: 3, created_at: now - 400, tags: [['p', x.bea]], content: '' }, 'me');
    await x.message({ type: 'SIDECAR_SET_SETTINGS', settings: { nameSearch: 'follows' } });
    await x.reload();
    await x.evaluate(`document.getElementById('search-btn').click()`);
    await x.evaluate(`(() => { const i = document.getElementById('search-input'); i.value = 'beatrix'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await x.waitFor(`!!document.querySelector('#search-results .ac-item')`, 15000);
    await x.evaluate(`document.querySelector('#search-results .ac-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    // The sheet opens, from your own relay.
    await x.waitFor(`/Beatrix Lists/.test((document.getElementById('modal') || {}).textContent || '')`, 15000);
    await sleep(4000);
    assert.equal(connected, 0, 'the panel asked a relay that only a stranger’s list names, on this machine');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); theirs.close(); }
});
