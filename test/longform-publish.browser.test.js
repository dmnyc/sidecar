'use strict';

// Publishing an article and a recipe from the full-size composer, in the real extension.
// The relay side is stood in for (window.SidecarComposePublish.publish and findOwn): what is
// checked is the event the page builds, the question asked before an address is reused, the
// draft clearing only once the piece is out, and the receipt's links.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

async function openCompose(x) {
  const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
  for (let i = 0; i < 60; i++) {
    if (await tab.evaluate(`!!document.querySelector('.compose-editor') && !!window.SidecarLongform && !!window.SidecarComposePublish && !document.documentElement.classList.contains('compose-booting')`)) break;
    await sleep(250);
  }
  await sleep(500);
  return tab;
}

// Stand in for the relays: record what would be published, answer findOwn from `taken`.
const STUB = (taken) => `(() => {
  window.__published = [];
  const api = window.SidecarComposePublish;
  const taken = ${JSON.stringify(taken)};
  api.findOwn = async (d) => taken.includes(d) ? [{ created_at: 1, tags: [['d', d], ['title', 'The old one']] }] : [];
  api.publish = async ({ template }) => {
    window.__published.push(template);
    return { signed: { ...template, id: 'f'.repeat(64), pubkey: api.pubkey() }, report: { accepted: ['wss://relay.example/'], failed: [], total: 1 } };
  };
})()`;

const type = (sel, text) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); document.execCommand('insertText', false, ${JSON.stringify(text)}); })()`;

test('an article publishes as NIP-23, clears its draft, and ends on a receipt', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openCompose(x);
    await tab.evaluate(STUB([]));
    await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Article').click()`);
    // Nothing yet: off, and the footer says what is missing.
    assert.equal(await tab.evaluate(`document.getElementById('compose-post').disabled`), true);
    assert.match(await tab.evaluate(`document.querySelector('.lf-missing').textContent`), /a title/);
    await tab.evaluate(type('.lf-article .lf-title', 'Hello, Long Form!'));
    await tab.evaluate(type('.lf-article .lf-body', '## Part one\n\nSome **bold** words.'));
    await tab.evaluate(type('.lf-article .lf-chip-input', 'Nostr'));
    await tab.evaluate(`document.querySelector('.lf-article .lf-chip-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await sleep(200);
    // The Preview renders the markdown, with no HTML from the body.
    await tab.evaluate(`[...document.querySelectorAll('.lf-body-tabs .compose-tab')][1].click()`);
    assert.equal(await tab.evaluate(`document.querySelector('.lf-preview h2').textContent`), 'Part one');
    assert.equal(await tab.evaluate(`document.querySelector('.lf-preview strong').textContent`), 'bold');
    await tab.evaluate(`[...document.querySelectorAll('.lf-body-tabs .compose-tab')][0].click()`);

    assert.equal(await tab.evaluate(`document.getElementById('compose-post').disabled`), false);
    await tab.evaluate(`document.getElementById('compose-post').click()`);
    // The review countdown, if the account has one, is pressed through.
    for (let i = 0; i < 20 && !(await tab.evaluate(`window.__published.length`)); i++) {
      await tab.evaluate(`(() => { const b = [...document.querySelectorAll('#compose-countdown button')].find((b) => /now/i.test(b.textContent)); if (b) b.click(); })()`);
      await sleep(250);
    }
    const ev = (await tab.evaluate(`window.__published`))[0];
    assert.equal(ev.kind, 30023);
    assert.equal(ev.content, '## Part one\n\nSome **bold** words.');
    const tag = (k) => ev.tags.filter((x) => x[0] === k).map((x) => x[1]);
    assert.deepEqual(tag('d'), ['hello-long-form']);
    assert.deepEqual(tag('title'), ['Hello, Long Form!']);
    assert.deepEqual(tag('t'), ['nostr']);
    assert.equal(tag('published_at').length, 1);
    assert.deepEqual(tag('client'), ['Sidecar']);

    await sleep(400);
    assert.equal(await tab.evaluate(`document.querySelector('.compose-done-title').textContent`), 'Your article is live.');
    const href = await tab.evaluate(`document.querySelector('.compose-done-open').href`);
    assert.match(href, /^https:\/\/jumble\.social\/notes\/naddr1/);
    // The draft is gone from the store once the article is out.
    const store = await x.message({ type: 'SIDECAR_SECRET_GET', store: 'longform' });
    const mine = Object.values((store && store.result) || store || {})[0];
    assert.ok(!mine || !mine.article, 'the published article stayed as a draft');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('a recipe publishes in Zap Cooking\'s format, and a used address is asked about first', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openCompose(x);
    await tab.evaluate(STUB(['apple-pie']));
    await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Recipe').click()`);
    await tab.evaluate(`(() => {
      const L = window.SidecarLongform.state.recipe;
      L.title = 'Apple Pie'; L.photos.push({ url: 'https://example.com/pie.jpg', alt: 'A pie' });
      L.ingredients.push('6 apples'); L.directions.push('Bake.'); L.categories.push('Pie');
      window.SidecarLongform.refresh();
    })()`);
    await sleep(200);
    assert.equal(await tab.evaluate(`document.getElementById('compose-post').disabled`), false);
    await tab.evaluate(`document.getElementById('compose-post').click()`);
    // The address is taken: asked, not replaced.
    for (let i = 0; i < 20 && (await tab.evaluate(`document.querySelector('.lf-confirm').classList.contains('hidden')`)); i++) await sleep(100);
    assert.match(await tab.evaluate(`document.querySelector('.lf-confirm .confirm-msg').textContent`), /The old one/);
    assert.equal(await tab.evaluate(`window.__published.length`), 0);
    await tab.evaluate(`[...document.querySelectorAll('.lf-confirm button')].find((b) => b.textContent === 'Publish as a new one').click()`);
    for (let i = 0; i < 20 && !(await tab.evaluate(`window.__published.length`)); i++) {
      await tab.evaluate(`(() => { const b = [...document.querySelectorAll('#compose-countdown button')].find((b) => /now/i.test(b.textContent)); if (b) b.click(); })()`);
      await sleep(250);
    }
    const ev = (await tab.evaluate(`window.__published`))[0];
    const tag = (k) => ev.tags.filter((x) => x[0] === k).map((x) => x[1]);
    assert.deepEqual(tag('d'), ['apple-pie-2']);
    // The title tag is zapcooking- plus the address actually used, -2 and all: Zap Cooking's
    // recipe page tells the title tag from the categories by that match, and without it shows none.
    assert.deepEqual(tag('t'), ['zapcooking', 'zapcooking-apple-pie-2', 'zapcooking-pie']);
    assert.deepEqual(tag('image'), ['https://example.com/pie.jpg']);
    assert.deepEqual(ev.tags.find((x) => x[0] === 'imeta'), ['imeta', 'url https://example.com/pie.jpg', 'alt A pie']);
    assert.equal(ev.content, '\n## Ingredients\n\n- 6 apples\n\n\n## Directions\n\n1. Bake.\n');
    await sleep(400);
    const links = await tab.evaluate(`[...document.querySelectorAll('.compose-done-open')].map((a) => [a.textContent, a.href])`);
    assert.equal(links[0][0], 'View on Zap Cooking');
    assert.match(links[0][1], /^https:\/\/zap\.cooking\/r\/naddr1/);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
