'use strict';

// AN ARTICLE'S BODY WRITES LIKE A WORD PROCESSOR AND STAYS MARKDOWN. Real input in the real
// extension: the system clipboard and a real Cmd+V, real shortcut keys and Enter, and a real
// drop (Chrome), in the article body and the recipe form.
//
//   - formatted text pasted in keeps its formatting as markdown (headings, bold, italic,
//     links, lists, quotes); Google Docs' bold-by-style counts; Cmd+Shift+V pastes plain
//   - a code editor's copy, and a clipboard with nothing markdown can say, paste as text
//   - Cmd+B, Cmd+I and Cmd+K mark the selection, and Cmd+B again takes the marks off
//   - Enter continues a list or a quote, numbered on; Enter on an empty item ends the list
//   - one Cmd+Z takes back a paste
//   - a heading pasted into a recipe's notes becomes a bold line (Zap Cooking reads a
//     recipe by its ## headings), and a list pasted into Ingredients becomes its items

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const FIREFOX = process.env.SIDECAR_BROWSER === 'firefox';
const opts = { skip: CHROME ? false : 'no browser found', timeout: 240000 };

async function openTab(x, mode) {
  const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
  for (let i = 0; i < 60 && !(await tab.evaluate(`!!document.querySelector('.compose-editor') && !!window.SidecarLongform && !document.documentElement.classList.contains('compose-booting')`)); i++) await sleep(250);
  await sleep(500);
  await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === ${JSON.stringify(mode)}).click()`);
  await sleep(400);
  return tab;
}

function driver(tab) {
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
    focus: async (sel) => { await tab.evaluate(`(() => { const f = document.querySelector('${sel}'); f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); f.focus(); })()`); await sleep(100); },
    value: (sel) => tab.evaluate(`document.querySelector('${sel}').value`),
    selected: (sel) => tab.evaluate(`(() => { const f = document.querySelector('${sel}'); return f.value.slice(f.selectionStart, f.selectionEnd); })()`),
    type: async (s) => { await tab.type(s); await sleep(80); },
    enter: async () => { await key('Enter'); await sleep(80); },
    selectAll: async () => { await key('a', { meta: true, commands: ['selectAll'] }); await sleep(80); },
    cmd: async (k) => { await key(k, { meta: true }); await sleep(120); },
    undo: async () => { await key('z', { meta: true, commands: ['undo'] }); await sleep(150); },
    paste: async (clip) => { await setClipboard(clip); await key('v', { meta: true, commands: ['paste'] }); await sleep(250); },
    pastePlain: async (clip) => { await setClipboard(clip); await key('v', { meta: true, shift: true, commands: ['pasteAndMatchStyle'] }); await sleep(250); },
    drop: async (sel, { text, html }) => {
      // On the first line, right of the words: where a person lets go to add to them.
      const at = await tab.evaluate(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 20 }; })()`);
      const items = [];
      if (text !== undefined) items.push({ mimeType: 'text/plain', data: text });
      if (html !== undefined) items.push({ mimeType: 'text/html', data: html });
      for (const type of ['dragEnter', 'dragOver', 'drop']) await tab.cdp('Input.dispatchDragEvent', { type, x: at.x, y: at.y, data: { items, dragOperationsMask: 1 } });
      await sleep(250);
    },
  };
}

const RICH = '<h2>Title</h2><p>Some <b>bold</b> and <i>italic</i> with a <a href="https://example.com/x">link</a>.</p>'
  + '<ul><li>one</li><li>two</li></ul><blockquote><p>quoted</p></blockquote>';
const RICH_MD = '## Title\n\nSome **bold** and _italic_ with a [link](https://example.com/x).\n\n- one\n- two\n\n> quoted';
const DOCS = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700;">Big</span><span style="font-weight:400;"> deal</span></p></b>';
const CODE_TEXT = '  if (x) {\n    y();\n  }';
const CODE_HTML = '<div style="color: #d4d4d4; white-space: pre;"><div><span style="color: #c586c0; font-weight: bold;">  if</span> (x) {</div><div>    y();</div><div>  }</div></div>';

