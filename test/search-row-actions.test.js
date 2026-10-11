'use strict';

// Follow and mute from a search result. The follow writer is the dangerous part: a kind 3
// is the account's whole follow list and it is replaceable, so a list rebuilt from a bad
// read erases it. These run the real functions out of sidepanel.js against a fake relay
// set and keystore and check what is actually published.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('./helpers/i18n');

const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

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

const WRITER = [
  lift(/  let _followWrite = [^\n]*\n  function changeFollow\([\s\S]*?\n  \}\n  const addFollow = [^\n]*\n  const removeFollow = [^\n]*\n/, 'changeFollow'),
  lift(/  async function writeFollow\([\s\S]*?\n  \}\n/, 'writeFollow'),
].join('\n');

function world({ list = null, profile = true, relayDown = false, known = [], active = ME, signFails = null } = {}) {
  const w = { published: [], queried: [], store: list ? [list] : [], wot: 0, baselines: [] };
  const ctx = withI18n({
    state: { activePubkey: active },
    followListCache: known.length ? known.map((pubkey) => ({ pubkey, name: 'x', picture: null })) : null,
    followListPubkey: known.length ? active : null,
    followCountCache: new Map(),
    NT: { nip19: { npubEncode: (h) => 'npub1' + h.slice(0, 6) } },
    shortNpub: (n) => n.slice(0, 10),
    forgetWot: () => { w.wot++; },
    readRelayUrls: async () => ['wss://read.test'],
    postRelays: async () => ['wss://write.test'],
    poolQuerySync: async (relays, f) => {
      w.queried.push(relays);
      if (relayDown) return [];
      const out = w.store.filter((e) => f.kinds.includes(e.kind));
      if (profile && f.kinds.includes(0)) out.push({ kind: 0, created_at: 1, tags: [], content: '{}' });
      return out;
    },
    publishSigned: async (ev) => { w.published.push(ev); w.store = [ev]; },
    seedBaseline: (_p, ev) => w.baselines.push(ev),
    call: async (msg) => {
      if (msg.expectedPubkey && msg.expectedPubkey !== active) throw new Error('Account changed');
      if (msg.type !== 'SIDECAR_OWNER_SIGN') throw new Error('unexpected ' + msg.type);
      if (signFails) throw new Error(signFails);
      return { ...msg.event, id: 'f'.repeat(64), pubkey: active, sig: '0'.repeat(128) };
    },
  });
  vm.createContext(ctx);
  vm.runInContext(WRITER + '\nglobalThis.api = { addFollow, removeFollow };', ctx);
  w.ctx = ctx;
  w.api = ctx.api;
  return w;
}
const kind3 = (over) => ({ kind: 3, created_at: 1000, tags: [], content: '', ...over });

// ---- the write ----

test('a follow is appended and everything the list already carries is untouched', async () => {
  const tags = [['p', BOB, 'wss://hint.test', 'bobby'], ['p', CAL]];
  const w = world({ list: kind3({ tags, content: '{"wss://r":{"read":true}}' }) });
  assert.equal(await w.api.addFollow(ME, DAN), true);
  const ev = w.published[0];
  assert.equal(ev.kind, 3);
  assert.deepEqual(plain(ev.tags), [...tags, ['p', DAN]], 'relay hints and petnames survive');
  assert.equal(ev.content, '{"wss://r":{"read":true}}');
});

test('following someone already followed publishes nothing', async () => {
  const w = world({ list: kind3({ tags: [['p', BOB]] }) });
  assert.equal(await w.api.addFollow(ME, BOB), false);
  assert.equal(w.published.length, 0);
});

test('an unfollow removes that pubkey only, keeping the rest and the content', async () => {
  const w = world({ list: kind3({ tags: [['p', BOB, 'wss://h', 'b'], ['p', CAL], ['t', 'x']], content: 'keep' }) });
  assert.equal(await w.api.removeFollow(ME, BOB), true);
  assert.deepEqual(plain(w.published[0].tags), [['p', CAL], ['t', 'x']]);
  assert.equal(w.published[0].content, 'keep');
});

test('unfollowing someone who is not followed publishes nothing', async () => {
  const w = world({ list: kind3({ tags: [['p', CAL]] }) });
  assert.equal(await w.api.removeFollow(ME, BOB), false);
  assert.equal(w.published.length, 0);
});

