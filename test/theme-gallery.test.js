'use strict';

// The theme gallery in Settings previews each theme in its own document. Three things
// about that arrangement are load-bearing and invisible in review, so they are pinned
// here. All three are source assertions: the gallery needs a browser, twelve iframes and
// a real stylesheet cascade, none of which can be stood up in node.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const tileJs = fs.readFileSync(path.join(ROOT, 'theme-tile.js'), 'utf8');
const tileHtml = fs.readFileSync(path.join(ROOT, 'theme-tile.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

test('Reduce motion reaches the previews', () => {
  // reduceBalanceMotion is enforced in JS, not CSS: paintBalanceEl gates .bal-in on the
  // flag, and the class on <html> only covers the masked-disc animation. A preview is a
  // separate document and cannot read the setting, so the panel has to pass it — and the
  // <html> class cannot cross into an iframe either.
  assert.match(
    panel,
    /replayPreview\(!reduceBalanceMotion\)/,
    'the panel must tell the preview whether it may animate; the preview cannot see the setting'
  );
  assert.match(
    tileJs,
    /window\.replayPreview = function \(animate\) \{ paint\(animate !== false\); \}/,
    'the preview must honour the flag it is passed'
  );
  // Passed rather than withheld: an early return would leave a figure frozen wherever an
  // earlier click stopped it, so the still repaint is what clears it.
  assert.doesNotMatch(
    panel.slice(panel.indexOf('function replayThemePreview')),
    /^\s*if \(reduceBalanceMotion\) return;/m,
    'replayThemePreview should repaint still rather than decline to repaint'
  );
  // And the class is carried in for anything that keys on it inside the preview.
  assert.match(panel, /function syncPreviewMotion\(\)/);
  assert.match(panel, /classList\.toggle\('reduce-balance-motion', reduceBalanceMotion\)/);
});

test('the preview script is external, as MV3 requires', () => {
  // MV3's default page CSP is `script-src 'self'`, so an inline <script> in an extension
  // page is silently refused — no error in the page, no failed request, just a document
  // whose script never ran. This shipped inline once and the preview rendered as an empty
  // card in the fallback palette.
  assert.match(tileHtml, /<script src="theme-tile\.js">/);
  assert.doesNotMatch(tileHtml, /<script>[\s\S]*?<\/script>/);
});

test('the preview document is a full panel, and the card crops it', () => {
  // A theme's field is not resolution-independent: several are built from layers sized in
  // absolute pixels and tuned to sit at the top of a 700px panel. An earlier version used
  // a small document to magnify the repeating tiles, and those glows flooded all of it —
  // Nixie previewed red and Speakeasy warm when they are near-black and deep violet.
  assert.match(panel, /const PREVIEW_W = 360;/);
  assert.match(css, /width: 360px;\s*\n\s*height: 700px;/, 'the frame must be a full panel');
  // The stage height in the tile and the aspect-ratio of the slot describe the same crop.
  // If they disagree the card stops being centred in the band.
  const stage = tileHtml.match(/\.preview-stage \{[^}]*height:\s*(\d+)px/);
  const ratio = css.match(/aspect-ratio:\s*360 \/ (\d+)/);
  assert.ok(stage && ratio, 'could not read the stage height and the slot aspect-ratio');
  assert.equal(
    stage[1], ratio[1],
    'theme-tile.html .preview-stage height and the .theme-preview aspect-ratio must match'
  );
});

test('no theme paints a resting border on its own gallery card', () => {
  // THE RECURRING ONE, and it turned up in four theme files at once. A theme card at rest
  // must fall through to the shared `border: 2px solid var(--border)` — a neutral each
  // theme derives from its own palette, so it lightens on light themes and darkens on
  // dark ones. The active card is the only one allowed a colored edge.
  //
  // What went wrong: several themes styled their own card the way they style everything
  // else and set a colored resting border. Populuxe's was literally
  // `border-color: var(--gold)` — the SAME token .theme-card.active uses — so it looked
  // selected whenever it was visible. Nixie and Metropolis were near enough to do the
  // same, and Par Avion carried its airmail border-image at rest, which is louder than
  // any other theme's active state. In a six-card grid that is four cards claiming to be
  // the current one.
  //
  // Hover and .active are exempt: both are states the user caused, and the point of the
  // per-theme rule there is that a theme's selection color is its own.
  const dir = path.join(ROOT, 'themes');
  const offenders = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.css'))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8')
      // Comments first — this suite has twice had prose match its own guard.
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // Every rule whose selector mentions .theme-card without narrowing to a user state.
    const rules = text.match(/[^{}]*\.theme-card[^{}]*\{[^}]*\}/g) || [];
    for (const rule of rules) {
      const selector = rule.slice(0, rule.indexOf('{'));
      if (/:hover|\.active|\.selected/.test(selector)) continue;
      // :not(.theme-card) selectors are the corner sweep excluding cards, not card rules.
      if (/:not\(\.theme-card\)/.test(selector)) continue;
      if (/border-color|border-image|(^|[^-])border\s*:/.test(rule.slice(rule.indexOf('{')))) {
        offenders.push(file + ': ' + selector.trim());
      }
    }
  }
  assert.deepEqual(
    offenders, [],
    'these themes give their gallery card a colored border at rest, which reads as ' +
    'selected:\n  ' + offenders.join('\n  ')
  );
});

