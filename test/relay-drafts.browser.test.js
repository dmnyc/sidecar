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

    // Save to relays with no private relays: said, and an offer naming the relays it would use.
    assert.ok(await x.evaluate(click('#modal .saved-draft-current .saved-draft-cloud')));
    await x.waitFor(`!!document.querySelector('#modal .relay-drafts .primary')`);
    const offer = await x.evaluate(`document.querySelector('#modal .relay-drafts').innerText`);
    assert.match(offer, /No private relays for drafts yet\./);
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
