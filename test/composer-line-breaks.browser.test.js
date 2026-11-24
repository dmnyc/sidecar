'use strict';

// WHAT IS PUBLISHED HAS THE LINES THE EDITOR SHOWS. A reply written as two lines with a blank
// line between them went out with the blank line gone. Chrome had left the last line as bare
// text after the blocks above it (`<div>Cheers</div><div><br></div>My clankers`), which it
// draws on a line of its own, and serializeEditor read it as more of the block before it.
// An empty block inside another (`<div><div><br></div></div>`), which the panel's editor makes,
// was read as one line more than it shows. A fuzz of real key presses found both: it compared
// the lines serializeEditor writes with the lines the editor draws.
//
// Each case is checked against the editor itself: its drawn height in lines must equal the
// number of lines serializeEditor writes, so the expectation is what a person sees.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no browser found', timeout: 180000 };

// [name, editor HTML as Chrome left it, the text it must publish]
const SHAPES = [
  ['a line typed after the blocks above it', '<div>Cheers 🍻🫂</div><div><br></div>My clankers', 'Cheers 🍻🫂\n\nMy clankers'],
  ['bare text after one block', '<div>one</div>two', 'one\ntwo'],
  ['a break after a block', '<div>one</div><br>two', 'one\n\ntwo'],
  ['an empty block inside a block', 'one<div><div><br></div></div>', 'one\n'],
  ['text, then blocks (unchanged)', 'one<div><br></div><div>two</div>', 'one\n\ntwo'],
  ['breaks only (unchanged)', 'one<br><br>two', 'one\n\ntwo'],
];

// Key presses that leave a line as bare text after a block, as the reply was written:
// the second line first, then the first line typed above it.
const KEYS = [['type', 'My clankers'], ['key', 'ArrowLeft', { meta: true, commands: ['moveToBeginningOfLine'] }],
  ['key', 'Enter'], ['key', 'Enter'], ['key', 'ArrowUp'], ['key', 'ArrowUp'], ['type', 'Cheers 🍻🫂']];

const measure = (ED) => `(() => {
  const ed = document.querySelector('${ED}'); const cs = getComputedStyle(ed);
  ed.style.minHeight = '0'; ed.style.height = 'auto'; ed.style.maxHeight = 'none';
  const h = ed.scrollHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  ed.style.minHeight = ''; ed.style.height = ''; ed.style.maxHeight = '';
  return { text: SidecarCore.serializeEditor(ed), drawn: Math.round(h / parseFloat(cs.lineHeight)), html: ed.innerHTML };
})()`;

for (const PAGE of ['compose', 'panel']) {
  const ED = PAGE === 'panel' ? '#modal .compose-editor' : '.compose-editor';
  test(`the ${PAGE === 'panel' ? 'panel' : 'full-size'} composer publishes the lines it shows`, opts, async (t) => {
    let x;
    try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
    const fails = [];
    try {
      const tab = await x.openPage(`chrome-extension://${x.extId}/${PAGE === 'panel' ? 'sidepanel' : 'compose'}.html`);
      if (PAGE === 'panel') {
        await tab.viewport({ width: 380, height: 820, scale: 1 });
        for (let i = 0; i < 40 && !(await tab.evaluate(`!!document.getElementById('compose-fab')`)); i++) await sleep(250);
        await sleep(800);
        await tab.evaluate(`document.getElementById('compose-fab').click()`); await sleep(400);
        await tab.evaluate(`document.getElementById('compose-note-btn').click()`); await sleep(800);
      }
      for (let i = 0; i < 60 && !(await tab.evaluate(`!!document.querySelector('${ED}') && !document.documentElement.classList.contains('compose-booting')`)); i++) await sleep(250);
      await sleep(600);
      for (const [name, html, want] of SHAPES) {
        await tab.evaluate(`document.querySelector('${ED}').innerHTML = ${JSON.stringify(html)}`);
        const got = await tab.evaluate(measure(ED));
        if (got.text !== want) fails.push(`${name}: published ${JSON.stringify(got.text)}, not ${JSON.stringify(want)}`);
        if (got.drawn !== want.split('\n').length) fails.push(`${name}: the editor draws ${got.drawn} lines, the case expects ${want.split('\n').length}`);
      }
      await tab.evaluate(`(() => { const ed = document.querySelector('${ED}'); ed.innerHTML = ''; ed.focus(); ed.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      for (const st of KEYS) { if (st[0] === 'key') await tab.press(st[1], st[2] || {}); else await tab.type(st[1]); await sleep(90); }
      await sleep(150);
      const typed = await tab.evaluate(measure(ED));
      if (typed.text !== 'Cheers 🍻🫂\n\nMy clankers') fails.push(`typed: published ${JSON.stringify(typed.text)} from ${typed.html}`);
      if (typed.drawn !== 3) fails.push(`typed: the editor draws ${typed.drawn} lines (${typed.html})`);
      assert.deepEqual(fails, []);
      assert.deepEqual(x.errors, []);
    } finally { x.close(); }
  });
}
