'use strict';

// NIP-84 highlights from the page's context menu: the kind:9802 the popup builds, and the
// worker wiring that keeps what you selected away from web pages.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
require('../highlight-event.js');
const HL = globalThis.SidecarHighlight;

const tagsNamed = (ev, name) => ev.tags.filter((t) => t[0] === name);

test('A HIGHLIGHT IS A 9802 WHOSE CONTENT IS THE PASSAGE, SOURCED TO THE PAGE', () => {
  const ev = HL.buildTemplate({
    text: '  The quick brown fox.  ', url: 'https://example.com/a?x=1#:~:text=quick', clientTag: true, now: 1700000000000,
  });
  assert.equal(ev.kind, 9802);
  assert.equal(ev.content, 'The quick brown fox.');
  assert.equal(ev.created_at, 1700000000);
  // The fragment is where you were on the page, not the page.
  assert.deepEqual(tagsNamed(ev, 'r'), [['r', 'https://example.com/a?x=1', 'source']]);
  assert.deepEqual(tagsNamed(ev, 'client'), [['client', 'Sidecar']]);
  assert.equal(tagsNamed(ev, 'comment').length, 0);
  assert.equal(tagsNamed(ev, 'alt').length, 1);
});

test('the client tag follows the setting', () => {
  const ev = HL.buildTemplate({ text: 'x', url: 'https://example.com/', clientTag: false });
  assert.equal(tagsNamed(ev, 'client').length, 0);
});

test('A COMMENT MAKES IT A QUOTE HIGHLIGHT, its links marked mention, never source', () => {
  const ev = HL.buildTemplate({
    text: 'passage', url: 'https://example.com/post',
    comment: 'Agreed, see https://other.org/x. And https://example.com/post too.',
  });
  assert.deepEqual(tagsNamed(ev, 'comment'), [['comment', 'Agreed, see https://other.org/x. And https://example.com/post too.']]);
  assert.deepEqual(tagsNamed(ev, 'r'), [
    ['r', 'https://example.com/post', 'source'],
    ['r', 'https://other.org/x', 'mention'],
  ]);
  // A blank comment is no comment.
  assert.equal(tagsNamed(HL.buildTemplate({ text: 'p', url: 'https://e.com/', comment: ' \n ' }), 'comment').length, 0);
});

test('the surrounding paragraph is context only when it contains the passage and adds to it', () => {
  const url = 'https://example.com/';
  const withCtx = HL.buildTemplate({ text: 'brown fox', url, context: 'The quick brown fox jumps.' });
  assert.deepEqual(tagsNamed(withCtx, 'context'), [['context', 'The quick brown fox jumps.']]);
  assert.equal(tagsNamed(HL.buildTemplate({ text: 'brown fox', url, context: 'brown fox' }), 'context').length, 0);
  assert.equal(tagsNamed(HL.buildTemplate({ text: 'brown fox', url, context: 'something else' }), 'context').length, 0);
  assert.equal(tagsNamed(HL.buildTemplate({ text: 'fox', url, context: 'fox ' + 'a'.repeat(HL.MAX_CONTEXT) }), 'context').length, 0);
});

test('LINE BREAKS SURVIVE: a quoted list or verse is not flattened', () => {
  const ev = HL.buildTemplate({ text: 'one  \r\ntwo\n\n\n\nthree', url: 'https://example.com/' });
  assert.equal(ev.content, 'one\ntwo\n\nthree');
});

test('A PASSAGE OVER THE LIMIT IS REFUSED, NEVER CUT: a shortened quote is a misquote', () => {
  const long = 'a'.repeat(HL.MAX_TEXT + 1);
  assert.equal(HL.tooLong(long), true);
  assert.equal(HL.tooLong('a'.repeat(HL.MAX_TEXT)), false);
  assert.throws(() => HL.buildTemplate({ text: long, url: 'https://example.com/' }), /too long/);
});

