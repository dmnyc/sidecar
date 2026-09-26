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
// composer-core.js is loaded beside the panel: the DOM toolkit moved there so the
// expanded composer page could share it rather than keep a second copy of 55 icons.
// Both files are the panel's source as far as these assertions are concerned.
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8') +
  '\n' + fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
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

test('EXPANDING LIFTS BOTH TRUNCATIONS, AND COLLAPSING PUTS THEM BACK', () => {
  // The text is cut twice: at 140 chars in the source, and again by a three-line
  // -webkit-line-clamp in CSS. Undoing only the first left the row visibly unchanged,
  // with the browser drawing its own ellipsis at the same three lines.
  //
  // And it has to be REVERSIBLE. This lived in build(), which runs once, so collapsing
  // never put the snippet back — on a reply row, whose panel holds nothing, the caret had
  // no visible effect at all. Reported as "sometimes it does nothing"; the rows where it
  // seemed to work were the reaction ones, where the panel did have a note in it. Worse,
  // the still-unclamped text then measured as unclipped and syncToggle hid the caret.
  const item = stripComments(lift('function buildItem('));
  assert.match(item, /const text = cleanSnippet\(ev\.content \|\| ''\)/,
    'the expanded text is a build-time snapshot, so resolved mention names are lost');
  assert.match(item, /contentEl\.textContent = open\s*\?\s*text/, 'the text is not swapped both ways');
  assert.match(item, /: \(text\.length > 140 \? text\.slice\(0, 140\) \+ '…' : text\)/,
    'collapsing does not put the 140-char cut back');
  assert.match(item, /contentEl\.classList\.toggle\('notif-content-full', open\)/,
    'the CSS clamp is lifted but never restored');
  assert.match(css, /\.notif-content-full \{[^}]*-webkit-line-clamp: none/, 'the class does not lift the clamp');
  // Both must happen in the toggle, not in the one-time builder.
  const build = item.slice(item.indexOf('function build()'), item.indexOf("toggle.addEventListener"));
  assert.doesNotMatch(build, /notif-content-full/, 'expanding the text is a one-way door again');
  // And the late mention-name pass must not collapse a row the reader has open.
  const sheet = stripComments(lift('async function showNotifModal('));
  assert.match(sheet, /if \(el\.classList\.contains\('notif-content-full'\)\)/,
    'the mention re-render can collapse an expanded row');
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

test('THE CHEVRON IS ONLY THERE WHEN IT REVEALS SOMETHING', () => {
  // Reported: on a one-line comment the toggle changed nothing, so it read as broken
  // furniture. And it has to be MEASURED — the 140-char source cut is half the story,
  // since .notif-content is a three-line clamp, so a 90-character note can wrap past it
  // and a 200-character one can fit inside it after mention shortening.
  const item = stripComments(lift('function buildItem('));
  assert.match(item, /toggle\.classList\.add\('notif-expand-none'\)/, 'the chevron is shown unconditionally');
  assert.match(item, /contentEl\.scrollHeight > contentEl\.clientHeight \+ 1/,
    'whether the text is clipped is guessed rather than measured');
  // NOT ON THE FRAME LOOP. requestAnimationFrame never fires while the document is
  // hidden, and a ResizeObserver is delivered on that same loop, so a row built with the
  // panel closed or occluded would be measured never and keep no chevron. Reading
  // scrollHeight forces layout by itself; it does not need a frame.
  const at = item.indexOf("toggle.classList.add('notif-expand-none')");
  const block = item.slice(at, at + 900);
  assert.match(block, /setTimeout\(syncToggle, 0\)/, 'the first measurement is not on a timer');
  assert.doesNotMatch(block, /requestAnimationFrame/, 'the measurement is back on the frame loop');
  // The font swap changes how the text wraps, so the answer is asked for again after it.
  assert.match(block, /document\.fonts\.ready\.then\(syncToggle\)/, 'a font swap can leave the answer stale');
  assert.match(block, /new ResizeObserver\(syncToggle\)/, 'dragging the panel wider cannot change the answer');
  // Expanded, the clamp is off and nothing measures as clipped — hiding the control then
  // would strand the row open with no way back.
  assert.match(block, /if \(toggle\.classList\.contains\('open'\)\) return/, 'expanding can hide its own control');
  // A reaction/repost/zap row keeps it: there is always a note to go and fetch.
  assert.match(item, /if \(!targetId\) \{/, 'the pointer rows lost their chevron too');
  assert.match(css, /\.notif-expand-none \{ display: none; \}/, 'hiding the chevron leaves a gap');
});

// ---- what you reacted with -----------------------------------------------------------

test('A REACTION OF YOURS SHOWS ON THE ROW', () => {
  // Without it, reacting is a toast that disappears and a row that looks exactly as it
  // did, so tomorrow you cannot tell whether you already answered something — which is
  // the question a notification list exists to answer.
  const item = stripComments(lift('function buildItem('));
  assert.match(item, /className: 'notif-reacted hidden'/, 'the row has nowhere to show a reaction');
  assert.match(item, /paintMyReactions\(reactedEl, ev\.id\)/, 'an existing reaction is not drawn on build');
  const actions = stripComments(lift('function buildActions('));
  assert.match(actions, /addMyReaction\(ev\.id, \{ content: ch, tags: \[\] \}\)/, 'a reaction is published but never shown');
});

test('the same emoji twice is one chip', () => {
  const f = stripComments(lift('function addMyReaction('));
  assert.match(f, /new Map\(\)/, 'reactions are not deduped per note');
  assert.match(f, /map\.set\(\(ev\.content \|\| ''\)\.trim\(\), reactionDisplay\(ev\)\)/,
    'the reaction is not stored by its content');
});

test('EVERY ROW FOR THAT NOTE GETS THE CHIP', () => {
  // One note can be the target of several notifications — a reply, and a reaction to it —
  // so updating only the row that was tapped would leave the others disagreeing.
  const f = stripComments(lift('function addMyReaction('));
  assert.match(f, /querySelectorAll\(/, 'only one row is updated');
  assert.match(f, /data-notif-id="' \+ cssEscape\(noteId\)/, 'the selector is built from unescaped data');
});

test('the legacy + and - reactions draw as the sender ones do', () => {
  // notifLabel shows a SENDER's '+' as ❤️ through the same reactionDisplay, and a chip
  // of ours that showed a literal plus sign would make one event read as two different
  // things on one screen.
  const d = fn('function reactionDisplay(', 'reactionDisplay');
  assert.equal(d({ content: '+', tags: [] }).glyph, '❤️');
  assert.equal(d({ content: '-', tags: [] }).glyph, '👎');
  assert.equal(d({ content: '', tags: [] }).glyph, '❤️', 'an empty reaction is a like');
  assert.equal(d({ content: '🔥', tags: [] }).glyph, '🔥', 'a real emoji must survive exactly as sent');
});

test('REACTIONS ARE ASKED OF THE RELAYS, NOT JUST REMEMBERED', () => {
  // The question is "did I answer this", not "did I answer this from Sidecar" — so a
  // reaction sent from another client, or from this panel before a reload, counts. One
  // query for the whole list, after the sheet is interactive, capped like the rest.
  const fnSrc = stripComments(lift('async function showNotifModal('));
  assert.match(fnSrc, /kinds: \[7\], authors: \[a\.pubkey\], '#e': ids/, 'own reactions are never fetched');
  // The event goes in whole: a custom emoji's picture lives in its emoji tag, and a
  // restore that passed only r.content printed the shortcode as literal chip text.
  assert.match(fnSrc, /addMyReaction\(notifTargetId\(r\), r\)/, 'the results are not painted');
  assert.match(fnSrc, /setTimeout\(\(\) => res\(\[\]\), \d+\)/, 'the query is uncapped');
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

test('THE PICKER OPENS OVER THE SHEET, NOT INSTEAD OF IT', () => {
  // Reported: reacting closed the notification list and dropped you back on the panel,
  // so you lost your place in a list you were working through. There is one #modal
  // element, so anything routed through openModal replaces what is already in it — this
  // layers itself inside instead, leaving the list, its loaded pages and its scroll
  // offset untouched underneath.
  const f = stripComments(lift('function emojiPickerOver('));
  assert.doesNotMatch(f, /openModal\(/, 'the picker replaces the sheet again');
  assert.match(f, /host\.appendChild\(sheet\)/, 'the picker is not mounted into the sheet');
  assert.match(f, /const close = \(\) => sheet\.remove\(\)/, 'dismissing the picker does more than remove it');
  assert.doesNotMatch(f, /closeModal\(\)/, 'the picker can still close the sheet behind it');
  const actions = stripComments(lift('function buildActions('));
  assert.match(actions, /emojiPickerOver\(\$\('modal'\)/, 'the React button no longer opens it over the sheet');
  assert.match(css, /\.emoji-over \{[^}]*position: absolute/, 'the layer does not cover the sheet');
});

test('escape closes the picker and not the sheet under it', () => {
  const f = stripComments(lift('function emojiPickerOver('));
  assert.match(f, /e\.key !== 'Escape'/, 'the picker ignores Escape');
  assert.match(f, /e\.stopPropagation\(\)/, "Escape falls through to the panel's own dismiss");
});

test('REPLYING COMES BACK TO WHERE YOU WERE', () => {
  // The composer is the one action that cannot open over the sheet — it is a full editor
  // with tabs, media and a review countdown, and it needs the panel. So the sheet is
  // rebuilt afterwards with the pages it had loaded and the offset it was scrolled to,
  // whether the reply was posted or abandoned.
  const actions = stripComments(lift('function buildActions('));
  assert.match(actions, /const place = notifPlace\(\)/, 'the place is not captured before leaving');
  assert.match(actions, /returnTo: \(\) => showNotifModal\(a, place\)/, 'nothing brings the sheet back');
  const composer = stripComments(lift('async function openComposer('));
  assert.match(composer, /typeof opts\.returnTo === 'function'/, 'the composer ignores returnTo');
  // Guarded and last: it opens a modal, and must not be able to stop the draft save.
  const at = composer.indexOf('opts.returnTo');
  assert.match(composer.slice(at - 200, at), /persistDraft\(\)/, 'the return runs before the draft is saved');
  assert.match(composer.slice(at, at + 120), /try \{/, 'a failing return can break closing the composer');
});

test('the sheet restores pages before the offset', () => {
  // Scrolling to an offset nothing has been rendered into clamps to the bottom of a
  // short list, so the pages have to come back first.
  const fnSrc = stripComments(lift('async function showNotifModal('));
  const pages = fnSrc.indexOf('place.pages > 1');
  const off = fnSrc.indexOf('place.scrollTop');
  assert.ok(pages !== -1 && off !== -1, 'the restore moved');
  assert.ok(pages < off, 'the offset is restored before the rows exist to scroll through');
  assert.match(fnSrc, /notifPlace = \(\) => \(\{[\s\S]{0,80}?pages: Math\.max\(1, Math\.ceil\(shown \/ PAGE\)\)/,
    'the sheet no longer reports where it is');
  // A timer, not a frame: rAF does not run while the document is hidden.
  assert.match(fnSrc, /setTimeout\(\(\) => \{ if \(scroll\.isConnected\) scroll\.scrollTop = want/,
    'the offset is restored on the frame loop');
});

test('THE PICKER RENDERS ONE GROUP AT A TIME', () => {
  // Every cell is a real button, for the keyboard and for a screen reader, and 1,914 of
  // those is a visible hitch on open in a 360px panel. The largest group is 388.
  const f = stripComments(lift('function emojiPickerOver('));
  assert.match(f, /function showGroup\(i\)/, 'the picker no longer shows a single group');
  assert.match(f, /paintGrid\(groups\[i\]\[1\]\)/, 'a tab paints something other than its group');
  assert.match(f, /createDocumentFragment/, 'the cells are appended one at a time');
  assert.match(source, /const EMOJI_SEARCH_MAX = \d+/, 'search results are uncapped');
});

test('search reads across every group', () => {
  // Nobody knows which of the nine groups "shrug" is in, which is the whole point of
  // having a search box over a table that is already grouped.
  const f = stripComments(lift('function emojiPickerOver('));
  assert.match(f, /for \(const \[, rows\] of groups\)/, 'search no longer covers every group');
  // row[2] is the search haystack: the name lowercased, with any curated aliases folded
  // in beside it. It was row[1], the raw name, which is why a lowercase "ital" could not
  // find "flag Italy".
  assert.match(f, /emojiHit\(row\[2\], q\)/, 'search no longer matches on the name');
  assert.match(f, /No emoji matches that/, 'a search with no hits says nothing');
});

test('A MISSING EMOJI TABLE SAYS SO', () => {
  // The table is a plain script tag, so this only fails if the file is missing from a
  // build — but an empty sheet reads as a hung fetch, and there is nothing to wait for.
  const f = stripComments(lift('function emojiPickerOver('));
  assert.match(f, /The emoji table did not load/, 'a missing table leaves an empty sheet');
  const g = stripComments(lift('function emojiGroups('));
  // Written either way round over time; what matters is that both halves are still asked.
  assert.match(g, /Array\.isArray\(table\)/, 'the table is trusted without checking its shape');
  assert.match(g, /table\.length/, 'an empty table is trusted without checking');
});

test('the vendored table is loaded by the panel', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  assert.match(html, /<script src="emoji-data\.js"><\/script>/, 'the panel does not load the emoji table');
  const hashes = fs.readFileSync(path.join(ROOT, 'scripts', 'vendor-hashes.sha256'), 'utf8');
  assert.match(hashes, /\s+emoji-data\.js$/m, 'the emoji table is not hash-pinned like the other bundles');
  const data = fs.readFileSync(path.join(ROOT, 'emoji-data.js'), 'utf8');
  assert.match(data, /GENERATED, do not edit/, 'the generated header is gone');
  // Two sources now: names from unicode-emoji-json, CLDR keywords from emojibase.
  assert.match(data, /emojibase-data@/, 'the keyword source is no longer recorded in the file');
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
  // Same controls as the profile sheet's zap form, so the two cannot drift apart. The
  // presets are no longer asserted by class here: they moved into zapPresetRow, which
  // both forms call, so sharing is now structural rather than a matching pair of
  // hand-rolled rows. See zap-default.test.js.
  const z = stripComments(lift('function buildZapForm('));
  assert.match(z, /zapPresetRow\(amount, stop\)/, 'the presets stopped being the shared row');
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
