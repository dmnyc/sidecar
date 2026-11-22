'use strict';

// MORE THAN SIDECAR PAYS IS REFUSED, against the real extension. A page asks to pay a 1 BTC
// invoice (Sidecar pays 99,999,999 sats at most): the page is told no, nothing reaches the
// wallet, and where a payment card would have opened (the panel, or the popup) a card says why,
// with no amount, no account and no Pay, and one button, Close. The card is reused, so the next
// payment card must come back whole: its Pay button, its account, its Reject.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 180000 };
// Bech32 data only: its alphabet has no '1', so the last '1' is the separator.
const DATA = 'pjq' + 'q'.repeat(200) + 'xyz0234567';

async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('timed out');
}

const look = (root) => `(() => {
  const q = (s) => document.querySelector(s);
  const shown = (el) => !!el && !el.classList.contains('hidden') && !!el.offsetParent;
  const r = ${JSON.stringify(root)};
  const missing = Object.entries(r).filter(([, sel]) => !q(sel)).map(([k]) => k);
  if (missing.length) return { missing };
  return {
    ask: q(r.ask).textContent.trim(),
    preview: q(r.preview).innerText.replace(/\\s+/g, ' ').trim(),
    allow: shown(q(r.allow)),
    account: shown(q(r.account)),
    reject: q(r.reject).textContent.trim(),
  };
})()`;
const PANEL = { ask: '#approval-ask', preview: '#approval-preview', allow: '#approval-allow', account: '#approval-account', reject: '#approval-reject' };
const POPUP = { ask: '#ask', preview: '#preview', allow: '#allow', account: '#account', reject: '#reject' };

test('a 1 BTC invoice is refused: the page is told, nothing reaches the wallet, and a card says why', opts, async (t) => {
  const site = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><p>shop'); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const walletRequests = [];
  let x;
  try { x = await startExtension({ relayOptions: { onEvent: (ev) => { if (ev && ev.kind === 23194) walletRequests.push(ev); } } }); } catch (e) { site.close(); if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    await x.message({ type: 'SIDECAR_SET_NWC', pubkey: x.me, connection: 'nostr+walletconnect://' + 'ab'.repeat(32) + '?relay=' + encodeURIComponent(x.relay.url) + '&secret=' + 'cd'.repeat(32) });
    const page = await x.openPage(`http://127.0.0.1:${site.address().port}/`);
    await page.evaluate('new Promise((r) => { const t = setInterval(() => { if (window.webln) { clearInterval(t); r(true); } }, 50); })');
    const cardUp = () => x.waitFor(`!document.getElementById('view-approval').classList.contains('hidden')`, 10000);

    // Enable (no card once a wallet is connected), then ask for 1 BTC.
    await page.evaluate(`window.__r = []; window.webln.enable().then(() => window.__r.push('enabled'), (e) => window.__r.push('enable: ' + e.message))`, { wait: false });
    await until(async () => page.evaluate(`window.__r.includes('enabled')`));
    walletRequests.length = 0;
    await page.evaluate(`window.webln.sendPayment('lnbc11${DATA}').then(() => window.__r.push('paid'), (e) => window.__r.push('pay: ' + e.message))`, { wait: false });

    // The page is told no at once, before anyone presses anything.
    const answer = await until(async () => page.evaluate(`window.__r.find((s) => s.startsWith('pay'))`));
    assert.equal(answer, "pay: Sidecar can't pay more than 99,999,999 sats at once");

    // The panel's card: why, and Close; no amount, no account, no Pay.
    await cardUp();
    const panel = await until(async () => { const s = await x.evaluate(look(PANEL)); if (s.missing) throw new Error('panel lacks ' + s.missing); return /can’t pay more/.test(s.preview) && s; });
    assert.equal(panel.ask, 'asked for a payment Sidecar can’t make');
    assert.equal(panel.preview, 'Sidecar can’t pay more than 99,999,999 sats at once, so nothing was paid.');
    assert.equal(panel.allow, false, 'a Pay button on the refusal');
    assert.equal(panel.account, false, 'an account on the refusal');
    assert.equal(panel.reject, 'Close');
    assert.doesNotMatch(panel.preview, /100,000,000/, 'the amount asked for is not drawn');

    // The popup's, for the same request.
    const pending = (await x.message({ type: 'SIDECAR_GET_PENDING' })).result;
    const popup = await x.openPage(`chrome-extension://${x.extId}/prompt.html?id=${pending.head.id}`);
    const pop = await until(async () => { const s = await popup.evaluate(look(POPUP)); if (s.missing) return false; return /can’t pay more/.test(s.preview) && s; });
    assert.equal(pop.ask, 'asked for a payment Sidecar can’t make');
    assert.equal(pop.allow, false);
    assert.equal(pop.account, false);
    assert.equal(pop.reject, 'Close');
    await popup.close().catch(() => {});

    // Close puts it away. Nothing was asked of the wallet.
    await x.evaluate(`document.getElementById('approval-reject').click()`);
    await x.waitFor(`document.getElementById('view-approval').classList.contains('hidden')`, 8000);
    assert.equal(walletRequests.length, 0, 'a request reached the wallet');

    // The next payment card is whole again on the reused card.
    await page.evaluate(`window.webln.sendPayment('lnbc2120n1${DATA}').then(() => 0, () => 0)`, { wait: false });
    await cardUp();
    const next = await until(async () => { const s = await x.evaluate(look(PANEL)); return /212/.test(s.preview) && s; });
    assert.equal(next.ask, 'wants to send a Lightning payment');
    assert.equal(next.allow, true, 'the Pay button did not come back');
    assert.equal(next.account, true, 'the account did not come back');
    assert.equal(next.reject, 'Reject');
    await x.evaluate(`document.getElementById('approval-reject').click()`);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); site.close(); }
});
