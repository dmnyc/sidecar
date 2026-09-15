'use strict';

// Unit coverage for NIP-88 poll counting in sidepanel.js.
//
// The rules are small and every one of them changes the number on screen, which is why
// they are tested against the real function rather than asserted about in a grep. The
// counting function is lifted out of the panel and run in a vm, the same approach
// web-comment.test.js uses, because sidepanel.js is one IIFE around chrome APIs and
// cannot be required.

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

const ctx = { console, Date, crypto: globalThis.crypto };
vm.createContext(ctx);
vm.runInContext(
  lift(/const POLL_KIND = \d+;/, 'POLL_KIND') + '\n' +
    lift(/const POLL_RESPONSE_KIND = \d+;/, 'POLL_RESPONSE_KIND') + '\n' +
    lift(/const POLL_SINGLE = '[^']*';/, 'POLL_SINGLE') + '\n' +
    lift(/const POLL_MULTIPLE = '[^']*';/, 'POLL_MULTIPLE') + '\n' +
    lift(/function pollOptionId\(\)\s*\{[\s\S]*?\n  \}/, 'pollOptionId') + '\n' +
    lift(/function pollOptions\(ev\)\s*\{[\s\S]*?\n  \}/, 'pollOptions') + '\n' +
    lift(/function pollIsMultiple\(ev\)\s*\{[\s\S]*?\n  \}/, 'pollIsMultiple') + '\n' +
    lift(/function pollEndsAt\(ev\)\s*\{[\s\S]*?\n  \}/, 'pollEndsAt') + '\n' +
    lift(/function tallyPollVotes\(pollEv, votes\)\s*\{[\s\S]*?\n  \}/, 'tallyPollVotes') + '\n' +
    lift(/function pollShare\(count, voters\)\s*\{[\s\S]*?\n  \}/, 'pollShare') + '\n' +
    'globalThis.pollOptionId = pollOptionId;' +
    'globalThis.pollOptions = pollOptions;' +
    'globalThis.pollIsMultiple = pollIsMultiple;' +
    'globalThis.pollEndsAt = pollEndsAt;' +
    'globalThis.tallyPollVotes = tallyPollVotes;' +
    'globalThis.pollShare = pollShare;',
  ctx,
  { filename: 'sidepanel-poll-slice.js' }
);
const { pollOptionId, pollOptions, pollIsMultiple, pollEndsAt, tallyPollVotes, pollShare } = ctx;

const POLL_ID = 'p'.repeat(64);
const OTHER_POLL = 'q'.repeat(64);

function poll(opts = {}) {
  const tags = [
    ['option', 'aaa', 'Yay'],
    ['option', 'bbb', 'Nay'],
    ['option', 'ccc', 'Undecided'],
  ];
  if (opts.multiple) tags.push(['polltype', 'multiplechoice']);
  if (opts.polltype) tags.push(['polltype', opts.polltype]);
  if (opts.endsAt) tags.push(['endsAt', String(opts.endsAt)]);
  return { id: POLL_ID, kind: 1068, pubkey: 'author', created_at: 1000, tags, content: 'Q?' };
}

let seq = 0;
function vote(pubkey, responses, opts = {}) {
  seq += 1;
  return {
    id: (opts.id || 'v' + seq).padEnd(64, '0'),
    kind: 1018,
    pubkey,
    created_at: opts.at || 2000,
    tags: [['e', opts.poll || POLL_ID]].concat(responses.map((r) => ['response', r])),
  };
}

function countsOf(result) {
  return Object.fromEntries(result.counts);
}

// The lifted functions run in a vm, so the objects they return carry that realm's
// Object prototype and assert.deepEqual reports "same structure but not
// reference-equal". Round-tripping brings the value into this realm so the comparison
// is about the data, which is the thing under test.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('one vote per pubkey: the latest replaces the earlier one', () => {
  // Voting twice is changing your mind, not voting twice. Without this a poll can be
  // run up by one person reposting their ballot.
  const r = tallyPollVotes(poll(), [
    vote('alice', ['aaa'], { at: 2000 }),
    vote('alice', ['bbb'], { at: 2500 }),
    vote('bob', ['aaa'], { at: 2100 }),
  ]);
  assert.deepEqual(countsOf(r), { aaa: 1, bbb: 1, ccc: 0 });
  assert.equal(r.voters, 2, 'two people voted, whatever the event count');
});

