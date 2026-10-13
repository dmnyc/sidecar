'use strict';

// The directory is a list that scrolls. Rows are revealed twenty at a time as the end comes
// near, rows already on screen are kept across repaints (a repaint that rebuilt them lost the
// reader's place and flashed every thumbnail), and the end of each list says whether more is
// coming, offers to keep looking, or says there is nothing more. These run the real list code
// out of streams.js, paint() included, against a small fake DOM.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'streams.js'), 'utf8');
const CODE = source.slice(source.indexOf('  const rowCache = new Map();'), source.indexOf('  let directoryPaintTimer=null;'));

function node() {
  const n = {
    children: [], parent: null, hidden: false, attrs: {}, className: '', textContent: '', listeners: {}, ops: 0, top: 0,
    setAttribute(k, v) { n.attrs[k] = String(v); }, getAttribute(k) { return k in n.attrs ? n.attrs[k] : null; },
    append(...k) { k.forEach((x) => { x.remove(); x.parent = n; n.children.push(x); }); },
    replaceChildren(...k) { n.children.forEach((x) => { x.parent = null; }); n.children = []; n.append(...k); },
    insertBefore(x, ref) { x.remove(); x.parent = n; const i = ref ? n.children.indexOf(ref) : -1; if (i < 0) n.children.push(x); else n.children.splice(i, 0, x); n.ops++; },
    get lastElementChild() { return n.children[n.children.length - 1] || null; },
    remove() { if (n.parent) { n.parent.children = n.parent.children.filter((c) => c !== n); n.parent = null; n.ops++; } },
    addEventListener(e, f) { n.listeners[e] = f; }, click() { n.listeners.click && n.listeners.click(); },
    getBoundingClientRect() { return { top: n.top, bottom: n.top }; }, after() {},
  };
  return n;
}

const item = (i, over) => ({ key: 'k' + i, title: 'Stream ' + i, status: 'live', host: 'h', ...over });
const many = (n, from = 0) => Array.from({ length: n }, (_, i) => item(from + i));

