'use strict';

// A compose tab that has posted shows a receipt, not a draft. It used to keep behaving
// as an open composer: the panel focused it instead of opening a new note or reply, the
// tab's "switch draft" handler repainted an editor that was gone, and its empty draft
// could delete the slot the panel had just written. These run the real functions.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const compose = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(src, decl) {
  const at = src.indexOf(decl);
  assert.ok(at !== -1, decl + ' is gone');
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

// The relay row is the shared core's now (the panel's banner draws it too), so the receipt's
// tests run the real one, built with whatever h, t and tn the test hands it.
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
function coreReport(h, t, tn) {
  const ctx = vm.createContext({ h, t, tn, URL });
  vm.runInContext([
    lift(core, 'function groupRefusals('), lift(core, 'function refusalLines('),
    lift(core, 'function acceptedLine('), lift(core, 'function relayReportNode('),
    'this.relayReportNode = relayReportNode;',
  ].join('\n'), ctx);
  return ctx.relayReportNode;
}

const X = 'a'.repeat(64);
const Y = 'b'.repeat(64);

function tabHandler(state) {
  const replaced = [];
  const switched = [];
  const ctx = vm.createContext({
    receiptShown: state.done, replyId: state.replyId,
    location: { pathname: '/compose.html', replace: (u) => replaced.push(u) },
    switchToDraft: (w) => { switched.push(w); return Promise.resolve(); },
  });
  vm.runInContext(lift(compose, 'function handleComposeOpen(') + '\nthis.f = handleComposeOpen;', ctx);
  return { open: (replyId) => ctx.f({ type: 'SIDECAR_COMPOSE_OPEN', replyId }), replaced, switched };
}

test('a tab on its receipt starts over on whatever the panel asks for', () => {
  const asNote = tabHandler({ done: true, replyId: null });
  asNote.open(null);
  assert.deepEqual(asNote.replaced, ['/compose.html'], 'a new note: a fresh composer');
  assert.deepEqual(asNote.switched, [], 'no switch on an editor that is gone');
  const sameReply = tabHandler({ done: true, replyId: X });
  sameReply.open(X);
  assert.deepEqual(sameReply.replaced, ['/compose.html?reply=' + X], 'the same note again is not "already here"');
  const otherReply = tabHandler({ done: true, replyId: X });
  otherReply.open(Y);
  assert.deepEqual(otherReply.replaced, ['/compose.html?reply=' + Y]);
});

test('a tab that is editing behaves as it did', () => {
  const same = tabHandler({ done: false, replyId: X });
  same.open(X);
  assert.deepEqual([same.replaced, same.switched], [[], []], 'already here: nothing to do');
  const other = tabHandler({ done: false, replyId: X });
  other.open(Y);
  assert.deepEqual([other.replaced, other.switched], [[], [Y]], 'another draft: switch, no reload');
});

test('a tab on its receipt never writes its empty draft over the store', async () => {
  const writes = [];
  const run = async (done) => {
    writes.length = 0;
    const ctx = vm.createContext({
      receiptShown: done, dkey: 'slot', replyTo: null,
      draft: { text: '', media: [], poll: null },
      call: async (m) => { if (m.type === 'SIDECAR_SECRET_SET') writes.push(m); return {}; },
    });
    vm.runInContext(lift(compose, 'async function persistDraft(') + '\nthis.f = persistDraft;', ctx);
    await ctx.f();
    return writes.length;
  };
  assert.equal(await run(true), 0, 'the receipt wrote the store: it can delete the next reply\'s slot');
  assert.equal(await run(false), 1, 'an editing tab still saves');
});

test('the panel reads a tab on its receipt from its address, and does not count it as open', async () => {
  const contexts = (url) => [{ documentUrl: url, tabId: 7, windowId: 1 }];
  const find = async (url) => {
    const ctx = vm.createContext({
      URL,
      chrome: { runtime: { getURL: (p) => 'chrome-extension://abc/' + p, getContexts: async () => contexts(url) } },
    });
    vm.runInContext(lift(panel, 'async function liveComposeTab(') + '\nthis.f = liveComposeTab;', ctx);
    return JSON.parse(JSON.stringify(await ctx.f()));
  };
  const editing = await find('chrome-extension://abc/compose.html?reply=' + X);
  assert.equal(editing.done, false);
  assert.equal(editing.replyId, X);
  const receipt = await find('chrome-extension://abc/compose.html#done');
  assert.equal(receipt.done, true, 'the tab marked itself and the panel saw it');
  const afterReply = await find('chrome-extension://abc/compose.html?reply=' + X + '#done');
  assert.equal(afterReply.done, true);

  const decide = vm.createContext({});
  vm.runInContext(lift(panel, 'function composeTabHoldsDraft(') + '\n' + lift(panel, 'function composeTabNeedsSwitch(')
    + '\nthis.holds = composeTabHoldsDraft; this.needs = composeTabNeedsSwitch;', decide);
  assert.equal(decide.holds(editing, X), true, 'editing this draft: focus it, do not open a second');
  assert.equal(decide.holds(receipt, null), false, 'a receipt is not an open composer for a new note');
  assert.equal(decide.holds(afterReply, X), false, 'nor for a second reply to the same note');
  assert.equal(decide.needs(receipt, null), true, 'a receipt has to be told to start over');
  assert.equal(decide.needs(editing, X), false);
  assert.equal(decide.needs(null, X), false);
});