test('a tie on created_at resolves the same way every load', () => {
  // Two events for one pubkey at the identical second is not hypothetical: clients
  // stamp in whole seconds. Breaking the tie on arrival order would mean the same poll
  // showed different numbers on a refresh, which reads as the count being made up.
  const a = vote('alice', ['aaa'], { at: 2000, id: 'aaa-low' });
  const b = vote('alice', ['bbb'], { at: 2000, id: 'zzz-high' });
  const forward = countsOf(tallyPollVotes(poll(), [a, b]));
  const backward = countsOf(tallyPollVotes(poll(), [b, a]));
  assert.deepEqual(forward, backward, 'order of arrival must not change the result');
  assert.deepEqual(forward, { aaa: 0, bbb: 1, ccc: 0 }, 'the higher id wins the tie');
});

test('nothing after endsAt counts, whatever the relay sends', () => {
  // The query asks with `until`, but a relay answers with whatever it likes, and a
  // result that keeps moving after the poll closed is worse than one that is wrong.
  const r = tallyPollVotes(poll({ endsAt: 3000 }), [
    vote('alice', ['aaa'], { at: 2999 }),
    vote('bob', ['aaa'], { at: 3001 }),
    vote('carol', ['bbb'], { at: 3000 }),
  ]);
  assert.deepEqual(countsOf(r), { aaa: 1, bbb: 1, ccc: 0 }, 'the late ballot is not counted');
  assert.equal(r.voters, 2);
});

test('a late vote does not resurrect an earlier one it should have replaced', () => {
  // alice votes in time, then again after the close. The late event is the newest, so a
  // naive "latest wins" that filtered afterwards would drop her entirely.
  const r = tallyPollVotes(poll({ endsAt: 3000 }), [
    vote('alice', ['aaa'], { at: 2900 }),
    vote('alice', ['bbb'], { at: 3500 }),
  ]);
  assert.deepEqual(countsOf(r), { aaa: 1, bbb: 0, ccc: 0 }, 'her valid ballot still stands');
});

test('single choice counts the first response tag and no others', () => {
  const r = tallyPollVotes(poll(), [vote('alice', ['aaa', 'bbb', 'ccc'])]);
  assert.deepEqual(countsOf(r), { aaa: 1, bbb: 0, ccc: 0 });
  assert.equal(r.voters, 1, 'one person, one vote, however many tags they wrote');
});

test('SINGLE CHOICE DOES NOT FALL THROUGH TO THE FIRST RECOGNIZED TAG', () => {
  // The spec says the first response tag is the response. Skipping past an
  // unrecognized one to find a usable id sounds forgiving and is a hole: anyone could
  // cast a real single-choice vote by listing junk ahead of it, and clients that read
  // the spec literally would show a different total for the same events.
  const r = tallyPollVotes(poll(), [vote('alice', ['not-an-option', 'aaa'])]);
  assert.deepEqual(countsOf(r), { aaa: 0, bbb: 0, ccc: 0 });
  assert.equal(r.voters, 0, 'a ballot for nothing is not a voter');
});

test('multiple choice counts each distinct id once, order irrelevant', () => {
  const r = tallyPollVotes(poll({ multiple: true }), [
    vote('alice', ['bbb', 'aaa', 'bbb']),
    vote('bob', ['ccc']),
  ]);
  assert.deepEqual(countsOf(r), { aaa: 1, bbb: 1, ccc: 1 }, 'the repeat of bbb is one vote');
  assert.equal(r.voters, 2);
});

test('ids that are not options of this poll are dropped', () => {
  const r = tallyPollVotes(poll({ multiple: true }), [vote('alice', ['aaa', 'zzz'])]);
  assert.deepEqual(countsOf(r), { aaa: 1, bbb: 0, ccc: 0 });
});