test('only web pages can be a source, and an empty selection is nothing', () => {
  for (const url of ['chrome://extensions/', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', '']) {
    assert.throws(() => HL.buildTemplate({ text: 'x', url }), /web page/, url);
  }
  assert.throws(() => HL.buildTemplate({ text: '   ', url: 'https://example.com/' }), /Nothing selected/);
});

test('THE WORKER: one selection item, and the passage is for extension pages only', () => {
  const bg = read('background.js');
  assert.match(bg, /id: 'sidecar-highlight', title: t\('Highlight with Sidecar'\), contexts: \['selection'\]/);
  assert.match(bg, /info\.menuItemId === 'sidecar-highlight'/);
  // Not in the content-script allowlist: a page that could ask would learn what you
  // selected on another site.
  const allow = /const CONTENT_OK = new Set\(\[([\s\S]*?)\]\);/.exec(bg)[1];
  assert.doesNotMatch(allow, /HIGHLIGHT/);
  assert.match(bg, /case 'SIDECAR_HIGHLIGHT_GET':/);
  assert.match(bg, /case 'SIDECAR_HIGHLIGHT_DROP':/);
  // Handed over by id, not in the address.
  assert.match(bg, /highlight\.html\?id=' \+ id/);
});

test('the popup loads the builder before itself, and signs through the owner door', () => {
  const html = read('highlight.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.indexOf('highlight-event.js') < scripts.indexOf('highlight.js'));
  const js = read('highlight.js');
  assert.match(js, /type: 'SIDECAR_OWNER_SIGN', event: template, expectedPubkey: state\.activePubkey/);
});

// ---- what you sign, you see ----

test('THE PARAGRAPH THAT GOES OUT AS CONTEXT IS SHOWN, AND CAN BE LEFT OUT', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'highlight.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'highlight.js'), 'utf8');
  assert.match(html, /id="hl-context"/);
  assert.match(html, /id="hl-context-off"/);
  assert.match(html, /data-i18n="Leave out the surrounding paragraph"/);
  // Shown exactly when the builder would send one, with the passage marked, as text.
  assert.match(js, /const ctx = HL\.contextFor\(passage, hl\.context\);/);
  assert.match(js, /h\('mark', \{ textContent: passage \}\)/);
  assert.ok(!/innerHTML\s*=\s*[^'"]*ctx/.test(js), 'the paragraph must not be built as markup');
  // And the event carries it only if it was shown and not left out.
  assert.match(js, /context: withContext \? hl\.context : ''/);
});

test('THE BUILDER\'S ENGLISH REFUSALS ARE SAID IN THE READER\'S LANGUAGE', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'highlight.js'), 'utf8');
  for (const m of ['Nothing selected', 'Selection too long', 'Not a web page']) {
    assert.ok(js.includes("'" + m + "': t("), m + ' is shown untranslated');
  }
});

test('THE POPUP PAINTS ITS LOGO WITH OR WITHOUT THE DARK-BAR LIST', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'highlight.js'), 'utf8');
  assert.match(js, /const darkBar = COMPOSE_DARK_BAR_THEMES && COMPOSE_DARK_BAR_THEMES\.has\(name\);/);
});

test('THE PASSAGE IS SET IN THE READING FACE, SO IT READS AS THE PAGE WROTE IT', () => {
  // Several display faces set everything in capitals (Ben Day's Bangers among them), which
  // showed a quote you were about to sign in a case the page never used.
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const rule = css.match(/\.hl-quote \{([^}]*)\}/);
  assert.ok(rule, '.hl-quote is gone');
  assert.match(rule[1], /font-family: var\(--font-ui\);/);
  assert.match(rule[1], /text-transform: none;/);
  assert.ok(!/--font-display/.test(rule[1]), 'the quote is back in a display face');
});

// ---- a Nostr note read in a web client is cited as the note ----

const vmod = require('node:vm');
const NT = (() => {
  const c = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer };
  vmod.createContext(c);
  vmod.runInContext(read('nostr-tools.js'), c);
  return c.NostrTools;
})();
const decode = NT.nip19.decode;
const ID = '0f8d5c8b30880d4a9721cb4f8f689ea9c81230e1f3e4c0db3237fb2f6e5c939a';
const PK = '8498bd7c5bbcb5a4622b9629faa23cb9854fdfa9aac19561f3a6caaebfbb4a4c';

