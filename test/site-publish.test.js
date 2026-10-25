'use strict';

// The publish session behind one site-publishing approval (site-publish.js).
//
// The session is the trust model, so the tests are the trust model in runnable form:
// a session signs the account, kinds, bytes and window its approval named, and
// refuses everything else. Isolated module, no chrome — same harness as
// test/kind-grant.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'site-publish.js'), 'utf8');
const ctx = { console };
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const SP = ctx.SidecarSitePublish;

const ALICE = 'a'.repeat(64);
const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);
const H3 = '3'.repeat(64);

const T0 = 1_700_000_000_000;

// The module's `now` defaults to the real clock — right in production, useless against
// a session begun in 1700-something. Every call here runs at T0 unless it names a time.
function check(session, event, pubkey, now) {
  return SP.check(session, event, pubkey, now == null ? T0 : now);
}

function plan(over) {
  return Object.assign({
    name: '',
    files: [
      { path: '/index.html', hash: H1, size: 100 },
      { path: '/about.html', hash: H2, size: 200 },
    ],
    unpublish: false,
  }, over);
}

function session(over) {
  return SP.begin(ALICE, plan(over), T0);
}

test('a valid plan passes, and every broken shape names itself', () => {
  assert.equal(SP.validatePlan(plan()), null);
  assert.equal(SP.validatePlan(plan({ name: 'my-blog' })), null);
  assert.equal(SP.validatePlan(plan({ name: 'My Blog' })), 'site name');
  assert.equal(SP.validatePlan(plan({ name: 'ends-with-dash-' })), 'site name');
  assert.equal(SP.validatePlan(plan({ name: 'thirteen-chars-long-but-fine-xx'.slice(0, 14) })), 'site name');
  assert.equal(SP.validatePlan(plan({ files: [] })), 'no files');
  assert.equal(SP.validatePlan(plan({ files: [{ path: 'index.html', hash: H1, size: 1 }] })), 'file path');
  assert.equal(SP.validatePlan(plan({ files: [{ path: '/a/../b.html', hash: H1, size: 1 }] })), 'file path');
  assert.equal(SP.validatePlan(plan({ files: [{ path: '/a.html', hash: 'nothex', size: 1 }] })), 'file hash');
  assert.equal(SP.validatePlan(plan({ files: [{ path: '/a.html', hash: H1, size: -1 }] })), 'file size');
  assert.equal(SP.validatePlan(plan({ files: [
    { path: '/a.html', hash: H1, size: 1 },
    { path: '/a.html', hash: H2, size: 1 },
  ] })), 'duplicate path');
  assert.equal(SP.validatePlan(null), 'no plan');
});

test('an unpublish plan needs no files', () => {
  assert.equal(SP.validatePlan({ name: 'blog', unpublish: true }), null);
  assert.equal(SP.validatePlan({ name: '', unpublish: true }), null);
  assert.equal(SP.validatePlan({ name: 'BAD', unpublish: true }), 'site name');
});

test('the manifest kind is derived from the name, never from the page', () => {
  const root = session();
  assert.equal(root.manifestKind, 15128);
  const named = session({ name: 'blog' });
  assert.equal(named.manifestKind, 35128);
});

test('a manifest of the approved files signs; one carrying a foreign blob does not', () => {
  const s = session();
  assert.equal(check(s, { kind: 15128, tags: [['path', '/index.html', H1], ['path', '/about.html', H2]] }, ALICE), null);
  const why = check(s, { kind: 15128, tags: [['path', '/index.html', H1], ['path', '/evil.html', H3]] }, ALICE);
  assert.match(why, /does not cover blob/);
  // Hashes are case-insensitive on the event side, as every relay and gateway writes them.
  assert.equal(check(s, { kind: 15128, tags: [['path', '/index.html', H1.toUpperCase()]] }, ALICE), null);
});

test('a named session signs only its own name; the root session signs only an unnamed manifest', () => {
  const named = session({ name: 'blog' });
  assert.equal(check(named, { kind: 35128, tags: [['d', 'blog'], ['path', '/index.html', H1]] }, ALICE), null);
  assert.match(check(named, { kind: 35128, tags: [['d', 'other'], ['path', '/index.html', H1]] }, ALICE), /does not cover the site/);
  const root = session();
  assert.match(check(root, { kind: 15128, tags: [['d', 'blog'], ['path', '/index.html', H1]] }, ALICE), /named site/);
});

