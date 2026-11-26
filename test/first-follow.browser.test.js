'use strict';

// A NEW ACCOUNT FOLLOWS AND MUTES. An account made a minute ago has no follow list, no mute
// list and often no profile, so a read of its relays brings back nothing at all. That used to
// read as "the relays did not answer": the profile card's Follow button stayed dimmed for good,
// and a follow or a mute from anywhere failed with "Could not read your follow list". When every
// relay really answered with nothing, the first follow or mute starts the list. Against the REAL
// extension and a relay on localhost, with nothing published for the account beforehand.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME } = require('./helpers/real-extension');

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
