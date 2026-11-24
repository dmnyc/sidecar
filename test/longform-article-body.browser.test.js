'use strict';

// PICTURES IN AN ARTICLE'S BODY, AND THE WHOLE ARTICLE IN PREVIEW, in the real extension with
// real input. Pasting a picture into the body did nothing, and there was no way to describe
// a picture once it was in; Preview drew the body alone.
//
//   - a pasted picture puts `![Uploading name…]()` where it landed, as a paragraph of its own, and the
//     upload swaps it for `![](link)`, as GitHub does; a failed upload takes it away again
//   - the description row opens after the upload, and what is typed goes between the brackets
//   - a picture dropped from the desktop takes the same path (Chrome)
//   - Preview draws the whole article (title, summary, topics, body); a picture in it carries
//     + ALT, which opens its description row back in Write

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const FIREFOX = process.env.SIDECAR_BROWSER === 'firefox';
const opts = { skip: CHROME ? false : 'no browser found', timeout: 240000 };

// nostr.build answered here. `hold`: each upload waits for window.__release(); `fail`: refused.
const stubUploads = (mode) => `(() => {
  const real = window.fetch;
  window.__uploads = 0; window.__release = [];
  window.fetch = (url, init) => {
    if (!String(url).startsWith('https://nostr.build/api/v2/upload/')) return real(url, init);
    const n = ++window.__uploads;
    const answer = () => ${mode === 'fail'
    ? `new Response('nope', { status: 500 })`
    : `new Response(JSON.stringify({ data: [{ url: 'https://img.test/' + n + '.png' }] }), { status: 200 })`};
    if (${mode === 'hold' ? 'true' : 'false'}) return new Promise((r) => window.__release.push(() => r(answer())));
    return Promise.resolve(answer());
  };
})()`;

async function openArticle(x, mode) {
  const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
  for (let i = 0; i < 60 && !(await tab.evaluate(`!!window.SidecarLongform && !document.documentElement.classList.contains('compose-booting')`)); i++) await sleep(250);
  await sleep(500);
  await tab.evaluate(stubUploads(mode));
  await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Article').click()`);
  await sleep(300);
  return tab;
}
const body = (tab) => tab.evaluate(`document.querySelector('.lf-body').value`);
async function typeInBody(tab, text) {
  await tab.evaluate(`(() => { const b = document.querySelector('.lf-body'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); })()`);
  await tab.type(text); await sleep(100);
}
async function pastePicture(tab) {
  await tab.evaluate(`(async () => { const c = document.createElement('canvas'); c.width = c.height = 8; c.getContext('2d').fillRect(0, 0, 8, 8); window.__png = await new Promise((r) => c.toBlob(r, 'image/png')); })()`);
  if (FIREFOX) {
    // Firefox's clipboard is set from chrome scope; a picture is its own flavor.
    await tab.browserEval(`(() => {
      const t = Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable); t.init(null);
      const bytes = atob('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR42mNkYPhfz0AEYBxVSF8AAKb4CK2vdQV+AAAAAElFTkSuQmCC');
      const stream = Cc['@mozilla.org/io/string-input-stream;1'].createInstance(Ci.nsIStringInputStream); if (stream.setByteStringData) stream.setByteStringData(bytes); else stream.setData(bytes, bytes.length);
      t.addDataFlavor('image/png'); t.setTransferData('image/png', stream);
      Services.clipboard.setData(t, null, Ci.nsIClipboard.kGlobalClipboard); return true; })()`);
  } else {
    assert.equal(await tab.evaluate(`navigator.clipboard.write([new ClipboardItem({ 'image/png': window.__png })]).then(() => 'ok', (e) => e.message)`), 'ok');
  }
  await tab.evaluate(`document.querySelector('.lf-body').focus()`);
  await tab.press('v', { meta: true, commands: ['paste'] });
  await sleep(400);
}

test('a pasted picture uploads into the article body as GitHub does, then asks for its description', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openArticle(x, 'hold');
    await typeInBody(tab, 'Before');
    await pastePicture(tab);
    // While it uploads: a placeholder of its own line.
    assert.match(await body(tab), /^Before\n\n!\[Uploading [^\]]*…\]\(#upload-\d+\)\n\n$/);
    await tab.evaluate(`window.__release.forEach((r) => r())`);
    await sleep(400);
    assert.equal(await body(tab), 'Before\n\n![](https://img.test/1.png)\n\n');
    // The description row is open; what is typed there is the alt text.
    assert.equal(await tab.evaluate(`!!document.querySelector('.lf-article .compose-alt-row')`), true, 'no description row');
    await tab.evaluate(`(() => { const f = document.querySelector('.lf-article .compose-alt-text'); f.focus(); })()`);
    await tab.type('A black square');
    await sleep(900); // the row commits as it types, half a second behind
    assert.equal(await body(tab), 'Before\n\n![A black square](https://img.test/1.png)\n\n');
    assert.equal(await tab.evaluate(`SidecarLongform.state.article.body`), 'Before\n\n![A black square](https://img.test/1.png)\n\n');
  } finally { x.close(); }
  assert.deepEqual(x.errors, []);
});

