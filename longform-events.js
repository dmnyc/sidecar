'use strict';

// ---- what an article or a recipe publishes as ----
//
// Pure functions, no DOM and no relays: longform.js builds the forms and calls these to turn
// a draft into an unsigned kind 30023, and the tests load this file on its own.
//
// AN ARTICLE follows NIP-23. A RECIPE is an article too, written in Zap Cooking's format
// (MIT, zapcooking/frontend: createMarkdown in src/lib/parser.ts, newRecipeIdentifier in
// src/lib/coordinate.ts, withSourceAttribution and sourceUrl in src/lib/anonImport.ts, the
// tags in src/routes/create/+page.svelte). Their reader splits the content on the headings
// and matches the detail lines by their emoji labels, so those are copied to the character.
(function (root) {
  const KIND = 30023;
  const RECIPE_TAG = 'zapcooking';

  // AN ARTICLE'S ADDRESS: the title lowercased, every run of anything that is not a letter or
  // a digit turned into one hyphen, the ends trimmed. A title with nothing usable in it gets
  // a time-based one, so two such articles never land on the same address.
  function articleIdentifier(title, nowSec) {
    const slug = String(title || '').toLowerCase().normalize('NFC')
      .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
    return slug || 'post-' + nowSec;
  }

  // A NEW RECIPE'S ADDRESS is its title by the tag rule (tagSlug, below), so the title tag is
  // exactly `zapcooking-` + the address, which is how Zap Cooking's recipe page, its editor and
  // its printout tell the title tag from the categories: no match there and they skip every
  // category. Zap Cooking's older rule (lowercase, spaces to hyphens, colons dropped) kept the
  // rest of the punctuation and made addresses its own pages could not match. A recipe already
  // published keeps its address: an edit replaces it where it is. A title with nothing usable
  // in it gets a time-based address, as an article does.
  function recipeIdentifier(title, nowSec) {
    return tagSlug(title) || 'recipe-' + (nowSec || Math.floor(Date.now() / 1000));
  }

  // ONE RULE FOR EVERY HASHTAG THIS PUBLISHES (a recipe's title and categories, an article's
  // topics), the rule editor-matrix/recipes sets for every app: lowercase, spaces to hyphens,
  // and nothing but letters, marks and digits of any script, and hyphens. Punctuation in a tag
  // broke things: a client's tag link cut at a `?` or `&`, a typed #hashtag could not reach
  // `za’atar`, `'` and `’` made two tags of one word, and Zap Cooking's fork page took a
  // title tag with a colon for a category. "Za’atar & Mac: Take 2!" is `zaatar-mac-take-2`.
  // An empty result is no tag at all. The address (recipeIdentifier) keeps its own rule: an
  // edit must land where the recipe already is.
  function tagSlug(s) {
    return String(s == null ? '' : s).normalize('NFC').trim().toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{M}\p{N}-]/gu, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  // The `zapcooking-<x>` tag for a title or a category; '' when nothing of it is left.
  const recipeTag = (s) => { const slug = tagSlug(s); return slug ? RECIPE_TAG + '-' + slug : ''; };

  // A source link only when it is a plain http(s) address with no credentials in it.
  function sourceUrl(raw) {
    try {
      const url = new URL(String(raw || '').trim());
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
      url.hash = '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  // Zap Cooking's createMarkdown, section for section and newline for newline.
  function recipeMarkdown(rec) {
    const s = (v) => String(v || '').trim();
    const notes = s(rec.notes);
    const prep = s(rec.prep);
    const cook = s(rec.cook);
    const servings = s(rec.servings);
    const ingredients = (rec.ingredients || []).map((x) => `- ${s(x)}\n`).join('');
    const directions = (rec.directions || []).map((x, i) => `${i + 1}. ${s(x)}\n`).join('');
    const src = sourceUrl(rec.source);
    const more = src ? `Original recipe: <${src.replace(/</g, '%3C').replace(/>/g, '%3E')}>` : '';
    let md = '';
    if (notes) md += `\n## Chef's notes\n\n${notes}\n`;
    if (prep || cook || servings) {
      md += '\n## Details\n\n';
      if (prep) md += `- ⏲️ Prep time: ${prep}\n`;
      if (cook) md += `- 🍳 Cook time: ${cook}\n`;
      if (servings) md += `- 🍽️ Servings: ${servings}\n`;
    }
    if (ingredients) md += '\n## Ingredients\n\n' + ingredients;
    if (directions) md += '\n\n## Directions\n\n' + directions;
    if (more) md += `\n\n## Additional Resources\n\n${more}\n\n`;
    return md;
  }

  // An article. `d` and `publishedAt` are passed in, because an edit keeps both: the address
  // it replaces and the time it first went out. `extra` is the tags the caller adds after
  // these (client, the body's p tags, imeta for a described cover).
  function articleTemplate(art, { now, d, publishedAt, extra }) {
    const cover = (art.cover || [])[0];
    const topics = [...new Set((art.topics || []).map(tagSlug).filter(Boolean))];
    const summary = String(art.summary || '').trim();
    return {
      kind: KIND,
      created_at: now,
      tags: [
        ['d', d],
        ['title', String(art.title || '').trim()],
        ['published_at', String(publishedAt || now)],
        ...(summary ? [['summary', summary]] : []),
        ...(cover ? [['image', cover.url]] : []),
        ...topics.map((x) => ['t', x]),
        ...(extra || []),
      ],
      // Exactly as written: single newlines are markdown's soft breaks, and rewriting them
      // would make the published article differ from the one previewed.
      content: String(art.body || ''),
    };
  }

  // A recipe, with Zap Cooking's tags in Zap Cooking's order. published_at is NIP-23's, which
  // their reader ignores and every other long-form reader uses for the date.
  function recipeTemplate(rec, { now, d, publishedAt, extra }) {
    const title = String(rec.title || '').trim();
    const summary = String(rec.summary || '').trim();
    const src = sourceUrl(rec.source);
    const cats = [...new Set((rec.categories || []).map((c) => recipeTag(c)).filter(Boolean))];
    // The title tag is the address's, whatever the address is (a taken one gets -2), so the
    // two always match, as Zap Cooking's pages need.
    const address = d || recipeIdentifier(title, now);
    const titleTag = RECIPE_TAG + '-' + address;
    return {
      kind: KIND,
      created_at: now,
      tags: [
        ['d', address],
        ['title', title],
        ...(src ? [['r', src]] : []),
        ['t', RECIPE_TAG],
        ['t', titleTag],
        ...(summary ? [['summary', summary]] : []),
        ...(rec.photos || []).map((p) => ['image', p.url]),
        ...cats.map((x) => ['t', x]),
        ['published_at', String(publishedAt || now)],
        ...(extra || []),
      ],
      content: recipeMarkdown(rec),
    };
  }

  // The size a relay sees, near enough: the JSON of the event, in bytes. Relays commonly
  // refuse events over about 64 KB.
  function eventBytes(template) {
    return new TextEncoder().encode(JSON.stringify(template)).length;
  }

  // THE NEXT FREE ADDRESS when the one wanted is taken by a different article: -2, -3, ...
  function nextIdentifier(d, taken) {
    const set = new Set(taken);
    for (let n = 2; ; n++) if (!set.has(`${d}-${n}`)) return `${d}-${n}`;
  }

  const api = {
    KIND, RECIPE_TAG, articleIdentifier, recipeIdentifier, tagSlug, recipeTag, sourceUrl, recipeMarkdown,
    articleTemplate, recipeTemplate, eventBytes, nextIdentifier,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SidecarLongformEvents = api;
})(typeof self !== 'undefined' ? self : this);
