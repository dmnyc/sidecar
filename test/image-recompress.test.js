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
function load({ width = 2000, height = 1500, alpha = false, jpegBytes = 100 * 1024, decodeThrows = false, decoder = true, probeRaw = true, pixel = 255 } = {}) {
  const calls = { encoded: [], closed: 0, warnings: [], requests: [], contexts: [], put: [] };
  class Canvas {
    constructor(w, h) { this.w = w; this.h = h; }
    getContext(type, opts) {
      calls.contexts.push(opts ? opts.colorSpace : null);
      return {
        drawImage() {},
        getImageData: (x, y, w, h) => {
          // A one-pixel canvas is the HDR probe: it reads back the value it was given when
          // the browser decodes the signal raw, and something else when it converts it.
          if (w === 1 && h === 1) return { data: new Uint8ClampedArray([probeRaw ? 148 : 230, 0, 0, 255]) };
          const data = new Uint8ClampedArray(w * h * 4).fill(pixel);
          for (let i = 3; i < data.length; i += 4) data[i] = 255;
          if (alpha) data[3] = 0;
          return { data };
        },
        putImageData: (img) => { calls.put.push(Array.from(img.data.slice(0, 4))); },
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
    FormData, File, Blob, Promise, Number, String, Math, DataView, Uint32Array, Response, DecompressionStream,
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

// ---- HDR photos pasted from the clipboard ----
// Preview on a Mac copies an HDR photo as a 16-bit PNG whose ICC profile declares the PQ curve
// in a cicp tag. Chrome ignores the tag and decoded the signal as ordinary values, so the JPEG
// came out gray and flat. Measured in Chrome on that clipboard PNG, the correction brought the
// average error against the original's standard-range image from 28 levels to 3.
const zlib = require('node:zlib');
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
// A minimal ICC profile: the header, then a tag table holding one cicp tag.
function iccWithCicp(transfer) {
  const icc = Buffer.alloc(132 + 12 + 12);
  icc.writeUInt32BE(icc.length, 0);
  icc.write('acsp', 36, 'latin1');
  icc.writeUInt32BE(1, 128);
  icc.write('cicp', 132, 'latin1');
  icc.writeUInt32BE(144, 136);
  icc.writeUInt32BE(12, 140);
  icc.write('cicp', 144, 'latin1');
  icc[152] = 12; icc[153] = transfer; icc[154] = 0; icc[155] = 1; // P3 primaries, the transfer, RGB, full range
  return icc;
}
function hdrPng({ icc = null, cicp = null, size = 8 * MB } = {}) {
  const ihdr = Buffer.from([0, 0, 0x0B, 0x65, 0, 0, 0x0F, 0x30, 16, 2, 0, 0, 0]);
  const parts = [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr)];
  if (icc) parts.push(chunk('iCCP', Buffer.concat([Buffer.from('ICC Profile\0\0', 'latin1'), zlib.deflateSync(icc)])));
  if (cicp) parts.push(chunk('cICP', Buffer.from(cicp)));
  const head = Buffer.concat(parts);
  const idat = chunk('IDAT', Buffer.alloc(Math.max(0, size - head.length - 24)));
  return new File([head, idat, chunk('IEND', Buffer.alloc(0))], 'image.png', { type: 'image/png' });
}

test('an HDR PNG is recognized by the cicp tag in its ICC profile, or by its own cICP chunk', async () => {
  const { core } = load();
  assert.equal((await core.pngHdrInfo(hdrPng({ icc: iccWithCicp(16) }))).transfer, 'pq');
  assert.equal((await core.pngHdrInfo(hdrPng({ cicp: [9, 18, 0, 1] }))).transfer, 'hlg');
  assert.equal(await core.pngHdrInfo(hdrPng({ icc: iccWithCicp(13) })), null, 'an sRGB transfer is not HDR');
  assert.equal(await core.pngHdrInfo(hdrPng()), null, 'no color chunks at all');
  assert.equal(await core.pngHdrInfo(png(1 * MB)), null, 'not a PNG');
});

test('PQ to standard range: black stays black, reference white is white, brighter clips', () => {
  const { core } = load();
  const table = core.pqToSdrTable();
  assert.equal(table[0], 0);
  assert.equal(table[148], 255, 'PQ 148 of 255 is about 203 nits, the standard-range white');
  assert.equal(table[255], 255);
  assert.ok(table[64] > 0 && table[64] < 64, 'a dark PQ value maps darker, not lifted');
  for (let v = 1; v < 256; v++) assert.ok(table[v] >= table[v - 1], 'never reverses');
});

test('a pasted HDR photo is corrected to standard range, with nothing to tell the person', async () => {
  const { core, calls } = load({ jpegBytes: 1 * MB, pixel: 64 });
  const seen = [];
  const out = await core.recompressImage(hdrPng({ icc: iccWithCicp(16) }), { pasted: true, onHdr: (x) => seen.push(x) });
  assert.equal(out.type, 'image/jpeg');
  assert.deepEqual(seen, [], 'corrected, so no notice');
  const table = core.pqToSdrTable();
  assert.deepEqual(calls.put, [[table[64], table[64], table[64], 255]], 'the pixels are rewritten before encoding');
});

test('the correction is skipped when the browser already converts the signal itself', async () => {
  const { core, calls } = load({ jpegBytes: 1 * MB, probeRaw: false });
  const seen = [];
  const out = await core.recompressImage(hdrPng({ icc: iccWithCicp(16) }), { pasted: true, onHdr: (x) => seen.push(x) });
  assert.equal(out.type, 'image/jpeg');
  assert.deepEqual(seen, ['pq'], 'not corrected, so the person is told');
  assert.deepEqual(calls.put, [], 'converting twice would ruin it');
});

test('an HDR PNG chosen with the Media button goes up as it is, its HDR intact', async () => {
  const { core, calls } = load({ jpegBytes: 1 * MB });
  const f = hdrPng({ icc: iccWithCicp(16) });
  const seen = [];
  assert.equal(await core.recompressImage(f, { onHdr: (x) => seen.push(x) }), f);
  assert.deepEqual(seen, []);
  assert.equal(calls.encoded.length, 0);
});

test('an uncorrected pasted HDR photo shows the notice through the page; a corrected or chosen one does not', async () => {
  const { core } = load({ jpegBytes: 1 * MB, probeRaw: false });
  const notices = [];
  const installed = core.installComposer({
    activePubkey: () => 'a'.repeat(64),
    relayUrls: async () => [],
    poolGet: async () => null,
    call: async (m) => (m.type === 'SIDECAR_GET_ACCOUNT_RELAYS' ? {} : m.event),
    onUploadNotice: (m) => notices.push(m),
  });
  await installed.uploadMedia(hdrPng({ icc: iccWithCicp(16) }), 'a'.repeat(64), { pasted: true });
  assert.deepEqual(notices, ['This pasted HDR photo may lose definition. Attach the original file for best results.']);
  await installed.uploadMedia(hdrPng({ icc: iccWithCicp(16) }), 'a'.repeat(64));
  assert.equal(notices.length, 1, 'a chosen file is not converted');
  const { core: rawCore } = load({ jpegBytes: 1 * MB });
  const quiet = [];
  const corrected = rawCore.installComposer({
    activePubkey: () => 'a'.repeat(64),
    relayUrls: async () => [],
    poolGet: async () => null,
    call: async (m) => (m.type === 'SIDECAR_GET_ACCOUNT_RELAYS' ? {} : m.event),
    onUploadNotice: (m) => quiet.push(m),
  });
  await corrected.uploadMedia(hdrPng({ icc: iccWithCicp(16) }), 'a'.repeat(64), { pasted: true });
  assert.deepEqual(quiet, [], 'a corrected paste says nothing');
});
