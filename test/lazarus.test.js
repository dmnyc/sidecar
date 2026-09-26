'use strict';

// Lazarus — recovery of user data from relay history (github.com/dmnyc/lazarus),
// spec 0.6.1-draft.
//
// The fixtures below are the spec's conformance cases, at least the ones a pure
// core can carry: sudden drops vs gradual curation, clobber episodes, settled
// lists, tombstones that are never recommended, the three certainties for
// encrypted private items, the delta rule's type-and-value comparison, and the
// recovered event's place in time. The four invariants' remaining halves live in
// the panel (scan only on click, publish only on click) and are guarded by the
// source assertions at the bottom.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'lazarus.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const L = ctx.SidecarLazarus;
assert.ok(L, 'lazarus.js did not mount SidecarLazarus');

// An event factory: p-tags numbered so counts and set differences are readable.
let seq = 0;
const nextId = () => 'id' + (++seq).toString().padStart(4, '0') + '0'.repeat(58);
const ptags = (n, from = 0) => Array.from({ length: n }, (_, i) =>
  ['p', 'f'.repeat(16) + (from + i).toString().padStart(48, '0')]);
const DAY = 86400;
// Timestamps are absolute, so ages subtract from a base: candAt(base - DAY) is one
// day older than candAt(base), and the NEWEST version carries the largest number.
const BASE = 100 * DAY;
const ev = (createdAt, tags, content = '') => ({ id: nextId(), created_at: createdAt, tags, content });
const cand = (createdAt, tags, content, kind = 3) => L.candidate(ev(createdAt, tags, content), kind);

// ---- the registry -------------------------------------------------------------------

test('THE REGISTRY IS THE SPEC\'S, IN FULL', () => {
  for (const k of L.KIND_LIST) assert.ok(L.REGISTRY[k], 'KIND_LIST names an unregistered kind');
  assert.equal(L.REGISTRY[3].tier, 1);
  assert.equal(L.REGISTRY[10000].tier, 1);
  assert.equal(L.REGISTRY[10000].privateItems, true);
  assert.equal(L.REGISTRY[10003].privateItems, true);
  assert.equal(L.REGISTRY[10003].profile, 'count');
  assert.equal(L.REGISTRY[0].profile, 'recency');
  assert.equal(L.REGISTRY[10002].profile, 'recency');
  assert.equal(L.REGISTRY[10044].profile, 'none');
  assert.equal(L.REGISTRY[10044].meaningfulEmpty, true, '10044 empty is a defined state, not damage');
  assert.equal(L.REGISTRY[10002].marker, true, 'the read/write marker is part of a relay item');
  // Tier-1 kinds are required; a registry that loses one is a conformance break.
  assert.ok([3, 10000].every((k) => L.REGISTRY[k].tier === 1));
});

// ---- items: type and value, hints are not items --------------------------------------

test('ITEMS COMPARE BY TYPE AND VALUE; A REWRITTEN HINT IS NOT A CHANGE', () => {
  // The same follows with different relay hints in content are the same list.
  const a = cand(100, ptags(3), '{"p0":"wss://a"}');
  const b = cand(90, ptags(3), '{"p0":"wss://b"}');
  const d = L.delta(b, a, 3);
  assert.equal(d.added, 0);
  assert.equal(d.removed, 0);
  // Valueless p-tags are malformed, not members.
  const sloppy = L.candidate({ id: nextId(), created_at: 80, tags: [['p'], ...ptags(2)] }, 3);
  assert.equal(sloppy.publicItems.length, 2);
});

test('ON RELAY LISTS THE MARKER IS PART OF THE ITEM', () => {
  const url = 'wss://relay.example';
  const write = L.candidate({ id: nextId(), created_at: 10, tags: [['r', url, 'write']] }, 10002);
  const read = L.candidate({ id: nextId(), created_at: 20, tags: [['r', url, 'read']] }, 10002);
  const d = L.delta(write, read, 10002);
  assert.equal(d.added + d.removed, 2, 'a rewritten marker is a change — it changes what the relay is for');
});

// ---- the three certainties for private items -----------------------------------------

