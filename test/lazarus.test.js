'use strict';

// Lazarus — recovery of user data from relay history (github.com/dmnyc/lazarus).
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

test('ESTIMATED: THE CIPHERTEXT SIZE YIELDS AN ITEM-COUNT BAND', () => {
  // NIP-44 v2: 67 bytes of overhead, padded to a power of two. 260 base64 chars
  // decode to 195 bytes → padded 128 → plaintext in (64, 128] → in 72-byte items:
  // between 1 and 1.
  const b = L.privateBand('A'.repeat(260), 'nip44');
  assert.deepEqual([b.min, b.max], [1, 1]);
  // A bigger payload: 772 chars → 579 bytes → padded 512 → plaintext (256, 512]
  // → items in [4, 7].
  const big = L.privateBand('A'.repeat(772), 'nip44');
  assert.deepEqual([big.min, big.max], [4, 7]);
  // Not a power of two → not a v2 payload → cannot be sized at all.
  assert.equal(L.privateBand('A'.repeat(259), 'nip44'), null);
  // NIP-04: base64 iv (16 bytes) + blocks; plaintext wastes 1-16 bytes per block.
  // 44 chars → 33 bytes → two blocks → plaintext in [17, 32].
  const nip04 = L.privateBand('A'.repeat(44) + '?iv=' + 'B'.repeat(24), 'nip04');
  assert.deepEqual([nip04.min, nip04.max], [17, 32]);
});

test('THE BAND NEVER INVERTS, SO AN EMPTIED PRIVATE LIST NEVER READS AS A ZERO', () => {
  // 132 chars → 99 bytes → padded 32 → plaintext [1, 32] → less than one assumed
  // item: min 1, max floored to 0 must clamp to 1.
  const tiny = L.privateBand('A'.repeat(132), 'nip44');
  assert.deepEqual([tiny.min, tiny.max], [1, 1]);
});

test('ITEMRANGE: EXACT, ESTIMATED, FLAGGED', () => {
  const pub = cand(10, ptags(2), '');
  assert.deepEqual([L.itemRange(pub).min, L.itemRange(pub).max], [2, 2]);
  // Estimated: private content that sizes but does not decrypt. Kind 10000 is
  // where private items apply; a kind-3 candidate has none to size.
  const est = cand(10, ptags(2), 'A'.repeat(772), 10000);
  const r = L.itemRange(est);
  assert.equal(r.certainty, 'estimated');
  assert.equal(r.min, 6); // 2 public + 4
  assert.equal(r.max, 9); // 2 public + 7
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

test('KIND 0 DELTAS ITS FIELDS', () => {
  const chosen = cand(10, [], JSON.stringify({ name: 'New', about: 'same', lud16: 'a@b' }));
  const current = cand(20, [], JSON.stringify({ name: 'Old', about: 'same', website: 'x' }));
  const d = L.delta(chosen, current, 0);
  // Spread: the field arrays come from the core's realm, and strict deepEqual
  // compares prototypes across realms.
  assert.deepEqual([...d.fields.added], ['lud16']);
  assert.deepEqual([...d.fields.changed], ['name']);
  assert.deepEqual([...d.fields.removed], ['website']);
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
  // The replaced section is gone, the replacement is here.
  assert.doesNotMatch(panel, /'Data backup'/, 'the NIP-78 data backup section is still present');
  assert.match(panel, /'Data recovery'/);
  // The wallet's own NIP-78 backup is a different concern and stays.
  assert.match(panel, /fetchBackupEvent\(/);
  assert.match(panel, /NWC_BACKUP_DTAG/);
  // The mute-list decryption helper is shared with the notifications, not deleted.
  assert.match(panel, /function muteTags\(/);
});
