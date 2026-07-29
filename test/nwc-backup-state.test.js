'use strict';

// Unit coverage for nwcBackupState() in sidepanel.js.
//
// The bug this pins shut: the old check was `!!(await fetchBackupEvent(dtag))` — a
// bare existence test. kind:30078 is replaceable by (pubkey, kind, d-tag), so
// connecting a new wallet leaves the PREVIOUS ciphertext on the relays and the
// status line kept reading "Backed up ✓". The reassurance pointed at a connection
// string the user no longer held, so the one case where the UI needed to speak up
// was the exact case it stayed quiet.
//
// Every assertion here is really the same assertion: nothing but a verified match
// may report 'current'. A false 'stale' just prompts a harmless re-backup; a false
// 'current' loses a wallet.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

const CONN = 'nostr+walletconnect://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.example&secret=71a8c14c1774f1e0e2b7c0d0f3f0b4e5';
const OTHER = 'nostr+walletconnect://a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90?relay=wss%3A%2F%2Frelay.other&secret=0f0e0d0c0b0a09080706050403020100';

// Builds a context where fetchBackupEvent and call() are stubs, so the state
// machine is exercised without relays or a keystore.
function harness({ event, connection, decrypt, getNwcThrows }) {
  const calls = [];
  const ctx = {
    console,
    NWC_BACKUP_DTAG: 'sidecar:nwc-backup',
    fetchBackupEvent: async () => (event === undefined ? null : event),
    call: async (msg) => {
      calls.push(msg);
      if (msg.type === 'SIDECAR_GET_NWC') {
        if (getNwcThrows) throw new Error('locked');
        return { connection };
      }
      if (msg.type === 'SIDECAR_OWNER_DECRYPT') {
        if (typeof decrypt === 'function') return decrypt(msg);
        return decrypt;
      }
      throw new Error('unexpected call ' + msg.type);
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/async function nwcBackupState\(\)\s*\{[\s\S]*?\n  \}/, 'nwcBackupState') + '\n' +
    lift(/const NWC_BACKUP_LABEL = \{[\s\S]*?\n  \};/, 'NWC_BACKUP_LABEL') + '\n' +
    'globalThis.nwcBackupState = nwcBackupState;' +
    'globalThis.NWC_BACKUP_LABEL = NWC_BACKUP_LABEL;',
    ctx
  );
  return { ctx, calls };
}

const evt = (content, algo) => ({
  content: content || 'CIPHERTEXT',
  created_at: 1750000000,
  tags: algo ? [['d', 'sidecar:nwc-backup'], ['encryption', algo]] : [['d', 'sidecar:nwc-backup']],
});

// ---- the four states ------------------------------------------------------------

test('no backup event on the relays is "none"', async () => {
  const { ctx } = harness({ event: undefined, connection: CONN });
  assert.equal((await ctx.nwcBackupState()).state, 'none');
});

test('a backup that decrypts to the connected string is "current"', async () => {
  const { ctx } = harness({ event: evt(), connection: CONN, decrypt: CONN });
  const r = await ctx.nwcBackupState();
  assert.equal(r.state, 'current');
  assert.equal(r.at, 1750000000, 'the event timestamp comes back for display');
});

test('a backup holding a DIFFERENT wallet is "stale", not "current" — the whole bug', async () => {
  const { ctx } = harness({ event: evt(), connection: CONN, decrypt: OTHER });
  assert.equal((await ctx.nwcBackupState()).state, 'stale');
});

test('a backup with no wallet connected is "unknown", never "current"', async () => {
  const { ctx } = harness({ event: evt(), connection: '', decrypt: CONN });
  assert.equal((await ctx.nwcBackupState()).state, 'unknown');
});

// ---- fail closed ---------------------------------------------------------------

test('a decrypt failure is "unknown" — an unreadable backup must not vouch for itself', async () => {
  const { ctx } = harness({
    event: evt(), connection: CONN,
    decrypt: () => { throw new Error('bad ciphertext'); },
  });
  assert.equal((await ctx.nwcBackupState()).state, 'unknown');
});

test('a locked keystore is "unknown", not "none" — "none" would understate what exists', async () => {
  const { ctx } = harness({ event: evt(), connection: CONN, getNwcThrows: true });
  const r = await ctx.nwcBackupState();
  assert.equal(r.state, 'unknown');
  assert.equal(r.at, 1750000000);
});

