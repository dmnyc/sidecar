'use strict';

// The rescue sweep's Bitcoin math, pinned against the published vectors.
//
// bitcoin.js moves money, so "it looks right" is not a bar it may clear on its
// own: every construction here is checked against an EXTERNAL anchor — the
// BIP-340 signing vectors, the BIP-350 segwit address vectors, and the BIP-341
// wallet test vectors (tweak, tweaked private key, signature message, sighash,
// and a real consensus signature verified under the real tweaked key). The one
// thing the vectors cannot give is the exact sweep transaction, since they
// predate the feature; the final serialization is checked structurally (sizes,
// txid stability, round trip) and the sweep path end-to-end by signing a
// vector sighash and verifying it under the key a node would derive.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../bitcoin.js').SidecarBitcoin;

const h = (s) => B.hexToBytes(s);

// ---- BIP-340: deterministic signing, exact ---------------------------------

const BIP340 = [
  ['0000000000000000000000000000000000000000000000000000000000000003',
   '0000000000000000000000000000000000000000000000000000000000000000',
   '0000000000000000000000000000000000000000000000000000000000000000',
   'e907831f80848d1069a5371b402410364bdf1c5f8307b0084c55f1ce2dca821525f66a4a85ea8b71e482a74f382d2ce5ebeee8fdb2172f477df4900d310536c0',
   'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9'],
  ['b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef',
   '0000000000000000000000000000000000000000000000000000000000000001',
   '243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89',
   '6896bd60eeae296db48a229ff71dfe071bde413e6d43f917dc8dcf8c78de33418906d11ac976abccb20b091292bff4ea897efcb639ea871cfa95f6de339e4b0a',
   'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659'],
  ['c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9',
   'c87aa53824b4d7ae2eb035a2b5bbbccc080e76cdc6d1692c4b0b62d798e6d906',
   '7e2d58d8b3bcdf1abadec7829054f90dda9805aab56c77333024b9d0a508b75c',
   '5831aaeed7b44bb74e5eab94ba9d4294c49bcf2a60728d8b4c200f50dd313c1bab745879a5ad954a72c45a91c3a51d3c7adea98d82f8481e0e1e03674a6f3fb7',
   'dd308afec5777e13121fa72b9cc1b7cc0139715309b086c960e18fd969774eb8'],
];

test('schnorr signs exactly as BIP-340 vector 0-2', async () => {
  for (const [sk, aux, msg, sig] of BIP340) {
    assert.equal(B.bytesToHex(await B.schnorrSign(h(msg), h(sk), h(aux))), sig);
  }
});

test('schnorr verifies the vector signatures and rejects tampering', async () => {
  for (const [, , msg, sig, pub] of BIP340) {
    assert.equal(await B.schnorrVerify(h(sig), h(msg), h(pub)), true);
    const bad = h(sig);
    bad[0] ^= 1;
    assert.equal(await B.schnorrVerify(bad, h(msg), h(pub)), false);
    const badMsg = h(msg);
    badMsg[31] ^= 0x80;
    assert.equal(await B.schnorrVerify(h(sig), badMsg, h(pub)), false);
  }
});

// ---- BIP-350: segwit addresses, encode and decode ---------------------------

test('segwit addresses round trip the BIP-350 vectors', () => {
  // [address, scriptPubKey] — version and program read from the script.
  const vectors = [
    ['BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', '0014751e76e8199196d454941c45d1b3a323f1433bd6'],
    ['bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'],
  ];
  for (const [addr, script] of vectors) {
    const decoded = B.segwitAddressDecode(addr);
    assert.ok(decoded, addr + ' should decode');
    const verByte = decoded.version === 0 ? 0x00 : 0x50 + decoded.version;
    assert.equal(B.bytesToHex(B.concatBytes(new Uint8Array([verByte, decoded.program.length]), Uint8Array.from(decoded.program))), script);
    const hrp = addr.toLowerCase().slice(0, 2);
    assert.equal(B.segwitAddressEncode(hrp, decoded.version, Uint8Array.from(decoded.program)), addr.toLowerCase());
  }
  // The testnet vector from the same list decodes nowhere: a rescue sweep is
  // mainnet or it is nothing.
  assert.equal(B.segwitAddressDecode('tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7'), null);
});

