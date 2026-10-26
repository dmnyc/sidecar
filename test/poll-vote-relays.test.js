'use strict';

// Coverage for the relay set poll votes are queried from, in sidepanel.js.
//
// NIP-88 means a ballot to reach the relays named in the poll, but the clients most
// people vote from publish it to their own backends instead, so a count asked only of
// the poll's relays is a subset of the real one. The set is built by one pure function
// shared by both surfaces that count votes, and it is tested against the real function
// in a vm — the same lift approach poll-tally.test.js uses, because sidepanel.js is one
// IIFE around chrome APIs and cannot be required.

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
  lift(/const POLL_VOTE_DISCOVERY_RELAYS = \[[\s\S]*?\];/, 'POLL_VOTE_DISCOVERY_RELAYS') + '\n' +
    lift(/function pollVoteQueryUrls\(pollUrls, accountUrls\)\s*\{[\s\S]*?\n  \}/, 'pollVoteQueryUrls') + '\n' +
    'globalThis.POLL_VOTE_DISCOVERY_RELAYS = POLL_VOTE_DISCOVERY_RELAYS;' +
    'globalThis.pollVoteQueryUrls = pollVoteQueryUrls;',
  ctx,
  { filename: 'sidepanel-poll-relay-slice.js' }
);
const { POLL_VOTE_DISCOVERY_RELAYS, pollVoteQueryUrls } = ctx;

// The lifted function returns arrays from the vm's realm; round-trip before comparing,
// the same plain() trick poll-tally.test.js explains.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('a vote query has relays to ask even when the poll and the account name none', () => {
  // The regression this whole file is about. A poll whose relay tags point at dead
  // relays, on an account that lists none either, used to build an empty set, skip the
  // query entirely, and show zero forever while every other client counted votes.
  assert.deepEqual(plain(pollVoteQueryUrls([], [])), plain(POLL_VOTE_DISCOVERY_RELAYS));
  assert.ok(POLL_VOTE_DISCOVERY_RELAYS.length > 0, 'the discovery set is not empty');
});

test('the measured carriers are in the discovery set', () => {
  // Primal, Damus and Snort file their users' ballots with these backends and nowhere
  // else; on a live poll in October 2026 they held 10, 6 and 4 of 12 ballots while the
  // poll's own relays held 4 between them. A list without them is the undercount again.
  for (const url of ['wss://relay.primal.net', 'wss://relay.damus.io', 'wss://relay.snort.social']) {
    assert.ok(POLL_VOTE_DISCOVERY_RELAYS.includes(url), url + ' is a carrier of ballots');
  }
  assert.ok(POLL_VOTE_DISCOVERY_RELAYS.every((u) => /^wss:\/\/[^/]+$/.test(u)), 'every entry is a bare wss URL');
  assert.equal(new Set(POLL_VOTE_DISCOVERY_RELAYS).size, POLL_VOTE_DISCOVERY_RELAYS.length, 'no duplicates');
});

test('a relay named by both the poll and the discovery set is asked once', () => {
  const urls = plain(pollVoteQueryUrls(['wss://relay.primal.net', 'wss://poll.example'], []));
  assert.equal(urls.filter((u) => u === 'wss://relay.primal.net').length, 1, 'deduped');
  assert.ok(urls.includes('wss://poll.example'), 'the poll\'s own relay is still asked');
});

test('the poll\'s relays come first, then the account\'s, then the discovery set', () => {
  // Priority, pinned: a compliant ballot sits on the poll's relays, so those answers
  // are the ones worth arriving first. Nothing in the query depends on the order —
  // this holds it still, so a reorder is a decision, not an accident.
  const urls = plain(pollVoteQueryUrls(['wss://poll.example'], ['wss://account.example']));
  assert.deepEqual(urls.slice(0, 2), ['wss://poll.example', 'wss://account.example']);
  assert.deepEqual(urls.slice(2), plain(POLL_VOTE_DISCOVERY_RELAYS));
});
