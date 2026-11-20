'use strict';

// The folder in the full-size composer comes back after a draft is picked from Saved
// drafts. The pick repaints while the list is still up and again on the way back to the
// editor; the first finishing last hid the folder until something else repainted it.
// And a reply's target steps aside while the list is up, as its attachments do.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

async function until(tab, expr) {
  for (let i = 0; i < 60; i++) { if (await tab.evaluate(expr)) return; await sleep(250); }
  throw new Error('timed out: ' + expr);
}

test('the folder is back after picking a draft from Saved drafts', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const pk = (await x.message({ type: 'SIDECAR_GET_STATE' })).result.activePubkey;
    const id = 'a'.repeat(64);
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: {
      [pk]: { text: 'A note', media: [], savedAt: Date.now() },
      [pk + '|r:' + id]: { text: 'A reply', media: [], savedAt: Date.now() - 1000, replyTo: { id, pubkey: 'b'.repeat(64) } },
    } });
    const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
    const folder = `document.getElementById('compose-drafts-btn')`;
    await until(tab, `(document.querySelector('.compose-editor') || {}).innerText === 'A note' && !${folder}.classList.contains('hidden')`);
    // The note being answered stays with the editor: over the list it read as part of it.
    const target = `getComputedStyle(document.getElementById('compose-reply-target')).display`;
    await tab.evaluate(`${folder}.click()`);
    const row = `[...document.querySelectorAll('#compose-drafts-pane .saved-draft:not(.saved-draft-current)')].find((r) => /A reply/.test(r.textContent))`;
    await until(tab, `!!${row}`);
    await tab.evaluate(`${row}.querySelector('.saved-draft-open').click()`);
    await until(tab, `document.querySelector('.compose-editor').innerText === 'A reply'`);
    await sleep(1500); // past every repaint the pick started
    assert.equal(await tab.evaluate(`${folder}.classList.contains('hidden')`), false, 'the folder stayed hidden');
    assert.equal(await tab.evaluate(`document.getElementById('compose-drafts-count').textContent`), '1');
    assert.notEqual(await tab.evaluate(target), 'none', 'the reply target did not come back with the editor');
    // Back on the list from the reply: its target goes, and returns with Back to composer.
    await tab.evaluate(`${folder}.click()`);
    await until(tab, `!!document.querySelector('#compose-drafts-pane .saved-draft-current')`);
    assert.equal(await tab.evaluate(target), 'none', 'the reply target stayed over the list');
    await tab.evaluate(`document.querySelector('.compose-drafts-back').click()`);
    await until(tab, `document.getElementById('compose-drafts-pane').classList.contains('hidden')`);
    assert.notEqual(await tab.evaluate(target), 'none', 'the reply target did not come back');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
