'use strict';

// A HEIC photo cannot be decoded by the browser, so it cannot be turned into a JPEG here, and
// uploading it as it is gives a broken image in many apps. uploadMedia refuses it with a
// message. These run the real uploadMedia and count what leaves the page.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'composer-core.js'), 'utf8');
const PK = 'a'.repeat(64);

function harness() {
  const requests = [];
  const ctx = {
    window: { SidecarI18n: { t: (key, values = {}) => key.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k]), tn: (x) => x } },
    Date, URL, TextEncoder, crypto: webcrypto, Uint8Array, AbortController, clearTimeout, setTimeout, btoa, FormData,
    console: { warn() {} },
    fetch: async (url) => { requests.push(url); return { ok: true, json: async () => ({ data: [{ url: 'https://i.nostr.build/x.jpg' }] }) }; },
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const up = ctx.window.SidecarCore.installComposer({
    activePubkey: () => PK,
    onUploadFallback() {},
    devLog() {},
    relayUrls: async () => ['wss://relay.example'],
    poolGet: async () => null,
    call: async (m) => m.event || {},
  });
  return { ...up, requests };
}

// An ISO base media ftyp box: size, "ftyp", major brand, minor version, compatible brands.
function ftyp(major, ...compat) {
  const body = Buffer.concat([Buffer.from(major), Buffer.alloc(4), ...compat.map((b) => Buffer.from(b))]);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write('ftyp', 4);
  return Buffer.concat([head, body, Buffer.alloc(200)]);
}
const MESSAGE = /HEIC is not a supported image type\. Try pasting the image instead\./;

for (const [what, make] of [
  ['a file typed image/heic', () => new File([ftyp('heic', 'mif1')], 'IMG_0001.HEIC', { type: 'image/heic' })],
  ['a file typed image/heif', () => new File([Buffer.alloc(40)], 'photo.heif', { type: 'image/heif' })],
  ['a HEIC with no type, as Windows hands it over', () => new File([Buffer.alloc(40)], 'IMG_0002.heic', { type: '' })],
  ['a HEIC renamed to .jpg, found by its brands', () => new File([ftyp('heic', 'mif1')], 'IMG_0003.jpg', { type: 'image/jpeg' })],
  ['a HEIC whose major brand is mif1, found by a compatible brand', () => new File([ftyp('mif1', 'miaf', 'heic')], 'x.bin', { type: '' })],
]) {
  test(`${what} is refused with a message, and nothing is sent`, async () => {
    const h = harness();
    await assert.rejects(() => h.uploadMedia(make(), PK), MESSAGE);
    assert.equal(h.requests.length, 0);
  });
}

test('an AVIF, which shares the mif1 brand, is not mistaken for HEIC', async () => {
  const h = harness();
  const avif = new File([ftyp('avif', 'mif1', 'miaf')], 'a.avif', { type: 'image/avif' });
  assert.equal(await h.uploadMedia(avif, PK), 'https://i.nostr.build/x.jpg');
  assert.equal(h.requests.length, 1);
});

test('an ordinary image still uploads', async () => {
  const h = harness();
  const gif = new File([Buffer.from('GIF89a')], 'a.gif', { type: 'image/gif' });
  assert.equal(await h.uploadMedia(gif, PK), 'https://i.nostr.build/x.jpg');
});

test('a short file does not trip the sniff', async () => {
  const h = harness();
  await assert.rejects(() => h.uploadMedia(new File([Buffer.alloc(3)], 'x.bin', { type: '' }), PK), /Choose an image or video/);
});
