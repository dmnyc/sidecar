'use strict';

// A RECIPE'S LISTS REORDER BY DRAGGING, as on Zap Cooking: an item is dragged by its grip and
// lands before the row it is dropped on (top half) or after it (bottom half), so it can go
// past the last one. Only the grip starts a drag. From the keyboard, the grip's arrow keys move
// an item one place. Run in the real extension: the grip is pressed with a real mouse event;
// the drag itself is the page's own DragEvents, since headless Chrome does no native drag.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no browser found', timeout: 180000 };

async function openRecipe(x) {
  const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
  await tab.viewport({ width: 1280, height: 900, scale: 1 });
  for (let i = 0; i < 60 && !(await tab.evaluate(`!!window.SidecarLongform && !document.documentElement.classList.contains('compose-booting')`)); i++) await sleep(250);
  await sleep(600);
  await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Recipe').click()`);
  await tab.evaluate(`(() => {
    const L = window.SidecarLongform.state.recipe;
    L.ingredients.splice(0, L.ingredients.length, 'apples', 'butter', 'cinnamon');
    window.SidecarLongform.refresh();
  })()`);
  await sleep(300);
  const LIST = `document.querySelector('.lf-recipe .lf-list')`;
  return {
    tab,
    // What the draft holds and what the list shows, so neither can drift from the other.
    items: () => tab.evaluate(`[...window.SidecarLongform.state.recipe.ingredients]`),
    shown: () => tab.evaluate(`[...${LIST}.querySelectorAll('.lf-list-text')].map((n) => n.textContent)`),
    // Press the grip of row `from` for real (or not), then drag it over row `to`, at its top or
    // bottom quarter, and drop.
    drag: async (from, to, where, { grip = true } = {}) => {
      if (grip) {
        const at = await tab.evaluate(`(() => { const r = ${LIST}.children[${from}].querySelector('.lf-list-grip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        await tab.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
        await tab.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
      }
      return tab.evaluate(`(() => {
        const rows = () => ${LIST}.children;
        const src = rows()[${from}], dst = rows()[${to}];
        const dt = new DataTransfer();
        const r = dst.getBoundingClientRect();
        const y = ${JSON.stringify(where)} === 'top' ? r.top + r.height / 4 : r.bottom - r.height / 4;
        const ev = (type, el) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: y }));
        ev('dragstart', src);
        const types = [...dt.types];
        ev('dragover', dst);
        const line = dst.classList.contains('drop-before') ? 'before' : dst.classList.contains('drop-after') ? 'after' : null;
        ev('drop', dst);
        ev('dragend', src);
        return { types, line };
      })()`);
    },
  };
}

test('an ingredient dragged by its grip lands before or after the row it is dropped on', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const c = await openRecipe(x);
    assert.deepEqual(await c.items(), ['apples', 'butter', 'cinnamon']);

    // The last one onto the top half of the first: it becomes first.
    let r = await c.drag(2, 0, 'top');
    assert.equal(r.line, 'before', 'no line where it would land');
    assert.deepEqual(r.types, ['application/x-sidecar-list-item'], 'the drag carries text, which another field would take');
    assert.deepEqual(await c.items(), ['cinnamon', 'apples', 'butter']);
    assert.deepEqual(await c.shown(), ['cinnamon', 'apples', 'butter']);

    // The first onto the bottom half of the last: past the end.
    r = await c.drag(0, 2, 'bottom');
    assert.equal(r.line, 'after');
    assert.deepEqual(await c.items(), ['apples', 'butter', 'cinnamon']);

    // Onto the row just below, top half: where it already is. No line, nothing moves.
    r = await c.drag(0, 1, 'top');
    assert.equal(r.line, null, 'a line where nothing would change');
    assert.deepEqual(await c.items(), ['apples', 'butter', 'cinnamon']);

    // Not from the grip: the words are for clicking and selecting, and nothing moves.
    await c.drag(0, 2, 'bottom', { grip: false });
    assert.deepEqual(await c.items(), ['apples', 'butter', 'cinnamon'], 'a row moved without its grip');

    // The numbers follow the order.
    assert.deepEqual(await c.tab.evaluate(`[...document.querySelectorAll('.lf-recipe .lf-list')].map((l) => l.classList.contains('is-numbered'))`), [false, true]);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('the grip moves its item with the arrow keys, and keeps the focus', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const c = await openRecipe(x);
    await c.tab.evaluate(`document.querySelector('.lf-recipe .lf-list').children[0].querySelector('.lf-list-grip').focus()`);
    await c.tab.press('ArrowDown');
    await sleep(100);
    assert.deepEqual(await c.items(), ['butter', 'apples', 'cinnamon']);
    await c.tab.press('ArrowDown');
    await sleep(100);
    assert.deepEqual(await c.items(), ['butter', 'cinnamon', 'apples']);
    // Already last: nothing.
    await c.tab.press('ArrowDown');
    await sleep(100);
    assert.deepEqual(await c.items(), ['butter', 'cinnamon', 'apples']);
    assert.equal(await c.tab.evaluate(`document.activeElement.closest('li').querySelector('.lf-list-text').textContent`), 'apples', 'the focus did not follow the item');
    await c.tab.press('ArrowUp');
    await sleep(100);
    assert.deepEqual(await c.items(), ['butter', 'apples', 'cinnamon']);
    assert.deepEqual(await c.shown(), ['butter', 'apples', 'cinnamon']);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
