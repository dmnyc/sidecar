'use strict';

// A stream row's avatar comes from a profile lookup. The lookup used to be dropped if the stream
// list had reconnected since the row was built, which was harmless while every paint rebuilt its
// rows and fatal once rows were reused: they kept a blank avatar for good.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'streams.js'), 'utf8');
const at = source.indexOf('  function rowAvatar(');
const code = source.slice(at, source.indexOf('  function buildRow(', at));

function setup({ host = 'h', image = 'https://art.example/a.png' } = {}) {
  const pending = [];
  const attrs = new Map();
  const avatar = { getAttribute: (k) => attrs.get(k) ?? null, set src(v) { attrs.set('src', v); }, get src() { return attrs.get('src'); } };
  const ctx = {
    discoveryGeneration: 1,
    profileImages: new Map([['h', { banner: 'https://art.example/banner.png' }]]),
    profileImage: () => new Promise((resolve) => pending.push(resolve)),
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const item = { host, image, relays: [] };
  // Handed in the way production hands them in. They used to be globals of this test, which let
  // rowAvatar use two names it was never given: in the real page that threw a ReferenceError inside
  // the lookup's promise, and no stream whose own image failed ever got its host's picture or banner.
  const profileArtwork = {}, bannerArtwork = {};
  const refresh = ctx.rowAvatar(item, avatar, profileArtwork, bannerArtwork);
  return { ctx, avatar, refresh, pending, item, profileArtwork, bannerArtwork };
}
const tick = () => new Promise(setImmediate);

test('the avatar arrives even if the list reconnected after the row was built', async () => {
  const s = setup();
  s.refresh();
  s.ctx.discoveryGeneration = 2; // a new discovery began while the lookup was out
  s.pending[0]('https://pics.example/me.png');
  await tick();
  assert.equal(s.avatar.src, 'https://pics.example/me.png');
});

test('the player artwork, which is shared, is not set by a lookup from an earlier discovery', async () => {
  const s = setup();
  s.refresh();
  s.ctx.discoveryGeneration = 2;
  s.pending[0]('https://pics.example/me.png');
  await tick();
  assert.equal(s.profileArtwork.src, undefined);
  assert.equal(s.bannerArtwork.src, undefined);
  const t = setup();
  t.refresh();
  t.pending[0]('https://pics.example/me.png');
  await tick();
  assert.equal(t.profileArtwork.src, 'https://pics.example/me.png', 'the current discovery still sets it');
  assert.equal(t.bannerArtwork.src, 'https://art.example/banner.png');
});

test('with no profile picture the stream artwork stands in, and a later refresh can still upgrade it', async () => {
  const s = setup();
  s.refresh();
  s.pending[0](null);
  await tick();
  assert.equal(s.avatar.src, 'https://art.example/a.png');
  s.refresh();
  assert.equal(s.pending.length, 2, 'it asks again, since no profile has answered');
  s.pending[1]('https://pics.example/me.png');
  await tick();
  assert.equal(s.avatar.src, 'https://pics.example/me.png');
});

test('it does not ask again while a lookup is out, or once a profile has answered', async () => {
  const s = setup();
  s.refresh(); s.refresh(); s.refresh();
  assert.equal(s.pending.length, 1);
  s.pending[0]('https://pics.example/me.png');
  await tick();
  s.refresh();
  assert.equal(s.pending.length, 1, 'answered');
});

test('a stream with no host asks nothing', () => {
  const s = setup({ host: null });
  s.refresh();
  assert.equal(s.pending.length, 0);
});

// A stream whose own image does not load (a dead link) is left with the host's picture and banner as
// its thumbnail, which is what the two layers under the stream's image are for.
test('a lookup that answers sets the banner and the picture layers, and raises nothing', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const s = setup();
    s.refresh();
    s.pending[0]('https://pics.example/me.png');
    await tick(); await tick();
    assert.equal(s.profileArtwork.src, 'https://pics.example/me.png');
    assert.equal(s.bannerArtwork.src, 'https://art.example/banner.png');
    assert.deepEqual(unhandled.map((e) => String(e && e.message)), [], 'the lookup\'s promise threw');
  } finally { process.off('unhandledRejection', onUnhandled); }
});

test('rowAvatar uses no name it is not given: every free name resolves in this scope', () => {
  // The names rowAvatar may reach for without being handed them. Anything else, such as the row's
  // artwork elements, must come in as a parameter.
  const params = code.slice(code.indexOf('('), code.indexOf(')')).split(',').map((x) => x.replace(/[()\s]/g, ''));
  assert.deepEqual(params, ['item', 'avatar', 'profileArtwork', 'bannerArtwork']);
});

test('a stream announcement’s thumb tag is read, and only when it is an https link', () => {
  const SidecarStreams = require('../stream-core.js');
  const ev = tags => ({ id: 'a'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1, kind: 30311, content: '', tags: [['d', 'x'], ...tags] });
  assert.equal(SidecarStreams.parse(ev([['thumb', 'https://img.example/t.webp?n=1']])).thumb, 'https://img.example/t.webp?n=1');
  assert.equal(SidecarStreams.parse(ev([['thumb', 'javascript:alert(1)']])).thumb, null);
  assert.equal(SidecarStreams.parse(ev([])).thumb, null);
});

test('the thumb layer sits above the banner and below the announced image', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'streams.js'), 'utf8').replace(/\/\/.*$/gm, '');
  const at = re => src.search(re);
  // Each later insertBefore(x, artwork) lands closer to the image, so source order is paint order.
  assert.ok(at(/insertBefore\(profileArtwork,artwork\)/) < at(/insertBefore\(bannerArtwork,artwork\)/));
  assert.ok(at(/insertBefore\(bannerArtwork,artwork\)/) < at(/insertBefore\(thumbArtwork,artwork\)/));
  assert.match(src, /if\(item\.thumb\)thumbArtwork\.src=item\.thumb/);
});
