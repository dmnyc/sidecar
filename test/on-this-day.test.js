'use strict';

// "On this day": one line at the foot of the Accounts tab about something that happened
// on today's date, at least 75 years ago.
//
// The list is hand-written, and this file exists mostly to keep it that way safely. Two
// CC0 sources were tried and rejected: Wikidata's event classes are overwhelmingly
// military (eleven of twelve results for a sample date were battles), and the Library of
// Congress gives subject titles rather than facts, mispairs its year list with its
// subjects, and rate-limits a bulk read to a stop. Both are lookup tools, not imports.
//
// What must not rot: entries stay short enough for a 360px panel, the age rule is
// computed from the current year rather than written down, a day with nothing shows NO
// CARD rather than claiming nothing happened, and sharing goes through a composer the
// user reads and edits rather than posting on their behalf.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
const bare = panel.replace(/^\s*\/\/.*$/gm, '');

function lift(decl) {
  const at = bare.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = bare.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < bare.length; j++) {
    if (bare[j] === '{') depth++;
    else if (bare[j] === '}' && --depth === 0) return bare.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// The list is its own file so it can be hand-edited without opening sidepanel.js.
const dataFile = fs.readFileSync(path.join(ROOT, 'on-this-day.js'), 'utf8');
const ENTRIES = new Function('const window = {}; ' + dataFile + '; return window.SIDECAR_ON_THIS_DAY;')();
const DATA_SRC = 'const ON_THIS_DAY = ' + JSON.stringify(ENTRIES) + ';';
const pick = new Function(
  DATA_SRC + '\nconst HISTORY_MIN_AGE = 75;\n' + lift('function pickOnThisDay(') + '\nreturn pickOnThisDay;'
)();

test('every entry is a real date, a year and a line that fits the panel', () => {
  const days = Object.keys(ENTRIES);
  assert.ok(days.length >= 10, 'expected a usable seed, found ' + days.length);
  for (const key of days) {
    assert.match(key, /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, key + ' is not a MM-DD key');
    const [m, d] = key.split('-').map(Number);
    const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    assert.ok(d <= maxDay, key + ' is not a day that exists');
    assert.ok(Array.isArray(ENTRIES[key]) && ENTRIES[key].length, key + ' has no entries');
    for (const e of ENTRIES[key]) {
      assert.ok(Number.isInteger(e.year), key + ' has an entry with no year');
      assert.ok(e.text && e.text.trim().length, key + ' has an empty line');
      // Same ceiling PERIOD_QUOTES uses. The panel is 360px and this sits under
      // everything that does a job; a paragraph there is a paragraph nobody reads.
      assert.ok(e.text.length <= 140, key + ' (' + e.year + ') runs to ' + e.text.length + ' characters');
      assert.ok(!/—/.test(e.text), key + ' (' + e.year + ') uses an em dash');
    }
  }
});

test('THE AGE RULE IS COMPUTED, NOT WRITTEN DOWN', () => {
  // period-quotes.test.js hardcodes `year < 1931` and needs a human to bump it every
  // January. This one derives the cutoff so it cannot silently go stale.
  const fn = lift('function pickOnThisDay(');
  assert.match(fn, /year - e\.year >= HISTORY_MIN_AGE/, 'the cutoff is not derived from the current year');
  assert.match(bare, /const HISTORY_MIN_AGE = 75;/);

  // And nothing in the list is too recent to show today.
  const thisYear = new Date().getFullYear();
  for (const [key, list] of Object.entries(ENTRIES)) {
    for (const e of list) {
      assert.ok(thisYear - e.year >= 75, key + ' (' + e.year + ') is under 75 years old and would not render');
    }
  }
});

test('a day with nothing written for it shows no card at all', () => {
  // Not "nothing happened today", which would be false about every date in the
  // calendar. Absence has to read as silence or the list can never ship partial.
  assert.equal(pick(new Date('2026-06-02T12:00:00')), null);
  const fn = lift('function renderOnThisDay(');
  assert.match(fn, /if \(!entry\) \{ host\.textContent = ''; hide\(host\); return; \}/,
    'the card is left on screen when there is no entry for today');
  assert.match(html, /<div class="otd hidden" id="otd">/, 'the container does not start hidden');
});

test('THE SAME DAY GIVES DIFFERENT PEOPLE DIFFERENT LINES', () => {
  // The half of this that matters. The card is shareable, so seeding on the date alone
  // means everyone who opens Sidecar that day posts the same sentence, and a date
  // carrying four entries still produces one post.
  const day = new Date('2026-05-21T12:00:00');
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(pick(day, 'npub-test-' + i).year);
  assert.ok(seen.size > 1, 'every account got the same entry; the seed is not reaching the pick');
});

test('and the same person gets the same line all day', () => {
  // Reported against the quotes once: a line swapped underneath someone mid-read. A
  // pick that reshuffles on every render is worse than no variety at all.
  const seed = 'npub-stable';
  const morning = pick(new Date('2026-05-21T08:00:00'), seed);
  const night = pick(new Date('2026-05-21T23:30:00'), seed);
  assert.deepEqual(morning, night, 'the same account was dealt two cards on one day');
  assert.deepEqual(pick(new Date('2026-05-21T12:00:00'), seed), morning);

  // Pure function of day + seed: no storage, no clock beyond the date, nothing to go
  // stale. A different day may well differ, which is the point.
  const fn = lift('function pickOnThisDay(');
  assert.doesNotMatch(fn, /Math\.random/, 'a random pick cannot be stable within a day');
  assert.match(fn, /hash = Math\.imul\(hash, 16777619\)/, 'the FNV mix went missing');
});

test('signed out still gets a card', () => {
  // No account means no seed. Everyone signed out shares a line, which is fine, since
  // that is the one state where nobody is posting.
  const e = pick(new Date('2026-05-21T12:00:00'), undefined);
  assert.ok(e && e.year, 'a signed-out panel lost the card entirely');
});

test('the render passes the account through', () => {
  const fn = lift('function renderOnThisDay(');
  assert.match(fn, /pickOnThisDay\(null, state\.activePubkey\)/,
    'the pick is not seeded, so every user sees the same line again');
});

test('SHARING GOES THROUGH THE COMPOSER, WITH THE MENTION VISIBLE', () => {
  // The whole product is "nothing gets signed that you did not see". An extension that
  // quietly attaches its own mention to a note signed with someone's key is the shape of
  // the thing it exists to prevent, so the npub rides in the text where it can be read
  // and deleted, and nothing is published without the normal composer in front of it.
  const fn = lift('function renderOnThisDay(');
  assert.match(fn, /openComposer\(/, 'sharing does not open the composer');
  // A colon rather than a comma with the sentence recased. Lowercasing the first letter
  // to fit "On this day in 1859, ..." produced "joshua Norton", and it would do the same
  // to every proper noun and acronym in the list.
  assert.match(fn, /'On this day in ' \+ entry\.year \+ ': ' \+ entry\.text/);
  assert.doesNotMatch(fn, /toLowerCase\(\)/, 'the share text is deriving grammar from the prose again');
  assert.match(fn, /'\\n\\nvia nostr:' \+ SIDECAR_NPUB/, 'the mention is not in the visible text');
  assert.match(bare, /const SIDECAR_NPUB = 'npub1car07/);
  for (const forbidden of ['publish', 'signEvent', 'tags.push']) {
    assert.ok(!fn.includes(forbidden), 'the share path reaches ' + forbidden + ' rather than the composer');
  }
});

test('the card is drawn to the narrow-panel rules', () => {
  // CLAUDE.md: the icon keeps its metrics and the prose beside it does the truncating.
  const rule = css.slice(css.indexOf('.otd-share {'));
  assert.match(rule.slice(0, rule.indexOf('}')), /flex: 0 0 auto/);
  const main = css.slice(css.indexOf('.otd-main {'));
  assert.match(main.slice(0, main.indexOf('}')), /min-width: 0/);
  assert.match(css, /\.otd\.hidden \{ display: none; \}/);
});

test('the list is its own file, wired up, and shipped', () => {
  // Three ways this silently becomes a no-op: the script tag goes missing, it loads
  // after sidepanel.js, or packaging strips the file. The panel defaults to {} rather
  // than throwing, so every one of them looks like "no card today" forever.
  // Compare the TAGS, not the filenames: the comment above the tag mentions
  // sidepanel.js, so a bare indexOf finds the prose and reports the wrong order.
  const dataTag = html.indexOf('<script src="on-this-day.js"></script>');
  const panelTag = html.indexOf('<script src="sidepanel.js"></script>');
  assert.notEqual(dataTag, -1, 'the data file is not loaded');
  assert.notEqual(panelTag, -1, 'the panel script tag moved');
  assert.ok(dataTag < panelTag,
    'on-this-day.js must load BEFORE sidepanel.js or the global is not there yet');
  assert.match(bare, /const ON_THIS_DAY = window\.SIDECAR_ON_THIS_DAY \|\| \{\};/,
    'a missing data file should cost the card, not the panel');
  assert.match(dataFile, /window\.SIDECAR_ON_THIS_DAY = \{/);
  // package.sh strips by name and glob; a bare root .js is kept, but assert it rather
  // than assume, since shipping without it is invisible.
  const pkg = fs.readFileSync(path.join(ROOT, 'scripts', 'package.sh'), 'utf8');
  assert.ok(!/on-this-day\.js/.test(pkg), 'packaging explicitly removes the data file');
});
