'use strict';

// Exercise the renderer and decoded assets. In particular, changing the sky must
// never change a terrain pixel: dimming individual transparent mountain plates
// previously allowed stars to shine through the rock.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

function python(t, source) {
  const run = spawnSync('python3', ['-c', source, ROOT], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (run.error?.code === 'ENOENT') { t.skip('python3 is not installed'); return null; }
  if (/No module named '(PIL|numpy)'/.test(run.stderr)) {
    t.skip('Install scripts/borealis-requirements.txt to verify the artwork'); return null;
  }
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

const LOAD = `
import importlib.util, json, sys
from pathlib import Path
import numpy as np
from PIL import Image
root = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('borealis', root / 'scripts/gen-borealis.py')
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
`;

test('the two decoded Aurora Borealis compositions match a fresh procedural render', (t) => {
  const result = python(t, LOAD + `
report = {}
for layout, (w, h) in g.SIZES.items():
    name = 'borealis-night' + ('-wide' if layout == 'wide' else '') + '.avif'
    expected = np.asarray(g.render(w, h)).astype(np.int16)
    with Image.open(root / 'themes' / name) as image:
        actual = np.asarray(image.convert('RGB')).astype(np.int16)
        alpha = np.asarray(image.convert('RGBA'))[..., 3]
    assert actual.shape == expected.shape
    delta = np.abs(actual - expected)
    report[name] = {'meanError': float(delta.mean()),
                    'largeErrorFraction': float((delta.max(2) > 24).mean()),
                    'opaque': bool((alpha == 255).all())}
print(json.dumps(report))
`);
  if (!result) return;
  assert.equal(Object.keys(result).length, 2);
  for (const [name, row] of Object.entries(result)) {
    assert.ok(row.meanError < 2, `${name}: average encoding error ${row.meanError}`);
    assert.ok(row.largeErrorFraction < 0.001, `${name}: artwork moved beyond AVIF tolerance`);
    assert.ok(row.opaque, `${name}: terrain can expose the sky behind it`);
  }
});

test('terrain fully occludes even an artificially bright sky', (t) => {
  const result = python(t, LOAD + `
w, h = 144, 240
_, mask, _ = g.terrain(w, h)
original = g.sky
g.sky = lambda w, h: np.zeros((h, w, 3), dtype=np.float32)
dark = np.asarray(g.render(w, h))
g.sky = lambda w, h: np.ones((h, w, 3), dtype=np.float32)
bright = np.asarray(g.render(w, h))
g.sky = original
print(json.dumps({'terrainPixels': int(mask.sum()),
                  'terrainChanged': bool((dark[mask] != bright[mask]).any()),
                  'skyChanged': bool((dark[~mask] != bright[~mask]).any())}))
`);
  if (!result) return;
  assert.ok(result.terrainPixels > 1000, 'the scene must contain visible terrain');
  assert.equal(result.terrainChanged, false, 'sky light leaked through the solid mountains');
  assert.equal(result.skyChanged, true, 'the experiment did not actually change the sky');
});

test('shimmer masks reproduce and leave terrain and water completely untouched', (t) => {
  const result = python(t, LOAD + `
report = {}
for layout, (w, h) in g.SIZES.items():
    name = 'borealis-shimmer' + ('-wide' if layout == 'wide' else '') + '.png'
    expected = np.asarray(g.shimmer_mask(w, h))
    with Image.open(root / 'themes' / name) as image:
        actual = np.asarray(image)
        expanded = np.asarray(image.resize((w, h), Image.Resampling.BILINEAR))
    _, land, coast = g.terrain(w, h)
    report[name] = {'matches': bool(np.array_equal(actual, expected)),
                    'landLight': int(expanded[land].max()),
                    'waterLight': int(expanded[coast:].max()),
                    'skyLight': int(expanded.max())}
print(json.dumps(report))
`);
  if (!result) return;
  for (const [name, row] of Object.entries(result)) {
    assert.ok(row.matches, `${name}: regenerate the emission mask`);
    assert.equal(row.landLight, 0, `${name}: animated light touches the mountains`);
    assert.equal(row.waterLight, 0, `${name}: animated light touches the fjord`);
    assert.ok(row.skyLight > 128, `${name}: the mask must actually reveal aurora light`);
  }
});

test('water light reproduces and cannot spill onto land or sky', (t) => {
  const result = python(t, LOAD + `
report = {}
for layout, (w, h) in g.SIZES.items():
    name = 'borealis-water' + ('-wide' if layout == 'wide' else '') + '.png'
    expected = np.asarray(g.water_mask(w, h))
    with Image.open(root / 'themes' / name) as image:
        actual = np.asarray(image)
        expanded = np.asarray(image.resize((w, h), Image.Resampling.BILINEAR))
    _, land, coast = g.terrain(w, h)
    report[name] = {'matches': bool(np.array_equal(actual, expected)),
                    'landLight': int(expanded[land].max()),
                    'skyLight': int(expanded[:coast].max()),
                    'waterLight': int(expanded[coast:].max())}
print(json.dumps(report))
`);
  if (!result) return;
  for (const [name, row] of Object.entries(result)) {
    assert.ok(row.matches, `${name}: regenerate the water mask`);
    assert.equal(row.landLight, 0, `${name}: water light touches solid terrain`);
    assert.equal(row.skyLight, 0, `${name}: water light crosses the horizon`);
    assert.ok(row.waterLight > 128, `${name}: no reflected aurora reaches the water`);
  }
});
