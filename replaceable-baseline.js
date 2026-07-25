// Sidecar — destructive-overwrite detection for replaceable events (isolated module).
//
// Kinds 0 (profile), 3 (follows) and 10000 (mute list) are REPLACEABLE: the event
// being signed wholly overwrites the previous one on every relay. A buggy or naive
// client that publishes a short/empty list silently destroys the real one — the most
// common data-loss complaint on Nostr, and the reason Sidecar already ships follow-list
// RECOVERY. This module is the prevention half: it warns before the signature.
//
// HOW THE BASELINE IS OBTAINED — this is the crux of the design.
// The obvious approach (fetch the current version from relays when the prompt opens)
// doesn't work here: the approval prompt must never block on the network (clients time
// out with "Signer did not respond in time"), and the standalone prompt window has no
// relay access at all — it only talks to the background. So instead we keep a LOCAL
// baseline: whatever Sidecar itself last signed for this (account, kind). The check is
// then pure local state — synchronous, offline, and identical on both prompt surfaces.
//
// The panel, which does have relay access, can seed baselines from work it already
// does (see recordFromEvent) so a fresh install isn't blind until its first sign.
//
// LIMITS, stated plainly:
//  - No baseline ⇒ no warning. A first-ever sign of one of these kinds can't be judged.
//  - A baseline can be stale (something else published a newer version elsewhere).
//  - Therefore the ABSENCE of a warning NEVER means "this event is safe". This is a
//    safety net, not a gate. It must never be the only thing standing between a user
//    and data loss, and it must never block a signature on its own.
//
// Isolated (like keystore.js / permissions.js / relax-grants.js) so it can be unit
// tested against a chrome mock — see test/replaceable-baseline.test.js.

