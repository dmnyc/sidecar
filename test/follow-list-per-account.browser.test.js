'use strict';

// YOUR FOLLOW LIST IS YOURS, ACROSS A SWITCH. The panel loads the active account's follow
// list for search, @mentions and the follow checks, and the load used to belong to no one:
// a second account asking while the first's load was still running was handed the first's,
// the query re-read the active account between its awaits, and the result was filed under
// whoever was active when it finished. Switch while it loads, and the new account searched
// and @mentioned among the old account's follows. Against the REAL extension.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep, _internals: { SK } } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 150000 };
SK.other = '5e'.repeat(32);

async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150); }
  return fn();
}

test('switching while the follow list loads: the new account searches its own follows, not the last one’s', opts, async (t) => {
  let x;
  let mePk = null;
  // Me's own follow list is slow to come back, so the switch lands while it loads.
  const delay = (filters) => (mePk && filters.some((f) => (f.kinds || []).includes(3) && (f.authors || []).length === 1 && f.authors[0] === mePk) ? 4000 : 0);
  try { x = await startExtension({ relayDelayMs: delay }); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    const now = Math.floor(Date.now() / 1000);
    const other = x.nt.pubkey('other');
    x.put({ kind: 0, created_at: now - 500, tags: [], content: JSON.stringify({ name: 'Beatrix Mine' }) }, 'bea');
    x.put({ kind: 0, created_at: now - 500, tags: [], content: JSON.stringify({ name: 'Calloway Theirs' }) }, 'cal');
    x.put({ kind: 3, created_at: now - 400, tags: [['p', x.bea]], content: '' }, 'me');
    x.put({ kind: 3, created_at: now - 400, tags: [['p', x.cal]], content: '' }, 'other');
    await x.message({ type: 'SIDECAR_SET_SETTINGS', settings: { nameSearch: 'follows' } });
    await x.message({ type: 'SIDECAR_ADD_ACCOUNT', secret: SK.other, name: 'Other' });
    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: x.me });
    mePk = x.me;
    await x.reload();
    // A search as Me starts Me's follow-list load, which the relay holds.
    await x.evaluate(`document.getElementById('search-btn').click()`);
    const type = (text) => x.evaluate(`(() => { const i = document.getElementById('search-input'); if (!i) return; i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await type('bea');
    await sleep(300);
    // Switch mid-load.
    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: other });
    await x.waitFor(`(document.getElementById('acct-btn') || {}).title.includes('Other')`, 10000);
    await sleep(500);
    await x.evaluate(`(() => { const b = document.getElementById('search-btn'); const i = document.getElementById('search-input'); if (!i || !i.offsetParent) b.click(); })()`);
    const names = async (text) => {
      await type(text);
      return until(async () => {
        const n = await x.evaluate(`[...document.querySelectorAll('#search-results .ac-item-name')].map((e) => e.textContent)`);
        return n.length ? n : null;
      }, 10000);
    };
    assert.deepEqual(await names('calloway'), ['Calloway Theirs'], 'Other’s own follow was not found');
    // And Me's load, landing after the switch, did not take Other's place.
    await sleep(4500);
    assert.deepEqual(await names('calloway'), ['Calloway Theirs'], 'Other’s follows were replaced by Me’s');
    assert.equal(await names('beatrix'), null, 'Me’s follow turned up in Other’s search');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
