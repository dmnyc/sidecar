'use strict';

// The "Add anyway?" row under the relay input is hidden until a dead relay fails the add-time
// probe. Its own display: flex outranks the browser's rule for [hidden], so for a while it sat
// open under the input with no question in it and two buttons showing. Run against the real
// extension, because only a browser can say what is actually drawn.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

test('the Add anyway row takes no room in Relays until a relay fails the probe', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    await x.evaluate(`document.querySelector('.tab[data-tab=profile]').click()`);
    await x.waitFor(`!!document.querySelector('.nip65-setting .relay-add-confirm')`, 15000);
    const shown = await x.evaluate(`[...document.querySelectorAll('.nip65-setting [hidden]')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.className)`);
    assert.deepEqual(shown, [], 'an element marked hidden is drawn in Relays');
  } finally { x.close(); }
});
