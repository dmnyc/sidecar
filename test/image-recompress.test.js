'use strict';

// A photo copied to the clipboard is pasted as a PNG of every pixel: a 1.3 MB phone JPEG
// arrived as a 39 MB PNG. Large PNGs are re-encoded as JPEG before upload, and left alone
// when that would cost something.
//
// The decision rules run here against stand-in decoding and encoding; the real thing was run
// in a browser on the photo that prompted this (a pasted PNG of 12 MB came out as a 1.4 MB
// JPEG of the same dimensions in a quarter of a second).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'composer-core.js'), 'utf8');
const MB = 1024 * 1024;
const png = (bytes, name = 'image.png') => new File([new Uint8Array(bytes)], name, { type: 'image/png' });

// A decoder and an encoder that behave as told, in a context of the real composer-core.
function load({ width = 2000, height = 1500, alpha = false, jpegBytes = 100 * 1024, decodeThrows = false, decoder = true } = {}) {
  const calls = { encoded: [], closed: 0, warnings: [], requests: [], contexts: [] };
  class Canvas {
    constructor(w, h) { this.w = w; this.h = h; }
    getContext(type, opts) {
      calls.contexts.push(opts ? opts.colorSpace : null);
      return {
        drawImage() {},
        getImageData: (x, y, w, h) => {
          const data = new Uint8ClampedArray(w * h * 4).fill(255);
          if (alpha) data[3] = 0;
          return { data };
        },
      };
    }
    async convertToBlob(opts) {
      calls.encoded.push(opts);
      return new Blob([new Uint8Array(jpegBytes)], { type: opts.type });
    }
  }
  const ctx = {
    window: { SidecarI18n: { t: (key, values = {}) => key.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k]), tn: (x) => x } },
    Date, URL, TextEncoder, crypto: webcrypto, Uint8Array, Uint8ClampedArray, AbortController, setTimeout, clearTimeout, btoa,
    FormData, File, Blob, Promise, Number, String, Math,
    console: { warn: (...a) => calls.warnings.push(a.map(String).join(' ')) },
    OffscreenCanvas: Canvas,
    fetch: async (url, options) => { calls.requests.push({ url, options }); return { ok: true, json: async () => ({ data: [{ url: 'https://i.nostr.build/x.jpg' }] }) }; },
  };
  if (decoder) {
    ctx.createImageBitmap = async () => {
      if (decodeThrows) throw new Error('cannot decode');
      return { width, height, close() { calls.closed++; } };
    };
  }
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { core: ctx.window.SidecarCore, ctx, calls };
}

test('a large photographic PNG becomes a JPEG, in the same picture, with the name changed', async () => {
  const { core, calls } = load({ jpegBytes: 1.4 * MB });
  const out = await core.recompressImage(png(12 * MB, 'Screenshot 2026.png'));
  assert.equal(out.type, 'image/jpeg');
  assert.equal(out.name, 'Screenshot 2026.jpg');
  assert.equal(out.size, Math.round(1.4 * MB));
  assert.deepEqual(JSON.parse(JSON.stringify(calls.encoded)), [{ type: 'image/jpeg', quality: 0.85 }]);
  assert.equal(calls.closed, 1, 'the decoded bitmap is released');
});

test('nothing but a large PNG is ever touched', async () => {
  const { core, calls } = load();
  for (const f of [
    new File([new Uint8Array(5 * MB)], 'a.jpg', { type: 'image/jpeg' }),
    new File([new Uint8Array(5 * MB)], 'a.gif', { type: 'image/gif' }),
    new File([new Uint8Array(5 * MB)], 'a.webp', { type: 'image/webp' }),
    new File([new Uint8Array(5 * MB)], 'a.mp4', { type: 'video/mp4' }),
    png(50 * 1024), // under the floor: nothing to save
  ]) assert.equal(await core.recompressImage(f), f, f.type + ' must go up as chosen');
  assert.equal(calls.encoded.length, 0);
});

test('transparency keeps the PNG, because JPEG would turn it black', async () => {
  const { core } = load({ alpha: true, jpegBytes: 10 * 1024 });
  const f = png(8 * MB);
  assert.equal(await core.recompressImage(f), f);
});

test('a screenshot that JPEG does not shrink by 30 percent stays a PNG', async () => {
  const { core } = load({ jpegBytes: 800 * 1024 });
  const f = png(1 * MB); // 800 KB of 1 MB is not worth smeared text
  assert.equal(await core.recompressImage(f), f);
  const { core: core2 } = load({ jpegBytes: 700 * 1024 });
  const g = png(1 * MB); // exactly 70 percent: kept as a PNG, the boundary is "at least 30 percent smaller"
  const out = await core2.recompressImage(g);
  assert.equal(out.type, 'image/jpeg', '700 KB of 1 MB is 31 percent smaller and is used');
});

test('a picture too large to decode safely, a failed decode, and no decoder at all each send the original', async () => {
  const huge = load({ width: 8000, height: 6000 });
  const f1 = png(20 * MB);
  assert.equal(await huge.core.recompressImage(f1), f1, 'over the pixel limit');
  const broken = load({ decodeThrows: true });
  const f2 = png(20 * MB);
  assert.equal(await broken.core.recompressImage(f2), f2);
  assert.ok(broken.calls.warnings.some((w) => w.includes('sending it as it is')), 'and says so in the console');
  const none = load({ decoder: false });
  const f3 = png(20 * MB);
  assert.equal(await none.core.recompressImage(f3), f3);
});

test('the upload carries the recompressed file, and the original size limit still applies', async () => {
  const { core, ctx, calls } = load({ jpegBytes: 1 * MB });
  const installed = core.installComposer({
    activePubkey: () => 'a'.repeat(64),
    relayUrls: async () => [],
    poolGet: async () => null,
    call: async (m) => (m.type === 'SIDECAR_GET_ACCOUNT_RELAYS' ? {} : m.event),
  });
  const url = await installed.uploadMedia(png(12 * MB), 'a'.repeat(64));
  assert.equal(url, 'https://i.nostr.build/x.jpg');
  const sent = calls.requests.find((r) => r.url.includes('nostr.build')).options.body.get('file');
  assert.equal(sent.type, 'image/jpeg', 'what is uploaded is the JPEG, not the PNG that was pasted');
  assert.equal(sent.size, 1 * MB);
  await assert.rejects(() => installed.uploadMedia(new File([new Uint8Array(101 * MB)], 'big.png', { type: 'image/png' }), 'a'.repeat(64)), /too large/);
});

test('the picture is drawn in Display P3, so a phone photo keeps its colors', async () => {
  // A default canvas is sRGB: a Display P3 photo came out tagged sRGB with its colors shifted
  // by 28 levels a channel on average. Measured in a browser on that photo, a P3 canvas gave
  // a JPEG tagged Display P3 that matched the original within 2 levels.
  const { core, calls } = load({ jpegBytes: 1 * MB });
  await core.recompressImage(png(8 * MB));
  assert.deepEqual(calls.contexts, ['display-p3']);
});
