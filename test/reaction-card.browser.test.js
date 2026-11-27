'use strict';

// A reaction to sign is drawn with its emoji large, against the REAL extension, on both approval
// surfaces: the side panel's card and the popup window's page. The emoji used to be one character in
// 12px monospace under Raw. Raw and JSON must still show exactly what is signed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };
const E = 'e'.repeat(64);

async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('timed out');
}

// What a person sees in the content box of the card: the size of the glyph, its text, the note under it.
const look = (root) => `(() => {
  const box = document.querySelector(${JSON.stringify(root)} + ' .evpreview');
  if (!box) return null;
  const g = box.querySelector('.ev-reaction-glyph');
  const n = box.querySelector('.ev-reaction-note');
  return { classes: box.className, glyph: g ? g.innerText : null, size: g ? parseFloat(getComputedStyle(g).fontSize) : 0, note: n ? n.innerText : null, text: box.innerText };
})()`;
const clickMode = (root, label) => `(() => { const b = [...document.querySelectorAll(${JSON.stringify(root)} + ' .evpreview-mode')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`;

test('a reaction is drawn with its emoji large on both surfaces, and Raw still says what is signed', opts, async (t) => {
  const site = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>app</title><p>app'); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  let x;
  try { x = await startExtension(); } catch (e) { site.close(); if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const page = await x.openPage(`http://127.0.0.1:${site.address().port}/`);
    await page.evaluate('new Promise((r) => { const t = setInterval(() => { if (window.nostr) { clearInterval(t); r(true); } }, 50); })');
    const cardUp = () => x.waitFor(`(() => { const v = document.getElementById('view-approval'); return !!v && !v.classList.contains('hidden'); })()`, 10000);
    const reject = async () => { await x.evaluate(`document.getElementById('approval-reject').click()`); await x.waitFor(`document.getElementById('view-approval').classList.contains('hidden')`, 8000); };
    const react = (content) => page.evaluate(`window.nostr.signEvent({ kind: 7, content: ${JSON.stringify(content)}, tags: [['e', '${E}']], created_at: Math.floor(Date.now() / 1000) }).then(() => 0, () => 0)`, { wait: false });

    await page.evaluate('window.nostr.getPublicKey().then((k) => { window.__pk = k; }, () => 0)', { wait: false });
    await cardUp();
    await x.evaluate(`document.getElementById('approval-allow').click()`);
    await x.waitFor(`document.getElementById('view-approval').classList.contains('hidden')`, 8000);
    await until(async () => page.evaluate('!!window.__pk'));

    // An emoji: large on the panel and on the popup page.
    await react('🤙');
    await cardUp();
    const panel = await until(async () => x.evaluate(look('#approval-preview')));
    assert.equal(panel.glyph, '🤙');
    assert.ok(panel.size >= 40, 'the panel draws the emoji at ' + panel.size + 'px');
    assert.equal(panel.note, null, 'an emoji needs no note');
    assert.match(panel.classes, /ev-reaction/);

    const pending = (await x.message({ type: 'SIDECAR_GET_PENDING' })).result;
    assert.ok(pending && pending.head && pending.head.id, 'no pending request to open a popup on');
    const popup = await x.openPage(`chrome-extension://${x.extId}/prompt.html?id=${pending.head.id}`);
    const pop = await until(async () => popup.evaluate(look('#preview')));
    assert.equal(pop.glyph, '🤙');
    assert.ok(pop.size >= 40, 'the popup draws the emoji at ' + pop.size + 'px');

    // Raw is exactly the content, and JSON is the whole event.
    assert.ok(await x.evaluate(clickMode('#approval-preview', 'Raw')));
    const raw = await x.evaluate(look('#approval-preview'));
    assert.equal(raw.text.trim(), '🤙');
    assert.equal(raw.glyph, null);
    assert.ok(await x.evaluate(clickMode('#approval-preview', 'JSON')));
    assert.match((await x.evaluate(look('#approval-preview'))).text, /"kind": 7/);
    await popup.close().catch(() => {});
    await reject();

    // The old like: a heart, and a note saying what was actually signed.
    await react('+');
    await cardUp();
    const like = await until(async () => x.evaluate(look('#approval-preview')));
    assert.equal(like.glyph, '❤️');
    assert.equal(like.note, 'Like');
    assert.ok(like.size >= 40);
    assert.ok(await x.evaluate(clickMode('#approval-preview', 'Raw')));
    assert.equal((await x.evaluate(look('#approval-preview'))).text.trim(), '+', 'Raw must say +, not the heart');
    await reject();

    // A custom emoji's shortcode is not turned into a picture, and is not drawn large.
    await react(':shakingeyes:');
    await cardUp();
    const custom = await until(async () => x.evaluate(look('#approval-preview')));
    assert.equal(custom.glyph, ':shakingeyes:');
    assert.ok(custom.size < 30, 'a shortcode is drawn at ' + custom.size + 'px');
    assert.equal(await x.evaluate(`document.querySelectorAll('#approval-preview img').length`), 0);
    await reject();
    assert.deepEqual(x.errors, []);
  } finally { x.close(); site.close(); }
});
