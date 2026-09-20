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

  // The other return, which installComposer hands back. It was unguarded, so a name could
  // be dropped from it while both the panel and the page went on destructuring it: not a
  // ReferenceError this time, just undefined, called later, somewhere else.
  const inst = core.slice(core.indexOf('  function installComposer(d) {'));
  const instRet = inst.slice(inst.indexOf('return {'), inst.indexOf('};') + 2);
  const given = new Set([...instRet.matchAll(/([A-Za-z_$][\w$]*)\s*(?:,|\n)/g)].map((m) => m[1]));
  for (const { name, src, open, close } of INSTALLERS) {
    const at = src.indexOf(open);
    // The destructure immediately BEFORE the call, found backwards. Searching forwards
    // finds the first `const {` in the file and runs the whole way here, which is the
    // same over-match that let the missing-imports check come back clean.
    const decl = src.slice(0, at);
    const from = decl.lastIndexOf('const {');
    if (from === -1) continue; // that page destructures nothing, which is its own business
    const m = decl.slice(from).match(/const \{([^{}]*)\}\s*=\s*$/);
    if (!m) continue;
    for (const want of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      assert.ok(given.has(want), name + ' takes ' + want + ', which installComposer never returns');
    }
  }

});

test('THE PANEL STILL HAS EVERY NAME IT CALLS', () => {
  // THE ONE THAT KEEPS BREAKING, three times in a day. A function moves to the core, the
  // panel goes on calling it, and nothing says so: every test here reads source rather
  // than running the panel, so a ReferenceError waits until somebody opens the tab it is
  // on. It took logoSrcFor and avatarPhSrc out on the theme apply, and then IMG_EXT,
  // embedRef, renderNoteText, renderLinkCard, resolveMentions, paintCountdownNum and
  // tryBlossomFirst out on the Profile tab, the reply context strip, the web-comment
  // sheet, the unlock cooldown and the profile-picture uploader at once.
  //
  // An earlier version of this checked only the names the core RETURNS, which is why it
  // missed all seven: they were moved and never exported at all. This checks everything
  // the core declares.
  const declared = new Set();
  for (const m of bareCore.matchAll(/^  (?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)) declared.add(m[1]);
  for (const m of bareCore.matchAll(/^  (?:const|let) ([A-Za-z_$][\w$]*)\s*=/gm)) declared.add(m[1]);
  assert.ok(declared.size > 20, 'the scan found almost nothing, so it is probably broken');

  // Anchored to the real destructures. A looser pattern swallows the file between the
  // first `const {` and the installComposer call, which is how the earlier version of
  // this check came back clean while the panel was broken.
  const taken = new Set();
  for (const m of panel.matchAll(/const \{([^{}]*)\} = window\.SidecarCore(?:;|\.installComposer)/g)) {
    m[1].split(',').forEach((x) => { if (x.trim()) taken.add(x.trim()); });
  }
  const barePanel = strip(panel);
  const own = new Set();
  for (const m of barePanel.matchAll(/^  (?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)) own.add(m[1]);
  for (const m of barePanel.matchAll(/^  (?:const|let|var) ([A-Za-z_$][\w$]*)\s*[=;]/gm)) own.add(m[1]);

  const missing = [...declared].filter((n) =>
    !taken.has(n) && !own.has(n) && new RegExp('(?<![.\\w$])' + n + '\\b').test(barePanel)).sort();
  assert.deepEqual(missing, [], 'sidepanel.js calls these and no longer has them: ' + missing.join(', '));
});

test('THE ACTIVITY PING IS THROTTLED WHERE IT IS CALLED, NOT WHERE IT IS SUPPLIED', () => {
  // It fires on every input event. The panel wrapped its own in a 20s guard; the expanded
  // composer page passed the bare message, so a keystroke each woke the service worker for
  // as long as somebody was writing. Only one of the two was ever going to be remembered,
  // so the guard moved to the one place both go through.
  assert.match(bareCore, /if \(now - lastActivityPing < 20000\) return;/);
  const editor = bareCore.slice(bareCore.indexOf('function createMentionEditor(opts)'));
  const scope = editor.slice(0, editor.indexOf('\n  }\n'));
  assert.match(scope, /pingActivity\(\);/);
  assert.ok(!/deps\.noteActivity\(\)/.test(scope), 'the editor must go through the throttle');
  // And a page whose noteActivity throws does not take a keystroke down with it.
  assert.match(bareCore, /try \{ deps\.noteActivity\(\); \} catch \(_\) \{\}/);
});

test('the expanded composer page loads the core before it uses it', () => {
  const coreAt = pageHtml.indexOf('composer-core.js');
  const pageAt = pageHtml.indexOf('compose.js');
  assert.ok(coreAt > -1, 'compose.html does not load composer-core.js');
  assert.ok(coreAt < pageAt, 'composer-core.js has to come first');
  // nostr-tools too: the editor decodes and encodes bech32 through it.
  assert.ok(pageHtml.indexOf('nostr-tools.js') < coreAt);
});
