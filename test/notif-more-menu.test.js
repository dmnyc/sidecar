'use strict';

// The ⋮ menu on a notification: the event's kind, and copies of its ids, the sender's
// npub and the signed JSON.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

function lift(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  let paren = 0;
  let i = source.indexOf('(', at);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

test('THE JSON IS THE SIGNED EVENT, NOT WHAT THE CACHE HUNG ON IT', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(lift('function notifEventJson(') + '\nglobalThis.out = notifEventJson;', ctx);
  const ev = {
    id: 'a'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1, kind: 7,
    tags: [['e', 'c'.repeat(64)]], content: '+', sig: 'd'.repeat(128),
    _relay: 'wss://x', seenOn: ['wss://y'],
  };
  const out = JSON.parse(ctx.out(ev));
  assert.deepEqual(Object.keys(out), ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig']);
  assert.equal(out.content, '+');
});

test('every notification row gets the menu, not only the note-like ones', () => {
  const build = lift('function buildItem(');
  assert.match(build, /buildEventMenu\(ev, linkTarget\)/);
  assert.match(build, /right\.appendChild\(moreMenu\.btn\)/, 'the ⋮ lives in the top-right slot');
  // Outside the isNoteLike / targetId branches, so reactions, reposts, zaps and votes
  // have it too.
  const at = build.indexOf('buildEventMenu(');
  assert.ok(at < build.indexOf('const isNoteLike'), 'the menu is built before the note-only branches');
});

test('it offers the ids, the npub and the JSON, and names the kind', () => {
  const menu = lift('function buildEventMenu(');
  for (const label of ['Copy event ID', 'Copy npub', 'Copy event JSON']) {
    assert.ok(menu.includes("t('" + label + "')"), label);
  }
  assert.match(menu, /approvalKindLabels\(\)\[ev\.kind\]/, 'kind names come from the approval table');
  assert.match(menu, /t\('Kind \{\{kind\}\} · \{\{name\}\}', \{ kind, name: kindName \}\)/);
  // A zap's npub is the zapper the row names, not the LNURL service that signed it.
  assert.match(menu, /const who = zapSender\(ev\)/);
  assert.match(menu, /npubEncode\(who\)/);
});

test('a reaction or a zap offers only its parent note', () => {
  const menu = lift('function buildEventMenu(');
  assert.match(menu, /const parentOnly = \(ev\.kind === 7 \|\| ev\.kind === 9735\) && targetId;/);
  assert.match(menu, /for \(const \[label, glyph, value\] of shown\)/);
});

test('A TAP IN THE MENU NEVER FOLLOWS THE ROW LINK', () => {
  const menu = lift('function buildEventMenu(');
  assert.match(menu, /panel\.addEventListener\('click', stop\)/);
  assert.match(menu, /e\.preventDefault\(\); e\.stopPropagation\(\);/);
});

test('the menu is stacked rows under the header, never words beside content', () => {
  const rule = css.match(/\.notif-more \{([^}]*)\}/);
  assert.ok(rule, '.notif-more exists');
  assert.match(rule[1], /flex-direction: column/);
  assert.match(rule[1], /align-items: stretch/);
  // No shrinking the controls to make them fit (AGENTS.md).
  const item = css.match(/\.notif-more-item \{([^}]*)\}/)[1];
  assert.match(item, /font-size: 12\.5px/);
  assert.match(css, /\.notif-more-item span \{[^}]*text-overflow: ellipsis/);
});
