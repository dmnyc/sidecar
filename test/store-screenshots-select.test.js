'use strict';

// THE STORE-SCREENSHOT RUN CAN MAKE JUST THE IMAGES THAT CHANGED.
//
// Making all five means opening a live client over the network and walking its login and a zap, which is
// the slow and fragile part, to photograph two images that most releases leave alone. select.js decides
// which images a run makes (--only, --changed) and, for a release, which came out new compared with the
// previous set and which are carried over from it. These run the code on real PNG files.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const DIR = path.join(__dirname, '..', 'scripts', 'store-screenshots');
const { manifest } = require(path.join(DIR, 'layout.js'));
const sel = require(path.join(DIR, 'select.js'));

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, body) => { const t = Buffer.from(type, 'latin1'), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(body.length); sum.writeUInt32BE(crc(Buffer.concat([t, body]))); return Buffer.concat([len, t, body, sum]); };

// A w x h RGBA PNG of one color, with `paint(x, y)` allowed to return another [r,g,b], filtered with each of the PNG
// row filters in turn so the reader's unfiltering is exercised.
function writePng(file, w, h, base, paint) {
  paint = paint || (() => null);
  const rows = [];
  const px = Array.from({ length: h }, (_, y) => Buffer.from(Array.from({ length: w }, (_, x) => { const c = paint(x, y) || base; return [c[0], c[1], c[2], 255]; }).flat()));
  for (let y = 0; y < h; y++) {
    const f = y % 5, cur = px[y], prev = y ? px[y - 1] : Buffer.alloc(w * 4), out = Buffer.alloc(w * 4 + 1);
    out[0] = f;
    for (let i = 0; i < w * 4; i++) {
      const a = i >= 4 ? cur[i - 4] : 0, b = prev[i], c = i >= 4 ? prev[i - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      out[i + 1] = (cur[i] - pred) & 255;
    }
    rows.push(out);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]));
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shots-select-'));

test('--only takes numbers and names, and says what it did not understand', () => {
  const names = (list) => sel.parseOnly(list, manifest.images).map((im) => im.file);
  assert.deepEqual(names('1,3'), ['store-1-panels.png', 'store-3-wallets.png']);
  assert.deepEqual(names('wallets, signin'), ['store-3-wallets.png', 'store-4-signin.png']);
  assert.deepEqual(names('store-5-pay.png'), ['store-5-pay.png']);
  assert.deepEqual(names('3,1,3'), ['store-1-panels.png', 'store-3-wallets.png'], 'in gallery order, once each');
  assert.throws(() => names('6'), /names no image: "6"/);
  assert.throws(() => names('wallet-page'), /names no image/);
  assert.throws(() => names(' , '), /at least one image/);
});

test('--changed makes the images that need no client page; --only wins over it', () => {
  const files = (o) => sel.choose(manifest.images, o).map((im) => im.file);
  assert.deepEqual(files({ changed: true }), ['store-1-panels.png', 'store-2-apps.png', 'store-3-wallets.png']);
  assert.deepEqual(files({ changed: true, only: '4' }), ['store-4-signin.png']);
  assert.equal(files({}).length, 5, 'no flag makes all five');
});

test('a run that makes no client image never asks for the live client scenes', () => {
  const local = sel.scenesFor(sel.choose(manifest.images, { changed: true }));
  for (const scene of sel.LIVE_SCENES) assert.ok(!local.has(scene), scene + ' is not needed for images 1-3');
  assert.deepEqual([...local].sort(), ['apps', 'lock', 'profile', 'wallet', 'wallet-setup', 'wallets', 'welcome', 'welcome-clean']);
  const signin = sel.scenesFor(sel.choose(manifest.images, { only: '4' }));
  assert.ok(signin.has('approve-login') && signin.has('client-login'));
  const supplied = sel.scenesFor(sel.choose(manifest.images, { only: '4' }), { 'client-login': '/x.png' });
  assert.ok(supplied.has('approve-login') && !supplied.has('client-login'), 'a supplied backdrop stands in for the live page');
});

