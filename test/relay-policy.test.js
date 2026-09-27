'use strict';

// getRelays() TELLS A CLIENT THE ACCOUNT'S RELAYS, BY THE RULE THE PANEL POSTS BY (#274).
//
// Reported from real use: posts failed in Jumble on a relay outside the account's NIP-65
// set, with the account set to use only its own relays. The panel honored that setting;
// getRelays(), which the client asked, returned the bootstrap set regardless. Both now
// come from relay-policy.js, and the background answers from the account's last known
// list, which it keeps current by saving every kind:10002 it signs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const ctx = { self: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(read('relay-policy.js'), ctx);
const P = ctx.self.SidecarRelayPolicy;

const plain = (o) => JSON.parse(JSON.stringify(o));
const LIST = { read: ['wss://mine-read', 'wss://mine-both'], write: ['wss://mine-both', 'wss://mine-write'] };
const CONFIGURED = {
  'wss://boot': { read: true, write: true },
  'wss://boot-readonly': { read: true, write: false },
};

// ---- the rule -------------------------------------------------------------------------

test('BOOTSTRAP OFF WITH A LIST: THE DECLARED RELAYS AND NOTHING ELSE', () => {
  const m = plain(P.relayMap({ list: LIST, configured: CONFIGURED, bootstrap: false }));
  assert.deepEqual(m, {
    'wss://mine-read': { read: true, write: false },
    'wss://mine-both': { read: true, write: true },
    'wss://mine-write': { read: false, write: true },
  });
});

test('BOOTSTRAP OFF WITH NO LIST KNOWN: NOTHING, NOT THE RELAYS IT OPTED OUT OF', () => {
  assert.deepEqual(plain(P.relayMap({ list: null, configured: CONFIGURED, bootstrap: false })), {});
});

test('bootstrap on with a list: declared first, then the bootstrap set', () => {
  const m = P.relayMap({ list: LIST, configured: CONFIGURED, bootstrap: true });
  assert.deepEqual(Object.keys(m), ['wss://mine-read', 'wss://mine-both', 'wss://mine-write', 'wss://boot', 'wss://boot-readonly']);
  assert.deepEqual(plain(P.writeRelays(m)), ['wss://mine-both', 'wss://mine-write', 'wss://boot']);
});

test('bootstrap on with no list: the bootstrap set, as before', () => {
  assert.deepEqual(plain(P.relayMap({ list: null, configured: CONFIGURED, bootstrap: true })), CONFIGURED);
});

test('a relay in both sets keeps the union of its flags', () => {
  const m = P.relayMap({ list: { read: ['wss://boot-readonly'], write: [] }, configured: { 'wss://boot-readonly': { read: false, write: true } }, bootstrap: true });
  assert.deepEqual(plain(m), { 'wss://boot-readonly': { read: true, write: true } });
});

test('a bootstrap relay marked write:false is never a write target', () => {
  const m = P.relayMap({ list: null, configured: CONFIGURED, bootstrap: true });
  assert.deepEqual(plain(P.writeRelays(m)), ['wss://boot']);
});

test('a kind:10002 reads the way NIP-65 says', () => {
  assert.deepEqual(plain(P.listFromTags([
    ['r', 'wss://both'], ['r', 'wss://r', 'read'], ['r', 'wss://w', 'write'],
    ['p', 'x'], ['r'], ['r', 'wss://odd', 'sometimes'],
  ])), { read: ['wss://both', 'wss://r'], write: ['wss://both', 'wss://w'] });
  assert.equal(P.listFromTags([]), null, 'a list naming no relay is no list');
  assert.equal(P.listFromTags(undefined), null);
});

// ---- the background -------------------------------------------------------------------

