'use strict';

// Execute the shared uploader with controlled relays and HTTP responses. No uploads
// leave this process; both composers and the profile uploader use these functions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '..', 'composer-core.js'), 'utf8');
const PK = 'a'.repeat(64);
const OTHER_PK = 'b'.repeat(64);
const SERVER = 'https://blossom.example';
const FALLBACK = 'https://nostr.build/api/v2/upload/files';
const list = (...servers) => ({ tags: servers.map(s => ['server', s]) });
const file = () => new Blob(['test image'], { type: 'image/gif' });

function harness() {
  let now = 1800000000000;
  class Clock extends Date { static now() { return now; } }
  const state = {
    reads: [], requests: [], signs: [], warnings: [], relayRequests: [], timeouts: [], notices: [], devlog: [],
    accountRelays: { 'wss://relay.example': { read: true, write: true } },
    lookup: async () => list(SERVER),
    respond: async url => ({ ok: true, json: async () => url === FALLBACK
      ? { data: [{ url: 'https://i.nostr.build/fallback.gif' }] }
      : { url: url.replace('/upload', '/hash.gif') } }),
  };
  const ctx = {
    window: { SidecarI18n: { t: (key, values = {}) => key.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k]), tn: x => x } },
    Date: Clock, URL, TextEncoder, crypto: webcrypto, Uint8Array,
    AbortController, clearTimeout, btoa, FormData,
    setTimeout: (fn, ms) => { state.timeouts.push(ms); return setTimeout(fn, ms); },
    console: { warn: (...args) => state.warnings.push(args.map(String).join(' ')) },
    fetch: async (url, options) => { state.requests.push({ url, options }); return state.respond(url, options); },
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const uploader = ctx.window.SidecarCore.installComposer({
    activePubkey: () => PK,
    onUploadFallback: message => state.notices.push(message),
    devLog: (level, msg, data) => state.devlog.push({ level, msg, data }),
    relayUrls: async writableOnly => { assert.equal(writableOnly, false); return ['wss://relay.example']; },
    poolGet: async (relays, filter) => { state.reads.push({ relays, filter }); return state.lookup(filter, relays); },
    call: async message => {
      if (message.type === 'SIDECAR_GET_ACCOUNT_RELAYS') {
        state.relayRequests.push(message.pubkey);
        return state.accountRelays;
      }
      state.signs.push(message);
      return message.event;
    },
  });
  return { ...uploader, state, advance: ms => { now += ms; } };
}

for (const [name, lookup] of [
  ['relay exception', async () => { throw new Error('relay disconnected'); }],
  ['no event returned', async () => null],
  ['empty server list', async () => list()],
  ['no usable HTTPS server', async () => list('http://insecure.example')],
]) {
  test(`a ${name} does not poison the next upload's discovery`, async () => {
    const h = harness();
    h.state.lookup = lookup;
    assert.equal(await h.uploadMedia(file()), 'https://i.nostr.build/fallback.gif');
    h.state.lookup = async () => list(SERVER);
    assert.equal(await h.uploadMedia(file()), SERVER + '/hash.gif');
    assert.equal(h.state.reads.length, 2, 'retry discovery without waiting five minutes');
    assert.deepEqual(h.state.requests.map(r => r.url), [FALLBACK, SERVER + '/upload']);
  });
}

test('successful discovery is cached per account and expires after five minutes', async () => {
  const h = harness();
  h.state.lookup = async filter => list(filter.authors[0] === PK ? SERVER : 'https://other.example');
  assert.equal(await h.uploadMedia(file(), PK), SERVER + '/hash.gif');
  assert.equal(await h.uploadMedia(file(), PK), SERVER + '/hash.gif');
  assert.equal(h.state.reads.length, 1);
  assert.equal(await h.uploadMedia(file(), OTHER_PK), 'https://other.example/hash.gif');
  assert.equal(h.state.reads.length, 2);
  h.advance(300001);
  await h.uploadMedia(file(), PK);
  assert.equal(h.state.reads.length, 3);
  assert.ok(h.state.reads.every(r => r.filter.kinds[0] === 10063));
});

test('an expired successful lookup followed by failure is retried on the next upload', async () => {
  const h = harness();
  await h.uploadMedia(file());
  h.advance(300001);
  h.state.lookup = async () => { throw new Error('relay disconnected'); };
  await h.uploadMedia(file());
  h.state.lookup = async () => list('https://new.example');
  assert.equal(await h.uploadMedia(file()), 'https://new.example/hash.gif');
  assert.equal(h.state.reads.length, 3);
});

