'use strict';

// The comment thread page (thread.html), run for real: the real page, scripts and styles in
// a real Chrome, with the worker and the relay pool faked. What a text-reading test cannot
// say is whether the tree has the right shape on screen, whether a reply opens the composer
// on the right comment, whether a tap on a heart signs the right event, and whether words a
// stranger wrote ever become markup. This clicks.
//
// Needs a Chrome or Chromium binary (CHROME_PATH, or one of the usual places); without one
// it skips, like the other browser tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.THREAD_PAGE_ROOT || path.join(__dirname, '..');
const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const CHROME = candidates.find((p) => fs.existsSync(p)) || null;

function page(scenario) {
  let html = fs.readFileSync(path.join(ROOT, 'thread.html'), 'utf8');
  // Assets by absolute address rather than a <base>, which would also move the page's own
  // address and make its history calls resolve somewhere that is not this document.
  const stub = `<script>
const S = ${JSON.stringify(scenario)};
const BASE = 'file://${ROOT}/';
const ME = 'a'.repeat(64), THEM = 'b'.repeat(64);
const id = (c) => c.repeat(64);
const NOW = Math.floor(Date.now() / 1000);
const URL1 = 'https://example.com/post';
const WEB = [['I', URL1], ['K', 'web'], ['i', URL1], ['k', 'web']];
const ev = (c, pubkey, kind, content, tags, ago) => ({ id: id(c), pubkey, kind, content, tags, created_at: NOW - ago });
const DB = new Map();
const add = (e) => { DB.set(e.id, e); return e; };
// A comment of mine on a page, two replies to it from somebody else, and my answer to one.
add(ev('1', ME, 1111, 'Basically the plot of the movie Brazil.', WEB, 3600));
add(ev('2', THEM, 1111, 'Ha! See https://example.org/brazil, it is great.', [...WEB, ['e', id('1')]], 1800));
add(ev('3', ME, 1111, 'Agreed, ask nostr:@@NPUB@@ about it', [...WEB, ['e', id('2')]], 900));
add(ev('4', THEM, 1111, '<img src=x onerror="window.__pwn=1"> javascript:alert(1) <b>bold</b>', [...WEB, ['e', id('1')]], 600));
// A comment of mine on somebody's note.
add(ev('5', THEM, 1, 'A note worth answering', [], 7200));
add(ev('6', ME, 1111, 'Answering the note', [['E', id('5')], ['K', '1'], ['P', THEM], ['e', id('5')], ['k', '1'], ['p', THEM]], 3000));
if (S.deep) {
  // A chain six deep under the first comment: past four levels the rail stops moving right.
  let parent = id('1');
  for (const c of ['7', '8', '9', 'c', 'd', 'e']) { add(ev(c, THEM, 1111, 'level ' + c, [...WEB, ['e', parent]], 500)); parent = id(c); }
}
const reactions = [
  ev('f', THEM, 7, '+', [['e', id('1')], ['p', ME], ['k', '1111']], 100),
  ev('0', THEM, 7, '🔥', [['e', id('2')], ['p', THEM], ['k', '1111']], 90),
  ev('a', ME, 7, '🔥', [['e', id('2')], ['p', THEM], ['k', '1111']], 80),
];
const metas = [{ kind: 0, pubkey: THEM, created_at: 1, content: JSON.stringify({ name: 'Bea' }) }];
const SEEDS = {};
const fetched = [];
const published = [], signed = [], drafts = {}, composeOpen = [], tabsCreated = [], listeners = [];
const contexts = S.composeOpenFor ? [{ tabId: 7, windowId: 3, documentUrl: BASE + 'compose.html?reply=' + id(S.composeOpenFor) }] : [];
const state = { activePubkey: ME, accounts: [{ pubkey: ME, name: 'Me', npub: 'npub1me' }], locked: false };
const seen = [];
const answer = (m) => {
  seen.push(m.type);
  switch (m.type) {
    case 'SIDECAR_FETCH_OG': fetched.push(m.url); return S.ogFail ? null : { title: 'A headline about Brazil', description: 'The movie, and the week.', image: '', site: 'Example' };
    case 'SIDECAR_GET_STATE': return state;
    case 'SIDECAR_GET_SETTINGS': return { theme: 'speakeasy' };
    case 'SIDECAR_GET_RELAYS': return { 'wss://r.example': { read: true, write: true } };
    // The account publishes to one relay and reads replies at another, as many do.
    case 'SIDECAR_GET_ACCOUNT_RELAYS': return { 'wss://out.example': { read: false, write: true }, 'wss://in.example': { read: true, write: false } };
    case 'SIDECAR_OWNER_SIGN': { const e = { ...m.event, id: id('9'), pubkey: ME, sig: 's' }; signed.push(e); return e; }
    case 'SIDECAR_SECRET_GET': return JSON.parse(JSON.stringify(drafts));
    case 'SIDECAR_SECRET_SET': Object.keys(drafts).forEach((k) => delete drafts[k]); Object.assign(drafts, JSON.parse(JSON.stringify(m.value))); return true;
    default: return null;
  }
};
window.chrome = {
  runtime: {
    id: 'testid', lastError: null, getURL: (p) => BASE + p,
    sendMessage: (m, cb) => {
      if (m.type === 'SIDECAR_COMPOSE_OPEN') composeOpen.push(m);
      if (!cb) return Promise.resolve();
      Promise.resolve().then(() => cb({ ok: true, result: answer(m) }));
    },
    onMessage: { addListener: (f) => listeners.push(f) },
    getContexts: async () => contexts,
  },
  storage: { local: { get: (k, cb) => cb({}) }, // Through JSON, as storage hands it back: nostr-tools remembers a verified event with a symbol that no storage keeps.
    session: { get: async () => ({ sidecar_thread_seeds: JSON.parse(JSON.stringify(SEEDS)) }), set: async () => {} } },
  tabs: { create: (o) => tabsCreated.push(o), update: async () => {} },
  windows: { update: async () => {} },
  i18n: { getUILanguage: () => 'en' },
};
</script>`;
  // The page's own scripts run as they are; the relay pool is swapped for a fake between the
  // library that defines it and the page that uses it.
  const fake = `<script>
const queries = [];
// An event is only returned by a query that includes the relay it lives on. What I publish
// lives on my write relay; everything else is at the inbox I read replies from. A page that
// asks the wrong relays finds nothing, as the real one does.
const homeOf = (e) => (e.pubkey === ME ? 'wss://out.example' : 'wss://in.example');
const lives = (relays, e) => relays.includes(homeOf(e));
class FakePool {
  async get(relays, f) { return (await this.querySync(relays, f))[0] || null; }
  async querySync(relays, f) {
    queries.push([relays, f]);
    if (f.ids) return f.ids.map((i) => DB.get(i)).filter((e) => e && lives(relays, e));
    if (f.kinds && f.kinds[0] === 1111 && f['#e']) return [...DB.values()].filter((e) => e.kind === 1111 && lives(relays, e) && e.tags.some((t) => t[0] === 'e' && f['#e'].includes(t[1])));
    if (f.kinds && f.kinds[0] === 7) return reactions.filter((r) => r.tags.some((t) => t[0] === 'e' && f['#e'].includes(t[1])));
    if (f.kinds && f.kinds[0] === 0) return metas.filter((m) => f.authors.includes(m.pubkey));
    return [];
  }
  publish(relays, e) { published.push(e); return relays.map(() => Promise.resolve('ok')); }
  close() {}
}
// A copy with the fake pool in it: the library's own export may not be assignable.
window.NostrTools = Object.assign({}, window.NostrTools, { SimplePool: FakePool });
if (S.seed) {
  // A real signed comment that no relay has, left by the panel: the page must show it anyway.
  const sk = new Uint8Array(32).fill(7);
  const good = NostrTools.finalizeEvent({ kind: 1111, created_at: NOW - 60, tags: WEB, content: 'Left by the panel' }, sk);
  SEEDS[good.id] = good;
  // And one whose content was changed after signing: not what its id says it is.
  const forged = NostrTools.finalizeEvent({ kind: 1111, created_at: NOW - 50, tags: WEB, content: 'As signed' }, sk);
  SEEDS[forged.id] = { ...forged, content: 'Tampered' };
  history.replaceState(null, '', '?id=' + (S.seed === 'forged' ? forged.id : good.id));
}
DB.get(id('3')).content = DB.get(id('3')).content.replace('@@NPUB@@', NostrTools.nip19.npubEncode(THEM));
</script>`;
  const driver = `<script>
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s, r) => (r || document).querySelector(s);
const qa = (s, r) => [...(r || document).querySelectorAll(s)];
const chipsOf = (c) => qa(':scope > .thread-chips .thread-chip', c).map((x) => {
  const m = q('.thread-chip-mark', x);
  return (q('svg', m) ? 'heart' : m.textContent) + ' ' + q('.thread-chip-n', x).textContent + (x.classList.contains('mine') ? ' mine' : '');
});
const walk = (ol) => [...ol.children].map((li) => {
  const c = q(':scope > .thread-c', li);
  const kids = q(':scope > .thread-children', li);
  return { name: q('.thread-c-name', c).textContent, text: q('.thread-text', c).textContent, chips: chipsOf(c), flat: !!kids && kids.classList.contains('flat'), kids: kids ? walk(kids) : [] };
});
const look = () => {
  const focus = q('.thread-c-focus');
  const ctx = q('.thread-ctx');
  return {
    message: q('.thread-wait') && q('.thread-wait').textContent,
    retry: !!q('#thread-sheet > button.secondary'),
    ctx: ctx && {
      card: q('.link-card', ctx) ? { site: (q('.link-card-site', ctx) || {}).textContent, title: (q('.link-card-title', ctx) || {}).textContent, desc: (q('.link-card-desc', ctx) || {}).textContent, href: q('.link-card', ctx).href, target: q('.link-card', ctx).target } : null,
      host: (q('.thread-ctx-host', ctx) || {}).textContent,
      url: (q('.thread-ctx-url', ctx) || {}).textContent,
      snippet: (q('.thread-ctx-snippet', ctx) || {}).textContent,
      more: (q('.thread-ctx-more', ctx) || {}).textContent,
      moreHref: (q('.thread-ctx-more', ctx) || {}).href,
      footer: !!q('.thread-ctx-foot', ctx),
    },
    ancestors: qa('.thread-anc').map((a) => ((q('.thread-anc-who', a) || {}).textContent || '') + ' | ' + ((q('.thread-anc-text', a) || {}).textContent || a.textContent)),
    focus: focus && { name: q('.thread-c-name', focus).textContent, text: q('.thread-text', focus).textContent, chips: chipsOf(focus), acts: qa('.thread-acts .notif-act', focus).map((b) => b.getAttribute('aria-label')) },
    count: (q('.thread-count') || {}).textContent || null,
    none: !!q('.thread-none'),
    tree: q('.thread-list') ? walk(q('.thread-list')) : [],
    search: location.search,
    title: document.title,
  };
};
const errors = [];
console.warn = (...a) => errors.push(a.map((x) => (x && x.stack) || String(x)).join(' '));
window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));
// Until the page has stopped saying it is waiting, so a slow machine is not a failing test.
const settle = async () => {
  for (let i = 0; i < 60; i++) {
    await wait(100);
    const w = q('.thread-wait');
    if (!w || w.textContent !== 'Reading your relays…') return;
  }
};
const pre = document.createElement('pre'); pre.id = 'result'; document.body.append(pre);
let outRef = null;
// Written after every step, so a step that never returns shows how far the page got.
const save = (extra) => { pre.textContent = JSON.stringify(Object.assign({ progress: (outRef && outRef.__step) || '' }, outRef, extra)); };
(async () => {
  await settle();
  await wait(150);   // the preview card arrives after the thread is drawn
  const out = { first: look(), errors, __step: 'first' };
  outRef = out; save();
  const row = (n) => qa('.thread-list .thread-node')[n];
  const stopAt = (m) => { out.__step = m; save(); return S.stop === m; };
  const finish = () => { out.__step = 'stopped'; save(); };
  if (S.flow === 'tree') {
    // Reply on the first reply: the composer opens on THAT comment, through the draft slot the panel uses.
    q('.notif-act[aria-label="Reply"]', row(0)).click(); await wait(200);
    if (stopAt('reply')) return finish();
    out.drafts = JSON.parse(JSON.stringify(drafts));
    out.tabs = tabsCreated.slice();
    out.composeOpen = composeOpen.slice();
    // React on the comment itself: the picker opens, a quick emoji is picked, a kind 7 is signed and published.
    q('.thread-c-focus .notif-act[aria-label="React"]').click(); await wait(50);
    if (stopAt('react')) return finish();
    out.picker = { open: !!q('.thread-react'), quick: qa('.thread-react .emoji-quick-cell').length, search: !!q('.thread-react input[type=search]') };
    out.heartLit = q('.thread-c-focus .notif-act[aria-label="React"]').classList.contains('open');
    // The same heart again closes it; another comment's heart moves it there.
    q('.thread-c-focus .notif-act[aria-label="React"]').click(); await wait(50);
    out.closedByHeart = { gone: !q('.thread-react'), lit: q('.thread-c-focus .notif-act[aria-label="React"]').classList.contains('open'), expanded: q('.thread-c-focus .notif-act[aria-label="React"]').getAttribute('aria-expanded') };
    q('.thread-c-focus .notif-act[aria-label="React"]').click(); await wait(50);
    q('.notif-act[aria-label="React"]', row(0)).click(); await wait(50);
    out.moved = { pickers: qa('.thread-react').length, focusLit: q('.thread-c-focus .notif-act[aria-label="React"]').classList.contains('open'), rowLit: q('.notif-act[aria-label="React"]', row(0)).classList.contains('open') };
    q('.notif-act[aria-label="React"]', row(0)).click(); await wait(50);
    q('.thread-c-focus .notif-act[aria-label="React"]').click(); await wait(50);
    qa('.thread-react .emoji-quick-cell').find((b) => b.textContent === '🔥').click(); await wait(300);
    if (stopAt('picked')) return finish();
    out.signed = signed.slice(); out.published = published.map((e) => e.id);
    out.afterReact = look().focus.chips;
    out.pickerClosed = !q('.thread-react');
    // Fold the first reply's replies away and back.
    const fold = q('.thread-fold', row(0)); const before = row(0).classList.contains('collapsed');
    fold.click(); if (stopAt('fold')) return finish();
    out.folded = { before, after: row(0).classList.contains('collapsed'), text: fold.textContent.trim(), aria: fold.getAttribute('aria-expanded') };
    fold.click(); out.unfolded = row(0).classList.contains('collapsed');
    // Walk down into the first reply: its address, its ancestors, and Back.
    q('.thread-c-time', row(0)).click(); await wait(500);
    if (stopAt('down')) return finish();
    out.down = look();
    history.back(); await wait(500);
    if (stopAt('back')) return finish();
    out.back = look();
    // The panel pointing the open tab at another comment, from its own page and from a stranger.
    for (const f of listeners) f({ type: 'SIDECAR_THREAD_OPEN', id: id('6') }, { id: 'someone-else', url: 'https://evil.example/' });
    await wait(300); if (stopAt('stranger')) return finish();
    out.afterStranger = look().search;
    for (const f of listeners) f({ type: 'SIDECAR_THREAD_OPEN', id: id('6') }, { id: 'testid', url: BASE + 'sidepanel.html' });
    await wait(500); out.afterPanel = look();
  }
  if (S.flow === 'compose-open') {
    q('.notif-act[aria-label="Reply"]', row(0)).click(); await wait(200);
    out.composeOpen = composeOpen.slice(); out.tabs = tabsCreated.slice();
  }
  out.og = fetched.slice();
  out.pwn = !!window.__pwn;
  out.injected = qa('.thread-text img, .thread-text b').length;
  out.__step = 'done';
  save();
})().catch((e) => { save({ error: String(e && e.stack || e) }); });
</script>`;
  html = html.replace('<head>', '<head>\n' + stub);
  html = html.replace('<script src="thread.js"></script>', fake + '\n<script src="thread.js"></script>\n' + driver);
  return html.replace(/(href|src)="(?!https?:|file:|data:|#)([^"]+)"/g, (m, a, v) => `${a}="file://${ROOT}/${v}"`);
}

