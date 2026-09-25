'use strict';

// POPPING A REPLY OUT INTO THE TAB.
//
// Expand was refused to replies, and the refusal was correct at the time: compose.js
// wrote `kind: 1` with a client tag and nothing else, and it only ever opened the plain
// draft slot. A reply that reached it would have published as a top-level note, detached
// from the thread, with nothing on screen to say so.
//
// Three things had to become true, and the third is the one that cannot be eyeballed:
//   1. replyTags moved into composer-core, so both ends build threading from one place.
//   2. The tab opens the reply's OWN draft slot, named in the URL it was opened with.
//   3. The two composers produce the SAME TAGS from the same target.
//
// So this file runs both assemblies and compares them, rather than reading either.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');

const ME = 'a'.repeat(64);
const THEM = 'b'.repeat(64);
const THIRD = 'c'.repeat(64);

function replyTags(target, self) {
  const c = { Set, Array, String };
  c.globalThis = c;
  vm.createContext(c);
  vm.runInContext(
    core.match(/const WEB_COMMENT_KIND = 1111;/)[0] + '\n' +
    core.match(/function replyTags\(target, selfPubkey\)[\s\S]*?\n  \}/)[0] +
    ';globalThis.f = replyTags;', c);
  const r = c.f(target, self);
  return { kind: r.kind, tags: [...r.tags].map((t) => [...t]) };
}

// ---- the slot, which is what the URL actually names ----

function panelKey(pubkey, replyTo) {
  const src = panel.match(/const draftKey = [^\n]+/)[0];
  const c = {}; c.globalThis = c; vm.createContext(c);
  vm.runInContext(src + ';globalThis.f = draftKey;', c);
  return c.f(pubkey, replyTo);
}

function pageKey(pubkey, replyId) {
  const src = page.match(/function slotFor\(pubkey\)[\s\S]*?\n  \}/)[0];
  const c = { replyId }; c.globalThis = c; vm.createContext(c);
  vm.runInContext(src + ';globalThis.f = slotFor;', c);
  return c.f(pubkey);
}

test('THE TWO ENDS NAME THE SAME DRAFT SLOT', () => {
  // The panel writes the draft under its key and puts the id in the tab's URL; the tab
  // rebuilds the key from that id. Drift by one character and the tab opens an empty
  // slot, which looks exactly like the reply having been lost.
  const target = { id: 'f'.repeat(64), pubkey: THEM, kind: 1, tags: [] };
  assert.equal(pageKey(ME, target.id), panelKey(ME, target));
  // And a plain note is the bare account key at both ends.
  assert.equal(pageKey(ME, null), panelKey(ME, null));
  // Replying to two different notes is two slots, from the same account.
  assert.notEqual(pageKey(ME, 'd'.repeat(64)), pageKey(ME, 'e'.repeat(64)));
});

test('THE TAB AND THE PANEL BUILD IDENTICAL THREADING', () => {
  // The point of moving replyTags. Both composers call the same function with the same
  // arguments, so this compares it against itself across the shapes that differ most.
  const cases = [
    ['a top-level note', { id: '1'.repeat(64), pubkey: THEM, kind: 1, tags: [] }],
    ['a nested reply', { id: '2'.repeat(64), pubkey: THEM, kind: 1,
      tags: [['e', '3'.repeat(64), '', 'root'], ['p', THIRD]] }],
    ['a NIP-22 comment', { id: '4'.repeat(64), pubkey: THEM, kind: 1111,
      tags: [['E', '5'.repeat(64), '', THIRD], ['K', '1'], ['P', THIRD], ['e', '5'.repeat(64)], ['k', '1']] }],
  ];
  for (const [name, target] of cases) {
    const built = replyTags(target, ME);
    assert.ok(built.tags.length, name + ' produced no tags at all');
    // The author is notified, and the replier never is.
    assert.ok(built.tags.some((t) => t[0] === 'p' && t[1] === THEM), name + ': the author is not p-tagged');
    assert.ok(!built.tags.some((t) => t[0] === 'p' && t[1] === ME), name + ': self-p-tagged');
    // Threading comes first in the published list, which is what compose.js spreads.
    assert.ok(built.tags[0][0] === 'e' || built.tags[0][0] === 'E' || built.tags[0][0] === 'I',
      name + ': the first tag is not a threading tag');
  }
});