test('the read asks the write relays as well as the read relays', async () => {
  const w = world({ list: kind3({ tags: [['p', CAL]] }) });
  await w.api.addFollow(ME, BOB);
  assert.deepEqual(plain(w.queried[0]), ['wss://read.test', 'wss://write.test']);
});

test('FAIL CLOSED: relays that answer nothing publish nothing', async () => {
  const w = world({ list: kind3({ tags: [['p', CAL]] }), relayDown: true });
  await assert.rejects(() => w.api.addFollow(ME, BOB), /nothing was changed/);
  assert.equal(w.published.length, 0);
});

test('FAIL CLOSED: a list that reads empty over follows Sidecar already holds is not written over', async () => {
  const w = world({ list: kind3({ tags: [] }), known: [BOB, CAL] });
  await assert.rejects(() => w.api.addFollow(ME, DAN), /read as empty/);
  assert.equal(w.published.length, 0);
});

test('no list yet but a profile: the first list is ours to write', async () => {
  const w = world({ list: null, profile: true });
  assert.equal(await w.api.addFollow(ME, BOB), true);
  assert.deepEqual(plain(w.published[0].tags), [['p', BOB]]);
});

test('the replacement is newer than the list it replaces, even from the future', async () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const w = world({ list: kind3({ created_at: future, tags: [['p', CAL]] }) });
  await w.api.addFollow(ME, BOB);
  assert.equal(w.published[0].created_at, future + 1);
});

test('a malformed target is refused before anything is read', async () => {
  const w = world({ list: kind3() });
  await assert.rejects(() => w.api.addFollow(ME, 'nope'), /Could not follow/);
  assert.equal(w.queried.length, 0);
});

test('the account the menu was opened for must still be the active one', async () => {
  const w = world({ list: kind3(), active: BOB });
  await assert.rejects(() => w.api.addFollow(ME, DAN), /Switch back/);
  assert.equal(w.published.length, 0);
});

test('a refusal from the destructive-overwrite guard stops the write and is passed on', async () => {
  const w = world({ list: kind3({ tags: [['p', BOB]] }), signFails: 'Removes the 1 account you follow.' });
  await assert.rejects(() => w.api.removeFollow(ME, BOB), /Removes the 1 account/);
  assert.equal(w.published.length, 0);
});

test('two quick follows: the second builds on the first', async () => {
  const w = world({ list: kind3({ tags: [['p', CAL]] }) });
  await Promise.all([w.api.addFollow(ME, BOB), w.api.addFollow(ME, DAN)]);
  assert.equal(w.published.length, 2);
  assert.deepEqual(plain(w.store[0].tags), [['p', CAL], ['p', BOB], ['p', DAN]]);
});

test('the panel\'s own copies follow the list: cache, count, and the web of trust', async () => {
  const w = world({ list: kind3({ tags: [['p', CAL]] }), known: [CAL] });
  await w.api.addFollow(ME, BOB, { name: 'Bob', picture: 'p.png' });
  assert.deepEqual(plain(w.ctx.followListCache.map((c) => c.pubkey)), [CAL, BOB]);
  assert.equal(w.ctx.followListCache[1].name, 'Bob');
  assert.equal(w.ctx.followCountCache.get(ME), 2);
  assert.equal(w.wot, 1);
  await w.api.removeFollow(ME, CAL);
  assert.deepEqual(plain(w.ctx.followListCache.map((c) => c.pubkey)), [BOB]);
  assert.equal(w.ctx.followCountCache.get(ME), 1);
});

// ---- the buttons ----

function el(tag) {
  const listeners = {};
  const e = {
    tag, children: [], className: '', title: '', attrs: {}, listeners,
    classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } },
    setAttribute(k, v) { e.attrs[k] = v; },
    append(...k) { e.children.push(...k); }, appendChild(k) { e.children.push(k); return k; },
    replaceChildren(...k) { e.children = k; },
    addEventListener(n, f) { (listeners[n] = listeners[n] || []).push(f); },
    fire(n) { const ev = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }; (listeners[n] || []).forEach((f) => f(ev)); return ev; },
    async click() { const ev = { preventDefault() {}, stopPropagation() {} }; for (const f of listeners.click || []) f(ev); await new Promise((r) => setImmediate(r)); },
  };
  return e;
}

