'use strict';

// The seasonal packaging gate: an edition's art ships only in a release tagged inside
// its window (scripts/seasonal-packaging.cjs, which scripts/package.sh runs on the
// staged tree). The calendar itself is seasons.test.js's subject; this file holds the
// packaging half — which edition's art survives which tag date, that the art glob
// cannot eat anything but art, and that a stage built from this very tree loses the
// right files. Windows are read from seasons.js the way the helper reads them, so a
// window change that forgets this file fails here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const gate = require('../scripts/seasonal-packaging.cjs');

const ROOT = path.join(__dirname, '..');

function makeStage() {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-seasonal-'));
  fs.mkdirSync(path.join(stage, 'themes'));
  fs.copyFileSync(path.join(ROOT, 'seasons.js'), path.join(stage, 'seasons.js'));
  return stage;
}

function writeStage(stage, files) {
  for (const f of files) fs.writeFileSync(path.join(stage, f), 'x');
}

const list = (stage, dir) => fs.existsSync(path.join(stage, dir)) ? fs.readdirSync(path.join(stage, dir)) : [];

test('the gate strips exactly the editions out of season on the tag date', () => {
  const stage = makeStage();
  writeStage(stage, [
    'themes/sleepy-hollow-hollow.svg', 'themes/sleepy-hollow-tree-wide.svg', 'themes/sleepy-hollow.css',
    'themes/phantom-bouquet-floor.webp', 'themes/phantom-bouquet-drift-1.webp', 'themes/phantom-bouquet.css',
    'themes/patterns.css',
  ]);

  // A release tagged in October carries Sleepy Hollow and no Phantom Bouquet — the
  // branch carrying the new edition cannot leak it into an out-of-season hotfix.
  let removed = gate.stripOutOfSeasonArt(stage, '2026-10-06');
  assert.deepEqual(removed.sort(), ['themes/phantom-bouquet-drift-1.webp', 'themes/phantom-bouquet-floor.webp']);
  assert.deepEqual(list(stage, 'themes').sort(),
    ['patterns.css', 'phantom-bouquet.css', 'sleepy-hollow-hollow.svg', 'sleepy-hollow-tree-wide.svg', 'sleepy-hollow.css']);

  // The handoff day: the Phantom Bouquet release is the one Sleepy Hollow leaves.
  const stage2 = makeStage();
  writeStage(stage2, [
    'themes/sleepy-hollow-hollow.svg', 'themes/sleepy-hollow.css',
    'themes/phantom-bouquet-floor.webp', 'themes/phantom-bouquet.css',
  ]);
  removed = gate.stripOutOfSeasonArt(stage2, '2026-11-09');
  assert.deepEqual(removed, ['themes/sleepy-hollow-hollow.svg']);
  assert.deepEqual(list(stage2, 'themes').sort(), ['phantom-bouquet-floor.webp', 'phantom-bouquet.css', 'sleepy-hollow.css']);

  // After both windows close, neither ships.
  const stage3 = makeStage();
  writeStage(stage3, ['themes/sleepy-hollow-hollow.svg', 'themes/phantom-bouquet-floor.webp']);
  removed = gate.stripOutOfSeasonArt(stage3, '2026-12-07');
  assert.deepEqual(removed.sort(), ['themes/phantom-bouquet-floor.webp', 'themes/sleepy-hollow-hollow.svg']);
});

test('the gate is idempotent — a second run removes nothing', () => {
  const stage = makeStage();
  writeStage(stage, ['themes/phantom-bouquet-floor.webp']);
  assert.equal(gate.stripOutOfSeasonArt(stage, '2026-10-06').length, 1);
  assert.deepEqual(gate.stripOutOfSeasonArt(stage, '2026-10-06'), []);
  assert.deepEqual(list(stage, 'themes'), []);
  assert.ok(!fs.existsSync(path.join(stage, 'themes', 'phantom-bouquet-floor.webp')));
});

