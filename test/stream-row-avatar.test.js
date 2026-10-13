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
    profileArtwork: {}, bannerArtwork: {},
    profileImage: () => new Promise((resolve) => pending.push(resolve)),
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const item = { host, image, relays: [] };
  const refresh = ctx.rowAvatar(item, avatar);
  return { ctx, avatar, refresh, pending, item };
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
  assert.equal(s.ctx.profileArtwork.src, undefined);
  assert.equal(s.ctx.bannerArtwork.src, undefined);
  const t = setup();
  t.refresh();
  t.pending[0]('https://pics.example/me.png');
  await tick();
  assert.equal(t.ctx.profileArtwork.src, 'https://pics.example/me.png', 'the current discovery still sets it');
  assert.equal(t.ctx.bannerArtwork.src, 'https://art.example/banner.png');
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
