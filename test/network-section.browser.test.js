'use strict';

// SETTINGS → YOUR NETWORK, in two blocks. Until 1.19.2 the section was titled Notifications
// and held one block: the sort, the network's size, its build and Rebuild under a single
// heading. Now the section is named for the network, the sort sits under Notifications, and
// what the network is sits under Network status, which hides whole while the sort is off
// (no network is built then). Against the REAL extension.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

// Settings remembers which sections are open, so a plain click on the second visit closes it.
const openSection = `(() => { const s = document.querySelector('[data-section="notifications"]'); if (!s.classList.contains('open')) s.querySelector('.settings-section-toggle').click(); })()`;
const shown = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getClientRects().length > 0; })()`;

test('Your network: the sort under Notifications, the network under Network status, which hides with the sort off', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    x.put({ kind: 3, created_at: Math.floor(Date.now() / 1000) - 9000, tags: [['p', x.bea]], content: '' }, 'me');
    await x.reload();
    await x.evaluate(`document.getElementById('settings-btn').click()`); await sleep(800);
    await x.evaluate(openSection); await sleep(500);

    const layout = await x.evaluate(`(() => {
      const sec = document.querySelector('[data-section="notifications"]');
      const blocks = [...sec.querySelectorAll('.settings-section-body > .setting')];
      return {
        title: sec.querySelector('.settings-section-toggle').textContent.trim(),
        heads: blocks.map((b) => b.querySelector('h4').textContent.trim()),
        toggleIn: blocks.findIndex((b) => b.querySelector('#wotfilter-toggle')),
        rebuildIn: blocks.findIndex((b) => b.querySelector('#wot-rebuild')),
        statusIn: blocks.findIndex((b) => b.querySelector('#wot-status')),
      };
    })()`);
    assert.deepEqual(layout, { title: 'Your network', heads: ['Notifications', 'Network status'], toggleIn: 0, rebuildIn: 1, statusIn: 1 });

    // On by default, so the network block shows and fills in.
    assert.equal(await x.evaluate(`document.getElementById('wotfilter-toggle').checked`), true);
    assert.ok(await x.evaluate(shown('#wot-status-block')));
    await x.waitFor(`/Your network: /.test((document.getElementById('wot-status') || {}).textContent || '')`, 40000);

    // Off: the whole block goes, heading included, and the sort stays.
    await x.evaluate(`document.getElementById('wotfilter-toggle').click()`); await sleep(300);
    assert.equal(await x.evaluate(shown('#wot-status-block')), false, 'Network status stayed with the sort off');
    assert.ok(await x.evaluate(shown('#wotfilter-toggle')));
    // And it stays gone when Settings is drawn again from the saved setting.
    await x.reload();
    await x.evaluate(`document.getElementById('settings-btn').click()`); await sleep(800);
    await x.evaluate(openSection); await sleep(500);
    assert.equal(await x.evaluate(shown('#wot-status-block')), false);

    // On again: it is back.
    await x.evaluate(`document.getElementById('wotfilter-toggle').click()`); await sleep(300);
    assert.ok(await x.evaluate(shown('#wot-status-block')));
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
