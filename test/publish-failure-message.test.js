'use strict';

// Unit coverage for publishFailureMessage() in sidepanel.js.
//
// THE BUG (reported 2026-08-05): posting a note failed and the toast showed eight
// stacked lines of
//
//     wss://filter.nostr.wine/: connection failure: connection timed out |
//     wss://relay.azzamo.net/: connection failure: connection timed out | ...
//
// — a wall of near-identical text that filled the panel and told the user nothing
// actionable. And the underlying cause wasn't eight simultaneous relay outages: the
// panel was holding too many subscriptions (one set per ACCOUNT, three filters each,
// across every relay), so relays past their per-connection REQ cap stopped answering.
// The message should point at that rather than list eight identical errors.

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

const ctx = { console, URL, Map, Set, String, Number, Array };
vm.createContext(ctx);
vm.runInContext(
  lift(/function publishFailureMessage\(targets, results\) \{[\s\S]*?\n  \}/, 'publishFailureMessage') + '\n' +
  lift(/function hostOf\(url\) \{[\s\S]*?\n  \}/, 'hostOf') + '\n' +
  'globalThis.msg = publishFailureMessage;' +
  'globalThis.hostOf = hostOf;',
  ctx
);
const { msg, hostOf } = ctx;

const EIGHT = [
  'wss://filter.nostr.wine/', 'wss://relay.azzamo.net/', 'wss://nostr.wine/',
  'wss://relay.poster.place/', 'wss://nos.lol/', 'wss://relay.snort.social/',
  'wss://nostr.mom/', 'wss://offchain.pub/',
];
const timedOut = (n) => Array.from({ length: n },
  () => ({ status: 'fulfilled', value: 'connection failure: connection timed out' }));
const refused = (n) => Array.from({ length: n },
  () => ({ status: 'fulfilled', value: 'blocked: pubkey not allowed' }));

// ---- the reported case ----------------------------------------------------------

test('eight identical timeouts collapse to one sentence', () => {
  const m = msg(EIGHT, timedOut(8));
  assert.ok(m.length < 160, 'must fit a toast, not fill the panel: ' + m.length + ' chars');
  assert.ok(!m.includes('|'), 'no pipe-joined list of relays');
  assert.ok(!m.includes('wss://'), 'raw relay URLs belong in a log, not a toast');
  assert.match(m, /Check your connection/, 'all-timed-out is almost never eight outages');
});

test('the message never repeats the same reason twice', () => {
  const m = msg(EIGHT, timedOut(8));
  const hits = (m.match(/timed out/g) || []).length;
  assert.ok(hits <= 1, 'said "timed out" ' + hits + ' times');
});

test('it says the note was kept', () => {
  // clearComposeDraft only runs after a SUCCESSFUL publish, and the modal's close
  // handler persists when !published — so this claim is true and worth making. The
  // old message left the user assuming the text was lost.
  assert.match(msg(EIGHT, timedOut(8)), /saved as a draft/);
});

// ---- grouping -------------------------------------------------------------------

test('mixed reasons are grouped, not listed per relay', () => {
  const m = msg(EIGHT, [
    ...timedOut(4),
    { status: 'fulfilled', value: 'blocked: not on the whitelist' },
    { status: 'fulfilled', value: 'blocked: not on the whitelist' },
    { status: 'rejected', reason: new Error('rate-limited, slow down') },
    { status: 'fulfilled', value: 'auth-required: authenticate first' },
  ]);
  assert.match(m, /timed out/);
  assert.match(m, /refused the note/);
  assert.ok(m.length < 260, 'still bounded with four distinct reasons: ' + m.length);
});

test('a large group is summarized with a +N more', () => {
  const m = msg(EIGHT, timedOut(5).concat(refused(3)));
  assert.match(m, /\+\d+ more/, 'five relays should not all be named');
});

test('groups are ordered largest first', () => {
  // The dominant failure is the one worth reading first.
  const m = msg(EIGHT, refused(1).concat(timedOut(7)));
  assert.ok(m.indexOf('timed out') < m.indexOf('refused the note'),
    'the 7-relay group should precede the 1-relay group');
});

test('at most three reason groups are shown', () => {
  const m = msg(EIGHT, [
    { status: 'fulfilled', value: 'connection failure: connection timed out' },
    { status: 'fulfilled', value: 'blocked: nope' },
    { status: 'rejected', reason: new Error('rate-limited') },
    { status: 'fulfilled', value: 'auth-required: hello' },
    { status: 'fulfilled', value: 'error: something bespoke' },
    { status: 'fulfilled', value: 'error: another bespoke thing' },
    ...timedOut(2),
  ]);
  assert.ok(m.split(';').length <= 3, 'more than three groups makes it a list again');
});

// ---- reason wording -------------------------------------------------------------

