'use strict';

// The "view notes in" client list lives in two places that must agree:
// VIEW_CLIENTS in sidepanel.js maps a key to its URL builders, and a hardcoded
// <select> in sidepanel.html is what the user actually picks from.
//
// Nothing generates one from the other, so adding a client to just one side is a
// silent half-change: an entry in the JS that cannot be selected, or an option
// in the dropdown that falls back to the default the moment it is used. Neither
// throws, and neither is visible without opening Settings and trying it.
//
// This pins them together — same keys, same order, same labels — so the next
// client added has to land on both surfaces or fail here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// The client directory moved to composer-core.js: the panel's post banner and the
// expanded composer's confirmation ask the same question, so they read one list. Both
// files are the panel's source as far as these assertions are concerned.
const js = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8') +
  '\n' + fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');

function jsClients() {
  const block = js.match(/const VIEW_CLIENTS = \{[\s\S]*?\n  \};/);
  assert.ok(block, 'VIEW_CLIENTS not found in sidepanel.js');
  const out = [];
  const re = /^\s{4}([a-z0-9]+):\s*\{\s*label:\s*'([^']+)'[\s\S]*?url:\s*\(ne\)\s*=>\s*'([^']+)'[\s\S]*?profile:\s*\(np\)\s*=>\s*'([^']+)'/gm;
  let m;
  while ((m = re.exec(block[0]))) out.push({ key: m[1], label: m[2], url: m[3], profile: m[4] });
  return out;
}

function htmlOptions() {
  const sel = html.match(/<select id="client-select">[\s\S]*?<\/select>/);
  assert.ok(sel, 'client-select not found in sidepanel.html');
  const out = [];
  const re = /<option value="([^"]+)">([^<]+)<\/option>/g;
  let m;
  while ((m = re.exec(sel[0]))) out.push({ key: m[1], label: m[2] });
  return out;
}

test('every client in the dropdown exists in VIEW_CLIENTS', () => {
  const keys = new Set(jsClients().map((c) => c.key));
  for (const opt of htmlOptions()) {
    assert.ok(keys.has(opt.key), `<option value="${opt.key}"> has no VIEW_CLIENTS entry — picking it would silently fall back to the default`);
  }
});

test('every client in VIEW_CLIENTS is offered in the dropdown', () => {
  const keys = new Set(htmlOptions().map((o) => o.key));
  for (const c of jsClients()) {
    assert.ok(keys.has(c.key), `VIEW_CLIENTS.${c.key} is not in the dropdown — nobody can choose it`);
  }
});

test('the two lists agree on order and labels', () => {
  const a = jsClients().map((c) => c.key + ':' + c.label);
  const b = htmlOptions().map((o) => o.key + ':' + o.label);
  assert.deepEqual(b, a, 'dropdown and VIEW_CLIENTS differ in order or labels');
});

test('the default client is one of them', () => {
  const m = js.match(/const DEFAULT_CLIENT = '([a-z0-9]+)';/);
  assert.ok(m, 'DEFAULT_CLIENT not found');
  assert.ok(jsClients().some((c) => c.key === m[1]), 'DEFAULT_CLIENT is not in VIEW_CLIENTS');
  assert.ok(htmlOptions().some((o) => o.key === m[1]), 'DEFAULT_CLIENT is not in the dropdown');
});