function deferred() {
  let resolve; let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const settle = () => new Promise((r) => setImmediate(r));

const ctxTrust = { value: 0, seen: [] };
function rowWorld({ muted = false, mutesFail = false } = {}) {
  const toasts = [];
  const calls = [];
  const gates = { follow: null, mute: null };
  const set = { pubkeys: new Set(muted ? [BOB] : []) };
  const ctx = withI18n({
    state: { activePubkey: ME },
    followListCache: [],
    h: (tag, props) => {
      const e = el(tag);
      Object.assign(e, props || {});
      String(e.className || '').split(/\s+/).filter(Boolean).forEach((c) => e.classList.add(c));
      return e;
    },
    icon: (name) => ({ icon: name }),
    toast: (m, type) => toasts.push([m, type]),
    relayUrls: async () => ['wss://r'],
    loadMuteList: async () => { if (mutesFail) throw new Error('down'); return set; },
    trustTier: (pk, set) => { ctxTrust.seen.push([pk, [...set]]); return ctxTrust.value; },
    addFollow: (...a) => { calls.push(['follow', ...a]); return gates.follow ? gates.follow.promise : Promise.resolve(true); },
    removeFollow: (...a) => { calls.push(['unfollow', ...a]); return gates.follow ? gates.follow.promise : Promise.resolve(true); },
    addPrivateMute: (...a) => { calls.push(['mute', ...a]); return gates.mute ? gates.mute.promise : Promise.resolve(true); },
    removeMute: (...a) => { calls.push(['unmute', ...a]); return gates.mute ? gates.mute.promise : Promise.resolve(true); },
  });
  vm.createContext(ctx);
  vm.runInContext(lift(/  function personActions\(c, opts\) \{[\s\S]*?\n    return box;\n  \}\n/, 'personActions') + '\nglobalThis.actions = personActions;', ctx);
  return { ctx, toasts, calls, gates };
}

const iconOf = (b) => b.children[0].icon;

test('two icon buttons, no visible words, each with a translated name for assistive tech', async () => {
  const { ctx } = rowWorld();
  const c = { pubkey: BOB, name: 'Bob', tier: 0 };
  const box = ctx.actions(c);
  const [follow, mute] = box.children;
  assert.equal(box.children.length, 2);
  assert.equal(iconOf(follow), 'user-plus');
  assert.equal(follow.attrs['aria-label'], 'Follow');
  assert.equal(follow.title, 'Follow');
  await settle();
  assert.equal(iconOf(mute), 'eye');
  assert.equal(mute.attrs['aria-label'], 'Mute');
  for (const b of box.children) assert.ok(!b.textContent, 'no text node on an icon button');
});

test('a tap never opens the profile or takes focus from the search box', () => {
  const { ctx } = rowWorld();
  const [follow, mute] = ctx.actions({ pubkey: BOB, name: 'Bob', tier: 0 }).children;
  for (const b of [follow, mute]) {
    const ev = b.fire('mousedown');
    assert.equal(ev.prevented, true, 'default prevented, so the input keeps focus');
    assert.equal(ev.stopped, true, 'the row\'s own mousedown never sees it');
  }
});

test('the state shows what is true: followed and muted rows start flipped', async () => {
  const { ctx } = rowWorld({ muted: true });
  const [follow, mute] = ctx.actions({ pubkey: BOB, name: 'Bob', tier: 2 }).children;
  await settle();
  assert.equal(iconOf(follow), 'user-check');
  assert.equal(follow.attrs['aria-label'], 'Unfollow');
  assert.equal(iconOf(mute), 'eye-off');
  assert.equal(mute.attrs['aria-label'], 'Unmute');
});

test('the mute button is there from the start, dimmed until the list is read, and stays inert if it cannot be', async () => {
  const ok = rowWorld();
  const [, m1] = ok.ctx.actions({ pubkey: BOB, name: 'Bob', tier: 0 }).children;
  assert.equal(m1.classList.contains('hidden'), false, 'never taken out of the layout');
  assert.equal(m1.classList.contains('pending'), true);
  assert.equal(m1.disabled, true);
  await settle();
  assert.equal(m1.classList.contains('pending'), false);
  assert.equal(m1.disabled, false);

  const bad = rowWorld({ mutesFail: true });
  const [, m2] = bad.ctx.actions({ pubkey: BOB, name: 'Bob', tier: 0 }).children;
  await settle();
  assert.equal(m2.classList.contains('hidden'), false);
  assert.equal(m2.classList.contains('pending'), true, 'an unreadable list leaves it unavailable, not guessed');
  await m2.click();
  assert.equal(bad.calls.length, 0, 'and a tap on it does nothing');
});

test('follow flips at once, the toast follows the relays, and the row\'s tier is updated', async () => {
  const w = rowWorld();
  w.gates.follow = deferred();
  const c = { pubkey: BOB, name: 'Bob', picture: 'p.png', tier: 0 };
  const [follow] = w.ctx.actions(c).children;
  const pending = follow.click();
  await settle();
  assert.equal(iconOf(follow), 'user-check', 'flipped before the write finishes');
  assert.equal(w.toasts.length, 0);
  w.gates.follow.resolve(true);
  await pending;
  await settle();
  assert.deepEqual(plain(w.calls), [['follow', ME, BOB, { name: 'Bob', picture: 'p.png' }]]);
  assert.deepEqual(plain(w.toasts), [['Followed Bob', 'success']]);
  assert.equal(c.tier, 2);
});

test('a failed follow flips back and says why', async () => {
  const w = rowWorld();
  w.gates.follow = deferred();
  const c = { pubkey: BOB, name: 'Bob', tier: 0 };
  const [follow] = w.ctx.actions(c).children;
  const pending = follow.click();
  await settle();
  w.gates.follow.reject(new Error('Could not read your follow list, so nothing was changed.'));
  await pending;
  await settle();
  assert.equal(iconOf(follow), 'user-plus');
  assert.equal(c.tier, 0);
  assert.deepEqual(plain(w.toasts), [['Could not read your follow list, so nothing was changed.', 'error']]);
});

test('unfollow and unmute are the same buttons, one tap each', async () => {
  const w = rowWorld({ muted: true });
  const c = { pubkey: BOB, name: 'Bob', tier: 2 };
  const [follow, mute] = w.ctx.actions(c).children;
  await settle();
  await follow.click();
  await mute.click();
  assert.deepEqual(plain(w.calls), [['unfollow', ME, BOB], ['unmute', ME, ['p', BOB]]]);
  assert.deepEqual(plain(w.toasts.map((t) => t[0])), ['Unfollowed Bob', 'Unmuted Bob']);
  assert.equal(iconOf(follow), 'user-plus');
  assert.equal(iconOf(mute), 'eye');
});

test('a second tap while the first is still in flight does nothing', async () => {
  const w = rowWorld();
  w.gates.follow = deferred();
  const [follow] = w.ctx.actions({ pubkey: BOB, name: 'Bob', tier: 0 }).children;
  const first = follow.click();
  await follow.click();
  assert.equal(w.calls.length, 1);
  w.gates.follow.resolve(true);
  await first;
});

test('results mount the buttons for other people only, and the layout keeps them at the right edge', () => {
  assert.match(source, /if \(state\.activePubkey && !\(\(state && state\.accounts\) \|\| \[\]\)\.some\(\(a\) => a\.pubkey === c\.pubkey\)\) item\.append\(personActions\(c, \{ onTier: paintTrust \}\)\);/);
  assert.match(css, /^\.ac-item-actions \{[^}]*flex-shrink: 0/m, 'the buttons keep their size and the name truncates');
  assert.match(css, /^\.ac-item-name \+ \.ac-item-actions \{ margin-left: auto; \}/m, 'right edge when there is no trust mark');
});

// ---- the same buttons on the profile card a result opens ----

test('on a card the follow button is dimmed and inert until it is known whether you follow them', async () => {
  const w = rowWorld();
  const box = w.ctx.actions({ pubkey: BOB, name: 'Bob', tier: 0 }, { followKnown: false });
  const [follow, mute] = box.children;
  assert.equal(follow.classList.contains('hidden'), false, 'it keeps its place, so the mute icon does not move');
  assert.equal(follow.classList.contains('pending'), true);
  await follow.click();
  assert.equal(w.calls.length, 0, 'no tap goes through before the answer');
  box.setFollowing(true);
  assert.equal(follow.classList.contains('pending'), false);
  assert.equal(follow.disabled, false);
  assert.equal(iconOf(follow), 'user-check');
  assert.equal(follow.attrs['aria-label'], 'Unfollow');
  assert.equal(mute.classList.contains('hidden'), false);
});

test('a card told they are not followed offers Follow', () => {
  const w = rowWorld();
  const box = w.ctx.actions({ pubkey: BOB, name: 'Bob', tier: 0 }, { followKnown: false });
  box.setFollowing(false);
  assert.equal(iconOf(box.children[0]), 'user-plus');
});

test('a result row, which already knows, has its follow button ready at once', () => {
  const w = rowWorld();
  const [follow] = w.ctx.actions({ pubkey: BOB, name: 'Bob', tier: 2 }).children;
  assert.equal(follow.classList.contains('pending'), false);
  assert.equal(follow.disabled, false);
});

test('the toast names who the card shows now, even if the name arrived after it opened', async () => {
  const w = rowWorld();
  let shown = 'npub1xxxx';
  const card = { pubkey: BOB, get name() { return shown; }, picture: null };
  const box = w.ctx.actions(card, { followKnown: false });
  const [follow] = box.children;
  box.setFollowing(false);
  shown = 'Bob';
  await follow.click();
  assert.deepEqual(plain(w.toasts), [['Followed Bob', 'success']]);
});

test('the profile card gets the row under the follower line, for other people and not on a zap card', () => {
  assert.match(source, /const manage = !isSelf && !options\?\.zap && state\.activePubkey;\s*const toolbar = manage\s*\? personActions\(\{/);
  assert.match(source, /get name\(\) \{ return name\.textContent; \}/, 'the name is read when needed, not captured at open');
  assert.match(source, /\}, \{ followKnown: false \}\)\s*: h\('span', \{ className: 'ac-item-actions' \}\);\s*toolbar\.classList\.add\('peek-person-actions'\);/);
  assert.match(source, /if \(manage\) toolbar\.append\(h\('span', \{ className: 'peek-tool-sep' \}\)\);\s*toolbar\.append\(zapBtn, open\);\s*rel\.after\(toolbar\);\s*toolbar\.after\(zapWrap\);/);
  assert.match(source, /isFollowing\(pubkey\)\.then\(\(yes\) => \{\s*if \(modal\.isConnected\) toolbar\.setFollowing\(yes\);/);
  const at = source.indexOf('const toolbar = manage');
  assert.doesNotMatch(source.slice(at, at + 900), /getFollowList\(\)/, 'the card must not load every follow\'s profile to answer about one');
  assert.match(css, /^\.peek-person-actions \{[^}]*justify-content: center/m);
  assert.match(css, /^\.peek-person-actions \{[^}]*margin: 14px 0 2px/m, 'room above matching the room below');
});

// ---- not-ready is a look, not a removal ----

test('the not-ready look keeps the button in the layout and fades back in', () => {
  const pending = css.match(/^\.ac-item-actions \.icon-btn\.pending \{([^}]*)\}/m);
  assert.ok(pending, 'a pending rule exists');
  assert.match(pending[1], /opacity: 0\.\d+/);
  assert.match(pending[1], /pointer-events: none/);
  assert.doesNotMatch(pending[1], /display: none/, 'display:none would slide the other icon over');
  assert.match(css, /^\.ac-item-actions \.icon-btn \{ transition: opacity/m, 'the change is a transition');
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.ac-item-actions \.icon-btn \{ transition: none; \} \}/);
});

// ---- do you follow them, without loading everyone they follow ----

function followWorld({ cache = null, ev = undefined } = {}) {
  const asked = [];
  const ctx = {
    state: { activePubkey: ME },
    followListCache: cache,
    followListPubkey: cache ? ME : null,
    readRelayUrls: async () => ['wss://r'],
    poolGet: async (relays, filter) => { asked.push(filter); return ev; },
  };
  vm.createContext(ctx);
  vm.runInContext(lift(/  async function isFollowing\(target\) \{[\s\S]*?\n  \}\n/, 'isFollowing') + '\nglobalThis.isFollowing = isFollowing;', ctx);
  return { ctx, asked };
}

test('a loaded follow list answers at once, with no relay at all', async () => {
  const { ctx, asked } = followWorld({ cache: [{ pubkey: BOB }] });
  assert.equal(await ctx.isFollowing(BOB), true);
  assert.equal(await ctx.isFollowing(CAL), false);
  assert.equal(asked.length, 0);
});

test('with nothing loaded it asks for the kind 3 alone, never every follow\'s profile', async () => {
  const { ctx, asked } = followWorld({ ev: { kind: 3, tags: [['p', BOB]] } });
  assert.equal(await ctx.isFollowing(BOB), true);
  assert.equal(await ctx.isFollowing(CAL), false);
  assert.deepEqual(plain(asked[0]), { kinds: [3], authors: [ME] });
});

test('no follow list came back: that is no answer, so it rejects instead of saying no', async () => {
  const { ctx } = followWorld({ ev: null });
  await assert.rejects(() => ctx.isFollowing(BOB), /No follow list/);
});

// ---- the icon row on the card: bolt and way out, with Pay offer inside the payment area ----

test('the bolt and the link are on every card; follow and mute only for other people', () => {
  const at = source.indexOf('const manage = ');
  const block = source.slice(at, at + 1400);
  assert.match(block, /toolbar\.append\(zapBtn, open\)/, 'unconditional, so your own card and a zap card keep them');
  assert.match(block, /if \(manage\) toolbar\.append\(h\('span', \{ className: 'peek-tool-sep' \}\)\)/, 'the divider only where there is something to divide');
  assert.doesNotMatch(source, /modal\.append\(zapWrap\)/, 'the payment area sits under the row, not at the foot of the card');
});

test('both are icons with names for assistive tech, and no words on the card for them', () => {
  assert.match(source, /const zapBtn = h\('button', \{ className: 'icon-btn sm peek-bolt pending', type: 'button', title: zapLabel, disabled: true \}\);/);
  assert.match(source, /zapBtn\.setAttribute\('aria-label', zapLabel\)/);
  assert.match(source, /const open = h\('button', \{ className: 'icon-btn sm', type: 'button', title: t\('View in client'\) \}\);\s*open\.setAttribute\('aria-label', t\('View in client'\)\);\s*open\.append\(icon\('external'\)\);/);
  assert.match(source, /open\.title = label;\s*open\.setAttribute\('aria-label', label\);/, 'the client is named in the tooltip once known');
  const actions = source.match(/actions\.append\(close\);/);
  assert.ok(actions, 'only Close is left in the foot of the card');
});

test('the bolt is enabled by whichever of a zap or an offer turns up first', () => {
  assert.match(source, /zapPanel = \(zapHasWallet && !isSelf\)[\s\S]*?\n\s*enableBolt\(\);/, 'an address enables it');
  assert.match(source, /offerFound = offer;\s*enableBolt\(\);/, 'an offer alone enables it');
  assert.match(source, /const enableBolt = \(\) => \{ zapBtn\.disabled = false; zapBtn\.classList\.remove\('pending'\); \};/);
});

test('the bolt is gold, set apart by a divider, and the area waits for a panel', () => {
  assert.match(css, /^\.peek-bolt \{ color: var\(--gold\); \}/m);
  assert.match(css, /^\.peek-tool-sep \{[^}]*width: 1px/m);
  const wash = css.match(/^\.peek-person-actions \.peek-bolt\.peek-pay-on \{([^}]*)\}/m);
  assert.ok(wash && !/padding|font-size|border-width/.test(wash[1]), 'the row must not move when a panel opens');
});

