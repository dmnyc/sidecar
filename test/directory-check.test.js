'use strict';

// The release check for the app directory and the wallets list: what it reads from the two
// files, and how it judges what came back. Offline; the network pass is
// scripts/check-directory.js, run before each release.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const core = require('../scripts/directory-check-core');

const ROOT = path.join(__dirname, '..');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const headers = (h = {}) => new Headers(h);

test('every app and wallet card is read, each with a link and something to show', () => {
  const entries = core.readDirectory(ROOT);
  assert.ok(entries.filter((e) => e.list === 'apps').length > 40);
  assert.ok(entries.filter((e) => e.list === 'wallets').length > 4);
  for (const e of entries) {
    const ts = core.targets(e);
    assert.match(ts[0].url, /^https:\/\//, `${e.name} has no https link`);
    assert.ok(e.logo || ts.some((t) => t.kind !== 'page'), `${e.name} has nothing to show as a logo`);
  }
});

test('a card with no icon of its own is checked at the favicon the page falls back to', () => {
  const ts = core.targets({ name: 'X', url: 'https://x.example', domain: 'x.example' });
  assert.deepEqual(ts.map((t) => t.kind), ['page', 'favicon']);
  assert.equal(ts[1].url, core.faviconUrl('x.example'));
  assert.equal(core.targets({ url: 'https://a.b', icon: 'icons/apps/snort.png' })[1].kind, 'local-icon');
  assert.equal(core.targets({ url: 'https://a.b', logo: '<svg/>' }).length, 1);
});

test('a logo is judged by its bytes: a 200 of HTML is not a picture', () => {
  const icon = { kind: 'icon', url: 'https://a.example/i.png' };
  assert.equal(core.judge(icon, { status: 200, headers: headers({ 'content-type': 'image/png' }), body: PNG }).level, 'ok');
  const html = core.judge(icon, { status: 200, headers: headers({ 'content-type': 'text/html' }), body: Buffer.from('<!doctype html><html>') });
  assert.equal(html.level, 'fail');
  assert.match(html.why, /not a picture \(text\/html\)/);
  assert.equal(core.imageKind(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(core.judge(icon, { status: 404, headers: headers(), body: Buffer.alloc(0) }).level, 'fail');
});

test('a bot check fails a logo but only warns about a site link', () => {
  const cf = { status: 403, headers: headers({ 'cf-mitigated': 'challenge' }), body: Buffer.from('<html>') };
  assert.equal(core.judge({ kind: 'icon', url: 'https://a.example/i.png' }, cf).level, 'fail');
  assert.equal(core.judge({ kind: 'page', url: 'https://a.example' }, { ...cf, finalUrl: 'https://a.example/' }).level, 'warn');
  const vercel = { status: 429, headers: headers({ 'x-vercel-mitigated': 'challenge' }), body: Buffer.from('<html>') };
  assert.match(core.judge({ kind: 'icon', url: 'https://v.example/i.png' }, vercel).why, /Vercel bot check/);
});

test('a dead site fails, and one that now lands elsewhere warns', () => {
  const page = { kind: 'page', url: 'https://old.example' };
  assert.equal(core.judge(page, { error: 'ENOTFOUND' }).level, 'fail');
  assert.equal(core.judge(page, { status: 410, headers: headers(), finalUrl: page.url }).level, 'fail');
  assert.equal(core.judge(page, { status: 200, headers: headers(), finalUrl: 'https://www.old.example/' }).level, 'ok');
  assert.equal(core.judge(page, { status: 200, headers: headers(), finalUrl: 'https://parked.example/' }).level, 'warn');
  // A referral link redirects by design.
  assert.equal(core.judge({ ...page, extra: true }, { status: 200, headers: headers(), finalUrl: 'https://elsewhere.example/' }).level, 'ok');
});

test('Google answering 404 for a favicon means the card shows its gray globe', () => {
  const v = core.judge({ kind: 'favicon', url: core.faviconUrl('none.example') },
    { status: 404, headers: headers({ 'content-type': 'image/png' }), body: PNG }, { domain: 'none.example' });
  assert.equal(v.level, 'fail');
  assert.match(v.why, /gray globe/);
});

test('a bundled icon must exist and be a picture', () => {
  assert.equal(core.judgeLocal(ROOT, { url: 'icons/apps/snort.png' }).level, 'ok');
  assert.equal(core.judgeLocal(ROOT, { url: 'icons/apps/nope.png' }).level, 'fail');
  assert.equal(core.judgeLocal(ROOT, { url: 'welcome.js' }).level, 'fail');
});
