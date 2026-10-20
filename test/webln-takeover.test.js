'use strict';

// "Use Sidecar for Lightning payments" (#501) — the takeover branch of the real
// injection code, run against a second provider the way the two-extension lab did.
//
// The investigation the prototype comes from (#501) measured, in a real browser with
// two unpacked extensions at document_start in the MAIN world: Sidecar's provider
// executes last regardless of install order, an existing plain-assignment provider
// holds the slot through Sidecar's gate, the slot is only ever takeable when the
// property is configurable (a locked defineProperty throws), and a re-dispatched
// webln:ready is the one discovery signal a mid-page change of answer has. Each of
// those findings is pinned here against the real nostr-provider.js:
//   - an existing provider keeps the slot at document_start (today's behavior);
//   - the opt-in config takes the slot, keeps the other provider reachable, and
//     re-dispatches webln:ready;
//   - OFF hands the slot back;
//   - a locked provider cannot be taken and nothing is announced;
//   - Sidecar's provider is identifiable (isSidecar) either way.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'nostr-provider.js'), 'utf8');
const bgSrc = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

// A page context that records what the provider hears and announces, so a config
// message can be delivered and webln:ready dispatches counted.
function page(otherProvider, opts) {
  const listeners = [];
  const events = [];
  const posted = [];
  const win = {
    postMessage(m) { posted.push(m); },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    removeEventListener() {},
    dispatchEvent(ev) { events.push(ev.type); return true; },
    location: { origin: 'https://example.com', href: 'https://example.com/' },
  };
  const ctx = {
    window: win, document: { addEventListener() {}, documentElement: {} }, navigator: {},
    Event: class { constructor(type) { this.type = type; } },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout, clearTimeout, Promise, Object, Math, Date, String, Error, JSON, console,
  };
  if (otherProvider) {
    const locked = opts && opts.locked;
    Object.defineProperty(win, 'webln', {
      value: otherProvider, writable: !locked, configurable: !locked, enumerable: true,
    });
  }
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return {
    win,
    events,
    posted,
    // Deliver a message to the page the way the provider hears one: a window message
    // from the page's own world, given to every listener the provider registered.
    dispatch(data) {
      const msg = { source: win, data };
      for (const fn of [...listeners]) fn(msg);
    },
    // The settings config exactly as content.js relays it.
    config(on) {
      this.dispatch({ ext: 'sidecar', kind: 'config', weblnTakeover: on });
    },
  };
}

function otherWallet(name) {
  return { providerName: name || 'otherwallet', enable: async () => ({ enabled: true }) };
}

test('with no other provider, the install is the same as it always was — plus a name tag', () => {
  const p = page();
  const d = Object.getOwnPropertyDescriptor(p.win, 'webln');
  assert.ok(d, 'Sidecar installed webln');
  assert.equal(d.writable, true, 'still writable, as wallet libraries expect');
  assert.equal(d.configurable, true, 'still configurable');
  assert.equal(p.win.webln.isSidecar, true, 'the provider says who it is (#501 Q4)');
  assert.deepEqual(p.events, ['webln:ready'], 'the discovery handshake fires once');
  // A config lands on an already-Sidecar slot: nothing to take, nothing to announce.
  p.config(true);
  assert.equal(p.win.webln.isSidecar, true);
  assert.deepEqual(p.events, ['webln:ready'], 'no second event for a slot Sidecar already holds');
});

test('an existing provider keeps the slot at document_start — no change, no event', () => {
  const other = otherWallet();
  const p = page(other);
  assert.equal(p.win.webln, other, 'the gate still stands: Sidecar does not take the slot');
  assert.deepEqual(p.events, [], 'Sidecar dispatches nothing on a slot it did not take');
  assert.equal(p.win.webln.isSidecar, undefined);
});

test('the opt-in config takes the slot, keeps the other reachable, and re-announces', () => {
  const other = otherWallet();
  const p = page(other);
  p.config(true);
  assert.equal(p.win.webln.isSidecar, true, 'Sidecar holds the slot');
  assert.equal(p.win.webln.otherProvider, other, 'the other wallet stays reachable');
  const d = Object.getOwnPropertyDescriptor(p.win, 'webln');
  assert.equal(d.writable && d.configurable, true, 'the slot stays a normal property');
  assert.deepEqual(p.events, ['webln:ready'], 'exactly one re-discovery event for the change');
  // A repeat of the same answer is a no-op, not a second event.
  p.config(true);
  assert.deepEqual(p.events, ['webln:ready'], 'the same setting twice changes nothing');
});

