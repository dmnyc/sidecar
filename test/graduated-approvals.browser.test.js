'use strict';

// The graduated approval card against the REAL extension: a page signs reactions through
// window.nostr and the panel's cards are pressed the way a person presses them. Three plain
// cards (Sign, Reject, no Trust, no scope row); the fourth grows the "Always sign" row;
// pressing it signs and saves the grant; the fifth reaction signs with no card at all. A note
// in between proves the count is per kind, "Not now" proves the count starts over, and an
// encrypt card proves Trust is still where it belongs. The unit tests beside this one run
// each piece; this runs the path a click takes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 180000 };

const card = `(() => {
  const v = document.getElementById('view-approval');
  if (!v || v.classList.contains('hidden')) return null;
  const vis = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden') && !e.closest('.hidden'); };
  return {
    ask: document.getElementById('approval-ask').textContent,
    allow: document.getElementById('approval-allow').textContent.trim(),
    trust: vis('approval-trust'),
    graduated: vis('approval-graduated'),
    hint: vis('approval-relax-hint'),
    msg: document.getElementById('approval-graduated-msg').textContent,
    yes: document.getElementById('approval-graduated-yes').textContent,
    scopeRow: !!document.getElementById('approval-scope'),
  };
})()`;

async function withClient(t, fn) {
  const site = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>client</title><p>client'); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  let x;
  try { x = await startExtension(); } catch (e) { site.close(); if (e.skip) return t.skip(e.message); throw e; }
  try {
    const page = await x.openPage(`http://127.0.0.1:${site.address().port}/`);
    await page.evaluate('new Promise((r) => { const t = setInterval(() => { if (window.nostr) { clearInterval(t); r(true); } }, 50); })');
    // Start a window.nostr call without waiting; the handle reads how it ended.
    let n = 0;
    const call = async (expr) => {
      const id = 'c' + (++n);
      await page.evaluate(`(window.__r = window.__r || {}, window.__r.${id} = { state: 'pending' }, (${expr}).then((v) => { window.__r.${id} = { state: 'ok', v }; }, (e) => { window.__r.${id} = { state: 'err', e: String(e && e.message || e) }; }), true)`, { wait: false });
    };
    const result = async (id) => {
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        const r = await page.evaluate(`window.__r && window.__r.c${id}`);
        if (r && r.state !== 'pending') return r;
        await x.sleep(100);
      }
      return { state: 'pending' };
    };
    const cardUp = () => x.waitFor(card, 10000);
    const press = async (id) => {
      await x.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
      await x.waitFor(`document.getElementById('view-approval').classList.contains('hidden')`, 8000).catch(() => {});
    };
    const react = (i) => `window.nostr.signEvent({ kind: 7, content: '+', tags: [['e', '${String(i).padStart(64, '0')}']], created_at: Math.floor(Date.now() / 1000) })`;
    const note = (s) => `window.nostr.signEvent({ kind: 1, content: ${JSON.stringify(s)}, tags: [], created_at: Math.floor(Date.now() / 1000) })`;
    await fn({ x, page, call, result, cardUp, press, react, note, nextId: () => n + 1 });
  } finally {
    x.close();
    site.close();
  }
}

