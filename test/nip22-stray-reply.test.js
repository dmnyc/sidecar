'use strict';

// A kind 1 answering a kind 1111 comment is outside the comment's NIP-22 thread. It still
// notifies, since it names you, but as a reply to your comment, not to a note. Lifted
// from sidepanel.js and run, with an unresolved parent keeping the ordinary label.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(decl) {
  const at = panel.indexOf(decl);
  assert.ok(at > -1, decl + ' is gone from sidepanel.js');
  const open = panel.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < panel.length; i++) {
    if (panel[i] === '{') depth++;
    else if (panel[i] === '}' && --depth === 0) return panel.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

const ME = 'a'.repeat(64);
const THEM = 'b'.repeat(64);
const MINE = '1'.repeat(64);
const NOTE = '2'.repeat(64);

function load() {
  const c = { _ownCommentIds: new Map(), _noteCache: new Map(), WEB_COMMENT_KIND: 1111 };
  vm.createContext(c);
  vm.runInContext(lift('function strayReplyToOwnComment(ev, acctPubkey)') +
    '\nthis.stray = strayReplyToOwnComment;', c);
  return c;
}
const kind1 = (tags) => ({ kind: 1, pubkey: THEM, tags });

test('a kind 1 answering one of your comments is a reply to your comment', () => {
  const c = load();
  c._ownCommentIds.set(ME, new Set([MINE]));
  assert.equal(c.stray(kind1([['e', NOTE, '', 'root'], ['e', MINE, '', 'reply'], ['p', ME]]), ME), true);
  // A lone root marker is the parent too.
  assert.equal(c.stray(kind1([['e', MINE, '', 'root'], ['p', ME]]), ME), true);
  // So is the last positional e tag, in the legacy shape.
  assert.equal(c.stray(kind1([['e', NOTE], ['e', MINE], ['p', ME]]), ME), true);
});

test('the cached parent decides when it is known, and the k tag when it is not', () => {
  const c = load();
  c._noteCache.set(MINE, { kind: 1111, pubkey: ME });
  c._noteCache.set(NOTE, { kind: 1, pubkey: ME });
  assert.equal(c.stray(kind1([['e', MINE, '', 'reply']]), ME), true);
  assert.equal(c.stray(kind1([['e', NOTE, '', 'reply']]), ME), false, 'a reply to your note');
  const unknown = '3'.repeat(64);
  assert.equal(c.stray(kind1([['e', unknown, '', 'reply', ME], ['k', '1111']]), ME), true);
  assert.equal(c.stray(kind1([['e', unknown, '', 'reply', THEM], ['k', '1111']]), ME), false, 'someone else’s comment');
});

test('nothing resolved, a mention, or a comment itself keeps the ordinary label', () => {
  const c = load();
  c._ownCommentIds.set(ME, new Set([MINE]));
  assert.equal(c.stray(kind1([['e', '4'.repeat(64), '', 'reply']]), ME), false);
  assert.equal(c.stray(kind1([['e', MINE, '', 'mention']]), ME), false);
  assert.equal(c.stray({ kind: 1111, pubkey: THEM, tags: [['e', MINE]] }, ME), false);
});

test('the label uses it, and both composers record the comments you post', () => {
  const label = lift('function notifLabel(ev, acctPubkey)');
  assert.match(label, /if \(strayReplyToOwnComment\(ev, acctPubkey\)\) return \{ icon: 'message-filled', text: t\('replied to your comment'\) \};/);
  assert.match(panel, /else if \(signed\.kind === WEB_COMMENT_KIND\) rememberOwnComment\(signed\.pubkey, signed\.id\);/);
  assert.match(panel, /if \(msg\.kind === WEB_COMMENT_KIND\) rememberOwnComment\(msg\.pubkey, msg\.id\);/);
  const tab = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');
  assert.match(tab, /event: 'notePublished', pubkey: signed\.pubkey, id: signed\.id, kind: signed\.kind,/);
});
