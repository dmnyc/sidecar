'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const bare = source.replace(/^\s*\/\/.*$/gm, '');
function lift(name) {
  const at = bare.indexOf(name);
  assert.ok(at >= 0, name);
  const start = bare.indexOf('{', at);
  let depth = 0;
  for (let i = start; i < bare.length; i++) {
    if (bare[i] === '{') depth++;
    if (bare[i] === '}' && --depth === 0) return bare.slice(at, i + 1);
  }
  throw new Error(name);
}
function harness() {
  const live = [], history = [];
  const ctx = {
    state: { accounts: [{ pubkey: 'me' }], activePubkey: 'me' },
    _notifCache: new Map(), _ownNoteIds: new Map([['me', new Set(['old'])]]),
    _ownNoteIdsPromises: new Map(), _ownPollIds: new Map(), _muteLists: new Map(),
    _openNotifBell: null, OWN_NOTE_CEILING: 250, WEB_COMMENT_KIND: 1111, POLL_RESPONSE_KIND: 1018,
    loadNotifSeen: async () => {}, relayUrls: async () => ['wss://example.com'],
    loadMuteList: async () => {}, loadOwnPollIds: async () => new Set(),
    poolQuerySync: async () => [{ id: 'old', created_at: 1 }],
    isMutedNotif: (_, e) => e.muted === true,
    prefetchNotifProfile: async () => {}, zapSender: (e) => e.pubkey,
    pruneNameMuted: () => {}, refreshBell: () => {},
    setTimeout: () => 0, console,
    poolSubscribeMany: (urls, filter, params) => {
      const sub = { urls, filter, params, closed: false, close() { this.closed = true; } };
      live.push(sub); return sub;
    },
    poolSubscribeManyEose: (urls, filter, params) => {
      history.push({ urls, filter, params }); params.onclose?.(); return { close() {} };
    },
  };
  vm.createContext(ctx);
  for (const name of ['function rememberOwnNote(', 'function forgetOwnNoteQuery(', 'function loadOwnNoteIds(',
    'function isOwnNoteReply(', 'function closeNotifSubsExcept(', 'async function initNotifSubs(']) {
    vm.runInContext(lift(name), ctx);
  }
  return { ctx, live, history, active: () => live.filter((s) => !s.closed) };
}
const event = (id, kind, tags, rest = {}) => ({ id, kind, tags, pubkey: 'them', created_at: 10, ...rest });

test('discovery covers both reply kinds, including root authors with no known notes', async () => {
  const h = harness();
  h.ctx._ownNoteIds.clear(); h.ctx.poolQuerySync = async () => [];
  await h.ctx.initNotifSubs();
  assert.ok(h.active().some((s) => s.filter['#p']?.includes('me') && s.filter.kinds.includes(1) && s.filter.kinds.includes(1111)));
  const root = h.active().find((s) => s.filter['#P']);
  assert.ok(root.filter.kinds.includes(1111));
  root.params.onevent(event('root-comment', 1111, [['P', 'me'], ['K', '30023']]));
  assert.equal(h.ctx._notifCache.get('me').events.length, 1);
});

test('note-reference replies are accepted; citations are excluded; overlapping routes deduplicate', async () => {
  const h = harness(); await h.ctx.initNotifSubs();
  const replies = h.active().find((s) => s.filter['#e'] && s.filter.kinds.includes(1));
  assert.ok(replies);
  const send = replies.params.onevent;
  send(event('reply', 1, [['e', 'old', '', 'reply']]));
  send(event('reply', 1, [['e', 'old', '', 'reply'], ['p', 'me']]));
  send(event('citation', 1, [['e', 'other', '', 'root'], ['e', 'old', '', 'mention']]));
  send(event('legacy', 1, [['e', 'old']]));
  send(event('legacy-mention', 1, [['e', 'other'], ['e', 'old'], ['e', 'parent']]));
  send(event('muted', 1, [['e', 'old', '', 'root']], { muted: true }));
  send(event('self', 1, [['e', 'old', '', 'root']], { pubkey: 'me' }));
  send(event('mention', 1, [['p', 'me']]));
  send(event('quote', 1, [['q', 'old']]));
  assert.deepEqual(Array.from(h.ctx._notifCache.get('me').events, (e) => e.id), ['reply', 'legacy', 'mention', 'quote']);
});

