'use strict';

// Werkstätte squares everything on purpose, and a short list of things get their curves
// back. Keeping that list correct is the recurring cost of the blanket rule: the app grows
// new round things, the theme does not hear about them, and they quietly become tiles.
//
// This audits the app for anything circular and checks the theme has an exception, rather
// than waiting for someone to notice a squared button in a screenshot. That is how the
// relax controls and the approval avatars were found, one at a time, after shipping.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const promptInline = (fs.readFileSync(path.join(ROOT, 'prompt.html'), 'utf8')
  .match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n');
// Ben Day and Turnstile square their panels with the same blanket rule and the same
// exceptions.
const SQUARE_THEMES = ['werkstatte', 'ben-day', 'turnstile'];

// Not themed, or matched from a compound selector whose real target is covered.
const IGNORE = new Set([
  'has-av',       // .tx-icon.has-av img — .tx-icon is excepted
  'tx-icon',
  'welcome-mark', // welcome.html is not themed
  'css', 'json', 'low', 'profile-body', // captured from compound selectors
]);

for (const theme of SQUARE_THEMES) {
  test(`every circular thing in the app has a ${theme} exception`, () => {
    const sheet = fs.readFileSync(path.join(ROOT, 'themes', theme + '.css'), 'utf8');
    const src = css + '\n' + promptInline;
    const circular = new Set();
    for (const m of src.matchAll(/(?:^|\})([^{}@]*?)\{([^}]*)\}/g)) {
      if (!/border-radius:\s*50%/.test(m[2])) continue;
      for (const part of m[1].split(',')) {
        for (const c of part.matchAll(/\.([a-zA-Z][\w-]*)/g)) circular.add(c[1]);
      }
    }
    const excepted = new Set(
      [...sheet.matchAll(new RegExp('\\[data-theme="' + theme + '"\\] \\.([\\w-]+):not\\(\\.theme-card\\)', 'g'))]
        .map((m) => m[1])
    );
    const missing = [...circular].filter((c) => !excepted.has(c) && !IGNORE.has(c)).sort();
    assert.deepEqual(
      missing, [],
      'these are round everywhere else and square in ' + theme + '. Add them to the exception ' +
      'list, or add them to IGNORE with a reason:\n  ' + missing.join('\n  ')
    );
  });
}
