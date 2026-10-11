'use strict';

// Muting a person or a thread from the notification bell. The writer is the part that
// can do damage: a kind 10000 replaces the one before it, so a list rebuilt from a read
// that failed, or from private entries that could not be decrypted, deletes mutes the
// account has. These run the real functions out of sidepanel.js against a fake relay
// set and a fake keystore, and check what actually gets published.

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

const ME = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const ROOT = 'c'.repeat(64);
const REPLY = 'd'.repeat(64);
const NOTE = 'e'.repeat(64);

const CODE = [
  lift(/  const emptyMuteSet = [^\n]*\n/, 'emptyMuteSet'),
  lift(/  function collectMuteTags\(tags, into\) \{[\s\S]*?\n  \}\n/, 'collectMuteTags'),
  lift(/  function zapSender\(ev\) \{[\s\S]*?\n  \}\n/, 'zapSender'),
  lift(/  function muteSubject\(ev\) \{[\s\S]*?\n  \}\n/, 'muteSubject'),
  lift(/  function muteTargets\(ev, own\) \{[\s\S]*?\n  \}\n/, 'muteTargets'),
  lift(/  function applyLocalMutes\(entries, set\) \{[\s\S]*?\n  \}\n/, 'applyLocalMutes'),
  lift(/  let _muteWrite = [^\n]*\n  function changeMute\([\s\S]*?\n  \}\n  const addPrivateMute = [^\n]*\n  const removeMute = [^\n]*\n/, 'changeMute'),
  lift(/  async function writeMute\([\s\S]*?\n  \}\n/, 'writeMute'),
  lift(/  function loadMuteList\(pubkey, relays, force\) \{[\s\S]*?\n  \}\n/, 'loadMuteList'),
].join('\n');

// A reversible stand-in for NIP-04/44 that records which scheme was used, and can be
// told to fail. "Encrypted" content is `<scheme>:<json>`; NIP-04 adds the `?iv=` marker
// the real format carries so the writer's ordering logic is exercised.
function world({ list = null, profile = true, undecryptable = false, relayDown = false, active = ME } = {}) {
  const w = {
    published: [], signed: [], encryptedWith: [], baselines: [], pruned: 0,
    store: list ? [list] : [],
  };
  const ctx = withI18n({
    state: { activePubkey: active },
    _muteLists: new Map(),
    _muteListPromises: new Map(),
    _localMutes: new Map(),
    relayUrls: async () => ['wss://relay.test'],
    WEB_COMMENT_KIND: 1111,
    readRelayUrls: async () => ['wss://relay.test'],
    poolQuerySync: async (_r, f) => {
      if (relayDown) return [];
      const out = w.store.filter((e) => f.kinds.includes(e.kind));
      if (profile && f.kinds.includes(0)) out.push({ kind: 0, created_at: 1, tags: [], content: '{}' });
      return out;
    },
    publishSigned: async (ev) => { w.published.push(ev); w.store = [ev]; },
    seedBaseline: (_pk, ev) => w.baselines.push(ev),
    pruneNameMuted: () => { w.pruned++; },
    _notifProfiles: new Map(),
    isMutedNotif: () => false,
    call: async (msg) => {
      if (msg.expectedPubkey && msg.expectedPubkey !== active) throw new Error('Account changed');
      if (msg.type === 'SIDECAR_OWNER_DECRYPT') {
        if (undecryptable) throw new Error('bad ciphertext');
        const [scheme, ...rest] = String(msg.ciphertext).split(':');
        const want = msg.nip === 4 ? 'nip04' : 'nip44';
        if (scheme !== want) throw new Error('wrong scheme');
        return rest.join(':');
      }
      if (msg.type === 'SIDECAR_OWNER_ENCRYPT') {
        w.encryptedWith.push(msg.nip);
        return (msg.nip === 4 ? 'nip04:' : 'nip44:') + msg.plaintext;
      }
      if (msg.type === 'SIDECAR_OWNER_SIGN') {
        w.signed.push(msg.event);
        return { ...msg.event, id: 'f'.repeat(64), pubkey: active, sig: '0'.repeat(128) };
      }
      throw new Error('unexpected ' + msg.type);
    },
  });
  vm.createContext(ctx);
  vm.runInContext(CODE + '\nglobalThis.api = { muteTargets, addPrivateMute, removeMute, loadMuteList };', ctx);
  w.ctx = ctx;
  w.api = ctx.api;
  return w;
}

