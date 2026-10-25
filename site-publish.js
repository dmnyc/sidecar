// Sidecar — the publish session behind one site-publishing approval (isolated module).
//
// Issue #530: publishing an nsite signs one manifest event, one snapshot, maybe a
// server list, and one 24242 auth per blob per server — a dozen signatures for what
// must be ONE approval. The editor page cannot be handed SIDECAR_OWNER_SIGN for the
// batch (every extension page can already call that, so trusting it here would add
// nothing, and the point of the card is that a person saw this publish). And it
// cannot sign through window.nostr — extension pages have no provider — which is
// exactly why the recursion the issue worries about cannot happen by accident.
//
// So an approval mints a SESSION. The composer hands each event to the background
// with the session id, and the background signs only what the session covers. The
// trust model, in the four bounds that make it a grant rather than a blank check:
//
//   account  — signs only as the account the card showed, and fails closed if the
//              active account changed (expectedPubkey, as everywhere else).
//   bytes    — every hash that can be signed or uploaded is named in the approved
//              plan. A manifest's path tags, a snapshot's copies, and an upload
//              auth's x tag are each checked against that set, so a page cannot
//              publish a blob the card did not describe.
//   kinds    — the manifest kind is DERIVED from the approved name, not taken from
//              the page's plan; 5128 and 10063 ride along; kind 5 is admitted only
//              when the approval said "unpublish".
//   time     — the session dies on its TTL, when the publish says it is done, when
//              the keystore locks, or when the worker restarts (sessions are
//              memory only, like the approval queue's callbacks). A lost session
//              costs a re-approval, never a signature.
//
// What this deliberately is NOT: a standing, revocable grant of the kind
// kind-grants.js keeps. One approval, one publish, nothing remembered — the
// spec's open question about the trust model is answered by not having one that
// outlives the click that earned it.
//
// Isolated (like kind-grants.js / relax-grants.js) so it unit-tests against a
// clock — see test/site-publish.test.js. No chrome API in this file.

