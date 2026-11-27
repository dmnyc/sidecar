'use strict';

// A LINK WRITTEN http:// IS OFFERED A SWITCH TO https, AND HOLDS THE FIRST PRESS OF POST, in the
// real extension: the panel's composer, the full-size one, and a recipe. The offer is a quiet
// row under the editor, like the tracking-tags one; Use https switches the link where it was
// written and publishes nothing. Post with an http link still in the text is held once, and
// the next press sends it as it is. The two offers fix the same link in either order.
// The countdown is off, so a press of Post that gets through publishes at once, and the relay
// is what says whether anything went out.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no browser found', timeout: 180000 };
const LINK = 'http://food.example.com/pie';
const PAUSE = 1000; // past the offers' wait for a pause in the typing

async function openComposer(x, page) {
  const tab = await x.openPage(`chrome-extension://${x.extId}/${page === 'panel' ? 'sidepanel' : 'compose'}.html`);
  if (page === 'panel') {
    await tab.viewport({ width: 380, height: 820, scale: 1 });
    for (let i = 0; i < 40 && !(await tab.evaluate(`!!document.getElementById('compose-fab')`)); i++) await sleep(250);
    await sleep(800);
    await tab.evaluate(`document.getElementById('compose-fab').click()`); await sleep(400);
    await tab.evaluate(`document.getElementById('compose-note-btn').click()`); await sleep(800);
  }
  const ED = page === 'panel' ? '#modal .compose-editor' : '.compose-editor';
  const WRAP = page === 'panel' ? '#modal .compose-editor-wrap' : '.compose-editor-wrap';
  for (let i = 0; i < 60 && !(await tab.evaluate(`!!document.querySelector('${ED}') && !document.documentElement.classList.contains('compose-booting')`)); i++) await sleep(250);
  await sleep(600);
  const POST = page === 'panel' ? `document.querySelector('#modal .actions .primary')` : `document.getElementById('compose-post')`;
  const row = (cls) => `document.querySelector('${WRAP} .${cls}')`;
  return {
    tab,
    // A new account's first note comes with a suggestion in it; start from an empty editor.
    clear: async () => { await tab.evaluate(`(() => { const ed = document.querySelector('${ED}'); ed.innerHTML = ''; ed.focus(); ed.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(200); },
    type: async (text) => { await tab.evaluate(`document.querySelector('${ED}').focus()`); await tab.type(text); await sleep(PAUSE); },
    text: () => tab.evaluate(`SidecarCore.serializeEditor(document.querySelector('${ED}'))`),
    post: async () => { await tab.evaluate(`${POST}.click()`); await sleep(600); },
    // The http row as it stands: null when it is not on screen.
    http: () => tab.evaluate(`(() => { const r = ${row('http-row')}; if (!r || r.classList.contains('hidden')) return null;
      const n = r.querySelector('.http-note'); const up = !n.classList.contains('hidden');
      return { held: r.classList.contains('is-held'), note: up ? n.querySelector('.http-note-text').textContent : '', links: up ? [...n.querySelectorAll('li')].map((l) => l.textContent) : [], button: r.querySelector('button').textContent }; })()`),
    tracking: () => tab.evaluate(`(() => { const r = ${row('track-row')}; return !!r && !r.classList.contains('hidden'); })()`),
    useHttps: async () => { await tab.evaluate(`${row('http-row')}.querySelector('button').click()`); await sleep(400); },
    cleanTracking: async () => { await tab.evaluate(`${row('track-row')}.querySelector('button').click()`); await sleep(400); },
  };
}
const notes = (x) => x.relay.events.filter((e) => e.kind === 1 && e.pubkey === x.me);
async function published(x) {
  for (let i = 0; i < 40 && !notes(x).length; i++) await sleep(250);
  return notes(x);
}
async function start(t, settings) {
  try { return await startExtension({ settings }); } catch (e) { if (e.skip) { t.skip(e.message); return null; } throw e; }
}

for (const PAGE of ['panel', 'compose']) {
  const where = PAGE === 'panel' ? 'the panel' : 'the full-size composer';

  test(`in ${where}, an http link is offered Use https, and Post is held until it is pressed again`, opts, async (t) => {
    const x = await start(t, { noteCountdown: false });
    if (!x) return;
    try {
      await x.reload();
      const c = await openComposer(x, PAGE);
      await c.clear();
      await c.type(`Pie night: ${LINK} and https://safe.example.com`);
      assert.deepEqual(await c.http(), { held: false, note: '', links: [], button: 'Use https' }, 'no quiet offer while writing');

      await c.post();
      assert.deepEqual(await c.http(), { held: true, note: 'This link uses http, not https. Press Post again to send it as is.', links: [LINK], button: 'Use https' });
      assert.equal(notes(x).length, 0, 'the first press published');

      await c.useHttps();
      assert.equal(await c.text(), 'Pie night: https://food.example.com/pie and https://safe.example.com');
      assert.equal(await c.http(), null, 'the row stayed up');
      await sleep(800);
      assert.equal(notes(x).length, 0, 'Use https published');

      await c.post();
      const out = await published(x);
      assert.equal(out.length, 1);
      assert.equal(out[0].content, 'Pie night: https://food.example.com/pie and https://safe.example.com');
      assert.deepEqual(x.errors, []);
    } finally { x.close(); }
  });

  test(`in ${where}, a second press sends the http link as written, and a new link is asked about again`, opts, async (t) => {
    const x = await start(t, { noteCountdown: false });
    if (!x) return;
    try {
      await x.reload();
      const c = await openComposer(x, PAGE);
      await c.clear();
      await c.type(`Pie night: ${LINK}`);
      await c.post();
      assert.equal((await c.http()).held, true, 'not held');
      // Another http link is a different question: the hold lets go, and the next press asks.
      await c.type(' and http://cake.example.com');
      assert.equal((await c.http()).held, false, 'still held over the old links');
      assert.equal((await c.http()).button, 'Use https for 2 links', 'the button does not say how many');
      await c.post();
      const two = await c.http();
      assert.match(two.note, /^These 2 links use http/);
      assert.deepEqual(two.links, [LINK, 'http://cake.example.com'], 'the links are not named');
      assert.equal(notes(x).length, 0);
      // Words that leave the links alone keep the hold: the next press goes.
      await c.type('!');
      await c.post();
      const out = await published(x);
      assert.equal(out.length, 1);
      assert.equal(out[0].content, `Pie night: ${LINK} and http://cake.example.com!`);
      assert.deepEqual(x.errors, []);
    } finally { x.close(); }
  });

  test(`in ${where}, past three links the held note names three and counts the rest`, opts, async (t) => {
    const x = await start(t, { noteCountdown: false });
    if (!x) return;
    try {
      await x.reload();
      const c = await openComposer(x, PAGE);
      await c.clear();
      await c.type('a http://a.example.com b http://b.example.com c http://c.example.com d http://d.example.com e http://e.example.com');
      assert.equal((await c.http()).button, 'Use https for 5 links');
      await c.post();
      assert.deepEqual((await c.http()).links, ['http://a.example.com', 'http://b.example.com', 'http://c.example.com', 'and 2 more']);
      await c.useHttps();
      assert.equal(await c.text(), 'a https://a.example.com b https://b.example.com c https://c.example.com d https://d.example.com e https://e.example.com');
      assert.equal(await c.http(), null);
      assert.equal(notes(x).length, 0);
      assert.deepEqual(x.errors, []);
    } finally { x.close(); }
  });

  // Each composer takes the two fixes in a different order.
  const httpsFirst = PAGE === 'panel';
  test(`in ${where}, a link with tracking tags and http takes both fixes, ${httpsFirst ? 'https' : 'tracking'} first`, opts, async (t) => {
    const x = await start(t, { noteCountdown: false });
    if (!x) return;
    try {
      await x.reload();
      const c = await openComposer(x, PAGE);
      await c.clear();
      await c.type(`Pie night: ${LINK}?utm_source=feed&id=4`);
      assert.equal(await c.tracking(), true, 'no tracking offer');
      assert.ok(await c.http(), 'no https offer');
      if (httpsFirst) {
        await c.useHttps();
        assert.equal(await c.tracking(), true, 'the tracking offer went with the http one');
        await c.cleanTracking();
      } else {
        await c.cleanTracking();
        assert.ok(await c.http(), 'the https offer went with the tracking one');
        await c.useHttps();
      }
      assert.equal(await c.text(), 'Pie night: https://food.example.com/pie?id=4');
      assert.equal(await c.tracking(), false);
      assert.equal(await c.http(), null);

      // A tracked link typed away takes its offer with it, rather than leaving a button that
      // does nothing.
      await c.clear();
      await c.type('https://food.example.com/?utm_source=feed');
      assert.equal(await c.tracking(), true);
      await c.clear();
      assert.equal(await c.tracking(), false, 'the tracking offer outlived its link');

      assert.equal(notes(x).length, 0);
      assert.deepEqual(x.errors, []);
    } finally { x.close(); }
  });
}

