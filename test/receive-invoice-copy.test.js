'use strict';

// THE INVOICE UNDER THE QR CODE IS DATA, AND DATA CAN BE COPIED. The panel turns text
// selection off everywhere and back on for values; the receive sheet's invoice box was
// never one of them, and it shows a shortened form (start…end), so even a selection would
// have copied the ellipsis. One click now takes the whole box, and copying from it puts the
// whole invoice on the clipboard, while the box keeps its short form on screen.
//
// Run: showInvoice builds its box over a small fake DOM and a copy event is fired at it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

function liftFn(source, header) {
  const start = source.indexOf(header);
  assert.notEqual(start, -1, header + ' not found');
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced');
}

class El {
  constructor(tag) { this.tagName = tag; this.className = ''; this.children = []; this.listeners = {}; this.textContent = ''; }
  append(...ns) { this.children.push(...ns); }
  set innerHTML(_) { this.children = []; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  fire(type, ev) { (this.listeners[type] || []).forEach((fn) => fn(ev)); }
  find(cls) {
    for (const c of this.children) {
      if (c instanceof El && c.className.split(/\s+/).includes(cls)) return c;
      const deep = c instanceof El && c.find(cls);
      if (deep) return deep;
    }
    return null;
  }
}

const INVOICE = 'lnbc210n1p' + 'q'.repeat(200) + 'xyz0123456';

function build() {
  const document = { createElement: (tag) => new El(tag) };
  const h = (tag, props, kids) => { const el = new El(tag); Object.assign(el, props || {}); (kids || []).forEach((k) => el.append(k)); return el; };
  const ctx = {
    document, h, tSec: (s) => s,
    window: { SidecarQR: { draw: () => {} } },
    copyPlain: async () => {}, waitingRow: () => new El('div'),
    setTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(liftFn(panel, '  function showInvoice(container, invoice) {') + '\nthis.showInvoice = showInvoice;', ctx);
  const container = new El('div');
  ctx.showInvoice(container, INVOICE);
  return container.find('recv-bolt');
}

test('copying from the invoice box puts the whole invoice on the clipboard, not the shortened form', () => {
  const box = build();
  assert.ok(box, 'the invoice box is drawn');
  assert.ok(box.textContent.includes('…') && box.textContent.length < 40, 'it still shows the short form');
  const data = {};
  let prevented = false;
  box.fire('copy', { clipboardData: { setData: (type, v) => { data[type] = v; } }, preventDefault: () => { prevented = true; } });
  assert.equal(data['text/plain'], INVOICE);
  assert.ok(prevented, 'the shortened text the browser would copy is replaced');
});

test('one click selects the whole invoice box', () => {
  // The body turns selection off; this rule is what turns it back on for the box.
  const rule = css.slice(css.indexOf('.recv-bolt {'), css.indexOf('}', css.indexOf('.recv-bolt {')));
  assert.match(rule, /(^|[\s;])user-select:\s*all/);
  assert.match(rule, /-webkit-user-select:\s*all/);
});
