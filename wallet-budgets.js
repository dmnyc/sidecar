// Sidecar WebLN spending budgets — per-ACCOUNT, per-site payment allowances.
//
// Inspired by Alby's allowance model, adapted for NWC + Sidecar's per-site
// account binding. A site that has a budget can pay without a prompt until the
// running balance runs out (or a single payment exceeds the per-payment cap);
// then the next sendPayment prompts again. Budgets refill on a daily window.
//
// Storage: sidecar_wallet_budgets = { <pubkey>: { <host>: {
//   budgetSats,        // total per window (0 = always prompt)
//   remainingSats,     // left in the current window
//   perPaymentSats,    // max single payment without a prompt (0 = no cap)
//   resetAt,           // ms timestamp when the window refills
//   updatedAt
// } } }

(function (root) {
  'use strict';

  const KEY = 'sidecar_wallet_budgets';
  const DAY_MS = 24 * 60 * 60 * 1000;

  function get(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }
  function set(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }
  async function loadRoot() {
    return (await get(KEY))[KEY] || {};
  }

  // Apply the daily refill if the window has elapsed. Mutates `rec` in place and
  // returns whether anything changed (so callers can persist).
  function applyReset(rec, now) {
    if (rec.budgetSats > 0 && rec.resetAt && now >= rec.resetAt) {
      rec.remainingSats = rec.budgetSats;
      rec.resetAt = now + DAY_MS;
      return true;
    }
    return false;
  }

  async function getBudget(pubkey, host) {
    const rootMap = await loadRoot();
    const rec = rootMap[pubkey] && rootMap[pubkey][host];
    if (!rec) return null;
    const now = Date.now();
    if (applyReset(rec, now)) await set({ [KEY]: rootMap });
    return rec;
  }

  // Create/replace a site's budget. Resets the remaining balance and window.
  async function setBudget(pubkey, host, { budgetSats, perPaymentSats }) {
    const rootMap = await loadRoot();
    if (!rootMap[pubkey]) rootMap[pubkey] = {};
    const now = Date.now();
    rootMap[pubkey][host] = {
      budgetSats: Math.max(0, Math.floor(budgetSats || 0)),
      remainingSats: Math.max(0, Math.floor(budgetSats || 0)),
      perPaymentSats: Math.max(0, Math.floor(perPaymentSats || 0)),
      resetAt: now + DAY_MS,
      updatedAt: now,
    };
    await set({ [KEY]: rootMap });
    return rootMap[pubkey][host];
  }

  // A payable amount: a positive whole number of sats, and nothing else.
  //
  // covers() used to answer `remainingSats >= sats`, which says YES to zero and to
  // negatives — so a 0-sat payment was covered by an exhausted budget, and consume(-5)
  // computed `remaining - Math.floor(-5)` and GREW the allowance by five. Neither was
  // reachable from a BOLT11 invoice (invoiceSats returns null or a positive), so this
  // sat harmless until window.webln.keysend arrived and took its amount straight from
  // the page. The entry point validates too; this is the floor under it, because a
  // spending limit should not depend on every caller having checked first.
  const payable = (sats) => Number.isFinite(sats) && Math.floor(sats) === sats && sats > 0;

  // Serialize every read-modify-write on the store.
  //
  // reserve/consume/refund are each a load, a mutate and a save with awaits in between,
  // so two overlapping calls both read the pre-debit balance and the second save wins —
  // a lost decrement. Payments used to be spaced far enough apart (a human clicking a
  // zap) that this never showed, but one Podcasting 2.0 boost fires a keysend per split
  // back to back, which is precisely the interleaving that loses one. A single chain
  // makes each of these atomic on its own, rather than only while some caller happens to
  // hold the payment lock.
  let queue = Promise.resolve();
  function serialized(fn) {
    const run = queue.then(fn, fn);
    queue = run.then(() => {}, () => {});
    return run;
  }

  // True if `sats` can be paid from the current budget without a prompt. Read-only —
  // use reserve() when the answer is about to authorize a spend.
  async function covers(pubkey, host, sats) {
    if (!payable(sats)) return false;
    const rec = await getBudget(pubkey, host);
    if (!rec || rec.budgetSats <= 0) return false;
    if (rec.perPaymentSats > 0 && sats > rec.perPaymentSats) return false;
    return rec.remainingSats >= sats;
  }

  // Check and debit in ONE step, before the money moves. Returns true if the budget
  // covered it (and has now been decremented), false if it did not (and nothing changed).
  //
  // covers()-then-pay-then-consume() is not safe for payments that arrive in a burst:
  // consume runs in the background's un-awaited bookkeeping tail, which lands AFTER the
  // payment lock has already released, so the next payment's covers() reads a balance
  // that has not been debited yet. Four splits of a boost against a budget with room for
  // two therefore all passed. Reserving up front closes that: the balance is spent before
  // the request goes out, and the only thing that can hand it back is a wallet that
  // explicitly refused (see refund).
  function reserve(pubkey, host, sats) {
    return serialized(async () => {
      if (!payable(sats)) return false;
      const rootMap = await loadRoot();
      const rec = rootMap[pubkey] && rootMap[pubkey][host];
      if (!rec || rec.budgetSats <= 0) return false;
      applyReset(rec, Date.now());
      if (rec.perPaymentSats > 0 && sats > rec.perPaymentSats) return false;
      if (rec.remainingSats < sats) return false;
      rec.remainingSats -= sats;
      await set({ [KEY]: rootMap });
      return true;
    });
  }

  // Put a reservation back. ONLY for a payment the wallet explicitly refused — that is
  // the single outcome proven to have left the money alone (see the rejection contract in
  // nwc-client.js). A timeout or a lost reply is indeterminate, and crediting the budget
  // back for a payment that may well have settled is how a site spends past its limit.
  function refund(pubkey, host, sats) {
    return serialized(async () => {
      if (!payable(sats)) return;
      const rootMap = await loadRoot();
      const rec = rootMap[pubkey] && rootMap[pubkey][host];
      if (!rec) return;
      rec.remainingSats = Math.min(rec.budgetSats, rec.remainingSats + sats);
      await set({ [KEY]: rootMap });
    });
  }

  // Decrement the remaining balance after a successful payment. Kept for the paths that
  // still pay first and account afterwards; reserve() is the safer order.
  function consume(pubkey, host, sats) {
    return serialized(async () => {
      if (!payable(sats)) return;
      const rootMap = await loadRoot();
      const rec = rootMap[pubkey] && rootMap[pubkey][host];
      if (!rec) return;
      applyReset(rec, Date.now());
      rec.remainingSats = Math.max(0, rec.remainingSats - sats);
      await set({ [KEY]: rootMap });
    });
  }

  async function revoke(pubkey, host) {
    const rootMap = await loadRoot();
    if (rootMap[pubkey]) delete rootMap[pubkey][host];
    await set({ [KEY]: rootMap });
    return rootMap[pubkey] || {};
  }

  // All budgets for an account (for the UI). Applies any pending resets.
  async function getAll(pubkey) {
    const rootMap = await loadRoot();
    const m = rootMap[pubkey] || {};
    let changed = false;
    const now = Date.now();
    for (const host of Object.keys(m)) if (applyReset(m[host], now)) changed = true;
    if (changed) await set({ [KEY]: rootMap });
    return m;
  }

  async function clearAccount(pubkey) {
    const rootMap = await loadRoot();
    delete rootMap[pubkey];
    await set({ [KEY]: rootMap });
  }

  root.SidecarBudgets = { getBudget, setBudget, covers, reserve, refund, consume, revoke, getAll, clearAccount };
})(typeof self !== 'undefined' ? self : this);
