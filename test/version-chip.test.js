'use strict';

// The build string, and the logos that would not stay put.
//
// Three small things, all about the screens you look at when something is wrong.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

test('the version copies, on every surface that shows it', () => {
  // A version number exists to be quoted back to you in a support thread, and reading one
  // off a screen is where that goes wrong.
  assert.match(panel, /function versionChip\(cls, withPrefix\)/);
  assert.match(panel, /await copyPlain\(text\);/, 'it must copy what is on screen');
  // About, and the two pre-unlock screens.
  assert.match(panel, /versionChip\('about-version', true\)/);
  assert.match(panel, /\['lock-version', 'onboarding-version'\]\.forEach/);
  assert.match(html, /id="lock-version"/);
  assert.match(html, /id="onboarding-version"/);
});

test('it carries the commit, not just the version', () => {
  // "1.11.0" alone does not tell a store build from an unpacked checkout, and those are
  // the two that behave differently.
  const fn = panel.slice(panel.indexOf('function buildVersionText'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /build\.commit && build\.commit !== 'dev'/);
  // version.js is generated at package time and gitignored, so a dev checkout has none.
  assert.match(body, /chrome\.runtime\.getManifest\(\)\.version/, 'must fall back to the manifest');
});

test('the version row does not drag the unlock form off center', () => {
  // .screen is a centered flex column. `margin-top: auto` on a last child eats the free
  // space above it, which would push the form to the top of the screen — the first
  // version of this did exactly that, and the chip ended up off the bottom edge as well.
  const rule = css.match(/\.pre-version-row \{[^}]*\}/)[0];
  assert.match(rule, /position: fixed/);
  assert.doesNotMatch(rule, /margin-top: auto/);
  // Fixed and full-width, so it must not swallow clicks meant for the form above it.
  assert.match(rule, /pointer-events: none/);
  assert.match(css, /\.pre-version-row \.version-chip \{ pointer-events: auto; \}/);
});

test('LOGOS CANNOT BE DRAGGED OFF THE PAGE', () => {
  // A browser will happily let you peel a logo off and drag a translucent ghost of it
  // around, which looks broken and does nothing.
  const logoImgs = html.match(/<img[^>]*sidecar-logo[^>]*>/g) || [];
  assert.ok(logoImgs.length >= 5, 'expected several logos in the panel');
  for (const img of logoImgs) {
    assert.match(img, /draggable="false"/, 'still draggable: ' + img.slice(0, 70));
  }
  // The About logo is built in JS and never passed through the markup.
  assert.match(panel, /className: 'about-logo'[^}]*draggable: 'false'/);
  // And swapLogos already walks every logo in the panel, so it is the backstop.
  assert.match(panel, /img\.draggable = false;/);
});

test('the drag fix is scoped to logos, not to every image', () => {
  // Account rows use real HTML5 drag to reorder. A blanket img rule would stop you
  // dragging a row by its avatar, which is the obvious place to grab it.
  const rule = css.match(/\.brand-logo, \.brand-logo-sm, \.brand-foot img, \.about-logo \{[^}]*\}/);
  assert.ok(rule, 'the user-drag rule must name the logo classes');
  assert.match(rule[0], /-webkit-user-drag: none/);
  assert.doesNotMatch(css, /^img \{[^}]*user-drag: none/m, 'never a blanket img rule');
});

test('the lock-screen version fades, but stays reachable', () => {
  // A build string earns its place on the screen you stare at when something will not
  // open, and earns nothing the other ninety-nine times you unlock. So it shows on load
  // and gets out of the way.
  assert.match(panel, /const VERSION_FADE_MS = \d+;/);
  assert.match(panel, /setTimeout\(\(\) => chip\.classList\.add\('faded'\), VERSION_FADE_MS\)/);
  const fade = Number(panel.match(/const VERSION_FADE_MS = (\d+);/)[1]);
  assert.ok(fade >= 2000 && fade <= 8000, 'long enough to read, short enough to be a footnote: ' + fade);

  // FADED, NOT REMOVED. It keeps its pointer events, so hover brings it back and
  // tap-to-copy still works — a version you can read but not copy would undo the chip.
  assert.match(css, /\.pre-version-row \.version-chip\.faded \{ opacity: 0; \}/);
  const back = css.match(/\.pre-version-row \.version-chip\.faded:hover,[\s\S]*?\{ opacity: 1; \}/);
  assert.ok(back, 'something must bring it back');
  assert.match(back[0], /:hover/);
  // :focus as well as :focus-visible — it stays in the tab order while invisible, and
  // focus-visible does not match focus moved by script.
  assert.match(back[0], /\.faded:focus,/);
  assert.match(back[0], /:focus-visible/);
});

test('the fade respects a reduced-motion preference', () => {
  const mq = css.match(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.pre-version-row \.version-chip \{ transition: none; \}[^}]*\}/);
  assert.ok(mq, 'the transition must be dropped under prefers-reduced-motion');
});

test('only the pre-unlock chip fades — About keeps its version', () => {
  // About is a place you went on purpose to find this. Fading it there would be a
  // disappearing act at the exact moment someone is trying to read it.
  assert.match(css, /\.pre-version-row \.version-chip \{ transition: opacity/);
  assert.doesNotMatch(css, /\.about-version[^{]*\{[^}]*opacity: 0/);
});

test('no theme drags the version row back into flow', () => {
  // Par Avion lifts every direct child of the lock screen above its postmark backgrounds
  // with `position: relative; z-index: 2`. That rule predates the version footer, and it
  // swept it up — the chip landed under "Forgot your PIN?" instead of at the foot of the
  // panel. Theme selectors carry an id, so they outweigh the base rule and no amount of
  // class stacking wins; the exemption has to live in the theme.
  //
  // Any theme reaching for the lock screen's children has to exclude this row.
  const dir = path.join(ROOT, 'themes');
  const offenders = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.css'))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of text.match(/[^{}]*#view-(?:lock|onboarding)[^{}]*\{[^}]*\}/g) || []) {
      const sel = rule.slice(0, rule.indexOf('{'));
      if (!/>\s*\*?:?n?o?t?/.test(sel) || !/>/.test(sel)) continue;
      if (!/position\s*:/.test(rule)) continue;
      if (!sel.includes('.pre-version-row')) offenders.push(file + ': ' + sel.trim().split('\n')[0]);
    }
  }
  assert.deepEqual(
    offenders, [],
    'these theme rules set position on the lock screen\'s children without exempting the ' +
    'version footer, which pins itself with position:fixed:\n  ' + offenders.join('\n  ')
  );
});

test('the version row clears whatever a theme paints down there', () => {
  const rule = css.match(/\.pre-version-row \{[^}]*\}/)[0];
  assert.match(rule, /z-index: 2/, 'Par Avion puts postmarks in exactly this corner');
});
