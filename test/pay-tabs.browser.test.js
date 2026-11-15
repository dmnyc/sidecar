'use strict';

// A profile that can be paid two ways shows a Lightning / CLINK switch and one panel under
// it. Before the switch, Pay offer was a second button under the zap form: pressing it
// swapped one near-identical form for another, and nothing said which route the next press
// would take. A test that reads the source cannot tell whether the click does anything, so
// this one runs the real openProfileSheet, lifted out of sidepanel.js, in a real Chrome with
// the real styles.css, composer-core.js and clink.js, and clicks.
//
// The rest of the panel (the service worker, relays, the wallet) is faked: every name the
// lifted code reaches for that is not given here answers with an inert stand-in, and the
// few it really needs (a wallet that says yes, a cached profile) are written out below.
//
// Needs a Chrome or Chromium binary (CHROME_PATH, or one of the usual places); without one
// it skips, like the other browser tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.PAY_TABS_ROOT || path.join(__dirname, '..');
const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const CHROME = candidates.find((p) => fs.existsSync(p)) || null;

const SRC = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
function lift(decl) {
  const at = SRC.indexOf(decl);
  if (at < 0) throw new Error('moved: ' + decl);
  const open = SRC.indexOf('{', SRC.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    if (SRC[i] === '}' && --depth === 0) return SRC.slice(at, i + 1);
  }
  throw new Error('unbalanced: ' + decl);
}
const LIFTED = ['async function openProfileSheet(', 'function profileOffer(', 'function boltIcon(', 'function truncMid(',
  'function npubChip(', 'function satsInput(', 'function zapPresetRow(', 'function largeSendGate(', 'function shortNpub(',
  'function zapDefaultSaver(', 'function wireTabSlider('];
const NAMES = ['openProfileSheet', 'profileOffer', 'boltIcon', 'truncMid', 'npubChip', 'satsInput', 'zapPresetRow',
  'largeSendGate', 'shortNpub', 'zapDefaultSaver', 'wireTabSlider'];

const ACTIVE = '5'.repeat(64);
const THEM = 'd'.repeat(64);
const OFFER = 'noffer1qqstuyxnzxvp0s0waz4r4uhwsfknyqrgt8qqnl3wstz8hfeaawtdkzcpz4mhxue69uhhyetvv9ujucm0d9hx7uewd9hsyzm6v9c97er9vesh2mr5qvqsye76mm7';