// The payment area's state, run: a hidden area, an offer with no address, and both.
function payWorld({ zapOpen = false, offerOpen = false, hasZap = true, offerShown = false } = {}) {
  const mk = (hidden) => { const e = el('div'); if (hidden) e.classList.add('hidden'); e.isConnected = true; return e; };
  const ctx = {
    zapPanel: hasZap ? mk(!zapOpen) : null,
    offerPanel: mk(!offerOpen), offerHandoff: null,
    zapBtn: el('button'), offerBtn: el('button'),
    zapWrap: Object.assign(el('div'), { appended: [] }), payRow: el('div'),
    offerShown,
  };
  ctx.zapWrap.append = (x) => ctx.zapWrap.appended.push(x);
  vm.createContext(ctx);
  vm.runInContext(lift(/      function paintPayState\(\) \{[\s\S]*?\n      \}\n/, 'paintPayState') + '\nglobalThis.paint = paintPayState;', ctx);
  return ctx;
}

test('the payment area is hidden until a panel is open', () => {
  const closed = payWorld();
  closed.paint();
  assert.equal(closed.zapWrap.classList.contains('hidden'), true);
  const open = payWorld({ zapOpen: true });
  open.paint();
  assert.equal(open.zapWrap.classList.contains('hidden'), false);
  assert.equal(open.zapBtn.classList.contains('peek-pay-on'), true);
  assert.equal(open.zapBtn.attrs['aria-expanded'], 'true');
});

