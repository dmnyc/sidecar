'use strict';

// Unit coverage for listDiff() and muteTags() — the counting behind the restore
// confirmations.
//
// The modal work is DOM and isn't unit-testable here, but the NUMBERS are the
// confirmation: "23 you follow today are not in the backup" is what stops a
// restore that would shrink a live list, and a wrong number there is the
// destructive-event bug this whole flow exists to prevent. The one case that
// matters most is the reshuffle: same count on both sides, different members —
// counts alone read as "no change" while the restore loses real follows.
// muteTags is here for the private-list half: mutes encrypted in content count
// as zero unless they're decrypted and merged, and a private list of hundreds
// reading as "0 muted" is the wrong number, not a smaller one.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

const m = source.match(/function listDiff\(currentTags, backupTags\) \{[\s\S]*?\n  \}/);
if (!m) throw new Error('Could not find listDiff in sidepanel.js');
const listDiff = new vm.Script('(function(){' + m[0] + '\nreturn listDiff;\n})()').runInNewContext({});

const mm = source.match(/async function muteTags\(ev\) \{[\s\S]*?\n  \}/);
if (!mm) throw new Error('Could not find muteTags in sidepanel.js');
// The realm gets a fake `call` standing in for SIDECAR_OWNER_DECRYPT, so each
// test scripts exactly what the keystore returns (and records which NIP it was
// asked for, to pin the 44-first / 4-first heuristic).
const makeMuteTags = (call) =>
  new vm.Script('(function(){' + mm[0] + '\nreturn muteTags;\n})()').runInNewContext({ call });

// Per-field asserts, not deepEqual: the lifted function runs in a vm realm, and
// deepStrictEqual cross-realm rejects its return object even when every value
// matches.
function same(d, current, backup, dropped, added) {
  assert.equal(d.current, current);
  assert.equal(d.backup, backup);
  assert.equal(d.dropped, dropped);
  assert.equal(d.added, added);
}

const p = (n) => ['p', 'pk' + n];
const N = (n) => Array.from({ length: n }, (_, i) => p(i));

test('identical lists: nothing dropped, nothing added', () => {
  same(listDiff(N(5), N(5)), 5, 5, 0, 0);
});

test('older backup: dropped counts only the current-only follows', () => {
  same(listDiff(N(10), N(7)), 10, 7, 3, 0);
});

test('backup holds extras: added counts them', () => {
  same(listDiff(N(3), N(5)), 3, 5, 0, 2);
});

test('reshuffle: equal counts, different members — the case counts alone miss', () => {
  const cur = [p('a'), p('b'), p('c')];
  const bak = [p('x'), p('y'), p('z')];
  const d = listDiff(cur, bak);
  assert.equal(d.current, 3);
  assert.equal(d.backup, 3);
  assert.equal(d.dropped, 3);
  assert.equal(d.added, 3);
});

test('no live event: everything in the backup is new, nothing is lost', () => {
  same(listDiff(null, N(4)), 0, 4, 0, 4);
});

test('non-p tags and duplicate entries are not counted', () => {
  const tags = [p(1), p(1), ['e', 'evt1'], ['p'], p(2)];
  same(listDiff(tags, [p(1), p(2)]), 2, 2, 0, 0);
});

test('muteTags: no content — public tags only, never marked private', async () => {
  const fail = async () => { throw new Error('must not be called'); };
  const out = await makeMuteTags(fail)({ tags: [p(1), p(2)], content: '' });
  assert.equal(out.ok, true);
  assert.equal(out.private, false);
  assert.equal(out.tags.length, 2);
});

test('muteTags: NIP-44 private list merges with public tags, nip 44 tried first', async () => {
  const tried = [];
  const call = async (msg) => {
    tried.push(msg.nip);
    return JSON.stringify([['p', 'priv1'], ['p', 'priv2'], ['word', 'spam']]);
  };
  const out = await makeMuteTags(call)({ tags: [p(1)], content: 'ciphertext-without-iv' });
  assert.deepEqual(tried, [44]);
  assert.equal(out.ok, true);
  assert.equal(out.private, true);
  // 1 public + 3 decrypted (word tags ride along; listDiff filters by kind)
  assert.equal(out.tags.length, 4);
});

test('muteTags: legacy NIP-04 ciphertext ("?iv=") tries nip 4 first', async () => {
  const tried = [];
  const call = async (msg) => {
    tried.push(msg.nip);
    if (msg.nip === 4) return JSON.stringify([p('priv')]);
    throw new Error('wrong scheme');
  };
  const out = await makeMuteTags(call)({ tags: [], content: 'ct?iv=iv' });
  assert.deepEqual(tried, [4]);
  assert.equal(out.ok, true);
  assert.equal(out.private, true);
});

test('muteTags: undecryptable content — ok=false, public tags kept', async () => {
  const call = async () => { throw new Error('Keystore is locked'); };
  const out = await makeMuteTags(call)({ tags: [p(1)], content: 'ct' });
  assert.equal(out.ok, false);
  assert.equal(out.private, true);
  assert.equal(out.tags.length, 1);
});

test('muteTags: decrypted non-array is not a list — falls through to ok=false', async () => {
  const tried = [];
  const call = async (msg) => { tried.push(msg.nip); return '"a client note, not tags"'; };
  const out = await makeMuteTags(call)({ tags: [], content: 'ct' });
  assert.deepEqual(tried, [44, 4]); // both schemes tried, neither produced tags
  assert.equal(out.ok, false);
});

test('muteTags + listDiff: a pubkey muted publicly and privately counts once', async () => {
  const call = async () => JSON.stringify([['p', 'pk1'], ['p', 'pk9']]);
  const out = await makeMuteTags(call)({ tags: [p(1), p(2)], content: 'ct' });
  same(listDiff(out.tags, out.tags), 3, 3, 0, 0);
});
