'use strict';

// Beside a quoted note, the pictures' row has a list button that opens and closes their
// links, whatever the count, and each link is copied from its own row. Before it, the
// links sat behind the "1 attachment" label, which reads as a heading like "Quoting".
// Against the real extension, in the full-size composer and in the panel's.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };
const NOTE = 'nostr:note1' + 'q'.repeat(58);
const A = 'https://example.com/wonka.gif';
const B = 'https://example.com/second.png';

// Copies land here instead of the system clipboard.
const STUB = `(() => { window.__copied = []; navigator.clipboard.writeText = (s) => { window.__copied.push(s); return Promise.resolve(); }; })()`;

async function seed(x, media) {
  const pk = (await x.message({ type: 'SIDECAR_GET_STATE' })).result.activePubkey;
  await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [pk]: { text: 'hi', media, savedAt: Date.now() } } });
}

async function openCompose(x) {
  const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
  for (let i = 0; i < 60; i++) {
    if (await tab.evaluate(`!!document.querySelector('.attach-group-label')`)) break;
    await sleep(250);
  }
  await tab.evaluate(STUB);
  return tab;
}

const listShown = (root) => `(() => { const l = ${root}.querySelector('.attach-group-list'); return !!l && !l.classList.contains('hidden') && l.offsetHeight > 0; })()`;
const rows = (root) => `[...${root}.querySelectorAll('.attach-group-list .compose-media-url')].map((e) => e.textContent)`;

async function opensAndCloses(evaluate, root, want) {
  const btn = `${root}.querySelector('.attach-group-label .attach-group-links')`;
  assert.equal(await evaluate(`${btn}.title`), 'Show links');
  assert.equal(await evaluate(`${btn}.getAttribute('aria-expanded')`), 'false');
  assert.equal(await evaluate(listShown(root)), false, 'the list started open');
  await evaluate(`${btn}.click()`);
  await sleep(200);
  assert.equal(await evaluate(listShown(root)), true, 'the list did not open');
  assert.deepEqual(await evaluate(rows(root)), want);
  assert.equal(await evaluate(`${btn}.title`), 'Hide links');
  assert.equal(await evaluate(`${btn}.getAttribute('aria-expanded')`), 'true');
  assert.deepEqual(await evaluate(`window.__copied`), [], 'the list button copied something');
  // A row copies its own link.
  await evaluate(`${root}.querySelectorAll('.attach-group-list .compose-media-copy')[${want.length - 1}].click()`);
  await sleep(200);
  assert.deepEqual(await evaluate(`window.__copied`), [want[want.length - 1]]);
  await evaluate(`${btn}.click()`);
  await sleep(200);
  assert.equal(await evaluate(listShown(root)), false, 'the list did not close');
}

test('one attachment beside a quote: the list button opens its link, in both composers', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    await seed(x, [{ url: A }, { quote: NOTE }]);
    const tab = await openCompose(x);
    await opensAndCloses((s) => tab.evaluate(s), 'document', [A]);
    await tab.close();

    // The panel's composer, from the same builder.
    await x.evaluate(STUB);
    await x.evaluate(`document.getElementById('compose-fab').click()`); await sleep(400);
    await x.evaluate(`document.getElementById('compose-note-btn').click()`);
    await x.waitFor(`[...document.querySelectorAll('#modal button')].some((b) => b.textContent === 'Resume draft') || !!document.querySelector('#modal .attach-group-links')`);
    const resume = `[...document.querySelectorAll('#modal button')].find((b) => b.textContent === 'Resume draft')`;
    if (await x.evaluate(`!!${resume}`)) await x.evaluate(`${resume}.click()`);
    await x.waitFor(`!!document.querySelector('#modal .attach-group-links')`);
    await opensAndCloses((s) => x.evaluate(s), `document.querySelector('#modal')`, [A]);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('several attachments beside a quote: the same button, the same list', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    await seed(x, [{ url: A }, { url: B }, { quote: NOTE }]);
    const tab = await openCompose(x);
    await opensAndCloses((s) => tab.evaluate(s), 'document', [A, B]);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