test('the BIP-350 invalid addresses stay invalid', () => {
  for (const addr of [
    'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd', // bech32 checksum on a v1 address
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh', // bech32m checksum on a v0 address
    'BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P', // v0 program of 17 bytes
    'bc1pw5dgrnzv', // program of 1 byte
    'bc1gmk9yu', // empty data section
    'tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq47zagq', // mixed case
    'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v07qwwzcrf', // nonzero padding
  ]) {
    assert.equal(B.segwitAddressDecode(addr), null, addr + ' must not decode');
  }
});

// ---- BIP-341: the tweak, the tweaked key, the address ------------------------

const VEC_INTERNAL = 'd6889cb081036e0faefa3a35157ad71086b123b2b144b649798b494c300a961d';
const VEC_INTERNAL_PRIV = '6b973d88838f27366ed61c9ad6367663045cb456e28335c109e30717ae0c6baa';
const VEC_TWEAK = 'b86e7be8f39bab32a6f2c0443abbc210f0edac0e2c53d501b36b64437d9c6c70';
const VEC_TWEAKED_PUB = '53a1f6e454df1aa2776a2814a721372d6258050de330b3c6d10ee8f4e0dda343';
const VEC_TWEAKED_PRIV = '2405b971772ad26915c8dcdf10f238753a9b837e5f8e6a86fd7c0cce5b7296d9';
const VEC_TWEAKED_ADDR = 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5';

test('the TapTweak derivation matches the BIP-341 wallet vector', async () => {
  assert.equal(await B.tapTweakInt(h(VEC_INTERNAL)), B.bytesToBigInt(h(VEC_TWEAK)));
  assert.equal(B.bytesToHex(B.tweakedPubkeyFrom(VEC_INTERNAL, await B.tapTweakInt(h(VEC_INTERNAL)))), VEC_TWEAKED_PUB);
  const addrs = await B.deriveAddresses(VEC_INTERNAL);
  assert.equal(addrs.tweaked, VEC_TWEAKED_ADDR);
  assert.equal(B.segwitAddressDecode(addrs.tweaked).version, 1);
});

// keyPathSpending[0].inputSpending[0]: the vector's one input with no script
// tree — exactly the tweaked address's shape — and its consensus witness
// (SIGHASH_SINGLE, signed with all-zero aux), which re-signs byte for byte.
const VEC0_SIGHASH = '2514a6272f85cfa0f45eb907fcb0d121b808ed37c6ea160a5a9046ed5526d555';
const VEC0_WITNESS = 'ed7c1647cb97379e76892be0cacff57ec4a7102aa24296ca39af7541246d8ff14d38958d4cc1e2e478e4d4a764bbfd835b16d4e314b72937b29833060b87276c03';
const G = { x: 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n, y: 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n };

test('each form signs with its own output key: tweakedPrivkey for tweaked, the key itself for untweaked', async () => {
  const scalars = await B.signingScalars(h(VEC_INTERNAL_PRIV), VEC_INTERNAL);
  // The vector's tweakedPrivkey spends the tweaked output key (53a1…) …
  assert.equal(B.bytesToHex(B.bigIntToBytes(scalars.tweaked, 32)), VEC_TWEAKED_PRIV);
  // … and the untweaked address carries the internal key itself.
  assert.equal(B.bytesToHex(B.bigIntToBytes(B.scalarMult(scalars.untweaked, G).x, 32)), VEC_INTERNAL);
});

test('the tweaked form re-signs the BIP-341 consensus witness byte for byte', async () => {
  const scalars = await B.signingScalars(h(VEC_INTERNAL_PRIV), VEC_INTERNAL);
  const sig = await B.schnorrSign(h(VEC0_SIGHASH), B.bigIntToBytes(scalars.tweaked, 32), new Uint8Array(32));
  assert.equal(B.bytesToHex(sig) + '03', VEC0_WITNESS); // 03: that input's SIGHASH_SINGLE byte
});

// ---- BIP-341: the signature message and sighash, exact -----------------------

