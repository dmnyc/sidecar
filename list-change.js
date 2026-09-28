// Sidecar — what a list edit actually changes (isolated module).
//
// Muting someone in a client signs a new kind:10000: the WHOLE list, again, with the
// private part sealed to yourself. The approval card could only show that as a wall of
// base64 and "Tags 0", which tells nobody that the thing being approved is "mute Bob".
// The same is true of every NIP-51 list — follows, bookmarks, pins, relay lists, sets:
// the event is the whole list, and the one entry that changed is buried in it.
//
// This module turns such an event into what a person would say it does: who or what is
// being added, who or what is being removed, and how big the list is afterwards.
//
// TWO INPUTS, BOTH LOCAL, BOTH ALREADY OURS:
//  - The private entries. They are sealed to the account's own key, so the background
//    can open them with the key it is about to sign with. The plaintext goes to the
//    approval card only, never back to the page, which wrote it in the first place.
//  - The previous version, to diff against. Like replaceable-baseline.js this is a LOCAL
//    snapshot of whatever Sidecar last signed or the panel last saw on relays, because
//    an approval prompt must never wait on the network. Private entries are kept only
//    as salted digests: enough to tell an entry is new, never enough to read the list
//    back out of storage. Public entries are on every relay already and are kept as is,
//    so a removal of one can be named.
//
// LIMITS, stated plainly:
//  - No snapshot ⇒ no diff. The card then says what the list contains, not what changed.
//  - A snapshot can be stale (the list was edited in another signer), so a diff is
//    labelled as against "the version Sidecar last saw", never as the truth on relays.
//  - Anything that can't be read (a locked keystore, ciphertext that isn't ours) makes
//    describe() return null and the card falls back to the raw event. It fails open.
//
// Isolated (like replaceable-baseline.js) so it can be unit tested against a chrome
// mock — see test/list-change.test.js.

