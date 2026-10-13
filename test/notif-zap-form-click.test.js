'use strict';

// A click in the notification zap form must not reach the row, which is an anchor that opens the
// note in the client tab. The buttons stopped their own clicks; the message and amount fields did
// not, so clicking into either sent the client tab to the note.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const start = source.indexOf("      const wrap = h('div', { className: 'notif-act-wrap' }");
const tail = source.slice(start, source.indexOf('return wrap;', start) + 'return wrap;'.length);

function build() {
  const listeners = [];
  const ctx = {
    row: {}, choices: {}, zapForm: {}, err: {},
    h: (tag, props, kids) => ({ tag, props, kids, addEventListener: (type, fn) => listeners.push({ type, fn }) }),
    stop: (e) => { e.preventDefault(); e.stopPropagation(); },
  };
  vm.createContext(ctx);
  const wrap = vm.runInContext('(function(){' + tail + '})()', ctx);
  return { wrap, listeners };
}

test('a click inside the actions never reaches the notification row', () => {
  const { wrap, listeners } = build();
  assert.equal(wrap.props.className, 'notif-act-wrap');
  const click = listeners.filter((l) => l.type === 'click');
  assert.equal(click.length, 1);
  let stopped = false, prevented = false;
  click[0].fn({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true, 'the click stops at the wrapper');
  assert.equal(prevented, true);
});
