'use strict';

// A hashtag typed into the search box opens in your client, in the real extension. It used to
// go to the name search: the dropdown looked for a person called "#myfirstnote", and Enter said
// there was no match. Now it offers one row, the tag, and sends nothing to any name search.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

// Tabs the panel asks for are recorded and not opened, so no test reaches a real client.
const holdTabs = `(() => { window.__opened = []; chrome.tabs.query = async () => []; chrome.tabs.create = async (o) => { __opened.push(o.url); return { id: 1, windowId: 1 }; }; return true; })()`;
const type = (text) => `(() => { const i = document.getElementById('search-input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const rows = `[...document.querySelectorAll('#search-results .ac-item')].map((r) => [...r.children].map((c) => c.textContent).join(' | '))`;
const ask = `!!document.querySelector('#search-results .na-ask')`;
const enter = `document.getElementById('search-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`;

test('a hashtag in the search box opens in your client, and is never searched as a name', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.evaluate(holdTabs);
    await x.evaluate(`document.getElementById('search-btn').click()`);

    // The one row a tag gets, and no ask to search names beyond your follows: the name search
    // has never been decided here, so a name would bring that ask.
    await x.evaluate(type('#MyFirstNote'));
    await x.waitFor(`document.querySelectorAll('#search-results .ac-item').length === 1`, 5000);
    assert.deepEqual(await x.evaluate(rows), ['# | #myfirstnote | Hashtag']);
    await sleep(400);
    assert.equal(await x.evaluate(ask), false, 'a hashtag was offered to the name search');

    // Enter opens it in the default client's search for the tag, and the box closes.
    await x.evaluate(enter);
    await x.waitFor(`__opened.length === 1`, 5000);
    assert.deepEqual(await x.evaluate(`__opened`), ['https://jumble.social/notes?t=myfirstnote']);
    assert.equal(await x.evaluate(`document.getElementById('search-bar').classList.contains('hidden')`), true);

    // A click opens it too. Any script's letters make a tag; a trailing _ is punctuation.
    await x.evaluate(`document.getElementById('search-btn').click()`);
    await x.evaluate(type('#café_'));
    await x.waitFor(`document.querySelectorAll('#search-results .ac-item').length === 1`, 5000);
    await x.evaluate(`document.querySelector('#search-results .ac-hashtag').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
    await x.waitFor(`__opened.length === 2`, 5000);
    assert.equal(await x.evaluate(`__opened[1]`), 'https://jumble.social/notes?' + new URLSearchParams({ t: 'café' }));

    // A number alone is not a tag, the way the composer reads one: it stays a name search.
    await x.evaluate(`document.getElementById('search-btn').click()`);
    await x.evaluate(type('#1'));
    await sleep(600);
    assert.equal(await x.evaluate(`!!document.querySelector('#search-results .ac-hashtag')`), false, '#1 was offered as a hashtag');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