function measure(scenario, id) {
  if (process.env.THREAD_STOP) scenario = { ...scenario, stop: process.env.THREAD_STOP };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-thread-'));
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, page(scenario));
  if (process.env.THREAD_DUMP) fs.copyFileSync(file, process.env.THREAD_DUMP);
  // The page opens on ?id=…, as the panel opens it.
  const url = `file://${file}?id=${id}`;
  try {
    const r = spawnSync(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
      `--user-data-dir=${path.join(dir, 'profile')}`, '--virtual-time-budget=20000', '--window-size=900,1400',
      '--dump-dom', url,
    ], { encoding: 'utf8', timeout: 90000 });
    const m = /<pre id="result">([\s\S]*?)<\/pre>/.exec(r.stdout || '');
    assert.ok(m, 'Chrome did not report: ' + (r.stderr || '').slice(0, 300));
    const out = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    assert.ok(!out.error, out.error);
    if (process.env.THREAD_DEBUG) console.error(JSON.stringify(out, null, 1));
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const id = (c) => c.repeat(64);
const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

test('a web comment’s page shows the page it was on, the comment, and its replies as a tree', opts, () => {
  const { first: r, pwn, injected } = measure({ flow: 'none' }, id('1'));
  // The page's preview card, as the comment composer shows it, and under it the exact address and the way to the page's other comments.
  assert.deepEqual(r.ctx.card, { site: 'Example', title: 'A headline about Brazil', desc: 'The movie, and the week.', href: 'https://example.com/post', target: '_blank' });
  assert.equal(r.ctx.url, 'https://example.com/post');
  assert.equal(r.ctx.footer, true);
  assert.equal(r.ctx.more, 'See all comments on this page');
  assert.match(r.ctx.moreHref, /^https:\/\/jumble\.social\/external-content\?id=/);
  assert.equal(r.focus.name, 'Me');
  assert.equal(r.focus.text, 'Basically the plot of the movie Brazil.');
  assert.deepEqual(r.focus.chips, ['heart 1'], 'what has been said about the comment shows under it');
  assert.deepEqual(r.focus.acts, ['Reply', 'React', 'Open in Jumble', 'Refresh']);
  assert.equal(r.count, '3', 'three replies in all');
  assert.equal(r.tree.length, 2, 'two replies to the comment, oldest first');
  assert.equal(r.tree[0].name, 'Bea');
  assert.match(r.tree[0].text, /^Ha! See example\.org\/brazil, it is great\./, 'an address in a comment is a link, shortened');
  assert.deepEqual(r.tree[0].chips, ['🔥 2 mine']);
  assert.equal(r.tree[0].kids.length, 1, 'my answer nests under the reply it answers');
  assert.equal(r.tree[0].kids[0].name, 'Me');
  assert.match(r.tree[0].kids[0].text, /^Agreed, ask @Bea about it$/, 'a nostr: reference reads as the person’s name');
  assert.equal(r.tree[1].name, 'Bea');
  // Words a stranger wrote are text: no element, no handler, no address that runs.
  assert.equal(pwn, false);
  assert.equal(injected, 0);
  assert.equal(r.tree[1].text, '<img src=x onerror="window.__pwn=1"> javascript:alert(1) <b>bold</b>');
});

