'use strict';

// DRAFTS ON RELAYS (NIP-37), against the REAL extension: the panel's Saved drafts saves the
// draft on screen to relays, says there are no private relays and sets them up from the
// account's write relays when asked, and reads back a draft another client left there,
// opening it with the note in progress set aside rather than written over. The unit tests
// in relay-drafts.test.js run the codec and the controller; this runs the path the taps take.
//
// RELAY_DRAFTS_SHOTS=<dir> also writes what the panel looked like at each step, at its width.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };
const SHOTS = process.env.RELAY_DRAFTS_SHOTS || '';

const click = (selector) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.click(); return true; })()`;
const clickText = (selector, text) => `(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.textContent.trim() === ${JSON.stringify(text)}); if (!e) return false; e.click(); return true; })()`;

// NIP-44 to self, done as the worker does it, for the draft "another client" leaves.
function selfCipher() {
  const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, TextDecoder, setTimeout, clearTimeout, console, URL });
  ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'nostr-tools.js'), 'utf8'), ctx);
  vm.runInContext(`
    const sk = Uint8Array.from('05'.repeat(32).match(/../g).map((h) => parseInt(h, 16)));
    const ck = NostrTools.nip44.v2.utils.getConversationKey(sk, NostrTools.getPublicKey(sk));
    this.enc = (s) => NostrTools.nip44.v2.encrypt(s, ck);
    this.dec = (s) => NostrTools.nip44.v2.decrypt(s, ck);
  `, ctx);
  return { enc: ctx.enc, dec: ctx.dec };
}

async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(100); }
  throw new Error('timed out');
}

test('save to relays sets up private relays, and a draft from another client opens beside yours', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await x.screenshot(path.join(SHOTS, name + '.png')); } };
  try {
    await x.reload();
    const { enc, dec } = selfCipher();
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [x.me]: { text: 'Started in the panel', media: [], savedAt: Date.now() } } });

    await x.evaluate(click('#compose-note-btn'));
    await x.waitFor(clickText('#modal button', 'Resume draft'));
    await x.waitFor(`!!document.querySelector('#modal .compose-drafts-btn:not(.hidden)')`);
    assert.ok(await x.evaluate(click('#modal .compose-drafts-btn')));
    await x.waitFor(`!!document.querySelector('#modal .saved-draft-current .saved-draft-cloud')`);
    assert.equal(await x.evaluate(`document.querySelector('#modal .saved-draft-current .saved-draft-when').textContent`), 'Open now');
    // Nothing is read from the relays until asked.
    assert.ok(!x.relay.log.some((filters) => filters.some((f) => (f.kinds || []).includes(31234) || (f.kinds || []).includes(10013))),
      'Saved drafts asked the relays before anyone tapped anything');
    await shot('1-saved-drafts');

    // Save to relays with no relay list at all: a relay list is offered first, naming the relays.
    assert.ok(await x.evaluate(click('#modal .saved-draft-current .saved-draft-cloud')));
    await x.waitFor(`!!document.querySelector('#modal .relay-drafts .primary')`);
    const first = await x.evaluate(`document.querySelector('#modal .relay-drafts').innerText`);
    assert.match(first, /You have no relay list yet/);
    assert.match(first, new RegExp('127\\.0\\.0\\.1:' + x.relay.port));
    assert.ok(!x.relay.events.some((e) => e.kind === 10002), 'the relay list was published before anyone tapped');
    await shot('2a-relay-list-offer');

    assert.ok(await x.evaluate(clickText('#modal .relay-drafts .primary', 'Publish relay list')));
    const nip65 = await until(() => x.relay.events.find((e) => e.kind === 10002));
    assert.deepEqual(nip65.tags, [['r', x.relay.url]]);

    // Then the private relays, from the list just published.
    await x.waitFor(`/No private relays for drafts yet\\./.test(document.querySelector('#modal .relay-drafts').innerText)`);
    const offer = await x.evaluate(`document.querySelector('#modal .relay-drafts').innerText`);
    assert.match(offer, new RegExp('127\\.0\\.0\\.1:' + x.relay.port));
    await shot('2-set-up-offer');

    assert.ok(await x.evaluate(click('#modal .relay-drafts .primary')));
    const wrapEv = await until(() => x.relay.events.find((e) => e.kind === 31234));
    const list = x.relay.events.find((e) => e.kind === 10013);
    assert.ok(list, 'no private relay list was published');
    assert.deepEqual(list.tags, []);
    assert.deepEqual(JSON.parse(dec(list.content)), [['relay', x.relay.url]]);
    assert.equal(wrapEv.tags.find((tg) => tg[0] === 'k')[1], '1');
    const inner = JSON.parse(dec(wrapEv.content));
    assert.equal(inner.kind, 1);
    assert.equal(inner.content, 'Started in the panel');
    await x.waitFor(`!!document.querySelector('#modal .saved-draft-current .saved-draft-mark')`);
    const store = await x.message({ type: 'SIDECAR_SECRET_GET', store: 'drafts' });
    assert.equal(store.result[x.me].relay.d, wrapEv.tags.find((tg) => tg[0] === 'd')[1], 'the slot does not point at its relay copy');

    // Another client's draft, on the same private relay.
    const now = Math.floor(Date.now() / 1000);
    x.put({ kind: 31234, created_at: now, tags: [['d', 'phone-1'], ['k', '1'], ['expiration', String(now + 3600)]],
      content: enc(JSON.stringify({ kind: 1, created_at: now, tags: [], content: 'Written on my phone' })) }, 'me');
    assert.ok(await x.evaluate(clickText('#modal .relay-drafts-btn', 'Check your relays')));
    await x.waitFor(`[...document.querySelectorAll('#modal .relay-drafts .saved-draft-snip')].some((e) => e.textContent === 'Written on my phone')`);
    // Its own draft, already here, is not listed a second time.
    assert.equal(await x.evaluate(`document.querySelectorAll('#modal .relay-drafts .saved-draft').length`), 1);
    await shot('3-relay-list');

    assert.ok(await x.evaluate(`(() => { const s = [...document.querySelectorAll('#modal .relay-drafts .saved-draft-snip')].find((e) => e.textContent === 'Written on my phone'); s.closest('button').click(); return true; })()`));
    await x.waitFor(`(document.querySelector('#modal .compose-editor') || {}).innerText === 'Written on my phone'`);
    await shot('4-opened');
    const after = (await x.message({ type: 'SIDECAR_SECRET_GET', store: 'drafts' })).result;
    assert.equal(after[x.me].relay.d, 'phone-1');
    const aside = Object.keys(after).find((k) => k.startsWith(x.me + '|n:'));
    assert.ok(aside, 'the note in progress was not set aside');
    assert.equal(after[aside].text, 'Started in the panel');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('an account that already has a relay list is never offered one, and its list is left alone', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    x.put({ kind: 10002, created_at: Math.floor(Date.now() / 1000) - 100, tags: [['r', x.relay.url], ['r', 'wss://elsewhere.example']], content: '' }, 'me');
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [x.me]: { text: 'Started in the panel', media: [], savedAt: Date.now() } } });

    await x.evaluate(click('#compose-note-btn'));
    await x.waitFor(clickText('#modal button', 'Resume draft'));
    await x.waitFor(`!!document.querySelector('#modal .compose-drafts-btn:not(.hidden)')`);
    assert.ok(await x.evaluate(click('#modal .compose-drafts-btn')));
    await x.waitFor(`!!document.querySelector('#modal .saved-draft-current .saved-draft-cloud')`);
    assert.ok(await x.evaluate(click('#modal .saved-draft-current .saved-draft-cloud')));

    // Straight to the private relays: no word of a relay list, no button to publish one.
    await x.waitFor(`/No private relays for drafts yet\\./.test((document.querySelector('#modal .relay-drafts') || {}).innerText || '')`);
    const text = await x.evaluate(`document.querySelector('#modal .relay-drafts').innerText`);
    assert.doesNotMatch(text, /no relay list yet/);
    assert.equal(await x.evaluate(`[...document.querySelectorAll('#modal .relay-drafts button')].some((b) => b.textContent.trim() === 'Publish relay list')`), false);
    assert.equal(x.relay.events.filter((e) => e.kind === 10002).length, 1, 'a second relay list was published');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('a long list of drafts on the relays shows ten at a time, and says how many other kinds there are', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const { enc } = selfCipher();
    const now = Math.floor(Date.now() / 1000);
    x.put({ kind: 10002, created_at: now - 500, tags: [['r', x.relay.url]], content: '' }, 'me');
    x.put({ kind: 10013, created_at: now - 400, tags: [], content: enc(JSON.stringify([['relay', x.relay.url]])) }, 'me');
    for (let i = 0; i < 23; i++) {
      x.put({ kind: 31234, created_at: now - 300 + i, tags: [['d', 'bulk-' + i], ['k', '1'], ['expiration', String(now + 3600)]],
        content: enc(JSON.stringify({ kind: 1, created_at: now, tags: [], content: 'Draft number ' + i })) }, 'me');
    }
    // Long-form drafts: counted, not listed.
    for (let i = 0; i < 2; i++) {
      x.put({ kind: 31234, created_at: now - 100 + i, tags: [['d', 'article-' + i], ['k', '30023'], ['expiration', String(now + 3600)]],
        content: enc(JSON.stringify({ kind: 30023, created_at: now, tags: [['d', 'a' + i]], content: '# An article' })) }, 'me');
    }
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [x.me]: { text: 'Started in the panel', media: [], savedAt: Date.now() } } });
    await x.evaluate(click('#compose-note-btn'));
    await x.waitFor(clickText('#modal button', 'Resume draft'));
    await x.waitFor(`!!document.querySelector('#modal .compose-drafts-btn:not(.hidden)')`);
    assert.ok(await x.evaluate(click('#modal .compose-drafts-btn')));
    await x.waitFor(`!!document.querySelector('#modal .relay-drafts-btn')`);
    // The button has an icon in front of its word.
    assert.equal(await x.evaluate(`!!document.querySelector('#modal .relay-drafts-btn svg')`), true);
    assert.ok(await x.evaluate(clickText('#modal .relay-drafts-btn', 'Check your relays')));
    const rows = () => x.evaluate(`document.querySelectorAll('#modal .relay-drafts .saved-draft').length`);
    await x.waitFor(`document.querySelectorAll('#modal .relay-drafts .saved-draft').length > 0`);
    assert.equal(await rows(), 10, 'ten to begin with');
    assert.match(await x.evaluate(`document.querySelector('#modal .relay-drafts').innerText`), /2 drafts of kinds Sidecar does not draft yet/);
    assert.equal(await x.evaluate(`[...document.querySelectorAll('#modal .relay-drafts .relay-drafts-hint')].find((e) => /kinds Sidecar/.test(e.textContent)).title`), 'Kinds: 30023 ×2', 'hovering says which kinds');
    // Newest first.
    assert.match(await x.evaluate(`document.querySelector('#modal .relay-drafts .saved-draft-snip').textContent`), /Draft number 22/);

    assert.ok(await x.evaluate(clickText('#modal .relay-drafts-btn', 'Show 10 more')));
    assert.equal(await rows(), 20);
    assert.ok(await x.evaluate(clickText('#modal .relay-drafts-btn', 'Show 3 more')));
    assert.equal(await rows(), 23);
    assert.equal(await x.evaluate(`[...document.querySelectorAll('#modal .relay-drafts-btn')].some((b) => /Show .* more/.test(b.textContent))`), false, 'nothing left to show');

    // Deleting one keeps the page the list was on.
    assert.ok(await x.evaluate(`(() => { const b = document.querySelector('#modal .relay-drafts .saved-draft .saved-draft-x'); b.click(); return true; })()`));
    await sleep(300);
    assert.ok(await x.evaluate(`(() => { const b = document.querySelector('#modal .relay-drafts .saved-draft .saved-draft-x'); b.click(); return true; })()`));
    await x.waitFor(`document.querySelectorAll('#modal .relay-drafts .saved-draft').length === 22`);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('a draft another client keeps on the write relays is listed and opens, with no private relay list', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const { enc } = selfCipher();
    const now = Math.floor(Date.now() / 1000);
    // As Wisp writes one: a d and a k, no expiration, the inner event with a pubkey and no id or signature,
    // on a write relay, and no kind 10013 anywhere.
    x.put({ kind: 31234, created_at: now - 600, tags: [['d', 'other-app-1'], ['k', '1']],
      content: enc(JSON.stringify({ kind: 1, pubkey: x.me, created_at: now - 600, tags: [], content: 'Started in another app' })) }, 'me');

    // Reached from the compose menu with nothing saved here at all.
    await x.evaluate(click('#compose-fab'));
    await x.waitFor(`(() => { const b = document.getElementById('saved-drafts-btn'); return !!b && !b.hidden; })()`);
    assert.ok(await x.evaluate(click('#saved-drafts-btn')));
    await x.waitFor(`!!document.querySelector('#modal .relay-drafts-btn')`);
    assert.ok(await x.evaluate(clickText('#modal .relay-drafts-btn', 'Check your relays')));
    await x.waitFor(`[...document.querySelectorAll('#modal .relay-drafts .saved-draft-snip')].some((e) => e.textContent === 'Started in another app')`);
    assert.ok(!/could not be read|No private relays/.test(await x.evaluate(`document.querySelector('#modal .relay-drafts').innerText`)), 'no word of a missing private list');
    assert.ok(!x.relay.events.some((e) => e.kind === 10013 || e.kind === 10002), 'reading published nothing');

    assert.ok(await x.evaluate(`(() => { const s = [...document.querySelectorAll('#modal .relay-drafts .saved-draft-snip')].find((e) => e.textContent === 'Started in another app'); s.closest('button').click(); return true; })()`));
    await x.waitFor(`(document.querySelector('#modal .compose-editor') || {}).innerText === 'Started in another app'`);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
