// Sidecar — which relays an account uses, in one place (isolated module).
//
// THE BUG THIS EXISTS FOR (#274). The panel decided where its own posts went, and
// decided it correctly: the account's declared (NIP-65) relays, plus the bootstrap set
// unless "Use bootstrap relays" was off. getRelays(), the NIP-07 call a connected client
// makes to ask the same question, ignored all of it and returned the bootstrap set. So
// the setting worked for posts made in the panel and did nothing for the client the user
// actually posts from, and posts failed in Jumble on a relay the user had excluded.
//
// Both answers now come from relayMap below. It lives here, loaded by the background and
// the panel alike, because the failure it fixes was two copies of one rule, and a second
// copy of the fix would drift the same way.
//
// Pure: no storage, no network. Callers bring the three inputs.

(function () {
  // A kind:10002's r tags as { read, write }, or null when it names no relay. An r tag
  // with no marker is both.
  function listFromTags(tags) {
    const read = [];
    const write = [];
    for (const t of tags || []) {
      if (!Array.isArray(t) || t[0] !== 'r' || !t[1]) continue;
      const marker = t[2];
      if (!marker) { read.push(t[1]); write.push(t[1]); }
      else if (marker === 'read') read.push(t[1]);
      else if (marker === 'write') write.push(t[1]);
    }
    return read.length || write.length ? { read, write } : null;
  }

  // The account's relays as NIP-07 getRelays() reports them: { [url]: { read, write } }.
  //
  //   list        the declared relay list, { read, write }, or null when none is known
  //   configured  the bootstrap set, Settings' relay map: { [url]: { read, write } }
  //   bootstrap   "Use bootstrap relays" for this account (false = NIP-65 only)
  //
  //                      list known            no list known
  //   bootstrap on       declared + bootstrap  bootstrap
  //   bootstrap off      declared only         nothing
  //
  // Nothing, not the bootstrap set, when the switch is off and no list is known: those
  // are exactly the relays this account asked not to use. A client told nothing falls
  // back to its own relays; a client told the wrong ones publishes there.
  //
  // Declared relays come first, so a caller taking the keys in order gets the account's
  // own relays ahead of the fallback.
  function relayMap({ list, configured, bootstrap }) {
    const out = {};
    const add = (url, read, write) => {
      const cur = out[url] || { read: false, write: false };
      out[url] = { read: cur.read || read, write: cur.write || write };
    };
    if (list) {
      for (const u of list.read || []) add(u, true, false);
      for (const u of list.write || []) add(u, false, true);
    }
    if (bootstrap) {
      // The same reading the panel has always given Settings' map: a relay is written
      // to unless marked write:false, and read from unless marked read:false.
      for (const [u, f] of Object.entries(configured || {})) {
        add(u, !f || f.read !== false, !f || f.write !== false);
      }
    }
    return out;
  }

  // The write half, in order: where a post goes.
  function writeRelays(map) {
    return Object.keys(map).filter((u) => map[u].write);
  }

  // The read half, in order: where to look for what others send this account, its
  // inbox. Notifications read here, so a reply delivered to a declared read relay (which
  // is where a NIP-65 client sends it) is seen even when no bootstrap relay carries it.
  function readRelays(map) {
    return Object.keys(map).filter((u) => map[u].read);
  }

  const api = { listFromTags, relayMap, writeRelays, readRelays };
  if (typeof self !== 'undefined') self.SidecarRelayPolicy = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarRelayPolicy = api;
})();
