'use strict';

// DRAFTS ON RELAYS (NIP-37). A draft saved to relays is a kind 31234 whose content is the
// unsigned event Post would build, NIP-44 encrypted to the account's own key, sent to the
// private relays its kind 10013 lists. These run composer-core's codec and its relay
// controller for real, against nostr-tools' own NIP-44 and signatures standing in for the
// worker, and an in-memory relay standing in for the network.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('./helpers/i18n');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function loadCore() {
  const ctx = {
    console, setTimeout, clearTimeout, URL, TextEncoder, TextDecoder,
    navigator: { language: 'en' }, crypto: require('node:crypto').webcrypto,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: { lang: 'en', setAttribute() {}, dir: '' }, querySelectorAll: () => [] },
    chrome: { runtime: { getURL: (p) => p } },
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('nostr-tools.js'), ctx);
  vm.runInContext(read('i18n.js'), ctx);
  vm.runInContext(read('composer-core.js'), ctx);
  return ctx;
}
const core = loadCore();
const SC = core.SidecarCore;
const NT = core.NostrTools;
const plain = (x) => JSON.parse(JSON.stringify(x)); // across the vm's realm
// And the other way: nostr-tools checks an event is a plain object of ITS realm.
const vmParse = vm.runInContext('JSON.parse', core);
const inRealm = (x) => vmParse(JSON.stringify(x));
const sign = (template) => NT.finalizeEvent(inRealm(template), SK);

const SK = NT.generateSecretKey();
const PK = NT.getPublicKey(SK);
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const NOTE = '1'.repeat(64);
const ROOT_ID = '2'.repeat(64);
const COMMENT = '3'.repeat(64);

// The worker's three owner messages, done the way the worker does them, plus the store.
function fakeWorld({ settings = {}, store = {}, accountRelays, known = null } = {}) {
  const relay = [];     // every event published, in order
  const published = []; // { relays, event }
  const calls = [];
  let answers = { answered: true, complete: true };
  const ck = NT.nip44.v2.utils.getConversationKey(SK, PK);
  const call = async (msg) => {
    calls.push(msg.type);
    switch (msg.type) {
      case 'SIDECAR_OWNER_ENCRYPT':
        assert.equal(msg.nip, 44); assert.equal(msg.peer, PK); assert.equal(msg.expectedPubkey, PK);
        return NT.nip44.v2.encrypt(msg.plaintext, ck);
      case 'SIDECAR_OWNER_DECRYPT':
        assert.equal(msg.nip, 44); assert.equal(msg.peer, PK);
        return NT.nip44.v2.decrypt(msg.ciphertext, ck);
      case 'SIDECAR_OWNER_SIGN':
        assert.equal(msg.expectedPubkey, PK);
        return sign(msg.event);
      case 'SIDECAR_GET_SETTINGS': return settings;
      case 'SIDECAR_GET_ACCOUNT_RELAYS':
        assert.equal(msg.pubkey, PK);
        return accountRelays || {
          'wss://write.example': { read: true, write: true },
          'wss://two.example': { read: true, write: true },
          'wss://read.example': { read: true, write: false },
        };
      case 'SIDECAR_SECRET_GET': return JSON.parse(JSON.stringify(store));
      case 'SIDECAR_SECRET_SET': store = JSON.parse(JSON.stringify(msg.value)); return true;
      default: throw new Error('unexpected ' + msg.type);
    }
  };
  const io = {
    call, NT,
    query: async (relays, filter) => ({
      events: answers.answered ? relay.filter((ev) => filter.kinds.includes(ev.kind)
        && (!filter.authors || filter.authors.includes(ev.pubkey))) : [],
      ...answers,
    }),
    publish: async (relays, event) => { published.push({ relays, event }); relay.push(event); return relays.length; },
    readRelays: async () => ['wss://write.example'],
    writeRelays: async () => ['wss://write.example'],
    warn: (m) => calls.push('warn:' + m),
    knownRelayList: async () => known,
    relayListChanged: (pk) => calls.push('changed:' + pk),
  };
  return {
    io, relay, published, calls,
    get store() { return store; },
    setAnswers: (a) => { answers = a; },
    controller: SC.installRelayDrafts(io),
  };
}

const privateList = (urls) => sign({
  kind: 10013, created_at: 1000, tags: [],
  content: NT.nip44.v2.encrypt(JSON.stringify(urls.map((u) => ['relay', u])), NT.nip44.v2.utils.getConversationKey(SK, PK)),
});

// ---- the codec ----

