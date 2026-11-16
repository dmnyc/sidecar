'use strict';

// window.nostr.nip44v3, end to end: the page provider, the background's request path, the
// signer, and both approval surfaces. The scheme itself is test/nip44v3.test.js.
//
// The background half runs the REAL handleNostrRpc, lifted out of background.js, with the
// modules it reaches for stubbed and permissions.js real. That is what shows the two rules
// v3 adds actually hold, rather than that some line of source still reads a certain way:
// a v3 request asks every time whatever the site's tier, and a v3 card cannot raise the tier.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const bg = read('background.js');
const prompt = read('prompt.js');
const panel = read('sidepanel.js');

function lift(src, decl) {
  const at = src.indexOf(decl);
  assert.notEqual(at, -1, decl + ' is gone');
  let depth = 0;
  for (let i = src.indexOf('{', src.indexOf('(', at)); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

// The worker's crypto stack, loaded in the order importScripts loads it.
function workerModules() {
  const ctx = { crypto: globalThis.crypto, TextEncoder, TextDecoder, console };
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['nostr-tools.js', 'nip44v3-primitives.js', 'nip44v3.js', 'signer.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  return ctx;
}
const W = workerModules();
const NT = W.NostrTools;
const SIGNER = W.SidecarSigner;
const V3 = W.SidecarNip44v3;

const bytes = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const b64 = (u8) => Buffer.from(u8).toString('base64');
const A = bytes('0a'.repeat(32));
const B = bytes('0b'.repeat(32));
const PK_A = NT.getPublicKey(A);
const PK_B = NT.getPublicKey(B);

// ---- signer.js ----

test('signer: nip44v3 round-trips bytes between two accounts, bound to kind and scope', async () => {
  const plain = Uint8Array.of(0, 1, 2, 250, 255);
  const ct = await SIGNER.perform('nip44v3.encrypt',
    { pubkey: PK_B, kind: 30078, scope: 'app/settings', plaintextBase64: b64(plain) }, A, PK_A);
  assert.equal(Buffer.from(ct, 'base64')[0], 3, 'not a version-3 payload');
  const back = await SIGNER.perform('nip44v3.decrypt',
    { pubkey: PK_A, kind: 30078, scope: 'app/settings', ciphertext: ct }, B, PK_B);
  assert.equal(back, b64(plain), 'decrypt returns the bytes as base64');
  await assert.rejects(SIGNER.perform('nip44v3.decrypt',
    { pubkey: PK_A, kind: 30078, scope: 'app/other', ciphertext: ct }, B, PK_B), /context mismatch: scope/);
  await assert.rejects(SIGNER.perform('nip44v3.decrypt',
    { pubkey: PK_A, kind: 1, scope: 'app/settings', ciphertext: ct }, B, PK_B), /context mismatch: kind/);
});

test('signer: nip44 (v2) is untouched, and neither version opens the other', async () => {
  const v2 = await SIGNER.perform('nip44.encrypt', { pubkey: PK_B, plaintext: 'hello' }, A, PK_A);
  assert.equal(Buffer.from(v2, 'base64')[0], 2);
  assert.equal(await SIGNER.perform('nip44.decrypt', { pubkey: PK_A, ciphertext: v2 }, B, PK_B), 'hello');
  // The same call through nostr-tools directly: the signer adds nothing to v2.
  assert.equal(NT.nip44.decrypt(v2, NT.nip44.getConversationKey(B, PK_A)), 'hello');

  const v3 = await SIGNER.perform('nip44v3.encrypt', { pubkey: PK_B, kind: 4, scope: '', plaintextBase64: b64(Buffer.from('hello')) }, A, PK_A);
  await assert.rejects(SIGNER.perform('nip44.decrypt', { pubkey: PK_A, ciphertext: v3 }, B, PK_B), /unknown encryption version/);
  await assert.rejects(SIGNER.perform('nip44v3.decrypt', { pubkey: PK_A, kind: 4, scope: '', ciphertext: v2 }, B, PK_B), /unknown encryption version 2/);
});

test('signer: a v3 request needs the private key, and a malformed one never reaches it', async () => {
  assert.equal(SIGNER.needsPrivateKey('nip44v3.encrypt'), true);
  assert.equal(SIGNER.needsPrivateKey('nip44v3.decrypt'), true);
  await assert.rejects(SIGNER.perform('nip44v3.encrypt', { pubkey: PK_B, kind: 4, scope: '', plaintext: 'text' }, A, PK_A), /plaintext must be bytes/);
});

// ---- nostr-provider.js ----

function page() {
  const listeners = [];
  const posted = [];
  const win = {
    postMessage(msg) { posted.push(msg); },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    removeEventListener() {},
    dispatchEvent() { return true; },
    location: { origin: 'https://example.com', href: 'https://example.com/' },
  };
  const ctx = {
    window: win, document: { addEventListener() {}, documentElement: {} }, navigator: {},
    Event: class { constructor(type) { this.type = type; } },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout, clearTimeout, Promise, Object, Math, Date, String, Error, JSON, console, btoa, atob,
  };
  vm.createContext(ctx);
  vm.runInContext(read('nostr-provider.js'), ctx);
  // Answer the newest request the way content.js would.
  const answer = (response) => {
    const req = posted[posted.length - 1];
    for (const fn of listeners) fn({ source: win, data: { ext: 'sidecar', kind: 'response', scope: req.scope, id: req.id, response } });
  };
  return { ctx, win, posted, answer };
}

test('provider: window.nostr.nip44v3 takes (pubkey, kind, scope, ArrayBuffer) and sends the bytes as base64', async () => {
  const { win, posted, answer } = page();
  const buf = Uint8Array.of(104, 105, 0, 255).buffer;
  const p = win.nostr.nip44v3.encrypt(PK_B, 30078, 'app/settings', buf);
  const req = posted[posted.length - 1];
  assert.equal(req.method, 'nip44v3.encrypt');
  assert.deepEqual({ ...req.params }, { pubkey: PK_B, kind: 30078, scope: 'app/settings', plaintextBase64: 'aGkA/w==' });
  answer({ ok: true, result: 'Aw...' });
  assert.equal(await p, 'Aw...');

  // A typed array (and a view into part of a buffer) is read as the bytes it covers.
  const big = Uint8Array.of(9, 9, 1, 2, 3, 9);
  win.nostr.nip44v3.encrypt(PK_B, 1, '', big.subarray(2, 5));
  assert.equal(posted[posted.length - 1].params.plaintextBase64, 'AQID');
});

test('provider: a string plaintext is refused, not guessed at', async () => {
  const { win, posted } = page();
  const before = posted.length;
  await assert.rejects(win.nostr.nip44v3.encrypt(PK_B, 1, '', 'hello'), /plaintext must be an ArrayBuffer/);
  assert.equal(posted.length, before, 'nothing was sent to the extension');
});

test('provider: decrypt resolves to an ArrayBuffer of the plaintext bytes', async () => {
  const { ctx, win, posted, answer } = page();
  const p = win.nostr.nip44v3.decrypt(PK_A, 4, 'scope', 'Ayz...');
  const req = posted[posted.length - 1];
  assert.equal(req.method, 'nip44v3.decrypt');
  assert.deepEqual({ ...req.params }, { pubkey: PK_A, kind: 4, scope: 'scope', ciphertext: 'Ayz...' });
  answer({ ok: true, result: 'aGkA/w==' });
  const out = await p;
  assert.equal(Object.prototype.toString.call(out), '[object ArrayBuffer]');
  assert.deepEqual([...new Uint8Array(out)], [104, 105, 0, 255]);
  void ctx;
});

test('provider: window.nostr.nip44 keeps its shape', async () => {
  const { win, posted } = page();
  assert.deepEqual(Object.keys(win.nostr.nip44), ['encrypt', 'decrypt']);
  assert.equal(win.nostr.nip44.encrypt.length, 2);
  assert.equal(win.nostr.nip44.decrypt.length, 2);
  win.nostr.nip44.encrypt(PK_B, 'hi');
  assert.deepEqual({ ...posted[posted.length - 1].params }, { pubkey: PK_B, plaintext: 'hi' });
  assert.equal(posted[posted.length - 1].method, 'nip44.encrypt');
  assert.deepEqual(Object.keys(win.nostr.nip44v3), ['encrypt', 'decrypt']);
  assert.equal(win.nostr.nip44v3.encrypt.length, 4);
  assert.equal(win.nostr.nip44v3.decrypt.length, 4);
});

// ---- background.js: the real handleNostrRpc ----
//
// Run inside `with (env)`, where env is a proxy that answers every free name the function
// reaches for: the stubs below by name, the language's own globals from the outer realm,
// and anything else as an async no-op. permissions.js is real, over an in-memory store.
const HOST = 'app.example';

function background({ level, decision = { action: 'once' } }) {
  const store = {};
  const chrome = {
    storage: {
      local: {
        get: (k, cb) => cb(typeof k === 'string' ? { [k]: store[k] } : Object.fromEntries([].concat(k).map((x) => [x, store[x]]))),
        set: (o, cb) => { Object.assign(store, o); cb && cb(); },
      },
    },
  };
  const permsCtx = { chrome };
  permsCtx.self = permsCtx;
  vm.createContext(permsCtx);
  vm.runInContext(read('permissions.js'), permsCtx);
  const PERMS = permsCtx.SidecarPermissions;

  const calls = { prompts: [], performed: [], relax: [] };
  const named = {
    KS: {
      ensureLoaded: async () => {}, isInitialized: async () => true,
      getActivePubkey: async () => PK_A, hasAccount: async () => false, isLocked: () => false,
      getState: async () => ({ accounts: [{ pubkey: PK_A, name: 'A' }] }),
      getPrivkey: async () => A, setActive: async () => {},
    },
    PERMS,
    SIGNER: {
      needsPrivateKey: SIGNER.needsPrivateKey,
      perform: async (m, p, priv, pk) => { calls.performed.push(m); return SIGNER.perform(m, p, priv, pk); },
    },
    self: { SidecarNip44v3: V3, NostrTools: NT },
    NIP44V3_METHODS: new Set(JSON.parse(bg.match(/const NIP44V3_METHODS = new Set\((\[[^\]]*\])\);/)[1].replace(/'/g, '"'))),
    SEAL_METHODS: new Set(['nip04.encrypt', 'nip44.encrypt']),
    DECRYPT_METHODS: new Set(['nip04.decrypt', 'nip44.decrypt']),
    COALESCE_KINDS: new Set([30078]),
    RELAX: {
      neverRelaxes: () => false, has: async () => false, DEFAULT_MS: 1800000,
      grant: async (...a) => { calls.relax.push(a); }, revokeOtherAccounts: async () => {}, revokeForHost: async () => {},
    },
    KINDS: { isGrantableKind: () => false, dTagOf: () => null, has: async () => false },
    BASELINE: { isTracked: () => false },
    SidecarSeasons: { resolve: () => '' },
    sget: async () => ({}),
    resolveSiteAccount: async () => PK_A,
    getSiteAccount: async () => PK_A,
    getAuthorizedAccounts: async () => [PK_A],
    hasDecryptGrant: () => false, hasPubkeyGrant: () => false, hasContentGrant: () => false,
    isNip42AuthEvent: () => false,
    resolveSettings: () => ({ autoLockMinutes: 15 }),
    shouldNudgeTrust: async () => true,
    recallSealed: () => '',
    kindGrantWanted: () => false,
    openPrompt: async (data) => { calls.prompts.push(data); return { ...decision }; },
  };
  const env = new Proxy({}, {
    has: (_, k) => typeof k === 'string',
    get: (_, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in named) return named[k];
      if (k in globalThis) return globalThis[k];
      return async () => undefined;
    },
    set: () => true,
  });
  const fn = vm.runInNewContext('(function (env) { with (env) { return (' + lift(bg, 'async function handleNostrRpc(') + '); } })')(env);
  const rpc = (method, params) => new Promise((resolve) => fn(method, params, HOST, resolve));
  return { rpc, calls, PERMS, setLevel: (l) => PERMS.setLevel(PK_A, HOST, l) };
}

const v3Encrypt = () => ({ pubkey: PK_B, kind: 30078, scope: 'app/settings', plaintextBase64: b64(Buffer.from('theme=dark')) });

test('background: on a TRUSTED site, v3 still asks, and the card names the kind and scope', async () => {
  const bgx = background({});
  await bgx.setLevel('trusted');
  const r = await bgx.rpc('nip44v3.encrypt', v3Encrypt());
  assert.equal(r.ok, true, r.error);
  assert.equal(Buffer.from(r.result, 'base64')[0], 3);
  assert.equal(bgx.calls.prompts.length, 1, 'a trusted site encrypted with v3 without asking');
  const card = bgx.calls.prompts[0];
  assert.equal(card.needApproval, true);
  assert.equal(card.method, 'nip44v3.encrypt');
  assert.equal(card.params.kind, 30078);
  assert.equal(card.params.scope, 'app/settings');
  assert.equal(card.nudgeTrust, false, 'a v3 card pointed at Trust');
  assert.equal(card.relaxEligible, false, 'a v3 card offered the 30-minute window');
  assert.equal(card.canKindGrant, false);

  // The same trusted site's v2 decrypt is still silent: the tier means what it meant.
  const v2 = NT.nip44.encrypt('x', NT.nip44.getConversationKey(B, PK_A));
  const r2 = await bgx.rpc('nip44.decrypt', { pubkey: PK_B, ciphertext: v2 });
  assert.equal(r2.ok, true, r2.error);
  assert.equal(r2.result, 'x');
  assert.equal(bgx.calls.prompts.length, 1, 'v2 on a trusted site started asking');
});

test('background: a decrypt asks every time too, with no burst window after it', async () => {
  const bgx = background({});
  await bgx.setLevel('trusted');
  const ct = V3.encrypt(B, PK_A, 4, '', new Uint8Array([1, 2, 3]));
  for (let i = 0; i < 3; i++) {
    const r = await bgx.rpc('nip44v3.decrypt', { pubkey: PK_B, kind: 4, scope: '', ciphertext: ct });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result, 'AQID');
  }
  assert.equal(bgx.calls.prompts.length, 3);
});

test('background: Trust or a timed window chosen on a v3 card does not raise the site’s tier', async () => {
  for (const action of ['trust', 'relax']) {
    const bgx = background({ decision: { action } });
    const r = await bgx.rpc('nip44v3.encrypt', v3Encrypt());
    assert.equal(r.ok, true, r.error);
    assert.equal(await bgx.PERMS.getLevel(PK_A, HOST), 'ask', action + ' on a v3 card changed the tier');
    assert.deepEqual(bgx.calls.relax, [], action + ' on a v3 card opened a window');
  }
});

test('background: a blocked site is refused before any card', async () => {
  const bgx = background({});
  await bgx.setLevel('blocked');
  const r = await bgx.rpc('nip44v3.encrypt', v3Encrypt());
  assert.equal(r.ok, false);
  assert.match(r.error, /blocked/);
  assert.equal(bgx.calls.prompts.length, 0);
});

test('background: a malformed v3 request is refused without a card and without the key', async () => {
  const bgx = background({});
  const bad = [
    [{ ...v3Encrypt(), kind: 'x' }, /invalid kind/],
    [{ ...v3Encrypt(), scope: undefined }, /invalid scope/],
    [{ ...v3Encrypt(), plaintextBase64: undefined, plaintext: 'hi' }, /plaintext must be bytes/],
    [{ ...v3Encrypt(), pubkey: 'npub1x' }, /invalid pubkey/],
  ];
  for (const [params, re] of bad) {
    const r = await bgx.rpc('nip44v3.encrypt', params);
    assert.equal(r.ok, false);
    assert.match(r.error, re);
  }
  assert.equal(bgx.calls.prompts.length, 0);
  assert.deepEqual(bgx.calls.performed, []);
});

// ---- the approval surfaces ----

const tSec = (s, p) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => (p && p[k] != null ? String(p[k]) : ''));
const asks = {
  popup: (() => {
    const ctx = vm.createContext({ tSec });
    vm.runInContext(lift(prompt, 'function methodAsk(') + '\nthis.ask = methodAsk;', ctx);
    return ctx.ask;
  })(),
  'side panel': (() => {
    const ctx = vm.createContext({ tSec });
    vm.runInContext(lift(panel, 'function approvalMethodAsk(') + '\nthis.ask = approvalMethodAsk;', ctx);
    return ctx.ask;
  })(),
};

for (const [name, ask] of Object.entries(asks)) {
  test(name + ': the v3 methods have their own line, and v2 keeps its', () => {
    assert.equal(ask('nip44v3.encrypt'), 'wants to encrypt a message (NIP-44 v3)');
    assert.equal(ask('nip44v3.decrypt'), 'wants to decrypt a message (NIP-44 v3)');
    assert.equal(ask('nip44.encrypt'), 'wants to encrypt a message (NIP-44)');
    assert.equal(ask('nip44.decrypt'), 'wants to decrypt a message (NIP-44)');
  });
}

// A minimal DOM: enough for the preview builders to make rows of spans with textContent.
function el(tag) {
  return {
    tag, className: '', textContent: '', children: [],
    append(...c) { this.children.push(...c); },
  };
}
// Plain arrays of this realm, so deepEqual compares content and not where it was made.
const rowsText = (rows) => Array.from(rows, (r) => Array.from(r.children, (c) => String(c.textContent)));

function popupRows(data) {
  const ctx = vm.createContext({
    tSec, data, atob, TextDecoder, Uint8Array, String,
    document: { createElement: el },
  });
  vm.runInContext([
    lift(prompt, 'function isNip44v3('), lift(prompt, 'function rowEl('), lift(prompt, 'function nip44v3Rows('),
    lift(prompt, 'function clampScope('), lift(prompt, 'function bytesAsText('), lift(prompt, 'function clampText('),
    'function peerLabel() { return "peer"; }',
    'this.rows = nip44v3Rows;',
  ].join('\n'), ctx);
  return rowsText(ctx.rows());
}

function panelRows(data) {
  const h = (tag, props, kids) => Object.assign(el(tag), props || {}, { children: kids || [] });
  const ctx = vm.createContext({ tSec, h, atob, TextDecoder, Uint8Array, String });
  vm.runInContext([
    lift(panel, 'function nip44v3Preview('), lift(panel, 'function nip44v3Text('), lift(panel, 'function clampApprovalText('),
    'this.rows = nip44v3Preview;',
  ].join('\n'), ctx);
  return rowsText(ctx.rows(data));
}

test('both cards name the kind and the scope, as text, and say when the plaintext is binary', () => {
  const enc = (plaintextBase64, scope = 'app/settings') =>
    ({ method: 'nip44v3.encrypt', params: { pubkey: PK_B, kind: 4294967295, scope, plaintextBase64 } });

  const popup = popupRows(enc(b64(Buffer.from('theme=dark'))));
  assert.deepEqual(popup, [['To', 'peer'], ['Kind', '4294967295'], ['Scope', 'app/settings'], ['Sealing', 'theme=dark']]);
  const panelOut = panelRows(enc(b64(Buffer.from('theme=dark'))));
  assert.deepEqual(panelOut, [['Kind', '4294967295'], ['Scope', 'app/settings'], ['Sealing', 'theme=dark']]);

  for (const rows of [popupRows(enc('AP/D', '')), panelRows(enc('AP/D', ''))]) {
    assert.deepEqual(rows.slice(-2), [['Scope', 'None'], ['Sealing', 'Binary data']]);
  }
  // Markup in a scope is shown as the characters it is.
  const markup = '<img src=x onerror=alert(1)>';
  assert.deepEqual(popupRows(enc('', markup))[2], ['Scope', markup]);
  assert.deepEqual(panelRows(enc('', markup))[1], ['Scope', markup]);

  // A decrypt card has no plaintext to show.
  const dec = { method: 'nip44v3.decrypt', params: { pubkey: PK_B, kind: 1, scope: 's', ciphertext: 'A' } };
  assert.deepEqual(popupRows(dec), [['From', 'peer'], ['Kind', '1'], ['Scope', 's']]);
  assert.deepEqual(panelRows(dec), [['Kind', '1'], ['Scope', 's']]);
});

test('neither card offers Trust on a v3 request', () => {
  // The decision is enforced in the background (above); this is the button not being there.
  const strip = (s) => s.replace(/^\s*\/\/.*$/gm, '');
  assert.match(strip(prompt), /if \(isNip44v3\(data\.method\)\) els\.trust\.classList\.add\('hidden'\);/);
  assert.match(strip(panel), /if \(isNip44v3Approval\(data\)\) hide\(trust\);/);
});

test('the worker loads the v3 files before the signer, in both browsers', () => {
  const scripts = JSON.parse(read('manifest.json')).background.scripts;
  const at = (f) => scripts.indexOf(f);
  assert.ok(at('nip44v3-primitives.js') !== -1 && at('nip44v3-primitives.js') < at('nip44v3.js'));
  assert.ok(at('nip44v3.js') < at('signer.js'));
  // test/worker-scripts.test.js holds the Chrome importScripts list to this same order.
});
