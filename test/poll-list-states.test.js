'use strict';

// OPEN, ENDED, AND THE ONES THAT NEVER SAID.
//
// The Polls tab drew every poll the account had ever posted in rows identical to the
// pixel, so a poll taking votes and a poll that closed six months ago differed only in a
// line of small grey text, and that text said "ended 180d ago", which is a subtraction
// nobody asked to do. This is the counting behind the fix.
//
// Two rules matter more than the rest, and both are about not lying:
//
//   1. pollHasEnded still means ONLY that an end date passed. The tally sheet asks it and
//      prints "ended" on the answer, and kind 1068 has no close, so an open-ended poll
//      must never come back true there however old it is.
//   2. A tie is not a winner. The row is the only place most people will read the result,
//      so naming one of two equal leaders would invent an outcome.
//
// Lifted and run rather than grepped, the way poll-tally.test.js does it, because every
// one of these decides what a row says.

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

const ctx = { console, Date, Math, Number, Set, Map, Array };
vm.createContext(ctx);
vm.runInContext(
  lift(/const POLL_RESPONSE_KIND = \d+;/, 'POLL_RESPONSE_KIND') + '\n' +
    lift(/const POLL_MULTIPLE = '[^']*';/, 'POLL_MULTIPLE') + '\n' +
    lift(/function pollOptions\(ev\)\s*\{[\s\S]*?\n  \}/, 'pollOptions') + '\n' +
    lift(/function pollIsMultiple\(ev\)\s*\{[\s\S]*?\n  \}/, 'pollIsMultiple') + '\n' +
    lift(/function pollEndsAt\(ev\)\s*\{[\s\S]*?\n  \}/, 'pollEndsAt') + '\n' +
    lift(/function tallyPollVotes\(pollEv, votes\)\s*\{[\s\S]*?\n  \}/, 'tallyPollVotes') + '\n' +
    lift(/const POLL_WATCH_SECS = [^;]*;/, 'POLL_WATCH_SECS') + '\n' +
    lift(/function pollWatchExpired\(ev\)\s*\{[\s\S]*?\n  \}/, 'pollWatchExpired') + '\n' +
    lift(/function pollHasEnded\(endsAt\)\s*\{[\s\S]*?\n  \}/, 'pollHasEnded') + '\n' +
    lift(/const POLL_GROUPS = \[[^\]]*\];/, 'POLL_GROUPS') + '\n' +
    lift(/const POLL_GROUP_LABELS = \{[^}]*\};/, 'POLL_GROUP_LABELS') + '\n' +
    lift(/function pollGroup\(ev\)\s*\{[\s\S]*?\n  \}/, 'pollGroup') + '\n' +
    lift(/function pollIsPast\(ev\)\s*\{[\s\S]*?\n  \}/, 'pollIsPast') + '\n' +
    lift(/function pollWinner\(ev, votes\)\s*\{[\s\S]*?\n  \}/, 'pollWinner') + '\n' +
    lift(/function pollEndsText\(endsAt\)\s*\{[\s\S]*?\n  \}/, 'pollEndsText') + '\n' +
    'globalThis.POLL_RESPONSE_KIND = POLL_RESPONSE_KIND;' +
    'globalThis.POLL_WATCH_SECS = POLL_WATCH_SECS;' +
    'globalThis.pollWatchExpired = pollWatchExpired;' +
    'globalThis.pollHasEnded = pollHasEnded;' +
    'globalThis.pollIsPast = pollIsPast;' +
    'globalThis.POLL_GROUPS = POLL_GROUPS;' +
    'globalThis.POLL_GROUP_LABELS = POLL_GROUP_LABELS;' +
    'globalThis.pollGroup = pollGroup;' +
    'globalThis.pollWinner = pollWinner;' +
    'globalThis.pollEndsText = pollEndsText;',
  ctx
);
const { POLL_WATCH_SECS, pollWatchExpired, pollHasEnded, pollIsPast, pollWinner, pollEndsText,
        POLL_GROUPS, POLL_GROUP_LABELS, pollGroup } = ctx;