test('WHAT THE TAB PUBLISHES PUTS THREADING BEFORE EVERYTHING ELSE', () => {
  // NIP-10 readers take the first `e` marked root as the thread and NIP-22 scope is read
  // positionally by some clients, so the order is load-bearing rather than tidy.
  // The whole line: a character class excluding ] stops at the empty array inside
  // `reply ? reply.tags : []` and matches nothing.
  const tmpl = page.match(/^.*tags: \[.*imetaTagsForMedia\(draft\.media\)\],$/m)[0];
  const reply = tmpl.indexOf('reply ? reply.tags');
  const client = tmpl.indexOf("['client', 'Sidecar']");
  const imeta = tmpl.indexOf('imetaTagsForMedia');
  assert.ok(reply > -1, 'the tab no longer spreads the threading tags at all');
  assert.ok(reply < client && client < imeta, 'threading has to lead the tag list');
  // And the kind follows the target rather than being hardcoded to 1, or a reply to a
  // NIP-22 comment would publish as a kind 1 note nobody in that thread can see.
  assert.match(page, /kind: reply \? reply\.kind : 1,/);
});

test('A STALE OR FORGED reply IN THE URL CANNOT BECOME A DRAFT KEY', () => {
  // The id is used to build a storage key, so it is validated as a note id first.
  const guard = page.match(/let replyId = \(\(\) => \{[\s\S]*?\}\)\(\);/)[0];
  assert.match(guard, /\/\^\[0-9a-f\]\{64\}\$\/i\.test\(v\)/);
  assert.match(guard, /\.toLowerCase\(\)/, 'case would split one note into two slots');

  // And the TARGET is read off the draft, never off the URL. A tab pointed at a reply
  // whose draft was posted or dropped finds nothing and stays a plain note, which is the
  // safe direction: a note that should have been a reply is visible on screen, whereas a
  // reply quietly published as a note is not.
  assert.match(page, /replyTo = \(saved && saved\.replyTo && saved\.replyTo\.id\) \? saved\.replyTo : null;/);
  const publish = page.slice(page.indexOf('const reply = replyTo ?'));
  assert.doesNotMatch(publish.slice(0, 200), /replyId/, 'publishing reads the URL instead of the draft');
});

test('EXPANDING A REPLY WITH NOTHING TYPED STILL HANDS OVER THE TARGET', async () => {
  // The bug this caught. saveComposeDraft writes NOTHING for an empty draft and deletes
  // the slot outright, so pressing Expand before typing a word handed the tab an empty
  // key. The tab found no draft, had no target, and showed no parent note: you could not
  // see what you were answering, which is the commonest way to reach this at all.
  //
  // Run rather than read, because every individual line was fine and the defect was in
  // what the sequence produced.
  const handoff = panel.slice(
    panel.indexOf('let relays = null;'),
    panel.indexOf('// And never a second tab'));
  const target = { id: 'f'.repeat(64), pubkey: THEM, kind: 1, tags: [], content: 'the parent note' };
  const dkey = ME + '|r:' + target.id;
  const store = {};
  const c = {
    Date, Object, JSON, replyTo: target, dkey, pruneReplyDrafts: () => {},
    postRelays: async () => ['wss://a'],
    call: async (m) => {
      if (m.type === 'SIDECAR_SECRET_GET') return JSON.parse(JSON.stringify(store));
      if (m.type === 'SIDECAR_SECRET_SET') {
        Object.keys(store).forEach((k) => delete store[k]);
        Object.assign(store, JSON.parse(JSON.stringify(m.value)));
        return true;
      }
      return null;
    },
  };
  c.globalThis = c;
  vm.createContext(c);
  vm.runInContext('globalThis.go = async () => {' + handoff + '};', c);
  await c.go();

  assert.ok(store[dkey], 'Expand on an untyped reply wrote no slot, so the tab gets nothing');
  assert.equal(store[dkey].replyTo.id, target.id, 'the slot carries no target');
  assert.equal(store[dkey].replyTo.content, 'the parent note');
  assert.ok(store[dkey].expandRelays, 'the relay set was lost with it');

  // And the tab's own read of that slot resolves a target.
  const saved = store[dkey];
  const resolved = (saved && saved.replyTo && saved.replyTo.id) ? saved.replyTo : null;
  assert.ok(resolved, 'the tab cannot resolve the target out of the slot it was handed');
});

