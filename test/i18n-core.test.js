'use strict';

// i18n.js, the translation layer (docs/i18n-design.md). Run in a context shaped like
// each place it loads: an extension page, and the service worker, which has no DOM and
// no localStorage.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'i18n.js'), 'utf8');

// A fresh module. `settings` is what chrome.storage holds; `uiLang` the browser's language.
function load({ settings = {}, uiLang = 'en-US', cache = null, worker = false } = {}) {
  const store = { sidecar_lang: cache };
  const ctx = {
    Intl, Promise, Object, String, Number, Math, Set, Array, JSON,
    chrome: {
      i18n: { getUILanguage: () => uiLang },
      storage: { local: { get: (k, cb) => cb({ sidecar_settings: settings }) } },
      runtime: { getURL: (p) => 'chrome-extension://x/' + p },
    },
    fetch: async () => ({ ok: false }),
  };
  if (!worker) {
    ctx.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
    };
  }
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return Object.assign(ctx.SidecarI18n, { _store: store });
}

// ---- English, with nothing loaded ----------------------------------------------------

test('A KEY IS ITS OWN ENGLISH, SO NOTHING UNTRANSLATED IS EVER BLANK', () => {
  const i = load();
  assert.equal(i.t('Copy'), 'Copy');
  assert.equal(i.t('{{name}} removed from {{host}}', { name: 'Alice', host: 'jumble.social' }),
    'Alice removed from jumble.social');
});

test('a missing parameter is left visible, not dropped', () => {
  assert.equal(load().t('Hello {{name}}'), 'Hello {{name}}');
});

test('ENGLISH PLURALS NEED NO LOCALE FILE', () => {
  const i = load();
  assert.equal(i.tn('{{count}} relay', '{{count}} relays', 1), '1 relay');
  assert.equal(i.tn('{{count}} relay', '{{count}} relays', 0), '0 relays');
  assert.equal(i.tn('{{count}} relay', '{{count}} relays', 12500), '12,500 relays', 'count is formatted');
  assert.equal(i.tn('{{count}} sat to {{who}}', '{{count}} sats to {{who}}', 2, { who: 'Bob' }), '2 sats to Bob');
});

test('English numbers stay exactly as the code wrote them by hand (en-US)', () => {
  const i = load({ uiLang: 'en-GB' });
  assert.equal(i.lang, 'en');
  assert.equal(i.fmtNum(1234567.5), '1,234,567.5');
  assert.equal(i.fmtNum(0.5, { style: 'percent' }), '50%');
});

// ---- a translation ---------------------------------------------------------------------

test('A LOCALE REPLACES THE ENGLISH, AND FALLS BACK KEY BY KEY', () => {
  const i = load();
  i.setLocale('de', [{ Copy: 'Kopieren' }]);
  assert.equal(i.t('Copy'), 'Kopieren');
  assert.equal(i.t('Paste'), 'Paste', 'an untranslated key is still English');
});

test('the regional locale, then its base language, then English', () => {
  const i = load();
  i.setLocale('pt-BR', [{ Copy: 'Copiar (BR)' }, { Copy: 'Copiar', Paste: 'Colar' }]);
  assert.equal(i.t('Copy'), 'Copiar (BR)');
  assert.equal(i.t('Paste'), 'Colar');
  assert.equal(i.t('Cut'), 'Cut');
});

test('PARAMETERS ARE SUBSTITUTED AFTER TRANSLATION, NEVER TRANSLATED', () => {
  // A translator cannot change the amount on a card: it is not in their text.
  const i = load();
  i.setLocale('de', [{ 'Pay {{amount}} sats': '{{amount}} Sats zahlen' }]);
  assert.equal(i.t('Pay {{amount}} sats', { amount: '21' }), '21 Sats zahlen');
});