test('the PNG reader and the comparison see what a person would: a changed line, not ambient noise', () => {
  const d = tmp();
  const a = path.join(d, 'a.png'), same = path.join(d, 'same.png'), noisy = path.join(d, 'noisy.png'), moved = path.join(d, 'moved.png'), other = path.join(d, 'other.png');
  writePng(a, 64, 40, [44, 30, 83]);
  writePng(same, 64, 40, [44, 30, 83]);
  writePng(noisy, 64, 40, [44, 30, 83], (x, y) => (x % 3 === 0 && y % 2 === 0 ? [48, 34, 88] : null));   // a glow that drifts by a few levels
  writePng(moved, 64, 40, [44, 30, 83], (x, y) => (y === 20 && x > 10 && x < 50 ? [250, 250, 250] : null));   // one line of text-sized change
  writePng(other, 32, 40, [44, 30, 83]);
  assert.equal(sel.pixelDifference(a, same).pixels, 0);
  assert.equal(sel.pixelDifference(a, noisy).pixels, 0, 'a few levels of drift is not a change');
  assert.equal(sel.pixelDifference(a, moved).pixels, 39);
  assert.ok(sel.sameFile(a, noisy));
  assert.ok(!sel.sameFile(a, moved), 'a thin line of difference is a change: 39 pixels here, about 200 for the filter buttons that swapped in 1.17.2');
  assert.ok(!sel.sameFile(a, other), 'a different size is a different picture');
  assert.ok(!sel.sameFile(a, path.join(d, 'missing.png')));
  fs.rmSync(d, { recursive: true, force: true });
});

test('the previous set is the newest earlier one that is complete', () => {
  const store = tmp();
  const files = manifest.images.map((im) => im.file);
  const make = (v, skip = null) => { for (const b of ['chrome', 'firefox']) { fs.mkdirSync(path.join(store, 'screenshots-' + v, b), { recursive: true }); for (const f of files) if (f !== skip) fs.writeFileSync(path.join(store, 'screenshots-' + v, b, f), v); } };
  make('1.9.0'); make('1.17.1'); make('1.17.10', 'store-5-pay.png'); make('1.17.2'); make('1.18.0');
  assert.equal(sel.previousSet(store, '1.17.2', files), '1.17.1', 'not itself, not a later one, not one with an image missing');
  assert.equal(sel.previousSet(store, '1.18.1', files), '1.18.0');
  assert.equal(sel.previousSet(store, '1.9.0', files), null);
  assert.equal(sel.previousSet(path.join(store, 'nowhere'), '2.0.0', files), null);
  fs.rmSync(store, { recursive: true, force: true });
});

test('a release set is completed from the previous one and says what is new', () => {
  const root = tmp(), prev = path.join(root, 'screenshots-1.17.1'), out = path.join(root, 'screenshots-1.17.2');
  const BG = [44, 30, 83], LINE = (y) => (x, yy) => (yy === y && x > 4 && x < 40 ? [240, 240, 240] : null);
  const images = manifest.images, chosen = sel.choose(images, { changed: true });
  for (const b of ['chrome', 'firefox']) {
    fs.mkdirSync(path.join(prev, b), { recursive: true }); fs.mkdirSync(path.join(out, b), { recursive: true });
    for (const im of images) writePng(path.join(prev, b, im.file), 48, 30, BG, im.file === 'store-5-pay.png' ? LINE(5) : null);   // the old gallery
    // This run made 1-3: image 1 changed, 2 and 3 came out the same.
    writePng(path.join(out, b, 'store-1-panels.png'), 48, 30, BG, LINE(12));
    writePng(path.join(out, b, 'store-2-apps.png'), 48, 30, BG);
    writePng(path.join(out, b, 'store-3-wallets.png'), 48, 30, BG);
  }
  const status = sel.assemble({ images, chosen, out, prevDir: prev, prevVersion: '1.17.1' });
  const by = (w) => status.filter((s) => s.status === w).map((s) => s.image);
  assert.deepEqual(by('new'), ['chrome/store-1-panels.png', 'firefox/store-1-panels.png']);
  assert.deepEqual(by('unchanged'), ['chrome/store-2-apps.png', 'chrome/store-3-wallets.png', 'firefox/store-2-apps.png', 'firefox/store-3-wallets.png']);
  assert.deepEqual(by('carried'), ['chrome/store-4-signin.png', 'chrome/store-5-pay.png', 'firefox/store-4-signin.png', 'firefox/store-5-pay.png']);
  assert.ok(status.filter((s) => s.status === 'carried').every((s) => s.from === '1.17.1'));
  for (const b of ['chrome', 'firefox']) for (const im of images) assert.ok(fs.existsSync(path.join(out, b, im.file)), 'the set is complete: ' + b + '/' + im.file);
  assert.equal(sel.pixelDifference(path.join(out, 'chrome', 'store-5-pay.png'), path.join(prev, 'chrome', 'store-5-pay.png')).pixels, 0, 'a carried image is the previous one');
  assert.throws(() => sel.assemble({ images, chosen, out: path.join(root, 'screenshots-1.18.0'), prevDir: null, prevVersion: null }), /was not made this run and the previous set has no/);
  fs.rmSync(root, { recursive: true, force: true });
});
