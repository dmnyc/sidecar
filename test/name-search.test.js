'use strict';

// The global name search (name-search.js), run for real: a pool that answers the way relays do,
// real signatures from the vendored nostr-tools, and a clock the test moves.
//
// What has to hold: the text typed goes to the search relay and nothing about the account does;
// what comes back is only what verifies; and when that relay is down the account's own search
// relays are asked, without making every key wait out a timeout.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
let clock = 1_000_000;
const ctx = { console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, crypto: require('node:crypto').webcrypto, Date: { now: () => clock } };
ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'nostr-tools.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'name-search.js'), 'utf8'), ctx);
const NS = ctx.SidecarNameSearch;
const NT = ctx.NostrTools;
vm.runInContext(`
  this.sk = (n) => Uint8Array.from(String(n).padStart(64, '0').match(/../g).map((h) => parseInt(h, 16)));
  this.mk = (n, kind, content, tags, at) => NostrTools.finalizeEvent({ kind, content, tags: tags || [], created_at: at || 100 }, this.sk(n));
  this.pk = (n) => NostrTools.getPublicKey(this.sk(n));
`, ctx);
const mk = ctx.mk;
const pk = ctx.pk;
const plain = (x) => JSON.parse(JSON.stringify(x));

const ME = 'c'.repeat(64);
const profile = (n, c, at) => mk(n, 0, JSON.stringify(c), [], at);
// An event as a relay delivers it: parsed from JSON, so it carries no cached "verified" mark,
// and then changed. (Copying a freshly signed event would copy that mark with it.)
const tampered = (ev, changes) => Object.assign(JSON.parse(JSON.stringify(ev)), changes);

// A pool whose relays are scripted: for each subscription it looks up what its relays say.
function scriptedPool(script) {
  const asked = [];
  return {
    asked,
    subscribeMany(relays, filter, params) {
      asked.push({ relays: plain(relays), filter: plain(filter) });
      setTimeout(() => {
        const r = script(relays, filter);
        if (r === 'silent') { params.onclose([]); return; }
        if (r === 'closed') { params.onclose(['auth-required: sign in']); return; }
        (r || []).forEach((ev) => params.onevent(ev));
        params.oneose();
      }, 0);
      return { close() {} };
    },
  };
}
const deps = (pool, extra) => Object.assign({ pool, verify: NT.verifyEvent, pubkey: ME, readRelays: async () => ['wss://mine.example'] }, extra);

beforeEach(() => { NS.reset(); clock += 10 * 60 * 1000; });

test('the setting: its own key, an old "no" carried over, an old "yes" not', () => {
  assert.equal(NS.choice({}), undefined);
  assert.equal(NS.choice(null), undefined);
  for (const v of ['follows', 'account', 'default', 'custom']) assert.equal(NS.choice({ nameSearch: v }), v);
  assert.equal(NS.choice({ nameSearch: true }), 'default', 'a yes written by an earlier build of this setting');
  assert.equal(NS.choice({ nameSearch: false }), 'follows');
  assert.equal(NS.choice({ nameSearch: 'anything else' }), undefined, 'an unknown value is not a choice');
  assert.equal(NS.choice({ nostrArchives: true }), undefined, 'a yes given to another service is not a yes to this one');
  assert.equal(NS.choice({ nostrArchives: false }), 'follows', 'a no is kept');
  assert.equal(NS.choice({ nameSearch: 'default', nostrArchives: false }), 'default', 'the new answer wins');
});

