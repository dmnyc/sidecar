'use strict';

// Which web client Sidecar opens a note or profile in was one global setting, so a
// second account borrowed the first account's habits. A client is where an identity
// lives — a brand account read in one place and a personal one in another is the
// normal case. Requested in #300.
//
// Per-account WITH A FALLBACK, not instead of the global. An account that has never
// chosen keeps following defaultClient, and changing the global still moves everyone
// who has not chosen for themselves. That is what makes this additive rather than a
// migration.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  let paren = 0;
  let i = source.indexOf('(', at);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

const CLIENTS = {
  primal: { label: 'Primal' }, jumble: { label: 'Jumble' }, iris: { label: 'Iris' },
};
function resolver() {
  const ctx = { console, VIEW_CLIENTS: CLIENTS, DEFAULT_CLIENT: 'primal' };
  vm.createContext(ctx);
  vm.runInContext(lift('function resolveClient(') + '\nglobalThis.out = resolveClient;', ctx);
  return ctx.out;
}

// ---- resolution ---------------------------------------------------------------------

test('an account with its own choice gets it', () => {
  const r = resolver();
  const s = { defaultClient: 'primal', defaultClientBy: { alice: 'jumble' } };
  assert.equal(r(s, 'alice').label, 'Jumble');
});

test('AN ACCOUNT WITHOUT ONE FOLLOWS THE GLOBAL', () => {
  // The fallback is the whole design. Without it this would be a migration that
  // silently reset everyone to the built-in default.
  const r = resolver();
  const s = { defaultClient: 'iris', defaultClientBy: { alice: 'jumble' } };
  assert.equal(r(s, 'bob').label, 'Iris');
});

test('changing the global still moves everyone who has not chosen', () => {
  const r = resolver();
  const before = { defaultClient: 'primal', defaultClientBy: { alice: 'jumble' } };
  const after = { defaultClient: 'iris', defaultClientBy: { alice: 'jumble' } };
  assert.equal(r(before, 'bob').label, 'Primal');
  assert.equal(r(after, 'bob').label, 'Iris', 'the global stopped being a default');
  assert.equal(r(after, 'alice').label, 'Jumble', 'the global overrode an explicit choice');
});

test('no settings at all still resolves', () => {
  const r = resolver();
  for (const s of [null, undefined, {}, { defaultClientBy: {} }]) {
    assert.equal(r(s, 'alice').label, 'Primal', JSON.stringify(s));
  }
});

test('an unknown client key falls back rather than rendering nothing', () => {
  // A theme or client removed in a later build must degrade, not leave the caller
  // holding undefined and opening about:blank.
  const r = resolver();
  assert.equal(r({ defaultClientBy: { alice: 'deadclient' } }, 'alice').label, 'Primal');
  assert.equal(r({ defaultClient: 'deadclient' }, 'bob').label, 'Primal');
});

test('no pubkey means the global, not a crash', () => {
  const r = resolver();
  assert.equal(r({ defaultClient: 'jumble', defaultClientBy: { alice: 'iris' } }, null).label, 'Jumble');
});

// ---- writing ------------------------------------------------------------------------

test('THE MAP IS EDITED IN THE BACKGROUND, NOT SENT WHOLE', () => {
  // SIDECAR_SET_SETTINGS merges shallowly, so a panel sending the whole map would
  // clobber another account's choice, and two panels racing would lose one. The
  // same reasoning the nip65OnlyBy setter records above it.
  assert.match(bg, /case 'SIDECAR_SET_CLIENT_FOR'/, 'no dedicated setter');
  const handler = bg.slice(bg.indexOf("case 'SIDECAR_SET_CLIENT_FOR'"), bg.indexOf("case 'SIDECAR_SET_SETTINGS'"));
  assert.match(handler, /\{ \.\.\.\(prev\.defaultClientBy \|\| \{\}\) \}/, 'the map is not read-modify-written');
});

test('clearing removes the entry rather than storing an empty string', () => {
  // An empty string is not a client. Storing one would make the account resolve
  // through the fallback anyway, but leave dead keys accumulating for every account
  // that ever toggled back.
  const handler = bg.slice(bg.indexOf("case 'SIDECAR_SET_CLIENT_FOR'"), bg.indexOf("case 'SIDECAR_SET_SETTINGS'"));
  assert.match(handler, /delete map\[message\.pubkey\]/, 'clearing does not delete the entry');
});

test('the panel never writes the global from the per-account picker', () => {
  const src = stripComments(source);
  const at = src.indexOf("$('client-select').addEventListener('change'");
  assert.ok(at !== -1, 'the picker handler moved');
  const handler = src.slice(at, at + 400);
  assert.match(handler, /SIDECAR_SET_CLIENT_FOR/, 'the picker does not use the per-account setter');
  assert.doesNotMatch(handler, /defaultClient:/, 'the picker still writes the global setting');
});

// ---- the readers --------------------------------------------------------------------

test('every reader goes through the resolver', () => {
  // Three places read this. One resolving differently from the others is how an
  // account ends up opening notes in one client and profiles in another.
  // Counted with the resolver's OWN body removed, or it matches its own
  // implementation and the assertion can never fail.
  const src = stripComments(source).replace(stripComments(lift('function resolveClient(')), '');
  const direct = (src.match(/settings\s*&&\s*settings\.defaultClient\)/g) || []).length;
  assert.equal(direct, 0, 'a caller still resolves defaultClient for itself');
  assert.ok((src.match(/resolveClient\(/g) || []).length >= 2, 'the resolver has fewer than two callers');
});

test('the post banner uses the account that SIGNED, not the active one', () => {
  // They differ if the user switches accounts while the banner is up, and the note
  // belongs to whoever signed it.
  const fn = stripComments(lift('async function showPostBanner('));
  assert.match(fn, /signed && signed\.pubkey/, 'the banner resolves against the active account');
});

test('the picker offers an explicit way back to the default', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  const at = html.indexOf('<select id="client-select">');
  assert.ok(at !== -1);
  assert.match(html.slice(at, at + 200), /<option value="">/, 'no option clears the per-account choice');
});
