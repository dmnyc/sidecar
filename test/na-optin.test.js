'use strict';

// Unit coverage for the global name search's opt-in gate (audit issue #194).
//
// A name search sends what you are typing to a relay that is not one of yours. The setting is
// tri-state: undefined = never asked (a one-time ask renders in the dropdown on first use),
// true/false = decided. The pin that matters is: with the setting unset OR off, NO request
// leaves at all. The ask is the only enabler. Falling back to empty is what keeps mention
// search relay-only until then. The search itself is covered in name-search.test.js; these
// run each page's own copy of the gate, lifted out of the source, against a pool that counts
// what it is asked.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// A pool that records every subscription and answers each with one profile and EOSE.
function fakePool({ list } = {}) {
  const asked = [];
  return {
    asked,
    subscribeMany(relays, filter, params) {
      asked.push({ relays, filter });
      setTimeout(() => {
        if (list && filter.kinds && filter.kinds[0] === 10007) {
          params.onevent({ kind: 10007, id: 'd'.repeat(64), pubkey: 'c'.repeat(64), created_at: 9, sig: 's', tags: list.map((u) => ['relay', u]), content: '' });
        }
        if (filter.kinds && filter.kinds[0] === 0) {
          params.onevent({ kind: 0, id: 'e'.repeat(64), pubkey: 'a'.repeat(64), created_at: 5, sig: 's', tags: [], content: JSON.stringify({ name: 'Alice' }) });
        }
        params.oneose();
      }, 0);
      return { close() {} };
    },
  };
}

function build(file, { enabled, legacy, pool, custom, list }) {
  const source = read(file);
  const lift = (pattern, label) => {
    const m = source.match(pattern);
    if (!m) throw new Error('Could not find ' + label + ' in ' + file);
    return m[0];
  };
  const settings = {};
  if (enabled !== undefined) settings.nameSearch = enabled;
  if (legacy !== undefined) settings.nostrArchives = legacy;
  if (custom !== undefined) settings.nameSearchRelay = custom;
  const listeners = [];
  const ctx = {
    console, Date, setTimeout, clearTimeout,
    NT: { verifyEvent: () => true, nip19: { npubEncode: (pk) => 'npub1' + pk.slice(0, 20) } },
    shortNpub: (npub) => npub.slice(0, 12) + '…',
    state: { activePubkey: 'c'.repeat(64) },
    call: async () => {},
    getPool: () => pool,
    pool: () => pool,
    readRelayUrls: async () => (list ? ['wss://mine.example'] : []),
    relayUrls: async () => (list ? ['wss://mine.example'] : []),
    chrome: {
      storage: {
        local: { get: (key, cb) => cb({ sidecar_settings: settings }) },
        onChanged: { addListener: (fn) => listeners.push(fn) },
      },
    },
  };
  ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('name-search.js'), ctx);
  const panel = file === 'sidepanel.js';
  vm.runInContext([
    'const NS = self.SidecarNameSearch;',
    lift(/const isHex64 = \(s\) =>[^\n]*\n/, 'isHex64'),
    lift(/let naCooldownUntil = 0;[\s\S]*?const naAvailable[^\n]*\n/, 'cooldown helpers'),
    lift(/function naBackoff\(retryAfter\) \{[\s\S]*?\n  \}/, 'naBackoff'),
    lift(/let naSettingMemo;[\s\S]*?async function naSetting\(\) \{[\s\S]*?\n  \}/, 'settings memo and plan'),
    panel ? lift(/async function naEnabled\(\) \{[^\n]*\n/, 'naEnabled') : '',
    lift(/async function naDecide\(on\) \{[\s\S]*?\n  \}/, 'naDecide'),
    lift(/async function naSuggest\(query\) \{[\s\S]*?\n  \}/, 'naSuggest'),
    'globalThis.naSuggest = naSuggest; globalThis.naSetting = naSetting; globalThis.naDecide = naDecide; globalThis.naAvailable = naAvailable;',
    panel ? 'globalThis.naEnabled = naEnabled;' : '',
  ].join('\n'), ctx);
  return { ctx, pool, listeners };
}

const plain = (x) => JSON.parse(JSON.stringify(x));

