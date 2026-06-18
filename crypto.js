// Sidecar crypto module — PIN-based key wrapping with WebCrypto (no dependencies).
//
// Derives an AES-GCM key from the user's PIN/passphrase via PBKDF2, and uses it to
// encrypt/decrypt the 32-byte nostr private keys (and the NWC connection string) at
// rest. The derived CryptoKey is non-extractable and never leaves WebCrypto; only the
// decrypted private-key bytes are sensitive in-memory material.
//
// Loaded as a classic script: in the service worker via importScripts('crypto.js')
// (attaches to `self`), in pages via <script src="crypto.js"> (attaches to `window`).
// Both reach it as the global `SidecarCrypto`.

(function (root) {
  'use strict';

  const DEFAULT_ITERATIONS = 600000; // PBKDF2 rounds — high to offset low PIN entropy
  const SALT_BYTES = 16;
  const IV_BYTES = 12; // AES-GCM standard nonce length
  const VERIFIER_PLAINTEXT = 'sidecar-keystore-v1';

  const subtle = (root.crypto || globalThis.crypto).subtle;
  const getRandomValues = (arr) => (root.crypto || globalThis.crypto).getRandomValues(arr);

  function randomBytes(n) {
    return getRandomValues(new Uint8Array(n));
  }

  // ---- base64 helpers (work in both service worker and window contexts) ----
  function bytesToBase64(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < arr.length; i += chunk) {
      binary += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function utf8(str) {
    return new TextEncoder().encode(str);
  }

  // Generate a fresh KDF descriptor (one per keystore).
  function newKdf(iterations) {
    return {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: iterations || DEFAULT_ITERATIONS,
      salt: bytesToBase64(randomBytes(SALT_BYTES)),
    };
  }

  // Derive a non-extractable AES-GCM key from a PIN/passphrase and a KDF descriptor.
  async function deriveKey(pin, kdf) {
    const baseKey = await subtle.importKey('raw', utf8(pin), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: base64ToBytes(kdf.salt),
        iterations: kdf.iterations,
        hash: kdf.hash || 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable
      ['encrypt', 'decrypt']
    );
  }

  // Encrypt raw bytes → { iv, ct } (both base64). A fresh IV is generated per call.
  async function encryptBytes(key, bytes) {
    const iv = randomBytes(IV_BYTES);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
  }

  // Decrypt { iv, ct } → Uint8Array. Throws (OperationError) on wrong key / tampering.
  async function decryptBytes(key, enc) {
    const plain = await subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(enc.iv) },
      key,
      base64ToBytes(enc.ct)
    );
    return new Uint8Array(plain);
  }

  // Encrypt/decrypt a UTF-8 string (used for the NWC connection string).
  async function encryptString(key, str) {
    return encryptBytes(key, utf8(str));
  }
  async function decryptString(key, enc) {
    return new TextDecoder().decode(await decryptBytes(key, enc));
  }

  // A verifier lets us reject a wrong PIN instantly (decrypt → compare) without
  // having to decrypt an account key and produce garbage.
  async function makeVerifier(key) {
    return encryptBytes(key, utf8(VERIFIER_PLAINTEXT));
  }
  async function checkVerifier(key, verifier) {
    try {
      const bytes = await decryptBytes(key, verifier);
      return new TextDecoder().decode(bytes) === VERIFIER_PLAINTEXT;
    } catch (_) {
      return false; // OperationError ⇒ wrong PIN
    }
  }

  // Best-effort zeroing of sensitive Uint8Arrays on lock.
  function wipe(bytes) {
    if (bytes && bytes.fill) bytes.fill(0);
  }

  root.SidecarCrypto = {
    DEFAULT_ITERATIONS,
    randomBytes,
    bytesToBase64,
    base64ToBytes,
    newKdf,
    deriveKey,
    encryptBytes,
    decryptBytes,
    encryptString,
    decryptString,
    makeVerifier,
    checkVerifier,
    wipe,
  };
})(typeof self !== 'undefined' ? self : this);
