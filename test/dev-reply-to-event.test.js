'use strict';

// REPLY TO ANY EVENT, by id: a dev-build tool in the main composer. It finds the event
// and reopens the composer as a reply to it, so every reply goes through the same code.
// These run the pieces lifted out of sidepanel.js: the id parser against the real
// nostr-tools, the fetch against stub relays, and the button against a stub composer.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
// The parser and the fetch are composer-core's, shared with the expanded tab.
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'), { filename: 'nostr-tools.js' });
const NT = globalThis.NostrTools;

function lift(decl, src = panel) {
  const at = src.indexOf(decl);
  assert.ok(at !== -1, 'no ' + decl);
  const open = src.indexOf('{', src.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

const ID = 'ab'.repeat(32);
const AUTHOR = 'cd'.repeat(32);

// The panel's own wrappers, as sidepanel.js declares them, over the core's functions.
const CORE_FNS = [lift('function parseEventRef(text, NT)', core), lift('async function fetchEventRef(ref, via)', core)];
const WRAPPERS = [
  panel.match(/const devParseEventRef = .*;/)[0],
  panel.match(/const devFetchEventRef = \(ref\) => [\s\S]*?\n  \}\);/)[0],
].join('\n').replace(/window\.SidecarCore\./g, '');

function sandbox(extra = {}) {
  const ctx = { NT, String, Set, Promise, setTimeout, ...extra };
  vm.createContext(ctx);
  vm.runInContext([
    ...CORE_FNS, WRAPPERS,
    'globalThis.api = { parseEventRef: devParseEventRef, fetchEventRef: devFetchEventRef };',
  ].join('\n'), ctx);
  return ctx.api;
}

test('the id is read from hex, note1 and nevent1, and anything else is refused', () => {
  const { parseEventRef } = sandbox();
  const plain = (r) => r && { id: r.id, relays: [...r.relays], author: r.author };
  assert.deepEqual(plain(parseEventRef(ID.toUpperCase())), { id: ID, relays: [], author: null });
  assert.deepEqual(plain(parseEventRef('  ' + NT.nip19.noteEncode(ID) + '  ')), { id: ID, relays: [], author: null });
  const nevent = NT.nip19.neventEncode({ id: ID, relays: ['wss://hint.example'], author: AUTHOR });
  assert.deepEqual(plain(parseEventRef('nostr:' + nevent)), { id: ID, relays: ['wss://hint.example'], author: AUTHOR });
  assert.equal(parseEventRef(NT.nip19.npubEncode(AUTHOR)), null, 'an npub was read as an event');
  assert.equal(parseEventRef('ab12'), null);
  assert.equal(parseEventRef(''), null);
});

test('the event is asked of its hints, the configured relays and its author\'s outbox, and must be the one asked for', async () => {
  let asked = null;
  let answer = { id: ID, pubkey: AUTHOR, kind: 1, tags: [], content: 'hi' };
  const api = sandbox({
    relayUrls: async () => ['wss://mine.example'],
    getNip65: async () => ({ write: ['wss://outbox.example'] }),
    poolGet: async (relays, filter) => { asked = { relays, filter }; return answer; },
  });
  const got = await api.fetchEventRef({ id: ID, relays: ['wss://hint.example'], author: AUTHOR });
  assert.equal(got.id, ID);
  assert.deepEqual([...asked.relays], ['wss://hint.example', 'wss://mine.example', 'wss://outbox.example']);
  assert.deepEqual([...asked.filter.ids], [ID]);
  answer = { id: 'ef'.repeat(32) };
  assert.equal(await api.fetchEventRef({ id: ID, relays: [], author: null }), null, 'another event was accepted');
});

test('the button empties the note draft and reopens the composer as a reply, carrying the text', async () => {
  const log = [];
  let clickHandler = null;
  class El {
    constructor(props = {}) { Object.assign(this, props); }
    addEventListener(type, fn) { if (type === 'click') clickHandler = fn; }
  }
  const draft = { text: 'my reply', media: [], poll: null };
  const ev = { id: ID, pubkey: AUTHOR, kind: 1111, tags: [['K', 'web']], content: 'parent' };
  const ctx = {
    NT, String, Set, Promise, setTimeout,
    isDevBuild: () => true, devReplyEnabled: true, replyTo: null, draft,
    modal: { isConnected: true },
    h: (tag, props) => new El(props), t: (x) => x,
    relayUrls: async () => ['wss://mine.example'], getNip65: async () => null,
    poolGet: async () => ev,
    flushDraftNow: async () => log.push(['flush', draft.text]),
    closeModal: () => log.push(['close']),
    openComposer: (text, opts) => log.push(['open', text, opts.replyTo]),
    switchingDraft: false,
  };
  vm.createContext(ctx);
  vm.runInContext([
    'var switchingDraft = false;',
    ...CORE_FNS, WRAPPERS,
    lift('function buildDevReplyTo()'),
    'globalThis.row = buildDevReplyTo();',
  ].join('\n'), ctx);
  assert.ok(ctx.row, 'the row was not built in a dev build with the switch on');
  // The handler reads the field's value; every stub element answers with the same id.
  El.prototype.value = NT.nip19.noteEncode(ID);
  await clickHandler();
  assert.deepEqual(log.map((l) => l[0]), ['flush', 'close', 'open'], 'the draft was not saved empty before the composer closed');
  assert.equal(log[0][1], '', 'the note draft kept the text, so it would live in two drafts');
  assert.equal(log[2][1], 'my reply', 'the typed text did not come with the reply');
  assert.equal(log[2][2].id, ID);
  assert.equal(log[2][2].kind, 1111);
  assert.equal(ctx.switchingDraft, true, 'the close handler would save the note draft again');
});