// keyPathSpending[0].given.rawUnsignedTx, parsed here (the module serializes,
// it does not parse) so the sighash is computed over the vector's own tx.
const RAW_TX = '02000000097de20cbff686da83a54981d2b9bab3586f4ca7e48f57f5b55963115f3b334e9c010000000000000000d7b7cab57b1393ace2d064f4d4a2cb8af6def61273e127517d44759b6dafdd990000000000fffffffff8e1f583384333689228c5d28eac13366be082dc57441760d957275419a418420000000000fffffffff0689180aa63b30cb162a73c6d2a38b7eeda2a83ece74310fda0843ad604853b0100000000feffffffaa5202bdf6d8ccd2ee0f0202afbbb7461d9264a25e5bfd3c5a52ee1239e0ba6c0000000000feffffff956149bdc66faa968eb2be2d2faa29718acbfe3941215893a2a3446d32acd050000000000000000000e664b9773b88c09c32cb70a2a3e4da0ced63b7ba3b22f848531bbb1d5d5f4c94010000000000000000e9aa6b8e6c9de67619e6a3924ae25696bb7b694bb677a632a74ef7eadfd4eabf0000000000ffffffffa778eb6a263dc090464cd125c466b5a99667720b1c110468831d058aa1b82af10100000000ffffffff0200ca9a3b000000001976a91406afd46bcdfd22ef94ac122aa11f241244a37ecc88ac807840cb0000000020ac9a87f5594be208f8532db38cff670c450ed2fea8fcdefcc9a663f78bab962b0065cd1d';
const SPENT_SCRIPTS = [
  '512053a1f6e454df1aa2776a2814a721372d6258050de330b3c6d10ee8f4e0dda343',
  '5120147c9c57132f6e7ecddba9800bb0c4449251c92a1e60371ee77557b6620f3ea3',
  '76a914751e76e8199196d454941c45d1b3a323f1433bd688ac',
  '5120e4d810fd50586274face62b8a807eb9719cef49c04177cc6b76a9a4251d5450e',
  '512091b64d5324723a985170e4dc5a0f84c041804f2cd12660fa5dec09fc21783605',
  '00147dd65592d0ab2fe0d0257d571abf032cd9db93dc',
  '512075169f4001aa68f15bbed28b218df1d0a62cbbcf1188c6665110c293c907b831',
  '5120712447206d7a5238acc7ff53fbe94a3b64539ad291c7cdbc490b7577e4b17df5',
  '512077e30a5522dd9f894c3f8b8bd4c4b2cf82ca7da8a3ea6a239655c39c050ab220',
];
const SPENT_VALUES = [420000000n, 462000000n, 294000000n, 504000000n, 630000000n, 378000000n, 672000000n, 546000000n, 588000000n];

function parseRawTx(hex) {
  const b = h(hex);
  let at = 0;
  const rd = (n) => { const s = b.subarray(at, at + n); at += n; return s; };
  const u32 = (s) => (s[0] | (s[1] << 8) | (s[2] << 16) | (s[3] << 24)) >>> 0;
  const vri = () => { const n = b[at++]; if (n < 253) return n; if (n === 253) { const s = rd(2); return s[0] | (s[1] << 8); } throw new Error('vector uses a wide varint'); };
  const version = u32(rd(4));
  const nIn = vri();
  const inputs = [];
  for (let i = 0; i < nIn; i++) {
    const txidHex = B.bytesToHex(rd(32));
    const vout = u32(rd(4));
    rd(vri()); // scriptSig — the module never builds one
    inputs.push({ txidHex, vout, sequence: u32(rd(4)) });
  }
  const nOut = vri();
  const outputs = [];
  for (let i = 0; i < nOut; i++) {
    outputs.push({ valueSats: B.bytesToBigInt(rd(8).slice().reverse()), script: rd(vri()) });
  }
  return { version, inputs, outputs, nLockTime: u32(rd(4)) };
}

function vectorTx() {
  return parseRawTx(RAW_TX);
}
function vectorSpent() {
  return SPENT_SCRIPTS.map((s, i) => ({ valueSats: SPENT_VALUES[i], script: h(s) }));
}

test('the signature message is byte-exact against the BIP-341 vector', async () => {
  const msg = await B.sighashMessage(vectorTx(), 3, vectorSpent());
  assert.equal(B.bytesToHex(msg),
    '0001020000000065cd1de3b33bb4ef3a52ad1fffb555c0d82828eb22737036eaeb02a235d82b909c4c3f' +
    '58a6964a4f5f8f0b642ded0a8a553be7622a719da71d1f5befcefcdee8e0fde6' +
    '23ad0f61ad2bca5ba6a7693f50fce988e17c3780bf2b1e720cfbb38fbdd52e21' +
    '18959c7221ab5ce9e26c3cd67b22c24f8baa54bac281d8e6b05e400e6c3a957e' +
    'a2e6dab7c1f0dcd297c8d61647fd17d821541ea69c3cc37dcbad7f90d4eb4bc5' +
    '0003000000');
});

