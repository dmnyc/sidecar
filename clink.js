'use strict';

// ---- CLINK offers (noffer), payer side ----
//
// CLINK is ShockNet's Nostr-native Lightning interface: a `noffer1…` on someone's profile
// is an address you can ask for an invoice, over Nostr instead of over HTTPS. Paying one
// is LNURL-pay with a relay where the web server would be.
//
// Spec: https://github.com/shocknet/CLINK/blob/main/specs/clink-offers.md
// Still an open NIP (nostr-protocol/nips#1529) rather than a merged one, which is why
// kind 21001 is written out here rather than taken from nostr-tools' kinds.
//
// ITS OWN FILE, like nwc-client.js and ws-guard.js, because it is a protocol client and
// not panel furniture. It holds no key and opens no socket: whichever page installs it
// hands in signing, NIP-44 and a relay pool, so the panel's careful pool stays the
// panel's and this file never learns what it is talking to.
window.SidecarCLINK = (function () {
  const NOFFER_HRP = 'noffer';
  // The payer's request and the service's reply are both this kind. 20000-29999 is the
  // ephemeral range: relays are not expected to store it, which is the whole reason the
  // subscription has to be open BEFORE the request goes out.
  const KIND_CLINK = 21001;
  const DEFAULT_TIMEOUT_MS = 30000;

  // TLVs, in the order the spec lists them.
  const TLV_PUBKEY = 0;      // 32 bytes, the service's key
  const TLV_RELAY = 1;       // utf-8, where to ask
  const TLV_OFFER_ID = 2;    // utf-8, which offer
  const TLV_PRICING_TYPE = 3; // 0 fixed, 1 variable, 2 spontaneous (the default)
  const TLV_PRICE = 4;       // big-endian sats
  const TLV_CURRENCY = 5;    // utf-8, only meaningful with type 1

  // ---- bech32, by hand ----
  //
  // The vendored nostr-tools does not export bech32 and its nip19 has no noffer case, so
  // this is the one thing CLINK needs that Sidecar did not already have. Written out
  // rather than vendored: BIP-173 decode is forty lines of arithmetic, and REVIEWERS.md
  // justifies every third-party bundle to a reviewer by hash. A fifth bundle for this
  // would cost more to explain than to read.
  //
  // Plain bech32, not bech32m: nip19 and CLINK both use checksum constant 1.
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

  // 5-bit groups to 8-bit bytes. The trailing partial group must be zero padding and
  // shorter than a whole byte, or the payload was not produced by a bech32 encoder.
  function fromWords(words) {
    let acc = 0;
    let bits = 0;
    const out = [];
    for (const w of words) {
      if (w < 0 || w >> 5 !== 0) throw new Error('Invalid data in the offer');
      acc = (acc << 5) | w;
      bits += 5;
      while (bits >= 8) {
        bits -= 8;
        out.push((acc >> bits) & 0xff);
      }
    }
    if (bits >= 5 || ((acc << (8 - bits)) & 0xff) !== 0) {
      throw new Error('Invalid padding in the offer');
    }
    return new Uint8Array(out);
  }

  // Returns { hrp, bytes }. No length cap: nip19 lifts bech32's 90-character default to
  // 5000 for the same reason, which is that a real payload is longer than the BIP's
  // original address-sized assumption.
  function bech32Decode(str) {
    const s = String(str || '');
    if (s !== s.toLowerCase() && s !== s.toUpperCase()) {
      throw new Error('Mixed case in the offer');
    }
    const lower = s.toLowerCase();
    const sep = lower.lastIndexOf('1');
    if (sep < 1 || sep + 7 > lower.length) throw new Error('That is not a complete offer');
    const hrp = lower.slice(0, sep);
    const words = [];
    for (const ch of lower.slice(sep + 1)) {
      const v = CHARSET.indexOf(ch);
      if (v === -1) throw new Error('The offer has a character bech32 does not use');
      words.push(v);
    }
    if (polymod(hrpExpand(hrp).concat(words)) !== 1) {
      throw new Error('The offer failed its checksum, so it was mistyped or truncated');
    }
    return { hrp, bytes: fromWords(words.slice(0, -6)) };
  }

  // ---- the offer itself ----

  function parseTlvs(bytes) {
    const tlvs = [];
    let at = 0;
    while (at < bytes.length) {
      if (at + 2 > bytes.length) throw new Error('The offer is truncated');
      const type = bytes[at];
      const len = bytes[at + 1];
      if (at + 2 + len > bytes.length) throw new Error('The offer is truncated');
      tlvs.push({ type, value: bytes.slice(at + 2, at + 2 + len) });
      at += 2 + len;
    }
    return tlvs;
  }

  const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const toUtf8 = (b) => new TextDecoder('utf-8').decode(b);
  const toInt = (b) => b.reduce((n, x) => n * 256 + x, 0);

  function stripNostrPrefix(s) {
    return String(s || '').trim().replace(/^nostr:/i, '');
  }

  // Shape only, for deciding whether a profile field is worth decoding. The real check is
  // decodeNoffer, which throws with a reason somebody can act on.
  function isNofferString(s) {
    return typeof s === 'string' &&
      /^(nostr:)?noffer1[023456789acdefghjklmnpqrstuvwxyz]{6,}$/i.test(s.trim());
  }

  function decodeNoffer(input) {
    const cleaned = stripNostrPrefix(input);
    const { hrp, bytes } = bech32Decode(cleaned);
    if (hrp !== NOFFER_HRP) throw new Error('That is not a CLINK offer');
    const tlvs = parseTlvs(bytes);
    const find = (t) => tlvs.find((x) => x.type === t);

    const pubkey = find(TLV_PUBKEY);
    if (!pubkey || pubkey.value.length !== 32) throw new Error('The offer names no wallet');
    const relay = find(TLV_RELAY);
    if (!relay || !relay.value.length) throw new Error('The offer names no relay to ask');
    const offerId = find(TLV_OFFER_ID);
    if (!offerId || !offerId.value.length) throw new Error('The offer has no id');

    const typeTlv = find(TLV_PRICING_TYPE);
    const priceTlv = find(TLV_PRICE);
    const currencyTlv = find(TLV_CURRENCY);
    const out = {
      pubkey: toHex(pubkey.value),
      relay: toUtf8(relay.value),
      offerId: toUtf8(offerId.value),
      // Spontaneous when absent, which is the spec's default and the one that means
      // "name your own amount".
      pricingType: typeTlv && typeTlv.value.length
        ? (typeTlv.value[0] === 0 ? 'fixed' : typeTlv.value[0] === 1 ? 'variable' : 'spontaneous')
        : 'spontaneous',
    };
    if (priceTlv && priceTlv.value.length) out.price = toInt(priceTlv.value);
    if (currencyTlv && currencyTlv.value.length) out.currency = toUtf8(currencyTlv.value);
    return out;
  }

  // ---- asking the offer for an invoice ----
  //
  // deps: { sign, encrypt, decrypt, subscribe, publish, mePubkey }. Every one of them is
  // the installing page's, so this file holds no key and owns no socket.
  let deps = null;
  function install(d) { deps = d; return api; }

  // Fixed offers carry their price and need no amount from us. Variable and spontaneous
  // ones cannot be asked without one, and asking anyway wastes a round trip to be told so.
  function amountRequired(offer) {
    return !offer || offer.pricingType !== 'fixed';
  }

  async function requestInvoice(offer, opts) {
    const options = opts || {};
    const me = await deps.mePubkey();
    if (!me) throw new Error('No active Sidecar account');

    const payload = { offer: offer.offerId };
    if (options.amountSats > 0) payload.amount_sats = Math.floor(options.amountSats);
    if (options.description) payload.description = options.description;

    const content = await deps.encrypt(offer.pubkey, JSON.stringify(payload));
    const event = await deps.sign({
      kind: KIND_CLINK,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', offer.pubkey], ['clink_version', '1']],
      content,
    });

    // SUBSCRIBE FIRST, PUBLISH SECOND. 21001 is ephemeral, so a relay is not expected to
    // hold the reply for a subscription that arrives late: a service quick enough to
    // answer before we were listening would answer into nothing, and the only symptom
    // would be a timeout that looks like the service being down.
    return new Promise((resolve, reject) => {
      let settled = false;
      let sub = null;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { if (sub) sub.close(); } catch (_) {}
        fn(arg);
      };
      const timer = setTimeout(
        () => finish(reject, new Error('The offer did not answer. Its wallet may be offline.')),
        options.timeoutMs || DEFAULT_TIMEOUT_MS
      );

      sub = deps.subscribe(offer.relay, {
        kinds: [KIND_CLINK],
        authors: [offer.pubkey],
        '#p': [me],
        // A few seconds of slack for clock skew between us and the service.
        since: Math.floor(Date.now() / 1000) - 5,
      }, async (ev) => {
        if (settled) return;
        // The filter already says this, but a relay is not obliged to honor a filter and
        // this one decides what gets paid.
        if (!ev || ev.pubkey !== offer.pubkey) return;
        let parsed;
        try {
          parsed = JSON.parse(await deps.decrypt(offer.pubkey, ev.content));
        } catch (_) {
          return; // not ours, or not readable: keep listening rather than fail on it
        }
        if (parsed && typeof parsed.bolt11 === 'string' && parsed.bolt11) {
          finish(resolve, { bolt11: parsed.bolt11, offer });
          return;
        }
        if (parsed && (parsed.error || parsed.code != null)) {
          const e = new Error(String(parsed.error || 'The offer refused the request'));
          e.clinkCode = parsed.code;
          e.clinkRange = parsed.range;
          finish(reject, e);
        }
      });

      Promise.resolve(deps.publish(offer.relay, event)).catch((e) => finish(reject, e));
    });
  }

  const api = {
    KIND_CLINK,
    decodeNoffer,
    isNofferString,
    stripNostrPrefix,
    amountRequired,
    requestInvoice,
    install,
    // Exposed for the tests, which check this layer against nostr-tools' own bech32
    // rather than only against itself.
    bech32Decode,
  };
  return api;
})();
