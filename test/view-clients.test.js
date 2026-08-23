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
const js = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
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
    // The builders append the bech32, so each prefix has to end at a boundary
    // where concatenation produces a real path rather than a mangled one.
    assert.ok(/[/#]$/.test(c.url), c.key + ' note URL must end at a path boundary: ' + c.url);
    assert.ok(/[/#]$/.test(c.profile), c.key + ' profile URL must end at a path boundary: ' + c.profile);
  }
});

// Routes verified against each client rather than assumed: both of these are
// single-page apps where a wrong guess still renders something, so the paths
// were read from the router (JANK) or confirmed by every other candidate
// returning a real 404 (Nostrich).
const PINNED = [
  { key: 'jank', label: 'JANK', url: 'https://jank.army/notes/', profile: 'https://jank.army/users/' },
  { key: 'nostrich', label: 'Nostrich', url: 'https://nostrich.org/e/', profile: 'https://nostrich.org/p/' },
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
