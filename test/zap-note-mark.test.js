'use strict';

// The note mark on a zap in the wallet list, EXECUTED rather than read: txRow is lifted
// out of sidepanel.js and run against a small fake DOM, with the zap parsing, the label
// and the details rows all real.
//
// A zap's row reads "Zap from cecilia" whatever the zapper wrote, and the note lived only
// in the details pane, which starts closed. The mark beside the name says there is one,
// and its tooltip reads it. The quiet way to break it is the profile upgrade: the name is
// rewritten when the zapper's profile lands, and rewriting the whole label would drop the
// mark, which is why the name has its own span.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'), { filename: 'nostr-tools.js' });
const NT = globalThis.NostrTools;

// Brace matching that steps over strings and comments: parseZapRequest compares against
// the string '{', which a plain counter reads as an opening brace.
function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl + ' in sidepanel.js');
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i++) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (c === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < source.length && source[i] !== c; i++) if (source[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// Enough DOM for h(), classes, attributes, text and a click.
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.attrs = {};
    this._text = '';
    this._cls = new Set();
  }
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
  append(...kids) { kids.forEach((k) => this.children.push(typeof k === 'string' ? { textContent: k, children: [] } : k)); }
  appendChild(k) { this.append(k); return k; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  click() { (this.listeners.click || []).forEach((f) => f({ stopPropagation() {} })); }
  set innerHTML(_) { this.children = []; this._text = ''; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  find(cls) {
    const out = [];
    const walk = (n) => (n.children || []).forEach((c) => { if (c._cls && c._cls.has(cls)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
}

function harness(profile) {
  const ctx = {
    console, Promise, JSON, Math, String, Array, Object, Date, setTimeout,
    NT,
    document: { createElement: (t) => new FakeEl(t) },
    h: (tag, props, children) => {
      const el = new FakeEl(tag);
      if (props) Object.assign(el, props);
      (children || []).forEach((c) => el.append(c));
      return el;
    },
    icon: (name) => Object.assign(new FakeEl('svg'), { iconName: name }),
    msatToSat: (m) => Math.floor((m || 0) / 1000),
    fmtSats: (n) => String(n),
    satsLabel: (n) => n + ' sats',
    fmtFeeMsat: () => '0 sats',
    truncMid: (s) => s,
    relTime: () => '3d ago',
    cachedProfile: () => null,
    getProfile: async () => profile || null,
    showZapFace: () => {},
    copyPlain: async () => {},
  };
  vm.createContext(ctx);
  vm.runInContext([
    lift('function parseZapRequest('),
    lift('function zapFromTx('),
    lift('function normalizeDescription('),
    lift('function zapLabel('),
    lift('function txDetailRow('),
    lift('function txRow('),
  ].join('\n\n'), ctx);
  return ctx;
}

const ZAPPER = NT.getPublicKey(NT.generateSecretKey());
const ME = NT.getPublicKey(NT.generateSecretKey());
const zapRequest = (content) => JSON.stringify({
  kind: 9734, pubkey: ZAPPER, created_at: 1790000000, content,
  tags: [['p', ME], ['amount', '21000'], ['relays', 'wss://relay.example']],
});
const received = (content) => ({
  type: 'incoming', amount: 21000, settled_at: 1790000000,
  payment_hash: 'ab'.repeat(32), description: zapRequest(content),
});
const labelOf = (row) => row.find('item-label')[0];
const tick = () => new Promise((r) => setTimeout(r, 0));

test('A ZAP THAT CAME WITH A NOTE CARRIES A MARK, AND THE MARK CARRIES THE NOTE', () => {
  const row = harness().txRow(received('🦞👁️🦞'), {});
  const label = labelOf(row);
  assert.ok(label.classList.contains('has-note'));
  const [mark] = label.find('tx-note');
  assert.ok(mark, 'no mark beside the name');
  assert.equal(mark.title, '🦞👁️🦞', 'the tooltip is the note itself');
  assert.equal(mark.attrs['aria-label'], 'Note: 🦞👁️🦞');
  assert.equal(mark.attrs.role, 'img');
  assert.equal(mark.children[0].iconName, 'message-filled');
  assert.match(label.find('tx-name')[0].textContent, /^Zap from npub1/, 'the name shows first, as the short key');
});

test('THE MARK SURVIVES THE PROFILE UPGRADE', async () => {
  // The name is rewritten when the zapper's profile lands. Rewriting the label's whole
  // text, as it used to, would have taken the mark with it.
  const row = harness({ name: 'cecilia' }).txRow(received('gm'), {});
  await tick();
  const label = labelOf(row);
  assert.equal(label.find('tx-name')[0].textContent, 'Zap from cecilia');
  assert.equal(label.find('tx-note').length, 1, 'the mark is still beside the name');
});

test('NO NOTE, NO MARK', () => {
  for (const content of ['', '   ']) {
    const label = labelOf(harness().txRow(received(content), {}));
    assert.ok(!label.classList.contains('has-note'));
    assert.equal(label.find('tx-note').length, 0, JSON.stringify(content) + ' is not a note');
  }
});

test('A ZAP YOU SENT SHOWS THE COMMENT SIDECAR RECORDED', () => {
  const invoice = 'lnbc210n1test';
  const tx = { type: 'outgoing', amount: 21000, settled_at: 1790000000, invoice, description: '' };
  const meta = { [invoice]: { zapPubkey: ZAPPER, comment: 'thanks for the recipe' } };
  const [mark] = labelOf(harness().txRow(tx, meta)).find('tx-note');
  assert.ok(mark);
  assert.equal(mark.title, 'thanks for the recipe');
});

test('THE MARK AND THE DETAILS PANE AGREE ON THE NOTE', () => {
  const row = harness().txRow(received('see you at the meetup'), {});
  row.find('tx-head')[0].click();
  const noteRow = row.find('tx-d-row').find((r) => r.children[0].textContent === 'Note');
  assert.ok(noteRow, 'the details pane lost its Note row');
  assert.equal(noteRow.children[1].textContent, labelOf(row).find('tx-note')[0].title);
});

test('A PLAIN PAYMENT GETS NO MARK: ITS MEMO IS ALREADY THE LABEL', () => {
  const tx = { type: 'incoming', amount: 5000, settled_at: 1790000000, payment_hash: 'cd'.repeat(32), description: 'coffee' };
  const label = labelOf(harness().txRow(tx, {}));
  assert.equal(label.textContent, 'coffee');
  assert.equal(label.find('tx-note').length, 0);
});
