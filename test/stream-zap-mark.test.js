'use strict';

// The mark after a stream's zap total. While the history loads it is an ellipsis. Once it has
// loaded, a total that can be trusted is shown plain: a short stream that reads 1,000 sats
// needs no caveat. A plus ("at least this much") is for a total that is hard to pin down: a
// history longer than a scan will walk, or too few relays finishing a clean pass.
//
// It used to be a plus whenever every relay in a long list finished cleanly, which almost
// never happened, so the ellipsis stayed on; and a first fix that only relaxed that rule put
// a plus on every total. Neither was asked for.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../stream-core');
const { zapTotalMark, zapTotalUncertain, ZAP_QUORUM, zapHistory } = core;

test('while the history loads, a total is marked unfinished', () => {
  assert.equal(zapTotalMark({ count: 3, loading: true, answered: 0, truncated: false }), '…');
  assert.equal(zapTotalMark({ count: 0, loading: true, answered: 0 }), '…');
  assert.equal(zapTotalMark({ count: 3, loading: true, answered: 7, truncated: false }), '…', 'loading outranks everything else');
});

test('A TOTAL THAT CAN BE TRUSTED IS SHOWN PLAIN: no plus on a short stream', () => {
  assert.equal(zapTotalMark({ count: 4, loading: false, answered: 7, truncated: false }), '');
  assert.equal(zapTotalMark({ count: 4, loading: false, answered: ZAP_QUORUM, truncated: false }), '');
});

test('a relay that merely failed does not put a plus on a total the others agree on', () => {
  // 3 of 5 relays finished; the other two timed out. Truncated is about limits, not failures.
  assert.equal(zapTotalMark({ count: 252, loading: false, answered: 3, truncated: false }), '');
});

test('a history longer than a scan will walk gets the plus', () => {
  assert.equal(zapTotalMark({ count: 252, loading: false, answered: 5, truncated: true }), '+');
});

test('too few relays finishing gets the plus too', () => {
  assert.equal(zapTotalMark({ count: 252, loading: false, answered: 1, truncated: false }), '+');
  assert.equal(zapTotalMark({ count: 252, loading: false, answered: 0, truncated: false }), '+');
  assert.equal(zapTotalMark({ count: 252, loading: false }), '+', 'an unknown count is not a quorum');
});

test('no zaps: a dash once it is known, never a plus or nothing', () => {
  assert.equal(zapTotalMark({ count: 0, loading: false, answered: 7, truncated: false }), '—');
  assert.equal(zapTotalMark({ count: 0, loading: false, answered: 0, truncated: true }), '—');
});

test('the tooltip follows the same rule as the mark', () => {
  assert.equal(zapTotalUncertain({ answered: 5, truncated: false }), false);
  assert.equal(zapTotalUncertain({ answered: 5, truncated: true }), true);
  assert.equal(zapTotalUncertain({ answered: 1, truncated: false }), true);
  assert.equal(ZAP_QUORUM, 2, 'a single friendly relay is not enough to call it a count');
});

// ---- the real history scan: which relays finish, which stop at a limit, which fail ----
const none = { events: [], complete: true };
const failedPage = { events: [], complete: false };
const ev = (t) => ({ id: String(t), created_at: t });

async function scan(perRelay, opts = {}) {
  return zapHistory({
    sources: Object.keys(perRelay), filter: { until: 1000 }, signal: new AbortController().signal,
    accept: async () => {},
    query: async (relay, request) => perRelay[relay](request),
    ...opts,
  });
}
const finishes = () => async () => none;
const fails = () => async () => failedPage;

test('relays that finish are counted, and a failing one is not a truncation', async () => {
  const r = await scan({ a: finishes(), b: finishes(), c: finishes(), d: fails() });
  assert.equal(r.complete, false);
  assert.equal(r.answered, 3);
  assert.equal(r.truncated, false);
  assert.equal(zapTotalMark({ count: 252, loading: false, ...r }), '', 'three clean relays: a plain total');
});