test('a plain note goes out and comes back the same', () => {
  const npub = NT.nip19.npubEncode(ALICE);
  const draft = { text: 'Hello nostr:' + npub, media: [] };
  const ev = SC.draftToEvent(draft, { selfPubkey: PK, NT, now: 5 });
  assert.equal(ev.kind, 1);
  assert.equal(ev.created_at, 5);
  assert.equal(ev.content, 'Hello nostr:' + npub);
  assert.deepEqual(plain(ev.tags), [['client', 'Sidecar'], ['p', ALICE]], 'the client tag and the mention, as Post writes them');
  assert.deepEqual(plain(SC.draftFromEvent(plain(ev), PK)), draft);
  // Settings' client-tag opt-out reaches the draft too.
  assert.deepEqual(plain(SC.draftToEvent(draft, { selfPubkey: PK, NT, now: 5, clientTag: false }).tags), [['p', ALICE]]);
});

test('a reply with pictures, a described image and a video comes back with its target and its strip', () => {
  const ref = 'nostr:' + NT.nip19.neventEncode({ id: 'c'.repeat(64), author: BOB, relays: [] });
  const target = { id: NOTE, pubkey: ALICE, kind: 1, tags: [['e', ROOT_ID, '', 'root'], ['p', BOB]], content: 'the note' };
  const media = [
    { url: 'https://img.example/a.jpg', isVideo: false, alt: 'a cat on a mat' },
    { url: 'https://img.example/b.png', isVideo: false },
    { url: 'https://vid.example/c.mp4', isVideo: true, mime: 'video/mp4', dim: '640x480' },
    { quote: ref },
  ];
  const draft = { text: 'Look at these', media, replyTo: target };
  const ev = plain(SC.draftToEvent(draft, { selfPubkey: PK, NT, now: 9 }));
  assert.equal(ev.kind, 1);
  assert.deepEqual(ev.tags.slice(0, 2), [['e', ROOT_ID, '', 'root'], ['e', NOTE, '', 'reply']], 'threading leads');
  assert.ok(ev.tags.some((tg) => tg[0] === 'imeta' && tg.includes('alt a cat on a mat')));
  assert.ok(ev.tags.some((tg) => tg[0] === 'q' && tg[1] === 'c'.repeat(64)));
  assert.equal(ev.content, SC.composeNoteContent('Look at these', media));

  const back = plain(SC.draftFromEvent(ev, PK));
  assert.equal(back.text, 'Look at these');
  assert.deepEqual(back.media, media, 'the strip, in its order, with the alt and the video facts');
  assert.equal(back.replyTo.id, NOTE);
  assert.equal(back.replyTo.pubkey, ALICE);
  // And it threads the way it did: Post would build the same reply tags from it.
  const rebuilt = plain(SC.replyTags(back.replyTo, PK));
  assert.equal(rebuilt.kind, 1);
  assert.deepEqual(rebuilt.tags.filter((tg) => tg[0] === 'e'), [['e', ROOT_ID, '', 'root'], ['e', NOTE, '', 'reply']]);
  assert.deepEqual(new Set(rebuilt.tags.filter((tg) => tg[0] === 'p').map((tg) => tg[1])), new Set([ALICE, BOB]));
});

test('a kind 1111 comment keeps its NIP-22 root and scope, and opens as a 1111 again', () => {
  // A comment answering a comment, rooted on a web page: the shape replyTags builds.
  const parent = {
    id: COMMENT, pubkey: ALICE, kind: 1111,
    tags: [['I', 'https://example.com/post'], ['K', 'web'], ['i', 'https://example.com/post'], ['k', 'web'], ['p', BOB]],
    content: 'first!',
  };
  const draft = { text: 'Second.', media: [], replyTo: parent };
  const ev = plain(SC.draftToEvent(draft, { selfPubkey: PK, NT, now: 3 }));
  assert.equal(ev.kind, 1111);
  const scope = ev.tags.filter((tg) => ['I', 'K', 'E', 'A', 'P'].includes(tg[0]));
  assert.deepEqual(scope, [['I', 'https://example.com/post'], ['K', 'web']]);

  const back = plain(SC.draftFromEvent(ev, PK));
  assert.equal(back.text, 'Second.');
  assert.equal(back.replyTo.id, COMMENT);
  assert.equal(back.replyTo.kind, 1111);
  const rebuilt = plain(SC.replyTags(back.replyTo, PK));
  assert.equal(rebuilt.kind, 1111, 'still a comment, not a kind 1 reply');
  // Every threading tag the draft carried is in what Post would build from the opened one.
  for (const tg of ev.tags.filter((x) => ['I', 'K', 'E', 'A', 'P', 'e', 'k'].includes(x[0]))) {
    assert.ok(rebuilt.tags.some((r) => JSON.stringify(r) === JSON.stringify(tg)), 'kept ' + JSON.stringify(tg));
  }
});

