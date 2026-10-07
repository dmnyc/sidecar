'use strict';

// Package only the artwork in season on the tag’s UTC commit date.
// Read windows from the staged release; keep stylesheets and prune artwork only.
// A new release is needed to supply the next edition when its window opens.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The stage's seasons.js, evaluated the way test/seasons.test.js evaluates the working
// tree's copy: an isolated context, SidecarSeasons off the other side.
function loadSeasons(stageDir) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(stageDir, 'seasons.js'), 'utf8'), ctx);
  return ctx.SidecarSeasons;
}

function parseDay(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  if (Number.isNaN(date.getTime())) throw new Error('not a YYYY-MM-DD date: ' + dateStr);
  return date;
}

// The editions whose window does not contain dateStr (YYYY-MM-DD).
function outOfSeasonEditions(stageDir, dateStr) {
  const seasons = loadSeasons(stageDir);
  const date = parseDay(dateStr);
  if (seasons.current(date).length > 1) throw new Error('overlapping seasonal editions on ' + dateStr);
  return seasons.EDITIONS.filter((e) => !seasons.inSeason(e.key, date)).map((e) => e.key);
}

// An edition's art: themes/<key>-*. The dash after the key is what keeps
// themes/<key>.css out of the match, and the stylesheet is what survives.
function artFiles(stageDir, key) {
  return fs.readdirSync(path.join(stageDir, 'themes'))
    .filter((f) => f.startsWith(key + '-'))
    .map((f) => path.join('themes', f));
}

// Deletes every out-of-season edition's art from the stage and returns the relative
// paths removed, in sorted order.
function stripOutOfSeasonArt(stageDir, dateStr) {
  const removed = [];
  for (const key of outOfSeasonEditions(stageDir, dateStr)) {
    for (const rel of artFiles(stageDir, key)) {
      fs.unlinkSync(path.join(stageDir, rel));
      removed.push(rel);
    }
  }
  return removed.sort();
}

module.exports = { loadSeasons, parseDay, outOfSeasonEditions, artFiles, stripOutOfSeasonArt };

if (require.main === module) {
  const [stageDir, dateStr] = process.argv.slice(2);
  if (!stageDir || !dateStr) {
    console.error('Usage: node scripts/seasonal-packaging.cjs <stage-dir> <YYYY-MM-DD>');
    process.exit(2);
  }
  const seasons = loadSeasons(stageDir);
  const date = parseDay(dateStr);
  const removed = stripOutOfSeasonArt(stageDir, dateStr);
  for (const e of seasons.EDITIONS) {
    const inSeason = seasons.inSeason(e.key, date);
    const art = inSeason ? artFiles(stageDir, e.key) : [];
    console.log('  ' + e.key + ': ' +
      (inSeason ? 'in season — art ships (' + art.length + ' files)' : 'out of season — art stripped'));
  }
  console.log('  stripped ' + removed.length + ' file' + (removed.length === 1 ? '' : 's'));
}