test('the article body takes formatting as markdown, and writes like a word processor', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  const fails = [];
  const check = (name, got, want) => { if (got !== want) fails.push([name, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`]); };
  const BODY = '.lf-body';
  try {
    await x.reload();
    const tab = await openTab(x, 'Article');
    const d = driver(tab);

    await d.focus(BODY); await d.paste({ text: 'Title Some bold…', html: RICH });
    check('rich paste', await d.value(BODY), RICH_MD);
    await d.undo();
    check('one undo takes the paste back', await d.value(BODY), '');

    await d.focus(BODY); await d.paste({ text: 'Big deal', html: DOCS });
    check('Google Docs bold', await d.value(BODY), '**Big** deal');

    await d.focus(BODY); await d.pastePlain({ text: 'plain words', html: '<b>plain</b> words' });
    check('Cmd+Shift+V pastes plain', await d.value(BODY), 'plain words');

    await d.focus(BODY); await d.paste({ text: CODE_TEXT, html: CODE_HTML });
    check('a code editor’s copy keeps its spacing', await d.value(BODY), CODE_TEXT);

    await d.focus(BODY); await d.paste({ html: '<p>only</p><p>words</p>' });
    check('an HTML-only clipboard with no formatting', await d.value(BODY), 'only\nwords');

    await d.focus(BODY); await d.type('make this bold'); await d.selectAll(); await d.cmd('b');
    check('Cmd+B', await d.value(BODY), '**make this bold**');
    check('Cmd+B keeps the words selected', await d.selected(BODY), 'make this bold');
    await d.cmd('b');
    check('Cmd+B again takes it off', await d.value(BODY), 'make this bold');
    await d.cmd('i');
    check('Cmd+I', await d.value(BODY), '_make this bold_');

    await d.focus(BODY); await d.type('site'); await d.selectAll(); await d.cmd('k');
    check('Cmd+K selects the address to type over', await d.selected(BODY), 'https://');
    await d.type('https://a.example');
    check('Cmd+K makes a link', await d.value(BODY), '[site](https://a.example)');

    await d.focus(BODY); await d.type('- milk'); await d.enter(); await d.type('eggs'); await d.enter(); await d.enter(); await d.type('done');
    check('a list continues, and an empty item ends it', await d.value(BODY), '- milk\n- eggs\ndone');

    await d.focus(BODY); await d.type('9. a'); await d.enter(); await d.type('b');
    check('a numbered list numbers on', await d.value(BODY), '9. a\n10. b');

    await d.focus(BODY); await d.type('> q'); await d.enter(); await d.type('r');
    check('a quote continues', await d.value(BODY), '> q\n> r');

    await d.focus(BODY); await d.type('a '); await d.paste({ text: 'Heading', html: '<h3>Heading</h3>' });
    check('a pasted heading starts its own line', await d.value(BODY), 'a \n### Heading');

    if (!FIREFOX) {
      await d.focus(BODY); await d.type('a '); await d.drop(BODY, { text: 'bold', html: '<b style="color:red">bold</b>' });
      check('formatted text dropped in', await d.value(BODY), 'a **bold**');
    }
  } finally { x.close(); }
  assert.deepEqual(fails, []);
  assert.deepEqual(x.errors, []);
});

test('the recipe form: no headings in the notes, and a pasted list becomes items', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  const fails = [];
  const check = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push([name, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`]); };
  try {
    await x.reload();
    const tab = await openTab(x, 'Recipe');
    const d = driver(tab);

    await d.focus('.lf-notes'); await d.paste({ text: 'Tip Use cold butter', html: '<h2>Tip</h2><p>Use <b>cold</b> butter</p>' });
    check('a heading in the notes is a bold line', await d.value('.lf-notes'), '**Tip**\n\nUse **cold** butter');

    await tab.evaluate(`document.querySelector('.lf-recipe .lf-list-input').focus()`);
    await d.paste({ text: '1. 2 cups flour\n2. 1.5 tsp salt\n\n• 3 eggs\nStep 4: rest 350: no' });
    const items = await tab.evaluate(`[...document.querySelector('.lf-recipe .lf-list').querySelectorAll('.lf-list-text')].map((e) => e.textContent)`);
    check('a pasted list becomes items', items, ['2 cups flour', '1.5 tsp salt', '3 eggs', 'rest 350: no']);

    // EDITING AN ITEM IN PLACE, as Zap Cooking's own form allows: real clicks, real keys.
    const LIST = `document.querySelector('.lf-recipe .lf-list')`;
    const read = () => tab.evaluate(`[...${LIST}.children].map((li) => { const b = li.querySelector('.lf-list-edit'); return b ? '[' + b.value + ']' : li.querySelector('.lf-list-text').textContent; })`);
    const click = async (sel, i) => {
      const at = await tab.evaluate(`(() => { const el = ${LIST}.children[${i}].querySelector('${sel}'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 20), y: r.top + r.height / 2 }; })()`);
      await tab.clickAt(at.x, at.y); await sleep(150);
    };
    const key = async (k, o) => { await tab.press(k, o); await sleep(120); };

    await click('.lf-list-edit-btn', 0);
    check('the pencil opens the item in a box', await read(), ['[2 cups flour]', '1.5 tsp salt', '3 eggs', 'rest 350: no']);
    await d.selectAll(); await d.type('3 cups flour'); await key('Enter');
    check('Enter keeps the change', await read(), ['3 cups flour', '1.5 tsp salt', '3 eggs', 'rest 350: no']);

    await click('.lf-list-text', 1); await d.type(' fine'); await key('Escape');
    check('a click on the words opens it, and Escape takes the change back', await read(), ['3 cups flour', '1.5 tsp salt', '3 eggs', 'rest 350: no']);

    await click('.lf-list-text', 2); await d.selectAll(); await key('Backspace', { commands: ['deleteBackward'] }); await key('Enter');
    check('an emptied box keeps the old words', await read(), ['3 cups flour', '1.5 tsp salt', '3 eggs', 'rest 350: no']);

    await click('.lf-list-text', 2); await d.type(' beaten'); await click('button[title="Move up"]', 2);
    check('Move up while editing keeps the words and the box', await read(), ['3 cups flour', '[3 eggs beaten]', '1.5 tsp salt', 'rest 350: no']);
    await key('Enter');

    await click('.lf-list-text', 0); await d.type('!');
    await tab.evaluate(`document.querySelector('.lf-recipe .lf-title').focus()`); await sleep(150);
    check('leaving the box keeps the change', await read(), ['3 cups flour!', '3 eggs beaten', '1.5 tsp salt', 'rest 350: no']);

    await click('.lf-list-text', 3); await d.paste({ text: 'a\nb' });
    check('a list pasted into an item becomes items there', await read(), ['3 cups flour!', '3 eggs beaten', '1.5 tsp salt', 'rest 350: no a', 'b']);
  } finally { x.close(); }
  assert.deepEqual(fails, []);
  assert.deepEqual(x.errors, []);
});

