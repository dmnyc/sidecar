'use strict';

// Unit coverage for relayIconCandidates() — the ordered list of URLs a relay row tries
// before falling back to the wifi glyph.
//
// A relay list is a column of near-identical wss:// strings, so the icon is what makes
// it scannable. Two sources, best first: NIP-11's declared `icon` field, then the
// favicon paths Jumble tries. The ordering is the whole behavior, and it is pure, so it
// is the part worth pinning down.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl + ' in sidepanel.js');
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

const ctx = { console, URL, Set, Array };
vm.createContext(ctx);
vm.runInContext(
  [
    source.match(/const FAVICON_PATHS = \[[^\]]*\];/)[0],
    lift('function relayIconCandidates('),
    'globalThis.rawCandidates = relayIconCandidates;',
    'globalThis.PATHS = [...FAVICON_PATHS];',
  ].join('\n'),
  ctx
);

// Spread on the HOST side. An array built inside the vm has the vm's Array prototype,
// and assert.deepEqual (strict) compares prototypes — so a correct result fails with
// "same structure but not reference-equal".
const candidates = (u, d) => [...ctx.rawCandidates(u, d)];
const PATHS_LEN = [...ctx.PATHS].length;

// ---- the fallback chain --------------------------------------------------------

test('wss becomes https for the icon host', () => {
  const c = candidates('wss://nos.lol');
  assert.equal(c[0], 'https://nos.lol/favicon.ico');
});

test('a declared NIP-11 icon is tried before any favicon guess', () => {
  const c = candidates('wss://nos.lol', 'https://cdn.example/relay.png');
  assert.equal(c[0], 'https://cdn.example/relay.png', 'the operator’s choice beats a guess');
  assert.equal(c[1], 'https://nos.lol/favicon.ico');
});

test('the favicon paths keep Jumble’s order', () => {
  const c = candidates('wss://nos.lol');
  assert.deepEqual(c, [
    'https://nos.lol/favicon.ico',
    'https://nos.lol/favicon.svg',
    'https://nos.lol/favicon.png',
    'https://nos.lol/apple-touch-icon.png',
  ]);
});

test('a relay path or query never leaks into the icon URL', () => {
  // filter.nostr.wine publishes NIP-65 entries carrying a whole query string.
  const c = candidates('wss://filter.nostr.wine/npub1xyz?broadcast=true');
  c.forEach((u) => assert.ok(!u.includes('npub1xyz') && !u.includes('broadcast')));
  assert.equal(c[0], 'https://filter.nostr.wine/favicon.ico');
});

test('a port survives, because it is part of the origin', () => {
  assert.equal(candidates('wss://localhost:7777')[0], 'https://localhost:7777/favicon.ico');
});

test('a duplicate declared icon is not tried twice', () => {
  const c = candidates('wss://nos.lol', 'https://nos.lol/favicon.ico');
  assert.equal(c.length, PATHS_LEN, 'the declared icon collapsed into the favicon entry');
  assert.equal(new Set(c).size, c.length);
});

// ---- what must NOT be requested -------------------------------------------------

test('an http icon declared over NIP-11 is refused', () => {
  const c = candidates('wss://nos.lol', 'http://insecure.example/icon.png');
  assert.ok(
    !c.some((u) => u.startsWith('http://')),
    'the panel is https; an http image is mixed content and would be blocked anyway'
  );
});

test('a data: or javascript: icon is refused', () => {
  ['data:image/png;base64,AAAA', 'javascript:alert(1)'].forEach((bad) => {
    const c = candidates('wss://nos.lol', bad);
    assert.ok(!c.includes(bad), bad + ' must not reach an img src');
  });
});

test('a relay URL that will not parse yields nothing rather than throwing', () => {
  assert.deepEqual(candidates('not a url'), []);
  assert.deepEqual(candidates(''), []);
});

// ---- source guards --------------------------------------------------------------

// Comment stripping, line-based ON PURPOSE.
//
// The obvious /\/\*[\s\S]*?\*\// sweep is unusable against this file: a comment on
// sidepanel.js:7727 mentions the host permission "(https://*/*)", whose "/*" opens a
// block comment that then runs to the next "*/" 160k characters later. More than half
// the source vanishes and every doesNotMatch below passes vacuously.
//
// Dropping whole-line comments is enough here — the prose that trips these guards is
// always on its own line — and it cannot eat code.
function stripComments(src) {
  return src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join('\n');
}

const body = stripComments(source);

test('the NIP-11 read is deduplicated per host', () => {
  // A repaint rebuilds every row. Without the in-flight map, a list of eight relays
  // re-reads eight documents on each repaint, and the editor repaints on every
  // checkbox click.
  const fn = lift('async function ensureRelayIcon(');
  assert.match(fn, /relayIconInflight\.has\(host\)/);
  assert.match(fn, /relayIconInflight\.set\(host/);
});

test('a relay with no icon is remembered as having none', () => {
  // '' is a real answer. Storing it as "unknown" would re-read the document forever for
  // exactly the relays that have nothing to show.
  const fn = lift('async function ensureRelayIcon(');
  assert.match(fn, /relayIconCache\.has\(host\)/, "has(), not get() — '' is falsy");
  assert.match(fn, /rememberRelayIcon\(host, declared\)/);
  assert.doesNotMatch(fn, /if \(declared\) *(await )?rememberRelayIcon/, 'that would skip the negative');
});

test('the row still renders before the document arrives', () => {
  // The favicon chain starts immediately; NIP-11 only sharpens it. Waiting on the fetch
  // would leave every row blank for the length of a 5s NIP-11 timeout.
  const fn = lift('function relayIconEl(');
  const firstTry = fn.indexOf('tryFrom(relayIconCandidates(relayUrl, relayIconCache.get(host)))');
  const fetchIt = fn.indexOf('ensureRelayIcon(relayUrl)');
  assert.ok(firstTry !== -1 && firstTry < fetchIt, 'paint first, then refine');
});

test('the icon image is loaded without a referrer', () => {
  const fn = lift('function relayIconEl(');
  assert.match(fn, /referrerPolicy: 'no-referrer'/, 'do not tell a relay host which page asked');
});

test('the icon cache write is serialized like the NIP-65 store', () => {
  // Same read-modify-write hazard: several rows resolve at once and each rewrites the
  // whole object, so an unserialized set() drops the other rows' icons.
  assert.match(body, /relayIconWrites = relayIconWrites\.then\(/);
});
