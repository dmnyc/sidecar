'use strict';

// The Explore and Share links and On this day sit at the foot of the panel when there is
// room, as a footer, clear of the compose button; without room they stay where they were,
// 24px below the accounts. Measured in the side panel at its width, tall and short.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no browser found', timeout: 180000 };

const measure = `(() => {
  const c = document.querySelector('#view-main .content');
  c.scrollTop = c.scrollHeight;
  const R = (el) => el.getBoundingClientRect();
  const wrap = document.querySelector('.explore-link-wrap');
  const links = R(wrap.querySelector('.explore-link'));
  const otd = document.getElementById('otd');
  // The last thing in the group: On this day when it shows, the links when it does not.
  const last = otd.classList.contains('hidden') ? R(wrap) : R(otd);
  const above = wrap.previousElementSibling; // the last of the accounts block
  let prev = above; while (prev && prev.offsetParent === null) prev = prev.previousElementSibling;
  const fab = R(document.querySelector('#view-main .fab'));
  return {
    scrolls: c.scrollHeight > c.clientHeight + 1,
    fromBottom: Math.round(c.getBoundingClientRect().bottom - last.bottom),
    belowAccounts: Math.round(links.top - R(prev).bottom),
    clearOfFab: last.bottom <= fab.top || R(otd).right <= fab.left,
  };
})()`;

test('with room, the links and On this day sit at the foot of the panel; without, below the accounts', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    const p = await x.openPage(`chrome-extension://${x.extId}/sidepanel.html`);
    await p.viewport({ width: 360, height: 560, scale: 1 }); await sleep(2500);
    const short = await p.evaluate(measure);
    assert.equal(short.scrolls, true, 'the short panel is meant to scroll');
    const reserve = short.fromBottom; // what the panel keeps free under its last item

    await p.viewport({ width: 360, height: 1200, scale: 1 }); await sleep(800);
    const tall = await p.evaluate(measure);
    assert.equal(tall.scrolls, false);
    assert.equal(tall.fromBottom, reserve, `on a tall panel the group ends ${tall.fromBottom}px from the bottom, not at the foot (${reserve}px)`);
    assert.ok(tall.belowAccounts > 24, 'the free space is above the group');
    assert.equal(tall.clearOfFab, true, 'the compose button covers the group');

    // Short again: the free space is gone, and the links keep their 24px from what is above.
    await p.viewport({ width: 360, height: 560, scale: 1 }); await sleep(800);
    const again = await p.evaluate(`(() => { document.querySelector('#view-main .content').scrollTop = 0; return ${measure}; })()`);
    assert.ok(Math.abs(again.belowAccounts - short.belowAccounts) <= 1);
    assert.equal(again.clearOfFab, true);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
