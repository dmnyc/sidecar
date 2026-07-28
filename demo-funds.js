'use strict';

// Sidecar — demo wallet data, for local development ONLY.
//
// Populates the wallet card and transaction list with plausible, recent-looking
// activity so the wallet UI can be worked on (and screenshotted) without a funded
// NWC connection. It exists because an empty wallet renders almost none of the
// interesting states: no balance to denominate, no rows to expand, no incoming glow.
//
// This module fabricates numbers that look like money, which makes it the single
// most dangerous thing in the codebase if it ever reaches a user. Every guard here
// is deliberate:
//
//   1. GATED ON A DEV BUILD, AT READ TIME. isOn() resolves false unless the caller
//      passes a true dev flag. Storing the flag isn't enough on its own — a profile
//      carried from a dev machine, or a key written by some future bug, must not be
//      able to switch this on in a store build.
//   2. SESSION STORAGE ONLY. chrome.storage.session never touches disk and dies with
//      the browser session, so the flag can't outlive the run that set it.
//   3. CLEARED ON LOCK. background.js's lockKeystore() drops the key, so unlocking
//      always starts from real data.
//   4. PAYMENTS ARE REFUSED, NOT FAKED. A demo balance shown over a real connected
//      wallet is a lie the user could act on. wrap() lets reads be fictional but
//      makes payInvoice/makeInvoice throw, so nothing can move real sats while the
//      displayed balance is invented.
//
// Deliberately NOT wired into the background's WebLN payment path: demo mode is a
// panel display concern, and the fewer places that know about it, the fewer places
// can leak it.
//
// This file DOES ship in store builds, inert. Stripping it in scripts/package.sh
// was considered and rejected: both sidepanel.html's <script> tag and background.js's
// importScripts() would then have to tolerate its absence, which trades an
// already-guarded inert code path for a load-order fragility that only manifests in
// the release build — the one place a mistake is expensive. ~6 KB of dead code is
// the cheaper risk. The guards above are what keeps it dead.

