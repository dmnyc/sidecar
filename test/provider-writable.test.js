'use strict';

// window.nostr and window.webln are ordinary properties a page can replace.
//
// Login and wallet libraries put a wrapper in front of the extension by assigning their
// own window.nostr (or window.webln) and keeping ours behind it. They do it in strict-mode
// code, class fields included, where assigning to a read-only property throws, and the
// throw took down the library's setup: its login button then did nothing. This runs the
// real provider and makes that assignment the way such a library does.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'nostr-provider.js'), 'utf8');

function page() {
  const win = {
    postMessage() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    location: { origin: 'https://example.com', href: 'https://example.com/' },
  };
  const ctx = {
    window: win, document: { addEventListener() {}, documentElement: {} }, navigator: {},
    Event: class { constructor(type) { this.type = type; } },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout, clearTimeout, Promise, Object, Math, Date, String, Error, JSON, console,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, win };
}

for (const name of ['nostr', 'webln']) {
  test('window.' + name + ' is writable and configurable, as a page expects', () => {
    const { win } = page();
    const d = Object.getOwnPropertyDescriptor(win, name);
    assert.ok(d, 'window.' + name + ' was not defined');
    assert.equal(d.writable, true);
    assert.equal(d.configurable, true);
  });

  test('a strict-mode wrapper can replace window.' + name + ' and keep ours behind it', () => {
    const { ctx, win } = page();
    const ours = win[name];
    // A class body is strict mode, which is where the throw used to happen.
    const result = vm.runInContext(`
      class Wrapper {
        install = () => { this.inner = window.${name}; window.${name} = { wrapped: true, inner: this.inner }; };
      }
      const w = new Wrapper();
      w.install();
      w;
    `, ctx);
    assert.equal(win[name].wrapped, true, 'the wrapper did not take window.' + name);
    assert.equal(result.inner, ours, 'the wrapper lost the extension it wraps');
  });
}