// Arrays made inside the vm context are not deep-equal to host arrays; compare as data.
const plain = (x) => JSON.parse(JSON.stringify(x));
const priv = (tags) => 'nip44:' + JSON.stringify(tags);
const list = (over) => ({ kind: 10000, created_at: 1000, tags: [], content: '', ...over });
const hidden = (w) => JSON.parse(w.published[0].content.replace(/^nip(04|44):/, ''));

// ---- what a row can be muted by ----

test('a reply offers its own note, and its thread by the root rather than the note it answers', () => {
  const { api } = world();
  const ev = { id: REPLY, pubkey: BOB, kind: 1, tags: [['e', ROOT, '', 'root'], ['e', NOTE, '', 'reply'], ['p', ME]] };
  assert.deepEqual({ ...api.muteTargets(ev, ME) }, { person: BOB, note: REPLY, thread: ROOT });
});

test('positional e tags: the first is the root', () => {
  const { api } = world();
  const ev = { id: REPLY, pubkey: BOB, kind: 1, tags: [['e', ROOT], ['e', NOTE]] };
  assert.equal(api.muteTargets(ev, ME).thread, ROOT);
});

test('a NIP-22 comment mutes its E root', () => {
  const { api } = world();
  const ev = { id: REPLY, pubkey: BOB, kind: 1111, tags: [['E', ROOT], ['e', NOTE]] };
  assert.equal(api.muteTargets(ev, ME).thread, ROOT);
});

test('a root note is offered once: the thread row would do the same thing as the note row', () => {
  const { api } = world();
  assert.deepEqual({ ...api.muteTargets({ id: REPLY, pubkey: BOB, kind: 1, tags: [['p', ME]] }, ME) }, { person: BOB, note: REPLY, thread: '' });
});

test('a reaction that names no note has nothing to mute but the person', () => {
  const { api } = world();
  assert.deepEqual({ ...api.muteTargets({ id: REPLY, pubkey: BOB, kind: 7, tags: [['p', ME]], content: '+' }, ME) }, { person: BOB, note: '', thread: '' });
});

test('a reaction mutes the note it landed on, not the reaction event', () => {
  const { api } = world();
  const t = api.muteTargets({ id: REPLY, pubkey: BOB, kind: 7, tags: [['e', NOTE], ['p', ME]], content: '+' }, ME);
  assert.equal(t.note, NOTE);
  assert.equal(t.thread, '', 'same id as the note, so one row');
});

test('a zap mutes the zapper and the zapped note, not the LNURL service that signed it', () => {
  const { api } = world();
  const request = JSON.stringify({ pubkey: BOB, content: 'hi', tags: [['e', NOTE]] });
  const ev = { id: REPLY, pubkey: 'f'.repeat(64), kind: 9735, tags: [['description', request], ['p', ME]] };
  assert.deepEqual({ ...api.muteTargets(ev, ME) }, { person: BOB, note: NOTE, thread: '' });
});

test('you are never offered a mute on yourself', () => {
  const { api } = world();
  const ev = { id: REPLY, pubkey: ME, kind: 1, tags: [['e', ROOT, '', 'root']] };
  assert.equal(api.muteTargets(ev, ME).person, '');
});

test('malformed ids are never offered', () => {
  const { api } = world();
  const ev = { id: 'zz', pubkey: 'not-hex', kind: 1, tags: [['e', 'short']] };
  assert.deepEqual({ ...api.muteTargets(ev, ME) }, { person: '', note: '', thread: '' });
});

// ---- the write ----

test('the entry goes into the PRIVATE content; public tags are untouched', async () => {
  const pub = [['p', BOB], ['t', 'spam']];
  const w = world({ list: list({ tags: pub, content: priv([['word', 'gm']]) }) });
  assert.equal(await w.api.addPrivateMute(ME, ['p', 'c'.repeat(64)]), true);
  const ev = w.published[0];
  assert.equal(ev.kind, 10000);
  assert.deepEqual(plain(ev.tags), pub, 'public tags must ride through exactly');
  assert.deepEqual(hidden(w), [['word', 'gm'], ['p', 'c'.repeat(64)]], 'existing private entries kept, new one appended');
  assert.ok(!JSON.stringify(ev.tags).includes('c'.repeat(64)), 'the muted key must not appear in the clear');
});