test('the art glob matches art and only art, for every edition on the books', () => {
  const stage = makeStage(); // seasons.js from the working tree, themes/ from it too
  for (const f of fs.readdirSync(path.join(ROOT, 'themes'))) fs.copyFileSync(path.join(ROOT, 'themes', f), path.join(stage, 'themes', f));
  const seasons = gate.loadSeasons(stage);
  const keys = seasons.EDITIONS.map((e) => e.key);

  // No key may be a dash-prefix of another, or the shorter key's glob would eat the
  // longer key's files on a day the longer one is in season and the shorter is not.
  for (const a of keys) for (const b of keys) {
    if (a !== b) assert.ok(!b.startsWith(a + '-'), `edition key ${b} collides with ${a}'s art glob`);
  }

  for (const key of keys) {
    const css = path.join(ROOT, 'themes', key + '.css');
    assert.ok(fs.existsSync(css), `themes/${key}.css is missing — the gate keeps stylesheets, so one must exist`);
    const art = gate.artFiles(stage, key);
    assert.ok(art.length > 0, `themes/${key}-* matched nothing — either the art moved or the key drifted from its files`);
    for (const rel of art) {
      assert.ok(rel.startsWith('themes/' + key + '-') && !rel.endsWith('.css'), rel + ' is not art');
      assert.notEqual(rel, 'themes/' + key + '.css');
    }
  }
});

test('a stage built from this very tree loses the right edition on each tag date', (t) => {
  const git = spawnSync('git', ['archive', 'HEAD'], { cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  if (git.error && git.error.code === 'ENOENT') { t.skip('git is not installed'); return; }
  assert.equal(git.status, 0, git.stderr.toString());

  const untar = (dir) => {
    fs.mkdirSync(dir, { recursive: true });
    const run = spawnSync('/bin/bash', ['-c', 'git archive HEAD | tar -x -C "$1"', 'untar', dir], { cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(run.status, 0, run.stderr.toString());
    return dir;
  };

  // November 9 or later: Phantom Bouquet's release — the one Sleepy Hollow leaves.
  const november = untar(fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-tag-nov-')));
  const sleepyArt = fs.readdirSync(path.join(november, 'themes'))
    .filter((f) => f.startsWith('sleepy-hollow-'))
    .reduce((s, f) => s + fs.statSync(path.join(november, 'themes', f)).size, 0);
  const stripped = gate.stripOutOfSeasonArt(november, '2026-11-09');
  const sleepyLeft = stripped.filter((f) => f.startsWith('themes/sleepy-hollow-'));
  assert.ok(stripped.length > 0, 'nothing was stripped — the gate went inert');
  assert.ok(sleepyLeft.length > 0, 'Sleepy Hollow art survives a November 9 release');
  assert.ok(fs.existsSync(path.join(november, 'themes', 'sleepy-hollow.css')), 'the stylesheet must ship even when its art does not');
  assert.ok(fs.existsSync(path.join(november, 'themes', 'phantom-bouquet-floor.webp')), 'Phantom Bouquet art must ship in its own window');
  const kb = Math.round(sleepyArt / 1024);
  console.log(`    a November 9 release strips ${stripped.length} files (${kb} KB): ${stripped.join(', ')}`);

  // October: Sleepy Hollow's window — the edition not yet needed stays out.
  const october = untar(fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-tag-oct-')));
  const strippedOctober = gate.stripOutOfSeasonArt(october, '2026-10-06');
  assert.ok(strippedOctober.some((f) => f.startsWith('themes/phantom-bouquet-')), 'Phantom Bouquet art must not ship before its window opens');
  assert.ok(fs.existsSync(path.join(october, 'themes', 'phantom-bouquet.css')));
  assert.ok(fs.existsSync(path.join(october, 'themes', 'sleepy-hollow-tree-wide.svg')), 'Sleepy Hollow art ships in its own window');
});
