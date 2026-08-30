'use strict';

// Unit coverage for zap-request correlation (zap-requests.js).
//
// This module decides whether a Lightning payment may go out with NO prompt, so its
// invariants are spending controls, not conveniences:
//   - a payment only auto-approves against a zap request THIS user signed, for this
//     site, this account, and this exact amount;
//   - single-use — one signed request authorizes one payment, never a run of them;
//   - anything that can't be bound tightly (no amount tag, no invoice amount) is
//     refused rather than stored loosely: the cost of refusing is a prompt;
//   - records expire, and a lock clears them outright.
//
// The check it replaces looked for a kind:9734 zap request inline in the invoice
// description. NIP-57 step 6 issues a description HASH invoice, so that field is empty
// on every spec-compliant zap and the old check never fired at all — "Auto-approve
// zaps" was dead. It was also weaker in principle: any site could paste a real-looking
// 9734 into a description it wrote itself, with nothing tying it to the user. The
// no-inline-description case is pinned below so that regression can't come back.
//
// zap-requests.js is isolated (talks only to globalThis.chrome), so we load it in a vm
// against a small chrome mock — same approach as test/replaceable-baseline.test.js.

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function makeStorageArea() {
  const data = {};
  return {
    get(keys, cb) {
      let out = {};
      if (keys == null) out = { ...data };
      else if (typeof keys === 'string') { if (keys in data) out[keys] = data[keys]; }
      else if (Array.isArray(keys)) { for (const k of keys) if (k in data) out[k] = data[k]; }
      else { for (const k of Object.keys(keys)) out[k] = (k in data) ? data[k] : keys[k]; }
      cb(out);
    },
    set(obj, cb) { Object.assign(data, obj); cb && cb(); },
    remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) delete data[k]; cb && cb(); },
    clear(cb) { for (const k of Object.keys(data)) delete data[k]; cb && cb(); },
  };
}

let Z;
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const SITE = 'jumble.social';
const OTHER = 'evil.example';

// A kind:9734 zap request for `msat` millisats. `amount` is optional per NIP-57, so
// passing null models the request that carries none.
function zapRequest(msat, extraTags) {
  const tags = [['p', 'c'.repeat(64)], ['relays', 'wss://relay.example']];
  if (msat != null) tags.push(['amount', String(msat)]);
  return { kind: 9734, content: '', tags: tags.concat(extraTags || []) };
}

before(() => {
  globalThis.self = globalThis;
  globalThis.chrome = { storage: { session: makeStorageArea() }, runtime: {} };
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'zap-requests.js'), 'utf8'), {
    filename: 'zap-requests.js',
  });
  Z = globalThis.SidecarZapRequests;
  assert.ok(Z, 'SidecarZapRequests loaded');
});

beforeEach(async () => {
  await Z.clear();
});

// ---- the happy path ----

test('a signed zap request lets the matching payment through', async () => {
  assert.equal(await Z.record(SITE, ALICE, zapRequest(212000)), true);
  assert.equal(await Z.claim(SITE, ALICE, 212), true);
});

test('sub-sat rounding still matches (invoice sats -> millisats)', async () => {
  await Z.record(SITE, ALICE, zapRequest(1000));
  assert.equal(await Z.claim(SITE, ALICE, 1), true);
});

test('several queued zaps each pay exactly once', async () => {
  await Z.record(SITE, ALICE, zapRequest(100000));
  await Z.record(SITE, ALICE, zapRequest(212000));
  assert.equal(await Z.claim(SITE, ALICE, 212), true);
  assert.equal(await Z.claim(SITE, ALICE, 100), true);
  assert.equal(await Z.claim(SITE, ALICE, 100), false, 'no third payment');
});

// ---- single use ----

test('one signed request cannot authorize two payments', async () => {
  await Z.record(SITE, ALICE, zapRequest(212000));
  assert.equal(await Z.claim(SITE, ALICE, 212), true);
  assert.equal(await Z.claim(SITE, ALICE, 212), false, 'replay must be refused');
});

// ---- scoping: the abuse cases ----

test('a different site cannot spend my zap request', async () => {
  await Z.record(SITE, ALICE, zapRequest(212000));
  assert.equal(await Z.claim(OTHER, ALICE, 212), false);
  assert.equal(await Z.claim(SITE, ALICE, 212), true, 'still there for the real site');
});