(function () {
  'use strict';

  const STORAGE_PREFIX = 'sidecar_list_snap|';

  // Replaceable NIP-51 lists (and kind 3, which is a list in all but name).
  const REPLACEABLE = new Set([
    3, 10000, 10001, 10002, 10003, 10004, 10005, 10006, 10007, 10009,
    10012, 10015, 10020, 10030, 10050, 10063,
  ]);
  // Addressable sets: one list per d-tag, so the snapshot key carries it.
  const ADDRESSABLE = new Set([30000, 30002, 30003, 30004, 30005, 30015, 30030, 39089, 39092]);

  // Tags that describe the list rather than being entries in it.
  const META_TAGS = new Set(['d', 'title', 'name', 'description', 'summary', 'image', 'alt', 'client', 'expiration']);

  // How many entries a card lists by name before "and N more". A list edit is almost
  // always one entry; this is for the import-a-hundred case, which should not push the
  // Allow button off the screen.
  const SHOW_MAX = 5;

  // Content larger than this is not decrypted for display. Lists are small; a page
  // stuffing megabytes into a mute list gets the ordinary raw card.
  const MAX_CONTENT = 256 * 1024;

  function isList(kind) {
    return REPLACEABLE.has(kind) || ADDRESSABLE.has(kind);
  }

  function dTag(ev) {
    const d = (ev.tags || []).find((t) => Array.isArray(t) && t[0] === 'd');
    return d && typeof d[1] === 'string' ? d[1] : '';
  }

  function slot(pubkey, ev) {
    return STORAGE_PREFIX + pubkey + '|' + ev.kind + (ADDRESSABLE.has(ev.kind) ? ':' + dTag(ev) : '');
  }

  // Entries of a tag array, deduped, in order: [tag, value] with a string value. Hex
  // keys and ids are lowercased so the same person twice is one entry.
  function entriesOf(tags) {
    const out = [];
    const seen = new Set();
    if (!Array.isArray(tags)) return out;
    for (const t of tags) {
      if (!Array.isArray(t) || typeof t[0] !== 'string' || typeof t[1] !== 'string' || !t[1]) continue;
      if (META_TAGS.has(t[0])) continue;
      const value = /^[0-9a-f]{64}$/i.test(t[1]) ? t[1].toLowerCase() : t[1];
      const id = t[0] + ' ' + value;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ tag: t[0], value, id });
    }
    return out;
  }

  // Whether the content is something this module should try to open. Empty is "no
  // private part" (handled by the caller); JSON is kind 3's legacy relay map, not a
  // secret; anything oversized is not worth the work.
  function looksSealed(content) {
    if (typeof content !== 'string' || !content || content.length > MAX_CONTENT) return false;
    const c = content.trim();
    return !(c.startsWith('{') || c.startsWith('['));
  }

  // The private tag array of a list, or null when it can't be read. `decrypt(nip,
  // ciphertext)` is supplied by the background and opens content sealed to self. NIP-04
  // ciphertext carries "?iv="; NIP-44 is one base64 blob. Try the one it looks like
  // first, then the other, the same order loadMuteList in the panel uses.
  async function openPrivate(ev, decrypt) {
    const content = ev && ev.content;
    if (typeof content !== 'string' || !content) return [];
    if (!looksSealed(content)) return ev.kind === 3 ? [] : null;
    const order = content.includes('?iv=') ? [4, 44] : [44, 4];
    for (const nip of order) {
      try {
        const tags = JSON.parse(await decrypt(nip, content));
        if (Array.isArray(tags)) return tags;
      } catch (_) {}
    }
    return null;
  }

  // Salted with the account so two accounts' digests of the same entry differ.
  async function digest(pubkey, id) {
    const bytes = new TextEncoder().encode('sidecar-list|' + pubkey + '|' + id);
    const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    let hex = '';
    for (const b of new Uint8Array(buf).slice(0, 12)) hex += b.toString(16).padStart(2, '0');
    return hex;
  }

  function sget(keys) {
    return new Promise((r) => chrome.storage.local.get(keys, r));
  }
  function sset(obj) {
    return new Promise((r) => chrome.storage.local.set(obj, r));
  }

  // Remember this version of the list. `privateTags` null means the private part could
  // not be read, and then nothing is recorded: a snapshot missing its private half would
  // make every private entry look new next time.
  async function record(pubkey, ev, privateTags, opts) {
    try {
      if (!pubkey || !ev || !isList(ev.kind) || privateTags == null) return false;
      const k = slot(pubkey, ev);
      const ts = ev.created_at || 0;
      if (opts && opts.ifNewer) {
        const prev = (await sget(k))[k];
        if (prev && (prev.ts || 0) >= ts) return false;
      }
      const pub = entriesOf(ev.tags).map((e) => e.id);
      const priv = await Promise.all(entriesOf(privateTags).map((e) => digest(pubkey, e.id)));
      await sset({ [k]: { ts, pub, priv } });
      return true;
    } catch (_) {
      return false;
    }
  }

  function pick(list) {
    return list.slice(0, SHOW_MAX).map((e) => ({ tag: e.tag, value: e.value, private: !!e.private }));
  }

  // What the card says. Returns null when there is nothing honest to say (not a list,
  // or the private part could not be read), else:
  //   { kind, known, added, addedCount, removed, removedCount, removedPrivate,
  //     total, privateTotal }
  // `known` false means no snapshot: `added` then lists what the list contains.
  // Never throws: a broken description must not be able to block a signature.
  async function describe(pubkey, ev, privateTags) {
    try {
      if (!pubkey || !ev || !isList(ev.kind) || privateTags == null) return null;
      const pub = entriesOf(ev.tags).map((e) => Object.assign(e, { private: false }));
      const pubIds = new Set(pub.map((e) => e.id));
      // An entry both public and private is one entry, shown as public.
      const priv = entriesOf(privateTags)
        .filter((e) => !pubIds.has(e.id))
        .map((e) => Object.assign(e, { private: true }));
      const all = pub.concat(priv);
      const base = { kind: ev.kind, total: all.length, privateTotal: priv.length };

      const k = slot(pubkey, ev);
      const prev = (await sget(k))[k];
      if (!prev) {
        return Object.assign(base, {
          known: false, added: pick(all), addedCount: all.length,
          removed: [], removedCount: 0, removedPrivate: 0,
        });
      }

      const now = await Promise.all(all.map((e) => digest(pubkey, e.id)));
      const prevPub = new Set(prev.pub || []);
      const prevDigests = new Set(prev.priv || []);
      for (const d of await Promise.all([...prevPub].map((id) => digest(pubkey, id)))) prevDigests.add(d);

      const added = all.filter((e, i) => !prevPub.has(e.id) && !prevDigests.has(now[i]));
      const nowIds = new Set(all.map((e) => e.id));
      const nowDigests = new Set(now);
      const removedPub = [...prevPub].filter((id) => !nowIds.has(id)).map((id) => {
        const at = id.indexOf(' ');
        return { tag: id.slice(0, at), value: id.slice(at + 1), id };
      });
      const removedPrivate = (prev.priv || []).filter((d) => !nowDigests.has(d)).length;

      return Object.assign(base, {
        known: true,
        added: pick(added), addedCount: added.length,
        removed: pick(removedPub), removedCount: removedPub.length + removedPrivate, removedPrivate,
      });
    } catch (_) {
      return null;
    }
  }

  async function forget(pubkey) {
    const all = await sget(null);
    const doomed = Object.keys(all || {}).filter((k) => k.startsWith(STORAGE_PREFIX + pubkey + '|'));
    if (doomed.length) await new Promise((r) => chrome.storage.local.remove(doomed, r));
  }

  const api = {
    STORAGE_PREFIX, SHOW_MAX, isList, entriesOf, openPrivate, record, describe, forget,
  };
  if (typeof self !== 'undefined') self.SidecarListChange = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarListChange = api;
})();