test('a decrypt returning empty or null is never "current"', async () => {
  for (const bad of ['', null, undefined]) {
    const { ctx } = harness({ event: evt(), connection: CONN, decrypt: bad });
    const r = await ctx.nwcBackupState();
    assert.notEqual(r.state, 'current', 'decrypt returned ' + String(bad));
    assert.equal(r.state, 'stale');
  }
});

// ---- comparison details --------------------------------------------------------

test('surrounding whitespace does not read as a different wallet', async () => {
  const { ctx } = harness({ event: evt(), connection: '  ' + CONN + '\n', decrypt: CONN + ' ' });
  assert.equal((await ctx.nwcBackupState()).state, 'current');
});

test('a same-wallet string differing only in query order reports "stale"', async () => {
  // Accepted false positive, asserted so the tradeoff is deliberate rather than a
  // surprise: it prompts a re-backup, which is harmless. The alternative — parsing
  // out wallet pubkey + secret and ignoring the rest — risks calling two genuinely
  // different connections equal, which is the failure that loses money.
  const reordered = CONN.replace(
    /\?relay=([^&]+)&secret=(.+)$/,
    (_, relay, secret) => '?secret=' + secret + '&relay=' + relay
  );
  assert.notEqual(reordered, CONN, 'the fixture must actually differ');
  const { ctx } = harness({ event: evt(), connection: CONN, decrypt: reordered });
  assert.equal((await ctx.nwcBackupState()).state, 'stale');
});

// ---- encryption scheme ---------------------------------------------------------

test('an nip04 tag decrypts with nip 4, not 44', async () => {
  const { ctx, calls } = harness({ event: evt('C', 'nip04'), connection: CONN, decrypt: CONN });
  await ctx.nwcBackupState();
  const dec = calls.find((c) => c.type === 'SIDECAR_OWNER_DECRYPT');
  assert.equal(dec.nip, 4, 'older backups were NIP-04 and must stay readable');
});

test('nip44 is used for a nip44 tag and for a missing tag', async () => {
  for (const algo of ['nip44', undefined]) {
    const { ctx, calls } = harness({ event: evt('C', algo), connection: CONN, decrypt: CONN });
    await ctx.nwcBackupState();
    assert.equal(calls.find((c) => c.type === 'SIDECAR_OWNER_DECRYPT').nip, 44,
      'algo tag ' + String(algo));
  }
});

test('the ciphertext handed to decrypt is the event content', async () => {
  const { ctx, calls } = harness({ event: evt('ABC123', 'nip44'), connection: CONN, decrypt: CONN });
  await ctx.nwcBackupState();
  assert.equal(calls.find((c) => c.type === 'SIDECAR_OWNER_DECRYPT').ciphertext, 'ABC123');
});

// ---- the labels ----------------------------------------------------------------

test('every state has a label, and none is long enough to ellipsize in the sidebar', async () => {
  const { ctx } = harness({ event: undefined, connection: CONN });
  for (const s of ['none', 'current', 'stale', 'unknown']) {
    const label = ctx.NWC_BACKUP_LABEL[s];
    assert.ok(label, 'missing label for ' + s);
    // .backup-status is nowrap + ellipsis in a ~360px panel; these sit beside
    // "Wallet connection" on one row, so they have to stay short.
    assert.ok(label.length <= 16, s + ' label too long: ' + label);
  }
});

test('only "current" carries the reassuring check mark', async () => {
  const { ctx } = harness({ event: undefined, connection: CONN });
  const L = ctx.NWC_BACKUP_LABEL;
  assert.ok(L.current.includes('✓'));
  for (const s of ['none', 'stale', 'unknown']) {
    assert.ok(!L[s].includes('✓'), s + ' must not look like success');
  }
});

test('"stale" and "none" deliberately share a label', () => {
  // Not an oversight to be tidied up. A backup holding some other wallet means this
  // wallet is not backed up, which is the fact the user acts on. The two are told
  // apart by the warn color and the note beneath, not by the pill text — and naming
  // the backup's age instead ("Out of date") misreads against the adjacent
  // "Wallet connection" label as though the connection were the stale thing.
  const { ctx } = harness({ event: undefined, connection: CONN });
  assert.equal(ctx.NWC_BACKUP_LABEL.stale, ctx.NWC_BACKUP_LABEL.none);
});
