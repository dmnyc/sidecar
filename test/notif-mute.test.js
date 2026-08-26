'use strict';

// Unit coverage for what a NIP-51 mute list actually mutes in notifications.
//
// THE REPORT (2026-08-24): muted words and hashtags were not respected in
// notifications, and neither were muted threads.
//
// Cause: loadMuteList collected `p` tags and nothing else, from both the public
// tags and the private encrypted ones, and every consumer asked the resulting Set
// `has(ev.pubkey)`. A kind:10000 written by Amethyst or Jumble routinely carries
// `t` (hashtags), `word` (muted words) and `e` (threads) as well; all three were
// read off the relay, parsed, and then dropped on the floor.
//
// Found while fixing it: the pubkey half was broken for zaps too. A kind:9735
// receipt is authored by the LNURL zap service, not by the person — the panel
// already has zapSender() for exactly this — so muting someone never hid their
// zaps. The comment they typed and the note they zapped are likewise inside the
// embedded zap request, not on the receipt.
//
// FOLLOW-UP (2026-08-25): word mutes now also match the sender's display name,
// because the name is the one part of a notification the sender fully controls
// and the reader sees first — a key-rotating campaign can keep its keyword out
// of note text entirely and still have it announced on every row. Names arrive
// from a separate fetch and often after the event, so the late match is pruned
// (pruneNameMuted) rather than trusted to have been caught on arrival.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  lift(/  const emptyMuteSet = [^\n]*\n/, 'emptyMuteSet')
    + lift(/  function collectMuteTags\(tags, into\) \{[\s\S]*?\n  \}\n/, 'collectMuteTags')
    + lift(/  const MUTE_WORDISH = [\s\S]*?\n  const isWordish = [^\n]*\n/, 'wordish helpers')
    + lift(/  function mutedTermHit\([\s\S]*?\n  \}\n/, 'mutedTermHit')
    + lift(/  function mutedHashtagInText\([\s\S]*?\n  \}\n/, 'mutedHashtagInText')
    + lift(/  function zapSender\(ev\) \{[\s\S]*?\n  \}\n/, 'zapSender')
    + lift(/  function muteSubject\(ev\) \{[\s\S]*?\n  \}\n/, 'muteSubject')
    + lift(/  const _notifProfiles = new Map\(\);[^\n]*\n/, '_notifProfiles')
    + lift(/  function isMutedNotif\(mute, ev\) \{[\s\S]*?\n  \}\n/, 'isMutedNotif')
    + lift(/  function pruneNameMuted\(pubkey\) \{[\s\S]*?\n  \}\n/, 'pruneNameMuted')
    // pruneNameMuted reads the panel's caches and repaint helpers. Function
    // declarations above land on the vm context; the caches and `state` are
    // stand-ins the tests can seed directly.
    + '\nvar state = null;\nvar refreshBell = () => {};\nvar _openNotifBell = null;\n'
    + 'var _notifCache = new Map();\nvar _muteLists = new Map();\n'
    // `const` bindings are lexical and never land on the vm context; the function
    // declarations above do. Hand the rest over explicitly.
    + '\nglobalThis.emptyMuteSet = emptyMuteSet;\nglobalThis.__profiles = _notifProfiles;\n',
  ctx
);

const muteSet = (tags) => ctx.collectMuteTags(tags, ctx.emptyMuteSet());
const note = (over = {}) => Object.assign(
  { id: 'n1', kind: 1, pubkey: 'author', content: '', tags: [] }, over);

// A zap receipt as the LNURL service publishes it: its own pubkey is the service,
// and everything about the zap lives in the embedded request.
const zap = ({ sender = 'zapper', comment = '', reqTags = [] } = {}) => note({
  id: 'z1', kind: 9735, pubkey: 'lnurl-service', content: '',
  tags: [['description', JSON.stringify({ pubkey: sender, content: comment, tags: reqTags })]],
});

test('an empty list mutes nothing', () => {
  const m = muteSet([]);
  assert.equal(m.size, 0);
  assert.equal(ctx.isMutedNotif(m, note({ content: 'anything at all' })), false);
});

test('people are still muted, from public and private entries alike', () => {
  const m = muteSet([['p', 'alice']]);
  ctx.collectMuteTags([['p', 'bob']], m); // the private half merges into the same set
  assert.equal(ctx.isMutedNotif(m, note({ pubkey: 'alice' })), true);
  assert.equal(ctx.isMutedNotif(m, note({ pubkey: 'bob' })), true);
  assert.equal(ctx.isMutedNotif(m, note({ pubkey: 'carol' })), false);
});

