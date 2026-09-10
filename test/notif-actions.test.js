'use strict';

// Expanding a notification, and the three things you can do with it.
//
// A notification row is a summary: a 140-char snippet clamped to three lines, or — for a
// reaction, a repost or a zap — no content at all, just "reacted to your note" and a
// pointer. Expanding answers the question each of those leaves open, and puts reply,
// react and zap under the note they act on.
//
// The asymmetry that matters: reply/react/zap are offered on a NOTE (kind 1 or a NIP-22
// comment) and never on a reaction, repost or zap receipt. There is no thread to join, a
// kind:7 tagging another kind:7 renders as nothing sensible anywhere, and a button that
// produces a dead-end event is worse than no button. Those rows expand to show which of
// your notes they are about and stop there.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

// PARAMETER LIST FIRST, then the body. The naive form — first `{` after the name —
// silently returns the parameter list for anything destructured: zapInvoice takes
// `({ addr, msats, … })`, so it lifted nine words and every assertion about the body
// failed as if the code were missing.
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

function fn(decl, name) {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(lift(decl) + '\nglobalThis.out = ' + name + ';', ctx);
  return ctx.out;
}

// ---- which note a notification is about ---------------------------------------------

test('THE TARGET IS THE LAST e TAG, NOT THE FIRST', () => {
  // NIP-10's positional form puts the thread root first and the note actually being
  // answered last. Taking the first would show the top of a long thread instead of the
  // note someone reacted to — which is exactly the context the row is missing.
  const target = fn('function notifTargetId(', 'notifTargetId');
  assert.equal(
    target({ tags: [['e', 'root'], ['p', 'someone'], ['e', 'replied-to']] }),
    'replied-to',
    'a reply chain resolves to the root instead of the note'
  );
  assert.equal(target({ tags: [['e', 'only']] }), 'only');
});

test('a notification with nothing to point at resolves to nothing', () => {
  const target = fn('function notifTargetId(', 'notifTargetId');
  for (const ev of [null, undefined, {}, { tags: null }, { tags: [] }, { tags: [['p', 'x']] }]) {
    assert.equal(target(ev), '', JSON.stringify(ev));
  }
  // An `e` tag with no value is not a pointer.
  assert.equal(target({ tags: [['e']] }), '');
  assert.equal(target({ tags: [['e', '']] }), '');
});

test('THE FETCH IS CACHED, INCLUDING WHEN NOTHING CAME BACK', () => {
  // Two reactions to the same note is the common shape of a busy list, and expanding the
  // same row twice is the common gesture. Without the negative caching, a note no relay
  // holds would be re-asked on every expand — the slowest case, retried forever.
  const f = stripComments(lift('async function fetchNoteById('));
  assert.match(f, /if \(_noteCache\.has\(id\)\) return _noteCache\.get\(id\)/, 'the fetch is not cached');
  assert.match(f, /_noteCache\.set\(id, ev \|\| null\)/, 'a miss is not remembered');
  assert.match(f, /setTimeout\(\(\) => res\(null\), \d+\)/, 'the fetch is not capped');
});

// ---- what expanding reveals ----------------------------------------------------------

test('EXPANDING LIFTS BOTH TRUNCATIONS', () => {
  // The text is cut twice: at 140 chars in the source, and again by a 3-line
  // -webkit-line-clamp in CSS. Undoing only the first left the row visibly unchanged —
  // the browser drew its own ellipsis at the same three lines — so expanding read as a
  // chevron that did nothing.
  const item = stripComments(lift('function buildItem('));
  assert.match(item, /contentEl\.textContent = fullText/, 'the 140-char cut is not undone');
  assert.match(item, /classList\.add\('notif-content-full'\)/, 'the CSS clamp is not lifted');
  assert.match(css, /\.notif-content-full \{[^}]*-webkit-line-clamp: none/, 'the class does not lift the clamp');
});

test('a reaction, repost or zap expands to the note it is about', () => {
  const item = stripComments(lift('function buildItem('));
  assert.match(item, /const targetId = isNoteLike \? '' : notifTargetId\(ev\)/,
    'the pointer is resolved for the wrong kinds');
  assert.match(item, /fetchNoteById\(targetId\)/, 'the note is never fetched');
  assert.match(item, /That note is not on your relays/,
    'a note no relay holds leaves the row saying nothing');
});

