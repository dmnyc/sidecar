'use strict';

// KEYBOARD AND LAYOUT IN THE FULL-SIZE COMPOSER AND THE HELP PAGE, in the real extension:
// - Tab out of a recipe's category box goes on to the next thing, not to the top of the page,
//   and a half-typed category is still kept when the box is left.
// - The Note | Poll | Article | Recipe tabs are one Tab stop, moved along with the arrow keys
//   (mirrored right to left), and the chosen one is marked by more than its color.
// - The recipe list's buttons and the panel's switch rows are at least 24px, WCAG's minimum.
// - At 320px wide every composer tab is on screen, and neither page scrolls sideways.
// - With reduced motion, loading placeholders, the dim balance and the spinners stand still.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no browser found', timeout: 180000 };

async function start(t, settings) {
  try { return await startExtension({ settings }); } catch (e) { if (e.skip) { t.skip(e.message); return null; } throw e; }
}
async function openCompose(x, width = 1280) {
  const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
  await tab.viewport({ width, height: 900, scale: 1 });
  for (let i = 0; i < 60 && !(await tab.evaluate(`!!window.SidecarLongform && !document.documentElement.classList.contains('compose-booting')`)); i++) await sleep(250);
  await sleep(600);
  return tab;
}
const pickMode = (tab, name) => tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === ${JSON.stringify(name)}).click()`);
// What has the focus, as words a test can read.
const focused = (tab) => tab.evaluate(`(() => { const a = document.activeElement; if (!a || a === document.body) return 'body'; return a.className + '|' + (a.textContent || a.placeholder || '').trim(); })()`);

test('Tab out of a recipe category box goes on to the suggestions, and a half-typed one is kept', opts, async (t) => {
  const x = await start(t);
  if (!x) return;
  try {
    await x.reload();
    const tab = await openCompose(x);
    await pickMode(tab, 'Recipe');
    await sleep(400);
    const BOX = `[...document.querySelectorAll('.lf-recipe .lf-chip-input')].find((i) => i.placeholder === 'Add a category')`;
    const firstHint = () => tab.evaluate(`(() => { const b = ${BOX}.closest('.lf-chips').nextElementSibling.querySelector('.lf-chip-hint:not(.hidden)'); return b ? 'lf-chip-hint|' + b.textContent.trim() : null; })()`);
    assert.ok(await firstHint(), 'no suggestions under the box');

    // Empty box, Tab: the first suggestion.
    await tab.evaluate(`${BOX}.focus()`);
    const hint = await firstHint();
    await tab.press('Tab');
    await sleep(200);
    assert.equal(await focused(tab), hint, 'Tab out of the box lost the focus');

    // A word typed and left with Tab: kept as a category, and the focus still goes on.
    await tab.evaluate(`${BOX}.focus()`);
    await tab.type('Zucchini');
    await tab.press('Tab');
    await sleep(200);
    assert.deepEqual(await tab.evaluate(`[...window.SidecarLongform.state.recipe.categories]`), ['Zucchini']);
    // Typing narrowed the suggestions to none, so the next stop is whatever follows the box.
    assert.equal(await tab.evaluate(`(() => { const a = document.activeElement; return a !== document.body && !!(${BOX}.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING); })()`), true, 'the focus went back up the page');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

for (const [language, rtl] of [['en', false], ['ar', true]]) {
  test(`the composer's tabs move with the arrow keys${rtl ? ', mirrored right to left' : ''}, and the chosen one has a bar`, opts, async (t) => {
    const x = await start(t, { language });
    if (!x) return;
    try {
      await x.reload();
      const tab = await openCompose(x);
      const state = () => tab.evaluate(`[...document.querySelectorAll('.compose-mode')].map((b) => b.tabIndex)`);
      // One Tab stop: the chosen tab's.
      assert.deepEqual(await state(), [0, -1, -1, -1]);
      const at = () => tab.evaluate(`[...document.querySelectorAll('.compose-mode')].indexOf(document.activeElement)`);
      await tab.evaluate(`document.querySelector('.compose-mode').focus()`);
      const next = rtl ? 'ArrowLeft' : 'ArrowRight';
      const back = rtl ? 'ArrowRight' : 'ArrowLeft';
      await tab.press(next); await sleep(80);
      assert.equal(await at(), 1);
      await tab.press('End'); await sleep(80);
      assert.equal(await at(), 3);
      await tab.press(next); await sleep(80);
      assert.equal(await at(), 0, 'past the end does not wrap round to the start');
      await tab.press(back); await sleep(80);
      assert.equal(await at(), 3);
      await tab.press('Home'); await sleep(80);
      assert.equal(await at(), 0);
      // Arrows only move; Enter opens.
      await tab.press(next); await tab.press(next); await tab.press(next); await sleep(80);
      assert.equal(await tab.evaluate(`window.SidecarLongform.state.mode`), 'note', 'an arrow key opened a tab');
      await tab.press('Enter'); await sleep(400);
      assert.equal(await tab.evaluate(`window.SidecarLongform.state.mode`), 'recipe');
      assert.deepEqual(await state(), [-1, -1, -1, 0]);

      // The chosen tab is marked by a bar, not only a color.
      const bar = (sel) => tab.evaluate(`(() => { const s = getComputedStyle(document.querySelector('${sel}')); return { image: s.backgroundImage, size: s.backgroundSize }; })()`);
      const on = await bar('.compose-mode.active');
      assert.match(on.image, /gradient/, 'no bar under the chosen tab');
      assert.match(on.size, / 2px$/);
      assert.equal((await bar('.compose-mode:not(.active)')).image, 'none');
      assert.deepEqual(x.errors, []);
    } finally { x.close(); }
  });
}

