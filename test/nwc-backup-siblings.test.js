'use strict';

// Restoring a wallet backup another NWC app wrote (#538).
//
// Wisp (`nwc-wallet-backup`) and zap.cooking (`zapcooking-nwc-backup`) back the same
// spendable secret up under the same shape Sidecar does — kind 30078, NIP-78, content
// encrypted to the account's own key — each under its own d tag. Their restore only
// read Sidecar's own tag, so a wallet backed up in one of those apps could not be
// restored here. Sidecar still WRITES only its own tag: per-app namespacing is what
// stops one app's save from clobbering another's.

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

const ME = 'a'.repeat(64);
const RELAYS = ['wss://declared.example'];
const CONNECTION = 'nostr+walletconnect://pub@relay.example';

// A kind 30078 as an app would have written it. `ct` is the ciphertext stand-in;
// `dtag` is the sibling's (or Sidecar's own) d tag.
const backup = (created_at, { ct = 'ct', dtag = 'nwc-wallet-backup', encryption = 'nip44', deleted = false, pubkey = ME } = {}) => ({
  id: 'e' + dtag + created_at, pubkey, created_at,
  content: deleted ? '' : ct,
  tags: [['d', dtag], ['encryption', encryption], ...(deleted ? [['deleted', '']] : [])],
});

const SIBS = { events: [], answered: true, complete: true };

// `own` is what fetchBackupEvent answers with: an event, or null when the relays
// answered and Sidecar's own tag has no backup.
function harness({ own = null, siblings = SIBS, decryptTable = {} } = {}) {
  const calls = [];
  const clients = [];
  const ctx = {
    state: { activePubkey: ME },
    t: (s) => s,
    balanceCache: null,
    NWC_BACKUP_DTAG: 'sidecar:nwc-backup',
    call: async (msg) => {
      calls.push(msg);
      if (msg.type === 'SIDECAR_OWNER_DECRYPT') {
        const hit = decryptTable[msg.ciphertext];
        return hit && hit.val;
      }
      if (msg.type === 'SIDECAR_SET_NWC') return {};
      throw new Error('unexpected call ' + msg.type);
    },
    window: {
      SidecarNWC: {
        makeClient: (connection) => {
          clients.push(connection);
          return { getInfo: async () => {}, close: () => {} };
        },
      },
    },
    fetchBackupEvent: async () => own,
    poolQueryAnswered: async (relays, filter, params) => {
      ctx.lastFilter = filter;
      ctx.lastParams = params;
      return siblings;
    },
    normalizeRelay: (u) => String(u).replace(/\/$/, ''),
    postRelays: async () => RELAYS,
    relayUrls: async () => [],
    nip65OnlyFor: async () => false,
    setNwc: () => calls.find((m) => m.type === 'SIDECAR_SET_NWC'),
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/async function backupReadRelays\(\)\s*\{[\s\S]*?\n  \}/, 'backupReadRelays') + '\n' +
    lift(/const BACKUP_READ_CAP_MS = \d+;/, 'BACKUP_READ_CAP_MS') + '\n' +
    lift(/const NWC_BACKUP_SIBLINGS = \[[\s\S]*?\];/, 'NWC_BACKUP_SIBLINGS') + '\n' +
    lift(/async function fetchSiblingBackups\(\)\s*\{[\s\S]*?\n  \}/, 'fetchSiblingBackups') + '\n' +
    lift(/async function restoreNwcFromRelays\(\)\s*\{[\s\S]*?\n  \}/, 'restoreNwcFromRelays') + '\n' +
    'globalThis.fetchSiblingBackups = fetchSiblingBackups;\n' +
    'globalThis.restoreNwcFromRelays = restoreNwcFromRelays;',
    ctx
  );
  return { ctx, calls, clients };
}

// ---- what the sibling read asks for -------------------------------------------------------

test('one query asks for every sibling d tag, for this account, kind 30078', async () => {
  const { ctx } = harness();
  await ctx.fetchSiblingBackups();
  assert.deepEqual([...ctx.lastFilter.kinds], [30078]);
  assert.deepEqual([...ctx.lastFilter.authors], [ME]);
  assert.deepEqual([...ctx.lastFilter['#d']], ['nwc-wallet-backup', 'zapcooking-nwc-backup'],
    'the sibling tags are queried in one filter, not one read per app');
  assert.ok(ctx.lastParams.capMs > 0, 'nothing caps the read');
});

test('the newest usable copy per app, all apps newest first', async () => {
  const { ctx } = harness({
    siblings: { answered: true, complete: true, events: [
      backup(100), backup(300),                                  // Wisp wrote twice; 300 wins
      backup(200, { dtag: 'zapcooking-nwc-backup' }),
    ] },
  });
  const found = await ctx.fetchSiblingBackups();
  assert.deepEqual([...found].map((f) => [f.app, f.ev.created_at]),
    [['Wisp', 300], ['zap.cooking', 200]]);
});

