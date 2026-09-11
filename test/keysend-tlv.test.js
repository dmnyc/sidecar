'use strict';

// normalizeKeysend — the gate between window.webln.keysend and somebody's money.
//
// Nothing upstream of it validates anything: content.js routes by scope and the message
// router only re-derives the host, so `params` arrives exactly as the page wrote it,
// including the amount the budget check is about to trust. Two of these checks are
// load-bearing beyond ordinary input hygiene:
//
//   - The UTF-8 → hex translation. Getting it wrong does not fail the payment. It settles
//     and delivers a boostagram the recipient cannot read, which is the kind of bug that
//     ships.
//   - The TLV 5482373484 denylist. That record IS the keysend preimage. A page able to set
//     it chooses the payment hash of a spend somebody else is paying for, and defeats the
//     lookup_invoice confirmation that keeps a lost reply from being reported as a failure.

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
  lift(/const TLV_BOOSTAGRAM = \d+;/, 'TLV_BOOSTAGRAM'),
  lift(/const TLV_KEYSEND_PREIMAGE = \d+;/, 'TLV_KEYSEND_PREIMAGE'),
  lift(/const TLV_MIN_TYPE = \d+;/, 'TLV_MIN_TYPE'),
  lift(/const TLV_MAX_RECORDS = \d+;/, 'TLV_MAX_RECORDS'),
  lift(/const TLV_MAX_VALUE_BYTES = \d+;/, 'TLV_MAX_VALUE_BYTES'),
  lift(/const TLV_MAX_TOTAL_BYTES = \d+;/, 'TLV_MAX_TOTAL_BYTES'),
  lift(/const KEYSEND_MAX_SATS = \d+;/, 'KEYSEND_MAX_SATS'),
  lift(/const toHex = .*\n/, 'toHex'),
  lift(/function normalizeKeysend\(params\) \{[\s\S]*?\n\}/, 'normalizeKeysend'),
  lift(/function boostagramFrom\(records\) \{[\s\S]*?\n\}/, 'boostagramFrom'),
  lift(/function parseNwcMethods\(methods\) \{[\s\S]*?\n\}/, 'parseNwcMethods'),
].join('\n');

const ctx = { TextEncoder, TextDecoder, Uint8Array, JSON, Math, Number, Object, Array, String, Error, parseInt };
vm.createContext(ctx);
vm.runInContext(
  lifted + '\n;this.normalizeKeysend = normalizeKeysend; this.boostagramFrom = boostagramFrom; this.parseNwcMethods = parseNwcMethods;',
  ctx
);
const { normalizeKeysend, boostagramFrom, parseNwcMethods } = ctx;

const DEST = '03' + 'a1b2c3d4'.repeat(8); // 66 chars, compressed-point prefix
const args = (over) => Object.assign({ destination: DEST, amount: 100 }, over);
const hexToStr = (hex) =>
  new TextDecoder().decode(new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16))));

test('accepts a well-formed keysend and converts nothing it should not', () => {
  const ks = normalizeKeysend(args());
  assert.equal(ks.destination, DEST);
  assert.equal(ks.sats, 100); // sats stay sats here; the msat conversion is at the call site
  // length, not deepEqual: the array is built inside the vm context, so its prototype is
  // that realm's Array and a strict structural compare fails on identity alone.
  assert.equal(ks.records.length, 0);
});

test('custom record values are hex-encoded UTF-8, multi-byte included', () => {
  const message = 'Great show! 🎙 — café';
  const ks = normalizeKeysend(args({ customRecords: { '7629169': message } }));
  assert.equal(ks.records.length, 1);
  assert.equal(ks.records[0].type, 7629169); // a number on the wire, not the string key
  assert.match(ks.records[0].value, /^[0-9a-f]+$/);
  // The whole point: what the recipient decodes is what the page wrote.
  assert.equal(hexToStr(ks.records[0].value), message);
  // And a multi-byte character really did become more than one byte.
  assert.ok(ks.records[0].value.length / 2 > message.length);
});

test('a stringified amount is read as a number, not parsed as one', () => {
  assert.equal(normalizeKeysend(args({ amount: '250' })).sats, 250);
  // The reason this is not parseInt: parseInt('1e6') is 1, so a page asking to send a
  // million sats would have sent one, silently and in the direction of "wrong amount".
  assert.equal(normalizeKeysend(args({ amount: '1e6' })).sats, 1000000);
});

