// NIP-44 v3 (draft) — encrypted payloads bound to an event kind and a scope.
//
// The draft: https://github.com/nostr-land/nip44v3 (nip44v3.md, implementing.md). It is a
// draft with two implementations in the wild, so this sits BESIDE NIP-44 v2, never in
// its place. v2 is NostrTools.nip44, untouched: the wallet backup, private lists and every
// site calling window.nostr.nip44 keep the scheme they have today.
//
// What v3 changes, in one paragraph. There is no long-lived conversation key. Every
// message draws a fresh 32-byte nonce and derives its own two keys from the ECDH secret
// with HKDF, salted with "nip44-v3\0" and the nonce. ChaCha20 then runs with a ZERO
// nonce, which is safe because the key itself is new every time. The payload carries
// two pieces of context in the clear, the event kind and a free-form scope string, and
// the MAC covers them. A decrypt has to name the kind and scope it expects, and a
// payload sealed for some other context does not open: a ciphertext lifted out of a
// list and replayed into a DM fails instead of decrypting.
//
// Plaintexts are BYTES here, not strings: the draft carries binary data, and the
// window.nostr.nip44v3 methods take and return ArrayBuffers.
//
// Wire layout, all integers big-endian (base64 of):
//
//   0x03 | nonce(32) | mac(32) | u32 kind | u32 scope_len | scope | chacha20_ciphertext
//
// and under ChaCha20: u32 plaintext_len | plaintext | zero padding.
//
// Only the scheme lives in this file. The primitives it composes (ChaCha20, HKDF,
// HMAC-SHA256, secp256k1) come from nip44v3-primitives.js, a pinned, hash-checked build
// of the noble libraries (see VENDOR.md); nothing in that bundle knows about v3.
//
// Loaded by the background (importScripts and the Firefox manifest list) after
// nip44v3-primitives.js. Every function here is pure, so test/nip44v3.test.js runs the
// draft's own test vectors straight against it.

