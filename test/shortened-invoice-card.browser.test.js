'use strict';

// A pay modal that shows only a shortened invoice beside its QR, the whole one living in the QR and
// behind a Copy button, used to get nothing from Sidecar. A copy made while a QR is open inside a
// dialog now counts as asked for. Run against the REAL extension, on the invoice lab's cases 10
// (a dialog) and 11 (the same, with no dialog around it), with a wallet on file so there is a card
// to offer. Nothing is ever paid: no Pay button is pressed and the wallet never answers.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };
const ROOT = path.join(__dirname, '..');

function serve() {
  const site = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
    try { r.setHeader('content-type', 'text/html'); r.end(fs.readFileSync(f)); } catch (_) { r.statusCode = 404; r.end(); }
  });
  return new Promise((resolve) => site.listen(0, '127.0.0.1', () => resolve(site)));
}

test('a copy beside a QR in a dialog opens the card; the same copy with no dialog stays a pill', opts, async (t) => {
  let x; let site;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    site = await serve();
    await x.reload();
    await x.message({ type: 'SIDECAR_SET_NWC', pubkey: x.me, connection: 'nostr+walletconnect://' + 'ab'.repeat(32) + '?relay=' + encodeURIComponent(x.relay.url) + '&secret=' + 'cd'.repeat(32) });
    const page = await x.openPage(`http://127.0.0.1:${site.address().port}/test/manual/invoice-lab.html`);
    await page.evaluate('new Promise((r) => { const t = setInterval(() => { if (window.nostr) { clearInterval(t); r(true); } }, 50); })');
    await page.evaluate(`document.getElementById('connect').click()`, { wait: false });
    await x.waitFor(`(() => { const v = document.getElementById('view-approval'); return !!v && !v.classList.contains('hidden'); })()`, 8000);
    await x.evaluate(`document.getElementById('approval-allow').click()`);
    await sleep(1200);

    const press = async (sel) => {
      await page.evaluate(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`);
      await sleep(400);
      const r = await page.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      await page.clickAt(r.x, r.y);
    };
    // What the page shows, found without pressing it: a card, a pill, or nothing. Both are in a closed shadow root.
    const shows = async () => {
      for (let i = 0; i < 16; i++) {
        await sleep(400);
        if (await page.clickInShadow('.card .brand')) return 'card';
        if (await page.clickInShadow('.pill .x')) return 'pill';
      }
      return 'nothing';
    };

    await page.evaluate(`document.querySelector('[data-show=j]').click()`);
    await sleep(500);
    await press('#slot-j [data-copy]');
    assert.equal(await shows(), 'card', 'case 10: a copy beside a QR in a dialog');
    await page.clickInShadow('.card .cancel');

    await page.evaluate(`document.querySelector('[data-show=k]').click()`);
    await sleep(500);
    await press('#slot-k [data-copy]');
    assert.equal(await shows(), 'pill', 'case 11: the same copy with no dialog');
    assert.deepEqual(x.errors, []);
  } finally { if (site) site.close(); x.close(); }
});
