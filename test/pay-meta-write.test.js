'use strict';

// savePayMetaEntry — the background's writer for the encrypted pay-meta store.
//
// It exists because a sent zap cannot be labeled from the payment: NIP-57 commits to the
// zap request by description_hash, so the recipient never travels with the invoice.
// Sidecar signed the request, so it records who was paid, keyed by invoice (#253).
//
// The store now has TWO writers — this one and savePayMeta in sidepanel.js — which is
// what makes the cap and the null-handling below load-bearing rather than incidental.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in background.js');
  return m[0];
}

const lifted = [
  lift(/const PAY_META_MAX = \d+;/, 'PAY_META_MAX'),
  lift(/async function savePayMetaEntry\(invoice, meta\) \{[\s\S]*?\n\}/, 'savePayMetaEntry'),
].join('\n');

// `stored` is what secretGet hands back. null models every way the read can fail.
function harness(stored) {
  const ctx = {
    reads: 0,
    writes: [],
    putThrows: null,
    secretGet: async () => { ctx.reads++; return stored; },
    secretPut: async (name, value) => {
      if (ctx.putThrows) throw new Error(ctx.putThrows);
      // structuredClone, or a later mutation of the same object would rewrite history
      // and hide a lost write.
      ctx.writes.push({ name, value: structuredClone(value) });
    },
    Date,
    Object,
    JSON,
  };
  vm.createContext(ctx);
  vm.runInContext('(function () {\n' + lifted + '\nthis.save = savePayMetaEntry;\n}).call(this)', ctx);
  return ctx;
}

test('it records the pubkey against the invoice', async () => {
  const c = harness({});
  await c.save('lnbc1', { zapPubkey: 'a'.repeat(64) });
  assert.equal(c.writes.length, 1);
  assert.equal(c.writes[0].name, 'paymeta');
  assert.equal(c.writes[0].value.lnbc1.zapPubkey, 'a'.repeat(64));
  assert.ok(c.writes[0].value.lnbc1.ts, 'stamped, so the cap can evict oldest-first');
});

test('it merges rather than clobbers an existing entry', async () => {
  // The panel may already have written an address and comment for this invoice from the
  // send modal. Replacing the entry would drop them.
  const c = harness({ lnbc1: { address: 'alice@example.com', comment: 'hi', ts: 1 } });
  await c.save('lnbc1', { zapPubkey: 'b'.repeat(64) });
  const e = c.writes[0].value.lnbc1;
  assert.equal(e.address, 'alice@example.com', 'kept');
  assert.equal(e.comment, 'hi', 'kept');
  assert.equal(e.zapPubkey, 'b'.repeat(64), 'added');
});

test('A FAILED READ IS NOT AN EMPTY STORE', async () => {
  // The destructive one, and the reason this test file exists.
  //
  // secretGet returns {} for a store that is genuinely empty and null when it could not
  // read one — locked, no notes key, or a CORRUPT ENVELOPE, which it deliberately leaves
  // on disk because a future build may recover it. An earlier draft of this function did
  // `(await secretGet('paymeta')) || {}`, which treats all of those as "empty" and then
  // writes — encrypting a one-entry store straight over the envelope and taking every
  // recorded payment with it.
  //
  // A payment going unlabeled is the correct failure. Losing the store is not.
  const c = harness(null);
  await c.save('lnbc1', { zapPubkey: 'c'.repeat(64) });
  assert.deepEqual(c.writes, [], 'nothing may be written when the store could not be read');
});

test('a non-object read is refused too', async () => {
  for (const junk of [undefined, 'not-json', 42, null]) {
    const c = harness(junk);
    await c.save('lnbc1', { zapPubkey: 'd'.repeat(64) });
    assert.deepEqual(c.writes, [], 'refused: ' + JSON.stringify(junk));
  }
});

test('nothing is written without an invoice to key it by', async () => {
  const c = harness({});
  await c.save('', { zapPubkey: 'e'.repeat(64) });
  await c.save(null, { zapPubkey: 'e'.repeat(64) });
  await c.save('lnbc1', null);
  assert.deepEqual(c.writes, []);
  assert.equal(c.reads, 0, 'and it does not even read');
});

test('the cap is enforced here too, evicting oldest first', async () => {
  // Both writers share one store, so a background write that ignored the cap would grow
  // it without bound between panel writes.
  const all = {};
  for (let i = 0; i < 300; i++) all['inv' + i] = { ts: i + 1 };
  const c = harness(all);
  await c.save('new', { zapPubkey: 'f'.repeat(64) });
  const out = c.writes[0].value;
  assert.equal(Object.keys(out).length, 300, 'still capped at 300');
  assert.ok(!('inv0' in out), 'the oldest entry was evicted');
  assert.ok('inv299' in out, 'a recent one was kept');
  assert.ok('new' in out, 'and the new entry is there');
});

test('a write failure is swallowed — the payment already settled', async () => {
  // It runs in the post-payment block, where nothing may throw at the page. A locked
  // keystore makes secretPut throw by design.
  const c = harness({});
  c.putThrows = 'Sidecar is locked';
  await c.save('lnbc1', { zapPubkey: 'a'.repeat(64) }); // must not reject
});
