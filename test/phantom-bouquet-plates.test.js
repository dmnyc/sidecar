'use strict';

// Phantom Bouquet's plates are generated from Astra's cut leaves, never hand-edited:
// scripts/gen-phantom-bouquet.py lays out every one. This draws them again and compares
// each with the WebP that ships, so a plate edited by hand, or a change to the layout
// that was never written out, fails here instead of drifting. WebP is lossy, so the
// comparison is of pixels within a small tolerance rather than of bytes.
//
// It also holds the two placements the handoff asked for, measured on the shipped
// pixels: nothing on the head plate reaches the topbar or the tab labels (the top 106
// CSS px of the panel), and the heading row carries one whole leaf, not a cropped one.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function python(t, src) {
  const run = spawnSync('python3', ['-c', src, ROOT], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (run.error && run.error.code === 'ENOENT') { t.skip('python3 is not installed'); return null; }
  if (run.status !== 0 && /No module named 'PIL'|No module named 'numpy'/.test(run.stderr)) { t.skip('Pillow and numpy are not installed'); return null; }
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('every Phantom Bouquet plate is what the generator lays out', (t) => {
  const out = python(t, `
import importlib.util, json, os, sys
import numpy as np
from PIL import Image
root = sys.argv[1]
spec = importlib.util.spec_from_file_location('g', os.path.join(root, 'scripts', 'gen-phantom-bouquet.py'))
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
drawn = {}
g.save = lambda img, name, **kw: drawn.__setitem__(name, img)
import builtins; builtins.print = lambda *a, **k: None
g.main()
report = {}
for name, img in drawn.items():
    shipped = Image.open(os.path.join(root, 'themes', name)).convert('RGBA')
    a = np.asarray(img.convert('RGBA')).astype(np.float32)
    b = np.asarray(shipped).astype(np.float32)
    if a.shape != b.shape:
        report[name] = 'size %s, drawn %s' % (b.shape, a.shape); continue
    # Compare colour where there is something to see: premultiplied, so a transparent
    # pixel's meaningless colour does not count.
    pa = a[..., :3] * a[..., 3:] / 255; pb = b[..., :3] * b[..., 3:] / 255
    d = np.maximum(np.abs(pa - pb).max(2), np.abs(a[..., 3] - b[..., 3]))
    # The share of pixels that moved by more than the encoder's noise, in parts per
    # thousand: lossy WebP leaves a faint grain everywhere; a moved or edited leaf
    # leaves a solid patch.
    report[name] = float((d > 24).mean() * 1000)
sys.stdout.write(json.dumps(report))
`);
  if (!out) return;
  assert.ok(Object.keys(out).length >= 7, 'the generator laid out fewer plates than ship');
  for (const [name, diff] of Object.entries(out)) {
    assert.equal(typeof diff, 'number', `themes/${name}: ${diff}`);
    assert.ok(diff < 1, `themes/${name} differs from what the generator lays out (${diff.toFixed(2)} pixels in 1000)`);
  }
});

test('the head plate keeps clear of the topbar and tabs, and holds one whole leaf', (t) => {
  const out = python(t, `
import json, os, sys
import numpy as np
from PIL import Image
a = np.asarray(Image.open(os.path.join(sys.argv[1], 'themes', 'phantom-bouquet-top.avif')).getchannel('A'))
scale = a.shape[1] // 360
ys, xs = np.nonzero(a > 8)
sys.stdout.write(json.dumps({'top': int(ys.min()) / scale, 'edges': [int(xs.min()), int(xs.max()), int(ys.max())], 'w': a.shape[1], 'h': a.shape[0]}))
`);
  if (!out) return;
  assert.ok(out.top >= 106, 'the heading leaf reaches up to ' + out.top + 'px, into the tab labels');
  const [x0, x1, y1] = out.edges;
  assert.ok(x0 > 0 && x1 < out.w - 1 && y1 < out.h - 1, 'the heading leaf is cropped by the plate edge');
});

test('the white leaves only lighten what lies under the topbar and tabs, and end inside their plates', (t) => {
  const out = python(t, `
import json, os, sys
import numpy as np
from PIL import Image
linen = np.array([0xEC, 0xE5, 0xD6], np.float32)
report = {}
for name, frame in (('white', 360), ('white-wide', 900)):
    im = np.asarray(Image.open(os.path.join(sys.argv[1], 'themes', 'phantom-bouquet-%s.avif' % name)).convert('RGBA')).astype(np.float32)
    scale = im.shape[1] / frame
    a = im[..., 3:] / 255
    # Laid on the linen, the way the panel lays it, over the topbar and the tabs.
    bars = (im[..., :3] * a + linen * (1 - a))[:round(106 * scale)]
    report[name] = {
        'underBars': int((im[:round(106 * scale), :, 3] > 8).sum()),
        'darkest': float((bars - linen).min()),
        'bottom': int(im[-2:, :, 3].max()),
    }
sys.stdout.write(json.dumps(report))
`);
  if (!out) return;
  for (const [name, r] of Object.entries(out)) {
    assert.ok(r.underBars > 0, `phantom-bouquet-${name}.avif has no leaf coming in from the top edge`);
    // The lace under an icon or a label is lighter than the cloth, never darker. A few
    // levels is the lossy encoder's grain at a leaf's soft edge; a sepia-veined leaf
    // laid there darkens it by about 75.
    assert.ok(r.darkest >= -8, `phantom-bouquet-${name}.avif darkens the linen under the topbar or tabs by ${-r.darkest} levels`);
    // A leaf the plate's own bottom edge cuts off ends in a straight line mid-panel.
    assert.ok(r.bottom <= 8, `a leaf runs off the bottom of phantom-bouquet-${name}.avif`);
  }
});

test('the drifting leaves stand down under either reduce-motion setting', () => {
  const css = fs.readFileSync(path.join(ROOT, 'themes', 'phantom-bouquet.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-theme="phantom-bouquet"\] \.lock-leaves \{ display: none; \}/);
  // The in-app toggle sits on <html> with data-theme, so the two chain (CLAUDE.md).
  assert.match(css, /html\.reduce-balance-motion\[data-theme="phantom-bouquet"\] \.lock-leaves \{ display: none; \}/);
});

test('every drifting leaf has its sprite, and no sprite is left without a leaf', () => {
  const css = fs.readFileSync(path.join(ROOT, 'themes', 'phantom-bouquet.css'), 'utf8');
  const named = [...css.matchAll(/url\((phantom-bouquet-drift-\d+\.avif)\)/g)].map((m) => m[1]).sort();
  const shipped = fs.readdirSync(path.join(ROOT, 'themes')).filter((f) => /^phantom-bouquet-drift-\d+\.avif$/.test(f)).sort();
  assert.ok(named.length >= 5, 'the lock screen lost its leaves');
  assert.deepEqual(named, shipped);
  // sidepanel.html carries the elements the leaves ride on.
  const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  const slots = (html.match(/<div class="lock-leaves"[^>]*>(.*?)<\/div>/) || [, ''])[1].match(/<i><\/i>/g) || [];
  assert.ok(slots.length >= named.length, 'fewer .lock-leaves slots than drifting leaves');
});
