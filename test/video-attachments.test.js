'use strict';

// ATTACHING A VIDEO, AND THE THUMBNAIL IT GETS.
//
// Video was already half-supported: the picker accepted video/*, the draft carried
// isVideo, and the strip built a <video>. What it did not do was work. A <video> in a
// 72px cell paints black until it decodes something, downloads part of a file nobody
// asked to watch, and a frame at that size says less than the word VIDEO does.
//
// Worse, and invisible: the strip's success handler listened for 'load', which is an
// <img> event. A <video> never fires it. So the whole point of that handler, clearing
// the broken state when a retry succeeded, could not run for a video at all.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const expanded = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const bare = (s) => s.replace(/^\s*\/\/.*$/gm, '');

// ---- the extension parser, lifted and run ----

const ctx = { String };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  'function extOf(url) {' +
  core.match(/const m = \/\\\.\(\[a-z0-9\]\{2,5\}\)\$\/i\.exec\([^\n]+\);/)[0] +
  ' return m ? m[1].toUpperCase() : null; }; globalThis.f = extOf;',
  ctx
);
const extOf = ctx.f;

test('THE LABEL COMES FROM THE PATH, NOT THE WHOLE URL', () => {
  assert.equal(extOf('https://h/a.mp4'), 'MP4');
  assert.equal(extOf('https://h/a.MOV'), 'MOV');
  assert.equal(extOf('https://h/x/y/clip.webm'), 'WEBM');

  // A signed or cache-busted URL carries junk after the path, and the last dot in the
  // whole string is not the file's extension.
  assert.equal(extOf('https://h/a.mp4?sig=abc'), 'MP4');
  assert.equal(extOf('https://h/a.mp4#t=10'), 'MP4');
  assert.equal(extOf('https://h/a.mp4?x=y.zzz'), 'MP4',
    'the query decided the label, so a signed URL would read as ZZZ');

  // No extension is normal on content-addressed hosts (Blossom serves by hash). The
  // glyph alone is the answer; there is no label to invent.
  assert.equal(extOf('https://h/0a1b2c3d'), null);
  assert.equal(extOf('https://h/'), null);
  assert.equal(extOf(''), null);
});

test('A <video> GETS THE EVENT A <video> ACTUALLY FIRES', () => {
  // The bug this feature was hiding. 'load' is an <img> event; video has loadedmetadata.
  // Listening for the wrong one meant a video cell that recovered on retry kept its
  // broken styling until something else repainted the strip.
  assert.match(bare(panel), /el\.addEventListener\(m\.isVideo \? 'loadedmetadata' : 'load'/);
  assert.doesNotMatch(
    bare(panel).slice(bare(panel).indexOf('function renderThumbs()'), bare(panel).indexOf('function renderThumbs()') + 2600),
    /addEventListener\('load'/,
    'the strip still listens for a bare load event'
  );
});

test('THE HEADER IS FETCHED, THE FILE IS NOT', () => {
  // preload=metadata is what makes the 404 check affordable on a video. Without it the
  // browser is free to buffer a chunk of something nobody asked to watch; with preload
  // 'none' there would be no error to catch and the check would be gone.
  for (const [name, src] of [['panel', panel], ['expanded', expanded]]) {
    assert.match(bare(src), /if \(m\.isVideo\) \{ el\.preload = 'metadata'; el\.muted = true; \}/,
      name + ' does not hold the video to its header');
  }
});

test('BOTH COMPOSERS DRAW IT, FROM ONE BUILDER', () => {
  // Two strips drawing a video two ways is the difference nobody notices until one of
  // them is reported. The builder lives in composer-core and both call it.
  assert.match(core, /function videoThumbCover\(url\)/);
  assert.match(core, /composeNoteContent, stripDraftMediaUrls, buildMediaDrawer, videoThumbCover,/);
  assert.match(bare(panel), /cell\.append\(videoThumbCover\(m\.url\)\);\s*\n\s*primeVideoThumb\(el, cell\);/);
  assert.match(bare(expanded), /cell\.append\(SC\.videoThumbCover\(m\.url\)\);\s*\n\s*SC\.primeVideoThumb\(el, cell\);/);
  // Imported, not reached for off the global, matching how this file takes the rest.
  assert.match(panel, /buildMediaDrawer, videoThumbCover, primeVideoThumb \} = window\.SidecarCore;/);
});

test('the cover is opaque and does not eat the controls', () => {
  // Opaque or the black video shows through, which is the thing being replaced.
  assert.match(css, /\.compose-thumb-vid \{[\s\S]*?background: var\(--velvet-2\)/);
  // pointer-events: none, or a cover stretched across the cell would swallow the
  // remove button and the reorder steppers sitting on top of it.
  assert.match(css, /\.compose-thumb-vid \{[\s\S]*?pointer-events: none;/);
  // And appended BEFORE those controls, so they paint above it.
  const at = bare(panel).indexOf('cell.append(videoThumbCover(m.url));');
  assert.ok(at < bare(panel).indexOf("className: 'compose-thumb-x'"),
    'the cover is appended after the remove button');
});

test('A FRAME IS ASKED FOR, AND THE BADGE MOVES ASIDE WHEN IT ARRIVES', () => {
  const fn = core.slice(core.indexOf('function primeVideoThumb('));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));

  // preload=metadata stops at the header, so nothing is decoded and the element paints
  // nothing. A seek is what forces exactly one frame.
  assert.match(body, /el\.addEventListener\('loadedmetadata'/);
  assert.match(body, /el\.currentTime = /);

  // NOT FRAME ZERO. It is very often black or a fade-in, which is a thumbnail saying
  // less than the glyph it replaced.
  assert.match(body, /Math\.min\(0\.1, d \/ 2\)/,
    'the seek target is not clamped, so a clip under 0.1s never fires seeked');
  assert.doesNotMatch(body, /currentTime = 0;/);

  // Asked once. loadedmetadata fires again after a retry re-sets src, and seeking on
  // every one of those would fight the seek already in flight.
  assert.match(body, /if \(asked\) return;/);

  // Best-effort throughout: a codec the browser will not decode, or a host refusing
  // range requests, leaves the full cover in place, which is still a working thumbnail.
  assert.match(body, /try \{[\s\S]*?\} catch \(_\) \{\}/);

  // And the badge survives the frame rather than vanishing: a still does not say video.
  assert.match(body, /cell\.classList\.add\('has-frame'\)/);
  assert.match(css, /\.compose-thumb\.has-frame \.compose-thumb-vid \{/);
  assert.match(css, /\.compose-thumb\.has-frame \.compose-thumb-vid \{[\s\S]*?inset: auto auto 3px 3px;/,
    'the badge does not move to a corner, so it still covers the frame it uncovered');
});

test('the broken message names what actually failed', () => {
  assert.match(bare(panel), /'This ' \+ \(m\.isVideo \? 'video' : 'image'\)/,
    'a failed video still reports itself as an image');
});

test('an attached video still publishes as a plain URL', () => {
  // Nothing about the thumbnail may touch the wire format: composeNoteContent appends
  // every media URL the same way, and a video is not special to a reader.
  assert.match(core, /const urls = \(media \|\| \[\]\)\.map\(\(m\) => m && m\.url\)\.filter\(Boolean\);/);
  const fn = core.slice(core.indexOf('function composeNoteContent('));
  assert.doesNotMatch(fn.slice(0, 400), /isVideo/, 'the content builder branches on media type');
});
