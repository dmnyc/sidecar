'use strict';

// Every document that themes itself keeps its OWN copy of the theme lists, and
// that is deliberate — see the note beside LIGHT_THEMES in prompt.js. There is no
// module system between the panel, a content script running in a page's world,
// and a popup window, and the alternative was a fourth file holding ten strings.
//
// The note is honest about the cost: "a new light theme must be registered in all
// three, so each copy names the others." That registration was left to whoever
// remembered. It has already been missed once — the comment above themeColors in
// content.js records a theme that shipped in CARD_THEMES with no palette entry and
// rendered as Speakeasy.
//
// This is the check that was missing. It does not consolidate the lists; it fails
// when they disagree.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Pull a list of quoted strings out of a source file by its declared name.
// Accepts both shapes in use: a bare array literal (prompt.js, theme-boot.js)
// and `new Set([...])` (sidepanel.js, which membership-tests rather than
// iterates). Returns null when the file has no such declaration.
function listIn(file, name) {
  const src = read(file);
  const m = src.match(
    new RegExp('(?:const|let|var)\\s+' + name + '\\s*=\\s*(?:new\\s+Set\\s*\\(\\s*)?\\[([^\\]]*)\\]')
  );
  if (!m) return null;
  const items = m[1].match(/'[^']*'/g) || [];
  return items.map((s) => s.slice(1, -1));
}

// ---- the full theme allowlist ---------------------------------------------------

test('every copy of the theme allowlist agrees', () => {
  const copies = {
    'sidepanel.js (validThemes)': listIn('sidepanel.js', 'validThemes'),
    'prompt.js (THEMES)': listIn('prompt.js', 'THEMES'),
    'theme-boot.js (THEMES)': listIn('theme-boot.js', 'THEMES'),
  };
  for (const [where, list] of Object.entries(copies)) {
    assert.ok(list && list.length, where + ' has no theme list — did it get renamed?');
  }
  const canonical = copies['sidepanel.js (validThemes)'];
  for (const [where, list] of Object.entries(copies)) {
    assert.deepEqual(
      list, canonical,
      where + ' disagrees with sidepanel.js. A theme registered in one document and ' +
      'not another renders as Speakeasy there.'
    );
  }
});

test('the allowlist is dark-first, then light, matching the picker', () => {
  // sidepanel.html's picker is the canonical order and the comment above
  // validThemes says so. A reordering here would make the gallery and the
  // fallback disagree about which theme is "first".
  const all = listIn('sidepanel.js', 'validThemes');
  const light = listIn('sidepanel.js', 'LIGHT_THEMES');
  const firstLight = all.findIndex((t) => light.includes(t));
  assert.ok(firstLight > 0, 'no light theme found in the allowlist');
  assert.ok(
    all.slice(firstLight).every((t) => light.includes(t)),
    'a dark theme appears after the first light one — the list is no longer grouped'
  );
});

// ---- the light-theme list -------------------------------------------------------

test('EVERY COPY OF LIGHT_THEMES AGREES', () => {
  // The one that bites. A light theme missing here keeps the lavender wordmark,
  // which is baked for a dark field and simply disappears on a pale one — an
  // invisible logo rather than a wrong color, so it is easy to ship.
  const copies = {
    'sidepanel.js': listIn('sidepanel.js', 'LIGHT_THEMES'),
    'prompt.js': listIn('prompt.js', 'LIGHT_THEMES'),
    'theme-boot.js': listIn('theme-boot.js', 'LIGHT_THEMES'),
  };
  for (const [where, list] of Object.entries(copies)) {
    assert.ok(list && list.length, where + ' has no LIGHT_THEMES list');
  }
  const canonical = copies['sidepanel.js'];
  for (const [where, list] of Object.entries(copies)) {
    assert.deepEqual(list, canonical, where + ' disagrees with sidepanel.js on which themes are light');
  }
});

test('every light theme is also in the allowlist', () => {
  const all = listIn('sidepanel.js', 'validThemes');
  for (const t of listIn('sidepanel.js', 'LIGHT_THEMES')) {
    assert.ok(all.includes(t), t + ' is marked light but is not a valid theme');
  }
});

// ---- aliases --------------------------------------------------------------------

test('the art-deco alias is carried everywhere a theme is read', () => {
  // A vault that picked Art Deco before the Industria rename still holds the old
  // string and nothing rewrites it, so any document that reads the setting has to
  // map it or fall back to Speakeasy for that user.
  for (const f of ['sidepanel.js', 'prompt.js', 'content.js', 'theme-boot.js']) {
    assert.match(read(f), /'art-deco':\s*'industria'/, f + ' does not map the art-deco alias');
  }
});

