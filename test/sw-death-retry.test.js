'use strict';

// Unit coverage for the content script's retry when the MV3 service worker was
// asleep and the message never landed.
//
// THE REPORT (2026-08-09): posting from Jumble failed, and reloading the whole
// extension was the only way to get the failed draft to send.
//
// Sidecar does not publish notes for a client — Jumble signs via window.nostr and
// publishes itself, and background.js has no relay pool at all. So the failure was
// in the SIGNING hop: the worker is evicted after ~30s idle, the message goes
// nowhere, Jumble waits out its own 30s timeout (signer-approval.ts) and reports
// "Failed to post". Reloading the extension gave a fresh worker, so the retry landed.
//
// The fix retries ONCE, and only for the failure that proves nothing was delivered.
// The distinction matters more than the retry: re-sending a request the background
// already processed would prompt a second time and produce a SECOND signature —
// a duplicate note, or a payment made twice.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

// The retry predicate, lifted verbatim so the test exercises the shipped regex.
const RETRYABLE = (() => {
  const m = source.match(/const RETRYABLE = (\/.*?\/i);/);
  if (!m) throw new Error('RETRYABLE not found in content.js');
  // eslint-disable-next-line no-eval
  return eval(m[1]);
})();

// ---- which failures may be retried ----------------------------------------------

test('an undelivered message IS retryable', () => {
  // Chrome's wording when the worker was not running and could not be woken. Nothing
  // reached the background: no prompt, no signature.
  for (const msg of [
    'Could not establish connection. Receiving end does not exist.',
    'Receiving end does not exist.',
  ]) {
    assert.equal(RETRYABLE.test(msg), true, msg);
  }
});

test('a closed message port is NOT retryable — the dangerous case', () => {
  // The listener DID receive it; only the response was lost. The user may already
  // have approved, so the event may be signed. Retrying would sign it twice: a
  // duplicate note, or a double payment.
  assert.equal(
    RETRYABLE.test('The message port closed before a response was received.'),
    false,
    'retrying this could produce a second signature'
  );
});

test('an invalidated extension context is NOT retryable', () => {
  // The extension was reloaded under the content script. The page has to reload;
  // retrying into a dead context accomplishes nothing.
  assert.equal(RETRYABLE.test('Extension context invalidated.'), false);
});

test('an unknown error is NOT retryable', () => {
  // Default closed. An error we do not recognize might mean the request was
  // processed, and the cost of guessing wrong is a duplicate signature.
  for (const msg of ['', 'Some unexpected failure', 'Native host has exited.']) {
    assert.equal(RETRYABLE.test(msg), false, JSON.stringify(msg));
  }
});

// ---- the retry is bounded --------------------------------------------------------

test('it retries at most once', () => {
  // A worker that cannot start would otherwise be re-sent forever, and each attempt
  // could eventually wake it and prompt.
  assert.match(source, /if \(err && attempted === 1 && RETRYABLE\.test/,
    'the guard must pin the attempt number, not just the error');
});

test('the retry is delayed, not immediate', () => {
  // An immediate re-send races the same cold start and usually fails identically.
  assert.match(source, /setTimeout\(dispatch, \d+\)/);
  const delay = Number(source.match(/setTimeout\(dispatch, (\d+)\)/)[1]);
  assert.ok(delay >= 100 && delay <= 1000,
    `${delay}ms — too short to let Chrome start the worker, or long enough to be felt`);
});

test('the page is still answered exactly once', () => {
  // reply() guards on `replied`, which is what stops a retry from settling the page's
  // promise twice. Losing that would surface as a duplicate response to window.nostr.
  assert.match(source, /function reply\(response\) \{\s*\n\s*if \(replied\) return;/);
});

// ---- the messages a user actually sees -------------------------------------------

test('a lost-response error does not tell the user to just try again', () => {
  // The one case where blind retrying is unsafe. The copy has to leave room for
  // "it may already have worked" rather than implying nothing happened.
  const fn = source.match(/function friendlyError\(msg\) \{[\s\S]*?\n  \}/)[0];
  const m = fn.match(/message port closed[\s\S]*?return '([^']*)'/);
  assert.ok(m, 'no message for the port-closed case');
  assert.match(m[1], /went through/i, 'must hint the action may have completed');
});

test('raw Chrome plumbing never reaches the user', () => {
  const fn = source.match(/function friendlyError\(msg\) \{[\s\S]*?\n  \}/)[0];
  for (const phrase of ['message port closed', 'Receiving end does not exist']) {
    // The phrases appear as regex TESTS, but must not be what gets returned.
    const returned = [...fn.matchAll(/return '([^']*)'/g)].map((x) => x[1]);
    assert.ok(!returned.some((r) => r.includes(phrase)),
      `"${phrase}" is Chrome's internal wording, not a user message`);
  }
});

test('every branch returns something non-empty', () => {
  const fn = source.match(/function friendlyError\(msg\) \{[\s\S]*?\n  \}/)[0];
  const returns = [...fn.matchAll(/return ([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(returns.length >= 4, 'expected a branch per known error plus a fallback');
  // The fallback must not be able to produce an empty toast.
  assert.match(fn, /return m \|\| '[^']+'/, 'the fallback needs a default string');
});

// ---- the timeout was deliberately left alone ------------------------------------

test('the 180s page timeout is unchanged', () => {
  // Tempting to shorten this to match Jumble's 30s, but the window exists so a user
  // can READ an approval prompt and decide. background.js's REQUEST_TTL (175s) is set
  // just under it on purpose. Shortening it would abandon prompts mid-decision —
  // trading a rare lost request for a common one.
  assert.match(source, /180000/, 'the read-and-decide window must stay');
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const ttl = Number(bg.match(/const REQUEST_TTL = (\d+);/)[1]);
  assert.ok(ttl < 180000, `REQUEST_TTL ${ttl} must stay under the content-script timeout`);
});
