'use strict';

// A person you follow whose name is drawn in symbols or another script ("★ᗰ卂ᐯ★") could not
// be found by typing: the search of your follows compared what was typed with the name
// shown and nothing else, so their NIP-05 and lightning address, which is how people know
// them, found nobody. Against the REAL extension: the panel's search box, and the @mention
// in the full-size composer, which share the matching.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 150000 };

async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150); }
  return fn();
}

function people(x) {
  const now = Math.floor(Date.now() / 1000);
  x.put({ kind: 0, created_at: now - 500, tags: [], content: JSON.stringify({ name: '★ᗰ卂ᐯ★', display_name: '★ᗰ卂ᐯ★', nip05: 'doc@harbor.test' }) }, 'bea');
  x.put({ kind: 0, created_at: now - 500, tags: [], content: JSON.stringify({ display_name: '✦✦✦', lud16: 'quill@pay.test' }) }, 'cal');
  x.put({ kind: 0, created_at: now - 500, tags: [], content: JSON.stringify({ name: 'Plain Dan' }) }, 'dan');
  x.put({ kind: 3, created_at: now - 400, tags: [['p', x.bea], ['p', x.cal], ['p', x.dan]], content: '' }, 'me');
}

test('A FOLLOW IS FOUND BY THEIR NIP-05 OR LIGHTNING ADDRESS in the panel search', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    people(x);
    // Follows only: what is found here is found in the follow list, not by a search relay.
    await x.message({ type: 'SIDECAR_SET_SETTINGS', settings: { nameSearch: 'follows' } });
    await x.reload();
    await x.evaluate(`document.getElementById('search-btn').click()`);
    const search = async (text) => {
      await x.evaluate(`(() => { const i = document.getElementById('search-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      return until(async () => {
        const names = await x.evaluate(`[...document.querySelectorAll('#search-results .ac-item-name')].map((n) => n.textContent)`);
        return names.length ? names : null;
      }, 12000);
    };
    assert.deepEqual(await search('doc'), ['★ᗰ卂ᐯ★'], 'not found by the name in their NIP-05');
    assert.deepEqual(await search('harbor'), ['★ᗰ卂ᐯ★'], 'not found by the domain of their NIP-05');
    assert.deepEqual(await search('quill'), ['✦✦✦'], 'not found by their lightning address');
    assert.deepEqual(await search('plain'), ['Plain Dan'], 'a name stopped matching');
    assert.equal(await search('zzqx'), null, 'something matched nothing it should');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('and by the same in the full-size composer’s @mention', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    people(x);
    await x.message({ type: 'SIDECAR_SET_SETTINGS', settings: { nameSearch: 'follows' } });
    await x.reload();
    const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
    for (let i = 0; i < 60; i++) {
      if (await tab.evaluate(`!!document.querySelector('.compose-editor') && !document.documentElement.classList.contains('compose-booting')`)) break;
      await sleep(250);
    }
    const mention = async (text) => {
      await tab.evaluate(`(() => { const e = document.querySelector('.compose-editor'); e.focus(); document.execCommand('selectAll'); document.execCommand('delete'); document.execCommand('insertText', false, ${JSON.stringify('Hi @' + text)}); })()`);
      return until(async () => {
        const names = await tab.evaluate(`[...document.querySelectorAll('.ac-dropdown .ac-item-name')].map((n) => n.textContent)`);
        return names.length ? names : null;
      }, 20000);
    };
    assert.deepEqual(await mention('doc'), ['@★ᗰ卂ᐯ★'], 'not found by the name in their NIP-05');
    assert.deepEqual(await mention('quill'), ['@✦✦✦'], 'not found by their lightning address');
  } finally { x.close(); }
});
