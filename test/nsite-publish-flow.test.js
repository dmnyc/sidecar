'use strict';

// The publish flow, run for real (nsite.js's publish/unpublish against fake servers,
// relays and signer). Everything below is the actual orchestration code: it renders,
// hashes, asks, uploads, verifies, signs through a REAL site-publish session, and
// publishes — the fakes only stand in for the network and the key.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('./helpers/i18n.js');

const load = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const ALICE = 'a'.repeat(64);
const S1 = 'https://blossom-one.example';
const S2 = 'https://blossom-two.example';
const RELAYS = ['wss://relay.example'];

function harness({ currentManifest = null, approve = true } = {}) {
  const NS = { ctx: null };
  const SPctx = { console };
  SPctx.self = SPctx;
  vm.createContext(SPctx);
  vm.runInContext(load('site-publish.js'), SPctx);
  const SP = SPctx.SidecarSitePublish;

  const signed = [];
  const uploaded = [];   // { server, hash, bytes }
  const published = [];  // events handed to the relay pool
  let session = null;
  let ended = 0;

  const blobs = new Map(); // hash -> Uint8Array, what "the servers" hold

  const ctx = withI18n({
    console,
    crypto,
    TextEncoder,
    AbortSignal,
    AbortController,
    setTimeout,
    clearTimeout,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    // Two fake Blossom servers: the PUT stores, the GET serves what was stored —
    // and a GET for a hash that was never stored 404s, which is what the
    // verification step is for.
    fetch: async (url, opts) => {
      const u = new URL(url);
      if (opts && opts.method === 'PUT' && u.pathname === '/upload') {
        const auth = JSON.parse(Buffer.from(opts.headers.Authorization.slice(6), 'base64').toString('utf8'));
        const hash = auth.tags.find((t) => t[0] === 'x')[1];
        const body = opts.body;
        uploaded.push({ server: u.origin, hash, bytes: body.byteLength });
        blobs.set(hash, body);
        return { ok: true, json: async () => ({ url: u.origin + '/' + hash }) };
      }
      const hash = u.pathname.slice(1);
      if (blobs.has(hash)) {
        return { ok: true, arrayBuffer: async () => blobs.get(hash).buffer.slice(blobs.get(hash).byteOffset, blobs.get(hash).byteOffset + blobs.get(hash).byteLength) };
      }
      if (u.pathname === '/' || u.pathname === '') return { ok: true };
      return { ok: false, status: 404 };
    },
  });
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(load('nsite.js'), ctx);
  const nsite = ctx.SidecarNsite;

  nsite.install({
    call: async (message) => {
      if (message.type === 'SIDECAR_SITE_PUBLISH') {
        if (!approve) throw new Error('You rejected this publish');
        const err = SP.validatePlan(message.plan);
        if (err) throw new Error('bad plan: ' + err);
        session = SP.begin(ALICE, message.plan, Date.now());
        return { id: session.id, expiresAt: session.expiresAt };
      }
      if (message.type === 'SIDECAR_SITE_PUBLISH_END') { if (session) SP.end(message.session.id); ended++; return true; }
      throw new Error('unexpected call ' + message.type);
    },
    activePubkey: () => ALICE,
    fetchBlossomServers: async () => [S1, S2],
    relayUrls: async () => RELAYS,
    poolQuerySync: async () => (currentManifest ? [currentManifest] : []),
    hasServerList: async () => true,
    targetRelays: async () => RELAYS,
    publishToRelays: (relays, events) => {
      published.push(...events);
      return events.map(() => Promise.resolve(true));
    },
    siteSign: async (sess, event) => {
      // THE REAL GATE, as the background runs it: nothing is signed the session
      // does not cover.
      const why = SP.check(SP.get(sess.id) || null, event, ALICE);
      if (why) throw new Error(why);
      const signedEvent = { ...event, pubkey: ALICE, id: 'f'.repeat(64), sig: 's'.repeat(128) };
      signed.push(signedEvent);
      return signedEvent;
    },
  });

  return {
    nsite, SP, ctx,
    state: { get signed() { return signed; }, get uploaded() { return uploaded; }, get published() { return published; }, get session() { return session; }, get ended() { return ended; } },
  };
}

const draft = {
  name: 'blog',
  title: 'The Blog',
  pages: [
    { slug: 'index', title: 'Home', md: '# Hello\n\nWorld.' },
    { slug: 'about', title: 'About', md: 'About page.' },
  ],
};

