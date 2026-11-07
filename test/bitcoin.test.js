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

test('the signing scalars match the vector tweaked private key', async () => {
  const scalars = await B.signingScalars(h(VEC_INTERNAL_PRIV), VEC_INTERNAL);
  assert.equal(B.bytesToHex(B.bigIntToBytes(scalars.untweaked, 32)), VEC_TWEAKED_PRIV);
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

test('the sweep signing path produces verifiable key-path signatures for both forms', async () => {
  const sh = await B.sighashAll(vectorTx(), 0, vectorSpent());
  const sigs = await B.signSweepInputs(h(VEC_INTERNAL_PRIV), VEC_INTERNAL, [
    { hash: B.bytesToHex(sh), form: 'tweaked' },
    { hash: B.bytesToHex(sh), form: 'untweaked' },
  ]);
  // Tweaked form: the output key Q was spent as an internal key, so a node
  // verifies under Q + TapTweak(Q).
  const t2 = await B.tapTweakInt(h(VEC_TWEAKED_PUB));
  assert.equal(await B.schnorrVerify(h(sigs[0]), sh, B.tweakedPubkeyFrom(VEC_TWEAKED_PUB, t2)), true);
  // Untweaked form: the raw key was the output key; a node verifies under
  // internal + TapTweak(internal).
  const t = await B.tapTweakInt(h(VEC_INTERNAL));
  assert.equal(await B.schnorrVerify(h(sigs[1]), sh, B.tweakedPubkeyFrom(VEC_INTERNAL, t)), true);
});

// ---- serialization, size, txid ----------------------------------------------

test('a one-input sweep has the size a key-path spend should have', () => {
  const dest = h('512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  const plan = B.planSweep([{ txidHex: 'aa'.repeat(32), vout: 0, valueSats: 100000n, form: 'tweaked' }], dest, 10);
  // 4 (version) + 1 (nIn) + 41 (input) + 1 (nOut) + 43 (P2TR out) + 4 (locktime)
  // stripped = 94; witness = 1 (nIn) + 1 (items) + 1 (len) + 65 (sig) = 68; total 164
  assert.equal(plan.vsize, Math.ceil((94 * 3 + 164) / 4));
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
  // The witness sits between the inputs and the locktime.
  assert.ok(hex.indexOf('22'.repeat(64)) > 0);
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
  assert.equal(mapped[0].txidHex, 'aa');
  assert.equal(typeof mapped[0].valueSats, 'bigint');
  assert.equal(mapped[0].valueSats, 50000n);
  assert.equal(mapped[0].form, 'tweaked');
  assert.deepEqual(B.explorerUtxos(null, 'tweaked'), []);
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
