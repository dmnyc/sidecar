'use strict';

// Where the writers look for the list they are about to replace. A kind 10000 or 3 is
// published to the account's write relays and read back from its read relays, and either set
// can hold the newest version. A writer that asks only the read relays either finds nothing
// to change and reports success, or builds the replacement from an older copy and publishes
// it over the newer one. These run the real writers against relays where an event lives on
// only some of them.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('./helpers/i18n');

const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}
const plain = (x) => JSON.parse(JSON.stringify(x));

const ME = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAL = 'c'.repeat(64);
const DAN = 'd'.repeat(64);
const READ = 'wss://read.test';
const WRITE = 'wss://write.test';

const CODE = [
  lift(/  const emptyMuteSet = [^\n]*\n/, 'emptyMuteSet'),
  lift(/  function collectMuteTags\(tags, into\) \{[\s\S]*?\n  \}\n/, 'collectMuteTags'),
  lift(/  function applyLocalMutes\(entries, set\) \{[\s\S]*?\n  \}\n/, 'applyLocalMutes'),
  lift(/  async function listRelays\(pubkey\) \{[\s\S]*?\n  \}\n/, 'listRelays'),
  lift(/  let _muteWrite = [^\n]*\n  function changeMute\([\s\S]*?\n  \}\n  const addPrivateMute = [^\n]*\n  const removeMute = [^\n]*\n/, 'changeMute'),
  lift(/  async function writeMute\([\s\S]*?\n  \}\n/, 'writeMute'),
  lift(/  let _followWrite = [^\n]*\n  function changeFollow\([\s\S]*?\n  \}\n  const addFollow = [^\n]*\n  const removeFollow = [^\n]*\n/, 'changeFollow'),
  lift(/  async function writeFollow\([\s\S]*?\n  \}\n/, 'writeFollow'),
].join('\n');

// `only` pins an event to one relay, the way a version that has not reached the others is.
function world(events) {
  const w = { published: [], asked: [], events: events.slice() };
  const ctx = withI18n({
    state: { activePubkey: ME },
    _muteLists: new Map(), _localMutes: new Map(),
    followListCache: null, followListPubkey: null, followCountCache: new Map(),
    NT: { nip19: { npubEncode: (h) => 'npub1' + h.slice(0, 6) } },
    shortNpub: (n) => n, forgetWot: () => {},
    readRelayUrls: async () => [READ],
    postRelays: async () => [WRITE],
    poolQuerySync: async (relays, f) => {
      w.asked.push(relays.slice());
      const out = w.events.filter((e) => f.kinds.includes(e.kind) && (!e.only || relays.includes(e.only)));
      if (f.kinds.includes(0)) out.push({ kind: 0, created_at: 1, tags: [], content: '{}' });
      return out;
    },
    publishSigned: async (ev) => { w.published.push(ev); w.events = w.events.filter((e) => e.kind !== ev.kind).concat(ev); },
    seedBaseline: () => {}, pruneNameMuted: () => {},
    call: async (m) => {
      if (m.type === 'SIDECAR_OWNER_DECRYPT') return String(m.ciphertext).replace(/^nip44:/, '');
      if (m.type === 'SIDECAR_OWNER_ENCRYPT') return 'nip44:' + m.plaintext;
      if (m.type === 'SIDECAR_OWNER_SIGN') return { ...m.event, id: 'f'.repeat(64), pubkey: ME, sig: '0'.repeat(128) };
      throw new Error('unexpected ' + m.type);
    },
  });
  vm.createContext(ctx);
  vm.runInContext(CODE + '\nglobalThis.api = { addPrivateMute, removeMute, addFollow, removeFollow };', ctx);
  w.api = ctx.api; w.ctx = ctx;
  return w;
}
const list10000 = (over) => ({ kind: 10000, created_at: 100, tags: [], content: '', ...over });
const list3 = (over) => ({ kind: 3, created_at: 100, tags: [], content: '', ...over });
const pTags = (ev) => plain(ev.tags.filter((t) => t[0] === 'p').map((t) => t[1]));