test('the sighash is exact, and the vector signature verifies under it', async () => {
  const sh = await B.sighashAll(vectorTx(), 3, vectorSpent());
  assert.equal(B.bytesToHex(sh), 'bf013ea93474aa67815b1b6cc441d23b64fa310911d991e713cd34c7f5d46669');
  // keyPathSpending[0].inputSpending[2].expected.witness, the SIGHASH_ALL
  // input, verified against that input's tweaked key — a real consensus
  // signature over a sighash this module computed. The witness element is
  // sig || hash-type, so the signature is its first 64 bytes.
  const witnessSig = 'ff45f742a876139946a149ab4d9185574b98dc919d2eb6754f8abaa59d18b025637a3aa043b91817739554f4ed2026cf8022dbd83e351ce1fabc272841d2510a01';
  assert.equal(await B.schnorrVerify(h(witnessSig.slice(0, 128)), sh, h('e4d810fd50586274face62b8a807eb9719cef49c04177cc6b76a9a4251d5450e')), true);
});

test('the sweep signing path signs under the key a node reads from the spent script', async () => {
  // A node checks a key-path signature against the spent script's witness
  // program and nothing else. The tweaked form spends SPENT_SCRIPTS[0], so it
  // must verify under that script's key; the untweaked form's script carries
  // the raw internal key, so it must verify under that.
  const sh = await B.sighashAll(vectorTx(), 0, vectorSpent());
  const sigs = await B.signSweepInputs(h(VEC_INTERNAL_PRIV), VEC_INTERNAL, [
    { hash: B.bytesToHex(sh), form: 'tweaked' },
    { hash: B.bytesToHex(sh), form: 'untweaked' },
  ]);
  assert.equal(SPENT_SCRIPTS[0], '5120' + VEC_TWEAKED_PUB);
  assert.equal(await B.schnorrVerify(h(sigs[0]), sh, h(VEC_TWEAKED_PUB)), true);
  assert.equal(await B.schnorrVerify(h(sigs[1]), sh, h(VEC_INTERNAL)), true);
  // The first build applied one tweak too many to each form — Q + TapTweak(Q)
  // for tweaked, the tweaked key for untweaked — so no signature ever matched
  // its script. Neither key may verify again.
  const t2 = await B.tapTweakInt(h(VEC_TWEAKED_PUB));
  assert.equal(await B.schnorrVerify(h(sigs[0]), sh, B.tweakedPubkeyFrom(VEC_TWEAKED_PUB, t2)), false);
  assert.equal(await B.schnorrVerify(h(sigs[1]), sh, h(VEC_TWEAKED_PUB)), false);
});

test('every key can spend both addresses the card shows it, in all four Y parities', async () => {
  // Bind signing to deriveAddresses: whatever the card displays, the worker
  // must be able to spend, verified under that address's own witness program.
  // Keys 1, 2, 6 and 11 cover every parity pairing of the account key P and
  // the tweaked key Q, and the cover is asserted so an edit to this list
  // cannot quietly drop the odd-Y cases.
  const cover = new Set();
  for (const k of [1n, 2n, 6n, 11n]) {
    const P = B.scalarMult(k, G);
    const pub = B.bytesToHex(B.bigIntToBytes(P.x, 32));
    const addrs = await B.deriveAddresses(pub);
    const msg = await B.sha256(new TextEncoder().encode('sweep ' + k));
    const sigs = await B.signSweepInputs(B.bigIntToBytes(k, 32), pub, [
      { hash: B.bytesToHex(msg), form: 'tweaked' },
      { hash: B.bytesToHex(msg), form: 'untweaked' },
    ]);
    const progT = Uint8Array.from(B.segwitAddressDecode(addrs.tweaked).program);
    const progU = Uint8Array.from(B.segwitAddressDecode(addrs.untweaked).program);
    assert.equal(await B.schnorrVerify(h(sigs[0]), msg, progT), true, 'tweaked, key ' + k);
    assert.equal(await B.schnorrVerify(h(sigs[1]), msg, progU), true, 'untweaked, key ' + k);
    const Q = B.scalarMult((await B.signingScalars(B.bigIntToBytes(k, 32), pub)).tweaked, G);
    assert.equal(Q.x, B.bytesToBigInt(progT)); // the tweaked scalar's point IS the address's key
    cover.add((P.y % 2n ? 'P-odd' : 'P-even') + '/' + (Q.y % 2n ? 'Q-odd' : 'Q-even'));
  }
  assert.equal(cover.size, 4, 'parity cover: ' + [...cover].join(', '));
});

