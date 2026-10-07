'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const gate = require('../scripts/seasonal-packaging.cjs');
const ROOT = path.join(__dirname, '..');

function stage(t, archive = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-seasonal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (archive) {
    const tree = execFileSync('git', ['archive', 'HEAD'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', dir], { input: tree });
  } else {
    fs.copyFileSync(path.join(ROOT, 'seasons.js'), path.join(dir, 'seasons.js'));
    fs.cpSync(path.join(ROOT, 'themes'), path.join(dir, 'themes'), { recursive: true });
  }
  return dir;
}

const boundaries = [
  ['2026-10-01', 'sleepy-hollow'], ['2026-11-08', 'sleepy-hollow'],
  ['2026-11-09', null], ['2026-12-06', null], ['2026-12-07', 'borealis'],
  ['2026-12-31', 'borealis'], ['2027-01-01', 'borealis'],
  ['2027-01-17', 'borealis'], ['2027-01-18', null],
];
for (const [date, active] of boundaries) {
  test(`package for ${date} carries ${active || 'no seasonal artwork'}`, (t) => {
    const dir = stage(t);
    const before = new Map(fs.readdirSync(path.join(dir, 'themes')).map(f =>
      [f, fs.readFileSync(path.join(dir, 'themes', f))]));
    gate.stripOutOfSeasonArt(dir, date);
    for (const edition of gate.loadSeasons(dir).EDITIONS) {
      assert.equal(gate.artFiles(dir, edition.key).length > 0, edition.key === active);
      assert.ok(fs.existsSync(path.join(dir, 'themes', edition.key + '.css')));
    }
    for (const f of fs.readdirSync(path.join(dir, 'themes'))) {
      assert.deepEqual(fs.readFileSync(path.join(dir, 'themes', f)), before.get(f), f + ' changed bytes');
    }
    assert.deepEqual(gate.stripOutOfSeasonArt(dir, date), [], 'second pass is inert');
  });
}

test('overlapping editions fail before removing artwork', (t) => {
  const dir = stage(t);
  const file = path.join(dir, 'seasons.js');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('from: [12, 7], to: [1, 17]', 'from: [10, 1], to: [11, 8]'));
  const before = fs.readdirSync(path.join(dir, 'themes'));
  assert.throws(() => gate.stripOutOfSeasonArt(dir, '2026-10-06'), /overlapping/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'themes')), before);
});

test('edition art prefixes cannot swallow other editions or stylesheets', (t) => {
  const dir = stage(t);
  const keys = gate.loadSeasons(dir).EDITIONS.map(e => e.key);
  for (const a of keys) {
    assert.ok(gate.artFiles(dir, a).length > 0);
    assert.ok(gate.artFiles(dir, a).every(f => !f.endsWith('.css')));
    for (const b of keys) if (a !== b) assert.ok(!b.startsWith(a + '-'));
  }
});

test('committed archive carries only Aurora artwork for a December release', (t) => {
  const dir = stage(t, true);
  gate.stripOutOfSeasonArt(dir, '2026-12-07');
  assert.equal(gate.artFiles(dir, 'sleepy-hollow').length, 0);
  assert.equal(gate.artFiles(dir, 'borealis').length, 6);
  assert.ok(fs.existsSync(path.join(dir, 'themes', 'sleepy-hollow.css')));
  assert.ok(fs.existsSync(path.join(dir, 'themes', 'borealis.css')));
});
