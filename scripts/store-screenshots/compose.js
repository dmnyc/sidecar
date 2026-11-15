'use strict';
// Puts captures on a plate and writes the 1280×800 image. Chrome does the drawing: the page is
// plain HTML, so a plate color, a position or a corner radius is one value in the manifest.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CHROME } = require(path.join(__dirname, '..', '..', 'test', 'helpers', 'real-extension.js'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// items: [{ src, x, y, w, h, radius }] — drawn in order, each clipped to its own rounded rectangle.
function pageFor({ width, height, plate, items }) {
  const imgs = items.map((it) => `<img src="${esc(pathToFileUrl(it.src))}" style="left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;border-radius:${it.radius || 0}px">`).join('\n');
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:${esc(plate)}}
img{position:absolute;display:block;object-fit:cover}
</style><body>${imgs}</body>`;
}
const pathToFileUrl = (p) => 'file://' + path.resolve(p).split(path.sep).map(encodeURIComponent).join('/');

function compose({ out, width = 1280, height = 800, plate, items }) {
  if (!CHROME) throw new Error('No Chrome found to draw the image');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-'));
  const html = path.join(dir, 'page.html');
  fs.writeFileSync(html, pageFor({ width, height, plate, items }));
  const r = spawnSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${width},${height}`, `--user-data-dir=${path.join(dir, 'profile')}`, `--screenshot=${path.resolve(out)}`, pathToFileUrl(html),
  ], { stdio: 'ignore' });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0 || !fs.existsSync(out)) throw new Error('Chrome did not write ' + out);
  return out;
}

module.exports = { compose, pageFor };
