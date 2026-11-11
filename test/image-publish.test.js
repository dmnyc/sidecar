// scripts/publish-images.mjs: the dev tool that puts gallery images on a Blossom
// server and on nostr.build under one key. These run the real code against a fake
// fetch; nothing here touches the network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const core = require('../scripts/image-publish-core.js');
const tools = core.loadCrypto();

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const secretKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const pubkey = tools.getPublicKey(secretKey);

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-publish-'));
  const file = path.join(dir, 'shot.png');
  fs.writeFileSync(file, png);
  return { dir, file, catalog: path.join(dir, 'data', 'uploads.jsonl') };
}

function decodeAuth(header) {
  assert.match(header, /^Nostr /);
  return JSON.parse(Buffer.from(header.slice(6), 'base64url').toString());
}

function tag(event, name) {
  const t = event.tags.find((x) => x[0] === name);
  return t && t[1];
}

const json = (body, init) => new Response(JSON.stringify(body), { status: 200, ...init });

test('an ncryptsec made by the vendored code opens with the right password and not the wrong one', () => {
  const sealed = tools.encrypt(secretKey, 'correct horse', 12);
  assert.deepEqual(Array.from(tools.decrypt(sealed, 'correct horse')), Array.from(secretKey));
  assert.throws(() => tools.decrypt(sealed, 'wrong'));
});

test('the Blossom authorization is a signed kind 24242 scoped to one blob, one server and five minutes', () => {
  const hash = core.sha256(png);
  const server = core.normalizeServer('https://blossom.example/');
  const ev = core.blossomAuthorization(hash, server, secretKey, 1000);
  assert.equal(ev.kind, 24242);
  assert.equal(ev.pubkey, pubkey);
  assert.equal(tools.verifyEvent(ev), true);
  assert.equal(tag(ev, 't'), 'upload');
  assert.equal(tag(ev, 'x'), hash);
  assert.equal(tag(ev, 'server'), 'blossom.example');
  assert.equal(tag(ev, 'expiration'), '1300');
});

test('a Blossom upload PUTs the exact bytes with their hash and returns the server URL', async () => {
  const { file } = scratch();
  const image = core.readImage(file);
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url: String(url), init };
    return json({ url: 'https://blossom.example/' + image.hash + '.png', sha256: image.hash, size: png.length, type: 'image/png', uploaded: 1 });
  };
  const out = await core.uploadToBlossom({ image, secretKey, server: core.normalizeServer('https://blossom.example'), fetchImpl });
  assert.equal(seen.url, 'https://blossom.example/upload');
  assert.equal(seen.init.method, 'PUT');
  assert.equal(seen.init.headers['X-SHA-256'], image.hash);
  assert.equal(seen.init.headers['Content-Type'], 'image/png');
  assert.deepEqual(Buffer.from(seen.init.body), png);
  const auth = decodeAuth(seen.init.headers.Authorization);
  assert.equal(tools.verifyEvent(auth), true);
  assert.equal(tag(auth, 'x'), image.hash);
  assert.deepEqual({ target: out.target, url: out.url }, { target: 'blossom', url: 'https://blossom.example/' + image.hash + '.png' });
});

test('a Blossom server that answers with another blob, size or URL is refused', async () => {
  const { file } = scratch();
  const image = core.readImage(file);
  const server = core.normalizeServer('https://blossom.example');
  const other = 'f'.repeat(64);
  const cases = {
    'another hash': { url: 'https://blossom.example/' + other, sha256: other, size: png.length },
    'another size': { url: 'https://blossom.example/' + image.hash, sha256: image.hash, size: png.length + 1 },
    'another URL': { url: 'https://blossom.example/' + other + '.png', sha256: image.hash, size: png.length },
  };
  for (const [name, body] of Object.entries(cases)) {
    await assert.rejects(
      core.uploadToBlossom({ image, secretKey, server, fetchImpl: async () => json(body) }),
      /mismatched|different blob/,
      name,
    );
  }
});

