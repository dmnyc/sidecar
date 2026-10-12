'use strict';

// The mark after a stream's zap total. "…" meant "cannot be trusted yet" and "+" meant "at
// least this much", but a "+" needed EVERY relay in a long list to finish a clean pass, and
// the list includes relays that hold no zap receipts at all. One that times out keeps the
// whole pass partial, so the "…" stayed on for good. A quorum of relays that did finish is
// what the "+" needs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../stream-core');
const { zapTotalMark, ZAP_QUORUM, zapHistory } = core;

test('while the history loads, a total is marked unfinished', () => {
  assert.equal(zapTotalMark({ count: 3, loading: true, partial: true, answered: 0 }), '…');
  assert.equal(zapTotalMark({ count: 0, loading: true, partial: true, answered: 0 }), '…');
  assert.equal(zapTotalMark({ count: 3, loading: true, partial: false, answered: 7 }), '…', 'loading outranks everything else');
});

test('every relay finished: at least this much', () => {
  assert.equal(zapTotalMark({ count: 3, loading: false, partial: false, answered: 7 }), '+');
});

test('THE REPORTED CASE: some relays never finish, but enough did, so it is a floor and not "loading"', () => {
  assert.equal(zapTotalMark({ count: 252, loading: false, partial: true, answered: ZAP_QUORUM }), '+');
  assert.equal(zapTotalMark({ count: 252, loading: false, partial: true, answered: 5 }), '+');
});

test('too few relays finished: still unfinished', () => {
  assert.equal(zapTotalMark({ count: 252, loading: false, partial: true, answered: 1 }), '…');
  assert.equal(zapTotalMark({ count: 252, loading: false, partial: true, answered: 0 }), '…');
  assert.equal(zapTotalMark({ count: 252, loading: false, partial: true }), '…', 'an unknown count is not a quorum');
});

test('no zaps: a dash once it is known, never a plus', () => {
  assert.equal(zapTotalMark({ count: 0, loading: false, partial: false, answered: 7 }), '—');
  assert.equal(zapTotalMark({ count: 0, loading: false, partial: true, answered: 0 }), '—');
});

test('the quorum is two, so a single friendly relay is not enough to claim a floor', () => {
  assert.equal(ZAP_QUORUM, 2);
});

// The real history scan, against relays of which some never finish.
const noEvents = { events: [], complete: true };
const failed = { events: [], complete: false };
async function scan(relayResults) {
  const sources = Object.keys(relayResults);
  const result = await zapHistory({
    sources, filter: {}, signal: new AbortController().signal,
    accept: async () => {},
    query: async (relay) => relayResults[relay],
  });
  return result;
}

test('one failing relay makes the pass partial, which is what used to pin the "…"', async () => {
  const r = await scan({ a: noEvents, b: noEvents, c: noEvents, d: failed });
  assert.equal(r.complete, false);
  assert.equal(r.answered, 3);
  assert.equal(zapTotalMark({ count: 252, loading: false, partial: !r.complete, answered: r.answered }), '+');
});

test('with only one relay finishing, the mark stays "…"', async () => {
  const r = await scan({ a: noEvents, b: failed, c: failed, d: failed });
  assert.equal(r.answered, 1);
  assert.equal(zapTotalMark({ count: 252, loading: false, partial: !r.complete, answered: r.answered }), '…');
});

test('every relay finishing is complete and a plus', async () => {
  const r = await scan({ a: noEvents, b: noEvents });
  assert.equal(r.complete, true);
  assert.equal(zapTotalMark({ count: 1, loading: false, partial: !r.complete, answered: r.answered }), '+');
});

test('the player asks this function and hands it the number of relays that finished', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'streams.js'), 'utf8');
  assert.match(src, /let loading=true, partial=true, answered=0,/);
  assert.match(src, /const mark=SidecarStreams\.zapTotalMark\(\{count:session\.totals\.count,loading,partial,answered\}\);/);
  assert.match(src, /setZapDigits\(output,session\.totals\.count \? value\+mark : mark,animate\);/);
  assert.match(src, /partial=!result\.complete;answered=result\.answered;/);
  assert.doesNotMatch(src, /loading \|\| partial\?'…':'\+'/, 'the all-or-nothing rule is back');
});

test('an incomplete history is still said so in the tooltip, and it still retries', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'streams.js'), 'utf8');
  assert.match(src, /Zap history incomplete; retrying available relays\./);
  assert.match(src, /zapHistoryTimer=setTimeout\(\(\)=>\{[^}]*recover\(\)/, 'the incomplete scan is retried on a timer');
});