test('muted words match the content, case-insensitively', () => {
  const m = muteSet([['word', 'Airdrop']]);
  assert.equal(ctx.isMutedNotif(m, note({ content: 'free AIRDROP today' })), true);
  assert.equal(ctx.isMutedNotif(m, note({ content: 'nothing to see' })), false);
});

test('a one-word mute respects word boundaries', () => {
  const m = muteSet([['word', 'ass']]);
  assert.equal(ctx.isMutedNotif(m, note({ content: 'what a class act' })), false,
    'must not fire inside a longer word');
  assert.equal(ctx.isMutedNotif(m, note({ content: 'do not be an ass.' })), true);
});

test('a phrase or a symbol mutes as a plain substring', () => {
  const phrase = muteSet([['word', 'good morning']]);
  assert.equal(ctx.isMutedNotif(phrase, note({ content: 'GOOD MORNING nostr' })), true);
  const emoji = muteSet([['word', '🔥']]);
  assert.equal(ctx.isMutedNotif(emoji, note({ content: 'this is 🔥🔥' })), true);
});

test('muted hashtags match the t tag', () => {
  const m = muteSet([['t', 'Bitcoin']]);
  assert.equal(ctx.isMutedNotif(m, note({ tags: [['t', 'bitcoin']] })), true);
  assert.equal(ctx.isMutedNotif(m, note({ tags: [['t', 'nostr']] })), false);
});

test('muted hashtags also match one typed into the text with no t tag', () => {
  const m = muteSet([['t', 'bitcoin']]);
  assert.equal(ctx.isMutedNotif(m, note({ content: 'thoughts on #bitcoin today' })), true);
  assert.equal(ctx.isMutedNotif(m, note({ content: 'thoughts on #bitcoiners' })), false,
    'a longer tag is a different tag');
});

test('muted threads match the root, a reply to it, and a quote of it', () => {
  const m = muteSet([['e', 'thread1']]);
  assert.equal(ctx.isMutedNotif(m, note({ id: 'thread1' })), true, 'the thread itself');
  assert.equal(ctx.isMutedNotif(m, note({ tags: [['e', 'thread1']] })), true, 'a reply');
  assert.equal(ctx.isMutedNotif(m, note({ tags: [['q', 'thread1']] })), true, 'a quote');
  assert.equal(ctx.isMutedNotif(m, note({ tags: [['E', 'thread1']] })), true, 'a NIP-22 comment');
  assert.equal(ctx.isMutedNotif(m, note({ tags: [['e', 'other']] })), false);
});

test('muting a person hides their zaps, despite the receipt being the service', () => {
  const m = muteSet([['p', 'zapper']]);
  const z = zap({ sender: 'zapper' });
  assert.notEqual(z.pubkey, 'zapper', 'the receipt is authored by the LNURL service');
  assert.equal(ctx.isMutedNotif(m, z), true);
  assert.equal(ctx.isMutedNotif(m, zap({ sender: 'someone-else' })), false);
});

test('a muted word in a zap comment is caught', () => {
  const m = muteSet([['word', 'airdrop']]);
  assert.equal(ctx.isMutedNotif(m, zap({ comment: 'claim your airdrop' })), true);
  assert.equal(ctx.isMutedNotif(m, zap({ comment: 'nice note' })), false);
});

test('a zap on a muted thread is caught', () => {
  const m = muteSet([['e', 'thread1']]);
  assert.equal(ctx.isMutedNotif(m, zap({ reqTags: [['e', 'thread1']] })), true);
  assert.equal(ctx.isMutedNotif(m, zap({ reqTags: [['e', 'elsewhere']] })), false);
});

test('the four entry kinds are counted, so size gates the fast path', () => {
  const m = muteSet([['p', 'a'], ['t', 'b'], ['word', 'c'], ['e', 'd'], ['unknown', 'x']]);
  assert.equal(m.size, 4);
  assert.equal(m.pubkeys.size, 1);
  assert.equal(m.hashtags.size, 1);
  assert.equal(m.words.length, 1);
  assert.equal(m.threads.size, 1);
});

test('malformed entries are ignored rather than thrown on', () => {
  const m = muteSet([['p'], [], null, ['word', ''], 'nope', ['t', 'ok']]);
  assert.equal(m.size, 1);
  assert.equal(ctx.isMutedNotif(m, note({ tags: [['t', 'ok']] })), true);
});

