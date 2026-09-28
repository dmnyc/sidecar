// Sidecar — translation and locale formatting (isolated module).
//
// The design is docs/i18n-design.md. The short version:
//
//   KEYS ARE THE ENGLISH TEXT. t('Copy') returns "Copy" until a locale says otherwise,
//   so English needs no locale file, an untranslated string reads correctly, and the
//   tests that assert on English copy keep passing. A missing translation is never an
//   empty label.
//
//   PLURALS CARRY THEIR ENGLISH "OTHER" INLINE. tn('{{count}} relay', '{{count}}
//   relays', n) needs nothing loaded to be right in English. A locale supplies every
//   form its language has under the singular key ("…relay_one", "_few", "_many",
//   "_other"), chosen by Intl.PluralRules, so Polish and Arabic get their real forms.
//
//   PARAMETERS ARE NEVER TRANSLATED. Names, amounts, hosts and keys go in as {{values}}
//   and are substituted after translation, so a translator cannot alter a number on an
//   approval card, and the pseudo-locale leaves data unaccented, which is the signal it
//   exists for: anything unaccented on screen is data, or a string nobody wrapped.
//
// Loaded first on every extension page, and by the background through importScripts,
// where there is no DOM and no localStorage: everything that needs either is guarded.

(function (root) {
  'use strict';

  // The languages the picker offers, each named in itself. English is the only one
  // until a translation ships; en-XA is the developer's pseudo-locale.
  const LANGUAGES = [
    { code: 'en', name: 'English' },
  ];
  const PSEUDO = 'en-XA';
  // en-XB, the developer's TEST locale: a real locale file (locales/en-XB.json, written by
  // scripts/i18n-keys.mjs --test-locale, git-ignored, never shipped) that marks every
  // string ⟦like this⟧. It exercises what a real language does, fetching and applying a
  // file with English fallback, which en-XA (generated in code) never touches. Reachable
  // only by choosing it explicitly; no browser language resolves to it.
  const TEST = 'en-XB';
  const RTL = new Set(['ar', 'fa', 'he', 'ur']);
  const CACHE_KEY = 'sidecar_lang'; // localStorage: the resolved code, for a synchronous start

  const supported = () => LANGUAGES.map((l) => l.code);

  // A browser language to a supported one: exact, then the base language, then English.
  // Chinese follows script rather than region (Jumble's rule): zh, zh-CN and zh-SG are
  // Simplified, every other zh-* Traditional.
  function resolve(requested) {
    const want = String(requested || '').trim();
    if (!want) return 'en';
    if (want === PSEUDO) return PSEUDO;
    if (want === TEST) return TEST;
    const codes = supported();
    const exact = codes.find((c) => c.toLowerCase() === want.toLowerCase());
    if (exact) return exact;
    const base = want.split('-')[0].toLowerCase();
    if (base === 'zh') {
      const simplified = /^zh(-(cn|sg|hans))?$/i.test(want);
      const pick = simplified ? 'zh' : 'zh-TW';
      if (codes.includes(pick)) return pick;
    }
    return codes.find((c) => c.toLowerCase() === base) || 'en';
  }

  function browserLanguage() {
    try {
      if (root.chrome && chrome.i18n && chrome.i18n.getUILanguage) return chrome.i18n.getUILanguage();
    } catch (_) {}
    return (root.navigator && navigator.language) || 'en';
  }

  function readCache() {
    try { return root.localStorage ? root.localStorage.getItem(CACHE_KEY) : null; } catch (_) { return null; }
  }
  function writeCache(code) {
    try { if (root.localStorage) root.localStorage.setItem(CACHE_KEY, code); } catch (_) {}
  }

  // ---- state --------------------------------------------------------------------------

  let lang = resolve(readCache() || browserLanguage());
  let dicts = []; // [active, base], each a flat { key: text } object
  let plural = new Intl.PluralRules(lang === PSEUDO ? 'en' : lang);

  // The locale for numbers. English stays en-US, which is what the code wrote by hand
  // before this module existed, so nothing an English user sees changes.
  const numLocale = () => (lang === 'en' || lang === PSEUDO ? 'en-US' : lang);
  // And for dates, which in English kept following the BROWSER (the code passed
  // undefined): a UK browser shows "4 Mar". Forcing en-US would turn that into "Mar 4"
  // for English readers who never asked, so English keeps doing what it did. Another
  // language takes its own conventions.
  const dateLocale = () => (lang === 'en' || lang === PSEUDO ? undefined : lang);

  // ---- pseudo-locale ------------------------------------------------------------------
  //
  // Accented and padded 40%, inside brackets: [Ŝéţţîñĝš ·····]. Overflow shows where a
  // longer language will break, and an unaccented label is one that never went through
  // t(). Applied to the template before parameters are substituted, so names, amounts
  // and addresses stay readable.
  const ACCENT = {
    a: 'á', b: 'ƀ', c: 'ç', d: 'đ', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ',
    l: 'ļ', m: 'ɱ', n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ',
    w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
    A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Đ', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ',
    L: 'Ļ', M: 'Ṁ', N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ',
    W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
  };
  function pseudo(s) {
    let out = '';
    // Leave {{placeholders}} intact so substitution still finds them.
    for (const part of String(s).split(/(\{\{\w+\}\})/)) {
      out += /^\{\{\w+\}\}$/.test(part) ? part : part.replace(/[A-Za-z]/g, (c) => ACCENT[c] || c);
    }
    const letters = String(s).replace(/\{\{\w+\}\}/g, '').replace(/\s/g, '').length;
    const pad = Math.max(1, Math.round(letters * 0.4));
    return '[' + out + ' ' + '·'.repeat(pad) + ']';
  }

  // ---- translation --------------------------------------------------------------------

  function lookup(key) {
    for (const d of dicts) if (d && Object.prototype.hasOwnProperty.call(d, key)) return d[key];
    return null;
  }

  function substitute(s, params) {
    if (!params) return s;
    return s.replace(/\{\{(\w+)\}\}/g, (m, k) => (params[k] == null ? m : String(params[k])));
  }

  // t('Copy'), t('{{name}} removed from {{host}}', { name, host })
  function t(key, params) {
    let s = lookup(key);
    if (s == null) s = key;
    if (lang === PSEUDO) s = pseudo(s);
    return substitute(s, params);
  }

  // tn('{{count}} relay', '{{count}} relays', n, { … }). `count` is passed through as a
  // parameter, formatted for the language, unless the caller supplies its own.
  function tn(one, other, count, params) {
    const form = plural.select(Number(count));
    let s = lookup(one + '_' + form);
    if (s == null && form !== 'other') s = lookup(one + '_other');
    if (s == null) s = form === 'one' ? one : other; // English, from the call itself
    if (lang === PSEUDO) s = pseudo(s);
    const p = Object.assign({ count: fmtNum(Number(count)) }, params);
    return substitute(s, p);
  }

  // ---- formatting ---------------------------------------------------------------------

  function fmtNum(n, opts) {
    return new Intl.NumberFormat(numLocale(), opts).format(n);
  }
  function fmtDate(d, opts) {
    return new Intl.DateTimeFormat(dateLocale(), opts).format(d instanceof Date ? d : new Date(d));
  }
  // fmtRelative(-5, 'minute') → "5 min. ago" in English, the language's own words
  // elsewhere, with no translation work for any of them.
  function fmtRelative(value, unit, opts) {
    return new Intl.RelativeTimeFormat(numLocale(), Object.assign({ numeric: 'auto', style: 'narrow' }, opts))
      .format(value, unit);
  }

  // ---- static HTML --------------------------------------------------------------------
  //
  // <button data-i18n="Appearance">Appearance</button>, and data-i18n-placeholder /
  // -title / -aria-label / -alt for attributes. The English stays in the markup, so a
  // page whose locale failed to load still reads correctly.
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  function applyDom(scope) {
    const doc = root.document;
    if (!doc) return;
    const base = scope || doc;
    for (const el of base.querySelectorAll('[data-i18n]')) el.textContent = t(el.getAttribute('data-i18n'));
    for (const a of ATTRS) {
      for (const el of base.querySelectorAll('[data-i18n-' + a + ']')) {
        el.setAttribute(a, t(el.getAttribute('data-i18n-' + a)));
      }
    }
    if (!scope && doc.documentElement) {
      doc.documentElement.lang = lang === PSEUDO ? 'en' : lang;
      doc.documentElement.dir = RTL.has(lang.split('-')[0]) ? 'rtl' : 'ltr';
    }
  }

  // ---- loading ------------------------------------------------------------------------

  async function loadDicts(code) {
    if (code === 'en' || code === PSEUDO) return [];
    const get = async (c) => {
      try {
        const res = await fetch(chrome.runtime.getURL('locales/' + c + '.json'));
        return res.ok ? await res.json() : null;
      } catch (_) {
        return null; // a missing or broken locale falls back to English, never to blank
      }
    };
    const base = code.split('-')[0];
    return [await get(code), base !== code ? await get(base) : null].filter(Boolean);
  }

  // The setting, read once at startup. 'auto' (the default) follows the browser.
  function readSetting() {
    return new Promise((res) => {
      try {
        chrome.storage.local.get('sidecar_settings', (o) => {
          const s = (o && o.sidecar_settings) || {};
          res(s.language || 'auto');
        });
      } catch (_) { res('auto'); }
    });
  }

  const ready = (async () => {
    const setting = await readSetting();
    const code = resolve(setting === 'auto' ? browserLanguage() : setting);
    if (code !== lang) {
      lang = code;
      plural = new Intl.PluralRules(lang === PSEUDO ? 'en' : lang);
    }
    writeCache(lang);
    dicts = await loadDicts(lang);
    return lang;
  })();

  // Switch language with its dictionaries already in hand: the tests use it, and so can
  // a live switch once there is one. dictionaries is [active, base], most specific first.
  function setLocale(code, dictionaries) {
    lang = code;
    plural = new Intl.PluralRules(lang === PSEUDO ? 'en' : lang);
    dicts = (dictionaries || []).filter(Boolean);
  }

  // tSec() is t(), marked. It wraps text on the approval screens, the unlock and the
  // backups, where a mistranslated "sign", "encrypt" or "pay" is a security bug, not a
  // cosmetic one (docs/i18n-design.md §3.7). The extractor lists these keys apart, so a
  // language ships only once a native speaker has reviewed every one of them.
  const tSec = t;

  const api = {
    t, tn, tSec, fmtNum, fmtDate, fmtRelative, applyDom, ready, setLocale,
    get lang() { return lang; },
    get dir() { return RTL.has(lang.split('-')[0]) ? 'rtl' : 'ltr'; },
    languages: () => LANGUAGES.slice(),
    // For callers that need Intl directly (formatToParts, currency).
    numberLocale: () => numLocale(),
    resolve,
    // The code a stored setting ('auto' or a code) comes to, for writing the start-up
    // cache before a reload, so the next page opens in it rather than flipping after.
    resolveSetting: (setting) => resolve(!setting || setting === 'auto' ? browserLanguage() : setting),
    CACHE_KEY,
    PSEUDO,
    TEST,
  };
  root.SidecarI18n = api;
})(typeof self !== 'undefined' ? self : globalThis);
