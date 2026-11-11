'use strict';
// A pretend Lightning wallet for store screenshots: it speaks NIP-47 over the local relay
// and answers what the Wallet tab asks (get_info, get_balance, list_transactions) with a
// balance and a history written in the fixtures. It holds nothing and pays nothing.
//
// The panel talks to it exactly as it talks to a real wallet service: an encrypted
// kind 23194 request addressed to the wallet's key, an encrypted kind 23195 answer that
// names the request. Nothing in the panel is changed or faked; only the far end is.

function createWallet({ NT, secretKeyHex, balanceSats, transactions }) {
  const sk = Uint8Array.from(secretKeyHex.match(/../g).map((h) => parseInt(h, 16)));
  const pubkey = NT.getPublicKey(sk);
  const METHODS = ['pay_invoice', 'get_balance', 'get_info', 'make_invoice', 'lookup_invoice', 'list_transactions'];

  const result = (method, body) => ({ result_type: method, result: body });
  const error = (method, code, message) => ({ result_type: method, error: { code, message } });

  function answer(method, params) {
    if (method === 'get_info') {
      return result(method, { alias: 'Demo wallet', color: '#f0a040', pubkey, network: 'mainnet', block_height: 1, block_hash: '0'.repeat(64), methods: METHODS });
    }
    if (method === 'get_balance') return result(method, { balance: balanceSats * 1000 });
    if (method === 'list_transactions') {
      const limit = (params && params.limit) || 20;
      const list = [...transactions].sort((a, b) => b.settled_at - a.settled_at).slice(0, limit);
      return result(method, { transactions: list });
    }
    return error(method, 'NOT_IMPLEMENTED', 'This pretend wallet only answers what the Wallet tab reads.');
  }

  return {
    pubkey,
    // What the panel is given to connect: the wallet's key, the relay, and a key for the client.
    connectionString(relayUrl, clientSecretHex) {
      return 'nostr+walletconnect://' + pubkey + '?relay=' + encodeURIComponent(relayUrl) + '&secret=' + clientSecretHex;
    },
    // The kind 13194 event a wallet publishes to say what it can do.
    infoEvent() {
      return NT.finalizeEvent({ kind: 13194, created_at: Math.floor(Date.now() / 1000), tags: [], content: METHODS.join(' ') }, sk);
    },
    // Called with each event a client publishes to the relay.
    async handle(ev, { push }) {
      if (ev.kind !== 23194) return;
      if (!ev.tags.some((t) => t[0] === 'p' && t[1] === pubkey)) return;
      let req;
      try { req = JSON.parse(await NT.nip04.decrypt(sk, ev.pubkey, ev.content)); } catch (_) { return; }
      const body = answer(req.method, req.params);
      const content = await NT.nip04.encrypt(sk, ev.pubkey, JSON.stringify(body));
      push(NT.finalizeEvent({ kind: 23195, created_at: Math.floor(Date.now() / 1000), tags: [['p', ev.pubkey], ['e', ev.id]], content }, sk));
    },
  };
}

// ---- a BOLT11 invoice that reads correctly, for a page to ask Sidecar to pay ----
//
// The panel and the worker read an invoice's amount, description and expiry and check its
// bech32 checksum; the wallet is the one that checks the signature, and this wallet is pretend.
// So this builds a well-formed invoice (right checksum, right fields) with an empty signature.
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk;
}
const hrpExpand = (hrp) => [...hrp].map((c) => c.charCodeAt(0) >>> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
const toWords = (bytes) => {
  const out = []; let acc = 0; let bits = 0;
  for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; out.push((acc >> bits) & 31); } acc &= (1 << bits) - 1; }
  if (bits) out.push((acc << (5 - bits)) & 31);
  return out;
};
const wordsOf = (n, count) => Array.from({ length: count }, (_, i) => Math.floor(n / 32 ** (count - 1 - i)) % 32);

function createInvoice({ sats, description, expirySeconds = 3600, now = Math.floor(Date.now() / 1000), seed = 1 }) {
  const hrp = 'lnbc' + sats * 10 + 'n';   // nano-bitcoin: 1 sat = 10 nBTC
  const hash = Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 7) & 255);
  const desc = toWords(Buffer.from(description, 'utf8'));
  const field = (type, words) => [type, Math.floor(words.length / 32), words.length % 32, ...words];
  const data = [
    ...wordsOf(now, 7),
    ...field(1, toWords(hash)),                       // p: payment hash
    ...field(16, toWords(hash.slice().reverse())),    // s: payment secret
    ...field(13, desc),                               // d: description
    ...field(6, wordsOf(expirySeconds, 3)),           // x: expiry
    ...new Array(104).fill(0),                        // the signature a real wallet would check
  ];
  const mod = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const check = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return hrp + '1' + [...data, ...check].map((w) => CHARSET[w]).join('');
}

module.exports = { createWallet, createInvoice };
