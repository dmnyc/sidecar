// Lazarus — recovery of user data from relay history on Nostr.
// Spec: https://github.com/dmnyc/lazarus (0.5.0-draft).
//
// A buggy client publishing its own version of a replaceable event destroys every
// prior version on any relay that honors replacement. Until relays expire it, the
// history is a full undo log. This file is that protocol's pure core: the kind
// registry, candidate accounting (including the three-certainties contract for
// encrypted private items), clobber detection and recommendation, the delta rule,
// and the recovery event builder. No DOM, no pool, no signer — the panel injects
// those, and the four invariants are enforced where the clicks are:
//
//   1. Recovery is never automatic — the panel scans and restores only on click.
//   2. Everything found is shown — the panel renders every candidate this file
//      accounts for, including empty ones.
//   3. Tombstones are never recommended — enforced here (rank() never recommends
//      an empty candidate) and in the UI (past empty versions are not offered).
//   4. Your keys, your publish — the panel signs with the user's own signer on an
//      explicit click, one event per click.

(function (root) {
  'use strict';

  const SPEC_VERSION = '0.6.0-draft';

  // Reference thresholds from the spec. Implementations SHOULD use them so that
  // recommendations agree across clients; changing these here is a spec-version
  // event, not a tuning knob.
  const DROP_SHARE = 0.2;       // a sudden drop takes at least a fifth of the list…
  const DROP_MIN_ITEMS = 5;     // …and at least five items; curation never registers
  const EPISODE_WINDOW = 86400; // drops within a day of each other are one clobber episode
  const SETTLED_EDITS = 5;      // a list edited this many times since the drop…
  const SETTLED_SECONDS = 604800; // …spread over at least a week, is the user's choice

  // The kind registry — the single source of truth for kind semantics. Tier 1 is
  // required for conformance, tier 2 recommended, tier 3 optional with mandatory
  // warnings. Everything not listed is out of scope until the spec is amended.
  //
  //   profile       how candidates are ranked: `count` recommends only after a
  //                 sudden drop the current version hasn't recovered from;
  //                 `recency` lists newest first, the user picks; `none` forbids
  //                 ranking outright.
  //   itemTags      the tag types whose entries are the list's items.
  //   marker        the read/write marker is part of the item (kind 10002: it
  //                 changes what the relay is for, so a rewritten marker is a
  //                 change even when the URL is not).
  //   privateItems  NIP-51 encrypted content alongside public tags.
  //   restoreNote   the direction-of-harm warning the delta must show.
  const REGISTRY = {
    3: {
      name: 'Follow list', tier: 1, profile: 'count', itemTags: ['p'],
      noun: 'following',
      restoreNote: 'Restoring an old follow list re-follows the accounts it holds. That is mostly benign.',
    },
    10000: {
      name: 'Mute list', tier: 1, profile: 'count', itemTags: ['p'], privateItems: true,
      noun: 'muted',
      restoreNote: 'Restoring an old mute list re-silences accounts you may have deliberately unmuted since. That is a moderation action taken on your behalf.',
    },
    0: {
      name: 'Profile', tier: 2, profile: 'recency',
      restoreNote: 'This replaces your current profile fields with this version\'s.',
    },
    10003: {
      name: 'Bookmarks', tier: 2, profile: 'count', itemTags: ['e', 'a'], privateItems: true,
      noun: 'bookmarked',
      restoreNote: 'Restoring an old bookmark list affects nobody but you.',
    },
    10044: {
      name: 'Encryption keys', tier: 2, profile: 'none', itemTags: ['p'],
      meaningfulEmpty: true,
      noun: 'keys',
      // Empty means "I no longer use NIP-4e" — a defined state, not damage. The
      // intent question in the UI states both endpoints before anything publishes.
      emptyMeaning: 'The current empty state announces that you do not use NIP-4e; clients will not encrypt direct messages to these keys.',
      restoreNote: 'Restoring these keys means clients will encrypt direct messages to them again.',
    },
    10002: {
      name: 'Relay list', tier: 3, profile: 'recency', itemTags: ['r'], marker: true,
      noun: 'relays',
      restoreNote: 'An old relay list can strand you on dead relays and silently break event delivery. Check the relays in it are alive before restoring.',
    },
    10050: {
      name: 'DM relays', tier: 3, profile: 'recency', itemTags: ['relay'],
      noun: 'inboxes',
      restoreNote: 'A wrong DM inbox list silently breaks direct-message delivery. Check the relays in it are alive before restoring.',
    },
    10006: {
      name: 'Blocked relays', tier: 3, profile: 'count', itemTags: ['relay'],
      noun: 'blocked',
      restoreNote: 'Low stakes: this only re-blocks relays you had blocked.',
    },
  };

  // Display order for the picker: tier 1 first, then 2, then 3.
  const KIND_LIST = [3, 10000, 0, 10003, 10044, 10002, 10050, 10006];

  // One private item is assumed to serialize as ["p","<64 hex>"] — 72 characters.
  // NIP-51 private content holds exactly this shape for the kinds that carry it,
  // so the byte-to-item conversion below is an assumption the spec allows making
  // explicit, not a guess about unknown data.
  const ITEM_BYTES = 72;

  // NIP-44 v2 wraps the plaintext in ver(1) + nonce(32) + length(2) + mac(32) and
  // pads it to a power of two — 67 bytes of overhead, a band of half the padding.
  const NIP44_OVERHEAD = 67;

  function b64Bytes(s) {
    const clean = String(s || '').replace(/[^A-Za-z0-9+/=]/g, '');
    if (!clean) return 0;
    const pad = (clean.match(/=+$/) || [''])[0].length;
    return Math.max(0, Math.floor(clean.length * 3 / 4) - pad);
  }

  // The item-count band an encrypted content implies, without decrypting it — the
  // spec's `estimated` certainty. NIP-04 (AES-CBC) plaintexts waste 1-16 bytes per
  // 16-byte block; NIP-44 v2 pads to a power of two. Returns null when the payload
  // cannot be sized at all (the `flagged` certainty).
  function privateBand(content, scheme) {
    if (scheme === 'nip04') {
      const ciphertext = String(content || '').split('?iv=')[0] || '';
      const blocks = Math.floor(b64Bytes(ciphertext) / 16);
      if (blocks < 1) return null;
      return { min: 16 * blocks - 15, max: 16 * blocks };
    }
    const padded = b64Bytes(content) - NIP44_OVERHEAD;
    if (padded < 32 || (padded & (padded - 1)) !== 0) return null; // not a v2 payload
    const lo = padded === 32 ? 1 : padded / 2 + 1;
    // A tiny payload holds fewer items than one ITEM_BYTES assumes; the band never
    // inverts, or an emptied private list could read as a zero after all.
    const min = Math.ceil(lo / ITEM_BYTES);
    return { min, max: Math.max(min, Math.floor(padded / ITEM_BYTES)) };
  }

  // The list's items, as comparable keys: type and value, with the read/write
  // marker where it is part of the item. A relay hint or petname a client rewrote
  // produces the same key — an identical follow list must not read as hundreds of
  // follows added and removed. Malformed tags (no value) are not items.
  function itemKey(tag, kind) {
    if (!tag || typeof tag[1] !== 'string' || !tag[1]) return null;
    const rec = REGISTRY[kind] || {};
    if (rec.marker) return tag[0] + ':' + tag[1] + '|' + (tag[2] || '');
    return tag[0] + ':' + tag[1];
  }

  function publicItems(ev, kind) {
    const rec = REGISTRY[kind] || {};
    const tags = rec.itemTags
      ? (ev.tags || []).filter((t) => rec.itemTags.includes(t[0]))
      : [];
    const out = [];
    for (const t of tags) {
      const key = itemKey(t, kind);
      if (key) out.push({ key, tag: t });
    }
    return out;
  }

  // Kind 0 keeps its data in content, so its items are the fields themselves.
  function contentFields(ev) {
    try {
      const parsed = JSON.parse(ev.content || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v == null) continue;
        out[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
      return out;
    } catch (_) {
      return {};
    }
  }

  // One candidate: one distinct event of the target kind, found in a scan.
  // `decrypted` is set by the caller when it holds the key and the content read
  // back — the `exact` certainty for private items.
  function candidate(ev, kind) {
    const rec = REGISTRY[kind] || {};
    const cand = {
      event: ev,
      id: ev.id,
      createdAt: ev.created_at,
      kind,
      publicItems: publicItems(ev, kind),
      content: ev.content || '',
      decrypted: null, // array of private item tags, when decryption succeeded
    };
    if (rec.privateItems && cand.content) {
      cand.hasPrivate = true;
      cand.scheme = cand.content.includes('?iv=') ? 'nip04' : 'nip44';
      cand.band = privateBand(cand.content, cand.scheme);
    }
    return cand;
  }

  function allItems(cand) {
    return cand.decrypted ? cand.publicItems.concat(cand.decrypted) : cand.publicItems;
  }

  // The three certainties, as one range. Public items always count exactly; a
  // private-only list that was emptied must never read as a zero, which is what
  // public counts alone would say.
  function itemRange(cand) {
    const pub = cand.publicItems.length;
    if (cand.decrypted) {
      const n = pub + cand.decrypted.length;
      return { min: n, max: n, certainty: 'exact' };
    }
    if (cand.hasPrivate) {
      if (cand.band) return { min: pub + cand.band.min, max: pub + cand.band.max, certainty: 'estimated' };
      return { min: pub, max: Infinity, certainty: 'flagged' };
    }
    return { min: pub, max: pub, certainty: 'exact' };
  }

  // RANK. Newest first, always. The `count` profile recommends a version only
  // when the current one looks clobbered — lists shrink through normal curation,
  // so bigger-never-means-better:
  //
  //   - a step between consecutive versions is a sudden drop when the later
  //     version is missing at least 20% and at least 5 of the earlier version's
  //     items, or is empty while the earlier one was not;
  //   - sizes compare conservatively: the later version's maximum against the
  //     earlier version's minimum, so an estimate can never fake a drop;
  //   - drops within a day of each other form one clobber episode, and the
  //     fullest version from before any drop in that episode is the target, so a
  //     list clobbered, partly restored, and clobbered again points at its
  //     fullest state before the damage;
  //   - a clobber the list has since been edited on five times over at least a
  //     week is settled — the current version is the user's choice;
  //   - nothing is recommended while the current version's size is unknown, and
  //     "no recoverable improvement found" is a normal result.
  //
  // `opts.currentConfirmed === false` withholds the recommendation outright:
  // drops are measured against current, and a scan that never reached the user's
  // write relays may be measuring against a version the user already replaced.
  //
  // `meaningful-empty` kinds forbid ranking outright. `recency` kinds never
  // recommend. A tombstone is never recommended in any profile (invariant 3).
  function rank(candidates, kind, opts) {
    const rec = REGISTRY[kind] || {};
    const ordered = candidates.slice().sort((a, b) => b.createdAt - a.createdAt);
    const confirmed = !opts || opts.currentConfirmed !== false;
    const result = { ordered, recommended: null, requiresIntent: !!rec.meaningfulEmpty };

    if (!confirmed) {
      result.currentUnconfirmed = true;
      return result;
    }
    if (rec.meaningfulEmpty || rec.profile !== 'count' || ordered.length < 2) {
      return result;
    }

    const sizes = ordered.map(itemRange);
    if (sizes[0].certainty === 'flagged') {
      // The current size is unknown, so no comparison against it can be made.
      return result;
    }

    const drops = [];
    for (let i = 0; i + 1 < ordered.length; i++) {
      const later = sizes[i];
      const earlier = sizes[i + 1];
      const emptyDrop = earlier.max > 0 && later.max === 0;
      const missing = earlier.min - later.max;
      const sudden = earlier.min > 0
        && missing >= DROP_MIN_ITEMS
        && missing >= earlier.min * DROP_SHARE;
      if (emptyDrop || sudden) drops.push({ idx: i, preIdx: i + 1, missing });
    }
    if (!drops.length) return result;

    // Drops within a day of each other are one episode.
    const episodeOf = new Map();
    let ep = 0;
    episodeOf.set(0, 0);
    for (let d = 1; d < drops.length; d++) {
      const gap = ordered[drops[d].idx].createdAt - ordered[drops[d - 1].idx].createdAt;
      if (gap > EPISODE_WINDOW) ep++;
      episodeOf.set(d, ep);
    }

    for (let d = 0; d < drops.length; d++) {
      const drop = drops[d];
      const preSize = sizes[drop.preIdx];
      // The current version has recovered from this drop — keep walking back.
      const stillMissing = preSize.min - sizes[0].max;
      if (!(stillMissing >= DROP_MIN_ITEMS && stillMissing >= preSize.min * DROP_SHARE)) continue;

      // Settled: the list has been edited SETTLED_EDITS times since the drop,
      // spread over at least a week. The current version is the user's choice.
      const after = ordered.slice(0, drop.idx + 1); // the dropped version and everything since
      if (after.length >= SETTLED_EDITS
        && after[0].createdAt - after[after.length - 1].createdAt >= SETTLED_SECONDS) {
        return { ordered, recommended: null, requiresIntent: false, settled: true };
      }

      // The fullest version from just before any drop in this episode — fullest
      // by maximum, then minimum, then newest.
      const myEp = episodeOf.get(d);
      let best = null;
      for (let e = 0; e < drops.length; e++) {
        if (episodeOf.get(e) !== myEp) continue;
        if (best === null || betterSize(sizes[drops[e].preIdx], sizes[best.preIdx])
          || (sameSize(sizes[drops[e].preIdx], sizes[best.preIdx])
            && ordered[drops[e].preIdx].createdAt > ordered[best.preIdx].createdAt)) {
          best = drops[e];
        }
      }
      const chosen = ordered[best.preIdx];
      if (chosen.id === ordered[0].id) return result;
      // A tombstone is never the recommendation; the fullest pre-episode version
      // of an episode whose every pre-version is empty cannot exist (an empty
      // pre-version cannot have produced an emptyDrop against an empty later), so
      // this is belt-and-suspenders for the invariant.
      if (itemRange(chosen).max === 0) return result;
      return { ordered, recommended: chosen, requiresIntent: false, clobber: true };
    }
    return result;
  }

  function betterSize(a, b) {
    return a.max > b.max || (a.max === b.max && a.min > b.min);
  }
  function sameSize(a, b) {
    return a.max === b.max && a.min === b.min;
  }

  // THE DELTA RULE. What restoring `chosen` would do to `current`, as plain
  // numbers and the warnings the click needs. Items compare by type and value;
  // for kind 0, the fields that would change. `uncountedPrivate` must be set by
  // the caller when a private list could not be decrypted — the delta then says
  // so rather than presenting a public-only count as the whole list.
  function delta(chosen, current, kind, uncountedPrivate) {
    const rec = REGISTRY[kind] || {};
    const out = { added: 0, removed: 0, shrink: false, notes: [], fields: null, tagsAdded: 0, tagsRemoved: 0 };

    if (kind === 0) {
      const a = contentFields(chosen.event);
      const b = contentFields(current.event);
      const fields = { added: [], removed: [], changed: [] };
      for (const k of Object.keys(a)) {
        if (!(k in b)) fields.added.push(k);
        else if (a[k] !== b[k]) fields.changed.push(k);
      }
      for (const k of Object.keys(b)) {
        if (!(k in a)) fields.removed.push(k);
      }
      out.fields = fields;
      // TAGS THAT WOULD CHANGE count too: NIP-30 custom emoji live in a
      // profile's tags, and a restore replaces all of them — a fixed
      // content-field diff alone could report "no change" while the restore
      // reverted fields and tags it never compared.
      const aTags = new Set((chosen.event.tags || []).map((t) => t.join(':')));
      const bTags = new Set((current.event.tags || []).map((t) => t.join(':')));
      for (const k of aTags) if (!bTags.has(k)) out.tagsAdded++;
      for (const k of bTags) if (!aTags.has(k)) out.tagsRemoved++;
      return out;
    }

    const mine = new Set(allItems(chosen).map((i) => i.key));
    const theirs = new Set(allItems(current).map((i) => i.key));
    for (const k of mine) if (!theirs.has(k)) out.added++;
    for (const k of theirs) if (!mine.has(k)) out.removed++;
    out.shrink = out.removed > 0;

    if (rec.restoreNote) out.notes.push(rec.restoreNote);
    if (uncountedPrivate) {
      out.notes.push('This version\'s encrypted items could not be read here, so the counts leave private items out.');
    }
    if (out.shrink) {
      out.notes.push(out.removed + ' of the items in your current list are not in this version and would be removed.');
    }
    return out;
  }

  // THE PRE-SIGN RE-READ, decided. `reviewed` is the candidate the delta was
  // computed against; `newest` is the newest verified version the re-read found
  // on the write relays (or null); `writeAnswered` is whether at least one of
  // the user's write relays answered the re-read. Three outcomes:
  //
  //   proceed     — current stands as reviewed: nothing newer is known.
  //   changed     — the re-read found a version NEWER than the reviewed one; it
  //                 becomes current, the delta is recomputed and asked again.
  //                 An OLDER copy is not a change: the re-read asks fewer
  //                 relays than the scan did, and a stale copy on one of them
  //                 is not evidence the list moved.
  //   unconfirmed — no write relay answered. An absent answer is not an
  //                 unchanged one: nothing gets signed except through the
  //                 explicit override the UI may offer after a failed retry.
  function checkCurrent(reviewed, newest, writeAnswered) {
    if (!writeAnswered) return { status: 'unconfirmed' };
    if (newest && reviewed && newest.createdAt > reviewed.createdAt) {
      return { status: 'changed', version: newest };
    }
    return { status: 'proceed' };
  }

  // The event a restore publishes: the chosen candidate's item set verbatim —
  // tags, and the encrypted content carried over as-is (same key, still
  // decryptable) — as a fresh event of the same kind. The recovered version's
  // timestamp MUST beat the one it replaces: clobbering clients often have
  // skewed clocks, and an older timestamp loses to the clobbered version on
  // relays and in caches.
  function recoveryEvent(chosen, kind, now, currentCreatedAt) {
    return {
      kind,
      created_at: Math.max(now, (currentCreatedAt || 0) + 1),
      tags: chosen.event.tags,
      content: chosen.event.content || '',
    };
  }

  // Whether a candidate may be offered for restore. The current version has
  // nothing to restore onto. A past EMPTY version is the clobber's fingerprint:
  // shown, but not offered, so a clobbered state can't be put back by accident
  // (invariant 3). A meaningful-empty kind's empty state is a defined option,
  // not damage, and stays offered.
  function isRestorable(cand, opts) {
    if (opts.isCurrent) return false;
    const rec = REGISTRY[opts.kind] || {};
    if (rec.meaningfulEmpty) return true;
    return itemRange(cand).max > 0;
  }

  root.SidecarLazarus = {
    SPEC_VERSION,
    REGISTRY,
    KIND_LIST,
    DROP_SHARE,
    DROP_MIN_ITEMS,
    EPISODE_WINDOW,
    SETTLED_EDITS,
    SETTLED_SECONDS,
    SCAN_PAGE: 50,
    RELAY_TIMEOUT: 6000, // per-relay scan timeout, the spec's reference value
    candidate,
    publicItems,
    contentFields,
    itemKey,
    privateBand,
    itemRange,
    rank,
    delta,
    checkCurrent,
    recoveryEvent,
    isRestorable,
  };
})(typeof self !== 'undefined' ? self : this);