// ---- the pages actually load it --------------------------------------------------

test('every full page boots the theme', () => {
  // The bug this fixes: all three linked twelve theme stylesheets and never set
  // [data-theme], so they rendered Speakeasy regardless of the chosen theme.
  for (const page of ['help.html', 'welcome.html', 'wallets.html']) {
    const src = read(page);
    assert.match(src, /<script src="theme-boot\.js">/, page + ' does not load theme-boot.js');
    assert.ok(
      src.indexOf('theme-boot.js') < src.indexOf('</body>'),
      page + ' loads theme-boot.js outside the document body'
    );
  }
});

test('THE FULL PAGES DO NOT SWAP THE WORDMARK', () => {
  // The panel and the prompt window swap to the deco mark on a light theme
  // because their whole surface goes pale. These pages must not: .helpnav is a
  // hardcoded near-black bar in welcome.css and stays dark under every theme, so
  // the logo on it always wants the dark-field cut. Swapping put dark ink on a
  // near-black bar and the wordmark vanished.
  const src = read('theme-boot.js');
  assert.doesNotMatch(
    src.replace(/\/\/[^\n]*/g, ''), // strip comments; this file explains the trap at length
    /sidecar-logo-deco\.svg/,
    'theme-boot swaps to the deco wordmark — the nav is dark in every theme'
  );
});

test('a light theme is announced to CSS so the dark nav can pin its ink', () => {
  // Under a light theme the nav's children inherited that theme's near-black
  // ink onto the near-black bar. theme-boot sets the class; welcome.css pins the
  // tokens back for the bar only. Keying off a class rather than listing the six
  // light themes in CSS keeps the list from being duplicated a fifth time.
  assert.match(read('theme-boot.js'), /classList\.toggle\('theme-light'/, 'no light-theme class');
  assert.match(read('welcome.css'), /\.theme-light \.helpnav\s*\{/, 'welcome.css does not pin the nav under light themes');
});

test('the nav background really is theme-independent', () => {
  // The premise of both tests above. If .helpnav ever becomes theme-aware, the
  // pinning is wrong and the wordmark should start swapping again.
  const nav = read('welcome.css').match(/^\.helpnav \{[^}]*\}/m)[0];
  assert.match(nav, /background:\s*rgba\(/, 'no literal background on .helpnav');
  assert.doesNotMatch(nav, /background:\s*var\(/, '.helpnav now takes its background from a theme token');
});

test('the dark-field wordmark exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'icons/sidecar-logo.svg')), 'icons/sidecar-logo.svg is missing');
});

// ---- whose theme these pages wear ------------------------------------------------

test('THE FULL PAGES WEAR THE ACTIVE ACCOUNT\'S THEME', () => {
  // A theme belongs to an account (themeBy). Reading only settings.theme would show
  // these pages the default an account that never chose inherits, which is this PR's
  // own bug back again for anyone using per-account themes: on Par Avion, opening the
  // guide would still hand you a dark page.
  //
  // These are chrome-extension:// documents, so unlike the pay card in content.js there
  // is nothing to leak by reading the account on screen — no web page can see them.
  const src = read('theme-boot.js').replace(/\/\/[^\n]*/g, ''); // the file explains this at length
  assert.match(src, /sidecar_active_pubkey/, 'theme-boot no longer reads which account is active');
  assert.match(src, /\(pk && by\[pk\]\) \|\| st\.theme/, 'theme-boot no longer prefers the account over the default');
  assert.match(src, /st\.themeBy \|\| \{\}/, 'theme-boot does not read the per-account map');
});

test('a switch reaches a page already open', () => {
  // The two keys move independently — a pick writes sidecar_settings, a switch writes
  // sidecar_active_pubkey — so watching only the settings would leave a guide showing
  // the previous account's theme until it was reloaded.
  const src = read('theme-boot.js').replace(/\/\/[^\n]*/g, '');
  const at = src.indexOf('onChanged.addListener');
  assert.ok(at !== -1, 'theme-boot no longer follows storage changes');
  const fn = src.slice(at, at + 300);
  assert.match(fn, /changes\.sidecar_active_pubkey/, 'an account switch does not repaint an open page');
  assert.match(fn, /changes\.sidecar_settings/, 'a theme pick does not repaint an open page');
  // Re-read, rather than pulling one value out of the change record: the answer needs
  // both keys and only one of them is in any given record.
  assert.match(fn, /boot\(\)/, 'the listener resolves from the change record instead of re-reading');
});
