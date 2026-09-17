'use strict';

// NIP-22 comments used as replies to a kind:1.
//
// Many clients now answer a note with a kind:1111 rather than a NIP-10 kind:1. The whole
// difficulty is one line of the spec: a comment points at its ROOT with uppercase tags and
// at its PARENT with lowercase ones. Relay tag filters are case-sensitive, so the two are
// different filters, and getting that wrong loses a whole population of replies silently.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const bare = panel.replace(/^\s*\/\/.*$/gm, '');

function lift(decl) {
  const at = panel.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = panel.indexOf('{', panel.indexOf('(', at));
  let depth = 0;
  for (let i = open; i < panel.length; i++) {
    if (panel[i] === '{') depth++;
    else if (panel[i] === '}' && --depth === 0) return panel.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

const MINE = 'a'.repeat(64);
const THEM = 'b'.repeat(64);
const MY_NOTE = 'c'.repeat(64);

// commentRootIsOwn reads a module-level map, so the lift carries a stand-in for it.
function rootChecker(ownIds) {
  const ctx = { _ownNoteIds: new Map([[MINE, new Set(ownIds)]]) };
  vm.createContext(ctx);
  vm.runInContext(lift('function commentRootIsOwn(') + '\nglobalThis.fn = commentRootIsOwn;', ctx);
  return ctx.fn;
}

test('A COMMENT NAMES ITS ROOT IN UPPERCASE AND ITS PARENT IN LOWERCASE', () => {
  const isOwn = rootChecker([MY_NOTE]);

  // A reply to a comment on my note. `p` is the commenter by now, and I appear ONLY in
  // `P`. This is the case the `#p` filter could never see, and the reason the feature
  // looked like it worked: the FIRST reply in any thread arrives fine.
  const deep = { tags: [['E', MY_NOTE, '', MINE], ['K', '1'], ['P', MINE], ['e', 'x'], ['k', '1111'], ['p', THEM]] };
  assert.equal(isOwn(deep, MINE), true, 'a reply below the first level is still in my thread');

  // A client that omits P entirely: matched on the root id against my own notes.
  const noP = { tags: [['E', MY_NOTE], ['K', '1'], ['e', 'x'], ['k', '1111'], ['p', THEM]] };
  assert.equal(isOwn(noP, MINE), true, 'the E route has to cover clients that skip P');

  // Someone else's thread that merely mentions me. Neither route matches, so it stays a
  // mention rather than being promoted to a reply.
  const theirs = { tags: [['E', 'd'.repeat(64), '', THEM], ['K', '1'], ['P', THEM], ['p', MINE]] };
  assert.equal(isOwn(theirs, MINE), false, 'a mention in their thread is not a reply to me');

  // A page comment has no root author at all.
  const web = { tags: [['I', 'https://example.com/x'], ['K', 'web'], ['i', 'https://example.com/x'], ['k', 'web']] };
  assert.equal(isOwn(web, MINE), false);
  assert.equal(isOwn(deep, ''), false, 'no account, no claim');
});

test('a 1111 on your note reads as a reply, not as a mention', () => {
  // The same event two ways depending on which kind the replier's client happened to pick
  // would be a distinction with no meaning to the reader, so it reuses the kind:1 reply's
  // own glyph and wording rather than inventing a third presentation.
  const fn = lift('function notifLabel(');
  const branch = fn.slice(fn.indexOf('WEB_COMMENT_KIND'));
  assert.match(branch, /K\[1\] === '1' && commentRootIsOwn\(ev, acctPubkey\)/, 'the root KIND has to be read, not assumed');
  assert.match(branch, /icon: 'message-filled', text: 'replied to your note'/);
  assert.match(fn, /icon: 'message-filled', text: 'replied to your note'/, 'the kind:1 reply must still say it too');
  assert.match(branch, /glyph: '@', text: 'mentioned you in a comment'/, 'anything else keeps the old wording');

  // The account has to reach the label, or there is nothing to compare a root against.
  assert.match(bare, /function notifLabel\(ev, acctPubkey\)/);
  assert.match(bare, /notifLabel\(ev, a\.pubkey\)/);
});

test('THE FILTER IS ANCHORED ON THE ROOT, BESIDE THE REPOST AND QUOTE ONES', () => {
  // `#p` cannot match `P`, so a second filter is the only way to see past the first reply
  // in a thread. `#E` rather than `#P` because it also catches clients that omit P, which
  // are exactly the ones an uppercase filter would miss.
  assert.match(bare, /const comments = \{ kinds: \[WEB_COMMENT_KIND\], '#E': ownIdList, since: sinceTs \};/);
  const fn = bare.slice(bare.indexOf('function buildFilters('));
  const body = fn.slice(0, fn.indexOf('\n      }'));
  assert.match(body, /list\.push\(limit \? Object\.assign\(\{ limit \}, comments\) : comments\);/);
  // It rides ownIdList, the same set the repost and quote filters use, so it is loaded
  // and capped once rather than three times.
  const guard = body.slice(body.indexOf('if (ownIdList.length)'));
  assert.ok(guard.indexOf("'#E': ownIdList") > -1, 'it must sit inside the ownIdList guard');
});

test('our own comments name the root author, which they never used to', () => {
  // NIP-22: comments MUST point to the authors, P for the root scope. Ours copied the
  // root SCOPE verbatim and dropped the author, so a client watching #P for replies in its
  // own threads could not see ours. The mirror of the bug this branch fixes.
  const fn = lift('function replyTags(');
  const branch = fn.slice(fn.indexOf('target.kind === WEB_COMMENT_KIND'));
  assert.match(branch, /const rootP = tgTags\.find\(\(t\) => t\[0\] === 'P' && t\[1\]\);/);
  assert.match(branch, /if \(rootP\) tags\.push\(rootP\.slice\(\)\);/, 'the root author carries through a reply');
  // Falling back to the E tag's fourth element, which is where the spec also puts it,
  // rather than to the parent's author, who is only the same person at the top level.
  assert.match(branch, /tgTags\.find\(\(t\) => t\[0\] === 'E' && t\[3\]\)/);
  assert.match(branch, /tags\.push\(\['P', rootE\[3\]\]\)/);
});

function commentLabel(tags, account = MINE, cached = []) {
  const ctx = {
    WEB_COMMENT_KIND: 1111, POLL_RESPONSE_KIND: 1018,
    _noteCache: new Map(cached), _ownNoteIds: new Map([[MINE, new Set([MY_NOTE])]]),
  };
  vm.createContext(ctx);
  vm.runInContext(lift('function commentRootIsOwn(') + '\n' + lift('function notifLabel('), ctx);
  return ctx.notifLabel({ kind: 1111, tags }, account);
}

test('direct comments on my note are replies even when someone else owns the thread', () => {
  const label = commentLabel([['K', '1'], ['P', THEM], ['e', MY_NOTE, '', MINE], ['k', '1'], ['p', MINE]]);
  assert.equal(label.text, 'replied to your note');
  assert.equal(label.icon, 'message-filled');
});

test('direct replies to my comment take precedence over ownership of the root note', () => {
  const label = commentLabel([['K', '1'], ['P', MINE], ['e', 'comment'], ['k', '1111'], ['p', MINE]]);
  assert.equal(label.text, 'replied to your comment');
  assert.equal(label.icon, 'message-filled');
});

test('a reply to my comment in someone else’s thread or on a web page is not a mention', () => {
  for (const rootKind of ['1', 'web']) {
    assert.equal(commentLabel([['K', rootKind], ['P', THEM], ['e', 'comment'], ['k', '1111'], ['p', MINE]]).text,
      'replied to your comment');
  }
});

test('an explicit other parent author is not overridden by a mention of me', () => {
  assert.equal(commentLabel([['K', '1'], ['P', THEM], ['e', 'comment', '', THEM], ['k', '1111'], ['p', MINE]]).text,
    'mentioned you in a comment');
});

test('multiple participants alone do not establish who owns the parent', () => {
  assert.equal(commentLabel([['K', '1'], ['P', THEM], ['e', 'comment'], ['k', '1111'], ['p', MINE], ['p', THEM]]).text,
    'mentioned you in a comment');
});

test('a cached parent resolves ownership when p tags contain several participants', () => {
  assert.equal(commentLabel([['K', '1'], ['P', THEM], ['e', 'comment'], ['k', '1111'], ['p', MINE], ['p', THEM]],
    MINE, [['comment', { pubkey: MINE }]]).text, 'replied to your comment');
});

test('a page mention with no event parent keeps its mention label', () => {
  assert.equal(commentLabel([['K', 'web'], ['I', 'https://example.com'], ['k', 'web'], ['p', MINE]]).text,
    'mentioned you in a comment');
});
