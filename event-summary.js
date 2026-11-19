// Sidecar — reading an event to be signed, for the approval card (isolated module).
//
// Both approval surfaces, the side panel's card and the popup window, say what an event
// is before it is signed. They keep separate copies of the text and the drawing, so the
// parts that are logic live here, once, and are tested by running them:
//
//   kindRange(kind)    which of NIP-01's ranges an unrecognized kind falls in, so the card
//                      can say what that means instead of only that it is unknown
//   jsonRpc(content)   the method of a JSON-RPC 2.0 message in the content, if it is one
//   fields(content)    a JSON object in the content as rows, so the card opens on rows
//                      and not on a block of braces
//   tagNames(tags)     the tag names, counted: "p ×2, e"
//   reaction(ev)       what a reaction (kind 7, or 17 for a web page) says, so the card can show
//                      the emoji where it can be seen and not as a character in small type
//
// Nothing here is translated and nothing is drawn. Keys and values come from the page, so
// a surface draws them with textContent and passes them to a template as parameters.

(function () {
  'use strict';

  // NIP-01: 10000-19999 and kinds 0 and 3 are replaceable, 20000-29999 ephemeral, 30000-39999
  // addressable. Anything else is a regular event, kept as it is.
  function kindRange(kind) {
    if (!Number.isInteger(kind)) return null;
    if (kind >= 20000 && kind < 30000) return 'ephemeral';
    if (kind >= 30000 && kind < 40000) return 'addressable';
    if (kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)) return 'replaceable';
    return 'regular';
  }

  // Past this a content string is not parsed for a summary: the card keeps Raw and JSON, and
  // a page cannot make it do work by sending a large one.
  const MAX_PARSE = 20000;
  const MAX_ROWS = 16;
  const MAX_DEPTH = 3;
  const VALUE_CAP = 200;

  function parseObject(content) {
    if (typeof content !== 'string' || content.length < 2 || content.length > MAX_PARSE) return null;
    if (content[0] !== '{') return null;
    try {
      const v = JSON.parse(content);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch (_) { return null; }
  }

  // { method } for a JSON-RPC 2.0 request or notification, else null. A reply has no method.
  function jsonRpc(content) {
    const o = parseObject(content);
    if (!o || o.jsonrpc !== '2.0' || typeof o.method !== 'string' || !o.method) return null;
    return { method: o.method };
  }

  // A leaf as the text a row shows. Strings as written, the rest as JSON, and a long one
  // is cut: the full value is still in Raw and JSON.
  function leafText(v) {
    let s;
    if (typeof v === 'string') s = v;
    else if (Array.isArray(v) && v.length && v.every((x) => ['string', 'number', 'boolean'].includes(typeof x))) s = v.join(', ');
    else { try { s = JSON.stringify(v); } catch (_) { s = String(v); } }
    return s.length > VALUE_CAP ? s.slice(0, VALUE_CAP) + '…' : s;
  }

  // A JSON object in the content as [key, value] rows, nested objects flattened into dotted
  // keys ("params.clientInfo.name"). { rows, more } where `more` counts rows left out, or
  // null when the content is not a JSON object with anything in it (the card then keeps its
  // plain views). In the order the page wrote them.
  function fields(content) {
    const o = parseObject(content);
    if (!o) return null;
    const rows = [];
    let total = 0;
    const walk = (value, prefix, depth) => {
      const keys = Object.keys(value);
      for (const k of keys) {
        const v = value[k];
        const key = prefix ? prefix + '.' + k : k;
        if (v && typeof v === 'object' && !Array.isArray(v) && depth < MAX_DEPTH && Object.keys(v).length) {
          walk(v, key, depth + 1);
          continue;
        }
        total++;
        if (rows.length < MAX_ROWS) rows.push([key, leafText(v)]);
      }
    };
    walk(o, '', 1);
    if (!total) return null;
    return { rows, more: total - rows.length };
  }

  // The tag names with how many of each, in the order first seen: "p ×3, e ×2, t". A name is
  // the page's own text, so a long one is cut, and past six names the rest is "…".
  function tagNames(tags) {
    if (!Array.isArray(tags)) return '';
    const counts = new Map();
    for (const tag of tags) {
      const name = Array.isArray(tag) && typeof tag[0] === 'string' && tag[0] ? tag[0].slice(0, 12) : '?';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    const parts = [...counts].map(([n, c]) => (c > 1 ? n + ' ×' + c : n));
    return parts.length > 6 ? parts.slice(0, 6).join(', ') + ', …' : parts.join(', ');
  }

  // A reaction's content is its emoji (NIP-25). '+' (or nothing) is the old like and '-' the old
  // dislike, drawn the way Sidecar draws them in notifications, with `note` saying so, since the
  // heart is not what is signed. Anything else is the page's own text and is passed through as it
  // is, cut to 64 characters: a custom emoji's :shortcode: stays a shortcode, because the picture
  // would have to be fetched from an address the page chose, and the card is no place for that.
  // `big` says the content is a short run of emoji, which is the only thing worth drawing large.
  function reaction(ev) {
    if (!ev || (ev.kind !== 7 && ev.kind !== 17)) return null;
    const c = String(ev.content == null ? '' : ev.content).trim();
    if (c === '' || c === '+') return { glyph: '\u2764\uFE0F', note: 'like', big: true };
    if (c === '-') return { glyph: '\uD83D\uDC4E', note: 'dislike', big: true };
    const glyph = c.slice(0, 64);
    return { glyph, note: '', big: /\p{Extended_Pictographic}/u.test(glyph) && Array.from(glyph).length <= 8 };
  }

  const api = { kindRange, jsonRpc, fields, tagNames, reaction, MAX_ROWS };
  if (typeof self !== 'undefined') self.SidecarEventSummary = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarEventSummary = api;
})();
