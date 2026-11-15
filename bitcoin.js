// Sidecar — the little bit of Bitcoin a rescue sweep needs.
//
// The Wallet tab's optional on-chain rescue card (1.18) shows the two Taproot
// addresses derivable from the active account's Nostr key and can sweep every
// confirmed satoshi on them to one pasted destination. That takes: TapTweak
// derivation (BIP-341), key-path signatures (BIP-340), segwit addresses
// (BIP-173/350), a SIGHASH_ALL signature message, and raw transaction
// serialization — and none of it exists in the vendored nostr-tools bundle,
// which signs Nostr events and stops there. So this file is hand-rolled, the
// way crypto.js is: no dependencies, BigInt point arithmetic, WebCrypto
// sha256. Every construction here is pinned by test/bitcoin.test.js against
// the published vectors in BIP-340, BIP-350 and BIP-341's wallet test vectors,
// which is what makes hand-rolling defensible for a file that moves money.
//
// Loaded as a classic script: in the service worker via importScripts
// (attaches to `self`), in the side panel via <script> (attaches to `window`).
// Both reach it as the global `SidecarBitcoin`.
//
// Deliberately NOT on the window.nostr surface: web pages never see any of
// this. The side panel builds the transaction (public data only); the service
// worker computes every SIGHASH_ALL message itself (signSweepTx) and signs it
// against the unlocked keystore under one of the active account's own two
// Taproot keys — it never signs bytes handed to it.

