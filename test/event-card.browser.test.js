'use strict';

// The approval card for an event Sidecar has no name for, against the REAL extension. A site
// asks for a kind 25910, the ephemeral message kind MCP over Nostr uses, with a JSON-RPC
// message in its content. The card must say what range the kind is in and what that means,
// name the method, and open on the message's fields instead of its braces, with Raw and JSON
// one tap away and showing exactly what is signed. Both surfaces are read: the side panel's
// card, and the popup window's page, opened on the same pending request.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startExtension, CHROME } = require('./helpers/real-extension');

const fs = require('node:fs');
const path = require('node:path');
// EVENT_CARD_SHOTS=<dir> also writes what the panel's card looked like.
const SHOTS = process.env.EVENT_CARD_SHOTS || '';
const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

const MESSAGE = '{"jsonrpc":"2.0","id":"9eb9894f-7474-4d07-a474-09eb9aa01eee","method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"jank","version":"26.16.0"}}}';

// What a card shows, read from the page it is drawn in.
const read = (root) => `(() => {
  const box = document.querySelector(${JSON.stringify(root)});
  if (!box) return null;
  const view = box.querySelector('.evpreview');
  const warn = box.querySelector('.kind-warn');
  return {
    rows: [...box.querySelectorAll(':scope > .row')].map((r) => [r.children[0].textContent, r.children[1].textContent]),
    warning: warn ? warn.textContent : null,
    note: warn ? warn.classList.contains('kind-note') : null,
    warnColor: warn ? getComputedStyle(warn).color : null,
    fields: [...box.querySelectorAll('.evpreview .ev-field')].map((f) => [f.children[0].textContent, f.children[1].textContent]),
    view: view ? view.textContent : null,
    modes: [...box.querySelectorAll('.evpreview-mode')].map((b) => b.textContent),
    active: [...box.querySelectorAll('.evpreview-mode.active')].map((b) => b.textContent),
  };
})()`;
const press = (root, label) => `(() => { const b = [...document.querySelector(${JSON.stringify(root)}).querySelectorAll('.evpreview-mode')].find((e) => e.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`;

async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('timed out');
}

test('an unrecognized ephemeral kind opens on its fields, names its method, and says what ephemeral means', opts, async (t) => {
  const site = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>client</title><p>client'); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  let x;
  try { x = await startExtension(); } catch (e) { site.close(); if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const page = await x.openPage(`http://127.0.0.1:${site.address().port}/`);
    await page.evaluate('new Promise((r) => { const t = setInterval(() => { if (window.nostr) { clearInterval(t); r(true); } }, 50); })');
    const cardUp = () => x.waitFor(`(() => { const v = document.getElementById('view-approval'); return !!v && !v.classList.contains('hidden'); })()`, 10000);

    // Sign the page in, so the next card is a signing card.
    await page.evaluate('window.nostr.getPublicKey().then(() => 0, () => 0)', { wait: false });
    await cardUp();
    await x.evaluate(`document.getElementById('approval-allow').click()`);
    await x.waitFor(`document.getElementById('view-approval').classList.contains('hidden')`, 8000);

    await page.evaluate(`window.nostr.signEvent({ kind: 25910, content: ${JSON.stringify(MESSAGE)}, tags: [['p', '${'a'.repeat(64)}']], created_at: Math.floor(Date.now() / 1000) }).then(() => 0, () => 0)`, { wait: false });
    await cardUp();

    const check = async (evaluate, root, who) => {
      const c = await until(async () => { const v = await evaluate(read(root)); return v && v.rows.length ? v : null; });
      assert.deepEqual(c.rows[0], ['Kind', '25910 (ephemeral event)'], who);
      assert.deepEqual(c.rows[1], ['Tags', '1 (p)'], who + ': the tag count names its tags');
      assert.deepEqual(c.rows[2], ['Method', 'initialize'], who + ': the method is named');
      assert.equal(c.warning, 'Ephemeral: relays pass it on without keeping it. It’s still signed by your key.', who);
      assert.equal(c.note, true, who + ': ephemeral is a calm note, not the amber caution');
      assert.notEqual(c.warnColor, 'rgb(255, 179, 138)', who + ': not the warning color');
      // Opens on rows, not on braces.
      assert.deepEqual(c.modes, ['Formatted', 'Raw', 'JSON'], who);
      assert.deepEqual(c.active, ['Formatted'], who);
      assert.deepEqual(c.fields, [
        ['jsonrpc', '2.0'], ['id', '9eb9894f-7474-4d07-a474-09eb9aa01eee'], ['method', 'initialize'],
        ['params.protocolVersion', '2025-06-18'], ['params.capabilities', '{}'],
        ['params.clientInfo.name', 'jank'], ['params.clientInfo.version', '26.16.0'],
      ], who);
      assert.ok(!c.view.includes('{"jsonrpc"'), who + ': the default view still shows the raw message');
      // Raw is the exact content, and JSON the whole event: nothing is hidden, only moved.
      assert.ok(await evaluate(press(root, 'Raw')), who);
      assert.equal((await evaluate(read(root))).view, MESSAGE, who + ': Raw is not the signed content');
      assert.ok(await evaluate(press(root, 'JSON')), who);
      const json = (await evaluate(read(root))).view;
      assert.match(json, /"kind": 25910/, who);
      assert.ok(json.includes('"method\\":\\"initialize\\"') || json.includes('initialize'), who);
      assert.ok(await evaluate(press(root, 'Formatted')), who);
      assert.equal((await evaluate(read(root))).fields.length, 7, who + ': Formatted comes back');
    };

    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await x.screenshot(path.join(SHOTS, 'ephemeral-card.png')); }
    await check((e) => x.evaluate(e), '#approval-preview', 'panel');

    // The popup window's page, opened on the same pending request.
    const pending = (await x.message({ type: 'SIDECAR_GET_PENDING' })).result;
    assert.ok(pending && pending.head && pending.head.id, 'no pending request to open a popup on');
    const popup = await x.openPage(`chrome-extension://${x.extId}/prompt.html?id=${pending.head.id}`);
    await check((e) => popup.evaluate(e), '#preview', 'popup');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); site.close(); }
});