test('raw relay noise is translated to plain language', () => {
  const cases = [
    ['connection failure: connection timed out', /timed out/],
    ['failed to connect to wss://x', /couldn't connect/],
    ['blocked: pubkey not allowed', /refused the note/],
    ['restricted: not permitted', /refused the note/],
    ['rate-limited: slow down', /rate-limited us/],
    ['auth-required: please authenticate', /wants authentication/],
  ];
  for (const [raw, expected] of cases) {
    const m = msg(['wss://a.example/', 'wss://b.example/'],
      [{ status: 'fulfilled', value: raw }, { status: 'fulfilled', value: 'blocked: x' }]);
    assert.match(m, expected, 'for raw reason: ' + raw);
  }
});

test('an unrecognized reason is shown verbatim but truncated', () => {
  const long = 'error: ' + 'x'.repeat(200);
  const m = msg(['wss://a.example/', 'wss://b.example/'],
    [{ status: 'fulfilled', value: long }, { status: 'fulfilled', value: 'blocked: y' }]);
  assert.ok(m.length < 220, 'a chatty relay must not blow up the toast: ' + m.length);
});

test("the 'connection failure:' prefix is stripped from a bespoke reason", () => {
  const m = msg(['wss://a.example/', 'wss://b.example/'], [
    { status: 'fulfilled', value: 'connection failure: something unusual happened' },
    { status: 'fulfilled', value: 'blocked: y' },
  ]);
  assert.ok(!m.includes('connection failure:'), 'the prefix is noise: ' + m);
});

// ---- pluralization --------------------------------------------------------------

test('one relay reads as singular', () => {
  // "Couldn't reach all 1 of your relays" was the first draft of this.
  const m = msg(['wss://nos.lol/'], timedOut(1));
  assert.match(m, /your relay\b/);
  assert.ok(!/\b1 (of your )?relays/.test(m), 'awkward singular: ' + m);
});

test('one relay refusing also reads as singular', () => {
  const m = msg(['wss://nos.lol/'], refused(1));
  assert.match(m, /^Your relay refused/);
});

test('several relays read as plural with a count', () => {
  assert.match(msg(EIGHT, timedOut(8)), /all 8 of your relays/);
  assert.match(msg(EIGHT.slice(0, 3), refused(3)), /All 3 relays/);
});

// ---- rejected promises ----------------------------------------------------------

test('a rejected promise is handled like a returned reason', () => {
  // Two relays with DIFFERENT reasons, so the grouped branch runs and the reason text
  // is visible. With one relay (or one shared reason) the single-reason branch fires
  // instead and deliberately says "Couldn't reach…" rather than naming the timeout —
  // see the test above.
  const m = msg(['wss://a.example/', 'wss://b.example/'], [
    { status: 'rejected', reason: new Error('connection timed out') },
    { status: 'fulfilled', value: 'blocked: nope' },
  ]);
  assert.match(m, /timed out/, 'a rejection must be read the same as a returned string');
  assert.match(m, /a\.example/, 'and attributed to its relay');
});

test('a rejection with no message does not produce "undefined"', () => {
  const m = msg(['wss://a.example/'], [{ status: 'rejected', reason: null }]);
  assert.ok(!m.includes('undefined'), m);
  assert.ok(!m.includes('null'), m);
});

// ---- it is actually wired in ----------------------------------------------------

test('publishToRelays uses publishFailureMessage, not an inline join', () => {
  // Every test above exercises the function directly, so all of them still pass if
  // publishToRelays goes back to pasting raw errors together — which is exactly what
  // it used to do. Caught by mutation-testing the revert and seeing zero failures.
  const fn = source.match(/async function publishToRelays\(relays, signed\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, 'could not find publishToRelays');
  assert.match(fn[0], /throw new Error\(publishFailureMessage\(targets, results\)\)/,
    'the failure path must go through publishFailureMessage');
  assert.ok(!/join\(' \| '\)/.test(fn[0]),
    'no pipe-joined relay list — that was the reported ugliness');
});

// ---- the root cause: subscription load ------------------------------------------
//
// The ugly message was the symptom. The cause was subscription count: initNotifSubs
// opened a set for EVERY account (three filters each) across every relay and never
// closed any of them, so with 3 accounts and 8 relays the panel held ~144 concurrent
// REQs on one shared pool. Relays cap subscriptions per connection, so past the limit
// they stop answering — and a publish then fails on every relay at once.
//
// Structural tests: the behavior is DOM- and network-bound, but the two decisions
// that fix it are visible in the source and are exactly what a later edit would undo.

test('notification subscriptions are opened for the active account only', () => {
  const fn = source.match(/async function initNotifSubs\(\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, 'could not find initNotifSubs');
  assert.ok(!/for \(const a of state\.accounts\)/.test(fn[0]),
    'subscribing per account is what exhausted the relay connections');
  assert.match(fn[0], /state\.accounts\.find\(\(a\) => a\.pubkey === state\.activePubkey\)/,
    'it should resolve the active account and subscribe for that one');
});

test('switching accounts closes the previous live subscriptions', () => {
  // liveSub was stored on the cache and never closed anywhere — the leak that let
  // subscriptions accumulate for the life of the panel.
  assert.match(source, /function closeNotifSubsExcept\(keepPubkey\)/,
    'there must be something that closes stale subscriptions');
  const fn = source.match(/async function initNotifSubs\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /closeNotifSubsExcept\(active\.pubkey\)/,
    'and initNotifSubs must call it when it re-subscribes');
});

test('re-subscribing reuses the cache instead of discarding collected events', () => {
  // A fresh { events: [] } on every switch would reset the unseen count to zero and
  // throw away notifications already received for that account.
  const fn = source.match(/async function initNotifSubs\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /_notifCache\.get\(a\.pubkey\) \|\| \{ events: \[\], liveSub: null \}/,
    'the existing cache must be reused when present');
});

// ---- hostOf ---------------------------------------------------------------------

test('hostOf strips the scheme and trailing slash', () => {
  assert.equal(hostOf('wss://relay.nostr.wine/'), 'relay.nostr.wine');
  assert.equal(hostOf('wss://nos.lol'), 'nos.lol');
  assert.equal(hostOf('ws://localhost:7777/'), 'localhost:7777');
});

test('hostOf survives a malformed URL', () => {
  assert.equal(hostOf('not a url'), 'not a url');
  assert.equal(hostOf(''), '');
});
