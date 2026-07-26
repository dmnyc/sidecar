// Sidecar — zap-request correlation for auto-approved zaps (isolated module).
//
// "Auto-approve zaps" is a spending gate: under it, a site's payment goes out with no
// prompt at all. So the test for "is this really a zap?" has to be one an unfriendly
// site cannot satisfy on its own.
//
// The old test asked whether the invoice's description was a kind:9734 zap request.
// It never once fired. NIP-57 step 6 has the lnurl server issue a description HASH
// invoice — "the description is this zap request note and this note only" — so the
// request is committed to, never carried. The description field is empty on every
// spec-compliant zap, and the check always returned false. The setting did nothing.
//
// Matching that hash isn't a fix. It's computed over the exact JSON the client posted
// to the lnurl callback, and Sidecar hands back a signed event which the client then
// re-serializes in whatever key order it pleases. Sidecar cannot know those bytes, and
// a check that silently fails closed forever is worse than no check.
//
// So bind to what Sidecar does know: it SIGNED the kind:9734, seconds earlier. A
// payment qualifies only if it matches a zap request this user authorized through
// Sidecar — same site, same account, same amount to the millisat, inside a short
// window, redeemable exactly once. That is strictly stronger than what it replaces:
// the old inline check could be satisfied by any site that pasted a real-looking 9734
// into a description it wrote itself, with nothing tying it to the user at all.
//
// Records live in chrome.storage.session: a worker restart between signing and paying
// must not quietly switch auto-zap off, and they never belong on disk.
//
// Isolated (like relax-grants.js / replaceable-baseline.js) so it can be unit-tested
// directly against a chrome mock — see test/zap-requests.test.js.

(function () {
  'use strict';

  const STORAGE_KEY = 'sidecar_pending_zaps';
  // Generous enough for a slow lnurl round trip, short enough that a stale approval
  // can't be spent much later. The zap flow itself is seconds.
  const TTL_MS = 180000;

  const now = () => Date.now();

  function read() {
    return new Promise((resolve) =>
      chrome.storage.session.get(STORAGE_KEY, (got) => {
        void chrome.runtime.lastError;
        const list = got && got[STORAGE_KEY];
        resolve(Array.isArray(list) ? list : []);
      })
    );
  }

  function write(list) {
    return new Promise((resolve) =>
      chrome.storage.session.set({ [STORAGE_KEY]: list }, () => {
        void chrome.runtime.lastError;
        resolve();
      })
    );
  }

  const fresh = (list, t) => list.filter((z) => z && t - z.ts <= TTL_MS);

  // Remember a zap request we just signed, so the payment that follows can be tied
  // back to it. Anything we can't bind tightly is skipped rather than stored loosely —
  // the cost of skipping is a prompt, which is the safe direction.
  async function record(host, pubkey, ev) {
    if (!host || !pubkey) return false;
    if (!ev || ev.kind !== 9734 || !Array.isArray(ev.tags)) return false;
    const tag = ev.tags.find((t) => Array.isArray(t) && t[0] === 'amount');
    const msat = tag ? Number(tag[1]) : 0;
    // NIP-57 makes `amount` optional. A record that would match ANY amount is not a
    // safeguard, so decline to store one and let the payment prompt normally.
    if (!Number.isFinite(msat) || msat <= 0) return false;
    const t = now();
    const list = fresh(await read(), t);
    list.push({ host, pubkey, msat, ts: t });
    await write(list);
    return true;
  }

  // Claim the zap request behind this payment, if there is one. Single-use: one signed
  // request authorizes exactly one payment, so a site cannot replay a single approval
  // across a run of invoices.
  async function claim(host, pubkey, sats) {
    if (!host || !pubkey) return false;
    if (sats == null || !Number.isFinite(sats)) return false;
    const t = now();
    const msat = Math.round(sats * 1000);
    const list = await read();
    const i = list.findIndex(
      (z) =>
        z &&
        z.host === host &&
        z.pubkey === pubkey &&
        z.msat === msat &&
        t - z.ts <= TTL_MS
    );
    if (i < 0) return false;
    list.splice(i, 1);
    await write(fresh(list, t));
    return true;
  }

  // Drop everything — used on lock, so a locked keystore leaves no spendable approvals.
  async function clear() {
    await write([]);
  }

  async function pending() {
    return fresh(await read(), now());
  }

  const api = { STORAGE_KEY, TTL_MS, record, claim, clear, pending };
  if (typeof self !== 'undefined') self.SidecarZapRequests = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarZapRequests = api;
})();
