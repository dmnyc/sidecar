'use strict';

// Unit coverage for the Nostr Archives opt-in gate (audit issue #194).
//
// naSuggest and naMetadata disclose data the relays never see together — what
// you type in the composer, and your follow list in chunks. The setting is
// tri-state: undefined = never asked (a one-time ask renders in the dropdown on
// first use), true/false = decided. The pin that matters is: with the setting
// unset OR off, NO fetch happens at all — the ask is the only enabler. Falling
// back to empty is what keeps mention search relay-only until then.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

function harness({ enabled }) {
  const fetchCalls = [];
  const ctx = {
    NA_BASE: 'https://api.nostrarchives.test',
    console,
    AbortSignal: { timeout: (ms) => ms },
    Date,
    chrome: {
      storage: {
        local: { get: (key, cb) => cb({ sidecar_settings: { nostrArchives: enabled } }) },
      },
    },
    fetch: async (url, opts) => {
      fetchCalls.push({ url: String(url), opts });
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/const isHex64 = \(s\) =>[\s\S]*?\n  /, 'isHex64') + '\n' +
    lift(/let naCooldownUntil = 0;[\s\S]*?const naAvailable[^\n]*\n/, 'cooldown helpers') + '\n' +
    lift(/let naSettingMemo;[\s\S]*?let naSettingLoaded = false;\n/, 'memo state') + '\n' +
    lift(/function naSetting\(\) \{[\s\S]*?\n  \}/, 'naSetting') + '\n' +
    lift(/function naSetSettingMemo\(on\) \{[^\n]*\n/, 'naSetSettingMemo') + '\n' +
    lift(/async function naEnabled\(\) \{[^\n]*\n/, 'naEnabled') + '\n' +
    lift(/async function naDecide\(on\) \{[\s\S]*?\n  \}/, 'naDecide') + '\n' +
    lift(/async function naSuggest\(query\) \{[\s\S]*?\n  \}/, 'naSuggest') + '\n' +
    lift(/async function naMetadata\(pubkeys\) \{[\s\S]*?\n  \}/, 'naMetadata') + '\n' +
    'globalThis.naSuggest = naSuggest; globalThis.naMetadata = naMetadata; globalThis.naSetting = naSetting; globalThis.naEnabled = naEnabled; globalThis.naDecide = naDecide;',
    ctx
  );
  return { ctx, fetchCalls };
}

test('setting unset (never asked): suggest sends nothing — the ask is the only enabler', async () => {
  const { ctx, fetchCalls } = harness({ enabled: undefined });
  assert.equal((await ctx.naSuggest('alice')).length, 0);
  assert.equal(fetchCalls.length, 0, 'no request may leave the panel before the one-time ask is answered');
});

test('setting unset (never asked): metadata sends nothing — the follow list stays private', async () => {
  const { ctx, fetchCalls } = harness({ enabled: undefined });
  const out = await ctx.naMetadata(['a'.repeat(64), 'b'.repeat(64)]);
  assert.equal(out.size, 0);
  assert.equal(fetchCalls.length, 0);
});

test('setting off: suggest sends nothing and returns empty', async () => {
  const { ctx, fetchCalls } = harness({ enabled: false });
  // (length, not deepEqual against a host-realm [] — cross-vm realm arrays
  // never compare reference-equal)
  assert.equal((await ctx.naSuggest('alice')).length, 0);
  assert.equal(fetchCalls.length, 0, 'no request may leave the panel with the index off');
});

test('setting off: metadata sends nothing — the follow list stays private', async () => {
  const { ctx, fetchCalls } = harness({ enabled: false });
  const out = await ctx.naMetadata(['a'.repeat(64), 'b'.repeat(64)]);
  assert.equal(out.size, 0);
  assert.equal(fetchCalls.length, 0);
});

test('setting on: suggest queries the API', async () => {
  const { ctx, fetchCalls } = harness({ enabled: true });
  await ctx.naSuggest('alice');
  assert.equal(fetchCalls.length, 1);
  assert.ok(fetchCalls[0].url.includes('/v1/search/suggest'), fetchCalls[0].url);
});

test('setting on: metadata posts the pubkey chunk', async () => {
  const { ctx, fetchCalls } = harness({ enabled: true });
  await ctx.naMetadata(['a'.repeat(64)]);
  assert.equal(fetchCalls.length, 1);
  assert.ok(fetchCalls[0].url.includes('/v1/profiles/metadata'));
  assert.deepEqual(JSON.parse(fetchCalls[0].opts.body).pubkeys, ['a'.repeat(64)]);
});

test('the gate reads the nostrArchives key tri-state: unset is not enabled', async () => {
  // No nostrArchives key at all (every existing user until they answer the ask):
  // chrome.storage returns an object without it — naSetting must resolve
  // undefined, and naEnabled must resolve false.
  const ctx = { chrome: { storage: { local: { get: (k, cb) => cb({ sidecar_settings: {} }) } } } };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/let naSettingMemo;[\s\S]*?let naSettingLoaded = false;\n/, 'memo state') + '\n' +
    lift(/function naSetting\(\) \{[\s\S]*?\n  \}/, 'naSetting') + '\n' +
    lift(/function naSetSettingMemo\(on\) \{[^\n]*\n/, 'naSetSettingMemo') + '\n' +
    lift(/async function naEnabled\(\) \{[^\n]*\n/, 'naEnabled') + '\n' +
    'globalThis.naSetting = naSetting; globalThis.naEnabled = naEnabled;',
    ctx
  );
  assert.equal(await ctx.naSetting(), undefined);
  assert.equal(await ctx.naEnabled(), false);
});

test('answering the ask yes is the enabler end-to-end: decide(true), then suggest fetches', async () => {
  // Storage still reports unset (the write goes through the worker, absent
  // here); the memo naDecide sets is what lets the search proceed. This pins
  // the wiring from the ask's button to the gate without a DOM.
  const { ctx, fetchCalls } = harness({ enabled: undefined });
  assert.equal(fetchCalls.length, 0);
  await ctx.naDecide(true);
  await ctx.naSuggest('alice');
  assert.equal(fetchCalls.length, 1, 'after deciding yes, the search must fire without a reload');
});

test('answering the ask no keeps the gate closed, even though storage was never consulted again', async () => {
  const { ctx, fetchCalls } = harness({ enabled: undefined });
  await ctx.naDecide(false);
  assert.equal((await ctx.naSuggest('alice')).length, 0);
  assert.equal((await ctx.naMetadata(['a'.repeat(64)])).size, 0);
  assert.equal(fetchCalls.length, 0, 'deciding no must seal the gate via the memo, not just storage');
});

test('the memo serves later reads without going back to storage', async () => {
  const { ctx } = harness({ enabled: true });
  let reads = 0;
  const orig = ctx.chrome.storage.local.get;
  ctx.chrome.storage.local.get = (k, cb) => { reads++; return orig(k, cb); };
  await ctx.naSetting();
  await ctx.naSetting();
  await ctx.naSetting();
  assert.equal(reads, 1, 'storage is read once; every keystroke after that is synchronous');
});