test('a mixed sweep built the way the card builds it carries only valid signatures', async () => {
  // The panel's whole path, minus the network: plan two inputs of different
  // forms, hash each against the scripts actually being spent (the card's
  // spendScripts), sign, then check every witness item under its own input's
  // script key and that each is 64 signature bytes plus SIGHASH_ALL.
  const k = 6n; // P has an odd Y: the case the even-Y straightening exists for
  const pub = B.bytesToHex(B.bigIntToBytes(B.scalarMult(k, G).x, 32));
  const addrs = await B.deriveAddresses(pub);
  const spendScripts = {
    tweaked: B.p2trScript(B.tweakedPubkeyFrom(pub, await B.tapTweakInt(h(pub)))),
    untweaked: B.p2trScript(h(pub)),
  };
  assert.deepEqual(Array.from(spendScripts.tweaked.subarray(2)), B.segwitAddressDecode(addrs.tweaked).program);
  assert.deepEqual(Array.from(spendScripts.untweaked.subarray(2)), B.segwitAddressDecode(addrs.untweaked).program);
  const plan = B.planSweep([
    { txidHex: 'cd'.repeat(32), vout: 0, valueSats: 40000n, form: 'untweaked' },
    { txidHex: 'ab'.repeat(32), vout: 3, valueSats: 25000n, form: 'tweaked' },
  ], B.destScriptFor('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'), 2);
  const spent = plan.plan.map((u) => ({ valueSats: u.valueSats, script: spendScripts[u.form] }));
  const inputs = [];
  for (let i = 0; i < plan.tx.inputs.length; i++) {
    inputs.push({ hash: B.bytesToHex(await B.sighashAll(plan.tx, i, spent)), form: plan.plan[i].form });
  }
  const sigs = await B.signSweepInputs(B.bigIntToBytes(k, 32), pub, inputs);
  const witness = B.sweepWitness(sigs);
  for (let i = 0; i < witness.length; i++) {
    const item = h(witness[i][0]);
    assert.equal(item.length, 65);
    assert.equal(item[64], 0x01);
    assert.equal(await B.schnorrVerify(item.subarray(0, 64), h(inputs[i].hash), spent[i].script.subarray(2)), true, 'input ' + i);
  }
  // The planner sorted by outpoint, so the tweaked coin leads; the forms
  // must have followed their coins rather than the order they were given in.
  assert.deepEqual(plan.plan.map((u) => u.form), ['tweaked', 'untweaked']);
});

// ---- the worker signs a transaction, never a hash -----------------------------

const K6_SK = B.bigIntToBytes(6n, 32); // P = 6G has an odd Y
const K6_PUB = B.bytesToHex(B.bigIntToBytes(B.scalarMult(6n, G).x, 32));
function k6Plan() {
  return B.planSweep([
    { txidHex: 'cd'.repeat(32), vout: 0, valueSats: 40000n, form: 'untweaked' },
    { txidHex: 'ab'.repeat(32), vout: 3, valueSats: 25000n, form: 'tweaked' },
  ], B.destScriptFor('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'), 2);
}

