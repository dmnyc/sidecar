'use strict';

// Replying from a notification, and the tags that make it land in the right thread.
//
// Nostr has two threading models and they are not interchangeable:
//
//   kind 1     NIP-10. Markered `e` tags — one "root" for the thread, one "reply" for
//              the note being answered.
//   kind 1111  NIP-22. Scope in UPPERCASE tags (I/K for an external target like a web
//              page, E/K for an event), parent in lowercase.
//
// Getting this wrong does not throw. It publishes a real, signed event that lands in
// the wrong thread, or in no thread at all, and there is no taking it back — which is
// why the tag builder is a pure function with tests rather than inline in the composer.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

const ME = 'me'.padEnd(64, '0');
function build(target, activePubkey) {
  const ctx = {
    console, Set, Array, String,
    WEB_COMMENT_KIND: 1111,
    state: { activePubkey: activePubkey || ME },
  };
  vm.createContext(ctx);
  vm.runInContext(lift('function replyTags(') + '\nglobalThis.replyTags = replyTags;', ctx);
  const r = ctx.replyTags(target);
  // Spread the OUTER array on the host side too. r.tags.map() runs the vm's
  // Array.prototype.map and returns a vm array, which assert.deepEqual (strict)
  // rejects on prototype identity even when the contents match.
  return { kind: r.kind, tags: [...r.tags].map((t) => [...t]) };
}

const AUTHOR = 'aa'.padEnd(64, '1');
const OTHER = 'bb'.padEnd(64, '2');
const NOTE = 'cc'.padEnd(64, '3');
const ROOT_ID = 'dd'.padEnd(64, '4');

const eTags = (r) => r.tags.filter((t) => t[0] === 'e');
const pList = (r) => r.tags.filter((t) => t[0] === 'p').map((t) => t[1]);

// ---- NIP-10: replying to a note -----------------------------------------------------

test('replying to a root note marks it as the root', () => {
  const r = build({ kind: 1, id: NOTE, pubkey: AUTHOR, tags: [] });
  assert.equal(r.kind, 1);
  assert.deepEqual(eTags(r), [['e', NOTE, '', 'root']]);
});

test('A ROOT NOTE GETS NO SEPARATE REPLY TAG', () => {
  // Adding one pointing at the same event makes clients render it as a reply to
  // itself, which is how a thread ends up nested inside its own first post.
  const r = build({ kind: 1, id: NOTE, pubkey: AUTHOR, tags: [] });
  assert.equal(eTags(r).length, 1, JSON.stringify(eTags(r)));
});

test('replying inside a thread keeps the original root and points at the parent', () => {
  const r = build({
    kind: 1, id: NOTE, pubkey: AUTHOR,
    tags: [['e', ROOT_ID, '', 'root'], ['e', 'earlier', '', 'reply']],
  });
  assert.deepEqual(eTags(r), [
    ['e', ROOT_ID, '', 'root'],
    ['e', NOTE, '', 'reply'],
  ]);
});

test('everyone in the conversation is carried forward', () => {
  const r = build({ kind: 1, id: NOTE, pubkey: AUTHOR, tags: [['p', OTHER]] });
  assert.deepEqual(pList(r).sort(), [AUTHOR, OTHER].sort());
});

test('the replier is never p-tagged', () => {
  // Self-tagging turns your own reply into a notification from you.
  const r = build({ kind: 1, id: NOTE, pubkey: AUTHOR, tags: [['p', ME], ['p', OTHER]] }, ME);
  assert.ok(!pList(r).includes(ME), 'got ' + JSON.stringify(pList(r)));
});

test('duplicate participants are not tagged twice', () => {
  const r = build({ kind: 1, id: NOTE, pubkey: AUTHOR, tags: [['p', AUTHOR], ['p', AUTHOR], ['p', OTHER]] });
  assert.deepEqual(pList(r), [AUTHOR, OTHER]);
});

// ---- NIP-22: replying to a web comment ----------------------------------------------

const WEB = 'https://example.com/article';

test('a reply to a comment is itself a comment, not a note', () => {
  const r = build({ kind: 1111, id: NOTE, pubkey: AUTHOR, tags: [['I', WEB], ['K', 'web']] });
  assert.equal(r.kind, 1111, 'a kind:1 answer to a 1111 lands outside the thread entirely');
});

test('THE ROOT SCOPE IS COPIED, NOT REBUILT', () => {
  // Uppercase tags name the thread root. Re-deriving them is a chance to get it wrong,
  // and a comment whose scope drifts lands in a different thread on the same page.
  const r = build({
    kind: 1111, id: NOTE, pubkey: AUTHOR,
    tags: [['I', WEB], ['K', 'web'], ['i', WEB], ['k', 'web']],
  });
  assert.deepEqual(r.tags.filter((t) => t[0] === 'I'), [['I', WEB]]);
  assert.deepEqual(r.tags.filter((t) => t[0] === 'K'), [['K', 'web']]);
});