test('THE NOTE IS FOUND IN EVERY CLIENT\'S ADDRESS FORMAT', () => {
  const nevent = NT.nip19.neventEncode({ id: ID, author: PK, relays: ['wss://relay.example'] });
  const note = NT.nip19.noteEncode(ID);
  const naddr = NT.nip19.naddrEncode({ kind: 30023, pubkey: PK, identifier: 'essay', relays: [] });
  for (const url of [
    'https://jumble.social/notes/' + nevent,
    'https://njump.me/' + nevent,
    'https://coracle.social/notes/' + nevent + '?x=1',
    'https://snort.social/e/' + nevent,
  ]) {
    const r = HL.nostrRefFromUrl(url, decode);
    assert.equal(r && r.tag, 'e', url);
    assert.equal(r.id, ID);
    assert.equal(r.author, PK, 'an nevent carries its author');
    assert.equal(r.relay, 'wss://relay.example');
  }
  const bare = HL.nostrRefFromUrl('https://primal.net/e/' + note, decode);
  assert.equal(bare.tag, 'e');
  assert.equal(bare.author, '', 'a note1 has no author; the popup looks it up');
  const art = HL.nostrRefFromUrl('https://habla.news/a/' + naddr, decode);
  assert.equal(art.tag, 'a');
  assert.equal(art.coord, '30023:' + PK + ':essay');
  assert.equal(art.author, PK);
  // Ordinary pages, and garbage that only looks like a reference, cite the page.
  assert.equal(HL.nostrRefFromUrl('https://example.com/article', decode), null);
  assert.equal(HL.nostrRefFromUrl('https://example.com/note1notreallybech32', decode), null);
});

test('A HIGHLIGHT OF A NOTE IS SOURCED TO THE NOTE AND CREDITS ITS AUTHOR', () => {
  const url = 'https://jumble.social/notes/' + NT.nip19.neventEncode({ id: ID, author: PK, relays: ['wss://relay.example'] });
  const ref = HL.nostrRefFromUrl(url, decode);
  const ev = HL.buildTemplate({ text: 'I’m literally just a sponge.', url, comment: 'I said that!', nostrRef: ref, now: 1 });
  assert.deepEqual(tagsNamed(ev, 'e'), [['e', ID, 'wss://relay.example', 'source']]);
  assert.deepEqual(tagsNamed(ev, 'p'), [['p', PK, '', 'author']]);
  assert.deepEqual(tagsNamed(ev, 'r'), [], 'the web client\'s address is not the source');
  assert.deepEqual(tagsNamed(ev, 'alt'), [['alt', 'Highlight from a Nostr note']]);
  // No author known: still the note, just no p tag.
  const noAuthor = HL.buildTemplate({ text: 'x', url, nostrRef: { ...ref, author: '' }, now: 1 });
  assert.deepEqual(tagsNamed(noAuthor, 'p'), []);
  assert.equal(tagsNamed(noAuthor, 'e').length, 1);
  // An article is an a tag.
  const art = HL.buildTemplate({ text: 'x', url: 'https://habla.news/a/x', now: 1,
    nostrRef: { tag: 'a', coord: '30023:' + PK + ':essay', relay: '', author: PK, kind: 30023 } });
  assert.deepEqual(tagsNamed(art, 'a'), [['a', '30023:' + PK + ':essay', '', 'source']]);
  assert.deepEqual(tagsNamed(art, 'alt'), [['alt', 'Highlight from a Nostr article']]);
});

// ---- the Saved sheet's Highlights tab ----

const panelSrc = read('sidepanel.js');
function liftPanel(decl) {
  const at = panelSrc.indexOf(decl);
  assert.ok(at > -1, decl + ' is gone from sidepanel.js');
  const open = panelSrc.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < panelSrc.length; i++) {
    if (panelSrc[i] === '{') depth++;
    else if (panelSrc[i] === '}' && --depth === 0) return panelSrc.slice(at, i + 1);
  }
  throw new Error('unbalanced');
}

test('A HIGHLIGHT ROW SAYS WHERE IT CAME FROM: A PAGE BY HOST, A NOTE BY ITS AUTHOR', () => {
  const c = { URL };
  vmod.createContext(c);
  vmod.runInContext("const HEX_ID = /^[0-9a-f]{64}$/;\n" + liftPanel('function highlightSource(ev)') + '\nthis.highlightSource = highlightSource;', c);
  const src = (tags) => JSON.parse(JSON.stringify(c.highlightSource({ tags })));
  assert.deepEqual(src([['r', 'https://www.theonion.com/x', 'source']]), { kind: 'page', host: 'www.theonion.com' });
  assert.deepEqual(src([['e', ID, '', 'source'], ['p', PK, '', 'author']]), { kind: 'note', author: PK, id: ID });
  // Another client's highlight with an unmarked p: that is the author.
  assert.deepEqual(src([['e', ID], ['p', PK]]), { kind: 'note', author: PK, id: ID });
  // A mention is not the author; with nothing else, the note is looked up for one.
  assert.deepEqual(src([['e', ID], ['p', PK, '', 'mention']]), { kind: 'note', author: '', id: ID });
  assert.deepEqual(src([['a', '30023:' + PK + ':essay', '', 'source']]), { kind: 'article', author: PK });
  // The old shape, before notes were cited as notes: still a page, by its host.
  assert.deepEqual(src([['r', 'https://jumble.social/notes/nevent1x', 'source'], ['comment', 'I said that!']]),
    { kind: 'page', host: 'jumble.social' });
  assert.equal(c.highlightSource({ tags: [] }), null);
});

