'use strict';

// The same note, posted twice. A minimized mine can publish while you are elsewhere, and
// the same words left in a composer would then go out again. Both composers remember a
// fingerprint of what this account posted in the last fifteen minutes and ask once
// before an identical note goes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');

function lift(src, decl) {
  const at = src.indexOf(decl);
  assert.ok(at > -1, decl + ' is gone');
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced');
}

const ctx = { TextEncoder, crypto: globalThis.crypto, Object, JSON, String, Date };
vm.createContext(ctx);
vm.runInContext([
  core.match(/const RECENT_POST_MS = [^\n]*/)[0],
  lift(core, 'async function sha256Hex('),
  lift(core, 'async function postFingerprint('),
  lift(core, 'function freshRecentPosts('),
  'this.postFingerprint = postFingerprint; this.freshRecentPosts = freshRecentPosts;',
].join('\n'), ctx);

test('the same note from the same account has the same fingerprint, and anything different does not', async () => {
  const fp = (pk, d, r) => ctx.postFingerprint(pk, d, r);
  const a = await fp('pk1', { text: 'gm ', media: [] }, null);
  assert.equal(a, await fp('pk1', { text: 'gm', media: [] }, null), 'surrounding space is not a different note');
  assert.notEqual(a, await fp('pk2', { text: 'gm', media: [] }, null), 'another account');
  assert.notEqual(a, await fp('pk1', { text: 'gm!', media: [] }, null), 'other words');
  assert.notEqual(a, await fp('pk1', { text: 'gm', media: [{ url: 'https://x/1.jpg' }] }, null), 'an attachment');
  assert.notEqual(a, await fp('pk1', { text: 'gm', media: [] }, { id: 'e1' }), 'a reply is not the note');
  assert.match(a, /^[0-9a-f]{64}$/, 'a hash, so no note text is stored');
});

test('a fingerprint goes stale after fifteen minutes', () => {
  const now = 1_000_000_000_000;
  const kept = ctx.freshRecentPosts({ a: now - 60_000, b: now - 16 * 60_000 }, now);
  assert.deepEqual(Object.keys(kept), ['a']);
});

test('both composers ask before posting it again, forget the question on an edit, and remember what they post', () => {
  for (const [name, src] of [['sidepanel.js', panel], ['compose.js', page]]) {
    assert.match(src, /const at = repeatAsked === fp \? 0 : await recentlyPostedAt\(fp\);/, name + ' does not check');
    assert.match(src, /t\('Post it again\?'\)/, name + ' does not ask');
    assert.match(src, /t\('You posted this \{\{when\}\}\.', \{ when: /, name + ' does not say when');
    assert.match(src, /if \(repeatAsked\) \{ repeatAsked = null;/, name + ' keeps asking after an edit');
    assert.match(src, /postFingerprint\([^)]*\)\.then\(rememberPosted\)/, name + ' does not remember a post');
    assert.match(src, /chrome\.storage\.session\.set\(\{ \[SC_RECENT_KEY\]: all \}\)/, name + ' keeps no store');
  }
  // The core stays free of storage; the pages own it.
  assert.ok(!/chrome\.storage/.test(core.replace(/^\s*\/\/.*$/gm, '')));
});

test('"POST IT AGAIN?" WAITS A BEAT BEFORE IT CAN BE PRESSED', () => {
  // So a double-tap or an impatient second press cannot carry straight through the
  // question, while a deliberate repeat still can.
  assert.match(panel, /const REPEAT_HOLD_MS = 2000;/);
  assert.match(panel, /post\.disabled = true;\s*setTimeout\(\(\) => \{ if \(repeatAsked === fp\) post\.disabled = false; \}, REPEAT_HOLD_MS\);/);
  assert.match(page, /const REPEAT_HOLD_MS = 2000;/);
  assert.match(page, /repeatHoldUntil = Date\.now\(\) \+ REPEAT_HOLD_MS;/);
  assert.match(page, /if \(repeatAsked && Date\.now\(\) < repeatHoldUntil\) post\.disabled = true;/);
});
