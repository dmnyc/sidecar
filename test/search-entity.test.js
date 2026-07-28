'use strict';

// Unit coverage for the search bar's input parsing in sidepanel.js.
//
// The search bar takes whatever you paste and decides what it is: a NIP-19
// identifier, a NIP-05 address, or a name to look up. Getting that wrong in
// either direction is bad — a mis-parsed identifier sends you to a garbage URL,
// and a rejected valid one makes the box look broken — so the classifier is
// pinned here rather than left to manual testing.
//
// extractEntity and NIP05_RE are lifted out of sidepanel.js and evaluated in
// isolation, the same approach normalize-description.test.js uses.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { nip19 } = require('nostr-tools');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(
  lift(/function extractEntity\(raw\)\s*\{[\s\S]*?\n  \}/, 'extractEntity') + '\n' +
  lift(/const NIP05_RE = [^\n]+/, 'NIP05_RE') + '\n' +
  'globalThis.extractEntity = extractEntity; globalThis.NIP05_RE = NIP05_RE;',
  ctx
);
const { extractEntity, NIP05_RE } = ctx;

// A real pubkey, so the bech32 checksums are genuine rather than hand-made.
const PK = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';
const NPUB = nip19.npubEncode(PK);
const NOTE = nip19.noteEncode(PK);
const NEVENT = nip19.neventEncode({ id: PK, relays: [] });
const NPROFILE = nip19.nprofileEncode({ pubkey: PK, relays: [] });
const NADDR = nip19.naddrEncode({ kind: 30023, pubkey: PK, identifier: 'hello', relays: [] });

test('extracts every NIP-19 entity type the search bar accepts', () => {
  for (const [entity, expected] of [
    [NPUB, 'npub'], [NOTE, 'note'], [NEVENT, 'nevent'],
    [NPROFILE, 'nprofile'], [NADDR, 'naddr'],
  ]) {
    const got = extractEntity(entity);
    assert.equal(got, entity, expected + ' should round-trip unchanged');
    assert.equal(nip19.decode(got).type, expected);
  }
});

test('strips a nostr: or web+nostr: scheme', () => {
  assert.equal(extractEntity('nostr:' + NPUB), NPUB);
  assert.equal(extractEntity('web+nostr:' + NPUB), NPUB);
  assert.equal(extractEntity('NOSTR:' + NPUB), NPUB);
});

test('tolerates surrounding whitespace and uppercase', () => {
  assert.equal(extractEntity('  ' + NPUB + '  '), NPUB);
  assert.equal(extractEntity(NPUB.toUpperCase()), NPUB);
});

// The reason this matters: someone pastes a link from a client they don't use,
// and it should reopen in the one they do.
test('pulls the identifier out of a pasted client URL', () => {
  for (const url of [
    'https://njump.me/' + NPUB,
    'https://primal.net/p/' + NPUB,
    'https://jumble.social/users/' + NPUB,
    'https://nostrudel.ninja/#/u/' + NPUB,
    'https://coracle.social/' + NEVENT,
  ]) {
    const got = extractEntity(url);
    assert.ok(got, 'should find an entity in ' + url);
    assert.doesNotThrow(() => nip19.decode(got));
  }
});

test('returns null for things that are not identifiers', () => {
  for (const junk of ['', '   ', 'hello world', 'jack', 'daniel@resolvr.io', 'nostr:', null, undefined]) {
    assert.equal(extractEntity(junk), null, JSON.stringify(junk) + ' should not parse');
  }
});

// 1, b, i and o are not in the bech32 alphabet. If the character class let them
// through, a typo'd identifier would be handed to decode() and throw where a
// clean "that isn't valid" message belongs.
test('stops at characters outside the bech32 alphabet', () => {
  assert.equal(extractEntity('npub1bio'), null, 'b, i and o are not bech32 characters');
  const truncated = extractEntity(NPUB.slice(0, 20) + 'bbb');
  assert.equal(truncated, NPUB.slice(0, 20), 'should stop at the first invalid character');
  assert.throws(() => nip19.decode(truncated), 'a truncated entity must fail the checksum, not resolve');
});

test('NIP05_RE accepts addresses and bare domains, rejects the rest', () => {
  for (const ok of ['daniel@resolvr.io', 'resolvr.io', '_@example.com', 'a.b@sub.domain.co.uk']) {
    assert.ok(NIP05_RE.test(ok), ok + ' should be treated as NIP-05');
  }
  for (const bad of ['hello world', 'not@a', '@x.io', 'plainword', 'a@b@c.io']) {
    assert.ok(!NIP05_RE.test(bad), bad + ' should not be treated as NIP-05');
  }
});

// Order matters in runSearch: an identifier is checked before NIP-05, so an
// identifier must never be swallowed by the NIP-05 branch.
test('an identifier is never mistaken for a NIP-05 address', () => {
  for (const entity of [NPUB, NOTE, NEVENT, NPROFILE, NADDR]) {
    assert.ok(extractEntity(entity), 'identifier must parse first');
  }
});
