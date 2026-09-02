'use strict';

// Recent Activity should be checkable, not just believable.
//
// Requested as "being able to inspect the last 100 or so signed events... then I can
// trust them but verify". The list already keeps 200 entries, so length was never the
// gap. The gap was content: logActivity stored { ts, host, method, kind, pubkey } and
// no event id, which records THAT something was signed and never WHAT — precisely the
// thing "verify" needs.
//
// This is step one: the id only. It is 32 bytes, it carries no content, and it is the
// only field that makes an entry checkable against a relay. Storing the event body is a
// separate decision with real privacy weight (DMs, zap requests, drafts) and belongs in
// the encrypted store — see #280.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');

// There are several logActivity calls and the REJECTION one comes first in the file, so
// "the first match" finds the wrong one. Pick by what distinguishes them instead.
function logCalls() {
  return stripComments(bg).match(/logActivity\(\{[\s\S]*?\}\);/g) || [];
}
const successLog = () => {
  const c = logCalls().find((x) => x.includes('pubkey: activePubkey'));
  assert.ok(c, 'could not find the success-path logActivity call');
  return c;
};
const rejectedLog = () => {
  const c = logCalls().find((x) => x.includes('rejected'));
  assert.ok(c, 'could not find the rejection-path logActivity call');
  return c;
};

// ---- recording it ------------------------------------------------------------------

test('a successful signature records the event id', () => {
  assert.match(successLog(), /id: result && typeof result\.id === 'string' \? result\.id : undefined/);
});

test('the id is read defensively, not assumed', () => {
  // getPublicKey and the encrypt/decrypt methods produce no event and no id, and they
  // go through the same logActivity call. Reading result.id blindly would be fine but
  // storing a non-string would not.
  assert.match(successLog(), /typeof result\.id === 'string'/);
});

test('a refused request still records no id, because nothing was signed', () => {
  // The rejection path never reached the key. Giving it an id would invent a
  // signature that does not exist.
  assert.doesNotMatch(rejectedLog(), /\bid:/);
});

test('the id survives into storage', () => {
  // logActivity persists the whole entry; a sanitizer that dropped unknown fields
  // would silently undo all of this.
  const at = bg.indexOf('async function logActivity(');
  const fn = bg.slice(at, bg.indexOf('\n}', at));
  assert.match(fn, /cur\.unshift\(entry\)/, 'the entry is stored as given');
  assert.doesNotMatch(fn, /id:/, 'and not field-by-field, so nothing needs updating here');
});

// ---- surfacing it ------------------------------------------------------------------

test('rows with an id offer a way to view the event', () => {
  const at = panel.indexOf('function activityRow(');
  const fn = panel.slice(at, panel.indexOf('\n  }\n', at));
  assert.match(fn, /if \(e\.id\) \{/, 'only when there is something to verify');
  assert.match(fn, /neventEncode\(\{ id: e\.id/);
  assert.match(fn, /preferredClient\(\)/, 'opens where the user already reads Nostr');
});

test('the id itself is readable without leaving the panel', () => {
  const at = panel.indexOf('function activityRow(');
  const fn = panel.slice(at, panel.indexOf('\n  }\n', at));
  assert.match(fn, /row\.title = e\.id/);
});

test('the action is an icon button, not a labelled one', () => {
  // The panel is ~360px. A labelled action beside content is what collapses these
  // rows — the recurring mistake CLAUDE.md is written about.
  const at = panel.indexOf('function activityRow(');
  const fn = panel.slice(at, panel.indexOf('\n  }\n', at));
  assert.match(fn, /iconButton\('View this event', 'external'/);
  assert.match(fn, /className: 'item-actions'/, 'and lives in the inline action slot');
});

test('a row with no id is unchanged', () => {
  // getPublicKey entries, and every entry logged before this shipped. They must not
  // grow a button that would open nothing.
  const at = panel.indexOf('function activityRow(');
  const fn = panel.slice(at, panel.indexOf('\n  }\n', at));
  const guard = fn.indexOf('if (e.id) {');
  const button = fn.indexOf('iconButton(');
  assert.ok(guard !== -1 && guard < button, 'the button must be inside the guard');
});

// ---- what step one deliberately does not do ------------------------------------------

test('no event content is stored', () => {
  // The privacy decision deferred to #280. Signed events include DMs, zap requests and
  // drafts; Sidecar keeps that class of data in encrypted envelopes, not in plain
  // chrome.storage.local, so content must not arrive here by the back door.
  const call = successLog();
  for (const field of ['content', 'tags', 'sig']) {
    assert.doesNotMatch(call, new RegExp('\\b' + field + ':'), field + ' must not be logged');
  }
});
