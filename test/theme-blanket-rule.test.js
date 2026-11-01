'use strict';

// The square themes (Werkstätte, Ben Day, Turnstile) say "nothing is round" in one rule:
// a universal selector, its two pseudo-element twins, and a single declaration,
// `border-radius: 0`. Everything else in those files is an exception to it.
//
// That rule is one selector list, and a line added INSIDE the list changes what it says.
// A circle exception for a new control was spliced in between the universal selector and
// its twins, so the declaration that followed became `border-radius: 50%` for the whole
// list, and every element in Ben Day turned into an oval. The suite stayed green:
// werkstatte-round.test.js checks that round things have an exception, never that the
// rule they are exceptions to is still intact.
//
// So this reads the rule itself and pins its exact shape. Exceptions go after it, each in
// a rule of its own.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SQUARE_THEMES = ['werkstatte', 'ben-day', 'turnstile'];
const star = (t) => '[data-theme="' + t + '"] *:not(.theme-card):not(.theme-card *)';

// The blanket rule as it must read, for one theme.
const expected = (t) =>
  star(t) + ',\n' + star(t) + '::before,\n' + star(t) + '::after {\n  border-radius: 0;\n}';

// The selector list that starts with the universal selector, through its closing brace.
function blanketRule(css, t) {
  const at = css.indexOf(star(t) + ',');
  if (at === -1) return null;
  return css.slice(at, css.indexOf('}', at) + 1);
}

for (const theme of SQUARE_THEMES) {
  test(`${theme}'s "nothing is round" rule is intact`, () => {
    const css = fs.readFileSync(path.join(ROOT, 'themes', theme + '.css'), 'utf8');
    const rule = blanketRule(css, theme);
    assert.ok(rule, theme + ' has no blanket rule: the universal selector is gone');
    assert.equal(
      rule, expected(theme),
      'the blanket rule changed shape. A selector added to this list rewrites what it does to every ' +
      'element: put an exception in a rule of its own, after it.'
    );
  });
}

test('the check fails on the rule as it was broken', () => {
  // Proof the pin can fail: the exact shape that turned Ben Day into ovals.
  const broken =
    star('ben-day') + ',\n[data-theme="ben-day"] .zoom-thumb:not(.theme-card):not(.theme-card *) { border-radius: 50%; }\n' +
    star('ben-day') + '::before,\n' + star('ben-day') + '::after {\n  border-radius: 0;\n}';
  assert.notEqual(blanketRule(broken, 'ben-day'), expected('ben-day'));
});

test('no square theme leaves a circle rule inside a list that also squares', () => {
  // The same fault from the other direction: any rule that names the universal selector
  // and also sets a non-zero radius.
  for (const theme of SQUARE_THEMES) {
    const css = fs.readFileSync(path.join(ROOT, 'themes', theme + '.css'), 'utf8');
    for (const m of css.matchAll(/(?:^|\})([^{}@]*?)\{([^}]*)\}/g)) {
      const radius = /border-radius:\s*([^;]+);/.exec(m[2]);
      if (!radius || radius[1].trim() === '0') continue;
      assert.ok(!m[1].includes(star(theme)),
        theme + ': the universal selector shares a rule with border-radius: ' + radius[1].trim());
    }
  }
});
