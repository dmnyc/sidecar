'use strict';

// Unit coverage for rizfulExchangeCode() in sidepanel.js.
//
// This function trades a one-time code for a wallet connection string that Sidecar
// then STORES AND SPENDS FROM. The response comes from a third party over the
// network, so it's untrusted input on a path that ends in the user's money — these
// tests are mostly about what it refuses, not what it accepts.
//
// The specific hazard: if a `nwc_uri` that isn't an NWC URI reached
// SIDECAR_SET_NWC, a confused or compromised endpoint could get an arbitrary string
// stored as the user's wallet.

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

// Build a context with a stubbed fetch. `respond` returns { ok, status, json, text }.
// `warn` receives console.warn output from the lifted code (the ws:// relay advisory).
function harness(respond, warn = () => {}) {
  const calls = [];
  const ctx = {
    console: { warn },
    // A vm context inherits no globals. parseNwcLud16 uses URLSearchParams, and
    // without it here its try/catch swallows a ReferenceError and returns null —
    // which looks exactly like "this URI has no lud16".
    URLSearchParams,
    AbortSignal: { timeout: (ms) => ({ __timeout: ms }) },
    fetch: async (url, opts) => {
      calls.push({ url, opts });
      const r = respond(url, opts);
      return {
        ok: r.ok !== false,
        status: r.status || 200,
        json: async () => { if (r.throwsOnJson) throw new Error('bad json'); return r.json; },
        text: async () => r.text || '',
      };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/const RIZFUL_ORIGIN = [\s\S]*?const RIZFUL_EXCHANGE_URL = [^\n]+/, 'Rizful URLs') + '\n' +
    lift(/function parseNwcLud16\(connection\)\s*\{[\s\S]*?\n  \}/, 'parseNwcLud16') + '\n' +
    lift(/function warnIfInsecureNwcRelay\(connection\)\s*\{[\s\S]*?\n  \}/, 'warnIfInsecureNwcRelay') + '\n' +
    lift(/async function rizfulExchangeCode\(code, pubkey\)\s*\{[\s\S]*?\n  \}/, 'rizfulExchangeCode') + '\n' +
    'globalThis.rizfulExchangeCode = rizfulExchangeCode;' +
    'globalThis.RIZFUL_EXCHANGE_URL = RIZFUL_EXCHANGE_URL;',
    ctx
  );
  return { ctx, calls };
}

const NWC = 'nostr+walletconnect://abc123?relay=wss%3A%2F%2Frelay.example&secret=deadbeef';
const NWC_WITH_ADDR = NWC + '&lud16=alice%40rizful.com';
const PUBKEY = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';

test('a good exchange returns the connection string', async () => {
  const { ctx } = harness(() => ({ json: { nwc_uri: NWC } }));
  const out = await ctx.rizfulExchangeCode('CODE-1', PUBKEY);
  assert.equal(out.nwcUri, NWC);
});

test('it posts the code and pubkey as JSON, without cookies', async () => {
  const { ctx, calls } = harness(() => ({ json: { nwc_uri: NWC } }));
  await ctx.rizfulExchangeCode('  CODE-1  ', PUBKEY);
  const { url, opts } = calls[0];
  assert.equal(url, ctx.RIZFUL_EXCHANGE_URL);
  assert.equal(opts.method, 'POST');
  assert.equal(opts.credentials, 'omit', 'a token exchange must not carry cookies');
  assert.equal(opts.headers['Content-Type'], 'application/json');
  const body = JSON.parse(opts.body);
  assert.equal(body.secret_code, 'CODE-1', 'the code should be trimmed');
  assert.equal(body.nostr_public_key, PUBKEY);
});

test('the request is bounded by a timeout', async () => {
  const { ctx, calls } = harness(() => ({ json: { nwc_uri: NWC } }));
  await ctx.rizfulExchangeCode('CODE-1', PUBKEY);
  assert.ok(calls[0].opts.signal, 'no abort signal — a hung endpoint would hang the modal');
});

// The central guard.
test('a response that is not an NWC URI is REFUSED', async () => {
  for (const bad of [
    'https://evil.example/drain',
    'javascript:alert(1)',
    'nostr+walletconnectX://abc',
    'lnbc1...',
    '',
    '   ',
  ]) {
    const { ctx } = harness(() => ({ json: { nwc_uri: bad } }));
    await assert.rejects(
      () => ctx.rizfulExchangeCode('CODE-1', PUBKEY),
      /did not return a wallet connection/,
      JSON.stringify(bad) + ' must be refused'
    );
  }
});

