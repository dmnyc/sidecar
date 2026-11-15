'use strict';

// A wallet that wakes a phone per request (Blitz) raises a lock-screen alert for every one,
// a balance read included. Sidecar polled get_balance every 30s whenever the panel was
// unlocked, so one open panel meant an alert every half minute. These run the real
// wakesByPush, startWalletMonitor and pinnedNeedsFetch, and assert the requests that go out.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const sidepanel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const nwcSource = fs.readFileSync(path.join(ROOT, 'nwc-client.js'), 'utf8');

function lift(pattern, label) {
  const m = sidepanel.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

// The wallet pubkey and secret are placeholders; the relay and the address are the real shape.
const BLITZ = 'nostr+walletconnect://' + 'a'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.getalbypro.com%2Fblitz&secret=' + 'b'.repeat(64) +
  '&lud16=someone-030e%40blitzwalletapp.com';
const ALBY = 'nostr+walletconnect://' + 'c'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.getalbypro.com&secret=' + 'd'.repeat(64);
const OTHER = 'nostr+walletconnect://' + 'e'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.example&secret=' + 'f'.repeat(64) + '&lud16=me%40coinos.io';

function loadNwc() {
  const ctx = { URL, URLSearchParams, console, setTimeout, clearTimeout, NostrTools: {} };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(nwcSource, ctx);
  return ctx.SidecarNWC;
}

test('a Blitz connection is recognised by its relay path or its Lightning address', () => {
  const { wakesByPush } = loadNwc();
  assert.equal(wakesByPush(BLITZ), true);
  assert.equal(wakesByPush(BLITZ.replace(/&lud16=.*$/, '')), true, 'the relay path alone is enough');
  assert.equal(wakesByPush(OTHER.replace(/&lud16=.*$/, '&lud16=a%40blitzwalletapp.com')), true,
    'so is the address alone');
});

test('other wallets are not mistaken for it', () => {
  const { wakesByPush } = loadNwc();
  assert.equal(wakesByPush(ALBY), false, 'the same relay host without the /blitz path');
  assert.equal(wakesByPush(OTHER), false);
  assert.equal(wakesByPush('wss://relay.getalbypro.com/blitzard'), false);
  for (const junk of ['', null, undefined, 'not a connection', 'nostr+walletconnect://x?relay=%%%']) {
    assert.equal(wakesByPush(junk), false, 'garbage must not throw: ' + junk);
  }
});

function monitorHarness({ visible = 'visible', activeTab = 'wallet', pinnedHidden = true } = {}) {
  const intervals = [];
  const refreshes = [];
  const ctx = {
    console,
    window: { SidecarNWC: loadNwc() },
    state: { locked: false },
    document: {
      visibilityState: visible,
      querySelector: () => ({ dataset: { tab: activeTab } }),
    },
    $: () => ({ classList: { contains: (c) => c === 'hidden' && pinnedHidden } }),
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval: () => {},
    refreshWalletBalance: () => refreshes.push('balance'),
    refreshTransactionList: () => {},
    toast: () => {}, t: (s) => s, fmtSats: String, msatToSat: Number,
    nwcNotifSub: null, nwcPollTimer: null,
  };
  vm.createContext(ctx);
  vm.runInContext(
    'var nwcQuiet = false;' +
    lift(/  function balanceOnScreen\(\)\s*\{[\s\S]*?\n  \}/, 'balanceOnScreen') + '\n' +
    'var NWC_POLL_MS = 60000;' +
    lift(/  function stopWalletMonitor\(\)\s*\{[\s\S]*?\n  \}/, 'stopWalletMonitor') + '\n' +
    lift(/  function startWalletMonitor\(client, connection\)\s*\{[\s\S]*?\n  \}\n/, 'startWalletMonitor') + '\n' +
    lift(/  function pinnedNeedsFetch\(cached, ts\)\s*\{[\s\S]*?\n  \}/, 'pinnedNeedsFetch') + '\n' +
    'globalThis.startWalletMonitor = startWalletMonitor; globalThis.pinnedNeedsFetch = pinnedNeedsFetch;',
    ctx
  );
  const client = { subscribeNotifications: () => ({ close() {} }) };
  return { ctx, intervals, refreshes, client };
}

test('a Blitz wallet gets no polling timer at all', () => {
  const h = monitorHarness();
  h.ctx.startWalletMonitor(h.client, BLITZ);
  assert.equal(h.intervals.length, 0, 'every tick was a lock-screen alert');
});

test('any other wallet polls once a minute, not twice', () => {
  const h = monitorHarness();
  h.ctx.startWalletMonitor(h.client, ALBY);
  assert.equal(h.intervals.length, 1);
  assert.equal(h.intervals[0].ms, 60000);
});

test('a tick refreshes only while a balance is on screen', () => {
  const tick = (opts) => {
    const h = monitorHarness(opts);
    h.ctx.startWalletMonitor(h.client, ALBY);
    h.intervals[0].fn();
    return h.refreshes.length;
  };
  assert.equal(tick({}), 1, 'the Wallet tab is open');
  assert.equal(tick({ activeTab: 'activity', pinnedHidden: false }), 1, 'the pinned bar is showing');
  assert.equal(tick({ activeTab: 'activity', pinnedHidden: true }), 0, 'nothing shows a balance');
  assert.equal(tick({ visible: 'hidden' }), 0, 'the panel is hidden');
});

test('a locked panel never polls', () => {
  const h = monitorHarness();
  h.ctx.startWalletMonitor(h.client, ALBY);
  h.ctx.state.locked = true;
  h.intervals[0].fn();
  assert.equal(h.refreshes.length, 0);
});

test('the pinned bar re-reads a minute-old figure, except for a push-woken wallet', () => {
  const old = Date.now() - 120000;
  const normal = monitorHarness();
  normal.ctx.startWalletMonitor(normal.client, ALBY);
  assert.equal(normal.ctx.pinnedNeedsFetch(true, old), true);
  assert.equal(normal.ctx.pinnedNeedsFetch(true, Date.now()), false);

  const quiet = monitorHarness();
  quiet.ctx.startWalletMonitor(quiet.client, BLITZ);
  assert.equal(quiet.ctx.pinnedNeedsFetch(true, old), false, 'an old number is still a number');
  assert.equal(quiet.ctx.pinnedNeedsFetch(false, null), true, 'but an empty bar is filled once');
});
