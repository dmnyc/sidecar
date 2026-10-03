'use strict';

// The special editions: themes worn only for part of the year (seasons.js).
//
// Three things have to hold for one to work, and each fails silently when it does not:
//
//   THE CALENDAR   an edition resolves on the days of its window and on no others, so it
//                  arrives and leaves by itself without anyone opening the panel.
//   THE OVERLAY    wearing one never touches the account's own theme, so when it comes
//                  off (or the season ends) the account is back in exactly what it chose.
//   THE PLUMBING   every place that validates or resolves a theme knows the edition.
//                  An allowlist that misses it renders the default; a resolver that
//                  misses it shows the panel in October and the approval window in plain
//                  Speakeasy beside it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function seasons() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(read('seasons.js'), ctx);
  return ctx.SidecarSeasons;
}
const S = seasons();
const day = (iso) => new Date(iso + 'T12:00:00');

// ---- the calendar ---------------------------------------------------------------------

test('Sleepy Hollow is worn from October 1 through November 2, both days included', () => {
  assert.equal(S.inSeason('sleepy-hollow', day('2026-09-30')), false);
  assert.equal(S.inSeason('sleepy-hollow', day('2026-10-01')), true);
  assert.equal(S.inSeason('sleepy-hollow', new Date('2026-10-01T00:00:00')), true, 'arrives at local midnight');
  assert.equal(S.inSeason('sleepy-hollow', new Date('2026-11-02T23:59:59')), true, 'lasts the whole of its last day');
  assert.equal(S.inSeason('sleepy-hollow', new Date('2026-11-03T00:00:00')), false);
  assert.equal(S.inSeason('sleepy-hollow', day('2027-10-15')), true, 'it comes back every year');
});

test('a window that crosses New Year belongs to the year it opened', () => {
  // None ships yet; the New Year edition will. Added to a copy of the list, not the real one.
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(read('seasons.js'), ctx);
  const s = ctx.SidecarSeasons;
  s.EDITIONS.push({ key: 'test-new-year', name: 'Test', mode: 'dark', from: [12, 26], to: [1, 7] });
  assert.equal(s.seasonId('test-new-year', day('2026-12-25')), null);
  assert.equal(s.seasonId('test-new-year', day('2026-12-26')), 'test-new-year:2026');
  assert.equal(s.seasonId('test-new-year', day('2027-01-07')), 'test-new-year:2026', 'January is still last year\'s season');
  assert.equal(s.seasonId('test-new-year', day('2027-01-08')), null);
});

test('the season id names one edition in one year, which is what the card is shown once for', () => {
  assert.equal(S.seasonId('sleepy-hollow', day('2026-10-20')), 'sleepy-hollow:2026');
  assert.equal(S.seasonId('sleepy-hollow', day('2027-10-20')), 'sleepy-hollow:2027');
  assert.equal(S.seasonId('sleepy-hollow', day('2026-12-01')), null);
  assert.equal(S.seasonId('no-such-edition', day('2026-10-20')), null);
});

test('a developer date stands in for today, and nothing else does', () => {
  assert.equal(S.now({ devDate: '2026-10-20' }).getMonth(), 9);
  assert.equal(S.now({ devDate: '2026-10-20' }).getDate(), 20);
  for (const junk of ['', 'tomorrow', '2026-10', 20261020, null, undefined]) {
    const before = Date.now();
    const got = S.now({ devDate: junk }).getTime();
    assert.ok(got >= before - 1000 && got <= Date.now() + 1000, JSON.stringify(junk) + ' was taken as a date');
  }
});

// ---- the overlay ------------------------------------------------------------------------

test('an edition resolves for the account wearing it, in season, and for no one else', () => {
  const settings = { theme: 'nixie', themeBy: { alice: 'bauhaus' }, seasonalBy: { alice: 'sleepy-hollow' } };
  assert.equal(S.resolve(settings, 'alice', day('2026-10-20')), 'sleepy-hollow');
  assert.equal(S.resolve(settings, 'bob', day('2026-10-20')), null, 'it dressed an account that never put it on');
  assert.equal(S.resolve(settings, 'alice', day('2026-11-03')), null, 'the season ended and it is still on');
  assert.equal(S.resolve(settings, '', day('2026-10-20')), null, 'the lock screen knows no account yet');
  assert.equal(S.resolve({ seasonalBy: { alice: 'speakeasy' } }, 'alice', day('2026-10-20')), null,
    'an ordinary theme stored as an edition resolved');
  assert.equal(S.resolve(null, 'alice'), null);
});

