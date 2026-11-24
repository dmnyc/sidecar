'use strict';

// An article and a recipe are their own kinds of post, with their own drafts. Nothing typed
// as a note appears in either, nothing written in either reaches the note's draft slot or
// Saved drafts, and each comes back after the tab reloads. Run against the real extension:
// the drafts go through the background's encrypted store.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

async function openCompose(x) {
  const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
  for (let i = 0; i < 60; i++) {
    if (await tab.evaluate(`!!document.querySelector('.compose-editor') && !!window.SidecarLongform && !document.documentElement.classList.contains('compose-booting')`)) break;
    await sleep(250);
  }
  await sleep(500);
  return tab;
}

test('articles and recipes keep their own drafts, apart from the note', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    let tab = await openCompose(x);
    // A note first, in the note's editor.
    await tab.evaluate(`(() => { const e = document.querySelector('.compose-editor'); e.focus(); document.execCommand('insertText', false, 'Just a note'); })()`);
    await sleep(700);

    // The article's body starts empty: the note does not carry over.
    await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Article').click()`);
    assert.equal(await tab.evaluate(`document.querySelector('.lf-article .lf-body').value`), '', 'the note text appeared in the article');
    assert.equal(await tab.evaluate(`getComputedStyle(document.getElementById('compose-slot')).display`), 'none', 'the note editor still shows in the Article tab');
    await tab.evaluate(`(() => {
      const ti = document.querySelector('.lf-article .lf-title'); ti.focus(); document.execCommand('insertText', false, 'An article');
      const b = document.querySelector('.lf-article .lf-body'); b.focus(); document.execCommand('insertText', false, 'Its own body');
    })()`);
    // The toolbar's image button uploads and writes the picture's markdown at the caret. The
    // upload itself is stood in for: what is checked is what reaches the body.
    await tab.evaluate(`(async () => {
      window.SidecarComposeUpload = async () => 'https://example.com/up.png';
      const b = document.querySelector('.lf-article .lf-body'); b.focus(); b.setSelectionRange(b.value.length, b.value.length);
      document.querySelector('.lf-tool-image').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const input = document.querySelector('.lf-article .lf-body-file');
      const dt = new DataTransfer(); dt.items.add(new File(['x'], 'up.png', { type: 'image/png' }));
      input.files = dt.files; input.dispatchEvent(new Event('change'));
    })()`);
    await sleep(300);
    assert.equal(await tab.evaluate(`document.querySelector('.lf-article .lf-body').value`), 'Its own body\n\n![](https://example.com/up.png)\n\n');
    // With a title and a body the article can go out, and the button says Publish: it is the
    // article's button here, never the hidden note's.
    assert.equal(await tab.evaluate(`document.getElementById('compose-post').disabled`), false, 'Review stayed off for a complete article');
    assert.equal(await tab.evaluate(`document.getElementById('compose-post').textContent`), 'Review');

    await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Recipe').click()`);
    await tab.evaluate(`(() => { const ti = document.querySelector('.lf-recipe .lf-title'); ti.focus(); document.execCommand('insertText', false, 'A recipe'); })()`);
    // A picture added by link lists its link, with a copy button, under the strip.
    await tab.evaluate(`(() => {
      document.querySelector('.lf-recipe .lf-img-more .lf-disclose').click();
      const u = document.querySelector('.lf-recipe .lf-url-input'); u.value = 'https://example.com/pie.jpg';
      u.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    assert.equal(await tab.evaluate(`document.querySelector('.lf-recipe .lf-links .compose-media-url').textContent`), 'https://example.com/pie.jpg');
    assert.ok(await tab.evaluate(`!!document.querySelector('.lf-recipe .lf-links .compose-media-copy')`), 'no copy button for the image link');
    assert.ok(await tab.evaluate(`document.querySelector('.lf-recipe .lf-links .compose-media-toggle').getClientRects().length > 0`), 'the image links are hidden');
    await sleep(1200);

    // Back on the note: still the note, and its slot holds only the note.
    await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Note').click()`);
    assert.equal(await tab.evaluate(`document.querySelector('.compose-editor').innerText.trim()`), 'Just a note');
    const drafts = (await x.message({ type: 'SIDECAR_SECRET_GET', store: 'drafts' })).result;
    const noteText = JSON.stringify(drafts);
    assert.ok(noteText.includes('Just a note'), 'the note draft was not saved');
    assert.ok(!/An article|Its own body|A recipe/.test(noteText), 'an article or recipe leaked into the note drafts');
    const lf = (await x.message({ type: 'SIDECAR_SECRET_GET', store: 'longform' })).result;
    const mine = Object.values(lf)[0];
    assert.equal(mine.article.title, 'An article');
    assert.equal(mine.article.body, 'Its own body\n\n![](https://example.com/up.png)\n\n');
    assert.equal(mine.recipe.title, 'A recipe');
    assert.deepEqual(mine.recipe.photos, [{ url: 'https://example.com/pie.jpg' }]);
    assert.ok(!JSON.stringify(lf).includes('Just a note'), 'the note leaked into the article drafts');

    // Reloaded, each comes back in its own tab.
    await tab.close();
    tab = await openCompose(x);
    await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Article').click()`);
    assert.equal(await tab.evaluate(`document.querySelector('.lf-article .lf-title').value`), 'An article');
    assert.equal(await tab.evaluate(`document.querySelector('.lf-article .lf-body').value`), 'Its own body\n\n![](https://example.com/up.png)\n\n');
    assert.ok(await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Article').classList.contains('has-draft')`));
    await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Recipe').click()`);
    assert.equal(await tab.evaluate(`document.querySelector('.lf-recipe .lf-title').value`), 'A recipe');

    // Saved drafts lists both, from the Recipe tab too, and a row opens its own tab.
    await tab.evaluate(`document.getElementById('compose-drafts-btn').click()`);
    await sleep(800);
    assert.equal(await tab.evaluate(`getComputedStyle(document.getElementById('compose-drafts-pane')).display`) !== 'none', true, 'Saved drafts did not open from the Recipe tab');
    assert.equal(await tab.evaluate(`getComputedStyle(document.querySelector('.lf-recipe')).display`), 'none', 'the recipe form stayed over the list');
    const rows = await tab.evaluate(`[...document.querySelectorAll('.lf-saved-drafts .saved-draft-label')].map((e) => e.textContent)`);
    assert.deepEqual(rows, ['Article', 'Recipe']);
    await tab.evaluate(`document.querySelector('.lf-saved-drafts .saved-draft-open').click()`);
    await sleep(300);
    assert.equal(await tab.evaluate(`document.querySelector('.compose-sheet').dataset.mode`), 'article');
    assert.equal(await tab.evaluate(`document.getElementById('compose-drafts-pane').classList.contains('hidden')`), true);
    assert.equal(await tab.evaluate(`document.querySelector('.lf-article .lf-title').value`), 'An article');

    // From the Recipe tab, the note's row is not "Open now", and picking it opens the Note tab.
    await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Recipe').click()`);
    await tab.evaluate(`document.getElementById('compose-drafts-btn').click()`);
    await sleep(800);
    const noteRow = `document.querySelector('#compose-drafts-pane > .saved-drafts .saved-draft')`;
    assert.notEqual(await tab.evaluate(`${noteRow}.querySelector('.saved-draft-when').textContent`), 'Open now', 'the note said Open now from the Recipe tab');
    await tab.evaluate(`${noteRow}.querySelector('.saved-draft-open').click()`);
    await sleep(500);
    assert.equal(await tab.evaluate(`document.querySelector('.compose-sheet').dataset.mode`), 'note', 'picking the note left the Recipe tab up');
    assert.equal(await tab.evaluate(`document.querySelector('.compose-editor').innerText.trim()`), 'Just a note');

    // The panel's Saved drafts lists them too, and opens one in the full-size composer.
    await tab.close();
    await sleep(500);
    await x.evaluate(`document.getElementById('compose-fab').click()`); await sleep(400);
    await x.evaluate(`document.getElementById('compose-note-btn').click()`);
    // The note written earlier is offered first; resuming it reaches the editor and its folder.
    await x.waitFor(`[...document.querySelectorAll('#modal button')].some((b) => b.textContent === 'Resume draft')`);
    await x.evaluate(`[...document.querySelectorAll('#modal button')].find((b) => b.textContent === 'Resume draft').click()`);
    await x.waitFor(`!!document.querySelector('#modal .compose-drafts-btn:not(.hidden)')`);
    await x.evaluate(`document.querySelector('#modal .compose-drafts-btn').click()`);
    await x.waitFor(`!!document.querySelector('#modal .lf-saved-drafts')`);
    assert.deepEqual(await x.evaluate(`[...document.querySelectorAll('#modal .lf-saved-drafts .saved-draft-label')].map((e) => e.textContent)`), ['Article', 'Recipe']);
    await x.recordTabs();
    await x.evaluate(`document.querySelectorAll('#modal .lf-saved-drafts .saved-draft-open')[1].click()`);
    await sleep(800);
    const created = (await x.calls()).filter((c) => c.call === 'create');
    assert.ok(created.some((c) => /compose\.html#recipe$/.test(c.args[0].url)), 'the recipe did not open in the full-size composer');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

// The draft on screen can be thrown away from its own row: the editor (or the form) is
// cleared with the stored copy, so the next autosave has nothing to write back.
test('the open note, article or recipe is discarded from its row in Saved drafts', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openCompose(x);
    const store = async (name) => (await x.message({ type: 'SIDECAR_SECRET_GET', store: name })).result || {};
    await tab.evaluate(`(() => { const e = document.querySelector('.compose-editor'); e.focus(); document.execCommand('insertText', false, 'Throw this away'); })()`);
    await sleep(900);
    assert.ok(JSON.stringify(await store('drafts')).includes('Throw this away'), 'the note was not saved first');

    await tab.evaluate(`document.getElementById('compose-drafts-btn').click()`);
    await sleep(800);
    const cur = `document.querySelector('#compose-drafts-pane .saved-draft-current')`;
    assert.equal(await tab.evaluate(`${cur}.querySelector('.saved-draft-when').textContent`), 'Open now');
    assert.equal(await tab.evaluate(`${cur}.querySelector('.saved-draft-x:not(.saved-draft-cloud)').title`), 'Discard draft');
    await tab.evaluate(`${cur}.querySelector('.saved-draft-x:not(.saved-draft-cloud)').click()`);
    assert.equal(await tab.evaluate(`${cur}.querySelector('.saved-draft-snip').textContent`), 'Tap again to discard');
    await tab.evaluate(`${cur}.querySelector('.saved-draft-x:not(.saved-draft-cloud)').click()`);
    await sleep(1500); // past the autosave, which must not put it back
    assert.equal(await tab.evaluate(`document.querySelector('.compose-editor').innerText.trim()`), '', 'the editor kept the text');
    assert.ok(!JSON.stringify(await store('drafts')).includes('Throw this away'), 'the note came back');
    assert.equal(await tab.evaluate(`!!document.querySelector('#compose-drafts-pane .saved-draft-current')`), false, 'the row is still listed');

    // The article on screen, the same way, and the form is blank after.
    await tab.evaluate(`document.querySelector('.compose-drafts-back').click()`);
    await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Article').click()`);
    await tab.evaluate(`(() => { const i = document.querySelector('.lf-article .lf-title'); i.focus(); document.execCommand('insertText', false, 'Gone soon'); })()`);
    await sleep(900);
    assert.ok(JSON.stringify(await store('longform')).includes('Gone soon'), 'the article was not saved first');
    await tab.evaluate(`document.getElementById('compose-drafts-btn').click()`);
    await sleep(800);
    const art = `document.querySelector('.lf-saved-drafts .saved-draft-current')`;
    assert.equal(await tab.evaluate(`${art}.querySelector('.saved-draft-x').title`), 'Discard draft');
    await tab.evaluate(`${art}.querySelector('.saved-draft-x').click()`);
    await tab.evaluate(`${art}.querySelector('.saved-draft-x').click()`);
    await sleep(1500);
    assert.equal(await tab.evaluate(`document.querySelector('.lf-article .lf-title').value`), '', 'the article form kept its title');
    assert.ok(!JSON.stringify(await store('longform')).includes('Gone soon'), 'the article came back');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('recipe categories: seasonal suggestions and matches as you type, from Zap Cooking\'s list', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openCompose(x);
    // By the month, and every one of them a category Zap Cooking lists.
    assert.deepEqual(await tab.evaluate(`SidecarLongform.seasonalCategories(10)`), ['Turkey', 'Roast', 'Pie', 'Squash', 'Potato', 'Bread', 'Soup', 'Dessert']);
    assert.equal(await tab.evaluate(`SidecarLongform.seasonalCategories(11)[0]`), 'Christmas');
    assert.equal(await tab.evaluate(`SidecarLongform.seasonalCategories(3)[0]`), 'Easter');
    assert.deepEqual(await tab.evaluate(`SidecarLongform.matchingCategories('veg')`), ['Vegetables', 'Vegan', 'Raw Vegan']);
    assert.deepEqual(await tab.evaluate(`SidecarLongform.matchingCategories('')`), []);

    await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Recipe').click()`);
    await sleep(300);
    const hints = `[...document.querySelectorAll('.lf-recipe .lf-chip-hint')].map((b) => b.textContent)`;
    const month = await tab.evaluate(`new Date().getMonth()`);
    const seasonal = await tab.evaluate(`SidecarLongform.seasonalCategories(${month})`);
    // Each with Zap Cooking's emoji, where it has one.
    assert.deepEqual(await tab.evaluate(hints), await tab.evaluate(`${JSON.stringify(seasonal)}.map((c) => '+ ' + SidecarLongform.categoryShown(c))`));
    assert.ok((await tab.evaluate(hints)).some((h) => /\p{Extended_Pictographic}/u.test(h)), 'the suggestions show no emoji');
    // Typing swaps them for matches; a pick adds it and clears the box.
    const box = `document.querySelector('.lf-recipe .lf-chip-input')`;
    await tab.evaluate(`(() => { const i = ${box}; i.focus(); document.execCommand('insertText', false, 'veg'); })()`);
    await sleep(100);
    assert.deepEqual(await tab.evaluate(hints), ['+ 🥦 Vegetables', '+ 🌱 Vegan', '+ 🌿 Raw Vegan']);
    await tab.evaluate(`[...document.querySelectorAll('.lf-recipe .lf-chip-hint')].find((b) => b.textContent === '+ 🌱 Vegan').click()`);
    await sleep(100);
    const chips = `[...document.querySelectorAll('.lf-recipe .lf-chip > span:first-child')].map((s) => s.textContent)`;
    assert.deepEqual(await tab.evaluate(chips), ['🌱 Vegan']);
    assert.equal(await tab.evaluate(`${box}.value`), '');
    // A typed one of theirs takes their spelling; anything else stays as typed.
    await tab.evaluate(`(() => { const i = ${box}; i.focus(); document.execCommand('insertText', false, 'side'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await tab.evaluate(`(() => { const i = ${box}; i.focus(); document.execCommand('insertText', false, 'Thanksgiving'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await sleep(100);
    // Every category of theirs has an emoji; a category of your own has none.
    assert.deepEqual(await tab.evaluate(chips), ['🌱 Vegan', '🍽️ Side', 'Thanksgiving']);
    // Shown, never published: the categories are filed under their names alone.
    assert.deepEqual(await tab.evaluate(`SidecarLongform.state.recipe.categories.slice()`), ['Vegan', 'Side', 'Thanksgiving']);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

// A RELOAD COMES BACK TO THE TAB IT LEFT. Changing the theme reloads the composer, and a
// recipe being written came back as the Note tab, to be found again by hand. The tab is kept
// for that browser tab only: a composer opened afresh still starts on Note.
test('a reload keeps the tab that was open; a new composer starts on Note', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openCompose(x);
    await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Recipe').click()`);
    await tab.evaluate(`(() => { const ti = document.querySelector('.lf-recipe .lf-title'); ti.focus(); document.execCommand('insertText', false, 'Pumpkin bread'); })()`);
    await sleep(1500);

    await tab.evaluate('void location.reload()');
    await sleep(1500);
    let mode = '';
    for (let i = 0; i < 40; i++) {
      mode = await tab.evaluate(`window.SidecarLongform && document.querySelector('.lf-recipe .lf-title').value === 'Pumpkin bread' ? window.SidecarLongform.state.mode : ''`).catch(() => '');
      if (mode === 'recipe') break;
      await sleep(250);
    }
    assert.equal(mode, 'recipe', 'the reload came back on the Recipe tab with its draft');
    assert.equal(await tab.evaluate(`document.querySelector('.compose-mode.active').textContent.trim()`), 'Recipe');
    assert.equal(await tab.evaluate(`document.querySelector('.lf-recipe').classList.contains('hidden')`), false, 'the recipe form shows');

    const fresh = await openCompose(x);
    await sleep(1500);
    assert.equal(await fresh.evaluate('window.SidecarLongform.state.mode'), 'note', 'a new composer tab starts on Note');
  } finally { x.close(); }
  assert.deepEqual(x.errors, []);
});

// ONE ROW OF CATEGORY SUGGESTIONS, as many as fit. Eight seasonal picks with their emoji
// wrapped one stray pick onto a second row; how many fit depends on the window, the language
// and the emoji, so the row is fitted, and fitted again when the window changes.
test('category suggestions keep to one row, as many as fit', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openCompose(x);
    await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Recipe').click()`);
    await sleep(300);
    const rows = `(() => { const shown = [...document.querySelectorAll('.lf-recipe .lf-chip-hint')].filter((b) => b.offsetParent);
      return { shown: shown.length, total: document.querySelectorAll('.lf-recipe .lf-chip-hint').length, rows: new Set(shown.map((b) => b.offsetTop)).size }; })()`;
    await tab.viewport({ width: 520, height: 900, scale: 1 }); await sleep(400);
    const narrow = await tab.evaluate(rows);
    assert.equal(narrow.rows, 1, 'the suggestions wrapped at a narrow width');
    assert.ok(narrow.shown > 0 && narrow.shown < narrow.total, `a narrow width shows some, not all: ${JSON.stringify(narrow)}`);
    await tab.viewport({ width: 1600, height: 900, scale: 1 }); await sleep(400);
    const wide = await tab.evaluate(rows);
    assert.equal(wide.rows, 1);
    assert.ok(wide.shown > narrow.shown, `a wider window shows more again: ${JSON.stringify(wide)}`);
  } finally { x.close(); }
  assert.deepEqual(x.errors, []);
});