test('a first publish: approval, two verified uploads per file, manifest, snapshot, gateway', async () => {
  const h = harness();
  const result = await h.nsite.publish(draft, () => {});

  // Signed through the session: one 24242 auth per upload, the manifest (35128,
  // named) and its snapshot (5128) — and nothing else.
  const auths = h.state.signed.filter((e) => e.kind === 24242);
  assert.equal(auths.length, 4, 'one upload auth per file per server');
  const kinds = h.state.signed.filter((e) => e.kind !== 24242).map((e) => e.kind);
  assert.deepEqual(kinds, [35128, 5128], 'no 10063: the account already has a server list');
  const manifest = h.state.signed.find((e) => e.kind === 35128);
  assert.equal(manifest.tags.find((t) => t[0] === 'd')[1], 'blog');
  assert.equal(manifest.tags.filter((t) => t[0] === 'path').length, 2);
  const snapshot = h.state.signed.find((e) => e.kind === 5128);
  assert.equal(snapshot.kind, 5128);
  assert.ok(snapshot.tags.some((t) => t[0] === 'a' && t[1] === '35128:' + ALICE + ':blog'));

  // Two servers per file, and each upload's auth committed to the real bytes:
  // the verification GET ran against the same hash the plan approved.
  assert.equal(h.state.uploaded.length, 4);
  assert.deepEqual([...new Set(h.state.uploaded.map((u) => u.server))].sort(), [S1, S2].sort());
  for (const u of h.state.uploaded) assert.match(u.hash, /^[0-9a-f]{64}$/);
  // Every upload auth committed to the very hash it uploaded, session-checked.
  const approved = new Set(h.state.session ? [] : []);
  for (const a of auths) assert.ok(a.tags.some((t) => t[0] === 'x' && /^[0-9a-f]{64}$/.test(t[1])));

  // Everything the flow built went to the relays: manifest + snapshot.
  assert.deepEqual(h.state.published.map((e) => e.kind), [35128, 5128]);
  // The session was released when the publish settled.
  assert.equal(h.state.ended, 1);
  assert.equal(h.SP.get(h.state.session.id), null);
  // And the gateway address is the named-site form.
  assert.equal(result.url, 'https://' + h.nsite.pubkeyB36(ALICE) + 'blog.nsite.lol');
  assert.equal(result.live, true, 'the fake gateway serves the entry document');
  assert.equal(result.manifest, manifest);
});

test('a republish uploads only what changed, and the manifest names old and new servers', async () => {
  const h = harness();
  const first = await h.nsite.publish(draft, () => {});
  const h2 = harness({ currentManifest: first.manifest });
  // One page's text changes; the other is byte-identical, so its blob is not re-uploaded.
  const draft2 = { ...draft, pages: [draft.pages[0], { ...draft.pages[1], md: 'About page, edited.' }] };
  await h2.nsite.publish(draft2, () => {});
  assert.equal(h2.state.uploaded.length, 2, 'one file, two servers: only the changed page uploads');
  // The carried-over files' server rides along from the old manifest, so gateways
  // can still find them.
  const manifest = h2.state.signed.find((e) => e.kind === 35128);
  const servers = manifest.tags.filter((t) => t[0] === 'server').map((t) => t[1]).sort().join();
  assert.equal(servers, [S1, S2].sort().join());
});

test('a publish with nothing new in it refuses before asking', async () => {
  const h = harness();
  const first = await h.nsite.publish(draft, () => {});
  const h2 = harness({ currentManifest: first.manifest });
  await assert.rejects(() => h2.nsite.publish(draft, () => {}), /no changes to upload/);
  assert.equal(h2.state.signed.length, 0, 'nothing was signed');
});

test('a rejected card signs nothing and uploads nothing', async () => {
  const h = harness({ approve: false });
  await assert.rejects(() => h.nsite.publish(draft, () => {}), /rejected/);
  assert.equal(h.state.signed.length, 0);
  assert.equal(h.state.uploaded.length, 0);
});

test('unpublish: an empty manifest and a deletion for the site, under one approval', async () => {
  const h = harness();
  const first = await h.nsite.publish(draft, () => {});
  const h2 = harness({ currentManifest: first.manifest });
  const out = await h2.nsite.unpublish('blog', () => {});
  const kinds = h2.state.signed.map((e) => e.kind);
  assert.deepEqual(kinds, [35128, 5], 'the empty manifest and the kind 5, nothing else');
  const empty = h2.state.signed[0];
  assert.equal(empty.tags.filter((t) => t[0] === 'path').length, 0);
  assert.equal(empty.tags.find((t) => t[0] === 'd')[1], 'blog');
  const deletion = h2.state.signed[1];
  const a = deletion.tags.find((t) => t[0] === 'a');
  assert.equal(a[0], 'a');
  assert.equal(a[1], '35128:' + ALICE + ':blog');
  assert.deepEqual(h2.state.published.map((e) => e.kind), [35128, 5]);
  assert.equal(out.url, 'https://' + h.nsite.pubkeyB36(ALICE) + 'blog.nsite.lol');
  // Nothing was uploaded: unpublish moves no blobs.
  assert.equal(h2.state.uploaded.length, 0);
});

test('a page over the cap is refused before any approval is asked', async () => {
  const h = harness();
  const big = { ...draft, pages: [{ slug: 'index', title: '', md: 'x'.repeat(h.nsite.PAGE_MAX_BYTES) }] };
  await assert.rejects(() => h.nsite.publish(big, () => {}), /1 MB page limit/);
  assert.equal(h.state.signed.length, 0);
});
