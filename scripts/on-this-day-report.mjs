#!/usr/bin/env node
// Where the "on this day" list actually stands, so batches go where the gaps are
// rather than wherever someone happened to start.
//
// test/on-this-day.test.js enforces the hard rules and fails the suite. This reports
// the soft ones: coverage, thin months, and the mistake a test cannot see, which is
// writing about the same subject twice in a list assembled in themed batches.
//
//   node scripts/on-this-day-report.mjs
//   node scripts/on-this-day-report.mjs --gaps 06   (every empty day in June)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'on-this-day.js'), 'utf8');
const DATA = new Function('const window = {}; ' + src + '; return window.SIDECAR_ON_THIS_DAY;')();

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const THIS_YEAR = new Date().getFullYear();
const TARGET = 0.5; // half the year is the 1.14 floor

const pad = (n) => String(n).padStart(2, '0');
const key = (m, d) => pad(m + 1) + '-' + pad(d);

let days = 0, entries = 0, multi = 0;
const rows = [];
for (let m = 0; m < 12; m++) {
  let dm = 0, em = 0;
  for (let d = 1; d <= DAYS_IN[m]; d++) {
    const list = DATA[key(m, d)];
    if (!list || !list.length) continue;
    dm++; em += list.length;
    if (list.length > 1) multi++;
  }
  days += dm; entries += em;
  rows.push([MONTHS[m], dm, DAYS_IN[m], em]);
}

const bar = (n, total) => {
  const filled = Math.round((n / total) * 20);
  return '█'.repeat(filled) + '·'.repeat(20 - filled);
};

console.log('\nON THIS DAY: coverage\n');
for (const [name, dm, dim, em] of rows) {
  const flag = dm / dim < TARGET ? '  <- thin' : '';
  console.log('  %s %s %s/%s days, %s entries%s',
    name.padEnd(10), bar(dm, dim), String(dm).padStart(2), dim, String(em).padStart(2), flag);
}

const pct = (days / 366 * 100).toFixed(0);
console.log('\n  %s/366 days (%s%%), %s entries, %s dates with rotation',
  days, pct, entries, multi);
// COVERAGE IS MET; DEPTH IS THE GAP NOW. The panel indexes by year, so a date with one
// entry shows the same line every year: a second line on a covered date buys a year, and
// a new date buys nothing that is not already there.
console.log('  %s dates rotate, %s repeat every year',
  multi, days - multi);

// Subjects written twice. Crude on purpose: capitalised runs are the proper nouns,
// and a name appearing on two dates is nearly always the duplicate you did not mean.
const seen = new Map();
for (const [k, list] of Object.entries(DATA)) {
  for (const e of list) {
    for (const name of e.text.match(/\b[A-Z][a-z]+(?: [A-Z][a-z]+)*/g) || []) {
      if (name.length < 6) continue;
      if (!seen.has(name)) seen.set(name, []);
      seen.get(name).push(k + ' (' + e.year + ')');
    }
  }
}
const dupes = [...seen.entries()].filter(([, where]) => where.length > 1);
if (dupes.length) {
  console.log('\n  repeated subjects:');
  for (const [name, where] of dupes) console.log('    %s: %s', name, where.join(', '));
}

const want = process.argv.indexOf('--gaps');
if (want > -1 && process.argv[want + 1]) {
  const m = Number(process.argv[want + 1]) - 1;
  const empty = [];
  for (let d = 1; d <= DAYS_IN[m]; d++) if (!DATA[key(m, d)]) empty.push(key(m, d));
  console.log('\n  %s has %s empty days:\n    %s', MONTHS[m], empty.length, empty.join(' '));
}
console.log();
