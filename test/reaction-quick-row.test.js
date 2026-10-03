'use strict';

// The reaction picker's quick row learns from what you send.
//
// Eight defaults to start; every reaction sent is counted on this device, and the row is
// the eight most used. The rules worth pinning are the ones that keep the row from
// jumping: a default counts as used once already, anything else needs TWO uses to get
// on, ties go to the more recent and then to the defaults' order, and only emoji the
// picker offers are ever drawn from storage.

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

const lifted = [
  lift(/const QUICK_REACTIONS = \[[^\]]*\];/, 'QUICK_REACTIONS'),
  lift(/const REACTION_USE_LEGACY_KEY = '[^']+';/, 'REACTION_USE_LEGACY_KEY'),
  lift(/const REACTION_USE_PREFIX = '[^']+';/, 'REACTION_USE_PREFIX'),
  lift(/const reactionUseKey = \(pubkey\) => [^\n]+;/, 'reactionUseKey'),
  lift(/const REACTION_USE_MAX = \d+;/, 'REACTION_USE_MAX'),
  lift(/let _emojiChars = null;/, '_emojiChars'),
  lift(/\n {2}function isPickerEmoji\(ch\) \{[\s\S]*?\n {2}\}\n/, 'isPickerEmoji'),
  lift(/\n {2}function rankQuickReactions\(use\) \{[\s\S]*?\n {2}\}\n/, 'rankQuickReactions'),
  lift(/\n {2}function loadReactionUse\(pubkey\) \{[\s\S]*?\n {2}\}\n/, 'loadReactionUse'),
  lift(/\n {2}async function noteReactionUse\(pubkey, ch\) \{[\s\S]*?\n {2}\}\n/, 'noteReactionUse'),
  lift(/\n {2}async function undoReactionUse\(pubkey, ch, prev\) \{[\s\S]*?\n {2}\}\n/, 'undoReactionUse'),
].join('\n');

function load() {
  const emoji = { self: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'emoji-data.js'), 'utf8'), emoji);
  const table = emoji.self.SidecarEmoji;
  // structuredClone both ways, like the real store: a mock that hands back the live
  // object hides a write that never happened.
  const store = {};
  const chrome = {
    runtime: { lastError: undefined },
    storage: {
      local: {
        get(key, cb) { setTimeout(() => cb(key in store ? { [key]: structuredClone(store[key]) } : {}), 0); },
        set(obj, cb) { for (const k of Object.keys(obj)) store[k] = structuredClone(obj[k]); setTimeout(() => cb && cb(), 0); },
        remove(key, cb) { delete store[key]; setTimeout(() => cb && cb(), 0); },
      },
    },
  };
  const ctx = { chrome, emojiGroups: () => table, structuredClone, Date };
  vm.runInNewContext(lifted + '\nthis.api = { QUICK_REACTIONS, REACTION_USE_LEGACY_KEY, reactionUseKey, rankQuickReactions, loadReactionUse, noteReactionUse, undoReactionUse };', ctx);
  // Arrays made inside the sandbox carry its prototype, which a strict deepEqual rejects
  // however equal the contents; copy them into this realm.
  const rank = ctx.api.rankQuickReactions;
  return { ...ctx.api, rankQuickReactions: (use) => [...rank(use)], store };
}

const ME = 'a'.repeat(64);
const TESTER = 'b'.repeat(64);
const DEFAULTS = ['❤️', '🔥', '👍', '😂', '🙌', '🤙', '😮', '🫡'];

test('with nothing counted, the row is the eight defaults in their order', () => {
  const { rankQuickReactions, QUICK_REACTIONS } = load();
  assert.deepEqual([...QUICK_REACTIONS], DEFAULTS);
  assert.deepEqual(rankQuickReactions({}), DEFAULTS);
  assert.deepEqual(rankQuickReactions(undefined), DEFAULTS);
});

test('one use of something new does not displace a default; a second one does', () => {
  const { rankQuickReactions } = load();
  assert.deepEqual(rankQuickReactions({ '🦄': { n: 1, at: 5 } }), DEFAULTS);
  const row = rankQuickReactions({ '🦄': { n: 2, at: 5 } });
  assert.equal(row[0], '🦄');
  assert.equal(row.length, 8);
  assert.ok(!row.includes('🫡'), 'the last default gives way');
});

test('most used first, a tie going to the more recent', () => {
  const { rankQuickReactions } = load();
  const row = rankQuickReactions({
    '🔥': { n: 4, at: 10 },
    '🦄': { n: 3, at: 20 },
    '🍕': { n: 3, at: 30 },
  });
  assert.deepEqual(row.slice(0, 4), ['🔥', '🍕', '🦄', '❤️']);
});

test('a default you use climbs: its count adds to the one it starts with', () => {
  const { rankQuickReactions } = load();
  assert.equal(rankQuickReactions({ '🫡': { n: 1, at: 1 } })[0], '🫡');
});

test('stored keys the picker does not offer are ignored, never drawn', () => {
  const { rankQuickReactions } = load();
  assert.deepEqual(rankQuickReactions({
    lol: { n: 50, at: 1 },
    '<img src=x>': { n: 50, at: 1 },
    ':custom:': { n: 50, at: 1 },
    '🦄': { n: 'many' },
  }), DEFAULTS);
});