test('the opt-out config hands the slot back', () => {
  const other = otherWallet();
  const p = page(other);
  p.config(true);
  p.config(false);
  assert.equal(p.win.webln, other, 'the displaced provider is back on the slot');
  assert.deepEqual(p.events, ['webln:ready', 'webln:ready'], 'each change of answer announced once');
  // OFF when Sidecar never held the slot: no change, no event.
  p.config(false);
  assert.equal(p.win.webln, other);
  assert.deepEqual(p.events, ['webln:ready', 'webln:ready']);
});

test('a provider that locked the slot cannot be taken, and nothing is announced', () => {
  const other = otherWallet('lockedwallet');
  const p = page(other, { locked: true });
  p.config(true);
  assert.equal(p.win.webln, other, 'a non-configurable property cannot change hands');
  assert.deepEqual(p.events, [], 'and Sidecar does not pretend otherwise');
});

test('only Sidecar\'s own config kind moves the slot', () => {
  const other = otherWallet();
  const p = page(other);
  // Not exactly true, not the config kind, not Sidecar's envelope: none of these is
  // the person's answer. (The genuine config arrives on the page's own message
  // channel, which only the extension's scripts write — there is no stronger
  // origin to check in a MAIN-world script, and the setting's authority comes from
  // content.js being the only thing that sends this envelope.)
  p.dispatch({ ext: 'sidecar', kind: 'config', weblnTakeover: 'yes' });
  p.dispatch({ ext: 'sidecar', kind: 'response', weblnTakeover: true });
  p.dispatch({ ext: 'another-extension', kind: 'config', weblnTakeover: true });
  assert.equal(p.win.webln, other, 'the slot never moved');
  assert.deepEqual(p.events, [], 'and nothing was announced');

  // ...but the genuine message does.
  p.config(true);
  assert.equal(p.win.webln.isSidecar, true);
});

