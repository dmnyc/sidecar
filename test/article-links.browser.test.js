'use strict';

// AN ARTICLE OPENS WHERE THE CLIENT READS ARTICLES, AND CAN BE FOUND THERE. Every client Sidecar
// offers draws a long-form article from its naddr, but five answer one on their note route with
// an error page, and an naddr with no relays in it reads "not found" wherever the article is not
// on the client's own relays. Run in the real extension against a relay on localhost: a bookmark
// and a notification are pressed, and the address that went to the client is read back.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };
const NOW = () => Math.floor(Date.now() / 1000);
const ELSEWHERE = 'wss://writes.example.com';

const openedUrls = (calls) => calls
  .filter((c) => c.call === 'create' || c.call === 'update')
  .map((c) => (c.call === 'create' ? c.args[0] : c.args[1]).url)
  .filter(Boolean);
const naddrIn = (x, url) => { const m = /(naddr1[0-9a-z]+)/.exec(url || ''); return m ? x.nt.decode(m[1]).data : null; };

async function withExtension(t, o, fn) {
  let x;
  try { x = await startExtension(o); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try { await fn(x); } finally { x.close(); }
}

async function pressAndRead(x, expression) {
  await x.clearCalls();
  await x.evaluate(expression);
  await x.waitFor('window.__calls.some((c) => c.call === "create" || c.call === "update")', 8000);
  const urls = openedUrls(await x.calls());
  assert.equal(urls.length, 1, 'one address opened');
  return urls[0];
}

test('a bookmarked article opens on the client’s article route, with where its author writes; a recipe, old tag or new, opens in Zap Cooking', opts, async (t) => {
  await withExtension(t, { settings: { defaultClient: 'yakihonne' } }, async (x) => {
    const now = NOW();
    x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Bea' }) }, 'bea');
    x.put({ kind: 10002, created_at: now - 9000, tags: [['r', ELSEWHERE, 'write'], ['r', x.relay.url]], content: '' }, 'bea');
    x.put({ kind: 30023, created_at: now - 6000, tags: [['d', 'on-soup'], ['title', 'On soup, at length']], content: 'Long body' }, 'bea');
    x.put({ kind: 30023, created_at: now - 5000, tags: [['d', 'pea-soup'], ['title', 'Pea soup'], ['t', 'zapcooking'], ['t', 'zapcooking-pea-soup']], content: '## Ingredients\n\n- peas' }, 'bea');
    // Tagged as Zap Cooking tagged recipes before it was renamed.
    x.put({ kind: 30023, created_at: now - 4000, tags: [['d', 'old-borscht'], ['title', 'Old borscht'], ['t', 'nostrcooking'], ['t', 'nostrcooking-old-borscht']], content: '## Ingredients\n\n- beets' }, 'bea');
    x.put({ kind: 10003, created_at: now - 50, tags: [['a', '30023:' + x.bea + ':on-soup'], ['a', '30023:' + x.bea + ':pea-soup'], ['a', '30023:' + x.bea + ':old-borscht']], content: '' }, 'me');
    await x.reload();
    await x.recordTabs();
    await x.evaluate(`document.getElementById('bookmarks-btn').click()`);
    await x.waitFor(`['Pea soup', 'Old borscht', 'On soup'].every((s) => (document.querySelector('#modal .bm-scroll') || {}).innerText?.includes(s))`, 15000);
    const kindOf = (title) => x.evaluate(`[...document.querySelectorAll('#modal .bm-item')].find((r) => r.innerText.includes(${JSON.stringify(title)})).innerText`);
    assert.match(await kindOf('On soup, at length'), /\barticle\b/);
    assert.match(await kindOf('Pea soup'), /\brecipe\b/, 'a recipe is labeled as an article');
    assert.match(await kindOf('Old borscht'), /\brecipe\b/, 'an old-format recipe is labeled as an article');
    const row = (title) => `[...document.querySelectorAll('#modal .bm-item')].find((r) => r.innerText.includes(${JSON.stringify(title)})).click()`;

    const article = await pressAndRead(x, row('On soup, at length'));
    assert.match(article, /^https:\/\/yakihonne\.com\/article\/naddr1/, 'not YakiHonne’s article route');
    const a = naddrIn(x, article);
    assert.deepEqual([a.kind, a.pubkey, a.identifier], [30023, x.bea, 'on-soup']);
    assert.ok(a.relays.map((u) => u.replace(/\/$/, '')).includes(ELSEWHERE), 'the naddr does not say where its author writes: ' + JSON.stringify(a.relays));

    const recipe = await pressAndRead(x, row('Pea soup'));
    assert.match(recipe, /^https:\/\/zap\.cooking\/r\/naddr1/, 'a recipe did not open in Zap Cooking');
    assert.equal(naddrIn(x, recipe).identifier, 'pea-soup');

    const old = await pressAndRead(x, row('Old borscht'));
    assert.match(old, /^https:\/\/zap\.cooking\/r\/naddr1/, 'an old-format recipe did not open in Zap Cooking');
    assert.equal(naddrIn(x, old).identifier, 'old-borscht');
    assert.deepEqual(x.errors, []);
  });
});

test('a reaction to your article opens the article by address, on the article route, with your relays in it', opts, async (t) => {
  await withExtension(t, { settings: { defaultClient: 'yakihonne' } }, async (x) => {
    const now = NOW();
    x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Bea' }) }, 'bea');
    x.put({ kind: 10002, created_at: now - 9000, tags: [['r', x.relay.url], ['r', ELSEWHERE, 'write']], content: '' }, 'me');
    const mine = x.put({ kind: 30023, created_at: now - 6000, tags: [['d', 'my-piece'], ['title', 'My piece']], content: 'Body' }, 'me');
    const coord = '30023:' + x.me + ':my-piece';
    // As clients write one: the revision's id, the address, the author, the kind.
    x.put({ kind: 7, created_at: now - 60, tags: [['e', mine.id], ['a', coord], ['p', x.me], ['k', '30023']], content: '+' }, 'bea');
    await x.reload();
    await x.recordTabs();
    await x.evaluate(`document.getElementById('notif-bell-btn').click()`);
    await x.waitFor(`document.querySelectorAll('#modal .notif-item.notif-clickable').length >= 1`, 15000);
    const url = await pressAndRead(x, `document.querySelector('#modal .notif-item.notif-clickable').click()`);
    assert.match(url, /^https:\/\/yakihonne\.com\/article\/naddr1/, 'the row opened the revision, or on the note route: ' + url);
    const a = naddrIn(x, url);
    assert.deepEqual([a.kind, a.pubkey, a.identifier], [30023, x.me, 'my-piece']);
    assert.ok(a.relays.map((u) => u.replace(/\/$/, '')).includes(ELSEWHERE), 'the naddr does not say where you write: ' + JSON.stringify(a.relays));
    assert.deepEqual(x.errors, []);
  });
});

test('every client takes an naddr on its article route and keeps its note route for notes', opts, async (t) => {
  await withExtension(t, {}, async (x) => {
    await x.reload();
    const got = await x.evaluate(`(() => {
      const NT = window.NostrTools;
      const pk = '${'ab'.repeat(32)}';
      const naddr = NT.nip19.naddrEncode({ kind: 30023, pubkey: pk, identifier: 'x', relays: [] });
      const nevent = NT.nip19.neventEncode({ id: '${'cd'.repeat(32)}', relays: [] });
      const out = {};
      for (const [k, c] of Object.entries(window.SidecarCore.VIEW_CLIENTS)) {
        out[k] = { article: c.url(naddr).replace(naddr, '{naddr}'), note: c.url(nevent).replace(nevent, '{nevent}') };
      }
      return out;
    })()`);
    // Read out of each client and loaded logged out with a real article.
    assert.deepEqual(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.article])), {
      jumble: 'https://jumble.social/notes/{naddr}',
      primal: 'https://primal.net/a/{naddr}',
      yakihonne: 'https://yakihonne.com/article/{naddr}',
      iris: 'https://iris.to/{naddr}',
      snort: 'https://snort.social/{naddr}',
      nostrudel: 'https://nostrudel.ninja/#/articles/{naddr}',
      zapcooking: 'https://zap.cooking/r/{naddr}',
      noornote: 'https://noornote.app/article/{naddr}',
      jank: 'https://jank.army/notes/{naddr}',
      nostrvault: 'https://nostrvault.app/thread/{naddr}',
      ditto: 'https://ditto.pub/{naddr}',
      razr: 'https://razr.social/a/{naddr}',
      grimoire: 'https://grimoire.rocks/run?cmd=open%20{naddr}',
      coracle: 'https://coracle.social/{naddr}',
      njump: 'https://njump.me/{naddr}',
    });
    // Notes go where they always went.
    assert.equal(got.yakihonne.note, 'https://yakihonne.com/note/{nevent}');
    assert.equal(got.primal.note, 'https://primal.net/e/{nevent}');
    assert.equal(got.nostrudel.note, 'https://nostrudel.ninja/#/n/{nevent}');
    assert.match(got.razr.note, /^https:\/\/razr\.social\/e\/note1/);
    assert.deepEqual(x.errors, []);
  });
});
