'use strict';

// The header's account menu holds to the panel. With a long list the accounts scroll inside
// it, Add account and Manage accounts stay in view below them, the page itself never scrolls
// (which took the top bar away), and the account you are on is in view when it opens. Against
// the REAL extension, at the panel's width, at 100% and at 125% panel zoom.
//
// ACCOUNT_MENU_SHOTS=<dir> also writes what the panel looked like.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 180000 };
const SHOTS = process.env.ACCOUNT_MENU_SHOTS || '';

const measure = (x) => x.evaluate(`(() => {
  const menu = document.getElementById('acct-menu');
  const list = menu.querySelector('.acct-menu-list');
  const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
  const feet = [...menu.querySelectorAll(':scope > .acct-row.foot')];
  const active = list.querySelector('.acct-row.active');
  return {
    open: !menu.classList.contains('hidden'),
    pageScrolls: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
    innerHeight: window.innerHeight,
    menu: r(menu),
    rows: list.querySelectorAll('.acct-row').length,
    listScrolls: list.scrollHeight > list.clientHeight,
    feet: feet.map((f) => ({ text: f.textContent.trim(), ...r(f) })),
    list: r(list),
    active: active ? r(active) : null,
  };
})()`);

test('a long account menu scrolls inside itself and keeps its foot in view', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  const dir = SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'acct-menu-'));
  fs.mkdirSync(dir, { recursive: true });
  const shot = (name, size) => x.screenshot(path.join(dir, name), size);
  try {
    // Twelve accounts, the active one LAST in the order, so it starts out of view.
    for (let i = 1; i <= 11; i++) {
      const r = await x.message({ type: 'SIDECAR_ADD_ACCOUNT', secret: (i + 16).toString(16).padStart(2, '0').repeat(32) });
      assert.ok(r && r.ok, JSON.stringify(r));
    }
    const accounts = (await x.message({ type: 'SIDECAR_GET_STATE' })).result.accounts;
    assert.equal(accounts.length, 12);
    const last = accounts[accounts.length - 1].pubkey;
    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: last });
    await x.reload();

    for (const zoom of [1, 1.25]) {
      await x.evaluate(`(() => {
        document.body.style.zoom = ${zoom === 1 ? "''" : `'${zoom}'`};
        ${zoom === 1 ? "document.documentElement.style.removeProperty('--panel-zoom')" : `document.documentElement.style.setProperty('--panel-zoom', '${zoom}')`};
      })()`);
      await shot(`closed-${zoom}.png`, { width: 360, height: 640 });
      await x.evaluate(`document.getElementById('acct-btn').click()`);
      await sleep(400);
      const m = await measure(x);
      if (SHOTS) await shot(`open-${zoom}.png`, { width: 360, height: 640 });
      const at = `at ${zoom * 100}%`;
      assert.ok(m.open, `the menu opened ${at}`);
      assert.equal(m.rows, 12, `every account is in the menu ${at}`);
      assert.equal(m.pageScrolls, false, `the page scrolls under the menu ${at}`);
      assert.ok(m.listScrolls, `twelve accounts fit without scrolling in 640px ${at}?`);
      // getBoundingClientRect is in screen pixels at either zoom, as innerHeight is.
      assert.ok(m.menu.bottom <= m.innerHeight, `the menu runs past the panel ${at}: ${m.menu.bottom} > ${m.innerHeight}`);
      assert.deepEqual(m.feet.map((f) => f.text), ['Add account', 'Manage accounts']);
      for (const f of m.feet) assert.ok(f.bottom <= m.menu.bottom + 0.5, `${f.text} is out of view ${at}`);
      assert.ok(m.active && m.active.top >= m.list.top - 0.5 && m.active.bottom <= m.list.bottom + 0.5,
        `the active account, last in the order, is out of view when the menu opens ${at}`);

      // The two-tap switch still works inside the scroller: arm the first row, and it asks.
      await x.evaluate(`document.querySelector('#acct-menu .acct-menu-list .acct-row:not(.active) .acct-row-main').click()`);
      assert.equal(await x.evaluate(`document.querySelector('#acct-menu .acct-row-pending .acct-row-npub').textContent`), 'Tap again to confirm');
      await x.evaluate(`document.querySelector('#acct-menu .acct-row-cancel').click()`);
      await x.evaluate(`document.body.click()`);
      await sleep(400);
      assert.equal(await x.evaluate(`document.getElementById('acct-menu').classList.contains('hidden')`), true, 'the menu closed');
    }

    // A short list is the menu it always was: nothing to scroll.
    await x.evaluate(`(() => { document.body.style.zoom = ''; document.documentElement.style.removeProperty('--panel-zoom'); })()`);
    await shot('tall.png', { width: 360, height: 1400 });
    await x.evaluate(`document.getElementById('acct-btn').click()`);
    await sleep(400);
    const tall = await measure(x);
    assert.equal(tall.listScrolls, false, 'the list scrolls with room to spare');
    assert.equal(tall.pageScrolls, false);
  } finally {
    x.close();
    if (!SHOTS) fs.rmSync(dir, { recursive: true, force: true });
  }
});