function panelResolver() {
  const src = read('sidepanel.js');
  const at = src.indexOf('function resolveTheme(');
  const body = src.slice(at, src.indexOf('\n  }\n', at) + 4);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(read('seasons.js'), ctx);
  ctx.SEASONS = ctx.SidecarSeasons;
  vm.runInContext(body + '\nglobalThis.out = resolveTheme;', ctx);
  return ctx.out;
}

test('THE PANEL WEARS IT OVER THE ACCOUNT\'S OWN THEME, AND THE OWN THEME COMES BACK', () => {
  const r = panelResolver();
  const worn = { theme: 'nixie', themeBy: { alice: 'bauhaus' }, seasonalBy: { alice: 'sleepy-hollow' } };
  assert.equal(r({ ...worn, devDate: '2026-10-20' }, 'alice'), 'sleepy-hollow');
  assert.equal(r({ ...worn, devDate: '2026-11-03' }, 'alice'), 'bauhaus', 'the account\'s own theme did not come back');
  assert.equal(r({ ...worn, devDate: '2026-10-20' }, 'bob'), 'nixie');
});

test('putting one on or taking it off never writes the account\'s own theme', () => {
  const bg = read('background.js');
  const at = bg.indexOf("case 'SIDECAR_SET_SEASONAL_FOR': {");
  assert.ok(at !== -1, 'the background has no way to put an edition on');
  const h = bg.slice(at, bg.indexOf('break;', at));
  assert.match(h, /seasonalBy: map/);
  assert.doesNotMatch(h, /themeBy|theme: message/, 'wearing an edition writes the account\'s own theme');
  // Only an edition's key can be stored here: an ordinary theme name in seasonalBy would
  // never resolve, and an arbitrary string should not be written at all.
  assert.match(h, /if \(message\.theme && !SidecarSeasons\.isSeasonal\(message\.theme\)\) throw/);
});

test('choosing a theme of your own takes an edition off, wherever it is chosen', () => {
  const src = read('sidepanel.js');
  const pick = src.slice(src.indexOf('const selectedTheme = card.dataset.theme;'));
  assert.match(pick.slice(0, 2400), /SIDECAR_SET_SEASONAL_FOR', pubkey: state\.activePubkey, theme: seasonal \? selectedTheme : ''/);
  const modal = src.slice(src.indexOf('function themeOverrideModal('));
  assert.match(modal.slice(0, 5000), /SIDECAR_SET_SEASONAL_FOR', pubkey: a\.pubkey, theme: ''/,
    'the account menu sets a theme the edition then hides');
});

// ---- the plumbing -------------------------------------------------------------------------

test('every place that resolves a theme resolves the edition first', () => {
  assert.match(read('sidepanel.js'), /const seasonal = SEASONS\.resolve\(settings, pubkey\);\n\s*if \(seasonal\) return seasonal;/);
  assert.match(read('compose.js'), /let name = window\.SidecarSeasons\.resolve\(settings, pubkey\)\n\s*\|\| \(by && pubkey && by\[pubkey\]\)/);
  const bg = read('background.js');
  assert.match(bg, /theme: SidecarSeasons\.resolve\(promptSettings, activePubkey\)\n\s*\|\| \(promptSettings\.themeBy/,
    'the approval window does not wear the edition the panel is wearing');
  // The pay card resolves for the account the SITE is bound to, never the active one; see
  // test/per-account-theme.test.js for why. The edition follows the same rule.
  assert.match(bg, /cardTheme: SidecarSeasons\.resolve\(st, cardAccount\) \|\|/);
});

test('every allowlist of theme names takes the editions from the one list', () => {
  assert.match(read('sidepanel.js'), /const validThemes = \[[^\]]*\]\.concat\(SEASONS\.KEYS\);/);
  assert.match(read('compose.js'), /const VALID_THEMES = \[[^\]]*\]\n\s*\.concat\(window\.SidecarSeasons\.KEYS\);/);
  assert.match(read('prompt.js'), /const THEMES = \[[^\]]*\]\n\s*\.concat\(window\.SidecarSeasons\.KEYS\);/);
  // content.js runs in a page and does not load seasons.js, so it names each edition.
  const card = read('content.js').match(/const CARD_THEMES = new Set\(\[([^\]]*)\]\)/)[1];
  for (const key of S.KEYS) assert.ok(card.includes("'" + key + "'"), key + ' is missing from CARD_THEMES');
});

