'use strict';

// Bookmarking a note from a notification.
//
// The bookmarks modal only ever read these lists and removed from them. This adds the
// one WRITE, and a kind 10003 is replaceable: whatever is published becomes the list.
// So the dangerous case is not a failed publish, it is a SUCCESSFUL one built on a list
// that never arrived, which replaces every bookmark the account has with the single note
// just tapped. "No list yet" and "the relays said nothing" are the same silence from the
// panel's side, and most of this file is about telling them apart.

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

// The panel around the function: relays that answer with whatever the test scripts, a
// signer that hands back what it was given, and a publisher that records.
function harness(answers, pubkey = 'alice') {
  const published = [];
  const queries = [];
  const ctx = {
    state: { activePubkey: pubkey },
    readRelayUrls: async () => ['wss://one', 'wss://two'],
    poolQuerySync: async (relays, filter) => { queries.push(filter); return answers; },
    call: async (msg) => ({ ...msg.event, id: 'signed', pubkey: 'alice' }),
    publishSigned: async (ev) => { published.push(ev); },
    _bmCache: { pubkey: 'alice', evs: [{ id: 'stale' }], events: new Map() },
  };
  vm.createContext(ctx);
  vm.runInContext(lift('async function addBookmark(') + '\nglobalThis.out = addBookmark;', ctx);
  return { add: ctx.out, published, queries, cache: ctx._bmCache };
}

const NOTE = { id: 'f'.repeat(64), pubkey: 'bob', kind: 1 };
const list = (tags, extra) => ({ kind: 10003, created_at: 100, tags, content: '', ...extra });
const profile = { kind: 0, created_at: 50, tags: [], content: '{}' };

// ---- the list is added to, never rebuilt -----------------------------------------------

test('an existing list keeps every tag it had, with the new note appended', async () => {
  const have = list([['e', 'a'.repeat(64)], ['e', 'b'.repeat(64)], ['t', 'reading']]);
  const { add, published } = harness([have, profile]);
  assert.equal(await add(NOTE), true);
  assert.equal(published.length, 1);
  assert.equal(published[0].kind, 10003);
  assert.equal(
    published[0].tags.map((t) => t.join(':')).join('|'),
    ['e:' + 'a'.repeat(64), 'e:' + 'b'.repeat(64), 't:reading', 'e:' + NOTE.id].join('|'),
    'the list was rebuilt rather than appended to'
  );
});

test("THE CONTENT IS CARRIED THROUGH, BECAUSE IT IS SOMEONE ELSE'S CIPHERTEXT", async () => {
  // NIP-51 lists may hold private entries encrypted to the owner. The panel cannot read
  // that field and has no business rewriting it: publishing an empty content would
  // delete every private bookmark while appearing to add one.
  const have = list([['e', 'a'.repeat(64)]], { content: 'nip44:opaque-ciphertext' });
  const { add, published } = harness([have, profile]);
  await add(NOTE);
  assert.equal(published[0].content, 'nip44:opaque-ciphertext');
});

test('the newest copy of the replaceable event is the one extended', async () => {
  // Relays hand back their own copies. Building on the older one would silently drop
  // whatever was bookmarked in between.
  const older = { ...list([['e', 'a'.repeat(64)]]), created_at: 100 };
  const newer = { ...list([['e', 'a'.repeat(64)], ['e', 'c'.repeat(64)]]), created_at: 200 };
  const { add, published } = harness([older, newer, profile]);
  await add(NOTE);
  assert.equal(published[0].tags.length, 3, 'the older copy won, losing a bookmark');
});

test('a note already on the list publishes nothing at all', async () => {
  const have = list([['e', NOTE.id]]);
  const { add, published } = harness([have, profile]);
  assert.equal(await add(NOTE), false, 'a duplicate reports itself as a fresh bookmark');
  assert.equal(published.length, 0, 'the list was republished to say exactly what it said');
});

// ---- silence is not an empty list -------------------------------------------------------

test('SILENT RELAYS PUBLISH NOTHING', async () => {
  // The whole point. An account with bookmarks whose relays did not answer must not end
  // up with a one-entry list, which is what "just write it" would do here.
  const { add, published } = harness([]);
  await assert.rejects(() => add(NOTE), /Could not read your bookmarks/);
  assert.equal(published.length, 0);
});

test('a profile back with no list means the account really has none', async () => {
  // The control: the same filter asks for kind 0, so an answer proves the relays are
  // talking. Then the first list is ours to write.
  const { add, published } = harness([profile]);
  assert.equal(await add(NOTE), true);
  assert.equal(published[0].tags.map((t) => t.join(':')).join('|'), 'e:' + NOTE.id);
  assert.equal(published[0].content, '', 'a list invented here starts with content of its own');
});

test('the filter asks for the control in the same round trip', () => {
  const f = stripComments(lift('async function addBookmark('));
  assert.match(f, /kinds: \[0, 10003\]/, 'the control costs a second query, or is not asked for');
  assert.match(f, /authors: \[pubkey\]/, "somebody else's bookmarks are being read");
});

test('the modal is made to refetch rather than reopening on a stale list', async () => {
  const { add, cache } = harness([list([]), profile]);
  await add(NOTE);
  assert.equal(cache.pubkey, null, 'the cached list still claims to be current');
});

test('a locked panel refuses before it reaches a relay', async () => {
  // Every signed event is bound to the active account. With none there is no list to
  // extend and nothing to sign against, and the relays should not be asked either.
  const { add, published, queries } = harness([list([]), profile], null);
  await assert.rejects(() => add(NOTE), /No account is unlocked/);
  assert.equal(published.length, 0);
  assert.equal(queries.length, 0, 'it went to the relays without an account to ask about');
});

// ---- the button -------------------------------------------------------------------------

test('the row ends with the bookmark, after the four public actions', () => {
  const src = stripComments(source);
  assert.match(
    src,
    /row\.append\(replyBtn, repostBtn, reactBtn, zapBtn, bmBtn\)/,
    'the action row changed order or lost the bookmark'
  );
  assert.match(src, /const bmBtn = actBtn\('Bookmark', icon\('bookmark'\)\)/, 'the button is unlabeled');
  // Appended last AND pushed to the far edge: the gap is what separates the private
  // action from the four public ones, the way every client the user came from groups them.
  assert.match(src, /bmBtn\.classList\.add\('notif-act-end'\)/, 'the button sits against the zap');
  assert.match(css, /\.notif-actions \.notif-act-end \{[^}]*margin-left: auto/, 'nothing pushes it right');
});

test('a bookmarked button stops taking taps', () => {
  // The list is replaceable: a second publish rewrites it to say the same thing, and
  // each rewrite is another chance to land on a list that failed to load.
  const at = stripComments(source).indexOf("const bmBtn = actBtn('Bookmark'");
  const handler = stripComments(source).slice(at, at + 700);
  assert.match(handler, /bmBtn\.disabled = true/, 'the button can be tapped twice');
  assert.match(handler, /bmBtn\.classList\.add\('done'\)/, 'nothing says it worked after the toast fades');
  assert.match(handler, /bmBtn\.disabled = false/, 'a failed bookmark leaves the button dead');
  assert.match(css, /\.notif-act\.done \{[^}]*color: var\(--gold\)/, 'the done state has no style');
});
