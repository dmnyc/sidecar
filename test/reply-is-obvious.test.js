'use strict';

// A reply used to look like a new note: the expanded tab put an unlabeled quote above an
// editor that said "What's on your mind?" and a button that said "Post". These run the
// real painters and check that a reply says so in the label, the placeholder and the
// button, and that a tab which lost its target still says "Post".

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const compose = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(src, decl) {
  const at = src.indexOf(decl);
  assert.ok(at !== -1, decl + ' is gone');
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

const el = (tag) => {
  const e = { tag, children: [], classes: new Set(), dataset: {}, textContent: '', _kids: [] };
  e.classList = { add: (c) => e.classes.add(c), remove: (c) => e.classes.delete(c), contains: (c) => e.classes.has(c), toggle: (c, on) => (on ? e.classes.add(c) : e.classes.delete(c)) };
  e.append = (...k) => { e.children.push(...k); };
  e.addEventListener = () => {};
  e.isConnected = true;
  Object.defineProperty(e, 'innerHTML', { get: () => '', set: () => { e.children = []; } });
  return e;
};
const h = (tag, props, kids) => { const e = el(tag); Object.assign(e, props || {}); if (props && props.className) props.className.split(' ').forEach((c) => e.classes.add(c)); if (kids) e.append(...kids); return e; };

function tabCtx(over) {
  const post = el('button');
  const box = el('div'); box.classes.add('hidden');
  const editor = el('div');
  const ctx = vm.createContext(Object.assign({
    replyTo: null, replyId: null, dkey: 'slot', mining: false, state: { locked: false }, repeatAsked: null,
    posting: false, repeatHoldUntil: 0, draft: { text: 'hello', media: [], poll: null },
    editorApi: { editor },
    document: { getElementById: (id) => (id === 'compose-reply-target' ? box : null) },
    $: (id) => (id === 'compose-post' ? post : null),
    t: (s) => s, h,
    paintDevControls() {}, applyAvatar() {},
    composer: { renderNoteText() {} }, SC: { makeMediaExpandable() {}, pollDraftIsPostable: () => true },
    fetchPreviewProfile: () => new Promise(() => {}),
    Date,
  }, over));
  vm.runInContext(lift(compose, 'function paintPostButton(') + '\n' + lift(compose, 'function paintReplyTarget(') + '\nthis.paintPostButton = paintPostButton; this.paintReplyTarget = paintReplyTarget;', ctx);
  return { ctx, post, box, editor };
}
const NOTE = { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), kind: 1, content: 'hi', tags: [] };

test('the tab says Reply, labels the quote and asks for a reply when answering a note', () => {
  const t = tabCtx({ replyTo: NOTE, replyId: NOTE.id });
  t.ctx.paintReplyTarget();
  assert.equal(t.post.textContent, 'Reply');
  assert.equal(t.editor.dataset.placeholder, 'Write your reply…');
  assert.equal(t.box.classes.has('hidden'), false);
  assert.equal(t.box.children[0].textContent, 'Replying to', 'the first thing in the quote block says what it is');
  assert.ok(t.box.children[0].classes.has('reply-target-label'));
});

test('a new note keeps Post and the usual placeholder, with no label', () => {
  const t = tabCtx({});
  t.ctx.paintReplyTarget();
  assert.equal(t.post.textContent, 'Post');
  assert.equal(t.editor.dataset.placeholder, 'What’s on your mind?');
  assert.equal(t.box.classes.has('hidden'), true);
});

test('a tab that lost its target still says Post, because that is what it will do', () => {
  const t = tabCtx({ replyTo: null, replyId: NOTE.id });
  t.ctx.paintReplyTarget();
  assert.equal(t.post.textContent, 'Post');
  assert.equal(t.box.children.some((c) => c.classes.has('reply-target-label')), false, 'no "Replying to" over a note that is not a reply');
});

test('the repeat question outranks the Reply label', () => {
  const t = tabCtx({ replyTo: NOTE, replyId: NOTE.id, repeatAsked: { at: 1 } });
  t.ctx.paintPostButton();
  assert.equal(t.post.textContent, 'Post it again?');
});

test('the panel composer labels the quote it is answering', () => {
  const replyTo = Object.assign({}, NOTE, { content: 'a short note' });
  const ctx = vm.createContext({
    replyTo, h, t: (s) => s,
    cachedProfile: () => ({ picture: 'x' }), avatarEl: () => el('span'), notifAuthorName: () => 'Bob',
    getProfile: () => Promise.resolve({}), applyAvatar() {}, renderNoteText() {}, makeMediaExpandable() {},
    requestAnimationFrame() {},
  });
  vm.runInContext(lift(panel, 'function buildReplyBlock(') + '\nthis.f = buildReplyBlock;', ctx);
  const block = ctx.f();
  assert.equal(block.children[0].textContent, 'Replying to');
  assert.ok(block.children[0].classes.has('reply-target-label'));
  assert.ok(block.children[1].classes.has('reply-target-who'), 'the author row follows the label');
});

test('the panel button says Reply for a reply and Post for a note', () => {
  const body = lift(panel, 'function openComposer(');
  assert.match(body, /textContent: replyTo \? t\('Reply'\) : t\('Post'\)/);
  assert.match(body, /post\.textContent = replyTo \? t\('Reply'\) : t\('Post'\)/, 'the edit-after-repeat reset must keep the label');
});