(function (root) {
  const KEY = 'sidecar_demo_funds';

  // Not a round number. A real balance is whatever's left after arbitrary payments,
  // and 847,320 read as invented at a glance.
  const DEMO_BALANCE_MSAT = 412_905_000; // 412,905 sats

  // A fortnight of plausible activity, as offsets from "now" rather than fixed dates,
  // so the list still reads as recent however long after writing this it's opened.
  //
  // Two things make wallet history look real, and the first version had neither:
  //
  //   - Amounts split by KIND. Zaps really are round — 21, 210, 1000, 2100 are the
  //     amounts people actually tap — but anything denominated in fiat or tied to an
  //     order lands on an arbitrary number like 12,206. All-round amounts read as
  //     generated; all-irregular reads as noise.
  //   - Most rows have NO description. txRow falls back to "Received"/"Sent", which
  //     is what a real NWC list mostly looks like: a bare zap carries no memo, and
  //     only invoices and lightning-address sends bring text with them.
  //
  // Descriptions that ARE here are the shapes Sidecar renders in the wild: a
  // lightning address for an outgoing payment (real wallets put it in the memo when
  // there's no payMeta entry), a short zap comment, an order reference. No
  // "Channel open" — that isn't a thing NWC reports.
  //
  // NAMES AND DOMAINS ARE INVENTED, DELIBERATELY. These rows get screenshotted for
  // the store listings, and an earlier version used real handles at real providers
  // (getalby.com, walletofsatoshi.com, primal.net, zbd.gg). That put other people's
  // services — and in one case a real person's name — into Sidecar's marketing, and
  // pointed anyone who read a screenshot closely at addresses that aren't ours to
  // publish. The counterparties are now writers from Gatsby's own decade, at
  // sidecar.top, which we control.
  const TEMPLATE = [
    { type: 'incoming', sats: 210,   ago: 6 * 60,      desc: '' },
    { type: 'incoming', sats: 1000,  ago: 41 * 60,     desc: '🍸' },
    { type: 'outgoing', sats: 210,   ago: 2 * 3600,    desc: 'zelda@sidecar.top', fee: 1 },
    { type: 'incoming', sats: 21,    ago: 3 * 3600,    desc: '' },
    { type: 'outgoing', sats: 5000,  ago: 8 * 3600,    desc: 'ernest@sidecar.top', fee: 3 },
    { type: 'incoming', sats: 12206, ago: 19 * 3600,   desc: 'Invoice — manuscript edit' },
    { type: 'outgoing', sats: 2100,  ago: 26 * 3600,   desc: 'dorothy@sidecar.top', fee: 2 },
    { type: 'incoming', sats: 500,   ago: 2 * 86400,   desc: 'for the last chapter' },
    { type: 'outgoing', sats: 47893, ago: 3 * 86400,   desc: 'Order 4471', fee: 41 },
    { type: 'incoming', sats: 21000, ago: 4 * 86400,   desc: '' },
    { type: 'outgoing', sats: 100,   ago: 6 * 86400,   desc: 'langston@sidecar.top', fee: 1 },
    { type: 'incoming', sats: 3847,  ago: 9 * 86400,   desc: '' },
  ];

  // Deterministic pseudo-random hex. Math.random() would make every render differ,
  // which turns a screenshot diff into noise, but the arithmetic pattern the first
  // version produced ("de00ad001357…") read as obviously synthetic in the expanded
  // detail view. A small LCG gives hex that looks like hex.
  //
  // The 'de' prefix survives on purpose: a hash here should still be identifiable as
  // fabricated by anyone who looks closely.
  function fakeHex(len, i, tag) {
    let seed = (i + 1) * 2654435761 + tag.charCodeAt(0) * 40503;
    let out = 'de';
    while (out.length < len) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      out += ((seed >>> 16) & 0xff).toString(16).padStart(2, '0');
    }
    return out.slice(0, len);
  }

  /** Build the demo transaction list, timestamped relative to `nowMs`. */
  function buildTransactions(nowMs) {
    const nowSec = Math.floor(nowMs / 1000);
    return TEMPLATE.map((t, i) => {
      const settled = nowSec - t.ago;
      return {
        type: t.type,
        // NWC reports msats; the panel divides by 1000 to display sats.
        amount: t.sats * 1000,
        fees_paid: t.type === 'outgoing' ? (t.fee || 0) * 1000 : 0,
        description: t.desc,
        // Unix SECONDS, matching what a real NWC wallet returns.
        created_at: settled - 2,
        settled_at: settled,
        payment_hash: fakeHex(64, i, 'ad'),
        preimage: fakeHex(64, i, 'be'),
        // A recognizable stub rather than a well-formed bolt11: anything that parsed
        // as a real invoice could be copied out and acted on.
        invoice: 'lnbcDEMO' + fakeHex(20, i, 'cf'),
      };
    });
  }

  function buildBalance() {
    return { balance: DEMO_BALANCE_MSAT };
  }

  // ---- flag storage -------------------------------------------------------------

  function sessionArea() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) return chrome.storage.session;
    } catch (_) {}
    return null;
  }

  /**
   * Is demo mode active? `isDev` MUST be the caller's dev-build determination.
   * Fails closed: no dev flag, no storage, or any error → false.
   */
  async function isOn(isDev) {
    if (isDev !== true) return false; // strict: an undefined/truthy-ish value is not a dev build
    const area = sessionArea();
    if (!area) return false;
    try {
      const got = await area.get(KEY);
      return got && got[KEY] === true;
    } catch (_) { return false; }
  }

  /** Turn demo mode on or off. Refuses to turn ON unless `isDev` is exactly true. */
  async function setOn(on, isDev) {
    const area = sessionArea();
    if (!area) return false;
    if (on === true && isDev !== true) return false;
    try {
      if (on === true) await area.set({ [KEY]: true });
      else await area.remove(KEY);
      return true;
    } catch (_) { return false; }
  }

  /** Drop the flag unconditionally. Called from lockKeystore(). */
  async function clear() {
    const area = sessionArea();
    if (!area) return;
    try { await area.remove(KEY); } catch (_) {}
  }

  // ---- client decorator ---------------------------------------------------------

  /**
   * Wrap an NWC client so reads return demo data. Every other method passes through
   * unchanged EXCEPT the two that move money, which throw — a fabricated balance
   * over a real wallet is otherwise something the user could act on.
   *
   * `client` may be null: demo mode is useful precisely when no wallet is connected,
   * so a null client still yields demo reads.
   */
  function wrap(client, nowFn) {
    const now = typeof nowFn === 'function' ? nowFn : () => Date.now();
    const refuse = (what) => () => {
      const err = new Error('Demo funds are on — ' + what + ' is disabled. Turn it off in Settings › Developer.');
      err.demoBlocked = true;
      return Promise.reject(err);
    };
    const base = client || {};
    return {
      // Reads: fiction.
      getBalance: () => Promise.resolve(buildBalance()),
      listTransactions: (args) => {
        const all = buildTransactions(now());
        const limit = (args && args.limit) || all.length;
        const offset = (args && args.offset) || 0;
        return Promise.resolve({ transactions: all.slice(offset, offset + limit) });
      },
      getInfo: () => Promise.resolve(
        typeof base.getInfo === 'function'
          ? { alias: 'Demo wallet', methods: ['get_balance', 'list_transactions'] }
          : { alias: 'Demo wallet' }
      ),
      // Writes: refused, loudly.
      payInvoice: refuse('paying an invoice'),
      makeInvoice: refuse('creating an invoice'),
      // Everything else behaves as it did, so subscriptions and teardown still work.
      lookupInvoice: (...a) => (base.lookupInvoice ? base.lookupInvoice(...a) : Promise.reject(new Error('no wallet'))),
      subscribeNotifications: (...a) => (base.subscribeNotifications ? base.subscribeNotifications(...a) : () => {}),
      close: (...a) => (base.close ? base.close(...a) : undefined),
      isDemo: true,
    };
  }

  root.SidecarDemoFunds = { KEY, isOn, setOn, clear, wrap, buildTransactions, buildBalance, DEMO_BALANCE_MSAT };
})(typeof self !== 'undefined' ? self : globalThis);