test('a profile, which is JSON too, opens on its fields; a plain note and a non-JSON kind do not change', opts, async (t) => {
  const site = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>client</title><p>client'); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  let x;
  try { x = await startExtension(); } catch (e) { site.close(); if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const page = await x.openPage(`http://127.0.0.1:${site.address().port}/`);
    await page.evaluate('new Promise((r) => { const t = setInterval(() => { if (window.nostr) { clearInterval(t); r(true); } }, 50); })');
    const cardUp = () => x.waitFor(`(() => { const v = document.getElementById('view-approval'); return !!v && !v.classList.contains('hidden'); })()`, 10000);
    const settle = async () => {
      await x.evaluate(`document.getElementById('approval-allow').click()`);
      await x.waitFor(`document.getElementById('view-approval').classList.contains('hidden')`, 8000);
    };
    await page.evaluate('window.nostr.getPublicKey().then(() => 0, () => 0)', { wait: false });
    await cardUp(); await settle();

    // A note: Formatted is its own renderer, no field rows, no Method row.
    await page.evaluate(`window.nostr.signEvent({ kind: 1, content: 'hello {"jsonrpc":"2.0","method":"x"}', tags: [], created_at: Math.floor(Date.now() / 1000) }).then(() => 0, () => 0)`, { wait: false });
    await cardUp();
    let c = await until(async () => { const v = await x.evaluate(read('#approval-preview')); return v && v.rows.length ? v : null; });
    assert.deepEqual(c.rows.map((r) => r[0]), ['Kind', 'Tags'], 'a note has no Method row');
    assert.deepEqual(c.rows[1], ['Tags', '0']);
    assert.deepEqual(c.fields, []);
    assert.equal(c.warning, null);
    await settle();

    // Text that is not JSON on an unrecognized kind: Raw and JSON, as before.
    await page.evaluate(`window.nostr.signEvent({ kind: 4999, content: 'just words', tags: [], created_at: Math.floor(Date.now() / 1000) }).then(() => 0, () => 0)`, { wait: false });
    await cardUp();
    c = await until(async () => { const v = await x.evaluate(read('#approval-preview')); return v && v.rows.length ? v : null; });
    assert.deepEqual(c.rows[0], ['Kind', '4999 (unrecognized kind)']);
    assert.equal(c.warning, 'Unrecognized event kind. Review carefully before approving.');
    assert.equal(c.note, false, 'an unrecognized regular kind is still a caution');
    assert.deepEqual(c.modes, ['Raw', 'JSON']);
    assert.equal(c.view, 'just words');
    await settle();

    // A profile: rows.
    await page.evaluate(`window.nostr.signEvent({ kind: 0, content: JSON.stringify({ name: 'Test', about: 'Hello' }), tags: [], created_at: Math.floor(Date.now() / 1000) }).then(() => 0, () => 0)`, { wait: false });
    await cardUp();
    c = await until(async () => { const v = await x.evaluate(read('#approval-preview')); return v && v.rows.length ? v : null; });
    assert.deepEqual(c.fields, [['name', 'Test'], ['about', 'Hello']]);
    assert.deepEqual(c.modes, ['Formatted', 'Raw', 'JSON']);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); site.close(); }
});
