'use strict';

// The Overview drawer is re-run in place now: the header's refresh calls
// loadStats() again into the SAME elements the first run painted, and the
// retry link / the network coming back call the loaders again too. A loader
// written for one run — "append the badge", "add the dim class" — misbehaves on
// the second. These execute the real buildAccountStats against a small fake DOM
// and run it more than once.
//
//   - CLASSES: a state class a run adds (dim, warn) is removed by the next run
//     that no longer has that state.
//   - FRESH READ: the refresh asks the relays again; it does not get handed the
//     five-minute cache and call that refreshed.
//   - OVERLAP: two runs in flight at once leave one set of badges, not two.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const bare = src.replace(/^\s*\/\/.*$/gm, '');

function liftFn(decl) {
  const at = bare.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl + ' in sidepanel.js');
  const open = bare.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < bare.length; j++) {
    if (bare[j] === '{') depth++;
    else if (bare[j] === '}' && --depth === 0) return bare.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}
function lift(pattern, label) {
  const m = bare.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

const PK = 'a'.repeat(64);
const tick = () => new Promise((r) => setImmediate(r));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this._text = '';
    this._cls = new Set();
    this.dataset = {};
    this.style = {};
    this.attrs = {};
    this.disabled = false;
    this.connectedRoot = false;
  }
  get isConnected() { for (let n = this; n; n = n.parent) if (n.connectedRoot) return true; return false; }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const s = this._cls;
    return {
      add: (...c) => c.forEach((x) => s.add(x)),
      remove: (...c) => c.forEach((x) => s.delete(x)),
      contains: (c) => s.has(c),
      toggle: (c, force) => { const on = force === undefined ? !s.has(c) : !!force; if (on) s.add(c); else s.delete(c); return on; },
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; if (k === 'title') this.title = ''; }
  append(...kids) {
    kids.forEach((k) => {
      const node = typeof k === 'string' ? Object.assign(new FakeEl('#text'), { _text: k }) : k;
      node.parent = this;
      this.children.push(node);
    });
  }
  appendChild(k) { this.append(k); return k; }
  replaceChildren(...kids) { this.children = []; this._text = ''; this.append(...kids); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  click() { return Promise.all(((this.listeners.click) || []).map((f) => f({ target: this }))); }
  set innerHTML(_) { this.children = []; this._text = ''; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const cls = sel.replace(/^\./, '');
    const out = [];
    const walk = (n) => n.children.forEach((c) => { if (c._cls && c._cls.has(cls)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
}
const one = (root, cls) => root.querySelector('.' + cls);

// buildAccountStats, run for real. `s` is the scripted world: every read the
// drawer makes is a function of it, and can be changed between runs.
function drawerHarness(over = {}) {
  const s = {
    unseen: 0,
    nip65: { read: ['wss://r1'], write: [] },
    only: false,
    bootstrap: ['wss://b1', 'wss://b2'],
    profile: { content: {} },
    nwc: { has: false },
    backup: async () => ({ state: 'current' }),
    followRead: async () => ({ answered: true, events: [] }),
    ...over,
  };
  const asked = [];
  const root = new FakeEl('div');
  root.connectedRoot = true;
  const doc = { createElement: (t) => new FakeEl(t), createTextNode: (x) => Object.assign(new FakeEl('#text'), { _text: String(x) }), querySelector: () => null };
  const h = (tag, props, children) => {
    const el = new FakeEl(tag);
    if (props) Object.assign(el, props);
    (children || []).forEach((c) => el.append(c));
    return el;
  };
  const registryChunk = lift(/const followCountRepainters = new Set\(\);[\s\S]*?function repaintFollowCounts\(\) \{[\s\S]*?\n  \}/, 'the repaint registry');
  const deps = {
    t: (x, v) => (v ? x.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k]) : x),
    I18N: { fmtNum: (n) => String(n) },
    h,
    icon: (name) => Object.assign(new FakeEl('svg'), { iconName: name }),
    document: doc,
    followCountCache: new Map(),
    FOLLOW_COUNT_TTL: 5 * 60 * 1000,
    seedBaseline: () => {},
    poolQueryAnswered: async (...a) => { asked.push('follows'); return s.followRead(...a); },
    readRelayUrls: async () => ['wss://x'],
    accountStatsOpen: () => true,
    notifUnseenCount: () => s.unseen,
    getNip65: async () => s.nip65,
    nip65OnlyFor: async () => s.only,
    relayUrls: async () => s.bootstrap,
    getProfile: async () => (s.profileFn ? s.profileFn() : s.profile),
    verifyNip05: async () => ({ ok: true, status: 'verified' }),
    paintNip05Badge: () => {},
    paintNip05Favicon: () => {},
    call: async () => s.nwc,
    nwcBackupState: () => s.backup(),
    NWC_BACKUP_LABEL: { unknown: 'Couldn’t check' },
    openExtensionPage: () => {},
    accountStatsSync: null,
    overviewOnline: null,
    statsCollapsedForPlayer: false,
    accountStatsExpanded: null,
    PK,
  };
  const names = Object.keys(deps);
  const body = [
    'const _reg = (() => {',
    registryChunk,
    'return { registerFollowRepainter, repaintFollowCounts, followCountRepainters };',
    '})();',
    'const { registerFollowRepainter, repaintFollowCounts } = _reg;',
    lift(/function setWaiting\(el, text, waiting\) \{[\s\S]*?\n  \}/, 'setWaiting'),
    liftFn('async function getFollowCount('),
    liftFn('function buildAccountStats('),
    'return { drawer: buildAccountStats(PK), repaintFollowCounts };',
  ].join('\n');
  // eslint-disable-next-line no-new-func
  const out = new Function(...names, body)(...names.map((n) => deps[n]));
  root.append(out.drawer);
  return { drawer: out.drawer, s, asked, cache: deps.followCountCache, root, one: (c) => one(out.drawer, c), repaint: out.repaintFollowCounts };
}

const refreshBtn = (d) => one(d.drawer, 'account-stats-refresh');

test('HARNESS: the drawer builds and loads its three numbers', async () => {
  const d = drawerHarness();
  await settle();
  const nums = d.drawer.querySelectorAll('account-stat-num');
  assert.equal(nums.length, 3, 'following, alerts, relays are painted');
});
test('THE REFRESH REACHES THE RELAYS, NOT THE FIVE-MINUTE CACHE', async () => {
  const d = drawerHarness({
    followRead: async () => ({ answered: true, events: [{ pubkey: PK, created_at: 1, tags: [['p', 'b'.repeat(64)]] }] }),
  });
  await settle();
  assert.deepEqual(d.asked, ['follows'], 'the first open reads once');
  // Another client restores a longer list; the cache can't know.
  d.s.followRead = async () => ({
    answered: true,
    events: [{ pubkey: PK, created_at: 2, tags: [['p', 'b'.repeat(64)], ['p', 'c'.repeat(64)], ['p', 'd'.repeat(64)]] }],
  });
  await refreshBtn(d).click();
  await settle();
  assert.deepEqual(d.asked, ['follows', 'follows'], 'pressing refresh asks the relays again');
  const num = d.drawer.querySelectorAll('account-stat-num')[0];
  assert.equal(num.textContent, '3', 'and the figure moves to what they said');
});

test('ALERTS: a dimmed zero does not stay dim once there is something unseen', async () => {
  const d = drawerHarness();
  await settle();
  const notif = d.drawer.querySelectorAll('account-stat-num')[1];
  assert.ok(notif.classList.contains('account-stat-dim'), 'zero unseen reads dim');
  d.s.unseen = 4;
  await refreshBtn(d).click();
  await settle();
  assert.equal(notif.textContent, '4');
  assert.ok(!notif.classList.contains('account-stat-dim'), 'four unseen must not be dimmed');
});

test('RELAYS: a flagged or dimmed count is cleared when the next read has neither', async () => {
  // First run: nothing declared and bootstrap relays off → the 0 is flagged.
  const d = drawerHarness({ nip65: null, only: true });
  await settle();
  const relays = () => d.drawer.querySelectorAll('account-stat-num')[2];
  assert.ok(relays().classList.contains('account-stat-warn'), 'the first run flags the fault');
  // The user publishes a relay list; the refresh reads a healthy account.
  d.s.nip65 = { read: ['wss://r1', 'wss://r2'], write: ['wss://r1'] };
  d.s.only = false;
  await refreshBtn(d).click();
  await settle();
  assert.equal(relays().textContent, '2');
  assert.ok(!relays().classList.contains('account-stat-warn'), 'a healthy count must not keep the warning color');
  assert.ok(!relays().classList.contains('account-stat-dim'));
});

test('RELAYS: the tooltip of a past state does not outlive it', async () => {
  const d = drawerHarness({ nip65: null, only: false });
  await settle();
  assert.ok(d.one('account-stat-block-label'), 'sanity');
  const block = d.drawer.querySelectorAll('account-stat-block')[2];
  assert.match(block.title, /bootstrap relays/i, 'the bootstrap run explains itself');
  d.s.nip65 = { read: ['wss://r1'], write: [] };
  await refreshBtn(d).click();
  await settle();
  assert.ok(!block.title, 'a declared list must not keep the bootstrap explanation');
});

test('WALLET: two runs in flight leave one set of badges', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const d = drawerHarness({ nwc: { has: true }, backup: async () => { await gate; return { state: 'current' }; } });
  await settle();
  // The first run is parked on its backup read; a second begins and parks too.
  await refreshBtn(d).click();
  await settle();
  release();
  await settle();
  const wallet = d.drawer.querySelectorAll('wallet-status')[0];
  const badges = wallet.querySelectorAll('wallet-badge');
  assert.equal(badges.length, 2, 'Connected + Backed up, once each: ' + wallet.textContent);
});

test('WALLET: refreshing a settled drawer repaints the cell, never appends', async () => {
  const d = drawerHarness({ nwc: { has: true } });
  await settle();
  await refreshBtn(d).click();
  await settle();
  await refreshBtn(d).click();
  await settle();
  const wallet = d.drawer.querySelectorAll('wallet-status')[0];
  assert.equal(wallet.querySelectorAll('wallet-badge').length, 2, wallet.textContent);
});

test('THE SPINNER CLEARS EVEN WHEN THE RE-RUN THROWS', async () => {
  const d = drawerHarness();
  await settle();
  d.s.followRead = async () => { throw new Error('boom'); };
  d.cache.clear();
  await refreshBtn(d).click();
  await settle();
  assert.ok(!refreshBtn(d).classList.contains('spinning'), 'the spinner is gone');
});

test('TWO PRESSES RACING RUN ONE RE-READ', async () => {
  const d = drawerHarness();
  await settle();
  const before = d.asked.length;
  const a = refreshBtn(d).click();
  const b = refreshBtn(d).click();
  await Promise.all([a, b]);
  await settle();
  assert.equal(d.asked.length - before, 1, 'the second press while the first is in flight is ignored');
});

test('IDENTITY: a slow read from an earlier run does not overwrite a newer one', async () => {
  const d = drawerHarness();
  await settle();
  let release;
  const gate = new Promise((r) => { release = r; });
  let n = 0;
  d.s.profileFn = () => (++n === 1
    ? gate.then(() => ({ content: { lud16: 'stale@example.org' } }))
    : Promise.resolve({ content: { lud16: 'fresh@example.org' } }));
  await refreshBtn(d).click(); // run 1: its profile read is parked
  await refreshBtn(d).click(); // run 2: answers at once
  await settle();
  release();
  await settle();
  const lud = d.drawer.querySelectorAll('account-stat-id-val')[1];
  assert.equal(lud.textContent, 'fresh@example.org', 'the late answer from the older run is discarded');
});