test('the plan: what a setting means for an account, and what a yes would turn on', () => {
  const mine = ['wss://mine.example', 'wss://theirs.example'];
  // Nothing chosen: an account with search relays of its own is already using them.
  assert.deepEqual(plain(NS.plan({}, mine)), { mode: 'on', source: 'account', relays: mine, account: mine, offer: { source: 'account', hosts: ['mine.example', 'theirs.example'] } });
  // Nothing chosen and none: ask, and the offer is the default.
  const ask = NS.plan({}, []);
  assert.equal(ask.mode, 'ask');
  assert.deepEqual(plain(ask.offer), { source: 'default', hosts: ['search.brainstorm.world'] });
  // Follows only stays follows only, however many relays the account has; a yes offers its own.
  const off = NS.plan({ nameSearch: 'follows' }, mine);
  assert.equal(off.mode, 'off');
  assert.equal(off.offer.source, 'account');
  assert.equal(NS.plan({ nameSearch: 'follows' }, []).offer.source, 'default');
  // The default, and one typed in.
  assert.deepEqual(plain(NS.plan({ nameSearch: 'default' }, null).relays), ['wss://search.brainstorm.world']);
  assert.deepEqual(plain(NS.plan({ nameSearch: 'custom', nameSearchRelay: 'wss://typed.example' }, null).relays), ['wss://typed.example']);
  assert.equal(NS.plan({ nameSearch: 'custom', nameSearchRelay: 'ws://typed.example' }, null).mode, 'off', 'plain ws is not used');
  // "My search relays" with none published is not a search.
  assert.equal(NS.plan({ nameSearch: 'account' }, []).mode, 'off');
});

test('a relay address someone typed: wss only, no credentials, no spaces', () => {
  assert.equal(NS.cleanRelay('  wss://search.example/path  '), 'wss://search.example/path');
  for (const bad of ['ws://x.example', 'https://x.example', 'wss://u:p@x.example', 'wss://x .example', 'x.example', '', null, undefined, 'wss://' + 'a'.repeat(250)]) {
    assert.equal(NS.cleanRelay(bad), null, String(bad));
  }
});

test('resolve reads the account’s relays only for the sources that use them', async () => {
  const asked = [];
  const pool = { subscribeMany(relays, filter, params) { asked.push(filter.kinds[0]); setTimeout(() => params.oneose(), 0); return { close() {} }; } };
  const d = { pool: () => pool, pubkey: ME, readRelays: async () => ['wss://mine.example'] };
  await NS.resolve({ nameSearch: 'default' }, d);
  await NS.resolve({ nameSearch: 'custom', nameSearchRelay: 'wss://typed.example' }, d);
  assert.deepEqual(asked, [], 'the default and a typed relay never read the account’s list');
  await NS.resolve({}, d);
  assert.deepEqual(asked, [10007]);
});

test('silence is not "no search relays": a list that was not answered is read again soon, not in ten minutes', async () => {
  let answer = false;
  let reads = 0;
  const pool = { subscribeMany(relays, filter, params) {
    reads++;
    setTimeout(() => { if (answer) params.oneose(); else params.onclose([]); }, 0);
    return { close() {} };
  } };
  const d = { pool: () => pool, pubkey: ME, readRelays: async () => ['wss://mine.example'] };
  await NS.resolve({}, d);
  await NS.resolve({}, d);
  assert.equal(reads, 1, 'asked once, and not again on the next keystroke');
  clock += 31 * 1000;
  answer = true;
  await NS.resolve({}, d);
  assert.equal(reads, 2, 'after half a minute the silent read is retried');
  clock += 60 * 1000;
  await NS.resolve({}, d);
  assert.equal(reads, 2, 'an answer is kept');
});

test('typed text is cleaned: instructions to the relay, control characters and exclusions are dropped', () => {
  assert.equal(NS.cleanQuery('alice'), 'alice');
  assert.equal(NS.cleanQuery('  alice   smith '), 'alice smith');
  assert.equal(NS.cleanQuery('include:spam alice'), 'alice');
  assert.equal(NS.cleanQuery('alice observer:' + 'a'.repeat(64)), 'alice');
  assert.equal(NS.cleanQuery('alice sort:rank filter:rank:gte:0'), 'alice');
  assert.equal(NS.cleanQuery('-alice bob'), 'bob');
  assert.equal(NS.cleanQuery('al\u0000ice\n'), 'al ice');
  assert.equal(NS.cleanQuery('x'.repeat(200)).length, 64);
  assert.equal(NS.cleanQuery(undefined), '');
  assert.equal(NS.cleanQuery('include:spam'), '');
});

