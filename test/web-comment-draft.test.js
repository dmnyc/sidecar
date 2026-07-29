'use strict';

// Unit coverage for the web-comment draft store in sidepanel.js.
//
// The bug: clicking the overlay dismisses the comment modal, and the half-written
// comment went with it. Nothing was saved, so a stray click outside a narrow panel
// meant retyping. Saving is now done on every keystroke rather than at teardown —
// the overlay path never goes through Cancel, so anything deferred to close is
// exactly what gets lost.
//
// Scope is deliberately narrower than the note composer's drafts: memory only, no
// chrome.storage. A comment belongs to a page you're looking at, so it only has to
// survive reopening the modal while that URL is still around. Persisting it would
// mean writing text about someone's browsing to disk.

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

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const URL_1 = 'https://example.com/one';
const URL_2 = 'https://example.com/two';

function harness() {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/const webCommentDrafts = new Map\(\);/, 'webCommentDrafts') + '\n' +
    lift(/const WEB_COMMENT_DRAFT_MAX = \d+;[^\n]*/, 'WEB_COMMENT_DRAFT_MAX') + '\n' +
    lift(/const webCommentDraftKey = [^\n]+/, 'webCommentDraftKey') + '\n' +
    lift(/function saveWebCommentDraft\(pubkey, url, text\)\s*\{[\s\S]*?\n  \}/, 'saveWebCommentDraft') + '\n' +
    'globalThis.save = saveWebCommentDraft;' +
    'globalThis.key = webCommentDraftKey;' +
    'globalThis.drafts = webCommentDrafts;' +
    'globalThis.MAX = WEB_COMMENT_DRAFT_MAX;',
    ctx
  );
  const get = (pk, url) => ctx.drafts.get(ctx.key(pk, url));
  return { ctx, save: ctx.save, get, size: () => ctx.drafts.size };
}

// ---- the reported bug ----------------------------------------------------------

test('a draft survives to be read back for the same page', () => {
  const h = harness();
  h.save(PK_A, URL_1, 'half a thought');
  assert.equal(h.get(PK_A, URL_1), 'half a thought');
});

test('each URL keeps its own draft', () => {
  const h = harness();
  h.save(PK_A, URL_1, 'about page one');
  h.save(PK_A, URL_2, 'about page two');
  assert.equal(h.get(PK_A, URL_1), 'about page one');
  assert.equal(h.get(PK_A, URL_2), 'about page two');
});

test('a draft is scoped to the account that wrote it', () => {
  // The note composer scopes drafts per account; finding someone else's half-written
  // comment waiting in your editor would be a surprise.
  const h = harness();
  h.save(PK_A, URL_1, 'written as A');
  assert.equal(h.get(PK_B, URL_1), undefined);
});

test('the key cannot collide across a pubkey/url boundary', () => {
  // Concatenation with a separator that cannot appear in either half. A naive
  // pubkey+url join would let one pair impersonate another.
  const h = harness();
  assert.notEqual(h.ctx.key(PK_A, URL_1), h.ctx.key(PK_A + URL_1, ''));
  assert.ok(h.ctx.key(PK_A, URL_1).includes('\n'));
});

// ---- clearing -----------------------------------------------------------------

test('empty text removes the entry instead of storing a blank', () => {
  const h = harness();
  h.save(PK_A, URL_1, 'typed then deleted');
  h.save(PK_A, URL_1, '');
  assert.equal(h.get(PK_A, URL_1), undefined);
  assert.equal(h.size(), 0, 'a blank entry would still count against the cap');
});

test('whitespace-only text counts as empty', () => {
  const h = harness();
  h.save(PK_A, URL_1, 'real');
  for (const blank of ['   ', '\n\n', '\t', ' \n ']) {
    h.save(PK_A, URL_1, blank);
    assert.equal(h.get(PK_A, URL_1), undefined, JSON.stringify(blank));
    h.save(PK_A, URL_1, 'real');
  }
});

test('leading and trailing whitespace is preserved in a real draft', () => {
  // Only *emptiness* is trimmed for the decision — the stored text is verbatim, since
  // trimming it would move the caret on restore.
  const h = harness();
  h.save(PK_A, URL_1, '  indented thought\n');
  assert.equal(h.get(PK_A, URL_1), '  indented thought\n');
});

// ---- no target yet ------------------------------------------------------------

test('nothing is stored before a target URL is known', () => {
  // The target resolves asynchronously after the modal opens, so onChange can fire
  // with url still null. Storing under null would make one bucket shared by every
  // page — the next page opened would inherit the wrong draft.
  const h = harness();
  for (const noTarget of [null, undefined, '']) {
    h.save(PK_A, noTarget, 'typed before the tab resolved');
  }
  assert.equal(h.size(), 0);
});

// ---- the cap ------------------------------------------------------------------

test('abandoned drafts do not accumulate without bound', () => {
  const h = harness();
  for (let i = 0; i < h.ctx.MAX + 12; i++) h.save(PK_A, 'https://example.com/p' + i, 'draft ' + i);
  assert.equal(h.size(), h.ctx.MAX);
});

test('the cap evicts the least recently written, keeping the newest', () => {
  const h = harness();
  for (let i = 0; i < h.ctx.MAX; i++) h.save(PK_A, 'https://example.com/p' + i, 'draft ' + i);
  h.save(PK_A, 'https://example.com/NEW', 'the one being typed');
  assert.equal(h.get(PK_A, 'https://example.com/p0'), undefined, 'oldest should go');
  assert.equal(h.get(PK_A, 'https://example.com/NEW'), 'the one being typed',
    'the draft in front of the user must never be the one evicted');
  assert.equal(h.size(), h.ctx.MAX);
});

test('editing an existing draft refreshes its position, not just its text', () => {
  // Without the delete-then-set, a long-lived draft the user keeps returning to would
  // stay at its original insertion point and be evicted while still in active use.
  const h = harness();
  for (let i = 0; i < h.ctx.MAX; i++) h.save(PK_A, 'https://example.com/p' + i, 'draft ' + i);
  h.save(PK_A, 'https://example.com/p0', 'still working on this one'); // touch the oldest
  h.save(PK_A, 'https://example.com/NEW', 'newest');
  assert.equal(h.get(PK_A, 'https://example.com/p0'), 'still working on this one',
    'a touched draft should no longer be the eviction candidate');
  assert.equal(h.get(PK_A, 'https://example.com/p1'), undefined, 'p1 is now the oldest');
});

// ---- not persisted ------------------------------------------------------------

test('drafts are held in memory, never written to storage', () => {
  // Structural: the whole point of the narrower scope. If this ever moves to
  // chrome.storage it becomes a record of pages visited, sitting on disk.
  const block = source.match(
    /const webCommentDrafts = new Map\(\);[\s\S]*?\n  function webCommentModal\(\)/
  );
  assert.ok(block, 'could not isolate the draft store');
  assert.ok(!/chrome\.storage/.test(block[0]),
    'comment drafts must not be persisted to disk');
});
