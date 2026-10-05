'use strict';

// The bell's sender names, run rather than read. Notifications kept showing short npubs
// for two reasons: the lookup asked only the configured relays, which rarely carry a
// stranger's kind:0, and a row added while the sheet was open (a live arrival) kept the
// npub it was drawn with, because nothing looked at it again. These lift the bell's
// lookup functions out of sidepanel.js and run them against a stubbed profilesFor and
// stub rows.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');

function lift(decl) {
  const at = src.indexOf(decl);
  assert.ok(at !== -1, 'sidepanel.js no longer has ' + decl);
  const open = src.indexOf('{', src.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

const PK = (n) => String(n).repeat(64).slice(0, 64);

function bell({ answers = {}, fail = false } = {}) {
  const calls = [];
  const rows = [];
  const ctx = {
    calls, rows,
    _notifProfiles: new Map(),
    setTimeout, Promise, Set, Map,
    profilesFor: async (pks) => {
      calls.push([...pks]);
      if (fail) throw new Error('relays down');
      return new Map(pks.map((pk) => [pk, answers[pk] ? { name: answers[pk] } : null]));
    },
    document: {
      querySelectorAll: (sel) => {
        const m = /data-sender-pubkey="([0-9a-f]+)"/.exec(sel);
        return rows.filter((r) => r.pubkey === m[1]);
      },
    },
  };
  ctx.notifProfileName = (pk) => ctx._notifProfiles.get(pk) || '';
  vm.createContext(ctx);
  vm.runInContext([
    'const _notifProfileInflight = new Set();',
    src.match(/const notifProfileNeeded = .*;/)[0],
    lift('function patchNotifNames('),
    'let _notifLiveQueue = null;',
    lift('function prefetchNotifProfile(pubkey, relays)'),
    lift('async function prefetchNotifProfiles(pubkeys, relays)'),
    'globalThis.api = { prefetchNotifProfile, prefetchNotifProfiles, inflight: _notifProfileInflight };',
  ].join('\n'), ctx);
  const row = (pubkey) => { const r = { pubkey, textContent: 'npub1short…' }; rows.push(r); return r; };
  return { ...ctx.api, calls, row, names: ctx._notifProfiles };
}

test('a burst of live arrivals is one lookup, and every row showing them gets the name', async () => {
  const b = bell({ answers: { [PK(1)]: 'Alice', [PK(2)]: 'Bob' } });
  const rows = [b.row(PK(1)), b.row(PK(1)), b.row(PK(2))];
  await Promise.all([b.prefetchNotifProfile(PK(1), []), b.prefetchNotifProfile(PK(1), []), b.prefetchNotifProfile(PK(2), [])]);
  assert.equal(b.calls.length, 1, 'each arrival asked on its own');
  assert.deepEqual(b.calls[0].sort(), [PK(1), PK(2)].sort());
  assert.deepEqual(rows.map((r) => r.textContent), ['Alice', 'Alice', 'Bob'], 'a live row kept its npub');
});

test('the page batch names the rows already drawn', async () => {
  const b = bell({ answers: { [PK(3)]: 'Carol' } });
  const r = b.row(PK(3));
  await b.prefetchNotifProfiles([PK(3), PK(3)], []);
  assert.deepEqual(b.calls, [[PK(3)]], 'one query, each sender once');
  assert.equal(r.textContent, 'Carol');
});

test('an unanswered or failed lookup is not remembered as nameless', async () => {
  const b = bell({ answers: {} });
  const r = b.row(PK(4));
  await b.prefetchNotifProfiles([PK(4)], []);
  assert.equal(b.names.has(PK(4)), false);
  assert.equal(r.textContent, 'npub1short…');
  assert.equal(b.inflight.size, 0, 'the in-flight mark stayed set, so it is never asked again');
  await b.prefetchNotifProfiles([PK(4)], []);
  assert.equal(b.calls.length, 2, 'the next render did not ask again');

  const down = bell({ fail: true });
  await down.prefetchNotifProfiles([PK(5)], []);
  assert.equal(down.inflight.size, 0);
  assert.equal(down.names.size, 0);
});

test('a sender already named or already being asked is not asked again', async () => {
  const b = bell({ answers: { [PK(6)]: 'Dee' } });
  await b.prefetchNotifProfiles([PK(6)], []);
  await b.prefetchNotifProfiles([PK(6)], []);
  await b.prefetchNotifProfile(PK(6), []);
  assert.equal(b.calls.length, 1);
});
