'use strict';

// A POLL IN THE EXPANDED TAB.
//
// The tab had no poll editor, so the always-expanded setting had to refuse a poll draft:
// opening one there showed the question and the options as nothing and then published a
// plain note over the top of them. The editor moved into composer-core and both
// composers build it, which is what removed that exception.
//
// The real risk in a shared editor is not the UI, it is the two publish paths disagreeing
// about what a poll actually is. So that is what this checks.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');

test('ONE EDITOR, BUILT BY BOTH', () => {
  assert.match(core, /function buildPollEditor\(d\) \{/);
  assert.match(panel, /buildPollEditor\(\{/);
  assert.match(page, /SC\.buildPollEditor\(\{/);
  // And neither keeps a second copy of the option rows.
  for (const [name, src] of [['sidepanel.js', panel], ['compose.js', page]]) {
    assert.ok(!/function paintPollOptions\(/.test(src), name + ' grew its own poll editor back');
  }
});

test('BOTH PUBLISH THE SAME KIND, FROM THE SAME TAG BUILDER', () => {
  // A 1068 is a different event, not a note with extra tags. Either path emitting a
  // kind 1 with option tags on it produces something no NIP-88 client reads and no
  // ordinary client shows as a poll.
  assert.match(panel, /kind: asPoll \? POLL_KIND :/);
  assert.match(page, /kind: asPoll \? SC\.POLL_KIND :/);
  assert.match(panel, /buildPollTags\(draft\.poll, now, await relayUrls\(true\)\)/);
  assert.match(page, /SC\.buildPollTags\(draft\.poll, Math\.floor\(Date\.now\(\) \/ 1000\), await targetRelays\(\)\)/);

  // A POLL IS NEVER A REPLY, in either. A 1068 answering a note is not a shape anything
  // threads, which is also why the editor's own button hides on a reply.
  assert.match(panel, /const asPoll = draft\.poll && !replyTo;/);
  assert.match(page, /const asPoll = draft\.poll && !replyTo;/);
  const ed = core.slice(core.indexOf('function buildPollEditor(d)'));
  assert.match(ed.slice(0, 4000), /d\.isReply\(\)/);
});

test('THE SAME THREE THINGS GATE POST IN BOTH', () => {
  // A poll needs its question, two filled options, and a custom end time actually
  // picked. The content IS the question, so unlike a plain note an image cannot stand
  // in for it.
  const rule = /!pollDraftIsPostable\(|!SC\.pollDraftIsPostable\(/;
  assert.match(panel, rule);
  assert.match(page, rule);
  for (const [name, src] of [['sidepanel.js', panel], ['compose.js', page]]) {
    assert.match(src, /ends\.kind !== 'at' \|\| draft\.poll\.ends\.at > 0/, name + ' lets an unpicked end time post');
  }
});

test('THE POLL RIDES IN THE DRAFT SLOT, SO IT SURVIVES THE HANDOFF', () => {
  // Both ends read and write one slot. A poll started in the panel and expanded has to
  // arrive whole, or Expand on a poll is a way to lose one.
  assert.match(panel, /if \(draft\.poll\) all\[key\]\.poll = draft\.poll;/);
  assert.match(page, /if \(draft\.poll\) all\[dkey\]\.poll = draft\.poll;/);
  // Removing a poll in the tab has to clear it from the slot too, or reopening the panel
  // finds a poll the author deleted.
  assert.match(page, /else if \(all\[dkey\]\) delete all\[dkey\]\.poll;/);
  // Restored on every path that changes which slot is open: boot, re-key, account switch.
  assert.equal((page.match(/draft\.poll = \(saved && saved\.poll\) \|\| null;/g) || []).length, 3,
    'a slot change leaves the previous poll on screen');
});

test('A POLL WITH OPTIONS BUT NO QUESTION IS STILL SAVED', () => {
  // Options are typed one at a time, and losing four of them because the question had
  // not been written is the kind of thing that makes a draft store worse than none.
  assert.match(page, /\|\| \(draft\.poll && draft\.poll\.options && draft\.poll\.options\.some\(\(o\) => o\.trim\(\)\)\)/);
});

test('changed() means both, because folding them apart broke this once', () => {
  // updatePostState and scheduleSave were separate calls at six sites, and two more
  // sites only ever saved. That asymmetry is how adding a poll could leave Post enabled
  // under the note rule and publish a 1068 with no options at all.
  const ed = core.slice(core.indexOf('function buildPollEditor(d)'));
  const body = ed.slice(0, ed.indexOf('\n    paintPoll();'));
  assert.ok(!/updatePostState\(\)|scheduleSave\(\)/.test(body), 'the editor reaches for a panel binding');
  assert.match(panel, /changed: \(\) => \{ updatePostState\(\); scheduleSave\(\); \},/);
  assert.match(page, /changed: \(\) => \{ paintCount\(\); scheduleSave\(\); \},/);
});

test('the editor reads the draft through accessors, not a captured reference', () => {
  // The tab rebinds draft when the account changes, and a captured reference would go on
  // editing the previous account's poll.
  const ed = core.slice(core.indexOf('function buildPollEditor(d)'));
  const body = ed.slice(0, ed.indexOf('\n    paintPoll();'));
  assert.match(body, /d\.poll\(\)/);
  assert.match(body, /d\.setPoll\(/);
  assert.ok(!/\bdraft\./.test(body), 'the shared editor reaches into a draft it does not own');
});