test('a different account cannot spend it', async () => {
  await Z.record(SITE, ALICE, zapRequest(212000));
  assert.equal(await Z.claim(SITE, BOB, 212), false);
});

test('the amount must match exactly — no overpaying a small approval', async () => {
  await Z.record(SITE, ALICE, zapRequest(212000));
  assert.equal(await Z.claim(SITE, ALICE, 213), false);
  assert.equal(await Z.claim(SITE, ALICE, 211), false);
  assert.equal(await Z.claim(SITE, ALICE, 500000), false);
  assert.equal(await Z.claim(SITE, ALICE, 212), true);
});

test('a payment with no prior zap request is never auto-approved', async () => {
  assert.equal(await Z.claim(SITE, ALICE, 212), false);
});

// ---- refuse what cannot be bound ----

test('a zap request without an amount tag is not stored', async () => {
  assert.equal(await Z.record(SITE, ALICE, zapRequest(null)), false);
  assert.deepEqual(await Z.pending(), [], 'a match-anything record is not a safeguard');
});

test('a non-numeric or non-positive amount is not stored', async () => {
  for (const bad of ['abc', '0', '-5000', '']) {
    const ev = { kind: 9734, content: '', tags: [['amount', bad]] };
    assert.equal(await Z.record(SITE, ALICE, ev), false, 'amount ' + JSON.stringify(bad));
  }
  assert.deepEqual(await Z.pending(), []);
});

test('an amountless invoice never claims a record', async () => {
  await Z.record(SITE, ALICE, zapRequest(212000));
  assert.equal(await Z.claim(SITE, ALICE, null), false);
  assert.equal(await Z.claim(SITE, ALICE, undefined), false);
  assert.equal(await Z.claim(SITE, ALICE, NaN), false);
  assert.equal((await Z.pending()).length, 1, 'and does not consume it');
});

test('only kind 9734 is recorded', async () => {
  for (const kind of [0, 1, 3, 9735, 10000]) {
    assert.equal(await Z.record(SITE, ALICE, { kind, tags: [['amount', '212000']] }), false);
  }
  assert.deepEqual(await Z.pending(), []);
});

test('malformed events are refused without throwing', async () => {
  for (const ev of [null, undefined, {}, { kind: 9734 }, { kind: 9734, tags: 'nope' }]) {
    assert.equal(await Z.record(SITE, ALICE, ev), false);
  }
  assert.equal(await Z.record('', ALICE, zapRequest(1000)), false, 'no host');
  assert.equal(await Z.record(SITE, '', zapRequest(1000)), false, 'no account');
  assert.deepEqual(await Z.pending(), []);
});

// ---- peek: decides whether the page-invoice card can be skipped ----

test('peek matches without consuming, so the payment can still claim', async () => {
  await Z.record(SITE, ALICE, zapRequest(21000));
  assert.equal(await Z.peek(SITE, ALICE, 21), true);
  assert.equal(await Z.peek(SITE, ALICE, 21), true, 'repeatable — peeking is not spending');
  assert.equal((await Z.pending()).length, 1);
  assert.equal(await Z.claim(SITE, ALICE, 21), true, 'the record survived to be claimed');
});

test('peek is scoped exactly like claim', async () => {
  await Z.record(SITE, ALICE, zapRequest(21000));
  assert.equal(await Z.peek(OTHER, ALICE, 21), false, 'wrong site');
  assert.equal(await Z.peek(SITE, BOB, 21), false, 'wrong account');
  assert.equal(await Z.peek(SITE, ALICE, 22), false, 'wrong amount');
  assert.equal(await Z.peek(SITE, ALICE, null), false, 'amountless');
  assert.equal(await Z.peek(SITE, ALICE, 21), true);
});

test('peek finds nothing when no zap was authorized', async () => {
  assert.equal(await Z.peek(SITE, ALICE, 21), false);
});

test('peek refuses an expired record', async () => {
  await Z.record(SITE, ALICE, zapRequest(21000));
  const stale = (await Z.pending()).map((z) => ({ ...z, ts: z.ts - Z.TTL_MS - 1000 }));
  await new Promise((r) => chrome.storage.session.set({ [Z.STORAGE_KEY]: stale }, r));
  assert.equal(await Z.peek(SITE, ALICE, 21), false);
});