test('a comment on a note shows that note, and a missing comment says so and offers another try', opts, () => {
  const note = measure({ flow: 'none' }, id('6')).first;
  assert.equal(note.ctx.host, 'Bea');
  assert.equal(note.ctx.snippet, 'A note worth answering');
  assert.equal(note.ctx.more, 'Open in Jumble');
  assert.equal(note.focus.text, 'Answering the note');
  assert.equal(note.none, true);
  const lost = measure({ flow: 'none' }, id('9')).first;
  assert.equal(lost.message, 'Couldn’t find this comment on your relays.');
  assert.equal(lost.retry, true);
  const bad = measure({ flow: 'none' }, 'nonsense').first;
  assert.equal(bad.message, 'This address does not name a comment.');
});

test('a reply, a reaction, a fold and the walk down and back all do what they say', opts, () => {
  const r = measure({ flow: 'tree' }, id('1'));
  // Reply: the draft slot the panel uses, holding the comment answered, and the composer opened on it.
  const slot = r.drafts[id('a') + '|r:' + id('2')];
  assert.ok(slot, 'the reply’s draft slot exists');
  assert.equal(slot.replyTo.id, id('2'));
  assert.equal(slot.replyTo.kind, 1111);
  assert.deepEqual(slot.expandRelays, ['wss://out.example'], 'the composer is handed this account’s write relays');
  assert.equal(r.tabs.length, 1);
  assert.match(r.tabs[0].url, /compose\.html\?reply=2{64}$/);
  // React: a picker with the quick row and a search, a kind 7 signed with the right tags, published, and a chip.
  assert.deepEqual(r.picker, { open: true, quick: 8, search: true });
  assert.equal(r.heartLit, true, 'the heart is lit while its picker is open');
  assert.deepEqual(r.closedByHeart, { gone: true, lit: false, expanded: 'false' }, 'pressing the same heart again closes the picker');
  assert.deepEqual(r.moved, { pickers: 1, focusLit: false, rowLit: true }, 'another comment’s heart moves the picker there, one at a time');
  assert.equal(r.signed.length, 1);
  assert.equal(r.signed[0].kind, 7);
  assert.equal(r.signed[0].content, '🔥');
  assert.deepEqual(r.signed[0].tags.slice(0, 3), [['e', id('1')], ['p', id('a')], ['k', '1111']]);
  assert.equal(r.published.length, 1);
  assert.deepEqual(r.afterReact, ['heart 1', '🔥 1 mine']);
  assert.equal(r.pickerClosed, true);
  // Fold: hides the replies under one and says how many; again shows them.
  assert.deepEqual(r.folded, { before: false, after: true, text: 'Show 1 reply', aria: 'false' });
  assert.equal(r.unfolded, false);
  // Down: the reply's own page, with the comment it answers above it; Back returns.
  assert.equal(r.down.search, '?id=' + id('2'));
  assert.equal(r.down.focus.text, 'Ha! See example.org/brazil, it is great.');
  assert.equal(r.down.ancestors.length, 1);
  assert.equal(r.down.ancestors[0], 'Me | Basically the plot of the movie Brazil.');
  assert.equal(r.down.tree.length, 1);
  assert.equal(r.back.focus.text, 'Basically the plot of the movie Brazil.');
  // The panel can point the open tab at another comment; a stranger cannot.
  assert.equal(r.afterStranger, '?id=' + id('1'));
  assert.equal(r.afterPanel.focus.text, 'Answering the note');
});

