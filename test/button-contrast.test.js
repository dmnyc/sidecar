'use strict';

// WCAG contrast for the two filled buttons on the approval prompt, in every theme.
//
// Why this exists: "Trust this site" (.lav-btn) hardcoded a near-black label over a
// gradient whose mid and bottom stops come from --lav / --purple — variables every theme
// overrides. In the two themes that land those dark (Aegean cobalt #1565C0, Art Deco
// bronze #7A5A18) the label went dark-on-dark and was reported as illegible. The identical
// bug had already been found and fixed for .primary next to it, whose comment still reads
// "right on amber, unreadable on a cobalt fill" — so this is a mistake the codebase has now
// made twice, in adjacent rules, which is exactly what a test is for.
//
// Asserting hex values would not have caught it: every individual value was reasonable.
// The defect only exists in the COMBINATION of a theme's fill and the shared rule's label,
// which is why this resolves the real var() chains out of styles.css and the theme files
// and computes the ratio.
//
// Thresholds. The label is 14px/600 — not WCAG "large text" (that needs 18.66px bold or
// 24px), so the bar is 4.5:1. But the fill is a vertical gradient and the label is
// vertically centered, so it sits over the middle band, not the extremes:
//
//   mid stop  >= 4.5   the band the text actually sits on
//   any stop  >= 3.0   nothing wildly illegible at the edges, where ascenders reach
//
// Checking every stop at 4.5 was tried and is too strict to be useful: Aegean's .primary
// puts white on #2A7BD4 at the 0% stop for 4.33:1, which no eye reads as a defect because
// no glyph sits up there. Both thresholds still catch the reported bug — the old Aegean
// .lav-btn was 3.24:1 on its mid stop and 2.58:1 on its bottom.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const promptHtml = fs.readFileSync(path.join(ROOT, 'prompt.html'), 'utf8');

// ---- CSS custom-property tables -------------------------------------------------------

function varsIn(src, blockRe) {
  const m = src.match(blockRe);
  if (!m) throw new Error('block not found: ' + blockRe);
  const out = {};
  for (const d of m[0].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
}

const rootVars = varsIn(css, /:root\s*\{[\s\S]*?\n\}/);

const THEMES = fs
  .readdirSync(path.join(ROOT, 'themes'))
  .filter((f) => f.endsWith('.css') && f !== 'patterns.css')
  .map((f) => {
    const src = fs.readFileSync(path.join(ROOT, 'themes', f), 'utf8');
    return { name: f.replace('.css', ''), vars: varsIn(src, /\[data-theme=[^\]]+\]\s*\{[\s\S]*?\n\}/) };
  });

// ---- var() resolution ------------------------------------------------------------------
//
// Hand-rolled rather than regex: fallbacks nest (`var(--btn-lav-mid, var(--lav))`) and a
// naive `[^)]*` stops at the inner paren, which silently resolves to the wrong color.

function matchParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  throw new Error('unbalanced parens in: ' + s);
}

// Outermost var() expressions only — nested ones are skipped by resuming past the close.
function outerVars(expr) {
  const out = [];
  let i = 0;
  for (;;) {
    const j = expr.indexOf('var(', i);
    if (j === -1) return out;
    const k = matchParen(expr, j + 3);
    out.push(expr.slice(j, k + 1));
    i = k + 1;
  }
}

function splitVar(v) {
  const inner = v.slice(4, -1);
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++;
    else if (inner[i] === ')') depth--;
    else if (inner[i] === ',' && depth === 0) return [inner.slice(0, i).trim(), inner.slice(i + 1).trim()];
  }
  return [inner.trim(), null];
}

function resolve(expr, themeVars) {
  const e = String(expr).trim();
  if (e.startsWith('var(')) {
    const [name, fallback] = splitVar(e);
    if (themeVars[name] != null) return resolve(themeVars[name], themeVars);
    if (rootVars[name] != null) return resolve(rootVars[name], themeVars);
    if (fallback != null) return resolve(fallback, themeVars);
    return null;
  }
  return e.split(/\s+/)[0]; // drop a trailing gradient position like "58%"
}

