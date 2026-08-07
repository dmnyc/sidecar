'use strict';

// Unit coverage for the Recent activity icon mapping in sidepanel.js.
//
// THE COMPLAINT (2026-08-05/06): every signed event showed the same feather. A
// screenshot of the Activity tab was nine "Signed relay auth" rows out of twelve,
// all with an identical quill — you couldn't see at a glance what you'd reacted to,
// reposted, or zapped. The *label* already distinguished them; the icon carried no
// information at all.
//
// These tests pin three things:
//   1. every named kind resolves to an icon that actually exists (a typo renders a
//      blank box, which is worse than the feather it replaced)
//   2. the feather still means authorship, not "signed something"
//   3. the icons users already recognise are used for the events they know

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function block(name, pattern) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + name + ' in sidepanel.js');
  return m[1];
}

// Parse the three maps straight out of the source. Running the whole panel needs a
// DOM; the mapping itself is plain data and is what actually broke.
const iconsSrc = block('ICONS', /const ICONS = \{([\s\S]*?)\n  \};/);
const kindIconsSrc = block('KIND_ICONS', /const KIND_ICONS = \{([\s\S]*?)\n  \};/);
const kindNamesSrc = block('KIND_NAMES', /const KIND_NAMES = \{([\s\S]*?)\n  \};/);

