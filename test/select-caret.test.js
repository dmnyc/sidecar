// The select caret is ours, not the platform's.
//
// A select used to draw its own arrow, and the arrow landed 5px from the right edge
// against the 13px of inset the text gets on the left: lopsided, and unreachable,
// padding moves a select's text, never its arrow. So styles.css sets
// `appearance: none` and paints the caret as the top background layer instead.
//
// That has one sharp edge, which is what this file guards. A background shorthand
// cannot ADD a layer: any rule that restates a select's background replaces both
// layers and silently deletes the caret. Four themes restate it (they give fields
// their own fill), and the next theme to do so has to carry the layer too.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

// Comments first, every time: the rules below are prose-aware, and every comment
// written about the caret names the very token they look for.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const CARET = '--select-caret';
const GEO = '--select-caret-geo';

test('styles.css declares the caret, both inks, and the layer', () => {
  const root = stripComments(css).match(/:root\s*\{[\s\S]*?\n\}/);
  assert.ok(root, ':root block moved');
  for (const token of ['--select-caret-on-dark', '--select-caret-on-light', CARET, GEO]) {
    assert.ok(root[0].includes(token + ':'), token + ' is not declared in :root');
  }
  // One token holds the position so a theme restating the background cannot drift.
  assert.match(
    root[0],
    new RegExp(GEO + ':[^;]*right 13px center'),
    'the caret no longer sits at the 13px the text starts from'
  );
});

// The trap this cost a browser check to find. var() inside a CUSTOM PROPERTY is
// substituted where that property is declared, not where it is used: a token
// holding `var(--select-caret) no-repeat right 13px…` computed the :root ink once
// and inherited that, so every light theme's override was silently discarded and
// Bauhaus wore a white caret on a white field. --select-caret may only be read from
// a background, where the element being painted resolves it.
test('nothing wraps the caret in another custom property', () => {
  for (const d of stripComments(css).matchAll(/(--[\w-]+)\s*:\s*([^;]*);/g)) {
    if (d[1] === CARET) continue;
    assert.ok(
      !/var\(--select-caret\)/.test(d[2]),
      d[1] + ' embeds var(--select-caret), which freezes the ink at the declaration'
    );
  }
});

test('the select rule drops the platform caret and paints its own on top', () => {
  const rule = stripComments(css).match(/\nselect \{([\s\S]*?)\n\}/);
  assert.ok(rule, 'the bare `select` rule moved');
  const body = rule[1];
  assert.match(body, /appearance: none/, 'the platform draws the caret again');
  const bg = body.match(/background:\s*([\s\S]*?);/);
  assert.ok(bg, 'the select rule no longer sets a background');
  assert.ok(
    bg[1].trim().startsWith('var(' + CARET + ') var(' + GEO + ')'),
    'the caret must be the FIRST background layer, or the field paints over it'
  );
});

// A selector list is "a select's" if any of its selectors ends in the select type.
// Deliberately loose: `[data-theme="x"] select`, `select.level-select` and a bare
// `select` all count, because all three replace the same background.
const targetsSelect = (sel) =>
  sel.split(',').some((s) => /(^|[\s>+~])select(\.[\w-]+|:[\w-]+|\[[^\]]*\])*\s*$/.test(s.trim()));

for (const file of fs.readdirSync(path.join(ROOT, 'themes')).filter((f) => f.endsWith('.css'))) {
  test(file + ' keeps the caret on any select it repaints', () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, 'themes', file), 'utf8'));
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(src))) {
      const [sel, body] = [m[1].trim(), m[2]];
      if (!targetsSelect(sel) || !/(^|[\s;])background(-image)?\s*:/.test(body)) continue;
      assert.ok(
        body.includes('var(' + CARET + ')'),
        `${sel} restates a select's background without ${CARET}, which deletes its caret. ` +
        `Either add \`var(${CARET}) var(${GEO}),\` in front of the fill, or split the select ` +
        `out of the rule and leave styles.css to paint it.`
      );
    }
  });
}