// Real ciphertexts, from the vendored nostr-tools: the band is checked against
// the true item count of an actual encrypted list, not against its own formula.
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'), { filename: 'nostr-tools.js' });
const NT = globalThis.NostrTools;
const SK = NT.generateSecretKey();
const PK = NT.getPublicKey(SK);
const CONV = NT.nip44.v2.utils.getConversationKey(SK, PK);
const nip44Of = (tags) => NT.nip44.v2.encrypt(JSON.stringify(tags), CONV);
const nip04Of = (tags) => NT.nip04.encrypt(SK, PK, JSON.stringify(tags));

test('ESTIMATED: A REAL ENCRYPTED LIST SITS INSIDE ITS BAND, AT EVERY SIZE', async () => {
  // Sizes chosen to cross NIP-44's padding regimes: 32 bytes, 32-byte steps up
  // to 256, then eighths of the next power of two (a 5-item list pads to 384,
  // which is not a power of two and used to read as "cannot be sized").
  for (const n of [1, 2, 3, 5, 9, 40, 100, 400]) {
    for (const [scheme, content] of [['nip44', nip44Of(ptags(n))], ['nip04', await nip04Of(ptags(n))]]) {
      const b = L.privateBand(content, scheme);
      assert.ok(b, scheme + ' ' + n + ' items: a valid payload came back unsized');
      assert.ok(b.min <= n && n <= b.max, scheme + ' ' + n + ' items outside [' + b.min + ', ' + b.max + ']');
      assert.ok(b.min >= 1 && b.min <= b.max, 'the band inverted or read as zero');
    }
  }
});

test('ESTIMATED: A NIP-04 BAND COUNTS ITEMS, NOT BYTES', async () => {
  // The old band returned the plaintext's BYTE range as its item range: a
  // 50-account NIP-04 mute list read as about 3,650 items, so a client moving
  // the list to NIP-44 looked like a sudden drop of thousands.
  const b = L.privateBand(await nip04Of(ptags(50)), 'nip04');
  assert.ok(b.max < 60, 'a 50-item NIP-04 list sized as ' + b.min + ' to ' + b.max);
  const old = cand(BASE - DAY, [], await nip04Of(ptags(50)), 10000);
  const migrated = cand(BASE, [], nip44Of(ptags(50)), 10000);
  assert.equal(L.rank([migrated, old], 10000).recommended, null, 'a re-encryption is not a clobber');
});

test('ESTIMATED: MALFORMED PAYLOADS ARE FLAGGED, NOT GUESSED', () => {
  // 300 + 67 bytes: 300 is no length calc_padded_len produces, so not NIP-44 v2.
  assert.equal(L.privateBand(Buffer.alloc(367).toString('base64'), 'nip44'), null);
  // NIP-04 ciphertext is whole AES blocks; 33 bytes is not.
  assert.equal(L.privateBand(Buffer.alloc(33).toString('base64') + '?iv=' + Buffer.alloc(16).toString('base64'), 'nip04'), null);
  // calc_padded_len itself, against NIP-44's reference values.
  assert.deepEqual([1, 32, 33, 64, 65, 100, 256, 257, 300, 512, 513, 1000, 65535].map(L.calcPaddedLen),
    [32, 32, 64, 64, 96, 128, 256, 320, 320, 512, 640, 1024, 65536]);
});

test('THE BAND NEVER INVERTS, SO AN EMPTIED PRIVATE LIST NEVER READS AS A ZERO', () => {
  // An encrypted "[]" pads to 32 bytes: less than one assumed item, but a
  // ciphertext is there, so the band says at least one rather than zero.
  const tiny = L.privateBand(nip44Of([]), 'nip44');
  assert.deepEqual([tiny.min, tiny.max], [1, 1]);
  // And an emptied private list is still told apart from a full one: a clobber
  // that re-encrypts "[]" over 40 private mutes is a sudden drop.
  const full = cand(BASE - DAY, [], nip44Of(ptags(40)), 10000);
  const emptied = cand(BASE, [], nip44Of([]), 10000);
  assert.equal(L.rank([emptied, full], 10000).recommended.id, full.id);
});