test('with only one relay finishing the scan reports it, and the mark is a plus', async () => {
  const r = await scan({ a: finishes(), b: fails(), c: fails(), d: fails() });
  assert.equal(r.answered, 1);
  assert.equal(r.truncated, false);
  assert.equal(zapTotalMark({ count: 252, loading: false, ...r }), '+');
});

test('every relay finishing is complete, and plain', async () => {
  const r = await scan({ a: finishes(), b: finishes() });
  assert.equal(r.complete, true);
  assert.equal(r.truncated, false);
  assert.equal(zapTotalMark({ count: 1, loading: false, ...r }), '');
});

test('A RELAY THAT STOPS AT THE PAGE LIMIT WITH MORE BEHIND IT IS A TRUNCATION', async () => {
  // Always another full page: the scan walks maxPages of it and gives up with history left.
  let t = 1000;
  const endless = async (request) => ({ events: Array.from({ length: 3 }, () => ev(t--)), complete: true });
  // The boundary query (since === until) returns a single event so it is never the 1,000 cap.
  const relay = async (request) => (request.since !== undefined && request.since === request.until) ? { events: [ev(request.until)], complete: true } : endless(request);
  const r = await scan({ a: relay, b: finishes(), c: finishes() }, { pageSize: 3, maxPages: 4 });
  assert.equal(r.truncated, true);
  assert.equal(r.complete, false);
  assert.equal(r.answered, 2, 'the two that finished still count');
  assert.equal(zapTotalMark({ count: 224600, loading: false, ...r }), '+');
});

test('a second holding 1,000 receipts cannot be proved exhausted: a truncation', async () => {
  const crowded = async (request) => {
    if (request.since !== undefined && request.since === request.until) return { events: Array.from({ length: 1000 }, (_, i) => ({ id: 'x' + i, created_at: request.until })), complete: true };
    return { events: [ev(900)], complete: true };
  };
  const r = await scan({ a: crowded, b: finishes() });
  assert.equal(r.truncated, true);
});

test('A RELAY THAT THROWS IS A FAILURE, NOT A TRUNCATION: a dropped connection does not put a plus on a total', async () => {
  const drops = async () => { throw new Error('connection closed'); };
  const r = await scan({ a: drops, b: finishes(), c: finishes() });
  assert.equal(r.truncated, false);
  assert.equal(r.answered, 2);
  assert.equal(r.complete, false);
  assert.equal(zapTotalMark({ count: 12, loading: false, ...r }), '', 'two clean relays, one that dropped: a plain total');
});

test('an aborted scan is a failure, not a truncation, and is never complete', async () => {
  const controller = new AbortController();
  const slow = async () => { controller.abort(); return none; };
  const r = await scan({ a: slow }, { signal: controller.signal });
  assert.equal(r.complete, false);
  assert.equal(r.truncated, false);
});

test('the player passes the scan\'s answer to the mark and the tooltip', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'streams.js'), 'utf8');
  assert.match(src, /let loading=true, partial=true, answered=0, truncated=false,/);
  assert.match(src, /const mark=SidecarStreams\.zapTotalMark\(\{count:session\.totals\.count,loading,answered,truncated\}\);/);
  assert.match(src, /setZapDigits\(output,session\.totals\.count \? value\+mark : mark,animate\);/);
  assert.match(src, /partial=!result\.complete;answered=result\.answered;truncated=!!result\.truncated;/);
  assert.match(src, /SidecarStreams\.zapTotalUncertain\(\{answered,truncated\}\) \? t\('Zap history incomplete; retrying available relays\.'\)/);
  assert.doesNotMatch(src, /loading \|\| partial\?'…':'\+'/, 'the all-or-nothing rule is back');
});

test('an incomplete history is still retried on a timer', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'streams.js'), 'utf8');
  assert.match(src, /zapHistoryTimer=setTimeout\(\(\)=>\{[^}]*recover\(\)/, 'the incomplete scan is retried');
});
