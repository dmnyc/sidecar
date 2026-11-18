'use strict';

// A MISSING PROFILE IMAGE IS UPLOADED FROM THE PROFILE SCREEN, AND SAVES ON THE SPOT.
//
// With no banner or no picture the profile showed a gradient and a default face, and the only way
// to set either was Edit profile. Now the empty banner and the default avatar are the upload
// buttons: a picked file is uploaded and the profile republished at once, each image on its own.
// This runs the real panel in a real Chrome against a local relay. Only the upload endpoint is
// stubbed (the panel's fetch, for nostr.build's URL), so the signed upload auth, the merge with
// the existing profile, the signing and the publish are all the real code.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const stubUploads = (delay) => `(() => {
  const real = window.fetch;
  window.__uploads = [];
  window.__release = null;
  window.fetch = (url, init) => {
    if (!String(url).startsWith('https://nostr.build/api/v2/upload/')) return real(url, init);
    window.__uploads.push(String(url));
    const n = window.__uploads.length;
    const answer = () => new Response(JSON.stringify({ data: [{ url: 'https://img.test/' + n + '.png' }] }), { status: 200 });
    if (!${delay ? 'true' : 'false'}) return Promise.resolve(answer());
    return new Promise((resolve) => { window.__release = () => resolve(answer()); });
  };
})()`;

// What the picker would hand over: set the hidden input's file and fire its change.
const chooseFile = `(() => {
  const input = document.querySelector('.profile-header input[type="file"]');
  const bytes = Uint8Array.from(atob('${PNG}'), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'p.png', { type: 'image/png' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
})()`;

const targets = `(() => ({
  banner: !!document.querySelector('.profile-upload-ph'),
  avatar: !!document.querySelector('.profile-avatar-empty'),
}))()`;

async function openProfile(x) {
  await x.reload(); // the panel was open before the account was added, and still says there is none
  await x.evaluate(`document.querySelector('.tab[data-tab="profile"]').click()`);
  await x.waitFor(`!!document.querySelector('.profile-header')`, 15000);
}
const profiles = (x, field) => x.relay.events.filter((e) => e.kind === 0 && e.pubkey === x.me && JSON.parse(e.content)[field]);
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); }
  return null;
}
const seed = (x) => x.put({ kind: 0, created_at: Math.floor(Date.now() / 1000) - 60, tags: [], content: JSON.stringify({ name: 'tester', display_name: 'Tester', custom_field: 'kept' }) }, 'me');

test('an empty banner and avatar upload from the profile, each saving at once and keeping the rest', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    seed(x);
    await openProfile(x);
    await x.evaluate(stubUploads(false));
    assert.deepEqual(await x.evaluate(targets), { banner: true, avatar: true }, 'both empty images should be upload buttons');

    // The avatar first.
    await x.evaluate(`document.querySelector('.profile-avatar-empty').click()`);
    await x.evaluate(chooseFile);
    const first = await until(() => profiles(x, 'picture')[0]);
    assert.ok(first, 'no profile with a picture reached the relay');
    let c = JSON.parse(first.content);
    assert.equal(c.picture, 'https://img.test/1.png');
    assert.equal(c.banner, undefined, 'the banner was set by the avatar upload');
    assert.equal(c.custom_field, 'kept', 'a field the upload does not touch was dropped');
    await x.waitFor(`!document.querySelector('.profile-avatar-empty') && !!document.querySelector('.profile-upload-ph')`, 10000);

    // Then the banner, which must carry the picture along.
    await x.evaluate(`document.querySelector('.profile-upload-ph').click()`);
    await x.evaluate(chooseFile);
    const second = await until(() => profiles(x, 'banner')[0]);
    assert.ok(second, 'no profile with a banner reached the relay');
    c = JSON.parse(second.content);
    assert.equal(c.banner, 'https://img.test/2.png');
    assert.equal(c.picture, 'https://img.test/1.png', 'saving the banner erased the avatar');
    assert.equal(c.custom_field, 'kept');
    await x.waitFor(`!document.querySelector('.profile-upload-ph') && !document.querySelector('.profile-avatar-empty')`, 10000);
    const kinds = x.relay.events.filter((e) => e.kind === 0 && e.pubkey === x.me && e.created_at > Math.floor(Date.now() / 1000) - 30);
    assert.equal(kinds.length, 2, 'each image is one publish');
  } finally { x.close(); }
});

test('with both images set the profile shows no upload buttons', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    x.put({ kind: 0, created_at: Math.floor(Date.now() / 1000) - 60, tags: [], content: JSON.stringify({ name: 'tester', picture: 'https://img.test/a.png', banner: 'https://img.test/b.png' }) }, 'me');
    await openProfile(x);
    assert.deepEqual(await x.evaluate(targets), { banner: false, avatar: false });
  } finally { x.close(); }
});

test('a second upload waits while one is saving, so neither publish erases the other', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    seed(x);
    await openProfile(x);
    await x.evaluate(stubUploads(true));
    await x.evaluate(`document.querySelector('.profile-avatar-empty').click()`);
    await x.evaluate(chooseFile);
    await x.waitFor(`window.__uploads.length === 1`, 5000);
    // The avatar is mid-upload. Pressing the banner and choosing a file must start nothing.
    await x.evaluate(`document.querySelector('.profile-upload-ph').click()`);
    await x.evaluate(chooseFile);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(await x.evaluate('window.__uploads.length'), 1, 'a second upload started while the first was saving');
    await x.evaluate('window.__release()');
    assert.ok(await until(() => profiles(x, 'picture')[0]), 'the first upload never published');
    assert.equal(profiles(x, 'banner').length, 0, 'the ignored banner pick published anyway');
  } finally { x.close(); }
});

test('switching accounts while an image uploads publishes nothing', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    seed(x);
    const add = await x.message({ type: 'SIDECAR_ADD_ACCOUNT', secret: '06'.repeat(32), name: 'Bea' });
    assert.ok(add && add.ok, 'adding Bea');
    await openProfile(x);
    await x.evaluate(stubUploads(true));
    await x.evaluate(`document.querySelector('.profile-avatar-empty').click()`);
    await x.evaluate(chooseFile);
    await x.waitFor(`window.__uploads.length === 1`, 5000);
    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: x.bea });
    await x.evaluate('window.__release()');
    await new Promise((r) => setTimeout(r, 2000));
    const stray = x.relay.events.filter((e) => e.kind === 0 && /img\.test/.test(e.content));
    assert.equal(stray.length, 0, 'a profile was published after the account changed: ' + JSON.stringify(stray.map((e) => e.pubkey.slice(0, 8))));
  } finally { x.close(); }
});
