'use strict';

// AN EMPTY FIELD GOES THE PAGE'S WAY. Every field people write in has dir="auto", so what they
// type sets its own direction; with nothing typed, auto reads as left-to-right, and in Arabic,
// Hebrew, Persian or Urdu the placeholder and the caret sat at the left of the note editor and
// of every article and recipe field. Measured in the full-size composer, in Arabic and English.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no browser found', timeout: 180000 };

// Where the caret stands in the note editor, and which way the editor and its placeholder go.
const editorState = `(() => { const ed = document.querySelector('.compose-editor'); ed.focus();
  const b = ed.getBoundingClientRect(); const r = getSelection().getRangeAt(0).cloneRange();
  const mk = document.createElement('span'); mk.textContent = '\\u200b'; r.insertNode(mk); const c = mk.getBoundingClientRect(); mk.remove();
  return { dir: getComputedStyle(ed).direction, placeholder: getComputedStyle(ed, '::before').direction,
    caretAtRight: b.right - c.left < c.left - b.left }; })()`;
const clear = `(() => { const ed = document.querySelector('.compose-editor'); ed.focus(); document.execCommand('selectAll'); document.execCommand('delete'); })()`;
const fields = `[...document.querySelectorAll('input[dir=auto], textarea[dir=auto]')].filter((e) => e.offsetParent && e.placeholder)
  .map((e) => ({ name: e.className || e.placeholder, dir: getComputedStyle(e).direction }))`;

for (const [language, way] of [['ar', 'rtl'], ['en', 'ltr']]) {
  test(`in ${language}, empty fields go ${way}, and what is typed decides after that`, opts, async (t) => {
    let x;
    try { x = await startExtension({ settings: { language } }); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
    try {
      const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
      for (let i = 0; i < 60 && !(await tab.evaluate(`!!document.querySelector('.compose-editor') && !document.documentElement.classList.contains('compose-booting')`)); i++) await sleep(250);
      await sleep(600);
      const empty = await tab.evaluate(editorState);
      assert.deepEqual(empty, { dir: way, placeholder: way, caretAtRight: way === 'rtl' }, 'the empty note editor');
      await tab.type('hello'); await sleep(100);
      assert.equal((await tab.evaluate(editorState)).dir, 'ltr', 'English typed goes left to right');
      await tab.evaluate(clear); await tab.type('مرحبا'); await sleep(100);
      assert.equal((await tab.evaluate(editorState)).dir, 'rtl', 'Arabic typed goes right to left');
      await tab.evaluate(clear); await sleep(100);
      assert.equal((await tab.evaluate(editorState)).dir, way, 'cleared, it goes the page\'s way again');

      for (const [name, index] of [['article', 2], ['recipe', 3]]) {
        await tab.evaluate(`document.querySelectorAll('.compose-mode')[${index}].click()`); await sleep(800);
        const got = await tab.evaluate(fields);
        assert.ok(got.length >= 2, `${name}: found its fields`);
        for (const f of got) assert.equal(f.dir, way, `${name}: the empty field ${f.name}`);
      }
      // Typed into, a field takes the direction of its text.
      await tab.evaluate(`(() => { const vis = [...document.querySelectorAll('.lf-title')].find((x) => x.offsetParent); vis.focus(); })()`);
      await tab.type('Pumpkin bread'); await sleep(100);
      assert.equal(await tab.evaluate(`getComputedStyle([...document.querySelectorAll('.lf-title')].find((x) => x.offsetParent)).direction`), 'ltr');
      assert.deepEqual(x.errors, []);
    } finally { x.close(); }
  });
}