// ---- expiry and lock ----

test('an expired record is refused', async () => {
  await Z.record(SITE, ALICE, zapRequest(212000));
  const stale = (await Z.pending()).map((z) => ({ ...z, ts: z.ts - Z.TTL_MS - 1000 }));
  await new Promise((r) => chrome.storage.session.set({ [Z.STORAGE_KEY]: stale }, r));
  assert.equal(await Z.claim(SITE, ALICE, 212), false);
});

test('recording sweeps expired records', async () => {
  await new Promise((r) =>
    chrome.storage.session.set(
      { [Z.STORAGE_KEY]: [{ host: SITE, pubkey: ALICE, msat: 1, ts: Date.now() - Z.TTL_MS - 1 }] },
      r
    )
  );
  await Z.record(SITE, ALICE, zapRequest(212000));
  const left = await Z.pending();
  assert.equal(left.length, 1);
  assert.equal(left[0].msat, 212000);
});

test('lock clears every pending approval', async () => {
  await Z.record(SITE, ALICE, zapRequest(212000));
  await Z.record(SITE, BOB, zapRequest(100000));
  await Z.clear();
  assert.deepEqual(await Z.pending(), []);
  assert.equal(await Z.claim(SITE, ALICE, 212), false);
});

// ---- the regression this module exists for ----

test('a real zap invoice carries NO inline description, which is why the old check never fired', () => {
  // Tag 13 ('d') is the inline description; tag 23 ('h') is the description hash.
  // Real NIP-57 zap invoices, as collected from a live client, carry only 'h'.
  const REAL_ZAP_INVOICES = [
    'lnbc2120n1p4x232wpp559ajf4ec7s4t7gef74xnsyqert3jt807dr6ydxq23ft3hdskd2rqhp5wau44uqa3az65r80rmn4ymfsqnwrex4yhzfll8aul55e48cgcjmscqzysxqrrssrzjqv3dpepm8kfdxrk3sl6wzqdf49s9c0h9ljtjrek6c08r6aejlwcnur0dwyqqvusqqqqqqqlgqqqq86qqjqsp5g5kgwuuptl7yjc7g9xxzhcs8dnejccuy8fy3z9xywz02uhnqpagq9qxpqysgqneh4h267tam88h5hqnwj6rt2u40ekwcfuevejt60kjdu6lpp0lqq7a9nwjxdmqqz8x9cxlsp75qs4wl6qgn7g3uk7p8z25u33mg8h7gq8fhzmf',
    'lnbc840n1p4x2jvwpp5fng2eafm4m6zqj33jvquywx5edmq02sca2cfxmtlzxvddxpjlspssp5dcxdutntg573nsuwduvz5edanyh707wzkfjjha79clny7p7zhwlqxq9z0rgqnp4qvyndeaqzman7h898jxm98dzkm0mlrsx36s93smrur7h0azyyuxc5rzjq25carzepgd4vqsyn44jrk85ezrpju92xyrk9apw4cdjh6yrwt5jgqqqqrt49lmtcqqqqqqqqqqq86qq9qrzjqvt4uzpwalva67rw74e4a4qkxgvfh8z7cu68k8ctx3l5sxssr0578apyqr6zgqqqq8hxk2qqae4jsqyugqcqzpuhp5kkfy66cj2050ug3pwuc4vdwnv8wec30dqh6xz822ym2f6uvnqxtq9qyyssqdkpznl3ek82zqvjd90ru27ysx4pqpqn8jjk0uqxa8232ftdlu654djysf5dws2mpyhnejvtva3uuzpxxvg4naerm8c4m7mnxc8xnahsp94d6n7',
  ];
  const CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const tagsOf = (inv) => {
    const words = inv.slice(inv.lastIndexOf('1') + 1).split('').map((c) => CHARS.indexOf(c));
    const body = words.slice(0, words.length - 6);
    const end = body.length - 104;
    const found = [];
    let i = 7;
    while (i + 3 <= end) {
      const tag = body[i];
      const len = body[i + 1] * 32 + body[i + 2];
      if (i + 3 + len > end) break;
      found.push(tag);
      i += 3 + len;
    }
    return found;
  };
  for (const inv of REAL_ZAP_INVOICES) {
    const tags = tagsOf(inv);
    assert.ok(tags.includes(23), 'zap invoice commits via description hash (tag 23)');
    assert.ok(!tags.includes(13), 'and carries no inline description (tag 13) to sniff');
  }
});

