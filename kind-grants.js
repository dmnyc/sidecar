// Sidecar — persistent per-kind auto-approve grant (isolated module).
//
// "Always allow this event type for this site" (#482): a standing, revocable
// grant that signs future signEvent requests of ONE kind — optionally one `d`
// record of that kind — from ONE site, as the ONE account that granted it,
// without another approval click. The checkbox on the approval card saves it;
// the Activity tab's site row lists and revokes it.
//
// Scope, and why each axis exists: a grant is (account, host, kind, d). Account
// and host because trust granted to one identity on one site must never leak to
// another — the same rule permissions.js's tiers follow. `d` because a
// parameterized kind can hold many unrelated records under one kind number
// (an app's settings lives beside its other app-data), so a grant can cover one
// record rather than everything of that kind; a grant saved without a `d` is
// kind-level and matches any event of the kind.
//
// Signing only, by construction: grants are checked only on the signEvent path
// in handleNostrRpc — an encrypt or decrypt can never match one, so a grant
// never implicitly grants message access.
//
// Persistence: chrome.storage.local, cleared only by an explicit revoke (the
// row's ✕, Forget site, Forget all sites, account removal, full reset). The
// lock is NOT one of those: a grant auto-signs only while the keystore is
// unlocked anyway, because handleNostrRpc computes the unlock requirement
// independently of the approval decision — locked, the request still shows the
// PIN screen. This mirrors the permission tiers, which also survive a lock.
//
// Isolated (like relax-grants.js / permissions.js) so it can be unit-tested
// directly against a chrome mock — see test/kind-grant.test.js.

