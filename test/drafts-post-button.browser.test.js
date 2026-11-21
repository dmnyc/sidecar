'use strict';

// Saved drafts opened straight into a new full-size composer tab (compose.html#drafts, the
// panel's "Open saved drafts" when no tab is open) shows the list without the Post button,
// and Back to composer brings it back. The boot repainted the button just after the list
// hid it, and the repaint assigned className outright, which wiped the `hidden`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

test('the Post button stays hidden over Saved drafts opened in a new tab', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html#drafts`);
    for (let i = 0; i < 60 && !(await tab.evaluate(`!!document.querySelector('.compose-editor') && !document.documentElement.classList.contains('compose-booting')`)); i++) await sleep(250);
    await sleep(800);
    const shown = `getComputedStyle(document.getElementById('compose-post')).display !== 'none'`;
    assert.equal(await tab.evaluate(`!document.getElementById('compose-drafts-pane').classList.contains('hidden')`), true, 'the list did not open');
    assert.equal(await tab.evaluate(shown), false, 'Post showed over Saved drafts');
    // Back to the composer: Post is back, and still the primary button.
    await tab.evaluate(`[...document.querySelectorAll('#compose-drafts-pane button')].find((b) => /back to composer/i.test(b.textContent)).click()`);
    await sleep(300);
    assert.equal(await tab.evaluate(shown), true, 'Post did not come back with the composer');
    assert.equal(await tab.evaluate(`document.getElementById('compose-post').classList.contains('primary')`), true);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