const ICON_NAMES = new Set(
  [...iconsSrc.matchAll(/^\s*'?([\w-]+)'?:\s*'/gm)].map((m) => m[1])
);
const KIND_ICONS = Object.fromEntries(
  [...kindIconsSrc.matchAll(/^\s*(\d+):\s*'([\w-]+)'/gm)].map((m) => [Number(m[1]), m[2]])
);
const KIND_NAMES = Object.fromEntries(
  [...kindNamesSrc.matchAll(/(\d+):\s*'([^']+)'/g)].map((m) => [Number(m[1]), m[2]])
);

// ---- nothing renders blank -------------------------------------------------------

test('every kind icon exists in the ICONS map', () => {
  // A name with no entry makes icon() emit an empty <svg> — an invisible box in the
  // list, strictly worse than the feather it replaced.
  const missing = Object.entries(KIND_ICONS)
    .filter(([, name]) => !ICON_NAMES.has(name))
    .map(([kind, name]) => `kind ${kind} → '${name}'`);
  assert.deepEqual(missing, [], 'unresolvable icon names');
});

test('every named kind has an icon', () => {
  const uncovered = Object.keys(KIND_NAMES)
    .map(Number)
    .filter((k) => !(k in KIND_ICONS))
    .map((k) => `${k} (${KIND_NAMES[k]})`);
  assert.deepEqual(uncovered, [], 'kinds that would fall back to the feather');
});

test('an unknown kind falls back to the feather rather than blank', () => {
  assert.match(source, /const KIND_ICON_DEFAULT = 'feather';/);
  assert.match(source, /KIND_ICONS\[e\.kind\] \|\| KIND_ICON_DEFAULT/,
    'a kind Sidecar has never seen must still render something');
});

// ---- the feather keeps its meaning ----------------------------------------------

test('the feather is reserved for authorship', () => {
  // If everything is a feather again, the icon column is back to carrying no
  // information. Only kinds where the user actually wrote prose should use it.
  const feathered = Object.entries(KIND_ICONS)
    .filter(([, name]) => name === 'feather')
    .map(([kind]) => Number(kind));
  assert.deepEqual(feathered, [1], 'only the plain note should be a feather');
});

test('the noisy machine kinds are NOT feathers', () => {
  // These are what flooded the log in the report. Each is a client housekeeping
  // signature, not something the user chose to write.
  for (const kind of [22242, 30078, 24133, 27235, 24242]) {
    assert.notEqual(KIND_ICONS[kind], 'feather',
      `kind ${kind} (${KIND_NAMES[kind]}) should not look like authorship`);
  }
});

// ---- the icons users already recognise ------------------------------------------

test('reposts, reactions and zaps use their conventional glyphs', () => {
  assert.equal(KIND_ICONS[6], 'repeat', 'repost');
  assert.equal(KIND_ICONS[7], 'heart', 'reaction');
  assert.equal(KIND_ICONS[9734], 'zap', 'zap request');
  assert.equal(KIND_ICONS[9321], 'zap', 'nutzap');
  assert.equal(KIND_ICONS[9041], 'zap', 'zap goal');
});

test('relay auth gets the broadcast tower, relay LISTS get wifi', () => {
  // These are different actions and were briefly conflated under one wifi glyph.
  // Authenticating TO a relay is a handshake — the tower reads as transmission.
  // Editing a list of relays is configuration, and wifi reads as connectivity.
  assert.equal(KIND_ICONS[22242], 'tower', 'relay auth — the kind that floods the log');
  for (const kind of [10002, 10006, 10007, 10012, 10050]) {
    assert.equal(KIND_ICONS[kind], 'wifi', `kind ${kind} (${KIND_NAMES[kind]}) is a list, not a handshake`);
  }
});

test('both Blossom kinds use the flower', () => {
  // Blossom's own mark is a blossom, so petals are the literal read — and it beats
  // the generic download arrow these had, which said nothing about the protocol.
  assert.equal(KIND_ICONS[24242], 'flower', 'blossom auth');
  assert.equal(KIND_ICONS[10063], 'flower', 'blossom servers');
});

test('the flower is the real Blossom mark, fitted to the box', () => {
  // Replaced the five circles I approximated it with. This is filled art on its own
  // 58.48x63.59 viewBox, so it needs a transform into the 24x24 box icon() supplies —
  // without one it would render at ~2.7x and be clipped to a corner fragment.
  const body = iconsSrc.match(/^\s*flower: '([^']*)'/m)[1];
  const t = body.match(/transform="translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)"/);
  assert.ok(t, 'the mark must be transformed into the 24-unit box');
  const [, tx, ty, scale] = t.map(Number);
  const w = 58.48 * scale, h = 63.59 * scale;
  assert.ok(tx >= 0 && ty >= 0 && tx + w <= 24 && ty + h <= 24,
    `spans ${tx.toFixed(1)}..${(tx + w).toFixed(1)} x ${ty.toFixed(1)}..${(ty + h).toFixed(1)} — outside the box`);
  // And it should carry the tower's weight: that reaches y 1.6..22, so ~20 units.
  assert.ok(h > 18, `only ${h.toFixed(1)} units tall — reads small beside the tower`);
});

test('the filled Blossom mark still follows the theme colour', () => {
  // icon() sets fill:none stroke=currentColor, which renders a filled path invisible.
  // The mark has to opt into fill="currentColor" — a literal colour would pin it and
  // stop the five themes from recolouring it.
  const body = iconsSrc.match(/^\s*flower: '([^']*)'/m)[1];
  assert.match(body, /fill="currentColor"/, 'a filled glyph needs an explicit fill');
  assert.match(body, /stroke="none"/, 'and must not also be stroked, which doubles the outline');
});

test('app data is a stored record, not a settings gear', () => {
  // Kind 30078 is NIP-78 app-scoped storage — a client persisting its own state
  // (feed prefs, sync markers). A gear implies the user opened a settings screen and
  // changed something, which is not what happened; reported as looking wrong.
  assert.equal(KIND_ICONS[30078], 'copy');
});

test('HTTP auth is a globe, not a login arrow', () => {
  // NIP-98 signs an HTTP request to prove identity to a WEB SERVER. A login arrow
  // implies entering an app, which is not what happened — reported as making no
  // sense in the log.
  assert.equal(KIND_ICONS[27235], 'globe');
});

test('destructive kinds are visually distinct', () => {
  assert.equal(KIND_ICONS[5], 'trash', 'deletion');
  assert.equal(KIND_ICONS[62], 'trash', 'vanish request');
  assert.equal(KIND_ICONS[10000], 'user-x', 'mute list');
});

test('long-form writing is a document, not a note', () => {
  assert.equal(KIND_ICONS[30023], 'file-text', 'article');
  assert.equal(KIND_ICONS[30818], 'file-text', 'wiki article');
});

test('the comment kind uses the same bubble as the compose button', () => {
  // 1111 is what the "Comment on this page" feature publishes; the topbar button
  // for it is a message-circle, so the log should agree.
  assert.equal(KIND_ICONS[1111], 'message-circle');
});