test('ITEMRANGE: EXACT, ESTIMATED, FLAGGED', () => {
  const pub = cand(10, ptags(2), '');
  assert.deepEqual([L.itemRange(pub).min, L.itemRange(pub).max], [2, 2]);
  // Estimated: private content that sizes but does not decrypt. Kind 10000 is
  // where private items apply; a kind-3 candidate has none to size.
  const est = cand(10, ptags(2), nip44Of(ptags(6)), 10000);
  const r = L.itemRange(est);
  assert.equal(r.certainty, 'estimated');
  assert.ok(r.min <= 8 && 8 <= r.max, '2 public + 6 private must sit inside [' + r.min + ', ' + r.max + ']');
  // Exact: decryption in hand, the full count is known.
  est.decrypted = [{ key: 'p:x', tag: ['p', 'x'.repeat(64)] }];
  assert.deepEqual([L.itemRange(est).min, L.itemRange(est).max, L.itemRange(est).certainty], [3, 3, 'exact']);
  // Flagged: private content that cannot even be sized.
  const flagged = cand(10, ptags(1), 'not base64 at all', 10000);
  assert.equal(L.itemRange(flagged).certainty, 'flagged');
});

// ---- ranking: clobber detection, not size worship -------------------------------------

test('GRADUAL CURATION IS NOT A CLOBBER', () => {
  // A list that shrinks a few items at a time never registers, however far it
  // falls: no single step takes 20% of the version before it.
  const cands = [70, 75, 82, 90, 100].map((n, i) => cand(BASE - i * DAY, ptags(n)));
  const r = L.rank(cands, 3);
  assert.equal(r.recommended, null);
});

test('A SUDDEN DROP THE CURRENT HASN\'T RECOVERED FROM IS RECOMMENDED', () => {
  const pre = cand(BASE - DAY, ptags(100));
  const clobbered = cand(BASE, ptags(50, 100)); // disjoint: 100% missing
  const r = L.rank([clobbered, pre], 3);
  assert.equal(r.recommended.id, pre.id);
  assert.ok(r.clobber);
});

test('A DROP THE LIST HAS SINCE RECOVERED FROM RECOMMENDS NOTHING', () => {
  const pre = cand(BASE - 2 * DAY, ptags(100));
  const clobbered = cand(BASE - DAY, ptags(50, 100));
  const grew = cand(BASE, ptags(95, 100)); // still missing 5 of the pre-drop's min → below the 20% bar
  const r = L.rank([grew, clobbered, pre], 3);
  assert.equal(r.recommended, null);
});

test('A TOMBSTONE IS NEVER RECOMMENDED; THE FULLEST PRE-DROP VERSION IS', () => {
  const good = cand(BASE - DAY, ptags(10));
  const wiped = cand(BASE, []);
  const r = L.rank([wiped, good], 3);
  assert.equal(r.recommended.id, good.id);
  // The same holds when the episode ends on another empty.
  const wiped2 = cand(BASE + 3600, []);
  const r2 = L.rank([wiped2, wiped, good], 3);
  assert.equal(r2.recommended.id, good.id);
});

test('DROPS WITHIN A DAY ARE ONE EPISODE; THE FULLEST PRE-VERSION WINS', () => {
  const fullest = cand(BASE - 400, ptags(100));
  const half = cand(BASE + 3600 * 3, ptags(60, 100));        // drop 1: missing 40
  const partly = cand(BASE + 3600 * 5, ptags(65, 160));      // an edit that regrows a bit
  const clobbered = cand(BASE + 3600 * 6, ptags(30, 200));   // drop 2: missing 35 — 1.5h after drop 1
  const r = L.rank([clobbered, partly, half, fullest], 3);
  assert.equal(r.recommended.id, fullest.id, 'a list clobbered, partly restored, and clobbered again points at its fullest state before the damage');
});

