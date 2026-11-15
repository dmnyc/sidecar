'use strict';

// A long account list: the active account's overview no longer pushes the rest under the
// fold, and the active account is brought into view, clear of the compose button.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

function drawerRule() {
  const src = panel.match(/let accountStatsExpanded = null;\n\s*const ACCOUNT_STATS_OPEN_MAX = \d+;[\s\S]*?const accountStatsOpen = \(\) => \([\s\S]*?\);/);
  assert.ok(src, 'the drawer rule is gone from sidepanel.js');
  const c = { state: { accounts: [] } };
  vm.createContext(c);
  vm.runInContext(src[0].replace('let accountStatsExpanded', 'var accountStatsExpanded') +
    '\nthis.open = accountStatsOpen; this.set = (v) => { accountStatsExpanded = v; };', c);
  return c;
}

test('the overview starts open for up to three accounts and closed past that', () => {
  const c = drawerRule();
  for (const [n, open] of [[1, true], [3, true], [4, false], [7, false]]) {
    c.state.accounts = Array.from({ length: n }, (_, i) => ({ pubkey: String(i) }));
    assert.equal(c.open(), open, n + ' accounts');
  }
});

test('once you open or close it, that choice wins whatever the count', () => {
  const c = drawerRule();
  c.state.accounts = Array.from({ length: 7 }, (_, i) => ({ pubkey: String(i) }));
  c.set(true);
  assert.equal(c.open(), true);
  c.state.accounts = [{ pubkey: 'a' }];
  c.set(false);
  assert.equal(c.open(), false);
  // The toggle flips what is showing, not the stored null.
  assert.match(panel, /accountStatsExpanded = drawer\.classList\.contains\('collapsed'\);/);
});

test('arriving on Accounts, and the first time the panel opens there, shows the active account', () => {
  assert.match(panel, /else if \(name === 'accounts'\) \{ renderMain\(\); revealActiveAccount\(\); \}/);
  assert.match(panel, /if \(!_activeRevealedOnOpen\) _activeRevealedOnOpen = revealActiveAccount\(\);/);
  // Declared before renderMain, which reads it, so an early render cannot hit the TDZ.
  assert.ok(panel.indexOf('let _activeRevealedOnOpen = false;') < panel.indexOf('  function renderMain() {'));
  const at = panel.indexOf('  function revealActiveAccount() {');
  const fn = panel.slice(at, panel.indexOf('\n  }\n', at));
  assert.match(fn, /if \(!row \|\| !row\.offsetParent\) return false;/, 'a hidden tab does not count as shown');
  assert.match(fn, /scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.ok(!/scrollIntoView\(\{ block: '(start|center)'/.test(fn), 'scrolled only as far as needed');
});

test('the compose button never sits over the account it scrolled to', () => {
  // 18px up and 54px tall, so the margin has to clear 72px.
  const m = css.match(/\.item-active, \.account-stats-toggle \{ scroll-margin-bottom: (\d+)px; \}/);
  assert.ok(m, 'the scroll margin is gone');
  assert.ok(Number(m[1]) >= 72);
});

test('A REFRESH KEEPS THE MAIN VIEW WHERE IT WAS, instead of hiding it back to the top', () => {
  // refresh() hides every view and shows one, and display: none forgets the scroll offset,
  // which undid the reveal above within moments of the panel opening.
  const at = panel.indexOf('  async function refresh(opts) {');
  const fn = panel.slice(at, panel.indexOf('\n  }\n', at));
  const kept = fn.indexOf("const mainScroll = !$('view-main').classList.contains('hidden') && mainScroller ? mainScroller.scrollTop : null;");
  const hidden = fn.indexOf("$('view-main'), $('view-settings'), $('view-profile-edit'), $('view-approval')].forEach(hide);");
  assert.ok(kept > 0 && hidden > kept, 'read before the views are hidden');
  assert.match(fn, /renderMain\(\);\n\s*if \(mainScroll != null && mainScroller\) mainScroller\.scrollTop = mainScroll;/);
});

test('switching accounts, from the list or the header menu, brings the new one into view', () => {
  const sites = panel.match(/await call\(\{ type: 'SIDECAR_SET_ACTIVE', pubkey: a\.pubkey \}\);\s*await refresh\(\);[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*revealActiveAccount\(\);/g) || [];
  assert.equal(sites.length, 2, 'both switch paths reveal after the refresh');
});

// ---- the overview folds while the video player is open ------------------------------------

function playerRule() {
  const m = panel.match(/let accountStatsExpanded = null;[\s\S]*?let accountStatsSync = null;\n\s*\(\(\) => \{[\s\S]*?\}\)\(\);/);
  assert.ok(m, 'the player rule is gone from sidepanel.js');
  const flags = new Set();
  const dock = { classList: { contains: (x) => flags.has(x) } };
  let fire = null;
  const c = {
    state: { accounts: [{ pubkey: 'a' }] }, syncs: 0, $: (id) => (id === 'stream-dock' ? dock : null),
    MutationObserver: class { constructor(f) { fire = f; } observe() {} },
  };
  vm.createContext(c);
  vm.runInContext(m[0].replace('let accountStatsExpanded', 'var accountStatsExpanded').replace('let statsCollapsedForPlayer', 'var statsCollapsedForPlayer').replace('let accountStatsSync', 'var accountStatsSync') +
    '\nthis.open = accountStatsOpen; this.choose = (v) => { accountStatsExpanded = v; }; this.hold = () => statsCollapsedForPlayer;' +
    '\naccountStatsSync = () => { this.syncs++; };', c);
  c.play = (on) => { if (on) flags.add('stream-playing'); else flags.delete('stream-playing'); fire(); };
  return c;
}

test('while the player is open the overview is closed, whatever the count or the choice', () => {
  const c = playerRule();
  assert.equal(c.open(), true, 'one account, open before the player');
  c.play(true);
  assert.equal(c.open(), false);
  assert.equal(c.syncs, 1, 'the drawer on screen is folded without a rebuild');
  c.choose(true);
  assert.equal(c.open(), false, 'an earlier choice to keep it open does not hold it open beside a video');
});

test('closing the player gives the overview back as the person had it', () => {
  const c = playerRule();
  c.choose(false);
  c.play(true); c.play(false);
  assert.equal(c.open(), false, 'they had closed it');
  assert.equal(c.syncs, 2);
  const d = playerRule();
  d.play(true); d.play(false);
  assert.equal(d.open(), true, 'they had left it open by default');
});

test('opening the overview by hand beside a video is honored', () => {
  assert.match(panel, /accountStatsExpanded = drawer\.classList\.contains\('collapsed'\);\n\s*statsCollapsedForPlayer = false;/);
});
