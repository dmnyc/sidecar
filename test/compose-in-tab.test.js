'use strict';

// "WRITE IN A TAB BY DEFAULT".
//
// The setting only decides which composer opens first. Both read and write the one slot
// in the encrypted draft store, so nothing is copied and nothing can be stranded: the
// risk here is not data, it is the routes that reach openComposer with something already
// in hand, and the one thing the tab cannot do.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
const bare = panel.replace(/^\s*\/\/.*$/gm, '');

const composer = (() => {
  const at = bare.indexOf('async function openComposer(');
  let d = 0;
  for (let i = bare.indexOf('{', at); i < bare.length; i++) {
    if (bare[i] === '{') d++;
    else if (bare[i] === '}' && --d === 0) return bare.slice(at, i + 1);
  }
  throw new Error('unbalanced');
})();

test('IT IS OFF UNTIL TURNED ON', () => {
  // The panel is where this app lives; a setting that moves you into a browser tab is
  // one to opt into rather than out of.
  assert.match(bare, /\$\('compose-tab-toggle'\)\.checked = settings\.composeInTab === true;/);
  assert.match(bare, /settings: \{ composeInTab: e\.target\.checked \}/);
  assert.match(html, /id="compose-tab-toggle"/);
});

test('DECIDED ONCE, NOT AT EACH CALL SITE', () => {
  // Five routes reach openComposer: the FAB, the welcome nudge, a reply from the bell, a
  // quote-repost, and the first-post tip. Reading the setting inside means a sixth added
  // later gets it without anybody remembering.
  assert.match(composer, /composeInTab === true/);
  const calls = (bare.match(/openComposer\(/g) || []).length - 1; // minus the declaration
  assert.ok(calls >= 4, 'expected several entry routes, found ' + calls);
  // Lines that only mirror the setting into the Settings switch do not route anything,
  // and that switch follows storage now that the tab's footer can flip it too.
  const routing = bare.split('\n').filter((l) => /composeInTab/.test(l) && !/compose-tab-toggle|e\.target\.checked/.test(l));
  assert.equal(routing.length, 1,
    'the setting is read in more than one place, so a route can disagree with another');
});

test('A POLL IS NO LONGER AN EXCEPTION', () => {
  // A poll draft used to be held back, because the tab had no editor for one: opening it
  // there showed the question and the options as nothing, then published a plain note
  // over the top of them. The tab builds the same editor out of composer-core now.
  const page = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');
  assert.match(page, /SC\.buildPollEditor\(\{/, 'the tab lost its poll editor, so the exception has to come back');
  assert.ok(!/This draft has a poll, so it opens in the panel/.test(panel),
    'the setting still refuses a poll draft');
  // And the hint no longer promises polls stay in the panel.
  assert.ok(!/Polls stay here/.test(html));
  assert.match(html, /Open notes, replies and polls in a tab/);
});

test('TEXT PASSED IN IS SEEDED BEFORE THE TAB OPENS', () => {
  // Two routes hand openComposer their text rather than having it typed: the welcome
  // nudge and a quote-repost. Without seeding, both arrive in the tab as a blank note
  // and whatever they meant to say is gone.
  assert.match(composer, /if \(initialText && !\(slot && slot\.text && slot\.text\.trim\(\)\)\) \{/);
  assert.match(composer, /text: initialText, savedAt: Date\.now\(\)/);
  // NEVER over what is already there: a draft in progress outranks a prefill.
  assert.match(composer, /!\(slot && slot\.text && slot\.text\.trim\(\)\)/);
});

test('A REPLY SENT TO THE TAB STILL GIVES THE BELL BACK', () => {
  // The bell's reply route hands in a way back to the list it came from, and that is as
  // true when the composer opens somewhere else: without it the sheet is gone and the
  // reader has lost their place in a list they were working through.
  assert.match(composer, /await handOffToTab\(dk, \(opts && opts\.replyTo\) \|\| null\);\s*\n\s*if \(opts && opts\.returnTo\) opts\.returnTo\(\);/);
});

test('ONE HANDOFF, SHARED WITH EXPAND', () => {
  // Two copies of this drifted once already, and a reply arriving with no target was the
  // result. The setting and the button call the same function.
  assert.match(bare, /async function handOffToTab\(dkey, replyTo\)/);
  assert.match(composer, /await handOffToTab\(dk,/);
  const expand = bare.slice(bare.indexOf("expand.addEventListener('click'"));
  assert.match(expand.slice(0, 900), /await handOffToTab\(dkey, replyTo\)/);
});

test('a settings read that fails leaves you in the panel', () => {
  // The panel composer always works. Defaulting the other way on a storage hiccup would
  // send somebody to a tab they did not ask for and cannot easily get back from.
  assert.match(composer, /let inTab = false;/);
  assert.match(composer, /catch \(_\) \{\}/);
});

test('THE TAB CAN TURN ITS OWN DEFAULT ON AND OFF', () => {
  // The same setting as Settings, from the tab's footer, and each follows the other.
  const page = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');
  const tabHtml = fs.readFileSync(path.join(ROOT, 'compose.html'), 'utf8');
  assert.match(tabHtml, /id="compose-default-toggle"/);
  assert.match(tabHtml, /data-i18n="Always use the full-size composer"/);
  assert.match(page, /settings: \{ composeInTab: tabDefault\.checked \}/);
  assert.match(page, /changes\.sidecar_settings\.newValue \|\| \{\}\)\.composeInTab === true/);
  assert.match(bare, /\$\('compose-tab-toggle'\)\.checked = \(changes\.sidecar_settings\.newValue/);
});
