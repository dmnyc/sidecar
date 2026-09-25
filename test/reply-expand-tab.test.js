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
  const guard = page.match(/const replyId = \(\(\) => \{[\s\S]*?\}\)\(\);/)[0];
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

test('the quote is shown whole in the tab, which is the room the panel lacks', () => {
  // The panel caps at 240 because it has 360px. The tab is the space the panel does not
  // have, so capping there would reproduce the problem the tab exists to solve.
  const fn = page.slice(page.indexOf('function paintReplyTarget()'));
  assert.match(fn.slice(0, 1200), /renderNoteText\(body, replyTo\.content \|\| '', Infinity\)/);
  // Above the tabs, not inside a pane, or switching to Preview would hide the subject.
  const html = fs.readFileSync(path.join(ROOT, 'compose.html'), 'utf8');
  const target = html.indexOf('id="compose-reply-target"');
  assert.ok(target > -1 && target < html.indexOf('id="compose-tabs"'));
});