test('sending a reaction counts it, and the row reads the count back', async () => {
  const { noteReactionUse, loadReactionUse, rankQuickReactions, reactionUseKey, store } = load();
  await noteReactionUse(ME, '🦄');
  await noteReactionUse(ME, '🦄');
  await noteReactionUse(ME, 'not an emoji');
  assert.equal(store[reactionUseKey(ME)]['🦄'].n, 2);
  assert.ok(!('not an emoji' in store[reactionUseKey(ME)]));
  assert.equal(rankQuickReactions(await loadReactionUse(ME))[0], '🦄');
});

test('the store is capped, dropping the least used and never the one just sent', async () => {
  const { noteReactionUse, reactionUseKey, store } = load();
  const many = {};
  const pool = ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘',
    '😗', '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐',
    '😑', '😶', '😏', '😒', '🙄', '😬', '😌', '😔'];
  pool.forEach((ch, i) => { many[ch] = { n: 5 + i, at: i }; });
  store[reactionUseKey(ME)] = many;
  await noteReactionUse(ME, '🦄');
  const kept = store[reactionUseKey(ME)];
  assert.equal(Object.keys(kept).length, 40);
  assert.ok('🦄' in kept, 'the reaction just sent survives the cap');
  assert.ok(!('😀' in kept), 'the least used is the one dropped');
});

test('the React button counts on the tap and takes it back if the reaction fails', () => {
  const at = source.indexOf("const reactBtn = actBtn(t('React')");
  const block = source.slice(at, source.indexOf('// REPOST OR QUOTE', at));
  assert.match(block, /const quickRow = rankQuickReactions\(await loadReactionUse\(state\.activePubkey\)\);/);
  const counted = block.indexOf('const counted = noteReactionUse(who, ch);');
  const sent = block.indexOf('await publishReaction(ev, ch);');
  assert.ok(counted > 0 && sent > counted, 'counted before the publish, so the next picker has it');
  assert.match(block, /catch \(e2\) \{\s*counted\.then\(\(prev\) => undoReactionUse\(who, ch, prev\)\)/);
  assert.match(block, /\}, quickRow\);/);
  assert.match(source, /function emojiPickerOver\(host, onPick, quickRow = QUICK_REACTIONS\)/);
  assert.match(source, /quickRow\.forEach\(\(ch\) => \{/);
});

test('EACH ACCOUNT HAS ITS OWN ROW: reacting as one never reshuffles another', async () => {
  const { noteReactionUse, loadReactionUse, rankQuickReactions, REACTION_USE_LEGACY_KEY, store } = load();
  await noteReactionUse(TESTER, '🦄');
  await noteReactionUse(TESTER, '🦄');
  assert.equal(rankQuickReactions(await loadReactionUse(TESTER))[0], '🦄');
  assert.deepEqual(rankQuickReactions(await loadReactionUse(ME)), DEFAULTS, 'the other account still has the defaults');
  // No account, no row of its own and nothing counted.
  await noteReactionUse('', '🦄');
  assert.deepEqual({ ...(await loadReactionUse('')) }, {});
  // The old shared store is dropped, not handed to whichever account reads first.
  store[REACTION_USE_LEGACY_KEY] = { '🍕': { n: 9, at: 1 } };
  assert.deepEqual(rankQuickReactions(await loadReactionUse(ME)), DEFAULTS);
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(!(REACTION_USE_LEGACY_KEY in store), 'the shared store is removed');
});

test('removing an account removes its row', () => {
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const at = bg.indexOf("case 'SIDECAR_REMOVE_ACCOUNT'");
  const block = bg.slice(at, bg.indexOf('break;', at));
  assert.match(block, /chrome\.storage\.local\.remove\('sidecar_reaction_use:' \+ message\.pubkey, r\)/);
  assert.match(source, /const REACTION_USE_PREFIX = 'sidecar_reaction_use:';/, 'the same prefix as the panel');
});

test('a failed reaction leaves no count behind, and does not take another one with it', async () => {
  const { noteReactionUse, undoReactionUse, loadReactionUse, reactionUseKey, store } = load();
  // A new emoji, failed: gone entirely.
  const prev = await noteReactionUse(ME, '🦄');
  assert.equal(prev, null);
  await undoReactionUse(ME, '🦄', prev);
  assert.ok(!('🦄' in (store[reactionUseKey(ME)] || {})));
  // One already used twice, failed: back to two, with its old time.
  await noteReactionUse(ME, '🍕');
  await noteReactionUse(ME, '🍕');
  const before = { ...store[reactionUseKey(ME)]['🍕'] };
  const p2 = await noteReactionUse(ME, '🍕');
  // Another reaction lands while the failed one is out: the undo takes only its own use.
  await noteReactionUse(ME, '🍕');
  await undoReactionUse(ME, '🍕', p2);
  const after = (await loadReactionUse(ME))['🍕'];
  assert.equal(after.n, before.n + 1);
  assert.equal(after.at, before.at);
});
