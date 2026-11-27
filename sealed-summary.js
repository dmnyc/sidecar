// Sidecar — saying what text an app wants sealed is, for the approval card (isolated module).
//
// An app that stores its settings asks Sidecar to encrypt a string, and the card used to print
// that string. When it was a wallet connection that meant a wall of characters with the
// connection's secret in the middle of it. Both approval surfaces keep separate copies of the
// drawing, so the part that is logic lives here, once, and is tested by running it:
//
//   describe(text)   null for text a person can simply read (it is shown as it is), otherwise
//                    { kind, ... } naming what the text is. The card says that in a sentence and
//                    keeps the text itself behind a "Show details" link.
//
// Nothing here is translated and nothing is drawn. The values (hosts, key names) come from the
// page, so a surface draws them with textContent and passes them to a template as parameters.
// A secret never leaves this module: describe() reports a connection's relays and nothing else.

(function () {
  'use strict';

  const MAX_PARSE = 20000; // past this a string is not parsed for a summary
  const MAX_NAMES = 4;
  const MAX_HOSTS = 3;

  // The host of a relay or web address, or '' when it is not one.
  function hostOf(u) {
    const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:@]+)(?::\d+)?(?:[/?#]|$)/i.exec(String(u || '').trim());
    return m ? m[1].toLowerCase() : '';
  }

  // The values of one query parameter, decoded, in order.
  function queryAll(text, name) {
    const q = text.indexOf('?');
    if (q === -1) return [];
    const out = [];
    for (const part of text.slice(q + 1).split('#')[0].split('&')) {
      const eq = part.indexOf('=');
      const k = eq === -1 ? part : part.slice(0, eq);
      if (k !== name) continue;
      let v = eq === -1 ? '' : part.slice(eq + 1);
      try { v = decodeURIComponent(v); } catch (_) {}
      out.push(v);
    }
    return out;
  }

  function uniqueHosts(urls) {
    const seen = [];
    for (const u of urls) {
      const h = hostOf(u);
      if (h && !seen.includes(h)) seen.push(h);
    }
    return seen;
  }

  function describe(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return null;

    // Connection strings carry a secret, so they are named and never read out.
    if (/^nostr\+walletconnect:\/\//i.test(s) || /^nostrwalletconnect:\/\//i.test(s)) {
      return { kind: 'wallet', hosts: uniqueHosts(queryAll(s, 'relay')).slice(0, MAX_HOSTS) };
    }
    if (/^bunker:\/\//i.test(s)) {
      return { kind: 'signer', hosts: uniqueHosts(queryAll(s, 'relay')).slice(0, MAX_HOSTS) };
    }
    if (/^(nsec1[02-9ac-hj-np-z]{50,}|ncryptsec1[02-9ac-hj-np-z]{40,})$/i.test(s)) {
      return { kind: 'private-key' };
    }

    // A single web address, nothing else around it.
    if (/^https?:\/\/\S+$/i.test(s)) {
      const host = hostOf(s);
      if (host) return { kind: 'link', host };
    }

    if (s.length <= MAX_PARSE && (s[0] === '{' || s[0] === '[')) {
      let parsed;
      try { parsed = JSON.parse(s); } catch (_) { parsed = undefined; }
      if (Array.isArray(parsed)) return { kind: 'list', count: parsed.length };
      if (parsed && typeof parsed === 'object') {
        const keys = Object.keys(parsed);
        return {
          kind: 'object',
          count: keys.length,
          names: keys.slice(0, MAX_NAMES).map((k) => String(k).slice(0, 24)),
          more: Math.max(0, keys.length - MAX_NAMES),
        };
      }
    }

    // Ciphertext in the two shapes Nostr uses: NIP-04's base64?iv=base64, and NIP-44's version
    // byte (2 or 3) opening a long base64 run. Named as what they are, not as "encoded data".
    if (!/\s/.test(s) && s.length >= 24 && /^[A-Za-z0-9+/]+={0,2}\?iv=[A-Za-z0-9+/]+={0,2}$/.test(s)) return { kind: 'sealed' };
    if (!/\s/.test(s) && s.length >= 132 && /^A[gw][A-Za-z0-9+/]+={0,2}$/.test(s)) return { kind: 'sealed' };

    // One long unbroken run (hex, base64, ciphertext): nothing in it to read.
    if (s.length >= 40 && !/\s/.test(s)) return { kind: 'encoded', length: s.length };

    return null;
  }

  const api = { describe, hostOf };
  if (typeof self !== 'undefined') self.SidecarSealedSummary = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarSealedSummary = api;
})();
