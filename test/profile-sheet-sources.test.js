'use strict';

// The profile sheet opened from search drew as a bare npub, and only a second search
// showed the person: it asked the configured relays alone, which rarely carry a
// stranger's kind:0, and an answer landing after the sheet closed was dropped before it
// reached the cache. This lifts the sheet's lookup block out of sidepanel.js and runs it
// against stubbed sources.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const fn = src.slice(src.indexOf('async function openProfileSheet('));
const start = fn.indexOf('      let drawnAt = 0;');
const end = fn.indexOf('      }).then(land).catch(() => {});', start) + '      }).then(land).catch(() => {});'.length;
assert.ok(start !== -1 && end > start, 'the sheet\'s lookup block moved; update this test');
const block = fn.slice(start, end);

const ME = 'a'.repeat(64);
const ev = (at, name, pubkey = ME) => ({ pubkey, created_at: at, content: JSON.stringify({ name }) });

function sheet(answers) {
  // answers: { purple, configured, own } → { ev, delay } ; resolved in delay order
  const painted = [], cached = [], asked = [];
  const later = (a) => new Promise((r) => setTimeout(() => r(a && a.ev), a ? a.delay : 0));
  const ctx = {
    pubkey: ME, painted, cached, asked,
    modal: { isConnected: true },
    paint: (c) => painted.push(c.name),
    cacheProfile: (pk, c) => cached.push(c.name),
    poolGetProfile: (relays) => {
      asked.push(relays.join(','));
      if (relays.length === 1 && relays[0] === 'wss://purplepag.es') return later(answers.purple);
      if (relays[0] === 'wss://own') return later(answers.own);
      return later(answers.configured);
    },
    relayUrls: async () => ['wss://configured'],
    getNip65: async () => ({ write: answers.own ? ['wss://own'] : [] }),
    JSON, setTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  return ctx;
}
const settle = () => new Promise((r) => setTimeout(r, 60));

test('the aggregator, the configured relays and their own write relays are all asked', async () => {
  const s = sheet({ purple: { ev: ev(1, 'A'), delay: 1 }, configured: { ev: null, delay: 2 }, own: { ev: null, delay: 3 } });
  await settle();
  assert.deepEqual(s.asked.sort(), ['wss://configured', 'wss://own', 'wss://purplepag.es'].sort());
  assert.deepEqual(s.painted, ['A'], 'the aggregator\'s answer alone did not paint');
});

test('the newest answer wins, and an older one landing later does not repaint', async () => {
  const s = sheet({ purple: { ev: ev(10, 'old'), delay: 1 }, configured: { ev: ev(20, 'new'), delay: 10 }, own: { ev: ev(15, 'mid'), delay: 30 } });
  await settle();
  assert.deepEqual(s.painted, ['old', 'new'], 'a stale answer repainted over a newer one');
});

test('an answer landing after the sheet closed is still cached', async () => {
  const s = sheet({ purple: { ev: ev(5, 'Late'), delay: 20 } });
  s.modal.isConnected = false;
  await settle();
  assert.deepEqual(s.cached, ['Late'], 'the late answer was dropped before the cache');
  assert.deepEqual(s.painted, []);
});

test('somebody else\'s kind:0 is never drawn', async () => {
  const s = sheet({ purple: { ev: ev(5, 'Wrong', 'b'.repeat(64)), delay: 1 } });
  await settle();
  assert.deepEqual(s.painted, []);
  assert.deepEqual(s.cached, []);
});
