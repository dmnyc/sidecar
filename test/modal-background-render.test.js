'use strict';

// Unit coverage for deferring renderMain() while an overlay covers the panel.
//
// THE REPORT (2026-08-07, Chrome): flickering behind the notifications panel while
// background refreshing happens.
//
// Cause: renderMain() clears and rebuilds the header AND the account list
// (head.innerHTML = ''; list.innerHTML = '') and re-runs the pinned balance bar.
// Behind an open modal that tear-down shows through the overlay.
//
// And it isn't a one-off — it's a loop. renderMain kicks off a profile backfill for
// every account missing a kind:0, and fetchAndStoreProfile calls renderMain again on
// success. An account whose profile never resolves keeps that cycling on the retry
// cooldown, so the flicker repeats for as long as the panel is open.
//
// Fix: skip the render while covered, remember that it was skipped, and draw once
// when the overlay comes down. renderMain reads only from `state`, so nothing is lost
// by drawing once at the end instead of N times underneath.

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

// A DOM small enough to exercise the gate: an <html> classList and one #view-approval.
function harness({ modalOpen = false, approvalVisible = false, locked = false } = {}) {
  const mk = (classes) => {
    const set = new Set(classes);
    return {
      classList: {
        contains: (c) => set.has(c),
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
      },
    };
  };
  const approval = mk(approvalVisible ? [] : ['hidden']);
  const renders = [];
  const ctx = {
    console,
    document: { documentElement: mk(modalOpen ? ['modal-open'] : []) },
    $: (id) => (id === 'view-approval' ? approval : null),
    state: { locked, accounts: [], activePubkey: 'a'.repeat(64) },
    renderMain: () => renders.push(Date.now()),
  };
  vm.createContext(ctx);
  vm.runInContext(
    'let _mainRenderDeferred = false;\n' +
    lift(/  function panelIsCovered\(\) \{[\s\S]*?\n  \}/, 'panelIsCovered') + '\n' +
    lift(/  function flushDeferredMainRender\(\) \{[\s\S]*?\n  \}/, 'flushDeferredMainRender') + '\n' +
    'globalThis.panelIsCovered = panelIsCovered;' +
    'globalThis.flush = flushDeferredMainRender;' +
    'globalThis.setDeferred = (v) => { _mainRenderDeferred = v; };' +
    'globalThis.getDeferred = () => _mainRenderDeferred;',
    ctx
  );
  return { ctx, renders, approval };
}

// ---- what counts as "covered" ----------------------------------------------------

test('an open modal covers the panel', () => {
  assert.equal(harness({ modalOpen: true }).ctx.panelIsCovered(), true);
});

test('a visible approval card covers the panel', () => {
  // This is the surface that would have been missed: the approval screen never sets
  // `modal-open`, it just un-hides #view-approval. Leaving it out would keep the
  // flicker on exactly the screen where a background repaint is most alarming.
  assert.equal(harness({ approvalVisible: true }).ctx.panelIsCovered(), true);
});

test('nothing showing means not covered', () => {
  assert.equal(harness().ctx.panelIsCovered(), false);
});

test('a missing #view-approval element does not throw', () => {
  // welcome.html and the onboarding view have no approval card.
  const h = harness();
  h.ctx.$ = () => null;
  assert.doesNotThrow(() => h.ctx.panelIsCovered());
  assert.equal(h.ctx.panelIsCovered(), false);
});

// ---- the flush -------------------------------------------------------------------

test('flushing draws once when a render was deferred', () => {
  const h = harness();
  h.ctx.setDeferred(true);
  h.ctx.flush();
  assert.equal(h.renders.length, 1);
});

test('flushing does nothing when no render was deferred', () => {
  // Every overlay teardown calls flush; only the ones that actually skipped a render
  // should redraw. Otherwise closing a modal repaints the panel for no reason.
  const h = harness();
  h.ctx.setDeferred(false);
  h.ctx.flush();
  assert.equal(h.renders.length, 0);
});

test('N deferred renders collapse into ONE draw', () => {
  // The point of the fix. The profile-backfill loop can fire renderMain repeatedly
  // while the panel is open; the user should see one repaint on close, not a queue.
  const h = harness();
  for (let i = 0; i < 12; i++) h.ctx.setDeferred(true);
  h.ctx.flush();
  assert.equal(h.renders.length, 1, 'twelve skipped renders, one draw');
});

test('flushing while still covered is a no-op', () => {
  // Guards the ordering contract: a caller that flushes BEFORE clearing its own
  // visible state would silently lose the render and leave stale account names on
  // screen until something unrelated redrew.
  const h = harness({ modalOpen: true });
  h.ctx.setDeferred(true);
  h.ctx.flush();
  assert.equal(h.renders.length, 0);
  assert.equal(h.ctx.getDeferred(), true, 'and the pending flag must survive');
});

test('a locked panel never draws', () => {
  // renderMain reads state.accounts; drawing the account list over the lock screen
  // would leak names from a locked keystore.
  const h = harness({ locked: true });
  h.ctx.setDeferred(true);
  h.ctx.flush();
  assert.equal(h.renders.length, 0);
});

// ---- wiring ----------------------------------------------------------------------

test('renderMain defers instead of drawing when covered', () => {
  const fn = source.match(/  function renderMain\(\) \{[\s\S]*?\n    const active =/)[0];
  assert.match(fn, /if \(panelIsCovered\(\)\) \{\s*\n\s*_mainRenderDeferred = true;\s*\n\s*return;/,
    'renderMain must bail before touching the DOM');
});

test('renderMain clears the deferred flag once it actually draws', () => {
  const fn = source.match(/  function renderMain\(\) \{[\s\S]*?\n    const active =/)[0];
  assert.match(fn, /_mainRenderDeferred = false;/,
    'otherwise the next overlay close would redraw for no reason');
});

test('every overlay teardown flushes', () => {
  // Three places take an overlay down: closeModal, and the two spots that hide the
  // approval card. Miss one and the panel keeps showing stale content after it.
  const closeModal = source.match(/  function closeModal\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(closeModal, /flushDeferredMainRender\(\)/, 'closeModal');

  const hides = [...source.matchAll(/hide\(\$\('view-approval'\)\);/g)];
  assert.ok(hides.length >= 2, 'expected at least two approval-hide sites');
  for (const m of hides) {
    const after = source.slice(m.index, m.index + 200);
    assert.match(after, /flushDeferredMainRender\(\)/,
      'an approval-hide site at index ' + m.index + ' does not flush');
  }
});

test('closeModal removes the class BEFORE flushing', () => {
  // Ordering matters: flush checks panelIsCovered(), so flushing first would no-op
  // and the deferred render would never land.
  const fn = source.match(/  function closeModal\(\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(
    fn.indexOf("remove('modal-open')") < fn.indexOf('flushDeferredMainRender'),
    'the class must come off first'
  );
});
