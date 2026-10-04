'use strict';

// Where i18n.js is loaded, what the manifest takes from _locales, and the rules every
// locale file must keep (docs/i18n-design.md §3.2, §3.5, §3.10).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---- loading --------------------------------------------------------------------------

const PAGES = ['sidepanel.html', 'prompt.html', 'welcome.html', 'compose.html', 'help.html',
  'wallets.html', 'scan-qr.html', 'relay-rider.html', 'theme-tile.html', 'highlight.html'];

test('EVERY EXTENSION PAGE LOADS i18n.js BEFORE ITS OWN SCRIPTS', () => {
  for (const page of PAGES) {
    const html = read(page);
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    const at = scripts.indexOf('i18n.js');
    assert.ok(at !== -1, page + ' does not load i18n.js');
    // Everything after it may use it; only the head scripts that never show a word run
    // earlier: the sky plate, the special editions' calendar, and the composer's
    // first-paint theme.
    for (const early of scripts.slice(0, at)) {
      assert.ok(['sky-plate.js', 'seasons.js', 'compose-boot.js'].includes(early), page + ' runs ' + early + ' before i18n.js');
    }
  }
});

test('every HTML page with a script is on that list', () => {
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && /<script src=/.test(read(f)));
  assert.deepEqual(pages.sort(), [...PAGES].sort(), 'a new page must load i18n.js and join this list');
});

test('the background loads it first, in Chrome and in Firefox', () => {
  const bg = read('background.js');
  assert.match(bg, /importScripts\('i18n\.js', /);
  const scripts = JSON.parse(read('manifest.json')).background.scripts;
  assert.equal(scripts[0], 'i18n.js');
});

test('numbers in the panel go through I18N, never a hard-coded en-US', () => {
  const panel = read('sidepanel.js').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(panel, /toLocaleString\('en-US'\)/);
  assert.doesNotMatch(panel, /Intl\.NumberFormat\('en-US'/);
  assert.match(panel, /const I18N = window\.SidecarI18n;/);
});

// ---- the manifest ---------------------------------------------------------------------

test('EVERY __MSG__ IN THE MANIFEST HAS ITS ENGLISH, OR THE EXTENSION WILL NOT LOAD', () => {
  const manifest = read('manifest.json');
  assert.equal(JSON.parse(manifest).default_locale, 'en');
  const en = JSON.parse(read('_locales/en/messages.json'));
  const used = [...manifest.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]);
  assert.ok(used.length >= 4, 'the name, description, action and sidebar titles');
  for (const key of used) {
    assert.ok(en[key] && typeof en[key].message === 'string' && en[key].message, key + ' has no English message');
  }
});

test('each _locales translation carries only keys English has, and none empty', () => {
  const en = JSON.parse(read('_locales/en/messages.json'));
  for (const lang of fs.readdirSync(path.join(ROOT, '_locales'))) {
    const m = JSON.parse(read(path.join('_locales', lang, 'messages.json')));
    for (const [k, v] of Object.entries(m)) {
      assert.ok(en[k], lang + ' has ' + k + ', which English does not');
      assert.ok(v.message && v.message.trim(), lang + ' leaves ' + k + ' empty');
    }
  }
});

// ---- locale files ----------------------------------------------------------------------
//
// locales/<lang>.json, flat { "English key": "translation" }. None exist yet; these rules
// are here so the first one meets them.

const LOCALES = path.join(ROOT, 'locales');
const locales = fs.existsSync(LOCALES) ? fs.readdirSync(LOCALES).filter((f) => f.endsWith('.json')) : [];
const placeholders = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
const baseKey = (k) => k.replace(/_(zero|one|two|few|many|other)$/, '');

test('LOCALE FILES CARRY NO MARKUP', () => {
  // Translated text goes into textContent only. A locale file is something a pull request
  // can change, so it must never be a way to put HTML on an approval card.
  for (const f of locales) {
    for (const [k, v] of Object.entries(JSON.parse(read(path.join('locales', f))))) {
      assert.doesNotMatch(v, /<[a-z!/]/i, f + ': "' + k + '" contains markup');
    }
  }
});

test('A TRANSLATION KEEPS EXACTLY ITS KEY\'S {{PLACEHOLDERS}}', () => {
  // A dropped {{amount}} would show a payment card with no amount on it.
  for (const f of locales) {
    for (const [k, v] of Object.entries(JSON.parse(read(path.join('locales', f))))) {
      assert.deepEqual(placeholders(v), placeholders(baseKey(k)), f + ': "' + k + '"');
    }
  }
});

test('plural suffixes are only the CLDR forms', () => {
  for (const f of locales) {
    for (const k of Object.keys(JSON.parse(read(path.join('locales', f))))) {
      const m = k.match(/_([a-z]+)$/);
      if (m && /^(zero|one|two|few|many|other)$/.test(m[1]) === false && /^[a-z]+$/.test(m[1]) && k.includes('{{count}}')) {
        assert.fail(f + ': "' + k + '" has a plural suffix that is not a CLDR form');
      }
    }
  }
});

test('A TRANSLATED PAGE WAITS FOR ITS LANGUAGE FILE BEFORE IT DRAWS', () => {
  // The language code is known synchronously, but a real language's strings are a
  // fetch. The panel used to apply its data-i18n labels and render before that landed,
  // so everything it drew first stayed English; the pseudo-locale, which loads no file,
  // could never show it. Each page awaits I18N.ready before applyDom and its first draw.
  const strip = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const panel = strip(read('sidepanel.js'));
  const boot = panel.match(/const boot = async \(\) => \{[\s\S]*?\n  \};/);
  assert.ok(boot, 'sidepanel.js has no boot that waits');
  const wait = boot[0].indexOf('await I18N.ready');
  assert.notEqual(wait, -1, 'the panel boot does not wait for the language file');
  assert.ok(wait < boot[0].indexOf('I18N.applyDom()'), 'the panel applies labels before the file loads');
  assert.ok(wait < boot[0].indexOf('refresh()'), 'the panel draws before the file loads');
  assert.doesNotMatch(panel.slice(panel.indexOf('// ---- boot ----')), /^\s*I18N\.applyDom\(\);/m, 'an unguarded applyDom is back at boot');
  for (const f of ['prompt.js', 'welcome.js']) {
    const src = strip(read(f));
    assert.ok(src.indexOf('await I18N.ready') !== -1 && src.indexOf('await I18N.ready') < src.indexOf('I18N.applyDom()'), f + ' applies labels before the file loads');
  }
});
