'use strict';

// "Offer to pay invoices on any website?", the one line under the connected wallet's buttons.
// Against the REAL extension: it shows for a wallet nobody has asked about, Turn on enables the
// setting (and ends the first-offer card), the x says no for good without touching the setting, and
// an earlier answer means it never shows.
//
// WALLET_NUDGE_SHOTS=<dir> also writes what the panel looked like.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };
const SHOTS = process.env.WALLET_NUDGE_SHOTS || '';
const settings = async (x) => ((await x.message({ type: 'SIDECAR_GET_SETTINGS' })) || {}).result || {};
const visible = (x) => x.evaluate(`(() => { const e = document.querySelector('.wallet-anywhere-nudge'); return !!e && !e.classList.contains('hidden'); })()`);

async function connectAndOpenWallet(x) {
  await x.reload();
  await x.message({ type: 'SIDECAR_SET_NWC', pubkey: x.me, connection: 'nostr+walletconnect://' + 'ab'.repeat(32) + '?relay=' + encodeURIComponent(x.relay.url) + '&secret=' + 'cd'.repeat(32) });
  await x.evaluate(`document.querySelector('.tab[data-tab="wallet"]').click()`);
  await x.waitFor(`!!document.querySelector('.wallet-anywhere-nudge')`, 15000);
  await sleep(600);
}

test('it shows for a wallet nobody has asked about, and Turn on enables paying on any website', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await connectAndOpenWallet(x);
    assert.equal(await visible(x), true);
    assert.match(await x.evaluate(`document.querySelector('.wallet-anywhere-nudge').textContent`), /^Offer to pay invoices on any website\?/);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await x.screenshot(path.join(SHOTS, 'nudge.png')); }
    const before = await settings(x);
    assert.notEqual(before.payPillAnywhere, true);

    assert.ok(await x.evaluate(`(() => { const b = document.querySelector('.wallet-anywhere-nudge .explore-link'); b.click(); return true; })()`));
    await x.waitFor(`document.querySelector('.wallet-anywhere-nudge').classList.contains('hidden')`);
    const after = await settings(x);
    assert.equal(after.payPillAnywhere, true, 'Turn on enables Show on unconnected sites');
    assert.equal(after.payFirstOfferDone, true, 'and ends the first-offer card');
    assert.deepEqual(x.errors, []);

    // Drawn again, it stays away: the setting is on.
    await x.evaluate(`document.querySelector('.tab[data-tab="accounts"]').click()`);
    await x.evaluate(`document.querySelector('.tab[data-tab="wallet"]').click()`);
    await sleep(1500);
    assert.equal(await visible(x), false);
  } finally { x.close(); }
});

test('the x says no for good and leaves the setting alone', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await connectAndOpenWallet(x);
    assert.equal(await visible(x), true);
    assert.ok(await x.evaluate(`(() => { document.querySelector('.wallet-anywhere-nudge .wallet-nudge-x').click(); return true; })()`));
    await sleep(600);
    const s = await settings(x);
    assert.equal(s.payAnywhereNudgeDismissed, true);
    assert.notEqual(s.payPillAnywhere, true, 'no is not yes');
    assert.notEqual(s.payFirstOfferDone, true, 'and the tap-triggered offer is still to come');
    await x.evaluate(`document.querySelector('.tab[data-tab="accounts"]').click()`);
    await x.evaluate(`document.querySelector('.tab[data-tab="wallet"]').click()`);
    await sleep(1500);
    assert.equal(await visible(x), false);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('it never shows once the setting is on, or the question has been answered', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.message({ type: 'SIDECAR_SET_SETTINGS', settings: { payPillAnywhere: true } });
    await connectAndOpenWallet(x);
    assert.equal(await visible(x), false, 'already on');
    await x.message({ type: 'SIDECAR_SET_SETTINGS', settings: { payPillAnywhere: false, payFirstOfferDone: true } });
    await x.evaluate(`document.querySelector('.tab[data-tab="accounts"]').click()`);
    await x.evaluate(`document.querySelector('.tab[data-tab="wallet"]').click()`);
    await sleep(1500);
    assert.equal(await visible(x), false, 'answered elsewhere');
    await x.message({ type: 'SIDECAR_SET_SETTINGS', settings: { payFirstOfferDone: false, payOfferDismissed: true } });
    await x.evaluate(`document.querySelector('.tab[data-tab="accounts"]').click()`);
    await x.evaluate(`document.querySelector('.tab[data-tab="wallet"]').click()`);
    await sleep(1500);
    assert.equal(await visible(x), false, "Don't ask again on a tapped link is an answer too");
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
