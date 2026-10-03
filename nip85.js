// Sidecar — NIP-85 trust provider lists (kind 10040), read without the network (isolated module).
//
// A kind 10040 names, per kind of score, which service the user trusts to compute it
// and where its answers live: ["30382:rank", "<provider key>", "wss://relay"]. Web-of-
// trust services ask the user's signer to publish one when the user turns them on, and
// publish an empty one when the user turns them off.
//
// It is replaceable, so the newest copy replaces the old one wholesale. A service that
// "turns itself off" by publishing an empty list also removes every row that pointed at
// any other provider. That is why the approval card spells out what the new list holds,
// and why replaceable-baseline.js tracks it.
//
// Rows can also live encrypted (NIP-44) in .content, where only the user can read them.
// Sidecar does not decrypt them to draw a card: it says they are there, and counts them
// as present rather than guessing their number.
//
// Isolated so the parsing can be tested on its own — see test/nip85.test.js.

(function () {
  'use strict';

  const KIND_PROVIDER_LIST = 10040;

  const isHexKey = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);
  // "<kind>:<result tag>", e.g. "30382:rank". Anything else in a 10040 is not a row.
  const isAssertionType = (s) => typeof s === 'string' && /^\d+:[A-Za-z0-9_]+$/.test(s);

  // The public rows of a kind 10040, as { type, pubkey, relay }. Malformed rows are
  // skipped rather than failing the list: a card has to draw whatever a site sends.
  function rows(ev) {
    const tags = ev && ev.tags;
    if (!Array.isArray(tags)) return [];
    const out = [];
    for (const t of tags) {
      if (!Array.isArray(t) || !isAssertionType(t[0]) || !isHexKey(t[1])) continue;
      out.push({ type: t[0], pubkey: t[1].toLowerCase(), relay: typeof t[2] === 'string' ? t[2] : '' });
    }
    return out;
  }

  // The rows grouped by provider and relay: one service usually holds several rows (rank,
  // followers, muters…) at one relay, and a card listing each row would repeat the same
  // key five times. Types keep the order the list gave them.
  function providers(ev) {
    const groups = new Map();
    for (const r of rows(ev)) {
      const k = r.pubkey + ' ' + r.relay;
      if (!groups.has(k)) groups.set(k, { pubkey: r.pubkey, relay: r.relay, types: [] });
      const g = groups.get(k);
      if (!g.types.includes(r.type)) g.types.push(r.type);
    }
    return [...groups.values()];
  }

  // Whether the list also carries encrypted rows Sidecar cannot see.
  function hasPrivateRows(ev) {
    return !!(ev && typeof ev.content === 'string' && ev.content.trim() !== '');
  }

  // A score type as a person reads it. Scores about users (30382) are the common case, so
  // they drop the kind; the rest keep it, since "rank" alone would not say rank of what.
  function typeLabel(type) {
    const s = String(type || '');
    return s.startsWith('30382:') ? s.slice(6) : s;
  }

  // The relay as its host, for a row that has to fit on one line.
  function relayHost(relay) {
    try { return new URL(relay).host || String(relay || ''); } catch (_) { return String(relay || ''); }
  }

  const api = { KIND_PROVIDER_LIST, rows, providers, hasPrivateRows, typeLabel, relayHost };
  if (typeof self !== 'undefined') self.SidecarNip85 = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarNip85 = api;
})();
