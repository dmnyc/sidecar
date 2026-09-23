'use strict';

// THE MODAL BUILDERS, LIFTED AND ACTUALLY RUN.
//
// openModal calls buildContent(modal) and only then show(overlay), so anything that
// throws while building leaves the overlay hidden. The result is a button that does
// nothing: no sheet, no error text, no toast, because the code that would have written
// one never ran. Nothing in the panel reports it either, since the throw escapes into a
// click handler nobody is listening to.
//
// That shipped. sendModal's final modal.append listed `flight`, an element from an
// earlier design where a payment in flight had an inline block in the sheet. The block
// was replaced by a progress toast and deleted; its slot in the append list was not, and
// `flight` then existed only as a `let` inside the Pay click handler, a scope the builder
// cannot see. So every wallet Send in 1.13.0 was a no-op, on every account and every NWC
// wallet, and the suite was green throughout.
//
// A source assertion cannot find this. `let flight` is right there in the function, so
// any grep for the name succeeds; what is wrong is which scope it is in, and only the
// engine knows that. So these run the builder against stubs and assert it returns.
//
// The stubs are deliberately dumb. The point is not to check what the sheet contains,
// which the specific tests do; it is that the function reaches its end. A builder that
// completes has all its bindings.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

// An element that accepts anything and remembers what it was given.
function stubEl(tag) {
  return {
    tag,
    children: [],
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {},
    removeEventListener() {},
    append(...c) { this.children.push(...c); },
    appendChild(c) { this.children.push(c); return c; },
    prepend(...c) { this.children.unshift(...c); },
    remove() {},
    setAttribute() {},
    removeAttribute() {},
    focus() {},
    click() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function runBuilder(fnSource, name, extras) {
  const ctx = Object.assign({
    console, Math, JSON, Date, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
    parseInt, parseFloat, isNaN, String, Number, Object, Array, RegExp, Error, Set, Map,
    document: {
      createElement: stubEl,
      createTextNode: (t) => ({ text: t }),
      getElementById: () => stubEl('div'),
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    h: (tag, props, kids) => {
      const e = stubEl(tag);
      Object.assign(e, props || {});
      (kids || []).forEach((k) => e.children.push(k));
      return e;
    },
    icon: () => stubEl('svg'),
    closeModal() {},
    toast() { return { close() {} }; },
    fmtSats: (n) => String(n),
    show() {},
    hide() {},
  }, extras || {});

  let threw = null;
  let built = false;
  ctx.openModal = (build) => {
    try { build(stubEl('div')); built = true; } catch (e) { threw = e; }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fnSource + '\n' + name + '();', ctx);
  return { threw, built };
}

test('THE WALLET SEND SHEET BUILDS, WHICH IT DID NOT IN 1.13.0', () => {
  // The regression this file exists for. `flight` was appended to the sheet while being
  // declared inside the Pay handler, so the builder threw a ReferenceError before
  // openModal could reveal the overlay, and Send did nothing at all for everyone.
  const src =
    lift(/  function satsInput\([\s\S]*?\n  \}\n/, 'satsInput') + '\n' +
    lift(/  function sendModal\(\) \{[\s\S]*?\n  \}\n/, 'sendModal');
  const { threw, built } = runBuilder(src, 'sendModal');
  assert.equal(threw, null, threw && 'the Send sheet throws while building: ' + threw.message);
  assert.equal(built, true, 'the builder never ran');
});

test('and nothing in it references a binding from a handler scope', () => {
  // The specific shape, stated so the next one is recognisable: a name declared inside a
  // callback and used in the builder body reads fine and runs never. The append list at
  // the end of the builder is where it hid, because that is the one place every element
  // is named again after being made.
  const fn = lift(/  function sendModal\(\) \{[\s\S]*?\n  \}\n/, 'sendModal');
  const append = fn.slice(fn.lastIndexOf('modal.append('));
  assert.doesNotMatch(append, /\bflight\b/,
    'flight is back in the append list, where it is out of scope');
  // It is still the right name inside the handler, so this is not a rename.
  assert.match(fn, /let flight = null;/);
});

test('the receive sheet builds too', () => {
  // Same failure mode, same cost, and it is the other half of the wallet.
  const src =
    lift(/  const RECEIVE_PRESETS = \[[^\]]*\];/, 'RECEIVE_PRESETS') + '\n' +
    lift(/  function satsInput\([\s\S]*?\n  \}\n/, 'satsInput') + '\n' +
    lift(/  function receiveModal\(\) \{[\s\S]*?\n  \}\n/, 'receiveModal');
  const { threw, built } = runBuilder(src, 'receiveModal', {
    SidecarQR: { draw() {} },
    copyPlain: async () => {},
    // Real functions in the panel; stubbed here because the harness only lifts the
    // builder. A name that is genuinely missing shows up as a ReferenceError instead,
    // which is the whole point.
    getLightningAddress: async () => null,
    ensureNwc: async () => ({}),
    call: async () => ({}),
  });
  assert.equal(threw, null, threw && 'the Receive sheet throws while building: ' + threw.message);
  assert.equal(built, true, 'the builder never ran');
});
