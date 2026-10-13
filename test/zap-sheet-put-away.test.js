'use strict';

// A zap sheet that stayed on top while its payment was pending kept the stream's chat out of reach.
// Once the payment is on its way the sheet goes, and the player bar's other controls put an open
// zap sheet away. Leaving is not cancelling: nothing here touches the payment.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const code = source.replace(/^\s*\/\/.*$/gm, '');

const helperAt = code.indexOf('  function putAwayPaidSheet(');
const helper = code.slice(helperAt, code.indexOf('  // ', helperAt) > 0 ? code.indexOf('  const DOCK_CONTROLS', helperAt) : undefined);
const dockAt = code.indexOf('  const DOCK_CONTROLS');
const dock = code.slice(dockAt, code.indexOf('}, true);', dockAt) + '}, true);'.length);

test('a sheet that is still on screen is closed when its payment goes out; one that was replaced is not', () => {
  let closed = 0;
  const ctx = { closeModal: () => closed++ };
  vm.createContext(ctx);
  vm.runInContext(helper, ctx);
  ctx.putAwayPaidSheet({ isConnected: true });
  assert.equal(closed, 1);
  ctx.putAwayPaidSheet({ isConnected: false });
  ctx.putAwayPaidSheet(null);
  assert.equal(closed, 1, 'a different sheet opened since stays');
});

function dockClick({ id, modalClasses = ['stream-zap-modal'], open = true, closing = false, noButton = false }) {
  let closed = 0, handler, capture;
  const cls = (list) => ({ contains: (n) => list.includes(n) });
  const modal = { classList: cls([...modalClasses, ...(closing ? ['is-closing'] : [])]) };
  const ctx = {
    $: (name) => (name === 'stream-dock' ? { addEventListener: (type, fn, cap) => { if (type === 'click') { handler = fn; capture = cap; } } } : modal),
    document: { documentElement: { classList: cls(open ? ['modal-open'] : []) } },
    closeModal: () => closed++,
  };
  vm.createContext(ctx);
  vm.runInContext(dock, ctx);
  handler({ target: { closest: (sel) => (noButton ? null : { id }) } });
  return { closed, capture };
}

test('the chat button and the other player controls put an open zap sheet away', () => {
  for (const id of ['stream-chat-toggle', 'stream-browse', 'stream-title-button', 'stream-feed-toggle', 'stream-expand', 'stream-stop']) {
    assert.equal(dockClick({ id }).closed, 1, id);
  }
});

test('it listens before the control does, so a control that opens a sheet is not undone', () => {
  assert.equal(dockClick({ id: 'stream-chat-toggle' }).capture, true);
});

test('the bolt, controls without an id, and anything that is not an open zap sheet are left alone', () => {
  assert.equal(dockClick({ id: 'stream-zap' }).closed, 0, 'the bolt toggles its own sheet');
  assert.equal(dockClick({ id: '' }).closed, 0, 'a comment zap button has no id');
  assert.equal(dockClick({ id: 'stream-chat-toggle', noButton: true }).closed, 0);
  assert.equal(dockClick({ id: 'stream-chat-toggle', modalClasses: [] }).closed, 0, 'another sheet');
  assert.equal(dockClick({ id: 'stream-chat-toggle', open: false }).closed, 0, 'nothing open');
  assert.equal(dockClick({ id: 'stream-chat-toggle', closing: true }).closed, 0, 'already closing');
});

test('the sheet is put away only after the invoice exists and the payment goes out, before waiting on it', () => {
  const invoice = code.indexOf('const invoice = await zapInvoice(');
  const flight = code.indexOf('flight = toast(', invoice);
  const away = code.indexOf('putAwayPaidSheet(zapForm);', invoice);
  const pay = code.indexOf('const res = await client.payInvoice(invoice);', invoice);
  assert.ok(invoice > 0 && flight > invoice && away > flight && pay > away,
    'zapInvoice, then the progress toast, then put away, then payInvoice');
  assert.equal(code.split('putAwayPaidSheet(zapForm)').length - 1, 1, 'one call site, the stream and profile sheet');
});
