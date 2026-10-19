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
  // The real guard module, so isBatchableEntry asks the same tracked-kinds set the
  // overwrite warning asks and the two lists cannot drift apart.
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'replaceable-baseline.js'), 'utf8'), ctx);
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

test('a same-kind burst of the overwrite guard\'s kinds never batches', () => {
  // The guard tracks kinds 0/3/10000/10040 because they REPLACE what came before, and
  // a follow-list or mute-list replacement is exactly what "Allow all" must never sign
  // behind a preview row. Whatever a site queues for those kinds, each sign stands on
  // its own prompt with the warning and its deliberate second step.
  const view = pendingViewOf([
    entry('f1', 'signEvent', '["pubkey one","pubkey two"]', { state: 'showing', kind: 3, tags: [] }),
    entry('f2', 'signEvent', '["pubkey one"]', { kind: 3, tags: [] }),
  ]);
  assert.equal(view.head.groupIds.length, 1, 'a follow-list burst rode one Allow all');
  assert.equal(view.head.members.length, 0, 'members formed without batching');
  assert.equal(view.head.groupIds[0], 'f1', 'the head stopped being itself');

  const wiped = pendingViewOf([
    entry('m1', 'signEvent', '[]', { state: 'showing', kind: 10000, tags: [] }),
    entry('m2', 'signEvent', '["kept"]', { kind: 10000, tags: [] }),
  ]);
  assert.equal(wiped.head.groupIds.length, 1, 'a mute-list burst rode one Allow all');
});

test('a same-kind burst of zap requests never batches', () => {
  // #502's acceptance: a payment in the queue must not be approvable by the bulk
  // path. A kind-9734 sign is the signing half of a payment, and the amount it
  // commits to rides in its TAGS — which memberViewOf does not show (it shows
  // content only). A same-site burst of zap requests therefore collapsed into one
  // "Allow all (N)" whose member rows described bare content while the tap signed
  // N unseen spend commitments. Auto-zaps remain the standing no-prompt way to
  // sign these, and they carry per-zap and daily caps a batch never did.
  const view = pendingViewOf([
    entry('z1', 'signEvent', '{}', { state: 'showing', kind: 9734, tags: [['relays', '["wss://relay.example"]'], ['amount', '21000'], ['lnurl', 'lnurl1x']] }),
    entry('z2', 'signEvent', '{}', { kind: 9734, tags: [['relays', '["wss://relay.example"]'], ['amount', '1000000'], ['lnurl', 'lnurl1x']] }),
    entry('z3', 'signEvent', '{}', { kind: 9734, tags: [['relays', '["wss://relay.example"]'], ['amount', '5000'], ['lnurl', 'lnurl1x']] }),
  ]);
  assert.equal(view.head.groupIds.length, 1, 'a zap-request burst rode one Allow all');
  assert.equal(view.head.members.length, 0, 'members formed without batching');
  assert.equal(view.head.groupIds[0], 'z1', 'the head stopped being itself');
});

test('a payment can ride in no batch, as head or as member', () => {
  // The payment itself (webln sendPayment/keysend) is kept out by the method
  // whitelist — pinned here so a whitelist widening cannot silently re-admit it.
  const asHead = pendingViewOf([
    entry('p1', 'sendPayment', 'lnbc2100m1...', { state: 'showing' }),
    entry('p2', 'sendPayment', 'lnbc2100m2...'),
  ]);
  assert.equal(asHead.head.groupIds.length, 1, 'a payment burst rode one Allow all');
  assert.equal(asHead.head.members.length, 0);

  // And a payment queued behind a batchable sign head joins nothing: the method
  // rides in the batch key, and sendPayment is not batchable at all.
  const asMember = pendingViewOf([
    entry('s1', 'signEvent', 'hello', { state: 'showing' }),
    entry('p3', 'sendPayment', 'lnbc2100m3...'),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(asMember.head.groupIds)), ['s1'], 'a payment joined a note batch');
  assert.equal(asMember.head.members.length, 1, 'members formed without batching');
  assert.ok(asMember.waiting.some((w) => w.id === 'p3' && w.method === 'sendPayment'),
    'the payment vanished from the queue view');
});

