'use strict';

// Seasonal editions in the release zip — called by scripts/package.sh.
//
// WHY. seasons.js decides when an edition is OFFERED; this decides when its art SHIPS.
// A store extension downloads its package whole at install and every update — there is
// no on-demand delivery for extension files, and fetching art from a server at runtime
// is remote-hosted code, which both stores prohibit. So the tag is the one moment
// packaging can respect the calendar: an edition's art ships in a release tagged inside
// its window, and the next window's release brings it back. The rule itself is the
// maintainer's (2026-10-06): an edition ships on the day it is needed, and the release
// that brings one in takes the finished one out — Sleepy Hollow leaves the package the
// day Phantom Bouquet arrives.
//
// WHAT SHIPS AND WHAT DOES NOT. Art only: themes/<key>-*, which is where the weight
// lives (at the 2026 editions: Sleepy Hollow 438 KB of SVG, Phantom Bouquet 1.4 MB of
// WebP). The edition's stylesheet themes/<key>.css always ships: at 15-19 KB it is
// noise, it keeps every document's <link> valid, and the url()s left pointing at
// stripped files sit inside [data-theme="<key>"] blocks that package's calendar never
// activates. The gallery offers an edition only inside its window, so nothing in a
// stripped package ever asks for a missing file.
//
// THE DATE. The tag's own commit date in UTC — the same clock SOURCE_DATE in
// package.sh uses, so two people packaging one tag strip the same files. The windows
// are read from the stage's OWN seasons.js, not the working tree's, so the build stays
// a function of the tag alone. Parsed midday, so no timezone slides a date across
// midnight — the same care seasons.js takes with its pretend date.
//
// Idempotent: run twice against one stage and the second run removes nothing.

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