function page({ live = many(55), savedStreams = [], savedOnly = false, category = 'live', moreOpen = false } = {}) {
  const els = { 'stream-more-list': node(), 'stream-more-toggle': node(), 'stream-advanced': node() };
  const actions = node();
  const list = node();
  const calls = { history: [], details: 0, raf: [] };
  const ctx = {
    list, savedStreams, savedOnly, category, detailItem: null,
    historyBusy: false, historyPaging: false, historyStalled: false, detailDrawn: false,
    reveal: { main: 20, more: 20 }, REVEAL_BATCH: 20, listTotals: { main: 0, more: 0 },
    directory: { hidden: false, querySelector: () => actions },
    directoryContent: { clientHeight: 400, scrollTop: 0, getBoundingClientRect: () => ({ bottom: 400 }) },
    document: { getElementById: (id) => els[id], createElement: () => node() },
    model: { live: () => ctx.live, past: () => ctx.live, upcoming: () => ctx.live, events: new Map() },
    live,
    t: (s) => s,
    canLoadHistory: () => ctx.canLoad === true, canLoad: false,
    loadMoreHistory: (kind) => calls.history.push(kind),
    drawDirectoryDetails: () => { calls.details++; list.append(node()); },   // the details are drawn into the list
    requestAnimationFrame: (f) => { calls.raf.push(f); return calls.raf.length; },
    JSON, Set, Map,
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  vm.runInContext('moreOpen = ' + moreOpen, ctx);
  let built = 0;
  ctx.buildRow = (it) => { built++; const row = node(); row.item = it; return row; };
  return { ctx, els, list, calls, actions, built: () => built, foot: vm.runInContext('foot', ctx),
    paint: () => vm.runInContext('paint()', ctx), run: (c) => vm.runInContext(c, ctx) };
}
const rows = (container) => container.children.map((r) => r.item.key);
// Run the frames queued so far, but not the ones those schedule.
const flush = (p) => p.calls.raf.splice(0).forEach((f) => f());

test('the first paint shows one batch, not everything', () => {
  const p = page();
  p.paint();
  assert.equal(p.list.children.length, 20);
  assert.deepEqual(rows(p.list).slice(0, 2), ['k0', 'k1']);
  assert.equal(p.ctx.listTotals.main, 55);
});

test('revealing the next batch adds rows below and keeps the ones already there', () => {
  const p = page();
  p.paint();
  const first = [...p.list.children];
  p.run("loadMore('main')");
  assert.equal(p.list.children.length, 40);
  first.forEach((row, i) => assert.equal(p.list.children[i], row, 'row ' + i + ' is the same node'));
  p.run("loadMore('main')");
  assert.equal(p.list.children.length, 55, 'the last batch is the remainder');
  assert.equal(p.built(), 55, 'each stream was built once');
});

test('A REPAINT WITH NOTHING NEW TOUCHES NOTHING', () => {
  const p = page();
  p.paint();
  const ops = p.list.ops, built = p.built();
  p.paint(); p.paint();
  assert.equal(p.list.ops, ops, 'no row was moved, added or removed');
  assert.equal(p.built(), built, 'no row was rebuilt');
});

test('a stream that changed is rebuilt, and only that one', () => {
  const p = page();
  p.paint();
  const before = [...p.list.children];
  p.ctx.live[3] = { ...p.ctx.live[3], title: 'Renamed' };
  p.paint();
  assert.notEqual(p.list.children[3], before[3]);
  assert.equal(p.list.children[3].item.title, 'Renamed');
  before.forEach((row, i) => { if (i !== 3) assert.equal(p.list.children[i], row); });
});

test('a stream that is newly saved is rebuilt for its bookmark, and only that one', () => {
  const p = page();
  p.paint();
  const before = [...p.list.children];
  p.ctx.savedStreams = [{ key: 'k5' }];
  p.paint();
  assert.notEqual(p.list.children[5], before[5]);
  assert.equal(p.list.children[4], before[4]);
});

test('streams that reorder are moved, not rebuilt', () => {
  const p = page({ live: many(5) });
  p.paint();
  const built = p.built(), by = Object.fromEntries(p.list.children.map((r) => [r.item.key, r]));
  p.ctx.live = [p.ctx.live[4], p.ctx.live[0], p.ctx.live[1], p.ctx.live[2], p.ctx.live[3]];
  p.paint();
  assert.deepEqual(rows(p.list), ['k4', 'k0', 'k1', 'k2', 'k3']);
  assert.equal(p.built(), built);
  assert.equal(p.list.children[0], by.k4);
});

test('streams that disappear leave the list and are forgotten', () => {
  const p = page({ live: many(5) });
  p.paint();
  p.ctx.live = p.ctx.live.slice(0, 3);
  p.paint();
  assert.equal(p.list.children.length, 3);
  assert.equal(p.run('rowCache.size'), 3);
});

test('streams with no title go to the More group, with their own batch', () => {
  const live = [...many(3), ...Array.from({ length: 45 }, (_, i) => item(100 + i, { title: 'Untitled livestream' }))];
  const p = page({ live, moreOpen: true });
  p.paint();
  assert.equal(p.list.children.length, 3);
  assert.equal(p.els['stream-more-list'].children.length, 20);
  assert.equal(p.els['stream-more-toggle'].hidden, false);
  assert.equal(p.els['stream-more-list'].hidden, false);
  p.run("loadMore('more')");
  assert.equal(p.els['stream-more-list'].children.length, 40);
  assert.equal(p.list.children.length, 3, 'the main list is untouched by the More group\'s batch');
});

test('the More group stays shut until it is opened, and has no toggle when there is nothing in it', () => {
  const p = page({ live: [...many(2), item(9, { title: 'Untitled livestream' })], moreOpen: false });
  p.paint();
  assert.equal(p.els['stream-more-toggle'].hidden, false);
  assert.equal(p.els['stream-more-list'].hidden, true);
  const q = page({ live: many(2) });
  q.paint();
  assert.equal(q.els['stream-more-toggle'].hidden, true);
});

test('with nothing to show, the list says so and holds no rows', () => {
  const p = page({ live: [] });
  p.paint();
  assert.equal(p.list.children.length, 1);
  assert.match(p.list.children[0].textContent, /No live streams found/);
  p.run('lookingForStreams = true'); p.paint();
  assert.match(p.list.children[0].textContent, /Looking for streams/);
});

test('saved streams are listed from the saved set', () => {
  const p = page({ live: many(2), savedOnly: true, savedStreams: many(3, 50) });
  p.paint();
  assert.deepEqual(rows(p.list), ['k50', 'k51', 'k52']);
});

test('opening a stream\'s details clears the list, and coming back puts the same rows back', () => {
  const p = page();
  p.paint();
  const before = [...p.list.children];
  p.ctx.detailItem = p.ctx.live[2];
  p.paint();
  assert.equal(p.calls.details, 1);
  assert.equal(p.actions.hidden, true, 'the footer is hidden while details are open');
  assert.equal(p.foot.main.hidden, true);
  assert.equal(p.list.children.length, 1, 'only the details are in the list: no rows are left beside them');
  p.ctx.detailItem = null;
  p.paint();
  assert.equal(p.actions.hidden, false);
  assert.equal(p.list.children.length, 20, 'the details are gone and the rows are back');
  before.forEach((row, i) => assert.equal(p.list.children[i], row, 'row ' + i + ' came back as the same node'));
});

test('switching view starts at the top: the reveal, the stall, the rows and the scroll are reset', () => {
  const p = page();
  p.paint(); p.run("loadMore('main')");
  p.ctx.historyStalled = true; p.ctx.directoryContent.scrollTop = 900;
  p.run('resetReveal()');
  assert.equal(p.ctx.reveal.main, 20);
  assert.equal(p.ctx.reveal.more, 20);
  assert.equal(p.ctx.historyStalled, false);
  assert.equal(p.run('rowCache.size'), 0);
  assert.equal(p.ctx.directoryContent.scrollTop, 0);
  p.paint();
  assert.equal(p.list.children.length, 20);
});

// ---- the end of a list ----
test('with more known, the foot is empty and the scroll will reveal it', () => {
  const p = page();
  p.paint();
  assert.equal(p.foot.main.children.length + p.foot.main.textContent.length, 0);
});

test('a list that has run out says Loading… while history is on its way', () => {
  const p = page({ live: many(5) });
  p.ctx.canLoad = true; p.ctx.historyPaging = true;
  p.paint();
  assert.equal(p.foot.main.textContent, 'Loading…');
  assert.equal(p.list.getAttribute('aria-busy'), 'true');
  p.ctx.historyPaging = false; p.paint();
  assert.equal(p.list.getAttribute('aria-busy'), 'false');
});

test('a scan that found nothing leaves a button, not a retry loop', () => {
  const p = page({ live: many(5) });
  p.ctx.canLoad = true; p.ctx.historyStalled = true;
  p.paint();
  const button = p.foot.main.children[0];
  assert.equal(button.textContent, 'Keep looking');
  button.click();
  assert.equal(p.ctx.historyStalled, false);
  assert.deepEqual(p.calls.history, ['main']);
});

test('history that can still be fetched, and is not stalled, leaves the foot empty for the scroll to act on', () => {
  const p = page({ live: many(5) });
  p.ctx.canLoad = true;
  p.paint();
  assert.equal(p.foot.main.textContent, '');
  assert.equal(p.foot.main.children.length, 0);
});

test('a long list that has really ended says so, and a short one says nothing', () => {
  const long = page({ live: many(30) });
  long.run("reveal.main = 40"); long.paint();
  assert.equal(long.foot.main.textContent, 'No more streams available.');
  const short = page({ live: many(5) });
  short.paint();
  assert.equal(short.foot.main.textContent, '');
});

// ---- what makes more appear ----
test('near the end, more known streams are revealed before any history is fetched', () => {
  const p = page();
  p.paint();
  p.run("loadMore('main')");
  assert.equal(p.ctx.reveal.main, 40);
  assert.deepEqual(p.calls.history, []);
});

test('known streams are revealed first even when history could also be fetched', () => {
  const p = page();
  p.paint();
  p.ctx.canLoad = true;
  p.run("loadMore('main')");
  assert.equal(p.ctx.reveal.main, 40);
  assert.deepEqual(p.calls.history, [], 'a scan only starts once the known streams have run out');
});

test('at the end of the known streams, history is fetched, once, and only when allowed', () => {
  const p = page({ live: many(5) });
  p.paint();
  p.ctx.canLoad = true;
  p.run("loadMore('main')");
  assert.deepEqual(p.calls.history, ['main']);
  for (const blocked of ['historyBusy', 'historyPaging', 'historyStalled']) {
    const q = page({ live: many(5) });
    q.paint(); q.ctx.canLoad = true; q.ctx[blocked] = true;
    q.run("loadMore('main')");
    assert.deepEqual(q.calls.history, [], blocked + ' blocks a new scan');
  }
  const none = page({ live: many(5) });
  none.paint();
  none.run("loadMore('main')");
  assert.deepEqual(none.calls.history, [], 'Live has none to fetch');
});

test('the end is checked on the next frame, and acts only when it is near the bottom', () => {
  const p = page();
  p.foot.main.top = 5000;                                   // far below the bottom of the scroller
  p.paint(); flush(p);                                      // the check paint() scheduled
  assert.equal(p.ctx.reveal.main, 20);
  p.run('scheduleEndCheck()'); p.run('scheduleEndCheck()');
  assert.equal(p.calls.raf.length, 1, 'one check per frame however many triggers');
  flush(p);
  assert.equal(p.ctx.reveal.main, 20, 'still far away');
  p.foot.main.top = 450;                                    // within the reach
  p.run('scheduleEndCheck()'); flush(p);
  assert.equal(p.ctx.reveal.main, 40);
});

test('nothing is revealed while the directory is closed, a stream\'s details are open, or the scroller has no height', () => {
  for (const state of [(c) => { c.directory.hidden = true; }, (c) => { c.detailItem = {}; }, (c) => { c.directoryContent.clientHeight = 0; }]) {
    const p = page();
    p.foot.main.top = 5000; p.paint(); flush(p);              // quiet to begin with
    p.foot.main.top = 100; state(p.ctx);                      // near the end, but not allowed to act
    p.run('scheduleEndCheck()'); flush(p);
    assert.equal(p.ctx.reveal.main, 20);
  }
});

test('the More group is checked only while it is open', () => {
  const live = [...many(2), ...Array.from({ length: 45 }, (_, i) => item(100 + i, { title: 'Untitled livestream' }))];
  const closed = page({ live, moreOpen: false });
  closed.paint(); flush(closed); closed.foot.more.top = 100; closed.foot.main.top = 5000;
  closed.run('scheduleEndCheck()'); flush(closed);
  assert.equal(closed.ctx.reveal.more, 20);
  const open = page({ live, moreOpen: true });
  open.paint(); flush(open); open.foot.more.top = 100; open.foot.main.top = 5000;
  open.run('scheduleEndCheck()'); flush(open);
  assert.equal(open.ctx.reveal.more, 40);
});

test('every paint schedules a check, so a short list that leaves room is filled', () => {
  const p = page();
  p.calls.raf.length = 0;
  p.paint();
  assert.ok(p.calls.raf.length >= 1);
});

// ---- the wiring that fake DOM cannot exercise, and the removal of the pages ----
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('nothing of the paging is left in the script, the markup or the stylesheet', () => {
  assert.doesNotMatch(source, /streamPage|morePage|pageSize|paginate\(|stream-page-controls|measurePageSize|schedulePageSize|nextHistoryPage|stream-pagination/);
  for (const f of ['sidepanel.html', 'docs/streaming/layout.html', 'docs/streaming/preview.html']) {
    assert.doesNotMatch(read(f), /stream-page-controls/, f + ' still has the page controls');
  }
  assert.doesNotMatch(read('streams.css'), /stream-pagination|stream-page-controls/);
});

test('the foot styles hold their place when empty and keep the button readable', () => {
  const css = read('streams.css');
  assert.match(css, /\.stream-list-foot \{ min-height:1px; text-align:center;/, 'an empty foot still has height, so the scroll can watch it');
  assert.match(css, /\.stream-list-foot:not\(:empty\) \{ padding:10px 0 2px; \}/);
  assert.match(css, /\.stream-list-foot\[hidden\] \{ display:none; \}/);
  assert.match(css, /\.stream-list-foot \.ghost:focus-visible \{ outline:2px solid var\(--gold\)/);
  assert.match(css, /\.stream-directory-actions #stream-refresh \{/, 'the refresh button kept the style it shared with the page buttons');
});

test('the end of each list is watched from inside the scroller, with a scroll fallback and a resize check', () => {
  assert.match(source, /list\.after\(foot\.main\);document\.getElementById\('stream-more-list'\)\.after\(foot\.more\);/);
  assert.match(source, /new IntersectionObserver\(scheduleEndCheck,\{root:directoryContent,rootMargin:'0px 0px 160px 0px'\}\);\s*ends\.observe\(foot\.main\);ends\.observe\(foot\.more\);/);
  assert.match(source, /else directoryContent\.addEventListener\('scroll',scheduleEndCheck,\{passive:true\}\);/);
  assert.match(source, /new ResizeObserver\(scheduleEndCheck\)\.observe\(directoryContent\);/);
});

test('every view change starts the list at the top', () => {
  assert.match(source, /directoryError\(''\);category=value;detailItem=null;savedOnly=false;moreOpen=false;resetReveal\(\);/, 'a category tab');
  assert.match(source, /savedOnly=!savedOnly;detailItem=null;updateBackup\(\);moreOpen=false;resetReveal\(\);/, 'the saved toggle');
  assert.match(source, /'stream-refresh'\)\.addEventListener\('click',\(\)=>\{resetReveal\(\);discover\(true\);\}\);/, 'refresh');
  assert.match(source, /if\(reset\)\{historyCursors\.clear\(\);historyLoaded=false;historyStalled=false;\}/, 'a history reset forgets that it stalled');
});

test('opening a stream\'s details remembers the place in the list, and going back returns to it', () => {
  assert.match(source, /detailScroll=directoryContent\.scrollTop;detailItem=item; paint\(\); revealContent\(list\);/);
  assert.match(source, /back\.onclick=\(\)=>\{detailItem=null;paint\(\);directoryContent\.scrollTop=detailScroll;\};/);
});

test('both lists are marked busy while a batch loads', () => {
  assert.match(source, /list\.setAttribute\('aria-busy',String\(loading\)\);more\.setAttribute\('aria-busy',String\(loading\)\);/);
});

test('the one control left is a button that asks, with a name for assistive tech and a handler', () => {
  assert.match(source, /again\.type='button';again\.className='ghost';again\.textContent=t\('Keep looking'\);/);
  assert.match(source, /again\.addEventListener\('click',\(\)=>\{historyStalled=false;loadMoreHistory\(kind\);\}\);/);
});

test('a reused row is asked to refresh its avatar; a row just built is not asked twice', () => {
  const p = page({ live: many(3) });
  const asked = [];
  p.ctx.buildRow = (it) => { const row = node(); row.item = it; row.refreshAvatar = () => asked.push(it.key); return row; };
  p.paint();
  assert.deepEqual(asked, [], 'a built row loads its own avatar');
  p.paint();
  assert.deepEqual(asked, ['k0', 'k1', 'k2'], 'a reused row tries again until a profile has answered');
});