test('the acceptance queue: destructive, payment, and relay-auth all stand outside the bulk path', () => {
  // #502 acceptance, verbatim in one queue: a destructive overwrite, a payment and
  // a relay-auth request, plus the one same-kind pair that SHOULD still batch — and
  // nothing but that pair is touchable by "Allow all".
  const now = Math.floor(Date.now() / 1000);
  const authTags = [['relay', 'wss://relay.example'], ['challenge', 'challenge-string']];
  const view = pendingViewOf([
    entry('head', 'signEvent', 'note one', { state: 'showing' }),
    entry('follow', 'signEvent', '["pubkey one"]', { kind: 3, tags: [] }),
    entry('pay', 'sendPayment', 'lnbc2100m4...'),
    entry('auth', 'signEvent', '', { kind: 22242, tags: authTags, created_at: now }),
    entry('note2', 'signEvent', 'note two'),
  ]);
  // JSON round-trip: an array built inside the vm carries that realm's Array
  // prototype, and deepEqual on it compares prototypes that differ.
  assert.deepEqual(JSON.parse(JSON.stringify(view.head.groupIds)), ['head', 'note2'],
    'only the same-kind note pair is offered to one tap');
  assert.equal(view.head.members.length, 2);
  const bulked = new Set(view.head.groupIds);
  for (const outside of ['follow', 'pay', 'auth']) {
    assert.ok(!bulked.has(outside), outside + ' rode the bulk path');
    assert.ok(view.waiting.some((w) => w.id === outside), outside + ' vanished from the queue view');
  }
});

// ---- the queue strip explains the asymmetry (#502 remedy 1) ----------------------------

test('the backlog strip carries the why-no-Approve-all line where Reject all lives', () => {
  const el = panelHtml.match(/<p id="approval-backlog-note"[^>]*>/);
  assert.ok(el, 'sidepanel.html has no backlog note element');
  assert.match(el[0], /class="[^"]*\bapproval-backlog-note\b/,
    'the element carries the id but not the class styles.css targets');
  const rule = css.match(/\.approval-backlog-note\s*\{[^}]*\}/);
  assert.ok(rule, 'styles.css has no .approval-backlog-note rule');
  // The strip is a flex row (count + button); the note must take its own full-width
  // row below them, per the row-controls rule, or it wraps into the button's space.
  assert.match(rule[0], /flex-basis:\s*100%/);
  const stripRule = css.match(/\.approval-backlog\s*\{[^}]*\}/);
  assert.match(stripRule[0], /flex-wrap:\s*wrap/, 'the note cannot wrap without the strip wrapping');
  // Filled by renderBacklog, with the strip it belongs to.
  const s = stripComments(panel);
  const fn = stripComments(lift(panel, 'function renderBacklog('));
  assert.match(fn, /approval-backlog-note/, 'renderBacklog lost the note');
  assert.match(fn, /Rejecting is always safe/, 'the note does not say why there is no Approve all');
  assert.match(s, /renderBacklog\(view\.waiting \|\| \[\]\)/, 'the strip stopped rendering from the queue view');
});

// The note ships `hidden` in the markup. Filling it is not showing it: the first cut
// set the text and left the class, so the line existed and nobody could see it.
test('renderBacklog reveals the why-no-Approve-all note along with the strip', () => {
  const el = () => {
    const classes = new Set(['hidden']);
    return { textContent: '', classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } };
  };
  const els = { 'approval-backlog': el(), 'approval-backlog-count': el(), 'approval-backlog-note': el() };
  const ctx = vm.createContext({
    $: (id) => els[id],
    show: (e) => e.classList.remove('hidden'),
    hide: (e) => e.classList.add('hidden'),
    t: (s) => s,
    tn: (one, other, n) => (n === 1 ? one : other),
  });
  vm.runInContext(lift(panel, 'function renderBacklog(') + '\nthis.renderBacklog = renderBacklog;', ctx);
  ctx.renderBacklog([{}, {}]);
  assert.equal(els['approval-backlog'].classList.contains('hidden'), false, 'the strip stayed hidden');
  assert.match(els['approval-backlog-note'].textContent, /Rejecting is always safe/);
  assert.equal(els['approval-backlog-note'].classList.contains('hidden'), false, 'the note is filled but still hidden');
});