test('a comment rooted on a note keeps its E, K and P root tags', () => {
  const inner = {
    kind: 1111, created_at: 1, content: 'deep in the thread',
    tags: [['E', ROOT_ID, 'wss://r.example', BOB], ['K', '1'], ['P', BOB], ['e', COMMENT, '', ALICE], ['k', '1111'], ['p', ALICE]],
  };
  const back = plain(SC.draftFromEvent(inner, PK));
  const rebuilt = plain(SC.replyTags(back.replyTo, PK));
  assert.equal(rebuilt.kind, 1111);
  assert.deepEqual(rebuilt.tags.slice(0, 3), [['E', ROOT_ID, 'wss://r.example', BOB], ['K', '1'], ['P', BOB]]);
  assert.ok(rebuilt.tags.some((tg) => tg[0] === 'e' && tg[1] === COMMENT));
});

test('what this composer cannot continue is not opened as something else', () => {
  // A top-level comment on a kind 1 note: replyTags would answer it as kind 1.
  assert.equal(SC.draftFromEvent({ kind: 1111, content: 'x', tags: [['E', NOTE, '', ALICE], ['K', '1'], ['e', NOTE, '', ALICE], ['k', '1']] }, PK), null);
  // A comment on a web page with no parent event: nothing to reply to here.
  assert.equal(SC.draftFromEvent({ kind: 1111, content: 'x', tags: [['I', 'https://a.example'], ['K', 'web'], ['i', 'https://a.example'], ['k', 'web']] }, PK), null);
  // Long-form, and polls: not kinds this composer drafts.
  assert.equal(SC.draftFromEvent({ kind: 30023, content: '# hi', tags: [] }, PK), null);
  assert.equal(SC.draftToEvent({ text: 'Q?', poll: { options: ['a', 'b'] } }, { selfPubkey: PK, NT, now: 1 }), null);
});

test('content that only looks like attachments stays text', () => {
  // A link that is not a picture is the person's words, not the strip.
  const ev = { kind: 1, tags: [], content: 'Read this\n\nhttps://example.com/article' };
  assert.deepEqual(plain(SC.draftFromEvent(ev, PK)), { text: 'Read this\n\nhttps://example.com/article', media: [] });
  // Two quotes in a row are two notes, and the strip holds one.
  const q1 = 'nostr:' + NT.nip19.noteEncode('d'.repeat(64));
  const q2 = 'nostr:' + NT.nip19.noteEncode('e'.repeat(64));
  const two = { kind: 1, tags: [], content: 'Both\n\n' + q1 + '\n' + q2 };
  assert.deepEqual(plain(SC.draftFromEvent(two, PK)).media, []);
});

// ---- reading back ----

const wrap = (d, k, created_at, content, extra) => ({
  kind: 31234, pubkey: PK, id: d + created_at, created_at, content,
  tags: [['d', d], ['k', String(k)], ...(extra || [])],
});

test('newest per d wins, blanked ones are deleted, expired ones are gone, other kinds are counted', () => {
  const now = 10000;
  const { live, otherKinds } = SC.liveRelayDrafts([
    wrap('a', 1, 100, 'old'), wrap('a', 1, 200, 'new'),        // newest copy wins
    wrap('b', 1, 100, 'there'), wrap('b', 1, 300, ''),         // blanked later: deleted
    wrap('c', 1, 500, 'expired', [['expiration', '9000']]),     // NIP-40, past
    wrap('d', 1111, 400, 'live', [['expiration', '20000']]),
    wrap('e', 30023, 600, 'an article'),                        // counted, not listed
    wrap('f', 1, 50, 'gone', [['expiration', '20000']]), wrap('f', 1, 60, '', [['expiration', '20000']]),
    { ...wrap('g', 1, 700, 'someone else'), pubkey: ALICE },    // not ours
  ], PK, now);
  assert.deepEqual(plain(live.map((ev) => ev.content)), ['live', 'new']);
  assert.equal(otherKinds, 1);
});

test('a blank on one relay beats an older copy on another', () => {
  const { live } = SC.liveRelayDrafts([wrap('x', 1, 300, ''), wrap('x', 1, 299, 'still here?')], PK, 1000);
  assert.equal(live.length, 0);
});