test('Pay offer is in the area only beside a zap panel', () => {
  const both = payWorld({ zapOpen: true, offerShown: true });
  both.paint();
  assert.equal(both.payRow.classList.contains('hidden'), false);
  const zapOnly = payWorld({ zapOpen: true, offerShown: false });
  zapOnly.paint();
  assert.equal(zapOnly.payRow.classList.contains('hidden'), true);
  const offerOnly = payWorld({ hasZap: false, offerOpen: true, offerShown: true });
  offerOnly.paint();
  assert.equal(offerOnly.payRow.classList.contains('hidden'), true, 'the bolt opens it directly, so the second button would only repeat it');
});

test('an offer with no address: the bolt carries the open state, and the area shows', () => {
  const w = payWorld({ hasZap: false, offerOpen: true, offerShown: true });
  w.paint();
  assert.equal(w.zapWrap.classList.contains('hidden'), false);
  assert.equal(w.zapBtn.classList.contains('peek-pay-on'), true);
  assert.equal(w.zapBtn.attrs['aria-expanded'], 'true');
  assert.equal(w.offerBtn.classList.contains('peek-pay-on'), true);
});

test('the payment area is kept last in its own container so panels open above Pay offer', () => {
  const w = payWorld({ zapOpen: true, offerShown: true });
  w.paint();
  assert.equal(w.zapWrap.appended.at(-1), w.payRow);
});

