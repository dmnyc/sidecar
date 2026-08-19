'use strict';

// Unit coverage for normalizeSignEventParams in background.js — the shape gate in
// front of every page signEvent.
//
// Why it exists: NIP-07's signEvent takes an event template, and pages get that wrong.
// Before the gate, a page that sent the event as a JSON string, positionally in an
// array, or not at all got an approval card reading "Kind —" with no tag count and no
// content preview — nothing on screen to judge — and then, AFTER the user approved,
// nostr-tools threw "can't serialize event with wrong or missing properties" from
// inside the signer. The site showed an opaque failure and the user posted from
// another client instead.
//
// Two properties are asserted here, and they pull in opposite directions on purpose:
//
//   1. Liberal where the intent is unambiguous — a JSON-string event, a numeric-string
//      kind, absent tags/content/created_at. These now sign instead of dead-ending.
//   2. Strict where it isn't — throw BEFORE anything is queued, prompted, or signed,
//      with a message the page can show. A prompt that can't say what it's signing is
//      worse than a refusal.
//
// The string-kind case is the quiet one, and the reason coercion happens at this single
// point rather than at each use: kind "1" LABELS correctly by accident (object keys
// stringify) while failing every identity/Set check downstream — COALESCE_KINDS.has,
// RELAX.neverRelaxes, the 9734 zap test, isNip42AuthEvent's 22242, and BASELINE's
// TRACKED.has. That last one is the destructive-overwrite guard, so a kind:"3"
// follow-list wipe would skip its warning. The final test below pins that.

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

const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  lift(/function normalizeTagValue\(v\) \{[\s\S]*?\n\}/, 'normalizeTagValue') + '\n' +
    lift(/function normalizeSignEventParams\(params\) \{[\s\S]*?\n\}/, 'normalizeSignEventParams') + '\n' +
    lift(/function describeSignEventShape\(params\) \{[\s\S]*?\n\}/, 'describeSignEventShape') + '\n' +
    // The real kind gates, lifted rather than mirrored — a local copy would drift and
    // these tests would keep passing against the wrong sets.
    lift(/const COALESCE_KINDS = new Set\([\s\S]*?\);/, 'COALESCE_KINDS') + '\n' +
    lift(/function isNip42AuthEvent\(ev\) \{[\s\S]*?\n\}/, 'isNip42AuthEvent') + '\n' +
    lift(/const NIP42_MAX_CLOCK_SKEW = \d+;/, 'NIP42_MAX_CLOCK_SKEW') + '\n' +
    'globalThis.normalize = normalizeSignEventParams;' +
    'globalThis.describe = describeSignEventShape;' +
    'globalThis.COALESCE_KINDS = COALESCE_KINDS;' +
    'globalThis.isNip42AuthEvent = isNip42AuthEvent;',
  ctx
);
const normalize = ctx.normalize;
const describe = ctx.describe;