(function (root) {
  'use strict';

  const VERSION = 3;
  // version(1) + nonce(32) + mac(32) + kind(4) + scope_len(4) + the smallest possible
  // ChaCha20 block a sender can produce: the 4-byte length prefix of an empty message.
  const MIN_DECODED_LEN = 77;
  const MAX_PLAINTEXT = 0x7fffffff; // 2^31 - 1, the draft's ceiling
  const MAX_KIND = 0xffffffff; // a u32; kinds above 65535 are reserved but must work

  const enc = new TextEncoder();
  const SALT_PREFIX = enc.encode('nip44-v3\x00');
  const INFO_ENCRYPTION = enc.encode('encryption_key');
  const INFO_MAC = enc.encode('mac_key');

  // Looked up on use rather than captured at load, so a test can hand the file a
  // primitives object, and a missing bundle fails one call loudly instead of the
  // whole service worker at startup.
  function prims() {
    const P = root.SidecarNip44v3Primitives;
    if (!P) throw new Error('NIP-44 v3 primitives are not loaded');
    return P;
  }

  // ---- bytes ----

  // A Uint8Array from any realm (noble's own test): a test's vm context and the page's
  // structured clones each bring their own constructor, which instanceof cannot see.
  function isBytes(a) {
    return a instanceof Uint8Array ||
      (ArrayBuffer.isView(a) && a.constructor && a.constructor.name === 'Uint8Array');
  }

  function concat(...parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  function u32(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, false);
    return b;
  }

  function readU32(bytes, at) {
    return new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0, false);
  }

  function hexToBytes(hex) {
    if (typeof hex !== 'string' || hex.length % 2 || !/^[0-9a-f]*$/i.test(hex)) {
      throw new Error('invalid hex');
    }
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  // Compares every byte whatever it finds, so the time taken says nothing about where
  // two MACs first differ. Lengths are public (both are 32 for a MAC), so a length
  // mismatch may return early.
  function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  // ---- base64, strict ----
  //
  // RFC 4648 standard alphabet with padding, and nothing else: no whitespace, no URL-safe
  // characters, no missing '=' and no stray bits after the last byte. The draft says a
  // decoder "fails on malformed input", and atob() is deliberately forgiving about all of
  // the above, so the codec is written out here.

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64_INDEX = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) B64_INDEX[B64.charCodeAt(i)] = i;

  function base64Encode(bytes) {
    let out = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    const rest = bytes.length - i;
    if (rest === 1) {
      const n = bytes[i] << 16;
      out += B64[n >> 18] + B64[(n >> 12) & 63] + '==';
    } else if (rest === 2) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
    }
    return out;
  }

  function base64Decode(str) {
    if (typeof str !== 'string' || str.length % 4 !== 0) throw new Error('invalid base64');
    const pad = str.endsWith('==') ? 2 : str.endsWith('=') ? 1 : 0;
    const out = new Uint8Array((str.length / 4) * 3 - pad);
    const body = str.length - pad;
    const sextet = (i) => {
      const c = str.charCodeAt(i);
      const v = c < 128 ? B64_INDEX[c] : -1;
      if (v < 0) throw new Error('invalid base64');
      return v;
    };
    let o = 0;
    for (let i = 0; i < str.length; i += 4) {
      const a = sextet(i);
      const b = sextet(i + 1);
      const c = i + 2 < body ? sextet(i + 2) : 0;
      const d = i + 3 < body ? sextet(i + 3) : 0;
      const n = (a << 18) | (b << 12) | (c << 6) | d;
      out[o++] = n >> 16;
      if (o < out.length) out[o++] = (n >> 8) & 255;
      if (o < out.length) out[o++] = n & 255;
      // The bits a short final group leaves unused must be zero, or two different
      // strings would decode to the same bytes.
      if (i + 4 === str.length && ((pad === 2 && (b & 15)) || (pad === 1 && (c & 3)))) {
        throw new Error('invalid base64');
      }
    }
    return out;
  }

  // ---- context ----

  function checkKind(kind) {
    if (!Number.isInteger(kind) || kind < 0 || kind > MAX_KIND) {
      throw new Error('invalid kind: must be an integer from 0 to 4294967295');
    }
    return kind;
  }

  // The scope as the bytes that go on the wire. A string must be well-formed: a lone
  // surrogate has no UTF-8 encoding, and TextEncoder would quietly swap it for U+FFFD,
  // which is the "canonicalize or transform the scope" the draft tells libraries not to
  // do. Bytes (the test vectors' form) must already be valid UTF-8.
  const utf8Strict = new TextDecoder('utf-8', { fatal: true });
  function scopeBytes(scope) {
    if (typeof scope === 'string') {
      if (!isWellFormed(scope)) throw new Error('invalid scope: not valid UTF-8');
      return enc.encode(scope);
    }
    if (isBytes(scope)) {
      try { utf8Strict.decode(scope); } catch (_) { throw new Error('invalid scope: not valid UTF-8'); }
      return scope;
    }
    throw new Error('invalid scope: must be a string');
  }

  function isWellFormed(s) {
    if (typeof s.isWellFormed === 'function') return s.isWellFormed();
    return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
  }

  // ---- padding ----
  //
  // target_size from the draft: round up to the next power of two, cut that into 4
  // chunks (8 once it reaches 32 KiB), never smaller than 32 bytes, and pad to the next
  // chunk boundary. Integer arithmetic only; Math.log2 on large lengths is a rounding
  // error waiting to happen.
  function targetSize(len) {
    if (len <= 32) return 32;
    let nextPower = 1;
    while (nextPower < len) nextPower *= 2;
    const chunk = Math.max(32, nextPower / (nextPower >= 32768 ? 8 : 4));
    return chunk * Math.ceil(len / chunk);
  }

  // ---- keys ----

  // The x coordinate of seckey · lift_x(pubkey), as in BIP-340. secp256k1 rejects a
  // pubkey that is not on the curve and a secret key outside [1, n).
  function sharedSecret(privBytes, peerPubkeyHex) {
    if (!isBytes(privBytes) || privBytes.length !== 32) throw new Error('invalid secret key');
    if (typeof peerPubkeyHex !== 'string' || !/^[0-9a-f]{64}$/i.test(peerPubkeyHex)) {
      throw new Error('invalid pubkey');
    }
    const point = prims().secp256k1.getSharedSecret(privBytes, hexToBytes('02' + peerPubkeyHex));
    return point.subarray(1, 33);
  }

  // Per-message keys: HKDF-SHA256 with salt "nip44-v3\0" || nonce. The PRK is returned
  // too because the draft's vectors check it.
  function deriveKeys(shared, nonce) {
    if (!isBytes(nonce) || nonce.length !== 32) throw new Error('invalid nonce');
    const P = prims();
    const prk = P.hkdfExtract(P.sha256, shared, concat(SALT_PREFIX, nonce));
    return {
      prk,
      encryptionKey: P.hkdfExpand(P.sha256, prk, INFO_ENCRYPTION, 32),
      macKey: P.hkdfExpand(P.sha256, prk, INFO_MAC, 32),
    };
  }

  // ChaCha20 with a 96-bit all-zero nonce and the block counter starting at 0.
  const ZERO_NONCE = new Uint8Array(12);
  function chacha(key, data) {
    return prims().chacha20(key, ZERO_NONCE, data);
  }

  function authenticatedData(nonce, kind, scope, ciphertext) {
    return concat(nonce, u32(kind), u32(scope.length), scope, ciphertext);
  }

  // ---- encrypt ----

  // The whole of encryption, with the nonce supplied. INTERNAL: only encrypt() below
  // and the test vectors call this. A caller choosing the nonce is how a key gets reused,
  // so nothing a page can reach ever passes one (implementing.md says the same).
  function encryptWithNonce(privBytes, peerPubkeyHex, kind, scope, plaintext, nonce) {
    checkKind(kind);
    const scopeB = scopeBytes(scope);
    if (!isBytes(plaintext)) throw new Error('invalid plaintext: must be bytes');
    if (plaintext.length > MAX_PLAINTEXT) throw new Error('invalid plaintext: too long');

    const { encryptionKey, macKey } = deriveKeys(sharedSecret(privBytes, peerPubkeyHex), nonce);
    const prefixedLen = 4 + plaintext.length;
    const padded = new Uint8Array(targetSize(prefixedLen)); // zero-filled: the padding
    padded.set(u32(plaintext.length), 0);
    padded.set(plaintext, 4);
    const ciphertext = chacha(encryptionKey, padded);
    const mac = prims().hmac(prims().sha256, macKey, authenticatedData(nonce, kind, scopeB, ciphertext));
    return base64Encode(concat(
      Uint8Array.of(VERSION), nonce, mac, u32(kind), u32(scopeB.length), scopeB, ciphertext
    ));
  }

  function randomNonce() {
    const n = new Uint8Array(32);
    root.crypto.getRandomValues(n);
    return n;
  }

  // encrypt(secret key bytes, peer pubkey hex, kind, scope string, plaintext bytes)
  //   → base64 payload string
  function encrypt(privBytes, peerPubkeyHex, kind, scope, plaintext) {
    return encryptWithNonce(privBytes, peerPubkeyHex, kind, scope, plaintext, randomNonce());
  }

  // ---- decrypt ----

  // Splits a payload into its parts and checks its shape, without any key. Exported for
  // the tests (they check the parse against the vectors' nonce, kind and scope); a
  // caller must never treat the kind and scope found here as the expected ones.
  function decodePayload(payload) {
    if (typeof payload !== 'string') throw new Error('invalid payload: must be a string');
    if (payload.length === 0) throw new Error('invalid payload: empty');
    // '#' is reserved for future non-base64 encodings: an unknown version, not bad base64.
    if (payload[0] === '#') throw new Error('unknown encryption version');
    let data;
    try { data = base64Decode(payload); } catch (_) { throw new Error('invalid payload: bad base64'); }
    if (data.length < MIN_DECODED_LEN) throw new Error('invalid payload: too short');
    // Fail closed on every version but ours, v2 included: a v2 payload goes to
    // NostrTools.nip44, which in turn refuses anything that is not version 2.
    if (data[0] !== VERSION) throw new Error('unknown encryption version ' + data[0]);
    const scopeLen = readU32(data, 69);
    if (scopeLen > data.length - 73) throw new Error('invalid payload: scope length out of bounds');
    const ciphertext = data.subarray(73 + scopeLen);
    if (ciphertext.length < 4) throw new Error('invalid payload: ciphertext too short');
    return {
      nonce: data.subarray(1, 33),
      mac: data.subarray(33, 65),
      kind: readU32(data, 65),
      scope: data.subarray(73, 73 + scopeLen),
      ciphertext,
    };
  }

  // decrypt(secret key bytes, peer pubkey hex, expected kind, expected scope string,
  //         base64 payload) → plaintext bytes
  //
  // The expected kind and scope come from the CALLER (normally the event the payload sits
  // in), and a payload sealed for anything else fails, before any key is derived.
  function decrypt(privBytes, peerPubkeyHex, expectedKind, expectedScope, payload) {
    checkKind(expectedKind);
    const wantScope = scopeBytes(expectedScope);
    const p = decodePayload(payload);
    if (p.kind !== expectedKind) throw new Error('context mismatch: kind');
    // Neither scope is secret, so a plain comparison is fine here.
    if (p.scope.length !== wantScope.length || !p.scope.every((b, i) => b === wantScope[i])) {
      throw new Error('context mismatch: scope');
    }

    const { encryptionKey, macKey } = deriveKeys(sharedSecret(privBytes, peerPubkeyHex), p.nonce);
    const expectedMac = prims().hmac(prims().sha256, macKey, authenticatedData(p.nonce, p.kind, p.scope, p.ciphertext));
    if (!constantTimeEqual(p.mac, expectedMac)) throw new Error('invalid MAC');

    const padded = chacha(encryptionKey, p.ciphertext);
    const len = readU32(padded, 0);
    if (len + 4 > padded.length) throw new Error('invalid payload: plaintext length out of bounds');
    if (len > MAX_PLAINTEXT) throw new Error('invalid payload: plaintext too long');
    // The padding must be zeros. Its LENGTH is not checked: the draft allows any padding
    // a sender chose (its decrypt-only vectors use non-standard amounts).
    let nonZero = 0;
    for (let i = 4 + len; i < padded.length; i++) nonZero |= padded[i];
    if (nonZero !== 0) throw new Error('invalid padding');
    return padded.slice(4, 4 + len);
  }

  // ---- a page's request, checked before anyone is asked about it ----
  //
  // window.nostr.nip44v3 sends { pubkey, kind, scope, plaintextBase64 } to encrypt and
  // { pubkey, kind, scope, ciphertext } to decrypt (nostr-provider.js turns the page's
  // ArrayBuffer into base64, because extension messaging does not carry binary).
  // Everything is checked here, so a malformed request is refused outright rather than
  // put in front of the person on an approval card that cannot describe it. Returns the
  // params normalized; throws an English error, which is what reaches the page.
  function checkRequest(method, params) {
    const p = params && typeof params === 'object' ? params : {};
    if (typeof p.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(p.pubkey)) {
      throw new Error(method + ': invalid pubkey');
    }
    try { checkKind(p.kind); } catch (e) { throw new Error(method + ': ' + e.message); }
    if (typeof p.scope !== 'string') throw new Error(method + ': invalid scope: must be a string');
    if (!isWellFormed(p.scope)) throw new Error(method + ': invalid scope: not valid UTF-8');
    const out = { pubkey: p.pubkey.toLowerCase(), kind: p.kind, scope: p.scope };
    if (method === 'nip44v3.encrypt') {
      if (typeof p.plaintextBase64 !== 'string') throw new Error(method + ': plaintext must be bytes');
      try { base64Decode(p.plaintextBase64); } catch (_) { throw new Error(method + ': plaintext must be bytes'); }
      out.plaintextBase64 = p.plaintextBase64;
    } else if (method === 'nip44v3.decrypt') {
      if (typeof p.ciphertext !== 'string') throw new Error(method + ': ciphertext must be a string');
      out.ciphertext = p.ciphertext;
    } else {
      throw new Error('Unsupported method: ' + method);
    }
    return out;
  }

  const METHODS = Object.freeze(['nip44v3.encrypt', 'nip44v3.decrypt']);

  root.SidecarNip44v3 = {
    VERSION,
    METHODS,
    encrypt,
    decrypt,
    checkRequest,
    // Building blocks, exported for the tests and for nothing else to rely on.
    decodePayload,
    deriveKeys,
    sharedSecret,
    targetSize,
    base64Encode,
    base64Decode,
    _encryptWithNonce: encryptWithNonce,
  };
})(typeof self !== 'undefined' ? self : this);