test('A CLOBBER EDITED FIVE TIMES OVER A WEEK IS SETTLED', () => {
  const pre = cand(BASE - 20 * DAY, ptags(100));
  const dropped = cand(BASE - 19 * DAY, ptags(50, 100));
  // Five edits since the drop, spread over more than a week, none a drop itself.
  const ages = [18, 13, 8, 3, 0];
  const edits = ages.map((d, i) => cand(BASE - d * DAY, ptags(52 + i, 100)));
  const r = L.rank([...edits, dropped, pre], 3);
  assert.equal(r.recommended, null);
  assert.ok(r.settled);
});

test('NOTHING IS RECOMMENDED WHILE THE CURRENT SIZE IS UNKNOWN', () => {
  const pre = cand(BASE - DAY, ptags(100), '', 10000);
  const current = cand(BASE, ptags(2), 'garbage content', 10000); // unsizable private → flagged
  const r = L.rank([current, pre], 10000);
  assert.equal(r.recommended, null);
});

test('MEANINGFUL-EMPTY KINDS FORBID RANKING; RECENCY KINDS NEVER RECOMMEND', () => {
  const a = cand(20, ptags(1)), b = cand(10, ptags(50));
  const keys = L.rank([a, b], 10044);
  assert.equal(keys.recommended, null);
  assert.equal(keys.requiresIntent, true);
  assert.equal(L.rank([a, b], 0).recommended, null);
  assert.equal(L.rank([a, b], 10002).recommended, null);
});

test('DROPS MORE THAN A DAY APART ARE SEPARATE EPISODES', () => {
  // The episode gap was measured older-minus-newer, always negative, so every
  // drop in the history joined one episode and the recommendation reached back
  // past two months of the user's own curation to the fullest version ever.
  const v1 = cand(BASE - 60 * DAY, ptags(300));
  const v2 = cand(BASE - 59 * DAY, ptags(100));       // drop 1, two months ago
  const v3 = cand(BASE - 10 * DAY, ptags(110));       // lived with, and grown
  const v4 = cand(BASE - DAY, ptags(20, 500));        // drop 2, yesterday
  const r = L.rank([v4, v3, v2, v1], 3);
  assert.equal(r.recommended.id, v3.id, 'the recommendation must come from the episode being recovered from');
});

test('BACK-TO-BACK DROPS ARE ONE EPISODE, HOWEVER FAR APART', () => {
  // The spec: "Drops back to back, or within 24 hours of each other".
  const v1 = cand(BASE - 10 * DAY, ptags(100));
  const v2 = cand(BASE - 5 * DAY, ptags(60));         // drop: 40 of 100
  const v3 = cand(BASE - DAY, ptags(30));             // drop again, the very next version
  const r = L.rank([v3, v2, v1], 3);
  assert.equal(r.recommended.id, v1.id, 'the fullest state before the damage, not the half-clobbered one');
});

test('SETTLED COUNTS EDITS AFTER THE DROP, NOT THE DROP ITSELF', () => {
  // Four edits over two weeks is not five: the dropped version is the clobber,
  // not an edit on it, and counting it settled a clobber one edit early.
  const pre = cand(BASE - 20 * DAY, ptags(100));
  const dropped = cand(BASE - 19 * DAY, ptags(50, 100));
  const edits = [18, 13, 8, 0].map((d, i) => cand(BASE - d * DAY, ptags(52 + i, 100)));
  const r = L.rank([...edits, dropped, pre], 3);
  assert.equal(r.settled, undefined);
  assert.equal(r.recommended.id, pre.id);
});

test('A SAME-SECOND TIE GOES TO THE LOWEST ID, AS RELAYS KEEP IT', () => {
  // NIP-01: with equal created_at, the lowest id is retained. That version is
  // current, whatever order the relays returned them in.
  const hi = L.candidate({ id: 'b'.repeat(64), created_at: BASE, tags: ptags(3), content: '' }, 3);
  const lo = L.candidate({ id: 'a'.repeat(64), created_at: BASE, tags: ptags(4), content: '' }, 3);
  assert.equal(L.rank([hi, lo], 3).ordered[0].id, lo.id);
  assert.equal(L.rank([lo, hi], 3).ordered[0].id, lo.id);
  // And a re-read that finds the lower id at the reviewed second is a change.
  assert.equal(L.checkCurrent(hi, lo, true).status, 'changed');
  assert.equal(L.checkCurrent(lo, hi, true).status, 'proceed');
});

