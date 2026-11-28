'use strict';

// YOUR PAST REACTIONS SHOW IN THE BELL, against the real extension. The bell asks the relays
// which notes in it you have reacted to, and it asked only the relays in Sidecar's settings.
// Your reactions go to your write relays, from your relay list (NIP-65), wherever they were
// sent from, so where the two differed every reaction from before this session was missing.
//
// Here relay A is the one in Sidecar's settings, and your relay list names B as your write
// relay. One reaction is on each: both must show.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startExtension, CHROME, sleep, _internals } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 180000 };

const chips = (x, text) => x.evaluate(`(() => {
  const r = [...document.querySelectorAll('#modal .notif-item')].find((r) => r.textContent.includes(${JSON.stringify(text)}));
  const c = r && r.querySelector('.notif-reacted');
  return r ? (c && !c.classList.contains('hidden') ? c.textContent : '') : null;
})()`);

// A certificate for a relay served over TLS under a public-looking name. Bea's relay is on
// this machine, but a relay on this machine named in someone else's list is one the panel
// will not connect to (see relay-policy.js, isPrivateAddress), and Bea's relay out in the
// world is a wss:// server with a name. So it is served as one: wss://bea-reads.test.
function makeCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=bea-reads.test'], { stdio: 'ignore' });
  const cert = { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) };
  fs.rmSync(dir, { recursive: true, force: true });
  return cert;
}

test('YOUR PAST REACTIONS AND ZAPS SHOW ON THEIR NOTES, wherever they were sent from', opts, async (t) => {
  let x;
  const c = await _internals.startRelay({ tls: makeCert() }); // Bea reads here
  const cUrl = 'wss://bea-reads.test/';
  try { x = await startExtension({ chromeArgs: ['--ignore-certificate-errors', '--host-resolver-rules=MAP bea-reads.test 127.0.0.1:' + c.port] }); } catch (e) { c.close(); if (e.skip) return t.skip(e.message); throw e; }
  const b = await _internals.startRelay();
  try {
    const nt = _internals.nostrTools();
    const now = Math.floor(Date.now() / 1000);
    x.put({ kind: 3, created_at: now - 9000, tags: [['p', x.bea], ['p', x.cal]], content: '' }, 'me');
    x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Bea' }) }, 'bea');
    x.put({ kind: 10002, created_at: now - 9000, tags: [['r', cUrl, 'read']], content: '' }, 'bea');
    x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Cal' }) }, 'cal');
    x.put({ kind: 10002, created_at: now - 9000, tags: [['r', x.relay.url, 'read'], ['r', b.url, 'write']], content: '' }, 'me');
    const mine = x.put({ kind: 1, created_at: now - 7200, tags: [], content: 'A note of mine' }, 'me');
    const fromBea = x.put({ kind: 1, created_at: now - 600, tags: [['e', mine.id, '', 'root'], ['p', x.me]], content: 'Reply from Bea' }, 'bea');
    const fromCal = x.put({ kind: 1, created_at: now - 500, tags: [['e', mine.id, '', 'root'], ['p', x.me]], content: 'Reply from Cal' }, 'cal');
    // Sent from another client, to your write relay only.
    b.events.push(nt.sign({ kind: 7, created_at: now - 300, tags: [['e', fromBea.id], ['p', x.bea]], content: '🔥' }, 'me'));
    // And one on the panel's own relay, which was found before and must still be.
    x.put({ kind: 7, created_at: now - 200, tags: [['e', fromCal.id], ['p', x.cal]], content: '🎉' }, 'me');
    // A zap of yours on Bea's reply, sent from another client: its receipt is on the relay
    // Bea reads, which neither you nor Sidecar name. And a zap of Cal's reply by someone
    // else, which is not yours and lights nothing.
    const receipt = (noteId, author, by) => nt.sign({ kind: 9735, created_at: now - 100, tags: [['e', noteId], ['p', author],
      ['description', JSON.stringify(nt.sign({ kind: 9734, created_at: now - 101, tags: [['e', noteId], ['p', author], ['amount', '21000']], content: '' }, by))]], content: '' }, 'cal');
    c.events.push(receipt(fromBea.id, x.bea, 'me'));
    x.relay.events.push(receipt(fromCal.id, x.cal, 'bea'));
    await x.reload();

    let seen = null;
    for (let i = 0; i < 20; i++) {
      await x.evaluate(`document.getElementById('notif-bell-btn').click()`);
      await sleep(1500);
      if ((await chips(x, 'Reply from Bea')) !== null && (await chips(x, 'Reply from Cal')) !== null) {
        await x.waitFor(`[...document.querySelectorAll('#modal .notif-reacted:not(.hidden)')].length === 2`, 12000).catch(() => {});
        seen = { bea: await chips(x, 'Reply from Bea'), cal: await chips(x, 'Reply from Cal') };
        break;
      }
      await x.evaluate(`(() => { const m = document.querySelector('#modal .modal-x'); if (m) m.click(); })()`);
      await sleep(800);
    }
    assert.deepEqual(seen, { bea: '🔥', cal: '🎉' }, 'a reaction of yours is missing from the bell');
    // The heart is lit where you reacted, and the bolt where you zapped.
    await x.waitFor(`!!document.querySelector('#modal .notif-act.zapped')`, 12000).catch(() => {});
    const lit = await x.evaluate(`[...document.querySelectorAll('#modal .notif-item')].filter((r) => /Reply from (Bea|Cal)/.test(r.textContent)).map((r) => ({
      who: r.textContent.match(/Reply from (Bea|Cal)/)[1],
      heart: !!r.querySelector('.notif-act.reacted'),
      bolt: !!r.querySelector('.notif-act.zapped'),
      sats: (r.querySelector('.notif-act.zapped .zap-amt') || {}).textContent || null,
    })).sort((p, q) => p.who.localeCompare(q.who))`);
    assert.deepEqual(lit, [{ who: 'Bea', heart: true, bolt: true, sats: '21' }, { who: 'Cal', heart: true, bolt: false, sats: null }],
      'a past reaction or zap of yours is not shown on its note, or someone else’s zap is taken for yours');
    // The form's line says how much too, though the bolt was lit before the form was built.
    const hint = await x.evaluate(`(() => {
      const row = [...document.querySelectorAll('#modal .notif-item')].find((r) => r.textContent.includes('Reply from Bea'));
      row.querySelector('.notif-act[data-zap-note]').click();
      const h = row.querySelector('.notif-zap .zap-done-hint');
      return h && !h.classList.contains('hidden') ? h.textContent : null;
    })()`);
    assert.equal(hint, 'You zapped this 21 sats');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); b.close(); c.close(); }
});
