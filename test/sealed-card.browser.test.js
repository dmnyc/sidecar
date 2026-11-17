'use strict';

// An app that stores a wallet connection asks Sidecar to encrypt it, against the REAL
// extension. The card used to print the connection string, secret and all. It must say what
// the text is, keep the string behind "Show details", and say so on both surfaces: the side
// panel's card and the popup window's page. A batch of such requests lists them the same way.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };
const SECRET = '67c20fe6bec53f11becbd4e3382a602d3b362bdf2086ebd029d854ccdb8938d4';
const WALLET = 'nostr+walletconnect://2bb5d1d87f50066cc6066b41815d565abebb81a43996e90be52fa4f253cab8e8'
  + '?relay=wss%3A%2F%2Frelay.example.com&secret=' + SECRET;

async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('timed out');
}

// What a person sees: innerText leaves out anything display:none. The entry is a centered
// block for text that is not prose, and a label/value row for text that is.
const seen = (root) => `(() => {
  const box = document.querySelector(${JSON.stringify(root)});
  if (!box) return null;
  const r = box.querySelector('.sealed-block, .row.sealed');
  if (!r) return null;
  const block = r.classList.contains('sealed-block');
  const link = r.querySelector('.details-link');
  return {
    block,
    label: block ? r.querySelector('.sealed-what').innerText : r.children[0].innerText,
    shown: block ? r.querySelector('.sealed-val').innerText : r.children[1].innerText,
    link: link ? link.innerText : null,
    expanded: link ? link.getAttribute('aria-expanded') : null,
    rows: [...box.querySelectorAll(':scope > .row')].map((x) => x.children[0].innerText),
  };
})()`;
const clickLink = (root) => `(() => { const b = document.querySelector(${JSON.stringify(root)} + ' .details-link'); if (!b) return false; b.click(); return true; })()`;

