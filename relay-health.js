// Sidecar — relay health probing for the panel's NIP-65 editor (isolated module).
//
// WHY A PROBE AND NOT A CONNECTION COUNT. Every client that shows relay status shows
// whether a socket is open, because in a client the pool is already there and the answer
// is free. It is also nearly meaningless: a relay can complete the handshake and then
// never answer a query, or answer reads and silently refuse your writes. Both read as a
// green dot everywhere while quietly costing you posts. That silent case is the whole
// reason someone opens this screen, so the check has to be "did it actually serve me",
// not "did it pick up the phone".
//
// This is a port of scripts/relay-doctor.mjs (shipped 1.9.0, dev-only), whose probe() and
// classify() were written against plain WebSocket/fetch and are browser-portable as-is.
// The classification is deliberately IDENTICAL so the CLI and the panel cannot disagree
// about what "healthy" means — if you change a verdict here, change it there.
//
// Isolated (like relax-grants.js / zap-requests.js) so it can be unit-tested against
// fakes — see test/relay-health.test.js.

(function () {
  'use strict';

  // Shorter than the CLI's 6s/7s: this runs behind a button someone is watching, where a
  // slow relay is itself the answer. Long enough to clear a cold TLS handshake on a
  // distant relay, which is the case a too-eager timeout would libel as "down".
  const CONNECT_TIMEOUT = 5000;
  const READ_TIMEOUT = 6000;
  const NIP11_TIMEOUT = 5000;
  // Below the CLI's 8. A NIP-65 list is meant to be 2-4 relays (the panel warns when it
  // is not), so this is rarely the limit — it is here so a pathological list cannot open
  // twenty sockets at once from a side panel.
  const CONCURRENCY = 5;

  function httpFromWss(url) {
    return String(url).replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/+$/, '');
  }

  // NIP-11 relay information document. This is what makes write-safety knowable: it
  // reports payment/auth/write gating that a read probe cannot see, so a subscriber-only
  // relay is not misread as simply healthy.
  //
  // Reachable from here despite what you might expect. Most relays send
  // `Access-Control-Allow-Origin: *`, and an extension page holding host permissions is
  // not subject to CORS in the first place. It is still best-effort: `ok: false` only
  // costs the write verdict, never the read one.
  async function nip11(url, deps) {
    const f = (deps && deps.fetch) || fetch;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = setTimeout(() => { try { ctl && ctl.abort(); } catch (_) {} }, NIP11_TIMEOUT);
    try {
      const res = await f(httpFromWss(url), {
        headers: { Accept: 'application/nostr+json' },
        signal: ctl ? ctl.signal : undefined,
      });
      const body = await res.text();
      if (!res.ok) return { ok: false, status: res.status };
      const j = JSON.parse(body);
      const lim = j.limitation || {};
      return {
        ok: true,
        status: res.status,
        name: j.name || '',
        // NIP-11's own icon field. Better than guessing at /favicon.ico: it is what the
        // operator chose to represent the relay, and in practice it is widely set.
        icon: typeof j.icon === 'string' ? j.icon : '',
        paymentRequired: lim.payment_required === true,
        authRequired: lim.auth_required === true,
        restrictedWrites: lim.restricted_writes === true,
      };
    } catch (_) {
      return { ok: false, status: 0 };
    } finally {
      clearTimeout(t);
    }
  }

  // Open a socket, ask for one event, and time how long until EOSE. Proves the relay both
  // accepts a connection AND actually serves queries.
  //
  // With authorHex it asks for THAT author's notes, so `hasAuthorData` answers the
  // question the screen exists for: is this relay actually holding my events? A relay
  // that is up, serving, and empty of you is the one worth dropping, and no client shows
  // it today.
  // deps.onauth(template) -> signed kind:22242, when this relay is one the caller is
  // willing to identify to. Without it the probe stays anonymous and a challenge is
  // simply reported, which is what relay-doctor does — it has no key.
  function probe(url, authorHex, deps) {
    const WS = (deps && deps.WebSocket) || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    const onauth = deps && typeof deps.onauth === 'function' ? deps.onauth : null;
    return new Promise((resolve) => {
      const started = Date.now();
      let ws, settled = false, sawEvent = false, opened = 0;
      let readTimer;
      // NIP-42 state. `challenge` is remembered because a relay may send AUTH before we
      // ask for anything and only refuse the REQ afterwards.
      let challenge = '';
      // Set when the relay has asked for auth but has not yet sent a challenge to
      // answer. NIP-42 relays normally send AUTH first, but the two frames are
      // independent and a CLOSED can arrive ahead of the challenge; settling there would
      // report "demands AUTH" for a relay we were one frame away from signing in to.
      let wantAuth = false;
      let authTried = false;
      let authed = false;
      let authEventId = '';
      const done = (r) => {
        if (settled) return;
        settled = true;
        clearTimeout(connTimer);
        clearTimeout(readTimer);
        try { if (ws) ws.close(); } catch (_) {}
        resolve(r);
      };
      const connTimer = setTimeout(() => done({ up: false, reason: 'connect timeout' }), CONNECT_TIMEOUT);
      if (!WS) return done({ up: false, reason: 'no WebSocket' });
      try {
        ws = new WS(url);
      } catch (e) {
        return done({ up: false, reason: 'bad url (' + ((e && e.message) || e) + ')' });
      }
      ws.onopen = () => {
        opened = Date.now();
        clearTimeout(connTimer);
        readTimer = setTimeout(
          () => done({ up: true, served: false, connectMs: opened - started, reason: 'no EOSE' }),
          READ_TIMEOUT
        );
        sendReq();
      };

      function sendReq() {
        const filter = authorHex
          ? { kinds: [1], authors: [authorHex], limit: 1 }
          : { kinds: [1], limit: 1 };
        try { ws.send(JSON.stringify(['REQ', 'rh', filter])); } catch (_) {}
      }

      // Answer the challenge, then keep waiting rather than settling: the verdict this
      // screen exists for is "can I actually read from here", and that is only known
      // after the relay serves the retried REQ.
      function tryAuth() {
        if (!onauth || authTried || !challenge) return false;
        authTried = true;
        clearTimeout(readTimer);
        readTimer = setTimeout(
          () => done({ up: true, served: false, authChallenge: true, authFailed: true, connectMs: opened - started, reason: 'signed in but never answered' }),
          READ_TIMEOUT
        );
        Promise.resolve()
          .then(() => onauth({
            kind: 22242,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['relay', url], ['challenge', challenge]],
            content: '',
          }))
          .then((evt) => {
            if (settled || !evt) throw new Error('no auth event');
            authEventId = evt.id || '';
            ws.send(JSON.stringify(['AUTH', evt]));
          })
          .catch(() => {
            // Could not sign — locked keystore, no active account, a relay we are not
            // willing to identify to. Report it as the anonymous probe would have.
            done({ up: true, served: false, authChallenge: true, connectMs: opened - started, reason: 'demands AUTH' });
          });
        return true;
      }
      ws.onmessage = (m) => {
        let msg;
        try { msg = JSON.parse(String(m.data)); } catch (_) { return; }
        if (msg[0] === 'EVENT') sawEvent = true;
        if (msg[0] === 'AUTH') {
          challenge = msg[1] || '';
          // A relay that challenges on connect has not refused anything yet, so with a
          // signer we answer and carry on. Without one, the challenge IS the verdict.
          if (tryAuth()) return;
          if (!onauth && wantAuth) {
            return done({ up: true, served: false, authChallenge: true, connectMs: opened - started, reason: 'demands AUTH' });
          }
          if (!onauth) {
            return done({ up: true, served: false, authChallenge: true, connectMs: opened - started, reason: 'demands AUTH' });
          }
          return;
        }
        // The relay's verdict on our AUTH. A false here is a definitive refusal — the
        // subscription is lapsed, or this account is not on its list.
        if (msg[0] === 'OK' && authEventId && msg[1] === authEventId) {
          if (msg[2] === true) {
            authed = true;
            sendReq(); // retry the read now that it knows who we are
            return;
          }
          return done({ up: true, served: false, authChallenge: true, authFailed: true, connectMs: opened - started, reason: ('sign-in refused: ' + (msg[3] || '')).trim() });
        }
        if (msg[0] === 'CLOSED') {
          const needsAuth = /^auth-required/i.test(String(msg[2] || ''));
          // "auth-required: …" is a request, not a refusal — answer it and re-ask.
          if (needsAuth && tryAuth()) return;
          // STALE: this CLOSED refers to the REQ we sent before signing in, and it can
          // arrive while our AUTH is still in flight. relay.nostr.build does exactly
          // this. Settling here reported "demands AUTH" one frame before the relay was
          // ready to answer. The read timer still bounds the wait.
          if (needsAuth && authTried && !authed) return;
          // Asked for auth before sending a challenge: wait for it rather than settle.
          // The read timer still bounds this, so a relay that never follows through is
          // reported rather than hung on.
          if (needsAuth && onauth && !authTried) { wantAuth = true; return; }
          return done({ up: true, served: false, authed, authChallenge: !authed && needsAuth, connectMs: opened - started, reason: ('CLOSED: ' + (msg[2] || '')).trim() });
        }
        if (msg[0] === 'EOSE') {
          return done({
            up: true,
            served: true,
            authed,
            hasAuthorData: sawEvent,
            connectMs: opened - started,
            readMs: Date.now() - opened,
          });
        }
      };
      ws.onerror = () => done({ up: false, reason: 'connection refused' });
      ws.onclose = () => done({ up: false, reason: 'closed before serving' });
    });
  }

  // Verdicts, in the order they are decided. Kept identical to relay-doctor.mjs.
  //
  // writeSafe is false wherever we cannot show it is true, INCLUDING when NIP-11 could
  // not be read. That is the fail-safe direction for a keep-or-drop screen: telling
  // someone a relay accepts their posts when it may not is the answer that loses notes.
  // The UI distinguishes "known bad" from "unknown" via writeKnown rather than by
  // softening this.
  function classify(p, n11) {
    if (!p || !p.up) return { verdict: 'down', writeSafe: false, writeKnown: true, why: (p && p.reason) || 'unreachable' };
    // AUTH ANSWERED AND SERVED is a pass, not a gate.
    //
    // The probe only reaches here having signed in as the caller's account and read
    // back successfully, which is a STRONGER result than an anonymous healthy: it
    // proves this relay works for THIS account. Reporting it as auth-gated is what made
    // the panel tell the user to drop relays it had just fixed.
    //
    // Ordered before the authChallenge check so an answered challenge cannot fall into
    // it, and after `up` so a dead relay is still dead.
    if (p.authChallenge) {
      return {
        verdict: 'auth-gated',
        writeSafe: false,
        writeKnown: true,
        authed: false,
        why: p.authFailed ? (p.reason || 'sign-in refused') : 'demands NIP-42 AUTH',
      };
    }
    if (!p.served) return { verdict: 'not-serving', writeSafe: false, writeKnown: true, why: p.reason || 'connected but never answered' };
    const n = n11 || {};
    const gates = [];
    if (n.ok) {
      if (n.paymentRequired) gates.push('payment required');
      if (n.restrictedWrites) gates.push('restricted writes');
      if (n.authRequired) gates.push('auth required');
    }
    if (gates.length) return { verdict: 'gated', writeSafe: false, writeKnown: true, authed: !!p.authed, why: gates.join(', ') };
    // Served fine, but NIP-11 never answered — reads are proven, writes are not.
    if (!n.ok) return { verdict: 'healthy', writeSafe: false, writeKnown: false, authed: !!p.authed, why: '' };
    return { verdict: 'healthy', writeSafe: true, writeKnown: true, authed: !!p.authed, why: '' };
  }

  async function mapLimited(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (i < items.length) {
          const idx = i++;
          out[idx] = await fn(items[idx], idx);
        }
      })
    );
    return out;
  }

  // Probe a list. onResult fires per relay as it lands, so rows settle one at a time
  // rather than the whole list appearing after the slowest one — which on a list
  // containing a dead relay means staring at nothing for the full connect timeout.
  async function audit(urls, authorHex, opts) {
    const o = opts || {};
    return mapLimited(urls, o.concurrency || CONCURRENCY, async (url) => {
      // o carries onauth through to the probe, so a relay the caller is willing to
      // identify to is measured as that account sees it rather than anonymously.
      const [p, n] = await Promise.all([probe(url, authorHex, o), nip11(url, o)]);
      const r = Object.assign({ url, probe: p, nip11: n }, classify(p, n));
      if (typeof o.onResult === 'function') { try { o.onResult(r); } catch (_) {} }
      return r;
    });
  }

  const api = { CONNECT_TIMEOUT, READ_TIMEOUT, CONCURRENCY, httpFromWss, nip11, probe, classify, audit };
  if (typeof self !== 'undefined') self.SidecarRelayHealth = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarRelayHealth = api;
})();
