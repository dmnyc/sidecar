'use strict';

// Unit coverage for quoteTags in sidepanel.js — the NIP-18 `q` tags the composer
// derives from a note's body.
//
// Why it exists: a bech32 reference pasted into the composer used to go out as nothing
// but text. The note was a quote in the writer's head and a 210-character string in
// everyone else's client: nothing rendered the quoted event, and the quoted author was
// never notified. Sidecar's own notification list keys "quoted your note" off exactly
// this tag (notificationKind's hasQ), so a quote composed in Sidecar didn't read as a
// quote in Sidecar either.
//
// note/nevent quote by event id. naddr quotes by "kind:pubkey:d" coordinate, because an
// addressable event's id changes every time its author edits it.

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

// The real vendored nip19, not a stub — these tags are only as correct as the decode.
const ntCtx = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer };
vm.createContext(ntCtx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'), ntCtx);
const NT = ntCtx.NostrTools;

const ctx = { NT };
vm.createContext(ctx);
vm.runInContext(
  lift(/const BODY_REF_RE = [^;]+;/, 'BODY_REF_RE') + '\n' +
    lift(/function quoteTags\(content\) \{[\s\S]*?\n  \}/, 'quoteTags') + '\n' +
    lift(/function mentionPTags\(content\) \{[\s\S]*?\n  \}/, 'mentionPTags') + '\n' +
    'globalThis.quoteTags = quoteTags; globalThis.mentionPTags = mentionPTags;',
  ctx
);
const quoteTags = (s) => JSON.parse(JSON.stringify(ctx.quoteTags(s)));
const mentionPTags = (s) => JSON.parse(JSON.stringify(ctx.mentionPTags(s)));

const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);
const PK_A = 'c'.repeat(64);
const PK_B = 'd'.repeat(64);
const RELAY = 'wss://relay.example.com/';

const NOTE_REF = NT.nip19.noteEncode(ID_A);
const NEVENT_REF = NT.nip19.neventEncode({ id: ID_B, author: PK_A, kind: 1, relays: [RELAY] });
const NEVENT_BARE = NT.nip19.neventEncode({ id: ID_B });
const NADDR_REF = NT.nip19.naddrEncode({ identifier: 'my-post', pubkey: PK_B, kind: 30023, relays: [RELAY] });

test('a plain note gets no quote tags', () => {
  assert.deepEqual(quoteTags('just words, no refs'), { tags: [], authors: [] });
});

test('a note1 reference quotes by id', () => {
  assert.deepEqual(quoteTags('look at nostr:' + NOTE_REF), { tags: [['q', ID_A]], authors: [] });
});

test('an nevent reference carries its relay hint and author', () => {
  // Positional tag: the author can only be given if the relay slot is filled.
  assert.deepEqual(quoteTags('see nostr:' + NEVENT_REF), {
    tags: [['q', ID_B, RELAY, PK_A]],
    authors: [PK_A],
  });
});

test('an nevent with no hints still quotes by id', () => {
  assert.deepEqual(quoteTags('see nostr:' + NEVENT_BARE), { tags: [['q', ID_B]], authors: [] });
});

test('an naddr quotes by coordinate, not by id', () => {
  assert.deepEqual(quoteTags('read nostr:' + NADDR_REF), {
    tags: [['q', '30023:' + PK_B + ':my-post', RELAY, PK_B]],
    authors: [PK_B],
  });
});

test('several references all get tagged, once each', () => {
  const text = 'nostr:' + NOTE_REF + ' and nostr:' + NEVENT_REF + ' and nostr:' + NOTE_REF + ' again';
  const { tags } = quoteTags(text);
  assert.deepEqual(tags, [['q', ID_A], ['q', ID_B, RELAY, PK_A]]);
});

test('a malformed reference is skipped, not thrown', () => {
  // Same rule as mentionPTags: a bad paste must not cost the user their draft.
  const { tags } = quoteTags('nostr:nevent1' + 'q'.repeat(60) + ' plus nostr:' + NOTE_REF);
  assert.deepEqual(tags, [['q', ID_A]]);
});

test('profile mentions are not quote tags, and quotes are not mentions', () => {
  // The two helpers read the same body and must not poach each other's refs — a `q`
  // for an npub would be meaningless, and a `p` is not how a quote is expressed.
  const npub = NT.nip19.npubEncode(PK_A);
  assert.deepEqual(quoteTags('hi nostr:' + npub), { tags: [], authors: [] });
  assert.deepEqual(mentionPTags('see nostr:' + NEVENT_REF), []);
});

test('the quoted author is offered for a p tag, which is what notifies them', () => {
  // doPublish p-tags quoteTags().authors on top of mentionPTags — that is the whole
  // reason authors is returned separately from tags.
  const { authors } = quoteTags('nostr:' + NEVENT_REF + ' nostr:' + NADDR_REF);
  assert.deepEqual(authors, [PK_A, PK_B]);
});