test('POLISH GETS ITS THREE FORMS, ARABIC ITS SIX', () => {
  const i = load();
  i.setLocale('pl', [{
    '{{count}} relay_one': '{{count}} przekaźnik',
    '{{count}} relay_few': '{{count}} przekaźniki',
    '{{count}} relay_many': '{{count}} przekaźników',
  }]);
  const pl = (n) => i.tn('{{count}} relay', '{{count}} relays', n);
  assert.equal(pl(1), '1 przekaźnik');
  assert.equal(pl(3), '3 przekaźniki');
  assert.equal(pl(5), '5 przekaźników');
  assert.equal(pl(22), '22 przekaźniki');
  i.setLocale('ar', [{ 'x_zero': 'z', 'x_one': 'o', 'x_two': 't', 'x_few': 'f', 'x_many': 'm', 'x_other': 'r' }]);
  assert.deepEqual([0, 1, 2, 3, 11, 100].map((n) => i.tn('x', 'xs', n)), ['z', 'o', 't', 'f', 'm', 'r']);
});

test('a locale missing a form uses its _other before falling back to English', () => {
  const i = load();
  i.setLocale('pl', [{ '{{count}} relay_other': '{{count}} przekaźnika' }]);
  assert.equal(i.tn('{{count}} relay', '{{count}} relays', 5), '5 przekaźnika');
});

test('numbers and dates follow the language', () => {
  const i = load();
  i.setLocale('de', []);
  assert.equal(i.fmtNum(1234.5), '1.234,5');
  assert.match(i.fmtRelative(-5, 'minute'), /5/);
});

// ---- choosing the language --------------------------------------------------------------

test('THE BROWSER LANGUAGE RESOLVES TO A SUPPORTED ONE, OR ENGLISH', () => {
  const i = load();
  assert.equal(i.resolve('en-GB'), 'en');
  assert.equal(i.resolve('fr-CA'), 'en', 'no French yet, so English');
  assert.equal(i.resolve(''), 'en');
  assert.equal(i.resolve('en-XA'), 'en-XA');
});

test('the setting wins over the browser, and is cached for a synchronous start', async () => {
  const i = load({ settings: { language: 'en-XA' }, uiLang: 'en-US' });
  await i.ready;
  assert.equal(i.lang, 'en-XA');
  assert.equal(i._store.sidecar_lang, 'en-XA');
  const next = load({ cache: 'en-XA', settings: { language: 'en-XA' } });
  assert.equal(next.lang, 'en-XA', 'the next page starts in it before storage answers');
});

test('"auto" follows the browser', async () => {
  const i = load({ settings: { language: 'auto' }, uiLang: 'en-AU' });
  await i.ready;
  assert.equal(i.lang, 'en');
});

// ---- the pseudo-locale ----------------------------------------------------------------

test('THE PSEUDO-LOCALE ACCENTS AND PADS THE COPY, AND LEAVES DATA ALONE', () => {
  const i = load();
  i.setLocale('en-XA', []);
  const s = i.t('Removed {{name}}', { name: 'Alice' });
  assert.match(s, /^\[Ŕéɱöṽéđ Alice ·+\]$/, 'the name is data, so it reads plainly: ' + s);
  const pad = s.match(/·+/)[0].length;
  assert.equal(pad, Math.round('Removed'.length * 0.4));
  assert.match(i.tn('{{count}} relay', '{{count}} relays', 3), /^\[3 ŕéļáýš ·+\]$/);
});

// ---- the service worker ------------------------------------------------------------------

test('IT LOADS IN THE SERVICE WORKER, WHICH HAS NO DOM AND NO localStorage', async () => {
  const i = load({ worker: true });
  assert.equal(i.t('Payment sent'), 'Payment sent');
  await i.ready;
  i.applyDom(); // a no-op without a document, not a throw
});

test('a broken or missing locale file falls back to English, never to blank', async () => {
  const i = load({ settings: { language: 'de' } }); // no 'de' registered, and fetch fails
  await i.ready;
  assert.equal(i.t('Copy'), 'Copy');
});
