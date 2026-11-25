'use strict';

// A ZAP FROM THE BELL RUNS IN THE BACKGROUND, against the real extension. The payment bar
// used to start only once the lightning address had written an invoice. Until then the row
// sat locked on "Sending…", nothing in the bar said a zap was under way, and a failure was
// written into a form that leaving the bell had already thrown away. Now the bar takes the
// zap on the press, the form steps aside, and the next zap can go out beside it.
//
// The lightning addresses are the panel's own fetch, answered here: one that never answers,
// one that refuses. The wallet is a connection nobody answers, so a payment that reaches it
// stays in flight.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 180000 };

async function setUp(x, callbacks) {
  const now = Math.floor(Date.now() / 1000);
  // Bea and Cal are in your network, so their replies sit in the bell's main list.
  x.put({ kind: 3, created_at: now - 9000, tags: [['p', x.bea], ['p', x.cal]], content: '' }, 'me');
  x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Bea', lud16: 'bea@zap.test' }) }, 'bea');
  x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Cal', lud16: 'cal@zap.test' }) }, 'cal');
  const mine = x.put({ kind: 1, created_at: now - 7200, tags: [], content: 'A note of mine' }, 'me');
  x.put({ kind: 1, created_at: now - 600, tags: [['e', mine.id, '', 'root'], ['p', x.me]], content: 'Reply from Bea' }, 'bea');
  x.put({ kind: 1, created_at: now - 500, tags: [['e', mine.id, '', 'root'], ['p', x.me]], content: 'Reply from Cal' }, 'cal');
  await x.reload();
  await x.message({ type: 'SIDECAR_SET_NWC', pubkey: x.me, connection: 'nostr+walletconnect://' + 'ab'.repeat(32) + '?relay=' + encodeURIComponent(x.relay.url) + '&secret=' + 'cd'.repeat(32) });
  // The panel's fetch, for the two addresses only. `callbacks` says what each invoice
  // request does: 'hang' never answers, 'refuse' answers with an LNURL error.
  await x.evaluate(`(() => {
    const real = window.fetch.bind(window);
    const how = ${JSON.stringify(callbacks)};
    const json = (o) => Promise.resolve(new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } }));
    window.fetch = (url, init) => {
      const u = new URL(String(url));
      if (u.hostname !== 'zap.test') return real(url, init);
      const m = u.pathname.match(/^\\/\\.well-known\\/lnurlp\\/(\\w+)$/);
      if (m) return json({ tag: 'payRequest', callback: 'https://zap.test/cb/' + m[1], minSendable: 1000, maxSendable: 1e9,
        metadata: '[["text/plain","zap"]]', allowsNostr: true, nostrPubkey: '${'e'.repeat(64)}' });
      const who = u.pathname.split('/').pop();
      if (how[who] === 'refuse') return json({ status: 'ERROR', reason: 'No route to ' + who });
      if (how[who] === 'hang') return new Promise((res, rej) => init && init.signal && init.signal.addEventListener('abort', () => rej(init.signal.reason)));
      return json({ pr: 'lnbc210n1' + 'q'.repeat(200) });
    };
  })()`);
  // Open the bell until both replies are in it.
  for (let i = 0; i < 20; i++) {
    await x.evaluate(`document.getElementById('notif-bell-btn').click()`);
    await sleep(1200);
    if (await x.evaluate(`[...document.querySelectorAll('#modal .notif-item')].filter((r) => /Reply from (Bea|Cal)/.test(r.textContent)).length === 2`)) return;
    await x.evaluate(`(() => { const b = document.querySelector('#modal .modal-x'); if (b) b.click(); })()`);
    await sleep(800);
  }
  throw new Error('the bell never showed both replies');
}

