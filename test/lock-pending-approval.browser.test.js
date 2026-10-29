'use strict';

// #556 in a real browser: the extension loaded unpacked, a page asking through
// window.nostr, and the popup and panel cards clicked the way a person clicks them.
// The unit tests in lock-pending-approval.test.js run each half on its own; this runs
// the whole path, which is where the bug lived: a card opened while unlocked, the idle
// lock fired before it was answered, and Approve failed the sign with "Keystore is
// locked". A request queued behind that card failed the same way.
//
// The lock is lockKeystore(true), the call the auto-lock alarm makes, so the test does
// not wait out a timer. Needs Playwright with its Chromium; without them it skips.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const EXT = path.join(__dirname, '..');
const PIN = 'correct-horse-9';
const OPTS = { timeout: 90000 };

let chromium = null;
let skip = false;
try {
  ({ chromium } = require('playwright'));
} catch (_) {
  skip = 'Playwright is not installed';
}

async function withBrowser(fn, { login = true } = {}) {
  const site = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>client</title>'); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-lock-'));
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(userDir, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
  } catch (e) {
    site.close();
    fs.rmSync(userDir, { recursive: true, force: true });
    if (/Executable doesn't exist/i.test(e.message)) return 'skip';
    throw e;
  }
  try {
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
    const extId = new URL(sw.url()).host;
    await sw.evaluate(async (pin) => {
      await KS.initialize(pin);
      await KS.generateAccount('Tester');
    }, PIN);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${site.address().port}/`);
    const h = {
      ctx, sw, extId, page,
      // Start a window.nostr call without awaiting it; the handle reads how it ended.
      async call(expr) {
        const id = 'c' + Math.random().toString(36).slice(2);
        await page.evaluate(([expr, id]) => {
          window.__r = window.__r || {};
          window.__r[id] = { state: 'pending' };
          (0, eval)(expr).then(
            (v) => { window.__r[id] = { state: 'ok', v }; },
            (e) => { window.__r[id] = { state: 'err', e: String((e && e.message) || e) }; });
        }, [expr, id]);
        return async () => {
          for (let i = 0; i < 100; i++) {
            const r = await page.evaluate((id) => window.__r[id], id);
            if (r.state !== 'pending') return r;
            await page.waitForTimeout(100);
          }
          return { state: 'pending' };
        };
      },
      async popup() {
        for (let i = 0; i < 100; i++) {
          const p = ctx.pages().find((x) => x.url().includes('prompt.html') && !x.isClosed());
          if (p) { await p.waitForSelector('#allow:not([disabled])'); return p; }
          await page.waitForTimeout(100);
        }
        throw new Error('no approval popup opened');
      },
      async popupGone() {
        for (let i = 0; i < 50; i++) {
          if (!ctx.pages().some((x) => x.url().includes('prompt.html') && !x.isClosed())) return;
          await page.waitForTimeout(100);
        }
      },
      idleLock: () => sw.evaluate(() => lockKeystore(true)),
    };
    // Sign the page in, so the cards below are signing cards on a connected site.
    if (login) {
      const done = await h.call('window.nostr.getPublicKey()');
      await (await h.popup()).click('#allow');
      assert.equal((await done()).state, 'ok', 'login');
      await h.popupGone();
    }
    await fn(h);
  } finally {
    await ctx.close();
    site.close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
}

const signNote = (content) =>
  `window.nostr.signEvent({ kind: 1, content: ${JSON.stringify(content)}, tags: [], created_at: Math.floor(Date.now() / 1000) })`;
const hidden = (p, sel) => p.evaluate((sel) => document.querySelector(sel).classList.contains('hidden'), sel);

test('popup: a card the idle lock catches asks for the PIN, and it and the request behind it sign', OPTS, async (t) => {
  if (skip) return t.skip(skip);
  const ran = await withBrowser(async (h) => {
    const first = await h.call(signNote('first'));
    const second = await h.call(signNote('second')); // waits behind the first card
    const card = await h.popup();
    assert.equal(await hidden(card, '#unlock'), true, 'queued while unlocked, so no PIN field yet');

    await h.idleLock();
    await card.waitForSelector('#unlock:not(.hidden)', { timeout: 5000 });

    await card.fill('#pin', PIN);
    await card.click('#allow');
    const r1 = await first();
    assert.equal(r1.state, 'ok', 'first sign: ' + (r1.e || r1.state));

    // The request that waited behind it was re-marked too; the keystore is unlocked by
    // now, so its card goes straight to Approve.
    const next = await h.popup();
    await next.click('#allow');
    const r2 = await second();
    assert.equal(r2.state, 'ok', 'second sign: ' + (r2.e || r2.state));
  });
  if (ran === 'skip') t.skip('Playwright has no Chromium installed');
});

test('panel: a batch card the idle lock catches asks for the PIN, and Allow all signs both', OPTS, async (t) => {
  if (skip) return t.skip(skip);
  const ran = await withBrowser(async (h) => {
    // The panel page in a tab of the same window stands in for the side panel: it
    // connects the same port, so the worker hands it the cards.
    const panel = await h.ctx.newPage();
    await panel.goto(`chrome-extension://${h.extId}/sidepanel.html`);
    await panel.waitForSelector('#view-main:not(.hidden), #view-lock:not(.hidden)');
    await h.page.bringToFront();

    const first = await h.call(signNote('first'));
    const second = await h.call(signNote('second')); // same kind, so one "Allow all (2)" card
    await panel.waitForSelector('#view-approval:not(.hidden)');
    await panel.waitForFunction(() => /2/.test(document.getElementById('approval-allow').textContent));
    assert.equal(await hidden(panel, '#approval-unlock'), true, 'queued while unlocked, so no PIN field yet');

    await h.idleLock();
    await panel.waitForSelector('#approval-unlock:not(.hidden)', { timeout: 5000 });

    await panel.fill('#approval-pin', PIN);
    await panel.click('#approval-allow');
    for (const [name, r] of [['first', await first()], ['second', await second()]]) {
      assert.equal(r.state, 'ok', name + ' sign: ' + (r.e || r.state));
    }
  });
  if (ran === 'skip') t.skip('Playwright has no Chromium installed');
});

test('popup: a login card the idle lock catches stays PIN-less and still answers', OPTS, async (t) => {
  if (skip) return t.skip(skip);
  const ran = await withBrowser(async (h) => {
    // The site's first login, so the card is a real getPublicKey card.
    const login = await h.call('window.nostr.getPublicKey()');
    const card = await h.popup();
    assert.equal(await hidden(card, '#unlock'), true);

    await h.idleLock();
    // Give the card time to hear the lock and ask the worker; it must not grow a PIN field.
    await card.waitForTimeout(1500);
    assert.equal(await hidden(card, '#unlock'), true, 'answering getPublicKey never touches the keystore');

    await card.click('#allow');
    const r = await login();
    assert.equal(r.state, 'ok', 'login: ' + (r.e || r.state));
    assert.match(r.v, /^[0-9a-f]{64}$/);
  }, { login: false });
  if (ran === 'skip') t.skip('Playwright has no Chromium installed');
});
