'use strict';

// Two things every note and reply publishes, run from composer-core.js itself:
//
// A REPLY TO ANYTHING BUT A NOTE IS A COMMENT (NIP-22). A reply to an article or a recipe went
// out as a kind 1 note in a thread nobody reads that way, so Zap Cooking's comments under a
// recipe never showed it. editor-matrix's lab (reply-article) found it.
//
// A HASHTAG IS A t TAG (NIP-24). #nostr in a note published no tag, so no hashtag search found
// the note. The lab's note-hashtag found it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const core = fs.readFileSync(path.join(__dirname, '..', 'composer-core.js'), 'utf8');
function lift(decl) {
  const at = core.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = core.indexOf('{', core.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < core.length; i++) {
    if (core[i] === '{') depth++;
    else if (core[i] === '}' && --depth === 0) return core.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(['const WEB_COMMENT_KIND = 1111;', lift('function replyTags('), lift('function replyKind('), lift('function hashtagTags('),
  'this.replyTags = replyTags; this.replyKind = replyKind; this.hashtagTags = hashtagTags;'].join('\n'), ctx);
const plain = (x) => JSON.parse(JSON.stringify(x));

const ME = 'a'.repeat(64);
const BEA = 'b'.repeat(64);
const CAL = 'c'.repeat(64);

test('A REPLY TO AN ARTICLE OR A RECIPE IS A COMMENT, NAMING IT BY ADDRESS AND BY ID', () => {
  const article = { id: '1'.repeat(64), pubkey: BEA, kind: 30023, tags: [['d', 'pumpkin-bread'], ['title', 'Pumpkin Bread']] };
  const r = plain(ctx.replyTags(article, ME));
  assert.equal(r.kind, 1111);
  assert.deepEqual(r.tags, [
    ['A', `30023:${BEA}:pumpkin-bread`], ['E', article.id, '', BEA], ['K', '30023'], ['P', BEA],
    ['a', `30023:${BEA}:pumpkin-bread`], ['e', article.id, '', BEA], ['k', '30023'], ['p', BEA],
  ]);
  assert.equal(ctx.replyKind(article), 1111, 'the label says what is published');
});

test('a comment on something that is not addressable has no address', () => {
  const picture = { id: '2'.repeat(64), pubkey: BEA, kind: 20, tags: [['p', CAL]] };
  const r = plain(ctx.replyTags(picture, ME));
  assert.equal(r.kind, 1111);
  assert.ok(!r.tags.some((t) => t[0] === 'A' || t[0] === 'a'));
  assert.deepEqual(r.tags.filter((t) => t[0] === 'K' || t[0] === 'k'), [['K', '20'], ['k', '20']]);
  assert.deepEqual(r.tags.filter((t) => t[0] === 'p'), [['p', BEA], ['p', CAL]], 'everyone already in it is notified');
});

test('a reply to a note is still a note, and so is one to an event that names no kind', () => {
  const note = { id: '3'.repeat(64), pubkey: BEA, kind: 1, tags: [] };
  assert.deepEqual(plain(ctx.replyTags(note, ME)), { kind: 1, tags: [['e', note.id, '', 'root'], ['p', BEA]] });
  const old = { id: '4'.repeat(64), pubkey: BEA, tags: [] };
  assert.equal(ctx.replyTags(old, ME).kind, 1, 'a target saved before kinds were kept is a note, as it always was');
});

test('a reply to a comment keeps the comment\'s scope', () => {
  const comment = { id: '5'.repeat(64), pubkey: CAL, kind: 1111, tags: [['A', `30023:${BEA}:x`], ['K', '30023'], ['P', BEA], ['e', '1'.repeat(64)], ['k', '30023'], ['p', BEA]] };
  const r = plain(ctx.replyTags(comment, ME));
  assert.equal(r.kind, 1111);
  assert.ok(r.tags.some((t) => t[0] === 'A' && t[1] === `30023:${BEA}:x`));
  assert.ok(r.tags.some((t) => t[0] === 'k' && t[1] === '1111'));
});

test('A HASHTAG IS A t TAG: LOWERCASE, ONCE, IN THE ORDER WRITTEN', () => {
  assert.deepEqual(plain(ctx.hashtagTags('Testing the #EditorLab and #nostr, #Nostr again')), [['t', 'editorlab'], ['t', 'nostr']]);
  assert.deepEqual(plain(ctx.hashtagTags('#Café au lait #日本 #zap_cooking')), [['t', 'café'], ['t', '日本'], ['t', 'zap_cooking']]);
  assert.deepEqual(plain(ctx.hashtagTags('A tag at the end: #done.')), [['t', 'done']]);
  assert.deepEqual(plain(ctx.hashtagTags('trailing #dash- here')), [['t', 'dash']]);
});

test('a # that is not a hashtag publishes no tag', () => {
  assert.deepEqual(plain(ctx.hashtagTags('See https://example.com/page#section and wss://relay.example/#x')), []);
  assert.deepEqual(plain(ctx.hashtagTags('my #1 fan and issue#42 and C#')), []);
  assert.deepEqual(plain(ctx.hashtagTags('code `#notatag` and\n```\n#also not\n```')), []);
  assert.deepEqual(plain(ctx.hashtagTags('AT&T#x and a/#b')), []);
});