test('rejects a destination that is not a compressed node key', () => {
  for (const bad of ['', 'a'.repeat(64), '04' + 'a'.repeat(64), '03' + 'z'.repeat(64), DEST.slice(0, 65)]) {
    assert.throws(() => normalizeKeysend(args({ destination: bad })), /destination/);
  }
});

test('rejects amounts that are not a positive whole number of sats', () => {
  // 0 and negatives matter beyond tidiness: BUDGETS.covers used to answer "yes" to both,
  // so a 0-sat boostagram cleared an exhausted budget and a negative one grew it.
  for (const bad of [0, -5, '0', '-5', '1.9', 1.5, NaN, Infinity, 'abc', null, undefined]) {
    assert.throws(() => normalizeKeysend(args({ amount: bad })), /whole number of sats/);
  }
});

test('rejects the keysend preimage record outright', () => {
  assert.throws(
    () => normalizeKeysend(args({ customRecords: { '5482373484': 'deadbeef' } })),
    /preimage/
  );
});

test('rejects TLV types below the custom range', () => {
  assert.throws(() => normalizeKeysend(args({ customRecords: { '7': 'x' } })), /TLV types/);
  assert.throws(() => normalizeKeysend(args({ customRecords: { '65535': 'x' } })), /TLV types/);
  // 65536 is the first legal one.
  assert.equal(normalizeKeysend(args({ customRecords: { '65536': 'x' } })).records[0].type, 65536);
});

test('rejects customRecords that are not an object of strings', () => {
  assert.throws(() => normalizeKeysend(args({ customRecords: 'nope' })), /must be an object/);
  assert.throws(() => normalizeKeysend(args({ customRecords: ['nope'] })), /must be an object/);
  assert.throws(() => normalizeKeysend(args({ customRecords: { '7629169': 42 } })), /must be strings/);
});

// The regression test for the first live boost, which Sidecar refused.
//
// The size caps started at 512 bytes per value and 900 in total, reasoned from the onion
// payload. A blip-0010 boostagram is not a message — it carries the show, the episode,
// three GUIDs, a boost link, the app, the sender and a signature — and a real one runs past
// 900 bytes with a fourteen-character message in it. The site caught the rejection and fell
// back to LNURL, so the boost went out with no keysend and no boostagram at all: exactly
// what this feature exists to prevent, caused by the check meant to protect it.
test('a real boostagram is not refused for its size', () => {
  const boostagram = {
    podcast: 'Chad and Reeds Podcast',
    feedID: 7778147,
    url: 'https://feeds.podhome.fm/chad-and-reeds-podcast',
    episode: '003. Dimly LIT',
    episode_guid: '39217942-8932-6008-2e72-b12f43295a09',
    itemID: 41234567,
    ts: 1423,
    time: '00:23:43',
    action: 'boost',
    app_name: 'Boost Me Bitch',
    app_version: '1.4.2',
    value_msat: 100000,
    value_msat_total: 100000,
    name: 'Chad and Reeds Podcast',
    sender_name: 'chadf',
    sender_id: 'greyturkey26@primal.net',
    message: 'great episode!',
    boost_link: 'https://tardbox.com/boost/01M1STZFS8E0JR351YYQTKN1JQ',
    guid: '7c6f7875-2b73-491e-b32c-e2c8d6e91d53',
    remote_feed_guid: '11708875-2ff3-4c2e-a00b-08dee99f0b15',
    remote_item_guid: '639217942893260082e72b12f4-3295-40b6-abaa-9945ff051a09',
    uuid: '01M1STZFS8E0JR351YYQTKN1JQ',
    signature: '3045022100e8f1a2b3c4d5e6f70819'.repeat(3),
  };
  const payload = JSON.stringify(boostagram);
  // The cap it actually hit was 512 bytes per value; this is comfortably past it.
  assert.ok(payload.length > 512, 'the fixture must be big enough to have tripped the old cap');

  const ks = normalizeKeysend(args({ customRecords: { '7629169': payload } }));
  assert.equal(ks.records.length, 1);
  assert.equal(JSON.parse(hexToStr(ks.records[0].value)).boost_link, boostagram.boost_link);

  // And a chatty listener does not push it over either.
  const chatty = { ...boostagram, message: 'Great show — the bit about value splits finally made it click. '.repeat(8) };
  assert.equal(
    normalizeKeysend(args({ customRecords: { '7629169': JSON.stringify(chatty) } })).records.length,
    1
  );
});