test('a vote e-tagging a different poll never lands here', () => {
  const r = tallyPollVotes(poll(), [
    vote('alice', ['aaa'], { poll: OTHER_POLL }),
    vote('bob', ['aaa']),
  ]);
  assert.deepEqual(countsOf(r), { aaa: 1, bbb: 0, ccc: 0 });
  assert.equal(r.voters, 1);
});

test('THE SHARE DENOMINATOR IS VOTERS, NOT VOTES', () => {
  // Six ballots, each picking two of three options: twelve votes, six voters. Dividing
  // by the vote total reports every option at half its real support, which on a
  // multiple-choice poll makes a unanimous option look like a minority.
  const votes = [];
  for (let i = 0; i < 6; i += 1) votes.push(vote('voter' + i, ['aaa', 'bbb']));
  const r = tallyPollVotes(poll({ multiple: true }), votes);
  assert.equal(r.voters, 6);
  assert.equal(r.counts.get('aaa'), 6);
  assert.equal(pollShare(r.counts.get('aaa'), r.voters), 1, 'every voter picked it: 100%');
  const votesCast = [...r.counts.values()].reduce((a, b) => a + b, 0);
  assert.equal(votesCast, 12, 'the sum of counts exceeds the voter count, which is the trap');
});

test('an absent or unrecognized polltype is single choice', () => {
  // The stricter reading on purpose: guessing "multiple" from an unknown value would
  // let one ballot add several votes.
  assert.equal(pollIsMultiple(poll()), false, 'absent');
  assert.equal(pollIsMultiple(poll({ polltype: 'singlechoice' })), false);
  assert.equal(pollIsMultiple(poll({ polltype: 'ranked' })), false, 'unknown value');
  assert.equal(pollIsMultiple(poll({ multiple: true })), true);

  const r = tallyPollVotes(poll({ polltype: 'ranked' }), [vote('alice', ['aaa', 'bbb'])]);
  assert.deepEqual(countsOf(r), { aaa: 1, bbb: 0, ccc: 0 }, 'counted as single choice');
});

test('option tags: malformed dropped, duplicate ids dropped, order kept', () => {
  // A duplicate id is dropped rather than merged because two options sharing an id
  // cannot be told apart by a vote, so merging them would invent a choice nobody made.
  const ev = {
    tags: [
      ['option', 'aaa', 'First'],
      ['option', 'bbb'],
      ['option', '', 'No id'],
      ['option', 'aaa', 'Duplicate id'],
      ['option', 'ccc', 'Last'],
      ['relay', 'wss://example.com'],
    ],
  };
  assert.deepEqual(plain(pollOptions(ev)), [
    { id: 'aaa', label: 'First' },
    { id: 'ccc', label: 'Last' },
  ]);
});

test('an empty label is a real option, not a malformed one', () => {
  // Distinct from the missing-third-element case above: a poll can legitimately carry a
  // blank label, and dropping it would renumber every option after it.
  assert.deepEqual(plain(pollOptions({ tags: [['option', 'aaa', '']] })), [{ id: 'aaa', label: '' }]);
});

test('endsAt: absent, junk and non-positive all read as no end date', () => {
  assert.equal(pollEndsAt(poll()), null);
  assert.equal(pollEndsAt({ tags: [['endsAt', 'soon']] }), null);
  assert.equal(pollEndsAt({ tags: [['endsAt', '0']] }), null);
  assert.equal(pollEndsAt({ tags: [['endsAt', '-5']] }), null);
  assert.equal(pollEndsAt(poll({ endsAt: 1720493296 })), 1720493296);
});

test('option ids are alphanumeric and do not collide', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i += 1) {
    const id = pollOptionId();
    assert.match(id, /^[a-z0-9]{9}$/, 'NIP-88 asks for an alphanumeric id');
    ids.add(id);
  }
  assert.equal(ids.size, 500, 'ids within one session must not repeat');
});