test('the worker signs a sweep from its transaction, delivered as runtime messaging delivers it', async () => {
  const plan = k6Plan();
  // Chrome's runtime messaging is JSON: no BigInt, no Uint8Array survive it.
  const req = JSON.parse(JSON.stringify(B.sweepRequest(plan)));
  const sigs = await B.signSweepTx(K6_SK, K6_PUB, req);
  const scripts = {
    tweaked: B.p2trScript(B.tweakedPubkeyFrom(K6_PUB, await B.tapTweakInt(h(K6_PUB)))),
    untweaked: B.p2trScript(h(K6_PUB)),
  };
  const spent = plan.plan.map((u) => ({ valueSats: u.valueSats, script: scripts[u.form] }));
  assert.equal(sigs.length, 2);
  for (let i = 0; i < sigs.length; i++) {
    const sh = await B.sighashAll(plan.tx, i, spent);
    assert.equal(await B.schnorrVerify(h(sigs[i]), sh, spent[i].script.subarray(2)), true, 'input ' + i);
  }
});

test('the worker refuses anything that is not a well-formed single-output sweep', async () => {
  const good = () => JSON.parse(JSON.stringify(B.sweepRequest(k6Plan())));
  const edit = (fn) => { const r = good(); fn(r); return r; };
  const cases = {
    'no request at all': null,
    'the old contract, a bare hash': { inputs: [{ hash: 'ab'.repeat(32), form: 'untweaked' }] },
    'a bare hash inside a sweep': edit((r) => { r.inputs = [{ hash: 'ab'.repeat(32), form: 'untweaked' }]; }),
    'no inputs': edit((r) => { r.inputs = []; }),
    'sixty-five inputs': edit((r) => { r.inputs = Array.from({ length: 65 }, () => r.inputs[0]); }),
    'two outputs': edit((r) => { r.outputs.push(r.outputs[0]); }),
    'a short txid': edit((r) => { r.inputs[0].txidHex = r.inputs[0].txidHex.slice(2); }),
    'an uppercase txid': edit((r) => { r.inputs[0].txidHex = r.inputs[0].txidHex.toUpperCase(); }),
    'a fractional vout': edit((r) => { r.inputs[0].vout = 0.5; }),
    'a value as a number': edit((r) => { r.inputs[0].valueSats = 40000; }),
    'a negative value': edit((r) => { r.inputs[0].valueSats = '-1'; }),
    'more than all the bitcoin there is': edit((r) => { r.inputs[0].valueSats = '2100000000000001'; }),
    'an unknown form': edit((r) => { r.inputs[0].form = 'constructor'; }),
    'a non-witness output': edit((r) => { r.outputs[0].scriptHex = '76a914' + '00'.repeat(20) + '88ac'; }),
    'an output worth more than its inputs': edit((r) => { r.outputs[0].valueSats = '65001'; }),
    'a fractional version': edit((r) => { r.version = 2.5; }),
  };
  for (const [what, req] of Object.entries(cases)) {
    await assert.rejects(B.signSweepTx(K6_SK, K6_PUB, req), /malformed sweep request/, what);
  }
});

// ---- serialization, size, txid ----------------------------------------------

// The first Taproot key-path spend on mainnet (block 709635): one P2TR input
// with an empty scriptSig and a single witness item — the sweep's own shape —
// and a NONZERO locktime, so where the witness sits against the locktime shows
// in the bytes. Its prevout txid is in display order, as an explorer prints it.
const MAINNET_KEYPATH_TX = '01000000000101d1f1c1f8cdf6759167b90f52c9ad358a369f95284e841d7a2536cef31c0549580100000000fdffffff020000000000000000316a2f49206c696b65205363686e6f7272207369677320616e6420492063616e6e6f74206c69652e204062697462756734329e06010000000000225120a37c3903c8d0db6512e2b40b0dffa05e5a3ab73603ce8c9c4b7771e5412328f90140a60c383f71bac0ec919b1d7dbc3eb72dd56e7aa99583615564f9f99b8ae4e837b758773a5b2e4c51348854c8389f008e05029db7f464a5ff2e01d5e6e626174affd30a00';
const MAINNET_KEYPATH_TXID = '33e794d097969002ee05d336686fc03c9e15a597c1b9827669460fac98799036';
const MAINNET_KEYPATH_PREVOUT = '5849051cf3ce36257a1d844e28959f368a35adc9520fb9679175f6cdf8c1f1d1';

