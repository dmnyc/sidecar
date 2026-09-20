'use strict';

// The seam between the panel and the composer it shares.
//
// composer-core.js holds the DOM toolkit and the mention editor so a second page can have
// a composer without a second copy of either. Sidecar has no build step, so the seam is a
// script tag and a global, and nothing in the language stops the moved code reaching back
// into the panel's scope. It reaches into a scope that is not there, which means it does
// not fail until somebody types an @ in the browser.
//
// That already happened once during the extraction: the follow-list cache was read
// straight off `followListCache` and `state.activePubkey`. It passed every test, because
// every test reads source rather than running the editor, and it would have thrown on the
// first keystroke in the new page. These two checks are what makes that class of mistake
// loud at the point it is made.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');
const pageHtml = fs.readFileSync(path.join(ROOT, 'compose.html'), 'utf8');

// Both installers, checked the same way. Two pages build the editor now, and a dep the
// second one forgets is undefined at run time in exactly the place no test looks.
const INSTALLERS = [
  { name: 'sidepanel.js', src: panel, open: 'window.SidecarCore.installComposer({', close: '\n    });' },
  { name: 'compose.js', src: page, open: 'SC.installComposer({', close: '\n  });' },
];

// Comments and string literals say a lot of things the code does not do.
const strip = (src) => src
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, "''");
const bareCore = strip(core);

test('EVERY COLLABORATOR THE CORE READS IS ONE THE PAGE HANDS IN', () => {
  // The exact check, not a heuristic: gather the names the core reaches for through
  // `deps.`, gather the keys the panel passes to installComposer, and require the first
  // set to be inside the second. A dep added to the core and forgotten at the call site
  // is undefined at run time and nowhere in any other test.
  const used = new Set([...bareCore.matchAll(/\bdeps\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  assert.ok(used.size > 5, 'the scan found almost nothing, so it is probably broken');

  for (const { name, src, open, close } of INSTALLERS) {
    const at = src.indexOf(open);
    assert.ok(at > -1, name + ' does not install the composer');
    const args = src.slice(at).slice(0, src.slice(at).indexOf(close));
    const supplied = new Set([...args.matchAll(/(?:^|[\s,{])([A-Za-z_$][\w$]*)\s*(?:,|:|$)/gm)].map((m) => m[1]));
    const missing = [...used].filter((n) => !supplied.has(n)).sort();
    assert.deepEqual(missing, [], name + ' never passes: ' + missing.join(', '));
  }
});

test('THE CORE REACHES FOR NOTHING THAT ONLY EXISTS IN THE PANEL', () => {
  // A denylist of the panel's most-used globals rather than a full scope analysis, because
  // a heuristic that cries wolf gets deleted. These are the ones the moved code sat next
  // to for years and would reach for out of habit.
  const panelOnly = [
    'state.', 'followListCache', 'followListPubkey', '_profileCache', '_notifProfiles',
    'toast(', 'closeModal(', 'openModal(', 'renderMain(',
  ];
  for (const name of panelOnly) {
    assert.ok(!bareCore.includes(name), 'composer-core.js reaches for ' + name);
  }
  // chrome.* was on that list and came off when the proof-of-work miner moved here: it
  // resolves its worker with chrome.runtime.getURL, which answers the same on every
  // extension page. The narrower rule is the one that was always meant: nothing that
  // talks to the background, because a page hands its own `call` in and two routes to the
  // worker is two places for a message name to drift.
  assert.ok(!/chrome\.runtime\.sendMessage/.test(bareCore), 'the page supplies call()');
  assert.ok(!/chrome\.storage/.test(bareCore), 'settings belong to the page that reads them');
  // $('id') is the panel's element lookup and assumes the panel's markup.
  assert.ok(!/\$\(/.test(bareCore), "composer-core.js uses the panel's $() lookup");
});

test('the panel loads it first, because it destructures it on line one', () => {
  const coreAt = html.indexOf('composer-core.js');
  const panelAt = html.indexOf('sidepanel.js"');
  assert.ok(coreAt > -1, 'sidepanel.html does not load composer-core.js');
  assert.ok(coreAt < panelAt, 'composer-core.js has to come first');
  assert.match(panel, /const \{ show, hide, ICONS, FILLED_ICONS, icon, h \} = window\.SidecarCore;/);
});

test('what the core hands back is what the panel takes', () => {
  // Same shape of check as the deps one, the other way round: a name destructured off
  // SidecarCore that the core never returns is undefined, silently, at the top of the
  // panel's own scope.
  const ret = core.slice(core.lastIndexOf('  return {'));
  const exported = new Set([...ret.matchAll(/([A-Za-z_$][\w$]*)\s*(?:,|:|\n)/g)].map((m) => m[1]));
  const taken = [...panel.matchAll(/const \{([^}]*)\} = window\.SidecarCore;/g)]
    .flatMap((m) => m[1].split(',').map((s) => s.trim()))
    .filter(Boolean);
  assert.ok(taken.length > 5, 'the scan found almost nothing, so it is probably broken');
  for (const name of taken) assert.ok(exported.has(name), 'the core never returns ' + name);

  // AND THE OTHER HALF, which is the one that actually broke. Moving logoSrcFor and
  // avatarPhSrc to the core left the panel still calling them and no longer importing
  // them: a ReferenceError on every theme apply, and nothing here or anywhere else said
  // so, because every test reads source rather than running the panel. Any exported name
  // the panel still USES it must also TAKE.
  const held = new Set(taken);
  for (const name of exported) {
    if (name === 'installComposer') continue; // reached through window.SidecarCore by design
    const uses = new RegExp('(?<![.\\w$])' + name + '\\b').test(strip(panel));
    if (uses) assert.ok(held.has(name), 'sidepanel.js uses ' + name + ' without taking it');
  }
});

test('the expanded composer page loads the core before it uses it', () => {
  const coreAt = pageHtml.indexOf('composer-core.js');
  const pageAt = pageHtml.indexOf('compose.js');
  assert.ok(coreAt > -1, 'compose.html does not load composer-core.js');
  assert.ok(coreAt < pageAt, 'composer-core.js has to come first');
  // nostr-tools too: the editor decodes and encodes bech32 through it.
  assert.ok(pageHtml.indexOf('nostr-tools.js') < coreAt);
});
