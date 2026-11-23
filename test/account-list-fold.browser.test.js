'use strict';

// The account list folds from three accounts: the active account and the first other one in
// your order, then a button for the rest. Against the REAL extension: two accounts show as
// before, four fold, the button opens and folds the list, leaving the tab folds it, only an
// open list can be dragged, a new account opens it, and a quiet spell folds it again.
//
// ACCOUNT_FOLD_SHOTS=<dir> also writes what the panel looked like.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 150000 };
const SHOTS = process.env.ACCOUNT_FOLD_SHOTS || '';

const list = (x) => x.evaluate(`(() => {
  const rows = [...document.querySelectorAll('#account-list .item[data-pubkey]')];
  const btn = document.getElementById('account-list-more');
  const grip = document.querySelector('#account-list .grip-handle');
  return {
    pubkeys: rows.map((r) => r.dataset.pubkey),
    draggable: rows.map((r) => r.draggable),
    grip: grip ? getComputedStyle(grip).visibility : null,
    button: btn.classList.contains('hidden') ? null : btn.textContent,
    expanded: btn.getAttribute('aria-expanded'),
  };
})()`);
const press = (x, sel) => x.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);

test('the account list folds from three accounts and opens on demand', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await x.screenshot(path.join(SHOTS, name)); } };
  try {
    const add = async (hex) => {
      const r = await x.message({ type: 'SIDECAR_ADD_ACCOUNT', secret: hex.repeat(32) });
      assert.ok(r && r.ok, JSON.stringify(r));
    };
    await add('06');
    await x.reload();
    let s = await list(x);
    assert.equal(s.pubkeys.length, 2, 'two accounts both show');
    assert.equal(s.button, null, 'and no button under two');
    assert.deepEqual(s.draggable, [true, true]);
    assert.equal(s.grip, 'visible');

    await add('07');
    await add('08');
    await x.reload();
    const order = (await x.message({ type: 'SIDECAR_GET_STATE' })).result.accounts.map((a) => a.pubkey);
    assert.equal(order.length, 4);
    assert.equal(order[0], x.me);

    s = await list(x);
    assert.deepEqual(s.pubkeys, [order[0], order[1]], 'folded: the active account and the next one');
    assert.equal(s.button, '2 more accounts');
    assert.equal(s.expanded, 'false');
    assert.deepEqual(s.draggable, [false, false], 'a folded list cannot be dragged');
    assert.equal(s.grip, 'hidden');
    await shot('folded.png');

    await press(x, '#account-list-more');
    s = await list(x);
    assert.deepEqual(s.pubkeys, order, 'open: every account, in order');
    assert.equal(s.button, 'Show less');
    assert.equal(s.expanded, 'true');
    assert.deepEqual(s.draggable, [true, true, true, true]);
    assert.equal(s.grip, 'visible');
    await shot('open.png');

    await press(x, '#account-list-more');
    assert.equal((await list(x)).pubkeys.length, 2, 'Show less folds it');

    // Leaving the tab folds it.
    await press(x, '#account-list-more');
    await press(x, '.tab[data-tab="wallet"]');
    await press(x, '.tab[data-tab="accounts"]');
    assert.equal((await list(x)).pubkeys.length, 2, 'back from another tab, folded');

    // An active account further down the order still shows, in its place.
    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: order[2] });
    await x.reload();
    assert.deepEqual((await list(x)).pubkeys, [order[0], order[2]]);
    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: order[0] });
    await x.reload();

    // A new account opens the list so you can see where it landed.
    await press(x, '#add-generate');
    await x.waitFor(`document.querySelectorAll('#account-list .item[data-pubkey]').length === 5`, 15000);
    assert.equal((await list(x)).button, 'Show less');

    // And a quiet spell folds it again.
    await x.reload();
    await press(x, '#account-list-more');
    assert.equal((await list(x)).pubkeys.length, 5);
    await sleep(31500);
    s = await list(x);
    assert.equal(s.pubkeys.length, 2, 'folded after thirty quiet seconds');
    assert.equal(s.button, '3 more accounts');
  } finally {
    x.close();
  }
});