// ---- contrast --------------------------------------------------------------------------

function luminance(hex) {
  const c = hex.replace('#', '');
  const f = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const ch = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255);
  const lin = (u) => (u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(ch[0]) + 0.7152 * lin(ch[1]) + 0.0722 * lin(ch[2]);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---- the rules under test --------------------------------------------------------------

function rule(src, selector) {
  const m = src.match(new RegExp('\\n\\s*\\' + selector + '\\s*\\{([\\s\\S]*?)\\n\\s*\\}'));
  if (!m) throw new Error('rule not found: ' + selector);
  return m[1];
}

function stopsAndLabel(body) {
  const bg = body.match(/background:\s*linear-gradient\(([\s\S]*?)\);/);
  const color = body.match(/color:\s*([^;]+);/);
  if (!bg || !color) throw new Error('rule is missing background or color');
  const stops = outerVars(bg[1]);
  assert.equal(stops.length, 3, 'expected three themeable gradient stops, got ' + stops.length);
  return { stops, label: color[1].trim() };
}

const BUTTONS = [
  ['.lav-btn', 'Trust this site'],
  ['.primary', 'Allow once'],
];

for (const [selector, label] of BUTTONS) {
  for (const theme of THEMES) {
    test(`${label} (${selector}) is legible in ${theme.name}`, () => {
      const { stops, label: labelExpr } = stopsAndLabel(rule(css, selector));
      const fg = resolve(labelExpr, theme.vars);
      assert.ok(/^#[0-9a-f]{3,6}$/i.test(fg), `${theme.name}: label resolved to non-hex "${fg}"`);

      const resolved = stops.map((s) => resolve(s, theme.vars));
      for (const [i, bgc] of resolved.entries()) {
        assert.ok(/^#[0-9a-f]{3,6}$/i.test(bgc), `${theme.name}: stop ${i} resolved to non-hex "${bgc}"`);
        const r = contrast(fg, bgc);
        assert.ok(
          r >= 3.0,
          `${theme.name} ${selector}: stop ${i} (${bgc}) vs label ${fg} is ${r.toFixed(2)}:1, needs >= 3.0`
        );
      }
      const mid = contrast(fg, resolved[1]);
      assert.ok(
        mid >= 4.5,
        `${theme.name} ${selector}: mid stop (${resolved[1]}) vs label ${fg} is ${mid.toFixed(2)}:1, needs >= 4.5`
      );
    });
  }
}

// ---- the two surfaces must not drift ---------------------------------------------------

test('prompt.html and styles.css declare the same themeable hooks', () => {
  // The popup window has its own copy of these rules. A theme sets one set of variables, so
  // if the two rules read different ones the same theme renders differently depending on
  // whether the side panel happened to be open.
  for (const selector of ['.lav-btn']) {
    const a = new Set(outerVars(rule(css, selector)).map((v) => splitVar(v)[0]));
    const b = new Set(outerVars(rule(promptHtml, selector)).map((v) => splitVar(v)[0]));
    assert.deepEqual([...a].sort(), [...b].sort(), selector + ' hooks differ between surfaces');
  }
});

test('the light themes supply their own Trust fill', () => {
  // Aegean and Art Deco are the two whose --lav / --purple are dark enough to break the
  // shared default. If either stops overriding, the contrast tests above go red — this just
  // names them so the failure is obvious rather than arithmetic.
  for (const name of ['aegean', 'art-deco']) {
    const t = THEMES.find((x) => x.name === name);
    assert.ok(t, 'missing theme ' + name);
    for (const v of ['--btn-lav-top', '--btn-lav-mid', '--btn-lav-bot', '--btn-lav-text']) {
      assert.ok(t.vars[v], name + ' should define ' + v);
    }
  }
});

test('the ring is an inset shadow, not a border', () => {
  // The shared button rule sets border: none. A real border on .lav-btn alone would make it
  // 2px taller than the Allow button directly above it.
  const body = rule(css, '.lav-btn');
  assert.ok(!/(^|[^-])border:/.test(body), '.lav-btn must not set a border');
  assert.match(body, /inset 0 0 0 1px var\(--btn-lav-ring/);
});