test('a non-string or missing nwc_uri is refused rather than coerced', async () => {
  for (const bad of [undefined, null, 42, {}, ['nostr+walletconnect://x']]) {
    const { ctx } = harness(() => ({ json: { nwc_uri: bad } }));
    await assert.rejects(() => ctx.rizfulExchangeCode('CODE-1', PUBKEY), /did not return a wallet connection/);
  }
});

test('an HTTP error surfaces the server text, truncated', async () => {
  const { ctx } = harness(() => ({ ok: false, status: 400, text: 'That code has expired.' }));
  await assert.rejects(() => ctx.rizfulExchangeCode('CODE-1', PUBKEY), /That code has expired/);

  const long = harness(() => ({ ok: false, status: 500, text: 'x'.repeat(5000) }));
  const err = await long.ctx.rizfulExchangeCode('C', PUBKEY).then(() => null, (e) => e);
  assert.ok(err.message.length <= 220, 'a huge error body should not be pasted whole into the UI');
});

test('an HTTP error with no body still names the status', async () => {
  const { ctx } = harness(() => ({ ok: false, status: 502, text: '' }));
  await assert.rejects(() => ctx.rizfulExchangeCode('CODE-1', PUBKEY), /502/);
});

test('unparseable JSON fails with a clear message rather than a raw SyntaxError', async () => {
  const { ctx } = harness(() => ({ throwsOnJson: true }));
  await assert.rejects(() => ctx.rizfulExchangeCode('CODE-1', PUBKEY), /could not read/);
});

test('the lightning address is taken from the response when present', async () => {
  const { ctx } = harness(() => ({ json: { nwc_uri: NWC, lightning_address: 'alice@rizful.com' } }));
  const out = await ctx.rizfulExchangeCode('CODE-1', PUBKEY);
  assert.equal(out.lightningAddress, 'alice@rizful.com');
});

// This is what makes the profile's lud16 prompt fire, which is what makes the new
// wallet actually reachable by zaps — so it must not depend on the optional field.
test('the address falls back to the lud16 inside the NWC string', async () => {
  const { ctx } = harness(() => ({ json: { nwc_uri: NWC_WITH_ADDR } }));
  const out = await ctx.rizfulExchangeCode('CODE-1', PUBKEY);
  assert.equal(out.lightningAddress, 'alice@rizful.com');
});

test('a junk lightning_address is ignored rather than shown', async () => {
  const { ctx } = harness(() => ({ json: { nwc_uri: NWC, lightning_address: 'not-an-address' } }));
  const out = await ctx.rizfulExchangeCode('CODE-1', PUBKEY);
  assert.equal(out.lightningAddress, null, 'no @ means it is not an address; fall through');
});

test('no address anywhere is not an error — the wallet still connects', async () => {
  const { ctx } = harness(() => ({ json: { nwc_uri: NWC } }));
  const out = await ctx.rizfulExchangeCode('CODE-1', PUBKEY);
  assert.equal(out.nwcUri, NWC);
  assert.equal(out.lightningAddress, null);
});

test('the exchange endpoint is on rizful.com over https', async () => {
  const { ctx } = harness(() => ({ json: { nwc_uri: NWC } }));
  assert.match(ctx.RIZFUL_EXCHANGE_URL, /^https:\/\/rizful\.com\//);
});

// ---- ws:// relay advisory -------------------------------------------------------
// Warn, don't refuse: a ws:// relay is legitimate for a wallet on localhost or
// behind Tor, but the user should be able to find the warning in the console.

test('a ws:// relay in the returned URI logs the cleartext warning', async () => {
  const warns = [];
  const insecure = 'nostr+walletconnect://abc123?relay=ws%3A%2F%2Frelay.example&secret=deadbeef';
  const { ctx } = harness(() => ({ json: { nwc_uri: insecure } }), (m) => warns.push(m));
  await ctx.rizfulExchangeCode('CODE-1', PUBKEY);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /ws:\/\/ relay/);
});

test('a wss:// relay stays quiet — the warning is only for cleartext', async () => {
  const warns = [];
  const { ctx } = harness(() => ({ json: { nwc_uri: NWC } }), (m) => warns.push(m));
  await ctx.rizfulExchangeCode('CODE-1', PUBKEY);
  assert.equal(warns.length, 0);
});
