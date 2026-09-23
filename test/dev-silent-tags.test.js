'use strict';

// SILENT p TAGS: a dev-build fixture generator, not a feature.
//
// A p tag with no mention in the content notifies somebody while the note says nothing
// about why. That is precisely the shape of the reply spam Sidecar's own notification
// filter exists to demote, which is why this lives behind the dev build and has no
// setting a store build can reach. The gate is the point of most of this file.
//
// The other half is the parser. It turns typed text into tags pointing at real people,
// so anything it cannot read must be DROPPED rather than guessed at: a tag aimed at the
// wrong key is worse than no tag at all, and nothing in the note would reveal it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const bare = panel.replace(/^\s*\/\/.*$/gm, '');

// ---- the parser, lifted and run against real nostr-tools ----

// The vendored bundle is a browser IIFE, not a CommonJS module: evaluate it and take
// the global it defines, the same way the other tests here reach it.
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'),
  { filename: 'nostr-tools.js' });
const NT = globalThis.NostrTools;
assert.ok(NT && NT.nip19, 'the vendored nostr-tools did not expose nip19');
const ctx = { String, Set, NT };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  panel.match(/function parseSilentTags\(text\)[\s\S]*?\n    \}/)[0] + ';globalThis.f = parseSilentTags;',
  ctx
);
// Spread back into THIS realm's Array. The function builds its result inside the vm
// context, so its prototype is that realm's Array and deepStrictEqual rejects it on
// prototype alone, with the values printing identically. Nothing to do with the parser.
const parse = (t) => [...ctx.f(t)];

const HEX_A = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
const HEX_B = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';
const NPUB_A = NT.nip19.npubEncode(HEX_A);

test('IT READS npub AND HEX, AND DEDUPES ACROSS THE TWO', () => {
  assert.deepEqual(parse(NPUB_A), [HEX_A]);
  assert.deepEqual(parse(HEX_A), [HEX_A]);
  assert.deepEqual(parse('nostr:' + NPUB_A), [HEX_A], 'a copied nostr: URI is the common paste');
  assert.deepEqual(parse(HEX_A.toUpperCase()), [HEX_A], 'hex is normalized, or it dedupes wrong');

  // Whitespace, commas and newlines all separate, because a list gets pasted from
  // anywhere. The same key twice in two spellings is one tag.
  assert.deepEqual(parse(HEX_A + ', ' + HEX_B), [HEX_A, HEX_B]);
  assert.deepEqual(parse(NPUB_A + '\n' + HEX_A), [HEX_A], 'npub and its own hex are one key');
});

test('ANYTHING IT CANNOT READ IS DROPPED, NEVER GUESSED AT', () => {
  // Each of these could become a tag aimed at somebody who was never meant to be
  // notified, and nothing in the published note would show it.
  for (const bad of [
    '', '   ', 'hello', 'npub1', 'npub1notrealbech32',
    HEX_A.slice(0, 63),               // one short
    HEX_A + 'ff',                     // one long
    'g'.repeat(64),                   // not hex
    NT.nip19.noteEncode(HEX_A),       // a note id is not a person
    null, undefined,
  ]) {
    assert.deepEqual(parse(bad), [], 'expected nothing from ' + JSON.stringify(bad));
  }
  // And a bad token among good ones drops only itself.
  assert.deepEqual(parse('garbage ' + HEX_A + ' npub1bogus'), [HEX_A]);
});

test('THE GATE IS THE BUILD, NOT A SETTING A STORE BUILD CAN REACH', () => {
  // Three checks, matching the kind override beside it: the build, the flag read when
  // the composer opened, and the setting re-read at publish. The last matters because a
  // composer can sit open for a long time and this is the control whose effect is
  // invisible in what it produces.
  assert.match(bare, /const silentP = isDevBuild\(\) && devSilentEnabled && settings\?\.devSilentTags === true/);
  // The control itself refuses to build outside a dev build.
  const fn = bare.slice(bare.indexOf('function buildDevSilentTags()'));
  assert.match(fn.slice(0, 120), /if \(!isDevBuild\(\) \|\| !devSilentEnabled\) return null;/);
  // And it is not mounted either.
  assert.match(bare, /isDevBuild\(\) && devSilentEnabled \? \[buildDevSilentTags\(\)\] : \[\]/);
  // No settings-page switch: the ONLY way to turn this on is the bug badge's Dev tools,
  // which initDevBadge hides on a store build.
  const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  assert.doesNotMatch(html, /devSilentTags|silent-tag/i, 'a store-reachable switch for this exists');
});

test('THE TAGS ARE ADDITIVE, AND CHANGE NOTHING ELSE', () => {
  // A key already tagged for a reason (threading, or a mention in the body) keeps its
  // one tag and its position. A silent tag is additive or it is nothing.
  assert.match(bare, /\.filter\(\(hex\) => !already\.has\(hex\) && !bodyP\.some\(\(t\) => t\[1\] === hex\)\)/);
  // Present in BOTH tag assemblies, or turning the client tag off would drop them.
  const both = bare.match(/\.\.\.bodyP, \.\.\.silentP/g) || [];
  assert.equal(both.length, 2, 'silentP should ride in both branches, found ' + both.length);

  // AND IT MUST NOT TOUCH THE CONTENT. That is the entire point: the note reads exactly
  // as written. Nothing on this path may append to or rewrite the body.
  const at = bare.indexOf('const silentP = isDevBuild()');
  const region = bare.slice(at, at + 400);
  assert.doesNotMatch(region, /content/, 'the silent-tag path touches the content');
});

test('the author can see what the reader will not', () => {
  // Everything else in Preview is what a reader sees; this is the opposite. A control
  // whose whole effect is hidden needs one place the author can check before posting.
  assert.match(bare, /textContent: 'Silent p tags: ' \+ n \+ '\. Notified, not mentioned in the text\.'/);
  assert.match(bare, /if \(isDevBuild\(\) && devSilentEnabled\) \{/);
});
