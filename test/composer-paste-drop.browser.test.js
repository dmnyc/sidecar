'use strict';

// PASTE AND DROP ARE TEXT, IN EVERY EDITOR. Real input in the real extension: the system
// clipboard and a real Cmd+V, a real drag and drop (Chrome), in both composers and in the
// shared editor as the page-comment box and stream chat use it (no attachment hooks).
//
// What this guards, each seen failing before the fix:
//   - rich text dropped in kept its bold and colors, and a picture in it sat inline,
//     never uploaded and never published
//   - a clipboard holding only HTML pasted nothing
//   - a Windows line ending left a stray \r in the note (Firefox)
//   - Select All, Delete, then Undo brought nothing back (Firefox)
//   - lines copied with a blank one between them came back with an extra line (Firefox)
//   - the page-comment box took rich paste as it came

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const FIREFOX = process.env.SIDECAR_BROWSER === 'firefox';
const opts = { skip: CHROME ? false : 'no browser found', timeout: 240000 };

const SURFACES = ['compose', 'panel', 'bare'];

async function open(x, surface) {
  const page = surface === 'compose' ? 'compose' : 'sidepanel';
  const tab = await x.openPage(`chrome-extension://${x.extId}/${page}.html`);
  const ED = surface === 'panel' ? '#modal .compose-editor' : surface === 'bare' ? '#__bare .compose-editor' : '.compose-editor';
  if (surface !== 'compose') {
    await tab.viewport({ width: 380, height: 820, scale: 1 });
    for (let i = 0; i < 40 && !(await tab.evaluate(`!!document.getElementById('compose-fab') && !!window.SidecarStreamChatAccount`)); i++) await sleep(250);
    await sleep(800);
  }
  if (surface === 'panel') {
    await tab.evaluate(`document.getElementById('compose-fab').click()`); await sleep(400);
    await tab.evaluate(`document.getElementById('compose-note-btn').click()`); await sleep(800);
    await tab.evaluate(`(() => { const b = [...document.querySelectorAll('#modal button')].find((b) => b.textContent.trim() === 'Start fresh'); if (b) b.click(); })()`);
  }
  if (surface === 'bare') {
    await tab.evaluate(`(() => { const box = document.createElement('div'); box.id = '__bare';
      box.style.cssText = 'position:fixed;left:10px;top:10px;width:340px;z-index:99999;background:#fff';
      box.append(window.SidecarStreamChatAccount.createMentionEditor({ placeholder: 'Write a comment' }).wrap);
      document.body.appendChild(box); })()`);
  }
  for (let i = 0; i < 60 && !(await tab.evaluate(`!!document.querySelector('${ED}') && !document.documentElement.classList.contains('compose-booting')`)); i++) await sleep(250);
  await sleep(500);

  const setClipboard = async ({ text, html }) => {
    if (FIREFOX) {
      await tab.browserEval(`(() => { const t = Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable); t.init(null);
        const add = (f, d) => { t.addDataFlavor(f); const s = Cc['@mozilla.org/supports-string;1'].createInstance(Ci.nsISupportsString); s.data = d; t.setTransferData(f, s); };
        ${html !== undefined ? `add('text/html', ${JSON.stringify(html)});` : ''}${text !== undefined ? `add('text/plain', ${JSON.stringify(text)});` : ''}
        Services.clipboard.setData(t, null, Ci.nsIClipboard.kGlobalClipboard); return true; })()`);
      return;
    }
    const items = [];
    if (html !== undefined) items.push(`'text/html': new Blob([${JSON.stringify(html)}], { type: 'text/html' })`);
    if (text !== undefined) items.push(`'text/plain': new Blob([${JSON.stringify(text)}], { type: 'text/plain' })`);
    const r = await tab.evaluate(`(async () => { try { await navigator.clipboard.write([new ClipboardItem({ ${items.join(', ')} })]); return 'ok'; } catch (e) { return e.message; } })()`);
    assert.equal(r, 'ok', 'clipboard write');
  };
  const key = (k, o) => tab.press(k, o);
  return {
    tab,
    reset: async () => { await tab.evaluate(`(() => { const ed = document.querySelector('${ED}'); ed.innerHTML = ''; ed.focus(); ed.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(100); },
    type: async (s) => { await tab.type(s); await sleep(80); },
    enter: async () => { await key('Enter'); await sleep(80); },
    selectAll: async () => { await key('a', { meta: true, commands: ['selectAll'] }); await sleep(80); },
    del: async () => { await key('Delete', { commands: ['deleteForward'] }); await sleep(80); },
    right: async () => { await key('ArrowRight', { commands: ['moveRight'] }); await sleep(80); },
    undo: async () => { await key('z', { meta: true, commands: ['undo'] }); await sleep(150); },
    copy: async () => { await key('c', { meta: true, commands: ['copy'] }); await sleep(150); },
    paste: async (clip) => { if (clip) await setClipboard(clip); await key('v', { meta: true, commands: ['paste'] }); await sleep(250); },
    drop: async ({ text, html }) => {
      // Just past the end of the text, where a person lets go to add to it.
      const at = await tab.evaluate(`(() => { const ed = document.querySelector('${ED}'); const r = document.createRange(); r.selectNodeContents(ed);
        const rects = [...r.getClientRects()]; const box = ed.getBoundingClientRect(); const last = rects[rects.length - 1] || box;
        return { x: Math.min(last.right + 3, box.right - 4), y: last.top + Math.max(last.height, 10) / 2 }; })()`);
      const items = [];
      if (text !== undefined) items.push({ mimeType: 'text/plain', data: text });
      if (html !== undefined) items.push({ mimeType: 'text/html', data: html });
      for (const type of ['dragEnter', 'dragOver', 'drop']) await tab.cdp('Input.dispatchDragEvent', { type, x: at.x, y: at.y, data: { items, dragOperationsMask: 1 } });
      await sleep(250);
    },
    read: () => tab.evaluate(`(() => { const ed = document.querySelector('${ED}');
      const extra = [...ed.querySelectorAll('*')].filter((el) => !el.closest('[data-bech32]') && (!/^(DIV|P|BR|SPAN)$/.test(el.nodeName) || [...el.attributes].some((a) => a.name !== 'dir')));
      return { text: SidecarCore.serializeEditor(ed), formatting: extra.map((el) => el.nodeName.toLowerCase()) }; })()`),
  };
}

for (const surface of SURFACES) {
  test(`paste and drop come in as plain text (${surface})`, opts, async (t) => {
    let x;
    try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
    const fails = [];
    const check = (name, got, text) => {
      if (got.text !== text || got.formatting.length) fails.push([name, `expected ${JSON.stringify(text)}, got ${JSON.stringify(got.text)}${got.formatting.length ? ' with ' + got.formatting.join(',') : ''}`]);
    };
    try {
      await x.reload();
      const ed = await open(x, surface);

      await ed.reset(); await ed.paste({ text: 'bold and red', html: '<b style="color:red">bold</b> and <span style="color:red">red</span>' });
      check('rich paste', await ed.read(), 'bold and red');

      await ed.reset(); await ed.paste({ html: '<p>only</p><p>html</p>' });
      // Two paragraphs keep the blank line between them (editor-matrix: rich-html-only-paragraphs).
      check('a clipboard with only HTML', await ed.read(), 'only\n\nhtml');

      await ed.reset(); await ed.paste({ text: 'one\r\ntwo' });
      check('Windows line endings', await ed.read(), 'one\ntwo');

      await ed.reset(); await ed.type('hello'); await ed.selectAll(); await ed.del(); await ed.undo();
      check('Select All, Delete, Undo', await ed.read(), 'hello');

      await ed.reset(); await ed.type('ab'); await ed.enter(); await ed.enter(); await ed.type('cd');
      await ed.selectAll(); await ed.copy(); await ed.right(); await ed.enter(); await ed.paste();
      check('copy lines with a blank one, paste them back', await ed.read(), 'ab\n\ncd\nab\n\ncd');

      if (!FIREFOX) {
        await ed.reset(); await ed.type('a '); await ed.drop({ text: 'bold', html: '<b style="color:red">bold</b>' });
        check('rich text dropped in', await ed.read(), 'a bold');

        await ed.reset(); await ed.type('a'); await ed.drop({ text: '', html: '<img src="https://example.com/x.png">' });
        check('a picture dropped in from a page', await ed.read(), 'a');
      }
    } finally { x.close(); }
    assert.deepEqual(fails, []);
    assert.deepEqual(x.errors, []);
  });
}
