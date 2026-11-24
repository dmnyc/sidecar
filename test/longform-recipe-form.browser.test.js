'use strict';

// THE RECIPE FORM'S TIMES AND COVER, in the real extension with real typing and clicks.
//
//   - a time that is only a number is minutes: "15" becomes "15 min" on leaving the box, and
//     "1 hr", "0" and the servings are left as typed
//   - the first photo is drawn large as the cover, the rest under More photos; a tap on one
//     makes it the cover, and removing the cover moves the next one up
//   - an article's cover is drawn the same way

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no browser found', timeout: 180000 };

async function openTab(x, mode) {
  const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
  for (let i = 0; i < 60 && !(await tab.evaluate(`!!window.SidecarLongform && !document.documentElement.classList.contains('compose-booting')`)); i++) await sleep(250);
  await sleep(500);
  await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === ${JSON.stringify(mode)}).click()`);
  await sleep(300);
  return tab;
}
const clickAt = async (tab, sel) => {
  const at = await tab.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tab.clickAt(at.x, at.y); await sleep(200);
};
// Pictures added as a person adds them by link: the disclosure, the field, Enter.
async function addByLink(tab, form, urls) {
  await tab.evaluate(`document.querySelector('${form} .lf-img-more .lf-disclose').click()`);
  for (const u of urls) {
    await tab.evaluate(`(() => { const i = document.querySelector('${form} .lf-url-input'); i.focus(); i.value = ${JSON.stringify(u)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
    await sleep(120);
  }
}
const pictures = (tab, form) => tab.evaluate(`(() => {
  const f = document.querySelector('${form}');
  const cover = f.querySelector('.lf-cover');
  const shown = (el) => !!el && !el.classList.contains('hidden');
  return {
    cover: shown(cover) ? cover.querySelector('img').getAttribute('src') : null,
    coverWide: shown(cover) ? Math.round(cover.getBoundingClientRect().width / cover.getBoundingClientRect().height * 100) / 100 : null,
    strip: [...f.querySelectorAll('.lf-strip .compose-thumb img')].map((i) => i.getAttribute('src')),
    moreHead: shown(f.querySelector('.lf-more-head')),
    drop: shown(f.querySelector('.lf-drop')) ? f.querySelector('.lf-drop-text strong').textContent : null,
  };
})()`);

test('a bare number in a recipe time becomes minutes; anything else is kept', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openTab(x, 'Recipe');
    const inputs = `[...document.querySelectorAll('.lf-recipe .lf-details input')]`;
    const typeInto = async (n, text) => {
      await tab.evaluate(`(() => { const i = ${inputs}[${n}]; i.value = ''; i.focus(); })()`);
      await tab.type(text); await sleep(80);
      await tab.evaluate(`document.querySelector('.lf-recipe .lf-title').focus()`); await sleep(120);
      return tab.evaluate(`${inputs}[${n}].value`);
    };
    assert.equal(await typeInto(0, '15'), '15 min');
    assert.equal(await tab.evaluate('SidecarLongform.state.recipe.prep'), '15 min', 'the draft keeps what the box shows');
    assert.equal(await typeInto(1, '1 hr'), '1 hr');
    assert.equal(await typeInto(1, '0'), '0');
    assert.equal(await typeInto(1, '1.5'), '1.5 min');
    assert.equal(await typeInto(2, '6'), '6', 'servings are not a time');
  } finally { x.close(); }
  assert.deepEqual(x.errors, []);
});

test('the first photo is the cover, drawn large; a tap makes another the cover', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  const A = 'https://example.com/a.jpg', B = 'https://example.com/b.jpg', C = 'https://example.com/c.jpg';
  try {
    await x.reload();
    const tab = await openTab(x, 'Recipe');
    await tab.viewport({ width: 1100, height: 900, scale: 1 });
    let p = await pictures(tab, '.lf-recipe');
    assert.deepEqual(p, { cover: null, coverWide: null, strip: [], moreHead: false, drop: 'Add a cover photo' });

    await addByLink(tab, '.lf-recipe', [A]);
    p = await pictures(tab, '.lf-recipe');
    assert.equal(p.cover, A);
    assert.ok(Math.abs(p.coverWide - 1.91) < 0.05, 'the cover is not at the link-preview shape: ' + p.coverWide);
    assert.deepEqual(p.strip, []);
    assert.equal(p.moreHead, false);
    assert.equal(p.drop, 'Add more photos');

    await addByLink(tab, '.lf-recipe', [B, C]);
    p = await pictures(tab, '.lf-recipe');
    assert.deepEqual([p.cover, ...p.strip], [A, B, C]);
    assert.equal(p.moreHead, true);

    // A tap on C makes it the cover; the order is what is published.
    await clickAt(tab, '.lf-recipe .lf-strip .compose-thumb:nth-child(2) img');
    p = await pictures(tab, '.lf-recipe');
    assert.deepEqual([p.cover, ...p.strip], [C, A, B]);
    assert.deepEqual(await tab.evaluate('SidecarLongform.state.recipe.photos.map((m) => m.url)'), [C, A, B]);
    // The first in the strip moves up to the cover by its left arrow, which says so.
    assert.equal(await tab.evaluate(`document.querySelector('.lf-recipe .lf-strip .compose-thumb .compose-thumb-move.left').title`), 'Make cover');

    // Removing the cover moves the next one up.
    await clickAt(tab, '.lf-recipe .lf-cover .compose-thumb-x');
    p = await pictures(tab, '.lf-recipe');
    assert.deepEqual([p.cover, ...p.strip], [A, B]);
  } finally { x.close(); }
  assert.deepEqual(x.errors, []);
});

test('an article\'s cover is drawn the same way', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openTab(x, 'Article');
    await addByLink(tab, '.lf-article', ['https://example.com/cover.jpg']);
    const a = await pictures(tab, '.lf-article');
    assert.equal(a.cover, 'https://example.com/cover.jpg');
    assert.equal(a.drop, null, 'an article has one cover; the box goes once it is set');

  } finally { x.close(); }
  assert.deepEqual(x.errors, []);
});
