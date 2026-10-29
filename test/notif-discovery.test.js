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
// The bell's tuning constants, from the source rather than copied.
const NOTIF_CONSTS = (bare.match(/^  const NOTIF_[A-Z_]+ = [^;]+;/gm) || []).join('\n');
for (const name of ['NOTIF_SCREEN', 'NOTIF_SPANS', 'NOTIF_RANGE_LIMIT', 'NOTIF_CACHE_MAX', 'NOTIF_SETTLE_MS', 'NOTIF_FETCH_MAX_MS']) {
  assert.ok(NOTIF_CONSTS.includes(name + ' ='), name + ' moved');
}
function harness() {
  const live = [], history = [], reqs = [];
  const ctx = {
    state: { accounts: [{ pubkey: 'me' }], activePubkey: 'me' },
    _notifCache: new Map(), _ownNoteIds: new Map([['me', new Set(['old'])]]),
    _ownNoteIdsPromises: new Map(), _ownCommentIds: new Map(), _ownPollIds: new Map(), _muteLists: new Map(),
    _openNotifBell: null, OWN_NOTE_CEILING: 250, WEB_COMMENT_KIND: 1111, POLL_RESPONSE_KIND: 1018,
    loadNotifSeen: async () => {}, relayUrls: async () => ['wss://example.com'],
    loadMuteList: async () => {}, loadOwnPollIds: async () => new Set(),
    poolQuerySync: async () => [{ id: 'old', created_at: 1 }],
    isMutedNotif: (_, e) => e.muted === true,
    prefetchNotifProfile: async () => {}, zapSender: (e) => e.pubkey,
    pruneNameMuted: () => {}, refreshBell: () => {},
    setTimeout: () => 0, clearTimeout: () => {}, console, Date, Math,
    // What a stretch of history brings back, by its filters; nothing unless a test says.
    answer: () => [],
    poolSubscribeMany: (urls, filter, params) => {
      const sub = { urls, filter, params, closed: false, close() { this.closed = true; } };
      live.push(sub); return sub;
    },
    poolSubscribeManyEose: (urls, filter, params) => {
      history.push({ urls, filter, params }); params.onclose?.(); return { close() {} };
    },
    // The bell sends all its filters in one REQ per relay. Recorded one entry per filter,
    // so the assertions below still read filters, with the call itself counted in `reqs`.
    poolSubscribeAll: (urls, filters, params) => {
      reqs.push({ urls, filters, live: true });
      const group = { closed: false, close() { this.closed = true; } };
      filters.forEach((filter) => live.push({ urls, filter, params, get closed() { return group.closed; }, close() { group.close(); } }));
      return group;
    },
    poolSubscribeAllEose: (urls, filters, params) => {
      reqs.push({ urls, filters, live: false });
      filters.forEach((filter) => history.push({ urls, filter, params }));
      ctx.answer(filters).forEach((ev) => params.onevent(ev));
      params.onclose?.(); return { close() {} };
    },
  };
  // The bell reads the account's inbox (inboxRelays, relay-policy.js's read half). Here it
  // is whatever relayUrls returns, so a test that swaps the relay list swaps the inbox.
  ctx.inboxRelays = async () => ctx.relayUrls(false);
  vm.createContext(ctx);
  vm.runInContext(NOTIF_CONSTS.replace(/const /g, 'var '), ctx);
  for (const name of ['function rememberOwnNote(', 'function forgetOwnNoteQuery(', 'function loadOwnNoteIds(',
    'function isOwnNoteReply(', 'function rememberOwnComment(', 'async function loadOwnCommentIds(', 'function closeNotifSubsExcept(', 'async function initNotifSubs(']) {
    vm.runInContext(lift(name), ctx);
  }
  // Startup's first load runs on its own; wait for it, and for any run it started.
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setImmediate(r));
      const c = ctx._notifCache.get('me');
      if (c && c.refetchRun) await c.refetchRun;
      if (c && c.olderRun) await c.olderRun;
    }
  };
  return { ctx, live, history, reqs, settle, active: () => live.filter((s) => !s.closed) };
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
  const h = harness(); await h.ctx.initNotifSubs(); await h.settle();
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
  const h = harness(); await h.ctx.initNotifSubs(); await h.settle();
  h.ctx.relayUrls = async () => ['wss://new.example.com'];
  await h.ctx._notifCache.get('me').refetch();
  h.ctx.rememberOwnNote('me', 'new');
  assert.ok(h.active().every((s) => s.urls[0] === 'wss://new.example.com'));
});