test('Blossom uses the supplied account and file hash, and returns the server URL unchanged', async () => {
  const h = harness();
  const f = file();
  const expected = 'https://cdn.example/actual.gif';
  h.state.respond = async () => ({ ok: true, json: async () => ({ url: expected }) });
  assert.equal(await h.uploadMedia(f, OTHER_PK), expected);
  const sign = h.state.signs[0];
  assert.equal(sign.expectedPubkey, OTHER_PK);
  assert.equal(sign.event.kind, 24242);
  const digest = Buffer.from(await webcrypto.subtle.digest('SHA-256', await f.arrayBuffer())).toString('hex');
  assert.equal(sign.event.tags.find(t => t[0] === 'x')[1], digest);
  assert.equal(h.state.requests[0].options.method, 'PUT');
  assert.equal(h.state.requests[0].options.body, f);
  assert.equal(h.state.requests[0].options.headers['Content-Type'], 'image/gif');
});

test('tries the next advertised Blossom server before falling back', async () => {
  const h = harness();
  h.state.lookup = async () => list(SERVER + '/', 'https://second.example');
  const respond = h.state.respond;
  h.state.respond = async url => url === SERVER + '/upload' ? { ok: false, status: 503 } : respond(url);
  assert.equal(await h.uploadMedia(file()), 'https://second.example/hash.gif');
  assert.deepEqual(h.state.requests.map(r => r.url), [SERVER + '/upload', 'https://second.example/upload']);
});

test('all Blossom upload failures retain nostr.build fallback and a diagnostic', async () => {
  const h = harness();
  const respond = h.state.respond;
  h.state.respond = async url => url === FALLBACK ? respond(url) : { ok: false, status: 403 };
  assert.equal(await h.uploadMedia(file()), 'https://i.nostr.build/fallback.gif');
  assert.deepEqual(h.state.signs.map(s => s.event.kind), [24242, 27235]);
  assert.ok(h.state.warnings.some(s => s.includes('answered HTTP 403')));
});

test('profile upload helper also retries a missed discovery', async () => {
  const h = harness();
  h.state.lookup = async () => null;
  assert.equal(await h.tryBlossomFirst(file(), PK), null);
  h.state.lookup = async () => list(SERVER);
  assert.equal(await h.tryBlossomFirst(file(), PK), SERVER + '/hash.gif');
});


test('discovers a Blossom list on the account’s write-only relay', async () => {
  const h = harness();
  h.state.accountRelays = { 'wss://own-write.example': { read: false, write: true } };
  h.state.lookup = async (filter, relays) => relays.includes('wss://own-write.example') ? list(SERVER) : null;
  assert.equal(await h.uploadMedia(file(), OTHER_PK), SERVER + '/hash.gif');
  assert.deepEqual(h.state.relayRequests, [OTHER_PK]);
  assert.deepEqual(Array.from(h.state.reads[0].relays), ['wss://own-write.example']);
});

test('an empty account relay set does not query excluded bootstrap relays', async () => {
  const h = harness();
  h.state.accountRelays = {};
  assert.equal(await h.uploadMedia(file()), 'https://i.nostr.build/fallback.gif');
  assert.equal(h.state.reads.length, 0);
  assert.deepEqual(h.state.relayRequests, [PK]);
});

const big = mb => new Blob([new Uint8Array(mb * 1024 * 1024)], { type: 'image/jpeg' });

test('a larger file gets more time on a server, up to a ceiling', async () => {
  // One flat 30 seconds aborted any image that could not cross a modest uplink in that time,
  // and each abort fell through to nostr.build: small images on the person's own server, big
  // ones not.
  const timeoutFor = async f => {
    const h = harness();
    await h.uploadMedia(f);
    return h.state.timeouts[0];
  };
  assert.equal(await timeoutFor(file()), 40000, 'a tiny file: 30s and one megabyte');
  assert.equal(await timeoutFor(big(5)), 80000);
  assert.equal(await timeoutFor(big(12)), 150000);
  assert.equal(await timeoutFor(big(100)), 300000, 'never more than five minutes');
});

