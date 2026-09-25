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

test('OPENING THE MEDIA OPENS THE BLOCK THAT CLIPS IT', () => {
  // Without this the block's own 108px clip is still there, and the full image is a
  // taller thing behind the same small window: the button reads as doing nothing.
  assert.match(body, /if \(full && block\) block\.classList\.add\('is-open'\)/);
  assert.match(css, /\.reply-target\.is-open \.reply-target-body \{[^}]*overflow-y: auto/);
});

test('IT TOGGLES BOTH WAYS, AND SAYS WHICH WAY IT WILL GO', () => {
  assert.match(body, /full = !full;/);
  assert.match(body, /wrap\.classList\.toggle\('is-full', full\)/);
  // The icon and the title both turn round, or an open image offers "Show the full
  // image" and there is no way to read that it will shrink.
  assert.match(body, /btn\.title = full \? 'Shrink it again' : 'Show the full image'/);
  assert.match(body, /icon\(full \? 'arrow-down-left' : 'arrow-up-right'\)/);
});

test('COVER AT REST, CONTAIN WHEN OPEN', () => {
  // Cover, because a letterboxed sliver in a short box shows less of the picture than a
  // crop of its middle. Contain when open, because the whole frame is the point.
  assert.match(css, /\.note-media-wrap \.note-media \{[^}]*max-height: 120px[^}]*object-fit: cover/);
  assert.match(css, /\.note-media-wrap\.is-full \.note-media \{ max-height: none; object-fit: contain; \}/);
  // The page has room, so its resting cap is bigger. Same reasoning as the type scale.
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