test('three plain cards, the fourth offers Always, granting it stops the fifth from asking', opts, async (t) => {
  await withClient(t, async ({ x, call, result, cardUp, press, react, note, nextId }) => {
    // Sign the page in. A login card keeps Trust.
    let id = nextId();
    await call('window.nostr.getPublicKey()');
    let c = await cardUp();
    assert.equal(c.trust, true, 'a login card offers Trust');
    assert.equal(c.hint, false, 'a login card offers the quiet hint');
    await press('approval-allow');
    assert.equal((await result(id)).state, 'ok', 'login');

    // Three reactions: plain cards, Sign and Reject only.
    for (let i = 1; i <= 3; i++) {
      id = nextId();
      await call(react(i));
      c = await cardUp();
      assert.equal(c.scopeRow, false, 'the scope row is gone');
      assert.equal(c.trust, false, 'reaction ' + i + ' offered Trust');
      assert.equal(c.graduated, false, 'reaction ' + i + ' offered to stop asking too early');
      assert.equal(c.hint, i >= 2, 'reaction ' + i + ' hint timing');
      assert.equal(c.allow, 'Sign');
      await press('approval-allow');
      assert.equal((await result(id)).state, 'ok', 'reaction ' + i);
    }

    // A note now: another kind, its own count, so no row.
    id = nextId();
    await call(note('hello'));
    c = await cardUp();
    assert.equal(c.graduated, false, 'a note borrowed the reactions\' count');
    await press('approval-allow');
    assert.equal((await result(id)).state, 'ok', 'note');

    // The fourth reaction earns the row.
    id = nextId();
    await call(react(4));
    c = await cardUp();
    assert.equal(c.graduated, true, 'the fourth reaction did not offer to stop asking');
    assert.match(c.msg, /3 times in a row\./);
    assert.equal(c.yes, 'Always sign');
    assert.equal(c.allow, 'Sign', 'the primary button still answers this one only');
    assert.equal(c.trust, false);
    await press('approval-graduated-yes');
    const r4 = await result(id);
    assert.equal(r4.state, 'ok', 'Always sign also signs this one: ' + (r4.e || ''));

    // The grant is saved, for this site and kind, where the Activity tab lists it.
    const grants = await x.message({ type: 'SIDECAR_GET_KIND_GRANTS' });
    assert.ok(grants.ok && grants.result.some((g) => g.kind === 7 && /^127\.0\.0\.1/.test(g.host)), 'no grant saved: ' + JSON.stringify(grants));

    // The fifth reaction signs with no card.
    id = nextId();
    await call(react(5));
    const r5 = await result(id);
    assert.equal(r5.state, 'ok', 'the fifth reaction: ' + (r5.e || r5.state));
    assert.equal(await x.evaluate(card), null, 'a card came up for a granted kind');

    // An encrypt card still offers Trust, and never the row.
    id = nextId();
    await call(`window.nostr.nip44.encrypt(${JSON.stringify(x.bea)}, 'hi')`);
    c = await cardUp();
    assert.equal(c.trust, true, 'an encrypt card lost Trust');
    assert.equal(c.graduated, false);
    assert.equal(c.hint, false, 'an encrypt card offered the quiet hint');
    assert.equal(c.allow, 'Allow once');
    await press('approval-reject');
    assert.equal((await result(id)).state, 'err');

    // Revoking the grant from the Activity row puts the reactions back to asking, and the
    // count starts again from zero (taking the offer settled it).
    await x.message({ type: 'SIDECAR_REMOVE_KIND_GRANT', host: grants.result.find((g) => g.kind === 7).host, kind: 7 });
    id = nextId();
    await call(react(6));
    c = await cardUp();
    assert.equal(c.graduated, false, 'the count did not start over after the grant');
    await press('approval-allow');
    assert.equal((await result(id)).state, 'ok');
  });
});

test('Not now hides the row and the count starts over', opts, async (t) => {
  await withClient(t, async ({ call, result, cardUp, press, note, nextId, x }) => {
    let id = nextId();
    await call('window.nostr.getPublicKey()');
    await cardUp();
    await press('approval-allow');
    await result(id);
    for (let i = 1; i <= 3; i++) {
      id = nextId();
      await call(note('n' + i));
      await cardUp();
      await press('approval-allow');
      assert.equal((await result(id)).state, 'ok');
    }
    id = nextId();
    await call(note('n4'));
    let c = await cardUp();
    assert.equal(c.graduated, true);
    await x.evaluate(`document.getElementById('approval-graduated-no').click()`);
    c = await x.evaluate(card);
    assert.equal(c.graduated, false, 'Not now left the row up');
    await press('approval-allow');
    assert.equal((await result(id)).state, 'ok');
    // Two more plain cards before it could come back.
    for (let i = 5; i <= 6; i++) {
      id = nextId();
      await call(note('n' + i));
      c = await cardUp();
      assert.equal(c.graduated, false, 'the row came back after Not now at note ' + i);
      await press('approval-allow');
      await result(id);
    }
  });
});

// ---- a host where two of your accounts are signed in ----

// Who the card names: the capsule, the account menu's rows (opened by the test), the quiet hint's
// words and the shared-identity note. Every name is read beside the npub it sits on, so a name
// wandering onto another identity's npub shows as a mismatched pair.
const who = `(() => {
  const cap = document.querySelector('#approval-account .approval-capsule');
  const menu = document.getElementById('approval-switch-menu');
  const hint = document.getElementById('approval-relax-hint');
  return {
    cap: cap && { name: cap.querySelector('.aa-label').textContent, npub: cap.querySelector('.aa-npub').textContent },
    menuOpen: !menu.classList.contains('hidden'),
    rows: [...menu.querySelectorAll('.acct-row')].map((b) => ({
      name: b.querySelector('.acct-row-name').textContent,
      npub: b.querySelector('.acct-row-npub').textContent,
      chosen: b.classList.contains('active'),
    })),
    hint: hint.classList.contains('hidden') ? null : hint.textContent,
    shared: !!document.getElementById('approval-shared-note'),
  };
})()`;

// Two accounts, both signed in on the client: `second` logs in first, then `first`, so the site
// ends bound to `first` with `first` active. Returns the npubs by name.
async function twoAccountsSignedIn({ x, call, result, cardUp, press, nextId }, { first, second }) {
  const add = await x.message({ type: 'SIDECAR_ADD_ACCOUNT', secret: '06'.repeat(32), name: 'Bea' });
  assert.ok(add && add.ok, 'adding Bea: ' + JSON.stringify(add));
  const st = (await x.message({ type: 'SIDECAR_GET_STATE' })).result;
  const pk = { Tester: x.me, Bea: x.bea };
  const npub = Object.fromEntries(st.accounts.map((a) => [a.name, a.npub]));
  for (const name of [second, first]) {
    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: pk[name] });
    const id = nextId();
    await call('window.nostr.getPublicKey()');
    await cardUp();
    await press('approval-allow');
    const r = await result(id);
    assert.equal(r.state, 'ok', 'login as ' + name);
    assert.equal(r.v, pk[name], 'logged in as the wrong account');
  }
  return { pk, npub, short: (name) => npub[name].slice(0, 14) };
}

