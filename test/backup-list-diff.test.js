'use strict';

// Unit coverage for muteTags() — the private-list half of mute counting, shared
// by the notification filter and the Lazarus recovery screen.
//
// Mutes encrypted in content count as zero unless they're decrypted and merged,
// and a private list of hundreds reading as "0 muted" is the wrong number, not
// a smaller one. Lazarus's own counting (exact / estimated / flagged, and the
// delta rule) lives in test/lazarus.test.js against lazarus.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

const mm = source.match(/async function muteTags\(ev\) \{[\s\S]*?\n  \}/);
if (!mm) throw new Error('Could not find muteTags in sidepanel.js');
// The realm gets a fake `call` standing in for SIDECAR_OWNER_DECRYPT, so each
// test scripts exactly what the keystore returns (and records which NIP it was
// asked for, to pin the 44-first / 4-first heuristic).
const makeMuteTags = (call) =>
  new vm.Script('(function(){' + mm[0] + '\nreturn muteTags;\n})()').runInNewContext({ call });

const p = (n) => ['p', 'pk' + n];

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
  // 1 public + 3 decrypted (word tags ride along; the counter filters by kind)
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

test('muteTags: a pubkey muted publicly and privately counts once after merge', async () => {
  const call = async () => JSON.stringify([['p', 'pk1'], ['p', 'pk9']]);
  const out = await makeMuteTags(call)({ tags: [p(1), p(2)], content: 'ct' });
  const seen = new Set(out.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]));
  assert.equal(seen.size, 3);
});
