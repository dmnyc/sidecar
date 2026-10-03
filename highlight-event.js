// Sidecar — the NIP-84 highlight event (isolated module).
//
// A highlight is a kind:9802 whose content is the passage itself, sourced to the page it
// came from with an r tag marked "source". Words of your own go in a comment tag rather
// than a second note, which makes it a quote highlight: clients draw it as a quote with
// the passage underneath, and there is one event to like, zap or delete, not two.
//
// The passage is never shortened here. A highlight cut to fit is a misquote with your
// signature on it, so a selection over the limit is refused and the caller says so.
//
// Pure: no storage, no network, no DOM. The popup brings the inputs.

(function () {
  'use strict';

  const KIND = 9802;
  const MAX_TEXT = 4000;     // a passage, not an article
  const MAX_CONTEXT = 2000;  // the paragraph around it, when there is one

  // Line endings unified, trailing spaces off every line, runs of blank lines down to
  // one, and the ends trimmed. The words themselves are left exactly as selected.
  function tidy(s) {
    return String(s || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function sourceUrl(raw) {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      u.hash = '';
      return u.href;
    } catch (_) { return null; }
  }

  const tooLong = (text) => tidy(text).length > MAX_TEXT;

  // The surrounding paragraph earns a context tag only when it adds something: it has
  // to contain the passage, be longer than it, and stay a paragraph rather than a page.
  function contextFor(text, context) {
    const c = tidy(context);
    if (!c || c === text || c.length > MAX_CONTEXT || !c.includes(text)) return null;
    return c;
  }

  // A NOTE'S PARAGRAPH COMES FROM THE NOTE, not from the page showing it. Web clients
  // draw a note without <p> tags, so the page's nearest block is the whole note body,
  // quote cards and link previews included, and that would go out as the context. The
  // note's own text is split into paragraphs instead, with nostr: references and links
  // standing on a line of their own (what clients turn into cards) taken out.
  function noteParagraph(content, text) {
    const passage = tidy(text);
    if (!passage) return '';
    const body = tidy(String(content || '')
      .replace(/(^|\s)nostr:[a-z0-9]+/gi, '$1')
      .replace(/^[ \t]*https?:\/\/\S+[ \t]*$/gim, ''));
    const paras = body.split(/\n{2,}/).map(tidy);
    return paras.find((p) => p.includes(passage)) || (body.includes(passage) ? body : '');
  }

  // Links written in the comment, as NIP-84 asks: r tags marked "mention", so they are
  // never mistaken for the source.
  function mentionedUrls(comment, source) {
    const out = [];
    for (const m of String(comment || '').matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/g)) {
      const u = sourceUrl(m[0].replace(/[.,;:!?]+$/, ''));
      if (u && u !== source && !out.includes(u)) out.push(u);
    }
    return out;
  }

  // A NOSTR NOTE READ IN A WEB CLIENT IS A NOSTR NOTE, not a web page. Clients put the
  // note's reference in the address (jumble.social/notes/nevent1…, njump.me/note1…,
  // primal.net/e/…, habla.news/a/naddr1…), and NIP-84 sources a highlight of Nostr
  // content with an e or a tag and credits its author with a p tag, so clients can show
  // it on the note and tell its author. The r tag is for content from outside Nostr.
  //
  // `decode` is nip19.decode, passed in so this module stays free of dependencies.
  // Returns { tag: 'e', id } or { tag: 'a', coord }, with author, kind and a relay hint
  // when the reference carries them, or null when the address has no usable reference.
  const HEX64 = /^[0-9a-f]{64}$/;
  function nostrRefFromUrl(raw, decode) {
    let s = String(raw || '');
    try { s = decodeURIComponent(s); } catch (_) { /* keep it as it was */ }
    const m = s.match(/\b(?:nevent1|note1|naddr1)[02-9ac-hj-np-z]{6,}/);
    if (!m || typeof decode !== 'function') return null;
    let d;
    try { d = decode(m[0]); } catch (_) { return null; }
    const hint = (relays) => {
      const r = Array.isArray(relays) && relays.find((u) => /^wss?:\/\/\S+$/.test(u));
      return r || '';
    };
    const author = (pk) => (HEX64.test(pk || '') ? pk : '');
    if (d.type === 'note' && HEX64.test(d.data)) return { tag: 'e', id: d.data, relay: '', author: '', kind: null };
    if (d.type === 'nevent' && d.data && HEX64.test(d.data.id)) {
      return { tag: 'e', id: d.data.id, relay: hint(d.data.relays), author: author(d.data.author),
        kind: Number.isInteger(d.data.kind) ? d.data.kind : null };
    }
    if (d.type === 'naddr' && d.data && HEX64.test(d.data.pubkey) && Number.isInteger(d.data.kind)) {
      return { tag: 'a', coord: d.data.kind + ':' + d.data.pubkey + ':' + (d.data.identifier || ''),
        relay: hint(d.data.relays), author: d.data.pubkey, kind: d.data.kind };
    }
    return null;
  }

  function buildTemplate({ text, url, context, comment, clientTag, now, nostrRef }) {
    const passage = tidy(text);
    if (!passage) throw new Error('Nothing selected');
    if (passage.length > MAX_TEXT) throw new Error('Selection too long');
    const source = sourceUrl(url);
    if (!source) throw new Error('Not a web page');
    const note = tidy(comment);
    const ctx = contextFor(passage, context);
    // A Nostr note is cited as itself, the way clients cite one: the event marked source
    // and its author marked author. The client's web address is left out; which app it
    // was read in is not where it came from.
    const ref = nostrRef && (nostrRef.tag === 'e' ? HEX64.test(nostrRef.id || '') : !!nostrRef.coord) ? nostrRef : null;
    const tags = ref
      ? [[ref.tag, ref.tag === 'e' ? ref.id : ref.coord, ref.relay || '', 'source']]
      : [['r', source, 'source']];
    if (ref && HEX64.test(ref.author || '')) tags.push(['p', ref.author, '', 'author']);
    if (ctx) tags.push(['context', ctx]);
    if (note) {
      tags.push(['comment', note]);
      for (const u of mentionedUrls(note, source)) tags.push(['r', u, 'mention']);
    }
    // NIP-31, for clients that do not know the kind: what this is, in one line.
    tags.push(['alt', ref
      ? (ref.kind === 30023 ? 'Highlight from a Nostr article' : 'Highlight from a Nostr note')
      : 'Highlight from ' + source]);
    if (clientTag) tags.push(['client', 'Sidecar']);
    return {
      kind: KIND,
      created_at: Math.floor((now != null ? now : Date.now()) / 1000),
      tags,
      content: passage,
    };
  }

  const api = { KIND, MAX_TEXT, MAX_CONTEXT, tidy, sourceUrl, tooLong, contextFor, noteParagraph, mentionedUrls, nostrRefFromUrl, buildTemplate };
  if (typeof self !== 'undefined') self.SidecarHighlight = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarHighlight = api;
})();