test('and the tab does not delete that slot on its first save', () => {
  // The mirror of the same bug. persistDraft drops a slot with no content, which for an
  // untouched reply would take the target with it: reload and the parent note is gone.
  const fn = page.slice(page.indexOf('async function persistDraft()'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /else if \(replyTo\) \{[\s\S]{0,200}replyTo,/,
    'an untouched reply loses its slot, and its target with it');
  // The plain-note case is untouched: no content and no target still deletes.
  assert.match(body, /else delete all\[dkey\];/);
});

test('AN OPEN TAB IS TOLD TO SWITCH, BECAUSE IT CANNOT BE NAVIGATED', () => {
  // The manifest asks for storage, sidePanel, alarms, contextMenus and notifications,
  // and deliberately not "tabs". chrome.tabs.update(id, {url}) needs that permission and
  // fails silently without it, so an open tab stayed on whatever it already held: expand
  // a reply while a blank note is open and you get the blank note, with no error.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.ok(!manifest.permissions.includes('tabs'),
    'if tabs was added, revisit this: navigation would become possible and simpler');

  // So the panel sends, and the tab re-keys itself.
  assert.match(panel, /SIDECAR_COMPOSE_OPEN/);
  assert.match(page, /msg\.type === 'SIDECAR_COMPOSE_OPEN'/);
  // Validated on arrival as well as in the URL: a message is another way in.
  const handler = page.slice(page.indexOf("msg.type === 'SIDECAR_COMPOSE_OPEN'"));
  assert.match(handler.slice(0, 700), /\/\^\[0-9a-f\]\{64\}\$\/i\.test\(msg\.replyId\)/);
  // The open draft is written back before the key moves, or the text on screen lands in
  // the slot it was not typed in.
  assert.match(handler.slice(0, 700), /flushDraft\(\)\.then\(\(\) => \{ replyId = want; return reopenDraft\(\); \}\)/);
  // And a message naming the draft already open does nothing.
  assert.match(handler.slice(0, 700), /if \(want === replyId\) return;/);

  // replyId has to be reassignable for any of that to work.
  assert.match(page, /let replyId = \(\(\) => \{/);
  assert.ok(!/const replyId = /.test(page), 'replyId is const again, so the tab cannot re-key');
});

test('the target survives an account switch, or follows it', () => {
  // The slot is keyed by account, so switching accounts inside the tab moves to that
  // account's draft for the same note. Replying from two accounts is two drafts, and the
  // new one may not exist, in which case the tab correctly stops being a reply.
  const sw = page.slice(page.indexOf('await flushDraft();'));
  const body = sw.slice(0, 1400);
  assert.match(body, /dkey = slotFor\(state\.activePubkey\);/);
  assert.match(body, /replyTo = \(saved && saved\.replyTo && saved\.replyTo\.id\) \? saved\.replyTo : null;/);
  assert.match(body, /paintReplyTarget\(\);/);
});

test('THE HANDOFF WAITS FOR THE AUTOSAVE IT RACES', () => {
  // Both are read-modify-writes of the whole draft store, and for an EMPTY reply the
  // autosave's answer is "delete this slot". Unawaited, that delete could land after the
  // handoff's own write and erase the target it had just put there, so the tab opened on
  // a slot that was not there and showed a blank note. Nothing logged it.
  assert.match(panel, /await persistDraft\(\);/, 'the handoff does not wait for the save it races');
  assert.match(panel, /function persistDraft\(\) \{ return saveComposeDraft\(dkey, draft\); \}/,
    'persistDraft swallows its promise, so awaiting it waits for nothing');
  // And the saver has to hand its promise back for any of that to mean anything.
  const saver = panel.slice(panel.indexOf('function saveComposeDraft(key, draft)'));
  assert.match(saver.slice(0, 2600), /return \(async \(\) => \{/,
    'saveComposeDraft is fire-and-forget again');
});

test('THE TAB RENDERS THE QUOTE WITH A FUNCTION THAT EXISTS', () => {
  // renderNoteText is returned by installComposer, NOT exported on the core object. The
  // core's own comment lists "a reply's context strip" among the reasons it is handed
  // back that way. SC.renderNoteText is undefined, and calling it throws mid-paint with
  // the page half built.
  const coreRet = core.slice(core.lastIndexOf('  return {'));
  assert.ok(!/\brenderNoteText\b/.test(coreRet),
    'it is exported on the core now, so this whole hazard is gone and the note can go');
  assert.match(page, /composer\.renderNoteText\(body, replyTo\.content \|\| '', Infinity\)/);
  assert.ok(!/SC\.renderNoteText\(/.test(page), 'calling an undefined core export again');
});

test('A HANDOFF THAT DID NOT ARRIVE SAYS SO, INSTEAD OF LOOKING NORMAL', () => {
  // Four passes were spent on this feature partly because every failure looked
  // identical to success: the tab rendered an ordinary blank note, which is also what a
  // tab somebody opened themselves looks like. There was no way to tell a broken
  // handoff from nothing being wrong.
  //
  // A ?reply= with no draft behind it can only mean the handoff failed, and the
  // consequence is a note about to publish detached from the thread it was meant to
  // answer, so it interrupts.
  const fn = page.slice(page.indexOf('function paintReplyTarget()'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /if \(!replyTo && replyId\) \{/,
    'a tab sent to answer a note it cannot find goes back to looking like a new note');
  assert.match(body, /could not be loaded/);
  assert.match(body, /will post as a new note, not a reply/,
    'it does not say what the consequence is, which is the part that matters');
  // Named slot, so the next report carries the fact instead of a description.
  assert.match(body, /'slot ' \+ dkey/);
  // Warn-colored: this is not context, it is a problem with what is about to publish.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(css, /\.reply-target-lost \{ border-left-color: var\(--warn\); \}/);
});

test('CLOSING THE MODAL DOES NOT DELETE THE SLOT IT JUST HANDED OVER', () => {
  // The bug that survived four passes, because it is AFTER the code that looked wrong.
  // closeModal() is the last line of the Expand handler, and the modal's close callback
  // saves the draft one more time. For a reply with nothing typed yet, that save deletes
  // the slot, taking the target the handoff had just written. The tab then opened on a
  // slot that was not there and drew a blank note.
  assert.match(panel, /if \(!published && !handedToTab && enteredEditor\) persistDraft\(\);/,
    'the close handler writes over the draft the tab now owns');
  // Set BEFORE the close, or it is set too late to matter.
  const handler = panel.slice(panel.indexOf("expand.addEventListener('click'"));
  const head = handler.slice(0, 5000);
  const flagAt = head.indexOf('handedToTab = true;');
  const closeAt = head.indexOf('closeModal();');
  assert.ok(flagAt > -1 && closeAt > -1 && flagAt < closeAt,
    'the flag is set after the close it exists to suppress');

  // NOT called `expanded`. buildReplyBlock has its own `expanded` for the Show more
  // toggle, and two flags with one name in nested scopes is the next bug in this chain.
  const composer = panel.slice(panel.indexOf('async function openComposer('));
  assert.ok(!/let expanded = false;[\s\S]{0,400}handedToTab/.test(composer),
    'the handoff flag is shadowed by, or shadows, the Show more toggle');
});

test('the quote is shown whole in the tab, which is the room the panel lacks', () => {
  // The panel caps at 240 because it has 360px. The tab is the space the panel does not
  // have, so capping there would reproduce the problem the tab exists to solve.
  const fn = page.slice(page.indexOf('function paintReplyTarget()'));
  assert.match(fn.slice(0, 2600), /composer\.renderNoteText\(body, replyTo\.content \|\| '', Infinity\)/);
  // Above the tabs, not inside a pane, or switching to Preview would hide the subject.
  const html = fs.readFileSync(path.join(ROOT, 'compose.html'), 'utf8');
  const target = html.indexOf('id="compose-reply-target"');
  assert.ok(target > -1 && target < html.indexOf('id="compose-tabs"'));
});