test('AN UNSIZABLE VERSION NEVER OUTRANKS A KNOWN ONE AS "FULLEST"', () => {
  // Fullest was judged by maximum first, and a flagged version's maximum is
  // Infinity: it won every episode it was in, over a version known to be full.
  const known = cand(BASE, ptags(100), '', 10000);
  const x = cand(BASE + 3600, ptags(10), '', 10000);                    // drop from 100
  const flagged = cand(BASE + 7200, ptags(100), 'not a payload', 10000); // [100, Infinity]
  const y = cand(BASE + 10800, [], '', 10000);                           // emptied
  assert.equal(L.itemRange(flagged).certainty, 'flagged');
  const r = L.rank([y, flagged, x, known], 10000);
  assert.equal(r.recommended.id, known.id);
});

test('MUTED WORDS, HASHTAGS AND THREADS ARE MUTE-LIST ITEMS', () => {
  // NIP-51 mutes are p, t, word and e. Counting only accounts missed a clobber
  // that wiped fifty muted words, and the delta hid the words a restore removes.
  const muteTags = (n) => [...ptags(3), ...Array.from({ length: n }, (_, i) => ['word', 'spam' + i]),
    ['t', 'nsfw'], ['e', 'e'.repeat(64)]];
  const pre = cand(BASE - DAY, muteTags(50), '', 10000);
  const clobbered = cand(BASE, ptags(3), '', 10000);
  assert.equal(L.rank([clobbered, pre], 10000).recommended.id, pre.id);
  const d = L.delta(clobbered, cand(BASE + 60, muteTags(20), '', 10000), 10000);
  assert.equal(d.removed, 22, '20 words, a hashtag and a thread would be unmuted');
  assert.equal(d.shrink, true);
  // Bookmarks stay e and a, as NIP-51 has them.
  assert.equal(cand(10, [['e', 'e'.repeat(64)], ['a', '30023:' + 'a'.repeat(64) + ':x'], ['p', 'p'.repeat(64)]], '', 10003).publicItems.length, 2);
});

test('AN ITEM COUNTS ONCE, HOWEVER MANY TIMES IT IS LISTED', () => {
  const [one, two] = ptags(2);
  const c = cand(10, [one, one, ['p', one[1], 'wss://hint'], two], '', 10000);
  assert.equal(L.itemRange(c).max, 2, 'a duplicated tag is one follow, not two');
  // Listed publicly and privately: still one item.
  c.decrypted = L.privateItems([one, ['p', 'c'.repeat(64)]], 10000);
  assert.equal(L.itemRange(c).max, 3);
});

test('DECRYPTED PRIVATE ITEMS PASS THE SAME TYPE FILTER AS PUBLIC TAGS', () => {
  const decrypted = [['p', 'a'.repeat(64)], ['t', 'nostr'], ['relay', 'wss://x'], 'not a tag', ['p'], ['e', 'e'.repeat(64)]];
  assert.equal(L.privateItems(decrypted, 10000).length, 3, 'p, t and e are mutes; relay, a string and a valueless tag are not');
  assert.equal(L.privateItems(decrypted, 10003).length, 1, 'only the e tag is a bookmark');
});

test('A PAST PROFILE IS OFFERED; AN EMPTY ONE IS NOT', () => {
  // Kind 0 keeps its data in content, and counting only tags made every profile
  // version read as empty: none could ever be restored.
  const old = cand(10, [], JSON.stringify({ name: 'Me', about: 'hi' }), 0);
  assert.deepEqual([L.itemRange(old).min, L.itemRange(old).max], [2, 2]);
  assert.equal(L.isRestorable(old, { kind: 0, isCurrent: false }), true);
  assert.equal(L.isRestorable(cand(20, [], '{}', 0), { kind: 0, isCurrent: false }), false);
});

