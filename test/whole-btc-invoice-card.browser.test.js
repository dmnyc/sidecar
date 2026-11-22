'use strict';

// A WHOLE-BITCOIN INVOICE IS READ AT ITS AMOUNT, against the real extension. A page asked to
// pay "lnbc11p…", 1 BTC: misread as 0 sats, the card offered "Pay 0 sats" and skipped the
// 10,000-sat "Confirm amount above". Read right, it is over the most Sidecar pays, so it is
// refused (test/payment-limit-card.browser.test.js has the refusal in full); the point here
// is that it is never a "0 sats" card. An invoice with no amount says so, rather than 0.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 180000 };
// Bech32 data only: its alphabet has no '1', 'b', 'i' or 'o', so the last '1' is the separator.
const DATA = 'pjq' + 'q'.repeat(200) + 'xyz0234567';

async function card(inv) {
  const site = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><p>shop'); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const x = await startExtension();
  try {
    await x.reload();
    await x.message({ type: 'SIDECAR_SET_NWC', pubkey: x.me, connection: 'nostr+walletconnect://' + 'ab'.repeat(32) + '?relay=' + encodeURIComponent(x.relay.url) + '&secret=' + 'cd'.repeat(32) });
    const page = await x.openPage(`http://127.0.0.1:${site.address().port}/`);
    await page.evaluate('new Promise((r) => { const t = setInterval(() => { if (window.webln) { clearInterval(t); r(true); } }, 50); })');
    await page.evaluate(`window.webln.enable().then(() => window.webln.sendPayment(${JSON.stringify(inv)})).then(() => 0, () => 0)`, { wait: false });
    for (let i = 0; i < 4; i++) {
      await x.waitFor(`!document.getElementById('view-approval').classList.contains('hidden')`, 10000);
      if (await x.evaluate(`/Lightning payment|can’t make/.test(document.getElementById('view-approval').innerText)`)) break;
      await x.evaluate(`document.getElementById('approval-allow').click()`);
      await new Promise((r) => setTimeout(r, 600));
    }
    await new Promise((r) => setTimeout(r, 400));
    const seen = await x.evaluate(`({ text: document.getElementById('approval-preview').innerText.replace(/\\s+/g, ' ').trim(), button: document.getElementById('approval-reject').textContent.trim(), allow: document.getElementById('approval-allow').textContent.trim() })`);
    await x.evaluate(`document.getElementById('approval-reject').click()`);
    return seen;
  } finally { x.close(); site.close(); }
}

test('a 1 BTC invoice is read as 1 BTC, so it is refused, never offered as 0 sats', opts, async (t) => {
  let seen;
  try { seen = await card('lnbc11' + DATA); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  assert.match(seen.text, /can’t pay more than 99,999,999 sats/, seen.text);
  assert.doesNotMatch(seen.text, /(^|\D)0 sats/, seen.text);
  assert.equal(seen.button, 'Close');
});

test('an invoice with no amount says it is set by the invoice, not 0', opts, async (t) => {
  let seen;
  try { seen = await card('lnbc1' + DATA); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  assert.match(seen.text, /set by invoice/, seen.text);
  assert.doesNotMatch(seen.text, /(^|\D)0 sats/, seen.text);
});
