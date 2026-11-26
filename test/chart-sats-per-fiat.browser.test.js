'use strict';

// The wallet's price chart gives its figures in sats too: under the price's low, high and
// current figures, a line with the sats one unit of the currency buys, and the readout under
// the pointer gives both. The line sits in the band the corner buttons were already holding
// open, between them and never over them. Against the real extension, with the price sources
// answered by the test so nothing reaches them.
//
// CHART_SATS_SHOTS=<dir> also writes what the card looked like.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };
const SHOTS = process.env.CHART_SATS_SHOTS || '';

// A day of quarter-hour candles from $80,000 up to $100,000, and a spot price that agrees, in
// dollars and in yen. Candles are [time, low, high, open, close, volume], newest first.
const answerPrices = `(() => {
  const now = Math.floor(Date.now() / 1000);
  const candles = [];
  for (let i = 0; i < 96; i++) { const close = 80000 + (20000 * i) / 95; candles.unshift([now - (95 - i) * 900, close, close, close, close, 1]); }
  // The full history the longer ranges slice: bitcoin's first cents, then a day a week for a year.
  const prices = [{ time: 1279000000, USD: 0.05 }];
  for (let d = 365; d >= 0; d--) prices.push({ time: now - d * 86400, USD: 60000 + (40000 * (365 - d)) / 365 });
  prices.reverse();
  const real = window.fetch;
  window.fetch = async (url, init) => {
    const u = String(url);
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('/candles')) return json(candles);
    if (u.includes('mempool.space/api/v1/historical-price')) return json({ prices });
    if (u.includes('mempool.space/api/v1/prices')) return json({ USD: 100000, JPY: 15000000 });
    if (u.includes('api.coinbase.com/v2/prices')) return json({ data: { amount: u.includes('JPY') ? '15000000' : '100000' } });
    return real(url, init);
  };
  return true;
})()`;

const figures = `(() => {
  const q = (s) => (document.querySelector(s) || {}).textContent || '';
  return {
    fiat: [q('.wallet-chart-meta:not(.wallet-chart-sats) .wallet-chart-delta'), q('.wallet-chart-meta:not(.wallet-chart-sats) .wallet-chart-lowhigh'), q('.wallet-chart-meta:not(.wallet-chart-sats) .wallet-chart-price')],
    sats: [...document.querySelectorAll('.wallet-chart-sats > span')].map((e) => e.textContent),
  };
})()`;
// The readout under the pointer, at the chart's far left (the day's first, lowest price).
const scrubLeft = `(() => {
  const plot = document.querySelector('.wallet-chart-plot');
  const r = plot.getBoundingClientRect();
  plot.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 1, clientY: r.top + 10, bubbles: true }));
  return [...document.querySelector('.wallet-chart-scrub').children].map((e) => e.textContent).slice(0, 2);
})()`;
// Where the sats line sits: inside the card, and clear of the chart and pin buttons.
const placement = `(() => {
  const box = (e) => e.getBoundingClientRect();
  const card = box(document.querySelector('.wallet-card'));
  const spans = [...document.querySelectorAll('.wallet-chart-sats > span')].map(box);
  const buttons = [...document.querySelectorAll('.wallet-card > .wallet-chart-btn, .wallet-card > .wallet-pin')].map(box);
  const meet = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  return {
    inside: spans.every((s) => s.bottom <= card.bottom - 4 && s.left >= card.left && s.right <= card.right),
    clear: spans.every((s) => buttons.every((b) => !meet(s, b))),
    buttons: buttons.length,
  };
})()`;

async function openChart(x) {
  await x.reload();
  await x.evaluate(answerPrices);
  await x.message({ type: 'SIDECAR_SET_NWC', pubkey: x.me, connection: 'nostr+walletconnect://' + 'ab'.repeat(32) + '?relay=' + encodeURIComponent(x.relay.url) + '&secret=' + 'cd'.repeat(32) });
  await x.evaluate(`document.querySelector('.tab[data-tab="wallet"]').click()`);
  await x.waitFor(`!!document.querySelector('.wallet-chart-btn')`, 15000);
  await x.evaluate(`document.querySelector('.wallet-chart-btn').click()`);
  await x.waitFor(`!!document.querySelector('.wallet-chart-sats')`, 15000);
  await sleep(400); // the slot's open transition
}

test('under the price, the same figures in sats per dollar, between the corner buttons', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await openChart(x);
    // $100,000 buys 1,000 sats a dollar; the day's low, $80,000, buys 1,250. Low to high, so the
    // higher price comes first. The price's own row is as it was.
    assert.deepEqual(await x.evaluate(figures), {
      fiat: ['▲ 25.00%', '$80,000.00 – $100,000.00', '$100,000.00'],
      sats: ['1,000 – 1,250 sats/$', '1,000 sats/$'],
    });
    assert.deepEqual(await x.evaluate(scrubLeft), ['$80,000.00', '1,250 sats/$']);
    const at = await x.evaluate(placement);
    assert.equal(at.buttons >= 2, true, 'the corner buttons were not found');
    assert.equal(at.inside, true, 'the sats line ran off the card');
    assert.equal(at.clear, true, 'the sats line ran under a corner button');
    if (SHOTS) await x.screenshot(path.join(SHOTS, 'usd.png'), { width: 360, height: 640 });

    // ALL runs back to bitcoin's first cents: two billion sats a dollar, the longest the line gets.
    const pick = (label) => x.evaluate(`[...document.querySelectorAll('.wallet-chart-range-btn')].find((b) => b.textContent === '${label}').click()`);
    await pick('ALL');
    await x.waitFor(`document.querySelector('.wallet-chart-slot').dataset.range === 'all' && !document.querySelector('.wallet-chart.is-loading')`, 10000);
    await sleep(400);
    assert.deepEqual((await x.evaluate(figures)).sats, ['1,000 – 2,000,000,000 sats/$', '1,000 sats/$']);
    const all = await x.evaluate(placement);
    assert.equal(all.inside && all.clear, true, 'the long line ran into the buttons or off the card: ' + JSON.stringify(all));
    if (SHOTS) await x.screenshot(path.join(SHOTS, 'all.png'), { width: 360, height: 640 });
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('a currency worth few sats keeps a decimal', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.message({ type: 'SIDECAR_SET_SETTINGS', settings: { fiatCurrency: 'JPY' } });
    await openChart(x);
    // ¥15,000,000 buys 6.7 sats a yen; the day's low, ¥12,000,000, buys 8.3.
    assert.deepEqual((await x.evaluate(figures)).sats, ['6.7 – 8.3 sats/¥', '6.7 sats/¥']);
    if (SHOTS) await x.screenshot(path.join(SHOTS, 'jpy.png'), { width: 360, height: 640 });
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