const NOW = () => Math.floor(Date.now() / 1000);
const DAY = 86400;

// A poll with two options, an optional end date, and an age.
function poll(opts = {}) {
  const tags = [
    ['option', 'a', opts.aLabel || 'Yes'],
    ['option', 'b', opts.bLabel || 'No'],
  ];
  if (opts.endsAt) tags.push(['endsAt', String(opts.endsAt)]);
  return { id: 'p1', kind: 1068, content: 'Q?', created_at: opts.createdAt || NOW(), tags };
}
let n = 0;
const vote = (optId, at) => ({
  id: 'v' + ++n, kind: ctx.POLL_RESPONSE_KIND, pubkey: 'voter' + n,
  created_at: at || NOW(), tags: [['e', 'p1'], ['response', optId]],
});

test('THE WATCH WINDOW IS THIRTY DAYS, AND ONLY FOR POLLS WITH NO END DATE', () => {
  assert.equal(POLL_WATCH_SECS, 30 * DAY, 'the window moved');

  assert.equal(pollWatchExpired(poll({ createdAt: NOW() - 29 * DAY })), false, 'expired a day early');
  assert.equal(pollWatchExpired(poll({ createdAt: NOW() - 31 * DAY })), true, 'never expires');
  // Exactly on the boundary counts as expired: the comparison is <=, so a poll posted
  // thirty days ago to the second stops being watched rather than hanging on for a tick.
  assert.equal(pollWatchExpired(poll({ createdAt: NOW() - 30 * DAY })), true);

  // A poll that named an end date is governed by that date and nothing else, however old.
  assert.equal(pollWatchExpired(poll({ createdAt: NOW() - 400 * DAY, endsAt: NOW() + DAY })), false,
    'the watch window overrode an end date that has not passed');
  assert.equal(pollWatchExpired(null), false);
});

test('pollHasEnded STILL MEANS ONLY THAT AN END DATE PASSED', () => {
  // The rule this whole file exists to protect. The tally sheet calls pollHasEnded and
  // writes "ended" on the strength of it. kind 1068 has no close, so an open-ended poll
  // is never ended, and folding the watch window in here would have the sheet tell you an
  // author closed a poll they never closed.
  assert.equal(pollHasEnded(null), false, 'an open-ended poll reports as ended');
  assert.equal(pollHasEnded(0), false);
  assert.equal(pollHasEnded(NOW() - 10), true);
  assert.equal(pollHasEnded(NOW() + 10), false);

  // And the list's own question is the wider one, which is why it is a separate function.
  const oldOpen = poll({ createdAt: NOW() - 60 * DAY });
  assert.equal(pollHasEnded(null), false);
  assert.equal(pollIsPast(oldOpen), true, 'the list still treats a two-month-old open poll as live');
});

test('what counts as past, case by case', () => {
  assert.equal(pollIsPast(poll({ endsAt: NOW() - 60 })), true, 'end date passed');
  assert.equal(pollIsPast(poll({ endsAt: NOW() + 60 })), false, 'still running');
  assert.equal(pollIsPast(poll({ createdAt: NOW() - 3 * DAY })), false, 'young and open-ended');
  assert.equal(pollIsPast(poll({ createdAt: NOW() - 45 * DAY })), true, 'old and open-ended');
  // A future end date wins over an old creation date: the author said when it closes.
  assert.equal(pollIsPast(poll({ createdAt: NOW() - 45 * DAY, endsAt: NOW() + DAY })), false);
});

test('an open-ended poll reads as open, not as a missing field', () => {
  // "no end date" named something the poll does not carry, which scans as an error
  // rather than as the state it is.
  assert.equal(pollEndsText(null), 'open');
  assert.match(pollEndsText(NOW() + 5 * DAY), /^ends in 5d$/);
  assert.match(pollEndsText(NOW() - 2 * 3600), /^ended 2h ago$/);
});

