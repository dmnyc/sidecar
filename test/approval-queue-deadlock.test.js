'use strict';

// The approval queue must always drain.
//
// Only one entry may be 'showing' at a time — driveOnce() returns early while one is —
// so anything that gets stuck in that state blocks every later request. The popup
// surface cannot get stuck, because creating a window either succeeds or throws. The
// PANEL surface could: driveOnce marked the entry 'showing', broadcast the queue, and
// trusted the panel to render it. Nothing checked.
//
// When the panel did not render — wrong browser window, mid-render, busy — the entry
// sat 'showing' forever. Reported as: reactions and reposts on jumble.social simply do
// nothing. No prompt appears, Recent Activity gains no entry (nothing ever reaches
// logActivity), the panel is open the whole time, and the page waits out its own 180s
// timeout. Switching accounts fixed it, because that triggers the panel's
// syncApprovalOverlay() which re-reads the queue and re-renders.
//
// The fix is an acknowledgment: the panel confirms it rendered, and an entry that is
// not acked within PANEL_ACK_MS is taken back and re-routed to a popup.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl + ' in background.js');
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}
function liftLine(re, label) {
  const m = source.match(re);
  if (!m) throw new Error('Could not find ' + label);
  return m[0];
}

// deps.panelPort      is a panel connected
// deps.panelWindowId  which window it is in (null = unknown)
function harness(deps = {}) {
  const popups = [];
  const ctx = {
    console, Date, Math, Promise, Error, Object, Array, Set, Map, JSON,
    setTimeout, clearTimeout,
    queue: [],
    callbacks: new Map(),
    driving: false,
    driveAgain: false,
    popupWindowId: deps.popupWindowId != null ? deps.popupWindowId : null,
    panelPort: 'panelPort' in deps ? deps.panelPort : {},
    panelWindowId: 'panelWindowId' in deps ? deps.panelWindowId : null,
    chrome: { runtime: { getURL: (p) => 'chrome-extension://x/' + p } },
    // Everything driveOnce calls that is not the logic under test.
    expireEntry(id, reason) {
      const i = ctx.queue.findIndex((e) => e.id === id);
      if (i >= 0) ctx.queue.splice(i, 1);
      const cb = ctx.callbacks.get(id);
      ctx.callbacks.delete(id);
      if (cb && !cb.settled) { cb.settled = true; cb.resolve({ action: 'reject', reason }); }
    },
    closePopupWindow() { ctx.popupWindowId = null; },
    qPersist() {},
    broadcastQueue() {},
    stopKeepaliveIfIdle() {},
    async waitForPanelPort() {},
    async createPopup(url) { popups.push(url); ctx.popupWindowId = 99; return true; },
    async navigatePopup(url) { popups.push(url); return true; },
    popups,
  };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(
    [
      liftLine(/const REQUEST_TTL = \d+;/, 'REQUEST_TTL'),
      liftLine(/const TOMBSTONE_TTL = \d+;/, 'TOMBSTONE_TTL'),
      liftLine(/const PANEL_ACK_MS = \d+;/, 'PANEL_ACK_MS'),
      lift('function panelServesWindow('),
      lift('async function driveDisplay('),
      lift('async function driveOnce('),
      'globalThis.driveOnce = driveOnce;',
      'globalThis.PANEL_ACK_MS = PANEL_ACK_MS;',
    ].join('\n'),
    ctx
  );
  return ctx;
}

// A live queued entry, as openPrompt would have created it.
function enqueue(ctx, id, opts = {}) {
  const now = Date.now();
  ctx.queue.push({
    id, host: 'jumble.social', method: 'signEvent', kind: 7,
    data: {}, ts: now, deadline: now + 175000,
    state: 'queued', display: 'none',
    originWindowId: opts.originWindowId,
  });
  ctx.callbacks.set(id, { resolve() {}, settled: false });
}

// ---- the deadlock ----------------------------------------------------------------