test('A REWRITTEN RELAY URL IS NOT A CHANGE', () => {
  const a = L.candidate({ id: nextId(), created_at: 10, tags: [['r', 'wss://Relay.Example/'], ['r', 'wss://b.example:443', 'write']] }, 10002);
  const b = L.candidate({ id: nextId(), created_at: 20, tags: [['r', 'wss://relay.example'], ['r', 'wss://b.example', 'write']] }, 10002);
  const d = L.delta(a, b, 10002);
  assert.equal(d.added + d.removed, 0);
  assert.equal(L.relayKey('wss://relay.example//inbox/'), 'wss://relay.example/inbox');
});

test('NO RECOVERABLE IMPROVEMENT IS A NORMAL ANSWER', () => {
  const r = L.rank([cand(10, ptags(5)), cand(9, ptags(4)), cand(8, ptags(6))], 3);
  assert.equal(r.recommended, null);
  assert.equal(r.settled, undefined);
});

// ---- the delta rule -------------------------------------------------------------------

test('THE DELTA COUNTS BOTH DIRECTIONS AND FLAGS A SHRINK', () => {
  const chosen = cand(10, ptags(3));
  const current = cand(20, [...ptags(1), ['p', 'z'.repeat(64)]]);
  const d = L.delta(chosen, current, 3);
  assert.equal(d.added, 2);
  assert.equal(d.removed, 1);
  assert.equal(d.shrink, true);
  assert.ok(d.notes.some((n) => n.includes('removed')), 'the shrink must be stated');
  // And the mute list's direction of harm is named.
  const m = L.delta(chosen, current, 10000);
  assert.ok(m.notes.some((n) => /re-silence/.test(n)));
});

test('AN UNCOUNTED PRIVATE LIST SAYS SO IN THE DELTA', () => {
  const d = L.delta(cand(10, ptags(3)), cand(20, ptags(3)), 10000, true);
  assert.ok(d.notes.some((n) => /private items out/.test(n)));
});

test('AN UNREADABLE CURRENT LIST IS UNCOUNTED, AND TAKES THE SHRINK PATH', () => {
  // The flag used to come from the chosen version alone. A restore replaces the
  // current version's encrypted items wholesale, so when those could not be
  // read the counts are incomplete and the restore may remove items unseen.
  const chosen = cand(10, ptags(3), nip44Of(ptags(2, 50)), 10000);
  chosen.decrypted = L.privateItems(ptags(2, 50), 10000);
  const current = cand(20, ptags(3), nip44Of(ptags(9, 70)), 10000); // not decrypted
  const d = L.delta(chosen, current, 10000);
  assert.equal(d.removed, 0, 'the visible counts show nothing removed');
  assert.equal(d.uncounted, true);
  assert.equal(d.currentUncounted, true);
  assert.equal(d.shrink, true, 'removing unseen items is still a shrink');
  assert.ok(d.notes.some((n) => /current encrypted items/.test(n)));
  // The same ciphertext on both sides: nothing private changes, nothing is uncounted.
  const same = cand(30, ptags(4), current.content, 10000);
  const s = L.delta(same, current, 10000);
  assert.equal(s.uncounted, false);
  assert.equal(s.shrink, false);
});

test('ENCRYPTION KEYS ARE THE n TAGS NIP-4e LISTS THEM IN (0.6.1)', () => {
  // Counting p tags, as the registry once said, read every real key list as empty:
  // no version offered keys to restore, and the intent question asked the wrong way.
  const keys = cand(10, [['n', 'a'.repeat(64)], ['n', 'b'.repeat(64)]], '', 10044);
  assert.deepEqual([L.itemRange(keys).min, L.itemRange(keys).max], [2, 2]);
  assert.equal(L.itemRange(cand(10, [['p', 'c'.repeat(64)]], '', 10044)).max, 0, 'a p tag is a key share, not a key');
  assert.equal(L.SPEC_VERSION, '0.6.1-draft');
});

