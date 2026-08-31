// Sidecar — the web-of-trust set behind notification filtering (isolated module).
//
// WHY AN ALLOWLIST. Sidecar's existing notification filtering is thorough — muted
// pubkeys, threads, hashtags, words, and even the sender's display name — but every
// branch of it is a DENYLIST, and a denylist cannot win against key rotation. Fresh keys
// arrive faster than anyone can mute them, and the text is sampled from a dictionary so
// word mutes catch nothing without also eating real conversation. The only filter
// rotation cannot route around is "people I already have a reason to trust".
//
// WHAT THE SET IS: you, everyone you follow, and everyone that AT LEAST TEN of your
// follows follow. That last clause is the whole design. Taking anyone your follows follow
// is a weak signal — one careless follow launders a stranger in — and on a real
// 1,066-follow list it produces about 48.9k people, four fifths of them noise. Counting
// how many of your circle vouch for someone cuts that to roughly 9.3k.
//
// IT DEMOTES, IT DOES NOT HIDE. The caller renders out-of-network notifications in a
// collapsed group with a count. Sidecar is a companion, not a moderation service, and
// silently dropping a real reply is a worse failure than showing a spam row.
//
// FAIL OPEN. An empty or failed set means everything is in-network. The follow-list code
// already carries this scar: a race that discarded results the moment it lost "could wipe
// the entire follow list down to zero". A trust filter that fails CLOSED hides your real
// correspondents whenever a relay is slow, and does it invisibly.
//
// Isolated (like zap-requests.js and relay-health.js) so the set-building can be tested
// without a relay pool — see test/wot.test.js.

