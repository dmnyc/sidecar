'use strict';

// Repost and quote, from a notification.
//
// One button with two answers, between the reaction and the zap. Both are "send this on"
// and they differ only in whether you have something to add, so they share a control
// rather than spending two of the slots in a row that repeats down the whole list.
//
// The two choices are also the confirmation step. A repost is public the moment it is
// signed, and a deletion request is only ever advisory, so the second tap is load-bearing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  let paren = 0;
  let i = source.indexOf('(', at);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// ---- the event ------------------------------------------------------------------------

test('A TEXT NOTE IS A KIND 6, ANYTHING ELSE A KIND 16', () => {
  // NIP-18 defines 6 for text notes only. A 6 wrapping a kind:1111 web comment is
  // something clients are entitled to ignore, so those take the generic repost and carry
  // the original kind in a `k` tag.
  const f = stripComments(lift('async function publishRepost('));
  assert.match(f, /const isNote = target\.kind === 1/, 'every kind is reposted the same way');
  assert.match(f, /kind: isNote \? 6 : 16/, 'a non-note is still sent as a kind 6');
  assert.match(f, /if \(!isNote\) tags\.push\(\['k', String\(target\.kind\)\]\)/,
    'a generic repost does not say what it wraps');
});

test('the repost says which note, whose, and where to find it', () => {
  const f = stripComments(lift('async function publishRepost('));
  assert.match(f, /\['e', target\.id, relay\]/, 'no relay hint, so the e tag is bare');
  assert.match(f, /\['p', target\.pubkey\]/, 'the author is not credited');
  assert.match(f, /await postRelays\(\)/, 'the relay hint is invented rather than read');
  // NIP-18: the content is the stringified original, so a client can render the repost
  // without going to find the note first.
  assert.match(f, /content: JSON\.stringify\(target\)/, 'the original is not carried');
});

test('a repost is signed against the account it comes from', () => {
  const f = stripComments(lift('async function publishRepost('));
  assert.match(f, /expectedPubkey: state\.activePubkey/, 'it can be signed by the wrong account');
  assert.match(f, /await publishSigned\(signed\)/, 'it is signed but never published');
  // The client tag is read, not assumed — there is no panel-wide settings object.
  assert.match(f, /await call\(\{ type: 'SIDECAR_GET_SETTINGS' \}\)/, 'the client tag setting is assumed');
});

// ---- the control ----------------------------------------------------------------------

test('ONE BUTTON, BETWEEN THE REACTION AND THE ZAP', () => {
  const f = stripComments(lift('function buildActions('));
  assert.match(f, /row\.append\(replyBtn, reactBtn, repostBtn, zapBtn\)/, 'the order moved');
  assert.match(f, /actBtn\('Repost or quote', icon\('repeat'\)\)/, 'the button lost its glyph or its name');
  // Icon only, like its neighbours: four labelled buttons do not fit a ~300px sheet.
  assert.doesNotMatch(f, /textContent: 'Repost or quote'/, 'the action button grew a label');
});

test('THE TWO CHOICES ARE THE CONFIRMATION', () => {
  // Nothing is published by the first tap. A repost is public the moment it is signed and
  // a deletion request is advisory, so the second tap has to be a real decision.
  const f = stripComments(lift('function buildActions('));
  const at = f.indexOf("repostBtn.addEventListener");
  const handler = f.slice(at, f.indexOf('repostNow.addEventListener'));
  assert.doesNotMatch(handler, /publishRepost/, 'the first tap publishes');
  assert.match(handler, /choices\.classList\.toggle\('hidden'\)/, 'the first tap does not offer the choices');
  assert.match(f, /repostNow\.addEventListener\('click', async \(e\) => \{\s*stop\(e\);/,
    'choosing Repost does not stop the row link');
  assert.match(f, /await publishRepost\(ev\)/, 'Repost never publishes');
  assert.match(f, /repostNow\.disabled = true/, 'a double tap can repost twice');
});

test('QUOTE HANDS THE COMPOSER AN nevent AND LETS IT DO THE TAGGING', () => {
  // quoteTags scans the body for nostr: references and writes the q tag itself, so the
  // nevent in the text IS the tagging. Building a q tag here would be a second copy.
  const f = stripComments(lift('function buildActions('));
  assert.match(f, /NT\.nip19\.neventEncode\(\{ id: ev\.id, author: ev\.pubkey/, 'the quote has no reference');
  assert.match(f, /openComposer\('\\n\\nnostr:' \+ nevent/, 'the nevent is not handed to the composer');
  assert.doesNotMatch(f, /\['q',/, 'the q tag is hand-rolled instead of left to quoteTags');
  // And the sheet comes back afterwards, like Reply.
  assert.match(f, /returnTo: \(\) => showNotifModal\(a, place\)/, 'quoting loses your place in the list');
});

test('the choices close again after either answer', () => {
  const f = stripComments(lift('function buildActions('));
  assert.match(f, /const closeChoices = \(\) => \{/, 'nothing closes the choices');
  // The arrow definition reads `const closeChoices = () =>`, so it is not one of these.
  assert.equal((f.match(/closeChoices\(\)/g) || []).length, 2,
    'expected a close from each of the two answers');
});

test('the choice row has its own line, because it has words', () => {
  // The icon row is the only thing that fits beside content in a ~300px sheet, which is
  // the mistake this panel keeps making. flex-basis 0 so two words cannot size to
  // content and strand one of them on its own line.
  assert.match(css, /\.notif-repost \{[^}]*display: flex/, 'the choices are not their own row');
  assert.match(css, /\.notif-repost-choice \{[^}]*flex: 1 1 0/, 'the choices size to content');
});