test('a list written with NIP-04 is rewritten with NIP-04', async () => {
  // Read by trying both schemes, as the loader does, so a legacy list still reads and
  // a client that only understands NIP-04 still reads what we write back.
  const w = world({ list: list({ content: 'nip04:' + JSON.stringify([['p', BOB]]) }) });
  await w.api.addPrivateMute(ME, ['e', ROOT]);
  assert.deepEqual(plain(w.encryptedWith), [4]);
  assert.deepEqual(hidden(w), [['p', BOB], ['e', ROOT]]);
});

test('no list yet but a profile: the first list is ours to write, on NIP-44', async () => {
  const w = world({ list: null, profile: true });
  assert.equal(await w.api.addPrivateMute(ME, ['p', BOB]), true);
  assert.deepEqual(plain(w.published[0].tags), []);
  assert.deepEqual(plain(w.encryptedWith), [44]);
});

test('FAIL CLOSED: relays that answer nothing publish nothing', async () => {
  const w = world({ list: list({ content: priv([['p', BOB]]) }), relayDown: true });
  await assert.rejects(() => w.api.addPrivateMute(ME, ['p', 'c'.repeat(64)]), /nothing was changed/);
  assert.equal(w.signed.length, 0);
  assert.equal(w.published.length, 0);
});

test('FAIL CLOSED: private mutes that cannot be read are never overwritten', async () => {
  const w = world({ list: list({ content: priv([['p', BOB]]) }), undecryptable: true });
  await assert.rejects(() => w.api.addPrivateMute(ME, ['p', 'c'.repeat(64)]), /private mutes/);
  assert.equal(w.signed.length, 0, 'nothing is signed');
  assert.equal(w.published.length, 0, 'nothing is published');
});

test('already muted: nothing is published, the row still goes', async () => {
  const w = world({ list: list({ tags: [['p', BOB]] }) });
  assert.equal(await w.api.addPrivateMute(ME, ['p', BOB]), false);
  assert.equal(w.published.length, 0);
  assert.ok(w.ctx._muteLists.get(ME).pubkeys.has(BOB), 'applied locally so the row is pruned');
  assert.ok(w.pruned > 0);
});

test('the replacement is newer than the list it replaces, even from the future', async () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const w = world({ list: list({ created_at: future }) });
  await w.api.addPrivateMute(ME, ['p', BOB]);
  assert.equal(w.published[0].created_at, future + 1);
});

test('the signature is bound to the account the menu was opened for', async () => {
  const w = world({ list: list(), active: BOB });
  w.ctx.state.activePubkey = BOB;
  await assert.rejects(() => w.api.addPrivateMute(ME, ['p', 'c'.repeat(64)]), /Switch back/);
  assert.equal(w.signed.length, 0);
});

test('two quick mutes: the second builds on the first instead of replacing it', async () => {
  const w = world({ list: list({ content: priv([['word', 'gm']]) }) });
  const one = 'c'.repeat(64);
  const two = 'd'.repeat(64);
  await Promise.all([w.api.addPrivateMute(ME, ['p', one]), w.api.addPrivateMute(ME, ['e', two])]);
  assert.equal(w.published.length, 2);
  const final = JSON.parse(w.store[0].content.replace(/^nip44:/, ''));
  assert.deepEqual(final, [['word', 'gm'], ['p', one], ['e', two]]);
});

test('a relay still serving the old list cannot bring a just-muted row back', async () => {
  const w = world({ list: list({ tags: [['p', BOB]] }) });
  await w.api.addPrivateMute(ME, ['p', 'c'.repeat(64)]);
  w.store = [list({ tags: [['p', BOB]] })]; // the stale copy, as a lagging relay serves it
  const set = await w.api.loadMuteList(ME, ['wss://relay.test'], true);
  assert.ok(set.pubkeys.has('c'.repeat(64)), 'the mute made here survives a reload from a stale relay');
  assert.ok(set.pubkeys.has(BOB));
});

// ---- the menu ----

function el(tag) {
  const listeners = {};
  const e = {
    tag, children: [], className: '', textContent: '', disabled: false, listeners,
    classList: {
      s: new Set(),
      add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); },
      toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); },
      contains(c) { return this.s.has(c); },
    },
    setAttribute() {}, append(...k) { e.children.push(...k); }, appendChild(k) { e.children.push(k); return k; },
    addEventListener(n, f) { (listeners[n] = listeners[n] || []).push(f); },
    async click() { for (const f of listeners.click || []) await f({ preventDefault() {}, stopPropagation() {} }); },
  };
  e.classList.s = new Set();
  return e;
}

