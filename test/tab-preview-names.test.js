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
