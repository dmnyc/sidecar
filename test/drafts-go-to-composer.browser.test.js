'use strict';

// Saved drafts' way out says where it goes. Opened straight from the compose menu, there is
// no composer behind it, so the button says Go to composer; opened from the folder inside
// the composer, it says Back to composer. In the panel and in the full-size composer tab.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

test('the panel: Go to composer from the compose menu, Back to composer from the folder', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const label = `(() => { const b = document.querySelector('#modal .drafts-back'); return b ? b.textContent.trim() : null; })()`;
    await x.evaluate(`document.getElementById('compose-fab').click()`); await sleep(300);
    await x.evaluate(`document.getElementById('saved-drafts-btn').click()`); await sleep(900);
    assert.equal(await x.evaluate(label), 'Go to composer');
    await x.evaluate(`document.querySelector('#modal .drafts-back').click()`); await sleep(400);
    // Something to list, so the folder shows: a draft typed now.
    await x.evaluate(`(() => { const e = document.querySelector('#modal .compose-editor'); e.focus(); document.execCommand('insertText', false, 'A draft'); })()`);
    await sleep(900);
    await x.evaluate(`document.querySelector('#modal .compose-drafts-btn:not(.drafts-in-tab)').click()`); await sleep(900);
    assert.equal(await x.evaluate(label), 'Back to composer');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('the full-size composer: Go to composer when the tab opens on the list, Back from the folder', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html#drafts`);
    for (let i = 0; i < 60 && !(await tab.evaluate(`!!document.querySelector('.compose-editor') && !document.documentElement.classList.contains('compose-booting')`)); i++) await sleep(250);
    await sleep(900);
    const label = `(() => { const b = document.querySelector('#compose-drafts-pane .drafts-back'); return b ? b.textContent.trim() : null; })()`;
    assert.equal(await tab.evaluate(label), 'Go to composer');
    await tab.evaluate(`document.querySelector('#compose-drafts-pane .drafts-back').click()`); await sleep(300);
    await tab.evaluate(`(() => { const e = document.querySelector('.compose-editor'); e.focus(); document.execCommand('insertText', false, 'A draft'); })()`);
    await sleep(900);
    await tab.evaluate(`document.getElementById('compose-drafts-btn').click()`); await sleep(900);
    assert.equal(await tab.evaluate(label), 'Back to composer');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