// ---- the private relay list ----

test('the 10013 content parses to its relay tags, and anything malformed fails closed', () => {
  assert.deepEqual(plain(SC.parsePrivateRelayList(JSON.stringify([['relay', 'wss://p.example'], ['relay', 'wss://p.example'], ['other', 'x'], ['relay', 'not a url']]))), ['wss://p.example']);
  assert.throws(() => SC.parsePrivateRelayList('not json'));
  assert.throws(() => SC.parsePrivateRelayList(JSON.stringify({ relay: 'wss://p.example' })));
});

test('no list where every relay answered is "none"; nobody answering is "unreachable", never "none"', async () => {
  const w = fakeWorld();
  assert.equal((await w.controller.privateRelays(PK, true)).status, 'none');
  w.setAnswers({ answered: false, complete: true });
  assert.equal((await w.controller.privateRelays(PK, true)).status, 'unreachable');
  w.setAnswers({ answered: true, complete: false });
  assert.equal((await w.controller.privateRelays(PK, true)).status, 'unreachable', 'a relay still out might hold the list');
});

test('a list that will not decrypt or parse is unreadable, and nothing offers to write over it', async () => {
  const w = fakeWorld();
  w.relay.push(sign({ kind: 10013, created_at: 1, tags: [], content: 'garbage' }));
  assert.equal((await w.controller.privateRelays(PK, true)).status, 'unreadable');
  const e = await w.controller.save(PK, { text: 'hi', media: [] }).catch((x) => x);
  assert.equal(e.relayStatus, 'unreadable');
  assert.ok(!w.published.length, 'nothing was published');
});

test('saving with no private relays says so, and set-up publishes a 10013 to the write relays', async () => {
  const w = fakeWorld();
  const e = await w.controller.save(PK, { text: 'hi', media: [] }).catch((x) => x);
  assert.equal(e.relayStatus, 'none');
  assert.equal(e.message, 'No private relays for drafts yet.');
  await w.controller.setUp(PK, ['wss://write.example', 'wss://two.example']);
  const list = w.published[0];
  assert.equal(list.event.kind, 10013);
  assert.deepEqual(plain(list.event.tags), []);
  assert.deepEqual(plain(list.relays), ['wss://write.example'], 'NIP-37: the write relays');
  const ck = NT.nip44.v2.utils.getConversationKey(SK, PK);
  assert.deepEqual(JSON.parse(NT.nip44.v2.decrypt(list.event.content, ck)), [['relay', 'wss://write.example'], ['relay', 'wss://two.example']]);
});

// ---- a first relay list (NIP-65) ----

const relayList = (author, tags) => ({ ...sign({ kind: 10002, created_at: 5, tags, content: '' }), pubkey: author });
const publishedLists = (w) => w.published.filter((p) => p.event.kind === 10002);

test('the account\'s relay list: none only when every relay answered and none holds one', async () => {
  const w = fakeWorld();
  assert.equal((await w.controller.relayListStatus(PK)).status, 'none');
  w.setAnswers({ answered: false, complete: true });
  assert.equal((await w.controller.relayListStatus(PK)).status, 'unreachable');
  w.setAnswers({ answered: true, complete: false });
  assert.equal((await w.controller.relayListStatus(PK)).status, 'unreachable', 'a relay still out might hold it');
  w.setAnswers({ answered: true, complete: true });
  // A relay is not obliged to honor the author filter.
  w.io.query = async () => ({ events: [relayList(ALICE, [['r', 'wss://hers.example']])], answered: true, complete: true });
  assert.equal((await w.controller.relayListStatus(PK)).status, 'unreachable', 'somebody else\'s list says nothing about this account');
  w.io.query = async (relays, filter) => ({ events: w.relay.filter((ev) => filter.kinds.includes(ev.kind) && ev.pubkey === PK), answered: true, complete: true });
  w.relay.push(sign({ kind: 10002, created_at: 6, tags: [['r', 'wss://mine.example']], content: '' }));
  assert.equal((await w.controller.relayListStatus(PK)).status, 'ok');
});

test('a list the page already remembers counts as one, without asking a relay', async () => {
  const w = fakeWorld({ known: { read: ['wss://old.example'], write: ['wss://old.example'] } });
  w.io.query = async () => { throw new Error('no relay should be asked'); };
  assert.equal((await w.controller.relayListStatus(PK)).status, 'ok');
});

