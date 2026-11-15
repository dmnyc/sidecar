'use strict';

// Backups through i18n: the vault, the key backup and data recovery.
//
// lazarus.js stays free of the translation layer, so the panel translates what it says:
// kind names, item counts and the notes its delta explains itself with. Those tables are
// mirrors, and a mirror drifts, so this runs them against the registry and the notes the
// core actually emits: a kind or note added there fails here until the panel learns it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('./helpers/i18n');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'lazarus.js'), 'utf8');

function lift(decl) {
  const at = panel.indexOf(decl);
  assert.ok(at > -1, decl + ' is gone from sidepanel.js');
  const open = panel.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < panel.length; i++) {
    if (panel[i] === '{') depth++;
    else if (panel[i] === '}' && --depth === 0) return panel.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

function load() {
  const ctx = withI18n({
    h: (tag, props) => Object.assign({ tag }, props),
  });
  const lctx = { self: {} };
  vm.createContext(lctx);
  vm.runInContext(core, lctx);
  vm.createContext(ctx);
  vm.runInContext([
    'function lzName(', 'function lzYour(', 'function lzYourCurrent(', 'function lzYourCurrentCap(',
    'function lzCountOf(', 'function lzNote(', 'function lzOutcome(', 'function lzBold(',
  ].map(lift).join('\n') + '\n' + panel.match(/const LZ_NUM = [^\n]+/)[0] +
    '\nthis.LZ_NUM = LZ_NUM;', ctx);
  return { ctx, Lz: lctx.self.SidecarLazarus };
}

test('every kind Lazarus can recover has a name, a phrase and a count of its own', () => {
  const { ctx, Lz } = load();
  for (const k of Lz.KIND_LIST) {
    const kind = Number(k);
    for (const fn of ['lzName', 'lzYour', 'lzYourCurrent', 'lzYourCurrentCap']) {
      assert.notEqual(ctx[fn](kind), String(kind), fn + ' has no entry for kind ' + kind);
    }
    assert.ok(!/ items?$/.test(ctx.lzCountOf(kind, 2)), 'kind ' + kind + ' falls back to the generic "items" count');
  }
  // The chip label matches the core's own name in English, so the two cannot disagree.
  for (const k of Lz.KIND_LIST) assert.equal(ctx.lzName(Number(k)), Lz.REGISTRY[k].name);
});

test('every note the core can attach to a delta is in the panel\'s table', () => {
  const { ctx, Lz } = load();
  const notes = new Set();
  for (const k of Lz.KIND_LIST) {
    const r = Lz.REGISTRY[k];
    for (const f of ['restoreNote', 'emptyRestoreNote', 'currentMeaning', 'emptyMeaning']) if (r[f]) notes.add(r[f]);
  }
  for (const m of core.matchAll(/out\.notes\.push\('([^']+)'\)/g)) notes.add(m[1]);
  assert.ok(notes.size >= 12, 'found only ' + notes.size + ' notes; the scan above has gone blind');
  const table = lift('function lzNote(');
  for (const note of notes) {
    assert.ok(table.includes("'" + note + "':"), 'lzNote has no entry for: ' + note);
  }
  // The one with a number is matched as a pattern, and agrees with its count.
  assert.equal(ctx.lzNote('1 of the items in your current list aren’t in this version and would be removed.'),
    '1 of the items in your current list isn’t in this version and would be removed.');
  assert.equal(ctx.lzNote('7 of the items in your current list aren’t in this version and would be removed.'),
    '7 of the items in your current list aren’t in this version and would be removed.');
});

test('a count keeps its number in bold wherever the language puts it', () => {
  const { ctx } = load();
  const parts = ctx.lzBold(ctx.lzCountOf(10002, 1, ctx.LZ_NUM), '1');
  assert.equal(parts.length, 2);
  assert.equal(parts[0].tag, 'strong');
  assert.equal(parts[0].textContent, '1');
  assert.equal(parts[1], ' relay');
  assert.equal(ctx.lzCountOf(10002, 3), '3 relays');
  assert.equal(ctx.lzCountOf(0, 1), '1 profile field');
});

test('no plural ternary or glued sentence is left in the backups screens', () => {
  const regions = [
    ['  async function restoreNwcFromRelays()', '  // ---- NIP-65 relay list editor (Profile tab) ----'],
    ['  function renderSecretReveal(container, opts) {', '  function renameModal(a) {'],
    ['  // ---- Lazarus: recovery of user data from relay history ----', '  // ---- balance denomination'],
  ];
  for (const [a, b] of regions) {
    const body = panel.slice(panel.indexOf(a), panel.indexOf(b)).replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/=== 1 \? '' : 's'/.test(body), a + ' still pluralizes with a ternary');
    assert.ok(!/account\(s\)/.test(body), a + ' still says account(s)');
    assert.ok(!/\.name\.toLowerCase\(\)/.test(body), a + ' still drops a lowercased label into a sentence');
  }
});