test('revealing a card re-scales it, because a hidden card cannot be measured', () => {
  // The frame is a fixed 360px document scaled to whatever the card actually is, and the
  // factor is measured rather than hardcoded because the side panel is resizable.
  //
  // The trap: .hidden-mode is display:none, so the six cards in the other half have no
  // layout and clientWidth reads 0. The ResizeObserver runs for all twelve, but those six
  // hit the `if (!w) return` guard and keep the scale they had when last on screen. Widen
  // the panel on Dark, switch to Light, and every light card renders at the old width —
  // the theme's field stopping short of the card edge with dead background beside it.
  //
  // mountThemePreview cannot be where this is fixed: it returns early once a card has a
  // frame, so it runs once per card ever. Reveal is the first moment a card is
  // measurable, so showThemeMode has to do it on every switch.
  const show = panel.slice(panel.indexOf('function showThemeMode'));
  const body = show.slice(0, show.indexOf('\n  }\n'));
  assert.match(
    body,
    /scaleThemePreview\(/,
    'showThemeMode must re-scale each card it reveals; mounting alone only covers the first reveal'
  );
  // And the mount path must still early-return, which is what makes the above necessary —
  // if this ever changes, the reasoning above is worth rereading rather than deleting.
  assert.match(panel, /if \(!slot \|\| slot\.firstChild\) return;/);
  // The zero guard stays: it is correct, it is just not sufficient on its own.
  assert.match(panel, /const w = slot\.clientWidth;\s*\n\s*if \(!w\) return;/);
});

test('THE GALLERY IS THE SAME HEIGHT IN BOTH HALVES, AT EVERY PANEL WIDTH', () => {
  // A bare `1fr` is minmax(auto, 1fr), and that `auto` floors the column at its
  // min-content width. Min-content for these cards is the widest unbreakable word in the
  // half on screen, and the halves do not agree: Werkstätte is 141.5px in Syncopate
  // against 117.3px for the widest dark label. Below roughly a 363px panel the Light
  // columns hit that floor and stop shrinking while the Dark ones keep going, and since
  // .theme-preview is sized by aspect-ratio a wider card is a taller one, on three rows at
  // once. Toggling Dark/Light then moved everything underneath the gallery: measured at
  // +3.2px on a 360px panel, +13.6px at 350px, +24.0px at 340px.
  //
  // Comments are stripped first because the block above this rule explains the trap using
  // the very strings the assertions look for.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = bare.slice(bare.indexOf('.theme-selector {'));
  const decls = rule.slice(0, rule.indexOf('}'));
  assert.match(
    decls,
    /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    'the gallery columns must not be floored at min-content, or the two halves are different heights'
  );
  assert.doesNotMatch(
    decls,
    /grid-template-columns:\s*1fr\s+1fr/,
    'a bare 1fr is minmax(auto, 1fr): the longest theme name drives the column and the halves diverge'
  );
});