test('serializeTx rebuilds a real mainnet key-path spend byte for byte', async () => {
  // The outpoint goes through explorerUtxos exactly as the card's does, so
  // this also pins the display-to-wire flip against a transaction that exists.
  const [prev] = B.explorerUtxos([{ txid: MAINNET_KEYPATH_PREVOUT, vout: 1, value: 88480, status: { confirmed: true } }], 'tweaked');
  const tx = {
    version: 1,
    inputs: [{ txidHex: prev.txidHex, vout: prev.vout, sequence: 0xfffffffd }],
    outputs: [
      { valueSats: 0n, script: h('6a2f49206c696b65205363686e6f7272207369677320616e6420492063616e6e6f74206c69652e20406269746275673432') },
      { valueSats: 67230n, script: h('5120a37c3903c8d0db6512e2b40b0dffa05e5a3ab73603ce8c9c4b7771e5412328f9') },
    ],
    nLockTime: 709631,
  };
  const witness = [['a60c383f71bac0ec919b1d7dbc3eb72dd56e7aa99583615564f9f99b8ae4e837b758773a5b2e4c51348854c8389f008e05029db7f464a5ff2e01d5e6e626174a']];
  assert.equal(B.bytesToHex(B.serializeTx(tx, witness)), MAINNET_KEYPATH_TX);
  assert.equal(await B.txidOf(tx), MAINNET_KEYPATH_TXID);
  // Core weighs it at 676: 152 stripped bytes, 220 in all.
  assert.deepEqual(B.txWeight(tx, witness), { strippedSize: 152, totalSize: 220, weight: 676 });
});

test('serializeTx refuses a witness list that does not match the inputs', () => {
  const plan = B.planSweep([
    { txidHex: 'aa'.repeat(32), vout: 0, valueSats: 50000n, form: 'tweaked' },
    { txidHex: 'bb'.repeat(32), vout: 0, valueSats: 50000n, form: 'tweaked' },
  ], h('512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'), 5);
  assert.throws(() => B.serializeTx(plan.tx, B.sweepWitness(['11'.repeat(64)])), /one witness per input/);
});

test('a one-input sweep has the size a key-path spend should have', () => {
  const dest = h('512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  const plan = B.planSweep([{ txidHex: 'aa'.repeat(32), vout: 0, valueSats: 100000n, form: 'tweaked' }], dest, 10);
  // 4 (version) + 1 (nIn) + 41 (input) + 1 (nOut) + 43 (P2TR out) + 4 (locktime)
  // stripped = 94; with the witness, + 2 (marker, flag) + 1 (items) + 1 (len)
  // + 65 (sig) = 163. BIP-144 gives the witnesses no count of their own.
  assert.deepEqual(B.txWeight(plan.tx, B.sweepWitness(['00'.repeat(64)])), { strippedSize: 94, totalSize: 163, weight: 94 * 3 + 163 });
  assert.equal(plan.vsize, Math.ceil((94 * 3 + 163) / 4));
  assert.equal(plan.feeSats, BigInt(plan.vsize * 10));
  assert.equal(plan.outValueSats, 100000n - BigInt(plan.vsize * 10));
});

test('serialization round trips and the txid is stable and value-sensitive', async () => {
  const destScript = h('512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  const plan = B.planSweep([
    { txidHex: 'aa'.repeat(32), vout: 1, valueSats: 50000n, form: 'tweaked' },
    { txidHex: 'bb'.repeat(32), vout: 0, valueSats: 50000n, form: 'untweaked' },
  ], destScript, 5);
  const { tx } = plan;
  const hex = B.bytesToHex(B.serializeTx(tx, B.sweepWitness(['11'.repeat(64), '22'.repeat(64)])));
  // Wire order: inputs must be outpoint-sorted (aa before bb).
  assert.ok(hex.indexOf('aa'.repeat(32)) < hex.indexOf('bb'.repeat(32)));
  // BIP-144: the witnesses close the body and the locktime comes LAST — the
  // second input's signature, its SIGHASH_ALL byte, then nLockTime 0.
  assert.ok(hex.endsWith('01' + '41' + '22'.repeat(64) + '01' + '00000000'));
  const id1 = await B.txidOf(tx);
  const id2 = await B.txidOf(tx);
  assert.equal(id1, id2);
  const bumped = { ...tx, outputs: [{ valueSats: tx.outputs[0].valueSats - 1n, script: tx.outputs[0].script }] };
  assert.notEqual(await B.txidOf(bumped), id1);
});

