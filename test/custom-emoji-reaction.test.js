'use strict';

// Custom emoji reactions (NIP-30, #273).
//
// The benchmark: a real reaction from utxo the webmaster rendered as the literal text
// `:EZ:` in the bell. The panel never read the `emoji` tag that carries the picture.
//
// It failed two ways, depending on length. `:EZ:` is exactly four characters, so the old
// `r.length <= 4` test accepted it and printed the raw shortcode. `:shakingeyes:` is
// longer, failed that test, and fell through to a heart — which silently misstates what
// somebody did, and is the worse of the two.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

// notifLabel's kind:7 branch, lifted so the decision can be exercised directly.
function labeller() {
  const m = panel.match(/    if \(ev\.kind === 7\) \{[\s\S]*?\n    \}/);
  assert.ok(m, 'kind:7 branch not found');
  const ctx = { RegExp, Error };
  vm.createContext(ctx);
  vm.runInContext('this.label = function (ev) {\n' + m[0] + '\nreturn null; };', ctx);
  return ctx.label;
}
const label = labeller();

test('THE BENCHMARK: :EZ: resolves to its picture', () => {
  const r = label({
    kind: 7,
    content: ':EZ:',
    tags: [['emoji', 'EZ', 'https://example.com/ez.png']],
  });
  assert.equal(r.emojiUrl, 'https://example.com/ez.png');
  assert.equal(r.glyph, ':EZ:', 'the shortcode stays as the alt text and the fallback');
});

test('a longer shortcode is no longer reported as a heart', () => {
  // The worse failure: it does not look broken, it looks like something that did not
  // happen.
  const r = label({
    kind: 7,
    content: ':shakingeyes:',
    tags: [['emoji', 'shakingeyes', 'https://example.com/se.gif']],
  });
  assert.equal(r.emojiUrl, 'https://example.com/se.gif');
  assert.notEqual(r.glyph, '❤️');
});

test('NO TAG, NO GUESS', () => {
  // An unresolved shortcode is honest. A heart in its place is a false statement about
  // what someone did.
  const r = label({ kind: 7, content: ':EZ:', tags: [] });
  assert.equal(r.emojiUrl, '');
  assert.equal(r.glyph, ':EZ:');
  // And a tag for a different shortcode must not be borrowed.
  const other = label({ kind: 7, content: ':EZ:', tags: [['emoji', 'nope', 'https://x/y.png']] });
  assert.equal(other.emojiUrl, '');
});

test('the plain cases still work', () => {
  assert.equal(label({ kind: 7, content: '+', tags: [] }).glyph, '❤️');
  assert.equal(label({ kind: 7, content: '-', tags: [] }).glyph, '👎');
  assert.equal(label({ kind: 7, content: '🍸', tags: [] }).glyph, '🍸');
});

test('the length heuristic is gone, and it was wrong both ways', () => {
  // It rejected multi-codepoint emoji and accepted short words.
  assert.equal(label({ kind: 7, content: '👨‍👩‍👧', tags: [] }).glyph, '👨‍👩‍👧', 'eight code units, still an emoji');
  assert.equal(label({ kind: 7, content: 'lol', tags: [] }).glyph, '❤️', 'short text is not an emoji');
  // Comments stripped: the comment explaining why this heuristic is gone contains it,
  // which is the fifth time in one session a source guard has matched its own rationale.
  const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /r\.length <= 4/);
});

test('the image is treated like every other remote picture here', () => {
  const i = panel.indexOf("img.className = 'notif-glyph-img'");
  assert.notEqual(i, -1);
  const block = panel.slice(i, i + 400);
  assert.match(block, /referrerPolicy = 'no-referrer'/);
  assert.match(block, /img\.onerror = \(\) => \{ glyphEl\.textContent = glyph; \}/, 'a broken image falls back to the shortcode');
  assert.match(css, /\.notif-glyph-img \{/);
});
