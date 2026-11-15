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
    // The translator implementation necessarily accepts variable keys.
    if (f === 'i18n.js') continue;
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

test('qualified I18N calls expose literal keys and dynamic calls remain detectable',()=>{
  assert.deepEqual(K.extractFromJs("SidecarI18n.t('Zap comment'); I18N.tSec('Secret'); SidecarI18n.tn('one', 'many', 2); unrelated.t('ignore');"),[
    {key:'Zap comment'},{key:'Secret',security:true},{key:'one',other:'many',plural:true},
  ]);
  assert.equal(K.nonLiteralCalls('SidecarI18n.t(condition ? a : b); I18N.tSec(key);').length,2);
});

test('mixed plain and plural uses retain both lookup shapes regardless of source order', () => {
  const os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-i18n-keys-'));
  try {
    fs.writeFileSync(path.join(root, 'sidepanel.js'), "t('Followers'); tn('Followers', 'Many followers', n); tSec('Followers');");
    const [key] = K.allKeys(root);
    assert.deepEqual(key, {key:'Followers',simple:true,plural:true,other:'Many followers',security:true});
    // Calls in different files exercise both encounter orders, independent of
    // extractFromJs grouping the two call syntaxes during extraction.
    fs.writeFileSync(path.join(root, 'sidepanel.js'), "tn('Followers', 'Many followers', n);");
    fs.writeFileSync(path.join(root, 'prompt.js'), "tSec('Followers');");
    assert.deepEqual(K.allKeys(root), [{key:'Followers',other:'Many followers',plural:true,security:true,simple:true}]);
  } finally { fs.rmSync(root, {recursive:true,force:true}); }
});

test('the generated translation template includes plain and plural count labels', () => {
  const {execFileSync}=require('node:child_process');
  const catalog=JSON.parse(execFileSync(process.execPath,[path.join(K.ROOT,'scripts/i18n-keys.mjs'),'--json'],{encoding:'utf8'}));
  for (const key of ['{{count}} following','{{count}} muted']) {
    assert.ok(Object.hasOwn(catalog,key));
    assert.ok(Object.hasOwn(catalog,key+'_one'));
    assert.ok(Object.hasOwn(catalog,key+'_other'));
  }
});

test('HTML keys decode numeric entities once to match DOM attributes', () => {
  const { extractFromHtml } = require('../scripts/i18n-keys-core');
  assert.deepEqual(extractFromHtml('<p data-i18n="Sidecar can&#x27;t &amp; won&#39;t &amp;lt;"></p>'),
    [{ key: "Sidecar can't & won't &lt;" }]);
});
