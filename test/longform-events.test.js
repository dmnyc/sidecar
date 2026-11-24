'use strict';

// The events an article and a recipe publish as (longform-events.js), loaded on their own.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../longform-events.js');

test('an article address is the title as a slug, or a time-based one when nothing is left', () => {
  assert.equal(E.articleIdentifier('Why Nostr: A Field Guide!', 1), 'why-nostr-a-field-guide');
  assert.equal(E.articleIdentifier('  Café   au lait — 2026 ', 1), 'café-au-lait-2026');
  assert.equal(E.articleIdentifier('!!!', 1795125778), 'post-1795125778');
  assert.equal(E.articleIdentifier('', 7), 'post-7');
});

test('a new recipe\'s address is its title by the tag rule, or a time-based one when nothing is left', () => {
  assert.equal(E.recipeIdentifier('Grandma\'s Pie: The Best'), 'grandmas-pie-the-best');
  assert.equal(E.recipeIdentifier('!!!', 1700000000), 'recipe-1700000000');
  assert.equal(E.recipeTag('Raw Vegan'), 'zapcooking-raw-vegan');
});

// Zap Cooking's recipe page, editor and printout tell the title tag from the categories by
// finding `zapcooking-` + the address; with no match they skip every category. So the two
// must match, for a taken address (-2) and a title with nothing usable in it too.
test('the title tag is always zapcooking- plus the address', () => {
  const base = { summary: '', notes: '', prep: '', cook: '', servings: '', ingredients: ['x'], directions: ['y'], categories: ['Soup'], photos: [], source: '' };
  for (const [title, d] of [['Za’atar & Mac: Take 2!', undefined], ['Soup', 'soup-2'], ['!!!', undefined]]) {
    const ev = E.recipeTemplate({ ...base, title }, { now: 1700000000, d, publishedAt: 1, extra: [] });
    const address = ev.tags.find((x) => x[0] === 'd')[1];
    const prefixed = ev.tags.filter((x) => x[0] === 't' && x[1].startsWith('zapcooking-')).map((x) => x[1]);
    assert.equal(prefixed[0], 'zapcooking-' + address, title);
    assert.ok(prefixed.includes('zapcooking-soup'), 'the category follows it');
  }
});

test('the recipe markdown is Zap Cooking\'s, section for section', () => {
  const md = E.recipeMarkdown({
    notes: 'Use cold butter.', prep: '20 min', cook: '1 hr', servings: '6',
    ingredients: ['2 cups flour', '1 cup butter'], directions: ['Mix.', 'Bake.'],
    source: 'https://example.com/pie#top',
  });
  assert.equal(md,
    "\n## Chef's notes\n\nUse cold butter.\n" +
    '\n## Details\n\n- ⏲️ Prep time: 20 min\n- 🍳 Cook time: 1 hr\n- 🍽️ Servings: 6\n' +
    '\n## Ingredients\n\n- 2 cups flour\n- 1 cup butter\n' +
    '\n\n## Directions\n\n1. Mix.\n2. Bake.\n' +
    '\n\n## Additional Resources\n\nOriginal recipe: <https://example.com/pie>\n\n');
  // Empty sections are left out, as theirs are.
  assert.equal(E.recipeMarkdown({ ingredients: ['salt'], directions: ['Season.'] }),
    '\n## Ingredients\n\n- salt\n\n\n## Directions\n\n1. Season.\n');
});

test('a source link must be plain http(s), without credentials', () => {
  assert.equal(E.sourceUrl('https://a.example/x?y=1#z'), 'https://a.example/x?y=1');
  assert.equal(E.sourceUrl('javascript:alert(1)'), '');
  assert.equal(E.sourceUrl('https://user:pw@a.example/'), '');
  assert.equal(E.sourceUrl('not a link'), '');
});

test('an article carries NIP-23 tags, its body exactly as written', () => {
  const ev = E.articleTemplate({
    title: ' Hello ', summary: 'Short.', cover: [{ url: 'https://i.example/c.jpg' }],
    topics: ['Nostr', '#nostr', 'Writing'], body: 'Line one\nline two',
  }, { now: 100, d: 'hello', publishedAt: 50, extra: [['client', 'Sidecar']] });
  assert.equal(ev.kind, 30023);
  assert.equal(ev.created_at, 100);
  assert.equal(ev.content, 'Line one\nline two');
  assert.deepEqual(ev.tags, [
    ['d', 'hello'], ['title', 'Hello'], ['published_at', '50'], ['summary', 'Short.'],
    ['image', 'https://i.example/c.jpg'], ['t', 'nostr'], ['t', 'writing'], ['client', 'Sidecar'],
  ]);
  // A first publish takes its own time as published_at, and empty fields add nothing.
  assert.deepEqual(E.articleTemplate({ title: 'T', body: 'b' }, { now: 9, d: 't' }).tags,
    [['d', 't'], ['title', 'T'], ['published_at', '9']]);
});