test('MEANINGFUL-EMPTY DELTAS STATE BOTH ENDPOINTS, IN THE RIGHT DIRECTION', () => {
  const keys = cand(10, [['n', 'a'.repeat(64)]], '', 10044);
  const empty = cand(20, [], '', 10044);
  const restoring = L.delta(keys, empty, 10044).notes;
  assert.ok(restoring.includes(L.REGISTRY[10044].restoreNote));
  assert.ok(restoring.includes(L.REGISTRY[10044].emptyMeaning));
  // Choosing the EMPTY version used to say "clients will encrypt direct messages
  // to them again": the opposite of what that restore does.
  const emptying = L.delta(empty, keys, 10044).notes;
  assert.ok(!emptying.includes(L.REGISTRY[10044].restoreNote));
  assert.ok(emptying.includes(L.REGISTRY[10044].emptyRestoreNote));
  assert.ok(emptying.includes(L.REGISTRY[10044].currentMeaning));
});

test('KIND 0 DELTAS ITS FIELDS', () => {
  const chosen = cand(10, [], JSON.stringify({ name: 'New', about: 'same', lud16: 'a@b' }));
  const current = cand(20, [], JSON.stringify({ name: 'Old', about: 'same', website: 'x' }));
  const d = L.delta(chosen, current, 0);
  // Spread: the field arrays come from the core's realm, and strict deepEqual
  // compares prototypes across realms.
  assert.deepEqual([...d.fields.added], ['lud16']);
  assert.deepEqual([...d.fields.changed], ['name']);
  assert.deepEqual([...d.fields.removed], ['website']);
  assert.ok(d.notes.includes(L.REGISTRY[0].restoreNote), 'the profile\'s own warning is shown too');
});

test('KIND 0 DELTAS ITS TAGS TOO — A RESTORE REPLACES ALL OF THEM', () => {
  // NIP-30 custom emoji live in a profile's tags; a fixed content-field diff
  // could report "no change" while the restore reverted a tag it never compared.
  const chosen = cand(10, [['emoji', 'wow', 'https://a/wow.png']], '{}');
  const current = cand(20, [['emoji', 'wow', 'https://b/wow.png']], '{}');
  const d = L.delta(chosen, current, 0);
  assert.equal(d.tagsAdded, 1);
  assert.equal(d.tagsRemoved, 1);
  assert.deepEqual([...d.fields.added], []);
});

// ---- the pre-sign re-read, decided ----------------------------------------------------

test('THE RE-READ: ONLY A NEWER VERSION IS A CHANGE', () => {
  const reviewed = cand(5000, ptags(3));
  const older = cand(4000, ptags(5));
  // An older copy on a re-read relay is not a change: the re-read asks fewer
  // relays than the scan did, and a stale copy is not evidence the list moved.
  assert.equal(L.checkCurrent(reviewed, older, true).status, 'proceed');
  // A NEWER version means the list moved since the review: recompute and re-ask.
  const newer = cand(6000, ptags(1));
  const changed = L.checkCurrent(reviewed, newer, true);
  assert.equal(changed.status, 'changed');
  assert.equal(changed.version.id, newer.id);
  // Identical event: proceed.
  assert.equal(L.checkCurrent(reviewed, reviewed, true).status, 'proceed');
  // Nothing found anywhere: proceed — current stands as reviewed.
  assert.equal(L.checkCurrent(reviewed, null, true).status, 'proceed');
});

test('THE RE-READ: NO WRITE RELAY ANSWERED, NOTHING GETS SIGNED', () => {
  const reviewed = cand(5000, ptags(3));
  // An absent answer is not an unchanged one — even with an empty re-read.
  assert.equal(L.checkCurrent(reviewed, null, false).status, 'unconfirmed');
  // And a newer version found by a relay that then failed does not turn silence
  // into confirmation: the outcome still gates.
  assert.equal(L.checkCurrent(reviewed, cand(6000, ptags(1)), false).status, 'unconfirmed');
});

test('NOTHING IS RECOMMENDED WHILE CURRENT IS UNCONFIRMED', () => {
  // A scan that never reached the user's write relays may be measuring drops
  // against a version the user already replaced.
  const pre = cand(BASE - DAY, ptags(100));
  const clobbered = cand(BASE, ptags(50, 100));
  const r = L.rank([clobbered, pre], 3, { currentConfirmed: false });
  assert.equal(r.recommended, null);
  assert.equal(r.currentUnconfirmed, true);
  // The same story, write relays having answered: the recommendation stands.
  const ok = L.rank([clobbered, pre], 3, { currentConfirmed: true });
  assert.equal(ok.recommended.id, pre.id);
});

