'use strict';

// The CLINK offer decoder, LIFTED AND RUN.
//
// Everything here is arithmetic over bytes, and a source assertion cannot tell a correct
// bech32 from a plausible one. What is being decoded is a payment address: get the pubkey
// or the relay wrong and the request goes to a stranger, so the tests have to actually
// run it.
//
// THE BECH32 LAYER IS CHECKED AGAINST NOSTR-TOOLS, not against itself. Sidecar hand-rolls
// bech32 because the vendored bundle does not export one, and a decoder tested only by
// round-tripping its own encoder proves self-consistency and nothing about the wire
// format. nip19 is an independently written bech32 that ships in this extension: if our
// decode of an npub nostr-tools produced yields the bytes nostr-tools put in, the layer is
// right for reasons that have nothing to do with us.
//
// The TLV layer is round-tripped, the way zapcooking's own tests do it, because no public
// production noffer was available to pin as a fixture.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'),
  { filename: 'nostr-tools.js' });
const NT = globalThis.NostrTools;
assert.ok(NT && NT.nip19, 'the vendored nostr-tools did not expose nip19');

const ctx = { window: {}, console, TextDecoder, TextEncoder, setTimeout, clearTimeout, Date, Promise, JSON, Math, Array, Uint8Array, Error, String };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'clink.js'), 'utf8'), ctx);
const CLINK = ctx.window.SidecarCLINK;
assert.ok(CLINK, 'clink.js did not expose window.SidecarCLINK');

// A bech32 encoder for the fixtures only. Deliberately not imported from clink.js, which
// has no encoder at all: the payer never writes an offer, it only reads one.
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}
function hrpExpand(hrp) {
  const out = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}
function toWords(bytes) {
  let acc = 0, bits = 0;
  const out = [];
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) { bits -= 5; out.push((acc >> bits) & 31); }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}
function bech32Encode(hrp, bytes) {
  const words = toWords(bytes);
  const chk = polymod(hrpExpand(hrp).concat(words, [0, 0, 0, 0, 0, 0])) ^ 1;
  const sum = [];
  for (let i = 0; i < 6; i++) sum.push((chk >> (5 * (5 - i))) & 31);
  return hrp + '1' + words.concat(sum).map((w) => CHARSET[w]).join('');
}
function tlvBytes(entries) {
  const out = [];
  for (const { type, value } of entries) out.push(type, value.length, ...value);
  return new Uint8Array(out);
}
const utf8 = (s) => new TextEncoder().encode(s);
const hexBytes = (hex) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return out;
};

const PUBKEY = 'ee6ea13ab9fe5c4a68eaf9b1a34fe014a66b40117c50ee2a614f4cda959b6e74';
const RELAY = 'wss://relay.shockwallet.app';
const OFFER_ID = 'tip-jar';
const base = () => [
  { type: 0, value: hexBytes(PUBKEY) },
  { type: 1, value: utf8(RELAY) },
  { type: 2, value: utf8(OFFER_ID) },
];
const makeNoffer = (entries) => bech32Encode('noffer', tlvBytes(entries));

