'use strict';
// Where each capture sits on the plate, read from manifest.json, and the Firefox arrangement of it.
//
// Firefox puts its sidebar on the left, so its images are the same pictures with the panel on the
// left and the page on the right: every rectangle in a two-up image is mirrored across the middle of
// the canvas. The four-panel image has no page and no side, so it is the same in both sets.

const manifest = require('./manifest.json');

const mirrorRect = (r, canvasWidth) => ({ ...r, x: canvasWidth - (r.x + r.w) });

// The rectangles for one image: an array of { role, x, y, w, h, radius } in drawing order.
function slotsFor(image, { firefox = false } = {}) {
  const W = manifest.canvas.width;
  if (image.layout === 'fourPanels') {
    const f = manifest.fourPanels;
    return f.x.map((x, i) => ({ role: image.panels[i], x, y: f.y, w: f.w, h: f.h, radius: f.radius }));
  }
  const { page, panel } = manifest.twoUp;
  const p = firefox ? mirrorRect(page, W) : page;
  const s = firefox ? mirrorRect(panel, W) : panel;
  return [{ role: image.page, ...p }, { role: image.panel, ...s }];
}

module.exports = { manifest, slotsFor, mirrorRect };