test('profiles: only a kind 0 that verifies, one per key (the newest), in the relay’s order, at most eight', () => {
  const good = profile(1, { display_name: 'Alice', name: 'alice', picture: 'https://img.example/a.png' });
  const forged = tampered(profile(2, { name: 'Bob' }), { content: JSON.stringify({ name: 'Mallory' }) });
  const wrongKind = mk(3, 1, JSON.stringify({ name: 'Carol' }));
  const older = profile(4, { name: 'Dan old' }, 100);
  const newer = profile(4, { name: 'Dan new' }, 200);
  const badKey = tampered(profile(5, { name: 'Eve' }), { pubkey: 'zz' });
  const out = plain(NS.profiles([good, forged, wrongKind, older, badKey, newer, null], NT.verifyEvent));
  assert.deepEqual(out.map((r) => r.name), ['Alice', 'Dan new']);
  assert.equal(out[0].pubkey, pk(1));
  assert.equal(out[0].picture, 'https://img.example/a.png');
  const many = [];
  for (let i = 10; i < 40; i++) many.push(profile(i, { name: 'p' + i }));
  assert.equal(NS.profiles(many, NT.verifyEvent).length, 8, 'a relay is not obliged to honor its limit');
});

test('profiles: a name is chosen, cleaned and cut; a picture is an http(s) address or nothing', () => {
  const r = plain(NS.profiles([
    profile(1, { display_name: 'Disp', name: 'nm' }),
    profile(2, { displayName: 'Camel', name: 'nm' }),
    profile(3, { name: '  spaced\n  out  ' }),
    profile(4, { name: 'n'.repeat(300) }),
    profile(5, {}),
    mk(6, 0, 'not json'),
    profile(7, { name: 'img', picture: 'javascript:alert(1)' }),
    profile(9, { name: 'img3', picture: 'http://img.example/x.jpg' }),
  ], NT.verifyEvent));
  assert.equal(r[0].name, 'Disp');
  assert.equal(r[1].name, 'Camel');
  assert.equal(r[2].name, 'spaced out');
  assert.equal(r[3].name.length, 80);
  assert.equal(r[4].name, null, 'no name: the page shows a short npub');
  assert.equal(r[5].name, null);
  assert.equal(r[6].picture, null, 'a javascript: address is not a picture');
  assert.equal(r[7].picture, 'http://img.example/x.jpg');
  assert.equal(plain(NS.profiles([profile(8, { name: 'd', picture: 'data:image/png;base64,AAAA' })], NT.verifyEvent))[0].picture, null);
});

test('the search relay is asked the text and a viewpoint of its own, and nothing about the account', async () => {
  const pool = scriptedPool(() => [profile(1, { name: 'Alice' }), profile(2, { name: 'Alicia' })]);
  const out = await NS.search('ali', deps(pool));
  assert.equal(pool.asked.length, 1);
  assert.deepEqual(pool.asked[0].relays, ['wss://search.brainstorm.world']);
  assert.deepEqual(pool.asked[0].filter, { kinds: [0], search: 'ali observer:' + NS.HOUSE_OBSERVER, limit: 8 });
  assert.ok(!JSON.stringify(pool.asked).includes(ME), 'the account’s key went to the search relay');
  assert.deepEqual(plain(out.results).map((r) => r.name), ['Alice', 'Alicia'], 'ranked order is kept');
  assert.equal(out.failed, false);
});

test('what the person typed cannot change the viewpoint or lift the spam floor', async () => {
  const pool = scriptedPool(() => []);
  await NS.search('include:spam observer:' + 'a'.repeat(64) + ' ali', deps(pool));
  assert.equal(pool.asked[0].filter.search, 'ali observer:' + NS.HOUSE_OBSERVER);
});

test('a query too short to mean anything asks nobody', async () => {
  const pool = scriptedPool(() => []);
  for (const q of ['', 'a', ' a ', 'include:spam']) assert.deepEqual(plain(await NS.search(q, deps(pool))), { results: [], failed: false }, JSON.stringify(q));
  assert.equal(pool.asked.length, 0);
});

test('a relay that answers with nothing is "no match", and nobody else is asked', async () => {
  const pool = scriptedPool(() => []);
  assert.deepEqual(plain(await NS.search('zzzz', deps(pool))), { results: [], failed: false });
  assert.equal(pool.asked.length, 1, 'an honest empty answer is not a failure to fall back from');
});