test('a first list names the bootstrap relays with their read and write marks, and is signed by the owner', async () => {
  const w = fakeWorld();
  const res = await w.controller.publishRelayList(PK);
  const [one] = publishedLists(w);
  assert.ok(one, 'a kind 10002 went out');
  assert.deepEqual(plain(one.event.tags), [['r', 'wss://write.example'], ['r', 'wss://two.example'], ['r', 'wss://read.example', 'read']]);
  assert.equal(one.event.content, '');
  assert.deepEqual(plain(one.relays), ['wss://write.example', 'wss://two.example', 'wss://read.example']);
  assert.deepEqual(plain(res.write), ['wss://write.example', 'wss://two.example']);
  assert.ok(w.calls.includes('changed:' + PK), 'the page is told to drop what it cached');
  assert.ok(w.calls.includes('SIDECAR_OWNER_SIGN'));
});

test('a first list is never published over one that exists', async () => {
  const w = fakeWorld();
  w.relay.push(sign({ kind: 10002, created_at: 6, tags: [['r', 'wss://mine.example']], content: '' }));
  const e = await w.controller.publishRelayList(PK).catch((x) => x);
  assert.equal(e.relayStatus, 'exists');
  assert.equal(e.message, 'You already have a relay list.');
  assert.ok(!publishedLists(w).length, 'nothing was published');
});

test('the check is made again at publish time: a list that turned up after the card was drawn stops it', async () => {
  const w = fakeWorld();
  assert.equal((await w.controller.relayListStatus(PK)).status, 'none');
  w.relay.push(sign({ kind: 10002, created_at: 6, tags: [['r', 'wss://mine.example']], content: '' }));
  const e = await w.controller.publishRelayList(PK).catch((x) => x);
  assert.equal(e.relayStatus, 'exists');
  assert.ok(!publishedLists(w).length);
});

test('with no answer, or a relay still out, or a remembered list, nothing is published', async () => {
  for (const [label, setup] of [
    ['nobody answered', (w) => w.setAnswers({ answered: false, complete: true })],
    ['a relay is still out', (w) => w.setAnswers({ answered: true, complete: false })],
  ]) {
    const w = fakeWorld();
    setup(w);
    const e = await w.controller.publishRelayList(PK).catch((x) => x);
    assert.equal(e.relayStatus, 'unreachable', label);
    assert.ok(!publishedLists(w).length, label);
  }
  const w = fakeWorld({ known: { read: [], write: ['wss://old.example'] } });
  assert.equal((await w.controller.publishRelayList(PK).catch((x) => x)).relayStatus, 'exists');
  assert.ok(!publishedLists(w).length);
});

test('an account that turned the bootstrap relays off is offered nothing to publish', async () => {
  for (const accountRelays of [{}, { 'wss://read.example': { read: true, write: false } }]) {
    const w = fakeWorld({ accountRelays });
    assert.equal(await w.controller.publishRelayList(PK).catch(() => 'refused'), 'refused');
    assert.ok(!publishedLists(w).length);
  }
});

// ---- the whole trip ----

test('save, read back on another machine, open: the same draft, pointed at its relay copy', async () => {
  const w = fakeWorld({ store: { [PK]: { text: 'Draft one', media: [], savedAt: 1 } } });
  w.relay.push(privateList(['wss://private.example']));
  const ptr = await w.controller.saveEntry(PK, { key: PK, draft: w.store[PK] });
  const wrapEv = w.published[0].event;
  assert.deepEqual(plain(w.published[0].relays), ['wss://private.example'], 'to the private relays only');
  assert.equal(wrapEv.kind, 31234);
  assert.equal(wrapEv.tags.find((tg) => tg[0] === 'k')[1], '1');
  assert.equal(wrapEv.tags.find((tg) => tg[0] === 'd')[1], ptr.d);
  assert.ok(Number(wrapEv.tags.find((tg) => tg[0] === 'expiration')[1]) > wrapEv.created_at);
  assert.ok(!wrapEv.content.includes('Draft one'), 'encrypted');
  assert.equal(w.store[PK].relay.d, ptr.d, 'the local slot remembers where its copy is');
  assert.ok(!w.calls.includes('warn'), 'no approval card, no warning');

  // Another browser: the same relays, an empty store.
  const other = fakeWorld();
  other.relay.push(...w.relay);
  const res = await other.controller.list(PK);
  assert.equal(res.status, 'ok');
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].draft.text, 'Draft one');
  const opened = await other.controller.adopt(PK, res.items[0]);
  assert.equal(opened.key, PK);
  assert.equal(other.store[PK].text, 'Draft one');
  assert.equal(other.store[PK].relay.d, ptr.d);
});

