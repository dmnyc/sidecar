'use strict';

// WCAG contrast for theme colors: the filled buttons on the approval prompt, and every ink
// against every surface, in all five themes.
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

// Comments are stripped before the declarations are read. The theme files document
// their palettes heavily and they name their own tokens while doing it, so prose like
// "hotter than --gold: see below" parses as a declaration whose value runs to the next
// semicolon — which silently replaced the real --gold with a sentence. It failed loudly
// here (NaN contrast), but only because the stolen value happened not to look like a
// color; a comment mentioning "--faint: #999 was too dark" would have quietly measured
// the wrong ink and passed.
function varsIn(src, blockRe) {
  const m = src.match(blockRe);
  if (!m) throw new Error('block not found: ' + blockRe);
  const out = {};
  for (const d of m[0].replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[d[1]] = d[2].trim();
  }
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

// Resolves var() chains WITHOUT the trailing-token trim resolve() does, so an
// `rgba(203, 161, 78, 0.5)` or a bare `203, 161, 78` channel triple survives intact.
function resolveRaw(expr, themeVars) {
  const e = String(expr).trim();
  if (e.startsWith('var(')) {
    const [name, fallback] = splitVar(e);
    if (themeVars[name] != null) return resolveRaw(themeVars[name], themeVars);
    if (rootVars[name] != null) return resolveRaw(rootVars[name], themeVars);
    return fallback != null ? resolveRaw(fallback, themeVars) : null;
  }
  return e;
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

function toRgb(hex) {
  const c = hex.replace('#', '');
  const f = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
}

const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// Composite an rgba() over an opaque backdrop. This exists because the bug it caught was
// precisely an alpha token used where an opaque one belonged: --gold-soft is 50% alpha,
// designed for borders, and as a TEXT color it blends toward the surface behind it. On a
// dark card that still leaves usable contrast; on Art Deco's cream card it measured
// 1.30:1. Comparing the raw rgba against the surface would have shown a healthy ratio and
// missed it entirely — the blend is the whole defect.
function flatten(expr, backdrop, themeVars) {
  const v = String(resolveRaw(expr, themeVars)).trim();
  if (!/^rgba?\(/.test(v)) return v;
  // Paren-aware, not /\(([^)]+)\)/: the channel triple can itself be a var(), and
  // `rgba(var(--accent-rgb), 0.12)` closed the naive match at var's own paren and
  // silently produced NaN instead of failing loudly.
  const open = v.indexOf('(');
  const inner = v.slice(open + 1, matchParen(v, open));
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')') { depth--; cur += ch; }
    else if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  parts.push(cur.trim());

  let rgb;
  if (parts.length >= 4) {
    rgb = parts.slice(0, 3).map(Number);
  } else {
    rgb = String(resolveRaw(parts[0], themeVars)).split(',').map((x) => Number(x.trim()));
  }
  const alpha = Number(parts[parts.length - 1]);
  assert.ok(
    rgb.length === 3 && rgb.every((c) => Number.isFinite(c)) && Number.isFinite(alpha),
    'could not parse color "' + v + '"'
  );
  const bg = toRgb(backdrop);
  return hex(rgb.map((c, k) => alpha * c + (1 - alpha) * bg[k]));
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
  for (const selector of ['.lav-btn', '.secondary']) {
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

// ---------------------------------------------------------------------------
// Ink against surfaces
// ---------------------------------------------------------------------------
//
// Added when Aegean's card bottoms were tinted sea-light blue. The card top stays white,
// so the tint made the bottom DARKER, and every ink sitting on a card lost a little
// contrast. That is the same class of change as the .lav-btn bug — a fill moving out from
// under a label that used to be fine — so it needs the same kind of guard.
//
// Two tiers, because the four ink tokens are not one thing:
//
//   --text / --text-2   body copy. Hard AA floor of 4.5:1, met in every theme with a wide
//                       margin (worst is Art Deco --text-2 at 6.03:1).
//
//   --muted / --faint   recorded floors, NOT an AA assertion. Neither clears 4.5:1 in every
//                       theme today: Art Deco --muted is 3.68:1, and --faint runs 2.28–3.53
//                       across all five. Lifting every theme's ink is a design decision and
//                       not a test's call to make, so these record where things stand and
//                       fail on further slippage. The numbers being visible here is half the
//                       point — see the note under FLOORS.

const AA_NORMAL = 4.5;
const INK = ['--text', '--text-2', '--muted', '--faint', '--gold'];
const SURFACES = ['--bg', '--bg-2', '--velvet-1', '--velvet-2'];

// Worst-surface floors as measured. Raise these when a theme's ink improves; do not lower
// one to make a change pass — that is the failure this file exists to make visible.
//
// KNOWN BELOW AA (pre-existing, not introduced by any change here):
//   art-deco --muted 3.68:1  — secondary body text under the 4.5 floor
//   --faint  in every theme  — 2.28 (film-noir) to 3.53 (brownstone), except bauhaus and
//                              nixie (4.52, from its cool greys)
// --faint is used for the lowest-emphasis labels; if it ever carries something a user has
// to read, it needs darkening first, per theme.
//
// RESOLVED: art-deco --gold was 1.67:1 while being a `color:` in 25 rules, and this file
// said it "needs a decision about what Art Deco's accent ink IS". The decision was to
// split the token the way Bauhaus does — the bright metallic #C5A059 is now fill-only
// and pinned into --accent-fill / --fab-bg / --btn-accent-mid / --balloon-bg-hover /
// --glow, and --gold is a deep bronze at 5.23:1. --orange (2.21, @mentions) and --red
// (2.81, 16 rules) were the same defect in the same theme and moved with it.
//
// Note on art-deco --muted/--faint: they are NOT fixable the way the others were. To
// clear 4.5:1 on --velvet-2 (#DED4C0) a neutral grey has to be about #5A5A5A, which is
// barely lighter than --text-2 (#4a4a4a) — so the cream palette cannot carry a legible
// three-level grey hierarchy at all. That is a surface problem, not an ink problem.
const FLOORS = {
  aegean: { '--muted': 4.55, '--faint': 2.85, '--gold': 6.00 },
  'art-deco': { '--muted': 3.65, '--faint': 2.30, '--gold': 5.20 },
  brownstone: { '--muted': 6.20, '--faint': 3.50, '--gold': 8.60 },
  'film-noir': { '--muted': 4.45, '--faint': 2.25, '--gold': 7.85 },
  speakeasy: { '--muted': 5.20, '--faint': 3.00, '--gold': 6.95 },
  bauhaus: { '--muted': 6.00, '--faint': 4.65, '--gold': 4.80 },
  nixie: { '--muted': 7.60, '--faint': 4.50, '--gold': 12.35 },
  // Populuxe clears AA on all four surfaces for all five inks, --faint included. That is
  // a consequence of the ground being white with the cream demoted to a secondary plane,
  // which is the correction for the art-deco note above: the cream could not carry a
  // three-level hierarchy, so it stopped being the surface that had to.
  // --muted is much darker than the role usually wants (7.32) because it also has to stay
  // legible over the theme's pattern tile, which is far bolder than any other theme's.
  // That is what forced --pending-sub to be set explicitly; see themes/populuxe.css.
  populuxe: { '--muted': 7.32, '--faint': 4.78, '--gold': 4.64 },
  // Cast Iron's floors moved DOWN once, deliberately: a second user-directed pass
  // ("even outlines should be hinted at … avoid white fonts, everything in a dark
  // grey/black tone") demoted every ink and dimmed the surfaces with it. Hierarchy is
  // now carried by step between greys rather than by brightness, and these record the
  // honest new measurements — not a concession snuck past this table. Every ink still
  // clears AA where AA applies (--text 6.99, --text-2 5.57 on the darkest plate).
  'cast-iron': { '--muted': 4.61, '--faint': 2.39, '--gold': 8.83 },
};

for (const theme of THEMES) {
  test(`body ink clears AA on every surface in ${theme.name}`, () => {
    for (const ink of ['--text', '--text-2']) {
      const fg = resolve('var(' + ink + ')', theme.vars);
      assert.ok(/^#[0-9a-f]{3,6}$/i.test(fg), `${theme.name}: ${ink} resolved to "${fg}"`);
      for (const surface of SURFACES) {
        const bg = resolve('var(' + surface + ')', theme.vars);
        assert.ok(/^#[0-9a-f]{3,6}$/i.test(bg), `${theme.name}: ${surface} resolved to "${bg}"`);
        const r = contrast(fg, bg);
        assert.ok(
          r >= AA_NORMAL,
          `${theme.name}: ${ink} (${fg}) on ${surface} (${bg}) is ${r.toFixed(2)}:1, needs >= ${AA_NORMAL}`
        );
      }
    }
  });

  test(`secondary ink has not slipped in ${theme.name}`, () => {
    const floors = FLOORS[theme.name];
    assert.ok(floors, 'no recorded floors for theme ' + theme.name + ' — add them');
    for (const ink of ['--muted', '--faint', '--gold']) {
      const fg = resolve('var(' + ink + ')', theme.vars);
      const worst = Math.min(
        ...SURFACES.map((s) => contrast(fg, resolve('var(' + s + ')', theme.vars)))
      );
      assert.ok(
        worst >= floors[ink] - 0.005,
        `${theme.name}: ${ink} (${fg}) worst surface is ${worst.toFixed(2)}:1, floor is ${floors[ink]}`
      );
    }
  });
}

test('every theme has recorded floors', () => {
  // A new theme must be measured, not silently skipped.
  for (const theme of THEMES) assert.ok(FLOORS[theme.name], 'missing floors for ' + theme.name);
  for (const name of Object.keys(FLOORS)) {
    assert.ok(THEMES.some((t) => t.name === name), 'floors recorded for missing theme ' + name);
  }
});

test('INK and SURFACES name real tokens in every theme', () => {
  // A typo would make the loops above assert nothing at all.
  for (const theme of THEMES) {
    for (const v of INK.concat(SURFACES)) {
      const c = resolve('var(' + v + ')', theme.vars);
      assert.ok(/^#[0-9a-f]{3,6}$/i.test(c), `${theme.name}: ${v} did not resolve to a hex color`);
    }
  }
});

// ---------------------------------------------------------------------------
// Pending-confirm state
// ---------------------------------------------------------------------------
//
// Reported as unreadable in Art Deco: "Set as active?" / "Tap again to confirm". Two
// separate faults in one component, and neither is visible by reading the CSS.
//
//   .acct-row-pending .acct-row-name   --gold on a gold wash        1.68:1
//   .acct-row-pending .acct-row-npub   --gold-soft, 50% ALPHA       1.30:1
//
// The row's own background is a hardcoded rgba(203, 161, 78, 0.12) — the same wash in
// every theme, subtle over a dark card and subtle over cream, so it was never the problem
// on its own. The problem is gold ink on it, and an alpha token used as ink.
//
// Both text colors are now themeable with the gold as fallback, so the dark themes are
// unchanged and the two light themes supply their own. This checks the composited result,
// which is the only way the alpha fault shows up at all.

// Read out of the rule, not restated. It was a hardcoded rgba(203, 161, 78, 0.12) when
// this test was written and is now rgba(var(--accent-rgb), 0.12) so themes can move it —
// a literal here would have gone on cheerfully testing a gold backdrop that no theme
// renders any more.
const PENDING_WASH = rule(css, '.acct-row-pending').match(/background:\s*([^;]+?)(?:\s*!important)?;/)[1].trim();

for (const theme of THEMES) {
  test(`pending confirm is readable in ${theme.name}`, () => {
    const card = resolve('var(--velvet-1)', theme.vars);
    const wash = flatten(PENDING_WASH, card, theme.vars);

    const title = flatten(rule(css, '.acct-row-pending .acct-row-name').match(/color:\s*([^;]+);/)[1], wash, theme.vars);
    const sub = flatten(rule(css, '.acct-row-pending .acct-row-npub').match(/color:\s*([^;]+);/)[1], wash, theme.vars);

    const tr = contrast(title, wash);
    const sr = contrast(sub, wash);
    assert.ok(tr >= AA_NORMAL, `${theme.name}: pending title (${title}) on ${wash} is ${tr.toFixed(2)}:1, needs >= ${AA_NORMAL}`);
    assert.ok(sr >= AA_NORMAL, `${theme.name}: pending sub (${sub}) on ${wash} is ${sr.toFixed(2)}:1, needs >= ${AA_NORMAL}`);

    // The sub-label must stay the quieter of the two, or the fix has flattened the
    // hierarchy the color was carrying in the first place.
    assert.ok(sr <= tr, `${theme.name}: pending sub (${sr.toFixed(2)}) should not out-contrast the title (${tr.toFixed(2)})`);
  });

  test(`the item-row pending sub-label is readable in ${theme.name}`, () => {
    // Same label on the settings-style rows, which have no wash — it sits on the card.
    const expr = rule(css, '.item.item-pending .item-sub').match(/color:\s*([^;]+);/)[1];
    for (const surface of ['--velvet-1', '--velvet-2']) {
      const bg = resolve('var(' + surface + ')', theme.vars);
      const fg = flatten(expr, bg, theme.vars);
      const r = contrast(fg, bg);
      assert.ok(r >= AA_NORMAL, `${theme.name}: item pending sub (${fg}) on ${surface} (${bg}) is ${r.toFixed(2)}:1, needs >= ${AA_NORMAL}`);
    }
  });
}

test('no text color anywhere resolves to a translucent token', () => {
  // The root cause, stated directly. --gold-soft and friends are border/shadow tokens; a
  // `color:` that lands on one inherits the surface behind it and cannot be reasoned about
  // from the declaration alone. Scanning all of styles.css rather than the two known rules,
  // because the next one will be somewhere else.
  const offenders = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = m[1].trim().split('\n').pop().trim();
    for (const d of m[2].matchAll(/(?:^|;)\s*color:\s*([^;]+)/g)) {
      for (const theme of THEMES) {
        const v = resolveRaw(d[1].trim(), theme.vars);
        if (/^rgba\(/.test(String(v)) && !/,\s*1\s*\)$/.test(String(v))) {
          offenders.push(`${selector} -> ${d[1].trim()} = ${v} (${theme.name})`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], 'translucent text colors:\n  ' + offenders.join('\n  '));
});

// ---------------------------------------------------------------------------
// Accent plumbing
// ---------------------------------------------------------------------------

test('Aegean drives its accent washes off its own palette, not the gold literal', () => {
  // The two have to move together. Recoloring --gold alone gave the reported screenshot:
  // a cobalt check mark sitting on a Speakeasy-gold row highlight, because the wash was a
  // hardcoded literal that no theme could reach.
  const t = THEMES.find((x) => x.name === 'aegean');
  assert.ok(t, 'missing aegean');
  const wash = String(resolveRaw('var(--accent-rgb)', t.vars)).replace(/\s/g, '');
  const border = String(resolveRaw('var(--border-rgb)', t.vars)).replace(/\s/g, '');
  assert.ok(t.vars['--accent-rgb'], 'aegean must set --accent-rgb or its washes stay gold');
  assert.equal(wash, border, 'aegean --accent-rgb should follow its own cobalt --border-rgb');
  assert.equal(
    resolve('var(--gold)', t.vars),
    resolve('var(--purple)', t.vars),
    'aegean --gold should be its cobalt accent, not a metallic'
  );
});

test('the relax countdown keeps amber, whatever a theme does to --gold', () => {
  // Green -> amber is a traffic light. Aegean's --gold is cobalt now, and this rule read
  // --gold, so the "under a minute left" warning turned blue and the progression stopped
  // meaning anything. --amber is metallic in every theme; --gold is not.
  //
  // The rule is now themeable (--relax-dot-low) because the shared defaults are tuned for
  // a dark surface and vanish on a light one — see the dot test below. The fallback still
  // has to be --amber so the dark themes are unaffected, and no theme may point the token
  // at its --gold, which is the original defect one indirection further out.
  const body = rule(css, '.relax-status-dot.low');
  assert.match(body, /background: var\(--relax-dot-low, var\(--amber\)\)/, 'must fall back to --amber');
  assert.ok(!/var\(--gold\)/.test(body), 'must not read --gold');

  for (const theme of THEMES) {
    if (!theme.vars['--relax-dot-low']) continue;
    const low = resolve('var(--relax-dot-low)', theme.vars);
    const gold = resolve('var(--gold)', theme.vars);
    assert.notEqual(
      low.toLowerCase(),
      gold.toLowerCase(),
      `${theme.name}: --relax-dot-low resolved to --gold (${low}) — the traffic light stops meaning anything`
    );
  }
});

test('both relax countdown dots are visible on every theme status bar', () => {
  // The reported bug: the dot defaults (#4ade80 and --amber) are tuned for a dark
  // surface and measured 1.28-1.74:1 on the three light themes' status bars. A dot is a
  // non-text indicator, so the bar is WCAG 1.4.11's 3.0:1, not 4.5.
  //
  // The status bar is linear-gradient(--velvet-1 -> --velvet-2), so both stops count —
  // the dot sits at the top but the pulse ring reaches the lower one.
  const okBody = rule(css, '.relax-status-dot');
  const lowBody = rule(css, '.relax-status-dot.low');
  const okDefault = /var\(--relax-dot-ok, (#[0-9a-f]{3,6})\)/i.exec(okBody);
  assert.ok(okDefault, '.relax-status-dot must read --relax-dot-ok with a literal fallback');

  for (const theme of THEMES) {
    const ok = theme.vars['--relax-dot-ok']
      ? resolve('var(--relax-dot-ok)', theme.vars)
      : okDefault[1];
    const low = theme.vars['--relax-dot-low']
      ? resolve('var(--relax-dot-low)', theme.vars)
      : resolve('var(--amber)', theme.vars);

    for (const [name, fg] of [['ok', ok], ['low', low]]) {
      assert.ok(/^#[0-9a-f]{3,6}$/i.test(fg), `${theme.name}: ${name} dot resolved to "${fg}"`);
      for (const surface of ['--velvet-1', '--velvet-2']) {
        const bg = resolve('var(' + surface + ')', theme.vars);
        const r = contrast(fg, bg);
        assert.ok(
          r >= 3.0,
          `${theme.name}: ${name} dot (${fg}) on ${surface} (${bg}) is ${r.toFixed(2)}:1, needs >= 3.0`
        );
      }
    }
  }
  // Guard the rule that made lowBody themeable in the first place.
  assert.match(lowBody, /--relax-glow: color-mix/, 'the .low glow must follow its dot color');
});

test('accent pills survive a themed --gold', () => {
  // Their gradient hardcodes gold at the first and last stop with --gold in the middle,
  // so a theme that recolors --gold alone gets gold-cobalt-gold.
  for (const selector of ['.reload-banner-btn', '.host-perm-grant-btn']) {
    const body = rule(css, selector);
    assert.match(body, /var\(--btn-accent-mid/, selector + ' mid stop must be themeable');
    assert.match(body, /var\(--btn-accent-top/, selector + ' top stop must be themeable');
    assert.match(body, /var\(--btn-accent-bot/, selector + ' bottom stop must be themeable');
    assert.match(body, /color: var\(--btn-accent-text/, selector + ' label must be themeable');
  }
});

test('no stray Speakeasy gold is baked into a themed value', () => {
  // 15 rules hardcoded rgba(203, 161, 78, x) for accent washes, so a theme could recolor
  // --gold and still show Speakeasy's gold everywhere a wash appeared — which is what the
  // Aegean account list was doing. They read --accent-rgb now. What may still be literal:
  //   - the :root defaults themselves
  //   - a var(--x, <literal>) fallback, which a theme overrides by setting --x
  //   - the relax-glow amber, which is semantic and must not follow the theme
  const offenders = [];
  css.split('\n').forEach((line, i) => {
    if (!line.includes('rgba(203, 161, 78')) return;
    if (/^\s*--[a-z-]+:/.test(line)) return;            // a :root default
    if (/var\(--[a-z-]+,\s*rgba\(203/.test(line)) return; // themeable via its own token
    if (line.includes('--relax-glow')) return;          // semantic amber
    offenders.push(i + 1 + ': ' + line.trim());
  });
  assert.deepEqual(offenders, [], 'unthemeable gold literals:\n  ' + offenders.join('\n  '));
});
