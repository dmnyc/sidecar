'use strict';

// THE TAB'S "REPLYING TO" NAME.
//
// The expanded composer re-reads the author's kind:0 itself, and read it from the
// configured relays and purplepag.es alone, waiting on every one of them. A person whose
// profile lived on their own relays came out as npub1… in the header and in mention
// pills, even though the panel had named them a moment earlier. The lookup now asks the
// author's own NIP-65 write relays too, takes the first name, and settles quickly.
//
// This runs the real functions from compose.js against a fake pool.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'compose.js'), 'utf8');

function between(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a === -1 || b === -1) throw new Error('markers not found: ' + from);
  return src.slice(a, b);
}

const PK = 'c'.repeat(64);
const OTHER = 'd'.repeat(64);

// relaysData: url -> { kind0?: event, kind10002?: event, delay?: ms, dead?: true }
function build({ data, configured = ['wss://configured'], accounts = [] }) {
  const log = { subscribed: [] };
  const pool = {
    get: async (relays, filter) => {
      for (const url of relays) {
        const d = data[url];
        const ev = d && filter.kinds[0] === 10002 ? d.kind10002 : null;
        if (ev) return ev;
      }
      return null;
    },
    subscribeMany: (relays, filter, h) => {
      log.subscribed.push(relays.slice());
      let closed = false;
      let left = relays.length;
      const timers = relays.map((url) => {
        const d = data[url] || {};
        return setTimeout(() => {
          if (closed) return;
          if (d.kind0 && filter.kinds[0] === 0) h.onevent(d.kind0);
          if (--left === 0 && !closed) h.oneose();
        }, d.dead ? 100000 : (d.delay || 0));
      });
      return { close() { closed = true; timers.forEach(clearTimeout); } };
    },
  };
  const code = `
    const profileCache = new Map();
    const state = { accounts: ${JSON.stringify(accounts)} };
    const relayUrls = async () => ${JSON.stringify(configured)};
    const pool = () => POOL;
    ${between('  function metaName(', '  // A NAME FOR THE PREVIEW')}
    ${between('  const PROFILE_SETTLE_MS', '  function applyAvatar(')
      .replace('PROFILE_WAIT_MS = 6000', 'PROFILE_WAIT_MS = 400')
      .replace('OUTBOX_WAIT_MS = 3000', 'OUTBOX_WAIT_MS = 200')
      .replace('PROFILE_SETTLE_MS = 300', 'PROFILE_SETTLE_MS = 5')}
    return { fetchPreviewProfile, profileCache };
  `;
  const api = new Function('POOL', code)(pool);
  return { ...api, log };
}

const k0 = (pubkey, content, created_at = 100) => ({ id: String(created_at) + pubkey.slice(0, 4), pubkey, created_at, kind: 0, tags: [], content: JSON.stringify(content) });
const k10002 = (pubkey, tags) => ({ id: 'r' + pubkey.slice(0, 4), pubkey, created_at: 50, kind: 10002, tags, content: '' });

test('A NAME ONLY ON THE AUTHOR’S OWN RELAY IS FOUND', async () => {
  const t = build({
    data: {
      'wss://theirs': { kind0: k0(PK, { display_name: 'Gigi', picture: 'https://x/p.png' }) },
      'wss://purplepag.es': { kind10002: k10002(PK, [['r', 'wss://theirs', 'write']]) },
    },
  });
  const p = await t.fetchPreviewProfile(PK);
  assert.equal(p.name, 'Gigi');
  assert.equal(p.picture, 'https://x/p.png');
  assert.equal(t.profileCache.get(PK).name, 'Gigi', 'a name found is kept');
});

test('A DEAD RELAY DOES NOT HOLD UP A NAME ANOTHER HAD', async () => {
  const t = build({
    data: {
      'wss://configured': { dead: true },
      'wss://purplepag.es': { kind0: k0(PK, { name: 'Bob' }) },
    },
  });
  const t0 = Date.now();
  const p = await t.fetchPreviewProfile(PK);
  assert.equal(p.name, 'Bob');
  assert.ok(Date.now() - t0 < 300, 'settles shortly after the first answer, not at the cap');
});

test('THE NAME RULE IS THE PANEL’S: display_name, displayName, name', async () => {
  for (const [meta, want] of [
    [{ display_name: 'A', displayName: 'B', name: 'C' }, 'A'],
    [{ displayName: 'B', name: 'C' }, 'B'],
    [{ name: 'C' }, 'C'],
  ]) {
    const t = build({ data: { 'wss://configured': { kind0: k0(PK, meta) } } });
    assert.equal((await t.fetchPreviewProfile(PK)).name, want);
  }
});

test('A COPY WITH NO NAME DOES NOT WIN OVER ONE THAT HAS IT', async () => {
  const t = build({
    data: {
      'wss://configured': { kind0: k0(PK, { about: 'no name here' }, 300) },
      'wss://theirs': { kind0: k0(PK, { name: 'Named' }, 200), delay: 40 },
      'wss://purplepag.es': { kind10002: k10002(PK, [['r', 'wss://theirs']]) },
    },
  });
  assert.equal((await t.fetchPreviewProfile(PK)).name, 'Named');
});

test('NOBODY KNOWS THEM: null name, nothing cached', async () => {
  const t = build({ data: {} });
  const p = await t.fetchPreviewProfile(PK);
  assert.equal(p, null);
  assert.equal(t.profileCache.has(PK), false);
});

test('AN EVENT FROM A DIFFERENT AUTHOR IS IGNORED', async () => {
  const t = build({ data: { 'wss://configured': { kind0: k0(OTHER, { name: 'Impostor' }) } } });
  assert.equal(await t.fetchPreviewProfile(PK), null);
});

test('TWO ASKS FOR ONE PERSON SHARE ONE LOOKUP', async () => {
  const t = build({ data: { 'wss://configured': { kind0: k0(PK, { name: 'Once' }) } } });
  const [a, b] = await Promise.all([t.fetchPreviewProfile(PK), t.fetchPreviewProfile(PK)]);
  assert.equal(a, b);
  assert.equal(t.log.subscribed.filter((r) => r.includes('wss://configured')).length, 1);
});

test('YOUR OWN ACCOUNTS ANSWER WITH NO RELAY AT ALL', async () => {
  const t = build({ data: {}, accounts: [{ pubkey: PK, name: 'Me', picture: null }] });
  assert.equal((await t.fetchPreviewProfile(PK)).name, 'Me');
  assert.equal(t.log.subscribed.length, 0);
});