test('THE WINNER, AND THE THREE TIMES THERE IS NOT ONE', () => {
  const p = poll({ aLabel: 'Gimli', bLabel: 'Legolas', endsAt: NOW() + DAY });

  // A clear result: the label, and the share as "n of voters".
  const clear = pollWinner(p, [vote('a'), vote('a'), vote('b')]);
  assert.deepEqual({ ...clear }, { label: 'Gimli', share: '2 of 3' });

  // A TIE IS NOT A WINNER. Naming either of two equal leaders would be inventing an
  // outcome, and the row is where most people will read it.
  const tied = pollWinner(p, [vote('a'), vote('b')]);
  assert.equal(tied.label, 'Tied');
  assert.equal(tied.share, '1 of 2');

  // Nothing to report rather than a zero.
  assert.equal(pollWinner(p, []), null, 'no votes produced a winner');
  assert.equal(pollWinner(p, [{ id: 'x', kind: ctx.POLL_RESPONSE_KIND, pubkey: 'v', created_at: NOW(), tags: [['e', 'p1'], ['response', 'nope']] }]), null,
    'a ballot for an option that does not exist produced a winner');
  assert.equal(pollWinner({ id: 'p1', kind: 1068, created_at: NOW(), tags: [] }, [vote('a')]), null,
    'a poll with no options produced a winner');
});

test('the winner is counted with the same rules as the tally', () => {
  // Not a second counting implementation: pollWinner calls tallyPollVotes, so one voter
  // voting twice is one voter here exactly as it is in the sheet.
  const p = poll({ aLabel: 'Gimli', bLabel: 'Legolas' });
  const same = { id: 'v-a', kind: ctx.POLL_RESPONSE_KIND, pubkey: 'same', created_at: NOW() - 10, tags: [['e', 'p1'], ['response', 'a']] };
  const again = { id: 'v-b', kind: ctx.POLL_RESPONSE_KIND, pubkey: 'same', created_at: NOW(), tags: [['e', 'p1'], ['response', 'b']] };
  const w = pollWinner(p, [same, again]);
  assert.equal(w.share, '1 of 1', 'the same voter was counted twice');
  assert.equal(w.label, 'Legolas', 'the earlier ballot won over the later one');
});

// ---- the row and the grouping, against the source -------------------------------

const bare = source.replace(/^\s*\/\/.*$/gm, '');

test('EVERY GROUP GETS ITS HEADING, INCLUDING A LIST THAT IS ALL ONE', () => {
  assert.match(bare, /list\.append\(h\('div', \{ className: 'poll-group', textContent: POLL_GROUP_LABELS\[group\] \}\)\);/);
  // This was conditional at first, drawn only when both groups existed, on the reasoning
  // that a heading over the whole list labels nothing. That is exactly backwards in the
  // case it mattered: when every poll has finished, three ended rows and three running
  // ones are the same three rows, and the heading is the only thing that says which.
  assert.doesNotMatch(bare, /if \(polls\.some\(\(o\) => pollIsPast\(o\) !== past\)\)/,
    'the heading is conditional again, so an all-ended list is unlabelled');
});