// ---- the recipient, carried for labelling only (#253) ----------------------------
//
// A sent zap can never be labeled from the payment itself: NIP-57 step 6 has the lnurl
// server issue a description_hash invoice, so the request is committed to and never
// travels with it. The paying wallet genuinely does not know who it paid. Sidecar signed
// the request seconds earlier and does, so the recipient rides along on the record that
// already exists for the spending gate.
//
// The invariant that matters here is that this is a CAPTION, not a permission: reading
// it must not change what the payment is allowed to do.

const CAROL = 'c'.repeat(64); // the p tag zapRequest() builds

test('the recipient is recorded and can be read back', async () => {
  await Z.record(SITE, ALICE, zapRequest(212000));
  assert.equal(await Z.recipientFor(SITE, ALICE, 212), CAROL);
});

test('reading the recipient does not spend the approval', async () => {
  // THE ONE THAT MATTERS. recipientFor runs on every payment; if it consumed, the
  // auto-zap claim right after it would find nothing and every zap would prompt —
  // a label silently turning a feature off.
  await Z.record(SITE, ALICE, zapRequest(212000));
  assert.equal(await Z.recipientFor(SITE, ALICE, 212), CAROL);
  assert.equal(await Z.recipientFor(SITE, ALICE, 212), CAROL, 'still there on a second read');
  assert.equal(await Z.claim(SITE, ALICE, 212), true, 'the claim still has its record');
  assert.equal(await Z.claim(SITE, ALICE, 212), false, 'and it is single-use as before');
});

test('the recipient is refused on exactly the terms the claim is', async () => {
  // Same predicate, so a label can never name someone the gate would not have matched.
  await Z.record(SITE, ALICE, zapRequest(212000));
  assert.equal(await Z.recipientFor(SITE, ALICE, 999), '', 'wrong amount');
  assert.equal(await Z.recipientFor(OTHER, ALICE, 212), '', 'wrong site');
  assert.equal(await Z.recipientFor(SITE, BOB, 212), '', 'wrong account');
  assert.equal(await Z.recipientFor(SITE, ALICE, null), '', 'amountless invoice');
});

test('an expired record names no one', async () => {
  await Z.record(SITE, ALICE, zapRequest(212000));
  const stale = (await Z.pending()).map((z) => ({ ...z, ts: z.ts - Z.TTL_MS - 1000 }));
  await new Promise((r) => chrome.storage.session.set({ [Z.STORAGE_KEY]: stale }, r));
  assert.equal(await Z.recipientFor(SITE, ALICE, 212), '');
});

test('a zap request with no p tag still gates, it just cannot be labeled', async () => {
  // The gate and the caption are independent. NIP-57 requires the p tag, but a record
  // that cannot be labeled must never become a record that cannot be claimed — that
  // would turn a missing caption into a spending change.
  const noP = { kind: 9734, content: '', tags: [['amount', '212000'], ['relays', 'wss://r.example']] };
  assert.equal(await Z.record(SITE, ALICE, noP), true, 'still recorded');
  assert.equal(await Z.recipientFor(SITE, ALICE, 212), '', 'nobody to name');
  assert.equal(await Z.claim(SITE, ALICE, 212), true, 'and it still authorizes the payment');
});

test('the label names the same record the claim would take', async () => {
  // Two same-amount zaps from one site inside the window are indistinguishable to both,
  // so both must pick the same one — the older — or the caption describes a different
  // payment than the one that went out.
  await Z.record(SITE, ALICE, { kind: 9734, content: '', tags: [['p', 'd'.repeat(64)], ['amount', '5000']] });
  await Z.record(SITE, ALICE, { kind: 9734, content: '', tags: [['p', 'e'.repeat(64)], ['amount', '5000']] });
  assert.equal(await Z.recipientFor(SITE, ALICE, 5), 'd'.repeat(64), 'oldest first');
  await Z.claim(SITE, ALICE, 5); // consumes the same one
  assert.equal(await Z.recipientFor(SITE, ALICE, 5), 'e'.repeat(64), 'then the next');
});
