'use strict';
// Which of the five gallery images a run makes, and which of them are new compared with the last release.
//
//   --only 1,3          just those images (a number, or part of the file name: "wallets")
//   --changed           the images that need no client page, compared with the previous release's set;
//                       the ones that came out the same, and the client-page ones, are carried over from it
//   --previous X.Y.Z    the set to compare with and carry from (default: the newest one before --release)
//
// An image that is not made costs nothing: the panel scenes it needs are skipped, and when no
// image shows the client's own page, the live client is never opened.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// Roles that come from the client's own page, loaded live over the network. They change with that
// site, so no run can tell whether they did without taking them again.
const LIVE_ROLES = ['client-login', 'client-pay'];
// Panel scenes that exist only inside the live client's session.
const LIVE_SCENES = ['approve-login', 'approve-pay', ...LIVE_ROLES];

const rolesOf = (image) => (image.layout === 'fourPanels' ? image.panels : [image.page, image.panel]);
const needsClient = (image) => rolesOf(image).some((r) => LIVE_ROLES.includes(r));
const numberOf = (image) => Number((/^store-(\d+)-/.exec(image.file) || [])[1]);

// "1,3" or "store-3-wallets.png" or "wallets" -> the images they name; anything else is an error.
function parseOnly(list, images) {
  const picked = new Set();
  for (const raw of String(list || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const hits = /^\d+$/.test(raw)
      ? images.filter((im) => numberOf(im) === Number(raw))
      : images.filter((im) => im.file === raw || im.file.replace(/^store-\d+-/, '').replace(/\.png$/, '') === raw.replace(/\.png$/, ''));
    if (!hits.length) throw new Error('--only names no image: "' + raw + '" (use 1-' + images.length + ', or a name such as ' + images.map((im) => im.file.replace(/^store-\d+-|\.png$/g, '')).join(', ') + ')');
    hits.forEach((im) => picked.add(im));
  }
  if (!picked.size) throw new Error('--only needs at least one image');
  return images.filter((im) => picked.has(im));
}

// The images this run makes. `only` (a list string) wins; else `changed` means the ones without a client page; else all.
function choose(images, { only = null, changed = false } = {}) {
  if (only) return parseOnly(only, images);
  if (changed) return images.filter((im) => !needsClient(im));
  return images.slice();
}

// The panel scenes and pages the chosen images draw, minus the roles a supplied screenshot stands in for.
function scenesFor(chosen, supplied = {}) {
  const names = new Set();
  for (const im of chosen) for (const role of rolesOf(im)) if (!(role in supplied)) names.add(role);
  return names;
}

// A non-interlaced 8-bit PNG (what Chrome writes) as { width, height, channels, data }.
function readPng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(file + ' is not a PNG');
  let width = 0, height = 0, depth = 0, color = 0, interlace = 0; const idat = [];
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at), type = buf.toString('latin1', at + 4, at + 8), body = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; color = body[9]; interlace = body[12]; }
    else if (type === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
  if (depth !== 8 || interlace || !channels) throw new Error(file + ': only 8-bit non-interlaced PNGs are compared');
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * channels, data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? data[y * stride + i - channels] : 0, b = y ? data[(y - 1) * stride + i] : 0, c = i >= channels && y ? data[(y - 1) * stride + i - channels] : 0;
      let v = row[i];
      if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      data[y * stride + i] = v & 255;
    }
  }
  return { width, height, channels, data };
}

// How many pixels differ visibly (some channel by more than `delta`), as a count and a share of the image.
// Two photographs of the same screen are not byte for byte equal: the lock screen's sparkles and glow move.
function pixelDifference(fileA, fileB, delta = 24) {
  const a = readPng(fileA), b = readPng(fileB);
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) return { pixels: Infinity, share: 1 };
  let pixels = 0;
  for (let i = 0; i < a.data.length; i += a.channels) {
    for (let k = 0; k < a.channels; k++) if (Math.abs(a.data[i + k] - b.data[i + k]) > delta) { pixels++; break; }
  }
  return { pixels, share: pixels / (a.width * a.height) };
}

// The same picture, give or take the screen's own ambient motion (measured: two runs of the same screen differ by
// no pixel at all at this tolerance). By count, not by share of the image, because a real change can be tiny: the
// wallet filter's two buttons swapping places, in 1.17.2, moved about 200 pixels of a million.
const SAME_PIXELS = 16;
const sameFile = (a, b) => fs.existsSync(a) && fs.existsSync(b) && pixelDifference(a, b).pixels <= SAME_PIXELS;

const versionParts = (v) => v.split('.').map(Number);
const newer = (a, b) => { const x = versionParts(a), y = versionParts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

// The newest store/screenshots-X.Y.Z that has all of `files` in both browsers' folders and is older than `release`.
function previousSet(storeDir, release, files) {
  if (!fs.existsSync(storeDir)) return null;
  const found = fs.readdirSync(storeDir)
    .map((n) => (/^screenshots-(\d+\.\d+\.\d+)$/.exec(n) || [])[1]).filter(Boolean)
    .filter((v) => newer(v, release) < 0)
    .filter((v) => ['chrome', 'firefox'].every((b) => files.every((f) => fs.existsSync(path.join(storeDir, 'screenshots-' + v, b, f)))))
    .sort(newer);
  return found.length ? found[found.length - 1] : null;
}

// Completes a release set in `out` (chrome/ and firefox/): each chosen image has just been written there; the rest are
// copied in from the previous set. Returns [{ image, status: 'new' | 'unchanged' | 'carried', from? }], one per file.
function assemble({ images, chosen, out, prevDir, prevVersion }) {
  const status = [];
  for (const browser of ['chrome', 'firefox']) {
    for (const image of images) {
      const dest = path.join(out, browser, image.file);
      const before = prevDir && path.join(prevDir, browser, image.file);
      if (chosen.includes(image)) {
        status.push({ image: browser + '/' + image.file, status: before && sameFile(dest, before) ? 'unchanged' : 'new' });
      } else {
        if (!before || !fs.existsSync(before)) throw new Error(image.file + ' was not made this run and the previous set has no ' + browser + '/' + image.file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(before, dest);
        status.push({ image: browser + '/' + image.file, status: 'carried', from: prevVersion });
      }
    }
  }
  return status;
}

module.exports = { assemble, readPng, pixelDifference, SAME_PIXELS, LIVE_ROLES, LIVE_SCENES, rolesOf, needsClient, parseOnly, choose, scenesFor, sameFile, previousSet };