test('the recipe list buttons and the switch rows are at least 24px', opts, async (t) => {
  const x = await start(t);
  if (!x) return;
  try {
    await x.reload();
    const tab = await openCompose(x);
    await pickMode(tab, 'Recipe');
    await tab.evaluate(`(() => { const L = window.SidecarLongform.state.recipe; L.ingredients.push('apples', 'butter'); window.SidecarLongform.refresh(); })()`);
    await sleep(300);
    const small = await tab.evaluate(`[...document.querySelectorAll('.lf-recipe .lf-list-item button')].map((b) => { const r = b.getBoundingClientRect(); return [b.title || b.className, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }).filter(([, w, h]) => w < 24 || h < 24)`);
    assert.deepEqual(small, [], 'buttons under 24px');

    await x.evaluate(`document.getElementById('settings-btn').click()`); await sleep(800);
    await x.evaluate(`document.querySelectorAll('#view-settings .settings-section').forEach((s) => s.classList.add('open'))`); await sleep(400);
    const rows = await x.evaluate(`[...document.querySelectorAll('#view-settings .toggle-row')].filter((r) => r.getClientRects().length).map((r) => [r.textContent.trim().slice(0, 30), r.getBoundingClientRect().height]).filter(([, h]) => h < 24)`);
    assert.deepEqual(rows, [], 'switch rows under 24px');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('at 320px wide the composer keeps every tab on screen, and help does not scroll sideways', opts, async (t) => {
  const x = await start(t);
  if (!x) return;
  try {
    await x.reload();
    const tab = await openCompose(x, 320);
    const out = await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].filter((b) => { const r = b.getBoundingClientRect(); return r.right > innerWidth + 0.5 || r.left < -0.5; }).map((b) => b.textContent.trim())`);
    assert.deepEqual(out, [], 'tabs off screen');
    assert.equal(await tab.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, 'the composer scrolls sideways');

    const help = await x.openPage(`chrome-extension://${x.extId}/help.html`);
    await help.viewport({ width: 320, height: 800, scale: 1 });
    await sleep(1500);
    assert.equal(await help.evaluate(`document.documentElement.scrollWidth - innerWidth`), 0, 'help scrolls sideways');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('with reduced motion, loading shimmer, the loading balance and the spinners stand still', opts, async (t) => {
  const x = await start(t);
  if (!x) return;
  try {
    await x.reload();
    const tab = await openCompose(x);
    await tab.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(200);
    const moving = await tab.evaluate(`(() => {
      const host = document.createElement('div');
      host.innerHTML = '<div class="sk"></div><div class="wallet-balance loading">1</div><span class="recv-spinner"></span><span class="ac-spinner"></span>';
      document.body.append(host);
      const out = [...host.children].filter((el) => getComputedStyle(el).animationName !== 'none').map((el) => el.className);
      host.remove();
      return out;
    })()`);
    assert.deepEqual(moving, [], 'still moving with reduced motion');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