(function () {
  'use strict';

  const SESSION_TTL_MS = 15 * 60 * 1000;
  const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

  // The event kinds a publish session may ever sign. The manifest kind itself is
  // picked at mint time from the site name; 5 is minted in only for an unpublish.
  const BASE_KINDS = [5128, 10063, 24242];
  const DELETION_KIND = 5;
  const MANIFEST_KIND = 15128;
  const NAMED_MANIFEST_KIND = 35128;

  const HEX64 = /^[0-9a-f]{64}$/;

// Site paths are URL paths: slash-leading, printable and boring, one segment per
// slash — and no dot segment, which the character class alone would admit, since
// '.' and '..' are made of legal characters.
const PATH_RE = /^\/[A-Za-z0-9._~\-]+(?:\/[A-Za-z0-9._~\-]+)*$/;

function isSafePath(p) {
  if (!PATH_RE.test(p)) return false;
  return !p.split('/').some((seg) => seg === '.' || seg === '..');
}

  function isValidSiteName(name) {
    return typeof name === 'string' && /^[a-z0-9-]{1,13}$/.test(name) && !name.endsWith('-');
  }

  function dTagOf(event) {
    if (!event || !Array.isArray(event.tags)) return null;
    const tg = event.tags.find((t) => Array.isArray(t) && t[0] === 'd');
    return tg ? tg[1] : null;
  }

  function tagsOf(event, name) {
    return ((event && event.tags) || []).filter((t) => Array.isArray(t) && t[0] === name);
  }

  // ---- sessions ----

  let sessions = new Map();

  function sweep(now) {
    for (const [id, s] of sessions) if (s.expiresAt <= now) sessions.delete(id);
  }

  // The plan the card showed, checked before it ever reaches a card. Returns an
  // error string or null; the caller turns null into a session. Only an explicit
  // unpublish:true is one — anything else, flag omitted included, is a publish.
  function validatePlan(plan) {
    if (!plan || typeof plan !== 'object') return 'no plan';
    if (plan.name && !isValidSiteName(plan.name)) return 'site name';
    if (plan.unpublish === true) {
      return null;
    }
    if (!Array.isArray(plan.files) || !plan.files.length) return 'no files';
    let total = 0;
    const seen = new Set();
    for (const f of plan.files) {
      if (!f || !isSafePath(f.path)) return 'file path';
      if (!HEX64.test(f.hash)) return 'file hash';
      if (!Number.isInteger(f.size) || f.size <= 0) return 'file size';
      if (seen.has(f.path)) return 'duplicate path';
      seen.add(f.path);
      total += f.size;
    }
    if (total > MAX_TOTAL_BYTES) return 'total size';
    if (plan.files.length !== seen.size) return 'duplicate path';
    return null;
  }

  // Mint one session from a validated plan. `now` and `id` are injectable for the
  // tests; production passes nothing and gets Date.now() and a random id.
  function begin(pubkey, plan, now, id) {
    const at = now == null ? Date.now() : now;
    sweep(at);
    const name = plan && isValidSiteName(plan.name) ? plan.name : '';
    const manifestKind = name ? NAMED_MANIFEST_KIND : MANIFEST_KIND;
    const hashes = new Set(((plan && plan.files) || []).map((f) => f.hash));
    const session = {
      id: id || ('s_' + at + '_' + Math.random().toString(36).slice(2)),
      pubkey,
      name,
      manifestKind,
      unpublish: !!(plan && plan.unpublish),
      kinds: new Set([manifestKind, ...BASE_KINDS, ...(plan && plan.unpublish ? [DELETION_KIND] : [])]),
      hashes,
      beganAt: at,
      expiresAt: at + SESSION_TTL_MS,
    };
    sessions.set(session.id, session);
    return session;
  }

  function get(id, now) {
    const s = sessions.get(id);
    if (!s) return null;
    if (s.expiresAt <= (now == null ? Date.now() : now)) { sessions.delete(id); return null; }
    return s;
  }

  function end(id) {
    return sessions.delete(id);
  }

  function endForAccount(pubkey) {
    let changed = false;
    for (const [id, s] of sessions) if (s.pubkey === pubkey) { sessions.delete(id); changed = true; }
    return changed;
  }

  function endAll() {
    const had = sessions.size > 0;
    sessions = new Map();
    return had;
  }

  function liveCount() {
    sweep(Date.now());
    return sessions.size;
  }

  // ---- what a session may sign ----

  // One check per event, in the background's sign handler: the session covers the
  // event, or the reason it does not. Returns null when the signature may proceed.
  function check(session, event, expectedPubkey, now) {
    if (!session) return 'Publish session not found. Approve the publish again.';
    if (session.expiresAt <= (now == null ? Date.now() : now)) return 'The publish approval expired. Approve the publish again.';
    if (expectedPubkey && expectedPubkey !== session.pubkey) return 'Account changed';
    if (!event || typeof event.kind !== 'number') return 'not an event';
    if (!session.kinds.has(event.kind)) return 'The approval does not cover kind ' + event.kind;

    // An upload auth commits to one blob by hash; that hash must be one the card named.
    if (event.kind === 24242) {
      const xs = tagsOf(event, 'x').map((t) => String(t[1] || '').toLowerCase());
      if (!xs.length) return 'Upload authorization carries no blob hash';
      for (const x of xs) if (!session.hashes.has(x)) return 'The approval does not cover blob ' + x.slice(0, 12) + '…';
      return null;
    }

    // The deletion asks for the site this session was opened on, and nothing else.
    if (event.kind === DELETION_KIND) {
      if (!session.unpublish) return 'The approval does not cover deleting events';
      const a = tagsOf(event, 'a').map((t) => String(t[1] || ''));
      if (a.length !== 1) return 'A deletion names exactly one address';
      if (a[0] !== (session.manifestKind + ':' + session.pubkey + (session.name ? ':' + session.name : ''))) {
        return 'The approval does not cover ' + a[0];
      }
      return null;
    }

    // The server list carries no file data; the account-level kind check above is
    // the whole gate.
    if (event.kind === 10063) return null;

    // Manifests and snapshots: every published path must resolve to an approved
    // blob, and a named manifest must name the site the approval showed.
    if (event.kind === session.manifestKind || event.kind === 5128) {
      if (event.kind === session.manifestKind) {
        const d = dTagOf(event);
        if (session.name && d !== session.name) return 'The approval does not cover the site “' + d + '”';
        if (!session.name && d != null) return 'The approval does not cover a named site';
      }
      const paths = tagsOf(event, 'path');
      if (event.kind === session.manifestKind && !paths.length) {
        // The one empty manifest a session will sign: an unpublish. A publish of a
        // real site is refused at plan time, so empty here is only ever removal.
        if (!session.unpublish) return 'The manifest publishes no files';
        return null;
      }
      for (const tg of paths) {
        if (!isSafePath(String(tg[1] || ''))) return 'Bad path in the manifest: ' + String(tg[1]).slice(0, 40);
        if (!HEX64.test(String(tg[2] || '').toLowerCase())) return 'Bad blob hash in the manifest';
        if (!session.hashes.has(String(tg[2]).toLowerCase())) {
          return 'The approval does not cover blob ' + String(tg[2]).slice(0, 12) + '…';
        }
      }
      return null;
    }

    return 'The approval does not cover kind ' + event.kind;
  }

  const api = {
    SESSION_TTL_MS, MAX_TOTAL_BYTES,
    validatePlan, begin, get, end, endAll, endForAccount, liveCount, check,
  };
  if (typeof self !== 'undefined') self.SidecarSitePublish = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarSitePublish = api;
})();
