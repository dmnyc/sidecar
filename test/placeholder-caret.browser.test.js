'use strict';

// Type something, delete it all, and the caret goes back to the first line, on the
// placeholder's first letter, as in a composer never typed in. It went a line lower: the
// browser keeps a <br> to hold the emptied line open (on purpose, see syncEmptyClass), and
// the placeholder, drawn in the flow, took the first line itself and pushed the <br>'s line,
// and the caret, below it. Measured in the full-size composer and the panel's.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

// How far below the editor's first line the caret's line starts, in pixels: a zero-width
// mark at the caret, measured and removed.
const caretLine = (sel) => `(() => {
  const ed = document.querySelector(${JSON.stringify(sel)});
  const r = getSelection().getRangeAt(0).cloneRange();
  const mark = document.createElement('span'); mark.textContent = '\\u200b';
  r.insertNode(mark); const c = mark.getBoundingClientRect(); mark.remove();
  return { below: Math.round(c.top - ed.getBoundingClientRect().top - parseFloat(getComputedStyle(ed).paddingTop)),
    empty: ed.classList.contains('is-empty'), html: ed.innerHTML };
})()`;

async function typeAndDelete(page, sel) {
  await page.evaluate(`(() => { const ed = document.querySelector(${JSON.stringify(sel)}); ed.focus(); document.execCommand('selectAll'); document.execCommand('delete'); })()`);
  await page.type('hello');
  for (let i = 0; i < 5; i++) await page.press('Backspace');
  await sleep(200);
  return page.evaluate(caretLine(sel));
}

test('after typing and deleting everything, the caret is back on the first line', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    const panel = await x.openPage(`chrome-extension://${x.extId}/sidepanel.html`);
    await sleep(3000);
    await panel.evaluate(`document.getElementById('compose-fab').click()`);
    await sleep(400);
    await panel.evaluate(`document.getElementById('compose-note-btn').click()`);
    await sleep(1200);
    await panel.evaluate(`(() => { const b = [...document.querySelectorAll('#modal button')].find((b) => b.textContent === 'Start fresh'); if (b) b.click(); })()`);
    const sheet = await typeAndDelete(panel, '#modal .compose-editor');
    assert.equal(sheet.empty, true);
    assert.ok(sheet.below < 10, `panel composer: the caret is ${sheet.below}px down, a line below the placeholder`);
    // The full-size composer second: while one is open, the panel hands writing to it.
    const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
    await sleep(2500);
    const full = await typeAndDelete(tab, '.compose-editor');
    assert.equal(full.empty, true, 'the emptied editor does not show its placeholder');
    assert.ok(full.below < 10, `full-size composer: the caret is ${full.below}px down, a line below the placeholder (${full.html})`);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