(function () {
  'use strict';

  const STORAGE_KEY = 'sidecar_replaceable_baseline';

  // Kinds we track. Anything else is none of this module's business.
  const KIND_FOLLOWS = 3;
  const KIND_MUTE = 10000;
  const KIND_PROFILE = 0;
  const TRACKED = new Set([KIND_PROFILE, KIND_FOLLOWS, KIND_MUTE]);

  // A shrink has to be BOTH proportionally large and numerically meaningful to warn.
  // Unfollowing a handful of people is routine; losing most of a list is not. Without
  // the floor, going 3 → 1 follows would cry wolf at the exact moment a new user is
  // still assembling their list.
  const SHRINK_RATIO = 0.5;   // warn when over half the entries disappear
  const SHRINK_FLOOR = 10;    // ...and at least this many are lost

  // Profile fields worth protecting. Deliberately NOT "every field that was there
  // before": plenty of clients round-trip only the fields they understand, so warning
  // on any omission would fire on ordinary edits from ordinary clients and train
  // people to click through — which would defeat the entire point.
  const PROFILE_FIELDS = ['about', 'picture', 'nip05', 'lud16', 'lud06', 'display_name'];

  function sget(keys) {
    return new Promise((r) => chrome.storage.local.get(keys, r));
  }
  function sset(obj) {
    return new Promise((r) => chrome.storage.local.set(obj, r));
  }

  async function all() {
    return (await sget(STORAGE_KEY))[STORAGE_KEY] || {};
  }
  function key(pubkey, kind) { return pubkey + '|' + kind; }

  // Unique lowercase p-tag values — the entry count for kinds 3 and 10000. Deduped
  // because a list carrying the same pubkey twice isn't two follows. Returns null when
  // `tags` isn't an array: a malformed event is "unknown", not "an empty list", or a
  // client sending junk would trigger a full-wipe warning on nothing.
  function countPTags(ev) {
    const tags = ev && ev.tags;
    if (!Array.isArray(tags)) return null;
    const out = new Set();
    for (const t of tags) {
      if (Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string' && t[1].length === 64) {
        out.add(t[1].toLowerCase());
      }
    }
    return out.size;
  }

  // Which PROFILE_FIELDS carry a non-empty value in a kind:0's JSON content.
  // Unparseable content yields null — "unknown", never "empty", so a client using a
  // content format we don't understand can't look like field loss.
  function profileFields(ev) {
    let obj;
    try { obj = JSON.parse((ev && ev.content) || ''); } catch (_) { return null; }
    if (!obj || typeof obj !== 'object') return null;
    const present = [];
    for (const f of PROFILE_FIELDS) {
      const v = obj[f];
      if (typeof v === 'string' ? v.trim() !== '' : v != null) present.push(f);
    }
    return present;
  }

  // Summarize an event into the shape we persist and compare. Returns null for kinds
  // we don't track, or when a kind:0's content can't be read.
  function summarize(ev) {
    const kind = ev && ev.kind;
    if (!TRACKED.has(kind)) return null;
    if (kind === KIND_PROFILE) {
      const fields = profileFields(ev);
      if (!fields) return null;
      return { kind, fields };
    }
    const count = countPTags(ev);
    if (count == null) return null; // malformed — can't judge it
    return { kind, count };
  }

  // Record what we just signed (or what the panel observed on relays) as the new
  // baseline for this account+kind. `ts` is passed in rather than read from the clock
  // so the caller controls it and tests stay deterministic.
  async function record(pubkey, ev, ts) {
    const s = summarize(ev);
    if (!s || !pubkey) return false;
    const m = await all();
    m[key(pubkey, s.kind)] = Object.assign({ ts: ts || 0 }, s);
    await sset({ [STORAGE_KEY]: m });
    return true;
  }

  // Only overwrite an existing baseline if `ts` is newer — so the panel seeding from a
  // relay copy can't clobber a fresher record of what Sidecar itself just signed.
  async function recordIfNewer(pubkey, ev, ts) {
    const s = summarize(ev);
    if (!s || !pubkey) return false;
    const m = await all();
    const prev = m[key(pubkey, s.kind)];
    if (prev && (prev.ts || 0) >= (ts || 0)) return false;
    m[key(pubkey, s.kind)] = Object.assign({ ts: ts || 0 }, s);
    await sset({ [STORAGE_KEY]: m });
    return true;
  }

  // The check. Returns null when there's nothing to say (untracked kind, no baseline,
  // or the change looks unremarkable), else a plain-language finding the prompt can
  // render. Never throws: a broken check must not be able to block a signature.
  //
  // { kind, type, from, to, lost, fields, message }
  async function check(pubkey, ev) {
    try {
      const s = summarize(ev);
      if (!s || !pubkey) return null;
      const prev = (await all())[key(pubkey, s.kind)];
      if (!prev || prev.kind !== s.kind) return null; // nothing to compare against

      if (s.kind === KIND_PROFILE) {
        const before = new Set(prev.fields || []);
        const after = new Set(s.fields || []);
        const lost = [...before].filter((f) => !after.has(f));
        if (!lost.length) return null;
        return {
          kind: s.kind, type: 'profile-fields', lost,
          message: 'Clears your ' + humanFields(lost) + '.',
        };
      }

      const from = prev.count || 0;
      const to = s.count || 0;
      if (to >= from) return null; // growing or unchanged
      const lost = from - to;

      // Emptying a list that had anything in it is always worth flagging, however
      // small — that's the total-wipe case people actually get burned by.
      if (to === 0 && from > 0) {
        return {
          kind: s.kind, type: 'emptied', from, to, lost,
          message: s.kind === KIND_FOLLOWS
            ? 'Removes all ' + from + ' accounts you follow.'
            : 'Clears your mute list of ' + from + ' ' + plural(from, 'account') + '.',
        };
      }
      if (lost >= SHRINK_FLOOR && to <= from * SHRINK_RATIO) {
        return {
          kind: s.kind, type: 'shrink', from, to, lost,
          message: s.kind === KIND_FOLLOWS
            ? 'Drops your follows from ' + from + ' to ' + to + '.'
            : 'Drops your mute list from ' + from + ' to ' + to + '.',
        };
      }
      return null;
    } catch (_) {
      return null; // fail open — never let this stop a signature
    }
  }

  function plural(n, word) { return n === 1 ? word : word + 's'; }

  const FIELD_LABELS = {
    about: 'bio', picture: 'profile picture', nip05: 'verified name',
    lud16: 'Lightning address', lud06: 'Lightning address', display_name: 'display name',
  };
  function humanFields(fields) {
    const names = [...new Set(fields.map((f) => FIELD_LABELS[f] || f))];
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
  }

  async function forget(pubkey) {
    const m = await all();
    let changed = false;
    for (const k of Object.keys(m)) {
      if (k.startsWith(pubkey + '|')) { delete m[k]; changed = true; }
    }
    if (changed) await sset({ [STORAGE_KEY]: m });
  }

  const api = {
    STORAGE_KEY, TRACKED, PROFILE_FIELDS, SHRINK_RATIO, SHRINK_FLOOR,
    KIND_PROFILE, KIND_FOLLOWS, KIND_MUTE,
    summarize, record, recordIfNewer, check, forget,
    isTracked: (k) => TRACKED.has(k),
  };
  if (typeof self !== 'undefined') self.SidecarBaseline = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarBaseline = api;
})();
