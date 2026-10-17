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

// A page context that records what the provider hears and announces, so a config
// message can be delivered and webln:ready dispatches counted.
function page(otherProvider, opts) {
  const listeners = [];
  const events = [];
  const win = {
    postMessage() {},
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
