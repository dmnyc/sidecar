'use strict';

// Searching a well-known name returns a column of identical rows: same display name,
// same picture, different keys. Nothing on the row said which one your circle actually
// knows, so picking the real account was guesswork — and picking wrong means
// mentioning, following or zapping an impersonator. See #298.
//
// The signal is the web-of-trust set the notification bell already builds. NIP-05 is
// the obvious lever and a weaker one: odell@evil-lookalike.com verifies perfectly,
// because NIP-05 proves control of an identifier at a domain and says nothing about
// which domain you had in mind. A domain can be bought; ten of someone's follows
// cannot easily be persuaded.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  let paren = 0;
  let i = source.indexOf('(', at);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// Run the two pure-ish ranking functions against a controllable environment, so the
// tiering can be exercised without a panel, a relay or a warm set.
function run({ wotKeys, activePubkey = 'me', wotPubkey = 'me' }) {
  const ctx = {
    console, Set, Map, Array, Object, Number, String,
    state: { activePubkey },
    _wotSet: wotKeys ? new Set(wotKeys) : null,
    _wotPubkey: wotPubkey,
    self: {
      SidecarWot: {
        // Mirrors wot.js: unknown means yes, so callers must gate on set.size
        // themselves rather than leaning on this for "is this a positive claim".
        inNetwork: (set, pk) => (!set || !set.size ? true : set.has(pk)),
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext([lift('function trustTier('), lift('function rankByTrust(')].join('\n') +
    '\nglobalThis.out = { trustTier, rankByTrust };', ctx);
  return ctx.out;
}

const cand = (pubkey, name) => ({ pubkey, name: name || pubkey });

// ---- the tiers ---------------------------------------------------------------------

test('someone you follow outranks someone merely vouched for', () => {
  const { trustTier } = run({ wotKeys: ['vouched'] });
  const followed = new Set(['mine']);
  assert.equal(trustTier('mine', followed), 2);
  assert.equal(trustTier('vouched', followed), 1);
  assert.equal(trustTier('stranger', followed), 0);
});

test('A FOLLOW OUTRANKS THE SET EVEN IF THE SET DISAGREES', () => {
  // You chose them. No threshold should be able to overrule that, and wot.js says
  // the same thing where it builds the set.
  const { trustTier } = run({ wotKeys: ['someone-else'] });
  assert.equal(trustTier('mine', new Set(['mine'])), 2);
});

// ---- the ordering ------------------------------------------------------------------

test('results are reordered by tier', () => {
  const { rankByTrust } = run({ wotKeys: ['b'] });
  const items = [cand('stranger'), cand('b'), cand('mine')];
  const out = rankByTrust(items, [cand('mine')]);
  assert.deepEqual(out.map((c) => c.pubkey), ['mine', 'b', 'stranger']);
});

test('the sort is stable within a tier', () => {
  // Equal tiers must keep the order the index returned. An unstable sort would
  // reshuffle six identical-looking strangers on every keystroke.
  const { rankByTrust } = run({ wotKeys: ['x'] });
  const items = [cand('s1'), cand('s2'), cand('s3'), cand('x')];
  const out = rankByTrust(items, []);
  assert.deepEqual(out.map((c) => c.pubkey), ['x', 's1', 's2', 's3']);
});

// ---- failing open ------------------------------------------------------------------

test('A COLD SET CHANGES NOTHING', () => {
  // Building the set reads a kind:3 per follow, which is not something to start
  // from a keystroke. With no warm set the order must be left exactly as it was:
  // a mark on every row says nothing, and a wrong one says something false.
  const { rankByTrust } = run({ wotKeys: null });
  const items = [cand('a'), cand('b'), cand('c')];
  const out = rankByTrust(items, []);
  assert.deepEqual(out.map((c) => c.pubkey), ['a', 'b', 'c'], 'a cold set reordered results');
  assert.deepEqual(out.map((c) => c.tier), [0, 0, 0], 'a cold set marked rows');
});

test('an empty set is treated as cold, not as "nobody is trusted"', () => {
  const { rankByTrust } = run({ wotKeys: [] });
  const out = rankByTrust([cand('a'), cand('b')], []);
  assert.deepEqual(out.map((c) => c.tier), [0, 0]);
});

test('a set built for another account is not used', () => {
  // Switching accounts must not rank against the previous account's circle.
  const { rankByTrust } = run({ wotKeys: ['b'], activePubkey: 'me', wotPubkey: 'someone-else' });
  const out = rankByTrust([cand('a'), cand('b')], []);
  assert.deepEqual(out.map((c) => c.tier), [0, 0], 'a stale set ranked the results');
});

test('follows still lead when the set is cold', () => {
  // The merge already puts follow matches first; ranking must not undo that.
  const { rankByTrust } = run({ wotKeys: null });
  const out = rankByTrust([cand('mine'), cand('stranger')], [cand('mine')]);
  assert.equal(out[0].pubkey, 'mine');
  assert.equal(out[0].tier, 2, 'a follow is not recognised without a warm set');
});

// ---- what it renders ----------------------------------------------------------------

test('the mark is only ever a positive claim', () => {
  // Tier 0 gets nothing. Absence of a vouch is not evidence, and labelling it
  // would read as an accusation the panel cannot support.
  const fn = stripComments(lift('function renderSearchResults('));
  assert.match(fn, /c\.tier === 2/, 'no follow mark');
  assert.match(fn, /c\.tier === 1/, 'no network mark');
  assert.doesNotMatch(fn, /tier === 0|Unknown|Unverified|Suspicious/, 'the panel labels strangers');
});

test('RANKED, NOT FILTERED', () => {
  // An impersonator is not the only reason a stranger appears in a name search.
  // Dropping results would make honest ones unreachable — the bell groups rather
  // than hides for the same reason.
  const fn = stripComments(lift('function rankByTrust('));
  assert.doesNotMatch(fn, /\.filter\(/, 'ranking discards results');
  const { rankByTrust } = run({ wotKeys: ['b'] });
  assert.equal(rankByTrust([cand('a'), cand('b'), cand('c')], []).length, 3, 'a result was dropped');
});

test('the mark keeps its size and the name truncates', () => {
  // CLAUDE.md: the inline slot holds its metrics and the content beside it does the
  // shrinking. Here the mark is the whole point of the row — it is what separates
  // six identical names — so it must not be what collapses.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const mark = css.match(/^\.ac-item-trust \{[^}]*\}/m)[0];
  assert.match(mark, /flex-shrink:\s*0/, 'the trust mark can shrink');
  assert.match(css, /^\.ac-item-name \{[^}]*min-width:\s*0/m, 'the name cannot shrink to ellipsize');
});