test('A LATE RESULT IS WRITTEN IN, NOT REPAINTED', () => {
  // The list already refuses to rebuild when only a number changed, because a rebuild
  // replaces every node and throws the pane back to the top under a reader's thumb. The
  // winner arrives from the same query as that number and gets the same treatment.
  assert.match(bare, /lead\.textContent = win\.label;/);
  assert.match(bare, /setWaiting\(cell, win\.share, false\)/);
  const after = bare.slice(bare.indexOf('const freshWins = new Map()'));
  assert.doesNotMatch(after.slice(0, after.indexOf('  }')), /rows = paint\(/,
    'the vote query repaints the list instead of writing into the cells');
});

test('a running poll is never given a leader', () => {
  // Mid-vote, a leader reads as a result. The winner is only computed for rows that will
  // show it, which is also why the cache stores it separately.
  assert.match(bare, /if \(pollIsPast\(ev\)\) \{\s*const win = pollWinner\(ev, votes\);/);
  assert.match(bare, /_pollListCache\.set\(pubkey, \{ polls, counts: fresh, wins: freshWins \}\)/);
});


test('THREE GROUPS, AND THE THIRD IS THE HONEST ONE', () => {
  // An expired end date is Ended, and saying so only reports what the author set. A poll
  // with no end date that aged out never closed and can still take a vote, so the only
  // true thing to say is that Sidecar stopped following it. Filing it under Ended would
  // put a close on somebody else's poll that nobody ever made.
  assert.deepEqual([...POLL_GROUPS], ['open', 'ended', 'untracked'], 'the group order moved');
  assert.equal(POLL_GROUP_LABELS.untracked, 'Untracked');

  assert.equal(pollGroup(poll({ endsAt: NOW() + DAY })), 'open');
  assert.equal(pollGroup(poll({ createdAt: NOW() - 3 * DAY })), 'open', 'young and open-ended is live');
  assert.equal(pollGroup(poll({ endsAt: NOW() - DAY })), 'ended');
  assert.equal(pollGroup(poll({ createdAt: NOW() - 90 * DAY })), 'untracked');
  // An end date decides it even for an ancient poll: the author said when it closes.
  assert.equal(pollGroup(poll({ createdAt: NOW() - 90 * DAY, endsAt: NOW() + DAY })), 'open');
  assert.equal(pollGroup(poll({ createdAt: NOW() - 90 * DAY, endsAt: NOW() - DAY })), 'ended');

  // Both non-open groups show a result rather than a countdown, which is the one thing
  // pollIsPast is still for.
  assert.equal(pollIsPast(poll({ endsAt: NOW() - DAY })), true);
  assert.equal(pollIsPast(poll({ createdAt: NOW() - 90 * DAY })), true);
  assert.equal(pollIsPast(poll({ endsAt: NOW() + DAY })), false);
});

test('THE SORT AND THE HEADINGS ASK THE SAME QUESTION', () => {
  // They did not once, and it showed: the sort read pollHasEnded while the headings read
  // pollIsPast, so an open-ended poll left a month sorted to the top as though live and
  // rendered under a heading saying Ended. A group split into two runs with another group
  // between them is not a group, whatever the heading over the first run says.
  const sortSrc = source.slice(source.indexOf('// pollGroup, THE SAME QUESTION'));
  assert.match(sortSrc.slice(0, 600), /POLL_GROUPS\.indexOf\(pollGroup\(x\)\) - POLL_GROUPS\.indexOf\(pollGroup\(y\)\)/);

  // Run, because contiguity is the property that matters rather than the call.
  const set = [
    poll({ endsAt: NOW() - 10 * DAY }),
    poll({ createdAt: NOW() - 90 * DAY }),
    poll({ endsAt: NOW() + DAY }),
    poll({ createdAt: NOW() - 2 * DAY }),
    poll({ createdAt: NOW() - 200 * DAY }),
    poll({ endsAt: NOW() - 40 * DAY }),
  ].map((p, i) => ({ ...p, id: 'p' + i, created_at: p.created_at - i }));
  set.sort((x, y) => {
    const rank = POLL_GROUPS.indexOf(pollGroup(x)) - POLL_GROUPS.indexOf(pollGroup(y));
    return rank || y.created_at - x.created_at;
  });
  const groups = set.map(pollGroup);
  assert.deepEqual(groups, ['open', 'open', 'ended', 'ended', 'untracked', 'untracked']);
  // Two boundaries across three groups, which is what makes one heading per group right.
  const switches = groups.filter((g, i) => i > 0 && g !== groups[i - 1]).length;
  assert.equal(switches, 2, 'a group is split into more than one run');
});