test('a second save replaces the first: same d, newer', async () => {
  const w = fakeWorld({ store: { [PK]: { text: 'v1', media: [], savedAt: 1 } } });
  w.relay.push(privateList(['wss://private.example']));
  const first = await w.controller.saveEntry(PK, { key: PK, draft: w.store[PK] });
  const second = await w.controller.saveEntry(PK, { key: PK, draft: { ...w.store[PK], text: 'v2' } });
  assert.equal(second.d, first.d);
  assert.ok(second.at > first.at);
  const res = await w.controller.list(PK);
  assert.deepEqual(plain(res.items.map((it) => it.draft.text)), ['v2']);
});

test('drafts of other kinds and ones this composer cannot open are counted, not listed', async () => {
  const w = fakeWorld();
  w.relay.push(privateList(['wss://private.example']));
  const ck = NT.nip44.v2.utils.getConversationKey(SK, PK);
  const sealed = (inner, d, k) => sign({ kind: 31234, created_at: 50, tags: [['d', d], ['k', String(k)]],
    content: NT.nip44.v2.encrypt(JSON.stringify(inner), ck) });
  w.relay.push(sealed({ kind: 30023, content: '# Article', tags: [['title', 'x']] }, 'article', 30023));
  w.relay.push(sealed({ kind: 1111, content: 'on a page', tags: [['I', 'https://a.example'], ['K', 'web'], ['i', 'https://a.example'], ['k', 'web']] }, 'web', 1111));
  w.relay.push(sealed({ kind: 1, content: 'fine', tags: [] }, 'note', 1));
  const res = await w.controller.list(PK);
  assert.deepEqual(plain(res.items.map((it) => it.d)), ['note']);
  assert.equal(res.otherKinds, 1);
  assert.equal(res.unopenable, 1);
});

test('no private relay answering the draft read is "unreachable", not an empty list', async () => {
  const w = fakeWorld();
  w.relay.push(privateList(['wss://private.example']));
  await w.controller.privateRelays(PK, true);
  const realQuery = w.io.query;
  w.io.query = async (relays, filter) => (filter.kinds[0] === 31234 ? { events: [], answered: false, complete: true } : realQuery(relays, filter));
  assert.equal((await w.controller.list(PK)).status, 'unreachable');
});

// ---- cleanup ----

test('posting or deleting a draft with a relay copy blanks it: same d, newer, empty', async () => {
  const w = fakeWorld();
  w.relay.push(privateList(['wss://private.example']));
  await w.controller.forget(PK, { text: 'gone', relay: { d: 'sidecar-1', k: 1111, at: 4000000000 } });
  const blank = w.published.at(-1).event;
  assert.equal(blank.kind, 31234);
  assert.equal(blank.content, '');
  assert.deepEqual(plain(blank.tags.slice(0, 2)), [['d', 'sidecar-1'], ['k', '1111']]);
  assert.ok(blank.created_at > 4000000000, 'newer than the copy it blanks, even one from a fast clock');
});

test('a draft never saved to relays costs nothing when it goes', async () => {
  const w = fakeWorld();
  w.relay.push(privateList(['wss://private.example']));
  assert.equal(await w.controller.forget(PK, { text: 'local only' }), false);
  assert.equal(await w.controller.forget(PK, null), false);
  assert.deepEqual(w.published, []);
  assert.ok(!w.calls.includes('SIDECAR_OWNER_SIGN'));
});

test('a copy that cannot be blanked is a quiet warning, never an error', async () => {
  const w = fakeWorld();
  w.setAnswers({ answered: false, complete: true });
  assert.equal(await w.controller.forget(PK, { relay: { d: 'x', k: 1, at: 1 } }), false);
  assert.ok(w.calls.some((c) => c.startsWith('warn:')));
});

// ---- opening into the store ----

test('opening a relay note sets the note in progress aside; a busy reply slot is not written over', () => {
  const all = { [PK]: { text: 'my note', media: [], savedAt: 1 } };
  const item = { d: 'x', k: 1, at: 100, draft: { text: 'from relays', media: [] } };
  const res = plain(SC.adoptRelayDraft(all, PK, item, 2000));
  assert.equal(res.key, PK);
  assert.ok(res.shelved && res.shelved.startsWith(PK + '|n:'));
  assert.equal(all[res.shelved].text, 'my note');
  assert.equal(all[PK].text, 'from relays');
  assert.equal(all[PK].relay.d, 'x');

  const replyTo = { id: NOTE, pubkey: ALICE, kind: 1, tags: [], content: '' };
  const busy = { [PK + '|r:' + NOTE]: { text: 'my own reply', media: [], replyTo } };
  assert.equal(SC.adoptRelayDraft(busy, PK, { d: 'y', k: 1, at: 5, draft: { text: 'theirs', media: [], replyTo } }, 1).refused, true);
  assert.equal(busy[PK + '|r:' + NOTE].text, 'my own reply');
});