test('a publish session refuses to sign the empty manifest; only an unpublish may', () => {
  const s = session();
  assert.equal(check(s, { kind: 15128, tags: [] }, ALICE), 'The manifest publishes no files');
  const up = SP.begin(ALICE, { name: '', unpublish: true }, T0);
  assert.equal(check(up, { kind: 15128, tags: [] }, ALICE), null);
});

test('upload auths are scoped to the approved hashes', () => {
  const s = session();
  assert.equal(check(s, { kind: 24242, tags: [['t', 'upload'], ['x', H1], ['expiration', '1']] }, ALICE), null);
  assert.match(check(s, { kind: 24242, tags: [['t', 'upload'], ['x', H3]] }, ALICE), /does not cover blob/);
  assert.match(check(s, { kind: 24242, tags: [['t', 'upload']] }, ALICE), /no blob hash/);
});

test('kind 5 signs only on an unpublish session, and only for that site', () => {
  const up = SP.begin(ALICE, { name: 'blog', unpublish: true }, T0);
  assert.equal(check(up, { kind: 5, tags: [['a', '35128:' + ALICE + ':blog'], ['e', 'f'.repeat(64)]] }, ALICE), null);
  assert.match(check(up, { kind: 5, tags: [['a', '15128:' + ALICE]] }, ALICE), /does not cover/);
  // A publish session never mints kind 5 into its kinds at all, so the refusal is the
  // kind gate's, not the address gate's.
  const s = session();
  assert.match(check(s, { kind: 5, tags: [['a', '15128:' + ALICE]] }, ALICE), /does not cover kind 5/);
});

test('a session covers its kinds and no others', () => {
  const s = session();
  assert.equal(check(s, { kind: 5128, tags: [['path', '/index.html', H1]] }, ALICE), null);
  assert.equal(check(s, { kind: 10063, tags: [['server', 'https://x.example']] }, ALICE), null);
  assert.match(check(s, { kind: 0, tags: [] }, ALICE), /does not cover kind 0/);
  assert.match(check(s, { kind: 9734, tags: [] }, ALICE), /does not cover kind/);
});

test('the account bound at approval is the only account the session signs as', () => {
  const s = session();
  assert.match(check(s, { kind: 15128, tags: [['path', '/index.html', H1]] }, 'b'.repeat(64)), /Account changed/);
});

test('the session dies on its TTL, and says to ask again', () => {
  const s = session();
  assert.equal(check(s, { kind: 15128, tags: [['path', '/index.html', H1]] }, ALICE, T0 + SP.SESSION_TTL_MS - 1), null);
  const why = check(s, { kind: 15128, tags: [['path', '/index.html', H1]] }, ALICE, T0 + SP.SESSION_TTL_MS);
  assert.match(why, /expired|not found/);
  assert.equal(SP.get(s.id, T0 + SP.SESSION_TTL_MS), null, 'get sweeps an expired session');
});

test('end ends it; endAll ends everything; endForAccount leaves other accounts alone', () => {
  const s = session();
  const other = SP.begin('b'.repeat(64), plan(), T0);
  assert.equal(SP.end(s.id), true);
  // The session is gone from the map, which is all the background ever hands check:
  // get(id) returns null and the refusal is the not-found one.
  assert.equal(SP.get(s.id, T0), null);
  assert.match(check(null, { kind: 15128, tags: [['path', '/index.html', H1]] }, ALICE), /not found/);
  assert.equal(SP.get(other.id, T0) !== null, true);
  assert.equal(SP.endForAccount('c'.repeat(64)), false);
  assert.equal(SP.endForAccount('b'.repeat(64)), true);
  assert.equal(SP.get(other.id, T0), null);
  // liveCount sweeps on the real clock, so its sessions begin now, as production's do.
  SP.begin(ALICE, plan());
  SP.begin(ALICE, plan());
  assert.equal(SP.liveCount(), 2);
  assert.equal(SP.endAll(), true);
  assert.equal(SP.liveCount(), 0);
});