function page(scenario) {
  const code = LIFTED.map(lift).join('\n');
  return `<!doctype html><html data-theme="speakeasy"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${ROOT}/fonts.css"><link rel="stylesheet" href="file://${ROOT}/styles.css">
<link rel="stylesheet" href="file://${ROOT}/themes/speakeasy.css"><link rel="stylesheet" href="file://${ROOT}/themes/patterns.css">
</head><body style="width:360px;margin:0">
<div id="modal-overlay" class="modal-overlay hidden"><div class="modal" id="modal"></div></div>
<script src="file://${ROOT}/i18n.js"></script><script src="file://${ROOT}/composer-core.js"></script><script src="file://${ROOT}/clink.js"></script>
<script>
const S = ${JSON.stringify(scenario)};
const stub = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : (k === Symbol.toPrimitive ? () => '' : stub)), apply: () => stub, construct: () => stub });
const core = window.SidecarCore;
const fill = (s) => [document.createTextNode(String(s))];
const state = { activePubkey: S.self ? '${THEM}' : '${ACTIVE}', accounts: [{ pubkey: '${ACTIVE}' }, { pubkey: '${THEM}' }] };
const content = { name: 'Them' };
if (S.address) content.lud16 = 'them@example.com';
if (S.offer) content.noffer = '${OFFER}';
const real = {
  h: core.h, icon: core.icon, t: (s) => s, tSec: (s) => s, tn: (a, b, n) => (n === 1 ? a : b),
  state, I18N: { fmtNum: (n) => String(n), fill },
  NT: { nip19: { npubEncode: () => 'npub1' + 'q'.repeat(58) }, nip57: { makeZapRequest: () => ({ kind: 9734, tags: [] }) } },
  clink: window.SidecarCLINK,
  call: async (m) => (m.type === 'SIDECAR_HAS_NWC' ? { has: !!S.wallet } : {}),
  openModal: (fn) => { const m = document.getElementById('modal'); m.innerHTML = ''; fn(m); m.classList.add('is-open'); document.getElementById('modal-overlay').classList.remove('hidden'); return m; },
  closeModal: () => {}, lnAddressParams: async () => ({ zappable: true }),
  _profileCache: new Map([['${THEM}', { content, created_at: 1 }]]),
  trustTier: () => 0, cacheProfile: () => {}, toast: () => {}, ensureNwc: async () => ({ payInvoice: async () => {} }),
  isFollowing: async () => false, getFollowCount: async () => 5, fetchStatus: async () => null, verifyNip05: async () => ({}),
  personActions: () => { const s = document.createElement('span'); s.setFollowing = () => {}; return s; },
  copyPlain: async () => {}, avatarEl: () => document.createElement('span'), applyAvatar: () => {}, setWaiting: (e) => e,
  preferredClient: async () => ({ label: 'x', profile: () => '' }), readRelayUrls: async () => [], relayUrls: async () => [],
  renderAbout: () => {}, fmtSats: (n) => String(n), LARGE_SEND_SATS: 1e8, LARGE_SEND_WINDOW_MS: 5000,
  getFollowList: async () => [], getNip65: async () => [], poolGetProfile: async () => null, followsYou: async () => false,
  inNetwork: () => false, setStreamZapBolt: () => {}, closeSearch: () => {},
};
const LIFTED = new Set(${JSON.stringify(NAMES)});
const scope = new Proxy({}, {
  has: (t, k) => typeof k === 'string' && !LIFTED.has(k) && (k in real || !(k in globalThis)),
  get: (t, k) => (typeof k === 'symbol' ? undefined : (k in real ? real[k] : stub)), set: () => true,
});
const run = new Function('scope', 'with(scope){' + ${JSON.stringify(code)} + '\\n return { openProfileSheet };}');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const shown = (el) => !!el && !el.classList.contains('hidden');
const look = () => ({
  tabsVisible: shown(q('.peek-pay-tabs')),
  active: [...document.querySelectorAll('.peek-pay-tabs .modal-tab')].filter((t) => t.classList.contains('active')).map((t) => t.textContent),
  labels: [...document.querySelectorAll('.peek-pay-tabs .modal-tab')].map((t) => t.textContent),
  // [zap form showing, offer form showing]. The zap form is the one with a message field; the offer
  // form is only built the first time it is wanted, so it is absent (not hidden) until then.
  forms: [
    [...document.querySelectorAll('.peek-zap-form')].some((f) => f.querySelector('.status-input') && !f.classList.contains('hidden')),
    [...document.querySelectorAll('.peek-zap-form')].some((f) => !f.querySelector('.status-input') && !f.classList.contains('hidden')),
  ],
  qr: !!q('.peek-zap-pay:not(.hidden)'),
  areaOpen: shown(q('.peek-zap')),
  button: (q('.peek-zap-form:not(.hidden) button.primary') || {}).textContent || null,
  note: (q('.zap-pay-note') || {}).textContent || null,
});
(async () => {
  const { openProfileSheet } = run(scope);
  openProfileSheet('${THEM}', S.zapSheet ? { zap: true } : {});
  await wait(300);
  const out = { initial: look() };
  const bolt = q('.peek-bolt');
  if (!S.zapSheet) { bolt.click(); await wait(150); }
  out.opened = look();
  const tabs = [...document.querySelectorAll('.peek-pay-tabs .modal-tab')];
  if (S.clickClink) { tabs[1].click(); await wait(250); out.clink = look(); tabs[0].click(); await wait(150); out.back = look(); }
  if (!S.zapSheet) {
    bolt.click(); await wait(100); out.closed = look();
    bolt.click(); await wait(150); out.reopened = look();
    if (S.clickClink) { tabs[1].click(); await wait(250); bolt.click(); await wait(100); bolt.click(); await wait(250); out.reopenedOnClink = look(); }
  }
  const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify(out); document.body.append(pre);
})().catch((e) => { const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify({ error: String(e && e.stack || e) }); document.body.append(pre); });
</script></body></html>`;
}

