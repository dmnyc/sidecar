'use strict';

// The full-size composer's preview named people by npub where the panel named them: its
// lookup asked the configured relays alone (which rarely carry a stranger's kind:0) and
// remembered a miss for the life of the tab. This runs the page's real lookup against
// stub relays.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const page = fs.readFileSync(path.join(__dirname, '..', 'compose.js'), 'utf8');

function lift(decl) {
  const at = page.indexOf(decl);
  assert.ok(at !== -1, 'compose.js no longer has ' + decl);
  const open = page.indexOf('{', page.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < page.length; i++) {
    if (page[i] === '{') depth++;
    else if (page[i] === '}' && --depth === 0) return page.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

const ME = 'a'.repeat(64);
const STRANGER = 'b'.repeat(64);

function tab({ answer = null, accounts = [] } = {}) {
  const asked = [];
  const ctx = {
    JSON, Promise, Set, setTimeout,
    profileCache: new Map(),
    state: { accounts },
    relayUrls: async () => ['wss://mine.example'],
    pool: () => ({ get: async (relays, filter) => { asked.push({ relays, filter }); return answer; } }),
  };
  vm.createContext(ctx);
  vm.runInContext(lift('async function fetchPreviewProfile(pubkey)') + '\nglobalThis.f = fetchPreviewProfile;', ctx);
  return { f: ctx.f, asked, ctx };
}
const kind0 = (pubkey, name) => ({ pubkey, content: JSON.stringify({ name, picture: 'https://p.example/x.png' }) });

test('your own accounts are named from the store, with no relay asked', async () => {
  const t = tab({ accounts: [{ pubkey: ME, name: 'Scrubby', picture: 'https://p.example/s.png' }] });
  const p = await t.f(ME);
  assert.equal(p.name, 'Scrubby');
  assert.equal(t.asked.length, 0);
});

test('a stranger is asked of purplepag.es beside the configured relays', async () => {
  const t = tab({ answer: kind0(STRANGER, 'Gatsby') });
  assert.equal((await t.f(STRANGER)).name, 'Gatsby');
  assert.deepEqual([...t.asked[0].relays], ['wss://mine.example', 'wss://purplepag.es']);
  // And remembered: the second preview costs nothing.
  await t.f(STRANGER);
  assert.equal(t.asked.length, 1);
});

test('a miss is not remembered, so the next preview asks again', async () => {
  const t = tab({ answer: null });
  assert.equal(await t.f(STRANGER), null);
  await t.f(STRANGER);
  assert.equal(t.asked.length, 2, 'one unanswered lookup left this person an npub for the life of the tab');
});

test('somebody else\'s kind:0 is never used', async () => {
  const t = tab({ answer: kind0(ME, 'Wrong') });
  assert.equal(await t.f(STRANGER), null);
  assert.equal(t.ctx.profileCache.size, 0);
});

// THE MENTION RESOLVER, composer-core's, which both composers' previews run. It asked the
// configured relays alone and cached a miss as an empty profile, and that empty entry then
// read as "no name" to the embed beside it, so both stayed npubs in the full-size composer.
const core = fs.readFileSync(path.join(__dirname, '..', 'composer-core.js'), 'utf8');
function liftCore(decl) {
  const at = core.indexOf(decl);
  assert.ok(at !== -1, 'composer-core.js no longer has ' + decl);
  const open = core.indexOf('{', core.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < core.length; i++) {
    if (core[i] === '{') depth++;
    else if (core[i] === '}' && --depth === 0) return core.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}
function resolver(events) {
  const cache = new Map();
  const asked = [];
  const deps = {
    cachedProfile: (pk) => cache.get(pk) || null,
    cacheProfile: (pk, c) => cache.set(pk, { name: c.display_name || c.name || '' }),
    relayUrls: async () => ['wss://mine.example'],
    poolQuerySync: async (relays, filter) => { asked.push({ relays, filter }); return events; },
  };
  const ctx = { deps, JSON, Promise, Set, setTimeout };
  vm.createContext(ctx);
  vm.runInContext(liftCore('async function resolveMentions(mentions)') + '\nglobalThis.r = resolveMentions;', ctx);
  return { r: ctx.r, cache, asked };
}

test('the preview\'s mention lookup asks purplepag.es and does not cache a miss', async () => {
  const el = { textContent: '@npub1…' };
  const t = resolver([{ pubkey: STRANGER, created_at: 1, content: JSON.stringify({ name: 'Gatsby' }) }]);
  await t.r([{ el, pubkey: STRANGER }, { el: { textContent: '' }, pubkey: ME }]);
  assert.equal(el.textContent, '@Gatsby');
  assert.deepEqual([...t.asked[0].relays], ['wss://mine.example', 'wss://purplepag.es']);
  assert.equal(t.cache.has(ME), false, 'a miss was cached as a nameless profile');
  // A name already cached is not asked for again.
  await t.r([{ el, pubkey: STRANGER }]);
  assert.equal(t.asked.length, 1);
});

test('the tab\'s profile cache knows your own accounts, and a nameless entry is a miss', () => {
  const ctx = { profileCache: new Map([[STRANGER, { pubkey: STRANGER, name: null }]]),
    state: { accounts: [{ pubkey: ME, name: 'Scrubby', picture: null }] } };
  vm.createContext(ctx);
  vm.runInContext(lift('function cachedProfile(pubkey)') + '\nglobalThis.c = cachedProfile;', ctx);
  assert.equal(ctx.c(ME).name, 'Scrubby');
  assert.equal(ctx.c(STRANGER).name, null);
});
