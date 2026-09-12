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

// The pay card's theme is resolved in background.js rather than in the panel, because it
// depends on the SITE's binding as well as the settings and only the background may join
// those two. Lifted from the shipped expression so it cannot drift from what runs.
function cardResolver() {
  const m = bg.match(/cardTheme: (\(bound && by\[bound\]\) \|\| st\.theme \|\| ''),?/);
  if (!m) throw new Error('the pay card theme expression moved — update this test');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext('globalThis.out = (st, bound) => { const by = st.themeBy || {}; return ' + m[1] + '; };', ctx);
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

test('THE PAY CARD WEARS THE BOUND ACCOUNT\'S THEME, NEVER THE ACTIVE ONE', () => {
  // The line that matters most in this file. The card is rendered into a page that can
  // see it. The site already holds the pubkey of the account it is bound to, so that
  // account's theme is not news to it — but the ACTIVE account can be an identity the
  // site has never seen, and a card that changed colour on a switch is a switch detector
  // a page can poll by cycling the invoice on itself.
  const src = stripComments(bg);
  const at = src.indexOf("if (!fromExtPage && message.type === 'SIDECAR_GET_SETTINGS')");
  assert.ok(at !== -1, 'the clamped settings read for content scripts moved');
  const h = src.slice(at, at + 1400);
  assert.match(h, /getSiteAccount\(cardHost\)/, 'the card theme is not resolved against this site\'s account');
  assert.match(h, /cardTheme: \(bound && by\[bound\]\) \|\| st\.theme/, 'the card no longer resolves per site');
  assert.match(h, /new URL\((?:sender && sender\.url|\(sender && sender\.url\))/,
    'the host comes from the message body, which a page could influence');
  assert.doesNotMatch(h, /activePubkey/, 'the clamped read now hands a page the active identity');
});

test('the card resolves to the bound account, then the default', () => {
  const r = cardResolver();
  const st = { theme: 'speakeasy', themeBy: { alice: 'bauhaus', bob: 'nixie' } };
  assert.equal(r(st, 'alice'), 'bauhaus', 'a bound account does not get its own theme');
  assert.equal(r(st, 'bob'), 'nixie', 'the card follows the wrong account');
  // A site bound to an account that never chose, and a site with no binding at all
  // (which cannot render a card today, but must not resolve to undefined if it ever can).
  assert.equal(r(st, 'carol'), 'speakeasy', 'an account that never chose does not get the default');
  assert.equal(r(st, null), 'speakeasy', 'an unbound site does not fall back to the default');
  assert.equal(r({}, null), '', 'a fresh install must resolve to a falsy value, not undefined');
  // The switch that started all this: changing which account is ACTIVE cannot change
  // this answer, because the active account is not an input.
  assert.equal(r(st, 'alice'), 'bauhaus', 'the resolution is not stable');
});

test('THE CARD MAP NEVER CROSSES INTO A CONTENT SCRIPT', () => {
  // content.js asks for one resolved string. Handing it themeBy would let any page read
  // every account's theme, which is a fingerprint of how many identities you keep.
  const src = stripComments(content);
  assert.doesNotMatch(src, /themeBy/, 'the pay card now reads the per-account map itself');
  assert.match(src, /result\.cardTheme/, 'the card no longer takes the resolved theme from the background');
  // And nothing pushes a theme at it, so an account switch writes nothing a page can see.
  assert.doesNotMatch(stripComments(source), /cardTheme/, 'the panel writes a card theme again');
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

test('A GALLERY PICK DRESSES THE ACCOUNT YOU ARE IN, NOT EVERY ACCOUNT', () => {
  // Reported: an account that had never chosen a theme wore the previous account's,
  // because the pick wrote settings.theme and that is what such an account follows. The
  // pick must reach themeBy and the card, and must NOT reach settings.theme — which is
  // the default a never-chose account still wants.
  const src = stripComments(source);
  const at = src.indexOf('const selectedTheme = card.dataset.theme;');
  const own = src.slice(at, src.indexOf('} else {', at));
  assert.match(own, /SIDECAR_SET_THEME_FOR[^\n]*theme: selectedTheme/, 'the pick no longer dresses this account');
  assert.doesNotMatch(own, /settings: \{ theme:/,
    'a pick writes the default again, which redresses every account that never chose');
});

test('ONBOARDING SETS THE DEFAULT, because there is no account yet', () => {
  // Before any account exists there is nobody to attribute the choice to, and the value
  // is also the default every new account inherits.
  const src = stripComments(source);
  const at = src.indexOf('const selectedTheme = card.dataset.theme;');
  const h = src.slice(at, at + 1600);
  assert.match(h, /if \(state\.activePubkey\)/, 'the pick does not branch on having an account');
  const ob = h.slice(h.indexOf('} else {'));
  assert.match(ob, /settings: \{ theme: selectedTheme \}/, 'onboarding sets no default');
});

test('THE MARKED CARD IS THE THEME ON SCREEN', () => {
  // The gallery sets the theme for the account you are in, so it marks what that account
  // is wearing. Kept out of applyTheme, which runs on every render including the lock
  // screen, where mounting twelve preview documents is pure waste.
  const apply = stripComments(lift('function applyTheme('));
  assert.doesNotMatch(apply, /theme-card/, 'applying a theme marks a picker card again');
  const paint = stripComments(lift('function paintThemePicker('));
  assert.match(paint, /card\.dataset\.theme === marked/, 'nothing marks the picked card');
  assert.match(paint, /showThemeMode\(/, 'the gallery no longer opens on the marked card\'s half');
  const settings = stripComments(lift('async function renderSettings('));
  assert.match(settings, /paintThemePicker\(applyResolvedTheme\(settings\)\)/,
    'Settings marks something other than the theme it just applied');
});

test('any account can be dressed from its own menu', () => {
  // The gallery only reaches the account you are in. This modal is how the others get a
  // theme, and the only way back to the default once an account has chosen.
  const menu = stripComments(lift('function accountMenuModal('));
  assert.match(menu, /themeOverrideModal/, 'the account menu cannot set a theme');
  // The label instructs rather than naming the mechanism. "Theme override" described an
  // entry in themeBy that beats settings.theme, which is true and useless to a reader:
  // it was reported as the one item in this menu nobody could explain. A menu item is a
  // door, and the sentence on it should say where it goes.
  assert.match(menu, /menuItem\('Set account theme'/, 'the menu item names a mechanism again');
  // After the key backup: the one cosmetic item in a menu of consequential ones.
  assert.ok(
    menu.indexOf('Set account theme') > menu.indexOf('Back up private key'),
    'the theme item sits above the key backup again'
  );
  assert.doesNotMatch(menu, /'Theme override'/, 'the jargon label is back');
  const fn = stripComments(lift('function themeOverrideModal('));
  assert.match(fn, /SIDECAR_SET_THEME_FOR/, 'the modal does not write the account theme');
  assert.doesNotMatch(fn, /settings: \{ theme:/, 'the modal writes the default for every account');
  assert.match(fn, /value: '', textContent: 'Use the default'/, 'no way back to the default');
});

test('DRESSING ANOTHER ACCOUNT DOES NOT REPAINT THE PANEL', () => {
  // The menu is reachable for every account, not just the active one. Repainting would
  // change the panel out from under you.
  const fn = stripComments(lift('function themeOverrideModal('));
  const at = fn.indexOf('a.pubkey === state.activePubkey');
  assert.ok(at !== -1, 'the repaint is not scoped to the active account');
  const guarded = fn.slice(at, fn.indexOf('closeModal();', at));
  assert.match(guarded, /paintThemePicker\(applyResolvedTheme\(/, 'the active account is no longer repainted');
});

test('a value arriving late does not overwrite a pick', () => {
  // The modal opens on "Use the default" and fills in the account's real value when the
  // background answers. Pick inside that window and the answer would land on top of it.
  const fn = stripComments(lift('function themeOverrideModal('));
  assert.match(fn, /sel\.addEventListener\('change', \(\) => \{ touched = true; \}\)/, 'nothing records a pick');
  assert.match(fn, /!modal\.isConnected \|\| touched/, 'the late fill can still clobber a pick');
});

test('the labels and the allowlist cannot drift', () => {
  // A theme in one and missing from the other is unpickable rather than visibly
  // broken, so it would ship unnoticed.
  const labels = (source.match(/const THEME_LABELS = \[([\s\S]*?)\];/)[1].match(/'([a-z-]+)',/g) || [])
    .map((x) => x.replace(/[',]/g, ''));
  const valid = source.match(/const validThemes = \[([^\]]*)\]/)[1]
    .split(',').map((x) => x.trim().replace(/'/g, ''));
  assert.deepEqual(labels, valid, 'THEME_LABELS and validThemes disagree');
});

// ---- clearing ---------------------------------------------------------------------

test('an account can always go back to the default', () => {
  // Without this an account could take a theme and never give it back — the gallery has
  // no "off" position, since every card is a theme.
  const fn = stripComments(lift('function themeOverrideModal('));
  assert.match(fn, /Use the default/, 'the modal has no way back to the default');
  // Empty string reaches the setter, which deletes the key rather than storing it.
  assert.match(fn, /theme: sel\.value/, 'the chosen value is not what gets written');
});

test('THE THEME SELECT IS GROUPED, AND TAKES THE SPLIT FROM THE GALLERY', () => {
  // Twelve names in a flat list say nothing about what you are choosing: Populuxe and
  // Par Avion are light, Nixie and Cast Iron are not, and no one can tell from the word.
  // The gallery answers that with a picture. A select can only answer it by grouping.
  const fn = stripComments(lift('function themeOverrideModal('));
  assert.match(fn, /h\('optgroup', \{ label: 'Dark' \}\)/, 'the dark group is gone');
  assert.match(fn, /h\('optgroup', \{ label: 'Light' \}\)/, 'the light group is gone');
  // Read from the cards, not restated. sidepanel.html calls data-mode the only place the
  // split is made, and a second copy here would be right until the next theme is added.
  assert.match(fn, /querySelector\('\.theme-card\[data-theme="' \+ key \+ '"\]'\)/,
    'the modal keeps its own idea of which themes are light');
  assert.doesNotMatch(fn, /'populuxe'|'par-avion'|'nixie'/, 'theme names are hardcoded into the grouping');
});

test('every theme in the list has a card to be grouped by', () => {
  // The fallback in modeOf sends an unknown theme to Dark, which is the right thing to do
  // at runtime and the wrong thing to discover in a screenshot: a light theme shipped
  // without a gallery card would sit silently in the Dark group forever.
  const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  const block = source.match(/const THEME_LABELS = \[([\s\S]*?)\];/);
  assert.ok(block, 'THEME_LABELS moved');
  const keys = [...block[1].matchAll(/\['([a-z-]+)',/g)].map((m) => m[1]);
  assert.ok(keys.length >= 12, 'the theme list shrank unexpectedly: ' + keys.length);
  for (const key of keys) {
    assert.match(
      html,
      new RegExp('data-theme="' + key + '" data-mode="(dark|light)"'),
      key + ' has no gallery card with a data-mode, so the select would file it under Dark'
    );
  }
});
