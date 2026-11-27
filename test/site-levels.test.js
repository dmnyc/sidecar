'use strict';

// Per-account tiers on a shared site. A tier belongs to an (account, host) pair, but the
// Connected sites row could only ever edit the ACTIVE account's, so the other account's tier
// was reachable only by switching accounts first. SIDECAR_SET_LEVEL now takes the account it
// is for, and SIDECAR_GET_SITE_LEVELS reads every signed-in account's tier for the sheet.
// These run the real handlers over a fake permissions store; the browser test beside the
// approval cards runs the whole path through the panel.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

// The body of `case 'NAME': { ... }`, braces matched, so a block-scoped case lifts whole.
function braceCase(name) {
  const at = src.indexOf("case '" + name + "': {");
  assert.ok(at !== -1, name + ' case is gone');
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(src.indexOf('{', at) + 1, i);
  }
  throw new Error('unbalanced ' + name);
}

function world() {
  const levels = {}; // 'pubkey|host' -> level
  const accounts = new Set(['A', 'B']);
  const w = {
    levels, active: 'A',
    PERMS: {
      setLevel: async (pk, host, level) => { levels[pk + '|' + host] = level; return true; },
      getLevel: async (pk, host) => levels[pk + '|' + host] || 'ask',
    },
    KS: { getActivePubkey: async () => w.active, hasAccount: async (pk) => accounts.has(pk) },
    authorized: ['A', 'B'],
    getAuthorizedAccounts: async () => w.authorized,
  };
  return w;
}
function handler(name, w) {
  const fn = new Function('PERMS', 'KS', 'getAuthorizedAccounts', 'message',
    'return (async () => { let result; do {' + braceCase(name) + '\n} while (false); return result; })()'); // the case’s break needs a loop to leave
  return (message) => fn(w.PERMS, w.KS, w.getAuthorizedAccounts, message);
}

test('SET_LEVEL with an account sets that account’s tier and leaves the active account’s alone', async () => {
  const w = world();
  await handler('SIDECAR_SET_LEVEL', w)({ host: 'a.example', pubkey: 'B', level: 'blocked' });
  assert.equal(w.levels['B|a.example'], 'blocked');
  assert.equal(w.levels['A|a.example'], undefined, 'the active account’s tier moved with it');
});

test('SET_LEVEL without an account still means the active account', async () => {
  const w = world();
  await handler('SIDECAR_SET_LEVEL', w)({ host: 'a.example', level: 'trusted' });
  assert.equal(w.levels['A|a.example'], 'trusted');
  assert.equal(w.levels['B|a.example'], undefined);
});

test('SET_LEVEL refuses an account Sidecar does not hold, and writes nothing', async () => {
  const w = world();
  await assert.rejects(handler('SIDECAR_SET_LEVEL', w)({ host: 'a.example', pubkey: 'ghost', level: 'trusted' }), /Unknown account/);
  assert.deepEqual(w.levels, {}, 'a tier was written for a key nobody holds');
});

test('GET_SITE_LEVELS reads every signed-in account’s tier for the host, ask when unset', async () => {
  const w = world();
  w.levels['B|a.example'] = 'readonly';
  w.levels['A|other.example'] = 'trusted'; // another host must not leak in
  const got = await handler('SIDECAR_GET_SITE_LEVELS', w)({ host: 'a.example' });
  assert.deepEqual(JSON.parse(JSON.stringify(got)), { A: 'ask', B: 'readonly' });
});

test('GET_SITE_LEVELS covers only accounts signed in there', async () => {
  const w = world();
  w.authorized = ['B'];
  const got = await handler('SIDECAR_GET_SITE_LEVELS', w)({ host: 'a.example' });
  assert.deepEqual(Object.keys(got), ['B']);
});