test('every filter goes out in one request per relay set, not one per filter', async () => {
  // One subscription per filter was up to seven requests per relay for each set, and the
  // bell opens a history set and a live set together: relays that rate-limit closed them.
  const h = harness();
  await h.ctx.initNotifSubs();
  await h.settle();
  assert.ok(h.live.length > 1 && h.history.length > 1, 'several filters, as before');
  assert.equal(h.reqs.filter((r) => r.live).length, 1, 'the live set is one request');
  // History goes out a stretch at a time (see the newest-first tests below), and each
  // stretch is ONE request carrying every filter.
  const hist = h.reqs.filter((r) => !r.live);
  assert.ok(hist.length >= 1);
  for (const r of hist) assert.ok(r.filters.length > 1, 'a stretch went out as one request per filter');
  const bare = source.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(bare, /for \(const f of buildFilters\(/, 'a loop over the filters is one request each');
  assert.doesNotMatch(bare, /buildFilters\([^)]*\)\.map\(/, 'so is a map over them');
});

// THE STARTUP BACKFILL GETS A SECOND ASK. It goes out while the panel loads everything
// else at once and closes on EOSE or timeout, so a relay slowed by that crowd was cut off
// and the bell sat days behind until the refresh button was pressed by hand.
test('startup schedules one settle pass, which asks once and is skipped right after any ask', async () => {
  const h = harness();
  const timers = [];
  h.ctx.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return 0; };
  await h.ctx.initNotifSubs();
  await h.settle();
  const settle = timers.filter((t) => t.ms === 12000);
  assert.equal(settle.length, 1, 'no settle pass was scheduled');
  const cache = h.ctx._notifCache.get('me');
  assert.ok(cache.lastRefetchAt > 0, 'the startup load was not recorded');
  // Twelve seconds on, the startup load is no longer "moments ago".
  cache.lastRefetchAt = Date.now() - 6000;
  const before = h.reqs.filter((r) => !r.live).length;
  settle[0].fn();
  await h.settle();
  // One stretch: the newest day, which meets what the startup load already covers.
  assert.equal(h.reqs.filter((r) => !r.live).length, before + 1, 'the settle pass did not ask, or asked more than one stretch');
  settle[0].fn();
  await h.settle();
  assert.equal(h.reqs.filter((r) => !r.live).length, before + 1, 'a second settle asked again right after a finished ask');
});

test('asks made at once share one run', async () => {
  const h = harness();
  await h.ctx.initNotifSubs();
  await h.settle();
  const cache = h.ctx._notifCache.get('me');
  const before = h.reqs.filter((r) => !r.live).length;
  await Promise.all([cache.refetch(), cache.refetch(), cache.refetch()]);
  assert.equal(h.reqs.filter((r) => !r.live).length, before + 1, 'each ask ran its own fetch');
  assert.equal(cache.refetchRun, null, 'the shared run was never released');
  await cache.refetch();
  assert.equal(h.reqs.filter((r) => !r.live).length, before + 2, 'a later ask could not run');
});

// ---- newest first, older on request ----------------------------------------------------

const DAY = 86400;
const at = (id, ageDays, rest = {}) =>
  ({ id, kind: 7, tags: [['p', 'me']], pubkey: 'them', created_at: Math.floor(Date.now() / 1000 - ageDays * DAY), ...rest });
// Answers a stretch with the events whose time falls inside it, as a relay would.
const inStretch = (all) => (filters) => {
  const f = filters[0];
  return all.filter((e) => (f.since == null || e.created_at >= f.since) && (f.until == null || e.created_at <= f.until));
};

test('A COLD START LOADS THE NEWEST DAY FIRST, and stops there when it holds a screenful', async () => {
  const h = harness();
  const busy = Array.from({ length: 30 }, (_, i) => at('n' + i, i / 100)); // 30 in the last few hours
  h.ctx.answer = inStretch(busy);
  await h.ctx.initNotifSubs();
  await h.settle();
  const hist = h.reqs.filter((r) => !r.live);
  assert.equal(hist.length, 1, 'a busy day should be one stretch');
  const f = hist[0].filters[0];
  assert.ok(Math.abs(f.since - (Date.now() / 1000 - DAY)) < 5, 'the first stretch is not the last day');
  assert.equal(f.until, undefined, 'the newest stretch must reach up to now');
  const cache = h.ctx._notifCache.get('me');
  assert.equal(cache.events.length, 30);
  assert.equal(cache.events[0].id, 'n0', 'newest first');
});

test('a quiet account widens the stretch until it holds a screenful, without gaps or overlap', async () => {
  const h = harness();
  const quiet = Array.from({ length: 30 }, (_, i) => at('q' + i, 4 + i / 10)); // 4 to 7 days ago
  h.ctx.answer = inStretch(quiet);
  await h.ctx.initNotifSubs();
  await h.settle();
  const stretches = h.reqs.filter((r) => !r.live).map((r) => r.filters[0]);
  assert.equal(stretches.length, 3, 'one day, then three, then seven');
  for (let i = 1; i < stretches.length; i++) {
    assert.equal(stretches[i].until, stretches[i - 1].since, 'a stretch must start where the newer one ended');
  }
  assert.equal(h.ctx._notifCache.get('me').events.length, 30);
});

test('LOAD MORE asks for what is older than the loaded stretch, and says when there is nothing', async () => {
  const h = harness();
  const recent = Array.from({ length: 30 }, (_, i) => at('r' + i, i / 100));
  const older = Array.from({ length: 10 }, (_, i) => at('o' + i, 2 + i));
  h.ctx.answer = inStretch([...recent, ...older]);
  await h.ctx.initNotifSubs();
  await h.settle();
  const cache = h.ctx._notifCache.get('me');
  const start = cache.covered.since;
  const before = h.reqs.filter((r) => !r.live).length;
  const added = await cache.loadOlder();
  assert.equal(added, 10);
  const asked = h.reqs.filter((r) => !r.live).slice(before).map((r) => r.filters[0]);
  assert.equal(asked[0].until, start, 'paging must start where the loaded stretch starts');
  assert.ok(asked.every((f) => f.until <= start), 'paging asked again for what was already loaded');
  assert.equal(cache.exhausted, false);
  // Nothing further back: the whole widening comes back empty, and that is the end.
  assert.equal(await cache.loadOlder(), 0);
  assert.equal(cache.exhausted, true);
  const n = h.reqs.length;
  assert.equal(await cache.loadOlder(), 0);
  assert.equal(h.reqs.length, n, 'an exhausted history asked the relays again');
});

test('HISTORY NEVER LANDS AT THE TOP OF AN OPEN SHEET; a live arrival does', async () => {
  const h = harness();
  const added = [];
  h.ctx._openNotifBell = { pubkey: 'me', addLive: (ev) => added.push(ev.id) };
  h.ctx.answer = inStretch([at('past', 0.5)]);
  await h.ctx.initNotifSubs();
  await h.settle();
  await h.ctx._notifCache.get('me').refetch();
  assert.deepEqual(added, [], 'a fetch of the past was prepended to the open sheet');
  h.active()[0].params.onevent(at('now', 0, { id: 'live' }));
  assert.deepEqual(added, ['live']);
});

test('what a refresh brought in is counted, even into a full cache', async () => {
  const h = harness();
  await h.ctx.initNotifSubs();
  await h.settle();
  const cache = h.ctx._notifCache.get('me');
  h.ctx.answer = inStretch([at('a', 0.1), at('b', 0.2)]);
  cache.lastRefetchAt = 0;
  await cache.refetch();
  assert.equal(cache.refetchAdded, 2);
  await cache.refetch();
  assert.equal(cache.refetchAdded, 0, 'what was already there counted as new');
});
