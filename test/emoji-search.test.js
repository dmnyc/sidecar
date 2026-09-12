'use strict';

// Searching the emoji picker.
//
// Two faults, reported together and unrelated underneath. Typing "ital" found no flag,
// because the vendored names are not all lowercase: 338 of the 1,914 carry a capital, and
// every flag is one of them ("flag Italy"), while the search lowercased only the query.
// So every flag in the picker was unreachable by the way anyone would type it, and
// reachable only by guessing the capital.
//
// And "spock", "llap" and "italian" find nothing in any dataset. Checked rather than
// assumed: emojibase tags 🇮🇹 as "IT, flag", 🍝 as "pasta, meatballs, restaurant" and 🤌 as
// "gesture, sarcastic, huh". Nothing ties them to Italy, and no source anywhere carries
// "spock". Those are associations rather than descriptions, so they are ours to curate.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const emojiData = fs.readFileSync(path.join(ROOT, 'emoji-data.js'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = source.indexOf('{', source.indexOf('(', at));
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// The real vendored table, the real alias map, the real index builder. Nothing stubbed:
// the bug was in the data's shape, so a fixture would have hidden it.
function index() {
  const ctx = { self: {} };
  vm.createContext(ctx);
  vm.runInContext(emojiData, ctx);
  vm.runInContext(
    source.match(/const EMOJI_ALIASES = \{[\s\S]*?\n  \};/)[0] +
      '\nlet _emojiIndex = null;\n' +
      lift('function emojiGroups(') +
      '\nglobalThis.out = emojiGroups();',
    ctx
  );
  return ctx.out;
}

// What the picker does with a query, reduced to its one line.
const search = (groups, q) => {
  const hits = [];
  for (const [, rows] of groups) for (const row of rows) if (row[2].includes(q)) hits.push(row[0]);
  return hits;
};

test('THE VENDORED NAMES ARE NOT ALL LOWERCASE', () => {
  // The fact the bug rested on. If this ever stops being true the fix is still correct,
  // but the reason for it is worth keeping visible.
  const ctx = { self: {} };
  vm.createContext(ctx);
  vm.runInContext(emojiData, ctx);
  const names = ctx.self.SidecarEmoji.flatMap(([, rows]) => rows.map((r) => r[1]));
  assert.ok(names.length > 1900, 'the table shrank: ' + names.length);
  assert.ok(names.filter((n) => /[A-Z]/.test(n)).length > 100, 'names are all lowercase now');
});

test('a lowercase query finds a flag', () => {
  const g = index();
  assert.ok(search(g, 'ital').includes('🇮🇹'), '"ital" still misses the Italian flag');
  assert.ok(search(g, 'japan').includes('🇯🇵'), '"japan" still misses the Japanese flag');
  assert.ok(search(g, 'brazil').includes('🇧🇷'), '"brazil" still misses the Brazilian flag');
});

test('the name is still searchable as before', () => {
  const g = index();
  assert.ok(search(g, 'pizza').includes('🍕'));
  assert.ok(search(g, 'vulcan').includes('🖖'), 'the vulcan salute lost its own name');
  assert.ok(search(g, 'shrug').length > 0);
});

test('CURATED WORDS NO DATASET CARRIES', () => {
  const g = index();
  assert.deepEqual(search(g, 'spock'), ['🖖']);
  assert.deepEqual(search(g, 'llap'), ['🖖']);
  const italian = search(g, 'italian');
  for (const ch of ['🇮🇹', '🍕', '🍝', '🤌']) {
    assert.ok(italian.includes(ch), '"italian" does not surface ' + ch);
  }
});

test('an alias adds to a name rather than replacing it', () => {
  // 🖖 answers to "spock" AND to "vulcan salute". An alias that overwrote the name would
  // trade one gap for another.
  const g = index();
  const row = g.flatMap(([, rows]) => rows).find((r) => r[0] === '🖖');
  assert.match(row[2], /vulcan salute/, 'the name is gone from the haystack');
  assert.match(row[2], /spock/, 'the alias is not in the haystack');
  assert.equal(row[1], 'vulcan salute', 'the displayed name changed');
});

test('every alias points at an emoji that exists in the table', () => {
  // A typo in the map is silent: the word simply never matches anything.
  const ctx = { self: {} };
  vm.createContext(ctx);
  vm.runInContext(emojiData, ctx);
  const chars = new Set(ctx.self.SidecarEmoji.flatMap(([, rows]) => rows.map((r) => r[0])));
  const map = new Function('return ' + source.match(/const EMOJI_ALIASES = (\{[\s\S]*?\n  \});/)[1])();
  for (const [term, list] of Object.entries(map)) {
    assert.equal(term, term.toLowerCase(), term + ' would never match: queries are lowercased');
    for (const ch of list) assert.ok(chars.has(ch), term + ' points at ' + ch + ', which is not in the table');
  }
});

test('the index is built once, not per keystroke', () => {
  // The search runs across the whole table on a debounce. Lowercasing 1,914 names inside
  // that loop is the reason this was not simply fixed in the comparison.
  const fn = stripComments(lift('function emojiGroups('));
  assert.match(fn, /if \(_emojiIndex\) return _emojiIndex/, 'the index is rebuilt every call');
  const picker = stripComments(lift('function emojiPickerOver('));
  assert.match(picker, /row\[2\]\.includes\(q\)/, 'the search reads the raw name again');
  assert.doesNotMatch(picker, /row\[1\]\.toLowerCase\(\)/, 'lowercasing moved back into the query loop');
});

test('the empty state spans the grid instead of one 34px column', () => {
  // .emoji-grid is a grid of 34px tracks and the message is appended into it, so without
  // a span it wrapped one word per line.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(css, /\.emoji-grid \.emoji-none \{[^}]*grid-column: 1 \/ -1/, 'the message is a grid cell again');
  assert.match(stripComments(source), /className: 'hint emoji-none'/, 'the message lost the class that spans it');
});
