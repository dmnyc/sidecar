'use strict';

// THE RECIPE CONTRACT. Sidecar and Zap Cooking's web, iOS and Android apps publish the same
// recipes and keep their composers in step through editor-matrix/recipes: the exact events a
// recipe's fields publish as (fixtures.json) and the one list of categories with their emoji
// (categories.json). This holds Sidecar to both. It runs when editor-matrix sits beside this
// checkout (or EDITOR_MATRIX names it) and skips otherwise.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const EV = require('../longform-events.js');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(process.env.EDITOR_MATRIX || path.join(ROOT, '..', 'editor-matrix'), 'recipes');
const opts = { skip: fs.existsSync(path.join(DIR, 'fixtures.json')) ? false : 'editor-matrix is not beside this checkout' };

test('every fixture publishes exactly as editor-matrix says', opts, () => {
  const { cases } = JSON.parse(fs.readFileSync(path.join(DIR, 'fixtures.json'), 'utf8'));
  assert.ok(cases.length > 0);
  for (const c of cases) {
    const ev = EV.recipeTemplate(c.fields, { now: 1700000000, publishedAt: 1700000000, extra: [] });
    assert.deepEqual({ kind: ev.kind, tags: ev.tags, content: ev.content }, c.expect, c.name);
  }
});

test('the categories and their emoji are editor-matrix\'s list', opts, () => {
  const { categories } = JSON.parse(fs.readFileSync(path.join(DIR, 'categories.json'), 'utf8'));
  const src = fs.readFileSync(path.join(ROOT, 'longform.js'), 'utf8');
  // The names, in order, from the t() list the form suggests from.
  const list = src.slice(src.indexOf('const categoryNames = (t) => ['), src.indexOf('];', src.indexOf('const categoryNames = (t) => [')));
  const names = [...list.matchAll(/t\('((?:[^'\\]|\\.)*)'\)/g)].map((m) => m[1]);
  assert.deepEqual(names, categories.map((c) => c.name));
  // The emoji shown beside each.
  const block = src.match(/const CATEGORY_EMOJI = (\{[\s\S]*?\n  \});/)[1];
  const emoji = Function('return ' + block)();
  const want = Object.fromEntries(categories.filter((c) => c.emoji).map((c) => [c.name, c.emoji]));
  assert.deepEqual(emoji, want);
});