const bg = read('background.js');
function liftBg(decl) {
  const at = bg.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = bg.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < bg.length; j++) {
    if (bg[j] === '{') depth++;
    else if (bg[j] === '}' && --depth === 0) return bg.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

const PK = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function background(store) {
  const sget = async (keys) => {
    const out = {};
    for (const k of [].concat(keys)) if (store[k] !== undefined) out[k] = structuredClone(store[k]);
    return out;
  };
  const sset = async (obj) => { Object.assign(store, structuredClone(obj)); };
  // eslint-disable-next-line no-new-func
  return new Function('sget', 'sset', 'RELAY_POLICY', 'DEFAULT_RELAYS', `
    const NIP65_STORE = 'sidecar_nip65';
    let nip65StoreWrites = Promise.resolve();
    ${liftBg('async function relaysForAccount(')}
    ${liftBg('function rememberSignedRelayList(')}
    return { relaysForAccount, rememberSignedRelayList };`)(sget, sset, P, { 'wss://default': { read: true, write: true } });
}

test('THE BACKGROUND ANSWERS FROM THE ACCOUNT\'S SAVED LIST AND ITS OWN SWITCH', async () => {
  const store = {
    sidecar_relays: CONFIGURED,
    sidecar_settings: { nip65OnlyBy: { [PK]: true } },
    sidecar_nip65: { [PK]: { ...LIST, at: 1 }, [OTHER]: { read: ['wss://theirs'], write: ['wss://theirs'], at: 1 } },
  };
  const b = background(store);
  assert.deepEqual(Object.keys(await b.relaysForAccount(PK)), ['wss://mine-read', 'wss://mine-both', 'wss://mine-write'],
    'bootstrap off: declared only');
  assert.deepEqual(Object.keys(await b.relaysForAccount(OTHER)), ['wss://theirs', 'wss://boot', 'wss://boot-readonly'],
    'another account, switch on: its own list plus bootstrap, never the first account\'s');
});

test('an account with nothing saved: bootstrap when on, nothing when off', async () => {
  const on = background({ sidecar_relays: CONFIGURED });
  assert.deepEqual(plain(await on.relaysForAccount(PK)), CONFIGURED);
  const off = background({ sidecar_relays: CONFIGURED, sidecar_settings: { nip65OnlyBy: { [PK]: true } } });
  assert.deepEqual(plain(await off.relaysForAccount(PK)), {});
});

test('no configured relays saved yet falls back to the defaults', async () => {
  assert.deepEqual(Object.keys(await background({}).relaysForAccount(PK)), ['wss://default']);
});

test('A KIND:10002 IT SIGNS BECOMES THAT ACCOUNT\'S SAVED LIST', async () => {
  const store = { sidecar_nip65: { [OTHER]: { read: ['wss://theirs'], write: [], at: 1 } } };
  const b = background(store);
  await b.rememberSignedRelayList({ kind: 10002, pubkey: PK, tags: [['r', 'wss://new']] });
  assert.deepEqual(store.sidecar_nip65[PK].write, ['wss://new']);
  assert.deepEqual(store.sidecar_nip65[OTHER].read, ['wss://theirs'], 'other accounts untouched');
});

test('a signed empty list clears the saved one, and anything else is ignored', async () => {
  const store = { sidecar_nip65: { [PK]: { ...LIST, at: 1 } } };
  const b = background(store);
  await b.rememberSignedRelayList({ kind: 1, pubkey: PK, tags: [['r', 'wss://nope']] });
  assert.ok(store.sidecar_nip65[PK], 'a note is not a relay list');
  await b.rememberSignedRelayList({ kind: 10002, pubkey: 'not-hex', tags: [['r', 'wss://nope']] });
  assert.equal(Object.keys(store.sidecar_nip65).length, 1);
  await b.rememberSignedRelayList({ kind: 10002, pubkey: PK, tags: [] });
  assert.equal(store.sidecar_nip65[PK], undefined);
});

test('two lists signed at once both land', async () => {
  const store = {};
  const b = background(store);
  await Promise.all([
    b.rememberSignedRelayList({ kind: 10002, pubkey: PK, tags: [['r', 'wss://a']] }),
    b.rememberSignedRelayList({ kind: 10002, pubkey: OTHER, tags: [['r', 'wss://b']] }),
  ]);
  assert.ok(store.sidecar_nip65[PK] && store.sidecar_nip65[OTHER], 'serialized, so neither write drops the other');
});

test('getRelays answers for the site\'s account, and both signing paths save a list', () => {
  assert.match(bg, /if \(method === 'getRelays'\) \{\s*result = await relaysForAccount\(activePubkey\);/);
  assert.match(bg, /if \(method === 'signEvent' && result && result\.kind === 10002\) await rememberSignedRelayList\(result\);/);
  assert.match(liftBg("case 'SIDECAR_OWNER_SIGN': {"), /if \(result && result\.kind === 10002\) await rememberSignedRelayList\(result\);/);
});

// ---- loaded everywhere it is used ------------------------------------------------------

test('the module is loaded by the Chrome worker, the Firefox background and the panel', () => {
  assert.match(bg, /importScripts\([^)]*'relay-policy\.js'/);
  const manifest = JSON.parse(read('manifest.json'));
  const scripts = manifest.background.scripts;
  assert.ok(scripts.indexOf('relay-policy.js') !== -1 && scripts.indexOf('relay-policy.js') < scripts.indexOf('background.js'),
    'Firefox loads it before background.js');
  const html = read('sidepanel.html');
  assert.ok(html.indexOf('src="relay-policy.js"') !== -1 && html.indexOf('src="relay-policy.js"') < html.indexOf('src="sidepanel.js"'),
    'the panel loads it before sidepanel.js');
});
