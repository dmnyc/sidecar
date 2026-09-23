'use strict';

// THE CARD SHOWN ONCE AFTER AN UPDATE.
//
// Two things decide whether it appears, and they are deliberately in different files.
// The WORKER decides whether an update happened, because `chrome.runtime.onInstalled` is
// the only signal that knows an update from a fresh install. The PANEL decides whether
// that update has been acknowledged yet.
//
// Splitting it that way is the whole design. Comparing a stored version against the
// running one cannot tell an update from an install: a new install has no stored version
// and neither does a browser whose storage was cleared, so the obvious implementation
// shows release notes to somebody who has never opened the extension. That is the one
// case this must not do, and it is the case a "last seen version" check gets wrong.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const bare = panel.replace(/^\s*\/\/.*$/gm, '');

// ---- the comparison, lifted and run ----

const ctx = { Math, String, parseInt };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  bg.match(/function isNewerVersion\(a, b\)[\s\S]*?\n\}/)[0] + ';globalThis.f = isNewerVersion;',
  ctx
);
const isNewer = ctx.f;

test('VERSIONS COMPARE AS NUMBERS, NOT AS STRINGS', () => {
  // The pair that matters, and the one a string compare gets backwards: '1.14.0' sorts
  // BEFORE '1.9.1' alphabetically, because '1' is less than '9'. Sidecar has already
  // shipped a 1.9.1 and a 1.14.0, so this is not hypothetical.
  assert.equal(isNewer('1.14.0', '1.9.1'), true, 'a string compare would say no here');
  assert.equal(isNewer('1.9.1', '1.14.0'), false);

  assert.equal(isNewer('1.14.0', '1.13.0'), true);
  assert.equal(isNewer('1.14.1', '1.14.0'), true);
  assert.equal(isNewer('2.0.0', '1.14.0'), true);

  // Equal is not newer, in either spelling. '1.14' and '1.14.0' are the same version,
  // and a missing part reads as zero rather than as absent.
  assert.equal(isNewer('1.14.0', '1.14.0'), false);
  assert.equal(isNewer('1.14.0', '1.14'), false);
  assert.equal(isNewer('1.14', '1.14.0'), false);

  // Garbage does not become news.
  assert.equal(isNewer('', '1.14.0'), false);
  assert.equal(isNewer('nonsense', '1.14.0'), false);
});

// ---- what the worker writes ----