test('a zap receipt with an unparseable description does not throw', () => {
  const m = muteSet([['word', 'airdrop']]);
  const broken = note({ kind: 9735, pubkey: 'svc', tags: [['description', '{not json']] });
  assert.equal(ctx.isMutedNotif(m, broken), false);
});

// ---- display names ----
//
// The sender's name is what the notification row displays, so a word mute that
// skips it lets a sender put their keyword in the one place every reader looks.
// All fixtures here are synthetic words with no meaning outside this file.

test("a muted word matches the sender's display name, not only the note text", () => {
  const m = muteSet([['word', 'widgeon']]);
  ctx.__profiles.set('author', 'Widgeon Daily');
  assert.equal(ctx.isMutedNotif(m, note({ content: 'thanks for the note!' })), true,
    'the keyword lives in the name, and the row displays the name');
  assert.equal(ctx.isMutedNotif(m, note({ pubkey: 'other', content: 'plain words' })), false);
  ctx.__profiles.delete('author');
  assert.equal(ctx.isMutedNotif(m, note({ content: 'thanks for the note!' })), false,
    'before the profile resolves the arm is blind — the late match is pruneNameMuted\'s job');
});

test('names are matched case-insensitively, like text', () => {
  const m = muteSet([['word', 'widgeon']]);
  ctx.__profiles.set('author', 'WIDGEON daily');
  assert.equal(ctx.isMutedNotif(m, note({ content: 'x' })), true);
  ctx.__profiles.delete('author');
});

test('name matching follows the same word-boundary rule as text', () => {
  const m = muteSet([['word', 'art']]);
  ctx.__profiles.set('a1', 'Cartography Weekly');
  ctx.__profiles.set('a2', 'The Art of Nostr');
  assert.equal(ctx.isMutedNotif(m, note({ pubkey: 'a1', content: 'hi' })), false,
    'mid-word is not a hit');
  assert.equal(ctx.isMutedNotif(m, note({ pubkey: 'a2', content: 'hi' })), true);
  ctx.__profiles.delete('a1');
  ctx.__profiles.delete('a2');
});

test('a name match checks the zapper, not the LNURL service that signed the receipt', () => {
  const m = muteSet([['word', 'widgeon']]);
  ctx.__profiles.set('lnurl-service', 'Widgeon Holdings');
  ctx.__profiles.set('zapper', 'ordinary name');
  assert.equal(ctx.isMutedNotif(m, zap({ sender: 'zapper' })), false,
    'the service bearing the keyword is not the person the row shows');
  ctx.__profiles.set('zapper', 'widgeon fan');
  assert.equal(ctx.isMutedNotif(m, zap({ sender: 'zapper', comment: 'nice one' })), true);
  ctx.__profiles.delete('lnurl-service');
  ctx.__profiles.delete('zapper');
});

// ---- late-arriving names: the prune pass ----

test('a name that resolves after the event prunes it from the cache, the badge and an open bell', () => {
  ctx._muteLists.set('me', muteSet([['word', 'widgeon']]));
  const ev = note({ id: 'late1', content: 'an ordinary greeting' });
  ctx._notifCache.set('me', { events: [ev] });
  ctx.state = { activePubkey: 'me' };
  let bellPaints = 0;
  ctx.refreshBell = () => { bellPaints++; };
  const removed = [];
  const row = { dataset: { notifId: 'late1' }, remove: () => removed.push('late1') };
  ctx._openNotifBell = { pubkey: 'me', list: { querySelectorAll: () => [row] } };

  // Profile not resolved yet: the same event that will be muted shows for now.
  ctx.pruneNameMuted('me');
  assert.equal(ctx._notifCache.get('me').events.length, 1);

  // The fetch lands.
  ctx.__profiles.set('author', 'Widgeon Daily');
  ctx.pruneNameMuted('me');
  assert.equal(ctx._notifCache.get('me').events.length, 0, 'event dropped from the cache');
  assert.deepEqual(removed, ['late1'], 'row pulled from the open bell');
  assert.ok(bellPaints >= 1, 'badge recount requested');

  ctx._muteLists.delete('me');
  ctx._notifCache.delete('me');
  ctx._openNotifBell = null;
  ctx.state = null;
});

test('prune leaves a cache with no word mutes entirely alone', () => {
  ctx._muteLists.set('me', muteSet([['p', 'someone']]));
  ctx._notifCache.set('me', { events: [note({ id: 'x' })] });
  ctx.pruneNameMuted('me');
  assert.equal(ctx._notifCache.get('me').events.length, 1);
  ctx._muteLists.delete('me');
  ctx._notifCache.delete('me');
});
