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

function harness({ post, configured, nip65Only, postThrows }) {
  const queried = [];
  const ctx = {
    state: { activePubkey: 'a'.repeat(64) },
    normalizeRelay: (u) => String(u).replace(/\/$/, ''),
    postRelays: async () => { if (postThrows) throw new Error('relay list unavailable'); return post; },
    relayUrls: async () => configured,
    nip65OnlyFor: async () => !!nip65Only,
    poolGet: async (relays) => { queried.push(relays); return null; },
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/async function backupReadRelays\(\)\s*\{[\s\S]*?\n  \}/, 'backupReadRelays') + '\n' +
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
