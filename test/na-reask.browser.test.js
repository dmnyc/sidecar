'use strict';

// After someone has answered "Just my follows", a name that is not among their follows used
// to leave the search box with nothing at all, and nothing said a wider search existed. The
// ask now comes back in the dropdown when the follows have no match, so there is a way to
// change the answer where the dead end is. Against the REAL extension, in the side panel's
// search box. Answering "Just my follows" again keeps it away until the box is cleared, and
// "Search everyone" turns the search on.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('timed out');
}

test('with the name search off, a search that finds nothing offers the ask again', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.message({ type: 'SIDECAR_SET_SETTINGS', settings: { nameSearch: 'follows' } });
    await x.reload();
    const type = (text) => x.evaluate(`(() => { const i = document.getElementById('search-input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const ask = () => x.evaluate(`(() => { const a = document.querySelector('#search-results .na-ask'); return a ? a.textContent : null; })()`);
    const press = (cls) => x.evaluate(`(() => { const b = document.querySelector('#search-results .na-ask .${cls}'); if (!b) return false; b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return true; })()`);
    const stored = () => x.evaluate(`new Promise((r) => chrome.storage.local.get('sidecar_settings', (v) => r((v.sidecar_settings || {}).nameSearch)))`);

    await x.evaluate(`document.getElementById('search-btn').click()`);
    await type('zzqxnomatch');
    const text = await until(ask);
    assert.match(text, /^Find people beyond your follows\? Search defaults to Brainstorm’s relay\. Change this in Settings\./, 'the ask names the relay, in plain words');
    assert.ok(!text.includes('search.brainstorm.world'), 'and no hostname');

    // "Just my follows" again: gone, and it stays gone while the box is used...
    assert.ok(await press('na-ask-no'));
    await until(async () => (await ask()) === null);
    await type('zzqxnomatch2');
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(await ask(), null, 'asked again after a no, within the same search');
    assert.equal(await stored(), 'follows', 'the answer is still no');

    // ...and comes back with the next search.
    await type('');
    await type('zzqxother');
    await until(ask);

    // "Search everyone" turns on what was offered: the default, for an account with no search
    // relays of its own.
    assert.ok(await press('na-ask-yes'));
    await until(async () => (await stored()) === 'default');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