// A RECIPE HAS A PREVIEW, as an article does: the review window's drawing of it, from the
// markdown that is published, so the headings, the details, the lists and the source link
// show as Zap Cooking will be sent them. Write brings the fields back as they were.
test('the recipe form has Write | Preview, drawn from what is published', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openTab(x, 'Recipe');
    const tabBtn = (name) => tab.evaluate(`[...document.querySelectorAll('.lf-recipe .lf-body-tabs .compose-tab')].find((b) => b.textContent.trim() === ${JSON.stringify(name)}).click()`);

    await tabBtn('Preview'); await sleep(150);
    assert.equal(await tab.evaluate(`document.querySelector('.lf-recipe-preview').textContent.trim()`), 'Nothing to preview yet.');

    await tabBtn('Write'); await sleep(150);
    await tab.evaluate(`(() => {
      const set = (sel, v) => { const f = document.querySelector(sel); f.value = v; f.dispatchEvent(new Event('input', { bubbles: true })); };
      set('.lf-recipe .lf-title', 'Pumpkin bread');
      set('.lf-recipe .lf-summary', 'Moist and spiced');
      set('.lf-recipe .lf-details input', '20 min');
      set('.lf-recipe .lf-notes', 'Use **cold** butter');
      const lists = document.querySelectorAll('.lf-recipe .lf-list-input');
      for (const [i, v] of [[0, '2 cups flour'], [0, '1 tsp salt'], [1, 'Mix'], [1, 'Bake']]) { lists[i].value = v; lists[i].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); }
      const src = [...document.querySelectorAll('.lf-recipe input[type=url]')].pop(); /* Source, after the photos' address box */ src.value = 'https://example.com/bread'; src.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await tabBtn('Preview'); await sleep(150);
    const seen = await tab.evaluate(`(() => { const p = document.querySelector('.lf-recipe-preview');
      return { fieldsShown: !!document.querySelector('.lf-recipe .lf-title').offsetParent, previewShown: !!p.offsetParent,
        h1: (p.querySelector('h1') || {}).textContent, summary: (p.querySelector('.lf-review-summary') || {}).textContent,
        h2: [...p.querySelectorAll('h2')].map((e) => e.textContent), lis: [...p.querySelectorAll('li')].map((e) => e.textContent),
        strong: [...p.querySelectorAll('strong')].map((e) => e.textContent), link: (p.querySelector('a[href="https://example.com/bread"]') || {}).textContent }; })()`);
    assert.deepEqual(seen, {
      fieldsShown: false, previewShown: true, h1: 'Pumpkin bread', summary: 'Moist and spiced',
      h2: ["Chef's notes", 'Details', 'Ingredients', 'Directions', 'Additional Resources'],
      lis: ['⏲️ Prep time: 20 min', '2 cups flour', '1 tsp salt', 'Mix', 'Bake'],
      strong: ['cold'], link: 'https://example.com/bread',
    });

    await tabBtn('Write'); await sleep(150);
    assert.equal(await tab.evaluate(`!!document.querySelector('.lf-recipe .lf-title').offsetParent && document.querySelector('.lf-recipe .lf-title').value`), 'Pumpkin bread', 'Write brings the fields back');
  } finally { x.close(); }
  assert.deepEqual(x.errors, []);
});