test('no votes at all is zero, not a divide by zero', () => {
  const r = tallyPollVotes(poll(), []);
  assert.deepEqual(countsOf(r), { aaa: 0, bbb: 0, ccc: 0 });
  assert.equal(r.voters, 0);
  assert.equal(pollShare(0, 0), 0, 'a poll nobody has answered renders, it does not NaN');
});

// ---- the ballots behind the counts ---------------------------------------------------

test('THE BALLOTS NAME EXACTLY THE PEOPLE THE COUNT COUNTED', () => {
  // The voter list is drawn from the same pass, so the two can never disagree. A ballot
  // that was not counted must not appear in it, and every one that was must.
  const r = tallyPollVotes(poll(), [
    vote('alice', ['aaa'], { at: 2000 }),
    vote('bob', ['bbb'], { at: 2100 }),
    vote('carol', ['not-an-option'], { at: 2200 }),
  ]);
  assert.equal(r.voters, 2);
  assert.equal(r.ballots.length, r.voters, 'the list and the number are the same fact');
  assert.deepEqual(plain(r.ballots.map((b) => b.pubkey)).sort(), ['alice', 'bob']);
  assert.ok(!r.ballots.some((b) => b.pubkey === 'carol'), 'a ballot for nothing is not a voter');
});

test('a ballot carries what that person actually picked', () => {
  const r = tallyPollVotes(poll({ multiple: true }), [
    vote('alice', ['aaa', 'ccc'], { at: 2000 }),
    vote('bob', ['bbb'], { at: 2100 }),
  ]);
  const by = Object.fromEntries(plain(r.ballots).map((b) => [b.pubkey, b.picked]));
  assert.deepEqual(by.alice, ['aaa', 'ccc'], 'both of them, in the order they were cast');
  assert.deepEqual(by.bob, ['bbb']);
});

test('changing your mind shows the ballot you ended on, once', () => {
  // The same rule the counts use. A list showing both would name one person twice and
  // report a vote nobody holds any more.
  const r = tallyPollVotes(poll(), [
    vote('alice', ['aaa'], { at: 2000 }),
    vote('alice', ['bbb'], { at: 2500 }),
  ]);
  assert.equal(r.ballots.length, 1);
  assert.deepEqual(plain(r.ballots[0].picked), ['bbb']);
  assert.equal(r.ballots[0].at, 2500, 'and the time of the ballot that stands');
});

test('a single-choice ballot lists one pick even when it named several', () => {
  // NIP-88 says the first response tag wins on a single-choice poll. The list has to say
  // the same thing the bar does, or it reads as votes going missing.
  const r = tallyPollVotes(poll(), [vote('alice', ['aaa', 'bbb'], { at: 2000 })]);
  assert.deepEqual(plain(r.ballots[0].picked), ['aaa']);
  assert.deepEqual(countsOf(r), { aaa: 1, bbb: 0, ccc: 0 });
});

test('ballots come back newest first', () => {
  const r = tallyPollVotes(poll(), [
    vote('alice', ['aaa'], { at: 2000 }),
    vote('bob', ['bbb'], { at: 2400 }),
    vote('carol', ['ccc'], { at: 2200 }),
  ]);
  assert.deepEqual(plain(r.ballots.map((b) => b.pubkey)), ['bob', 'carol', 'alice']);
});

test('a vote after the poll closed is in neither the count nor the list', () => {
  const r = tallyPollVotes(poll({ endsAt: 2300 }), [
    vote('alice', ['aaa'], { at: 2200 }),
    vote('bob', ['bbb'], { at: 2400 }),
  ]);
  assert.equal(r.voters, 1);
  assert.deepEqual(plain(r.ballots.map((b) => b.pubkey)), ['alice']);
});

test('a vote on another poll never reaches the list', () => {
  const r = tallyPollVotes(poll(), [
    vote('alice', ['aaa'], { at: 2000 }),
    vote('mallory', ['aaa'], { at: 2100, poll: OTHER_POLL }),
  ]);
  assert.deepEqual(plain(r.ballots.map((b) => b.pubkey)), ['alice']);
});