// ---- the icon field can be a function -------------------------------------------

test('signEvent resolves its icon per event, others stay strings', () => {
  const meta = source.match(/const METHOD_META = \{([\s\S]*?)\n  \};/)[1];
  assert.match(meta, /icon: \(e\) => KIND_ICONS\[e\.kind\]/,
    'signEvent must pick an icon from the event');
  assert.match(meta, /getPublicKey: \{ icon: 'key'/, 'non-sign methods keep a fixed icon');
});

test('activityRow handles both a function and a string', () => {
  // signEvent's icon is now a function while every other entry is a string. Passing
  // the function straight to icon() would look up ICONS[<function>] and render blank.
  const fn = source.match(/function activityRow\(e\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /typeof meta\.icon === 'function' \? meta\.icon\(e\) : meta\.icon/);
  assert.match(fn, /icon\(iconName \|\| 'feather'\)/, 'and still guards against undefined');
});

// ---- the icon set itself ---------------------------------------------------------

test('no duplicate keys in ICONS', () => {
  // A duplicate silently shadows the earlier entry, so one icon quietly becomes
  // another. Object literals accept it without complaint.
  const all = [...iconsSrc.matchAll(/^\s*'?([\w-]+)'?:\s*'/gm)].map((m) => m[1]);
  const seen = new Set();
  const dupes = all.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
  assert.deepEqual(dupes, [], 'duplicate icon keys');
});

test('no icon carries its own viewBox or a hard-coded colour', () => {
  // icon() wraps every body in <svg viewBox="0 0 24 24" fill="none"
  // stroke="currentColor" stroke-width="2">. Art pasted in from a design tool is
  // usually FILLED geometry on its own viewBox — dropped in as-is it renders as a
  // hollow outline of itself, in the wrong box, and ignores the theme colour. Icons
  // have to be redrawn as stroke centre-lines on the 24x24 grid.
  //
  // fill="currentColor" is allowed and used deliberately by the dot glyphs (`more`,
  // `grip`), which have to be solid. Anything else pins a colour the themes can't
  // override.
  const offenders = [];
  for (const [, name, body] of iconsSrc.matchAll(/^\s*'?([\w-]+)'?:\s*'([^']*)'/gm)) {
    if (/viewBox=/.test(body)) offenders.push(name + ' (own viewBox)');
    for (const p of body.matchAll(/\b(fill|stroke)="([^"]*)"/g)) {
      if (p[2] !== 'currentColor' && p[2] !== 'none') {
        offenders.push(`${name} (${p[1]}="${p[2]}")`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'icons carrying their own viewBox or a fixed colour');
});

test('icon geometry stays inside the 24x24 box with room for the stroke', () => {
  // stroke-width 2 means the ink extends 1 unit past every centre-line, so a circle
  // at cy=12 r=11.5 would clip. Only circles are checked — their bounds are exact
  // and they are what the hand-drawn icons here are built from.
  const bad = [];
  for (const [, name, body] of iconsSrc.matchAll(/^\s*'?([\w-]+)'?:\s*'([^']*)'/gm)) {
    for (const c of body.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)) {
      const [cx, cy, r] = [+c[1], +c[2], +c[3]];
      if (cx - r - 1 < 0 || cx + r + 1 > 24 || cy - r - 1 < 0 || cy + r + 1 > 24) {
        bad.push(`${name}: circle(${cx},${cy},r${r})`);
      }
    }
  }
  assert.deepEqual(bad, [], 'geometry that clips at stroke-width 2');
});

test('every icon body is renderable SVG content', () => {
  // icon() drops the string inside <svg viewBox="0 0 24 24">…</svg> — anything that
  // isn't an element would produce an empty box.
  const bad = [...iconsSrc.matchAll(/^\s*'?([\w-]+)'?:\s*'([^']*)'/gm)]
    .filter(([, , body]) => !/^<(g|path|circle|line|polyline|polygon|rect|ellipse)\b/.test(body.trim()))
    .map(([, name]) => name);
  assert.deepEqual(bad, [], 'icon bodies that do not start with an SVG shape');
});
