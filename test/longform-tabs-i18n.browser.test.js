'use strict';

// Two things found reading the full-size composer in the pseudo-locale, in the real
// extension: the note's poll stayed on screen under the Article and Recipe forms
// once the Poll tab had been opened, and Zap Cooking's category names were never
// translated, though the tag a recipe is filed under has to stay English.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

async function openCompose(x) {
  const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
  for (let i = 0; i < 60; i++) {
    if (await tab.evaluate(`!!window.SidecarLongform && !!window.SidecarComposePublish && !document.documentElement.classList.contains('compose-booting')`)) break;
    await sleep(250);
  }
  await sleep(500);
  return tab;
}
// The tabs by position: their labels are translated, their order is not.
const TABS = { note: 0, poll: 1, article: 2, recipe: 3 };
const choose = (name) => `document.querySelectorAll('.compose-mode')[${TABS[name]}].click()`;
const POLL_SHOWN = `(() => { const p = document.querySelector('.poll-editor'); return !!p && p.getBoundingClientRect().height > 0; })()`;

test('the poll belongs to the note: it steps aside on the other tabs and is still there on return', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openCompose(x);
    for (const other of ['recipe', 'article']) {
      await tab.evaluate(choose('poll'));
      await sleep(250);
      assert.equal(await tab.evaluate(POLL_SHOWN), true, 'the Poll tab shows no poll');
      await tab.evaluate(choose(other));
      await sleep(250);
      assert.equal(await tab.evaluate(POLL_SHOWN), false, `the poll shows under the ${other} form`);
    }
    await tab.evaluate(choose('poll'));
    await sleep(250);
    assert.equal(await tab.evaluate(POLL_SHOWN), true, 'the poll was lost on the way back');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('recipe categories show translated and are filed under their English names', opts, async (t) => {
  let x;
  try { x = await startExtension({ settings: { language: 'en-XA' } }); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openCompose(x);
    await tab.evaluate(choose('recipe'));
    await sleep(300);
    // Every suggestion is a translated label: the pseudo-locale brackets what went through t().
    const hints = await tab.evaluate(`[...document.querySelectorAll('.lf-chip-hint')].map((b) => b.textContent)`);
    assert.ok(hints.length > 0, 'no category suggestions');
    for (const h of hints) assert.match(h, /^\+ (\S+ )?\[.*\]$/u, `a suggestion is not translated: ${h}`);
    // Picking one keeps the English name, which is the tag Zap Cooking files it under.
    await tab.evaluate(`document.querySelector('.lf-chip-hint').click()`);
    await sleep(200);
    const picked = await tab.evaluate(`window.SidecarLongform.state.recipe.categories.slice()`);
    assert.equal(picked.length, 1);
    assert.match(picked[0], /^[A-Z][A-Za-z -]+$/, 'the stored category is not the English name');
    assert.match(await tab.evaluate(`document.querySelector('.lf-chip span').textContent`), /^(\S+ )?\[.*\]$/u, 'the chosen chip shows the English name');
    // Typing the translated name finds the category, and adding it files the English one.
    const label = await tab.evaluate(`window.SidecarI18n.t('Turkey')`);
    assert.notEqual(label, 'Turkey', 'Turkey has no translated name to type');
    const part = label.replace(/^\[/, '').slice(0, 4);
    const found = await tab.evaluate(`window.SidecarLongform.matchingCategories(${JSON.stringify(part)})`);
    assert.ok(found.includes('Turkey'), `typing ${part} did not find Turkey: ${JSON.stringify(found)}`);
    await tab.evaluate(`(() => { const i = document.querySelector('.lf-chip-input'); i.value = ${JSON.stringify(label)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await sleep(200);
    assert.ok((await tab.evaluate(`window.SidecarLongform.state.recipe.categories.slice()`)).includes('Turkey'), 'the typed translated name was not filed as Turkey');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

// A real language arrives as a file, after the scripts have run; the pseudo-locale is
// made in code and is ready at once, which is how built-too-early labels hid from it.
test('in a real language the tabs and the recipe form are translated', opts, async (t) => {
  let x;
  try { x = await startExtension({ settings: { language: 'de' } }); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openCompose(x);
    const tabs = await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].map((b) => b.textContent.trim())`);
    assert.equal(tabs[0], 'Notiz', 'the Note tab: ' + tabs.join(', '));
    assert.equal(tabs[TABS.poll], 'Umfrage', 'the Poll tab: ' + tabs.join(', '));
    await tab.evaluate(choose('recipe'));
    await sleep(300);
    assert.equal(await tab.evaluate(`document.querySelector('.lf-recipe .lf-list-add').textContent`), 'Hinzufügen', 'the recipe form kept its English');
    // What is still needed is a list in the language, with its own "und", not an English ", ".
    const missing = await tab.evaluate(`[...document.querySelectorAll('.lf-missing')].find((n) => n.offsetParent).textContent`);
    assert.match(missing, /^Es fehlt noch: .+ und [^,]+$/u, 'the still-needed list: ' + missing);
    // "Raw" and "Healthy" were already keys for raw event data and a working relay, so their
    // chips read "Rohdaten" and "Funktionsfähig". They are food, and still filed in English.
    for (const name of ['Raw', 'Healthy']) {
      await tab.evaluate(`(() => { const i = document.querySelector('.lf-recipe .lf-chip-input'); i.value = '${name}'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
      await sleep(200);
    }
    assert.deepEqual(await tab.evaluate(`window.SidecarLongform.state.recipe.categories.slice()`), ['Raw', 'Healthy']);
    const chips = await tab.evaluate(`[...document.querySelectorAll('.lf-recipe .lf-chip span')].map((s) => s.textContent.replace(/^\\S+ /u, ''))`);
    assert.deepEqual(chips, ['Rohkost', 'Gesund'], 'the category chips: ' + chips.join(', '));
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('the title is set in Playfair Display, not the theme’s display face', opts, async (t) => {
  let x;
  try { x = await startExtension({ settings: { theme: 'cast-iron' } }); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openCompose(x);
    assert.equal(await tab.evaluate(`document.documentElement.getAttribute('data-theme')`), 'cast-iron');
    for (const form of ['recipe', 'article']) {
      await tab.evaluate(choose(form));
      await sleep(250);
      const font = await tab.evaluate(`getComputedStyle(document.querySelector('.lf-${form} .lf-title')).fontFamily`);
      assert.match(font, /^"?Playfair Display/, `the ${form} title is in ${font}`);
    }
  } finally { x.close(); }
});