test('an event-rooted comment carries its E scope through', () => {
  const r = build({ kind: 1111, id: NOTE, pubkey: AUTHOR, tags: [['E', ROOT_ID], ['K', '1']] });
  assert.deepEqual(r.tags.filter((t) => t[0] === 'E'), [['E', ROOT_ID]]);
});

test('the parent is named in lowercase, with its kind', () => {
  const r = build({ kind: 1111, id: NOTE, pubkey: AUTHOR, tags: [['I', WEB], ['K', 'web']] });
  assert.deepEqual(r.tags.filter((t) => t[0] === 'e'), [['e', NOTE]]);
  assert.deepEqual(r.tags.filter((t) => t[0] === 'k'), [['k', '1111']]);
});

test('the parent comment’s own lowercase tags are not inherited', () => {
  // Copying the parent's `e`/`k` would point the new comment at the parent's PARENT.
  const r = build({
    kind: 1111, id: NOTE, pubkey: AUTHOR,
    tags: [['I', WEB], ['K', 'web'], ['e', 'grandparent'], ['k', '1111']],
  });
  assert.deepEqual(r.tags.filter((t) => t[0] === 'e'), [['e', NOTE]], 'only the direct parent');
});

// ---- the composer -------------------------------------------------------------------

test('a reply publishes with the kind replyTags chose', () => {
  // A 1111 answered with a kind:1 is invisible in the thread it was meant for.
  const fn = lift('async function doPublish(');
  assert.match(fn, /kind: reply \? reply\.kind : 1/);
});

