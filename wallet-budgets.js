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

  // True if `sats` can be paid from the current budget without a prompt.
  async function covers(pubkey, host, sats) {
    const rec = await getBudget(pubkey, host);
    if (!rec || rec.budgetSats <= 0) return false;
    if (rec.perPaymentSats > 0 && sats > rec.perPaymentSats) return false;
    return rec.remainingSats >= sats;
  }

  // Decrement the remaining balance after a successful payment.
  async function consume(pubkey, host, sats) {
    const rootMap = await loadRoot();
    const rec = rootMap[pubkey] && rootMap[pubkey][host];
    if (!rec) return;
    applyReset(rec, Date.now());
    rec.remainingSats = Math.max(0, rec.remainingSats - Math.floor(sats || 0));
    await set({ [KEY]: rootMap });
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

  root.SidecarBudgets = { getBudget, setBudget, covers, consume, revoke, getAll, clearAccount };
})(typeof self !== 'undefined' ? self : this);