// The real vendored signer, so "this now signs" means nostr-tools actually accepts it
// rather than that our own validator is self-consistent. It runs in its own context and
// its validateEvent gates on `instanceof Object`, which is realm-bound — so the event
// has to be re-parsed INSIDE that context or every shape "fails" for the wrong reason.
const ntCtx = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, crypto: require('node:crypto').webcrypto };
vm.createContext(ntCtx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'), ntCtx);
vm.runInContext(
  'globalThis.__sk = NostrTools.generateSecretKey();' +
    'globalThis.signsAndVerifies = (json) => {' +
    '  const signed = NostrTools.finalizeEvent(JSON.parse(json), globalThis.__sk);' +
    '  return NostrTools.verifyEvent(signed);' +
    '};',
  ntCtx
);
const signsAndVerifies = (event) => ntCtx.signsAndVerifies(JSON.stringify(event));

// Same realm boundary, for assertions: normalize() returns an object built in the
// background.js context, and assert/strict compares prototypes.
const plain = (o) => JSON.parse(JSON.stringify(o));

const NOTE = { kind: 1, created_at: 1700000000, tags: [['t', 'sidecar']], content: 'hello' };

// ---- accepted shapes ---------------------------------------------------------

test('the canonical NIP-07 shape passes through unchanged', () => {
  const { event } = normalize({ event: NOTE });
  assert.deepEqual(plain(event), NOTE);
});

test('an event sent as params itself (no .event wrapper) is accepted', () => {
  const { event } = normalize(NOTE);
  assert.equal(event.kind, 1);
  assert.equal(event.content, 'hello');
});

test('an event sent as a JSON string is parsed, not rejected', () => {
  // The NIP-46 shape (params is [json]) leaking into a NIP-07 call. Used to reach the
  // signer as a string and throw "signEvent: missing event" after approval.
  const { event } = normalize({ event: JSON.stringify(NOTE) });
  assert.deepEqual(plain(event), NOTE);
});

test('a numeric-string kind is coerced to a number', () => {
  const { event } = normalize({ event: { ...NOTE, kind: '1' } });
  assert.equal(event.kind, 1);
  assert.equal(typeof event.kind, 'number');
});

test('absent tags, content, and created_at are filled', () => {
  const { event } = normalize({ event: { kind: 1 } });
  assert.deepEqual(plain(event.tags), []);
  assert.equal(event.content, '');
  assert.equal(typeof event.created_at, 'number');
  assert.ok(Math.abs(Math.floor(Date.now() / 1000) - event.created_at) < 5);
});

test('a supplied created_at is never overwritten', () => {
  // A client backdating an event means it; only an ABSENT timestamp gets stamped.
  const { event } = normalize({ event: { ...NOTE, created_at: 1600000000 } });
  assert.equal(event.created_at, 1600000000);
});

test('a client-stamped author pubkey survives normalization', () => {
  // applesauce clients name the intended author on the template, and handleNostrRpc
  // reads it to honor the account the client asked for. Dropping it would silently
  // re-route the signature to the site binding.
  const pk = 'a'.repeat(64);
  const { event } = normalize({ event: { ...NOTE, pubkey: pk } });
  assert.equal(event.pubkey, pk);
});

test('non-string tag values are coerced rather than dead-ending the post', () => {
  const { event } = normalize({ event: { ...NOTE, tags: [['amount', 21000], ['p', 'x', null], ['ok', true]] } });
  assert.deepEqual(plain(event.tags), [['amount', '21000'], ['p', 'x', ''], ['ok', 'true']]);
});

test('every accepted shape produces an event nostr-tools will actually sign', () => {
  for (const params of [
    { event: NOTE },
    NOTE,
    { event: JSON.stringify(NOTE) },
    { event: { ...NOTE, kind: '1' } },
    { event: { kind: 1 } },
    { event: { ...NOTE, tags: [['amount', 21000]] } },
  ]) {
    const { event } = normalize(params);
    assert.equal(signsAndVerifies(event), true, JSON.stringify(params).slice(0, 60));
  }
});

// ---- rejected shapes ---------------------------------------------------------
// Each of these used to reach a prompt showing "Kind —" and then crash in the signer.

test('unreadable payloads are rejected before anything is queued', () => {
  const cases = [
    [undefined, /expected an event object/],
    [{}, /kind must be a non-negative integer/],
    // params.event null falls back to params itself — an object with no kind.
    [{ event: null }, /kind must be a non-negative integer/],
    [[NOTE], /expected an event object/], // positional args
    [{ event: [NOTE] }, /expected an event object/],
    [{ event: 'not json at all' }, /isn't valid JSON/],
    [{ event: { ...NOTE, kind: 'note' } }, /kind must be a non-negative integer/],
    [{ event: { ...NOTE, kind: 1.5 } }, /kind must be a non-negative integer/],
    [{ event: { ...NOTE, kind: -1 } }, /kind must be a non-negative integer/],
    [{ event: { ...NOTE, tags: 'nope' } }, /tags must be an array/],
    [{ event: { ...NOTE, tags: ['e', 'id'] } }, /every entry in event.tags must be an array/],
    [{ event: { ...NOTE, tags: [['e', { id: 1 }]] } }, /tag values must be strings/],
    [{ event: { ...NOTE, content: { text: 'hi' } } }, /content must be a string/],
    [{ event: { ...NOTE, created_at: 'now' } }, /created_at must be a Unix timestamp/],
  ];
  for (const [params, re] of cases) {
    assert.throws(() => normalize(params), re, 'should reject ' + JSON.stringify(params));
  }
});

test('a rejection message names signEvent, so the page can show it verbatim', () => {
  // It surfaces through handleNostrRpc's catch as the page promise's rejection.
  for (const params of [undefined, {}, { event: 'x' }]) {
    try {
      normalize(params);
      assert.fail('expected a throw');
    } catch (e) {
      assert.match(e.message, /^signEvent: /);
    }
  }
});

// ---- the shape fingerprint recorded on a refusal -----------------------------
// A refusal used to leave no trace at all: the page got the error and Sidecar
// remembered nothing, which is why the original report arrived with no payload to look
// at. handleNostrRpc now writes this fingerprint to Activity before rethrowing.

test('the fingerprint says which mistake the client made', () => {
  assert.deepEqual(plain(describe(undefined)), { params: 'missing', event: 'missing' });
  assert.deepEqual(plain(describe([NOTE])), { params: 'array', event: 'missing' });
  assert.deepEqual(plain(describe({ event: 'some string' })), { params: 'object', event: 'string' });
  assert.deepEqual(plain(describe({ event: [NOTE] })), { params: 'object', event: 'array' });
  assert.deepEqual(plain(describe({ event: { ...NOTE, kind: 'note' } })), {
    params: 'object',
    event: 'object',
    kind: 'string',
    tags: 'array',
    content: 'string',
    created_at: 'number',
    kindValue: 'note', // a bare kind identifies nobody, and it's the most useful field
  });
  assert.deepEqual(plain(describe({ event: { kind: 1.5 } })), {
    params: 'object',
    event: 'object',
    kind: 'number',
    tags: 'missing',
    content: 'missing',
    created_at: 'missing',
    kindValue: 1.5,
  });
});

test('the fingerprint keeps nothing from the payload it refused', () => {
  // We declined to sign this. Keeping a copy of the content, the tag values, or the
  // author's key would be the wrong trade for a diagnostic.
  const secrets = ['s3cret-content', 'e-tag-value', 'f'.repeat(64), 'wss://private.relay'];
  const fingerprint = JSON.stringify(
    plain(
      describe({
        event: {
          kind: 'nope',
          content: secrets[0],
          tags: [['e', secrets[1]], ['relay', secrets[3]]],
          pubkey: secrets[2],
          created_at: 1700000000,
        },
      })
    )
  );
  for (const s of secrets) assert.equal(fingerprint.includes(s), false, 'leaked ' + s);
  // Long junk in the kind field is dropped too, rather than logged verbatim.
  assert.equal('kindValue' in plain(describe({ event: { kind: 'x'.repeat(400) } })), false);
});

// ---- what the coercion protects ---------------------------------------------

test('a string kind reaches the kind gates as a number', () => {
  // Before normalization these all took the wrong branch on a string kind, silently:
  // a kind:"3" wipe skipped the destructive-overwrite warning, and a kind:"22242"
  // relay auth lost its exemption.
  // The real destructive-overwrite guard, loaded as the module it is.
  const bctx = { console };
  vm.createContext(bctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'replaceable-baseline.js'), 'utf8'), bctx);
  const isTracked = bctx.SidecarBaseline.isTracked;

  assert.equal(COALESCE_HAS('30078'), false, 'a raw string kind misses COALESCE_KINDS');
  assert.equal(COALESCE_HAS(normalize({ event: { kind: '30078' } }).event.kind), true);

  assert.equal(isTracked('3'), false, 'a raw string kind misses the baseline guard');
  assert.equal(isTracked(normalize({ event: { kind: '3' } }).event.kind), true);

  const auth = { kind: '22242', created_at: Math.floor(Date.now() / 1000), tags: [['relay', 'wss://r'], ['challenge', 'c']], content: '' };
  assert.equal(ctx.isNip42AuthEvent(auth), false, 'a raw string kind is not recognized as relay auth');
  assert.equal(ctx.isNip42AuthEvent(normalize({ event: auth }).event), true);
});

function COALESCE_HAS(kind) {
  return ctx.COALESCE_KINDS.has(kind);
}