// ---- the mark beside the name follows the icon ----

test('following sets the row to Following at the moment of the tap, before the relays answer', async () => {
  const w = rowWorld();
  w.gates.follow = deferred();
  const tiers = [];
  const c = { pubkey: BOB, name: 'Bob', tier: 0 };
  const [follow] = w.ctx.actions(c, { onTier: () => tiers.push(c.tier) }).children;
  const pending = follow.click();
  await settle();
  assert.deepEqual(tiers, [2], 'the mark changed while the write is still in flight');
  w.gates.follow.resolve(true);
  await pending;
  await settle();
  assert.equal(c.tier, 2);
});

test('a failed follow takes the mark back to what it was', async () => {
  const w = rowWorld();
  w.gates.follow = deferred();
  const tiers = [];
  const c = { pubkey: BOB, name: 'Bob', tier: 1 };
  const [follow] = w.ctx.actions(c, { onTier: () => tiers.push(c.tier) }).children;
  const pending = follow.click();
  await settle();
  w.gates.follow.reject(new Error('nope'));
  await pending;
  await settle();
  assert.deepEqual(tiers, [2, 1]);
  assert.equal(c.tier, 1);
});

test('unfollowing falls back to the network mark if your follows still vouch, else to none, and never counts the person just removed', async () => {
  const w = rowWorld();
  w.ctx.followListCache = [{ pubkey: BOB }, { pubkey: CAL }];
  ctxTrust.seen = [];
  ctxTrust.value = 1;
  const c = { pubkey: BOB, name: 'Bob', tier: 2 };
  const [follow] = w.ctx.actions(c, { onTier: () => {} }).children;
  await follow.click();
  assert.equal(c.tier, 1);
  assert.deepEqual(plain(ctxTrust.seen[0]), [BOB, [CAL]], 'the follow list the tier is judged against no longer holds them');
  ctxTrust.value = 0;
});

