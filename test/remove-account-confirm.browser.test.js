'use strict';

// REMOVING AN ACCOUNT TAKES THE PIN, and offers the key first. Removing deletes the only copy of
// the key on this device, and it was one tap on a sheet that said so. Now one sheet asks for the
// PIN once: it downloads the key sheet, plain or encrypted, and Remove is a press of its own.
// The background checks the PIN: a message without it, or with a wrong one, removes nothing.
// Against the REAL extension.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep, _internals: { PIN } } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

async function withExtension(t, fn) {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try { await fn(x); } finally { x.close(); }
}
const accounts = (x) => x.message({ type: 'SIDECAR_GET_STATE' }).then((s) => ((s && s.result && s.result.accounts) || []).map((a) => a.pubkey));
const buttons = `[...document.querySelectorAll('#modal .actions button')].map((b) => b.textContent)`;

test('the background removes nothing without the PIN, or with a wrong one', opts, async (t) => {
  await withExtension(t, async (x) => {
    assert.deepEqual(await accounts(x), [x.me]);
    const bare = await x.message({ type: 'SIDECAR_REMOVE_ACCOUNT', pubkey: x.me });
    assert.ok(bare && bare.ok === false, 'removed without a PIN: ' + JSON.stringify(bare));
    const wrong = await x.message({ type: 'SIDECAR_REMOVE_ACCOUNT', pubkey: x.me, pin: 'not-the-pin' });
    assert.ok(wrong && wrong.ok === false, 'removed with a wrong PIN: ' + JSON.stringify(wrong));
    assert.deepEqual(await accounts(x), [x.me], 'the account went');
  });
});

test('Remove account is one sheet: one PIN for the key sheet and for removing, and Remove its own press', opts, async (t) => {
  await withExtension(t, async (x) => {
    await x.evaluate(`document.querySelector('.item-actions [title="Account options"]').click()`);
    await x.waitFor(`[...document.querySelectorAll('#modal .menu-item')].some((b) => b.textContent.includes('Remove account'))`, 10000);
    await x.evaluate(`[...document.querySelectorAll('#modal .menu-item')].find((b) => b.textContent.includes('Remove account')).click()`);
    await x.waitFor(`document.querySelector('#modal h3') && document.querySelector('#modal h3').textContent === 'Remove account?'`, 10000);
    await sleep(300);
    assert.deepEqual(await x.evaluate(buttons), ['Download backup sheet', 'Download encrypted sheet', 'Remove account', 'Cancel']);
    const press = (label) => x.evaluate(`[...document.querySelectorAll('#modal .actions button')].find((b) => b.textContent.trim().endsWith(${JSON.stringify(label)})).click()`);
    const setPin = (v) => x.evaluate(`(() => { const p = document.querySelector('#modal input[type=password]'); p.value = ${JSON.stringify(v)}; })()`);
    const errText = () => x.evaluate(`(document.querySelector('#modal .error') || {}).textContent || ''`);

    // No PIN: nothing happens but the ask for one.
    await press('Remove account');
    await x.waitFor(`(document.querySelector('#modal .error') || {}).textContent === 'Enter your PIN.'`, 5000);
    assert.deepEqual(await accounts(x), [x.me], 'removed without a PIN');

    // The key sheet with the same PIN: saved, checked, and the sheet stays.
    await setPin(PIN);
    await press('Download backup sheet');
    await x.waitFor(`!!document.querySelector('#modal .actions button svg')`, 20000);
    assert.equal(await errText(), '');
    assert.equal(await x.evaluate(`document.querySelector('#modal h3').textContent`), 'Remove account?');
    assert.deepEqual(await accounts(x), [x.me], 'saving the key sheet removed the account');

    // A wrong PIN is refused and nothing goes.
    await setPin('not-the-pin');
    await press('Remove account');
    await x.waitFor(`!!(document.querySelector('#modal .error') || {}).textContent`, 10000);
    assert.deepEqual(await accounts(x), [x.me], 'a wrong PIN removed the account');

    // The right one removes it.
    await setPin(PIN);
    await press('Remove account');
    for (let i = 0; i < 40 && (await accounts(x)).length; i++) await sleep(250);
    assert.deepEqual(await accounts(x), [], 'the right PIN did not remove the account');
    assert.deepEqual(x.errors, []);
  });
});
