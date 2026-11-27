'use strict';

// Rebuild network, from the bell. A thin network sorts nearly everything outside it, and the
// bell then looks empty with the fix three screens away in Settings. With nothing from your
// network and someone from outside it, the bell says so above the collapsed group and offers
// Rebuild network. Otherwise it sits small at the foot, under Load more or under the empty
// state. Pressing it rebuilds the set and reopens the bell.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

test('a bell with nothing from your network offers Rebuild network at the top, once', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    const now = Math.floor(Date.now() / 1000);
    // You follow Bea; Bea follows nobody. Cal, whom no one follows, reacts to your note. A
    // reaction, not a reply: a reply that reads as a person's is lifted into the list by the
    // spam check (nspam.test.js), and this is about a bell with nothing in it but strangers.
    x.put({ kind: 3, created_at: now - 9000, tags: [['p', x.bea]], content: '' }, 'me');
    x.put({ kind: 3, created_at: now - 9000, tags: [], content: '' }, 'bea');
    x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Cal' }) }, 'cal');
    const mine = x.put({ kind: 1, created_at: now - 7200, tags: [], content: 'A note of mine' }, 'me');
    x.put({ kind: 7, created_at: now - 600, tags: [['e', mine.id], ['p', x.me], ['k', '1']], content: '+' }, 'cal');
    await x.reload();

    // The network is built in the background; open the bell until it has sorted Cal out.
    let sorted = false;
    for (let i = 0; i < 20 && !sorted; i++) {
      await x.evaluate(`document.getElementById('notif-bell-btn').click()`);
      await sleep(1200);
      sorted = await x.evaluate(`!!document.querySelector('#modal .notif-offnet')`);
      if (!sorted) { await x.evaluate(`(() => { const b = document.querySelector('#modal .modal-x'); if (b) b.click(); })()`); await sleep(800); }
    }
    assert.ok(sorted, 'the bell never sorted the stranger outside the network');

    const thin = await x.evaluate(`(() => { const p = document.querySelector('#modal .notif-thin'); return p && { text: p.textContent, btn: !!p.querySelector('.notif-rebuild') }; })()`);
    assert.ok(thin, 'no line says nothing came from your network');
    assert.match(thin.text, /^Your network: 2 people\.Nothing from your network here\. If that looks wrong, rebuild it\./);
    assert.ok(thin.btn, 'the line has no Rebuild network button');

    // Offered once: the foot stays away while the line at the top already has the button.
    assert.equal(await x.evaluate(`document.querySelectorAll('#modal .notif-rebuild').length`), 1);

    await x.evaluate(`document.querySelector('#modal .notif-thin .notif-rebuild').click()`);
    await x.waitFor(`!!document.querySelector('#modal .notif-offnet')`, 20000);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('an empty bell keeps Rebuild network at its foot, under the empty state', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    const now = Math.floor(Date.now() / 1000);
    x.put({ kind: 3, created_at: now - 9000, tags: [['p', x.bea]], content: '' }, 'me');
    x.put({ kind: 3, created_at: now - 9000, tags: [], content: '' }, 'bea');
    await x.reload();
    let foot = null;
    for (let i = 0; i < 20 && !foot; i++) {
      await x.evaluate(`document.getElementById('notif-bell-btn').click()`);
      await sleep(1200);
      foot = await x.evaluate(`(() => { const f = document.querySelector('#modal .notif-rebuild-foot'); return f && f.textContent; })()`);
      if (!foot) { await x.evaluate(`(() => { const b = document.querySelector('#modal .modal-x'); if (b) b.click(); })()`); await sleep(800); }
    }
    assert.equal(foot, 'Your network: 2 people.Missing someone? Rebuild network', 'the foot names the size of the network it is sorting by');
    assert.ok(await x.evaluate(`!!document.querySelector('#modal .notif-rebuild-foot br + .notif-keep .notif-rebuild')`), 'the question and its button are not on their own line together');
    assert.ok(await x.evaluate(`(() => { const f = document.querySelector('#modal .notif-rebuild-foot'); const e = f && f.previousElementSibling; return !!e && /show up here/.test(e.textContent); })()`), 'the foot is not under the empty state');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
