'use strict';

// A NEW ACCOUNT FOLLOWS AND MUTES. An account made a minute ago has no follow list, no mute
// list and often no profile, so a read of its relays brings back nothing at all. That used to
// read as "the relays did not answer": the profile card's Follow button stayed dimmed for good,
// and a follow or a mute from anywhere failed with "Could not read your follow list". When every
// relay really answered with nothing, the first follow or mute starts the list. Against the REAL
// extension and a relay on localhost, with nothing published for the account beforehand.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { startExtension, CHROME, _internals: { startRelay } } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

async function withExtension(t, fn) {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try { await fn(x); } finally { x.close(); }
}

const BTN = (i) => `document.querySelectorAll('#modal .peek-person-actions .icon-btn')[${i}]`;
const ready = (i) => `(() => { const b = ${BTN(i)}; return !!b && !b.disabled && !b.classList.contains('pending'); })()`;
const toastText = `[...document.querySelectorAll('#toasts .toast')].map((e) => e.textContent).join(' | ')`;

async function openCard(x) {
  x.put({ kind: 0, created_at: Math.floor(Date.now() / 1000) - 100, tags: [], content: JSON.stringify({ name: 'Bea' }) }, 'bea');
  await x.reload();
  assert.deepEqual(x.relay.events.filter((e) => e.pubkey === x.me).map((e) => e.kind), [], 'the account is not new');
  await x.evaluate(`window.SidecarStreamChatAccount.profile(${JSON.stringify(x.bea)})`);
  await x.waitFor(`!!${BTN(0)}`, 10000);
}

test('a new account’s first follow, from a profile card: the button comes up, and the tap starts the list', opts, async (t) => {
  await withExtension(t, async (x) => {
    await openCard(x);
    await x.waitFor(ready(0), 15000);
    assert.equal(await x.evaluate(`${BTN(0)}.getAttribute('aria-label')`), 'Follow');
    await x.evaluate(`${BTN(0)}.click()`);
    await x.waitFor(`${toastText}.includes('Followed')`, 15000);
    const lists = x.relay.events.filter((e) => e.kind === 3 && e.pubkey === x.me);
    assert.equal(lists.length, 1);
    assert.deepEqual(lists[0].tags, [['p', x.bea]]);
    assert.equal(await x.evaluate(`${BTN(0)}.getAttribute('aria-label')`), 'Unfollow');
    assert.ok(!(await x.evaluate(toastText)).includes('Could not read'));
    assert.deepEqual(x.errors, []);
  });
});

test('a new account’s first mute starts its mute list, with the person in the private part', opts, async (t) => {
  await withExtension(t, async (x) => {
    await openCard(x);
    await x.waitFor(ready(1), 15000);
    await x.evaluate(`${BTN(1)}.click()`);
    await x.sleep(500);
    await x.evaluate(`${BTN(1)}.click()`);
    await x.waitFor(`${toastText}.includes('Muted')`, 15000);
    const lists = x.relay.events.filter((e) => e.kind === 10000 && e.pubkey === x.me);
    assert.equal(lists.length, 1);
    assert.deepEqual(lists[0].tags, [], 'the person is not in the public part');
    assert.ok(lists[0].content, 'no private part');
    assert.ok(!(await x.evaluate(toastText)).includes('Could not read'));
    assert.deepEqual(x.errors, []);
  });
});

// SOME RELAY IS ALWAYS DOWN. A relay that refuses the connection was asked nothing and can be
// written nothing, so it does not count either way. One that connects and then says nothing
// may hold the list, and still refuses.

// A port nothing listens on: the connection is refused at once, as a dead relay's is.
async function deadUrl() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return 'ws://127.0.0.1:' + port;
}

async function withRelays(x, extra) {
  const urls = [x.relay.url, ...extra];
  await x.message({ type: 'SIDECAR_SET_RELAYS', relays: Object.fromEntries(urls.map((u) => [u, { read: true, write: true }])) });
}

test('a new account’s first follow goes through with one of its relays down', opts, async (t) => {
  await withExtension(t, async (x) => {
    const second = await startRelay();
    try {
      await withRelays(x, [second.url, await deadUrl()]);
      await openCard(x);
      await x.waitFor(ready(0), 15000);
      await x.evaluate(`${BTN(0)}.click()`);
      await x.waitFor(`${toastText}.includes('Followed') || ${toastText}.includes('Could not')`, 20000);
      assert.ok(!(await x.evaluate(toastText)).includes('Could not read'), await x.evaluate(toastText));
      const lists = second.events.filter((e) => e.kind === 3 && e.pubkey === x.me);
      assert.equal(lists.length, 1, 'the list did not reach the relay that answered');
      assert.deepEqual(lists[0].tags, [['p', x.bea]]);
    } finally { second.close(); }
  });
});

test('but not with a relay that connected and never answered', opts, async (t) => {
  await withExtension(t, async (x) => {
    const quiet = await startRelay({ delayMs: 120000 });
    try {
      await withRelays(x, [quiet.url, await deadUrl()]);
      await openCard(x);
      await x.waitFor(ready(0), 15000);
      await x.evaluate(`${BTN(0)}.click()`);
      await x.waitFor(`${toastText}.includes('Could not read your follow list')`, 25000);
      assert.equal(x.relay.events.filter((e) => e.kind === 3 && e.pubkey === x.me).length, 0);
      assert.equal(quiet.events.filter((e) => e.kind === 3).length, 0);
    } finally { quiet.close(); }
  });
});
