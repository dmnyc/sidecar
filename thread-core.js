// Sidecar — what a comment thread is made of (isolated module).
//
// A NIP-22 comment answers either a Nostr event or a thing outside Nostr, and says which
// in its tags: the UPPERCASE tags (I, E, A) name the root the whole thread hangs from, the
// lowercase ones (i, e, a) name the parent this comment answers directly. Most clients draw
// a kind 1111 over a web address nowhere at all, which is the reason Sidecar has its own
// page for one (thread.html). This file is that page's reading of the tags, the tree it
// makes of the replies, and the tally of reactions under each.
//
// Pure: no storage, no network, no DOM. The page brings the events.
//
// Loaded by the page as window.SidecarThreadCore and by the tests with require().

(function (root) {
  'use strict';

  const HEX = /^[0-9a-f]{64}$/;
  const KIND_COMMENT = 1111;

  // The tag's own relay hint (the third field), when it is a usable websocket address.
  function hintOf(tag) {
    const u = normalizeRelay(tag && tag[2]);
    return u || '';
  }

  // wss://relay.example/ and wss://Relay.Example are one relay. Anything that is not a
  // plain ws(s) address is not a relay, so a tag cannot point the page at a local port or a
  // different scheme.
  function normalizeRelay(raw) {
    if (typeof raw !== 'string') return '';
    let u;
    try { u = new URL(raw.trim()); } catch (_) { return ''; }
    if (u.protocol !== 'wss:' && u.protocol !== 'ws:') return '';
    if (!u.hostname) return '';
    return (u.protocol + '//' + u.host + (u.pathname === '/' ? '' : u.pathname)).toLowerCase();
  }

  // What the thread hangs from, as its uppercase tag says: { kind: 'web', url } for a web
  // address, { kind: 'event', id, hint } for a Nostr event, { kind: 'address', ref } for an
  // addressable one, and null for a comment that names no root at all.
  function rootOf(ev) {
    const tags = (ev && ev.tags) || [];
    const web = tags.find((tg) => tg[0] === 'I' && /^https?:\/\//i.test(tg[1] || ''));
    if (web) return { kind: 'web', url: web[1] };
    const e = tags.find((tg) => tg[0] === 'E' && HEX.test(tg[1] || ''));
    if (e) return { kind: 'event', id: e[1], hint: hintOf(e) };
    const a = tags.find((tg) => tg[0] === 'A' && (tg[1] || '').includes(':'));
    if (a) return { kind: 'address', ref: a[1], hint: hintOf(a) };
    const other = tags.find((tg) => tg[0] === 'I' && tg[1]);
    if (other) return { kind: 'other', ref: other[1] };
    return null;
  }

  // What this comment answers directly. NIP-22 puts the parent in the lowercase e tag; a
  // client that lists every ancestor lists them root to leaf, so the last one is the
  // parent. '' for a top-level comment, whose parent is its root.
  function parentOf(ev) {
    const es = ((ev && ev.tags) || []).filter((tg) => tg[0] === 'e' && HEX.test(tg[1] || ''));
    if (!es.length) return { id: '', hint: '' };
    const last = es[es.length - 1];
    return { id: last[1], hint: hintOf(last) };
  }

  // The page address a comment is about, when it is about one, as a link-safe string.
  function pageOf(ev) {
    const r = rootOf(ev);
    return r && r.kind === 'web' ? r.url : '';
  }

  // The host to say beside the address; '' when the address is not one the URL parser takes.
  function hostOf(url) {
    try { return new URL(url).host; } catch (_) { return ''; }
  }

  // ---- the tree --------------------------------------------------------------------------

  // The replies to `rootId`, as a tree. `events` is everything the relays gave back, in any
  // order and with repeats: only a kind 1111 whose parent is in the tree is kept, each is
  // kept once, and a comment that names itself or an ancestor as its parent cannot loop the
  // walk. Children are oldest first, the order a conversation reads in.
  //
  // `depth` counts real nesting; `shown` is how far to indent it, which stops at maxIndent
  // because a reply tree indented eight levels is a column of margin and nothing else.
  function buildTree(rootId, events, maxIndent = 4) {
    const byParent = new Map();
    const seen = new Set([rootId]);
    for (const ev of events || []) {
      if (!ev || ev.kind !== KIND_COMMENT || !HEX.test(ev.id || '') || seen.has(ev.id)) continue;
      const p = parentOf(ev).id;
      if (!p || p === ev.id) continue;
      seen.add(ev.id);
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(ev);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
    let total = 0;
    const walk = (id, depth, path) => {
      const kids = [];
      for (const ev of byParent.get(id) || []) {
        if (path.has(ev.id)) continue;            // a loop in what relays handed us
        total++;
        const next = new Set(path); next.add(ev.id);
        const sub = walk(ev.id, depth + 1, next);
        kids.push({ ev, depth: depth + 1, shown: Math.min(depth + 1, maxIndent), children: sub.kids, descendants: sub.count });
      }
      return { kids, count: kids.reduce((n, k) => n + 1 + k.descendants, 0) };
    };
    const top = walk(rootId, 0, new Set([rootId]));
    return { children: top.kids, total };
  }

  // Every id in a tree, root's own children first, for the question "which comments are
  // these reactions under".
  function idsOf(tree) {
    const out = [];
    const walk = (nodes) => { for (const n of nodes) { out.push(n.ev.id); walk(n.children); } };
    walk(tree.children);
    return out;
  }

  // ---- reactions -------------------------------------------------------------------------

  // WHAT A REACTION DRAWS. NIP-25: the content is the emoji, '+' the legacy like and '-'
  // the legacy dislike, a pictographic renders as itself, and a :shortcode: (NIP-30) is a
  // picture carried in an ["emoji", shortcode, url] tag on the reaction. This is the panel's
  // reactionDisplay (sidepanel.js) and has to stay the same function: a chip drawn here has
  // to agree with the row the same event makes in a notification, so the two are compared by
  // a test rather than trusted to stay alike.
  function reactionDisplay(ev) {
    const r = ((ev && ev.content) || '').trim();
    if (r === '+' || !r) return { glyph: '❤️' };
    if (r === '-') return { glyph: '👎' };
    const short = /^:([a-zA-Z0-9_+-]+):$/.exec(r);
    if (short) {
      const tag = ((ev && ev.tags) || []).find((t) => t[0] === 'emoji' && t[1] === short[1] && t[2]);
      return { glyph: r, emojiUrl: tag ? tag[2] : '' };
    }
    const pictographic = /\p{Extended_Pictographic}/u.test(r);
    return { glyph: r && pictographic ? r : '❤️' };
  }

  // The note a reaction is aimed at: NIP-25 names it in the LAST e tag (the earlier ones are
  // the thread above it).
  function reactionTarget(ev) {
    const es = ((ev && ev.tags) || []).filter((tg) => tg[0] === 'e' && HEX.test(tg[1] || ''));
    return es.length ? es[es.length - 1][1] : '';
  }

  // Reactions by the comment they are under: id → [{ glyph, emojiUrl, count, mine }], most
  // used first, ties in the order the glyph first appeared. One person reacting with the
  // same emoji twice is counted once, since a relay replaying an event is not a second
  // opinion; `mine` says one of them was `me`.
  function tallyReactions(reactions, me) {
    const perTarget = new Map();
    const seenBy = new Set();
    for (const ev of reactions || []) {
      if (!ev || ev.kind !== 7) continue;
      const target = reactionTarget(ev);
      if (!target) continue;
      const d = reactionDisplay(ev);
      const key = target + '\u0000' + d.glyph;
      const who = key + '\u0000' + ev.pubkey;
      if (seenBy.has(who)) continue;
      seenBy.add(who);
      if (!perTarget.has(target)) perTarget.set(target, new Map());
      const chips = perTarget.get(target);
      const chip = chips.get(d.glyph) || { glyph: d.glyph, emojiUrl: d.emojiUrl || '', count: 0, mine: false };
      chip.count++;
      if (me && ev.pubkey === me) chip.mine = true;
      chips.set(d.glyph, chip);
    }
    const out = new Map();
    for (const [target, chips] of perTarget) {
      out.set(target, [...chips.values()].map((c, i) => ({ c, i })).sort((a, b) => b.c.count - a.c.count || a.i - b.i).map((x) => x.c));
    }
    return out;
  }

  // ---- relays ----------------------------------------------------------------------------

  // A kind 10002 as { read, write }: a bare r tag is both, a marker narrows it. These are
  // the relays a person's replies arrive at (read) and leave from (write), which is where a
  // thread of theirs is actually found.
  function relayListOf(ev) {
    const read = [];
    const write = [];
    for (const tg of (ev && ev.tags) || []) {
      if (tg[0] !== 'r') continue;
      const u = normalizeRelay(tg[1]);
      if (!u) continue;
      const mark = tg[2];
      if (mark !== 'write' && !read.includes(u)) read.push(u);
      if (mark !== 'read' && !write.includes(u)) write.push(u);
    }
    return { read, write };
  }

  // A list without repeats, in order, capped. A thread query goes to every relay in it, so
  // the cap is what keeps one author with forty relays from turning a page load into forty
  // sockets; the earlier entries are the ones the caller ranked first.
  function relaySet(lists, cap = 14) {
    const out = [];
    for (const list of lists) {
      for (const raw of list || []) {
        const u = normalizeRelay(raw);
        if (u && !out.includes(u)) out.push(u);
        if (out.length >= cap) return out;
      }
    }
    return out;
  }

  // ---- text ------------------------------------------------------------------------------

  // A comment's words as pieces the page can draw without trusting any of them: plain text,
  // an http(s) address, or a nostr: reference. The address loses trailing punctuation that
  // belongs to the sentence, not to the link.
  function tokenize(text) {
    const out = [];
    // Text next to text is one run, so a comma shaved off a link rejoins the sentence it
    // belongs to instead of standing alone.
    const push = (type, value) => {
      const last = out[out.length - 1];
      if (type === 'text' && last && last.type === 'text') last.value += value;
      else out.push({ type, value });
    };
    const re = /(https?:\/\/[^\s<>"']+)|(nostr:(?:npub1|nprofile1|note1|nevent1|naddr1)[a-z0-9]+)/gi;
    const s = String(text || '');
    let last = 0;
    let m;
    while ((m = re.exec(s))) {
      if (m.index > last) push('text', s.slice(last, m.index));
      let value = m[0];
      let tail = '';
      if (m[1]) {
        const trimmed = value.replace(/[.,;:!?)\]}'"]+$/, '');
        tail = value.slice(trimmed.length);
        value = trimmed;
      }
      push(m[1] ? 'url' : 'nostr', value);
      if (tail) push('text', tail);
      last = m.index + m[0].length;
    }
    if (last < s.length) push('text', s.slice(last));
    return out;
  }

  const api = {
    HEX, KIND_COMMENT, normalizeRelay, rootOf, parentOf, pageOf, hostOf,
    buildTree, idsOf, reactionDisplay, reactionTarget, tallyReactions,
    relayListOf, relaySet, tokenize,
    // Where a web page's comments are readable in another client, for the link beside them.
    jumbleThreadUrl: (url) => 'https://jumble.social/external-content?id=' + encodeURIComponent(url),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SidecarThreadCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
