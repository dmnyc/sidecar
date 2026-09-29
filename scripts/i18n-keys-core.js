'use strict';

// The translation keys in Sidecar's source: every t('…'), every tn('…', '…', n), and
// every data-i18n* attribute in the HTML. Keys are the English text, so this list is
// also what a translator translates. Shared by scripts/i18n-keys.mjs and the tests.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// The files whose strings are translated through i18n.js. content.js is not among them:
// it follows the browser through chrome.i18n and _locales (docs/i18n-design.md §3.2).
const JS_FILES = ['sidepanel.js', 'prompt.js', 'welcome.js', 'compose.js', 'composer-core.js',
  'wallets.js', 'help.js', 'scan-qr.js', 'relay-rider.js', 'theme-tile.js', 'background.js',
  'replaceable-baseline.js'];
const HTML_FILES = ['sidepanel.html', 'prompt.html', 'welcome.html', 'compose.html', 'help.html',
  'wallets.html', 'scan-qr.html', 'relay-rider.html', 'theme-tile.html'];

// A JS string literal in single or double quotes, escapes and all, and its value.
const LIT = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")`;
const unquote = (lit) => {
  // eslint-disable-next-line no-new-func
  return new Function('return ' + lit)();
};

// Whole-line comments out, so an example in prose is not taken for a call. Line-based
// ON PURPOSE: a block-comment regex is unusable on sidepanel.js, where a comment quoting
// the host permission "https://*/*" opens a "/*" that runs 160k characters to the next
// "*/" and takes real code with it. Blanked rather than removed, so line numbers hold.
function codeOnly(src) {
  return src.split('\n').map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l)).join('\n');
}

function extractFromJs(src) {
  const code = codeOnly(src);
  const keys = [];
  // t('Copy') — the name t alone, not something.t or format(. tSec('…') is the same call,
  // marked security-critical: those keys need a native speaker's review before a language
  // ships (docs/i18n-design.md §3.7).
  for (const m of code.matchAll(new RegExp(String.raw`(?<![\w$.])(t|tSec)\(\s*` + LIT, 'g'))) {
    keys.push(m[1] === 'tSec' ? { key: unquote(m[2]), security: true } : { key: unquote(m[2]) });
  }
  // tn('{{count}} relay', '{{count}} relays', n)
  for (const m of code.matchAll(new RegExp(String.raw`(?<![\w$.])tn\(\s*` + LIT + String.raw`\s*,\s*` + LIT, 'g'))) {
    keys.push({ key: unquote(m[1]), other: unquote(m[2]), plural: true });
  }
  return keys;
}

// t( followed by anything but a literal: a key that cannot be extracted, so no
// translator will ever see it. i18n.js itself is exempt (it translates data-i18n values).
function nonLiteralCalls(src) {
  const code = codeOnly(src);
  const out = [];
  for (const m of code.matchAll(/(?<![\w$.])(tn?|tSec)\(\s*([^'"\s)])/g)) {
    const line = code.slice(0, m.index).split('\n').length;
    out.push(line + ': ' + code.slice(m.index, code.indexOf('\n', m.index)).trim());
  }
  return out;
}

// data-i18n="…" and its attribute forms. A tag that also carries data-i18n-review is
// the HTML form of tSec: its keys are security-critical.
function extractFromHtml(src) {
  const keys = [];
  const decode = (v) => v.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  for (const tag of src.matchAll(/<[a-z][^>]*\bdata-i18n[^>]*>/gi)) {
    const review = /\bdata-i18n-review\b/.test(tag[0]);
    for (const m of tag[0].matchAll(/data-i18n(?:-(?!review\b)[a-z-]+)?="([^"]*)"/g)) {
      keys.push(review ? { key: decode(m[1]), security: true } : { key: decode(m[1]) });
    }
  }
  return keys;
}

// Every key, deduplicated, in first-seen order: { key, other?, plural? }.
function allKeys(root = ROOT) {
  const seen = new Map();
  // A key used as tSec anywhere is security-critical everywhere it appears.
  const add = (k) => {
    const had = seen.get(k.key);
    if (!had) seen.set(k.key, k);
    else if (k.security) had.security = true;
  };
  for (const f of JS_FILES) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) extractFromJs(fs.readFileSync(p, 'utf8')).forEach(add);
  }
  for (const f of HTML_FILES) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) extractFromHtml(fs.readFileSync(p, 'utf8')).forEach(add);
  }
  return [...seen.values()];
}

module.exports = { allKeys, extractFromJs, extractFromHtml, nonLiteralCalls, JS_FILES, HTML_FILES, ROOT };