test('a recipe’s http source is offered Use https, and the first Review is held', opts, async (t) => {
  const x = await start(t);
  if (!x) return;
  try {
    await x.reload();
    const { tab } = await openComposer(x, 'compose');
    for (let i = 0; i < 40 && !(await tab.evaluate(`!!window.SidecarLongform`)); i++) await sleep(250);
    await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Recipe').click()`);
    await tab.evaluate(`(() => {
      const L = window.SidecarLongform.state.recipe;
      L.title = 'Apple Pie'; L.photos.push({ url: 'https://example.com/pie.jpg', alt: 'A pie' }); L.categories.push('Pie'); L.ingredients.push('6 apples'); L.directions.push('Bake. Tips at ${LINK}'); L.source = '${LINK}/original';
      window.SidecarLongform.refresh();
      window.SidecarLongform.changed();
    })()`);
    await sleep(PAUSE);
    const ROW = `[...document.querySelectorAll('.http-row')].find((r) => !r.closest('.compose-editor-wrap'))`;
    const row = () => tab.evaluate(`(() => { const r = ${ROW}; return r && !r.classList.contains('hidden') && { held: r.classList.contains('is-held'), note: r.querySelector('.http-note-text').textContent, button: r.querySelector('button').textContent }; })()`);
    assert.deepEqual(await row(), { held: false, note: '', button: 'Use https for 2 links' }, 'no offer on the recipe');
    const reviewOpen = () => tab.evaluate(`!document.getElementById('compose-countdown').classList.contains('hidden')`);

    await tab.evaluate(`document.getElementById('compose-post').click()`);
    await sleep(600);
    assert.deepEqual(await row(), { held: true, note: 'These 2 links use http, not https. Press Review again to send them as is.', button: 'Use https for 2 links' });
    assert.equal(await reviewOpen(), false, 'the review opened on the first press');

    await tab.evaluate(`${ROW}.querySelector('button').click()`);
    await sleep(400);
    const rec = await tab.evaluate(`JSON.parse(JSON.stringify(window.SidecarLongform.state.recipe))`);
    assert.equal(rec.source, 'https://food.example.com/pie/original');
    assert.deepEqual(rec.directions, ['Bake. Tips at https://food.example.com/pie']);
    // The Source box on screen, not only the draft behind it.
    assert.deepEqual(await tab.evaluate(`[...document.querySelectorAll('.lf-recipe input[type="url"]')].map((i) => i.value).filter(Boolean)`), ['https://food.example.com/pie/original'], 'the form still shows http');
    assert.equal(await row(), false, 'the offer stayed up');

    // Review again: nothing to hold now, straight to the review screen.
    await tab.evaluate(`document.getElementById('compose-post').click()`);
    for (let i = 0; i < 30 && !(await reviewOpen()); i++) await sleep(100);
    assert.equal(await reviewOpen(), true, 'no review screen');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
