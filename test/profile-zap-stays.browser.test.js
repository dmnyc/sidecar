'use strict';

// ZAPPING SOMEONE FROM THEIR PROFILE KEEPS YOU ON IT, against the real extension. The sheet
// used to close the moment Send zap was pressed, which threw you out of the profile you had
// searched for. Now the payment area folds back to how it was before the bolt was pressed,
// the bolt pulses while the zap is out, and it bursts when the zap lands.
//
// The lightning address is the panel's own fetch, answered here. The wallet is a pretend
// one in the panel page that holds the payment until the test lets it go.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 180000 };

// A pretend wallet in the panel page, holding each payment until __walletRelease().
async function pretendWallet(x) {
  return x.evaluate(`(() => {
    const NT = window.NostrTools;
    const sk = NT.generateSecretKey();
    const pk = NT.getPublicKey(sk);
    const held = [];
    const ws = new WebSocket(${JSON.stringify(x.relay.url)});
    const answer = async (req, result) => {
      const content = await NT.nip04.encrypt(sk, req.pubkey, JSON.stringify(result));
      const ev = NT.finalizeEvent({ kind: 23195, created_at: Math.floor(Date.now() / 1000), tags: [['e', req.id], ['p', req.pubkey]], content }, sk);
      ws.send(JSON.stringify(['EVENT', ev]));
    };
    ws.onopen = () => ws.send(JSON.stringify(['REQ', 'w', { kinds: [23194], '#p': [pk] }]));
    ws.onmessage = async (m) => {
      const msg = JSON.parse(m.data);
      if (msg[0] !== 'EVENT') return;
      const req = msg[2];
      const body = JSON.parse(await NT.nip04.decrypt(sk, req.pubkey, req.content));
      if (body.method === 'pay_invoice') held.push(req);
      else if (body.method === 'get_info') answer(req, { result_type: 'get_info', result: { methods: ['pay_invoice', 'get_balance', 'get_info'] } });
      else if (body.method === 'get_balance') answer(req, { result_type: 'get_balance', result: { balance: 1e9 } });
      else answer(req, { result_type: body.method, error: { code: 'NOT_IMPLEMENTED', message: 'no' } });
    };
    window.__walletHeld = () => held.length;
    window.__walletRelease = () => { while (held.length) answer(held.shift(), { result_type: 'pay_invoice', result: { preimage: '00'.repeat(32) } }); };
    const secret = Array.from(NT.generateSecretKey(), (b) => b.toString(16).padStart(2, '0')).join('');
    return 'nostr+walletconnect://' + pk + '?relay=' + encodeURIComponent(${JSON.stringify(x.relay.url)}) + '&secret=' + secret;
  })()`);
}

