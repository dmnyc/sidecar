'use strict';

// Both composers say when the draft is saved. The draft is written about 0.4s after typing
// stops, encrypted on this device, and nothing on screen used to say so. "Saved" appears once
// a write lands, and a write that fails says "Not saved", the one case where the text exists
// only in that window. Run against the real extension: the words have to reach the screen.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

async function until(read, want, ms = 6000) {
  const end = Date.now() + ms;
  let got;
  while (Date.now() < end) { got = await read(); if (got === want) return got; await sleep(150); }
  return got;
}

test('the panel and the full-size composer say Saved after a write, and Not saved when it fails', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    await x.evaluate(`document.getElementById('compose-fab').click()`); await sleep(400);
    await x.evaluate(`document.getElementById('compose-note-btn').click()`);
    await x.waitFor(`!!document.querySelector('#modal .compose-editor')`);
    const panelSaved = () => x.evaluate(`(document.querySelector('#modal .compose-tabs .compose-saved') || {}).textContent`);
    assert.equal(await panelSaved(), '', 'Saved before anything was written');
    await x.evaluate(`(() => { const e = document.querySelector('#modal .compose-editor'); e.focus(); document.execCommand('insertText', false, 'A note in progress'); })()`);
    assert.equal(await until(panelSaved, 'Saved'), 'Saved', 'the panel never said Saved');
    assert.ok(await x.evaluate(`!!document.querySelector('#modal .compose-tabs .compose-saved svg')`), 'the panel shows no check');
    await x.evaluate(`document.querySelector('#modal > .modal-x:not(.compose-drafts-btn):not(.compose-expand)').click()`);
    await sleep(600);

    const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
    for (let i = 0; i < 60; i++) {
      if (await tab.evaluate(`!!document.querySelector('.compose-editor') && !document.documentElement.classList.contains('compose-booting')`)) break;
      await sleep(250);
    }
    const tabSaved = () => tab.evaluate(`document.getElementById('compose-saved').textContent`);
    await tab.evaluate(`(() => { const e = document.querySelector('.compose-editor'); e.focus(); document.execCommand('insertText', false, ' and more'); })()`);
    assert.equal(await until(tabSaved, 'Saved'), 'Saved', 'the full-size composer never said Saved');
    assert.ok(await tab.evaluate(`!!document.querySelector('#compose-tabs #compose-saved svg')`), 'the check is not at the end of the Write / Preview row');

    await x.message({ type: 'SIDECAR_LOCK' });
    await sleep(800);
    await tab.evaluate(`(() => { const e = document.querySelector('.compose-editor'); e.focus(); document.execCommand('insertText', false, '!'); })()`);
    assert.equal(await until(tabSaved, 'Not saved: Sidecar is locked'), 'Not saved: Sidecar is locked', 'a failed write still said Saved');
    assert.ok(await tab.evaluate(`document.getElementById('compose-saved').classList.contains('is-failed')`));
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
