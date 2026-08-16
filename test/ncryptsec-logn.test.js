'use strict';

// Unit coverage for the ncryptsec logn cap in sidepanel.js.
//
// nip49.js is a hash-pinned vendored build (CI enforces scripts/vendor-hashes.sha256),
// so the scrypt cost bound can't live inside its decrypt(). Instead decryptNcryptsec
// pre-reads the logn byte with ncryptsecLogn() and refuses to hand nip49 a string
// whose scrypt would allocate more than ~1GiB. A pasted string is attacker-controlled
// input; it must not be able to burn that memory in the NIP-49 worker (or, on the
// no-worker fallback, freeze the panel) before the AEAD ever rejects the key.
//
// decryptNcryptsec is async since the worker change (#195): scrypt runs off-thread
// via nip49(). The vm sandbox has no Worker global, so nip49() takes its documented
// sync fallback and calls window.SidecarNip49.decrypt on a microtask — the same
// code path a browser hits when workers are unavailable.
//
// The test vectors here are hand-built bech32 payloads (version 2 + logn + slack)
// with NO valid checksum — ncryptsecLogn doesn't check one (that's nip49.decrypt's
// job), which is exactly what lets the cap be tested without real keys.

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

// Build `ncryptsec1` + the 5-bit words encoding [version=2, logn] (+ slack bits),
// checksum deliberately garbage.
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function fakeNcryptsec(logn) {
  const bits = (2 << 8 | logn).toString(2).padStart(16, '0') + '0'.repeat(15);
  let words = '';
  for (let i = 0; i < bits.length; i += 5) words += CHARSET[parseInt(bits.slice(i, i + 5), 2)];
  return 'ncryptsec1' + words;
}

// A context where nip49.decrypt (via the sync fallback) and NT.nip19.nsecEncode
// are observable stubs.
function harness({ decryptResult, decryptThrows } = {}) {
  const decryptCalls = [];
  const ctx = {
    NT: {
      nip19: {
        nsecEncode: (bytes) => {
          if (!bytes || bytes.length !== 32) throw new Error('invalid key slice length');
          return 'nsec1' + Array.from(bytes, (b) => b.toString(16)).join('');
        },
      },
    },
    window: {
      SidecarNip49: {
        decrypt: (s, p) => {
          decryptCalls.push({ s, p });
          if (decryptThrows) throw new Error('bad ciphertext');
          return decryptResult;
        },
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/let nip49Worker = null;[\s\S]*?nip49Worker\.postMessage\(\{ id, op, args \}\);\n    \}\);\n  \}/, 'nip49 worker helper') + '\n' +
    lift(/const NCRYPTSEC_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';[\s\S]*?\n    return null;\n  \}/, 'ncryptsecLogn') + '\n' +
    lift(/async function decryptNcryptsec\(ncryptsec, password\) \{[\s\S]*?\n  \}/, 'decryptNcryptsec') + '\n' +
    'globalThis.ncryptsecLogn = ncryptsecLogn;' +
    'globalThis.decryptNcryptsec = decryptNcryptsec;',
    ctx
  );
  return { ctx, decryptCalls };
}

const OK_KEY = new Uint8Array(32).fill(7);
const FRIENDLY = /Incorrect password, or not a valid ncryptsec key\./;

// ---- the byte reader ------------------------------------------------------------

test('ncryptsecLogn reads the second payload byte out of hand-built vectors', () => {
  const { ctx } = harness();
  for (const logn of [10, 16, 18, 20, 21, 24, 255]) {
    assert.equal(ctx.ncryptsecLogn(fakeNcryptsec(logn)), logn, 'logn ' + logn);
  }
});

test('ncryptsecLogn returns null for junk — validity stays nip49.decrypt\'s job', () => {
  const { ctx } = harness();
  // Undecodable (no separator, non-charset chars, too short) → null. A non-ncryptsec
  // hrp with valid charset data (e.g. an nsec) DOES decode — fine, callers route
  // only /^ncryptsec1/ strings here, and a high byte there would just be rejected.
  for (const junk of ['', null, undefined, 'ncryptsec', 'ncryptsec1', 'ncryptsec1q!zry9x8', 'ncryptsec1qpz']) {
    assert.equal(ctx.ncryptsecLogn(junk), null, JSON.stringify(junk));
  }
});

// ---- the cap --------------------------------------------------------------------

test('a crafted logn > 20 is rejected before scrypt — nip49.decrypt is never called', async () => {
  const { ctx, decryptCalls } = harness({ decryptResult: OK_KEY });
  for (const logn of [21, 24, 30, 255]) {
    await assert.rejects(ctx.decryptNcryptsec(fakeNcryptsec(logn), 'pw'), FRIENDLY, 'logn ' + logn);
  }
  assert.equal(decryptCalls.length, 0, 'the memory burn happens in decrypt — it must not be reached');
});

test('logn 20 and below still reach nip49.decrypt', async () => {
  const { ctx, decryptCalls } = harness({ decryptResult: OK_KEY });
  for (const logn of [10, 16, 20]) {
    await ctx.decryptNcryptsec(fakeNcryptsec(logn), 'pw');
  }
  assert.equal(decryptCalls.length, 3);
});

// ---- the friendly-error contract --------------------------------------------------

test('a decrypt failure still maps to the friendly message', async () => {
  const { ctx } = harness({ decryptThrows: true });
  await assert.rejects(ctx.decryptNcryptsec(fakeNcryptsec(16), 'pw'), FRIENDLY);
});

test('a wrong-length key from decrypt surfaces the friendly message, not nostr-tools\' raw error', async () => {
  // nsecEncode must live INSIDE the try — a malformed key length used to throw
  // nostr-tools' "invalid key slice length" straight at the user.
  const { ctx } = harness({ decryptResult: new Uint8Array(2) });
  await assert.rejects(ctx.decryptNcryptsec(fakeNcryptsec(16), 'pw'), FRIENDLY);
});
