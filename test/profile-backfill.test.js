'use strict';

// Unit coverage for needsProfileBackfill() in sidepanel.js.
//
// Regression guard for the vault-import avatar bug. The predicate decides whether
// an account still needs its name/picture pulled from kind:0. It used to read
//
//   a.placeholderName || (!a.name && !a.picture)
//
// which treats a name with no picture as a complete profile. Vault import
// produces precisely that shape — keystore's addAccountFromBytes writes
// `picture: ''` and never sets placeholderName, while import passes the name
// through from the vault file — so a restored account never backfilled and kept
// the placeholder avatar in the account chip and dropdown permanently. No reload
// helped, because the state that triggers a fetch is the state import avoids
// creating.
//
// The || form is deliberately eager. Over-fetching is bounded: maybeFetchProfile
// dedupes on profileFetchAttempted, so an account whose kind:0 genuinely has no
// picture costs one attempt per panel session rather than one per render.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

const match = source.match(/function needsProfileBackfill\(a\)\s*\{[\s\S]*?\n  \}/);
if (!match) throw new Error('Could not find needsProfileBackfill in sidepanel.js');

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(match[0] + '\nglobalThis.needsProfileBackfill = needsProfileBackfill;', ctx);
const { needsProfileBackfill } = ctx;

const PIC = 'https://example.com/avatar.jpg';

test('a vault-restored account backfills — the bug this guards', () => {
  // Exactly what importVaultModal + addAccountFromBytes leave behind.
  assert.equal(
    needsProfileBackfill({ pubkey: 'a'.repeat(64), name: 'Gatsby', picture: '' }),
    true,
    'name from the vault, empty picture, no placeholderName → must still fetch'
  );
});

test('a freshly generated account backfills (placeholder cocktail name)', () => {
  assert.equal(
    needsProfileBackfill({ name: 'Velvet Negroni', picture: '', placeholderName: true }),
    true
  );
  // Even once a picture lands, a placeholder name still needs replacing.
  assert.equal(
    needsProfileBackfill({ name: 'Velvet Negroni', picture: PIC, placeholderName: true }),
    true
  );
});

test('a bare nsec import backfills', () => {
  assert.equal(needsProfileBackfill({ name: '', picture: '' }), true);
});

test('a picture with no name still backfills', () => {
  assert.equal(needsProfileBackfill({ name: '', picture: PIC }), true);
});

test('a complete profile does NOT backfill', () => {
  assert.equal(needsProfileBackfill({ name: 'Gatsby', picture: PIC }), false);
  assert.equal(
    needsProfileBackfill({ name: 'Gatsby', picture: PIC, placeholderName: false }),
    false,
    'an explicit placeholderName: false must not be read as truthy'
  );
});

test('undefined fields behave as missing, not as present', () => {
  assert.equal(needsProfileBackfill({}), true);
  assert.equal(needsProfileBackfill({ name: 'Gatsby' }), true, 'picture undefined → fetch');
  assert.equal(needsProfileBackfill({ picture: PIC }), true, 'name undefined → fetch');
});

test('no account is not a reason to fetch', () => {
  assert.equal(needsProfileBackfill(null), false);
  assert.equal(needsProfileBackfill(undefined), false);
});

// The old predicate, kept verbatim so the difference is asserted rather than
// described. If someone reverts to && this test tells them exactly what breaks.
test('the previous && form missed the vault-import case', () => {
  const old = (a) => !!a.placeholderName || (!a.name && !a.picture);
  const restored = { name: 'Gatsby', picture: '' };
  assert.equal(old(restored), false, 'the old predicate declined to fetch');
  assert.equal(needsProfileBackfill(restored), true, 'the new one fetches');
});