test('a wallet connection to seal is described, and its string stays behind a link', opts, async (t) => {
  const site = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>app</title><p>app'); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  let x;
  try { x = await startExtension(); } catch (e) { site.close(); if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const page = await x.openPage(`http://127.0.0.1:${site.address().port}/`);
    await page.evaluate('new Promise((r) => { const t = setInterval(() => { if (window.nostr) { clearInterval(t); r(true); } }, 50); })');
    const cardUp = () => x.waitFor(`(() => { const v = document.getElementById('view-approval'); return !!v && !v.classList.contains('hidden'); })()`, 10000);

    await page.evaluate('window.nostr.getPublicKey().then((k) => { window.__pk = k; }, () => 0)', { wait: false });
    await cardUp();
    await x.evaluate(`document.getElementById('approval-allow').click()`);
    await x.waitFor(`document.getElementById('view-approval').classList.contains('hidden')`, 8000);
    await until(async () => page.evaluate('!!window.__pk'));

    await page.evaluate(`window.nostr.nip44.encrypt(window.__pk, ${JSON.stringify(WALLET)}).then(() => 0, () => 0)`, { wait: false });
    await cardUp();

    const check = async (evaluate, root, who) => {
      const c = await until(async () => evaluate(seen(root)));
      assert.equal(c.block, true, who + ': a wallet connection is not drawn as a label/value row');
      assert.equal(c.label.toLowerCase(), 'seal to yourself', who);
      assert.ok(!c.rows.includes('To'), who + ': sealing to yourself still has a To row');
      assert.equal(c.shown.includes('A wallet connection through relay.example.com'), true, who + ': ' + c.shown);
      assert.ok(!c.shown.includes(SECRET), who + ': the secret is on the card by default');
      assert.ok(!c.shown.includes('nostr+walletconnect'), who + ': the string is on the card by default');
      assert.equal(c.link, 'Show details', who);
      assert.equal(c.expanded, 'false', who);
      assert.ok(await evaluate(clickLink(root)), who);
      const open = await evaluate(seen(root));
      assert.ok(open.shown.includes(SECRET), who + ': Show details does not show the string');
      assert.equal(open.link, 'Hide details', who);
      // The string takes the block's full width, left-aligned, and the link sits centered above it.
      const lay = await evaluate(`(() => {
        const blk = document.querySelector(${JSON.stringify(root)} + ' .sealed-block');
        const raw = blk.querySelector('.sealed-raw');
        const rb = raw.getBoundingClientRect(), bb = blk.getBoundingClientRect();
        const lb = blk.querySelector('.details-link').getBoundingClientRect();
        return { rawWidth: rb.width / bb.width, align: getComputedStyle(raw).textAlign,
          linkOff: Math.abs((lb.left + lb.width / 2) - (bb.left + bb.width / 2)) };
      })()`);
      assert.ok(lay.rawWidth > 0.85, who + ': the string is not as wide as the card (' + lay.rawWidth + ')');
      assert.ok(['start', 'left'].includes(lay.align), who + ': the string is not left-aligned');
      assert.ok(lay.linkOff < 3, who + ': the link is not centered (' + lay.linkOff + 'px off)');
      assert.ok(await evaluate(clickLink(root)), who);
      const shut = await evaluate(seen(root));
      assert.ok(!shut.shown.includes(SECRET), who + ': Hide details does not hide it');
    };
    await check((e) => x.evaluate(e), '#approval-preview', 'panel');

    const pending = (await x.message({ type: 'SIDECAR_GET_PENDING' })).result;
    assert.ok(pending && pending.head && pending.head.id, 'no pending request to open a popup on');
    const popup = await x.openPage(`chrome-extension://${x.extId}/prompt.html?id=${pending.head.id}`);
    await check((e) => popup.evaluate(e), '#preview', 'popup');

    // Plain text is still shown as written, with no link.
    await x.evaluate(`document.getElementById('approval-reject').click()`);
    await x.waitFor(`document.getElementById('view-approval').classList.contains('hidden')`, 8000);
    await page.evaluate(`window.nostr.nip44.encrypt(window.__pk, 'dinner at seven').then(() => 0, () => 0)`, { wait: false });
    await cardUp();
    const plain = await until(async () => x.evaluate(seen('#approval-preview')));
    assert.equal(plain.block, false, 'readable text keeps its row');
    assert.equal(plain.label, 'Sealing');
    assert.equal(plain.shown, 'dinner at seven');
    assert.equal(plain.link, null);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); site.close(); }
});

test('a batch of requests to seal is listed in words, with each string behind its link', opts, async (t) => {
  const site = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>app</title><p>app'); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  let x;
  try { x = await startExtension(); } catch (e) { site.close(); if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const page = await x.openPage(`http://127.0.0.1:${site.address().port}/`);
    await page.evaluate('new Promise((r) => { const t = setInterval(() => { if (window.nostr) { clearInterval(t); r(true); } }, 50); })');
    const cardUp = () => x.waitFor(`(() => { const v = document.getElementById('view-approval'); return !!v && !v.classList.contains('hidden'); })()`, 10000);

    await page.evaluate('window.nostr.getPublicKey().then((k) => { window.__pk = k; }, () => 0)', { wait: false });
    await cardUp();
    await x.evaluate(`document.getElementById('approval-allow').click()`);
    await x.waitFor(`document.getElementById('view-approval').classList.contains('hidden')`, 8000);
    await until(async () => page.evaluate('!!window.__pk'));

    await page.evaluate(`(() => { for (let i = 0; i < 2; i++) window.nostr.nip44.encrypt(window.__pk, ${JSON.stringify(WALLET)} + '&n=' + i).then(() => 0, () => 0); })()`, { wait: false });
    await cardUp();
    const rows = await until(async () => {
      const v = await x.evaluate(`[...document.querySelectorAll('#approval-batch-list .batch-member')].map((m) => ({
        what: m.querySelector('.batch-member-what').innerText,
        text: m.querySelector('.batch-member-text').innerText,
        link: (m.querySelector('.details-link') || {}).innerText || null,
      }))`);
      return v && v.length === 2 ? v : null;
    });
    for (const r of rows) {
      assert.equal(r.what.toLowerCase(), 'seal to yourself', 'the member says what it is, not its method code');
      assert.ok(r.text.includes('A wallet connection through relay.example.com'), r.text);
      assert.ok(!r.text.includes(SECRET), 'the secret is in the batch list by default');
      assert.equal(r.link, 'Show details');
    }
    assert.deepEqual(x.errors, []);
  } finally { x.close(); site.close(); }
});