test('both the read and the write relays are asked', async () => {
  const w = world([list10000({ tags: [['p', BOB]] })]);
  await w.api.removeMute(ME, ['p', BOB]);
  assert.deepEqual(plain(w.asked[0]), [READ, WRITE]);
});

test('UNMUTE: a list that lives only on the write relays is found, and the person is taken out of it', async () => {
  const w = world([list10000({ only: WRITE, created_at: 200, tags: [['p', BOB], ['p', CAL]] })]);
  assert.equal(await w.api.removeMute(ME, ['p', BOB]), true);
  assert.equal(w.published.length, 1, 'something was published');
  assert.deepEqual(pTags(w.published[0]), [CAL]);
});

test('UNMUTE: the newest copy wins over an older one the read relays still serve', async () => {
  const newest = Math.floor(Date.now() / 1000) + 3600;
  const w = world([
    list10000({ only: READ, created_at: newest - 500, tags: [['p', CAL]] }),
    list10000({ only: WRITE, created_at: newest, tags: [['p', BOB], ['p', CAL]] }),
  ]);
  assert.equal(await w.api.removeMute(ME, ['p', BOB]), true);
  assert.deepEqual(pTags(w.published[0]), [CAL]);
  assert.equal(w.published[0].created_at, newest + 1, 'newer than the newest, not the stale one');
});

test('MUTE: an older copy on the read relays is not published over a newer list', async () => {
  const w = world([
    list10000({ only: READ, created_at: 50, tags: [['p', CAL]] }),
    list10000({ only: WRITE, created_at: 200, tags: [['p', BOB], ['p', CAL]] }),
  ]);
  assert.equal(await w.api.addPrivateMute(ME, ['p', DAN]), true);
  assert.deepEqual(pTags(w.published[0]), [BOB, CAL], 'every entry of the newest list survives');
  assert.deepEqual(JSON.parse(w.published[0].content.replace(/^nip44:/, '')), [['p', DAN]]);
});

test('an unmute that finds the person on no copy says nothing changed and publishes nothing', async () => {
  const w = world([list10000({ only: WRITE, created_at: 200, tags: [['p', CAL]] })]);
  assert.equal(await w.api.removeMute(ME, ['p', BOB]), false);
  assert.equal(w.published.length, 0);
  assert.equal(w.ctx._muteLists.get(ME).pubkeys.has(BOB), false, 'what the panel holds agrees with the list it read');
});

test('UNFOLLOW: a follow list that lives only on the write relays is found', async () => {
  const w = world([list3({ only: WRITE, created_at: 200, tags: [['p', BOB], ['p', CAL]] })]);
  assert.equal(await w.api.removeFollow(ME, BOB), true);
  assert.deepEqual(pTags(w.published[0]), [CAL]);
});

test('FOLLOW: an older follow list on the read relays is not published over a newer one', async () => {
  const w = world([
    list3({ only: READ, created_at: 50, tags: [['p', CAL]] }),
    list3({ only: WRITE, created_at: 200, tags: [['p', BOB], ['p', CAL]] }),
  ]);
  assert.equal(await w.api.addFollow(ME, DAN), true);
  assert.deepEqual(pTags(w.published[0]), [BOB, CAL, DAN]);
});

test('the shared lookup is what both writers use, so they cannot disagree again', () => {
  const mute = source.slice(source.indexOf('async function writeMute('), source.indexOf('async function writeMute(') + 900);
  const follow = source.slice(source.indexOf('async function writeFollow('), source.indexOf('async function writeFollow(') + 900);
  assert.match(mute, /const relays = await listRelays\(pubkey\);/);
  assert.match(follow, /const relays = await listRelays\(pubkey\);/);
  assert.doesNotMatch(mute + follow, /readRelayUrls\(pubkey\)/);
});