test('a recipe carries Zap Cooking\'s tags in their order', () => {
  const ev = E.recipeTemplate({
    title: 'Apple Pie', summary: 'Classic.', source: 'https://example.com/pie',
    photos: [{ url: 'https://i.example/1.jpg' }, { url: 'https://i.example/2.jpg' }],
    categories: ['Pie', 'Dessert', 'pie'], ingredients: ['apples'], directions: ['Bake.'],
  }, { now: 100, extra: [['client', 'Sidecar']] });
  assert.equal(ev.kind, 30023);
  assert.deepEqual(ev.tags, [
    ['d', 'apple-pie'], ['title', 'Apple Pie'], ['r', 'https://example.com/pie'],
    ['t', 'zapcooking'], ['t', 'zapcooking-apple-pie'], ['summary', 'Classic.'],
    ['image', 'https://i.example/1.jpg'], ['image', 'https://i.example/2.jpg'],
    ['t', 'zapcooking-pie'], ['t', 'zapcooking-dessert'],
    ['published_at', '100'], ['client', 'Sidecar'],
  ]);
  assert.match(ev.content, /## Ingredients\n\n- apples\n/);
});

test('a taken address moves to the next free number', () => {
  assert.equal(E.nextIdentifier('hello', ['hello']), 'hello-2');
  assert.equal(E.nextIdentifier('hello', ['hello', 'hello-2', 'hello-3']), 'hello-4');
});

test('size is the JSON in bytes', () => {
  assert.equal(E.eventBytes({ content: 'é' }), JSON.stringify({ content: 'é' }).length + 1);
});

// ONE TAG RULE, editor-matrix/recipes: lowercase, spaces to hyphens, only letters, marks and
// digits of any script, and hyphens. Punctuation in a tag broke client links at `?` and `&`,
// kept typed #hashtags from reaching it, and split `'` from `’`.
test('every hashtag is letters, marks, digits and hyphens, in any script', () => {
  const cases = {
    'Za’atar & Mac: Take 2!': 'zaatar-mac-take-2',
    "Za'atar": 'zaatar',
    'Mac & Cheese?': 'mac-cheese',
    'Café crème': 'café-crème',
    '日本料理': '日本料理',
    'मसाला दोसा': 'मसाला-दोसा',       // the vowel signs are marks, and stay
    '🍕 Pizza': 'pizza',
    '  Raw   Vegan  ': 'raw-vegan',
    '#Nostr': 'nostr',
    '!!!': '',
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(E.tagSlug(from), to, from);
});

test('a category with nothing left publishes no tag', () => {
  const ev = E.recipeTemplate({
    title: 'Soup: The Sequel?', summary: '', notes: '', prep: '', cook: '', servings: '',
    ingredients: ['water'], directions: ['Boil.'], categories: ['Soup', '!!!', 'Mom’s Best!'],
    photos: [{ url: 'https://example.com/s.jpg' }], source: '',
  }, { now: 1, publishedAt: 1, extra: [] });
  const t = ev.tags.filter((x) => x[0] === 't').map((x) => x[1]);
  assert.deepEqual(t, ['zapcooking', 'zapcooking-soup-the-sequel', 'zapcooking-soup', 'zapcooking-moms-best']);
  assert.equal(ev.tags.find((x) => x[0] === 'd')[1], 'soup-the-sequel', 'the address follows the tag rule');
});

test('an article\'s topics follow the same rule, and come once', () => {
  const ev = E.articleTemplate({ title: 'T', summary: '', body: 'b', cover: [], topics: ['#Nostr', 'nostr!', 'Lightning Network', '???'] },
    { now: 1, d: 't', publishedAt: 1, extra: [] });
  assert.deepEqual(ev.tags.filter((x) => x[0] === 't').map((x) => x[1]), ['nostr', 'lightning-network']);
});
