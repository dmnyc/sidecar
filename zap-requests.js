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

  // The one predicate claim/peek/recipientFor all match on. Factored so they cannot
  // drift: a lookup that matched more loosely than the claim would label a payment
  // with a request that was never going to authorize it.
  const matches = (z, host, pubkey, msat, t) =>
    !!z && z.host === host && z.pubkey === pubkey && z.msat === msat && t - z.ts <= TTL_MS;

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
    // WHO THE ZAP IS FOR, carried for labelling rather than for the gate. NIP-57 step 6
    // has the lnurl server issue a description_hash invoice, so the recipient is
    // committed to and never travels with the payment — the paying wallet has no idea
    // who it paid, and no amount of parsing the BOLT11 recovers it. Sidecar signed this
    // request seconds earlier and does know, so it is kept here and nowhere else.
    // It has no bearing on whether a payment is auto-approved; matching is still
    // host + account + exact amount + window, exactly as before.
    const p = ev.tags.find((t2) => Array.isArray(t2) && t2[0] === 'p' && t2[1]);
    const recipient = p ? String(p[1]) : '';
    const t = now();
    const list = fresh(await read(), t);
    list.push({ host, pubkey, msat, recipient, ts: t });
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
    const i = list.findIndex((z) => matches(z, host, pubkey, msat, t));
    if (i < 0) return false;
    list.splice(i, 1);
    await write(fresh(list, t));
    return true;
  }

  // Is there a request this payment would match? Same test as claim(), but it does
  // NOT consume: callers that only need to decide whether to offer/skip a UI must
  // leave the record intact for the payment itself to claim.
  async function peek(host, pubkey, sats) {
    if (!host || !pubkey) return false;
    if (sats == null || !Number.isFinite(sats)) return false;
    const t = now();
    const msat = Math.round(sats * 1000);
    return (await read()).some((z) => matches(z, host, pubkey, msat, t));
  }

  // The recipient of the zap request behind this payment, for labelling it afterwards.
  //
  // DELIBERATELY NOT A CLAIM. Consuming here would spend the single-use approval that
  // the auto-zap gate is about to need, turning every labeled zap into a prompted one —
  // the label is a caption, and a caption must not change what the payment does.
  // Consequently this stays true for the whole TTL, which is the right trade: it is read
  // once per payment, and nothing downstream is a permission.
  //
  // Same first-match rule as claim, so the two agree on which record a payment belongs
  // to. Two zaps of the SAME amount, from the SAME site, on the SAME account, inside the
  // window are indistinguishable here — they already are to the gate — and the older one
  // wins. That mislabels the rarer case rather than the common one.
  async function recipientFor(host, pubkey, sats) {
    if (!host || !pubkey) return '';
    if (sats == null || !Number.isFinite(sats)) return '';
    const t = now();
    const msat = Math.round(sats * 1000);
    const hit = (await read()).find((z) => matches(z, host, pubkey, msat, t));
    return (hit && hit.recipient) || '';
  }

  // Drop everything — used on lock, so a locked keystore leaves no spendable approvals.
  async function clear() {
    await write([]);
  }

  async function pending() {
    return fresh(await read(), now());
  }

  const api = { STORAGE_KEY, TTL_MS, record, claim, peek, recipientFor, clear, pending };
  if (typeof self !== 'undefined') self.SidecarZapRequests = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarZapRequests = api;
})();
