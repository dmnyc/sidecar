'use strict';

// The library sheet (bookmarks, highlights, comments, reactions) and the doorway a comment's
// row is to its own page. The first version of these shipped with tests that read the source
// for the right words, and bugs no such test could see: the highlights list wrote itself into
// the comments cache, and an icon tab's aria-label never reached the DOM because h() assigns
// properties. This runs the real functions, lifted out of sidepanel.js, in a real Chrome with
// the real styles.css, and clicks. (The comment's page itself is thread-page.browser.test.js.)
//
// The rest of the panel (relays, profiles, the client) is faked below; any name the lifted
// code reaches for that is not given answers with an inert stand-in.
//
// Needs a Chrome or Chromium binary (CHROME_PATH, or one of the usual places); without one
// it skips, like the other browser tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.SAVED_HUB_ROOT || path.join(__dirname, '..');
const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const CHROME = candidates.find((p) => fs.existsSync(p)) || null;

const SRC = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
function lift(decl, src = SRC) {
  const at = src.indexOf(decl);
  if (at < 0) throw new Error('moved: ' + decl);
  const open = src.indexOf('{', src.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced: ' + decl);
}
// quoteSnippet lives in the composer core, which the panel takes it from; lifted from there.
const CORE_SRC = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
// A `const NAME = …;` statement: scanned to the semicolon that closes it, skipping strings.
function liftConst(name) {
  const at = SRC.indexOf('const ' + name + ' =');
  if (at < 0) throw new Error('moved: ' + name);
  let depth = 0;
  let quote = '';
  for (let i = at; i < SRC.length; i++) {
    const c = SRC[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return SRC.slice(at, i + 1);
  }
  throw new Error('unterminated: ' + name);
}
const FUNCTIONS = [
  'function renderBookmarks(', 'function buildEventMenu(', 'function zapSender(', 'async function liveThreadTab(', 'async function seedThread(', 'async function openThreadTab(', 'function commentParentId(', 'function commentPage(',
  'async function fillComments(', 'async function fetchComments(',
  'async function fillHighlights(', 'async function fetchHighlights(', 'function highlightSource(',
  'async function fillReactions(', 'async function fetchReactions(', 'function noteGist(', 'function reactionMark(', 'function reactionDisplay(',
  'async function loadSavedList(', 'function wireTabSlider(',
];
const CONSTS = ['THREAD_SEEDS_KEY', 'SAVED_PAGE', 'tabCount', 'setTabCount', 'paged', '_hlCache', '_cmCache', '_rctCache'];
const NAMES = FUNCTIONS.map((f) => /function (\w+)\(/.exec(f)[1]).concat(CONSTS, ['quoteSnippet']);

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const id = (c) => c.repeat(64);

function page(scenario) {
  const code = FUNCTIONS.map((f) => lift(f)).concat([lift('function quoteSnippet(', CORE_SRC)], CONSTS.map(liftConst)).join('\n');
  return `<!doctype html><html data-theme="speakeasy"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${ROOT}/fonts.css"><link rel="stylesheet" href="file://${ROOT}/styles.css">
<link rel="stylesheet" href="file://${ROOT}/themes/speakeasy.css"><link rel="stylesheet" href="file://${ROOT}/themes/patterns.css">
</head><body style="width:360px;margin:0">
<div id="modal-overlay" class="modal-overlay hidden"><div class="modal" id="modal"></div></div>
<script src="file://${ROOT}/i18n.js"></script><script src="file://${ROOT}/composer-core.js"></script>
<script>
const S = ${JSON.stringify(scenario)};
const ME = '${ME}', OTHER = '${OTHER}';
const id = (c) => c.repeat(64);
const stub = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : (k === Symbol.toPrimitive ? () => '' : stub)), apply: () => stub, construct: () => stub });
const core = window.SidecarCore;
const tags = (...rows) => rows;
const WEB = [['I', 'https://example.com/post'], ['K', 'web'], ['i', 'https://example.com/post'], ['k', 'web']];
const ev = (c, pubkey, kind, content, t, created) => ({ id: id(c), pubkey, kind, content, tags: t, created_at: created });
// c: my comment on a page. r1: someone's reply to it. r2: my reply to that reply.
const C1 = ev('1', ME, 1111, 'First comment', WEB, 300);
const R1 = ev('2', OTHER, 1111, 'Reply one', [...WEB, ['e', id('1')]], 310);
const R2 = ev('3', ME, 1111, 'Reply two', [...WEB, ['e', id('2')]], 320);
const NOSTR_SCOPED = ev('4', ME, 1111, 'On a Nostr thread', [['I', 'nostr:abc'], ['K', 'nostr']], 330);
const NOTE = ev('5', OTHER, 1, 'A note worth liking', [], 100);
const HL = ev('6', ME, 9802, 'A highlighted passage', [['r', 'https://example.com/post', 'source']], 200);
let tick = 500;
const reaction = (c, content, t) => ev(c, ME, 7, content, t, tick -= 10); // newest first, in the order listed
const REACTIONS = [
  reaction('7', '+', [['e', id('9')], ['e', id('5')], ['p', OTHER]]),            // like, aimed at the LAST e
  reaction('8', ':blob:', [['e', id('5')], ['p', OTHER], ['emoji', 'blob', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7']]),
  reaction('c', '🔥', [['e', id('5')], ['p', OTHER]]),
  reaction('d', '+', [['e', id('e')], ['p', OTHER]]),                            // note no relay returned
  reaction('f', '+', [['p', OTHER]]),                                            // a profile
];
// Notes whose raw text a one-line row cannot carry: words with a mention and a link, a picture alone, a link alone.
const NPUB = 'npub1' + 'q'.repeat(58);
const N_WORDS = ev('b', OTHER, 1, 'Welp, done running that nostr:' + NPUB + ' https://example.org/x?y=1', [], 100);
const N_IMAGE = ev('0', OTHER, 1, 'https://i.nostr.build/CPxspH5POM.jpg', [], 100);
const N_LINK = ev('a', OTHER, 1, 'https://example.org/page', [], 100);
for (const [n, note] of [['1', N_WORDS], ['2', N_IMAGE], ['3', N_LINK]]) {
  REACTIONS.push({ ...reaction('f', '+', [['e', note.id], ['p', OTHER]]), id: n.repeat(63) + 'f' });
}
const MANY = S.many ? Array.from({ length: S.many }, (_, i) => ({ id: (i + 16).toString(16).padStart(64, '0'), pubkey: ME, kind: 1111, content: 'Comment ' + i, tags: WEB, created_at: 1000 + i })) : [];
const queried = [];
const DB = new Map([C1, R1, R2, NOSTR_SCOPED, NOTE, HL, N_WORDS, N_IMAGE, N_LINK].map((e) => [e.id, e]));
const opened = [];
const created = [];
const messages = [];
const updated = [];
const contexts = [];
const seeds = {};
const state = { activePubkey: ME, accounts: [{ pubkey: ME }] };
const interp = (s, p) => String(s).replace(/{{(\\w+)}}/g, (_, k) => (p && p[k] != null ? p[k] : ''));
const block = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; return d; };
const real = {
  h: core.h, icon: core.icon, t: interp, tn: (a, b, n) => interp(n === 1 ? a : b, { count: n }),
  $: (i) => document.getElementById(i), show: (e) => e.classList.remove('hidden'),
  state, I18N: { fmtNum: (n) => String(n) }, HEX_ID: /^[0-9a-f]{64}$/,
  NT: { nip19: { npubEncode: (pk) => 'npub1' + pk.slice(0, 6), neventEncode: (o) => 'nevent1' + o.id.slice(0, 6) } },
  postRelays: async () => ['wss://r.example'], readRelayUrls: async () => [],
  poolQuerySync: async (relays, f) => {
    queried.push(f.kinds[0]);
    if (f['#e']) return [...DB.values()].filter((e) => e.kind === 1111 && e.tags.some((x) => x[0] === 'e' && x[1] === f['#e'][0]));
    if (f.kinds[0] === 1111) return [C1, NOSTR_SCOPED, ...MANY];
    if (f.kinds[0] === 9802) return [HL];
    if (f.kinds[0] === 7) return REACTIONS;
    return [];
  },
  fetchEventsByIds: async (ids) => new Map(ids.filter((i) => DB.has(i)).map((i) => [i, DB.get(i)])),
  profilesFor: async (pks) => new Map([...new Set(pks)].map((pk) => [pk, { name: pk === OTHER ? 'Bea' : 'Me' }])),
  preferredClient: async () => ({ label: 'Jumble', url: (b) => 'https://jumble.example/' + b, profile: (n) => 'https://jumble.example/p/' + n }),
  openInClient: (u) => { opened.push(u); }, handOffToTab: (k, e) => { handoffs.push([k, e.id]); },
  jumbleThreadUrl: (u) => 'https://jumble.example/thread?u=' + u,
  IMG_EXT: new RegExp('\\\\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\\\\?.*)?$', 'i'), VID_EXT: new RegExp('\\\\.(mp4|webm|mov|m4v)(\\\\?.*)?$', 'i'),
  relativeTime: () => '5m', mentionsAsNames: (c) => c, mentionPubkeys: () => [], shortNpub: (n) => n,
  approvalKindLabels: () => ({}), notifTargetId: () => '', notifEventJson: () => '{}', copyPlain: async () => {}, notifAuthorName: () => '',
  pickQuote: () => ({}), loadingQuote: (txt) => block('loading', txt), emptyQuote: (txt) => block('empty', txt), endQuote: () => block('bm-empty bm-end', '\u201Cquote\u201D'),
  closeModal: () => document.getElementById('modal-overlay').classList.add('hidden'),
  openModal: (fn) => { const m = document.getElementById('modal'); m.innerHTML = ''; fn(m); m.classList.add('is-open'); document.getElementById('modal-overlay').classList.remove('hidden'); return m; },
  chrome: {
    runtime: { getURL: (p) => 'chrome-extension://testid/' + p, getContexts: async () => contexts, sendMessage: (m) => { messages.push(m); return Promise.resolve(); } },
    storage: { session: { get: async () => ({ sidecar_thread_seeds: seeds }), set: async (o) => { Object.assign(seeds, o.sidecar_thread_seeds); } } },
    tabs: { create: (o) => { created.push(o); }, update: async (tabId, o) => { updated.push(['tab', tabId, o]); } },
    windows: { update: async (windowId, o) => { updated.push(['window', windowId, o]); } },
  },
  _bmCache: { pubkey: null, evs: null }, fillBookmarks: () => {}, refreshBookmarks: async () => false,
};
const LIFTED = new Set(${JSON.stringify(NAMES)});
const scope = new Proxy({}, {
  has: (t, k) => typeof k === 'string' && !LIFTED.has(k) && (k in real || !(k in globalThis)),
  get: (t, k) => (typeof k === 'symbol' ? undefined : (k in real ? real[k] : stub)), set: () => true,
});
const run = new Function('scope', 'with(scope){' + ${JSON.stringify(code)} + '\\n return { renderBookmarks, openThreadTab, buildEventMenu, caches: { hl: _hlCache, cm: _cmCache, rc: _rctCache } };}');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const qa = (s) => [...document.querySelectorAll(s)];
const hub = () => ({
  heading: q('#modal h3').textContent,
  tabs: qa('#modal .modal-tab').map((t) => ({
    label: t.getAttribute('aria-label'), selected: t.getAttribute('aria-selected'), active: t.classList.contains('active'),
    icon: t.querySelector('svg').getAttribute('data-icon'), role: t.getAttribute('role'),
    count: (t.querySelector('.tab-glyph .modal-tab-count') || {}).textContent || null,
  })),
  open: qa('#modal .bm-scroll').map((p) => !p.classList.contains('hidden')),
  rows: qa('#modal .bm-scroll:not(.hidden) .bm-item').map((e) => e.textContent),
  sources: qa('#modal .bm-scroll:not(.hidden) .cm-src').map((e) => e.textContent + ' | ' + e.title),
  metas: qa('#modal .bm-scroll:not(.hidden) .bm-meta').map((e) => e.textContent),
  // The rule under the last row, and the rule above the closing quote: one of them, never both.
  lastRule: (() => { const rows = qa('#modal .bm-scroll:not(.hidden) .bm-item'); return rows.length ? getComputedStyle(rows[rows.length - 1]).borderBottomWidth : null; })(),
  quoteRule: (() => { const e = q('#modal .bm-scroll:not(.hidden) .bm-end'); return e ? getComputedStyle(e).borderTopWidth : null; })(),
});
(async () => {
  const api = run(scope);
  const out = {};
  if (S.flow === 'launch') {
    api.renderBookmarks();
    await wait(200);
    qa('#modal .modal-tab')[2].click(); await wait(300);
    const row = () => q('#modal .bm-scroll:not(.hidden) .bm-item');
    // A row opens the comment on its own page, in a new tab, and the sheet is left alone.
    row().click(); await wait(100);
    out.created = created.slice();
    out.seeded = Object.values(seeds).map((e) => [e.id, e.content, e.kind]);
    out.sheetStillOpen = !q('#modal-overlay').classList.contains('hidden');
    out.headingAfter = q('#modal h3').textContent;
    // With that tab already open, it is pointed at the comment and focused instead of a second one opening.
    contexts.push({ tabId: 5, windowId: 2, documentUrl: 'chrome-extension://testid/thread.html?id=' + id('9') });
    row().click(); await wait(100);
    out.createdAfter = created.length;
    out.messages = messages.slice();
    out.updated = updated.slice();
    // A thread tab that is not this extension's page is no thread tab.
    contexts.length = 0;
    contexts.push({ tabId: 8, windowId: 4, documentUrl: 'https://evil.example/thread.html?id=' + id('9') });
    row().click(); await wait(100);
    out.createdAfterStranger = created.length;
  }
  if (S.flow === 'hub') {
    api.renderBookmarks();
    await wait(200);
    out.fresh = hub();
    out.queriesAtOpen = queried.slice();
    const tabs = () => qa('#modal .modal-tab');
    tabs()[1].click(); await wait(300); out.highlights = hub();
    out.cmUntouched = api.caches.cm.evs === null && api.caches.rc.evs === null;
    tabs()[2].click(); await wait(300); out.comments = hub();
    out.menuComments = (() => { const b = q('#modal .bm-scroll:not(.hidden) .bm-item .notif-more-btn'); b.click(); return qa('#modal .bm-scroll:not(.hidden) .bm-item .notif-more-item').map((x) => x.textContent); })();
    // The control: the same menu asked for the way a notification asks, which does offer an npub.
    out.menuControl = (() => { const m = api.buildEventMenu({ id: id('1'), pubkey: ME, kind: 1111, tags: [], content: '' }, null, {}); m.btn.click(); return [...m.panel.querySelectorAll('.notif-more-item')].map((x) => x.textContent); })();
    tabs()[3].click(); await wait(300);
    out.reactions = hub();
    // The ⋮ menu of the first row of a tab: its labels, once opened.
    const menuOf = () => { const b = q('#modal .bm-scroll:not(.hidden) .bm-item .notif-more-btn'); b.click(); return qa('#modal .bm-scroll:not(.hidden) .bm-item .notif-more-item').map((x) => x.textContent); };
    out.menuReactions = menuOf();
    out.reactionRows = qa('#modal .bm-scroll:not(.hidden) .bm-item').map((row) => {
      const mark = row.querySelector('.cm-reaction-mark');
      return {
        heart: !!mark.querySelector('svg[data-icon="heart"]'), img: (mark.querySelector('img') || {}).src || null,
        mark: mark.textContent, text: row.querySelector('.cm-reaction').textContent, title: row.title,
      };
    });
    qa('#modal .bm-scroll:not(.hidden) .bm-item')[0].click();
    qa('#modal .bm-scroll:not(.hidden) .bm-item')[4].click();
    await wait(100);
    out.reactionOpened = opened.slice();
    // Close, reopen: each list's cache must hold its own events.
    api.renderBookmarks(); await wait(200);
    qa('#modal .modal-tab')[2].click(); await wait(300);
    out.reopened = hub();
    out.caches = { hl: api.caches.hl.evs.map((e) => e.kind), cm: api.caches.cm.evs.map((e) => e.kind), rc: api.caches.rc.evs.map((e) => e.kind) };
  }
  if (S.flow === 'paging') {
    api.renderBookmarks();
    await wait(200);
    qa('#modal .modal-tab')[2].click();
    await wait(400);
    const items = () => qa('#modal .bm-scroll:not(.hidden) .bm-item').length;
    const more = () => q('#modal .bm-scroll:not(.hidden) .show-more-btn');
    out.first = { items: items(), more: !!more(), count: hub().tabs[2].count };
    more().click(); out.second = { items: items(), more: !!more() };
    more().click(); more().click(); more().click();
    out.last = { items: items(), more: !!more() };
  }
  const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify(out); document.body.append(pre);
})().catch((e) => { const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify({ error: String(e && e.stack || e) }); document.body.append(pre); });
</script></body></html>`;
}

function measure(scenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-savedhub-'));
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, page(scenario));
  if (process.env.HUB_DUMP) fs.copyFileSync(file, process.env.HUB_DUMP);
  try {
    const r = spawnSync(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
      `--user-data-dir=${path.join(dir, 'profile')}`, '--virtual-time-budget=12000', '--window-size=420,900',
      '--dump-dom', `file://${file}`,
    ], { encoding: 'utf8', timeout: 60000 });
    const m = /<pre id="result">([\s\S]*?)<\/pre>/.exec(r.stdout || '');
    assert.ok(m, 'Chrome did not report: ' + (r.stderr || '').slice(0, 300));
    const out = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    assert.ok(!out.error, out.error);
    if (process.env.HUB_DEBUG) console.error(JSON.stringify(out.reactionRows, null, 1));
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

test('a comment’s row opens its own page in a tab, points an open one at it, and leaves the sheet where it was', opts, () => {
  const r = measure({ flow: 'launch' });
  assert.deepEqual(r.created, [{ url: 'chrome-extension://testid/thread.html?id=' + id('1') }], 'a new tab on the comment, by its id');
  assert.deepEqual(r.seeded, [[id('1'), 'First comment', 1111]], 'the comment is left for the page, so it opens at once');
  assert.equal(r.sheetStillOpen, true, 'there is no dead end: the list is still underneath');
  assert.equal(r.headingAfter, 'Comments');
  assert.equal(r.createdAfter, 1, 'with the page already open, no second tab');
  assert.deepEqual(r.messages, [{ type: 'SIDECAR_THREAD_OPEN', id: id('1') }]);
  assert.deepEqual(r.updated, [['tab', 5, { active: true }], ['window', 2, { focused: true }]]);
  assert.equal(r.createdAfterStranger, 2, 'a tab that is not this extension’s thread page is not one');
});

test('the sheet is four icon tabs, the heading follows the open one, and each list keeps its own cache', opts, () => {
  const r = measure({ flow: 'hub' });
  assert.deepEqual(r.fresh.tabs.map((t) => t.label), ['Bookmarks', 'Highlights', 'Comments', 'Reactions']);
  assert.deepEqual(r.fresh.tabs.map((t) => t.icon), ['bookmark', 'highlighter', 'message-circle', 'heart']);
  assert.ok(r.fresh.tabs.every((t) => t.role === 'tab'));
  assert.deepEqual(r.fresh.tabs.map((t) => t.selected), ['true', 'false', 'false', 'false']);
  assert.equal(r.fresh.heading, 'Bookmarks');
  assert.equal(r.highlights.heading, 'Highlights');
  assert.equal(r.highlights.rows.length, 1);
  assert.match(r.highlights.rows[0], /A highlighted passage/);
  assert.equal(r.highlights.tabs[1].count, '1', 'the count hangs off the icon, inside the tab glyph');
  assert.equal(r.comments.heading, 'Comments');
  assert.equal(r.comments.rows.length, 1, 'the Nostr-scoped comment stays out; only web pages are listed');
  assert.match(r.comments.rows[0], /First comment/);
  // The site leads the row, with the full address as its tooltip; the line under the words is the time alone.
  assert.deepEqual(r.comments.sources, ['example.com | https://example.com/post']);
  assert.deepEqual(r.comments.metas, ['5m']);
  assert.equal(r.reactions.heading, 'Reactions');
  // Your own comments and reactions have no one else's npub to copy, and the menu does not offer yours.
  assert.ok(r.menuControl.includes('Copy npub'), 'the menu offers an author’s npub when asked the usual way');
  assert.ok(r.menuComments.length > 0 && !r.menuComments.includes('Copy npub'), 'comments: ' + r.menuComments.join(', '));
  assert.ok(r.menuReactions.length > 0 && !r.menuReactions.includes('Copy npub'), 'reactions: ' + r.menuReactions.join(', '));
  // A flat list ends in one rule, not two: the last row gives up its own, so the line above the closing quote is the only one.
  for (const tab of ['highlights', 'comments', 'reactions']) {
    assert.equal(r[tab].quoteRule, '1px', tab + ': the closing quote keeps its rule');
    assert.equal(r[tab].lastRule, '0px', tab + ': the last row has none, or the two stack');
  }
  // The highlights list once wrote its events into the comments cache.
  assert.equal(r.cmUntouched, true, 'visiting highlights leaves the other lists’ caches alone');
  assert.deepEqual(r.caches, { hl: [9802], cm: [1111], rc: [7, 7, 7, 7, 7, 7, 7, 7] });
  assert.equal(r.reopened.rows.length, 1);
  assert.match(r.reopened.rows[0], /First comment/, 'reopened on the comments tab, from a cache that holds comments');
  assert.equal(r.reopened.heading, 'Comments');
});

test('a reaction row draws its mark the way the notification list does, and aims at the last e tag', opts, () => {
  const r = measure({ flow: 'hub' });
  const [like, custom, fire, lost, profile, words, image, link] = r.reactionRows;
  assert.equal(like.heart, true, 'a plain like is the heart from the icon set, not the raw plus sign');
  assert.match(like.text, /^Bea · A note worth liking$/, 'the target is the LAST e tag (NIP-25), not the thread root');
  assert.match(custom.img || '', /^data:image\/gif/, 'a custom emoji is its picture');
  assert.equal(fire.mark, '🔥');
  assert.equal(lost.text, 'A Nostr note by Bea', 'an e tag whose note never came back is still a note, not a profile');
  assert.match(lost.title, /^Open in Jumble/, 'and still opens: a client looks a note up by id, so a row is never dead');
  assert.equal(profile.text, 'Bea', 'a profile reaction names the profile');
  assert.match(profile.title, /^Open in Jumble/);
  // A one-line row carries a note's words and nothing it cannot: no bare address, no npub.
  assert.equal(words.text, 'Bea · Welp, done running that', 'the link and the mention are dropped, the words stay');
  assert.equal(image.text, 'Bea · Image', 'a note that was only a picture says so');
  assert.equal(link.text, 'Bea · example.org', 'and one that was only a link names the site');
  for (const row of r.reactionRows) assert.ok(!/https?:|npub1|nostr:/.test(row.text), 'no raw address or npub on a row: ' + row.text);
  assert.equal(r.reactionOpened.length, 2);
  assert.match(r.reactionOpened[0], /nevent1/);
  assert.match(r.reactionOpened[1], /\/p\/npub1/, 'and opens the profile, as the row’s own comment promised');
});

test('opening the sheet queries nothing but bookmarks; each other list is asked for on its first visit', opts, () => {
  const r = measure({ flow: 'hub' });
  assert.deepEqual(r.queriesAtOpen, [], 'highlights, comments and reactions wait to be opened');
});

test('a long list appears in screens of thirty under Show more, and the capsule stops at 99+', opts, () => {
  const r = measure({ flow: 'paging', many: 130 });
  assert.deepEqual(r.first, { items: 30, more: true, count: '99+' });
  assert.deepEqual(r.second, { items: 60, more: true });
  assert.deepEqual(r.last, { items: 131, more: false }, 'every comment is reachable, and the button leaves with the last of them');
});