// The real renderSearchResults, on a small DOM stand-in.
function node(tag) {
  const n = {
    tag, children: [], parent: null, className: '', textContent: '', classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); } },
    dataset: {}, listeners: {},
    append(...k) { for (const x of k) { x.parent = n; n.children.push(x); } },
    prepend(x) { x.parent = n; n.children.unshift(x); },
    appendChild(x) { n.append(x); return x; },
    after(x) { const i = n.parent.children.indexOf(n); x.parent = n.parent; n.parent.children.splice(i + 1, 0, x); },
    remove() { if (n.parent) n.parent.children = n.parent.children.filter((x) => x !== n); },
    querySelector(sel) { const cls = sel.slice(1); return n.children.find((x) => String(x.className).split(/\s+/).includes(cls)) || null; },
    addEventListener(e, f) { (n.listeners[e] = n.listeners[e] || []).push(f); },
    set innerHTML(_) { n.children = []; },
  };
  return n;
}

function renderWorld() {
  const box = node('div');
  const rows = {};
  const ctx = withI18n({
    searchResults: [], searchIndex: -1,
    state: { activePubkey: ME, accounts: [{ pubkey: ME }] },
    $: () => box,
    h: (tag, props, kids) => { const n = node(tag); Object.assign(n, props || {}); (kids || []).forEach((k) => n.append(k)); return n; },
    applyAvatar: () => {},
    personActions: (c, opts) => { const a = node('span'); a.className = 'ac-item-actions'; a.opts = opts; rows[c.pubkey] = a; return a; },
    closeSearch: () => {}, openProfileSheet: () => {},
  });
  vm.createContext(ctx);
  vm.runInContext(lift(/  function renderSearchResults\(items, loading, askEl\) \{[\s\S]*?\n  \}\n/, 'renderSearchResults') + '\nglobalThis.render = renderSearchResults;', ctx);
  return { ctx, box, rows };
}
const classes = (n) => String(n.className).split(/\s+/);

