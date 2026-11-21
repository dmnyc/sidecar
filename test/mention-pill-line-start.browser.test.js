'use strict';

// A mention pill that starts a line, in the real extension, with real key presses: the caret
// can stand in front of it, and Backspace there or Delete at the end of the line above joins
// the two lines and keeps the pill. Before the fix Chrome had no caret position in front of
// the pill: Backspace took a letter of the line above, Delete took the line break and the
// pill with it, and the left arrow jumped over both.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

// The editor as a saved draft comes back into it: a line, a break, a pill, its space.
const BUILD = `(() => {
  const ed = document.querySelector('.compose-editor');
  ed.innerHTML = '';
  ed.append(document.createTextNode('If your media uploads hit'), document.createElement('br'));
  const pill = document.createElement('span');
  pill.className = 'mention-pill'; pill.contentEditable = 'false';
  pill.dataset.bech32 = 'nostr:npub1example'; pill.textContent = '@nostr.build';
  ed.append(pill, document.createTextNode('\\u00a0'));
  ed.focus();
  ed.dispatchEvent(new Event('input', { bubbles: true }));
})()`;
// What a person sees: the anchor is invisible, so it is left out.
const SHOWN = `document.querySelector('.compose-editor').innerHTML.replace(/\\u200B/g, '').replace(/<span[^>]*>/g, '<pill>').replace(/<\\/span>/g, '</pill>')`;
const caret = (tab, expr) => tab.evaluate(`(() => { const ed = document.querySelector('.compose-editor'); const r = document.createRange(); ${expr}; r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
const JOINED = 'If your media uploads hit<pill>@nostr.build</pill>&nbsp;';

async function openCompose(x) {
  const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
  for (let i = 0; i < 60 && !(await tab.evaluate(`!!document.querySelector('.compose-editor') && !document.documentElement.classList.contains('compose-booting')`)); i++) await sleep(250);
  await sleep(500);
  return tab;
}

test('a pill that starts a line can be joined to the line above, and is kept', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openCompose(x);

    // The left arrow from after the pill stops in front of it, on its line.
    await tab.evaluate(BUILD);
    await caret(tab, `r.setStart(ed.lastChild, 0)`);
    await tab.press('ArrowLeft');
    await sleep(100);
    assert.equal(await tab.evaluate(`(() => { const r = getSelection().getRangeAt(0); const ed = document.querySelector('.compose-editor'); return r.startContainer.previousSibling === ed.querySelector('br') || r.startContainer === ed.querySelector('br').nextSibling; })()`), true,
      'the caret could not stand in front of the pill');
    // Backspace there joins the lines.
    await tab.press('Backspace');
    await sleep(150);
    assert.equal(await tab.evaluate(SHOWN), JOINED, 'Backspace in front of the pill');

    // Delete at the end of the line above does the same, and keeps the pill.
    await tab.evaluate(BUILD);
    await caret(tab, `r.setStart(ed.firstChild, ed.firstChild.length)`);
    await tab.press('Delete');
    await sleep(150);
    assert.equal(await tab.evaluate(SHOWN), JOINED, 'Delete at the end of the line above');

    // Typing in front of the pill writes there, and the anchor never reaches the saved text.
    await tab.evaluate(BUILD);
    await caret(tab, `r.setStart(ed.childNodes[2], ed.childNodes[2].length)`);
    await tab.evaluate(`document.execCommand('insertText', false, 'Hi ')`);
    await sleep(700);
    assert.equal(await tab.evaluate(SHOWN), 'If your media uploads hit<br>Hi <pill>@nostr.build</pill>&nbsp;');
    const saved = await x.message({ type: 'SIDECAR_SECRET_GET', store: 'drafts' }).catch(() => null);
    assert.ok(!JSON.stringify(saved || {}).includes('\\u200b') && !JSON.stringify(saved || {}).includes('​'), 'the anchor was saved with the draft');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
