'use strict';

// Any stream can have its address copied as an naddr, which is what the stream box takes, so a stream
// can be sent and opened from it. The address helper is pure and is round-tripped through the real
// encoder and the real paste parser; the button is run against a fake clipboard and a fake page.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'), { filename: 'nostr-tools.js' });
const core = require('../stream-core');
const NT = globalThis.NostrTools;
const streams = fs.readFileSync(path.join(ROOT, 'streams.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'streams.css'), 'utf8');

const PK = 'c'.repeat(64);
const item = (over = {}) => ({ key: '30311:' + PK + ':show-1', relays: ['wss://relay.one', 'wss://relay.two'], title: 'A show', ...over });

test('a stream\'s address comes from its key and relay hints', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(core.streamAddress(item()))), { kind: 30311, pubkey: PK, identifier: 'show-1', relays: ['wss://relay.one', 'wss://relay.two'] });
});

test('a d tag that holds colons keeps them, and only wss relays are hinted, three at most', () => {
  const a = core.streamAddress(item({ key: '30311:' + PK + ':a:b:c', relays: ['https://nope', 'wss://1', 'wss://2', 'wss://3', 'wss://4'] }));
  assert.equal(a.identifier, 'a:b:c');
  assert.deepEqual(JSON.parse(JSON.stringify(a.relays)), ['wss://1', 'wss://2', 'wss://3']);
});

test('a saved video link has no announcement behind it, and nothing else passes for one', () => {
  for (const bad of [{ key: 'url:https://example.com/live.m3u8' }, { key: '30023:' + PK + ':x' }, { key: '30311:short:x' }, { key: '' }, {}, null, undefined]) {
    assert.equal(core.streamAddress(bad), null, JSON.stringify(bad));
  }
});

test('what is copied is what the stream box reads back, so a copied stream can be pasted and opened', () => {
  for (const original of [item(), item({ key: '30311:' + PK + ':a:b:c' }), item({ relays: [] })]) {
    const copied = NT.nip19.naddrEncode(core.streamAddress(original));
    assert.match(copied, /^naddr1[0-9a-z]+$/);
    const pasted = core.parseStreamAddress(copied, (v) => NT.nip19.decode(v));
    assert.equal(pasted.naddr.pubkey, PK);
    assert.equal(pasted.naddr.identifier, core.streamAddress(original).identifier);
  }
});

// ---- the button ----------------------------------------------------------------------------

function lift(decl) {
  const at = streams.indexOf(decl);
  assert.ok(at !== -1, decl + ' is gone');
  let depth = 0;
  for (let i = streams.indexOf('{', at); i < streams.length; i++) {
    if (streams[i] === '{') depth++;
    else if (streams[i] === '}' && --depth === 0) return streams.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}
function fakeEl(tag) {
  const e = { tag, attrs: {}, children: [], handlers: {}, className: '', title: '' };
  e.setAttribute = (k, v) => { e.attrs[k] = v; };
  e.append = (...k) => { e.children.push(...k); };
  e.replaceChildren = (...k) => { e.children = k; };
  e.addEventListener = (t, f) => { e.handlers[t] = f; };
  return e;
}
function button({ writes, fail } = {}) {
  const timers = [];
  const ctx = vm.createContext({
    SidecarStreams: core, NostrTools: NT, t: (s) => s, clearTimeout() {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    document: { createElement: fakeEl, createElementNS: (ns, tag) => fakeEl(tag) },
    navigator: { clipboard: { writeText: async (text) => { if (fail) throw new Error('denied'); (writes || []).push(text); } } },
  });
  vm.runInContext(lift('function copyAddressButton(') + '\nthis.f = copyAddressButton;', ctx);
  return { make: (it) => ctx.f(it), timers };
}

test('a stream with an event gets a button, a saved video link does not', () => {
  const b = button();
  const el = b.make(item());
  assert.ok(el.className.includes('stream-copy'));
  assert.equal(el.title, 'Copy stream address');
  assert.equal(b.make({ key: 'url:https://example.com/x.m3u8' }), null);
});

test('pressing it copies the naddr without opening the stream, and shows that it did', async () => {
  const writes = [];
  const b = button({ writes });
  const el = b.make(item());
  let stopped = false;
  await el.handlers.click({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true, 'the press must not open the stream underneath it');
  assert.deepEqual(writes, [NT.nip19.naddrEncode(core.streamAddress(item()))]);
  assert.equal(el.title, 'Copied');
  assert.equal(el.children[0].children[0].tag, 'path', 'the icon is a tick');
  b.timers[0]();
  assert.equal(el.title, 'Copy stream address', 'and goes back');
  assert.equal(el.children[0].children[0].tag, 'rect', 'to the copy icon');
});

test('a clipboard that refuses is not reported as a copy', async () => {
  const el = button({ fail: true }).make(item());
  await el.handlers.click({ stopPropagation() {} });
  assert.equal(el.title, 'Copy stream address');
});

test('it sits directly under the bookmark in a row, clear of it and inside the row', () => {
  const rule = (selector) => { const m = css.match(new RegExp(selector.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}')); assert.ok(m, selector + ' is gone'); return m[1]; };
  const px = (body, prop) => Number((body.match(new RegExp(prop + ':\\s*(\\d+)px')) || [])[1]);
  const bookmark = rule('.stream-bookmark'), copy = rule('.stream-row .stream-copy'), row = rule('.stream-row .stream-result');
  assert.ok(px(copy, 'top') >= px(bookmark, 'top') + px(bookmark, 'height'), 'the copy button overlaps the bookmark');
  assert.equal(px(copy, 'right'), px(bookmark, 'right'), 'it is in the same column');
  assert.ok(px(copy, 'top') + px(copy, 'height') <= px(row, 'min-height'), 'it would hang below the row');
});

test('rows and the details header both offer it, and the row puts it after the bookmark', () => {
  assert.match(streams, /row\.append\(save\);\s*const copyAddress=copyAddressButton\(item\);if\(copyAddress\)row\.append\(copyAddress\);/);
  assert.match(streams, /const copyAddress=copyAddressButton\(item\);if\(copyAddress\)header\.append\(copyAddress\);\s*header\.append\(save\);/);
});