test('a failed upload takes its placeholder away and says why', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openArticle(x, 'fail');
    await typeInBody(tab, 'Text');
    await pastePicture(tab);
    await sleep(600);
    assert.equal(await body(tab), 'Text', 'the placeholder, or the lines made for it, stayed');
    // The body's own error line (the cover picker above has one of its own).
    assert.match(await tab.evaluate(`document.querySelector('.lf-article .lf-body ~ .lf-img-err').textContent`), /Upload failed/);
  } finally { x.close(); }
});

// DevTools' drag cannot carry a file from the desktop in headless Chrome, so the drop is made in
// the page: a real File in a DataTransfer, to the field's own drop handler.
test('a picture dropped from the desktop takes the same path', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openArticle(x, 'now');
    await tab.evaluate(`(async () => {
      const c = document.createElement('canvas'); c.width = c.height = 8; c.getContext('2d').fillRect(0, 0, 8, 8);
      const png = await new Promise((r) => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([png], 'photo.png', { type: 'image/png' }));
      const b = document.querySelector('.lf-body'); const r = b.getBoundingClientRect();
      b.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 20 }));
    })()`);
    await sleep(800);
    assert.equal(await body(tab), '![](https://img.test/1.png)\n\n');
  } finally { x.close(); }
});

test('Preview draws the whole article, and + ALT on a picture opens its description', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openArticle(x, 'now');
    await tab.evaluate(`(() => {
      const set = (sel, v) => { const f = document.querySelector(sel); f.value = v; f.dispatchEvent(new Event('input', { bubbles: true })); };
      set('.lf-article .lf-title', 'On writing');
      set('.lf-article .lf-summary', 'A short piece');
      set('.lf-article .lf-body', 'Words first.\\n\\n![](https://img.test/9.png)\\n');
      const ti = document.querySelector('.lf-article .lf-chip-input'); ti.value = 'Nostr!'; ti.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    })()`);
    const tabs = `[...document.querySelectorAll('.lf-article .lf-body-tabs .compose-tab')]`;
    await tab.evaluate(`${tabs}.find((b) => b.textContent.trim() === 'Preview').click()`);
    await sleep(300);
    const seen = await tab.evaluate(`(() => { const p = document.querySelector('.lf-article-preview');
      return { fields: !!document.querySelector('.lf-article .lf-title').offsetParent, h1: (p.querySelector('h1') || {}).textContent,
        summary: (p.querySelector('.lf-review-summary') || {}).textContent, topics: [...p.querySelectorAll('.lf-review-tag')].map((e) => e.textContent),
        chip: (p.querySelector('.lf-preview-img .compose-thumb-alt') || {}).textContent }; })()`);
    assert.deepEqual(seen, { fields: false, h1: 'On writing', summary: 'A short piece', topics: ['#nostr'], chip: '+ ALT' });
    await tab.evaluate(`document.querySelector('.lf-preview-img .compose-thumb-alt').click()`);
    await sleep(300);
    assert.equal(await tab.evaluate(`!!document.querySelector('.lf-article .lf-body').offsetParent`), true, 'Write did not come back');
    assert.equal(await tab.evaluate(`!!document.querySelector('.lf-article .compose-alt-row')`), true, 'the description row did not open');
  } finally { x.close(); }
  assert.deepEqual(x.errors, []);
});

test('the cover in Preview shows its description chip, in the article and the recipe', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openArticle(x, 'now');
    const check = async (kind, sel, mode) => {
      await tab.evaluate(`(() => {
        const s = SidecarLongform.state.${kind};
        s.title = 'Covered'; s.${kind === 'article' ? 'cover' : 'photos'}.push({ url: 'https://img.test/cover.png', alt: 'A plate of food' });
        [...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === '${mode}').click();
      })()`);
      await sleep(300);
      await tab.evaluate(`[...document.querySelectorAll('${sel} .compose-tab')].find((b) => b.textContent.trim() === 'Preview').click()`);
      await sleep(300);
      assert.equal(await tab.evaluate(`(document.querySelector('${sel} .lf-preview .lf-preview-img .compose-thumb-alt') || {}).textContent`), '✓ ALT', `${kind}: no chip on the cover`);
      await tab.evaluate(`document.querySelector('${sel} .lf-preview .lf-preview-img .compose-thumb-alt').click()`);
      await sleep(300);
      assert.equal(await tab.evaluate(`(document.querySelector('${sel} .compose-alt-row .compose-alt-text') || {}).value`), 'A plate of food', `${kind}: the cover's description row did not open`);
    };
    await check('article', '.lf-article', 'Article');
    await check('recipe', '.lf-recipe', 'Recipe');
  } finally { x.close(); }
  assert.deepEqual(x.errors, []);
});

