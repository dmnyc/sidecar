'use strict';

// THE (1) ON THE POLLS TAB THAT NEVER WENT AWAY.
//
// The capsule on the bell's Polls tab counted every poll the account had ever posted,
// so a single poll that ended in March held a (1) forever, and viewing the tally did
// nothing to it — nothing about the number meant "unread", so nothing about reading the
// list could clear it. The number now counts live polls: an end date still ahead, or an
// open-ended poll inside the seven-day watch window. Zero removes the capsule; the tab
// itself stays, because the tallies behind it are still worth reaching.
//
// Lifted and run rather than grepped, the way poll-list-states.test.js does it, because
// "does this poll still count" is the whole fix.

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
  // The state the lifted functions close over, declared in the same script so they
  // bind to these and not to the panel's own maps.
  'const _ownPollIds = new Map();\n' +
  'const _ownPollMeta = new Map();\n' +
  lift(/const POLL_WATCH_SECS = [^;]*;/, 'POLL_WATCH_SECS') + '\n' +
  lift(/function pollEndsAt\(ev\)\s*\{[\s\S]*?\n  \}/, 'pollEndsAt') + '\n' +
  lift(/function pollHasEnded\(endsAt\)\s*\{[\s\S]*?\n  \}/, 'pollHasEnded') + '\n' +
  lift(/function pollWatchExpiredAt\(createdAt, endsAt\)\s*\{[\s\S]*?\n  \}/, 'pollWatchExpiredAt') + '\n' +
  lift(/function pollWatchExpired\(ev\)\s*\{[\s\S]*?\n  \}/, 'pollWatchExpired') + '\n' +
  lift(/function pollIsLive\(createdAt, endsAt\)\s*\{[\s\S]*?\n  \}/, 'pollIsLive') + '\n' +
  lift(/function pollGroup\(ev\)\s*\{[\s\S]*?\n  \}/, 'pollGroup') + '\n' +
  lift(/function countLivePolls\(polls\)\s*\{[\s\S]*?\n  \}/, 'countLivePolls') + '\n' +
  lift(/function rememberPollMeta\(pubkey, ev\)\s*\{[\s\S]*?\n  \}/, 'rememberPollMeta') + '\n' +
  lift(/function rememberOwnPoll\(pubkey, id, ev\)\s*\{[\s\S]*?\n  \}/, 'rememberOwnPoll') + '\n' +
  lift(/function ownPollCount\(pubkey\)\s*\{[\s\S]*?\n  \}/, 'ownPollCount') + '\n' +
  lift(/function liveOwnPollCount\(pubkey\)\s*\{[\s\S]*?\n  \}/, 'liveOwnPollCount') + '\n' +
  lift(/function accountHasPolls\(pubkey\)\s*\{[\s\S]*?\n  \}/, 'accountHasPolls') + '\n' +
  'globalThis.rememberOwnPoll = rememberOwnPoll;' +
  'globalThis.ownPollCount = ownPollCount;' +
  'globalThis.liveOwnPollCount = liveOwnPollCount;' +
  'globalThis.accountHasPolls = accountHasPolls;' +
  'globalThis.countLivePolls = countLivePolls;' +
  'globalThis.pollIsLive = pollIsLive;' +
  'globalThis.__reset = () => { _ownPollIds.clear(); _ownPollMeta.clear(); };',
  ctx
);
const { rememberOwnPoll, ownPollCount, liveOwnPollCount, accountHasPolls, countLivePolls } = ctx;

const NOW = () => Math.floor(Date.now() / 1000);
const DAY = 86400;

// The shape the loaders and the composer hold: the whole event.
function pollEv(opts = {}) {
  const tags = [];
  if (opts.endsAt) tags.push(['endsAt', String(opts.endsAt)]);
  return { id: opts.id || 'p1', kind: 1068, content: 'Q?', created_at: opts.createdAt || NOW(), tags };
}

let n = 0;
const seed = (opts = {}) => {
  const ev = pollEv({ ...opts, id: opts.id || 'p' + ++n });
  rememberOwnPoll('pk', ev.id, ev);
  return ev;
};

