'use strict';

// The quote block's label row now carries the quoted event's kind — "KIND 1"
// beside QUOTING, the way the reply view shows KIND beside REPLYING TO (Daniel:
// "I'd like this feature to be included in the new quoted note view"). The kind
// paints when the quoted note lands, stays empty when the lookup fails, and
// pairs with the action icons at the row's end.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('./helpers/i18n.js');

const core = fs.readFileSync(path.join(__dirname, '..', 'composer-core.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

function lift(pattern, label) {
  const m = core.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in composer-core.js');
  return m[0];
}

// A DOM stub good enough for buildQuoteBlock: classList toggles, appends,
// text/properties, and a parent walk for assertions.
class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.textContent = '';
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this._cls = new Set();
    this.classList = {
      add: (c) => this._cls.add(c),
      remove: (c) => this._cls.delete(c),
      toggle: (c, v) => { (v === undefined ? !this._cls.has(c) : v) ? this._cls.add(c) : this._cls.delete(c); },
      contains: (c) => this._cls.has(c),
    };
  }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._cls].join(' '); }
  set innerHTML(v) { this.children = []; this._html = v; }
  appendChild(n) { return this.append(n); }
  append(...nodes) { for (const n of nodes) { if (n) this.children.push(n); } return this; }
  remove() {}
  addEventListener() {}
  setAttribute() {}
  find(cls, out = []) {
    if (this._cls.has(cls)) out.push(this);
    for (const c of this.children) if (c && c.find) c.find(cls, out);
    return out;
  }
}

function findCls(node, cls) { return node.find(cls)[0] || null; }

function quoteWorld({ cachedEvent = null, lookedUp = undefined } = {}) {
  const world = { icons: [] };
  const ctx = withI18n({
    document: { createElement: (tag) => new Node(tag) },
    requestAnimationFrame: (fn) => fn(),
    renderNoteText: (body, full, cap) => { body.textContent = full.slice(0, cap === Infinity ? undefined : cap); },
    makeMediaExpandable: () => {},
    blockIconBtn: (name, title) => { const b = new Node('button'); b.title = title; world.icons.push({ name, b }); return b; },
    copyWithCheck: () => {},
    quoteOpen: new Set(),
    peekEvent: () => cachedEvent,
    lookUpQuoted: () => Promise.resolve(lookedUp),
    quotedRef: (ref) => ref,
    deps: {
      applyAvatar: () => {},
      shortNpub: () => 'npub1stub',
      NT: { nip19: { npubEncode: () => 'nevent1stub' } },
      fetchPreviewProfile: async () => null,
    },
  });
  const src = lift(/const QUOTE_BLOCK_CAP = \d+;/, 'QUOTE_BLOCK_CAP') + '\n' +
    lift(/function h\(tag, props, children\) \{[\s\S]*?\n  \}/, 'h') + '\n' +
    lift(/function buildQuoteBlock\(ref, ctl\) \{[\s\S]*?\n  \}/, 'buildQuoteBlock') + '\n' +
    'globalThis.buildQuoteBlock = buildQuoteBlock;';
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  world.ctx = ctx;
  return world;
}

const author = 'a'.repeat(64);
const kind1 = { id: 'b'.repeat(64), pubkey: author, kind: 1, tags: [], content: 'Ah! Books.' };
const longform = { id: 'c'.repeat(64), pubkey: author, kind: 30023, tags: [['title', 'On ducks']], content: 'long' };

test('the label row names the kind it quotes', () => {
  const w = quoteWorld({ cachedEvent: kind1 });
  const block = w.ctx.buildQuoteBlock('nostr:nevent1stub');
  const kindEl = findCls(block, 'quote-block-kind');
  assert.ok(kindEl, 'the kind span exists in the block');
  assert.equal(kindEl.textContent, 'kind 1');
  const row = findCls(block, 'reply-target-label');
  const kids = row.children.filter(Boolean).map((c) => c.className || c.textContent);
  assert.ok(kids.indexOf('reply-target-kind quote-block-kind') < kids.indexOf('quote-block-actions'),
    'the kind sits before the action icons');
});

test('a long-form quote shows its own kind, not the reply kind', () => {
  const w = quoteWorld({ cachedEvent: longform });
  const block = w.ctx.buildQuoteBlock('nostr:nevent1stub');
  assert.equal(findCls(block, 'quote-block-kind').textContent, 'kind 30023');
});

test('a failed lookup leaves the kind empty, like the name', async () => {
  const w = quoteWorld({ cachedEvent: null, lookedUp: null });
  const block = w.ctx.buildQuoteBlock('nostr:nevent1stub');
  assert.equal(findCls(block, 'quote-block-kind').textContent, '');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(findCls(block, 'reply-target-name').textContent, 'Quoted note');
  assert.equal(findCls(block, 'quote-block-kind').textContent, '');
});

test('the kind pairs with the icons at the row end, in css', () => {
  assert.match(css, /\.quote-block \.reply-target-kind \{ margin-inline-start: auto; \}/);
});
