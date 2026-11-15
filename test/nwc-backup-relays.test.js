'use strict';

// The wallet backup must be READ from the relays it is WRITTEN to.
//
// backupNwcToRelays publishes through postRelays(), but fetchBackupEvent used to read
// the configured relays alone. With a NIP-65 list that differs from Settings, or with
// bootstrap relays off, each new backup landed where the check never looked, and the
// configured relays kept the previous wallet's ciphertext: "Your backup is a different
// wallet", however many times it was saved again.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

// answer: what poolQueryAnswered resolves with; by default the relays answered with nothing.
function harness({ post, configured, nip65Only, postThrows, answer }) {
  const queried = [];
  const ctx = {
    state: { activePubkey: 'a'.repeat(64) },
    t: (s) => s,
    poolQueryAnswered: async (relays, filter, params) => {
      queried.push(relays);
      ctx.lastParams = params;
      return answer || { events: [], answered: true, complete: true };
    },
    normalizeRelay: (u) => String(u).replace(/\/$/, ''),
    postRelays: async () => { if (postThrows) throw new Error('relay list unavailable'); return post; },
    relayUrls: async () => configured,
    nip65OnlyFor: async () => !!nip65Only,
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/async function backupReadRelays\(\)\s*\{[\s\S]*?\n  \}/, 'backupReadRelays') + '\n' +
    lift(/const BACKUP_READ_CAP_MS = \d+;/, 'BACKUP_READ_CAP_MS') + '\n' +
    lift(/async function fetchBackupEvent\(dtag\)\s*\{[\s\S]*?\n  \}/, 'fetchBackupEvent') + '\n' +
    'globalThis.fetchBackupEvent = fetchBackupEvent;',
    ctx
  );
  return { ctx, queried };
}

test('reads the relays the backup is published to, not only the configured ones', async () => {
  const { ctx, queried } = harness({
    post: ['wss://declared.example', 'wss://configured.example'],
    configured: ['wss://configured.example/', 'wss://readonly.example'],
  });
  await ctx.fetchBackupEvent('sidecar:nwc-backup');
  assert.deepEqual([...queried[0]].sort(),
    ['wss://configured.example', 'wss://declared.example', 'wss://readonly.example']);
});

test('with bootstrap relays off, reads only the declared write relays', async () => {
  const { ctx, queried } = harness({
    post: ['wss://declared.example'],
    configured: ['wss://bootstrap.example'],
    nip65Only: true,
  });
  await ctx.fetchBackupEvent('sidecar:nwc-backup');
  assert.deepEqual([...queried[0]], ['wss://declared.example']);
});

test('an unresolved relay list throws ("couldn\'t check"), never reads as "no backup"', async () => {
  const { ctx, queried } = harness({ post: [], configured: [], nip65Only: true, postThrows: true });
  await assert.rejects(ctx.fetchBackupEvent('sidecar:nwc-backup'));
  assert.equal(queried.length, 0);
});

// ---- "no backup" only when the relays said so ---------------------------------------

const ME = 'a'.repeat(64);
const copy = (created_at, rest = {}) => ({ id: 'c' + created_at, pubkey: ME, created_at, content: 'x', tags: [], ...rest });
const one = { post: ['wss://declared.example'], configured: [] };

test('the newest copy wins when relays hold different ones', async () => {
  const { ctx } = harness({ ...one, answer: { events: [copy(100), copy(300), copy(200)], answered: true, complete: true } });
  assert.equal((await ctx.fetchBackupEvent('sidecar:nwc-backup')).created_at, 300);
});

test('another author\'s copy is not taken for this account\'s backup', async () => {
  const { ctx } = harness({ ...one, answer: { events: [copy(500, { pubkey: 'b'.repeat(64) })], answered: true, complete: true } });
  assert.equal(await ctx.fetchBackupEvent('sidecar:nwc-backup'), null);
});

test('relays that answered with nothing, all of them, is "no backup"', async () => {
  const { ctx } = harness({ ...one });
  assert.equal(await ctx.fetchBackupEvent('sidecar:nwc-backup'), null);
});

test('NOBODY ANSWERING IS "COULDN\'T CHECK", NOT "NO BACKUP"', async () => {
  const { ctx } = harness({ ...one, answer: { events: [], answered: false, complete: true } });
  await assert.rejects(ctx.fetchBackupEvent('sidecar:nwc-backup'));
});

test('a read cut off by the cap with nothing in hand is unchecked; with a copy in hand it is used', async () => {
  const cut = harness({ ...one, answer: { events: [], answered: true, complete: false } });
  await assert.rejects(cut.ctx.fetchBackupEvent('sidecar:nwc-backup'), 'a relay still out may hold it');
  const got = harness({ ...one, answer: { events: [copy(42)], answered: true, complete: false } });
  assert.equal((await got.ctx.fetchBackupEvent('sidecar:nwc-backup')).created_at, 42);
});

test('the read waits for every relay, and is capped', async () => {
  const { ctx } = harness({ ...one });
  await ctx.fetchBackupEvent('sidecar:nwc-backup');
  assert.ok(ctx.lastParams.capMs > 0, 'nothing caps the read');
  assert.equal(ctx.lastParams.settleAfter, undefined,
    'settling on the first answer can take an older copy over the newest');
});