test('every client URL is https and carries the identifier', () => {
  for (const c of jsClients()) {
    assert.ok(c.url.startsWith('https://'), c.key + ' note URL must be https');
    assert.ok(c.profile.startsWith('https://'), c.key + ' profile URL must be https');
    // The builders append the bech32, so each prefix has to end at a boundary where
    // concatenation produces a real URL rather than a mangled one. Three are legal:
    // a path segment (/), a fragment (#), and a query value (=). The last one because a
    // client can take the identifier as a parameter rather than a path. Grimoire is a
    // command line, `run?cmd=open <bech32>`, so its prefix ends at the `=`.
    const boundary = /[/#=]$/;
    assert.ok(boundary.test(c.url), c.key + ' note URL must end at a path, fragment or query boundary: ' + c.url);
    assert.ok(boundary.test(c.profile), c.key + ' profile URL must end at a path, fragment or query boundary: ' + c.profile);
  }
});

// Routes verified against each client rather than assumed: both of these are
// single-page apps where a wrong guess still renders something, so the paths
// were read from the router (JANK) or confirmed by every other candidate
// returning a real 404 (Nostrich).
const PINNED = [
  { key: 'jank', label: 'JANK', url: 'https://jank.army/notes/', profile: 'https://jank.army/users/' },
  { key: 'nostrich', label: 'Nostrich', url: 'https://nostrich.org/e/', profile: 'https://nostrich.org/p/' },
  // Razr's router was read the same way: /e/:noteId, /p/:npub and /a/:naddr, with its own
  // links written as /e/note1… and /e/naddr…. Note the trap that makes reading the router
  // necessary: razr.social answers 200 text/html on ANY path, so "the URL works" proves
  // nothing there.
  { key: 'razr', label: 'Razr', url: 'https://razr.social/e/', profile: 'https://razr.social/p/' },
  // Grimoire has no routes to pin: it is a command line, and both builders end at the
  // same `?cmd=`. What distinguishes them is the verb, which the test below covers.
  { key: 'grimoire', label: 'Grimoire', url: 'https://grimoire.rocks/run?cmd=', profile: 'https://grimoire.rocks/run?cmd=' },
];

for (const want of PINNED) {
  test(want.label + ' is registered on both surfaces with the verified routes', () => {
    const got = jsClients().find((c) => c.key === want.key);
    assert.ok(got, want.label + ' missing from VIEW_CLIENTS');
    assert.equal(got.label, want.label);
    assert.equal(got.url, want.url);
    assert.equal(got.profile, want.profile);
    assert.ok(
      htmlOptions().some((o) => o.key === want.key && o.label === want.label),
      want.label + ' missing from the dropdown'
    );
  });
}

// ---- the two that do not append a bech32 to a path -------------------------------------

test('GRIMOIRE SENDS A COMMAND, AND THE TWO VERBS DIFFER', () => {
  // `open <bech32>` resolves a note, an nevent and a naddr into the same viewer, since
  // all three are cases in its own decoder, while a profile has its own verb, which is the
  // command Grimoire builds for itself. Pinning only the shared `?cmd=` prefix would let
  // the two swap without anything noticing.
  const block = js.match(/grimoire: \{[\s\S]*?\n    \},/);
  assert.ok(block, 'the Grimoire entry moved');
  assert.match(block[0], /encodeURIComponent\('open ' \+ ne\)/, 'the note builder lost its verb');
  assert.match(block[0], /encodeURIComponent\('profile ' \+ np\)/, 'the profile builder lost its verb');
  // Encoded, because the command has a space in it.
  assert.equal((block[0].match(/encodeURIComponent/g) || []).length, 2, 'a command is being sent raw');
});

test('RAZR IS HANDED THE note1 ITS OWN LINKS CARRY', () => {
  // /e/ is known to take a note1 and a naddr, because those are what Razr writes for
  // itself (its ids go through encodeNote). An nevent is not known to decode there, so it
  // is reduced rather than sent hopefully. The hints in an nevent are the cost.
  const fn = js.match(/function razrEntity\(entity\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, 'razrEntity is gone: is an nevent being passed to /e/ unreduced?');
  assert.match(fn[0], /d\.type === 'nevent'/, 'the reduction no longer keys on an nevent');
  assert.match(fn[0], /NT\.nip19\.noteEncode\(d\.data\.id\)/, 'an nevent is not reduced to a note1');
  // A naddr must pass through untouched: Razr routes those to /e/ as well, and
  // re-encoding one as a note would point at nothing.
  assert.match(fn[0], /return entity;/, 'anything that is not an nevent must go through unchanged');
  assert.match(js, /url: \(ne\) => 'https:\/\/razr\.social\/e\/' \+ razrEntity\(ne\)/, 'the entry stopped reducing');
});