test('BOOKMARKS AND HIGHLIGHTS ARE TWO TABS, AND HIGHLIGHTS LOAD ONLY WHEN ASKED FOR', () => {
  const body = liftPanel('function renderBookmarks()');
  assert.match(body, /textContent: t\('Bookmarks'\)/);
  assert.match(body, /textContent: t\('Highlights'\)/);
  assert.match(body, /if \(hl && !hlFilled\) \{\s*hlFilled = true;\s*fillHighlights\(/);
  const fetch = liftPanel('async function fetchHighlights(pubkey)');
  assert.match(fetch, /kinds: \[9802\], authors: \[pubkey\]/);
});

test('A BOOKMARKED NOTE IS LOOKED FOR ON THE WRITE RELAYS, AND ON ITS HINT WHEN ALLOWED', () => {
  const fn = liftPanel('async function fetchEventsByIds(ids, hints)');
  // The account's own notes live on its write relays, which the read list need not name.
  assert.match(fn, /write = await postRelays\(\)/);
  // A bookmark's own relay hint, only when the account allows relays it did not choose.
  assert.match(fn, /if \(!\(await nip65OnlyFor\(pubkey\)\)\) \{\s*extra = /);
  assert.match(fn, /\[\.\.\.read, \.\.\.write, \.\.\.extra\]/);
  // And the hints are collected from the bookmarks' e tags.
  assert.match(liftPanel('async function refreshBookmarks()'), /if \(t && t\[0\] === 'e' && typeof t\[2\] === 'string' && t\[2\]\) hints\.push\(t\[2\]\);/);
});

test('SAVED ROWS CARRY THE SAME ⋮ MENU AS A NOTIFICATION', () => {
  assert.match(panelSrc, /^  function buildEventMenu\(ev, linkTarget, opts\) \{/m, 'the menu is shared, not inside the bell');
  assert.match(liftPanel('async function fillHighlights('), /const menu = buildEventMenu\(ev, null, \{ npubOf:/);
  assert.match(panelSrc, /const menu = ref \? buildEventMenu\(ref, null\) : null;/);
});

test('A BOOKMARK NO RELAY RETURNS IS LEFT OUT, NOT SHOWN AS AN UNKNOWN AUTHOR', () => {
  const fill = liftPanel('async function fillBookmarks(');
  assert.match(fill, /if \(events\.has\(id\)\) found\.push\(id\);/);
  assert.ok(!/buildRow\(id, s\.ev, true\)/.test(fill), 'missing rows are drawn again');
  assert.ok(!/'Not on your relays'/.test(fill));
});

test('A NOTE\'S PARAGRAPH COMES FROM THE NOTE, not from the client drawing it', () => {
  // A quote post: its own line, the quoted note's reference, and a GIF on its own line.
  const content = 'There is only one classy way to pronounce GIF. 🍸👌✨\nnostr:nevent1qqsabc123\n\nhttps://example.com/a.gif';
  assert.equal(HL.noteParagraph(content, 'There is only one classy way to pronounce GIF.'),
    'There is only one classy way to pronounce GIF. 🍸👌✨');
  // Paragraphs are split on blank lines; a link inside the prose stays.
  const two = 'First thought.\n\nSecond one, see https://example.com/x for more.';
  assert.equal(HL.noteParagraph(two, 'Second one'), 'Second one, see https://example.com/x for more.');
  // Text that is not in the note (a quoted note's card) gets no paragraph at all.
  assert.equal(HL.noteParagraph(content, 'via Damus'), '');
});

test('the popup takes a note\'s paragraph from the fetched note and never from the page', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'highlight.js'), 'utf8');
  assert.match(page, /if \(nostrRef && nostrRef\.tag === 'e'\) hl\.context = '';\s*paintContext\(\);/);
  assert.match(page, /hl\.context = HL\.noteParagraph\(ev\.content, hl\.text\);\s*paintContext\(\);/);
  // Post decides on the paragraph only after the lookup has had its chance.
  assert.match(page, /await refReady;[^\n]*\n\s*\/\/[^\n]*\n\s*const withContext =/);
});

test('A MENTION IN A HIGHLIGHT OR ITS COMMENT READS AS A NAME, not a nostr:npub', () => {
  const c = { console, TextEncoder, TextDecoder, crypto: globalThis.crypto, Uint8Array };
  c.window = c; c.self = c; c.globalThis = c;
  vmod.createContext(c);
  vmod.runInContext(fs.readFileSync(path.join(__dirname, '..', 'nostr-tools.js'), 'utf8'), c);
  const re = panelSrc.match(/const MENTION_RE = [^\n]+/)[0];
  vmod.runInContext('const NT = window.NostrTools;\n' + re + '\n' +
    liftPanel('function shortNpub(npub)') + '\n' + liftPanel('function mentionPubkeys(text)') + '\n' +
    liftPanel('function mentionsAsNames(text, profiles)') +
    '\nthis.mentionPubkeys = mentionPubkeys; this.mentionsAsNames = mentionsAsNames;', c);
  const named = 'a'.repeat(64);
  const nameless = 'b'.repeat(64);
  const npubA = c.NostrTools.nip19.npubEncode(named);
  const nprofB = c.NostrTools.nip19.nprofileEncode({ pubkey: nameless });
  const text = 'Highlighted on nostr:' + npubA + ' with nostr:' + nprofB;
  assert.deepEqual([...c.mentionPubkeys(text)], [named, nameless]);
  const out = c.mentionsAsNames(text, new Map([[named, { name: 'Alice' }]]));
  assert.ok(out.startsWith('Highlighted on @Alice with @npub1'), out);
  assert.ok(!/nostr:/.test(out));
});

test('the Saved lists read their authors in one query, not one per author', () => {
  const body = liftPanel('async function profilesFor(pubkeys)');
  assert.match(body, /kinds: \[0\], authors: need\.slice\(i, i \+ 100\)/);
  assert.match(body, /'wss:\/\/purplepag\.es'/);
  assert.match(liftPanel('async function fillHighlights('), /const profiles = await profilesFor\(\[/);
  assert.match(liftPanel('async function fillBookmarks('), /const profiles = await profilesFor\(/);
  assert.ok(!/authors\.map\(async \(pk\) => \[pk, await getProfile/.test(panelSrc), 'a per-author lookup is back');
});

test('a highlight\'s Copy npub is the quoted author\'s, and a web page offers none', () => {
  assert.match(liftPanel('async function fillHighlights('),
    /buildEventMenu\(ev, null, \{ npubOf: \(src && src\.kind !== 'page' && src\.author\) \|\| null,/);
  const menu = liftPanel('function buildEventMenu(ev, linkTarget, opts)');
  assert.match(menu, /const who = opts && 'npubOf' in opts \? opts\.npubOf : zapSender\(ev\);/);
  assert.match(menu, /who \? \[t\('Copy npub'\)/);
  // The e tag on a highlight is the note it quotes, so it is not called a parent.
  assert.match(menu, /opts && opts\.sourceNote \? t\('Copy source note ID'\) : t\('Copy parent note ID'\)/);
  assert.match(liftPanel('async function fillHighlights('), /sourceNote: true \}\)/);
});

test('THE LOADING QUOTE STAYS UP UNTIL THE ROWS ARE READY, not a blank sheet', () => {
  // Both lists wait on relays for names after they have their events; clearing first
  // left the sheet empty for those seconds, which reads as broken.
  const bm = liftPanel('async function fillBookmarks(');
  assert.ok(bm.lastIndexOf("scroll.textContent = '';") > bm.indexOf('await profilesFor('), 'bookmarks clear before the lookup');
  const hl = liftPanel('async function fillHighlights(');
  const lastClear = hl.lastIndexOf("pane.textContent = '';");
  assert.ok(lastClear > hl.indexOf('await profilesFor('), 'highlights clear before the lookup');
  assert.ok(hl.indexOf("pane.textContent = '';") > hl.indexOf('if (!evs.length) {'), 'a clear runs ahead of the waits');
});
