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
function fakePool() {
  const asked = [];
  return {
    asked,
    subscribeMany(relays, filter, params) {
      asked.push({ relays, filter });
      setTimeout(() => {
        if (filter.kinds && filter.kinds[0] === 0) {
          params.onevent({ kind: 0, id: 'e'.repeat(64), pubkey: 'a'.repeat(64), created_at: 5, sig: 's', tags: [], content: JSON.stringify({ name: 'Alice' }) });
        }
        params.oneose();
      }, 0);
      return { close() {} };
    },
  };
}

function build(file, { enabled, legacy, pool }) {
  const source = read(file);
  const lift = (pattern, label) => {
    const m = source.match(pattern);
    if (!m) throw new Error('Could not find ' + label + ' in ' + file);
    return m[0];
  };
  const settings = {};
  if (enabled !== undefined) settings.nameSearch = enabled;
  if (legacy !== undefined) settings.nostrArchives = legacy;
  const listeners = [];
  const ctx = {
    console, Date, setTimeout, clearTimeout,
    NT: { verifyEvent: () => true, nip19: { npubEncode: (pk) => 'npub1' + pk.slice(0, 20) } },
    shortNpub: (npub) => npub.slice(0, 12) + '…',
    state: { activePubkey: 'c'.repeat(64) },
    call: async () => {},
    getPool: () => pool,
    pool: () => pool,
    readRelayUrls: async () => [],
    relayUrls: async () => [],
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
    lift(/let naSettingMemo;[\s\S]*?let naSettingLoaded = false;\n/, 'memo state'),
    lift(/function naSetting\(\) \{[\s\S]*?\n  \}/, 'naSetting'),
    panel ? lift(/function naSetSettingMemo\(on\) \{[^\n]*\n/, 'naSetSettingMemo') : '',
    panel ? lift(/async function naEnabled\(\) \{[^\n]*\n/, 'naEnabled') : '',
    lift(/async function naDecide\(on\) \{[\s\S]*?\n  \}/, 'naDecide'),
    lift(/async function naSuggest\(query\) \{[\s\S]*?\n  \}/, 'naSuggest'),
    'globalThis.naSuggest = naSuggest; globalThis.naSetting = naSetting; globalThis.naDecide = naDecide; globalThis.naAvailable = naAvailable;',
    panel ? 'globalThis.naEnabled = naEnabled;' : '',
  ].join('\n'), ctx);
  return { ctx, pool, listeners };
}

for (const [label, file] of [['side panel', 'sidepanel.js'], ['expanded composer', 'compose.js']]) {
  test(label + ', setting unset (never asked): nothing leaves — the ask is the only enabler', async () => {
    const { ctx, pool } = build(file, { enabled: undefined, pool: fakePool() });
    assert.equal((await ctx.naSuggest('alice')).length, 0);
    assert.equal(pool.asked.length, 0, 'no request may leave before the one-time ask is answered');
  });

  test(label + ', setting off: nothing leaves and the answer is empty', async () => {
    const { ctx, pool } = build(file, { enabled: false, pool: fakePool() });
    assert.equal((await ctx.naSuggest('alice')).length, 0);
    assert.equal(pool.asked.length, 0, 'no request may leave with the search off');
  });

  test(label + ', setting on: the search relay is asked, and a profile comes back as a name', async () => {
    const { ctx, pool } = build(file, { enabled: true, pool: fakePool() });
    const out = await ctx.naSuggest('alice');
    assert.equal(pool.asked.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(pool.asked[0].relays)), ['wss://search.brainstorm.world']);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'Alice');
    assert.equal(out[0].pubkey, 'a'.repeat(64));
  });

  test(label + ', answering the ask yes is the enabler end to end: decide(true), then the search asks', async () => {
    // Storage still reports unset (the write goes through the worker, absent here); the memo
    // naDecide sets is what lets the search proceed. This pins the wiring from the ask's
    // button to the gate without a DOM.
    const { ctx, pool } = build(file, { enabled: undefined, pool: fakePool() });
    assert.equal(pool.asked.length, 0);
    await ctx.naDecide(true);
    await ctx.naSuggest('alice');
    assert.equal(pool.asked.length, 1, 'after deciding yes, the search must fire without a reload');
  });

  test(label + ', answering the ask no keeps the gate closed without storage being consulted again', async () => {
    const { ctx, pool } = build(file, { enabled: undefined, pool: fakePool() });
    await ctx.naDecide(false);
    assert.equal((await ctx.naSuggest('alice')).length, 0);
    assert.equal(pool.asked.length, 0, 'deciding no must seal the gate via the memo, not just storage');
  });

  test(label + ': the decision is written under its own key, not the old index’s', async () => {
    const { ctx } = build(file, { enabled: undefined, pool: fakePool() });
    const sent = [];
    ctx.call = async (m) => { sent.push(m); };
    await ctx.naDecide(true);
    assert.deepEqual(JSON.parse(JSON.stringify(sent[0].settings)), { nameSearch: true });
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
    const { ctx } = build(file, { enabled: true, pool: fakePool() });
    let reads = 0;
    const orig = ctx.chrome.storage.local.get;
    ctx.chrome.storage.local.get = (k, cb) => { reads++; return orig(k, cb); };
    await ctx.naSetting();
    await ctx.naSetting();
    await ctx.naSetting();
    assert.equal(reads, 1, 'storage is read once; every keystroke after that is synchronous');
  });

  test(label + ': when no relay answers, the search backs off instead of waiting on every key', async () => {
    const silent = { asked: [], subscribeMany(relays, filter, params) { this.asked.push(filter); setTimeout(() => params.onclose([]), 0); return { close() {} }; } };
    const { ctx } = build(file, { enabled: true, pool: silent });
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
  assert.match(page, /NS\.decision\(changes\.sidecar_settings\.newValue \|\| \{\}\)/);
});

test('the ask names the relay and says what it sees: what you type, and nothing about who you follow', () => {
  for (const f of ['sidepanel.js', 'compose.js']) {
    const src = read(f);
    assert.match(src, /Also search names beyond your follows\? This uses a search relay \(\{\{host\}\}\) that sees what you type\./, f);
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