test('publishing replaces live filters and closes old subscriptions without losing the cache', async () => {
  const h = harness(); await h.ctx.initNotifSubs();
  const previous = h.active(); const cache = h.ctx._notifCache.get('me');
  h.ctx.rememberOwnNote('me', 'new');
  assert.ok(previous.every((s) => s.closed));
  assert.equal(h.active().length, previous.length);
  assert.equal(h.ctx._notifCache.get('me'), cache);
  const replies = h.active().find((s) => s.filter.kinds.includes(1) && s.filter['#e']);
  assert.ok(replies.filter['#e'].includes('new'));
  assert.ok(h.active().find((s) => s.filter['#E']).filter['#E'].includes('new'));
  replies.params.onevent(event('new-reply', 1, [['e', 'new', '', 'root']]));
  assert.equal(cache.events[0].id, 'new-reply');
});

test('refresh discovers notes from another client and preserves locally published seeds', async () => {
  const h = harness(); await h.ctx.initNotifSubs();
  h.ctx.rememberOwnNote('me', 'local');
  h.ctx.poolQuerySync = async () => [{ id: 'external', created_at: 20 }];
  h.ctx.forgetOwnNoteQuery('me'); await h.ctx.loadOwnNoteIds('me', []);
  await h.ctx._notifCache.get('me').refetch();
  for (const id of ['local', 'external']) {
    assert.ok(h.active().find((s) => s.filter['#E']).filter['#E'].includes(id));
    assert.ok(h.history.at(-1).filter['#E'].includes(id));
  }
});

test('a late loader updates subscriptions but never restarts an inactive account', async () => {
  const h = harness(); await h.ctx.initNotifSubs();
  let finish;
  h.ctx.poolQuerySync = () => new Promise((r) => { finish = r; });
  h.ctx.forgetOwnNoteQuery('me');
  const pending = h.ctx.loadOwnNoteIds('me', []);
  h.ctx.rememberOwnNote('me', 'during-load');
  finish([{ id: 'late', created_at: 30 }]); await pending;
  assert.ok(h.active().find((s) => s.filter['#E']).filter['#E'].includes('during-load'));
  assert.ok(h.active().find((s) => s.filter['#E']).filter['#E'].includes('late'));
  h.ctx.state.activePubkey = 'other'; h.ctx.closeNotifSubsExcept('other');
  h.ctx.rememberOwnNote('me', 'inactive');
  assert.equal(h.active().length, 0);
});

test('the note ID collection stays bounded across loads and publishes', async () => {
  const h = harness();
  for (let i = 0; i < 300; i++) h.ctx.rememberOwnNote('me', String(i));
  await h.ctx.loadOwnNoteIds('me', []);
  assert.equal(h.ctx._ownNoteIds.get('me').size, 250);
  assert.ok(h.ctx._ownNoteIds.get('me').has('299'));
});

test('a full note cache still admits newly discovered notes', async () => {
  const h = harness();
  for (let i = 0; i < 250; i++) h.ctx.rememberOwnNote('me', String(i));
  h.ctx.poolQuerySync = async () => [{ id: 'external-new', created_at: 999 }];
  await h.ctx.loadOwnNoteIds('me', []);
  assert.equal(h.ctx._ownNoteIds.get('me').size, 250);
  assert.ok(h.ctx._ownNoteIds.get('me').has('external-new'));
  assert.ok(h.ctx._ownNoteIds.get('me').has('249'));
});

test('overlapping startup calls create only one live subscription set', async () => {
  const h = harness();
  await Promise.all([h.ctx.initNotifSubs(), h.ctx.initNotifSubs()]);
  const filters = h.active().map((s) => JSON.stringify(s.filter));
  assert.equal(filters.length, new Set(filters).size);
});

test('publishing after a relay refresh uses the refreshed relay list', async () => {
  const h = harness(); await h.ctx.initNotifSubs();
  h.ctx.relayUrls = async () => ['wss://new.example.com'];
  await h.ctx._notifCache.get('me').refetch();
  h.ctx.rememberOwnNote('me', 'new');
  assert.ok(h.active().every((s) => s.urls[0] === 'wss://new.example.com'));
});
