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
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');

// The real replyKind, with the real replyTags behind it.
const coreCtx = vm.createContext({});
vm.runInContext('const WEB_COMMENT_KIND = 1111;\n' + (function () {
  const at = core.indexOf('function replyTags(');
  let depth = 0; let end = -1;
  for (let i = core.indexOf('{', at); i < core.length; i++) {
    if (core[i] === '{') depth++; else if (core[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  return core.slice(at, end);
})() + '\n' + (function () {
  const at = core.indexOf('function replyKind(');
  let depth = 0; let end = -1;
  for (let i = core.indexOf('{', at); i < core.length; i++) {
    if (core[i] === '{') depth++; else if (core[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  return core.slice(at, end);
})() + '\nthis.replyKind = replyKind;', coreCtx);
const replyKind = (target) => coreCtx.replyKind(target);

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
    devBuild: false, devOn: { kind: false }, devKind: 0,
    editorApi: { editor },
    document: {
      getElementById: (id) => (id === 'compose-reply-target' ? box : null),
      querySelector: () => (box.children[0] && box.children[0].children && box.children[0].children[1]) || null,
    },
    $: (id) => (id === 'compose-post' ? post : null),
    t: (s, v) => (v ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k]) : s), h,
    paintDevControls() {}, applyAvatar() {},
    composer: { renderNoteText() {} }, SC: { makeMediaExpandable() {}, pollDraftIsPostable: () => true, replyKind },
    fetchPreviewProfile: () => new Promise(() => {}),
    Date,
  }, over));
  vm.runInContext(lift(compose, 'function paintPostButton(') + '\n' + lift(compose, 'function paintReplyKind(') + '\n' + lift(compose, 'function paintReplyTarget(') + '\nthis.paintPostButton = paintPostButton; this.paintReplyTarget = paintReplyTarget; this.paintReplyKind = paintReplyKind;', ctx);
  return { ctx, post, box, editor };
}
const NOTE = { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), kind: 1, content: 'hi', tags: [] };

test('the tab says Reply, labels the quote and asks for a reply when answering a note', () => {
  const t = tabCtx({ replyTo: NOTE, replyId: NOTE.id });
  t.ctx.paintReplyTarget();
  assert.equal(t.post.textContent, 'Reply');
  assert.equal(t.editor.dataset.placeholder, 'Write your reply…');
  assert.equal(t.box.classes.has('hidden'), false);
  assert.equal(t.box.children[0].children[0].textContent, 'Replying to', 'the first thing in the quote block says what it is');
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
    replyTo, h, t: (s, v) => (v ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k]) : s),
    isDevBuild: () => false, devKindEnabled: false, devKind: 0, window: { SidecarCore: { replyKind } },
    cachedProfile: () => ({ picture: 'x' }), avatarEl: () => el('span'), notifAuthorName: () => 'Bob',
    getProfile: () => Promise.resolve({}), applyAvatar() {}, renderNoteText() {}, makeMediaExpandable() {},
    requestAnimationFrame() {},
  });
  vm.runInContext('let replyKindEl = null;\n' + lift(panel, 'function paintReplyKind(') + '\n' + lift(panel, 'function buildReplyBlock(') + '\nthis.f = buildReplyBlock; this.kindText = () => replyKindEl.textContent;', ctx);
  const block = ctx.f();
  assert.equal(block.children[0].children[0].textContent, 'Replying to');
  assert.ok(block.children[0].classes.has('reply-target-label'));
  assert.ok(block.children[1].classes.has('reply-target-who'), 'the author row follows the label');
  assert.equal(ctx.kindText(), 'kind 1', 'a reply to a note goes out as kind 1');
});

test('the panel button says Reply for a reply and Post for a note', () => {
  const body = lift(panel, 'function openComposer(');
  assert.match(body, /textContent: replyTo \? t\('Reply'\) : t\('Post'\)/);
  assert.match(body, /post\.textContent = replyTo \? t\('Reply'\) : t\('Post'\)/, 'the edit-after-repeat reset must keep the label');
});

// ---- which kind the reply goes out as ------------------------------------------------

test('replyKind: 1 for a note, 1111 under a comment, asked of the real replyTags', () => {
  assert.equal(replyKind(NOTE), 1);
  assert.equal(replyKind(Object.assign({}, NOTE, { kind: 1111, tags: [['E', 'c'.repeat(64)], ['K', '1'], ['P', 'd'.repeat(64)]] })), 1111);
  assert.equal(replyKind(null), null);
});

test('the tab shows the kind beside the label, and a comment says 1111', () => {
  const note = tabCtx({ replyTo: NOTE, replyId: NOTE.id });
  note.ctx.paintReplyTarget();
  assert.equal(note.box.children[0].children[1].textContent, 'kind 1');
  const comment = Object.assign({}, NOTE, { kind: 1111, tags: [['E', 'c'.repeat(64)], ['K', '1'], ['P', 'd'.repeat(64)]] });
  const c = tabCtx({ replyTo: comment, replyId: comment.id });
  c.ctx.paintReplyTarget();
  assert.equal(c.box.children[0].children[1].textContent, 'kind 1111');
});

test('the dev kind selector repaints the label, so it never names a kind that will not go out', () => {
  const t = tabCtx({ replyTo: NOTE, replyId: NOTE.id });
  t.ctx.paintReplyTarget();
  assert.equal(t.box.children[0].children[1].textContent, 'kind 1');
  t.ctx.devBuild = true; t.ctx.devOn = { kind: true }; t.ctx.devKind = 1111;
  t.ctx.paintReplyKind();
  assert.equal(t.box.children[0].children[1].textContent, 'kind 1111');
  t.ctx.devKind = 0;
  t.ctx.paintReplyKind();
  assert.equal(t.box.children[0].children[1].textContent, 'kind 1', 'Automatic goes back to the inherited kind');
});

test('both dev kind selectors repaint the label when the choice changes', () => {
  const strip = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(strip(compose), /devKind = Number\(select\.value\); paint\(\); paintReplyKind\(\);/);
  assert.match(strip(panel), /devKind = Number\(select\.value\); paint\(\); paintReplyKind\(\);/);
});
