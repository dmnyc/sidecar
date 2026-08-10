'use strict';

// A signing approval must outrank everything else on screen.
//
// THE REPORT (2026-08-09): with the notifications panel open, the approval box can be
// blocked.
//
// It was worse than a tie. `.modal-overlay` is z-index 100 and `.approval-overlay` was
// 50, so ANY open modal — notifications, composer, settings — rendered on top of a
// signing request. showApproval()'s own comment claimed "Overlay on top of whatever's
// showing" while the CSS put it underneath.
//
// That is a safety problem, not a cosmetic one: a request the user never sees is a
// request that silently times out. Worse, an approval the user cannot see is one they
// cannot REJECT — so a site asking for a signature at an awkward moment just waits,
// and the user's only clue is the client reporting a failure later.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

// Pull the z-index out of a rule by selector.
function zOf(selector) {
  const re = new RegExp(selector.replace('.', '\\.') + '\\s*\\{[^}]*?z-index:\\s*(\\d+)', 's');
  const m = css.match(re);
  if (!m) throw new Error('no z-index found for ' + selector);
  return Number(m[1]);
}

// ---- stacking --------------------------------------------------------------------

test('the approval overlay outranks every modal', () => {
  const approval = zOf('.approval-overlay');
  const modal = zOf('.modal-overlay');
  assert.ok(approval > modal,
    `approval ${approval} must beat modal ${modal} — this was 50 vs 100, i.e. hidden`);
});

test('the approval overlay outranks the account menu', () => {
  // .acct-menu is 90 and floats over the panel; it must not cover a signature request.
  assert.ok(zOf('.approval-overlay') > zOf('.acct-menu'));
});

test('toasts still appear above the approval', () => {
  // Toasts are transient confirmations ("Note published"), and an approval that buried
  // them would hide the outcome of the previous action.
  assert.ok(zOf('.toasts') > zOf('.approval-overlay'));
});

test('the lightning layer still appears above the approval', () => {
  // The zap strike is pointer-events:none, so it cannot swallow a click on Allow —
  // and a payment approval that hid its own celebration would read as a failure.
  assert.ok(zOf('.lightning-layer') > zOf('.approval-overlay'));
});

test('nothing clickable sits between the modal and the approval', () => {
  // Any interactive layer in the 100..120 band would be able to intercept clicks meant
  // for Allow or Reject.
  const approval = zOf('.approval-overlay');
  const modal = zOf('.modal-overlay');
  const between = [...css.matchAll(/([.#][\w-]+)[^{}]*\{[^}]*?z-index:\s*(\d+)/gs)]
    .map((m) => ({ sel: m[1], z: Number(m[2]) }))
    .filter((r) => r.z > modal && r.z < approval)
    .filter((r) => !/lightning|toast/.test(r.sel));
  assert.deepEqual(between, [], 'layers stacked between the modal and the approval');
});

// ---- the modal is dismissed, not just covered ------------------------------------

test('an arriving approval closes any open modal', () => {
  // z-index alone leaves a stale modal underneath: dismissing the approval would
  // reveal something the user had forgotten, and the approval's backdrop click would
  // land on it.
  const fn = panel.match(/function showApproval\(\) \{[\s\S]*?\n    const payment =/)[0];
  assert.match(fn, /classList\.contains\('modal-open'\)\) closeModal\(\)/,
    'showApproval must close an open modal');
});

test('the approval is shown BEFORE the modal is closed', () => {
  // Ordering matters once the deferred-render fix lands: closing first leaves the panel
  // briefly uncovered, letting a deferred renderMain() fire in the gap and delaying the
  // approval by a frame.
  const fn = panel.match(/function showApproval\(\) \{[\s\S]*?\n    const payment =/)[0];
  const showAt = fn.indexOf("show($('view-approval'))");
  const closeAt = fn.indexOf('closeModal()');
  assert.ok(showAt !== -1 && closeAt !== -1, 'both calls must be present');
  assert.ok(showAt < closeAt, 'show() must come first');
});

test('closing a modal cannot lose a draft', () => {
  // The two draft-bearing modals persist on close, which is what makes dismissing one
  // non-destructive. If either stopped doing that, this fix would start costing the
  // user typed text.
  assert.match(panel, /if \(!published && enteredEditor\) persistDraft\(\);/,
    "the composer's onClose must still persist its draft");
  assert.match(panel, /onChange: \(text\) => saveWebCommentDraft\(/,
    'page comments must still save on every keystroke');
});

// ---- the claim in the comment now matches the CSS --------------------------------

test('the CSS comment records why the approval sits where it does', () => {
  // The old code comment said "on top of whatever's showing" while the CSS said
  // otherwise. A future z-index change should have to read the reason first.
  const rule = css.match(/\.approval-overlay \{/);
  assert.ok(rule, '.approval-overlay rule missing');
  const before = css.slice(Math.max(0, rule.index - 700), rule.index);
  assert.match(before, /modal-overlay/, 'the comment must name what it has to beat');
  assert.match(before, /toasts|lightning/, 'and what it must stay below');
});
