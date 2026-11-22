'use strict';

// A PAYMENT'S AMOUNT IS DRAWN LARGE on the approval card, against the REAL extension, on both
// approval surfaces: the side panel's card and the popup window's page. It was a row in 12px
// monospace, smaller than the Pay button that repeats it. Now the number has the card's width
// to itself, sized by its length so it stays on one line, with the unit on a line of its own.
//
//   - 212 sats: the number at its largest, under the wallet card's own balance, "sats" under it
//   - 21,000 sats: a large send, whose first press is "Confirm amount above", reads the block
//   - the largest amount Sidecar pays (99,999,999 sats): smaller, still on one line, every
//     digit on screen
//   - German: the unit is the reviewed translation's ("Sats"); the pseudo-locale's brackets
//     do not get a line of their own

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 300000 };
// Bech32 data only: its alphabet has no '1', so the invoice's last '1' is its separator.
const tail = 'p' + 'q'.repeat(200) + 'xyz0234567';
const invoice = (hrpAmount) => 'lnbc' + hrpAmount + '1' + tail;

async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('timed out');
}

// What a person sees in the amount block, top to bottom, and whether the number fits.
const look = (root) => `(() => {
  const block = document.querySelector(${JSON.stringify(root)} + ' .pay-amount');
  if (!block) return null;
  const v = block.querySelector('.pay-amount-value');
  const size = parseFloat(getComputedStyle(v).fontSize);
  return {
    lines: [...block.children].map((c) => c.className.replace('pay-amount-', '') + ':' + c.textContent),
    size,
    oneLine: v.getBoundingClientRect().height < size * 1.6,
    clipped: v.scrollWidth > v.clientWidth + 1,
  };
})()`;

async function pay(inv, language) {
  const site = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>shop</title><p>shop'); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const x = await startExtension(language ? { settings: { language } } : {});
  try {
    await x.reload();
    // A wallet to pay from (never reached: the card is rejected).
    await x.message({ type: 'SIDECAR_SET_NWC', pubkey: x.me, connection: 'nostr+walletconnect://' + 'ab'.repeat(32) + '?relay=' + encodeURIComponent(x.relay.url) + '&secret=' + 'cd'.repeat(32) });
    const page = await x.openPage(`http://127.0.0.1:${site.address().port}/`);
    await page.evaluate('new Promise((r) => { const t = setInterval(() => { if (window.webln) { clearInterval(t); r(true); } }, 50); })');
    await page.evaluate(`window.webln.enable().then(() => window.webln.sendPayment(${JSON.stringify(inv)})).then(() => 0, () => 0)`, { wait: false });
    // Letting the site in first, if it asks.
    for (let i = 0; i < 4; i++) {
      await x.waitFor(`(() => { const v = document.getElementById('view-approval'); return !!v && !v.classList.contains('hidden'); })()`, 10000);
      if (await x.evaluate(`!!document.querySelector('#approval-preview .pay-amount')`)) break;
      await x.evaluate(`document.getElementById('approval-allow').click()`);
      await new Promise((r) => setTimeout(r, 600));
    }
    const panel = await until(async () => x.evaluate(look('#approval-preview')));
    const button = await x.evaluate(`document.getElementById('approval-allow').textContent.trim()`);
    const pending = (await x.message({ type: 'SIDECAR_GET_PENDING' })).result;
    const popupPage = await x.openPage(`chrome-extension://${x.extId}/prompt.html?id=${pending.head.id}`);
    await popupPage.viewport({ width: 360, height: 640, scale: 1 });
    const popup = await until(async () => popupPage.evaluate(look('#preview')));
    await popupPage.close().catch(() => {});
    await x.evaluate(`document.getElementById('approval-reject').click()`);
    return { panel, popup, button, errors: x.errors.slice() };
  } finally { x.close(); site.close(); }
}

test('a payment\'s amount is drawn large, the unit under it, on both surfaces', opts, async (t) => {
  let r;
  try { r = await pay(invoice('2120n')); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  for (const [where, s] of [['panel', r.panel], ['popup', r.popup]]) {
    assert.deepEqual(s.lines, ['label:Amount', 'value:212', 'unit:sats'], where);
    // Large, but never larger than the wallet card's own balance (40px).
    assert.ok(s.size >= 30 && s.size < 40, `${where} draws 212 at ${s.size}px`);
    assert.ok(s.oneLine && !s.clipped, where);
  }
  assert.deepEqual(r.errors, []);
});

test('a large send reads the block above its "Confirm amount above"', opts, async (t) => {
  let r;
  try { r = await pay(invoice('210u')); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  assert.deepEqual(r.panel.lines, ['label:Amount', 'value:21,000', 'unit:sats']);
  assert.equal(r.button, 'Confirm amount above');
  assert.ok(r.panel.oneLine && r.popup.oneLine);
});

test('the largest amount Sidecar pays is smaller, on one line, every digit on screen', opts, async (t) => {
  let r;
  // 999,999,990 nanobitcoin: 99,999,999 sats, the most Sidecar pays at once (nwc-client.js).
  try { r = await pay(invoice('999999990n')); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  for (const [where, s] of [['panel', r.panel], ['popup', r.popup]]) {
    assert.equal(s.lines[1], 'value:99,999,999', where);
    assert.ok(s.size <= 26, `${where} draws it at ${s.size}px`);
    assert.ok(s.oneLine, `${where} wrapped it`);
    assert.ok(!s.clipped, `${where} cut digits off`);
  }
});

test('the unit is the language\'s own, and the pseudo-locale gets no stray line', opts, async (t) => {
  let de, xa;
  try { de = await pay(invoice('2120n'), 'de'); xa = await pay(invoice('2120n'), 'en-XA'); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  assert.deepEqual(de.panel.lines.slice(1), ['value:212', 'unit:Sats']);
  assert.deepEqual(de.popup.lines.slice(1), ['value:212', 'unit:Sats']);
  for (const s of [xa.panel, xa.popup]) {
    assert.equal(s.lines.length, 3, 'label, number, unit: ' + JSON.stringify(s.lines));
    assert.equal(s.lines[1], 'value:212');
  }
});