async function setUp(x, how) {
  const now = Math.floor(Date.now() / 1000);
  x.put({ kind: 3, created_at: now - 9000, tags: [['p', x.bea]], content: '' }, 'me');
  x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Bea', lud16: 'bea@zap.test' }) }, 'bea');
  await x.reload();
  const nwc = await pretendWallet(x);
  await x.message({ type: 'SIDECAR_SET_NWC', pubkey: x.me, connection: nwc });
  await x.evaluate(`(() => {
    const real = window.fetch.bind(window);
    const json = (o) => Promise.resolve(new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } }));
    window.fetch = (url, init) => {
      const u = new URL(String(url));
      if (u.hostname !== 'zap.test') return real(url, init);
      if (/lnurlp/.test(u.pathname)) return json({ tag: 'payRequest', callback: 'https://zap.test/cb/bea', minSendable: 1000, maxSendable: 1e9,
        metadata: '[["text/plain","zap"]]', allowsNostr: true, nostrPubkey: '${'e'.repeat(64)}' });
      return ${JSON.stringify(how)} === 'refuse' ? json({ status: 'ERROR', reason: 'No route to bea' }) : json({ pr: 'lnbc210n1' + 'q'.repeat(200) });
    };
  })()`);
  // Found by search, as you would: her name, and her row in the suggestions.
  await x.evaluate(`document.getElementById('search-btn').click()`);
  await sleep(300);
  await x.evaluate(`(() => { const i = document.getElementById('search-input'); i.value = 'Bea'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await x.waitFor(`[...document.querySelectorAll('#search-results .ac-item')].some((r) => /Bea/.test(r.textContent))`, 10000);
  await x.evaluate(`[...document.querySelectorAll('#search-results .ac-item')].find((r) => /Bea/.test(r.textContent)).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
  await x.waitFor(`!!document.querySelector('#modal .peek-bolt') && !document.querySelector('#modal .peek-bolt').disabled`, 15000);
}

// Open the bolt's form, pick 21, press Send zap.
const zap = (x) => x.evaluate(`(async () => {
  const bolt = document.querySelector('#modal .peek-bolt');
  const form = document.querySelector('#modal .peek-zap-form');
  if (form.classList.contains('hidden')) bolt.click();
  const amount = form.querySelector('.zap-inline input');
  amount.value = '21';
  amount.dispatchEvent(new Event('input', { bubbles: true }));
  form.querySelector('.zap-inline button.primary').click();
  return 'sent';
})()`);

const sheet = (x) => x.evaluate(`(() => {
  const m = document.getElementById('modal');
  const b = m.querySelector('.peek-bolt');
  const f = m.querySelector('.peek-zap-form');
  return {
    open: document.documentElement.classList.contains('modal-open') && !m.classList.contains('is-closing'),
    name: (m.textContent.match(/Bea/) || [''])[0],
    formShown: !!f && !f.classList.contains('hidden'),
    amount: f ? f.querySelector('.zap-inline input').value : null,
    zapping: !!b && b.classList.contains('zapping'), disabled: !!b && b.disabled,
    label: b ? b.getAttribute('aria-label') : null,
  };
})()`);

test('THE PROFILE STAYS while you zap its person, and folds back when the zap lands', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await setUp(x, 'ok');
    const before = await sheet(x);
    assert.equal(before.open, true);
    assert.equal(await zap(x), 'sent');
    await x.waitFor(`window.__walletHeld() === 1`, 15000);
    assert.deepEqual(await sheet(x), { open: true, name: 'Bea', formShown: false, amount: '', zapping: true, disabled: true, label: 'Zapping…' },
      'the profile closed, or did not say a zap was out');
    if (process.env.ZAP_SHOTS) await x.screenshot(process.env.ZAP_SHOTS + '/profile-zapping.png');
    // In front, so the burst's frames run (taking the picture brings the panel forward).
    await x.screenshot(require('node:path').join(require('node:os').tmpdir(), 'sidecar-profile-front.png'));
    await x.evaluate(`window.__walletRelease()`);
    await x.waitFor(`!document.querySelector('#modal .peek-bolt').classList.contains('zapping')`, 15000);
    const after = await sheet(x);
    assert.deepEqual(after, { open: true, name: 'Bea', formShown: false, amount: '', zapping: false, disabled: false, label: before.label },
      'the profile is not back as it was before the zap');
    assert.equal(await x.evaluate(`document.querySelectorAll('#modal .peek-bolt .zap-burst').length`), 1, 'no burst on the bolt');
    await sleep(1800);
    assert.equal(await x.evaluate(`document.querySelectorAll('.zap-burst').length`), 0, 'the burst stayed');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('a zap from a profile that fails puts the bolt back, with the amount kept for another try', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await setUp(x, 'refuse');
    const label = (await sheet(x)).label;
    assert.equal(await zap(x), 'sent');
    await x.waitFor(`/No route to bea/.test(document.getElementById('payment-status-sub').textContent)`, 10000);
    assert.deepEqual(await sheet(x), { open: true, name: 'Bea', formShown: false, amount: '21', zapping: false, disabled: false, label });
    assert.equal(await x.evaluate(`document.querySelectorAll('.zap-burst').length`), 0, 'a burst for a zap that failed');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