const site = async (x) => {
  const b = await x.message({ type: 'SIDECAR_GET_SITE_BINDINGS' });
  return Object.entries(b.result || {}).find(([h]) => /^127\.0\.0\.1/.test(h));
};

test('picking an account on a shared card names it, and renames no one else', opts, async (t) => {
  await withClient(t, async (c) => {
    const { x, call, result, cardUp, press, note, nextId } = c;
    const { pk, short } = await twoAccountsSignedIn(c, { first: 'Tester', second: 'Bea' });
    const bound = await site(x);
    assert.equal(bound && bound[1], pk.Tester, 'the site is bound to Tester');

    // Each row's name must sit on its own npub: Tester on Tester's, Bea on Bea's.
    const named = (rows) => Object.fromEntries(rows.map((r) => [r.npub.slice(0, 14), r.name]));
    const openMenu = async () => {
      await x.evaluate(`document.getElementById('approval-switch-toggle').click()`);
      return x.waitFor(`(() => { const w = ${who}; return w.menuOpen && w.rows.length ? w : null; })()`, 5000);
    };

    // One note first, so the card under test is the kind's second ask and carries the quiet hint.
    let id = nextId();
    await call(note('first'));
    await cardUp();
    await press('approval-allow');
    const r1 = await result(id);
    assert.equal(r1.state, 'ok', 'first note: ' + (r1.e || ''));

    id = nextId();
    await call(note('picked'));
    await cardUp();
    let w = await x.evaluate(who);
    assert.equal(w.shared, true, 'not a shared-identity card');
    assert.deepEqual(w.cap, { name: 'Tester', npub: w.cap.npub }, 'the card opened as someone else');
    assert.equal(w.cap.npub.slice(0, 14), short('Tester'));
    assert.match(w.hint || '', /Keep signing as Tester\?/, 'the hint names the account the card opened as');

    w = await openMenu();
    assert.deepEqual(named(w.rows), { [short('Tester')]: 'Tester', [short('Bea')]: 'Bea' }, 'menu rows before the pick');

    // Pick Bea.
    await x.evaluate(`[...document.querySelectorAll('#approval-switch-menu .acct-row')].find((b) => b.querySelector('.acct-row-name').textContent === 'Bea').click()`);
    w = await x.evaluate(who);
    assert.equal(w.menuOpen, false, 'the menu stayed open after the pick');
    assert.equal(w.cap.name, 'Bea', 'the capsule does not show the picked account');
    assert.equal(w.cap.npub.slice(0, 14), short('Bea'), 'the capsule shows the picked name on another npub');
    assert.equal(w.hint, null, 'the hint is up for a pick: it offers a window the picked account never earned');

    // Reopened: every row still wears its own name (the bug: Tester's npub read "Bea").
    w = await openMenu();
    assert.deepEqual(named(w.rows), { [short('Tester')]: 'Tester', [short('Bea')]: 'Bea' }, 'a pick renamed another identity in the menu');
    assert.equal(w.rows.find((r) => r.chosen).name, 'Bea', 'the check is not on the picked row');
    // Close it again by the toggle, and sign.
    await x.evaluate(`document.getElementById('approval-switch-toggle').click()`);
    await press('approval-allow');
    const signed = await result(id);
    assert.equal(signed.state, 'ok', 'the picked sign: ' + (signed.e || ''));
    assert.equal(signed.v.pubkey, pk.Bea, 'signed as someone other than the pick');

    // A follow-up card from the same client: both names still on their own npubs.
    id = nextId();
    await call(note('after'));
    await cardUp();
    w = await x.evaluate(who);
    assert.equal(w.shared, true);
    // One-shot: the pick named the signer for that event only. The next card opens as the
    // account the user came in with, not the one they picked.
    assert.equal(w.cap.npub.slice(0, 14), short('Tester'), 'the pick stuck: the follow-up opened as Bea');
    const capName ={ [short('Tester')]: 'Tester', [short('Bea')]: 'Bea' }[w.cap.npub.slice(0, 14)];
    assert.equal(w.cap.name, capName, 'the follow-up capsule wears another identity\'s name');
    if (w.hint) assert.match(w.hint, new RegExp('Keep signing as ' + capName + '\\?'), 'the follow-up hint names someone else');
    w = await openMenu();
    assert.deepEqual(named(w.rows), { [short('Tester')]: 'Tester', [short('Bea')]: 'Bea' }, 'the follow-up menu cross-names the accounts');
    await x.evaluate(`document.getElementById('approval-switch-toggle').click()`);
    await press('approval-reject');
    assert.equal((await result(id)).state, 'err');
    assert.deepEqual(x.errors, [], 'the panel threw');
  });
});
