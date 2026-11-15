'use strict';

// The bell's badge counts the newest screenful, not a week: past a screenful of unread, or
// with unread that may reach back past what has been loaded, it reads "25+". These run the
// real notifBadgeText.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('./helpers/i18n.js');

const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
function lift(decl) {
  const at = panel.indexOf(decl);
  assert.ok(at !== -1, decl + ' is gone');
  let depth = 0;
  for (let i = panel.indexOf('{', at); i < panel.length; i++) {
    if (panel[i] === '{') depth++;
    else if (panel[i] === '}' && --depth === 0) return panel.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

const screen = panel.match(/const NOTIF_SCREEN = (\d+);/);
assert.ok(screen, 'NOTIF_SCREEN moved');
const SCREEN = Number(screen[1]);
const ctx = withI18n({ NOTIF_SCREEN: SCREEN });
vm.createContext(ctx);
vm.runInContext(lift('function notifBadgeText(') + '\nthis.badge = notifBadgeText;', ctx);
const badge = (...a) => ctx.badge(...a);

const loaded = (since, extra) => Object.assign({ covered: { since, until: 2000 }, exhausted: false }, extra);

test('nothing unread shows nothing', () => {
  assert.equal(badge(0, loaded(100), 50), '');
});

test('a few unread, all inside what is loaded, is the plain count', () => {
  assert.equal(badge(3, loaded(100), 500), '3');
});

test('more unread than a screenful reads as a screenful and a +', () => {
  assert.equal(badge(SCREEN + 12, loaded(100), 500), SCREEN + '+');
});

test('unread that may reach past what is loaded gets a +', () => {
  // You last looked before the loaded stretch starts, and older history is still there.
  assert.equal(badge(4, loaded(1000), 500), '4+');
  // The same, but the relays have nothing older: the count is the whole story.
  assert.equal(badge(4, loaded(1000, { exhausted: true }), 500), '4');
});

test('a screenful exactly, all loaded, has no +', () => {
  assert.equal(badge(SCREEN, loaded(100), 500), String(SCREEN));
});
