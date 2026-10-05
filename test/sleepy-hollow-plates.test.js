'use strict';

// Sleepy Hollow's plates are generated, never hand-edited: scripts/gen-sleepy-hollow.py
// draws every one, and a change to the scene is a change to the script. This regenerates
// them in memory and compares each with the file that ships, so a plate edited by hand,
// or a script change whose output was never written, fails here instead of drifting.
//
// The expanded composer wears its own hollow, with the Horseman at the left edge, because
// its centered card covers anything nearer the middle; the composer's rule must name it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('every Sleepy Hollow plate is what the generator draws', (t) => {
  const py = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('g', sys.argv[1])
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
files = {}
g_open = open
class Sink:
    def __init__(self, name): self.name = name
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def write(self, body): files[self.name] = body
import builtins
builtins.open = lambda p, mode='r', *a, **k: Sink(p) if 'w' in mode else g_open(p, mode, *a, **k)
builtins.print = lambda *a, **k: None
g.main()
builtins.open = g_open
sys.stdout.write(json.dumps({k.split('/')[-1]: v for k, v in files.items()}))
`;
  const run = spawnSync('python3', ['-c', py, path.join(ROOT, 'scripts', 'gen-sleepy-hollow.py')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error && run.error.code === 'ENOENT') { t.skip('python3 is not installed'); return; }
  assert.equal(run.status, 0, run.stderr);
  const plates = JSON.parse(run.stdout);
  assert.ok(Object.keys(plates).length >= 15, 'the generator wrote fewer plates than ship');
  for (const [name, body] of Object.entries(plates)) {
    const shipped = fs.readFileSync(path.join(ROOT, 'themes', name), 'utf8');
    assert.ok(shipped === body, `themes/${name} differs from what the generator draws`);
  }
});

test('the expanded composer wears its own hollow, with the bright moon', () => {
  const css = fs.readFileSync(path.join(ROOT, 'themes', 'patterns.css'), 'utf8');
  const rule = css.slice(css.indexOf('[data-theme="sleepy-hollow"] body.compose-page {'));
  const stack = rule.slice(0, rule.indexOf(';'));
  assert.match(stack, /background-image:\s*url\(sleepy-hollow-hollow-compose\.svg\)/);
  assert.match(stack, /url\(sleepy-hollow-sky-wide\.svg\)/);
  assert.doesNotMatch(stack, /var\(--sh-/, 'the composer follows the dim default again, and its card hides the Horseman');
});
