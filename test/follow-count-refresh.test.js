'use strict';

// Following or unfollowing someone used to leave two figures stale: the
// Overview drawer's count and the Profile tab's. writeFollow already refreshed
// followCountCache, so the data was right and nothing was showing it — there
// was no refresh method, as Daniel put it when he hit it. The contract now:
// writeFollow announces 'sidecar-follows-changed' after the cache update, and
// both surfaces repaint their figure from that fresh cache in place.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const bare = src.replace(/^\s*\/\/.*$/gm, '');

function lift(decl) {
  const at = bare.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = bare.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < bare.length; j++) {
    if (bare[j] === '{') depth++;
    else if (bare[j] === '}' && --depth === 0) return bare.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

const PK = 'a'.repeat(64);
const tag = (c) => ['p', c.repeat(64)];

// writeFollow, run for real against stubs. listTags is the kind:3 the relays
// answer with; followListCache mimics the panel's loaded list.
function writeHarness({ listTags, followListCache = null } = {}) {
  const events = [];
  class CustomEvent { constructor(type) { this.type = type; } }
  const deps = {
    t: (s) => s,
    state: { activePubkey: PK },
    listRelays: async () => ['wss://x'],
    poolQuerySync: async () => listTags
      ? [{ pubkey: PK, created_at: 1, kind: 3, tags: listTags, content: '' }]
      : [],
    call: async (m) => ({ ...m.event, id: 'signed', sig: 'sig' }),
    publishSigned: async () => {},
    seedBaseline: () => {},
    followCountCache: new Map(),
    followListCache,
    followListPubkey: followListCache ? PK : null,
    forgetWot: () => {},
    document: { dispatchEvent: (e) => events.push(e.type) },
    CustomEvent,
  };
  // eslint-disable-next-line no-new-func
  const writeFollow = new Function(...Object.keys(deps), `${lift('async function writeFollow(')}; return writeFollow;`)(...Object.values(deps));
  return { writeFollow, cache: deps.followCountCache, events };
}

test('FOLLOWING SOMEONE REFRESHES THE CACHE AND ANNOUNCES IT', async () => {
  const h = writeHarness({ listTags: [tag('1'), tag('2')] });
  const changed = await h.writeFollow(PK, '3'.repeat(64), false);
  assert.equal(changed, true);
  assert.equal(h.cache.get(PK), 3, 'two follows plus the new one');
  assert.deepEqual(h.events, ['sidecar-follows-changed']);
});

test('UNFOLLOWING DOES THE SAME', async () => {
  const h = writeHarness({ listTags: [tag('1'), tag('2'), tag('3')] });
  const changed = await h.writeFollow(PK, '3'.repeat(64), true);
  assert.equal(changed, true);
  assert.equal(h.cache.get(PK), 2);
  assert.deepEqual(h.events, ['sidecar-follows-changed']);
});

test('A NO-OP (ALREADY IN THAT STATE) SAYS NOTHING', async () => {
  const h = writeHarness({ listTags: [tag('1'), tag('2')] });
  const changed = await h.writeFollow(PK, '1'.repeat(64), false);
  assert.equal(changed, false, 'the list already carried this follow');
  assert.deepEqual(h.events, [], 'nothing changed, so nothing is announced');
});

test('BOTH SURFACES HOLDING THE NUMBER LISTEN FOR THE ANNOUNCEMENT', () => {
  // The dispatcher is behavioral above; these are the two repaint hooks, each
  // attached to an element that dies with its render.
  const drawerHook = bare.indexOf("drawer.addEventListener('sidecar-follows-changed'");
  const profileHook = bare.indexOf("followNum.addEventListener('sidecar-follows-changed'");
  assert.ok(drawerHook > -1, 'the Overview drawer repaints its follow figure');
  assert.ok(profileHook > drawerHook, 'the Profile tab repaints its follow figure');
  // Each repaint reads the cache writeFollow just refreshed, and draws nothing
  // when there is no answer (the dash stays a dash).
  assert.match(bare.slice(drawerHook, drawerHook + 220), /followCountCache\.get\(pubkey\)/);
  assert.match(bare.slice(profileHook, profileHook + 220), /followCountCache\.get\(active\.pubkey\)/);
});
