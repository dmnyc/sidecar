'use strict';

// "Forget site" is meant to be "start over, ask me again". It cleared the saved tier, the
// binding and the history, but not the short windows a site had earned: the 60-second app-data
// approve window and decrypt-burst window held in the worker's memory, and a timed Auto-sign
// window. One more sign inside a window went through with no card and quietly bound the
// forgotten site again. These run the real handlers and the real window helpers.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

function lift(decl) {
  const at = src.indexOf(decl);
  assert.ok(at !== -1, decl + ' is gone');
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}
function caseBody(name) {
  const m = src.match(new RegExp("case '" + name + "':([\\s\\S]*?)\\n\\s*break;"));
  assert.ok(m, name + ' case is gone');
  return m[1];
}

// The real window helpers over real Maps.
function windows() {
  const ctx = vm.createContext({ contentGrants: new Map(), decryptGrants: new Map(), COALESCE_WINDOW_MS: 60000, DECRYPT_WINDOW_MS: 60000, Date });
  vm.runInContext([
    lift('function grantKey('), lift('function hasContentGrant('), lift('function grantContent('),
    lift('function decryptGrantKey('), lift('function hasDecryptGrant('), lift('function grantDecrypt('),
    lift('function forgetStandingApprovals('),
    'this.api = { hasContentGrant, grantContent, hasDecryptGrant, grantDecrypt, forgetStandingApprovals };',
  ].join('\n'), ctx);
  return ctx;
}

test('forgetStandingApprovals ends that host\'s windows and leaves other hosts alone', () => {
  const ctx = windows();
  const { api } = ctx;
  api.grantContent('a.example', 'pk1', 30078); api.grantContent('a.example', 'pk2', 30078);
  api.grantDecrypt('a.example', 'pk1');
  api.grantContent('b.example', 'pk1', 30078); api.grantDecrypt('b.example', 'pk1');
  assert.equal(api.hasContentGrant('a.example', 'pk1', 30078), true);
  api.forgetStandingApprovals('a.example');
  assert.equal(api.hasContentGrant('a.example', 'pk1', 30078), false, 'the app-data window outlived the forget');
  assert.equal(api.hasContentGrant('a.example', 'pk2', 30078), false, 'for every account that host had');
  assert.equal(api.hasDecryptGrant('a.example', 'pk1'), false, 'the decrypt window outlived the forget');
  assert.equal(api.hasContentGrant('b.example', 'pk1', 30078), true, 'another site lost its window');
  assert.equal(api.hasDecryptGrant('b.example', 'pk1'), true);
});

test('the Forget site handler ends the windows and revokes the timed Auto-sign window', async () => {
  const ctx = windows();
  const revoked = [];
  const body = caseBody('SIDECAR_REMOVE_HOST');
  const handler = new Function('PERMS', 'KS', 'KINDS', 'clearSiteAccount', 'clearAuthorizedForHost', 'clearAlwaysActiveHost',
    'forgetStandingApprovals', 'RELAX', 'syncRelaxBadge', 'message',
    'return (async () => { let result; ' + body + '\n return result; })()');
  ctx.api.grantContent('a.example', 'pk1', 30078);
  const noop = async () => {};
  await handler(
    { removeHost: async () => ({}) }, { getActivePubkey: async () => 'pk1' }, { revokeForHost: noop },
    noop, noop, noop, ctx.api.forgetStandingApprovals,
    { revokeForHost: async (h) => revoked.push(h) }, () => {}, { host: 'a.example' });
  assert.equal(ctx.api.hasContentGrant('a.example', 'pk1', 30078), false, 'a sign right after Forget must ask again');
  assert.deepEqual(revoked, ['a.example'], 'a timed Auto-sign window outlived the forget');
});

test('the Forget all sites handler clears every window and the Auto-sign windows', async () => {
  const ctx = windows();
  let relaxAll = 0;
  const body = caseBody('SIDECAR_FORGET_ALL_SITES');
  // KINDS is a stand-in the handler only touches once the standing per-kind grants (#482) exist.
  const handler = new Function('PERMS', 'KINDS', 'sset', 'contentGrants', 'decryptGrants', 'RELAX', 'syncRelaxBadge',
    'SITE_ACCTS_KEY', 'SITE_AUTHZ_KEY', 'SITE_ALWAYS_ACTIVE_KEY', 'ACTIVITY_KEY',
    'return (async () => { let result; ' + body + '\n return result; })()');
  ctx.api.grantContent('a.example', 'pk1', 30078); ctx.api.grantDecrypt('b.example', 'pk1');
  const noop = async () => {};
  await handler({ clearAll: noop }, { clearAll: noop }, noop, ctx.contentGrants, ctx.decryptGrants,
    { revokeAll: async () => { relaxAll++; } }, () => {}, 'a', 'b', 'c', 'd');
  assert.equal(ctx.api.hasContentGrant('a.example', 'pk1', 30078), false);
  assert.equal(ctx.api.hasDecryptGrant('b.example', 'pk1'), false);
  assert.equal(relaxAll, 1, 'the timed Auto-sign windows survived Forget all sites');
});
