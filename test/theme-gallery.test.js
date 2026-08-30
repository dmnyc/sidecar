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
