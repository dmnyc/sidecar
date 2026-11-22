'use strict';

// A list left open kept saying "just now" about a zap from an hour ago, and the next
// arrival said it too: txRow paints the relative label once, when the row is built, and
// nothing ever re-renders a row that already exists. The fix stamps each label with its
// timestamp (dataset.ts) and has loadTransactions re-stamp what is on screen on a slow
// tick — re-render only, never a re-fetch.
//
// Run, not read: loadTransactions, txRow and the real relTime (composer-core's) execute
// here over a minimal fake DOM, against a clock the test moves forward. On the old code
// the run fails — no interval is installed and no row carries a stamp, so an hour-old
// zap stays "just now" forever.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');

function liftFn(source, header, label) {
  const start = source.indexOf(header);
  if (start === -1) throw new Error(label + ' not found');
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(label + ' braces never balanced');
}

const loadTransactionsSrc = liftFn(panel, '  async function loadTransactions(listEl, client) {', 'loadTransactions');
const txRowSrc = liftFn(panel, '  function txRow(tx, metaMap) {', 'txRow');
const relTimeSrc = liftFn(core, '  function relTime(ts) {', 'relTime');

// ---- a minimal fake DOM: just the shapes this list uses (.class, .class[data-attr]) --

function matches(sel) {
  const attr = (sel.match(/\[([^\]=]+)\]/) || [])[1] || null;
  const camel = attr && attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const classes = sel.replace(/\[[^\]]*\]/g, '').split('.').filter(Boolean);
  return (el) => el.classList
    && classes.every((c) => el.classList.contains(c))
    && (!attr || el.dataset[camel] !== undefined);
}

