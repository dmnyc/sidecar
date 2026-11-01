'use strict';

// A phone photo carries where it was taken. Every upload sent the GPS coordinates along, and
// one Blossom server refused the file for it ("Private metadata detected"), which is how it
// was found. EXIF, XMP and IPTC come out of a JPEG before upload, in its own bytes, with the
// image data and the color profile untouched; a photo stored sideways is redrawn upright.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'composer-core.js'), 'utf8');

function load({ bitmap = true } = {}) {
  const calls = { redrawn: 0, requests: [] };
  class Canvas {
    constructor(w, h) { this.w = w; this.h = h; }
    getContext() { return { drawImage() {}, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }) }; }
    async convertToBlob(o) { calls.redrawn++; return new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])], { type: o.type }); }
  }
  const ctx = {
    window: { SidecarI18n: { t: (k, v = {}) => k.replace(/\{\{(\w+)\}\}/g, (_, x) => v[x]), tn: (x) => x } },
    Date, URL, TextEncoder, crypto: webcrypto, Uint8Array, Uint8ClampedArray, AbortController, setTimeout, clearTimeout,
    btoa, FormData, File, Blob, Promise, Number, String, Math, Set,
    console: { warn() {} }, OffscreenCanvas: Canvas,
    fetch: async (url, options) => { calls.requests.push({ url, options }); return { ok: true, json: async () => ({ data: [{ url: 'https://i.nostr.build/x.jpg' }] }) }; },
  };
  if (bitmap) ctx.createImageBitmap = async () => ({ width: 40, height: 30, close() {} });
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { core: ctx.window.SidecarCore, calls };
}

// ---- a JPEG built byte by byte ----
const seg = (marker, body) => Buffer.concat([Buffer.from([0xFF, marker, (body.length + 2) >> 8, (body.length + 2) & 0xFF]), body]);
// EXIF, little-endian TIFF: IFD0 with Orientation and a GPS IFD pointer, and a GPS IFD with a latitude.
function exif(orientation) {
  const t = Buffer.alloc(64);
  t.write('II', 0); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4);
  t.writeUInt16LE(2, 8);
  t.writeUInt16LE(0x0112, 10); t.writeUInt16LE(3, 12); t.writeUInt32LE(1, 14); t.writeUInt16LE(orientation, 18);
  t.writeUInt16LE(0x8825, 22); t.writeUInt16LE(4, 24); t.writeUInt32LE(1, 26); t.writeUInt32LE(38, 30);
  t.writeUInt32LE(0, 34);
  t.writeUInt16LE(1, 38); t.writeUInt16LE(0x0001, 40); t.writeUInt16LE(2, 42); t.writeUInt32LE(2, 44); t.write('N\0', 48);
  return seg(0xE1, Buffer.concat([Buffer.from('Exif\0\0'), t]));
}
const ICC = seg(0xE2, Buffer.from('ICC_PROFILE\0\x01\x01display-p3-profile-bytes'));
const XMP = seg(0xE1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>GPS 40.7</x:xmpmeta>'));
const IPTC = seg(0xED, Buffer.from('Photoshop 3.0\0owner name'));
const DQT = seg(0xDB, Buffer.alloc(65, 7));
const SCAN = Buffer.concat([seg(0xDA, Buffer.alloc(10, 1)), Buffer.from([1, 2, 3, 0xFF, 0x00, 4, 5]), Buffer.from([0xFF, 0xD9])]);
const jpeg = (...parts) => new File([Buffer.concat([Buffer.from([0xFF, 0xD8]), seg(0xE0, Buffer.from('JFIF\0\x01\x01')), ...parts, DQT, SCAN])], 'IMG_1234.jpg', { type: 'image/jpeg' });
const bytes = async (f) => Buffer.from(await f.arrayBuffer());

test('location, XMP and IPTC come out; the image data and the color profile stay byte for byte', async () => {
  const { core, calls } = load();
  const out = await core.stripPrivateMetadata(jpeg(exif(1), ICC, XMP, IPTC));
  const b = await bytes(out);
  assert.equal(b.indexOf('Exif'), -1, 'no EXIF');
  assert.equal(b.indexOf('xmpmeta'), -1, 'no XMP');
  assert.equal(b.indexOf('owner name'), -1, 'no IPTC');
  assert.ok(b.indexOf('display-p3-profile-bytes') > 0, 'the color profile is kept');
  assert.ok(b.subarray(b.length - SCAN.length).equals(SCAN), 'the picture itself is untouched');
  assert.ok(b.indexOf(DQT) > 0);
  assert.equal(out.type, 'image/jpeg');
  assert.equal(out.name, 'IMG_1234.jpg');
  assert.equal(calls.redrawn, 0, 'stripped in place, not re-encoded');
});

test('a photo stored sideways is redrawn upright instead of losing the tag that turns it', async () => {
  const { core, calls } = load();
  const out = await core.stripPrivateMetadata(jpeg(exif(6), ICC));
  assert.equal(calls.redrawn, 1);
  assert.equal((await bytes(out)).indexOf('Exif'), -1);
});

test('when a sideways photo cannot be redrawn, it is refused rather than sent with its location', async () => {
  const { core } = load({ bitmap: false });
  await assert.rejects(core.stripPrivateMetadata(jpeg(exif(6))), /location data/);
});

test('a JPEG with nothing private is sent exactly as it was', async () => {
  const { core } = load();
  const f = jpeg(ICC);
  assert.equal(await core.stripPrivateMetadata(f), f);
});

test('a file that does not parse as a JPEG is refused, never sent unchecked', async () => {
  const { core } = load();
  const broken = new File([Buffer.from([0xFF, 0xD8, 0x00, 0x11, 0x22])], 'x.jpg', { type: 'image/jpeg' });
  await assert.rejects(core.stripPrivateMetadata(broken), /could not be read/);
});

test('other types are not touched here', async () => {
  const { core } = load();
  for (const type of ['image/gif', 'image/webp', 'video/mp4']) {
    const f = new File([Buffer.from('Exif GPS')], 'x', { type });
    assert.equal(await core.stripPrivateMetadata(f), f);
  }
});

test('the upload sends the stripped photo', async () => {
  const { core, calls } = load();
  const up = core.installComposer({
    activePubkey: () => 'a'.repeat(64), relayUrls: async () => [], poolGet: async () => null,
    call: async (m) => (m.type === 'SIDECAR_GET_ACCOUNT_RELAYS' ? {} : m.event),
  });
  await up.uploadMedia(jpeg(exif(1), ICC), 'a'.repeat(64));
  const sent = calls.requests.find((r) => r.url.includes('nostr.build')).options.body.get('file');
  assert.equal((await bytes(sent)).indexOf('Exif'), -1, 'the location never leaves');
});

test('the profile picture uploader strips it too', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
  const fn = panel.slice(panel.indexOf('async function uploadImage('), panel.indexOf('tryBlossomFirst(file, forPk)', panel.indexOf('async function uploadImage(')));
  assert.match(fn, /file = await window\.SidecarCore\.stripPrivateMetadata\(file\);/);
});