(function () {
  'use strict';

  const STORAGE_KEY = 'sidecar_kind_grants';

  // Kinds that can never carry a standing grant. The first two sets are the
  // same ones that never relax (relax-grants.js), kept as literals here for the
  // same reason they are there: this file must stay dependency-free for the
  // chrome-mock tests, and test/kind-grant.test.js asserts the replaceable set
  // stays in agreement with replaceable-baseline.js so the lists cannot drift.
  //
  // CONTROL_KINDS hand the account or wallet to another app or device.
  //
  // REPLACEABLE_KINDS wholly replace what came before with no merge and no
  // undo (profile, follows, mutes, trust providers) — the kinds the
  // destructive-overwrite guard exists for. One tap signing a follow-list
  // replacement the card only previews as a row is what #505 took away from
  // batches; a standing grant would give it back permanently.
  const CONTROL_KINDS = new Set([24133, 23194, 23195]);
  const REPLACEABLE_KINDS = new Set([0, 3, 10000, 10040]);

  // Zap requests (9734) carry the amount in their tags, so a standing grant
  // would be a blank check: every future zap request from the site signed
  // whatever size it asked for, sidestepping the auto-zap caps that are the
  // only standing limit on that kind today. Signing a zap request moves no
  // money by itself, but it is the spend-commitment half of a payment, and
  // payments keep their own per-request gates.
  const PAYMENT_KINDS = new Set([9734]);

  // Relay auth (22242) needs no grant: well-formed auth events are already
  // pre-approved, and a grant would additionally cover the malformed ones the
  // well-formedness check deliberately sends back to a human.
  const AUTH_KINDS = new Set([22242]);

  function lget(keys) {
    return new Promise((r) => chrome.storage.local.get(keys, r));
  }
  function lset(obj) {
    return new Promise((r) => chrome.storage.local.set(obj, r));
  }

  async function map() {
    return (await lget(STORAGE_KEY))[STORAGE_KEY] || {};
  }

  // `d` normalized to null so "no record named" has one representation (a page
  // sending d: "" and omitting d are the same kind-level event for matching).
  function normD(d) {
    return typeof d === 'string' && d.length ? d : null;
  }

  // The fields ride in the value, not just the key, so nothing ever parses the
  // composite key (a `d` may itself contain '|').
  function key(host, pubkey, kind, d) {
    return host + '|' + pubkey + '|' + kind + '|' + (d || '');
  }

  // A kind-level grant (d: null) matches every event of the kind; a
  // record-level grant matches only events carrying that exact `d`.
  function matchesGrant(grantD, eventD) {
    return grantD == null || grantD === eventD;
  }

  // The event's `d` tag value, or null when it has none. Same shape the sign
  // path sees: the event object itself (params.event, or params when the page
  // passed the event bare).
  function dTagOf(event) {
    if (!event || !Array.isArray(event.tags)) return null;
    for (const t of event.tags) {
      if (Array.isArray(t) && t[0] === 'd') return typeof t[1] === 'string' ? t[1] : null;
    }
    return null;
  }

  // The one question both the background's offer gate and its grant handler
  // ask: may THIS kind ever be covered by a standing grant? Both call sites go
  // through this so they cannot drift — the relax window's bug was exactly a
  // gate that existed in one place and not the other.
  function isGrantableKind(kind) {
    return kind != null &&
      !CONTROL_KINDS.has(kind) &&
      !REPLACEABLE_KINDS.has(kind) &&
      !PAYMENT_KINDS.has(kind) &&
      !AUTH_KINDS.has(kind);
  }

  async function has(host, pubkey, kind, eventD) {
    if (!isGrantableKind(kind)) return false;
    const m = await map();
    for (const v of Object.values(m)) {
      if (v.host === host && v.pubkey === pubkey && v.kind === kind &&
          matchesGrant(v.d, normD(eventD))) return true;
    }
    return false;
  }

  async function grant(host, pubkey, kind, d) {
    if (!isGrantableKind(kind)) throw new Error('Kind ' + kind + ' cannot carry a standing grant');
    const record = { host, pubkey, kind, d: normD(d), updatedAt: Date.now() };
    const m = await map();
    m[key(host, pubkey, kind, record.d)] = record;
    await lset({ [STORAGE_KEY]: m });
    return record;
  }

  async function revoke(host, pubkey, kind, d) {
    const m = await map();
    delete m[key(host, pubkey, kind, normD(d))];
    await lset({ [STORAGE_KEY]: m });
  }

  async function revokeForHost(pubkey, host) {
    const m = await map();
    let changed = false;
    for (const k of Object.keys(m)) {
      if (m[k].pubkey === pubkey && m[k].host === host) { delete m[k]; changed = true; }
    }
    if (changed) await lset({ [STORAGE_KEY]: m });
  }

  // Drop an account's every grant (called when an account is removed).
  async function clearAccount(pubkey) {
    const m = await map();
    let changed = false;
    for (const k of Object.keys(m)) {
      if (m[k].pubkey === pubkey) { delete m[k]; changed = true; }
    }
    if (changed) await lset({ [STORAGE_KEY]: m });
  }

  // The bulk "Forget all sites" sweep — every account's grants at once.
  async function clearAll() {
    await lset({ [STORAGE_KEY]: {} });
  }

  // One account's grants for the Activity tab, newest first.
  async function listFor(pubkey) {
    const m = await map();
    return Object.values(m)
      .filter((v) => v.pubkey === pubkey)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((v) => ({ host: v.host, kind: v.kind, d: v.d, updatedAt: v.updatedAt }));
  }

  // Which queued requests a fresh grant already covers — the entries sitting
  // behind the card that granted it (a burst queued while its head was on
  // screen). Pure over `entries` so the tests can drive it directly; the
  // caller settles each returned id 'once'. Only entries that were actually
  // waiting on an approval (needApproval, no unlock still owed) qualify: an
  // unlock needs its PIN regardless of any grant.
  function matchTargets(entries, host, pubkey, kind, d) {
    const out = [];
    for (const e of entries || []) {
      if (!e || e.state === 'interrupted' || e.host !== host) continue;
      if (e.method !== 'signEvent' || !e.data) continue;
      if (e.data.activePubkey !== pubkey) continue;
      if (!e.data.needApproval || e.data.needUnlock) continue;
      const ev = e.data.params && (e.data.params.event || e.data.params);
      if (!ev || ev.kind !== kind) continue;
      if (!matchesGrant(d, dTagOf(ev))) continue;
      out.push(e.id);
    }
    return out;
  }

  const api = {
    STORAGE_KEY, CONTROL_KINDS, REPLACEABLE_KINDS, PAYMENT_KINDS, AUTH_KINDS,
    has, grant, revoke, revokeForHost, clearAccount, clearAll, listFor,
    isGrantableKind, matchesGrant, dTagOf, matchTargets,
  };
  if (typeof self !== 'undefined') self.SidecarKindGrants = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarKindGrants = api;
})();
