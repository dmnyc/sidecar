'use strict';

// UNFOLLOWING THE LAST PERSON YOU FOLLOW. The worker refuses to sign a follow list that ends up
// empty, since that is what a wipe after a bad read looks like, and the panel's unfollow had no
// way through it: the button went back and a toast said "Removes the 1 account you follow." An
// account that follows one person could never unfollow them. Against the REAL extension and its
// real guard: follow one person from their profile card, then unfollow them.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };
const BTN = `document.querySelectorAll('#modal .peek-person-actions .icon-btn')[0]`;
const label = `${BTN}.getAttribute('aria-label')`;
const toastText = `[...document.querySelectorAll('#toasts .toast')].map((e) => e.textContent).join(' | ')`;

test('an account that follows one person can unfollow them', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    const now = Math.floor(Date.now() / 1000);
    x.put({ kind: 0, created_at: now - 100, tags: [], content: JSON.stringify({ name: 'Me' }) }, 'me');
    x.put({ kind: 3, created_at: now - 100, tags: [], content: '' }, 'me');
    x.put({ kind: 0, created_at: now - 100, tags: [], content: JSON.stringify({ name: 'Bea' }) }, 'bea');
    await x.reload();
    await x.evaluate(`window.SidecarStreamChatAccount.profile(${JSON.stringify(x.bea)})`);
    await x.waitFor(`!!${BTN} && !${BTN}.disabled && !${BTN}.classList.contains('pending')`, 15000);
    await x.evaluate(`${BTN}.click()`);
    await x.waitFor(`${toastText}.includes('Followed')`, 15000);
    await sleep(500);
    await x.evaluate(`${BTN}.click()`);
    await x.waitFor(`${toastText}.includes('Unfollowed') || ${toastText}.includes('Removes')`, 15000);
    assert.ok(!(await x.evaluate(toastText)).includes('Removes'), 'the guard refused: ' + await x.evaluate(toastText));
    assert.equal(await x.evaluate(label), 'Follow');
    const lists = x.relay.events.filter((e) => e.kind === 3 && e.pubkey === x.me).sort((a, b) => b.created_at - a.created_at);
    assert.deepEqual(lists[0].tags, [], 'the newest list still has them');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