test('a tombstone removes that app alone, by empty content or a deleted tag', async () => {
  const { ctx } = harness({
    siblings: { answered: true, complete: true, events: [
      backup(300, { deleted: true }),                            // Wisp deleted there
      backup(200, { ct: '' }),                                   // …and an older empty one
      backup(100, { dtag: 'zapcooking-nwc-backup' }),
    ] },
  });
  const found = await ctx.fetchSiblingBackups();
  assert.deepEqual([...found].map((f) => f.app), ['zap.cooking'],
    'zap.cooking still restores; Wisp read as deleted');
});

test('another account\'s copy is not taken for this account', async () => {
  const { ctx } = harness({
    siblings: { answered: true, complete: true, events: [backup(500, { pubkey: 'b'.repeat(64) })] },
  });
  assert.deepEqual([...(await ctx.fetchSiblingBackups())], []);
});

test('a quiet, complete read with no siblings is an empty list', async () => {
  const { ctx } = harness();
  assert.deepEqual([...(await ctx.fetchSiblingBackups())], []);
});

test('NOBODY ANSWERING IS "COULDN\'T CHECK", NOT "NO BACKUP"', async () => {
  const { ctx } = harness({ siblings: { events: [], answered: false, complete: true } });
  await assert.rejects(ctx.fetchSiblingBackups());
});

// ---- restore ------------------------------------------------------------------------------

test('Sidecar\'s own backup is used first, and siblings are never queried', async () => {
  const { ctx, calls } = harness({
    own: backup(50, { ct: 'ownct', dtag: 'sidecar:nwc-backup' }),
    decryptTable: { ownct: { val: CONNECTION } },
  });
  await ctx.restoreNwcFromRelays();
  assert.equal(ctx.setNwc().connection, CONNECTION);
  assert.ok(!calls.some((m) => m.type === 'SIDECAR_OWNER_DECRYPT' && m.ciphertext === 'ct'),
    'no sibling ciphertext was decrypted');
});

test('with no own backup, a sibling\'s backup restores', async () => {
  const { ctx, calls } = harness({
    siblings: { answered: true, complete: true, events: [
      backup(300, { ct: 'z1', dtag: 'zapcooking-nwc-backup' }),
    ] },
    decryptTable: { z1: { val: CONNECTION } },
  });
  await ctx.restoreNwcFromRelays();
  assert.equal(ctx.setNwc().connection, CONNECTION);
  const dec = calls.find((m) => m.type === 'SIDECAR_OWNER_DECRYPT');
  assert.equal(dec.ciphertext, 'z1');
  assert.equal(dec.nip, 44, 'no encryption tag reads as NIP-44, Sidecar\'s own default');
});

test('a Wisp NIP-04 backup decrypts as NIP-04', async () => {
  const { ctx, calls } = harness({
    siblings: { answered: true, complete: true, events: [
      backup(300, { ct: 'w1', encryption: 'nip04' }),
    ] },
    decryptTable: { w1: { val: CONNECTION } },
  });
  await ctx.restoreNwcFromRelays();
  assert.equal(ctx.setNwc().connection, CONNECTION);
  assert.equal(calls.find((m) => m.type === 'SIDECAR_OWNER_DECRYPT').nip, 4);
});

test('a sibling that decrypts to nothing usable is skipped for a usable one', async () => {
  const { ctx } = harness({
    siblings: { answered: true, complete: true, events: [
      backup(300, { ct: 'w1' }),
      backup(200, { ct: 'z1', dtag: 'zapcooking-nwc-backup' }),
    ] },
    decryptTable: { w1: { val: '{"not":"a connection string"}' }, z1: { val: CONNECTION } },
  });
  await ctx.restoreNwcFromRelays();
  assert.equal(ctx.setNwc().connection, CONNECTION, 'the newer unusable one did not win');
});

test('no own backup and no usable sibling is "no backup found"', async () => {
  const { ctx } = harness({
    siblings: { answered: true, complete: true, events: [backup(300, { ct: 'w1' })] },
    decryptTable: { w1: { val: 'garbage' } },
  });
  await assert.rejects(ctx.restoreNwcFromRelays(),
    /No wallet backup found on your relays/);
});

test('a restored connection round-trips getInfo before it is saved', async () => {
  const { ctx, clients } = harness({
    siblings: { answered: true, complete: true, events: [backup(300, { ct: 'w1' })] },
    decryptTable: { w1: { val: CONNECTION } },
  });
  await ctx.restoreNwcFromRelays();
  assert.deepEqual([...clients], [CONNECTION], 'the candidate that was saved is the one that validated');
});