test('a sweep under its dust floor is refused', () => {
  const dest = h('512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  assert.throws(() => B.planSweep([{ txidHex: 'aa'.repeat(32), vout: 0, valueSats: 400n, form: 'tweaked' }], dest, 10), /fee/);
  assert.throws(() => B.planSweep([], dest, 10), /nothing to spend/);
});

// ---- destination reading -----------------------------------------------------

const VEC_P2WPKH = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const VEC_P2TR = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';

test('readDestination takes a plain or bitcoin: address and ignores the rest', () => {
  assert.equal(B.readDestination(VEC_P2WPKH).address, VEC_P2WPKH);
  assert.equal(B.readDestination('  ' + VEC_P2TR + ' ').address, VEC_P2TR);
  assert.equal(B.readDestination('bitcoin:' + VEC_P2WPKH + '?amount=0.0001&label=rescue').address, VEC_P2WPKH);
  assert.equal(B.readDestination('BITCOIN:' + VEC_P2WPKH.toUpperCase()).address, VEC_P2WPKH.toUpperCase());
  assert.equal(B.readDestination(VEC_P2TR).version, 1);
});

test('readDestination names what it refused', () => {
  assert.equal(B.readDestination('lightning:lnbc1p3xzj2pp5q').error, 'lightning');
  assert.equal(B.readDestination('lnbc1p3xzj2pp5q').error, 'lightning');
  assert.equal(B.readDestination('LNURL1DP68GURN8GHJ7UM9DEHKXC3RVDM').error, 'lightning');
  assert.equal(B.readDestination('tb1qqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesrxh6hy').error, 'testnet');
  assert.equal(B.readDestination('1BrZmTvZ2pLzrQfjf2AphbU9rM5SKSTgRc').error, 'legacy');
  assert.equal(B.readDestination('11111111111111111111111111111111').error, 'legacy');
  assert.equal(B.readDestination('bc1qnotachecksum').error, 'invalid');
  assert.equal(B.readDestination('hello world').error, 'invalid');
  assert.equal(B.readDestination('').error, 'empty');
});

test('explorer UTXOs map to BigInt sweep inputs, confirmed only', () => {
  const list = [
    { txid: 'aa', vout: 0, value: 50000, status: { confirmed: true } },
    { txid: 'bb', vout: 1, value: 999, status: { confirmed: false } },
  ];
  const mapped = B.explorerUtxos(list, 'tweaked');
  assert.equal(mapped.length, 1);
  assert.equal(typeof mapped[0].valueSats, 'bigint');
  assert.equal(mapped[0].valueSats, 50000n);
  assert.equal(mapped[0].form, 'tweaked');
  assert.deepEqual(B.explorerUtxos(null, 'tweaked'), []);
});

test('the explorer txid flips into wire order for the outpoint', () => {
  // The wire outpoint is the display txid REVERSED — get this wrong and the
  // transaction references coins that no chain ever saw, which mempool
  // reports as a bare 400. A palindrome hides the bug, so this one isn't.
  const display = '1234567890abcdef';
  const mapped = B.explorerUtxos([{ txid: display, vout: 0, value: 1, status: { confirmed: true } }], 'tweaked');
  // Byte-wise, not nibble-wise: [12,34,56,78,90,ab,cd,ef] becomes [ef,cd,ab,90,78,56,34,12].
  assert.equal(mapped[0].txidHex, 'efcdab9078563412');
});

test('the destination script mirrors the decoded address', () => {
  const d0 = B.segwitAddressDecode(VEC_P2WPKH);
  assert.equal(B.bytesToHex(B.destScriptFor(VEC_P2WPKH)), '0014' + B.bytesToHex(Uint8Array.from(d0.program)));
  assert.equal(B.bytesToHex(B.destScriptFor(VEC_P2TR)), '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
});

test('the sweep card would offer this key its own two addresses', async () => {
  // A fixed demo key's nostr pubkey (3G), so the assertion has stable text
  // without any real account's key in the repo.
  const xonly = B.bytesToHex(B.bigIntToBytes(B.scalarMult(3n, { x: 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n, y: 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n }).x, 32));
  const addrs = await B.deriveAddresses(xonly);
  assert.match(addrs.untweaked, /^bc1p/);
  assert.notEqual(addrs.tweaked, addrs.untweaked);
  assert.equal(B.segwitAddressDecode(addrs.tweaked).program.length, 32);
});