(function (root) {
  'use strict';

  // ---- bytes and hex ---------------------------------------------------------

  const HEX = '0123456789abcdef';
  function bytesToHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
    return s;
  }
  function hexToBytes(hex) {
    if (typeof hex !== 'string' || hex.length % 2 || /[^0-9a-fA-F]/.test(hex)) return null;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function concatBytes() {
    let len = 0;
    for (const b of arguments) len += b.length;
    const out = new Uint8Array(len);
    let at = 0;
    for (const b of arguments) { out.set(b, at); at += b.length; }
    return out;
  }
  function bytesToBigInt(bytes) {
    let v = 0n;
    for (const b of bytes) v = (v << 8n) | BigInt(b);
    return v;
  }
  function bigIntToBytes(v, len) {
    const out = new Uint8Array(len);
    for (let i = len - 1; i >= 0; i--) { out[i] = Number(v & 255n); v >>= 8n; }
    return out;
  }
  // Little-endian integers, as the transaction wire format encodes them.
  function leBytes(n, len) {
    n = BigInt(n);
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) { out[i] = Number(n & 255n); n >>= 8n; }
    return out;
  }
  const u32le = (n) => leBytes(n, 4);
  const u64le = (n) => leBytes(n, 8);

  // ---- sha256 (WebCrypto) and tagged hashes ----------------------------------

  async function sha256(bytes) {
    return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  }
  // BIP-340's TaggedHash: sha256(sha256(tag) || sha256(tag) || msg).
  async function taggedHash(tag, msg) {
    const t = await sha256(new TextEncoder().encode(tag));
    return sha256(concatBytes(t, t, msg));
  }

  // ---- secp256k1 point arithmetic (affine, extended-Euclid inverses) ---------
  //
  // A rescue sweep performs a handful of point operations per signing session
  // (one tweak per key, one verify per test), so affine coordinates with a
  // BigInt modular inverse are fast enough by orders of magnitude and stay
  // readable — this file wants to be auditable more than it wants to be quick.

  const FIELD_P = 2n ** 256n - 2n ** 32n - 977n;
  const ORDER_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  const G = { x: 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n, y: 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n };
  const INFINITY = null;

  function mod(a, m) { const r = a % m; return r >= 0n ? r : r + m; }
  // Extended Euclid — the curve's field needs an inverse for every addition.
  function invert(a, m) {
    a = mod(a, m);
    let [old_r, r] = [a, m], [old_s, s] = [1n, 0n];
    while (r) {
      const q = old_r / r;
      [old_r, r] = [r, old_r - q * r];
      [old_s, s] = [s, old_s - q * s];
    }
    if (old_r !== 1n) return null; // a and m not coprime
    return mod(old_s, m);
  }
  function pointDouble(p) {
    if (!p || p.y === 0n) return INFINITY;
    const l = mod(3n * p.x * p.x * invert(2n * p.y, FIELD_P), FIELD_P);
    const x = mod(l * l - 2n * p.x, FIELD_P);
    return { x, y: mod(l * (p.x - x) - p.y, FIELD_P) };
  }
  function pointAdd(p, q) {
    if (!p) return q;
    if (!q) return p;
    if (p.x === q.x) return p.y === q.y && p.y !== 0n ? pointDouble(p) : INFINITY;
    const l = mod((q.y - p.y) * invert(q.x - p.x, FIELD_P), FIELD_P);
    const x = mod(l * l - p.x - q.x, FIELD_P);
    return { x, y: mod(l * (p.x - x) - p.y, FIELD_P) };
  }
  function scalarMult(k, p) {
    k = mod(k, ORDER_N);
    let acc = INFINITY, addend = p;
    while (k) {
      if (k & 1n) acc = pointAdd(acc, addend);
      addend = pointDouble(addend);
      k >>= 1n;
    }
    return acc;
  }
  // lift_x from BIP-340: the x-only key's implicit point has an even Y.
  function liftX(xonly) {
    const x = bytesToBigInt(xonly);
    if (x >= FIELD_P) return null;
    const ySq = mod(x * x * x + 7n, FIELD_P);
    // secp256k1's field is 3 mod 4, so a root is y^((P+1)/4) when one exists.
    let y = modPow(ySq, (FIELD_P + 1n) / 4n, FIELD_P);
    if (mod(y * y, FIELD_P) !== ySq) return null;
    if (y % 2n !== 0n) y = FIELD_P - y;
    return { x, y };
  }
  function modPow(b, e, m) {
    let acc = 1n;
    b = mod(b, m);
    while (e) {
      if (e & 1n) acc = mod(acc * b, m);
      b = mod(b * b, m);
      e >>= 1n;
    }
    return acc;
  }
  // The scalar whose point is the given scalar's point with an even Y — i.e.
  // the secret scalar of the point lift_x(x-only(pubkey)) encodes.
  function evenYScalar(k) {
    const pt = scalarMult(k, G);
    if (!pt) return null;
    return pt.y % 2n === 0n ? mod(k, ORDER_N) : mod(-k, ORDER_N);
  }

  // ---- BIP-340 Schnorr signatures ----------------------------------------------
  //
  // sign() is async because sha256 goes through WebCrypto. aux is optional
  // (random when omitted) and exposed for the deterministic test vectors; in
  // production it must be fresh randomness, and getRandomValues provides it.

  async function schnorrSign(msg32, seckey32, aux32) {
    if (msg32.length !== 32 || seckey32.length !== 32) throw new Error('schnorr: bad lengths');
    if (bytesToBigInt(seckey32) >= ORDER_N || bytesToBigInt(seckey32) === 0n) throw new Error('schnorr: secret key out of range');
    const d0 = evenYScalar(bytesToBigInt(seckey32));
    const pub = bigIntToBytes(scalarMult(d0, G).x, 32);
    const aux = aux32 || globalThis.crypto.getRandomValues(new Uint8Array(32));
    const t = xorBytes(bigIntToBytes(d0, 32), await taggedHash('BIP0340/aux', aux));
    // The nonce binds t, the public key and the message.
    const k0 = mod(bytesToBigInt(await taggedHash('BIP0340/nonce', concatBytes(t, pub, msg32))), ORDER_N);
    const R = scalarMult(k0, G);
    if (!R) throw new Error('schnorr: nonce is the group identity');
    const k = R.y % 2n === 0n ? k0 : ORDER_N - k0;
    const e = mod(bytesToBigInt(await taggedHash('BIP0340/challenge', concatBytes(bigIntToBytes(R.x, 32), pub, msg32))), ORDER_N);
    return concatBytes(bigIntToBytes(R.x, 32), bigIntToBytes(mod(k + e * d0, ORDER_N), 32));
  }
  async function schnorrVerify(sig64, msg32, pubkey32) {
    if (sig64.length !== 64 || msg32.length !== 32 || pubkey32.length !== 32) return false;
    const r = bytesToBigInt(sig64.subarray(0, 32));
    const s = bytesToBigInt(sig64.subarray(32));
    if (r >= FIELD_P || s >= ORDER_N) return false;
    const Pt = liftX(pubkey32);
    if (!Pt) return false;
    const e = mod(bytesToBigInt(await taggedHash('BIP0340/challenge', concatBytes(sig64.subarray(0, 32), pubkey32, msg32))), ORDER_N);
    const R = pointAdd(scalarMult(s, G), scalarMult(ORDER_N - e, Pt));
    if (!R || R.y % 2n !== 0n || R.x !== r) return false;
    return true;
  }
  function xorBytes(a, b) {
    const out = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
    return out;
  }

  // ---- bech32 / bech32m and segwit addresses (BIP-173 / BIP-350) ---------------

  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const BECH32_CONST = 1n;
  const BECH32M_CONST = 0x2bc830a3n;
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

  function polymod(values) {
    let chk = 1n;
    for (const v of values) {
      const b = chk >> 25n;
      chk = ((chk & 0x1ffffffn) << 5n) ^ BigInt(v);
      for (let i = 0; i < 5; i++) if ((b >> BigInt(i)) & 1n) chk ^= BigInt(GEN[i]);
    }
    return chk;
  }
  function hrpExpand(hrp) {
    const out = [];
    for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
    out.push(0);
    for (const c of hrp) out.push(c.charCodeAt(0) & 31);
    return out;
  }
  function convertBits(data, from, to, pad) {
    let acc = 0, bits = 0;
    const out = [];
    const max = (1 << to) - 1;
    for (const v of data) {
      if (v < 0 || (v >> from) !== 0) return null;
      acc = (acc << from) | v;
      bits += from;
      while (bits >= to) { bits -= to; out.push((acc >> bits) & max); }
    }
    if (pad) {
      if (bits) out.push((acc << (to - bits)) & max);
    } else if (bits >= from || (acc << (to - bits)) & max) {
      return null;
    }
    return out;
  }
  function bech32Encode(hrp, data, kind) {
    const values = hrpExpand(hrp).concat(data);
    const konst = kind === 'bech32m' ? BECH32M_CONST : BECH32_CONST;
    const poly = polymod(values.concat([0, 0, 0, 0, 0, 0])) ^ konst;
    let out = hrp + '1';
    for (const v of data) out += CHARSET[v];
    for (let i = 0; i < 6; i++) out += CHARSET[Number((poly >> BigInt((5 - i) * 5)) & 31n)];
    return out;
  }
  // Decode either checksum flavor and report which — a segwit address is only
  // valid when the flavor matches its witness version, checked in segwitDecode.
  function bech32Decode(addr) {
    if (addr.length < 8 || addr.length > 90) return null;
    // Bech32 is case-legal only in one direction: all lower or all upper.
    const lower = addr.toLowerCase();
    if (addr !== lower && addr !== addr.toUpperCase()) return null;
    const sep = lower.lastIndexOf('1');
    if (sep < 1 || sep + 7 > lower.length) return null;
    const hrp = lower.slice(0, sep);
    for (const c of hrp) if (c.charCodeAt(0) < 33 || c.charCodeAt(0) > 126) return null;
    const data = [];
    for (const c of lower.slice(sep + 1)) {
      const v = CHARSET.indexOf(c);
      if (v === -1) return null;
      data.push(v);
    }
    const check = polymod(hrpExpand(hrp).concat(data));
    if (check === BECH32_CONST) return { hrp, data: data.slice(0, -6), kind: 'bech32' };
    if (check === BECH32M_CONST) return { hrp, data: data.slice(0, -6), kind: 'bech32m' };
    return null;
  }
  function segwitAddressEncode(hrp, version, program) {
    const data = convertBits(program, 8, 5, true);
    if (!data) return null;
    return bech32Encode(hrp, [version].concat(data), version === 0 ? 'bech32' : 'bech32m');
  }
  // Mainnet addresses only; the rescue sweep refuses to touch anything else.
  function segwitAddressDecode(addr) {
    const d = bech32Decode(String(addr));
    if (!d || d.hrp !== 'bc') return null;
    const version = d.data[0];
    if (version === undefined || version > 16) return null;
    const program = convertBits(d.data.slice(1), 5, 8, false);
    if (!program || program.length < 2 || program.length > 40) return null;
    if (version === 0 && program.length !== 20 && program.length !== 32) return null;
    if (version === 0 && d.kind !== 'bech32') return null;
    if (version !== 0 && d.kind !== 'bech32m') return null;
    return { version, program };
  }
  function p2trScript(xonly32) {
    // OP_1 <32-byte key> — a P2TR output script.
    return concatBytes(new Uint8Array([0x51, 0x20]), xonly32);
  }

  // ---- Taproot derivation (BIP-341 / BIP-86) -----------------------------------
  //
  // Two addresses hang off a Nostr key: the "tweaked" BIP-86-style one, whose
  // output key is Q = P + t·G with t = taggedHash('TapTweak', P) and no script
  // tree, and the "untweaked" one, whose output key is the raw Nostr pubkey
  // itself. Spending either is a key-path spend, and a node checks a key-path
  // signature against the output key the spent script carries — it applies
  // no tweak of its own (BIP-341: Verify(q, sighash, sig), q the witness
  // program). So each form signs with the scalar of its own output key.

  async function tapTweakInt(xonly32) {
    const t = bytesToBigInt(await taggedHash('TapTweak', xonly32));
    if (t >= ORDER_N) throw new Error('taproot: tweak out of range');
    return t;
  }
  // Panel-side: everything here is public. The x-only key in, addresses out.
  async function deriveAddresses(pubkeyHex) {
    const xonly = hexToBytes(pubkeyHex);
    if (!xonly || xonly.length !== 32) throw new Error('taproot: not an x-only pubkey');
    const P = liftX(xonly);
    if (!P) throw new Error('taproot: pubkey is not a curve point');
    const t = await tapTweakInt(xonly);
    const Q = pointAdd(P, scalarMult(t, G));
    if (!Q) throw new Error('taproot: tweaked key is the group identity');
    return {
      tweaked: segwitAddressEncode('bc', 1, bigIntToBytes(Q.x, 32)),
      untweaked: segwitAddressEncode('bc', 1, xonly),
    };
  }
  function tweakedPubkeyFrom(pubkeyHex, t) {
    const P = liftX(hexToBytes(pubkeyHex));
    const Q = pointAdd(P, scalarMult(t, G));
    return bigIntToBytes(Q.x, 32);
  }
  // Worker-side: from the account's private key, the signing scalars for both
  // forms — each the scalar of the output key its own address carries.
  //   untweaked: the address carries P, so p0 signs it — the secret
  //              straightened onto P's even-Y point, the point lift_x(P) names.
  //   tweaked:   the address carries Q = P + t·G, so p0 + t signs it — the
  //              BIP-341 vector's tweakedPrivkey. BIP-340's sign() straightens
  //              Q's own Y parity internally.
  // The even-Y step before adding t is the load-bearing one: t added to a raw
  // secret whose point has an odd Y signs for -P + t·G, which nothing commits
  // to. And no second tweak, anywhere: a node never adds one when it verifies.
  async function signingScalars(seckey32, pubkeyHex) {
    const p0 = evenYScalar(bytesToBigInt(seckey32));
    if (p0 === null) throw new Error('taproot: secret key out of range');
    const xonly = hexToBytes(pubkeyHex);
    if (!xonly || xonly.length !== 32 || scalarMult(p0, G).x !== bytesToBigInt(xonly)) {
      throw new Error('taproot: key does not match the account pubkey');
    }
    const t = await tapTweakInt(xonly);
    return { untweaked: p0, tweaked: mod(p0 + t, ORDER_N) };
  }
  // Sign SIGHASH_ALL messages for a sweep's inputs. Each entry names the form
  // its input was funded to ('tweaked' | 'untweaked'); the worker derives the
  // matching scalar itself and never trusts the panel to supply one.
  async function signSweepInputs(seckey32, pubkeyHex, inputs) {
    const scalars = await signingScalars(seckey32, pubkeyHex);
    const sigs = [];
    for (const input of inputs) {
      if (!input || typeof input.hash !== 'string' || input.form !== 'tweaked' && input.form !== 'untweaked') {
        throw new Error('taproot: malformed signing request');
      }
      const hash = hexToBytes(input.hash);
      if (!hash || hash.length !== 32) throw new Error('taproot: sighash is not 32 bytes');
      sigs.push(bytesToHex(await schnorrSign(hash, bigIntToBytes(scalars[input.form], 32))));
    }
    return sigs;
  }

  // ---- transaction serialization, size, txid -----------------------------------

  function writeVarint(n, out) {
    if (n < 253) out.push(n);
    else if (n <= 0xffff) out.push(253, n & 255, (n >> 8) & 255);
    else if (n <= 0xffffffff) out.push(254, n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255);
    else out.push(255, n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255, 0, 0, 0, 0);
  }
  // tx: { version, inputs: [{txidHex, vout, sequence}], outputs: [{valueSats, script}], nLockTime }
  // witness: per input, an array of stack items (hex), or null to serialize the
  // legacy (stripped) form — which is also what the txid is taken over.
  //
  // BIP-144 layout: version, marker+flag, inputs, outputs, the WITNESSES, then
  // the locktime last. The witnesses carry no count of their own — one per
  // input, in input order, the input count already says how many — so a stray
  // count, or a locktime ahead of them, makes a parser read the locktime's
  // first byte as an empty witness: Core's "TX decode failed".
  function serializeTx(tx, witness) {
    const out = [];
    Array.prototype.push.apply(out, u32le(tx.version));
    const hasWitness = !!witness;
    if (hasWitness && witness.length !== tx.inputs.length) throw new Error('tx: one witness per input');
    if (hasWitness) out.push(0x00, 0x01); // segwit marker + flag
    writeVarint(tx.inputs.length, out);
    for (const input of tx.inputs) {
      Array.prototype.push.apply(out, hexToBytes(input.txidHex));
      Array.prototype.push.apply(out, u32le(input.vout));
      writeVarint(0, out); // empty scriptSig
      Array.prototype.push.apply(out, u32le(input.sequence == null ? 0xfffffffd : input.sequence));
    }
    writeVarint(tx.outputs.length, out);
    for (const output of tx.outputs) {
      Array.prototype.push.apply(out, u64le(output.valueSats));
      writeVarint(output.script.length, out);
      Array.prototype.push.apply(out, output.script);
    }
    if (hasWitness) {
      for (const items of witness) {
        writeVarint(items.length, out);
        for (const item of items) {
          const bytes = hexToBytes(item);
          writeVarint(bytes.length, out);
          Array.prototype.push.apply(out, bytes);
        }
      }
    }
    Array.prototype.push.apply(out, u32le(tx.nLockTime || 0));
    return Uint8Array.from(out);
  }
  function txWeight(tx, witness) {
    const stripped = serializeTx(tx, null);
    const total = witness ? serializeTx(tx, witness) : stripped;
    return { strippedSize: stripped.length, totalSize: total.length, weight: stripped.length * 3 + total.length };
  }
  const vsizeOf = (tx, witness) => Math.ceil(txWeight(tx, witness).weight / 4);
  async function txidOf(tx) {
    const id = await sha256(await sha256(serializeTx(tx, null)));
    return bytesToHex(id.slice().reverse());
  }

  // ---- the BIP-341 signature message (SIGHASH_ALL, key-path, no annex) ---------

  // spentOutputs: one {valueSats, script} per input, in input order.
  async function sighashMessage(tx, inputIndex, spentOutputs) {
    let prevouts = new Uint8Array(0), amounts = new Uint8Array(0);
    let scripts = new Uint8Array(0), sequences = new Uint8Array(0);
    for (let i = 0; i < tx.inputs.length; i++) {
      prevouts = concatBytes(prevouts, hexToBytes(tx.inputs[i].txidHex), u32le(tx.inputs[i].vout));
      amounts = concatBytes(amounts, u64le(spentOutputs[i].valueSats));
      scripts = concatBytes(scripts, varintLenBytes(spentOutputs[i].script));
      sequences = concatBytes(sequences, u32le(tx.inputs[i].sequence == null ? 0xfffffffd : tx.inputs[i].sequence));
    }
    let outputs = new Uint8Array(0);
    for (const o of tx.outputs) outputs = concatBytes(outputs, u64le(o.valueSats), varintLenBytes(o.script));
    // The epoch byte leads, then hash type and the transaction summary.
    return concatBytes(
      new Uint8Array([0x00]), // epoch
      new Uint8Array([0x01]), // hash type: SIGHASH_ALL
      u32le(tx.version),
      u32le(tx.nLockTime || 0),
      await sha256(prevouts),
      await sha256(amounts),
      await sha256(scripts),
      await sha256(sequences),
      await sha256(outputs),
      new Uint8Array([0x00]), // spend type: no annex, no script
      u32le(inputIndex)
    );
  }
  async function sighashAll(tx, inputIndex, spentOutputs) {
    return taggedHash('TapSighash', await sighashMessage(tx, inputIndex, spentOutputs));
  }
  function varintLenBytes(bytes) {
    const out = [];
    writeVarint(bytes.length, out);
    return concatBytes(new Uint8Array(out), bytes);
  }

  // ---- planning a sweep ---------------------------------------------------------

  // utxos: confirmed outputs from the explorer, each {txidHex, vout, valueSats,
  // form}. Sorted by outpoint so the same coin set always builds the same tx.
  // No change output: the single destination takes everything not spent on fee.
  // The explorer's UTXO list mapped to what planSweep consumes: confirmed
  // outputs only, values as BigInt, form-tagged. The txid comes in display
  // order — the string everyone quotes — but an outpoint on the wire carries
  // those bytes REVERSED, so it is flipped here once and everything
  // downstream (serialization, the prevouts hash) speaks wire order.
  function explorerUtxos(list, form) {
    return (Array.isArray(list) ? list : [])
      .filter((u) => u && u.status && u.status.confirmed)
      .map((u) => {
        const wire = hexToBytes(String(u.txid)).slice().reverse();
        return { txidHex: bytesToHex(wire), vout: u.vout, valueSats: BigInt(u.value), form };
      });
  }

  function planSweep(utxos, destScript, feeRateSatVb) {
    if (!utxos.length) throw new Error('sweep: nothing to spend');
    if (utxos.length > 64) throw new Error('sweep: too many outputs for one transaction');
    if (!destScript || destScript.length < 2) throw new Error('sweep: destination script missing');
    const sorted = utxos.slice().sort((a, b) =>
      a.txidHex === b.txidHex ? a.vout - b.vout : (a.txidHex < b.txidHex ? -1 : 1));
    const inValue = sorted.reduce((s, u) => s + BigInt(u.valueSats), 0n);
    const tx = {
      version: 2,
      inputs: sorted.map((u) => ({ txidHex: u.txidHex, vout: u.vout, sequence: 0xfffffffd })), // RBF on: a rescue can be bumped
      outputs: [{ valueSats: 0n, script: destScript }],
      nLockTime: 0,
    };
    // Size the transaction against the witness it will eventually carry: one
    // 65-byte key-path signature per input (64 sig bytes + the SIGHASH_ALL type).
    const dummySig = '00'.repeat(64) + '01';
    const vsize = vsizeOf(tx, sorted.map(() => [dummySig]));
    const fee = BigInt(Math.ceil(Number(vsize) * feeRateSatVb));
    const outValue = inValue - fee;
    if (outValue < 330n) throw new Error('sweep: balance does not cover the fee');
    tx.outputs[0].valueSats = outValue;
    return { tx, vsize, feeSats: fee, outValueSats: outValue, inValueSats: inValue, plan: sorted };
  }
  // The witness a signed sweep carries: one 65-byte item per input — a BIP-340
  // signature followed by the SIGHASH_ALL type byte.
  function sweepWitness(sigsHex) {
    return sigsHex.map((s) => [s + '01']);
  }

  // ---- the panel→worker signing request ------------------------------------------
  //
  // The panel sends the unsigned transaction and, per input, the coin's value
  // and form — JSON-safe, since runtime messaging carries neither BigInt nor
  // Uint8Array — and deliberately no hash and no script. The worker derives
  // the spent scripts from the account's own pubkey and computes every sighash
  // itself (signSweepTx), so it never signs bytes a caller chose. That matters
  // because the untweaked form signs under the Nostr key itself: a worker that
  // signed any 32 bytes on request would sign any Nostr event id, around every
  // check the event path makes.
  function sweepRequest(plan) {
    return {
      version: plan.tx.version,
      nLockTime: plan.tx.nLockTime || 0,
      inputs: plan.tx.inputs.map((input, i) => ({
        txidHex: input.txidHex,
        vout: input.vout,
        sequence: input.sequence,
        valueSats: String(plan.plan[i].valueSats),
        form: plan.plan[i].form,
      })),
      outputs: plan.tx.outputs.map((o) => ({ valueSats: String(o.valueSats), scriptHex: bytesToHex(o.script) })),
    };
  }

  // Worker-side: sign a sweep from its transaction, never from a hash. Whatever
  // asks, the most it can obtain is key-path signatures for a single-output
  // transaction spending this account's own two Taproot outputs.
  async function signSweepTx(seckey32, pubkeyHex, req) {
    const bad = () => new Error('taproot: malformed sweep request');
    const u32 = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
    const sats = (s) => typeof s === 'string' && /^[0-9]{1,16}$/.test(s) && BigInt(s) <= 2100000000000000n;
    if (!req || typeof req !== 'object' || !Array.isArray(req.inputs) || !Array.isArray(req.outputs)) throw bad();
    if (!req.inputs.length || req.inputs.length > 64 || req.outputs.length !== 1) throw bad();
    if (!u32(req.version) || !u32(req.nLockTime)) throw bad();
    const xonly = hexToBytes(pubkeyHex);
    if (!xonly || xonly.length !== 32) throw bad();
    const scripts = {
      tweaked: p2trScript(tweakedPubkeyFrom(pubkeyHex, await tapTweakInt(xonly))),
      untweaked: p2trScript(xonly),
    };
    const tx = { version: req.version, nLockTime: req.nLockTime, inputs: [], outputs: [] };
    const spent = [];
    let inValue = 0n;
    for (const i of req.inputs) {
      if (!i || typeof i !== 'object' || (i.form !== 'tweaked' && i.form !== 'untweaked')) throw bad();
      if (typeof i.txidHex !== 'string' || !/^[0-9a-f]{64}$/.test(i.txidHex) || !u32(i.vout) || !u32(i.sequence) || !sats(i.valueSats)) throw bad();
      tx.inputs.push({ txidHex: i.txidHex, vout: i.vout, sequence: i.sequence });
      spent.push({ valueSats: BigInt(i.valueSats), script: scripts[i.form] });
      inValue += BigInt(i.valueSats);
    }
    const o = req.outputs[0];
    const script = o && typeof o.scriptHex === 'string' ? hexToBytes(o.scriptHex) : null;
    // A witness program, the only kind destScriptFor builds: OP_0 or OP_1..16,
    // then one push of the whole 2..40-byte program.
    if (!script || script.length < 4 || script.length > 42 || script[1] !== script.length - 2) throw bad();
    if (script[0] !== 0x00 && (script[0] < 0x51 || script[0] > 0x60)) throw bad();
    if (!sats(o.valueSats) || BigInt(o.valueSats) > inValue) throw bad();
    tx.outputs.push({ valueSats: BigInt(o.valueSats), script });
    const inputs = [];
    for (let k = 0; k < tx.inputs.length; k++) {
      inputs.push({ hash: bytesToHex(await sighashAll(tx, k, spent)), form: req.inputs[k].form });
    }
    return signSweepInputs(seckey32, pubkeyHex, inputs);
  }

  // ---- BIP-21 and the scan -------------------------------------------------------

  // What a receive QR or a pasted string may hand us. Sweep-all ignores amounts,
  // so only the address matters; Lightning codes and off-mainnet addresses are
  // named rejections the card can show as-is.
  //
  // NATIVE SEGWIT ONLY (bc1q…, bc1p…), BY CHOICE. Legacy 1… and 3… addresses are
  // refused with their own sentence. Nothing in Bitcoin forces this; it keeps the
  // money path small. This module implements one address format (bech32/bech32m),
  // each piece pinned to the published test vectors, and the worker's signer refuses
  // any output that is not a witness program (see the check in the sweep signer
  // above), the guard that closed a message which would have signed arbitrary bytes.
  // Accepting 3… (exchanges still hand those out) and 1… means Base58Check decoding,
  // the P2SH and P2PKH output scripts, and widening that guard to exactly those two
  // shapes, each with tests against known transactions. Most wallets give a bc1
  // address by default, so it waits with the other sweep follow-ups (dust-aware
  // input selection, a fee ceiling).
  function readDestination(raw) {
    let text = String(raw || '').trim();
    if (!text) return { error: 'empty' };
    if (/^lightning:/i.test(text) || /^(lnbc|lntb|lnsb|lnurl)/i.test(text) || /^lnurl/i.test(text.replace(/^nostr:/i, ''))) {
      return { error: 'lightning' };
    }
    if (/^bitcoin:/i.test(text)) {
      text = text.slice('bitcoin:'.length).split('?')[0];
    }
    if (/[^\w]/.test(text.replace(/[a-zA-Z0-9]/g, ''))) return { error: 'invalid' };
    const decoded = segwitAddressDecode(text);
    if (!decoded) {
      // Off-mainnet segwit addresses carry the tb/bcrt human-readable part.
      if (/^(tb|bcrt)1[a-z0-9]+$/i.test(text)) return { error: 'testnet' };
      // Base58 (legacy 1…/3…) addresses fail the bech32 charset check but
      // deserve their own sentence in the card.
      if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(text)) return { error: 'legacy' };
      return { error: 'invalid' };
    }
    return { address: text, version: decoded.version };
  }
  // The destination's output script. Segwit scripts are OP_<version>
  // OP_PUSH<n> <program>: version 0 uses the 0x00 opcode and pushes of 20 or
  // 32; version 1 (P2TR) uses opcode 0x51.
  function destScriptFor(address) {
    const d = segwitAddressDecode(address);
    if (!d) throw new Error('sweep: destination is not a mainnet segwit address');
    const verByte = d.version === 0 ? 0x00 : 0x50 + d.version;
    return concatBytes(new Uint8Array([verByte, d.program.length]), Uint8Array.from(d.program));
  }

  root.SidecarBitcoin = {
    // bytes
    bytesToHex, hexToBytes, concatBytes, bytesToBigInt, bigIntToBytes,
    // crypto
    sha256, taggedHash, schnorrSign, schnorrVerify,
    // curve internals — exposed for the test suite's BIP-340/341 vectors
    scalarMult, liftX, evenYScalar,
    // addresses and keys
    segwitAddressEncode, segwitAddressDecode, p2trScript, destScriptFor,
    tapTweakInt, deriveAddresses, signingScalars, signSweepInputs, tweakedPubkeyFrom,
    // transactions
    serializeTx, txWeight, vsizeOf, txidOf, sighashMessage, sighashAll, planSweep, sweepWitness, explorerUtxos,
    sweepRequest, signSweepTx,
    readDestination,
  };
})(typeof self !== 'undefined' ? self : this);