for (const [label, file] of [['side panel', 'sidepanel.js'], ['expanded composer', 'compose.js']]) {
  test(label + ', nothing chosen and no search relays of the account’s own: nothing leaves, and the ask is due', async () => {
    const { ctx, pool } = build(file, { enabled: undefined, pool: fakePool() });
    assert.equal(await ctx.naSetting(), undefined, 'undefined means ask');
    assert.equal((await ctx.naSuggest('alice')).length, 0);
    assert.equal(pool.asked.length, 0, 'no request may leave before the one-time ask is answered');
  });

  test(label + ', follows only: nothing leaves and the answer is empty', async () => {
    for (const enabled of ['follows', false]) {
      const { ctx, pool } = build(file, { enabled, pool: fakePool() });
      assert.equal(await ctx.naSetting(), false);
      assert.equal((await ctx.naSuggest('alice')).length, 0);
      assert.equal(pool.asked.length, 0, 'no request may leave with the search off');
    }
  });

  test(label + ', the default: the search relay is asked, and a profile comes back as a name', async () => {
    for (const enabled of ['default', true]) { // true is what an earlier build of the setting wrote
      const { ctx, pool } = build(file, { enabled, pool: fakePool() });
      const out = await ctx.naSuggest('alice');
      assert.equal(pool.asked.length, 1);
      assert.deepEqual(plain(pool.asked[0].relays), ['wss://search.brainstorm.world']);
      assert.match(pool.asked[0].filter.search, / observer:[0-9a-f]{64}$/, 'the default relay is asked with a viewpoint');
      assert.equal(out.length, 1);
      assert.equal(out[0].name, 'Alice');
      assert.equal(out[0].pubkey, 'a'.repeat(64));
    }
  });

  test(label + ', an account that has published search relays uses them with no question asked, and no viewpoint is sent', async () => {
    const { ctx, pool } = build(file, { enabled: undefined, list: ['wss://mine.example', 'wss://theirs.example'], pool: fakePool({ list: ['wss://mine.example', 'wss://theirs.example'] }) });
    assert.equal(await ctx.naSetting(), true, 'nothing to ask: they named these relays for this');
    const out = await ctx.naSuggest('alice');
    const searches = pool.asked.filter((a) => a.filter.kinds[0] === 0);
    assert.equal(searches.length, 1);
    assert.deepEqual(plain(searches[0].relays), ['wss://mine.example', 'wss://theirs.example']);
    assert.equal(searches[0].filter.search, 'alice', 'a relay that is not the default is sent the text and nothing else');
    assert.equal(out.length, 1);
    assert.ok(!pool.asked.some((a) => a.relays.includes('wss://search.brainstorm.world')), 'the default is never contacted');
  });

  test(label + ', their own relay list that includes the default is asked the way the default wants', async () => {
    const list = ['wss://mine.example', 'wss://search.brainstorm.world'];
    const { ctx, pool } = build(file, { enabled: 'account', list, pool: fakePool({ list }) });
    await ctx.naSuggest('alice');
    const searches = pool.asked.filter((a) => a.filter.kinds[0] === 0);
    const main = searches.find((a) => a.relays.includes('wss://search.brainstorm.world'));
    const rest = searches.find((a) => a.relays.includes('wss://mine.example'));
    assert.match(main.filter.search, / observer:[0-9a-f]{64}$/);
    assert.equal(rest.filter.search, 'alice');
  });

  test(label + ', a relay typed in is the only one asked, and a bad address is not used', async () => {
    const good = build(file, { enabled: 'custom', custom: 'wss://typed.example', pool: fakePool() });
    assert.equal(await good.ctx.naSetting(), true);
    await good.ctx.naSuggest('alice');
    assert.deepEqual(plain(good.pool.asked.map((a) => a.relays)), [['wss://typed.example']]);
    for (const custom of ['http://typed.example', 'wss://user:pw@typed.example', 'typed.example', '', 'wss://a b.example']) {
      const bad = build(file, { enabled: 'custom', custom, pool: fakePool() });
      assert.equal(await bad.ctx.naSetting(), false, JSON.stringify(custom));
      assert.equal((await bad.ctx.naSuggest('alice')).length, 0);
      assert.equal(bad.pool.asked.length, 0, 'an address that is not wss:// is never used');
    }
  });

  test(label + ', a relay they chose that does not answer is not swapped for another', async () => {
    const silent = { asked: [], subscribeMany(relays, filter, params) { this.asked.push({ relays, filter }); setTimeout(() => params.onclose([]), 0); return { close() {} }; } };
    const { ctx } = build(file, { enabled: 'custom', custom: 'wss://typed.example', pool: silent });
    assert.equal((await ctx.naSuggest('alice')).length, 0);
    assert.ok(silent.asked.every((a) => !a.relays.includes('wss://search.brainstorm.world')), 'their typing must not go to the default');
    assert.equal(ctx.naAvailable(), false, 'and the search pauses instead of waiting on every key');
  });

  test(label + ', answering the ask yes turns on what it offered: the default, or their own relays when they have some', async () => {
    const none = build(file, { enabled: undefined, pool: fakePool() });
    const sent = [];
    none.ctx.call = async (m) => { sent.push(m); };
    await none.ctx.naSetting(); // the page plans first, which is what the ask is built from
    await none.ctx.naDecide(true);
    assert.deepEqual(plain(sent[0].settings), { nameSearch: 'default' });
    await none.ctx.naSuggest('alice');
    assert.equal(none.pool.asked.length, 1, 'after deciding yes, the search must fire without a reload');

    const own = build(file, { enabled: 'follows', list: ['wss://mine.example'], pool: fakePool({ list: ['wss://mine.example'] }) });
    const sent2 = [];
    own.ctx.call = async (m) => { sent2.push(m); };
    assert.equal(await own.ctx.naSetting(), false, 'they said follows only, and that holds');
    await own.ctx.naDecide(true);
    assert.deepEqual(plain(sent2[0].settings), { nameSearch: 'account' }, 'a yes offered their own relays');
  });

  test(label + ', answering the ask no keeps the gate closed without storage being consulted again', async () => {
    const { ctx, pool } = build(file, { enabled: undefined, pool: fakePool() });
    const sent = [];
    ctx.call = async (m) => { sent.push(m); };
    await ctx.naSetting();
    await ctx.naDecide(false);
    assert.deepEqual(plain(sent[0].settings), { nameSearch: 'follows' });
    assert.equal((await ctx.naSuggest('alice')).length, 0);
    assert.equal(pool.asked.length, 0, 'deciding no must seal the gate via the memo, not just storage');
  });

  test(label + ': an answer given to the previous index does not switch this one on, but a no is kept', async () => {
    // A yes was about a different service: it is asked again. A no is not a question to repeat.
    const yes = build(file, { enabled: undefined, legacy: true, pool: fakePool() });
    assert.equal(await yes.ctx.naSetting(), undefined);
    assert.equal((await yes.ctx.naSuggest('alice')).length, 0);
    assert.equal(yes.pool.asked.length, 0, 'an old yes must not send anything');
    const no = build(file, { enabled: undefined, legacy: false, pool: fakePool() });
    assert.equal(await no.ctx.naSetting(), false);
    assert.equal(no.pool.asked.length, 0);
  });

  test(label + ': the memo serves later reads without going back to storage', async () => {
    const { ctx } = build(file, { enabled: 'default', pool: fakePool() });
    let reads = 0;
    const orig = ctx.chrome.storage.local.get;
    ctx.chrome.storage.local.get = (k, cb) => { reads++; return orig(k, cb); };
    await ctx.naSetting();
    await ctx.naSetting();
    await ctx.naSetting();
    assert.equal(reads, 1, 'storage is read once; every keystroke after that is synchronous');
  });

  test(label + ', the default not answering: the search backs off instead of waiting on every key', async () => {
    const silent = { asked: [], subscribeMany(relays, filter, params) { this.asked.push(filter); setTimeout(() => params.onclose([]), 0); return { close() {} }; } };
    const { ctx } = build(file, { enabled: 'default', pool: silent });
    assert.equal((await ctx.naSuggest('alice')).length, 0);
    assert.equal(ctx.naAvailable(), false, 'a failed search must pause the next ones');
  });
}

