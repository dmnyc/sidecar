'use strict';

// READING THE REST OF THE NOTE YOU ARE ANSWERING.
//
// The reply block showed the target under TWO independent caps: renderNoteText's 240
// characters, which truncates the text and appends an ellipsis, and a CSS max-height
// that clips whatever survives. Both exist for good reasons (one photo took the block
// to 305px of a 360px panel) but between them a long note was unreadable, and there was
// no way to see the rest without leaving the composer.
//
// The thing this file mostly guards is that BOTH caps lift. Dropping the class alone
// expands the box to reveal a note that still ends in "…", which looks like the feature
// working and is not.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const bare = panel.replace(/^\s*\/\/.*$/gm, '');

const fn = bare.slice(bare.indexOf('function buildReplyBlock()'));
const body = fn.slice(0, fn.indexOf('\n    }\n'));

test('BOTH CAPS LIFT, NOT JUST THE CSS ONE', () => {
  // Re-rendered, because the ellipsis is in the DOM that renderNoteText produced and no
  // amount of max-height will take it back out.
  assert.match(body, /body\.innerHTML = '';\s*\n\s*renderNoteText\(body, full, expanded \? Infinity : 240\)/);
  assert.match(body, /block\.classList\.toggle\('is-open', expanded\)/);
  assert.match(css, /\.reply-target\.is-open \.reply-target-body \{[^}]*max-height: 320px/);
});

test('THE NO-CAP VALUE IS INFINITY, NOT ZERO', () => {
  // renderNoteText compares `used + s.length > maxLen`, so 0 is exceeded by the first
  // character and the whole note renders as a single "…". The obvious value is wrong.
  assert.match(core, /if \(used \+ s\.length > maxLen\) \{/,
    'the cap comparison changed; re-check what "no cap" has to be');
  assert.match(body, /expanded \? Infinity : 240/);
  assert.doesNotMatch(body, /expanded \? 0 :/);
});

test('IT SCROLLS RATHER THAN GROWING WITHOUT LIMIT', () => {
  // The composer is in a 360px panel and the quote is context, not the subject. A long
  // note allowed to grow freely pushes the editor off the bottom, which answers "let me
  // read the rest" by moving the problem one step down the sheet.
  assert.match(css, /\.reply-target\.is-open \.reply-target-body \{[^}]*overflow-y: auto/);
  // And it returns to the top on collapse, or reopening starts mid-note.
  assert.match(body, /if \(!expanded\) body\.scrollTop = 0;/);
});

test('NO CONTROL WHEN THERE IS NOTHING TO OPEN', () => {
  // A short note gets no toggle and no fade. A control that does nothing reads as
  // broken software, and a phantom gradient reads as a rendering fault.
  assert.match(body, /if \(!wasClipped\) return;/);
  assert.match(body, /block\.append\(toggle\)/);
  // Measured after layout, because scrollHeight is 0 until the block has one. The
  // length check is the other half: a note under the CSS height can still be over 240
  // characters and therefore still truncated.
  assert.match(body, /requestAnimationFrame\(\(\) => \{/);
  assert.match(body, /body\.scrollHeight > body\.clientHeight \+ 1 \|\| full\.length > 240/,
    'a note that fits the box but exceeds 240 characters offers no way to read the rest');
});

test('the fade goes away once it scrolls', () => {
  // The gradient means "there is more below". Over a scrollable region the scrollbar
  // says that already, and the fade only obscures the line being read.
  assert.match(css, /\.reply-target\.is-open::after \{ opacity: 0; \}/);
  assert.match(body, /block\.classList\.toggle\('is-clipped', !expanded && wasClipped\)/);
});

test('it reuses the bio toggle rather than inventing a second one', () => {
  // renderAbout already does show-more/show-less with .show-toggle. Two controls that
  // do the same thing in one panel is two things to keep in step.
  assert.match(body, /className: 'show-toggle'/);
  assert.match(body, /toggle\.textContent = expanded \? t\('Show less'\) : t\('Show more'\)/);
  assert.match(css, /\.show-toggle \{/);
});
