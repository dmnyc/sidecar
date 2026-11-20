'use strict';

// The draft on screen can be thrown away from its own row in Saved drafts: two taps,
// the first saying what the second does. The editor is cleared with the stored copy, so
// the next autosave cannot write it back. Against the real extension, in the full-size
// composer and in the panel's.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

async function seed(x, text) {
  const pk = (await x.message({ type: 'SIDECAR_GET_STATE' })).result.activePubkey;
  await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [pk]: { text, media: [], savedAt: Date.now() } } });
}
async function until(tab, expr) {
  for (let i = 0; i < 60; i++) { if (await tab.evaluate(expr)) return; await sleep(250); }
  throw new Error('timed out: ' + expr);
}
const stored = async (x) => JSON.stringify((await x.message({ type: 'SIDECAR_SECRET_GET', store: 'drafts' })).result || {});

// The open draft's row in a Saved drafts list under `root`: titled Discard, asks on the
// first tap, and goes on the second.
async function discardFromRow(evaluate, root) {
  const cur = `${root}.querySelector('.saved-draft-current')`;
  const x = `${cur}.querySelector('.saved-draft-x:not(.saved-draft-cloud)')`;
  assert.equal(await evaluate(`${cur}.querySelector('.saved-draft-when').textContent`), 'Open now');
  assert.equal(await evaluate(`${x}.title`), 'Discard draft');
  await evaluate(`${x}.click()`);
  assert.equal(await evaluate(`${cur}.querySelector('.saved-draft-label').textContent`), 'Discard this draft?');
  assert.equal(await evaluate(`${cur}.querySelector('.saved-draft-snip').textContent`), 'Tap again to discard');
  await evaluate(`${x}.click()`);
}

test('the open draft is discarded from its row in the full-size composer', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    await seed(x, 'Throw this away');
    const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
    await until(tab, `(document.querySelector('.compose-editor') || {}).innerText === 'Throw this away' && !document.documentElement.classList.contains('compose-booting')`);
    await tab.evaluate(`document.getElementById('compose-drafts-btn').click()`);
    await until(tab, `!!document.querySelector('#compose-drafts-pane .saved-draft-current')`);
    await discardFromRow((s) => tab.evaluate(s), `document.querySelector('#compose-drafts-pane')`);
    await sleep(1500); // past the autosave, which must not put it back
    assert.equal(await tab.evaluate(`document.querySelector('.compose-editor').innerText.trim()`), '', 'the editor kept the text');
    assert.ok(!(await stored(x)).includes('Throw this away'), 'the draft came back');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('the open draft is discarded from its row in the panel composer', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    await seed(x, 'Gone from the panel');
    await x.evaluate(`document.getElementById('compose-fab').click()`); await sleep(400);
    await x.evaluate(`document.getElementById('compose-note-btn').click()`);
    const resume = `[...document.querySelectorAll('#modal button')].find((b) => b.textContent === 'Resume draft')`;
    await x.waitFor(`!!${resume} || !!document.querySelector('#modal .compose-editor')`);
    if (await x.evaluate(`!!${resume}`)) await x.evaluate(`${resume}.click()`);
    await x.waitFor(`!!document.querySelector('#modal .compose-drafts-btn:not(.hidden):not(.drafts-in-tab)')`);
    await x.evaluate(`document.querySelector('#modal .compose-drafts-btn:not(.drafts-in-tab)').click()`);
    await x.waitFor(`!!document.querySelector('#modal .saved-draft-current')`);
    await discardFromRow((s) => x.evaluate(s), `document.querySelector('#modal')`);
    // A blank composer in its place, and nothing to resume.
    await x.waitFor(`!!document.querySelector('#modal .compose-editor')`);
    await sleep(1500);
    assert.equal(await x.evaluate(`document.querySelector('#modal .compose-editor').innerText.trim()`), '', 'the editor kept the text');
    assert.ok(!(await stored(x)).includes('Gone from the panel'), 'the draft came back');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
