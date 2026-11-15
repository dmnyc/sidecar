'use strict';

// The on-chain card's review and its two-tap confirm, run for real: the card is
// lifted out of sidepanel.js into a vm with a small DOM, a scriptable explorer
// (each fee lookup resolves when the test says so, in whatever order) and a
// worker that signs with signSweepTx. The property under test is the one an
// irreversible button owes its user: what it signs is what the review shows,
// and what the review shows is what the field holds — however the network
// interleaves the lookups behind them.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../bitcoin.js').SidecarBitcoin;
const { withI18n } = require('./helpers/i18n.js');

const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const G = { x: 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n, y: 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n };
const SK = B.bigIntToBytes(6n, 32);
const PUB = B.bytesToHex(B.bigIntToBytes(B.scalarMult(6n, G).x, 32));
const X = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const Y = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';
const RATES = { fastestFee: 9, halfHourFee: 5, hourFee: 2, economyFee: 1, minimumFee: 1 };

// ---- a DOM just big enough for the card --------------------------------------------

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    this._text = '';
    this.listeners = {};
    this.dataset = {};
    this.disabled = false;
    this.value = '';
    this.classList = new Set();
    this.classList.contains = this.classList.has;
    this.classList.remove = this.classList.delete;
    this.classList.toggle = (c, on) => ((on === undefined ? !this.classList.has(c) : on) ? this.classList.add(c) : this.classList.delete(c));
  }
  set className(v) { this.classList.clear(); for (const c of String(v).split(/\s+/)) if (c) this.classList.add(c); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { for (const c of this.children) c.parent = null; this.children = []; this._text = String(v); }
  append(...nodes) { for (const n of nodes) { n.remove(); n.parent = this; this.children.push(n); } }
  prepend(...nodes) { for (const n of nodes.reverse()) { n.remove(); n.parent = this; this.children.unshift(n); } }
  appendChild(n) { this.append(n); return n; }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  dispatchEvent(ev) { for (const fn of this.listeners[ev.type] || []) fn(ev); return true; }
  click() { if (!this.disabled) this.dispatchEvent({ type: 'click', preventDefault() {} }); }
  querySelectorAll(sel) {
    const hits = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (sel.startsWith('.') ? c.classList.has(sel.slice(1)) : c.tagName === sel.toUpperCase()) hits.push(c);
        walk(c);
      }
    };
    walk(this);
    return hits;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  // Visible = attached under the root and no ancestor (or itself) hidden.
  shownUnder(root) {
    for (let n = this; n; n = n.parent) {
      if (n.classList.has('hidden')) return false;
      if (n === root) return true;
    }
    return false;
  }
}
function h(tag, props, children) {
  const el = new El(tag);
  for (const [k, v] of Object.entries(props || {})) el[k] = v;
  for (const c of children || []) el.append(c);
  return el;
}

function lift(pattern, label) {
  const m = panel.match(pattern);
  assert.ok(m, 'could not find ' + label + ' in sidepanel.js');
  return m[0];
}

// ---- the card, mounted -------------------------------------------------------------------