test('bounds a single value, the record count, and the total payload', () => {
  // These are bounds on absurdity, not on what the network carries — the wallet is the
  // authority on what fits in the onion. Nothing a real client sends comes near them.
  assert.throws(
    () => normalizeKeysend(args({ customRecords: { '7629169': 'x'.repeat(8193) } })),
    /the limit is 8192/
  );

  const many = {};
  for (let i = 0; i < 17; i++) many[String(65536 + i)] = 'x';
  assert.throws(() => normalizeKeysend(args({ customRecords: many })), /Too many/);

  // Records that are each individually legal but together exceed the total.
  assert.throws(
    () => normalizeKeysend(args({
      customRecords: { '7629169': 'x'.repeat(8000), '65536': 'y'.repeat(8000), '65537': 'z'.repeat(8000) },
    })),
    /the limit is 16384/
  );
});

test('boostagramFrom reads the caption out of record 7629169', () => {
  const payload = JSON.stringify({
    podcast: 'Podcasting 2.0',
    episode: 'Episode 42',
    message: 'great episode',
    sender_name: 'someone',
    action: 'boost',
  });
  const { records } = normalizeKeysend(args({ customRecords: { '7629169': payload } }));
  const boost = boostagramFrom(records);
  assert.equal(boost.podcast, 'Podcasting 2.0');
  assert.equal(boost.episode, 'Episode 42');
  assert.equal(boost.message, 'great episode');
  assert.equal(boost.senderName, 'someone');
  assert.equal(boost.action, 'boost');
});

test('a stream tick is distinguishable from a boost', () => {
  // Both carry the show's name, so "is there a boostagram" cannot tell them apart — and
  // streaming sats fire one a minute. Only the action does.
  const tick = JSON.stringify({ podcast: 'Podcasting 2.0', action: 'STREAM', value_msat: 1000 });
  const { records } = normalizeKeysend(args({ customRecords: { '7629169': tick } }));
  const boost = boostagramFrom(records);
  assert.equal(boost.podcast, 'Podcasting 2.0');
  assert.equal(boost.action, 'stream', 'lower-cased, so the caller compares one thing');
  assert.equal(boost.message, '');
});

test('a boostagram that is malformed costs the card its detail, not its render', () => {
  const bad = (v) => boostagramFrom(normalizeKeysend(args({ customRecords: { '7629169': v } })).records);
  assert.equal(bad('not json at all'), null);
  assert.equal(bad('[1,2,3]'), null); // valid JSON, wrong shape
  assert.equal(bad('{}'), null); // nothing worth showing
  assert.equal(bad('{"podcast": 42}'), null); // right key, wrong type
  assert.equal(boostagramFrom([]), null);
  assert.equal(boostagramFrom(null), null);
});

// A wallet's advertised method list decides whether Sidecar offers keysend at all, so
// misreading it is the difference between a working boost and a flat refusal.
test('the wallet method list is read in both shapes wallets actually send', () => {
  const wire = 'pay_invoice,pay_keysend,get_balance,get_info,make_invoice,lookup_invoice';
  // NIP-47 says array, and it usually is.
  assert.ok(parseNwcMethods(['pay_invoice', 'PAY_KEYSEND']).includes('pay_keysend'));
  // Alby's own info endpoint hands back one comma-separated string. Reading only the array
  // shape would call that wallet method-less and refuse keysend on a wallet that has it.
  assert.ok(parseNwcMethods(wire).includes('pay_keysend'));
  assert.ok(parseNwcMethods('pay_invoice pay_keysend').includes('pay_keysend'));
  // Nothing usable is an empty list, which the caller reads as "unknown", not "no".
  for (const junk of [undefined, null, 42, {}, '']) {
    assert.equal(parseNwcMethods(junk).length, 0);
  }
});
