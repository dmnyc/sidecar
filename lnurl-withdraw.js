// Cash an LNURL-withdraw link (LUD-03) through the connected NWC wallet.
//
// NIP-47 has no withdraw command, because withdraw is a client protocol: the wallet makes
// an invoice and the CLIENT hands it to the service. So Sidecar does what a withdraw-capable
// wallet does. It reads the link, asks the wallet for an invoice in the service's range
// (make_invoice), sends that invoice to the service's callback, and then waits for the
// payment to land (lookup_invoice). Nothing here holds, rotates or splits anything: an
// LNURLcash note is an ordinary withdraw link whose k1 is the note, and it is cashed the same
// way.
//
// No user-facing text lives here. Every failure carries a `code` (and `domain` / `reason`
// where they help) and the panel words it through t(), so a translator sees whole sentences
// and a service's own words are only ever shown as data.
//
// Runs in the side-panel page (needs fetch and the panel's NWC client). The link is chosen
// by someone else, so every address it leads to goes through the private-network guard.

(function (root) {
  'use strict';

  const FETCH_TIMEOUT_MS = 10000;
  const BODY_MAX = 100000;       // characters of JSON we will read from a service
  const REASON_MAX = 200;        // characters of a service's own explanation we will show
  const DESC_MAX = 200;
  const POLL_FIRST_MS = 2000;
  const POLL_MAX_MS = 15000;
  const POLL_WINDOW_MS = 5 * 60 * 1000;

  const fail = (code, extra) => Object.assign(new Error(code), { code }, extra || {});

  // ---- bech32, for lnurl1… ------------------------------------------------------------
  //
  // LUD-01 puts a whole URL in the data part, so the 90-character limit BIP-173 sets for
  // addresses does not apply and must not be enforced. Checksum and charset are checked,
  // so a truncated paste reads as "not a link" rather than as a different link.
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

  function polymod(values) {
    let chk = 1;
    for (const v of values) {
      const top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
    }
    return chk >>> 0;
  }
  const hrpExpand = (hrp) => [...hrp].map((c) => c.charCodeAt(0) >> 5)
    .concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));

  // The URL inside an lnurl1… string, or null when it is not a well-formed one.
  function decodeLnurl(raw) {
    const s = String(raw || '').trim();
    if (!s || s !== s.toLowerCase() && s !== s.toUpperCase()) return null; // mixed case is invalid
    const str = s.toLowerCase();
    const sep = str.lastIndexOf('1');
    if (str.slice(0, sep) !== 'lnurl' || str.length - sep < 7) return null;
    const words = [];
    for (const c of str.slice(sep + 1)) {
      const v = CHARSET.indexOf(c);
      if (v === -1) return null;
      words.push(v);
    }
    if (polymod(hrpExpand('lnurl').concat(words)) !== 1) return null;
    // Regroup 5-bit words into bytes, dropping the six checksum words. Leftover bits must
    // be zero padding and fewer than five, or the string is not canonical.
    let acc = 0, bits = 0;
    const bytes = [];
    for (const w of words.slice(0, -6)) {
      acc = (acc << 5) | w;
      bits += 5;
      if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); acc &= (1 << bits) - 1; }
    }
    if (bits >= 5 || acc !== 0) return null;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)); } catch (_) { return null; }
  }

  // ---- reading the link ---------------------------------------------------------------

  const stripLightning = (s) => String(s || '').trim().replace(/^lightning:/i, '').trim();

  // Does this read as a withdraw-or-other-LNURL link at all? Cheap and offline: it decides
  // whether to take the text seriously, not whether the service will agree.
  function looksLikeLink(raw) {
    const s = stripLightning(raw);
    return /^lnurl1[a-z0-9]+$/i.test(s) || /^lnurlw:\/\/\S+$/i.test(s);
  }

  // The https URL a link points at. Throws { code } for a link that is not one, or that
  // leads somewhere Sidecar will not go.
  function parseLink(raw) {
    const s = stripLightning(raw);
    let url = null;
    if (/^lnurlw:\/\//i.test(s)) {
      // LUD-17: lnurlw:// is https, except for onion hosts, which are http.
      url = 'https://' + s.slice('lnurlw://'.length);
    } else if (/^lnurl1[a-z0-9]+$/i.test(s)) {
      url = decodeLnurl(s);
    }
    if (!url) throw fail('not-link');
    return checkedUrl(url, 'bad-link');
  }

  // A URL that is safe to request: https, no embedded credentials, and a public host.
  // Single-label names (http://intranet/) are refused as well as the private ranges,
  // because they resolve on the user's own network.
  function checkedUrl(raw, code) {
    let u;
    try { u = new URL(raw); } catch (_) { throw fail(code); }
    if (u.protocol !== 'https:') throw fail('insecure', { domain: u.hostname });
    if (u.username || u.password) throw fail(code);
    const host = u.hostname;
    const PH = root.SidecarPrivateHost;
    if (!PH || PH.isPrivateHostname(host) || (!host.includes('.') && !host.includes(':'))) {
      throw fail('private', { domain: host });
    }
    return u;
  }

  // Everything a service tells us is data. Collapsed to one line and clamped, so it cannot
  // push the sheet around or smuggle layout in.
  const oneLine = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

  // GET the link and read the withdrawRequest. Resolves with what the sheet shows:
  // { url, domain, callback, k1, minMsat, maxMsat, description }.
  async function fetchRequest(linkUrl, deps) {
    const u = linkUrl instanceof URL ? linkUrl : checkedUrl(linkUrl, 'bad-link');
    const body = await getJson(u, deps);
    return readRequest(u, body);
  }

  async function getJson(u, deps) {
    const f = (deps && deps.fetch) || root.fetch.bind(root);
    let res;
    try {
      res = await f(u.toString(), {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        // A redirect is a second address nobody checked. Withdraw services answer where
        // the link points, so refusing one costs nothing real.
        redirect: 'error',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (_) {
      throw fail('unreachable', { domain: u.hostname });
    }
    let text;
    try { text = await res.text(); } catch (_) { throw fail('unreachable', { domain: u.hostname }); }
    if (text.length > BODY_MAX) throw fail('bad-response', { domain: u.hostname });
    let body;
    try { body = JSON.parse(text); } catch (_) { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      // A web page where a withdraw service should be.
      throw fail('bad-response', { domain: u.hostname });
    }
    return body;
  }

  function readRequest(u, body) {
    const domain = u.hostname;
    if (body.status === 'ERROR') throw fail('refused', { domain, reason: oneLine(body.reason, REASON_MAX) });
    if (body.tag !== 'withdrawRequest') throw fail('not-withdraw', { domain });
    // k1 is opaque. It goes back exactly as received: never assumed to be 64 hex, never
    // trimmed or re-encoded, because some services use longer values.
    if (typeof body.k1 !== 'string' || !body.k1 || body.k1.length > 1024) throw fail('bad-response', { domain });
    if (typeof body.callback !== 'string') throw fail('bad-response', { domain });
    const callback = checkedUrl(body.callback, 'bad-response');
    const minMsat = Math.max(1, Math.ceil(Number(body.minWithdrawable)));
    const maxMsat = Math.floor(Number(body.maxWithdrawable));
    if (!Number.isSafeInteger(minMsat) || !Number.isSafeInteger(maxMsat) || maxMsat < minMsat) {
      throw fail('bad-limits', { domain });
    }
    return {
      url: u.toString(),
      domain,
      callback: callback.toString(),
      k1: body.k1,
      minMsat,
      maxMsat,
      description: oneLine(body.defaultDescription, DESC_MAX),
    };
  }

  // ---- the amount ---------------------------------------------------------------------

  // What the sheet may offer. A service that names one amount (an LNURLcash note always does)
  // gets no field. Otherwise whole sats from min to max; a range too narrow to hold a whole
  // sat is treated as its minimum.
  function amountRange(req) {
    const minSats = Math.ceil(req.minMsat / 1000);
    const maxSats = Math.floor(req.maxMsat / 1000);
    const fixed = req.minMsat === req.maxMsat || minSats > maxSats;
    return { fixed, minSats, maxSats, fixedMsat: req.minMsat };
  }

  // Millisats for a chosen number of sats, or null when it is outside the service's range.
  function msatFor(req, sats) {
    const r = amountRange(req);
    if (r.fixed) return r.fixedMsat;
    return Number.isInteger(sats) && sats >= r.minSats && sats <= r.maxSats ? sats * 1000 : null;
  }

  // ---- the wallet ---------------------------------------------------------------------

  // The NIP-47 `methods` list from get_info. Alby's own info endpoint answers with one
  // comma-separated string and a wallet may do the same over the wire, so both are read.
  function parseMethods(methods) {
    if (Array.isArray(methods)) return methods.map((m) => String(m).trim().toLowerCase()).filter(Boolean);
    if (typeof methods === 'string') return methods.split(/[\s,]+/).map((m) => m.trim().toLowerCase()).filter(Boolean);
    return [];
  }

  // Can this wallet connection make an invoice? UNKNOWN IS NOT NO: a wallet that told us
  // nothing usable is allowed to answer for itself, and a refusal then comes back as a
  // walletDenied the claim reports properly. Only a list that exists and leaves
  // make_invoice out hides the option.
  function canMakeInvoice(methods) {
    return !methods.length || methods.includes('make_invoice');
  }

  // Did lookup_invoice say the invoice was paid? Wallets differ in which field they fill.
  const isSettled = (inv) => !!(inv && (inv.settled_at || inv.preimage || inv.state === 'settled'));

  // ---- claiming -----------------------------------------------------------------------

  // Ask the wallet for an invoice and hand it to the service.
  //
  //   req         the object fetchRequest returned
  //   amountMsat  already chosen and inside the range (see msatFor)
  //   client      the panel's NWC client
  //   previous    the attempt a failed claim left behind, if any
  //
  // Resolves { attempt, state } where state is:
  //   'settled'  the previous attempt turned out to have been paid
  //   'accepted' the service answered OK. That may only mean the payment is in flight.
  //   'unsure'   the callback may or may not have arrived; treated like 'accepted'
  // Rejects with { code, attempt? }:
  //   'make-invoice'  the wallet answered no, nothing was sent anywhere (a wallet that did
  //                   not answer rethrows its own error, which reads as a sentence)
  //   'restricted'    the wallet connection does not allow make_invoice
  //   'refused'       the service said no, in its own words (reason)
  //   'unconfirmed'   there is an earlier attempt that cannot be ruled out; no new
  //                   invoice is made until it can be
  //
  // THE RULE THAT PREVENTS A DOUBLE PAYOUT: an invoice that went to the service is never
  // abandoned for a new one until lookup_invoice says it was not paid. A service that
  // answered OK may be paying it right now.
  async function claim({ req, amountMsat, client, fetch: fetchFn, previous }) {
    if (previous) {
      let inv;
      try { inv = await client.lookupInvoice(previous.lookupArg); } catch (_) { throw fail('unconfirmed', { attempt: previous }); }
      if (isSettled(inv)) return { attempt: previous, state: 'settled' };
    }

    let made;
    try {
      made = await client.makeInvoice(amountMsat, 'Withdraw from ' + req.domain);
    } catch (e) {
      const code = e && e.code;
      if (code === 'RESTRICTED' || code === 'NOT_IMPLEMENTED' || code === 'UNAUTHORIZED') throw fail('restricted');
      if (e && e.walletDenied) throw fail('make-invoice', { reason: e.message });
      // A timeout or a dropped relay already reads as a sentence about the wallet. Nothing
      // has gone to the service yet, so there is nothing to be unsure about.
      throw e;
    }
    const invoice = made && (made.invoice || made.payment_request || made.bolt11);
    if (!invoice || typeof invoice !== 'string') throw fail('make-invoice', { reason: '' });
    const attempt = {
      invoice,
      amountMsat,
      domain: req.domain,
      lookupArg: made.payment_hash ? { payment_hash: made.payment_hash } : { invoice },
    };

    const cb = new URL(req.callback);
    cb.searchParams.set('k1', req.k1);
    cb.searchParams.set('pr', invoice);
    let body = null;
    try { body = await getJson(cb, { fetch: fetchFn }); } catch (_) { return { attempt, state: 'unsure' }; }
    if (body.status === 'OK') return { attempt, state: 'accepted' };
    if (body.status === 'ERROR') {
      throw fail('refused', { domain: req.domain, reason: oneLine(body.reason, REASON_MAX), attempt });
    }
    return { attempt, state: 'unsure' };
  }

  // Wait for the payment to reach the wallet. Resolves:
  //   'settled'  lookup_invoice sees it
  //   'failed'   the wallet reports the invoice expired or failed
  //   'waiting'  the window ran out with nothing seen: the payment may still arrive, and
  //              the caller must not make another invoice on the strength of this
  //   'stopped'  isStopped() went true (the sheet was closed)
  // A lookup that errors is a missed poll, not an answer; the next one asks again.
  async function watch({ client, attempt, isStopped, sleep, now, windowMs }) {
    const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const clock = now || Date.now;
    const deadline = clock() + (windowMs == null ? POLL_WINDOW_MS : windowMs);
    let delay = POLL_FIRST_MS;
    for (;;) {
      await wait(delay);
      if (isStopped && isStopped()) return 'stopped';
      try {
        const inv = await client.lookupInvoice(attempt.lookupArg);
        if (isSettled(inv)) return 'settled';
        if (inv && (inv.state === 'expired' || inv.state === 'failed')) return 'failed';
      } catch (_) { /* keep waiting */ }
      if (clock() >= deadline) return 'waiting';
      delay = Math.min(Math.round(delay * 1.5), POLL_MAX_MS);
    }
  }

  root.SidecarLnurlWithdraw = {
    decodeLnurl, looksLikeLink, parseLink, fetchRequest, amountRange, msatFor,
    parseMethods, canMakeInvoice, isSettled, claim, watch,
  };
})(typeof self !== 'undefined' ? self : this);
