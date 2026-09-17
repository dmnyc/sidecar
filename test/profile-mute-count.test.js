'use strict';

// The mute count beside the follow count on the Profile tab.
//
// Two things this file is really about. It counts PEOPLE, because "following" counts
// people and a pair of numbers side by side is read as comparable whether or not it is:
// an account following 200 and muting 3 words would otherwise show "200 / 3" with the 3
// meaning something else entirely. And the refresh button reaches it, because that button
// already exists to fix exactly this class of staleness and a stat it does not refresh is
// worse than no button at all.

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
  const open = source.indexOf('{', source.indexOf('(', at));
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// A mute set in the shape collectMuteTags builds, and the two elements the painter writes.
function el() {
  const node = { textContent: '', attrs: {}, classes: new Set(), dataset: {} };
  node.removeAttribute = (k) => { delete node.attrs[k]; };
  // setWaiting shimmers the number while it is unknown and clears that when it lands, so
  // the stub has to carry a classList and a dataset for it to write to.
  node.classList = {
    toggle: (c, on) => (on ? node.classes.add(c) : node.classes.delete(c)),
    contains: (c) => node.classes.has(c),
  };
  Object.defineProperty(node, 'title', {
    get() { return node.attrs.title; },
    set(v) { node.attrs.title = v; },
  });
  return node;
}

function painter(muteSet) {
  const ctx = {
    loadMuteList: async () => muteSet,
    readRelayUrls: async () => ['wss://one'],
  };
  vm.createContext(ctx);
  // The real setWaiting, lifted rather than stubbed: whether the number stops shimmering
  // when it lands is part of what this painter is responsible for.
  vm.runInContext(
    lift('function setWaiting(') + '\n' +
      lift('async function paintMuteCount(') + '\nglobalThis.out = paintMuteCount;',
    ctx
  );
  return ctx.out;
}

const set = (o) => ({
  pubkeys: new Set(o.pubkeys || []),
  hashtags: new Set(o.hashtags || []),
  words: o.words || [],
  threads: new Set(o.threads || []),
});

test('IT COUNTS PEOPLE, LIKE THE NUMBER BESIDE IT', async () => {
  const num = el(), label = el();
  await painter(set({ pubkeys: ['a', 'b', 'c'], hashtags: ['spam'], words: ['airdrop', 'giveaway'] }))('me', num, label);
  assert.equal(num.textContent, '3', 'the headline counts entries rather than people');
});

test('the rest of the list is in the tooltip, not thrown away', async () => {
  const num = el(), label = el();
  await painter(set({ pubkeys: ['a'], hashtags: ['spam'], words: ['airdrop', 'giveaway'], threads: ['t1'] }))('me', num, label);
  assert.match(label.title, /1 hashtag\b/, 'hashtags are not reported');
  assert.match(label.title, /2 words/, 'words are not reported');
  assert.match(label.title, /1 thread\b/, 'threads are not reported');
  assert.match(label.title, /Only people are counted here/, 'the tooltip does not say what the number means');
});

test('a list of people only gets no tooltip', async () => {
  const num = el(), label = el();
  await painter(set({ pubkeys: ['a', 'b'] }))('me', num, label);
  assert.equal(num.textContent, '2');
  assert.equal(label.title, undefined, 'an empty "also muted" line is being shown');
});

test('an empty mute list is zero, not a dash', async () => {
  // A dash means "could not tell". Nobody muted is a fact and reads as one.
  const num = el(), label = el();
  await painter(set({}))('me', num, label);
  assert.equal(num.textContent, '0');
});

test('relays that say nothing leave a dash rather than a wrong zero', async () => {
  const num = el(), label = el();
  const ctx = { loadMuteList: async () => { throw new Error('no relays'); }, readRelayUrls: async () => [] };
  vm.createContext(ctx);
  vm.runInContext(
    lift('function setWaiting(') + '\n' +
      lift('async function paintMuteCount(') + '\nglobalThis.out = paintMuteCount;',
    ctx
  );
  await ctx.out('me', num, label);
  assert.equal(num.textContent, '—', 'a failed fetch reports zero muted, which is a lie');
  assert.equal(num.classList.contains('t-shimmer'), false, 'a dash is an answer and must stop sweeping');
});

test('thousands are grouped, like the follow count', async () => {
  const num = el(), label = el();
  await painter(set({ pubkeys: Array.from({ length: 1234 }, (_, i) => 'p' + i) }))('me', num, label);
  assert.equal(num.textContent, '1,234');
});

// ---- the surfaces -------------------------------------------------------------------------

test('the stat sits beside the follow count and is painted', () => {
  const src = stripComments(source);
  assert.match(src, /h\('span', \{ className: 'profile-stat' \}, \[muteNum, document\.createTextNode\(' muted'\)\]\)/,
    'the muted stat is gone from the row');
  assert.match(src, /paintMuteCount\(active\.pubkey, muteNum, muteStat\)/, 'nothing fills the number in');
});

test('THE REFRESH BUTTON REACHES IT', () => {
  // loadMuteList caches a PROMISE per account and never expires it, so a mute added in
  // another client stays invisible until something drops that cache. The refresh already
  // drops the profile and follow caches for this reason; leaving the mute list out would
  // make it the one number on the screen the refresh silently does not refresh.
  // Anchored on the PROFILE button's own declaration: `refreshBtn.addEventListener` alone
  // finds the notification sheet's refresh first, which is a different button entirely.
  const decl = source.indexOf("className: 'profile-backup-jump'");
  assert.ok(decl !== -1, 'the profile refresh button moved');
  const at = source.indexOf("refreshBtn.addEventListener('click'", decl);
  assert.ok(at !== -1, 'the refresh handler moved');
  const handler = stripComments(source.slice(at, at + 900));
  assert.match(handler, /_profileCache\.delete\(active\.pubkey\)/, 'the profile cache is no longer dropped');
  assert.match(handler, /followCountCache\.delete\(active\.pubkey\)/, 'the follow cache is no longer dropped');
  assert.match(handler, /_muteListPromises\.delete\(active\.pubkey\)/, 'the mute list survives a refresh');
});

test('the button says what it does', () => {
  const src = stripComments(source);
  assert.match(src, /title: 'Refresh profile, follow and mute counts'/, 'the tooltip still promises only two of three');
});