(function () {
  'use strict';

  // 16 hex chars = 8 bytes of the pubkey. A full set can run to six figures of keys, and
  // at 64 characters each that is megabytes of strings held for the life of the panel;
  // this cuts it to a quarter without changing any answer that matters. Collisions are
  // ~n²/2^65, which at 100k keys is about one in four billion — and a collision lets a
  // stranger through as in-network, which is the fail-open direction anyway.
  const KEY_LEN = 16;

  // HOW MANY OF YOUR FOLLOWS HAVE TO VOUCH for someone before they count as in-network.
  //
  // Membership on a single mention is a weak signal, and weakest where it matters: one
  // careless follow launders a stranger into your network. Counting votes instead is what
  // separates "somebody you follow follows them" from "your circle knows them". Measured
  // against a real 1,066-follow list, the difference is 48.9k people seen versus about
  // 9.3k qualified — the raw two-hop set is four fifths noise.
  //
  // 10 is Wisp's tuned figure and a better starting point than one invented here.
  const THRESHOLD = 10;

  // Relays cap authors per filter, and a 300-author REQ is refused outright by some.
  const CHUNK = 50;

  // Chunks run in parallel, but gently. A 1,000-follow list is ~20 requests, and
  // sequentially that is minutes for something nothing waits on. Four at a time turned out
  // to crowd the relay pool hard enough that the notification bell's own profile lookups
  // failed and every name in it fell back to an npub. Two still finishes in a fraction of
  // the sequential time and leaves room for the things the user is actually reading.
  const CONCURRENCY = 2;

  const short = (pk) => String(pk || '').slice(0, KEY_LEN);
  const isHexKey = (pk) => typeof pk === 'string' && /^[0-9a-f]{64}$/i.test(pk);

  // ONE VOTE PER PERSON, NOT PER COPY OF THEIR LIST.
  //
  // A kind:3 is replaceable, and a pool query spans several relays, so the same person's
  // follow list comes back once per relay that holds it. Counting every copy multiplies
  // each vote by however many relays answered — with four relays, one follow could cast
  // four votes, and roughly twice as many people cleared a threshold of 10 as should
  // have. Newest created_at per author wins, which is the rule the panel already applies
  // to every other replaceable event.
  //
  // Duplicate p tags inside one list are collapsed too: following someone twice is not
  // two endorsements.
  function followsFromEvents(evs) {
    const newest = new Map();
    (evs || []).forEach((ev) => {
      if (!ev || !isHexKey(ev.pubkey)) return;
      const cur = newest.get(ev.pubkey);
      if (!cur || (ev.created_at || 0) > (cur.created_at || 0)) newest.set(ev.pubkey, ev);
    });
    const out = [];
    newest.forEach((ev) => {
      const seen = new Set();
      (ev.tags || []).forEach((t) => {
        if (!t || t[0] !== 'p' || !isHexKey(t[1]) || seen.has(t[1])) return;
        seen.add(t[1]);
        out.push(t[1]);
      });
    });
    return out;
  }

  // Build the set.
  //
  //   me            hex pubkey of the account (always in its own network)
  //   follows       hex pubkeys the account follows — hop one, already known
  //   fetchFollowsOf(chunk) -> hex pubkeys those people follow — hop two
  //
  // fetchFollowsOf is injected rather than imported: the relay pool lives in the panel,
  // and keeping it out of here is what makes this testable at all. It is called once per
  // chunk and may reject; a chunk that fails is skipped rather than failing the build,
  // because a partial set still filters and an absent one filters nothing.
  async function build(opts) {
    const o = opts || {};
    const me = isHexKey(o.me) ? o.me : '';
    const follows = (o.follows || []).filter(isHexKey);
    const chunkSize = o.chunkSize || CHUNK;
    const threshold = o.threshold == null ? THRESHOLD : o.threshold;
    const muted = o.muted instanceof Set ? o.muted : new Set();

    // NOTHING TO STAND ON MEANS NO FILTER, and the set has to be genuinely EMPTY to say
    // so — inNetwork reads an empty set as "everyone". Seeding it with `me` first would
    // leave a one-entry set that is not empty and therefore filters, so a fresh account
    // with no follow list would see every notification it ever gets buried as
    // out-of-network. That is the exact inversion this is supposed to prevent.
    if (!follows.length || typeof o.fetchFollowsOf !== 'function') {
      return { set: new Set(), seen: 0, qualified: 0, follows: follows.length, expanded: 0, threshold };
    }

    // EVERY follow is expanded, not the first N of them. An earlier version capped the
    // seeds and quietly covered 28% of a real list while reporting a confident total.
    // The cap that genuinely matters is per REQUEST, which is what chunking is for.
    const chunks = [];
    for (let i = 0; i < follows.length; i += chunkSize) chunks.push(follows.slice(i, i + chunkSize));

    // pubkey -> how many of your follows follow them.
    const votes = new Map();
    let expanded = 0;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
        while (next < chunks.length) {
          const chunk = chunks[next++];
          let got;
          try {
            got = await o.fetchFollowsOf(chunk);
          } catch (_) {
            continue; // a chunk that fails narrows the set; it must not empty it
          }
          expanded += chunk.length;
          // Reported per chunk rather than per person: the caller is drawing a bar, and a
          // build on a large follow list is the one place in the panel where something
          // takes long enough that silence reads as broken.
          if (typeof o.onProgress === 'function') {
            try { o.onProgress(expanded, follows.length); } catch (_) {}
          }
          (got || []).forEach((pk) => {
            if (!isHexKey(pk)) return;
            const k = short(pk);
            votes.set(k, (votes.get(k) || 0) + 1);
          });
        }
      })
    );

    const set = new Set();
    // You and the people you chose yourself are in unconditionally — a follow is a louder
    // vote than ten strangers' follows, and no threshold should be able to overrule it.
    if (me) set.add(short(me));
    follows.forEach((pk) => set.add(short(pk)));

    let qualified = 0;
    votes.forEach((n, k) => {
      if (n < threshold) return;
      // Muted people do not get in through the back door. The denylist and the allowlist
      // compose rather than sitting side by side.
      if (muted.has(k)) return;
      set.add(k);
      qualified++;
    });

    return { set, seen: votes.size, qualified, follows: follows.length, expanded, threshold };
  }

  // Is this person in the network? UNKNOWN MEANS YES — an absent or empty set is not
  // evidence about anybody, and treating it as such would hide real correspondents the
  // first time a relay was slow.
  function inNetwork(set, pubkey) {
    if (!set || !set.size) return true;
    if (!isHexKey(pubkey)) return true;
    return set.has(short(pubkey));
  }

  // Split notifications without discarding any. The caller renders `out` collapsed.
  // `senderOf` is passed in because the interesting party is not always ev.pubkey — a zap
  // receipt is authored by the LNURL service, and filtering on that would judge the
  // wrong person entirely.
  function partition(set, events, senderOf) {
    const inn = [];
    const out = [];
    const who = typeof senderOf === 'function' ? senderOf : (e) => e && e.pubkey;
    (events || []).forEach((ev) => {
      (inNetwork(set, who(ev)) ? inn : out).push(ev);
    });
    return { inn, out };
  }

  const api = { KEY_LEN, THRESHOLD, CHUNK, CONCURRENCY, short, followsFromEvents, build, inNetwork, partition };
  if (typeof self !== 'undefined') self.SidecarWot = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarWot = api;
})();