test('THE ACCOUNT MENU OFFERS WHAT CAN BE WORN ALL YEAR, NOT THE EDITIONS', () => {
  // An edition chosen there would vanish at the end of its season with no say in it. The
  // gallery's own slot is where one is put on.
  const labels = read('sidepanel.js').match(/const THEME_LABELS = \[([\s\S]*?)\];/)[1];
  for (const key of S.KEYS) assert.ok(!labels.includes("'" + key + "'"), key + ' is in THEME_LABELS');
});

test('every page that applies a theme loads the calendar before its own script', () => {
  for (const page of ['sidepanel.html', 'compose.html', 'prompt.html']) {
    const scripts = [...read(page).matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    const at = scripts.indexOf('seasons.js');
    assert.ok(at !== -1, page + ' does not load seasons.js');
    const own = scripts.indexOf(page.replace('.html', '.js'));
    assert.ok(own > at, page + ' runs its script before seasons.js');
  }
  const bg = read('background.js');
  assert.match(bg, /importScripts\([^)]*'seasons\.js'/);
  const scripts = JSON.parse(read('manifest.json')).background.scripts;
  assert.ok(scripts.indexOf('seasons.js') !== -1 && scripts.indexOf('seasons.js') < scripts.indexOf('background.js'),
    'Firefox runs the background without the calendar');
});

test('every edition ships its sheet, and every page that links themes links it', () => {
  for (const ed of S.EDITIONS) {
    assert.ok(fs.existsSync(path.join(ROOT, 'themes', ed.key + '.css')), 'no themes/' + ed.key + '.css');
    assert.ok(['dark', 'light'].includes(ed.mode), ed.key + ' has no gallery half');
    for (const page of ['sidepanel.html', 'compose.html', 'prompt.html', 'help.html', 'wallets.html', 'welcome.html']) {
      assert.ok(read(page).includes('href="themes/' + ed.key + '.css"'), page + ' does not link ' + ed.key + '.css');
    }
    const light = read('composer-core.js').match(/const LIGHT_THEMES = new Set\(\[([^\]]*)\]\)/)[1];
    assert.equal(light.includes("'" + ed.key + "'"), ed.mode === 'light', ed.key + ' is in the wrong half of LIGHT_THEMES');
  }
});

// ---- the card ----------------------------------------------------------------------------

test('THE CARD IS OFFERED ONCE A SEASON, AND NOT IN THE LAST FEW DAYS', () => {
  const src = read('sidepanel.js');
  const fn = src.slice(src.indexOf('function maybeShowSeasonCard('), src.indexOf('const farewellSaid'));
  assert.match(fn, /settings\.seasonalOffers === false\) return;/, 'the setting does not stop the card');
  assert.match(fn, /const id = SEASONS\.seasonId\(ed\.key, now\);/);
  assert.match(fn, /\(got\[SEASON_CARD_SEEN\] \|\| \[\]\)\.includes\(id\)\) return;/, 'an answered card comes back');
  assert.match(fn, /end - now > SEASON_CARD_QUIET_DAYS \* 86400000/);
  // One card at a time, and the update card goes first.
  assert.match(fn, /if \(got\.versionCard \|\| \$\('version-card'\)/);
  // The buttons have words, so they take their own row under the content (CLAUDE.md).
  assert.match(fn, /h\('div', \{ className: 'season-card-actions' \}, \[wear, later\]\)/);
  // Both answers are remembered, not just the yes.
  assert.match(fn, /later\.addEventListener\('click', done\);/);
});

test('the farewell clears the stored choice once the calendar has taken it off', () => {
  const src = read('sidepanel.js');
  const fn = src.slice(src.indexOf('function maybeSayFarewell('), src.indexOf('function paintSpecialEditions('));
  assert.match(fn, /if \(!key \|\| !SEASONS\.isSeasonal\(key\) \|\| SEASONS\.resolve\(settings, pk\)\) return;/,
    'the farewell fires while the edition is still in season');
  assert.match(fn, /SIDECAR_SET_SEASONAL_FOR', pubkey: pk, theme: ''/);
});

test('new interface text goes through t()', () => {
  const src = read('sidepanel.js');
  const block = src.slice(src.indexOf('// ---- special editions: the seasonal themes'), src.indexOf('// ---- web of trust'));
  for (const s of ["t('Wear it')", "t('Not now')", "t('Special edition theme')", "t('Until {{date}}'", "t('Back to {{theme}}'"]) {
    assert.ok(block.includes(s), s + ' is not translated');
  }
  assert.doesNotMatch(block, /innerHTML/);
});
