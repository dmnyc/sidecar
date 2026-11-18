'use strict';

// "Open saved drafts" on the compose menu, against the REAL extension. The item appears only
// when the account has drafts, opens the same list the composer's folder opens, and does it
// without writing over the draft it is there to list: opened with a note in progress, that note
// is the "Open now" row and Back returns to it with every word still there.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };
const click = (selector) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.click(); return true; })()`;
const visible = (selector) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); return !!e && !e.hidden && getComputedStyle(e).display !== 'none'; })()`;

async function openMenu(x) {
  // Closed first, so the next tap opens it again and works the item out afresh.
  await x.evaluate(`(() => { const m = document.getElementById('compose-menu'); if (!m.hidden) document.getElementById('compose-fab').click(); })()`);
  await sleep(400);
  await x.evaluate(click('#compose-fab'));
  await sleep(500);
}
const stored = async (x) => ((await x.message({ type: 'SIDECAR_SECRET_GET', store: 'drafts' })) || {}).result || {};

test('the item is there only when there are drafts, and the list opens without overwriting the draft', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();

    await openMenu(x);
    assert.equal(await x.evaluate(visible('#compose-note-btn')), true, 'the menu is open');
    assert.equal(await x.evaluate(visible('#saved-drafts-btn')), false, 'no drafts, no item');

    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [x.me]: { text: 'A note in progress', media: [], savedAt: Date.now() } } });
    await openMenu(x);
    assert.equal(await x.evaluate(visible('#saved-drafts-btn')), true, 'a draft in progress shows the item');

    assert.ok(await x.evaluate(click('#saved-drafts-btn')));
    await x.waitFor(`!!document.querySelector('#modal .saved-draft-current')`);
    assert.match(await x.evaluate(`document.querySelector('#modal h3').textContent`), /Saved drafts/);
    assert.match(await x.evaluate(`document.querySelector('#modal .saved-draft-current').textContent`), /A note in progress/);
    assert.equal(await x.evaluate(`document.querySelector('#modal .saved-draft-current .saved-draft-when').textContent`), 'Open now');

    // Still there in the store, word for word, after the list saved "what is on screen".
    assert.equal((await stored(x))[x.me].text, 'A note in progress');

    // And back to it, in the editor, with the text in the box.
    assert.ok(await x.evaluate(`(() => { const b = [...document.querySelectorAll('#modal button')].find((e) => e.textContent.trim() === 'Back to your draft'); if (!b) return false; b.click(); return true; })()`));
    await x.waitFor(`!!document.querySelector('#modal [contenteditable]')`);
    assert.equal(await x.evaluate(`document.querySelector('#modal [contenteditable]').innerText.trim()`), 'A note in progress');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('with no note in progress but a draft set aside, the item opens the list with it', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    // A reply draft is its own slot, so it counts as a draft with no note in progress.
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [x.me + '|r:' + 'a'.repeat(64)]: { text: 'Answering something', media: [], savedAt: Date.now(), replyTo: { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), kind: 1 } } } });
    await openMenu(x);
    assert.equal(await x.evaluate(visible('#saved-drafts-btn')), true, 'another slot with a draft shows the item');
    assert.ok(await x.evaluate(click('#saved-drafts-btn')));
    await x.waitFor(`!!document.querySelector('#modal .saved-drafts .saved-draft')`);
    assert.match(await x.evaluate(`document.querySelector('#modal .saved-drafts').textContent`), /Answering something/);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

// ---- with the full-size composer as the default, the list is the tab's ----

async function pageUntil(page, expression, ms = 10000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await page.evaluate(expression); if (last) return last; } catch (_) {} await sleep(150); }
  throw new Error('timed out waiting for: ' + expression + ' (last: ' + last + ')');
}
const listShowing = `(() => { const p = document.getElementById('compose-drafts-pane'); return !!p && !p.classList.contains('hidden') && /Saved drafts/.test(p.textContent); })()`;

test('the composer tab opened with #drafts starts on its Saved drafts, and a reload returns to the draft', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [x.me]: { text: 'In the tab', media: [], savedAt: Date.now() } } });
    const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html#drafts`);
    await pageUntil(tab, listShowing);
    assert.match(await tab.evaluate(`document.getElementById('compose-drafts-pane').textContent`), /In the tab/);
    assert.equal(await tab.evaluate('location.hash'), '', 'the marker is dropped from the address');
  } finally { x.close(); }
});

test('"Open saved drafts" with the full-size composer as the default opens the tab on its list', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    await x.message({ type: 'SIDECAR_SET_SETTINGS', settings: { composeInTab: true } });
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [x.me]: { text: 'In the tab', media: [], savedAt: Date.now() } } });
    await x.recordTabs();
    await openMenu(x);
    assert.equal(await x.evaluate(visible('#saved-drafts-btn')), true);
    assert.ok(await x.evaluate(click('#saved-drafts-btn')));
    await x.waitFor(`(window.__calls || []).some((c) => c.call === 'create')`);
    const made = (await x.calls()).filter((c) => c.call === 'create');
    assert.equal(made.length, 1);
    assert.ok(/\/compose\.html#drafts$/.test(made[0].args[0].url), 'the tab opens on its list: ' + made[0].args[0].url);
    assert.equal(await x.evaluate(`!!document.querySelector('#modal .saved-drafts, #modal .saved-draft')`), false, 'the panel draws no list of its own');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('with the composer tab already open, the panel item turns it to its list', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    await x.message({ type: 'SIDECAR_SET_SETTINGS', settings: { composeInTab: true } });
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [x.me]: { text: 'In the tab', media: [], savedAt: Date.now() } } });
    const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
    await pageUntil(tab, `!!document.querySelector('.compose-sheet') && document.getElementById('compose-drafts-pane') && document.getElementById('compose-drafts-pane').classList.contains('hidden')`);
    await openMenu(x);
    assert.ok(await x.evaluate(click('#saved-drafts-btn')));
    await pageUntil(tab, listShowing);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
