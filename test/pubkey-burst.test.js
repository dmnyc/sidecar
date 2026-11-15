'use strict';

// A site that asks for the public key from every component it mounts queued one identical
// "wants to see your public key" card per call (seventeen on opening one site). The answer
// to the first now covers the rest of that host's backlog. These run the real settlePrompt,
// the real flush and the real window helpers against a real queue.

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

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

// A worker with `entries` waiting, each with a live callback that records how it settled.
function worker(entries) {
  const queue = [];
  const callbacks = new Map();
  const settled = {};
  entries.forEach((e, i) => {
    const id = 'p' + i;
    queue.push({
      id, host: e.host, method: e.method || 'getPublicKey', kind: null, state: 'queued', display: 'none',
      data: { host: e.host, method: e.method || 'getPublicKey', activePubkey: e.pubkey || ME, otherAccounts: [{ pubkey: OTHER }] },
    });
    callbacks.set(id, { settled: false, resolve: (d) => { settled[id] = d; } });
  });
  const ctx = vm.createContext({
    queue, callbacks, pubkeyGrants: new Map(), decryptGrants: new Map(), PUBKEY_WINDOW_MS: 20000,
    DECRYPT_METHODS: new Set(['nip04.decrypt', 'nip44.decrypt']), Date,
    qPersist() {}, broadcastQueue() {}, driveDisplay() {}, dlog() {}, stopKeepaliveIfIdle() {}, flushDecryptSiblings() {}, grantDecrypt() {},
  });
  vm.runInContext([
    lift('function pubkeyGrantKey('), lift('function hasPubkeyGrant('), lift('function grantPubkey('),
    lift('function flushPubkeySiblings('), lift('function settlePrompt('),
    'this.api = { settlePrompt, hasPubkeyGrant };',
  ].join('\n'), ctx);
  return { ctx, queue, settled };
}

test('approving one getPublicKey settles the same site\'s waiting ones, and only those', () => {
  const w = worker([
    { host: 'poll.example' }, { host: 'poll.example' }, { host: 'poll.example' },
    { host: 'other.example' },
    { host: 'poll.example', pubkey: OTHER },
    { host: 'poll.example', method: 'signEvent' },
  ]);
  w.ctx.api.settlePrompt('p0', 'once');
  for (const id of ['p0', 'p1', 'p2']) assert.equal(w.settled[id].action, 'once', id + ' still waiting');
  assert.equal(w.settled.p1.coalesced, true, 'a sibling must be marked so it is not counted as an approval');
  assert.equal(w.settled.p0.coalesced, undefined);
  assert.equal(w.settled.p3, undefined, 'another site was answered');
  assert.equal(w.settled.p4, undefined, 'another account was answered');
  assert.equal(w.settled.p5, undefined, 'a signing request was answered by a login approval');
  assert.deepEqual(w.queue.map((e) => e.id), ['p3', 'p4', 'p5']);
});

test('rejecting one rejects the rest of that site\'s backlog', () => {
  const w = worker([{ host: 'poll.example' }, { host: 'poll.example' }, { host: 'other.example' }]);
  w.ctx.api.settlePrompt('p0', 'reject');
  assert.equal(w.settled.p1.action, 'reject');
  assert.equal(w.settled.p2, undefined);
  assert.equal(w.ctx.api.hasPubkeyGrant('poll.example', ME), false, 'a rejection must not open a window');
});

test('Trust settles the siblings as a plain approval, not as another Trust', () => {
  const w = worker([{ host: 'poll.example' }, { host: 'poll.example' }]);
  w.ctx.api.settlePrompt('p0', 'trust');
  assert.equal(w.settled.p1.action, 'once');
});

test('the account picked in the switcher goes with the siblings, and the window follows it', () => {
  const w = worker([{ host: 'poll.example' }, { host: 'poll.example' }]);
  w.ctx.api.settlePrompt('p0', 'once', { switchToPubkey: OTHER });
  assert.equal(w.settled.p1.switchToPubkey, OTHER);
  assert.equal(w.ctx.api.hasPubkeyGrant('poll.example', OTHER), true);
  assert.equal(w.ctx.api.hasPubkeyGrant('poll.example', ME), false);
});

test('an account the card never offered is not carried or granted', () => {
  const w = worker([{ host: 'poll.example' }, { host: 'poll.example' }]);
  w.ctx.api.settlePrompt('p0', 'once', { switchToPubkey: 'c'.repeat(64) });
  assert.equal(w.settled.p1.switchToPubkey, undefined);
  assert.equal(w.ctx.api.hasPubkeyGrant('poll.example', ME), true);
  assert.equal(w.ctx.api.hasPubkeyGrant('poll.example', 'c'.repeat(64)), false);
});

test('the window is short, per site and per account, and a sibling does not extend it', () => {
  const w = worker([{ host: 'poll.example' }, { host: 'poll.example' }]);
  const realNow = Date.now;
  const t0 = realNow();
  try {
    Date.now = () => t0;
    w.ctx.api.settlePrompt('p0', 'once');
    assert.equal(w.ctx.api.hasPubkeyGrant('poll.example', ME), true);
    assert.equal(w.ctx.api.hasPubkeyGrant('other.example', ME), false);
    assert.equal(w.ctx.api.hasPubkeyGrant('poll.example', OTHER), false);
    // The flushed sibling settled with coalesced:true; had it re-granted, this would be later.
    assert.equal(w.ctx.pubkeyGrants.get('poll.example|' + ME), t0 + 20000);
    Date.now = () => t0 + 19999;
    assert.equal(w.ctx.api.hasPubkeyGrant('poll.example', ME), true);
    Date.now = () => t0 + 20000;
    assert.equal(w.ctx.api.hasPubkeyGrant('poll.example', ME), false, 'the window outlived its 20 seconds');
  } finally {
    Date.now = realNow;
  }
});

test('the worker consults the window, and a coalesced sibling is not counted toward the Trust nudge', () => {
  const handler = src.slice(src.indexOf('async function handleNostrRpc'));
  const code = handler.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(code, /const pubkeyCoalesced = method === 'getPublicKey' && hasPubkeyGrant\(host, activePubkey\)/);
  assert.match(code, /decryptCoalesced \|\| pubkeyCoalesced \|\|/, 'the window is not wired into needApproval');
  assert.match(code, /if \(!\(method === 'getPublicKey' && decision\.coalesced === true\)\) \{\s*if \(decision\.action === 'once'\) await bumpApproveCount\(/);
});