function menuWorld(addPrivateMute) {
  const timers = [];
  const toasts = [];
  const ctx = withI18n({
    h: (tag, props, kids) => {
      const e = el(tag);
      Object.assign(e, props || {});
      String(e.className || '').split(/\s+/).filter(Boolean).forEach((c) => e.classList.add(c));
      (kids || []).forEach((k) => e.children.push(k));
      return e;
    },
    icon: (name) => ({ icon: name }),
    toast: (m, type) => toasts.push([m, type]),
    approvalKindLabels: () => ({}),
    NT: { nip19: { neventEncode: () => 'nevent', npubEncode: () => 'npub' } },
    zapSender: (ev) => ev.pubkey,
    notifTargetId: () => '',
    notifEventJson: () => '{}',
    notifAuthorName: () => 'Bob',
    copyPlain: async () => {},
    addPrivateMute,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].f = null; },
  });
  vm.createContext(ctx);
  vm.runInContext(lift(/  function buildEventMenu\(ev, linkTarget, opts\) \{[\s\S]*?\n    return \{ btn, panel \};\n  \}\n/, 'buildEventMenu') + '\nglobalThis.build = buildEventMenu;', ctx);
  return { ctx, timers, toasts };
}

const labels = (menu) => menu.panel.children.filter((c) => c.tag === 'button').map((b) => b.children[1].textContent);

test('the menu offers both mutes, last, only when asked', async () => {
  const { ctx } = menuWorld(async () => true);
  const ev = { id: REPLY, pubkey: BOB, kind: 1, tags: [] };
  const bare = ctx.build(ev, null);
  await bare.btn.click();
  assert.ok(!labels(bare).some((l) => /^Mute/.test(l)), 'other callers of the menu get no mute rows');

  const menu = ctx.build(ev, null, { mute: { person: BOB, note: REPLY, thread: ROOT, pubkey: ME } });
  await menu.btn.click();
  const all = labels(menu);
  assert.deepEqual(plain(all.slice(-3)), ['Mute Bob', 'Mute this note and replies', 'Mute the whole thread']);
});

test('TWO TAPS: the first only arms, the second mutes', async () => {
  const calls = [];
  const { ctx, toasts } = menuWorld(async (pk, tag) => { calls.push([pk, tag]); return true; });
  const menu = ctx.build({ id: REPLY, pubkey: BOB, kind: 1, tags: [] }, null, { mute: { person: BOB, thread: '', pubkey: ME } });
  await menu.btn.click();
  const row = menu.panel.children.at(-1);
  await row.click();
  assert.equal(calls.length, 0, 'one tap must not write anything');
  assert.equal(row.children[1].textContent, 'Tap again to mute');
  await row.click();
  assert.deepEqual(plain(calls), [[ME, ['p', BOB]]]);
  assert.deepEqual(plain(toasts), [['Muted Bob', 'success']]);
});

test('an armed row disarms by itself', async () => {
  const calls = [];
  const { ctx, timers } = menuWorld(async (pk, tag) => { calls.push(tag); return true; });
  const menu = ctx.build({ id: REPLY, pubkey: BOB, kind: 1, tags: [] }, null, { mute: { person: BOB, thread: '', pubkey: ME } });
  await menu.btn.click();
  const row = menu.panel.children.at(-1);
  await row.click();
  const t = timers.find((x) => x.f && x.ms === 4000);
  assert.ok(t, 'a disarm timer is set');
  t.f();
  assert.equal(row.children[1].textContent, 'Mute Bob');
  await row.click();
  assert.equal(calls.length, 0, 'after the timeout the next tap arms again rather than muting');
});

test('a failed write says why and leaves the row usable', async () => {
  const { ctx, toasts } = menuWorld(async () => { throw new Error('Could not read your mute list, so nothing was changed.'); });
  const menu = ctx.build({ id: REPLY, pubkey: BOB, kind: 1, tags: [] }, null, { mute: { person: BOB, thread: '', pubkey: ME } });
  await menu.btn.click();
  const row = menu.panel.children.at(-1);
  await row.click();
  await row.click();
  assert.deepEqual(plain(toasts), [['Could not read your mute list, so nothing was changed.', 'error']]);
  assert.equal(row.disabled, false);
  assert.equal(row.children[1].textContent, 'Mute Bob');
});

