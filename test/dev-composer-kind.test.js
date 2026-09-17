'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
function lift(name) {
  const start = source.indexOf(name);
  assert.ok(start >= 0);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
}
function setup(dev = true) {
  const ctx = { state: { activePubkey: 'me' }, WEB_COMMENT_KIND: 1111,
    isDevBuild: () => dev, fetchNoteById: async () => ({ pubkey: 'root-author' }) };
  vm.createContext(ctx);
  vm.runInContext(lift('function replyTags(') + '\n' + lift('async function devComposerReply('), ctx);
  return ctx;
}
const note = { id: 'note', pubkey: 'gatsby', kind: 1, tags: [] };
const comment = { id: 'comment', pubkey: 'amelia', kind: 1111,
  tags: [['E', 'note', '', 'gatsby'], ['K', '1'], ['P', 'gatsby'], ['e', 'note'], ['k', '1']] };

test('store builds ignore overrides and retain production reply types', async () => {
  const ctx = setup(false);
  assert.equal((await ctx.devComposerReply(note, 1111)).kind, 1);
  assert.equal((await ctx.devComposerReply(comment, 1)).kind, 1111);
  assert.equal(await ctx.devComposerReply(null, 1111), null);
});

test('automatic retains normal threading in dev builds', async () => {
  const ctx = setup();
  for (const target of [note, comment]) {
    assert.equal(JSON.stringify(await ctx.devComposerReply(target, 0)), JSON.stringify(ctx.replyTags(target)));
  }
});

test('a kind 1111 reply to a kind 1 note names its root, parent, and both authors', async () => {
  const result = await setup().devComposerReply(note, 1111);
  assert.equal(result.kind, 1111);
  assert.deepEqual(JSON.parse(JSON.stringify(result.tags)), [
    ['E', 'note', '', 'gatsby'], ['K', '1'], ['P', 'gatsby'],
    ['e', 'note', '', 'gatsby'], ['k', '1'], ['p', 'gatsby'],
  ]);
});

test('converting a nested note reply keeps the original root and fetches its author', async () => {
  const ctx = setup();
  const result = await ctx.devComposerReply({ ...note, id: 'nested', tags: [['e', 'root', '', 'root']] }, 1111);
  assert.equal(result.tags.find((t) => t[0] === 'E')[1], 'root');
  assert.equal(result.tags.find((t) => t[0] === 'P')[1], 'root-author');
  assert.equal(result.tags.find((t) => t[0] === 'e')[1], 'nested');
  ctx.fetchNoteById = async () => null;
  await assert.rejects(ctx.devComposerReply({ ...note, tags: [['e', 'unknown', '', 'root']] }, 1111), /thread author/);
});

test('forced kind 1 fixtures preserve the mixed thread root and notify its author', async () => {
  const result = await setup().devComposerReply(comment, 1);
  assert.equal(result.kind, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.tags)), [
    ['e', 'note', '', 'root'], ['e', 'comment', '', 'reply'], ['p', 'amelia'], ['p', 'gatsby'],
  ]);
});

test('standalone kind 1111 cannot be published without a scope', async () => {
  await assert.rejects(setup().devComposerReply(null, 1111), /Reply to a note/);
});

test('selector is dev-only, session-local, and explains nonstandard replies', () => {
  const selector = lift('function buildDevKindSelector(');
  assert.match(selector, /if \(!isDevBuild\(\) \|\| !devKindEnabled\) return null/);
  assert.match(selector, /Nonstandard demo reply/);
  assert.match(selector, /disabled: !replyTo/);
  assert.match(selector, /select.disabled = !!draft.poll/);
  assert.match(source, /let devKind = 0/);
  assert.match(lift('async function doPublish('), /isDevBuild\(\) && devKindEnabled && settings\?\.devComposerKinds === true && devKind/);
});