test('THE ACTIONS ARE OFFERED ON NOTES ONLY', () => {
  const item = stripComments(lift('function buildItem('));
  assert.match(item, /if \(isNoteLike\) \{\s*const stopAct/,
    'reply/react/zap is offered on a reaction, repost or zap receipt');
  assert.match(item, /item\.appendChild\(buildActions\(ev, stopAct\)\)/, 'the action row is not appended');
  // NOT behind the chevron. The actions are what you came to the row to do; the chevron
  // is for reading, which is a different question and a tap nobody should have to pay.
  const panel = item.slice(item.indexOf('function build()'), item.indexOf('toggle.addEventListener'));
  assert.doesNotMatch(panel, /buildActions/, 'the actions went back behind the drawer');
});

test('the chevron is icon-only, because that slot has no width to give', () => {
  // .notif-top-right is flex-shrink:0 beside a truncating author name, so anything with
  // words in it takes width from the name — the recurring mistake this panel makes.
  const item = stripComments(lift('function buildItem('));
  const at = item.indexOf("className: 'notif-expand-btn'");
  assert.ok(at !== -1, 'the expand button moved');
  const block = item.slice(at, at + 300);
  assert.match(block, /icon\('chevron-down'\)/, 'the chevron lost its glyph');
  assert.doesNotMatch(block, /textContent: '[A-Za-z]/, 'the expand control grew a label');
  assert.match(item, /'aria-expanded': 'false'/, 'the toggle does not announce its state');
});

test('THE ACTIONS ARE ICONS, NOT LABELLED BUTTONS', () => {
  // They sit on every note row in the list, so three words each is a toolbar repeated 25
  // times. Icons are quiet enough to always be there, which is what let them come out
  // from behind the chevron — and they need an accessible name each, which cannot go
  // through h()'s Object.assign (see the note beside the dismiss button).
  const f = stripComments(lift('function buildActions('));
  assert.doesNotMatch(f, /textContent: 'Reply'|textContent: 'React'|textContent: 'Zap'/,
    'the action buttons grew labels again');
  assert.match(f, /b\.setAttribute\('aria-label', label\)/, 'an icon-only button with no accessible name');
  assert.match(f, /title: label/, 'the icons carry no tooltip');
  for (const [name, glyph] of [['Reply', "icon\\('message-filled'\\)"], ['React', "icon\\('heart'\\)"], ['Zap', 'boltIcon\\(\\)']]) {
    assert.match(f, new RegExp("actBtn\\('" + name + "', " + glyph + "\\)"), name + ' lost its glyph');
  }
  // 30px square: a tap target, not a shrunken button. Shrinking controls to fit is the
  // thing CLAUDE.md forbids outright.
  assert.match(css, /\.notif-act \{[^}]*width: 30px; height: 30px/, 'the action buttons are no longer tap-sized');
});

// ---- reacting ------------------------------------------------------------------------

test('A REACTION IS A KIND 7 WHOSE CONTENT IS THE EMOJI', () => {
  // NIP-25. The e/p tags say what is being reacted to and whose it is; k carries the
  // target's kind so a client can filter reactions without fetching the note.
  const f = stripComments(lift('async function publishReaction('));
  assert.match(f, /kind: 7/, 'the reaction is not a kind 7');
  assert.match(f, /content: emoji/, 'the emoji is not the content');
  assert.match(f, /\['e', target\.id\]/, 'nothing says which note');
  assert.match(f, /\['p', target\.pubkey\]/, 'nothing says whose note');
  assert.match(f, /\['k', String\(target\.kind\)\]/, 'the target kind is not carried');
});

test('a reaction is signed against the account it is meant to come from', () => {
  // Same guard every other owner-signed event here uses: a reaction signed by an account
  // that changed underneath it would go out as the wrong identity.
  const f = stripComments(lift('async function publishReaction('));
  assert.match(f, /expectedPubkey: state\.activePubkey/, 'the reaction can be signed by the wrong account');
  assert.match(f, /await publishSigned\(signed\)/, 'the reaction is signed but never published');
});

test('the client tag is READ, not assumed', () => {
  // There is no panel-wide settings object — the composer's copy is local to its own
  // send path — so a reference to a bare `settings` here would throw at click time.
  const f = stripComments(lift('async function publishReaction('));
  assert.match(f, /await call\(\{ type: 'SIDECAR_GET_SETTINGS' \}\)/, 'the setting is not read');
  assert.match(f, /clientTag \? \[\.\.\.tags, CLIENT_TAG\.slice\(\)\] : tags/, 'the setting is not honored');
});

// ---- the picker ----------------------------------------------------------------------

test('THE PICKER RENDERS ONE GROUP AT A TIME', () => {
  // Every cell is a real button, for the keyboard and for a screen reader, and 1,914 of
  // those is a visible hitch on open in a 360px panel. The largest group is 388.
  const f = stripComments(lift('function emojiPickerModal('));
  assert.match(f, /function showGroup\(i\)/, 'the picker no longer shows a single group');
  assert.match(f, /paintGrid\(groups\[i\]\[1\]\)/, 'a tab paints something other than its group');
  assert.match(f, /createDocumentFragment/, 'the cells are appended one at a time');
  assert.match(source, /const EMOJI_SEARCH_MAX = \d+/, 'search results are uncapped');
});

test('search reads across every group', () => {
  // Nobody knows which of the nine groups "shrug" is in, which is the whole point of
  // having a search box over a table that is already grouped.
  const f = stripComments(lift('function emojiPickerModal('));
  assert.match(f, /for \(const \[, rows\] of groups\)/, 'search no longer covers every group');
  assert.match(f, /row\[1\]\.includes\(q\)/, 'search no longer matches on the name');
  assert.match(f, /No emoji matches that/, 'a search with no hits says nothing');
});

test('A MISSING EMOJI TABLE SAYS SO', () => {
  // The table is a plain script tag, so this only fails if the file is missing from a
  // build — but an empty sheet reads as a hung fetch, and there is nothing to wait for.
  const f = stripComments(lift('function emojiPickerModal('));
  assert.match(f, /The emoji table did not load/, 'a missing table leaves an empty sheet');
  const g = stripComments(lift('function emojiGroups('));
  assert.match(g, /Array\.isArray\(table\) && table\.length/, 'the table is trusted without checking');
});

test('the vendored table is loaded by the panel', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  assert.match(html, /<script src="emoji-data\.js"><\/script>/, 'the panel does not load the emoji table');
  const hashes = fs.readFileSync(path.join(ROOT, 'scripts', 'vendor-hashes.sha256'), 'utf8');
  assert.match(hashes, /\s+emoji-data\.js$/m, 'the emoji table is not hash-pinned like the other bundles');
  const data = fs.readFileSync(path.join(ROOT, 'emoji-data.js'), 'utf8');
  assert.match(data, /GENERATED — do not edit/, 'the generated header is gone');
  assert.match(data, /^self\.SidecarEmoji = \[\[/m, 'the table is not the shape the picker reads');
});

// ---- zapping -------------------------------------------------------------------------

test('A ZAP FROM A NOTIFICATION IS A ZAP OF THE NOTE', () => {
  // makeZapRequest adds the `e` tag from `event`. Without it the receipt lands on the
  // author's profile with no note attached, and neither side can tell what was zapped.
  const f = stripComments(lift('function buildZapForm('));
  assert.match(f, /event: ev,/, 'the zap no longer names the note');
  const inv = stripComments(lift('async function zapInvoice('));
  assert.match(inv, /NT\.nip57\.makeZapRequest\(\{ event, amount: msats/, 'zapInvoice ignores the event');
  assert.match(inv, /const template = event/, 'the two request forms are no longer exclusive');
  // And the profile sheet's form, which zaps a PERSON, must keep working.
  assert.match(inv, /makeZapRequest\(\{ pubkey: recipientPubkey,/, 'the profile zap lost its form');
});

test('the zap form is built on first tap, not with the row', () => {
  // It costs a profile fetch to learn whether someone can be zapped at all. Doing that
  // for every row in the list would be 25 round trips for the one zap anybody sends.
  const f = stripComments(lift('function buildActions('));
  assert.match(f, /if \(!zapBuilt\)/, 'the zap form is built for every row up front');
  const z = stripComments(lift('function buildZapForm('));
  assert.match(z, /if \(!p\.zappable\) throw new Error/, 'an address that cannot receive zaps is still offered');
  assert.match(z, /send\.disabled = true/, 'the send button is live before the address is known');
});

test('the amount row and presets reuse the profile sheet', () => {
  // Same control, same class names, so the two zap forms cannot drift apart visually.
  const z = stripComments(lift('function buildZapForm('));
  assert.match(z, /className: 'peek-zap-presets'/, 'the presets stopped being the shared row');
  assert.match(z, /className: 'zap-inline'/, 'the amount row stopped being the shared row');
  assert.match(z, /satsInput\('sats'\)/, 'the amount field is no longer the shared input');
});

test('a sent zap is recorded so history can name it', () => {
  // NWC history keeps the amount and nothing else, so without this the row reads as a
  // bare "Sent" — the same reasoning the profile sheet's zap records.
  const z = stripComments(lift('function buildZapForm('));
  assert.match(z, /savePayMeta\(invoice, \{/, 'the payment is not recorded');
  assert.match(z, /zapPubkey: who/, 'history cannot tell this was a zap');
});