test('a refused upload reports the status and the reason the server gave', async () => {
  const { file } = scratch();
  const image = core.readImage(file);
  const fetchImpl = async () => new Response('', { status: 402, headers: { 'x-reason': 'payment required' } });
  await assert.rejects(
    core.uploadToBlossom({ image, secretKey, server: core.normalizeServer('https://blossom.example'), fetchImpl }),
    /Blossom upload failed \(402\): payment required/,
  );
});

test('a nostr.build upload signs a NIP-98 event for its own URL and method, and checks what it serves', async () => {
  const { file } = scratch();
  const image = core.readImage(file);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return json({ data: [{ url: 'https://i.nostr.build/abc.png' }] });
    return new Response(png, { status: 200 });
  };
  const out = await core.uploadToNostrBuild({ image, secretKey, fetchImpl });
  assert.equal(calls[0].url, core.NOSTR_BUILD_URL);
  assert.equal(calls[0].init.method, 'POST');
  const auth = decodeAuth(calls[0].init.headers.Authorization);
  assert.equal(auth.kind, 27235);
  assert.equal(tools.verifyEvent(auth), true);
  assert.equal(tag(auth, 'u'), core.NOSTR_BUILD_URL);
  assert.equal(tag(auth, 'method'), 'POST');
  const sent = calls[0].init.body.get('file');
  assert.deepEqual(Buffer.from(await sent.arrayBuffer()), png);
  assert.equal(out.url, 'https://i.nostr.build/abc.png');
  assert.equal(out.verified, true);
});

test('a host that serves different bytes than were sent is flagged, not trusted', async () => {
  const { file } = scratch();
  const image = core.readImage(file);
  let n = 0;
  const fetchImpl = async () => (++n === 1
    ? json({ data: { url: 'https://i.nostr.build/abc.png' } })
    : new Response(Buffer.from('re-encoded'), { status: 200 }));
  const out = await core.uploadToNostrBuild({ image, secretKey, fetchImpl });
  assert.equal(out.verified, false);
});

test('nostr.build answering with no URL, or a plain-HTTP one, is an error', async () => {
  const { file } = scratch();
  const image = core.readImage(file);
  for (const body of [{ data: [] }, { data: [{ url: 'http://i.nostr.build/abc.png' }] }, {}]) {
    await assert.rejects(core.uploadToNostrBuild({ image, secretKey, fetchImpl: async () => json(body) }), /no URL/);
  }
});

test('servers must be HTTPS, with loopback allowed for tests, and carry no credentials', () => {
  assert.throws(() => core.normalizeServer('http://blossom.example'), /HTTPS/);
  assert.doesNotThrow(() => core.normalizeServer('http://localhost:3000'));
  assert.throws(() => core.normalizeServer('https://user:pw@blossom.example'), /credentials/);
  assert.throws(() => core.normalizeServer('https://blossom.example/?x=1'), /credentials|query/);
  assert.equal(core.normalizeServer('https://blossom.example///').pathname, '/');
});

test('only image types are accepted', () => {
  assert.equal(core.imageMimeType('a.WEBP'), 'image/webp');
  assert.throws(() => core.imageMimeType('a.exe'), /Unsupported/);
  assert.throws(() => core.imageMimeType('noext'), /Unsupported/);
});

test('the catalog is append-only JSON lines, private to the user, and skips damaged lines', () => {
  const { file, catalog } = scratch();
  const image = core.readImage(file);
  const record = core.recordFor(image, { target: 'blossom', server: 'https://blossom.example', url: 'https://blossom.example/x.png', verified: true }, pubkey);
  core.appendRecord(catalog, record);
  fs.appendFileSync(catalog, 'not json\n');
  core.appendRecord(catalog, { ...record, target: 'nostr-build' });
  const warnings = [];
  const back = core.readRecords(catalog, (m) => warnings.push(m));
  assert.equal(back.length, 2);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /line 2/);
  assert.equal(fs.statSync(catalog).mode & 0o777, 0o600);
  assert.deepEqual(core.readRecords(path.join(path.dirname(catalog), 'missing.jsonl')), []);
  const text = fs.readFileSync(catalog, 'utf8');
  assert.ok(!text.includes(Buffer.from(secretKey).toString('hex')), 'the catalog must never hold the key');
});