test('a result draws its mark from its tier: Following, In your network, or nothing for a stranger', () => {
  const { ctx, box } = renderWorld();
  ctx.render([{ pubkey: BOB, name: 'B', tier: 2 }, { pubkey: CAL, name: 'C', tier: 1 }, { pubkey: DAN, name: 'D', tier: 0 }], false, null);
  const marks = box.children.map((row) => row.children.find((x) => classes(x).includes('ac-item-trust')));
  assert.equal(marks[0].textContent, 'Following');
  assert.equal(marks[1].textContent, 'In your network');
  assert.equal(marks[2], undefined, 'absence of a vouch is not labeled');
});

test('the mark sits between the name and the buttons, and is redrawn in place when the tier changes', () => {
  const { ctx, box, rows } = renderWorld();
  const c = { pubkey: BOB, name: 'Bob', tier: 0 };
  ctx.render([c], false, null);
  const row = box.children[0];
  const order = () => row.children.map((x) => classes(x).find((k) => /^ac-item-/.test(k)));
  assert.deepEqual(order(), ['ac-item-av', 'ac-item-name', 'ac-item-actions']);
  c.tier = 2; rows[BOB].opts.onTier();
  assert.deepEqual(order(), ['ac-item-av', 'ac-item-name', 'ac-item-trust', 'ac-item-actions']);
  assert.equal(row.children[2].textContent, 'Following');
  c.tier = 1; rows[BOB].opts.onTier();
  assert.equal(row.children.filter((x) => classes(x).includes('ac-item-trust')).length, 1, 'one mark, never two');
  assert.equal(row.children[2].textContent, 'In your network');
  c.tier = 0; rows[BOB].opts.onTier();
  assert.deepEqual(order(), ['ac-item-av', 'ac-item-name', 'ac-item-actions'], 'gone again on unfollow');
});

test('the link out opens the profile in a tab and leaves the card open', () => {
  const at = source.indexOf("open.addEventListener('click', async () => {");
  assert.ok(at > 0, 'the handler moved');
  const handler = source.slice(at, source.indexOf('});', at) + 3);
  assert.match(handler, /openInClient\(client\.profile\(npub\)\)/);
  assert.doesNotMatch(handler, /closeModal/, 'the card closed itself when the profile opened elsewhere');
});