test('the notification list passes the menu its targets for the account it is showing', () => {
  assert.match(source, /buildEventMenu\(ev, linkTarget, \{ mute: \{ \.\.\.muteTargets\(ev, a\.pubkey\), pubkey: a\.pubkey, item \} \}\)/);
});

// ---- unmute ----

test('unmute takes the entry out of the public tags and the private content, and nothing else', async () => {
  const other = 'c'.repeat(64);
  const w = world({ list: list({ tags: [['p', BOB], ['p', other], ['t', 'spam']], content: priv([['p', BOB], ['word', 'gm']]) }) });
  assert.equal(await w.api.removeMute(ME, ['p', BOB]), true);
  assert.deepEqual(plain(w.published[0].tags), [['p', other], ['t', 'spam']]);
  assert.deepEqual(hidden(w), [['word', 'gm']]);
});

test('unmuting someone muted only in public leaves the ciphertext exactly as it was', async () => {
  const content = priv([['word', 'gm']]);
  const w = world({ list: list({ tags: [['p', BOB]], content }) });
  assert.equal(await w.api.removeMute(ME, ['p', BOB]), true);
  assert.equal(w.published[0].content, content);
  assert.equal(w.encryptedWith.length, 0, 'nothing is re-encrypted');
});

test('unmuting someone who is not on the list publishes nothing', async () => {
  const w = world({ list: list({ tags: [['p', 'c'.repeat(64)]] }) });
  assert.equal(await w.api.removeMute(ME, ['p', BOB]), false);
  assert.equal(w.published.length, 0);
});

test('FAIL CLOSED on unmute too: unreadable private mutes are not overwritten', async () => {
  const w = world({ list: list({ tags: [['p', BOB]], content: priv([['p', 'c'.repeat(64)]]) }), undecryptable: true });
  await assert.rejects(() => w.api.removeMute(ME, ['p', BOB]), /private mutes/);
  assert.equal(w.signed.length, 0);
});

test('a relay still serving the old list cannot bring an unmuted person back', async () => {
  const w = world({ list: list({ tags: [['p', BOB]] }) });
  await w.api.removeMute(ME, ['p', BOB]);
  w.store = [list({ tags: [['p', BOB]] })];
  const set = await w.api.loadMuteList(ME, ['wss://relay.test'], true);
  assert.equal(set.pubkeys.has(BOB), false);
  assert.equal(set.size, 0, 'the count follows');
});

test('mute then unmute then mute in the panel ends muted', async () => {
  const w = world({ list: list() });
  await w.api.addPrivateMute(ME, ['p', BOB]);
  await w.api.removeMute(ME, ['p', BOB]);
  await w.api.addPrivateMute(ME, ['p', BOB]);
  assert.deepEqual(hidden({ published: [w.store[0]] }), [['p', BOB]]);
  w.store = [list()];
  const set = await w.api.loadMuteList(ME, ['wss://relay.test'], true);
  assert.equal(set.pubkeys.has(BOB), true);
});

test('each mute row writes its own entry', async () => {
  const calls = [];
  const { ctx } = menuWorld(async (pk, tag) => { calls.push(tag); return true; });
  const menu = ctx.build({ id: REPLY, pubkey: BOB, kind: 1, tags: [] }, null, { mute: { person: BOB, note: REPLY, thread: ROOT, pubkey: ME } });
  await menu.btn.click();
  for (const row of menu.panel.children.slice(-3)) { await row.click(); await row.click(); }
  assert.deepEqual(plain(calls), [['p', BOB], ['e', REPLY], ['e', ROOT]]);
});

test('a root note shows two mute rows, not three', async () => {
  const { ctx } = menuWorld(async () => true);
  const menu = ctx.build({ id: REPLY, pubkey: BOB, kind: 1, tags: [] }, null, { mute: { person: BOB, note: REPLY, thread: '', pubkey: ME } });
  await menu.btn.click();
  assert.deepEqual(plain(labels(menu).slice(-2)), ['Mute Bob', 'Mute this note and replies']);
});

// ---- what "this note and replies" actually reaches ----