test('THE CAPSULE COUNTS LIVE POLLS, CASE BY CASE', () => {
  ctx.__reset();
  seed({ endsAt: NOW() + DAY });          // still running
  seed({ endsAt: NOW() - DAY });          // ended yesterday
  seed({ createdAt: NOW() - 2 * DAY });   // open-ended and new
  seed({ createdAt: NOW() - 8 * DAY });   // open-ended, aged out
  seed({ createdAt: NOW() - 400 * DAY, endsAt: NOW() + DAY }); // the author's date wins over age

  assert.equal(ownPollCount('pk'), 5, 'every poll is known');
  assert.equal(liveOwnPollCount('pk'), 3, 'only the live ones hold the capsule');
});

test('ALL FINISHED MEANS NO CAPSULE AND THE TAB STILL THERE', () => {
  ctx.__reset();
  seed({ endsAt: NOW() - DAY });
  seed({ createdAt: NOW() - 30 * DAY }); // open-ended, long past the window

  assert.equal(liveOwnPollCount('pk'), 0, 'the capsule goes, as it already does at zero');
  assert.equal(accountHasPolls('pk'), true, 'the tab is gated on every poll, not the live ones');
});

test('THE BOUNDARY IS THE SEVENTH DAY, TO THE SECOND', () => {
  ctx.__reset();
  seed({ createdAt: NOW() - 7 * DAY });
  seed({ createdAt: NOW() - 7 * DAY + 1 });

  assert.equal(liveOwnPollCount('pk'), 1, 'the comparison is <=, so exactly seven days is out');
});

test('A POLL JUST SIGNED IS LIVE BEFORE ANY RELAY CONFIRMS IT', () => {
  ctx.__reset();
  // The publish path passes the signed event, so the count is seeded whole: posted
  // time and end date, not just the id.
  rememberOwnPoll('pk', 'fresh', pollEv({ id: 'fresh', endsAt: NOW() + 3 * DAY }));
  assert.equal(liveOwnPollCount('pk'), 1);
  assert.equal(ownPollCount('pk'), 1, 'and the id is in the filter set as before');

  // An id with no event behind it cannot be judged live, so it counts as nothing — but
  // it still reaches the vote filter, which wants ids and nothing else.
  rememberOwnPoll('pk', 'bare-id');
  assert.equal(ownPollCount('pk'), 2);
  assert.equal(liveOwnPollCount('pk'), 1);
});

test('THE LIST CORRECTS THE CAPSULE BY THE SAME RULE', () => {
  ctx.__reset();
  // The seed is judged from stored times; the correction reads whole events through
  // pollGroup. Same question, so the two cannot disagree about what counts.
  const polls = [
    pollEv({ id: 'a', endsAt: NOW() - DAY }),
    pollEv({ id: 'b', endsAt: NOW() + DAY }),
    pollEv({ id: 'c', createdAt: NOW() - 30 * DAY }),
    pollEv({ id: 'd', createdAt: NOW() - DAY }),
  ];
  assert.equal(countLivePolls(polls), 2);
  assert.equal(countLivePolls([]), 0);

  for (const ev of polls) rememberOwnPoll('pk', ev.id, ev);
  assert.equal(liveOwnPollCount('pk'), countLivePolls(polls), 'seed and correction agree');
});

// ---- where the corrections are wired, against the source ------------------------

const bare = source.replace(/^\s*\/\/.*$/gm, '');

test('THE SEED AND BOTH CORRECTIONS COUNT THE LIVE ONES', () => {
  assert.match(bare, /setCount\(liveOwnPollCount\(a\.pubkey\)\);/, 'the seed, the moment the sheet opens');
  assert.match(bare, /onCount\(countLivePolls\(cached\.polls\)\);/, 'the cache pass');
  assert.match(bare, /onCount\(countLivePolls\(polls\)\);/, 'and the relay answer that replaces it');
  // The tab itself answers a different question, and must keep answering it with every
  // poll: an all-finished account loses its capsule, not its way back to the tallies.
  assert.match(bare, /return ownPollCount\(pubkey\) > 0;/);
});