// ---- the recovery event ----------------------------------------------------------------

test('THE RECOVERED EVENT BEATS WHAT IT REPLACES AND CARRIES THE ITEMS VERBATIM', () => {
  // A clobbering client with a skewed clock published created_at 10,000: an
  // honest "now" that is older than that loses on relays and in caches.
  const chosen = cand(5000, ptags(3), '{"p0":"wss://keep"}');
  const current = cand(10000, ptags(2));
  const e = L.recoveryEvent(chosen, 3, 9000, current.createdAt);
  assert.equal(e.created_at, 10001);
  assert.equal(e.kind, 3);
  assert.equal(e.content, '{"p0":"wss://keep"}', 'relay hints ride along, verbatim');
  assert.deepEqual(e.tags, chosen.event.tags, 'the item set is the candidate\'s, verbatim');
  // An honest clock just needs now.
  assert.equal(L.recoveryEvent(chosen, 3, 20000, current.createdAt).created_at, 20000);
});

// ---- what may be offered ---------------------------------------------------------------

test('PAST EMPTY VERSIONS ARE SHOWN BUT NOT OFFERED', () => {
  const wiped = cand(10, []);
  assert.equal(L.isRestorable(wiped, { kind: 3, isCurrent: false }), false);
  // The current empty version is shown as it is — and restoring current over
  // itself is not an offer either.
  assert.equal(L.isRestorable(cand(20, []), { kind: 3, isCurrent: true }), false);
  // A non-empty older version is the normal case.
  assert.equal(L.isRestorable(cand(10, ptags(2)), { kind: 3, isCurrent: false }), true);
  // A meaningful-empty kind's empty state is a defined option, not damage.
  assert.equal(L.isRestorable(cand(10, [], '', 10044), { kind: 10044, isCurrent: false }), true);
});

// ---- the panel's side of the contract ---------------------------------------------------
// The core cannot enforce the invariants that live where the clicks are, so these
// assert the panel still wires them: scan and publish are click-driven, the Lazarus
// screen replaced the NIP-78 data backup, and the script is loaded.

test('THE PANEL LOADS THE CORE AND THE SCREEN REPLACED THE BACKUP SECTION', () => {
  assert.match(html, /<script src="lazarus\.js"><\/script>/, 'the core is not loaded');
  // The panel ranks, deltas and builds recoveries through the core, never
  // reimplementing the spec's math inline.
  assert.match(panel, /const Lz = self\.SidecarLazarus;/);
  assert.match(panel, /Lz\.rank\(/, 'the panel does not rank through the core');
  assert.match(panel, /Lz\.delta\(/, 'the panel does not delta through the core');
  assert.match(panel, /Lz\.recoveryEvent\(/, 'the panel does not build recoveries through the core');
  assert.match(panel, /Lz\.checkCurrent\(/, 'the re-read decision is not the core\'s');
  // 0.6.0: relays are untrusted and their outcomes are recorded. Every event is
  // verified before it can become a candidate; a scan no relay answered is a
  // failure with a retry, never "no versions found"; the override exists and is
  // a deliberate second gate.
  assert.match(panel, /function lazarusValidEvent\(/);
  assert.match(panel, /NT\.verifyEvent\(ev\) && ev\.kind === kind && ev\.pubkey === pubkey/);
  assert.match(panel, /No relay answered/);
  assert.match(panel, /Retry the relays that failed/);
  assert.match(panel, /Restore without confirming/);
  assert.match(panel, /currentConfirmed: scan\.writeAnswered/);
  // The replaced section is gone, the replacement is here.
  assert.doesNotMatch(panel, /'Data backup'/, 'the NIP-78 data backup section is still present');
  assert.match(panel, /'Data recovery'/);
  // The wallet's own NIP-78 backup is a different concern and stays.
  assert.match(panel, /fetchBackupEvent\(/);
  assert.match(panel, /NWC_BACKUP_DTAG/);
});
