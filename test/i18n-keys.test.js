'use strict';

// The translation keys: what the extractor finds, and the rules that keep that list
// complete (docs/i18n-design.md §3.10).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const K = require('../scripts/i18n-keys-core.js');

test('THE EXTRACTOR READS t() AND tn() THE WAY THE CODE WRITES THEM', () => {
  const keys = K.extractFromJs([
    "el.textContent = t('Copy');",
    'x = t("Double quoted");',
    "y = t('Can\\'t reach {{host}}', { host });",
    "z = tn('{{count}} relay', '{{count}} relays', n);",
    "w = format('not a key'); q = obj.t('not a key either');",
    "// t('a key in a comment is prose, not a call')",
  ].join('\n'));
  assert.deepEqual(keys, [
    { key: 'Copy' },
    { key: 'Double quoted' },
    { key: "Can't reach {{host}}" },
    { key: '{{count}} relay', other: '{{count}} relays', plural: true },
  ]);
});

test('it reads data-i18n attributes from the HTML, entities decoded', () => {
  const keys = K.extractFromHtml('<b data-i18n="Appearance">Appearance</b><input data-i18n-placeholder="Search &amp; find">');
  assert.deepEqual(keys.map((k) => k.key), ['Appearance', 'Search & find']);
});

test('EVERY t() IN THE SOURCE TAKES A LITERAL, OR NO TRANSLATOR EVER SEES IT', () => {
  const offenders = [];
  for (const f of K.JS_FILES) {
    const p = path.join(K.ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const hit of K.nonLiteralCalls(fs.readFileSync(p, 'utf8'))) offenders.push(f + ':' + hit);
  }
  assert.deepEqual(offenders, [], 'pass the English text itself; a variable key cannot be extracted');
});

test('the real source yields the keys already wrapped', () => {
  const keys = K.allKeys().map((k) => k.key);
  for (const k of ['just now', '{{count}} vote']) assert.ok(keys.includes(k), 'missing ' + k);
});

test('A LOCALE FILE CARRIES ONLY KEYS THE CODE STILL USES', () => {
  // A translation of a string that has since changed is dead weight, and a sign the new
  // English went untranslated. en-XB is generated locally from these same keys, so it
  // is skipped: a stale copy on one machine is not a defect in the repo.
  const dir = path.join(K.ROOT, 'locales');
  if (!fs.existsSync(dir)) return;
  const known = new Set(K.allKeys().map((k) => k.key));
  const base = (k) => k.replace(/_(zero|one|two|few|many|other)$/, '');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'en-XB.json')) {
    const stale = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter((k) => !known.has(base(k)));
    assert.deepEqual(stale, [], f + ' translates keys no longer in the code');
  }
});

test('the test locale is git-ignored, so it never ships', () => {
  assert.match(fs.readFileSync(path.join(K.ROOT, '.gitignore'), 'utf8'), /^locales\/en-XB\.json$/m);
});
