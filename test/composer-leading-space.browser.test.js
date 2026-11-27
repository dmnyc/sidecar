'use strict';

// A NOTE MAY START WITH A SPACE OR A BLANK LINE while it is being written, as in any text
// editor. The composer tested its emptiness on the trimmed text and cleared itself when
// that was empty, so a space or Enter typed into an empty editor vanished as it was typed.
// Real keys in the real extension, in both composers; clearing the editor must still bring
// the placeholder back.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no browser found', timeout: 180000 };

const K = (k, o) => ['key', k, o];
const SHIFT_ENTER = K('Enter', { shift: true, commands: ['insertLineBreak'] });
const SELECT_ALL = K('a', { meta: true, commands: ['selectAll'] });
// [name, steps, what the editor holds as text afterwards, whether the placeholder shows]
const C = [
  ['a space, then a word', [['type', ' '], ['type', 'hi']], ' hi', false],
  ['a space on its own stays', [['type', ' ']], ' ', false],
  ['two spaces stay', [['type', ' '], ['type', ' ']], '  ', false],
  ['Enter, then a word', [K('Enter'), ['type', 'hi']], '\nhi', false],
  ['Enter twice, then a word', [K('Enter'), K('Enter'), ['type', 'hi']], '\n\nhi', false],
  ['Enter on its own stays', [K('Enter')], '\n', false],
  ['Shift+Enter, then a word', [SHIFT_ENTER, ['type', 'hi']], '\nhi', false],
  ['a space, then Backspace: empty again, the placeholder back', [['type', ' '], K('Backspace')], '', true],
  ['Enter, then Backspace: empty again, the placeholder back', [K('Enter'), K('Backspace')], '', true],
  ['words, select all, Delete: the placeholder back', [['type', 'hi there'], SELECT_ALL, K('Delete')], '', true],
  ['blank lines, select all, Delete: the placeholder back', [K('Enter'), K('Enter'), SELECT_ALL, K('Delete')], '', true],
];

for (const PAGE of ['compose', 'panel']) {
  const ED = PAGE === 'panel' ? '#modal .compose-editor' : '.compose-editor';
  test(`an empty ${PAGE === 'panel' ? 'panel' : 'full-size'} composer takes a space or a line break first`, opts, async (t) => {
    let x;
    try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
    const fails = [];
    try {
      await x.reload();
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
      for (const [name, steps, text, placeholder] of C) {
        await tab.evaluate(`(() => { const ed = document.querySelector('${ED}'); ed.innerHTML = ''; ed.focus(); ed.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await sleep(100);
        for (const st of steps) {
          if (st[0] === 'key') await tab.press(st[1], st[2] || {}); else await tab.type(st[1]);
          await sleep(90);
        }
        await sleep(150);
        // The editor's text as the composer reads it: what it saves and posts from.
        const got = await tab.evaluate(`(() => { const ed = document.querySelector('${ED}'); return { text: SidecarCore.serializeEditor(ed), placeholder: ed.classList.contains('is-empty'), focused: document.activeElement === ed }; })()`);
        if (got.text !== text || got.placeholder !== placeholder || !got.focused) {
          fails.push([name, `expected ${JSON.stringify(text)} placeholder=${placeholder}  got ${JSON.stringify(got.text)} placeholder=${got.placeholder} focused=${got.focused}`]);
        }
      }
      // A note started with a blank line, then written: what is saved keeps the blank line.
      await tab.evaluate(`(() => { const ed = document.querySelector('${ED}'); ed.innerHTML = ''; ed.focus(); ed.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await tab.press('Enter'); await sleep(90);
      await tab.type('saved after a blank line'); await sleep(200);
      let saved = '';
      for (let i = 0; i < 30 && !saved.includes('saved after'); i++) {
        await sleep(200);
        const all = (await x.message({ type: 'SIDECAR_SECRET_GET', store: 'drafts' })).result || {};
        saved = Object.values(all).map((d) => (d && d.text) || '').join('|');
      }
      if (saved !== '\nsaved after a blank line') fails.push(['the saved draft', 'got ' + JSON.stringify(saved)]);
    } finally { x.close(); }
    assert.deepEqual(fails, []);
    assert.deepEqual(x.errors, []);
  });
}

// And back: a draft saved with a leading space, leading blank lines, or a last empty line
// opens holding exactly that, and reads back the same.
test('a draft that starts with a space or blank lines, or ends on a new line, comes back as it was', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  const fails = [];
  try {
    await x.reload();
    const pk = (await x.message({ type: 'SIDECAR_GET_STATE' })).result.activePubkey;
    for (const text of ['\n\nstarts two lines down', ' starts with a space', 'ends on a new line\n', 'a\n\nb']) {
      await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [pk]: { text, media: [], savedAt: Date.now() } } });
      const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
      for (let i = 0; i < 60 && !(await tab.evaluate(`!!document.querySelector('.compose-editor') && !document.documentElement.classList.contains('compose-booting') && !!document.querySelector('.compose-editor').textContent`)); i++) await sleep(250);
      await sleep(300);
      const got = await tab.evaluate(`SidecarCore.serializeEditor(document.querySelector('.compose-editor'))`);
      if (got !== text) fails.push([JSON.stringify(text), 'came back as ' + JSON.stringify(got)]);
      await tab.close();
    }
  } finally { x.close(); }
  assert.deepEqual(fails, []);
});
