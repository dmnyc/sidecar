'use strict';

// Notification marks: bundled SVG for the kind, the sender's own emoji for a reaction.
//
// Emoji are rendered by the OS. They carry their own colors, so they ignore the theme,
// and they differ between platforms — the same notification is a flat glyph on one
// machine and a glossy 3D badge on another. The zap had already moved for this reason
// (boltIcon, because ⚡ washed out on light themes); repost and reply had not.
//
// The line that matters: a REACTION's emoji is CONTENT. If someone reacts 🎉, replacing
// it with a generic heart loses what they said. Only the marks Sidecar chooses for
// itself become icons.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

const ctx = {
  console, JSON, Number, Math, String, parseInt,
  WEB_COMMENT_KIND: 1111,
  fmtSats: (n) => Math.round(n).toLocaleString('en-US'),
};
vm.createContext(ctx);
vm.runInContext(
  [
    source.match(/const BOLT11_MSAT = \{[^}]*\};/)[0],
    lift('function msatsFromBolt11('),
    lift('function zapAmountText('),
    lift('function zapMsats('),
    lift('function notifLabel('),
    'globalThis.notifLabel = notifLabel;',
  ].join('\n'),
  ctx
);
const { notifLabel } = ctx;

const ev = (kind, over = {}) => Object.assign({ kind, content: '', tags: [] }, over);

// ---- what Sidecar chooses becomes an icon -------------------------------------------

test('a repost is a bundled icon, not 🔁', () => {
  const l = notifLabel(ev(6));
  assert.equal(l.icon, 'repeat');
  assert.equal(l.glyph, undefined, 'no emoji left to render');
});

test('a reply is a bundled icon, not 💬', () => {
  const l = notifLabel(ev(1, { tags: [['e', 'abc']] }));
  assert.equal(l.icon, 'message-filled', 'solid: the stroked balloon washes out at 14px');
  assert.equal(l.glyph, undefined);
});

test('the solid balloon renders filled, not as a stroked outline', () => {
  // Filling a stroked path gives a muddy blob — Feather outlines have the stroke width
  // baked into their proportions, so a solid glyph needs its own path AND fill/stroke
  // swapped at render time.
  assert.match(source, /const FILLED_ICONS = new Set\(\[[^\]]*'message-filled'/);
  const fn = lift('function icon(');
  assert.match(fn, /FILLED_ICONS\.has\(name\)/);
  assert.match(fn, /fill="' \+ \(solid \? 'currentColor' : 'none'\)/);
  assert.match(fn, /stroke="' \+ \(solid \? 'none' : 'currentColor'\)/);
});

test('both icon names exist in the bundled set', () => {
  // A name that is not in ICONS renders an empty <svg> — a silently blank mark.
  const icons = source.match(/const ICONS = \{[\s\S]*?\n  \};/)[0];
  for (const name of ['repeat', 'message-filled']) {
    assert.ok(
      icons.includes("\n    " + name + ':') || icons.includes("\n    '" + name + "':"),
      name + ' is not in ICONS'
    );
  }
});

// ---- what the SENDER chose stays theirs ---------------------------------------------

test('A REACTION KEEPS THE SENDER’S EMOJI', () => {
  // The whole boundary. This is content, not decoration.
  assert.equal(notifLabel(ev(7, { content: '🎉' })).glyph, '🎉');
  assert.equal(notifLabel(ev(7, { content: '🔥' })).glyph, '🔥');
  assert.equal(notifLabel(ev(7, { content: '😂' })).glyph, '😂');
});

test('a reaction never becomes an icon', () => {
  for (const c of ['+', '-', '🎉', '', 'zap']) {
    assert.equal(notifLabel(ev(7, { content: c })).icon, undefined, JSON.stringify(c));
  }
});

test('the +/- conventions still map to their emoji', () => {
  assert.equal(notifLabel(ev(7, { content: '+' })).glyph, '❤️');
  assert.equal(notifLabel(ev(7, { content: '-' })).glyph, '👎');
  assert.equal(notifLabel(ev(7, { content: '' })).glyph, '❤️', 'empty means a like');
});

// ---- untouched ----------------------------------------------------------------------

test('the zap still uses the filled bolt, which was already an SVG', () => {
  const l = notifLabel(ev(9735));
  assert.equal(l.glyph, '⚡', 'the render site maps this to boltIcon and its gold treatment');
  assert.equal(l.icon, undefined);
});

test('the typographic marks are left alone', () => {
  // '@' and '❝' are text characters, not emoji: they already inherit the theme's text
  // color. ❝ was chosen deliberately because 🗨️ rendered near-black on the panel.
  assert.equal(notifLabel(ev(1)).glyph, '@', 'mention');
  assert.equal(notifLabel(ev(1111)).glyph, '@', 'web comment');
  assert.equal(notifLabel(ev(1, { tags: [['q', 'abc']] })).glyph, '❝', 'quote');
});

// ---- the render site -----------------------------------------------------------------

test('all three mark kinds are handled, in the right order', () => {
  const at = source.indexOf('const glyphEl = h(\'span\', { className: \'notif-glyph\' });');
  assert.ok(at !== -1, 'the glyph render site moved');
  const block = source.slice(at, at + 700);
  const icon = block.indexOf('if (glyphIcon)');
  const bolt = block.indexOf("glyph === '⚡'");
  const text = block.indexOf('glyphEl.textContent = glyph');
  assert.ok(icon !== -1 && bolt !== -1 && text !== -1, 'a branch is missing');
  assert.ok(icon < bolt && bolt < text, 'icon, then bolt, then the literal character');
});

test('the icon inherits currentColor so themes need no per-theme rule', () => {
  // The thing emoji cannot do, and the reason for the change.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(css, /\.notif-glyph svg \{[^}]*color: var\(--muted\)/);
});
