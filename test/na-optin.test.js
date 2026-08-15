'use strict';

// Unit coverage for the Nostr Archives opt-in gate (audit issue #194).
//
// naSuggest and naMetadata disclose data the relays never see together — what
// you type in the composer, and your follow list in chunks. Both are opt-in via
// the "Use the Nostr Archives name index" setting (default off), and the pin
// that matters is: with the setting off, NO fetch happens at all. Falling back
// to empty is what keeps mention search relay-only, silently and safely.

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
    lift(/function naEnabled\(\) \{[\s\S]*?\n  \}/, 'naEnabled') + '\n' +
    lift(/async function naSuggest\(query\) \{[\s\S]*?\n  \}/, 'naSuggest') + '\n' +
    lift(/async function naMetadata\(pubkeys\) \{[\s\S]*?\n  \}/, 'naMetadata') + '\n' +
    'globalThis.naSuggest = naSuggest; globalThis.naMetadata = naMetadata;',
    ctx
  );
  return { ctx, fetchCalls };
}

test('setting off (the default): suggest sends nothing and returns empty', async () => {
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

test('the gate reads the nostrArchives key, defaulting to off when unset', async () => {
  // No nostrArchives key at all (every existing user until they touch the toggle):
  // chrome.storage returns an object without it — naEnabled must resolve false.
  const ctx = { chrome: { storage: { local: { get: (k, cb) => cb({ sidecar_settings: {} }) } } } };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/function naEnabled\(\) \{[\s\S]*?\n  \}/, 'naEnabled') + 'globalThis.naEnabled = naEnabled;',
    ctx
  );
  assert.equal(await ctx.naEnabled(), false);
});
