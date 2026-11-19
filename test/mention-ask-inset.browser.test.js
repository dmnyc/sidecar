'use strict';

// The full-size composer's field has a visible border and 18px of padding. The @mention
// dropdown, and the name-search ask that opens in it, used to span the field from border to
// border, so the ask's box ran along the field's edges. It now sits in by the padding, in line
// with the text. The panel's field has no border, so there the dropdown keeps the full width.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

test('in the full-size composer the name-search ask sits inside the field, in line with the text', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
    for (let i = 0; i < 60; i++) {
      if (await tab.evaluate(`!!document.querySelector('.compose-editor') && !document.documentElement.classList.contains('compose-booting')`)) break;
      await sleep(250);
    }
    await tab.evaluate(`(() => { const e = document.querySelector('.compose-editor'); e.focus(); document.execCommand('insertText', false, 'Hello @br'); })()`);
    let shown = false;
    for (let i = 0; i < 40 && !shown; i++) { shown = await tab.evaluate(`!!document.querySelector('.ac-dropdown .na-ask')`); if (!shown) await sleep(250); }
    assert.ok(shown, 'the name-search ask did not open');
    const m = await tab.evaluate(`(() => {
      const ed = document.querySelector('.compose-editor').getBoundingClientRect();
      const dd = document.querySelector('.ac-dropdown').getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(document.querySelector('.compose-editor')).paddingLeft);
      return { left: dd.left - ed.left, right: ed.right - dd.right, pad };
    })()`);
    assert.equal(Math.round(m.left), Math.round(m.pad), 'the dropdown runs along the field’s left edge');
    assert.equal(Math.round(m.right), Math.round(m.pad), 'the dropdown runs along the field’s right edge');
  } finally { x.close(); }
});
