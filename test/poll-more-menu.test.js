'use strict';

// The poll results sheet gets the same ⋮ every notification row carries: the poll's event
// id, its author's npub, a link and the JSON. These run the real attachPollMenu with a stub
// in place of buildEventMenu, which is tested where it was written.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');

function lift(decl) {
  const at = panel.indexOf(decl);
  assert.ok(at !== -1, 'sidepanel.js no longer has ' + decl);
  const open = panel.indexOf('{', panel.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < panel.length; i++) {
    if (panel[i] === '{') depth++;
    else if (panel[i] === '}' && --depth === 0) return panel.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

function el() {
  const e = { classes: new Set(), children: [], afterNode: null };
  e.classList = { add: (...c) => c.forEach((x) => e.classes.add(x)) };
  e.append = (k) => e.children.push(k);
  e.after = (k) => { e.afterNode = k; };
  return e;
}

function harness() {
  const made = [];
  const row = el();
  row.querySelector = (sel) => (sel === '.notif-more-btn' ? row.children.find((k) => k.classes.has('notif-more-btn')) || null : null);
  const ctx = {
    buildEventMenu: (ev, link, opts) => {
      const m = { btn: el(), panel: el(), ev, link, opts };
      m.btn.classes.add('notif-more-btn'); // as buildEventMenu makes it
      made.push(m);
      return m;
    },
  };
  vm.createContext(ctx);
  vm.runInContext(lift('function attachPollMenu(questionRow, pollEv, link)') + '\nthis.attach = attachPollMenu;', ctx);
  return { ctx, made, row };
}

const POLL = { id: 'p'.repeat(64), pubkey: 'a'.repeat(64), kind: 1068, tags: [], content: 'Q?' };

test("the ⋮ sits at the end of the question's line, and its rows open under it", () => {
  const h = harness();
  h.ctx.attach(h.row, POLL, 'https://client.example/nevent1x');
  assert.equal(h.made.length, 1);
  const m = h.made[0];
  assert.ok(h.row.children.includes(m.btn), 'the button is in the question row, not a sheet corner');
  assert.ok(!m.btn.classes.has('modal-x'), 'the corners are the exits');
  assert.equal(h.row.afterNode, m.panel, 'the rows sit under the question, full width');
  assert.ok(m.panel.classes.has('poll-more-menu'));
});

test("it is the poll's menu, with the link out and no npub row", () => {
  const h = harness();
  h.ctx.attach(h.row, POLL, 'https://client.example/nevent1x');
  const m = h.made[0];
  assert.equal(m.ev, POLL);
  assert.equal(m.opts.npubOf, null, 'npubOf: null is how buildEventMenu leaves the npub row out');
  assert.equal(m.link, 'https://client.example/nevent1x');
  const noLink = harness();
  noLink.ctx.attach(noLink.row, POLL, null);
  assert.equal(noLink.made[0].link, null, 'with no client resolved, the link item is left out rather than guessed');
});

test('Refresh runs the load again, and the menu is still added only once', () => {
  const h = harness();
  h.ctx.attach(h.row, POLL, null);
  h.ctx.attach(h.row, POLL, null);
  assert.equal(h.made.length, 1);
});

test('no poll in hand, no menu', () => {
  const h = harness();
  assert.equal(h.ctx.attach(h.row, null, null), null);
  assert.equal(h.made.length, 0);
});

test('the sheet adds it once the poll is loaded, after the link out is worked out', () => {
  const body = lift('async function openPollResults(poll, relayHints, returnTo)');
  const linkAt = body.indexOf("openOut.onclick = () => openInClient(url);");
  const attachAt = body.indexOf('attachPollMenu(questionRow, pollEv, url);');
  assert.ok(linkAt !== -1 && attachAt !== -1, 'the link or the menu call is gone');
  assert.ok(attachAt > linkAt, 'the menu is added before its link is known');
  assert.ok(attachAt > body.indexOf("if (!pollEv) {\n            question.textContent = '';"), 'the menu is added before a missing poll returns');
});
