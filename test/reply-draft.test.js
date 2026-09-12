'use strict';

// A reply gets its own draft.
//
// Reported: tapping Reply on a notification opened the composer showing whatever
// half-written note was sitting in the main composer. There was one draft slot per
// account, `all[pubkey]`, and everything shared it, so a reply and a note about something
// else were the same saved text. Worse than showing the wrong words, the draft chooser
// then offered to resume a draft carrying its own reply target, which would have quietly
// answered a different note than the one tapped.
//
// Now the slot is keyed by what is being answered. The main composer keeps the bare
// account key, which is what makes every draft saved before this still load.

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

// The store, in memory, behind the same message names the panel uses.
function store(initial) {
  const data = { drafts: { ...(initial || {}) } };
  const ctx = {
    call: async (msg) => {
      if (msg.type === 'SIDECAR_SECRET_GET') return data[msg.store];
      if (msg.type === 'SIDECAR_SECRET_SET') { data[msg.store] = msg.value; return true; }
      return null;
    },
    REPLY_DRAFT_MAX: 20,
  };
  vm.createContext(ctx);
  vm.runInContext(
    [source.match(/const draftKey = .*/)[0], lift('function pruneReplyDrafts('),
     lift('function loadComposeDraft('), lift('function saveComposeDraft('), lift('async function clearComposeDraft(')].join('\n') +
      '\nglobalThis.api = { draftKey, loadComposeDraft, saveComposeDraft, clearComposeDraft, pruneReplyDrafts };',
    ctx
  );
  return { api: ctx.out || ctx.api, data };
}

const ALICE = 'a'.repeat(64);
const NOTE = 'f'.repeat(64);
const settle = () => new Promise((r) => setTimeout(r, 0));

test('A REPLY AND THE MAIN COMPOSER DO NOT SHARE A SLOT', async () => {
  const { api, data } = store();
  api.saveComposeDraft(api.draftKey(ALICE, null), { text: 'a note about the weather', media: [] });
  api.saveComposeDraft(api.draftKey(ALICE, { id: NOTE }), { text: 'answering you', media: [], replyTo: { id: NOTE, pubkey: 'b', kind: 1, tags: [] } });
  await settle();
  assert.equal(Object.keys(data.drafts).length, 2, 'one write landed on top of the other');
  assert.equal(data.drafts[ALICE].text, 'a note about the weather');
  assert.equal(data.drafts[ALICE + '|r:' + NOTE].text, 'answering you');
});

test('opening a reply cannot see the main composer draft', async () => {
  const { api } = store();
  api.saveComposeDraft(ALICE, { text: 'half a thought', media: [] });
  await settle();
  assert.equal(await api.loadComposeDraft(api.draftKey(ALICE, { id: NOTE })), null, 'the reply was offered an unrelated draft');
  assert.equal((await api.loadComposeDraft(ALICE)).text, 'half a thought', 'the main composer lost its own draft');
});

test('two replies to different notes keep their own text', async () => {
  const { api } = store();
  const other = 'c'.repeat(64);
  api.saveComposeDraft(api.draftKey(ALICE, { id: NOTE }), { text: 'first', media: [] });
  api.saveComposeDraft(api.draftKey(ALICE, { id: other }), { text: 'second', media: [] });
  await settle();
  assert.equal((await api.loadComposeDraft(api.draftKey(ALICE, { id: NOTE }))).text, 'first');
  assert.equal((await api.loadComposeDraft(api.draftKey(ALICE, { id: other }))).text, 'second');
});

test('publishing a reply clears only that reply', async () => {
  const { api, data } = store();
  api.saveComposeDraft(ALICE, { text: 'still writing this', media: [] });
  api.saveComposeDraft(api.draftKey(ALICE, { id: NOTE }), { text: 'sent', media: [] });
  await settle();
  await api.clearComposeDraft(api.draftKey(ALICE, { id: NOTE }));
  assert.equal(data.drafts[ALICE + '|r:' + NOTE], undefined, 'the reply draft survived publishing');
  assert.equal(data.drafts[ALICE].text, 'still writing this', 'publishing a reply wiped the main draft');
});

test('ABANDONED REPLIES DO NOT ACCUMULATE FOREVER', async () => {
  // A slot per answered note is unbounded by construction, and this store is encrypted at
  // rest for a reason: it should not become an archive of everything half-said.
  const all = { [ALICE]: { text: 'main', savedAt: 1 } };
  for (let i = 0; i < 25; i++) all[ALICE + '|r:' + i] = { text: 'r' + i, savedAt: 1000 + i };
  const { api } = store(all);
  api.pruneReplyDrafts(all);
  const left = Object.keys(all).filter((k) => k.includes('|r:'));
  assert.equal(left.length, 20, 'the cap is not being applied');
  assert.ok(all[ALICE], 'pruning reply slots took the main draft with it');
  assert.ok(all[ALICE + '|r:24'], 'the newest reply was pruned');
  assert.equal(all[ALICE + '|r:0'], undefined, 'the oldest reply survived');
});

// ---- the composer uses one key for its whole session -------------------------------------

test('the key is fixed by what you arrived with, not by what you resume', () => {
  // A saved draft can carry its own reply target. If the key followed that, resuming one
  // inside the main composer would start writing into a reply slot, and the account draft
  // would be stranded where nothing looks for it.
  const fn = stripComments(lift('async function openComposer('));
  assert.match(fn, /const dkey = draftKey\(pubkey, replyTo\)/, 'the composer no longer pins a key');
  const at = fn.indexOf('const dkey');
  assert.ok(at < fn.indexOf('loadComposeDraft'), 'the key is derived after the draft is read');
  for (const call of ['saveComposeDraft(dkey', 'loadComposeDraft(dkey', 'clearComposeDraft(dkey']) {
    assert.ok(fn.includes(call), call + ') is still using the bare account key');
  }
  assert.ok(!/ComposeDraft\(pubkey[,)]/.test(fn), 'a draft call still passes the account key');
});

test('drafts saved before this change still load', () => {
  // The main composer keeps the bare pubkey, so the old shape is the new shape for the one
  // slot that already existed. No migration, and nothing to lose if this is reverted.
  const fn = stripComments(source.match(/const draftKey = .*/)[0]);
  assert.match(fn, /replyTo && replyTo\.id \? pubkey \+ '\|r:' \+ replyTo\.id : pubkey/, 'the main slot key changed');
});