test('a sign card says what ciphertext and encoded content is, and the batch lists JSON in words', opts, async (t) => {
  const site = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>app</title><p>app'); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  let x;
  try { x = await startExtension(); } catch (e) { site.close(); if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const page = await x.openPage(`http://127.0.0.1:${site.address().port}/`);
    await page.evaluate('new Promise((r) => { const t = setInterval(() => { if (window.nostr) { clearInterval(t); r(true); } }, 50); })');
    const cardUp = () => x.waitFor(`(() => { const v = document.getElementById('view-approval'); return !!v && !v.classList.contains('hidden'); })()`, 10000);
    const settle = async (id) => { await x.evaluate(`document.getElementById('${id}').click()`); await x.waitFor(`document.getElementById('view-approval').classList.contains('hidden')`, 8000); };
    await page.evaluate('window.nostr.getPublicKey().then(() => 0, () => 0)', { wait: false });
    await cardUp(); await settle('approval-allow');

    const NIP04 = 'YSBzZWFsZWQgbWVzc2FnZSBvZiBzb21lIGxlbmd0aA==?iv=MDEyMzQ1Njc4OWFiY2RlZg==';
    await page.evaluate(`window.nostr.signEvent({ kind: 4, content: ${JSON.stringify(NIP04)}, tags: [], created_at: Math.floor(Date.now() / 1000) }).then(() => 0, () => 0)`, { wait: false });
    await cardUp();
    const state = (root) => `(() => { const b = document.querySelector(${JSON.stringify(root)}); const v = b && b.querySelector('.evpreview'); if (!v) return null;
      return { shown: v.innerText, modes: [...b.querySelectorAll('.evpreview-mode')].map((e) => e.textContent), active: [...b.querySelectorAll('.evpreview-mode.active')].map((e) => e.textContent) }; })()`;
    const pressRaw = (root) => `[...document.querySelector(${JSON.stringify(root)}).querySelectorAll('.evpreview-mode')].find((e) => e.textContent === 'Raw').click()`;
    const pending = (await x.message({ type: 'SIDECAR_GET_PENDING' })).result;
    const popup = await x.openPage(`chrome-extension://${x.extId}/prompt.html?id=${pending.head.id}`);
    for (const [who, evaluate, root] of [['panel', (e) => x.evaluate(e), '#approval-preview'], ['popup', (e) => popup.evaluate(e), '#preview']]) {
      const c = await until(async () => { const v = await evaluate(state(root)); return v && v.shown ? v : null; });
      assert.equal(c.shown, 'A sealed message', who + ': ciphertext is printed on the card by default');
      assert.deepEqual(c.active, ['Formatted'], who);
      await evaluate(pressRaw(root));
      assert.equal((await evaluate(state(root))).shown, NIP04, who + ': Raw is not the signed content');
    }
    await settle('approval-reject');

    // A batch of JSON settings events: each listed in words, with Show details.
    await page.evaluate(`(() => { for (let i = 0; i < 3; i++) window.nostr.signEvent({ kind: 30078, content: JSON.stringify({ n: i, theme: 'dark' }), tags: [['d', 'lab/' + i]], created_at: Math.floor(Date.now() / 1000) }).then(() => 0, () => 0); })()`, { wait: false });
    await cardUp();
    const rows = await until(async () => {
      const v = await x.evaluate(`[...document.querySelectorAll('#approval-batch-list .batch-member')].map((m) => m.querySelector('.batch-member-text').innerText)`);
      return v && v.length === 3 ? v : null;
    });
    for (const r of rows) {
      assert.ok(r.includes('Data with 2 fields: n, theme'), r);
      assert.ok(!r.includes('{"n"'), 'raw JSON is in the batch list by default');
    }
    assert.deepEqual(x.errors, []);
  } finally { x.close(); site.close(); }
});
