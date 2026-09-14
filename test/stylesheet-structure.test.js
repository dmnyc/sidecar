'use strict';

// Every stylesheet has to parse all the way to the end.
//
// This exists because of a real break, shipped on a branch and only found from a
// screenshot: moving a block left a stray `}` behind at one end and swallowed an `@media`
// rule's closing brace at the other. The file still LOOKED fine, `{` and `}` still
// balanced across the whole file because the two mistakes canceled out, and all 1400
// tests passed.
//
// What actually happened is that Chrome stopped parsing at the damage and dropped the
// remaining 580-odd rules. Everything below that point lost its styling, which showed up
// as icons with no size: `.fab svg { width: 24px }` never applied, so the composer quill
// rendered at about 400px, and the key on the PIN card did the same.
//
// The lesson is that whole-file brace counting proves nothing, because two errors in
// opposite directions balance. This walks the file the way a parser does: comments and
// quoted strings are skipped as units, so braces inside a data: URL or a prose comment
// cannot be miscounted, and a depth that ever goes negative is an extra `}` at a point,
// not a total.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const sheets = ['styles.css', ...fs.readdirSync(path.join(ROOT, 'themes')).filter((f) => f.endsWith('.css')).map((f) => 'themes/' + f)];

// Walk like a parser. Returns the first structural fault, or null.
function scan(src) {
  let i = 0, line = 1, depth = 0;
  const open = [];
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '\n') { line++; i++; continue; }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) return { fault: 'unterminated comment', line };
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const q = ch;
      let j = i + 1;
      while (j < n && src[j] !== q) { if (src[j] === '\\') j++; j++; }
      for (let k = i; k < j && k < n; k++) if (src[k] === '\n') line++;
      i = j + 1;
      continue;
    }
    if (ch === '{') { open.push(line); depth++; i++; continue; }
    if (ch === '}') {
      if (depth === 0) return { fault: 'closing brace with nothing open', line };
      open.pop(); depth--; i++; continue;
    }
    i++;
  }
  if (depth !== 0) return { fault: depth + ' block(s) never closed, first opened', line: open[0] };
  return null;
}

for (const rel of sheets) {
  test(rel + ' parses to the end', () => {
    const fault = scan(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.equal(fault, null,
      fault && rel + ':' + fault.line + ' — ' + fault.fault +
        '. Chrome stops parsing here and silently drops every rule after it.');
  });
}

test('THE SCAN CATCHES WHAT WHOLE-FILE COUNTING MISSES', () => {
  // The exact shape of the break that got through: a stray close early on and a missing
  // close later. Counted across the file these cancel, so `{` and `}` tally and nothing
  // looks wrong. Walking positionally, the stray one is caught where it sits.
  const canceling = 'a { color: red; }\n}\n@media (x) {\n  b { color: blue; }\n';
  assert.equal((canceling.match(/\{/g) || []).length, (canceling.match(/\}/g) || []).length,
    'this fixture is meant to have balanced totals');
  assert.notEqual(scan(canceling), null, 'the scan agreed with the naive count, which is the bug');

  // And the things that must NOT be mistaken for structure.
  assert.equal(scan('a { background: url("data:image/svg+xml,%3Csvg%3E{}{}"); }'), null,
    'braces inside a quoted URL are being counted');
  assert.equal(scan('/* a comment with { and } and /* inside */ a { color: red; }'), null,
    'braces inside a comment are being counted');
});