test('threading tags come first', () => {
  // NIP-10 readers take the first root-markered `e` as the thread; some NIP-22 readers
  // read scope positionally.
  const fn = lift('async function doPublish(');
  const base = fn.indexOf('const base = reply ? reply.tags : []');
  assert.ok(base !== -1);
  assert.match(fn, /\[\.\.\.base, CLIENT_TAG\.slice\(\), \.\.\.bodyP/);
});

test('a body mention does not duplicate a participant already tagged', () => {
  const fn = lift('async function doPublish(');
  assert.match(fn, /already\.has\(t\[1\]\)/);
});

// ---- where it is offered --------------------------------------------------------------

test('reply is offered on notes and comments only', () => {
  // A reaction, repost or zap receipt has no thread to join. A reply tagging a kind:7
  // renders as nothing sensible anywhere, and a button that produces a dead-end event
  // is worse than no button.
  const at = source.indexOf("const actionRow = h('div', { className: 'notif-action'");
  assert.ok(at !== -1, 'the notification action row moved');
  const block = source.slice(at, at + 1400);
  assert.match(block, /if \(ev\.kind === 1 \|\| ev\.kind === WEB_COMMENT_KIND\) \{/);
});

test('the reply button does not also follow the row link', () => {
  // The row is an anchor that opens the note in a client. Without stopping the event,
  // tapping Reply would open a tab behind the composer as well.
  const at = source.indexOf("const actionRow = h('div', { className: 'notif-action'");
  const block = source.slice(at, at + 1400);
  assert.match(block, /e\.preventDefault\(\)/);
  assert.match(block, /e\.stopPropagation\(\)/);
});

test('the composer shows what is being answered', () => {
  const fn = lift('function buildReplyBlock(');
  assert.match(fn, /renderNoteText\(body, replyTo\.content/);
  assert.match(fn, /notifAuthorName\(replyTo\.pubkey\)/);
});

test('the reply context sits above the tabs, not inside a view', () => {
  // Same reasoning as the page-comment modal's target block: it is the subject, not
  // one of the two panes, so it must not vanish when you switch to Preview.
  const at = source.indexOf("h('h3', { textContent: replyTo ? 'Reply' : 'New note' })");
  assert.ok(at !== -1, 'the composer heading moved');
  const block = source.slice(at, at + 400);
  const ctx = block.indexOf('buildReplyBlock()');
  const tabs = block.indexOf('tabBar');
  assert.ok(ctx !== -1 && tabs !== -1, 'the append order moved');
  assert.ok(ctx < tabs, 'context must be appended before the tab bar');
});

// ---- the review countdown -------------------------------------------------------------

test('the countdown shows the parent too', () => {
  // The last screen before it publishes. A reply read without what it answers is the
  // one that goes out saying the wrong thing.
  const fn = lift('function showCountdown(');
  assert.match(fn, /buildReplyBlock\(\)/);
  const parent = fn.indexOf('buildReplyBlock()');
  const body = fn.indexOf('previewBody');
  assert.ok(parent < body, 'parent first, then what you wrote — reading order');
});

test('the reply block is built fresh, not held as one node', () => {
  // A DOM element lives in exactly one place. Reusing a single node would move it out
  // of the editor and into the countdown, so going back would leave the editor bare.
  const fn = lift('function buildReplyBlock(');
  assert.match(fn, /const block = h\('div', \{ className: 'reply-target' \}\)/, 'a new node each call');
  const editor = source.indexOf('...(replyTo ? [buildReplyBlock()] : [])');
  assert.ok(editor !== -1, 'the editor pane must call the builder too');
});

test('the countdown names what it is posting', () => {
  const fn = lift('function showCountdown(');
  assert.match(fn, /replyTo \? 'Posting your reply' : 'Posting your note'/);
});

test('the review preview cannot be squashed to nothing', () => {
  // .modal is a flex column. max-height capped this pane but nothing stopped it
  // COLLAPSING, and it was measured at 26px tall holding 137px of content once the
  // reply target made it taller — a countdown showing almost nothing right before it
  // publishes. It scrolls internally instead, which is what the cap was always for.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const rule = css.match(/\.countdown-preview \{[^}]*\}/)[0];
  assert.match(rule, /flex-shrink: 0/);
  assert.match(rule, /overflow-y: auto/, 'so the cap still bounds it');
});

// ---- the review countdown -------------------------------------------------------------

test('the countdown shows the parent too', () => {
  // The last screen before it publishes. A reply read without what it answers is the
  // one that goes out saying the wrong thing.
  const fn = lift('function showCountdown(');
  assert.match(fn, /buildReplyBlock\(\)/);
  assert.ok(fn.indexOf('buildReplyBlock()') < fn.indexOf('previewBody'), 'parent first, reading order');
});

test('the reply block is built fresh, not held as one node', () => {
  // A DOM element lives in exactly one place. Reusing a single node would move it out
  // of the editor into the countdown, leaving the editor bare on the way back.
  assert.match(lift('function buildReplyBlock('), /const block = h\('div', \{ className: 'reply-target' \}\)/);
  assert.ok(source.includes('...(replyTo ? [buildReplyBlock()] : [])'), 'the editor calls it too');
});

test('the review preview cannot be squashed to nothing', () => {
  // .modal is a flex column. max-height capped this pane but nothing stopped it
  // COLLAPSING — measured at 26px tall holding 137px of content once the reply target
  // made it taller, which is a countdown showing almost nothing right before it posts.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const rule = css.match(/\.countdown-preview \{[^}]*\}/)[0];
  assert.match(rule, /flex-shrink: 0/);
  assert.match(rule, /overflow-y: auto/, 'so the cap still bounds it');
});

// ---- drafts ---------------------------------------------------------------------------

test('A SAVED REPLY REMEMBERS WHAT IT ANSWERS', () => {
  // Without this a resumed reply came back as a plain note — same text, no target — and
  // posting it published a top-level note instead of an answer, silently.
  const fn = lift('function saveComposeDraft(');
  assert.match(fn, /if \(draft\.replyTo\)/);
  assert.match(fn, /id: r\.id, pubkey: r\.pubkey, kind: r\.kind, tags: r\.tags, content: r\.content/);
});

test('resuming a draft restores its target', () => {
  const at = source.indexOf("const resume = h('button'");
  const block = source.slice(at, at + 400);
  assert.match(block, /replyTo = saved\.replyTo \|\| null/);
  assert.match(block, /media: \(saved\.media \|\| \[\]\)\.slice\(\), replyTo/);
});

test('starting fresh keeps the target you arrived with', () => {
  // Discarding an old draft must not also discard the Reply just tapped to get here.
  const at = source.indexOf("const fresh = h('button'");
  const block = source.slice(at, at + 400);
  assert.match(block, /replyTo = \(opts && opts\.replyTo\) \|\| null/);
});

test('the draft chooser says whether the saved draft is a reply', () => {
  // One slot per account, so the saved draft may be a reply while you came to write a
  // note. Resuming silently changes what Post will publish.
  assert.match(source, /const savedIsReply = !!saved\.replyTo/);
  assert.match(source, /savedIsReply \? 'Resume your reply\?' : 'Resume your draft\?'/);
});

test('the reply target is stored without its signature', () => {
  // The drafts store is encrypted at rest for a reason; there is no cause to keep a
  // stranger's sig in it, and nothing reads it.
  const fn = lift('function saveComposeDraft(');
  assert.doesNotMatch(fn, /\bsig\b/);
});

// ---- the avatar -------------------------------------------------------------------------

test('the reply target avatar has a picture to show', () => {
  // _notifProfiles is NAME ONLY, so a bare pubkey gave avatarEl nothing and every reply
  // rendered a placeholder. Cached only — no fetch on a screen already being typed into.
  const fn = lift('function buildReplyBlock(');
  assert.match(fn, /cachedProfile\(replyTo\.pubkey\)/);
  assert.match(fn, /picture: prof\.picture/);
});

test('the placeholder is contained, not cropped', () => {
  // applyAvatar sets .avatar-ph for the placeholder, which is a GLYPH: object-fit cover
  // crops it to a corner. Every other avatar class in the panel carries this rule.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(css, /\.reply-target-av\.avatar-ph img \{[^}]*object-fit: contain/);
});