test('a refresh that finds nothing keeps using the last list that worked, for an hour', async () => {
  const h = harness();
  assert.equal(await h.uploadMedia(file()), SERVER + '/hash.gif');
  h.advance(300001);
  h.state.lookup = async () => { throw new Error('relay disconnected'); };
  assert.equal(await h.uploadMedia(file()), SERVER + '/hash.gif', 'a flaky relay must not send this one to nostr.build');
  assert.ok(h.state.warnings.some(w => w.includes('last one that worked')));
  // It stays expired, so the next upload asks again and a recovered relay is believed at once.
  h.state.lookup = async () => list('https://new.example');
  assert.equal(await h.uploadMedia(file()), 'https://new.example/hash.gif');
  // And a list that the refresh keeps missing is not honored forever.
  h.advance(300001);
  h.state.lookup = async () => null;
  assert.equal(await h.uploadMedia(file()), 'https://new.example/hash.gif', 'within the hour');
  h.advance(3600001);
  assert.equal(await h.uploadMedia(file()), 'https://i.nostr.build/fallback.gif', 'past it, there is no list');
});

test('when the account\u2019s servers all refuse a file, the person is told why it went to nostr.build', async () => {
  const h = harness();
  const respond = h.state.respond;
  h.state.respond = async url => url === FALLBACK ? respond(url) : { ok: false, status: 413 };
  assert.equal(await h.uploadMedia(file()), 'https://i.nostr.build/fallback.gif');
  assert.deepEqual(h.state.notices, ['Your Blossom server did not take this file (blossom.example answered HTTP 413). Uploaded to nostr.build instead.']);
});

test('an account with no Blossom list is never told about a fallback it did not choose', async () => {
  const h = harness();
  h.state.lookup = async () => null;
  assert.equal(await h.uploadMedia(file()), 'https://i.nostr.build/fallback.gif');
  assert.deepEqual(h.state.notices, []);
});

test('a server that takes too long is reported as slow, not as an abort', async () => {
  const h = harness();
  const respond = h.state.respond;
  h.state.respond = async (url, options) => {
    if (url === FALLBACK) return respond(url);
    const e = new Error('The operation was aborted.');
    e.name = 'AbortError';
    throw e;
  };
  await h.uploadMedia(file());
  assert.deepEqual(h.state.notices, ['Your Blossom server did not take this file (it took too long). Uploaded to nostr.build instead.']);
});

test('the server\u2019s own reason is in the notice, with the host that gave it', async () => {
  // Blossom servers say why in an X-Reason header. A 403 can be a banned type, a quota, a
  // closed list or a bad signature, and "HTTP 403" told nobody which.
  const h = harness();
  const respond = h.state.respond;
  h.state.respond = async url => url === FALLBACK
    ? respond(url)
    : { ok: false, status: 403, headers: { get: name => (name === 'X-Reason' ? 'Storage quota exceeded' : null) } };
  await h.uploadMedia(file());
  assert.deepEqual(h.state.notices, ['Your Blossom server did not take this file (blossom.example answered HTTP 403: Storage quota exceeded). Uploaded to nostr.build instead.']);
  assert.ok(h.state.warnings.some(w => w.includes('Storage quota exceeded')), 'and the console has it too');
});

test('with several servers, the notice names the one that answered last', async () => {
  const h = harness();
  h.state.lookup = async () => list(SERVER, 'https://second.example');
  const respond = h.state.respond;
  h.state.respond = async url => url === FALLBACK ? respond(url) : { ok: false, status: url.startsWith(SERVER) ? 413 : 403 };
  await h.uploadMedia(file());
  assert.match(h.state.notices[0], /second\.example answered HTTP 403/);
});

test('every decision goes to the debug log as well as the console, with what was tried and why', async () => {
  // The console was the only record, so finding out why a file went to nostr.build meant
  // having developer tools open at the right moment.
  const h = harness();
  const respond = h.state.respond;
  h.state.respond = async url => url === FALLBACK ? respond(url) : { ok: false, status: 403, headers: { get: () => 'Blocked type' } };
  await h.uploadMedia(file());
  const log = JSON.parse(JSON.stringify(h.state.devlog));
  const failed = log.find(e => e.msg === 'Blossom upload failed');
  assert.ok(failed, 'the refusal is logged');
  assert.equal(failed.data.server, SERVER);
  assert.match(failed.data.error, /answered HTTP 403: Blocked type/);
  assert.equal(failed.data.type, 'image/gif');
  assert.ok(log.some(e => e.level === 'error' && e.msg.startsWith('every Blossom server refused')));
  assert.ok(h.state.warnings.some(w => w.includes('Blocked type')), 'and the console has it too');

  const ok = harness();
  await ok.uploadMedia(file());
  const done = JSON.parse(JSON.stringify(ok.state.devlog)).find(e => e.msg === 'uploaded to Blossom');
  assert.equal(done.data.url, SERVER + '/hash.gif', 'a success is logged with where it landed');
});
