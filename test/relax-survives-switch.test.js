'use strict';

// SWITCHING ACCOUNTS LEAVES THE 30-MINUTE WINDOWS RUNNING. Each window is keyed to a site
// and an account and only covers signing as that account, yet two rules still ended them:
// switching Sidecar's active account ended every window everywhere, and posting on a site
// as a different account than it last used ended that site's. So on a site with two
// accounts, opening the second account's window closed the first one's (lab cases 4.5 and
// 4.6). Both handlers are run here, lifted from background.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

function liftBlock(from) {
  const at = src.indexOf(from);
  assert.ok(at !== -1, from + ' is gone');
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + from);
}

function relaxSpy() {
  const calls = [];
  return {
    calls,
    RELAX: {
      revokeAll: async () => { calls.push('revokeAll'); },
      revokeForHost: async (h) => { calls.push('revokeForHost:' + h); },
      revoke: async (h, pk) => { calls.push('revoke:' + h + '|' + pk); },
    },
  };
}

test('switching the active account keeps every window', async () => {
  const { calls, RELAX } = relaxSpy();
  let active = 'A';
  const ctx = {
    RELAX, syncRelaxBadge() {},
    KS: { getActivePubkey: async () => active, setActive: async (pk) => { active = pk; return true; } },
    message: { type: 'SIDECAR_SET_ACTIVE', pubkey: 'B' },
  };
  vm.createContext(ctx);
  const body = liftBlock("case 'SIDECAR_SET_ACTIVE': {");
  const out = await vm.runInContext(
    '(async () => { let result; switch (message.type) { ' + body + ' } return result; })()', ctx);
  assert.equal(out, true);
  assert.equal(active, 'B', 'the switch did not happen');
  assert.deepEqual(calls, [], 'switching accounts ended a window');
});

test('posting on a site as another account rebinds it and keeps its windows', async () => {
  for (const [method, sharedIdentity, authorSwitched] of [
    ['signEvent', true, false],      // picked the other account on the card
    ['signEvent', false, true],      // the client posted as the other author
    ['getPublicKey', false, false],  // re-login as the other account
  ]) {
    const { calls, RELAX } = relaxSpy();
    const binds = [];
    const ctx = {
      RELAX, syncRelaxBadge() {}, relaxJustGrantedFor: null,
      method, sharedIdentity, authorSwitched, host: 'shared.example', activePubkey: 'B',
      getSiteAccount: async () => 'A',
      setSiteAccount: async (h, pk) => { binds.push(h + '|' + pk); },
    };
    vm.createContext(ctx);
    const block = liftBlock("if (method === 'getPublicKey' || authorSwitched || sharedIdentity || !(await getSiteAccount(host))) {");
    await vm.runInContext('(async () => { ' + block + ' })()', ctx);
    assert.deepEqual(binds, ['shared.example|B'], method + ': the site was not rebound');
    assert.deepEqual(calls, [], method + ': rebinding ended a window');
  }
});

test('lock and forgetting the site still end windows', () => {
  // The two that stay, by design: a lock removes the keys, and forgetting a site removes
  // every approval it had.
  assert.match(src, /A lock ends any active relax window[\s\S]{0,300}RELAX\.revokeAll\(\)\.then\(syncRelaxBadge\);/);
  assert.match(src, /await RELAX\.revokeForHost\(message\.host\); \/\/ and a timed Auto-sign window/);
});