// The note composer's busy stripes, on every long-form upload control: the picture drop zone
// (article cover, recipe photos) and the body's Image button, which a pasted picture uses too.
test('an upload in the article or recipe runs the note composer\'s stripes until it lands', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openArticle(x, 'hold');
    const stripes = (sel) => tab.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const a = getComputedStyle(el, '::after');
      return { busy: el.classList.contains('is-uploading'), name: a.animationName, image: /repeating-linear-gradient/.test(a.backgroundImage), opacity: getComputedStyle(el).opacity }; })()`);
    const dropFile = (sel) => tab.evaluate(`(async () => {
      const c = document.createElement('canvas'); c.width = c.height = 8; c.getContext('2d').fillRect(0, 0, 8, 8);
      const png = await new Promise((r) => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([png], 'photo.png', { type: 'image/png' }));
      document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    })()`);
    const busy = { busy: true, name: 'upload-stripes', image: true, opacity: '1' };
    // Lets the held upload go once it has reached the network (a picture is shrunk first).
    const release = async () => {
      for (let i = 0; i < 40 && !(await tab.evaluate(`window.__release.length`)); i++) await sleep(100);
      await tab.evaluate(`window.__release.splice(0).forEach((r) => r())`); await sleep(400);
    };
    // The body's Image button, while a pasted picture uploads.
    await pastePicture(tab);
    assert.deepEqual(await stripes('.lf-article .lf-tool-image'), busy, 'the Image button');
    await release();
    assert.equal((await stripes('.lf-article .lf-tool-image')).busy, false);
    // The article's cover drop zone.
    await dropFile('.lf-article .lf-drop');
    assert.deepEqual(await stripes('.lf-article .lf-drop'), busy, 'the cover drop zone');
    await release();
    // The recipe's photos.
    await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Recipe').click()`);
    await sleep(300);
    await dropFile('.lf-recipe .lf-drop');
    assert.deepEqual(await stripes('.lf-recipe .lf-drop'), busy, 'the recipe photo drop zone');
    await release();
    assert.equal((await stripes('.lf-recipe .lf-drop')).busy, false);
  } finally { x.close(); }
  assert.deepEqual(x.errors, []);
});

// Each picture a paragraph of its own, wherever the caret was: a single line break between text
// and a picture makes them one paragraph, and readers draw the picture inline, tight to the text.
test('a picture goes into the body as a paragraph of its own, wherever the caret is', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openArticle(x, 'now');
    // [body before, caret, pictures, body after]
    const cases = [
      ['Para', 4, 1, 'Para\n\n![](U1)\n\n'],                 // end of a line
      ['Para\n', 5, 1, 'Para\n\n![](U1)\n\n'],              // start of the line under text
      ['Para\n\n', 6, 1, 'Para\n\n![](U1)\n\n'],           // after a blank line
      ['', 0, 1, '![](U1)\n\n'],                               // an empty body
      ['One\nTwo', 4, 1, 'One\n\n![](U1)\n\nTwo'],          // between two lines (the published case)
      ['OneTwo', 3, 1, 'One\n\n![](U1)\n\nTwo'],             // mid-line
      ['One\n\nTwo', 5, 1, 'One\n\n![](U1)\n\nTwo'],       // between paragraphs
      ['Top', 0, 1, '![](U1)\n\nTop'],                         // the top of the body
      ['Para', 4, 2, 'Para\n\n![](U1)\n\n![](U2)\n\n'],    // two at once: two paragraphs
    ];
    for (const [start, caret, count, want] of cases) {
      const got = await tab.evaluate(`(async () => {
        let n = 0; window.SidecarComposeUpload = async () => 'U' + (++n);
        const b = document.querySelector('.lf-article .lf-body');
        b.value = ${JSON.stringify(start)}; b.dispatchEvent(new Event('input', { bubbles: true }));
        b.focus(); b.setSelectionRange(${caret}, ${caret});
        document.querySelector('.lf-tool-image').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const input = document.querySelector('.lf-article .lf-body-file');
        const dt = new DataTransfer(); for (let i = 0; i < ${count}; i++) dt.items.add(new File(['x'], 'p' + i + '.png', { type: 'image/png' }));
        input.files = dt.files; input.dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 200));
        return b.value; })()`);
      assert.equal(got, want, `${JSON.stringify(start)} at ${caret}`);
    }
  } finally { x.close(); }
  assert.deepEqual(x.errors, []);
});