function measure(scenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-paytabs-'));
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, page(scenario));
  try {
    const r = spawnSync(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
      `--user-data-dir=${path.join(dir, 'profile')}`, '--virtual-time-budget=6000', '--window-size=420,900',
      '--dump-dom', `file://${file}`,
    ], { encoding: 'utf8', timeout: 60000 });
    const m = /<pre id="result">([\s\S]*?)<\/pre>/.exec(r.stdout || '');
    assert.ok(m, 'Chrome did not report: ' + (r.stderr || '').slice(0, 300));
    const out = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    assert.ok(!out.error, out.error);
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

test('two ways to pay: a Lightning / CLINK switch, one panel under it, and the bolt reopens where you were', opts, () => {
  const r = measure({ address: true, offer: true, wallet: true, clickClink: true });
  assert.equal(r.initial.areaOpen, false, 'the area waits for the bolt');
  assert.deepEqual(r.opened.labels, ['Lightning', 'CLINK']);
  assert.equal(r.opened.tabsVisible, true);
  assert.deepEqual(r.opened.active, ['Lightning']);
  assert.deepEqual(r.opened.forms, [true, false], 'the zap form shows, the offer form does not');
  assert.equal(r.opened.button, 'Send zap');
  // Pressing CLINK opens the offer's own form, with its own button, and puts the zap form away.
  assert.deepEqual(r.clink.active, ['CLINK']);
  assert.deepEqual(r.clink.forms, [false, true]);
  assert.equal(r.clink.button, 'Pay offer');
  // And back, without toggling anything shut.
  assert.deepEqual(r.back.active, ['Lightning']);
  assert.deepEqual(r.back.forms, [true, false]);
  // The bolt closes the area and reopens it.
  assert.equal(r.closed.areaOpen, false);
  assert.deepEqual(r.closed.forms, [false, false]);
  assert.equal(r.reopened.areaOpen, true);
  // On the route you left it on.
  assert.deepEqual(r.reopenedOnClink.active, ['CLINK']);
  assert.deepEqual(r.reopenedOnClink.forms, [false, true]);
});

test('an offer and no address: the bolt opens the offer directly, and there is no switch', opts, () => {
  const r = measure({ offer: true, wallet: true });
  assert.equal(r.opened.tabsVisible, false);
  assert.equal(r.opened.areaOpen, true);
  assert.equal(r.opened.button, 'Pay offer');
});

test('an address and no offer: the zap form, and no switch', opts, () => {
  const r = measure({ address: true, wallet: true });
  assert.equal(r.opened.tabsVisible, false);
  assert.equal(r.opened.button, 'Send zap');
});

test('another account you hold is payable, and only your active profile is the handoff', opts, () => {
  const other = measure({ address: true, offer: true, wallet: true });
  assert.equal(other.opened.button, 'Send zap', 'a second account in the keystore gets the real form');
  assert.equal(other.opened.qr, false);
  const self = measure({ address: true, offer: true, wallet: true, self: true });
  assert.equal(self.opened.button, null, 'your own active profile has no send form');
  assert.equal(self.opened.qr, true);
  assert.equal(self.opened.note, 'Sending is off on your own profile.');
  assert.equal(self.opened.tabsVisible, true, 'both handoffs are still reachable');
});

test('the stream zap sheet: Lightning opens with the switch, and an offer alone opens itself', opts, () => {
  const both = measure({ address: true, offer: true, wallet: true, zapSheet: true });
  assert.equal(both.opened.tabsVisible, true);
  assert.deepEqual(both.opened.active, ['Lightning']);
  assert.deepEqual(both.opened.forms, [true, false]);
  const offerOnly = measure({ offer: true, wallet: true, zapSheet: true });
  assert.equal(offerOnly.opened.tabsVisible, false);
  assert.equal(offerOnly.opened.areaOpen, true, 'there is no bolt on this sheet to open it');
  assert.equal(offerOnly.opened.button, 'Pay offer');
});