// Open a reply's zap form, wait for its address, pick 21 and press Send zap.
const zap = (x, name) => x.evaluate(`(async () => {
  const row = [...document.querySelectorAll('#modal .notif-item')].find((r) => r.textContent.includes('Reply from ${name}'));
  row.querySelector('.notif-act[aria-label="Zap"]').click();
  const form = row.querySelector('.notif-zap');
  const send = () => form.querySelector('.zap-inline button.primary');
  for (let i = 0; i < 100 && (!send() || send().disabled); i++) await new Promise((r) => setTimeout(r, 100));
  if (!send() || send().disabled) return 'the address never answered';
  const amount = form.querySelector('.zap-inline input');
  amount.value = '21';
  amount.dispatchEvent(new Event('input', { bubbles: true }));
  send().click();
  return 'sent';
})()`);

const bar = (x) => x.evaluate(`(() => {
  const b = document.getElementById('payment-status');
  const row = (name) => [...document.querySelectorAll('#modal .notif-item')].find((r) => r.textContent.includes('Reply from ' + name));
  const form = (name) => { const r = row(name); const f = r && r.querySelector('.notif-zap'); return f ? !f.classList.contains('hidden') : null; };
  return {
    shown: !b.classList.contains('hidden'),
    line: document.getElementById('payment-status-line').textContent,
    sub: document.getElementById('payment-status-sub').textContent,
    count: document.getElementById('payment-status-count').classList.contains('hidden') ? '' : document.getElementById('payment-status-count').textContent,
    beaForm: form('Bea'),
    calForm: form('Cal'),
  };
})()`);

