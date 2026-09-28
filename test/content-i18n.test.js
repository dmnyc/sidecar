'use strict';

// The in-page pay pill and card, translated through chrome.i18n (docs/i18n-design.md §3.2):
// they follow the BROWSER's language, never Sidecar's own setting, because they sit in
// open shadow roots the page can read.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
const en = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', 'en', 'messages.json'), 'utf8'));

function lift(decl) {
  const at = content.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = content.indexOf(') {', at) + 2;
  let depth = 0;
  for (let j = open; j < content.length; j++) {
    if (content[j] === '{') depth++;
    else if (content[j] === '}' && --depth === 0) return content.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// The helpers, run against a chrome.i18n whose messages the test supplies.
function helpers(messages) {
  const ctx = {
    Intl, String, Array,
    chrome: {
      i18n: {
        getUILanguage: () => 'en-US',
        getMessage: (name, subs) => {
          const m = messages[name];
          if (m == null) return '';
          return (subs || []).reduce((s, v, i) => s.split('$' + (i + 1)).join(v), m);
        },
      },
    },
  };
  vm.createContext(ctx);
  const uiLang = content.match(/const UI_LANG = [^\n]+/)[0];
  vm.runInContext(
    `${lift('function escapeHtml(')}\n${uiLang}\n${lift('function msg(')}\n${lift('function msgHtml(')}\n` +
      'globalThis.h = { msg, msgHtml, escapeHtml };',
    ctx
  );
  return ctx.h;
}

test('A TRANSLATION CANNOT PUT MARKUP ON A PAGE, BUT THE CODE\'S BOLD AMOUNT SURVIVES', () => {
  const h = helpers({ payPillPayable: '<img src=x onerror=alert(1)> $1 Sats zahlbar' });
  const out = h.msgHtml('payPillPayable', '$1 sats payable', ['<b>21</b>']);
  assert.equal(out, '&lt;img src=x onerror=alert(1)&gt; <b>21</b> Sats zahlbar');
});

test('a missing message falls back to the English written in the code, never blank', () => {
  const h = helpers({});
  assert.equal(h.msg('cardNotNow', 'Not now'), 'Not now');
  assert.equal(h.msg('payPillLabelNoAmount', 'A Lightning invoice is payable on $1. Open Sidecar to pay it.', ['example.com']),
    'A Lightning invoice is payable on example.com. Open Sidecar to pay it.');
  assert.equal(h.msgHtml('flightPaid', 'Paid $1 sats', ['<b>21</b>']), 'Paid <b>21</b> sats');
});

// Every msg('name', 'fallback', …) and msgHtml('name', 'fallback', …) call in content.js.
const calls = [...content.replace(/^\s*\/\/.*$/gm, '')
  .matchAll(/\bmsg(?:Html)?\(\s*'(\w+)',\s*'((?:[^'\\]|\\.)*)'/g)]
  .map((m) => ({ name: m[1], fallback: m[2].replace(/\\'/g, "'") }));

test('EVERY MESSAGE THE PILL AND CARD USE HAS ITS ENGLISH IN _locales', () => {
  assert.ok(calls.length >= 20, 'found only ' + calls.length + ' calls');
  const missing = calls.filter((c) => !en[c.name]).map((c) => c.name);
  assert.deepEqual(missing, []);
});

test('AND EACH FALLBACK READS EXACTLY AS ITS ENGLISH MESSAGE', () => {
  // So a message that fails to load reads the same as one that loads.
  const mismatched = [];
  for (const c of calls) {
    const e = en[c.name];
    if (!e) continue;
    // _locales writes $AMOUNT$; the fallback writes the same slot as $1.
    let msgText = e.message;
    for (const [name, def] of Object.entries(e.placeholders || {})) {
      msgText = msgText.split('$' + name.toUpperCase() + '$').join(def.content);
    }
    if (msgText !== c.fallback) mismatched.push(c.name + ': "' + c.fallback + '" vs "' + msgText + '"');
  }
  assert.deepEqual(mismatched, []);
});

test('the pill never uses Sidecar\'s own language setting, and never a hard-coded en-US', () => {
  const code = content.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /SidecarI18n|sidecar_lang|settings\.language/, 'the pill must follow the browser');
  assert.doesNotMatch(code, /toLocaleString\('en-US'\)/);
  assert.match(code, /const UI_LANG = \(\(\) => \{ try \{ return chrome\.i18n\.getUILanguage\(\); \}/);
});

test('the errors a page can read over NIP-07 stay English', () => {
  // Apps match on them, so they are part of the API, not the interface.
  assert.match(content, /'Sidecar response could not be delivered\.'/);
  assert.match(content, /'Sidecar request failed\.'/);
});
