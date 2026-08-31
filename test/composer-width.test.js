'use strict';

// The composers grow with the panel (backlog item H).
//
// Every other modal is capped at 344px because the side panel is usually narrow and a
// dialog wider than its content reads as a mistake. A composer is the exception: it is a
// writing surface, the panel can be dragged wide, and holding a note to 300px of usable
// width while there is 700px of window is the one case where that cap costs something.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

test('both composers opt into the wider modal', () => {
  // The post composer and the web-comment composer. Two surfaces, and fixing one is not
  // fixing it.
  assert.equal((panel.match(/classList\.add\('compose-modal'\)/g) || []).length, 2);
  const post = panel.slice(panel.indexOf('async function openComposer(initialText)'));
  assert.match(post, /compose-modal/, 'the post composer');
  const comment = panel.slice(panel.indexOf('function webCommentModal()'));
  assert.match(comment.slice(0, 900), /compose-modal/, 'the comment composer');
});

test('THE VARIANT RESETS, or it leaks into the next modal', () => {
  // openModal reuses one element. modal-sheet already had to be cleared for this reason;
  // a second variant that is not would leave every dialog opened after a composer 620px
  // wide, which is the kind of bug that looks like a theme problem.
  assert.match(panel, /modal\.classList\.remove\('modal-sheet', 'compose-modal'\)/);
});

test('it is a ceiling, not a fixed width', () => {
  // .modal already sets width: 100%, so this only raises the cap — on a narrow panel the
  // composer still fills the panel and nothing moves.
  assert.match(css, /\.modal\.compose-modal \{ max-width: 620px; \}/);
  assert.match(css, /\.modal \{[^}]*width: 100%;/, 'the fill behavior it relies on');
});

test('THE CLASS IS ADDED INSIDE THE BUILDER, NOT BEFORE THE CALL', () => {
  // The bug this shipped with for one commit. openModal clears the per-modal variants as
  // its first act, so a class added before the call is wiped before anything renders —
  // the composer opened at the default 344px and the change looked like it had not
  // applied at all. Both composers add it inside their build callback.
  for (const fn of ['async function openComposer(initialText)', 'function webCommentModal()']) {
    const src = panel.slice(panel.indexOf(fn));
    const body = src.slice(0, src.indexOf('\n  }\n'));
    const add = body.indexOf("classList.add('compose-modal')");
    const open = body.indexOf('openModal(');
    assert.notEqual(add, -1, fn + ' must add the class');
    assert.notEqual(open, -1, fn + ' must open a modal');
    assert.ok(add > open, fn + ' adds the class BEFORE openModal, which clears it');
  }
});

// ---- the cancel guard (backlog item G) -------------------------------------------

test('A BACKGROUND CLICK CANNOT TAKE WHAT YOU TYPED', () => {
  // Clicking the blank space beside a composer closed it and took the text with it. It is
  // the easiest gesture in the panel to make by accident and the most expensive one to
  // get wrong.
  assert.match(panel, /let _modalDismissGuard = null;/);
  const fn = panel.slice(panel.indexOf("$('modal-overlay').addEventListener"));
  const body = fn.slice(0, fn.indexOf('\n  });'));
  assert.match(body, /if \(_modalDismissGuard\)/, 'the overlay click must consult it');
  assert.match(body, /if \(hold\) return toast\(/, 'and say why nothing happened');
  // A throwing guard must not wedge the modal shut.
  assert.match(body, /catch \(_\) \{ hold = false; \}/);
});

test('an explicit Cancel still closes', () => {
  // Only the background click is guarded. Refusing Cancel would be a trap, not a guard —
  // there would be no way out at all.
  const fn = panel.slice(panel.indexOf("$('modal-overlay').addEventListener"));
  const body = fn.slice(0, fn.indexOf('\n  });'));
  assert.match(body, /closeModal\(\);/, 'an unguarded click still closes');
  const composer = panel.slice(panel.indexOf('async function openComposer(initialText)'));
  assert.match(composer, /cancel\.addEventListener\('click', closeModal\)/, 'Cancel is untouched');
});

test('both composers arm it, on what each can actually lose', () => {
  // The post composer autosaves drafts, so a stray click is recoverable there; the
  // comment composer has NO draft store, which makes it the surface this exists for.
  assert.match(panel, /_modalDismissGuard = \(\) => !!\(draft\.text\.trim\(\) \|\| \(draft\.media \|\| \[\]\)\.length\)/);
  assert.match(panel, /_modalDismissGuard = \(\) => !!commentEditor\.getText\(\)\.trim\(\)/);
});

test('the guard resets between modals', () => {
  // Same trap as the width class: a stale guard would make an unrelated dialog refuse to
  // close, which is far worse than one that opens too wide.
  const fn = panel.slice(panel.indexOf('function openModal(buildContent, onClose)'));
  assert.match(fn.slice(0, 700), /_modalDismissGuard = null;/);
});

test('the post composer has an X, and it discards', () => {
  // An X is where people look for the way out. Someone who does not find one clicks the
  // background instead, which is now guarded and does nothing — so without an X the guard
  // reads as a stuck dialog. Safe to discard here because drafts autosave.
  const fn = panel.slice(panel.indexOf('async function openComposer(initialText)'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /className: 'modal-x', title: 'Close'/);
  assert.match(body, /closeX\.addEventListener\('click', closeModal\)/);
  // After the content: showEditor clears the modal to build itself, so an X appended
  // before it is wiped.
  assert.ok(
    body.indexOf('const closeX') > body.indexOf('showEditor();'),
    'the X must be appended after the content that clears the modal'
  );
});
