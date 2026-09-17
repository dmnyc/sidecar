'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
// Execute the actual initial rendering, paging, and outside-network toggle together.
const start = panel.indexOf('      const panelQuote = pickQuote();');
const end = panel.indexOf('      // Back to where you were.', start);
assert.ok(start >= 0 && end > start);
const source = panel.slice(start, end);

function element(tag, props = {}, children = []) {
  const node = {
    tag, ...props, children: [], style: {}, listeners: {},
    append(...items) { items.forEach((item) => this.appendChild(item)); },
    appendChild(item) { this.children.push(item); item.parent = this; return item; },
    insertBefore(item, before) {
      const at = this.children.indexOf(before);
      assert.ok(at >= 0);
      this.children.splice(at, 0, item);
      item.parent = this;
    },
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); },
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

function render(events, offNet) {
  const list = element('div', { className: 'notif-list' });
  const scroll = element('div', {}, [list]);
  const ctx = {
    events, offNet, list, scroll, PAGE: 25,
    h: element, icon: () => element('svg'), pickQuote: () => 'quote',
    emptyQuote: () => element('div', { className: 'empty' }),
    endQuote: () => element('p'),
    buildItem: (ev) => element('a', { eventId: ev.id }),
    document: { createTextNode: (textContent) => element('text', { textContent }), createElement: element },
    client: { label: 'Client', profile: () => 'https://example.com/profile' },
    NT: { nip19: { npubEncode: () => 'npub' } }, a: { pubkey: 'account' },
  };
  vm.runInNewContext(source, ctx);
  const find = (className) => scroll.children.find((n) => n.className === className);
  return { list, scroll, find };
}

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