class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.className = '';
    this.dataset = {};
    this.children = [];
    this.parentNode = null;
    this._listeners = {};
  }
  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c) => list().includes(c),
      add: (c) => { if (!list().includes(c)) el.className = (el.className + ' ' + c).trim(); },
      remove: (c) => { el.className = list().filter((x) => x !== c).join(' '); },
      toggle: (c, force) => {
        const has = list().includes(c);
        const want = force === undefined ? !has : !!force;
        if (want && !has) el.classList.add(c);
        else if (!want && has) el.classList.remove(c);
        return want;
      },
    };
  }
  get innerHTML() { return ''; }
  set innerHTML(_) {
    this.children.slice().forEach((c) => { c.parentNode = null; });
    this.children.length = 0;
  }
  append(...ns) { ns.forEach((n) => { n.parentNode = this; this.children.push(n); }); }
  prepend(...ns) { ns.reverse().forEach((n) => { n.parentNode = this; this.children.unshift(n); }); }
  remove() {
    const p = this.parentNode;
    if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); }
    this.parentNode = null;
  }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  querySelectorAll(sel) {
    const pred = matches(sel);
    const out = [];
    const walk = (el) => el.children.forEach((c) => { if (pred(c)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

// ---- the clock the test controls; relTime reads Date.now() --------------------------

const RealDate = Date;
const clock = { ms: 1731504000000 };
class FakeDate {
  static now() { return clock.ms; }
  constructor(...args) { return new RealDate(...(args.length ? args : [clock.ms])); }
}

const BASE = clock.ms;
const flush = () => new Promise((r) => setImmediate(r));

// 5s and 65s settled, and one still pending — "just now", "-1 minute", "pending".
const TXNS = [
  { type: 'incoming', amount: 21000, settled_at: Math.floor((BASE - 5000) / 1000), payment_hash: 'aa'.repeat(32) },
  { type: 'incoming', amount: 1000, settled_at: Math.floor((BASE - 65000) / 1000), payment_hash: 'bb'.repeat(32) },
  { type: 'outgoing', amount: 5000, payment_hash: 'cc'.repeat(32) },
];

function harness(txns) {
  const ticks = [], cleared = [], listCalls = [];
  const document = { createElement: (tag) => new FakeEl(tag) };
  const h = (tag, props, children) => {
    const el = document.createElement(tag);
    if (props) Object.assign(el, props);
    (children || []).forEach((c) => { if (c != null && c !== false) el.append(c); });
    return el;
  };
  const ctx = {
    document,
    h,
    t: (s) => s,
    I18N: { fmtRelative: (v, unit) => v + ' ' + unit, fmtDate: () => 'a date' },
    Date: FakeDate,
    setInterval: (fn, ms) => { ticks.push({ fn, ms }); return ticks.length; },
    clearInterval: (id) => cleared.push(id),
    getPayMeta: async () => ({}),
    listState: (el, msg) => { el.innerHTML = ''; const s = new FakeEl('div'); s.className = 'list-state'; s.textContent = msg; el.append(s); },
    hide: () => {}, show: () => {},
    icon: (name) => { const el = new FakeEl('span'); el.dataset.icon = name; return el; },
    applyAvatar: () => {}, cachedProfile: () => null, getProfile: () => Promise.resolve(null),
    zapFromTx: () => null, normalizeDescription: () => '', zapLabel: () => 'Zap from x',
    msatToSat: (m) => m / 1000, fmtSats: String,
    truncMid: (s, a, b) => String(s).slice(0, a) + '…' + String(s).slice(-b),
    satsLabel: (n) => n + ' sats', fmtFeeMsat: () => '0 sats',
    txDetailRow: () => new FakeEl('div'), zapNoteRow: () => new FakeEl('div'),
  };
  const client = {
    listTransactions: async (args) => {
      listCalls.push(args);
      return { transactions: args.offset === 0 ? txns : [] };
    },
  };
  const host = new FakeEl('div');
  const listEl = new FakeEl('div');
  host.append(listEl);
  vm.createContext(ctx);
  vm.runInContext(
    'let _refreshTxList = null;\nlet _txTimeTick = null;\n'
    + loadTransactionsSrc + '\n' + txRowSrc + '\n' + relTimeSrc + '\n'
    + 'this.runLoad = loadTransactions;\nthis.getTick = () => _txTimeTick;\nthis.refresh = () => _refreshTxList();',
    ctx
  );
  return { ctx, client, listEl, ticks, cleared, listCalls };
}

test('the labels re-stamp while the list sits open', async () => {
  const { ctx, client, listEl, ticks, listCalls } = harness(TXNS);
  ctx.runLoad(listEl, client);
  await flush();
  const subs = listEl.querySelectorAll('.item-sub');
  assert.equal(subs.length, 3);
  assert.equal(subs[0].textContent, 'just now');
  assert.equal(subs[1].textContent, '-1 minute');
  assert.equal(subs[2].textContent, 'pending');
  assert.notEqual(subs[0].dataset.ts, undefined, 'each settled row carries its timestamp');
  assert.equal(subs[2].dataset.ts, undefined, 'a pending row has no stamp to re-render from');

  // An hour passes on an open panel. The tick re-renders in place; nothing re-fetches.
  clock.ms += 61000;
  assert.equal(ticks.length, 1, 'the list installs one re-stamp interval');
  assert.equal(ticks[0].ms, 30000);
  ticks[0].fn();
  assert.equal(subs[0].textContent, '-1 minute', 'the minute-old row no longer says just now');
  assert.equal(subs[1].textContent, '-2 minute');
  assert.equal(subs[2].textContent, 'pending', 'a pending row is untouched');
  assert.equal(listCalls.length, 1, 'the tick never re-fetches');
});

test('renderWallet tears the tick down with the view', () => {
  const start = panel.indexOf('async function renderWallet()');
  assert.notEqual(start, -1);
  const body = panel.slice(start, panel.indexOf('function walletLoadFailed', start));
  const clear = body.indexOf('clearInterval(_txTimeTick)');
  assert.notEqual(clear, -1, 'renderWallet clears the interval');
  const noAccount = body.indexOf('No active account.');
  assert.notEqual(noAccount, -1);
  assert.ok(clear < noAccount, 'cleared before the no-account early return, which skips the later reset');
});

// A PAYMENT TO YOUR OWN WALLET LISTED SENT ABOVE RECEIVED. The rows came in the wallet's
// order, newest-created first, and a received payment is created when its invoice is made,
// a moment before the send that pays it, so the pair read upside down under the same "just
// now". Rows are ordered by when they settled, newest first; for one payment seen from both
// sides, Received above Sent, since the receive is what completes it. The same order holds
// for rows that arrive while the list is open.
const dirOf = (listEl) => listEl.querySelectorAll('.tx-row').map((r) => r.dataset.ph.slice(0, 2) + ':' + (r.querySelector('.tx-icon').classList.contains('in') ? 'in' : 'out'));

test('a payment to your own wallet lists Received above Sent, and rows go by when they settled', async () => {
  const at = Math.floor(BASE / 1000);
  const self = 'dd'.repeat(32);
  const txns = [
    // the wallet's order: newest created first
    { type: 'outgoing', amount: 1000, created_at: at - 2, settled_at: at - 2, payment_hash: self },
    { type: 'incoming', amount: 2000, created_at: at - 30, settled_at: at - 30, payment_hash: 'ee'.repeat(32) },
    { type: 'incoming', amount: 1000, created_at: at - 40, settled_at: at - 2, payment_hash: self },
    { type: 'incoming', amount: 3000, created_at: at - 900, settled_at: at - 10, payment_hash: 'ff'.repeat(32) },
  ];
  const { ctx, client, listEl } = harness(txns);
  ctx.runLoad(listEl, client);
  await flush();
  assert.deepEqual(dirOf(listEl), ['dd:in', 'dd:out', 'ff:in', 'ee:in']);
});

test('rows that arrive while the list is open take their place by when they settled', async () => {
  const at = Math.floor(BASE / 1000);
  const first = [{ type: 'incoming', amount: 2000, created_at: at - 300, settled_at: at - 300, payment_hash: 'ee'.repeat(32) }];
  const later = [
    { type: 'outgoing', amount: 1000, created_at: at - 2, settled_at: at - 2, payment_hash: 'dd'.repeat(32) },
    { type: 'incoming', amount: 1000, created_at: at - 40, settled_at: at - 2, payment_hash: 'dd'.repeat(32) },
    ...first,
  ];
  const { ctx, client, listEl } = harness(first);
  ctx.runLoad(listEl, client);
  await flush();
  client.listTransactions = async () => ({ transactions: later });
  await ctx.refresh();
  assert.deepEqual(dirOf(listEl), ['dd:in', 'dd:out', 'ee:in']);
});

test('the Received half of a payment to your own wallet still appears when it arrives after the Sent half', async () => {
  const at = Math.floor(BASE / 1000);
  const sent = { type: 'outgoing', amount: 1000, created_at: at - 2, settled_at: at - 2, payment_hash: 'dd'.repeat(32) };
  const received = { type: 'incoming', amount: 1000, created_at: at - 40, settled_at: at - 2, payment_hash: 'dd'.repeat(32) };
  const older = { type: 'incoming', amount: 2000, created_at: at - 300, settled_at: at - 300, payment_hash: 'ee'.repeat(32) };
  const { ctx, client, listEl } = harness([older]);
  ctx.runLoad(listEl, client);
  await flush();
  client.listTransactions = async () => ({ transactions: [sent, older] });
  await ctx.refresh();
  client.listTransactions = async () => ({ transactions: [sent, received, older] });
  await ctx.refresh();
  assert.deepEqual(dirOf(listEl), ['dd:in', 'dd:out', 'ee:in']);
});
