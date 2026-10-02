'use strict';

// A PHOTO IN THE NOTE YOU ARE ANSWERING.
//
// The quote block is capped, so an image in the note being replied to arrived as a
// 108px slice of itself. It was clipped rather than stripped on purpose, because
// sometimes the image IS the note, but a slice of it answers nothing either.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

const fn = core.slice(core.indexOf('function makeMediaExpandable(block, body)'));
const body = fn.slice(0, fn.indexOf('\n  }\n'));

test('IT IS A BUTTON, NOT A CLICK ON THE MEDIA', () => {
  // A <video> carries its own controls and a click on it means play. Overloading that
  // would make one gesture mean two things depending on where in the frame it landed.
  assert.match(body, /className: 'note-media-zoom'/);
  assert.ok(!/el\.addEventListener\('click'/.test(body), 'the media itself toggles, so video cannot be played');
  // The quote sits inside a sheet that closes on an outside click, and can sit inside a
  // link to the note.
  assert.match(body, /e\.preventDefault\(\);\s*\n\s*e\.stopPropagation\(\);/);
});

test('FULL SIZE MEANS THE VIEWPORT, NOT A BIGGER WINDOW', () => {
  // Growing the image inside the quote only trades a 108px window for a 320px one, and
  // in a 360px column that is still not the picture.
  assert.match(body, /openMediaLightbox\(el\.getAttribute\('src'\) \|\| el\.src, el\.tagName === 'VIDEO'\)/);
  assert.ok(!/classList\.toggle\('is-full'/.test(body), 'it grows in place again');
  assert.match(css, /\.media-lightbox \{[\s\S]*?position: fixed; inset: 0;/);
  // contain and bounded both ways: whole frame, nothing cropped, nothing off screen.
  assert.match(css, /\.media-lightbox-item \{[\s\S]*?max-width: 100%; max-height: 100%;[\s\S]*?object-fit: contain;/);

  // Above the panel's own overlays, because it opens from inside one of them.
  const z = Number((css.match(/\.media-lightbox \{[\s\S]*?z-index: (\d+);/) || [])[1]);
  const others = [...css.matchAll(/z-index: (\d+);/g)].map((m) => Number(m[1])).filter((n) => n !== z);
  assert.ok(z > Math.max(...others), 'the lightbox opens behind the sheet it was opened from');
});

test('THE LIGHTBOX CLOSES EVERY WAY SOMEBODY WILL TRY', () => {
  const lb = core.slice(core.indexOf('function openMediaLightbox(src, isVideo)'));
  const lbBody = lb.slice(0, lb.indexOf('\n  }\n'));
  assert.match(lbBody, /if \(e\.key === 'Escape'\)/);
  assert.match(lbBody, /back\.addEventListener\('click', \(e\) => \{ if \(e\.target === back\) shut\(\); \}\)/,
    'clicking the image closes it, so a video cannot be scrubbed');
  assert.match(lbBody, /close\.addEventListener\('click'/);

  // Escape is CAPTURED, or the panel's own handler closes the sheet behind it instead
  // and the lightbox is left floating over nothing.
  assert.match(lbBody, /addEventListener\('keydown', onKey, true\)/);
  // And the handler is taken off again, or every image ever opened keeps listening.
  assert.match(lbBody, /removeEventListener\('keydown', onKey, true\)/);
  assert.match(lbBody, /if \(gone\) return;/, 'shut can run twice and remove a live listener');
});

test('the resting thumbnail is still capped and cropped', () => {
  // Cover, because a letterboxed sliver in a short box shows less of a picture than a
  // crop of its middle does. The lightbox is where nothing is cropped.
  assert.match(css, /\.note-media-wrap \.note-media \{[^}]*max-height: 120px[^}]*object-fit: cover/);
  assert.match(css, /\.compose-page \.note-media-wrap \.note-media \{ max-height: 260px; \}/);
});

test('BOTH REPLY TARGETS GET IT, AND A REDRAW DOES NOT LOSE IT', () => {
  assert.match(panel, /makeMediaExpandable\(block, body\);/);
  assert.match(page, /SC\.makeMediaExpandable\(box, body\);/);
  // Show more re-renders the quote, which throws away the wrappers with the old DOM, so
  // it has to re-wrap or an expanded quote has no media controls at all.
  const wraps = (panel.match(/makeMediaExpandable\(block, body\);/g) || []).length;
  assert.equal(wraps, 2, 'expected the first render and the Show more redraw, found ' + wraps);
});

test('it never double-wraps', () => {
  // makeMediaExpandable runs again on every redraw, and the panel calls it twice on a
  // note that was never redrawn at all.
  assert.match(body, /if \(el\.parentNode && el\.parentNode\.classList\.contains\('note-media-wrap'\)\) return;/);
});