test('OUR BECH32 AGREES WITH THE ONE THAT SHIPS IN THIS EXTENSION', () => {
  // The cross-check that makes the rest of this file mean something. nostr-tools wrote
  // these strings with its own bech32; we decode them with ours and compare the bytes it
  // put in. Nothing here is round-tripped through our own encoder.
  const npub = NT.nip19.npubEncode(PUBKEY);
  const ours = CLINK.bech32Decode(npub);
  assert.equal(ours.hrp, 'npub');
  assert.equal(Buffer.from(ours.bytes).toString('hex'), PUBKEY);

  // And a long one with TLVs of its own, so the 5-bit regrouping is exercised past a
  // single 32-byte payload. nprofile is nip19's own TLV format, not CLINK's.
  const nprofile = NT.nip19.nprofileEncode({ pubkey: PUBKEY, relays: [RELAY, 'wss://nos.lol'] });
  const long = CLINK.bech32Decode(nprofile);
  assert.equal(long.hrp, 'nprofile');
  assert.ok(long.bytes.length > 60, 'the nprofile payload should carry both relays');
  // Not by offset: nip19 orders its own TLVs however it likes, and pinning that would be
  // testing nostr-tools rather than our regrouping. What matters is that 5-bit groups
  // reassembled into 8-bit bytes across a long payload put the key back byte for byte.
  assert.ok(Buffer.from(long.bytes).toString('hex').includes(PUBKEY),
    'the pubkey did not survive the 5-to-8 bit regrouping');
  assert.ok(Buffer.from(long.bytes).toString('utf8').includes(RELAY),
    'the relay did not survive it either');

  // A note id too, which is a bare 32 bytes with no TLV wrapper at all.
  const note = NT.nip19.noteEncode(PUBKEY);
  assert.equal(Buffer.from(CLINK.bech32Decode(note).bytes).toString('hex'), PUBKEY);
});

test('a minimal offer decodes, and an absent pricing type means spontaneous', () => {
  const got = CLINK.decodeNoffer(makeNoffer(base()));
  assert.equal(got.pubkey, PUBKEY);
  assert.equal(got.relay, RELAY);
  assert.equal(got.offerId, OFFER_ID);
  // The spec's default, and the one that means "name your own amount".
  assert.equal(got.pricingType, 'spontaneous');
  assert.equal(got.price, undefined);
});

test('the three pricing types, and a price in big-endian sats', () => {
  const fixed = CLINK.decodeNoffer(makeNoffer(base().concat([
    { type: 3, value: new Uint8Array([0]) },
    { type: 4, value: new Uint8Array([0x03, 0xe8]) }, // 1000
  ])));
  assert.equal(fixed.pricingType, 'fixed');
  assert.equal(fixed.price, 1000);

  const variable = CLINK.decodeNoffer(makeNoffer(base().concat([
    { type: 3, value: new Uint8Array([1]) },
    { type: 5, value: utf8('USD') },
  ])));
  assert.equal(variable.pricingType, 'variable');
  assert.equal(variable.currency, 'USD');

  const spontaneous = CLINK.decodeNoffer(makeNoffer(base().concat([
    { type: 3, value: new Uint8Array([2]) },
  ])));
  assert.equal(spontaneous.pricingType, 'spontaneous');

  // A price wider than two bytes, since sats go past 65535 routinely.
  const big = CLINK.decodeNoffer(makeNoffer(base().concat([
    { type: 4, value: new Uint8Array([0x01, 0x00, 0x00]) }, // 65536
  ])));
  assert.equal(big.price, 65536);
});

test('ONLY A FIXED OFFER KNOWS ITS OWN AMOUNT', () => {
  // Asking a variable or spontaneous offer without one wastes a round trip to be told so,
  // and the answer comes back as a typed error thirty seconds later at worst.
  assert.equal(CLINK.amountRequired({ pricingType: 'fixed' }), false);
  assert.equal(CLINK.amountRequired({ pricingType: 'variable' }), true);
  assert.equal(CLINK.amountRequired({ pricingType: 'spontaneous' }), true);
  assert.equal(CLINK.amountRequired(null), true);
});

test('a nostr: prefix is carried, because that is how they are pasted', () => {
  const noffer = makeNoffer(base());
  assert.equal(CLINK.decodeNoffer('nostr:' + noffer).pubkey, PUBKEY);
  assert.equal(CLINK.decodeNoffer('  ' + noffer + '  ').pubkey, PUBKEY);
  assert.equal(CLINK.stripNostrPrefix('nostr:' + noffer), noffer);
  assert.equal(CLINK.stripNostrPrefix('  NOSTR:' + noffer), noffer);
});

