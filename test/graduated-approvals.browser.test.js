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
