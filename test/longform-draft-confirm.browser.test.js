'use strict';

// ARTICLE AND RECIPE ROWS IN SAVED DRAFTS ASK AS THE NOTE ROWS DO. Their trash used to ask a
// question that never went away, and a tap on the row while it asked opened the draft
// instead of deleting it, the opposite of the note rows in the same list. Now the first tap
// on the trash asks, the question goes back on its own after a few seconds, and the second
// tap, on the trash or anywhere on the row, deletes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

// Found by the snippet it shows at rest, remembered on the row, since asking rewrites the snippet.
const row = (name) => `(() => { for (const r of document.querySelectorAll('#modal .lf-saved-drafts .saved-draft')) { if (!r.dataset.was) r.dataset.was = r.querySelector('.saved-draft-snip').textContent; if (r.dataset.was === ${JSON.stringify(name)}) return r; } return null; })()`;
const look = (name) => `(() => { const r = ${row(name)}; return r ? {
  label: r.querySelector('.saved-draft-label').textContent,
  snip: r.querySelector('.saved-draft-snip').textContent,
  meta: !r.querySelector('.saved-draft-meta').classList.contains('hidden'),
  asking: r.classList.contains('confirming'),
} : null; })()`;

test('an article row asks before it deletes, lets the question go, and deletes on a tap anywhere on it', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const pk = (await x.message({ type: 'SIDECAR_GET_STATE' })).result.activePubkey;
    const now = Date.now();
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [pk]: { text: 'A note', media: [], savedAt: now } } });
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'longform', value: { [pk]: {
      article: { title: 'An article', summary: '', body: 'Its body', savedAt: now },
      recipe: { title: 'A recipe', summary: '', ingredients: [], savedAt: now },
    } } });
    await x.evaluate(`document.getElementById('compose-fab').click()`); await sleep(400);
    await x.evaluate(`document.getElementById('compose-note-btn').click()`);
    await x.waitFor(`[...document.querySelectorAll('#modal button')].some((b) => b.textContent === 'Resume draft')`);
    await x.evaluate(`[...document.querySelectorAll('#modal button')].find((b) => b.textContent === 'Resume draft').click()`);
    await x.waitFor(`!!document.querySelector('#modal .compose-drafts-btn:not(.hidden)')`);
    await x.evaluate(`document.querySelector('#modal .compose-drafts-btn').click()`);
    await x.waitFor(`!!${row('An article')}`);
    const calm = { label: 'Article', snip: 'An article', meta: true, asking: false };
    assert.deepEqual(await x.evaluate(look('An article')), calm);

    // The first tap asks, in the note rows' words.
    await x.evaluate(`${row('An article')}.querySelector('.saved-draft-x').click()`);
    const asking = { label: 'Delete this draft?', snip: 'Tap again to delete', meta: false, asking: true };
    assert.deepEqual(await x.evaluate(look('An article')), asking);
    // Left alone, the question goes back.
    await x.front();
    await sleep(4500);
    assert.deepEqual(await x.evaluate(look('An article')), calm);

    // Asked again, a tap on the row deletes: it does not open the draft.
    await x.evaluate(`${row('An article')}.querySelector('.saved-draft-x').click()`);
    assert.deepEqual(await x.evaluate(look('An article')), asking);
    await x.recordTabs();
    await x.evaluate(`${row('An article')}.querySelector('.saved-draft-open').click()`);
    await x.waitFor(`!${row('An article')}`);
    assert.deepEqual((await x.calls()).filter((c) => c.call === 'create'), [], 'the tap opened the article');
    const lf = (await x.message({ type: 'SIDECAR_SECRET_GET', store: 'longform' })).result;
    assert.equal(lf[pk].article, undefined, 'the article is still stored');
    assert.equal(lf[pk].recipe.title, 'A recipe');
    assert.deepEqual(await x.evaluate(look('A recipe')), { label: 'Recipe', snip: 'A recipe', meta: true, asking: false });
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

// The panel leaves a draft alone while a full-size composer has it open, since the tab would
// save it straight back. The row it was asking on comes back as it was, not stuck on Deleting.
test('a delete the panel declines puts the row back', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const pk = (await x.message({ type: 'SIDECAR_GET_STATE' })).result.activePubkey;
    const now = Date.now();
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [pk]: { text: 'A note', media: [], savedAt: now } } });
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'longform', value: { [pk]: {
      article: { title: 'An article', summary: '', body: 'Its body', savedAt: now },
    } } });
    await x.evaluate(`document.getElementById('compose-fab').click()`); await sleep(400);
    await x.evaluate(`document.getElementById('compose-note-btn').click()`);
    await x.waitFor(`!!document.querySelector('#modal .compose-drafts-btn:not(.hidden)') || [...document.querySelectorAll('#modal button')].some((b) => b.textContent === 'Resume draft')`);
    if (await x.evaluate(`[...document.querySelectorAll('#modal button')].some((b) => b.textContent === 'Resume draft')`)) {
      await x.evaluate(`[...document.querySelectorAll('#modal button')].find((b) => b.textContent === 'Resume draft').click()`);
      await x.waitFor(`!!document.querySelector('#modal .compose-drafts-btn:not(.hidden)')`);
    }
    await x.evaluate(`document.querySelector('#modal .compose-drafts-btn').click()`);
    await x.waitFor(`!!${row('An article')}`);
    // A full-size composer opens meanwhile (the panel sends you to it while it is open).
    const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
    await sleep(2500);
    await x.evaluate(`${row('An article')}.querySelector('.saved-draft-x').click()`);
    await x.evaluate(`${row('An article')}.querySelector('.saved-draft-x').click()`);
    await sleep(800);
    assert.deepEqual(await x.evaluate(look('An article')), { label: 'Article', snip: 'An article', meta: true, asking: false });
    assert.equal(await x.evaluate(`${row('An article')}.querySelector('.saved-draft-x').disabled`), false);
    const lf = (await x.message({ type: 'SIDECAR_SECRET_GET', store: 'longform' })).result;
    assert.equal(lf[pk].article.title, 'An article');
    await tab.close();
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