test('a 1111 opened from relays lands in its reply slot with its scope intact', () => {
  const inner = {
    kind: 1111, created_at: 1, content: 'reply',
    tags: [['I', 'https://example.com/x'], ['K', 'web'], ['P', BOB], ['e', COMMENT, '', ALICE], ['k', '1111'], ['p', ALICE]],
  };
  const draft = SC.draftFromEvent(inner, PK);
  const all = {};
  const res = SC.adoptRelayDraft(all, PK, { d: 'z', k: 1111, at: 7, draft }, 1);
  assert.equal(res.key, PK + '|r:' + COMMENT);
  const tags = plain(SC.replyTags(all[res.key].replyTo, PK));
  assert.equal(tags.kind, 1111);
  assert.deepEqual(tags.tags.slice(0, 3), [['I', 'https://example.com/x'], ['K', 'web'], ['P', BOB]]);
});

test('an older local copy of the same relay draft gives way, unless it was edited', () => {
  const ptr = (at, draft) => ({ d: 'same', k: 1, at, sum: SC.draftSum(draft) });
  const untouched = { text: 'v1', media: [] };
  const all = { [PK + '|n:5']: { ...untouched, relay: ptr(10, untouched) } };
  SC.adoptRelayDraft(all, PK, { d: 'same', k: 1, at: 20, draft: { text: 'v2', media: [] } }, 30);
  assert.deepEqual(Object.keys(all), [PK], 'the stale copy went');

  const edited = { [PK + '|n:5']: { text: 'v1 plus my edits', media: [], relay: ptr(10, untouched) } };
  SC.adoptRelayDraft(edited, PK, { d: 'same', k: 1, at: 20, draft: { text: 'v2', media: [] } }, 30);
  assert.equal(edited[PK + '|n:5'].text, 'v1 plus my edits', 'kept');
  assert.equal(edited[PK + '|n:5'].relay, undefined, 'and no longer speaks for the relay copy');
  assert.equal(edited[PK].relay.d, 'same');
});

test('a relay draft already here is not listed twice', () => {
  const all = { [PK]: { text: 'x', relay: { d: 'q', at: 50 } } };
  assert.equal(SC.relayDraftIsLocal(all, PK, { d: 'q', at: 50 }), true);
  assert.equal(SC.relayDraftIsLocal(all, PK, { d: 'q', at: 51 }), false, 'a newer copy elsewhere is offered');
  assert.equal(SC.relayDraftIsLocal(all, PK, { d: 'other', at: 1 }), false);
});

// ---- the list rows ----

function fakeEl(tag) {
  const classes = new Set();
  const el = {
    tag, children: [], listeners: {}, isConnected: true, disabled: false, textContent: '', title: '',
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle() {} },
    append(...kids) { el.children.push(...kids); },
    setAttribute() {},
    addEventListener(type, fn) { el.listeners[type] = fn; },
    click() { return el.listeners.click && el.listeners.click(); },
  };
  Object.defineProperty(el, 'className', { set(v) { v.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); } });
  return el;
}
const findAll = (el, cls, out = []) => {
  if (el.classList && el.classList.contains(cls)) out.push(el);
  for (const k of el.children || []) findAll(k, cls, out);
  return out;
};
function lift(name) {
  const src = read('composer-core.js');
  const at = src.indexOf('  function ' + name + '(');
  assert.ok(at > -1, name + ' is gone from composer-core.js');
  return src.slice(at, src.indexOf('\n  }\n', at) + 4);
}
function listCtx() {
  const ctx = withI18n({
    console, Date, setTimeout, clearTimeout,
    h: (tag, props, kids) => { const el = fakeEl(tag); Object.assign(el, props || {}); (kids || []).forEach((k) => el.append(k)); return el; },
    icon: () => fakeEl('svg'), relTime: () => '5m ago', stripDraftMediaUrls: (text) => text || '',
    pictureCount: () => 0,
  });
  vm.createContext(ctx);
  vm.runInContext(['draftRefsAsText', 'draftSnippet', 'draftKindLabel', 'buildSavedDraftList'].map(lift).join('\n') + '\nthis.build = buildSavedDraftList;', ctx);
  return ctx;
}

