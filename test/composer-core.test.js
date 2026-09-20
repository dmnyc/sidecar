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

  const call = panel.slice(panel.indexOf('window.SidecarCore.installComposer({'));
  const args = call.slice(0, call.indexOf('\n    });'));
  const supplied = new Set([...args.matchAll(/(?:^|[\s,{])([A-Za-z_$][\w$]*)\s*(?:,|:|$)/gm)].map((m) => m[1]));

  const missing = [...used].filter((name) => !supplied.has(name)).sort();
  assert.deepEqual(missing, [], 'the core reads collaborators the panel never passes');
});

test('THE CORE REACHES FOR NOTHING THAT ONLY EXISTS IN THE PANEL', () => {
  // A denylist of the panel's most-used globals rather than a full scope analysis, because
  // a heuristic that cries wolf gets deleted. These are the ones the moved code sat next
  // to for years and would reach for out of habit.
  const panelOnly = [
    'state.', 'followListCache', 'followListPubkey', '_profileCache', '_notifProfiles',
    'toast(', 'closeModal(', 'openModal(', 'renderMain(', 'chrome.',
  ];
  for (const name of panelOnly) {
    assert.ok(!bareCore.includes(name), 'composer-core.js reaches for ' + name);
  }
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
});