test('an approval handed to the panel is marked showing and awaits an ack', async () => {
  const ctx = harness();
  enqueue(ctx, 'a');
  await ctx.driveOnce();
  const a = ctx.queue.find((e) => e.id === 'a');
  assert.equal(a.state, 'showing');
  assert.equal(a.display, 'panel');
  assert.equal(a.acked, false, 'unproven until the panel says otherwise');
  assert.ok(a.shownAt > 0, 'needs a timestamp or the deadline cannot be measured');
});

test('a second request waits while the first is genuinely showing', async () => {
  // Not a bug — one at a time is the design. This pins the behavior the fix must keep.
  const ctx = harness();
  enqueue(ctx, 'a');
  await ctx.driveOnce();
  ctx.queue.find((e) => e.id === 'a').acked = true; // panel rendered it
  enqueue(ctx, 'b');
  await ctx.driveOnce();
  assert.equal(ctx.queue.find((e) => e.id === 'b').state, 'queued');
});

test('an UNACKED panel entry is taken back once the deadline passes', async () => {
  // The whole bug: without this the queue never drains again.
  const ctx = harness();
  enqueue(ctx, 'a');
  await ctx.driveOnce();
  const a = ctx.queue.find((e) => e.id === 'a');
  a.shownAt = Date.now() - (ctx.PANEL_ACK_MS + 100); // pretend the deadline elapsed
  await ctx.driveOnce();
  assert.equal(a.panelFailed, true, 'must not be handed back to the same silent panel');
  assert.equal(ctx.popups.length, 1, 're-routed to a popup, the surface we can verify');
});

test('a queue blocked by an unrendered approval drains again', async () => {
  // End to end: the reaction that "does nothing", followed by the repost behind it.
  const ctx = harness();
  enqueue(ctx, 'reaction');
  await ctx.driveOnce();                       // handed to a panel that never renders
  enqueue(ctx, 'repost');
  await ctx.driveOnce();
  assert.equal(ctx.queue.find((e) => e.id === 'repost').state, 'queued', 'blocked, as reported');

  ctx.queue.find((e) => e.id === 'reaction').shownAt = Date.now() - (ctx.PANEL_ACK_MS + 100);
  await ctx.driveOnce();
  assert.ok(ctx.popups.length >= 1, 'the head finally reaches a surface');
});

test('an ACKED panel entry is never taken away', async () => {
  // The failure this fix must not introduce: yanking a prompt the user is reading.
  const ctx = harness();
  enqueue(ctx, 'a');
  await ctx.driveOnce();
  const a = ctx.queue.find((e) => e.id === 'a');
  a.acked = true;
  a.shownAt = Date.now() - (ctx.PANEL_ACK_MS * 10); // long since shown, still on screen
  await ctx.driveOnce();
  assert.equal(a.state, 'showing');
  assert.equal(a.display, 'panel');
  assert.equal(ctx.popups.length, 0, 'no popup should appear over a live panel prompt');
});

test('with no panel at all it goes straight to a popup, as before', async () => {
  const ctx = harness({ panelPort: null });
  enqueue(ctx, 'a');
  await ctx.driveOnce();
  const a = ctx.queue.find((e) => e.id === 'a');
  assert.equal(a.display, 'popup');
  assert.equal(ctx.popups.length, 1);
});

test('a definite window mismatch still prefers the popup', async () => {
  const ctx = harness({ panelWindowId: 1 });
  enqueue(ctx, 'a', { originWindowId: 2 });
  await ctx.driveOnce();
  assert.equal(ctx.queue.find((e) => e.id === 'a').display, 'popup');
});

// ---- source guards ---------------------------------------------------------------

function stripComments(src) {
  return src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
}

const body = source
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
  .join('\n');

test('the panel path schedules its own wake-up', () => {
  // Nothing else re-enters driveOnce if the panel stays silent — no user action, no
  // message, no timer. Without this the deadline is never evaluated and the entry
  // stays stuck exactly as before.
  const fn = lift('async function driveOnce(');
  assert.match(fn, /setTimeout\(\(\) => \{ driveDisplay\(\); \}, PANEL_ACK_MS/);
});

test('the panel acks from the place that actually renders', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  const fn = panel.slice(panel.indexOf('function showApproval('));
  assert.match(fn.slice(0, 900), /SIDECAR_APPROVAL_SHOWN/);
});