test('forged answers from the search relay are dropped', async () => {
  const real = profile(1, { name: 'Real' });
  const forged = tampered(profile(2, { name: 'Bob' }), { content: JSON.stringify({ name: 'Mallory' }) });
  const out = await NS.search('ab', deps(scriptedPool(() => [forged, real])));
  assert.deepEqual(plain(out.results).map((r) => r.name), ['Real']);
});

test('down: the account’s own search relays are asked, with the text alone, and the main relay is skipped for a minute', async () => {
  const list = mk(7, 10007, '', [['relay', 'wss://mine-search.example'], ['relay', 'ws://insecure.example'], ['relay', 'wss://search.brainstorm.world/'], ['relay', 'wss://two.example']]);
  const mineList = Object.assign({}, list, { pubkey: ME });
  const pool = scriptedPool((relays, filter) => {
    if (relays.includes('wss://search.brainstorm.world')) return 'silent';
    if (filter.kinds[0] === 10007) return [mineList];
    return [profile(1, { name: 'Alice' })];
  });
  const out = await NS.search('ali', deps(pool));
  assert.deepEqual(plain(out.results).map((r) => r.name), ['Alice']);
  assert.equal(out.failed, false);
  const lookups = pool.asked.filter((a) => a.filter.kinds[0] === 10007);
  assert.equal(lookups.length, 1);
  assert.deepEqual(lookups[0].relays, ['wss://mine.example']);
  const fallback = pool.asked[pool.asked.length - 1];
  assert.deepEqual(fallback.relays, ['wss://mine-search.example', 'wss://two.example'], 'wss only, and not the main relay again');
  assert.deepEqual(fallback.filter, { kinds: [0], search: 'ali', limit: 8 }, 'no viewpoint word is sent to a relay that does not know it');

  // The next key, a moment later: straight to the account’s relays, no wait on the one that is down.
  pool.asked.length = 0;
  clock += 5000;
  await NS.search('alic', deps(pool));
  assert.ok(!pool.asked.some((a) => a.relays.includes('wss://search.brainstorm.world')), 'the main relay was asked again inside the minute');
  assert.equal(pool.asked.filter((a) => a.filter.kinds[0] === 10007).length, 0, 'the list is remembered');

  // A minute on, the main relay is tried again.
  clock += 61 * 1000;
  pool.asked.length = 0;
  await NS.search('alice', deps(pool));
  assert.ok(pool.asked.some((a) => a.relays.includes('wss://search.brainstorm.world')));
});

test('a relay that closes the subscription with a reason has not answered', async () => {
  const pool = scriptedPool((relays) => (relays.includes('wss://search.brainstorm.world') ? 'closed' : []));
  const out = await NS.search('ali', deps(pool, { readRelays: async () => [] }));
  assert.deepEqual(plain(out), { results: [], failed: true });
});

test('down with no search relays of its own: failed, so the page stops asking for a while', async () => {
  const pool = scriptedPool((relays, filter) => (filter.kinds[0] === 10007 ? [] : 'silent'));
  assert.deepEqual(plain(await NS.search('ali', deps(pool))), { results: [], failed: true });
});

test('another account’s search relay list is not this account’s', async () => {
  const theirs = Object.assign({}, mk(8, 10007, '', [['relay', 'wss://theirs.example']]), { pubkey: 'd'.repeat(64) });
  const pool = scriptedPool((relays, filter) => {
    if (relays.includes('wss://search.brainstorm.world')) return 'silent';
    if (filter.kinds[0] === 10007) return [theirs];
    return [profile(1, { name: 'Alice' })];
  });
  assert.deepEqual(plain(await NS.search('ali', deps(pool))), { results: [], failed: true });
  assert.ok(!pool.asked.some((a) => a.relays.includes('wss://theirs.example')));
});

test('a pool that throws is a failure, never an exception', async () => {
  const pool = { subscribeMany() { throw new Error('socket'); } };
  assert.deepEqual(plain(await NS.search('ali', deps(pool, { readRelays: async () => { throw new Error('x'); } }))), { results: [], failed: true });
});
