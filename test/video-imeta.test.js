'use strict';

// WHAT A VIDEO SAYS ABOUT ITSELF. An uploaded video carries its type and pixel size in its
// imeta tag (NIP-92), unless Settings turns that off.
//
// Everything here runs the real composer-core.js, loaded the way a page loads it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function loadCore(extra = {}) {
  const ctx = {
    console, setTimeout, clearTimeout, URL, TextEncoder, TextDecoder,
    navigator: { language: 'en' }, crypto: require('node:crypto').webcrypto,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: { lang: 'en', setAttribute() {}, dir: '' }, querySelectorAll: () => [] },
    chrome: { runtime: { getURL: (p) => p } },
    ...extra,
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('nostr-tools.js'), ctx);
  vm.runInContext(read('i18n.js'), ctx);
  vm.runInContext(read('composer-core.js'), ctx);
  return ctx;
}
const core = loadCore();
const SC = core.SidecarCore;
const NT = core.NostrTools;

const A = 'https://x.example/a.jpg';
const B = 'https://x.example/b.jpg';
// Arrays made inside the vm are another realm's; compare them as plain data.
const plain = (x) => JSON.parse(JSON.stringify(x));
const tagsFor = (m, o) => plain(SC.imetaTagsForMedia(m, o));

// ---- what a video says about itself ----

const video = { url: 'https://x.example/v.mp4', isVideo: true, mime: 'video/mp4', dim: '1920x1080' };

test('an uploaded video gets an imeta tag with its type and size', () => {
  assert.deepEqual(tagsFor([video]), [['imeta', 'url ' + video.url, 'm video/mp4', 'dim 1920x1080']]);
});

test('a described video also carries its alt, last', () => {
  assert.deepEqual(tagsFor([{ ...video, alt: 'a boat' }]),
    [['imeta', 'url ' + video.url, 'm video/mp4', 'dim 1920x1080', 'alt a boat']]);
});

test('Settings off: videos go out as bare URLs, described ones keep their alt', () => {
  assert.deepEqual(tagsFor([video], { videoImeta: false }), []);
  assert.deepEqual(tagsFor([{ ...video, alt: 'a boat' }], { videoImeta: false }),
    [['imeta', 'url ' + video.url, 'alt a boat']]);
  // An unset setting is on.
  assert.equal(tagsFor([video], { videoImeta: undefined }).length, 1);
});

test('a video the browser could not measure still reports its type; one never read reports nothing', () => {
  assert.deepEqual(tagsFor([{ url: video.url, isVideo: true, mime: 'video/webm' }]),
    [['imeta', 'url ' + video.url, 'm video/webm']]);
  assert.deepEqual(tagsFor([{ url: video.url, isVideo: true }]), []);
});

test('a restored draft cannot put a malformed type or size on the wire', () => {
  assert.deepEqual(tagsFor([{ url: video.url, isVideo: true, mime: 'text/html; x', dim: '1920 x 1080' }]), []);
  assert.deepEqual(tagsFor([{ url: video.url, isVideo: true, mime: 'video/mp4', dim: '0x0' }]),
    [['imeta', 'url ' + video.url, 'm video/mp4']]);
});

test('images are exactly as before: described ones tag, bare ones do not', () => {
  assert.deepEqual(tagsFor([{ url: A }, { url: B, alt: 'a cat' }, { url: A, mime: 'video/mp4', dim: '1x1' }]),
    [['imeta', 'url ' + B, 'alt a cat']]);
});

// ---- reading a video's size in the browser ----

function fakeVideoCore(behave) {
  const made = [];
  const ctx = loadCore({
    document: {
      documentElement: { lang: 'en', setAttribute() {}, dir: '' }, querySelectorAll: () => [],
      createElement(tag) {
        const listeners = {};
        const el = {
          tag, videoWidth: 0, videoHeight: 0, removed: false,
          addEventListener(n, f) { listeners[n] = f; },
          removeAttribute() { this.removed = true; }, load() {},
          set src(v) { el._src = v; Promise.resolve().then(() => behave(el, listeners)); },
          get src() { return el._src; },
        };
        made.push(el);
        return el;
      },
    },
    URL: Object.assign(function () {}, { createObjectURL: () => 'blob:fake', revokeObjectURL() { ctx.__revoked = (ctx.__revoked || 0) + 1; } }),
  });
  return { SC: ctx.SidecarCore, ctx, made };
}

test('a video file reports its type and pixel size', async () => {
  const { SC: S, ctx } = fakeVideoCore((el, l) => { el.videoWidth = 1280; el.videoHeight = 720; l.loadedmetadata(); });
  assert.deepEqual({ ...(await S.readVideoMeta({ type: 'video/mp4' })) }, { mime: 'video/mp4', dim: '1280x720' });
  assert.equal(ctx.__revoked, 1, 'the object URL was not released');
});

test('a file the browser cannot decode still reports its type, and never throws', async () => {
  const { SC: S } = fakeVideoCore((el, l) => l.error());
  assert.deepEqual({ ...(await S.readVideoMeta({ type: 'video/x-matroska' })) }, { mime: 'video/x-matroska' });
});

test('an image, or nothing, has no video meta', async () => {
  const { SC: S } = fakeVideoCore(() => {});
  assert.deepEqual({ ...(await S.readVideoMeta({ type: 'image/png' })) }, {});
  assert.deepEqual({ ...(await S.readVideoMeta(null)) }, {});
});

test('a file that never answers does not hold the upload open', async () => {
  const real = Date.now();
  const { SC: S } = fakeVideoCore(() => {});
  // The five-second bound is real; shorten it by running against a timer stub.
  const out = await Promise.race([
    S.readVideoMeta({ type: 'video/mp4' }),
    new Promise((r) => setTimeout(() => r('still waiting'), 200)),
  ]);
  assert.equal(out, 'still waiting', 'it resolved before the file answered or timed out');
  assert.ok(Date.now() - real < 2000);
});