test('password keys: typing builds it, backspace and ctrl-u edit it, enter submits, ctrl-c cancels, escapes are ignored', () => {
  let p = '';
  for (const ch of 'abc') p = core.applyPasswordKey(p, ch, {}).password;
  assert.equal(p, 'abc');
  assert.equal(core.applyPasswordKey(p, undefined, { name: 'backspace' }).password, 'ab');
  assert.equal(core.applyPasswordKey(p, undefined, { ctrl: true, name: 'u' }).password, '');
  assert.deepEqual(core.applyPasswordKey(p, undefined, { name: 'return' }), { type: 'submit', password: 'abc' });
  assert.equal(core.applyPasswordKey(p, undefined, { ctrl: true, name: 'c' }).type, 'cancel');
  assert.equal(core.applyPasswordKey(p, '\x1b[A', { name: 'up' }).password, 'abc');
});

// ---- the command itself, run for real ----

function cli(args, env, input) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'publish-images.mjs'), ...args], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
    input,
  });
}

test('the command prints an image’s existing URL instead of sending it again, and needs no key to do so', () => {
  const { file, catalog } = scratch();
  const image = core.readImage(file);
  for (const target of ['blossom', 'nostr-build']) {
    core.appendRecord(catalog, core.recordFor(image, { target, server: 's', url: 'https://host.example/' + target + '.png', verified: true }, pubkey));
  }
  const out = cli(['upload', file], { SIDECAR_IMAGE_CATALOG: catalog, SIDECAR_BLOSSOM_SERVER: 'https://blossom.example' });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /host\.example\/blossom\.png {2}\(already published to blossom\)/);
  assert.match(out.stdout, /host\.example\/nostr-build\.png {2}\(already published to nostr-build\)/);
});

test('the command refuses to upload without a key, without a server, or without a terminal for the password', () => {
  const { file, catalog } = scratch();
  const base = { SIDECAR_IMAGE_CATALOG: catalog };
  let out = cli(['upload', file], base);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /SIDECAR_BLOSSOM_SERVER is not set/);
  out = cli(['upload', file, '--to', 'nostr-build'], base);
  assert.match(out.stderr, /SIDECAR_NCRYPTSEC is not set/);
  out = cli(['upload', file, '--to', 'nostr-build'], { ...base, SIDECAR_NCRYPTSEC: tools.encrypt(secretKey, 'pw', 12) });
  assert.match(out.stderr, /terminal is required/);
  assert.ok(!out.stdout.includes('pw') && !out.stderr.includes('pw'));
});

test('a typo in a later path stops the batch before any password is asked for', () => {
  const { file, catalog } = scratch();
  const out = cli(['upload', file, path.join(path.dirname(file), 'nope.png'), '--to', 'nostr-build'], { SIDECAR_IMAGE_CATALOG: catalog, SIDECAR_NCRYPTSEC: 'x' });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /ENOENT/);
  assert.ok(!/password/i.test(out.stdout));
});

test('list reads the catalog, newest first, and filters', () => {
  const { file, catalog } = scratch();
  const image = core.readImage(file);
  core.appendRecord(catalog, core.recordFor(image, { target: 'blossom', server: 's', url: 'https://host.example/one.png', verified: true }, pubkey));
  core.appendRecord(catalog, core.recordFor(image, { target: 'nostr-build', server: 's', url: 'https://host.example/two.png', verified: true }, pubkey));
  const all = JSON.parse(cli(['list', '--json'], { SIDECAR_IMAGE_CATALOG: catalog }).stdout);
  assert.deepEqual(all.map((r) => r.url), ['https://host.example/two.png', 'https://host.example/one.png']);
  const some = JSON.parse(cli(['list', 'one', '--json'], { SIDECAR_IMAGE_CATALOG: catalog }).stdout);
  assert.equal(some.length, 1);
});
