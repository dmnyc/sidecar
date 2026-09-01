// Sidecar — the WebSocket nostr-tools forgets to close (isolated module).
//
// THE BUG, in the vendored library. AbstractRelay.connect() creates a socket and, when
// the connection times out, rejects the promise, calls onclose and hands off to
// handleHardClose — without ever calling close() on the socket it just made
// (nostr-tools.js ~3120). The onerror path does the same. The socket is left in
// CONNECTING and the browser keeps the pending connection open.
//
// It leaks one socket PER ATTEMPT and it is linear: driven through SimplePool, twenty
// queries across three unreachable relays produce sixty sockets and close none of them.
// See test/websocket-leak.test.js, which reproduces it against the real vendored file.
//
// WHY IT MATTERS MORE THAN IT SOUNDS. Chrome caps WebSockets per renderer. A long-lived
// side panel that talks to a handful of relays eventually exhausts that budget, and then
// nothing in the browser can open a socket — not Sidecar, not the Nostr client in the
// next tab. Every relay reports "connect timeout" while the same relays answer in 200ms
// from outside the browser. It presents as intermittent: posting works, then fails, then
// works again as abandoned sockets time out at the OS level and free up slots. The only
// reliable recovery is quitting the browser, which is not a thing to ask of anyone.
//
// WHY NOT PATCH nostr-tools. It is vendored and hash-pinned (scripts/vendor-hashes.sha256),
// so a patch there is invisible to anyone reading upstream and would be silently dropped
// by the next vendor update. SimplePool accepts a websocketImplementation, so the fix
// lives here instead: a socket that closes itself once the library has certainly
// abandoned it.
//
// Used by BOTH pools — the panel's and the one nwc-client builds per wallet client — so
// it is a module rather than a helper inside either.

(function () {
  'use strict';

  // Generous on purpose. nostr-tools' own maxWaitForConnection defaults to 3s and
  // callers shorten it further, so anything still CONNECTING well past that has been
  // abandoned. Closing a socket the library still wanted would turn a slow relay into a
  // broken one, which is the worse failure of the two.
  const CONNECT_DEADLINE_MS = 15000;

  // A ceiling as well as a deadline: the deadline bounds the leak RATE, not the total.
  // Set well under Chrome's per-renderer cap so Sidecar can never be the reason another
  // tab fails to connect.
  const MAX_PENDING = 64;

  const pending = new Set();

  function reap() {
    // Insertion order, so the first entry is the longest-pending — the one to give up on.
    while (pending.size >= MAX_PENDING) {
      const oldest = pending.values().next().value;
      if (!oldest) break;
      pending.delete(oldest);
      try { oldest.close(); } catch (_) {}
    }
  }

  // Returns a WebSocket subclass to hand to SimplePool, or undefined where there is no
  // WebSocket to extend (node tests, some workers) so nostr-tools falls back to its own.
  // deadlineMs is injectable so the tests can exercise the timeout without waiting
  // fifteen seconds; nothing in the extension passes it.
  function impl(Base, deadlineMs) {
    const W = Base || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    if (!W) return undefined;
    const deadline = deadlineMs || CONNECT_DEADLINE_MS;
    return class SidecarWebSocket extends W {
      constructor(url, protocols) {
        super(url, protocols);
        reap();
        pending.add(this);
        const settle = () => {
          clearTimeout(this._sidecarDeadline);
          pending.delete(this);
        };
        this._sidecarDeadline = setTimeout(() => {
          pending.delete(this);
          // Only if still CONNECTING. An open socket is the library's to manage; this
          // exists solely to clean up after the connect path it abandons.
          if (this.readyState === 0) { try { this.close(); } catch (_) {} }
        }, deadline);
        this.addEventListener('open', settle);
        this.addEventListener('close', settle);
        this.addEventListener('error', settle);
      }
    };
  }

  const api = { CONNECT_DEADLINE_MS, MAX_PENDING, impl, pendingCount: () => pending.size };
  if (typeof self !== 'undefined') self.SidecarWsGuard = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarWsGuard = api;
})();