test('the tab hears a decision made in the panel', () => {
  // The tab memoizes like the panel, but the decision it mirrors is often made in a different
  // document (the panel's Settings), so the memo listens to storage instead of trusting its own
  // first read forever. The registration sits at module scope, outside the lifted functions.
  const page = read('compose.js');
  assert.match(page, /chrome\.storage\.onChanged\.addListener/);
  assert.match(page, /naSettingMemo = changes\.sidecar_settings\.newValue \|\| \{\}/);
});

test('the ask names the relay and says what it sees: what you type, and nothing about who you follow', () => {
  for (const f of ['sidepanel.js', 'compose.js']) {
    const src = read(f);
    assert.match(src, /Find people beyond your follows\? Search defaults to \{\{name\}\}’s relay\. Change this in Settings\./, f);
    assert.match(src, /Find people beyond your follows\? Search will use your search relays \(\{\{hosts\}\}\)\. Change this in Settings\./, f);
    assert.match(src, /Search everyone/, f);
    assert.match(src, /Just my follows/, f);
    assert.doesNotMatch(src, /who you follow\./, f + ' still says the search sees who you follow');
  }
});

test('nothing sends the follow list anywhere for a name any more', () => {
  const panel = read('sidepanel.js');
  assert.doesNotMatch(panel, /naMetadata/);
  assert.doesNotMatch(panel, /nostrarchives/i);
  assert.doesNotMatch(read('compose.js'), /nostrarchives/i);
});