test('ONLY AN UPDATE WRITES THE FLAG, NEVER A FRESH INSTALL', () => {
  const listener = bg.slice(bg.indexOf('chrome.runtime.onInstalled.addListener'));
  const body = listener.slice(0, listener.indexOf('\n});') + 4);

  // The install branch is untouched and still does its own thing.
  assert.match(body, /if \(details\.reason === 'install'\) \{/);
  assert.match(body, /welcome\.html/, 'the install branch lost its welcome tab');

  // And the update branch is separate, rather than an else on the install one: a browser
  // may fire onInstalled for other reasons (chrome_update, shared_module_update) and
  // neither of those is news about Sidecar.
  assert.match(body, /if \(details\.reason === 'update'\) \{/);
  assert.match(body, /chrome\.storage\.local\.set\(\{ versionCard: \{ to, from: details\.previousVersion \|\| null \} \}\)/);

  // A DOWNGRADE IS NOT NEWS. Rolling a build back or sideloading over a newer one would
  // otherwise offer "what's new" pointing at notes for a version being left behind.
  assert.match(body, /isNewerVersion\(to, details\.previousVersion\)/);
  assert.match(body, /!details\.previousVersion \|\|/,
    'an update with no previousVersion is dropped, so an upgrade would show nothing');
});

// ---- what the panel does with it ----

test('THE FLAG IS CLEARED ON ACKNOWLEDGEMENT, NOT ON PAINT', () => {
  const fn = bare.slice(bare.indexOf('function maybeShowVersionCard()'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));

  // Painting is not reading. A panel opened and shut while somebody was doing something
  // else would otherwise spend the single showing this ever gets.
  assert.match(body, /const done = \(\) => \{\s*chrome\.storage\.local\.remove\('versionCard'\);/);
  assert.doesNotMatch(body.slice(0, body.indexOf('const done')), /storage\.local\.remove/,
    'the flag is cleared before the card is even built');

  // Both ways out count, because following the link IS reading the notes and the card
  // must not be waiting when they come back.
  assert.match(body, /x\.addEventListener\('click', done\)/);
  assert.match(body, /done\(\);\s*\n\s*openExtensionPage\('help\.html', '#whats-new'\)/,
    'the link does not acknowledge, so the card survives being read');

  // It says which version, which is half of what was asked for.
  assert.match(body, /'Updated to ' \+ versionCard\.to/);
  // Guarded against a second one stacking under the tabs on a re-entry.
  assert.match(body, /\$\('version-card'\)\) return;/);
});

test('it runs at boot, and costs nothing when there is no update', () => {
  // An update is about the whole extension rather than about anything you did, so it is
  // not hung off a tab or an account switch.
  assert.match(bare, /initStampedType\(\);\s*\n\s*maybeShowVersionCard\(\);/);
  // One storage read, and it returns before touching the DOM when the flag is absent.
  const fn = bare.slice(bare.indexOf('function maybeShowVersionCard()'));
  assert.match(fn.slice(0, 260), /if \(!versionCard \|\| !versionCard\.to/);
});

test('it reuses the switch tip rather than inventing a second banner', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  // Same metrics, same dismiss button, same place under the tabs. Two banners in one
  // spot with two sets of numbers is two things to keep in step.
  assert.match(bare, /className: 'switch-tip version-card'/);
  assert.match(bare, /nav\.tabs'\)\.insertAdjacentElement\('afterend', card\)/);
  // But a different colour, because the switch tip is a caution about posting from the
  // wrong account and this is news. Identical-looking banners in the same place train
  // people to dismiss both unread.
  assert.match(css, /\.version-card \{ border-color: rgba\(167, 139, 250/);
  assert.match(css, /\.version-card \.switch-tip-title \{ color: var\(--lav\); \}/);
  // After .switch-tip-link so the colour wins the tie; both are one class.
  assert.ok(css.indexOf('.version-card .switch-tip-link') > css.indexOf('.switch-tip-link:hover'),
    'the lavender link loses to the gold one on source order');
});

test('THE PREVIEW LIVES BEHIND THE DEV-BUILD GATE', () => {
  // The card is armed by chrome.runtime.onInstalled, which is the one event you cannot
  // fire at yourself on an unpacked build, so without this there is no way to look at it
  // on a local build.
  //
  // It sits in the bug-badge Dev tools sheet with the rest of the dev affordances, so it
  // is gated the way they all are: openDebugPanel returns before building anything if the
  // build is not a development one, and the badge that opens it is hidden besides. Two
  // gates, neither of them a condition wrapped around this button that someone could
  // forget to write.
  const fn = bare.slice(bare.indexOf('async function openDebugPanel()'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));

  assert.match(body.slice(0, 200), /await devBuildReady;\s*\n\s*if \(!isDevBuild\(\)\) return;/,
    'the sheet builds before it knows whether this is a dev build');
  assert.match(body, /'Preview the update card'/);
  // And it is not ALSO hanging off a settings row, where it would need its own gate.
  const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  assert.doesNotMatch(html, /dev-version-card/,
    'a second copy of the preview outside the dev-build gate');

  // It arms the real flag rather than building a lookalike card, so what you preview is
  // what ships.
  assert.match(body, /chrome\.storage\.local\.set\(\{ versionCard: \{ to: ver \|\| 'this version', from: null \} \}/);

  // Through afterModalClose, and only then to the main view: arming the flag while the
  // sheet is still up paints the card underneath it, and it is spent by the time the
  // sheet is dismissed.
  assert.match(body, /afterModalClose\(\(\) => \{\s*\n\s*hide\(\$\('view-settings'\)\);\s*\n\s*show\(\$\('view-main'\)\);\s*\n\s*maybeShowVersionCard\(\)/);
});