test('it is offered only in a dev build, with the switch on, in the main composer', () => {
  const fn = lift('function buildDevReplyTo()');
  assert.match(fn, /if \(!isDevBuild\(\) \|\| !devReplyEnabled \|\| replyTo\) return null;/);
  assert.match(panel, /\.\.\.\(isDevBuild\(\) && devReplyEnabled && !replyTo \? \[buildDevReplyTo\(\)\] : \[\]\),/);
  assert.match(panel, /devReplyEnabled = ds\?\.devReplyById === true;/);
  // Refused while media or a poll is in the draft: those do not travel with the text.
  assert.match(fn, /if \(\(draft\.media \|\| \[\]\)\.length \|\| draft\.poll\)/);
});

// AN ID LEFT IN THE FIELD IS NOT A REPLY. Typing one and pressing Post published a plain
// note, because only the button turned the composer into a reply. Both composers now load
// on paste or Enter, and refuse to post while an unloaded id is still in the field.
const page = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');

test('a pasted id or Enter loads it, in both composers', () => {
  for (const [name, src, parse] of [['panel', panel, 'devParseEventRef'], ['tab', page, 'SC\\.parseEventRef']]) {
    assert.match(src, new RegExp("field\\.addEventListener\\('paste', \\(\\) => setTimeout\\(\\(\\) => \\{ if \\(" + parse + '\\(field\\.value'), name + ': a paste does not load');
    assert.match(src, /field\.addEventListener\('keydown', \(e\) => \{ if \(e\.key === 'Enter'\) \{ e\.preventDefault\(\); load\(\); \} \}\);/, name + ': Enter does not load');
  }
});

test('Post refuses while an unloaded id is in the field, in both composers', () => {
  const guard = /if \(devReplyField && devReplyField\.isConnected && devReplyField\.value\.trim\(\) && !replyTo\) \{/;
  const panelPost = panel.slice(panel.indexOf("post.addEventListener('click', async () => {", panel.indexOf('function buildDevReplyTo()')));
  assert.match(panelPost.slice(0, 600), guard, 'the panel posts an unloaded id as a plain note');
  const tabPost = page.slice(page.indexOf("$('compose-post').addEventListener('click', () => {"));
  assert.match(tabPost.slice(0, 700), guard, 'the tab posts an unloaded id as a plain note');
});

test('the expanded composer has the same three dev aids, gated by the build and read again at Post', () => {
  // The build decides, as in the panel: an unpacked Chrome build has no update_url.
  assert.match(page, /devBuild = !chrome\.runtime\.getManifest\(\)\.update_url;/);
  assert.match(page, /if \(!devBuild\) \{ box\.classList\.add\('hidden'\); return; \}/);
  for (const key of ['devComposerKinds', 'devSilentTags', 'devReplyById']) {
    assert.match(page, new RegExp('settings\\?\\.' + key + ' === true'), 'the tab never reads ' + key);
  }
  // At Post: the switches are re-read, and the tags come from the shared core.
  // Settings are read once at Post, for the client tag and the dev switches together.
  assert.match(page, /const settings = \(await call\(\{ type: 'SIDECAR_GET_SETTINGS' \}\)\.catch\(\(\) => null\)\) \|\| \{\};/);
  assert.match(page, /SC\.parseSilentTags\(devSilentText, NT\)\s*\n\s*\.filter\(\(hex\) => !replyP\.has\(hex\) && !body\.p\.some\(\(tg\) => tg\[1\] === hex\)\)/);
  // In the panel's order: threading, client, mentions, silent tags, quotes.
  assert.match(page, /\.\.\.clientTag,\s*\n\s*\.\.\.body\.p,\s*\n\s*\.\.\.silentP,\s*\n\s*\.\.\.body\.q,/);
  // The reply by id writes the slot slotFor would name, then switches to it.
  assert.match(page, /const key = state\.activePubkey \+ '\|r:' \+ ev\.id;/);
  assert.match(page, /await switchToDraft\(ev\.id\);/);
});
