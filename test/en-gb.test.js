'use strict';

// UK English (en-GB) is a catalog of differences: it lists only the strings British English
// spells another way (colour, cancelled, recognise, maths), and everything else shows the
// English key as it is. These hold it to the English it is a variant of, and catch a new
// string with an American spelling that has no British entry.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { allKeys } = require('../scripts/i18n-keys-core.js');

const ROOT = path.join(__dirname, '..');
const GB = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', 'en-GB.json'), 'utf8'));
const KEYS = new Set(allKeys().map((k) => k.key));
const params = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort();

// The American spellings Sidecar's strings use, matched as whole words. A new one that a
// string takes up goes here, and its British form into locales/en-GB.json.
const AMERICAN = /\b(color\w*|favor\w*|behavior\w*|honor\w*|neighbor\w*|center\w*|gray\w*|canceled|canceling|labeled|labeling|traveled|traveling|modeled|math|catalog\w*|\w+iz(e|es|ed|ing|ation|ations)|\w+yz(e|es|ed|ing))\b/i;
// Words that end like -ize but are spelled that way on both sides of the Atlantic.
const BOTH = /\b(size|sizes|sized|resize|resized|full-size|prize|prizes|seize|seized)\b/gi;
const american = (s) => AMERICAN.test(s.replace(BOTH, ''));

test('every en-GB entry is an English key, spelled the British way, with its placeholders', () => {
  assert.ok(Object.keys(GB).length > 0);
  for (const [key, value] of Object.entries(GB)) {
    assert.ok(KEYS.has(key), `en-GB lists a string Sidecar no longer has: ${key}`);
    assert.notEqual(value, key, `en-GB repeats the English unchanged: ${key}`);
    assert.deepEqual(params(value), params(key), `en-GB changed the placeholders of: ${key}`);
    assert.equal(american(value), false, `en-GB still spells it the American way: ${value}`);
  }
});

test('A NEW STRING WITH AN AMERICAN SPELLING NEEDS ITS BRITISH ENTRY', () => {
  const missing = [...KEYS].filter((k) => american(k) && !(k in GB));
  assert.deepEqual(missing, [], 'add these to locales/en-GB.json, spelled the British way');
});

test('a UK browser reads the British catalog, with English for everything it leaves out', async () => {
  const asked = [];
  const ctx = {
    Intl, Promise, Object, String, Number, Math, Set, Array, JSON,
    chrome: {
      i18n: { getUILanguage: () => 'en-GB' },
      storage: { local: { get: (k, cb) => cb({ sidecar_settings: {} }) } },
      runtime: { getURL: (p) => p },
    },
    fetch: async (url) => {
      asked.push(url);
      return url === 'locales/en-GB.json' ? { ok: true, json: async () => GB } : { ok: false };
    },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'i18n.js'), 'utf8'), ctx);
  const i = ctx.SidecarI18n;
  await i.ready;
  assert.equal(i.lang, 'en-GB');
  assert.equal(i.t('Mining canceled'), 'Mining cancelled');
  assert.equal(i.t('{{kind}} (unrecognized kind)', { kind: 'Kind 9999' }), 'Kind 9999 (unrecognised kind)');
  assert.equal(i.t('Copy'), 'Copy', 'a string en-GB leaves out is the English');
  assert.equal(i.tn('{{count}} relay', '{{count}} relays', 2), '2 relays');
  assert.deepEqual(asked, ['locales/en-GB.json'], 'English has no catalog, so there is no base to ask for');
  assert.ok(i.languages().some((l) => l.code === 'en-GB' && l.name === 'English (UK)'));
});