test('showPosted marks the tab, and the message listener hands off to the handler', () => {
  const body = lift(compose, 'async function showPosted(');
  assert.match(body, /receiptShown = true;/);
  assert.match(body, /replaceState\(null, '', location\.pathname \+ location\.search \+ '#done'\)/);
  assert.match(compose, /msg\.type === 'SIDECAR_COMPOSE_OPEN'\) \{\s*handleComposeOpen\(msg\);/);
});

// The first cut named its flag `done`, and showPosted has a local `done` (the "Close this
// tab" button) further down: assigning the flag at the top touched the local before it
// existed and the receipt never painted. Nothing above runs showPosted, so this does.
test('showPosted runs: the receipt paints and the tab marks itself', async () => {
  const mk = () => {
    const el = { children: [], classes: new Set(), listeners: {}, href: '', textContent: '' };
    el.classList = { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c) };
    el.append = (...k) => { el.children.push(...k); };
    el.addEventListener = (type, fn) => { el.listeners[type] = fn; };
    Object.defineProperty(el, 'innerHTML', { get: () => '', set: () => { el.children = []; } });
    return el;
  };
  const sheet = mk();
  const urls = [];
  const ctx = vm.createContext({
    receiptShown: false,
    document: { querySelector: () => sheet, createElement: () => mk() },
    state: { activePubkey: 'pk' },
    call: async () => ({}),
    composer: { resolveClient: () => ({ url: (n) => 'https://client.example/' + n, label: 'Client' }) },
    neventFor: async () => 'nevent1abc',
    h: (tag, props, kids) => { const e = mk(); Object.assign(e, props || {}); if (kids) e.append(...kids); return e; },
    icon: () => mk(),
    t: (s, v) => (v ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k]) : s),
    tn: (one, other, n) => (n === 1 ? one : other).replace('{{count}}', n),
    window: { location: { replace() {} } },
    location: { pathname: '/compose.html', search: '' },
    history: { replaceState: (a, b, url) => urls.push(url) },
  });
  ctx.SC = { relayReportNode: coreReport(ctx.h, ctx.t, ctx.tn) };
  vm.runInContext(lift(compose, 'async function showPosted(') + '\nthis.f = showPosted;', ctx);
  const four = ['wss://a', 'wss://b', 'wss://c', 'wss://d'];
  await ctx.f({ pubkey: 'pk', kind: 1 }, { accepted: four, failed: [], total: 4 }, 'note');
  assert.deepEqual(urls, ['/compose.html#done'], 'the tab marked its address');
  assert.equal(ctx.receiptShown, true);
  assert.ok(sheet.classes.has('compose-done'), 'the receipt painted');
  assert.ok(sheet.children.length >= 4, 'title, count, actions and the close word are on the sheet');
});