function mount() {
  const feeLookups = [];
  const signRequests = [];
  const broadcasts = [];
  const tweaked = { list: null };
  const ctx = withI18n({
    Promise, Error, Object, Array, String, Number, BigInt, JSON, Uint8Array, RegExp, Math,
    state: { activePubkey: PUB },
    window: { SidecarBitcoin: B },
    document: { createTextNode: (s) => { const n = new El('#text'); n._text = String(s); return n; } },
    Event: function Event(type) { this.type = type; },
    h,
    icon: (name) => h('svg', { className: 'icon-' + name }),
    copyPlain: async () => {},
    denomParts: (n) => ({ text: String(n), unit: 'sats' }),
    chrome: { tabs: { create() {} } },
    // The card's own timers (the four-second disarm, the scan poll) never fire here.
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    async btcFetch(p, opts) {
      if (p === '/v1/fees/recommended') {
        let resolve;
        const ready = new Promise((r) => { resolve = r; });
        feeLookups.push({ resolve: () => resolve() });
        await ready;
        return { json: async () => RATES };
      }
      if (p === '/tx') {
        broadcasts.push(opts.body);
        return { text: async () => 'ab'.repeat(32) };
      }
      const m = p.match(/^\/address\/([^/]+)\/utxo$/);
      if (m) {
        const addrs = await B.deriveAddresses(PUB);
        const list = decodeURIComponent(m[1]) === addrs.tweaked
          ? [{ txid: '12'.repeat(31) + '34', vout: 1, value: 100000, status: { confirmed: true } }]
          : [];
        tweaked.list = list;
        return { json: async () => list };
      }
      throw new Error('unexpected fetch ' + p);
    },
    async call(message) {
      if (message.type === 'SIDECAR_BTC_SIGN_INPUTS') {
        const wire = JSON.parse(JSON.stringify(message));
        signRequests.push(wire);
        return { sigs: await B.signSweepTx(SK, PUB, wire.sweep) };
      }
      throw new Error('unexpected call ' + message.type);
    },
  });
  vm.createContext(ctx);
  vm.runInContext([
    lift(/\n {2}async function btcConfirmedUtxos\([\s\S]*?\n {2}\}\n/, 'btcConfirmedUtxos'),
    lift(/\n {2}function btcSatsText\([\s\S]*?\n {2}\}\n/, 'btcSatsText'),
    lift(/\n {2}function appendBtcSweepCard\(view\) \{[\s\S]*?\n {2}\}\n/, 'appendBtcSweepCard'),
    'this.appendBtcSweepCard = appendBtcSweepCard;',
  ].join('\n'), ctx);
  const view = h('div');
  ctx.appendBtcSweepCard(view);
  const dest = view.querySelector('.btc-sweep-dest');
  const review = view.querySelector('.btc-sweep-review');
  const reviewMsg = view.querySelector('.confirm-msg');
  const go = review.querySelector('.primary');
  const chips = view.querySelectorAll('.btc-sweep-fee-chip');
  return {
    view, dest, review, reviewMsg, go, chips, feeLookups, signRequests, broadcasts, tweaked,
    type(text) { dest.value = text; dest.dispatchEvent({ type: 'input' }); },
    reviewShown: () => review.shownUnder(view),
  };
}

async function until(cond, label) {
  for (let i = 0; i < 400; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('timed out waiting for ' + label);
}
const settle = () => new Promise((r) => setTimeout(r, 30));

// ---- the property --------------------------------------------------------------------------

test('a review still waiting on the network never replaces a newer one', async () => {
  const c = mount();
  await until(() => c.tweaked.list, 'the balance lookup');
  await settle();
  c.type(X); // its review waits on the first fee lookup …
  c.type(Y); // … and this one on the second
  await until(() => c.feeLookups.length === 2, 'two fee lookups');
  c.feeLookups[1].resolve(); // the newer answer lands first
  await settle();
  c.feeLookups[0].resolve(); // and the older one after it
  await settle();
  assert.equal(c.dest.value, Y);
  const review = c.reviewMsg.textContent;
  c.go.click();
  c.go.click();
  await until(() => c.signRequests.length === 1, 'the signing request');
  assert.equal(c.signRequests[0].sweep.outputs[0].scriptHex, B.bytesToHex(B.destScriptFor(Y)), 'what is signed pays the field’s address');
  assert.match(review, new RegExp(Y), 'the review named what the field holds');
});

test('a cleared field leaves nothing to confirm, even when an older review lands late', async () => {
  const c = mount();
  await until(() => c.tweaked.list, 'the balance lookup');
  await settle();
  c.type(X);
  await until(() => c.feeLookups.length === 1, 'the fee lookup');
  c.type('');
  c.feeLookups[0].resolve();
  await settle();
  assert.equal(c.reviewShown(), false, 'no review over an empty field');
  c.go.click();
  c.go.click();
  await settle();
  assert.equal(c.signRequests.length, 0, 'nothing was signed');
});

test('once a sweep goes out, the card holds still and keeps its receipt', async () => {
  const c = mount();
  await until(() => c.tweaked.list, 'the balance lookup');
  await settle();
  c.type(X);
  await until(() => c.feeLookups.length === 1, 'the fee lookup');
  c.feeLookups[0].resolve();
  await settle();
  c.go.click();
  c.go.click();
  await until(() => c.broadcasts.length === 1, 'the broadcast');
  await settle();
  assert.match(c.reviewMsg.textContent, /^Swept /);
  // A fee chip tapped after the fact must not tear the receipt down for a new
  // review of coins that are already spent.
  c.chips[0].click();
  await settle();
  assert.ok(c.reviewShown(), 'the receipt stays up');
  assert.match(c.reviewMsg.textContent, /^Swept /);
  assert.equal(c.signRequests.length, 1);
});
