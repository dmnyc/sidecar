'use strict';

// The batch card now describes every event one click will settle.
//
// M1 from the 2026-09-13 audit: "Allow all (N)" previewed only the head event, so a site
// could queue a benign note, queue a different note behind it, and have one click
// described by the first sign both. Same-kind was never the same content. The pending
// view now carries a `members` array (id, method, kind, and the content/plaintext of
// each member) and the panel renders one row per member before the button is offered.
//
// G2 rode along: encrypt requests carry kind === null, so nip04.encrypt and nip44.encrypt
// from one host+account shared a batch key and one click approved across two different
// crypto methods. The method is now part of the key.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const panelHtml = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

function lift(src, decl) {
  const at = src.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = src.indexOf('{', src.indexOf('(', at));
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// Queue entries shaped the way handleNostrRpc enqueues them: only what pendingView and
// the batch functions read, which is the point — the test fails if they start needing
// (and leaking) more.
function entry(id, method, content, extra = {}) {
  const kind = extra.kind !== undefined ? extra.kind : (method === 'signEvent' ? 1 : null);
  return {
    id, method, kind,
    host: 'ditto.pub',
    state: extra.state || 'queued',
    display: 'panel',
    ts: 1,
    data: {
      activePubkey: 'pk'.repeat(16),
      accountName: 'Main',
      params: method === 'signEvent'
        ? { event: { kind, content, tags: extra.tags || [], created_at: extra.created_at || 1, pubkey: 'pk'.repeat(16) } }
        : { plaintext: content, pubkey: extra.peer || 'ab12cd34ef567890' },
    },
  };
}

function pendingViewOf(queue) {
  const ctx = { queue };
  vm.createContext(ctx);
  vm.runInContext(
    [
      // isNip42AuthEvent reads it for the clock-skew check. Missing, the guard threw the
      // moment a fixture got far enough to be a real auth event, which no fixture did
      // until one carried empty content and a fresh created_at.
      bg.match(/const NIP42_MAX_CLOCK_SKEW = \d+;/)[0],
      lift(bg, 'function isNip42AuthEvent('),
      lift(bg, 'function isBatchableEntry('),
      lift(bg, 'function batchKeyOf('),
      lift(bg, 'function memberViewOf('),
      lift(bg, 'function pendingView('),
      'globalThis.out = pendingView();',
    ].join('\n'),
    ctx
  );
  return ctx.out;
}

test('a batch of three signs three described events, not one described twice', () => {
  const view = pendingViewOf([
    entry('a1', 'signEvent', 'vote yes on thing one', { state: 'showing' }),
    entry('a2', 'signEvent', 'a DIFFERENT note the card never mentioned'),
    entry('a3', 'signEvent', 'a third note'),
  ]);
  assert.equal(view.head.groupIds.length, 3, 'the burst stopped batching');
  assert.equal(view.head.members.length, 3, 'members did not ride along');
  assert.deepEqual(view.head.members.map((m) => m.id), ['a1', 'a2', 'a3'], 'members are not in queue order');
  assert.equal(view.head.members[1].content, 'a DIFFERENT note the card never mentioned',
    'the second event is still invisible to the user');
  assert.equal(view.head.members[2].content, 'a third note');
  // Members describe, they do not hand over: no params blob, no full event.
  for (const m of view.head.members) {
    assert.deepEqual(Object.keys(m).sort(), ['content', 'id', 'kind', 'method', 'unreadable'],
      'memberViewOf started leaking more than a description');
  }
});

test('members cover encrypt bursts with the plaintext and the peer', () => {
  const view = pendingViewOf([
    entry('e1', 'nip04.encrypt', 'settings blob one', { state: 'showing' }),
    entry('e2', 'nip04.encrypt', 'settings blob two'),
  ]);
  assert.equal(view.head.members.length, 2);
  assert.equal(view.head.members[0].plaintext, 'settings blob one');
  assert.equal(view.head.members[1].plaintext, 'settings blob two');
  assert.equal(view.head.members[0].peer, 'ab12cd34ef567890', 'the peer vanished from the description');
});

test('nip04 and nip44 encrypts no longer share a batch key (G2)', () => {
  // kind is null on both, so the old key grouped them; one click approving across two
  // different crypto methods was never a "same kind" batch.
  const k04 = pendingViewOf([
    entry('x1', 'nip04.encrypt', 'a', { state: 'showing' }),
    entry('x2', 'nip44.encrypt', 'b'),
  ]);
  assert.equal(k04.head.groupIds.length, 1, 'the methods still batch together');
  // A solo head is a one-member batch; the panel hides lists under 2. What must NOT
  // happen is a second member joining across methods.
  assert.equal(k04.head.members.length, 1, 'a solo head lost its own description');

  // The key itself is method-aware even when nothing else differs.
  const ctx = { IN_A: entry('y1', 'nip04.encrypt', 'same text'), IN_B: entry('y2', 'nip44.encrypt', 'same text') };
  vm.createContext(ctx);
  // ctx.out, not the return value: runInContext hands back the script's completion value,
  // which for a trailing assignment is the array itself, so reading `.out` off it was
  // undefined and the assertion below died before it could compare anything.
  vm.runInContext(
    lift(bg, 'function batchKeyOf(') + '\nglobalThis.out = [batchKeyOf(IN_A), batchKeyOf(IN_B)];',
    ctx
  );
  const keys = ctx.out;
  assert.notEqual(keys[0], keys[1], 'batchKeyOf still ignores the method');
});

test('a non-batchable head still ships no members', () => {
  // Payments and relay-auth have their own cards; the member list is for bursts only.
  //
  // A REAL NIP-42 EVENT IS NARROWER THAN JUST ITS TAGS. isNip42AuthEvent wants relay and
  // challenge tags AND NOTHING ELSE, empty content, and a created_at inside the allowed
  // skew. A fixture carrying '{}' content and created_at 1 fails two of those, so it is
  // not an auth event at all: it was batched because it is an ordinary kind:22242 sign,
  // which is correct behavior, and the assertion proved nothing about the guard.
  const now = Math.floor(Date.now() / 1000);
  const authTags = [['relay', 'wss://relay.example'], ['challenge', 'challenge-string']];
  const auth = entry('n1', 'signEvent', '', {
    state: 'showing', kind: 22242, tags: authTags, created_at: now,
  });
  const view = pendingViewOf([
    auth,
    entry('n2', 'signEvent', '', { kind: 22242, tags: authTags, created_at: now }),
  ]);
  assert.equal(view.head.members.length, 0, 'a NIP-42 auth batch snuck back in');
});

// ---- the panel wiring -----------------------------------------------------------------

test('the panel renders the member list before the batch button is offered', () => {
  const s = stripComments(panel);
  assert.match(s, /renderBatchList\(pendingApproval\.members\)/,
    'showApproval never renders the member list');
  const fn = stripComments(lift(panel, 'function renderBatchList('));
  assert.match(fn, /approval-batch-list/, 'renderBatchList lost its element');
  assert.match(fn, /members\.length < 2/, 'single approvals now render a redundant list');
  assert.match(fn, /clampApprovalText\(/, 'member text is unclamped page-written text');
  assert.ok(!/innerHTML\s*=/.test(fn.replace('list.innerHTML', '')) &&
    /textContent/.test(fn), 'member rows are not textContent-assigned');
});

test('the member list rides the queue updates, not just the first render', () => {
  // Same head + more arrivals re-renders the batch count; it must refresh the list too,
  // or event N+1 is approved on the strength of a list that never mentioned it.
  const s = stripComments(panel);
  const at = s.indexOf('pendingApproval.groupIds = group;');
  assert.ok(at !== -1, 'the re-render branch moved');
  assert.match(s.slice(at, at + 200), /pendingApproval\.members = /,
    'a batch that grew keeps showing the old member list');
});

test('the element and its scroll exist, styled so a burst cannot hide the buttons', () => {
  // THE ELEMENT HAS TO CARRY THE CLASS THE RULE TARGETS. Asserting that an id exists, and
  // separately that a class rule exists, passes while nothing connects the two: show and
  // hide only toggle `hidden`, so an element holding the id alone is styled by none of
  // this and the cap below is inert. That is exactly how it shipped the first time, with
  // three comments claiming a scroll that was never applied.
  const el = panelHtml.match(/<div id="approval-batch-list"[^>]*>/);
  assert.ok(el, 'sidepanel.html has no member list element');
  assert.match(el[0], /class="[^"]*\bapproval-batch-list\b/,
    'the element carries the id but not the class styles.css targets');
  const rule = css.match(/\.approval-batch-list\s*\{[^}]*\}/);
  assert.ok(rule, 'styles.css has no .approval-batch-list rule');
  assert.match(rule[0], /max-height/, 'the list can grow without bound');
  assert.match(rule[0], /overflow-y:\s*auto/, 'the list has no scroll of its own');
});