// "Published to 9 relays" for a note that reached one is the lie this page used to tell.
test('showPosted says how many took it, and names the relays that did not', async () => {
  const mk = () => {
    const el = { children: [], classes: new Set(), listeners: {}, href: '', textContent: '' };
    el.classList = { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c) };
    el.append = (...k) => { el.children.push(...k); };
    el.addEventListener = () => {};
    Object.defineProperty(el, 'innerHTML', { get: () => '', set: () => { el.children = []; } });
    return el;
  };
  const sheet = mk();
  const fill = (s, v) => (v ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k]) : s);
  const ctx = vm.createContext({
    receiptShown: false,
    document: { querySelector: () => sheet, createElement: () => mk() },
    state: { activePubkey: 'pk' },
    call: async () => ({}),
    composer: { resolveClient: () => ({ url: (n) => 'https://client.example/' + n, label: 'Client' }) },
    neventFor: async () => 'nevent1abc',
    URL,
    h: (tag, props, kids) => { const e = mk(); e.tag = tag; Object.assign(e, props || {}); if (kids) e.append(...kids); return e; },
    icon: () => mk(),
    t: fill,
    tn: (one, other, n) => fill(n === 1 ? one : other, { count: n }),
    window: { location: { replace() {} } },
    location: { pathname: '/compose.html', search: '' },
    history: { replaceState() {} },
  });
  ctx.SC = { relayReportNode: coreReport(ctx.h, ctx.t, ctx.tn) };
  vm.runInContext(lift(compose, 'async function showPosted(') + '\nthis.f = showPosted;', ctx);
  await ctx.f({ pubkey: 'pk', kind: 1 }, {
    accepted: ['wss://snort'],
    failed: [
      { url: 'wss://azzamo', code: 'payment', text: '' },
      { url: 'wss://nostrelites', code: 'payment', text: '' },
      { url: 'wss://nos.lol', code: 'timeout', text: '' },
      { url: 'wss://feed', code: 'refused', text: 'restricted: read-only' },
    ],
    total: 5,
  }, 'reply');
  const texts = (el) => [el.textContent, ...(el.children || []).flatMap(texts)].filter(Boolean);
  const said = sheet.children.flatMap(texts);
  assert.ok(said.includes('Published to 1 relay.'), 'the count is of the relays that took it: ' + JSON.stringify(said));
  assert.ok(said.includes('Accepted it: snort.'), 'the relay that accepted it is named: ' + JSON.stringify(said));
  assert.ok(said.includes('azzamo, nostrelites asked for payment.'), 'the paid relays are named: ' + JSON.stringify(said));
  assert.ok(said.includes('nos.lol timed out.'), 'and the one that never answered: ' + JSON.stringify(said));
  assert.ok(said.includes('Refused by feed: restricted: read-only'), "a refusal carries the relay's own words: " + JSON.stringify(said));
  assert.ok(!said.includes('Published to 5 relays.'), 'it must never claim the total when some refused');

  // COLLAPSED: the count is the row, and everything else is inside a details element, closed.
  const details = sheet.children.find((k) => k.tag === 'details');
  assert.ok(details, 'the relay answer is one expandable row');
  assert.equal(details.children[0].tag, 'summary');
  assert.equal(details.children[0].textContent, 'Published to 1 relay.');
  assert.ok(!details.open, 'closed until it is opened');
  assert.ok(details.children.length >= 4, 'the detail is inside the row, not beside it');
  assert.equal(sheet.children.filter((k) => /^(Refused|azzamo|nos\.lol)/.test(k.textContent || '')).length, 0,
    'no refusal sentence sits outside the row');
});

test('when every relay took it there is no row to open, just the plain count', async () => {
  const mk = () => {
    const el = { children: [], classes: new Set(), listeners: {}, href: '', textContent: '' };
    el.classList = { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c) };
    el.append = (...k) => { el.children.push(...k); };
    el.addEventListener = () => {};
    Object.defineProperty(el, 'innerHTML', { get: () => '', set: () => { el.children = []; } });
    return el;
  };
  const sheet = mk();
  const fill = (s, v) => (v ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k]) : s);
  const ctx = vm.createContext({
    receiptShown: false,
    document: { querySelector: () => sheet, createElement: () => mk() },
    state: { activePubkey: 'pk' }, call: async () => ({}),
    composer: { resolveClient: () => ({ url: (n) => 'https://client.example/' + n, label: 'Client' }) },
    neventFor: async () => 'nevent1abc',
    h: (tag, props, kids) => { const e = mk(); e.tag = tag; Object.assign(e, props || {}); if (kids) e.append(...kids); return e; },
    icon: () => mk(), t: fill, tn: (one, other, n) => fill(n === 1 ? one : other, { count: n }),
    window: { location: { replace() {} } }, location: { pathname: '/compose.html', search: '' }, history: { replaceState() {} },
  });
  ctx.SC = { relayReportNode: coreReport(ctx.h, ctx.t, ctx.tn) };
  vm.runInContext(lift(compose, 'async function showPosted(') + '\nthis.f = showPosted;', ctx);
  await ctx.f({ pubkey: 'pk', kind: 1 }, { accepted: ['wss://a', 'wss://b'], failed: [], total: 2 }, 'note');
  const said = sheet.children.map((k) => k.textContent).filter(Boolean);
  assert.ok(said.includes('Published to 2 relays.'), JSON.stringify(said));
  assert.ok(!sheet.children.some((k) => k.tag === 'details'), 'nothing to expand when nothing went wrong');
});