test('the ack only counts for the entry the panel was actually given', () => {
  // A stale ack for an entry that has moved on must not mark the current head rendered.
  assert.match(body, /SIDECAR_APPROVAL_SHOWN[\s\S]{0,400}?e\.state === 'showing' && e\.display === 'panel'/);
});

test('a service-worker restart cannot resurrect a wedged showing entry', () => {
  // shownAt / acked / display are deliberately NOT in sanitizeEntry, which would
  // otherwise be a hole: a restored entry with state 'showing' and no shownAt would
  // fail the deadline check and block the queue with no timer left to rescue it.
  //
  // It is safe because reconcileQueue rebuilds every restored entry as an
  // 'interrupted' tombstone — their callbacks and page channels are gone, so they can
  // never sign. Tombstones are not 'showing', so the early return never sees them.
  const sanitize = lift('function sanitizeEntry(');
  assert.doesNotMatch(sanitize, /shownAt|acked|panelFailed/, 'if these ever persist, re-check the restore path');

  const reconcile = lift('async function reconcileQueue(');
  assert.match(reconcile, /state: 'interrupted'/, 'restored entries must never come back as showing');
});

test('the deadline branch requires a timestamp, so a fieldless entry cannot trip it', () => {
  // Belt and braces for the above: even if an entry somehow arrives as 'showing'
  // without shownAt, the guard must not fire on undefined arithmetic.
  const fn = lift('async function driveOnce(');
  assert.match(fn, /showing\.shownAt != null/);
});

// ---- the regression the deadlock fix introduced ---------------------------------

test('A PANEL-FAILED ENTRY DOES NOT BOUNCE BETWEEN POPUP AND PANEL', () => {
  // driveOnce hands a showing popup back to the panel whenever the panel can serve
  // that window. panelFailed entries are routed straight back to a popup by the
  // head-picking below, so without excluding them here the entry oscillates: popup
  // opens, gets taken back, opens again — forever. The page's promise never settles
  // and a window flickers. Reported as "I can't do anything, and Jumble's bar pulses
  // as if waiting for something that never finishes".
  // Comments stripped: the prose explaining this guard is longer than the guard, so a
  // fixed character window measures the explanation rather than the code.
  const fn = stripComments(lift('async function driveOnce('));
  const branch = fn.slice(fn.indexOf("showing.display === 'popup'"));
  assert.match(branch.slice(0, 160), /!showing\.panelFailed/, 'the handoff must skip a failed entry');
});

test('a popup that never failed on the panel still hands off', async () => {
  // The behavior being preserved: a popup opened because no panel was there should
  // move to the panel once one appears.
  const ctx = harness({ panelPort: null });
  enqueue(ctx, 'a');
  await ctx.driveOnce();
  const a = ctx.queue.find((e) => e.id === 'a');
  assert.equal(a.display, 'popup');
  ctx.panelPort = {}; // a panel opens
  await ctx.driveOnce();
  assert.equal(a.display, 'panel', 'handoff still works for an entry with no history');
});

test('a panel-failed entry stays on the popup once a panel is open', async () => {
  const ctx = harness();
  enqueue(ctx, 'a');
  await ctx.driveOnce();                       // handed to a panel that never renders
  const a = ctx.queue.find((e) => e.id === 'a');
  a.shownAt = Date.now() - (ctx.PANEL_ACK_MS + 100);
  await ctx.driveOnce();                       // taken back, routed to a popup
  assert.equal(a.display, 'popup');
  assert.equal(a.panelFailed, true);
  const popupsAfterRoute = ctx.popups.length;

  await ctx.driveOnce();                       // panel is still open — must NOT bounce
  assert.equal(a.display, 'popup', 'it must stay where it can be observed');
  assert.equal(ctx.popups.length, popupsAfterRoute, 'and not be reopened');
});
