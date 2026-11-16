'use strict';

// NIP-44 v3 (draft), run against the draft's own test vectors, and held apart from v2.
//
// The vectors are test/fixtures/nip44v3-vectors.json, a byte-exact copy of
// test-vectors.json from https://github.com/nostr-land/nip44v3 at commit
// 5680754519807622d962a394ebea68483433d4df (2026-06-02), fetched 2026-11-15. JSON has no
// comments, so the provenance lives here, and the first test pins the file's SHA-256 so a
// hand edit to a vector cannot pass quietly. To refresh: fetch the file at a newer commit,
// update the commit, date and hash here, and expect every test below to run it.
//
// Everything runs the real code: nip44v3.js on the real nip44v3-primitives.js bundle,
// and v2 is the real nostr-tools bundle the extension ships.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'nip44v3-vectors.json');
const FIXTURE_SHA256 = '8350608081acdf8fe659db9cfd1f901cbf6d9da8ef011e7e545ed376eaca0043';
const vectors = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// The extension's own files, in the order the background loads them.
const ctx = { crypto: globalThis.crypto, TextEncoder, TextDecoder, console };
ctx.self = ctx;
vm.createContext(ctx);
for (const f of ['nostr-tools.js', 'nip44v3-primitives.js', 'nip44v3.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const V3 = ctx.SidecarNip44v3;
const P = ctx.SidecarNip44v3Primitives;
const NT = ctx.NostrTools;

const hex = (b) => Buffer.from(b).toString('hex');
const bytes = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const pub = (skHex) => NT.getPublicKey(bytes(skHex));
const utf8 = (s) => new TextEncoder().encode(s);
// Matches the error's MESSAGE: assert.throws tests a RegExp against String(err), which
// carries an "Error: " prefix that would defeat every anchored pattern below.
const fails = (fn, re, note) => assert.throws(fn, (e) => {
  if (re) assert.match(e.message, re, note);
  return true;
});

test('the fixture is the draft’s file, unedited', () => {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(FIXTURE)).digest('hex');
  assert.equal(sha, FIXTURE_SHA256);
  for (const k of ['encrypt_decrypt', 'decrypt_only', 'long_encrypt_decrypt', 'padded_length', 'invalid_decryption']) {
    assert.ok(Array.isArray(vectors[k]) && vectors[k].length > 0, k + ' is missing or empty');
  }
});

// From both parties' side, as implementing.md asks: parse, key schedule, decrypt, encrypt.
for (const [i, v] of vectors.encrypt_decrypt.entries()) {
  test('encrypt_decrypt #' + i + ' (kind ' + v.kind + ', ' + v.plaintext_hex.length / 2 + ' bytes)', () => {
    for (const [me, them] of [[v.secret1, v.secret2], [v.secret2, v.secret1]]) {
      const parsed = V3.decodePayload(v.ciphertext);
      assert.equal(hex(parsed.nonce), v.nonce);
      assert.equal(parsed.kind, v.kind);
      assert.equal(hex(parsed.scope), v.scope_hex);

      const keys = V3.deriveKeys(V3.sharedSecret(bytes(me), pub(them)), bytes(v.nonce));
      assert.equal(hex(keys.prk), v.prk);
      assert.equal(hex(keys.encryptionKey), v.encryption_key);
      assert.equal(hex(keys.macKey), v.mac_key);

      assert.equal(hex(V3.decrypt(bytes(me), pub(them), v.kind, bytes(v.scope_hex), v.ciphertext)), v.plaintext_hex);
      assert.equal(
        V3._encryptWithNonce(bytes(me), pub(them), v.kind, bytes(v.scope_hex), bytes(v.plaintext_hex), bytes(v.nonce)),
        v.ciphertext
      );
    }
  });
}

// Payloads another implementation may legitimately produce (padding of a non-standard
// length) must open: the padding is checked for zeros, never for its size.
for (const [i, v] of vectors.decrypt_only.entries()) {
  test('decrypt_only #' + i + ': ' + v.note, () => {
    for (const [me, them] of [[v.secret1, v.secret2], [v.secret2, v.secret1]]) {
      const parsed = V3.decodePayload(v.ciphertext);
      assert.equal(hex(parsed.nonce), v.nonce);
      assert.equal(parsed.kind, v.kind);
      assert.equal(hex(parsed.scope), v.scope_hex);
      const keys = V3.deriveKeys(V3.sharedSecret(bytes(me), pub(them)), bytes(v.nonce));
      assert.equal(hex(keys.prk), v.prk);
      assert.equal(hex(keys.encryptionKey), v.encryption_key);
      assert.equal(hex(keys.macKey), v.mac_key);
      assert.equal(hex(V3.decrypt(bytes(me), pub(them), v.kind, bytes(v.scope_hex), v.ciphertext)), v.plaintext_hex);
    }
  });
}

test('long_encrypt_decrypt: every vector, from both sides, up to 256 KiB', () => {
  for (const v of vectors.long_encrypt_decrypt) {
    const plaintext = bytes(v.pattern_hex.repeat(v.repeat));
    for (const [me, them] of [[v.secret1, v.secret2], [v.secret2, v.secret1]]) {
      const ct = V3._encryptWithNonce(bytes(me), pub(them), v.kind, bytes(v.scope_hex), plaintext, bytes(v.nonce));
      assert.equal(crypto.createHash('sha256').update(ct).digest('hex'), v.ciphertext_sha256,
        'ciphertext hash for ' + plaintext.length + ' bytes');
      assert.ok(Buffer.from(V3.decrypt(bytes(them), pub(me), v.kind, bytes(v.scope_hex), ct)).equals(Buffer.from(plaintext)));
    }
  }
});

test('padded_length: target_size for every listed length, up to 16 MiB', () => {
  for (const [len, want] of vectors.padded_length) assert.equal(V3.targetSize(len), want, 'length ' + len);
});

// Each failure is checked for its REASON, not just for throwing: a decrypt that fails the
// MAC check on a payload that should have been refused on its version is right by
// accident, and the vectors' `why` exists so implementations can tell.
const REASON = [
  [/^invalid MAC$/, /^invalid MAC$/],
  [/^invalid padding$/, /^invalid padding$/],
  [/^unsupported (future )?version/, /^unknown encryption version/],
  [/^empty payload$/, /^invalid payload: empty$/],
  [/^payload only has 1 byte$/, /^invalid payload: too short$/],
  [/^scope length out-of-bounds$/, /^invalid payload: scope length out of bounds$/],
  [/^ciphertext too short$/, /^invalid payload: ciphertext too short$/],
  [/^invalid base64/, /^invalid payload: bad base64$/],
  [/^context mismatch \(kind\)$/, /^context mismatch: kind$/],
  [/^context mismatch \(scope\)$/, /^context mismatch: scope$/],
  [/^invalid scope \(not valid utf8\)$/, /^invalid scope: not valid UTF-8$/],
];
for (const [i, v] of vectors.invalid_decryption.entries()) {
  test('invalid_decryption #' + i + ' fails closed: ' + v.why, () => {
    const reason = REASON.find(([why]) => why.test(v.why));
    assert.ok(reason, 'no expected reason recorded for "' + v.why + '"');
    fails(() => V3.decrypt(bytes(v.secret), v.public, v.kind, bytes(v.scope_hex), v.ciphertext), reason[1]);
  });
}

// ---- held apart from v2 ----

// NIP-44 v2's own published vector (sec1 = 1, sec2 = 2, nonce = 1, plaintext "a"), through
// the vendored nostr-tools exactly as signer.js calls it. v2 must not move a byte.
const V2_SEC1 = '00'.repeat(31) + '01';
const V2_SEC2 = '00'.repeat(31) + '02';
const V2_CONV = 'c41c775356fd92eadc63ff5a0dc1da211b268cbea22316767095b2871ea1412d';
const V2_PAYLOAD = 'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABee0G5VSK0/9YypIObAtDKfYEAjD35uVkHyB0F4DwrcNaCXlCWZKaArsGrY6M9wnuTMxWfp1RTN9Xga8no+kF5Vsb';

test('v2 is unchanged: its published vector, byte for byte', () => {
  const conv = NT.nip44.getConversationKey(bytes(V2_SEC1), pub(V2_SEC2));
  assert.equal(hex(conv), V2_CONV);
  assert.equal(NT.nip44.v2.encrypt('a', conv, bytes('00'.repeat(31) + '01')), V2_PAYLOAD);
  assert.equal(NT.nip44.decrypt(V2_PAYLOAD, conv), 'a');
  // And a fresh v2 payload still carries version byte 2.
  assert.equal(Buffer.from(NT.nip44.encrypt('hello', conv), 'base64')[0], 2);
});

test('a v3 payload does not open through v2, and a v2 payload does not open through v3', () => {
  const v = vectors.encrypt_decrypt[0];
  const conv = NT.nip44.getConversationKey(bytes(v.secret1), pub(v.secret2));
  fails(() => NT.nip44.decrypt(v.ciphertext, conv), /unknown encryption version/);

  const v2 = NT.nip44.encrypt('hello', conv);
  fails(() => V3.decrypt(bytes(v.secret1), pub(v.secret2), 1, '', v2), /^unknown encryption version 2$/);
  fails(() => V3.decrypt(bytes(V2_SEC1), pub(V2_SEC2), 1, '', V2_PAYLOAD), /^unknown encryption version 2$/);
});

test('a "#" payload is an unknown version in both, never a parse attempt', () => {
  const conv = NT.nip44.getConversationKey(bytes(V2_SEC1), pub(V2_SEC2));
  fails(() => NT.nip44.decrypt('#' + V2_PAYLOAD.slice(1), conv), /unknown encryption version/);
  fails(() => V3.decodePayload('#anything'), /^unknown encryption version$/);
});

test('every version byte but 3 is refused by v3', () => {
  const v = vectors.encrypt_decrypt[1];
  const raw = Buffer.from(v.ciphertext, 'base64');
  for (const version of [0, 1, 2, 4, 255]) {
    raw[0] = version;
    fails(() => V3.decodePayload(raw.toString('base64')), new RegExp('^unknown encryption version ' + version + '$'));
  }
});

// ---- the edges the vectors do not reach ----

test('a round trip with a random nonce, and two encryptions never share one', () => {
  const a = bytes('11'.repeat(32));
  const b = bytes('22'.repeat(32));
  const msg = utf8('meet at the usual place');
  const one = V3.encrypt(a, NT.getPublicKey(b), 30078, 'sidecar/test', msg);
  const two = V3.encrypt(a, NT.getPublicKey(b), 30078, 'sidecar/test', msg);
  assert.notEqual(one, two);
  assert.notEqual(hex(V3.decodePayload(one).nonce), hex(V3.decodePayload(two).nonce));
  assert.equal(new TextDecoder().decode(V3.decrypt(b, NT.getPublicKey(a), 30078, 'sidecar/test', one)), 'meet at the usual place');
});

test('binary plaintexts, the empty one included, come back exactly', () => {
  const a = bytes('33'.repeat(32));
  const b = bytes('44'.repeat(32));
  for (const plain of [new Uint8Array(0), Uint8Array.of(0, 255, 0xc3, 0x28, 0), crypto.randomBytes(70000)]) {
    const ct = V3.encrypt(a, NT.getPublicKey(b), 1, '', new Uint8Array(plain));
    assert.ok(Buffer.from(V3.decrypt(b, NT.getPublicKey(a), 1, '', ct)).equals(Buffer.from(plain)));
  }
});

test('kinds above 65535 work, up to 2^32 - 1; outside a u32 is refused', () => {
  const a = bytes('55'.repeat(32));
  const b = bytes('66'.repeat(32));
  for (const kind of [65536, 0xffffffff]) {
    const ct = V3.encrypt(a, NT.getPublicKey(b), kind, 'x', utf8('k'));
    assert.equal(V3.decodePayload(ct).kind, kind);
    assert.equal(new TextDecoder().decode(V3.decrypt(b, NT.getPublicKey(a), kind, 'x', ct)), 'k');
  }
  for (const kind of [-1, 2 ** 32, 1.5, '1', null, undefined, NaN]) {
    fails(() => V3.encrypt(a, NT.getPublicKey(b), kind, '', utf8('k')), /invalid kind/);
  }
});

test('a scope is never transformed: a lone surrogate is refused, not replaced', () => {
  const a = bytes('77'.repeat(32));
  const b = bytes('88'.repeat(32));
  fails(() => V3.encrypt(a, NT.getPublicKey(b), 1, 'ab\uD800', utf8('x')), /invalid scope: not valid UTF-8/);
  fails(() => V3.encrypt(a, NT.getPublicKey(b), 1, '\uDC00', utf8('x')), /invalid scope: not valid UTF-8/);
  // A scope that differs only by Unicode normalization is a different scope.
  const ct = V3.encrypt(a, NT.getPublicKey(b), 1, 'café', utf8('x'));
  fails(() => V3.decrypt(b, NT.getPublicKey(a), 1, 'café', ct), /context mismatch: scope/);
});

test('the base64 decoder is strict', () => {
  assert.deepEqual([...V3.base64Decode('AQID')], [1, 2, 3]);
  for (const bad of ['AQI', 'AQ I', 'AQ==\n', 'A-_=', 'AR==', 'AQN=', '====', 'AQ=D']) {
    fails(() => V3.base64Decode(bad), /invalid base64/, JSON.stringify(bad));
  }
  const all = crypto.randomBytes(1000);
  for (let n = 0; n < 40; n++) {
    const slice = all.subarray(0, n * 23);
    assert.equal(V3.base64Encode(new Uint8Array(slice)), slice.toString('base64'));
    assert.ok(Buffer.from(V3.base64Decode(slice.toString('base64'))).equals(slice));
  }
});

test('a pubkey that is not on the curve, or a bad secret key, is refused', () => {
  const a = bytes('99'.repeat(32));
  fails(() => V3.encrypt(a, 'ff'.repeat(32), 1, '', utf8('x')));
  fails(() => V3.encrypt(a, 'not hex', 1, '', utf8('x')), /invalid pubkey/);
  fails(() => V3.encrypt(new Uint8Array(32), NT.getPublicKey(bytes('01'.repeat(32))), 1, '', utf8('x')));
});

test('checkRequest refuses what an approval card could not describe', () => {
  const pk = NT.getPublicKey(bytes('12'.repeat(32)));
  const ok = V3.checkRequest('nip44v3.encrypt', { pubkey: pk.toUpperCase(), kind: 4, scope: '', plaintextBase64: 'aGk=' });
  assert.deepEqual({ ...ok }, { pubkey: pk, kind: 4, scope: '', plaintextBase64: 'aGk=' });
  assert.deepEqual({ ...V3.checkRequest('nip44v3.decrypt', { pubkey: pk, kind: 4, scope: 's', ciphertext: 'x' }) },
    { pubkey: pk, kind: 4, scope: 's', ciphertext: 'x' });
  const bad = [
    [{ pubkey: 'npub1...', kind: 4, scope: '', plaintextBase64: '' }, /invalid pubkey/],
    [{ pubkey: pk, kind: '4', scope: '', plaintextBase64: '' }, /invalid kind/],
    [{ pubkey: pk, kind: 4, scope: null, plaintextBase64: '' }, /invalid scope/],
    [{ pubkey: pk, kind: 4, scope: '\uD800', plaintextBase64: '' }, /not valid UTF-8/],
    [{ pubkey: pk, kind: 4, scope: '', plaintext: 'hi' }, /plaintext must be bytes/],
    [{ pubkey: pk, kind: 4, scope: '', plaintextBase64: 'not base64!' }, /plaintext must be bytes/],
  ];
  for (const [params, re] of bad) fails(() => V3.checkRequest('nip44v3.encrypt', params), re);
  fails(() => V3.checkRequest('nip44v3.decrypt', { pubkey: pk, kind: 4, scope: '' }), /ciphertext must be a string/);
  fails(() => V3.checkRequest('nip44.encrypt', { pubkey: pk, kind: 4, scope: '' }), /Unsupported method/);
});

test('the primitives bundle exports exactly what nip44v3.js composes', () => {
  assert.deepEqual(Object.keys(P).sort(), ['chacha20', 'hkdfExpand', 'hkdfExtract', 'hmac', 'secp256k1', 'sha256']);
});