test('muting a note hides it and the replies that tag it; a sibling and a deeper branch stay', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext([
    lift(/  const emptyMuteSet = [^\n]*\n/, 'emptyMuteSet'),
    lift(/  function collectMuteTags\(tags, into\) \{[\s\S]*?\n  \}\n/, 'collectMuteTags'),
    lift(/  function zapSender\(ev\) \{[\s\S]*?\n  \}\n/, 'zapSender'),
    lift(/  function muteSubject\(ev\) \{[\s\S]*?\n  \}\n/, 'muteSubject'),
    lift(/  function isMutedNotif\(mute, ev\) \{[\s\S]*?\n  \}\n/, 'isMutedNotif'),
    'globalThis.set = collectMuteTags([["e", "' + REPLY + '"]], emptyMuteSet()); globalThis.hit = (ev) => isMutedNotif(set, ev);',
  ].join('\n'), ctx);
  const x = (n) => String(n).repeat(64);
  assert.equal(ctx.hit({ id: REPLY, pubkey: BOB, kind: 1, tags: [], content: '' }), true, 'the note itself');
  assert.equal(ctx.hit({ id: x(1), pubkey: BOB, kind: 1, tags: [['e', ROOT, '', 'root'], ['e', REPLY, '', 'reply']], content: '' }), true, 'a direct reply');
  assert.equal(ctx.hit({ id: x(2), pubkey: BOB, kind: 7, tags: [['e', REPLY]], content: '+' }), true, 'a reaction to it');
  assert.equal(ctx.hit({ id: x(3), pubkey: BOB, kind: 1, tags: [['e', ROOT, '', 'root'], ['e', NOTE, '', 'reply']], content: '' }), false, 'a sibling reply');
  assert.equal(ctx.hit({ id: x(4), pubkey: BOB, kind: 1, tags: [['e', ROOT, '', 'root'], ['e', x(1), '', 'reply']], content: '' }), false,
    'a reply to a reply cites the root and its own parent, so it is the thread row that reaches it');
});

// ---- the row leaves at once ----

function deferred() {
  let resolve; let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

async function tapTwice(menuRow) {
  await menuRow.click();
  return menuRow.click();
}

test('the row is hidden the moment the second tap lands, before the relays answer', async () => {
  const write = deferred();
  const { ctx, toasts } = menuWorld(() => write.promise);
  const item = el('div');
  const menu = ctx.build({ id: REPLY, pubkey: BOB, kind: 1, tags: [] }, null, { mute: { person: BOB, note: '', thread: '', pubkey: ME, item } });
  await menu.btn.click();
  const row = menu.panel.children.at(-1);
  await row.click();
  assert.equal(item.classList.contains('hidden'), false, 'arming alone changes nothing');
  const pending = row.click();
  assert.equal(item.classList.contains('hidden'), true, 'gone while the write is still in flight');
  assert.equal(toasts.length, 0, 'the toast waits for the result');
  write.resolve(true);
  await pending;
  assert.equal(item.classList.contains('hidden'), true);
  assert.deepEqual(plain(toasts), [['Muted Bob', 'success']]);
});

test('a failed write brings the row back and says why', async () => {
  const write = deferred();
  const { ctx, toasts } = menuWorld(() => write.promise);
  const item = el('div');
  const menu = ctx.build({ id: REPLY, pubkey: BOB, kind: 1, tags: [] }, null, { mute: { person: BOB, note: '', thread: '', pubkey: ME, item } });
  await menu.btn.click();
  const row = menu.panel.children.at(-1);
  await row.click();
  const pending = row.click();
  assert.equal(item.classList.contains('hidden'), true);
  write.reject(new Error('Could not read your mute list, so nothing was changed.'));
  await pending;
  assert.equal(item.classList.contains('hidden'), false, 'restored');
  assert.equal(row.disabled, false);
  assert.deepEqual(plain(toasts), [['Could not read your mute list, so nothing was changed.', 'error']]);
});

test('arming, and an armed row that times out, never hide anything', async () => {
  const { ctx, timers } = menuWorld(async () => true);
  const item = el('div');
  const menu = ctx.build({ id: REPLY, pubkey: BOB, kind: 1, tags: [] }, null, { mute: { person: BOB, note: '', thread: '', pubkey: ME, item } });
  await menu.btn.click();
  const row = menu.panel.children.at(-1);
  await row.click();
  timers.find((x) => x.f && x.ms === 4000).f();
  assert.equal(item.classList.contains('hidden'), false);
});