test('WHAT IT REFUSES, AND WHY EACH ONE MATTERS', () => {
  // Every one of these is a payment address. A decoder that guessed would send a request,
  // and possibly sats, somewhere nobody named.
  const bad = (input, why) => assert.throws(() => CLINK.decodeNoffer(input), Error, why);

  bad(NT.nip19.npubEncode(PUBKEY), 'an npub is a person, not an offer');
  bad('noffer1', 'nothing after the separator');
  bad('not-an-offer', 'no separator at all');
  bad('', 'empty');

  // A mistyped character changes the payload; the checksum is the only thing standing
  // between that and a request to the wrong wallet.
  const good = makeNoffer(base());
  const flipped = good.slice(0, -1) + (good.endsWith('q') ? 'p' : 'q');
  bad(flipped, 'a flipped character must not decode');

  // `b`, `i`, `o` and `1` are excluded from the charset precisely because they are the
  // ones people mistype, so a string containing them is not a bech32 payload.
  bad('noffer1bbbbbbbbb', 'b is not in the bech32 charset');

  // The required TLVs. Missing any one of them leaves nowhere to send the request.
  bad(makeNoffer(base().slice(1)), 'no pubkey');
  bad(makeNoffer([base()[0], base()[2]]), 'no relay');
  bad(makeNoffer([base()[0], base()[1]]), 'no offer id');
  // A pubkey that is not 32 bytes is not a key.
  bad(makeNoffer([{ type: 0, value: hexBytes(PUBKEY.slice(0, 40)) }, base()[1], base()[2]]),
    'short pubkey');
  // A TLV whose length runs past the end of the payload.
  bad(bech32Encode('noffer', new Uint8Array([0, 32, 1, 2, 3])), 'truncated TLV body');
});

test('the shape check is shape only, and IS the check the editor runs', () => {
  // The profile editor validates before saving; this is the reader's half of the same
  // question, and the two must not disagree about what is worth trying.
  const noffer = makeNoffer(base());
  assert.equal(CLINK.isNofferString(noffer), true);
  assert.equal(CLINK.isNofferString('nostr:' + noffer), true);
  assert.equal(CLINK.isNofferString(NT.nip19.npubEncode(PUBKEY)), false);
  assert.equal(CLINK.isNofferString(''), false);
  assert.equal(CLINK.isNofferString(null), false);
  assert.equal(CLINK.isNofferString(undefined), false);

  // EVERY BECH32 CHARACTER, AND `l` MOST OF ALL. The editor carried its own copy of the
  // charset with `l` missing, so it refused about 95% of real offers: a 95-character
  // payload dodges one specific letter roughly one time in twenty, and the first offer
  // anybody tried to save was refused. The guard that should have caught it compared the
  // panel's source against that same wrong literal, so it agreed with the bug instead of
  // failing on it. Run the charset rather than spelling it out a third time.
  assert.equal(CHARSET.length, 32);
  assert.ok(CHARSET.includes('l'), 'the fixture charset lost the character this is about');
  assert.equal(CLINK.isNofferString('noffer1' + CHARSET), true, 'the reader refuses a bech32 character');
  for (const ch of CHARSET) {
    assert.equal(CLINK.isNofferString('noffer1' + ch.repeat(8)), true, `the reader refuses "${ch}"`);
  }
  // And the four bech32 leaves out, which are the ones people mistype.
  for (const ch of '1bio') {
    assert.equal(CLINK.isNofferString('noffer1' + ch.repeat(8)), false, `the reader accepts "${ch}"`);
  }

  // The editor runs THIS, rather than a second copy that can drift from it. Comments
  // stripped first, or the refusal below matches the comment that explains it.
  const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(panel, /!window\.SidecarCLINK\.isNofferString\(draft\.noffer\)/,
    'the editor validates with something other than the reader');
  assert.doesNotMatch(panel, /\^noffer1\[[a-z0-9]+\]/i,
    'the editor is carrying its own bech32 charset again, which is how they drifted apart');
});