test('an open composer tab is pointed at the comment instead of a second one opening', opts, () => {
  const r = measure({ flow: 'compose-open', composeOpenFor: '4' }, id('1'));
  assert.deepEqual(r.composeOpen, [{ type: 'SIDECAR_COMPOSE_OPEN', replyId: id('2') }]);
  assert.equal(r.tabs.length, 0);
});

test('a deep thread keeps every comment but stops moving right after four levels', opts, () => {
  const r = measure({ flow: 'none', deep: true }, id('1')).first;
  const depthOf = (nodes, d = 1, acc = []) => { for (const n of nodes) { acc.push([d, n.flat]); depthOf(n.kids, d + 1, acc); } return acc; };
  const flat = depthOf(r.tree[2] ? [r.tree[2]] : r.tree.filter((n) => /level 7/.test(n.text)));
  assert.equal(flat.length, 6, 'all six levels are on the page');
  // The flag is on a node whose own replies sit on a flat rail: the fourth level's replies, and the fifth's.
  assert.deepEqual(flat.map((x) => x[1]), [false, false, false, true, true, false], 'past four levels the rail stops moving right');
});

test('a comment the panel left for the page shows at once, and one that is not what it claims is ignored', opts, () => {
  const good = measure({ flow: 'none', seed: 'good' }, id('1')).first;
  assert.equal(good.focus.text, 'Left by the panel', 'no relay has it, and the page does not need one');
  const forged = measure({ flow: 'none', seed: 'forged' }, id('1')).first;
  assert.equal(forged.message, 'Couldn’t find this comment on your relays.', 'a seed whose content does not match its signature is not trusted');
});

test('a site that gives no preview leaves the host and the address, and the preview is asked for once', opts, () => {
  const none = measure({ flow: 'none', ogFail: true }, id('1')).first;
  assert.equal(none.ctx.card, null);
  assert.equal(none.ctx.host, 'example.com', 'the host stands in for the card');
  assert.equal(none.ctx.url, 'https://example.com/post');
  assert.equal(none.ctx.more, 'See all comments on this page');
  // Walking down into a reply and back redraws the card from what was kept, without asking the site again.
  const walked = measure({ flow: 'tree' }, id('1'));
  assert.deepEqual(walked.og, ['https://example.com/post']);
});
