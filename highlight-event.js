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

  function buildTemplate({ text, url, context, comment, clientTag, now }) {
    const passage = tidy(text);
    if (!passage) throw new Error('Nothing selected');
    if (passage.length > MAX_TEXT) throw new Error('Selection too long');
    const source = sourceUrl(url);
    if (!source) throw new Error('Not a web page');
    const note = tidy(comment);
    const ctx = contextFor(passage, context);
    const tags = [['r', source, 'source']];
    if (ctx) tags.push(['context', ctx]);
    if (note) {
      tags.push(['comment', note]);
      for (const u of mentionedUrls(note, source)) tags.push(['r', u, 'mention']);
    }
    // NIP-31, for clients that do not know the kind: what this is, in one line.
    tags.push(['alt', 'Highlight from ' + source]);
    if (clientTag) tags.push(['client', 'Sidecar']);
    return {
      kind: KIND,
      created_at: Math.floor((now != null ? now : Date.now()) / 1000),
      tags,
      content: passage,
    };
  }

  const api = { KIND, MAX_TEXT, MAX_CONTEXT, tidy, sourceUrl, tooLong, contextFor, mentionedUrls, buildTemplate };
  if (typeof self !== 'undefined') self.SidecarHighlight = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarHighlight = api;
})();