test('rows get the cloud beside the trash; the open draft has only the cloud; a relay row only the trash', async () => {
  const { build } = listCtx();
  const saved = [];
  const picked = [];
  const list = build({
    entries: [
      { key: PK, draft: { text: 'on screen' }, current: true },
      { key: PK + '|n:1', draft: { text: 'set aside', relay: { d: 'q' } } },
      { key: 'relay:z', draft: { text: 'from relays', savedAt: 1 }, relayItem: { d: 'z' } },
      { key: PK + '|n:2', draft: { text: '', poll: { options: ['a', 'b'] } } },
    ],
    onPick: (e) => picked.push(e.key), onCurrent: () => picked.push('current'),
    onSave: async (e) => { saved.push(e.key); }, onDelete: async () => {},
  });
  const rows = findAll(list, 'saved-draft');
  const icons = rows.map((r) => r.children.slice(1).map((b) => (b.classList.contains('saved-draft-cloud') ? 'cloud' : 'trash')));
  assert.deepEqual(icons, [['cloud'], ['cloud', 'trash'], ['trash'], ['trash']], 'two icons at most, and none on a poll');
  assert.equal(findAll(rows[1], 'saved-draft-mark').length, 1, 'a row with a relay copy is marked');
  assert.equal(findAll(rows[2], 'saved-draft-mark').length, 1, 'and so is a relay row');
  await rows[1].children[1].click();
  assert.deepEqual(saved, [PK + '|n:1']);
  rows[0].children[0].click();
  assert.deepEqual(picked, ['current'], 'the open draft goes back to the editor');
  rows[2].children[1].click();
  assert.equal(findAll(rows[2], 'saved-draft-label')[0].textContent, 'Delete it from your relays?');
});

// ---- the pages ----

test('both composers blank the relay copy when a draft is posted or deleted', () => {
  const panel = read('sidepanel.js');
  const page = read('compose.js');
  // The panel's post and Start fresh both go through clearComposeDraft.
  assert.match(panel, /const removed = all\[key\];\s*delete all\[key\];[\s\S]{0,120}relayDrafts\.forget\(String\(key\)\.split\('\|'\)\[0\], removed\);/);
  // Saved drafts' trash, in both.
  assert.match(panel, /const removed = now\[entry\.key\];\s*delete now\[entry\.key\];[\s\S]{0,140}relayDrafts\.forget\(pubkey, removed\);/);
  assert.match(page, /const removed = now\[entry\.key\];\s*delete now\[entry\.key\];[\s\S]{0,140}relayDrafts\.forget\(pubkey, removed\);/);
  // The tab's post: the slot read before it is cleared, blanked after.
  assert.match(page, /const postedSlot = \(await readAllDrafts\(\)\)\[dkey\];[\s\S]{0,600}await persistDraft\(\);\s*relayDrafts\.forget\(state\.activePubkey, postedSlot\);/);
});

test('the panel\'s autosave keeps the pointer to the relay copy', async () => {
  // Run, not read: saveComposeDraft rebuilds the slot from the editor on every save.
  const src = read('sidepanel.js');
  const at = src.indexOf('  function saveComposeDraft(');
  let depth = 0; let end = -1;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  let store = { [PK]: { text: 'old', media: [], relay: { d: 'keep', k: 1, at: 1 } } };
  const ctx = {
    Date,
    call: async (m) => (m.type === 'SIDECAR_SECRET_GET' ? JSON.parse(JSON.stringify(store)) : (store = m.value)),
    pruneReplyDrafts() {},
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(at, end) + '\nthis.save = saveComposeDraft;', ctx);
  await ctx.save(PK, { text: 'new words', media: [] });
  assert.equal(store[PK].text, 'new words');
  assert.deepEqual(plain(store[PK].relay), { d: 'keep', k: 1, at: 1 });
});

test('the owner signs its own drafts: no approval card, and every call names the account', () => {
  const core = read('composer-core.js');
  const install = core.slice(core.indexOf('  function installRelayDrafts('), core.indexOf('  function buildRelayDraftsPane('));
  assert.match(install, /type: 'SIDECAR_OWNER_SIGN', event, expectedPubkey: pubkey/);
  assert.match(install, /type: 'SIDECAR_OWNER_ENCRYPT', nip: 44, peer: pubkey, expectedPubkey: pubkey/);
  assert.match(install, /type: 'SIDECAR_OWNER_DECRYPT', nip: 44, peer: pubkey, expectedPubkey: pubkey/);
});