// ---- the setting reaches a page that loads AFTER it was saved ---------------------------
//
// The live push (pushPageSettings) only reaches pages that are already open. A page that
// loads later asks the worker for its settings, through the clamped web-origin read, and
// that reply did not carry weblnTakeover: every load told the provider "off", so a saved
// ON worked only until the next reload. This runs the real clamped read.
function pageSettingsReply(saved) {
  const start = bgSrc.indexOf("if (!fromExtPage && message.type === 'SIDECAR_GET_SETTINGS') {");
  assert.ok(start !== -1, 'the clamped settings read is gone');
  let depth = 0, end = -1;
  for (let i = bgSrc.indexOf('{', start); i < bgSrc.length; i++) {
    if (bgSrc[i] === '{') depth++;
    else if (bgSrc[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const block = bgSrc.slice(start, end);
  const replies = [];
  const ctx = vm.createContext({
    URL,
    sget: async () => ({ sidecar_settings: saved }),
    getSiteAccount: async () => null,
    resolveSiteAccount: async () => 'pk',
    KS: { hasNwc: async () => false },
    SidecarSeasons: { resolve: () => '' },
    AUTOZAP_DEFAULT_MAX: 100,
    replies,
  });
  vm.runInContext(
    '(function (fromExtPage, message, sender, sendResponse) {' + block + '})' +
    '(false, { type: "SIDECAR_GET_SETTINGS" }, { url: "https://example.com/" }, (r) => replies.push(r));',
    ctx
  );
  return new Promise((resolve) => setTimeout(() => resolve(JSON.parse(JSON.stringify(replies[0]))), 20));
}

test('a page that loads after the setting was saved is told the setting', async () => {
  const on = await pageSettingsReply({ weblnTakeover: true });
  assert.equal(on.result.weblnTakeover, true);
  const off = await pageSettingsReply({});
  assert.equal(off.result.weblnTakeover, false);
  const junk = await pageSettingsReply({ weblnTakeover: 'yes' });
  assert.equal(junk.result.weblnTakeover, false, 'only a real true opts in');
});

// ---- the proactive offer (#501) ---------------------------------------------------------
//
// Nobody hunts for a setting they do not know exists, so the page-world provider tells the
// content script, once, when another wallet holds the slot, and the panel offers to take
// it. The provider never decides anything; these pin what it says and when.
const notices = (p) => p.posted.filter((m) => m && m.kind === 'webln-other-present');

test('another wallet on the slot: the first config message raises one notice, never two', () => {
  const p = page(otherWallet());
  assert.equal(notices(p).length, 0, 'nothing is said before the content script has spoken');
  p.config(false);
  assert.equal(notices(p).length, 1);
  assert.equal(notices(p)[0].ext, 'sidecar');
  p.config(false);
  p.config(false);
  assert.equal(notices(p).length, 1, 'once per load');
});

test('no notice when Sidecar holds the slot, or when the person already opted in', () => {
  const alone = page();
  alone.config(false);
  assert.equal(notices(alone).length, 0, 'Sidecar installed itself: no other wallet to mention');
  const optedIn = page(otherWallet());
  optedIn.config(true);
  assert.equal(notices(optedIn).length, 0, 'already taken at the person\'s own word');
});

function liftFn(source, decl) {
  const at = source.indexOf(decl);
  assert.ok(at !== -1, decl + ' is gone');
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

test('weblnOfferHost: one offer, never to someone who opted in or waved it off', () => {
  const ctx = vm.createContext({});
  vm.runInContext(liftFn(bgSrc, 'function weblnOfferHost(') + '\nthis.f = weblnOfferHost;', ctx);
  const f = ctx.f;
  assert.equal(f({}, 'example.com'), 'example.com');
  assert.equal(f({}, ''), '', 'no host, no offer');
  assert.equal(f({ weblnTakeover: true }, 'example.com'), '', 'already on');
  assert.equal(f({ weblnOfferDismissed: true }, 'example.com'), '', 'already answered');
  assert.equal(f({ weblnOfferHost: 'first.example' }, 'second.example'), '', 'one offer at a time');
});

test('a page may raise the notice but never answer the offer', () => {
  const set = bgSrc.match(/const CONTENT_OK = new Set\(\[[\s\S]*?\]\);/);
  assert.ok(set, 'CONTENT_OK is gone');
  assert.match(set[0], /SIDECAR_WEBLN_OTHER_PRESENT/);
  assert.doesNotMatch(set[0], /SIDECAR_WEBLN_OFFER_ANSWER/, 'a site could switch the takeover on');
});

// The panel's card, run for real: the host is shown, "Use Sidecar" answers yes, "Not now"
// answers no, and either retires the card.
function offerCard() {
  const panelSrc = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
  const mk = (tag) => {
    const el = { tag, children: [], classes: new Set(['hidden']), handlers: {}, textContent: '', _html: '' };
    el.classList = { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), contains: (c) => el.classes.has(c) };
    el.append = (...kids) => { el.children.push(...kids); };
    el.addEventListener = (type, fn) => { el.handlers[type] = fn; };
    Object.defineProperty(el, 'innerHTML', { get: () => el._html, set: (v) => { el._html = v; if (v === '') el.children = []; } });
    return el;
  };
  const card = mk('div');
  const answers = [];
  const ctx = vm.createContext({
    $: (id) => (id === 'webln-offer' ? card : null),
    show: (e) => e.classList.remove('hidden'),
    hide: (e) => e.classList.add('hidden'),
    h: (tag, props, kids) => { const e = mk(tag); Object.assign(e, props || {}); if (kids) e.append(...kids); return e; },
    t: (s, v) => (v ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k]) : s),
    bg: async (m) => { answers.push(m); return { ok: true }; },
  });
  vm.runInContext(liftFn(panelSrc, 'function renderWeblnOffer(') + '\nthis.render = renderWeblnOffer;', ctx);
  return { card, answers, render: ctx.render };
}

test('the offer card names the site and answers through the worker', async () => {
  const c = offerCard();
  c.render('example.com');
  assert.equal(c.card.classes.has('hidden'), false, 'the card is shown');
  assert.match(c.card.children[0].textContent, /example\.com/);
  const [use, later] = c.card.children[1].children;
  await use.handlers.click();
  assert.deepEqual(c.answers.map((a) => [a.type, a.use]), [['SIDECAR_WEBLN_OFFER_ANSWER', true]]);
  assert.equal(c.card.classes.has('hidden'), true, 'answered: the card is gone');
  c.render('example.com');
  const again = c.card.children[1].children[1];
  await again.handlers.click();
  assert.equal(c.answers[1].use, false, '"Not now" answers no');
  c.render('');
  assert.equal(c.card.classes.has('hidden'), true, 'no host, no card');
});
