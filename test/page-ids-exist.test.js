'use strict';

// Every literal $('id') a page script looks up must exist in that page's HTML (or be
// created by the script with that id). A missing id is null at runtime, and the
// approval card is where that hurt: the panel's scope row read
// $('approval-scope-relax').checked from inputs that had no ids, so the render threw
// partway through and the 30-minute and Always choices silently signed once. Nothing
// else flagged it: the free-identifier test checks names, not elements.
//
// A wiring pin, not behavior: it only proves each lookup has something to find.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PAGES = ['sidepanel', 'prompt', 'compose', 'highlight'];

for (const page of PAGES) {
  test(`every $('id') in ${page}.js names an element ${page}.html (or the script) provides`, () => {
    const js = fs.readFileSync(path.join(ROOT, page + '.js'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, page + '.html'), 'utf8');
    const inHtml = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const made = new Set([
      ...[...js.matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1]),
      ...[...js.matchAll(/\.id\s*=\s*'([^']+)'/g)].map((m) => m[1]),
    ]);
    const refs = [...new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]))];
    assert.ok(refs.length > 0, `no $('id') lookups found in ${page}.js`);
    const missing = refs.filter((id) => !inHtml.has(id) && !made.has(id));
    assert.deepEqual(missing, [], `${page}.js looks up ids that nothing provides`);
  });
}

test('the panel scope row ids are on the radios themselves', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  for (const v of ['once', 'relax', 'always']) {
    assert.match(html, new RegExp(`<input type="radio" name="approval-scope" value="${v}" id="approval-scope-${v}"`),
      `the ${v} radio carries id approval-scope-${v}`);
  }
});