test('a zap whose address has not answered is in the bar at once, and another zap goes out beside it', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await setUp(x, { bea: 'hang', cal: 'ok' });
    assert.equal(await zap(x, 'Bea'), 'sent');
    await sleep(400);
    const first = await bar(x);
    assert.equal(first.shown, true, 'nothing in the bar while the address has not answered');
    assert.equal(first.line, 'Zapping 21 sats');
    assert.equal(first.beaForm, false, 'the zap form stays up, locked, while the zap is under way');
    // And it can be seen from the bell, which covers the whole panel: the sheet stops at
    // the bar's top edge, so what is drawn at the bar's middle is the bar.
    const seen = await x.evaluate(`(() => {
      const b = document.getElementById('payment-status').getBoundingClientRect();
      const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const sheet = document.querySelector('#modal').getBoundingClientRect();
      return { bar: !!(at && at.closest('#payment-status')), sheetAbove: sheet.bottom <= b.top + 1, open: document.documentElement.classList.contains('modal-open') };
    })()`);
    assert.deepEqual(seen, { bar: true, sheetAbove: true, open: true }, 'the bell covers the bar');
    if (process.env.ZAP_SHOTS) await x.screenshot(process.env.ZAP_SHOTS + '/bell-zapping.png');

    // Bea's address still has not answered. Cal's zap goes out anyway, and both are in the air.
    assert.equal(await zap(x, 'Cal'), 'sent');
    await sleep(800);
    const both = await bar(x);
    assert.equal(both.calForm, false);
    assert.equal(both.count, '2 in flight', 'the second zap did not join the first');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('a refusal from the address reaches the bar after the bell is closed', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await setUp(x, { bea: 'refuse' });
    assert.equal(await zap(x, 'Bea'), 'sent');
    // Leave the bell straight away, before the address answers.
    await x.evaluate(`document.querySelector('#modal .modal-x').click()`);
    const failed = await x.waitFor(`(() => { const s = document.getElementById('payment-status-sub'); return !document.getElementById('payment-status').classList.contains('hidden') && s.textContent; })()`, 8000)
      .then(() => bar(x)).catch(() => bar(x));
    assert.equal(failed.shown, true, 'the failure went into a form nobody can see');
    assert.equal(failed.line, 'Payment failed');
    assert.equal(failed.sub, 'No route to bea');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('a zap that fails while another is still in the air says so', opts, async (t) => {
  // The bar draws the flights while there are any, so a failure beside a zap still under
  // way had nowhere to show. It toasts.
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await setUp(x, { bea: 'hang', cal: 'refuse' });
    assert.equal(await zap(x, 'Bea'), 'sent');
    assert.equal(await zap(x, 'Cal'), 'sent');
    const toast = await x.waitFor(`[...document.querySelectorAll('#toasts .toast-error')].map((el) => el.textContent).find((s) => /No route to cal/.test(s))`, 8000)
      .then(() => true).catch(() => false);
    assert.equal(toast, true, 'the failure beside a zap in flight was shown nowhere');
    assert.equal((await bar(x)).line, 'Zapping 21 sats', 'Bea’s zap is still the one in the bar');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

// Whether what is drawn at the middle of `sel` is `sel`, so not under the sheet.
const inSight = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  const b = el.getBoundingClientRect();
  const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return !!(at && at.closest(${JSON.stringify(sel)}));
})()`;

test('with the relax bar up too, both bars stay in sight under the bell, and its +N list opens over the sheet', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await setUp(x, { bea: 'hang' });
    // Two relax windows, so the bar shows one and a +1 for the other.
    const grants = {
      ['one.example|' + x.me]: { exp: Date.now() + 600000, dur: 600000 },
      ['two.example|' + x.me]: { exp: Date.now() + 900000, dur: 900000 },
    };
    await x.evaluate(`new Promise((r) => chrome.storage.session.set({ sidecar_relax_grants: ${JSON.stringify(grants)} }, r))`);
    await x.waitFor(`!document.getElementById('relax-status').classList.contains('hidden') && !document.getElementById('relax-status-more').classList.contains('hidden')`, 8000);
    assert.equal(await zap(x, 'Bea'), 'sent');
    await sleep(500);
    assert.equal(await x.evaluate(inSight('#payment-status')), true, 'the zap bar is covered');
    assert.equal(await x.evaluate(inSight('#relax-status-more')), true, 'the relax bar is covered');
    if (process.env.ZAP_SHOTS) await x.screenshot(process.env.ZAP_SHOTS + '/bell-zapping-relax-closed.png');
    await x.evaluate(`document.getElementById('relax-status-more').click()`);
    await sleep(300);
    assert.equal(await x.evaluate(inSight('#relax-status-list')), true, 'the +N list opened behind the sheet');
    if (process.env.ZAP_SHOTS) await x.screenshot(process.env.ZAP_SHOTS + '/bell-zapping-relax.png');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('with no zap, the relax timer and a mine still stay in sight under the bell', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await setUp(x, {});
    const grants = { ['one.example|' + x.me]: { exp: Date.now() + 600000, dur: 600000 } };
    await x.evaluate(`new Promise((r) => chrome.storage.session.set({ sidecar_relax_grants: ${JSON.stringify(grants)} }, r))`);
    await x.waitFor(`!document.getElementById('relax-status').classList.contains('hidden')`, 8000);
    await sleep(300);
    assert.equal(await x.evaluate(`document.getElementById('payment-status').classList.contains('hidden')`), true, 'no zap in this one');
    assert.equal(await x.evaluate(inSight('#relax-status-end')), true, 'the bell covers the relax timer');
    if (process.env.ZAP_SHOTS) await x.screenshot(process.env.ZAP_SHOTS + '/bell-relax-only.png');
    // A mine's bar, shown by hand (starting a real one takes a post and minutes of work):
    // the sheet moves up to the highest bar, so both are in sight.
    // Shown by hand (with the lift a real mine gives the compose button), nothing redraws it, so the timer's redraw re-measures here instead
    // (a real mine's redraw calls the same measure). A changed window redraws the timer.
    await x.evaluate(`document.getElementById('mining-status').classList.remove('hidden'); document.getElementById('view-main').classList.add('mining-active')`);
    grants['one.example|' + x.me].exp += 1000;
    await x.evaluate(`new Promise((r) => chrome.storage.session.set({ sidecar_relax_grants: ${JSON.stringify(grants)} }, r))`);
    await sleep(600);
    assert.equal(await x.evaluate(inSight('#mining-status-stop')), true, 'the bell covers the mining bar');
    assert.equal(await x.evaluate(inSight('#relax-status-end')), true);
    const sheetAbove = await x.evaluate(`document.querySelector('#modal').getBoundingClientRect().bottom <= document.getElementById('mining-status').getBoundingClientRect().top + 1`);
    assert.equal(sheetAbove, true, 'the sheet runs over the mining bar');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
