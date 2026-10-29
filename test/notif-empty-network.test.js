'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('./helpers/i18n.js');

const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
// Execute the actual initial rendering, paging, and outside-network toggle together.
const start = panel.indexOf('      const panelQuote = pickQuote();');
const end = panel.indexOf('      // Back to where you were.', start);
assert.ok(start >= 0 && end > start);
const source = panel.slice(start, end);

function element(tag, props = {}, children = []) {
  const node = {
    tag, ...props, children: [], style: {}, listeners: {},
    // Strings become text nodes, as in the DOM: fill() hands back a sentence's words as strings.
    append(...items) { items.forEach((item) => this.appendChild(typeof item === 'string' ? { text: item } : item)); },
    appendChild(item) { this.children.push(item); item.parent = this; return item; },
    insertBefore(item, before) {
      const at = this.children.indexOf(before);
      assert.ok(at >= 0);
      this.children.splice(at, 0, item);
      item.parent = this;
    },
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
    // In a document while it hangs from something; loadMore checks it after waiting.
    get isConnected() { return !!this.parent; },
    addEventListener(name, fn) { this.listeners[name] = fn; },
  };
  const classes = new Set((props.className || '').split(' '));
  node.classList = {
    toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
    contains(name) { return classes.has(name); },
  };
  node.append(...children);
  return node;
}

// `cache` stands in for the account's notification cache: what Load more asks for older
// history through. Absent, there is nothing older to ask for.
function render(events, offNet, cache) {
  const list = element('div', { className: 'notif-list' });
  const scroll = element('div', {}, [list]);
  const ctx = {
    events, offNet, list, scroll, PAGE: 25,
    _notifCache: new Map(cache ? [['account', cache]] : []), _muteLists: new Map(),
    wotSet: null, isMutedNotif: () => false, zapSender: (e) => e.pubkey, self: {},
    h: element, icon: () => element('svg'), pickQuote: () => 'quote',
    emptyQuote: () => element('div', { className: 'empty' }),
    endQuote: () => element('p'),
    buildItem: (ev) => element('a', { eventId: ev.id }),
    document: { createTextNode: (textContent) => element('text', { textContent }), createElement: element },
    client: { label: 'Client', profile: () => 'https://example.com/profile' },
    NT: { nip19: { npubEncode: () => 'npub' } }, a: { pubkey: 'account' },
  };
  withI18n(ctx); // notification labels go through t() and tn()
  vm.runInNewContext(source, ctx);
  const find = (className) => scroll.children.find((n) => n.className === className);
  return { list, scroll, find };
}
const tick = () => new Promise((r) => setImmediate(r));

test('cached notifications remain reachable when every sender is outside the network', () => {
  const events = [{ id: 'reply' }, { id: 'reaction' }];
  const view = render([], events);
  assert.equal(view.find('empty'), undefined, 'existing notifications must not show the empty state');
  const group = view.find('notif-offnet');
  assert.ok(group, 'outside-network group is reachable without an in-network row');
  const [toggle, inner] = group.children;
  assert.equal(toggle.children[1].textContent, '2 from outside your network');
  assert.equal(inner.classList.contains('hidden'), true);
  toggle.listeners.click();
  assert.equal(inner.classList.contains('hidden'), false);
  assert.deepEqual(inner.children.slice(0, -1).map((row) => row.eventId), ['reply', 'reaction']);
  assert.ok(view.find('notif-end'));
});

test('a truly empty cache retains its empty state', () => {
  const view = render([], []);
  assert.ok(view.find('empty'));
  assert.equal(view.find('notif-offnet'), undefined);
  assert.equal(view.find('notif-end'), undefined);
});

test('mixed notifications keep the outside-network group after the last page', () => {
  const events = Array.from({ length: 26 }, (_, i) => ({ id: String(i) }));
  const view = render(events, [{ id: 'outside' }]);
  assert.equal(view.list.children.length, 25);
  assert.equal(view.find('notif-offnet'), undefined);
  view.find('notif-load-more').listeners.click();
  assert.equal(view.list.children.length, 26);
  assert.ok(view.find('notif-offnet'));
  assert.ok(view.find('notif-end'));
  assert.equal(view.find('notif-load-more'), undefined);
});

test('LOAD MORE ASKS THE RELAYS once the cached pages run out, and appends what they had', async () => {
  const mine = Array.from({ length: 30 }, (_, i) => ({ id: 'c' + i, created_at: 1000 - i }));
  const older = Array.from({ length: 5 }, (_, i) => ({ id: 'o' + i, created_at: 900 - i }));
  let asked = 0;
  const cache = {
    events: [...mine], covered: { since: 950, until: 2000 }, exhausted: false,
    loadOlder: async () => { asked++; cache.events.push(...older); cache.covered.since = 800; return older.length; },
  };
  const view = render(mine, [], cache);
  assert.equal(view.list.children.length, 25);
  view.find('notif-load-more').listeners.click(); // the cached page: no ask
  assert.equal(view.list.children.length, 30);
  assert.equal(asked, 0, 'asked the relays while a cached page was still in hand');
  const more = view.find('notif-load-more');
  assert.ok(more, 'the button went away while older history was still there to ask for');
  const pending = more.listeners.click();
  assert.equal(more.disabled, true, 'the button does not show it is working');
  await pending; await tick();
  assert.equal(asked, 1);
  assert.deepEqual(view.list.children.slice(30).map((r) => r.eventId), ['o0', 'o1', 'o2', 'o3', 'o4']);
  // The relays had nothing older: that is the end of the list.
  cache.loadOlder = async () => { asked++; cache.exhausted = true; return 0; };
  await view.find('notif-load-more').listeners.click(); await tick();
  assert.equal(view.find('notif-load-more'), undefined);
  assert.ok(view.find('notif-end'), 'the end note never came');
});

test('an older page skips what the sheet already drew', async () => {
  const mine = [{ id: 'a', created_at: 100 }];
  const cache = {
    events: [...mine], covered: { since: 90, until: 200 }, exhausted: false,
    loadOlder: async () => { cache.events.push({ id: 'a', created_at: 100 }, { id: 'b', created_at: 50 }); cache.exhausted = true; return 1; },
  };
  const view = render(mine, [], cache);
  await view.find('notif-load-more').listeners.click(); await tick();
  assert.deepEqual(view.list.children.map((r) => r.eventId), ['a', 'b']);
});
