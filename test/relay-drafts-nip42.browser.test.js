'use strict';

// DRAFTS ON A RELAY THAT DEMANDS NIP-42, against the REAL extension. The relay drafts lab runs against
// test/manual/nip42-relay.js: a private relay that answers nothing until the client has proved who it is.
// This is the round trip from the panel's side: the account's relay is that relay, so a draft saved to
// it must be preceded by an AUTH the extension answers on its own, with no approval card, and what
// lands on the relay is an encrypted kind 31234 and the private relay list, never the draft's words.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');
const { startNip42Relay } = require('./manual/nip42-relay');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };
const click = (selector) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.click(); return true; })()`;
const clickText = (selector, text) => `(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.textContent.trim() === ${JSON.stringify(text)}); if (!e) return false; e.click(); return true; })()`;
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(150); }
  throw new Error('timed out');
}
const getState = (port) => new Promise((resolve, reject) => {
  http.get('http://127.0.0.1:' + port + '/state', (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => resolve(JSON.parse(b))); }).on('error', reject);
});

// NIP-44 to self, done as the worker does it, for the draft "another client" leaves.
function selfCipher() {
  const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, TextDecoder, setTimeout, clearTimeout, console, URL });
  ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'nostr-tools.js'), 'utf8'), ctx);
  vm.runInContext(`
    const sk = Uint8Array.from('05'.repeat(32).match(/../g).map((h) => parseInt(h, 16)));
    const ck = NostrTools.nip44.v2.utils.getConversationKey(sk, NostrTools.getPublicKey(sk));
    this.enc = (s) => NostrTools.nip44.v2.encrypt(s, ck);
  `, ctx);
  return { enc: ctx.enc };
}

test('a draft saved to a relay that requires NIP-42 is authenticated for, stored encrypted, and blanked on delete', opts, async (t) => {
  const relay = await startNip42Relay();
  let x;
  try { x = await startExtension(); } catch (e) { relay.close(); if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    // The account's relay is the private one, and nothing else.
    await x.message({ type: 'SIDECAR_SET_RELAYS', relays: { [relay.url]: { read: true, write: true } } });
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: { [x.me]: { text: 'LAB-started in the panel', media: [], savedAt: Date.now() } } });

    await x.evaluate(click('#compose-note-btn'));
    await x.waitFor(clickText('#modal button', 'Resume draft'));
    await x.waitFor(`!!document.querySelector('#modal .compose-drafts-btn:not(.hidden)')`);
    assert.ok(await x.evaluate(click('#modal .compose-drafts-btn')));
    await x.waitFor(`!!document.querySelector('#modal .saved-draft-current .saved-draft-cloud')`);
    assert.ok(await x.evaluate(click('#modal .saved-draft-current .saved-draft-cloud')));
    await x.waitFor(`!!document.querySelector('#modal .relay-drafts .primary')`);
    assert.match(await x.evaluate(`document.querySelector('#modal .relay-drafts').innerText`), /no relay list yet/i);

    assert.ok(await x.evaluate(clickText('#modal .relay-drafts .primary', 'Publish relay list')));
    await until(() => relay.events().find((e) => e.kind === 10002));
    await x.waitFor(`/No private relays for drafts yet\\./.test(document.querySelector('#modal .relay-drafts').innerText)`);
    assert.ok(await x.evaluate(click('#modal .relay-drafts .primary')));
    const draft = await until(() => relay.events().find((e) => e.kind === 31234));
    assert.ok(relay.events().find((e) => e.kind === 10013), 'no private relay list reached the relay');
    assert.ok(!draft.content.includes('LAB-'), 'the draft reached the relay as plaintext');

    // The relay required AUTH and the extension answered it, unprompted, as the account.
    let s = await getState(relay.port);
    assert.ok(s.log.some((l) => l.kind === 'auth' && /accepted/.test(l.text)), 'the relay never accepted an AUTH: ' + JSON.stringify(s.log));
    assert.deepEqual(s.authed, [x.me]);
    assert.deepEqual(s.leaks, [], 'a private event reads as plaintext on the relay');
    assert.equal(await x.evaluate(`document.getElementById('view-approval') && !document.getElementById('view-approval').classList.contains('hidden')`), false,
      'answering the relay’s AUTH raised an approval card');

    await x.waitFor(`!!document.querySelector('#modal .saved-draft-current .saved-draft-mark')`);

    // A draft another client left on the same relay: found over the authenticated connection, and
    // deleting it from here blanks the relay's copy (same d, empty content, newer).
    const { enc } = selfCipher();
    const now = Math.floor(Date.now() / 1000);
    relay.put(x.nt.sign({ kind: 31234, created_at: now - 5, tags: [['d', 'phone-1'], ['k', '1'], ['expiration', String(now + 3600)]],
      content: enc(JSON.stringify({ kind: 1, created_at: now, tags: [], content: 'Written on my phone' })) }, 'me'));
    assert.ok(await x.evaluate(clickText('#modal .relay-drafts-btn', 'Check your relays')));
    await x.waitFor(`[...document.querySelectorAll('#modal .relay-drafts .saved-draft-snip')].some((e) => e.textContent === 'Written on my phone')`);
    assert.ok(await x.evaluate(`(() => { const s = [...document.querySelectorAll('#modal .relay-drafts .saved-draft-snip')].find((e) => e.textContent === 'Written on my phone'); const b = s.closest('.saved-draft').querySelector('.saved-draft-x:not(.saved-draft-cloud)'); if (!b) return false; b.click(); return true; })()`),
      'no Delete from your relays button on the relay draft');
    // Two taps: the first asks, the second deletes.
    await x.waitFor(`[...document.querySelectorAll('#modal button')].some((b) => /Tap again to delete/.test(b.textContent))`);
    assert.ok(await x.evaluate(`(() => { const b = [...document.querySelectorAll('#modal button')].find((e) => /Tap again to delete/.test(e.textContent)); b.click(); return true; })()`));
    await until(() => { const e = relay.events().find((ev) => ev.kind === 31234 && (ev.tags.find((tg) => tg[0] === 'd') || [])[1] === 'phone-1'); return e && e.content === ''; });
    s = await getState(relay.port);
    assert.deepEqual(s.leaks, []);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); relay.close(); }
});
