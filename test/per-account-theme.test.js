'use strict';

// Per-account themes (#266). With several accounts the panel looked identical whether
// you were in your main identity or a throwaway, and the account name was the only
// thing telling them apart. A theme answers "which account am I in" before you read
// anything.
//
// Three surfaces read the theme and they do NOT all follow the account:
//
//   panel      follows the account. The obvious one.
//   approval   follows the account, and is the valuable one — that window is about a
//              specific identity, and it is where picking the wrong one costs money.
//   pay card   DOES NOT AND MUST NOT. content.js reads settings through a
//              deliberately clamped path so a visited site cannot fingerprint config.
//              Handing it a per-account theme would leak which account is active on
//              that site, to that site.
//
// That asymmetry is the whole design. The rest is the same map-with-fallback shape as
// nip65OnlyBy and defaultClientBy.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

function lift(decl, src) {
  const s = src || source;
  const at = s.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  let paren = 0;
  let i = s.indexOf('(', at);
  for (; i < s.length; i++) {
    if (s[i] === '(') paren++;
    else if (s[i] === ')' && --paren === 0) break;
  }
  const open = s.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return s.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

function resolver() {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(lift('function resolveTheme(') + '\nglobalThis.out = resolveTheme;', ctx);
  return ctx.out;
}

// ---- resolution ---------------------------------------------------------------------

test('an account with its own theme gets it', () => {
  const r = resolver();
  assert.equal(r({ theme: 'nixie', themeBy: { alice: 'bauhaus' } }, 'alice'), 'bauhaus');
});

test('AN ACCOUNT WITHOUT ONE FOLLOWS THE GLOBAL', () => {
  const r = resolver();
  assert.equal(r({ theme: 'nixie', themeBy: { alice: 'bauhaus' } }, 'bob'), 'nixie');
});

test('changing the global still moves everyone who has not chosen', () => {
  const r = resolver();
  const s = { theme: 'metropolis', themeBy: { alice: 'bauhaus' } };
  assert.equal(r(s, 'bob'), 'metropolis');
  assert.equal(r(s, 'alice'), 'bauhaus', 'the global overrode an explicit choice');
});

test('LOCKED FALLS BACK TO THE GLOBAL', () => {
  // The lock screen paints before the panel knows who is unlocking, so
  // state.activePubkey is empty. It cannot wear an account's theme yet.
  const r = resolver();
  assert.equal(r({ theme: 'film-noir', themeBy: { alice: 'bauhaus' } }, ''), 'film-noir');
  assert.equal(r({ theme: 'film-noir' }, null), 'film-noir');
});

test('no settings at all still resolves to a real theme', () => {
  const r = resolver();
  for (const s of [null, undefined, {}, { themeBy: {} }]) {
    assert.equal(r(s, 'alice'), 'speakeasy', JSON.stringify(s));
  }
});

// ---- the surfaces that follow, and the one that must not -----------------------------

test('THE PAY CARD STILL READS THE GLOBAL THEME', () => {
  // The line that matters most in this file. content.js reads settings through a
  // clamped path so a visited site cannot fingerprint config; a per-account theme
  // there would tell the site which account is active on it.
  const src = stripComments(content);
  assert.match(src, /sidecar_settings\.theme\)/, 'the pay card stopped reading the global theme');
  assert.doesNotMatch(src, /themeBy/, 'the pay card now leaks which account is active on the site');
});

test('the approval window follows the account it is about', () => {
  // The valuable surface: that window is about one identity and it is where picking
  // the wrong one costs something.
  const src = stripComments(bg);
  assert.match(src, /promptSettings\.themeBy && promptSettings\.themeBy\[activePubkey\]/,
    'the approval window still shows the global theme');
});

test('the panel resolves against the active account', () => {
  const src = stripComments(source);
  assert.match(src, /applyTheme\(resolveTheme\(settings, state\.activePubkey\)\)/,
    'the panel still applies the global theme at boot');
  assert.doesNotMatch(src, /applyTheme\(settings\.theme \|\| 'speakeasy'\)/, 'a caller still resolves for itself');
});

// ---- writing -------------------------------------------------------------------------

test('the map is edited in the background, not sent whole', () => {
  // SIDECAR_SET_SETTINGS merges shallowly, so a panel sending the whole map would
  // clobber another account's theme and racing panels would lose one.
  assert.match(bg, /case 'SIDECAR_SET_THEME_FOR'/, 'no dedicated setter');
  const h = bg.slice(bg.indexOf("case 'SIDECAR_SET_THEME_FOR'"), bg.indexOf("case 'SIDECAR_SET_CLIENT_FOR'"));
  assert.match(h, /\{ \.\.\.\(prev\.themeBy \|\| \{\}\) \}/, 'the map is not read-modify-written');
  assert.match(h, /delete map\[message\.pubkey\]/, 'clearing does not delete the entry');
});

test('picking a card writes the account, not the global', () => {
  const src = stripComments(source);
  const at = src.indexOf('const selectedTheme = card.dataset.theme;');
  assert.ok(at !== -1, 'the picker handler moved');
  const h = src.slice(at, at + 900);
  assert.match(h, /SIDECAR_SET_THEME_FOR/, 'the picker does not use the per-account setter');
});

test('ONBOARDING SETS THE GLOBAL, because there is no account yet', () => {
  // Before any account exists there is nobody to attribute the choice to, and the
  // global is also the default every new account will inherit.
  const src = stripComments(source);
  const at = src.indexOf('const selectedTheme = card.dataset.theme;');
  const h = src.slice(at, at + 900);
  assert.match(h, /if \(state\.activePubkey\)/, 'the picker does not branch on having an account');
  assert.match(h, /settings: \{ theme: selectedTheme \}/, 'onboarding cannot set a theme at all');
});

// ---- the way back ----------------------------------------------------------------------

test('there is a way back to following the default', () => {
  // The picker is a grid of cards with no "off" position, so without this an account
  // could take a theme and never give it back.
  const fn = stripComments(lift('function paintThemeFollowState('));
  assert.match(fn, /theme: ''/, 'nothing clears the per-account theme');
  assert.match(fn, /Use the default/, 'the control has no label');
  assert.match(fn, /Following the default/, 'an account following the global is not told so');
});
