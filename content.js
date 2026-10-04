// Sidecar content script — bridges the page's window.nostr (nostr-provider.js) to the
// extension service worker. The provider itself is injected by the browser as a
// MAIN-world content script (see manifest.json) — guaranteed to run before any page
// script, and immune to page CSP, which could block the old <script src> injection
// on strict sites. This file relays each request to the background, attaching the
// TRUSTED host (taken from location here, never from the page), and posts the
// response back to the page.

(function () {
  'use strict';

  const host = location.host; // trusted origin identity (includes port, e.g. localhost:3000)

  // WHEN THE EXTENSION RESTARTS UNDER AN OPEN TAB. An update, a disable/enable, or Chrome
  // repairing the install all cut this script off from the extension — every chrome.* call
  // throws "Extension context invalidated" — while it stays in the page, still hearing
  // every window.nostr request. The browser does not inject a fresh copy into tabs that
  // were already open, so a long-lived client tab (Jumble) failed every signature until
  // it was reloaded, and nothing told the user why beyond "reload this page".
  //
  // The worker now injects a fresh copy into open tabs after any such restart (see
  // reconnectOpenTabs in background.js). This copy's job, once cut off, is to get out of
  // the way: take its card down and let the fresh copy answer (see handOff below).
  //
  // `rt` is captured, not looked up: whether an old and a new copy share a global is up to
  // the browser, and a check reading the global `chrome` could report the old copy alive.
  const rt = chrome.runtime;
  function extensionAlive() {
    try { return !!(rt && rt.id); } catch (_) { return false; }
  }
  // A live copy is already here (the manifest's injection and the worker's raced on a tab
  // that was still loading): answering every request twice is the one outcome to avoid.
  try {
    if (typeof window.__sidecarContentAlive === 'function' && window.__sidecarContentAlive()) return;
  } catch (_) {}
  window.__sidecarContentAlive = extensionAlive;
  const UPDATED_ERROR = 'Sidecar was updated — reload this page to reconnect.';

  // Whether this page is signed into Sidecar's signer. Seeded from the persistent
  // site binding on startup, then flipped live the moment the page successfully
  // uses window.nostr. The "Pay with Sidecar" card only shows when this is true:
  // a live invoice on a nostr client you're signed into is a real pay intent; an
  // invoice anywhere else is almost always noise (and invoices are time-sensitive).
  let connectedToSite = false;
  // Whether there is a wallet to pay WITH. Nothing is offered without one: a payment
  // that cannot succeed is pure interruption. Read once on load and re-read the moment
  // an invoice turns up while this is false, so connecting a wallet takes effect without
  // a page reload.
  let hasWallet = false;
  let walletAsked = '';
  // 'pill' or 'card' — which of the two is on screen, so a re-scan does not swap one for
  // the other underneath the user.
  let shownMode = '';

  const SCOPE_TO_TYPE = {
    nostr: 'SIDECAR_NOSTR_RPC',
    webln: 'SIDECAR_WEBLN_RPC',
  };

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.ext !== 'sidecar') return;

    // A fresh copy answered a request this cut-off copy stood aside for.
    if (d.kind === 'response') {
      const t = handoffs.get(d.id);
      if (t) { clearTimeout(t); handoffs.delete(d.id); }
      return;
    }

    // An invoice the page just copied to its own clipboard (see the writeText
    // wrapper in nostr-provider.js). Re-validated here rather than trusted: the
    // provider runs in the page world, so anything arriving on this channel is
    // page-controlled and gets the same regex and expiry check as an invoice
    // found in the DOM.
    if (d.kind === 'copied-invoice') {
      const m = INVOICE_TEXT_RE.exec(String(d.invoice || ''));
      if (!m) return;
      const inv = m[0].toLowerCase();
      if (invoiceExpired(inv)) return;
      copiedInvoice = inv;
      copiedAt = Date.now();
      scanForInvoice();
      return;
    }

    if (d.kind !== 'request') return;
    const type = SCOPE_TO_TYPE[d.scope];
    if (!type) return;

    if (!extensionAlive()) {
      retire();
      handOff(d);
      return;
    }

    // Always answer the page exactly once. If the service worker dies mid-request
    // (MV3 recycles it) the callback may never fire, which would hang the page's
    // window.nostr/webln promise — so a timeout guarantees a (failed) response.
    let replied = false;
    function post(response) {
      window.postMessage({ ext: 'sidecar', scope: d.scope, kind: 'response', id: d.id, response }, '*');
    }
    function reply(response) {
      if (replied) return;
      replied = true;
      clearTimeout(timer);
      try {
        post(response);
      } catch (e) {
        // postMessage rejects values it can't structured-clone (DataCloneError).
        // Re-post a clone-safe copy so the page's promise still settles instead
        // of hanging — and never let the failure surface as an uncaught error.
        let safe;
        try { safe = JSON.parse(JSON.stringify(response)); } catch (_) {
          safe = { ok: false, error: 'Sidecar response could not be delivered.' };
        }
        try { post(safe); } catch (_) {}
      }
    }
    const timer = setTimeout(
      () => reply({ ok: false, error: 'Sidecar did not respond (timed out). Try again.' }),
      180000
    );

    // MV3 evicts the service worker after ~30s idle. If that happens between the
    // page's call and our response, the request is lost: the page waits out its own
    // timeout and reports a failure for something Sidecar never even asked about.
    // Reported as "had to reload the extension to get Jumble to send the draft".
    //
    // Chrome distinguishes the two failure shapes through lastError.message, and only
    // ONE of them is safe to retry:
    //
    //   "Could not establish connection. Receiving end does not exist."
    //       The worker wasn't running and couldn't be woken; the message was NEVER
    //       delivered. Nothing was prompted, nothing signed. Retrying is safe.
    //
    //   "The message port closed before a response was received."
    //       The listener DID get it — the channel died before sendResponse. The user
    //       may already have approved, and the signature may exist. Retrying could
    //       prompt a second time and produce a SECOND signed event, which for a note
    //       means a duplicate post and for a payment means paying twice. Never retry.
    //
    // So the retry is deliberately narrow. Sending the same event twice is worse than
    // one clear failure, and the background has no request-level dedupe to fall back on.
    const RETRYABLE = /receiving end does not exist|could not establish connection/i;
    let attempted = 0;

    function dispatch() {
      attempted++;
      try {
        chrome.runtime.sendMessage(
          { type, scope: d.scope, method: d.method, params: d.params, host },
          function (response) {
            let err;
            try { err = chrome.runtime.lastError; } catch (_) {
              return reply({ ok: false, error: UPDATED_ERROR });
            }
            // Undelivered, and we haven't retried yet: wake the worker and try once
            // more. A short delay gives Chrome time to actually start it — an
            // immediate re-send usually races the same cold start and fails again.
            if (err && attempted === 1 && RETRYABLE.test(err.message || '')) {
              setTimeout(dispatch, 150);
              return;
            }
            // A successful nostr call means the page is signed in — unlock the pay
            // card and re-scan in case an invoice is already on screen.
            if (!err && d.scope === 'nostr' && response && response.ok && !connectedToSite) {
              connectedToSite = true;
              scheduleScan();
            }
            reply(err ? { ok: false, error: friendlyError(err.message) } : response);
          }
        );
      } catch (e) {
        // Only say "updated" when that is what happened. Anything else sendMessage throws
        // is reported as itself, so a report of this message means what it says.
        reply({
          ok: false,
          error: extensionAlive() ? 'Sidecar request failed: ' + ((e && e.message) || e) : UPDATED_ERROR,
        });
      }
    }
    dispatch();
  });

  // Requests this cut-off copy is leaving to a fresh one, by id. If none answers in time
  // (the worker could not inject one, or has not yet), the page still gets its promise
  // settled, with the one instruction that fixes it.
  const handoffs = new Map();
  const HANDOFF_MS = 2000;
  function handOff(d) {
    if (handoffs.has(d.id)) return;
    handoffs.set(d.id, setTimeout(() => {
      handoffs.delete(d.id);
      try {
        window.postMessage(
          { ext: 'sidecar', scope: d.scope, kind: 'response', id: d.id, response: { ok: false, error: UPDATED_ERROR } },
          '*'
        );
      } catch (_) {}
    }, HANDOFF_MS));
  }

  // Take this copy's card and invoice watching down for good, so a fresh copy's card is
  // not joined by a second one that can no longer pay anything.
  let retired = false;
  let scanObserver = null;
  function retire() {
    if (retired) return;
    retired = true;
    try { if (scanObserver) scanObserver.disconnect(); } catch (_) {}
    try { removeCard(); } catch (_) {}
  }

  // Turn Chrome's internal messaging errors into something a user can act on. The raw
  // strings name Chrome's plumbing ("the message port closed before a response was
  // received"), which reads as a Sidecar crash rather than the recoverable hiccup it is.
  function friendlyError(msg) {
    const m = String(msg || '');
    if (/message port closed/i.test(m)) {
      // The request reached Sidecar but the answer didn't come back. Deliberately does
      // NOT say "try again" without qualification: if the user already approved, the
      // event may have been signed and re-sending would duplicate it.
      return 'Sidecar lost the connection while handling this. Check whether it went through before retrying.';
    }
    if (/receiving end does not exist|could not establish connection/i.test(m)) {
      // Survived a retry, so Sidecar genuinely isn't reachable.
      return "Sidecar didn't respond. Make sure it's enabled, then try again.";
    }
    if (/context invalidated/i.test(m)) {
      return UPDATED_ERROR;
    }
    return m || 'Sidecar request failed.';
  }

  // ===== "Pay with Sidecar" confirmation card =====
  // When the page shows a Lightning invoice (a lightning: link, an input/QR value,
  // or a BOLT11 in the page text — e.g. a zap modal or Bitcoin Connect), present a
  // centered, style-isolated card over a dimmed backdrop showing what's being paid,
  // the amount, and the originating site, with one clear "Pay with Sidecar" action.
  // A corner pill kept getting buried under docked bars; a modal can't be lost.
  let showCard = true; // setting (default on)
  // >0 = auto-zap is off and enabling it would cover a zap up to this many sats, so
  // the card offers to switch it on. The card can't write the setting — the offer
  // rides along with the payment and is confirmed on Sidecar's own approval screen,
  // because a page must not be able to enable automatic spending by itself.
  let autoZapOffer = 0;
  let offerAutoZapChecked = false;
  let cardHost = null;
  let shownInvoice = '';
  let dismissedInvoice = '';

  // An invoice the page copied to the clipboard. Unlike a DOM invoice there is
  // nothing to keep re-deriving it from, and nothing that disappears when the
  // modal closes — so it carries its own expiry. Without one, a card could
  // outlive the modal that produced it and sit there long after the moment
  // passed. The BOLT11's own expiry still applies on top of this; this is only
  // the ceiling on how long a copy counts as a live intent to pay.
  let copiedInvoice = '';
  let copiedAt = 0;
  const COPIED_TTL_MS = 3 * 60 * 1000;
  let escHandler = null;
  let cardControls = null; // { invoice, setPaid, setError } for the card or indicator on screen
  // What the corner indicator is currently reporting, so a theme repaint can rebuild it
  // in the state it was in rather than restarting the spinner on a payment that landed.
  let flightAuto = false;
  let flightPaid = false;
  // A card with a decision out on it. Module scope rather than the card's own closure
  // because scanForInvoice has to see it: see the guard at the top of that function.
  let awaitingDecision = false;
  // The invoice of a `lightning:` link the person tapped. That card is theirs to close:
  // on a site not signed into Sidecar the scan would otherwise take it straight down,
  // and a checkout page with a countdown (BTCPay) re-scans every second.
  let tappedInvoice = '';
  let tappedHref = ''; // that link as the page wrote it, for "Open in another wallet"
  // Settings → "Show on unconnected sites" (default off): on a site not signed in with
  // Sidecar, a payment panel's invoice gets the corner pill, never the card by itself,
  // and a tapped lightning: link opens the card. Off, such sites are left entirely alone.
  let pillAnywhere = false;
  // THE OFFER. With that switch off, a tap on a lightning: link on such a site used to go
  // straight to the registered app, and nobody learned Sidecar could pay it. Now the first
  // tap opens the card as an offer ("Sidecar can pay this invoice"). Turning the switch on
  // is asked on Sidecar's own approval screen, never here. "Don't ask again" sets
  // payOfferDismissed, and taps go to the app as before.
  let payOfferDismissed = false;
  let offerInvoice = ''; // the invoice whose card is the offer, so a redraw keeps its wording

  function invoiceSats(bolt11) {
    const m = /^ln(?:bc|tb)(\d+)([munp]?)/i.exec(bolt11);
    if (!m || !m[1]) return null;
    const F = { m: 1e5, u: 1e2, n: 1e-1, p: 1e-4, '': 1e8 };
    return Math.round(Number(m[1]) * F[m[2].toLowerCase()]);
  }

  // Minimal BOLT11 decode of just the description ('d', tag 13) so the card can
  // show what's being paid (e.g. a zap memo). bech32, no dependencies.
  const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  function invoiceMemo(bolt11) {
    try {
      const s = bolt11.toLowerCase();
      const sep = s.lastIndexOf('1'); // bech32 separator (its data charset omits '1')
      if (sep < 1) return '';
      const words = [];
      for (const c of s.slice(sep + 1)) {
        const v = BECH32.indexOf(c);
        if (v < 0) return '';
        words.push(v);
      }
      const body = words.slice(0, words.length - 6); // drop the 6-word checksum
      const end = body.length - 104; // signature occupies the final 104 words
      let i = 7; // skip the 35-bit (7-word) timestamp
      while (i + 3 <= end) {
        const tag = body[i];
        const len = body[i + 1] * 32 + body[i + 2];
        const start = i + 3;
        if (start + len > end) break;
        if (tag === 13) { // 'd' = description
          let acc = 0, bits = 0;
          const bytes = [];
          for (let k = start; k < start + len; k++) {
            acc = (acc << 5) | body[k];
            bits += 5;
            if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
          }
          return new TextDecoder().decode(new Uint8Array(bytes)).trim();
        }
        i = start + len;
      }
    } catch (_) {}
    return '';
  }

  const INVOICE_RE = /ln(?:bc|tb)[0-9][a-z0-9]{20,}/i;
  const INVOICE_TEXT_RE = /ln(?:bc|tb)[0-9][a-z0-9]{40,}/i;
  // Elements that signal an active pay/zap prompt rather than an incidental
  // invoice in page content. A QR alongside the invoice is the strongest tell.
  const QR_SEL = 'canvas, img[alt*="qr" i], img[src*="qr" i], [class*="qr" i], [data-testid*="qr" i]';

  // Skip invoices that have already expired — a lingering or used invoice
  // shouldn't interrupt the user with a pay prompt. Decodes the BOLT11 timestamp
  // and `x` (expiry) field from its bech32 data (reuses BECH32 above). Defensive:
  // any parse doubt returns false (not expired) so a valid invoice is never
  // wrongly suppressed.
  function invoiceExpired(bolt11) {
    try {
      const s = bolt11.toLowerCase();
      const sep = s.lastIndexOf('1'); // bech32 data charset excludes '1'
      if (sep < 1) return false;
      const data = s.slice(sep + 1);
      if (data.length < 7 + 104 + 6) return false; // timestamp + sig + checksum
      const val = (c) => BECH32.indexOf(c);
      let ts = 0;
      for (let i = 0; i < 7; i++) { const v = val(data[i]); if (v < 0) return false; ts = ts * 32 + v; }
      let expiry = 3600; // BOLT11 default
      const taggedEnd = data.length - 110; // 104-symbol signature + 6-symbol checksum
      let i = 7;
      while (i + 3 <= taggedEnd) {
        const l1 = val(data[i + 1]); const l2 = val(data[i + 2]);
        if (l1 < 0 || l2 < 0) break;
        const len = l1 * 32 + l2;
        const start = i + 3;
        if (start + len > taggedEnd) break;
        if (data[i] === 'x') {
          let v = 0; let ok = true;
          for (let j = 0; j < len; j++) { const d = val(data[start + j]); if (d < 0) { ok = false; break; } v = v * 32 + d; }
          if (ok) expiry = v;
        }
        i = start + len;
      }
      if (!ts) return false;
      return Math.floor(Date.now() / 1000) > ts + (expiry || 3600) + 30; // 30s grace
    } catch (_) {
      return false;
    }
  }

  // Is this node inside a deliberate pay/zap surface — a modal dialog, a payment
  // web component (Bitcoin Connect / WalletConnect), or next to a QR — rather
  // than an invoice incidentally rendered in page content?
  // Page-level containers are never evidence of anything: body.querySelector finds a
  // modal's QR from anywhere in the document, which made every link on the page look
  // like a payment the moment one modal was open.
  const PAGE_LEVEL = new Set(['body', 'html', 'main', 'article', 'section']);

  // Small enough to be a payment panel rather than a page. 60 elements is generous for a
  // modal (amount, memo, QR, a couple of buttons) and nowhere near a timeline.
  function isPanelSized(el) {
    try { return el.querySelectorAll('*').length <= 60; } catch (_) { return false; }
  }

  // A modal by LAYOUT rather than by markup. Not every dialog sets role="dialog", and a
  // QR rendered as a plain data: <img> is invisible to QR_SEL, so a payment panel built
  // without either was indistinguishable from a link in a feed. What every one of them
  // does have is an ancestor pinned over the page.
  function isOverlay(el) {
    try {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed') return false;
      const z = Number(cs.zIndex);
      const r = el.getBoundingClientRect();
      const area = (r.width * r.height) / (innerWidth * innerHeight || 1);
      return (Number.isFinite(z) && z >= 10) || area >= 0.25;
    } catch (_) {
      return false;
    }
  }

  function hasPayIntent(el) {
    let node = el, hops = 0;
    while (node && hops < 24) {
      if (node.nodeType === 1) {
        const tag = (node.tagName || '').toLowerCase();
        if (/^(bc-|bci-|wcm-|w3m-)/.test(tag)) return true;
        if (node.getAttribute) {
          const role = node.getAttribute('role');
          if (role === 'dialog' || role === 'alertdialog' || node.getAttribute('aria-modal') === 'true') return true;
        }
        // A QR NEAR the invoice is evidence; a QR somewhere else on the page is not. Both
        // limits are load-bearing: the hop count keeps the search inside the thing the
        // invoice belongs to, and the size cap rejects an ancestor that is really the page
        // in disguise. Excluding body and main alone was not enough, because a wrapper div
        // around a whole feed reaches every QR in it just as well.
        if (hops <= 4 && node.querySelector && !PAGE_LEVEL.has(tag) && isPanelSized(node)) {
          try { if (node.querySelector(QR_SEL)) return true; } catch (_) {}
        }
        if (isOverlay(node)) return true;
      }
      node = node.parentNode || node.host || null;
      hops++;
    }
    return false;
  }

  // Returns a *payable* BOLT11 invoice on the page (lowercased) — one shown with
  // clear intent (a lightning: link, or an invoice inside a pay/zap modal or
  // beside a QR) and not expired. A bare invoice sitting in page text/content is
  // ignored so it can't interrupt the user. Returns '' when there's nothing to act on.
  // Returns '' or { invoice, asked } — `asked` meaning the page is already showing a
  // payment UI the user must have opened to get here. That distinction decides everything
  // downstream: a zap modal exists because somebody clicked zap, and interrupting them
  // with the card they were about to want is the whole point of the feature. A link
  // scrolling past in a feed is not that.
  function findPageInvoice() {
    // Pierce shadow DOM — web-component modals (e.g. Bitcoin Connect) render
    // inside a shadow root. Collect candidates across all roots, then qualify.
    const roots = [document];
    const fields = [];
    const qrEls = [];
    // The best UNASKED candidate, held back until every asked-for one has had its chance.
    // A link in a feed must never outrank a modal the user just opened, and links are
    // scanned first, so without this the timeline wins by being earlier in the document.
    let passive = '';
    for (let i = 0; i < roots.length && i < 2000; i++) {
      let links, inputs, qrs, all;
      try {
        links = roots[i].querySelectorAll('a[href^="lightning:" i]');
        inputs = roots[i].querySelectorAll('input, textarea');
        qrs = roots[i].querySelectorAll(QR_SEL);
        all = roots[i].querySelectorAll('*');
      } catch (_) {
        continue;
      }
      // 1) lightning: links — an explicit, user-clickable pay intent.
      for (const a of links) {
        const m = INVOICE_RE.exec((a.getAttribute('href') || '').replace(/^lightning:/i, ''));
        // A lightning: link gets the same question as an invoice in a field: is it inside
        // something the user opened? A link in a zap modal is the modal's own pay button
        // and belongs to the loud path; the identical link in a note scrolling past does
        // not. Without this the link branch, which runs first, stamped both as passive.
        if (!m) continue;
        const inv = m[0].toLowerCase();
        if (invoiceExpired(inv)) continue;
        if (hasPayIntent(a)) return { invoice: inv, asked: true };
        if (!passive) passive = inv;
      }
      for (const f of inputs) fields.push(f);
      for (const q of qrs) qrEls.push(q);
      for (const el of all) if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    // 2) invoice in an input/textarea, but only when shown in a pay/zap context.
    for (const f of fields) {
      const m = INVOICE_RE.exec(f.value || f.getAttribute('value') || '');
      if (!m) continue;
      const inv = m[0].toLowerCase();
      // hasPayIntent is the qualifier: a dialog, a modal, or a QR beside it. All of
      // those are on screen because the user opened them.
      if (!invoiceExpired(inv) && hasPayIntent(f)) return { invoice: inv, asked: true };
    }
    // 3) invoice rendered as text right beside a QR (the common zap-modal shape).
    for (const q of qrEls) {
      let node = q, hops = 0;
      while (node && hops < 6) {
        let text = '';
        try { text = node.innerText || node.textContent || ''; } catch (_) {}
        const m = INVOICE_TEXT_RE.exec(text);
        if (m) {
          const inv = m[0].toLowerCase();
          if (!invoiceExpired(inv)) return { invoice: inv, asked: true };
          break; // expired — move on to the next QR
        }
        node = node.parentNode || node.host || null;
        hops++;
      }
    }
    // 4) a link that was only ever sitting there. After the two asked-for shapes above,
    // so a modal always outranks the timeline behind it, and before the clipboard for the
    // reason the next comment gives.
    if (passive) return { invoice: passive, asked: false };

    // 5) an invoice the page copied to the clipboard. Last, so an explicit
    // lightning: link or a visible invoice still wins — those are the same
    // payment described more directly, and re-derived fresh on every scan.
    if (copiedInvoice) {
      // Dropped here rather than at each of the four places that dismiss an
      // invoice — paid, declined, dismissed, stopped waiting. One expiry point
      // means a new dismissal path can't forget to clear it.
      if (
        copiedInvoice === dismissedInvoice ||
        Date.now() - copiedAt > COPIED_TTL_MS ||
        invoiceExpired(copiedInvoice)
      ) {
        copiedInvoice = '';
        copiedAt = 0;
      } else {
        // A copy is a gesture, but there is no payment UI on screen to tie it to, so it
        // stays quiet. When the copy came from a modal the QR branch above has already
        // claimed it with asked: true.
        return { invoice: copiedInvoice, asked: false };
      }
    }
    return '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // THE PILL AND CARD FOLLOW THE BROWSER'S LANGUAGE, through chrome.i18n and _locales,
  // never Sidecar's own setting (docs/i18n-design.md §3.2). They sit in OPEN shadow roots
  // this page can read, and the page already knows the browser's language from
  // navigator.language, so following it reveals nothing new; following a different
  // in-app choice would hand every site one more fingerprinting bit.
  //
  // msg() falls back to the English written here if a message is missing, so a gap in a
  // locale is English, never a blank button. `subs` fill $1, $2 in order.
  const UI_LANG = (() => { try { return chrome.i18n.getUILanguage(); } catch (_) { return 'en-US'; } })();
  function msg(name, fallback, subs) {
    let out = '';
    try { out = chrome.i18n.getMessage(name, subs); } catch (_) {}
    if (!out) {
      out = fallback;
      (subs || []).forEach((v, i) => { out = out.split('$' + (i + 1)).join(v); });
    }
    return out;
  }
  // For innerHTML: the message ESCAPED, then markup set where each placeholder was, so a
  // translation can never put markup into a page, and a bold amount stays code-built.
  function msgHtml(name, fallback, marks) {
    const tokens = marks.map((_, i) => '\u0001' + i + '\u0001');
    let out = escapeHtml(msg(name, fallback, tokens));
    marks.forEach((m, i) => { out = out.split(tokens[i]).join(m); });
    return out;
  }
  // Amounts in the browser's own number format: en-US's for an English browser, as before.
  const fmtAmount = (n) => { try { return new Intl.NumberFormat(UI_LANG).format(n); } catch (_) { return String(n); } };
  function bolt(cls) {
    return (
      '<svg class="' + cls + '" viewBox="0 0 55 94" fill="currentColor">' +
      '<path d="M35.563 0V40.406H54.969L21.016 93.75V51.719H0L35.563 0Z"/></svg>'
    );
  }

  // The real Sidecar wordmark (glass + lettering), inlined so it renders inside the
  // page's shadow DOM with no web-accessible file and immune to the page's img-src
  // CSP. Keeps its brand colors instead of inheriting currentColor.
  const LOGO_SVG =
    '<svg class="brand-logo" viewBox="0 0 824 226" fill="none" aria-label="Sidecar">' +
    '<path d="M200.381 0C200.381 55.1291 155.609 99.8203 100.381 99.8203C45.1539 99.8203 0.381226 55.1281 0.381226 0H200.381Z" fill="#fff"/>' +
    '<path d="M200.381 0H100.929V99.807C155.904 99.5108 200.381 54.9449 200.381 0Z" fill="#d0d1d3"/>' +
    '<path d="M194.685 33.2253H6.07739C19.1073 70.0701 53.1779 96.9858 93.8872 99.5944V213.036H62.2426C58.6556 213.036 55.7495 215.937 55.7495 219.518C55.7495 223.098 58.6556 225.999 62.2426 225.999H138.52C142.107 225.999 145.013 223.098 145.013 219.518C145.013 215.937 142.107 213.036 138.52 213.036H106.876V99.5944C147.584 96.9858 181.655 70.0701 194.685 33.2253Z" fill="#FFA01B"/>' +
    '<path d="M194.685 33.2253H100.927V226H138.519C142.106 226 145.012 223.099 145.012 219.519C145.012 215.938 142.106 213.037 138.519 213.037H106.874V99.5944C147.584 96.9858 181.655 70.0701 194.685 33.2253Z" fill="#EA772F"/>' +
    '<path d="M811.269 182.788C813.862 182.788 817.175 181.635 821.208 179.331C822.649 179.331 823.369 179.907 823.369 181.059C823.369 181.924 822.937 182.644 822.072 183.22C821.496 183.796 818.904 184.804 814.294 186.245C809.685 187.685 805.94 188.405 803.059 188.405C793.552 188.405 788.799 185.381 788.799 179.331C788.799 177.026 789.375 174.577 790.528 171.985C791.968 169.392 792.688 167.663 792.688 166.799C792.688 165.935 792.4 165.503 791.824 165.503C786.062 167.519 777.708 172.561 766.761 180.627L736.08 219.086C733.775 221.967 731.615 223.407 729.598 223.407C727.294 223.407 726.141 222.687 726.141 221.247C726.141 219.806 727.15 217.502 729.166 214.333L756.39 180.195C758.406 177.602 762.151 172.705 767.625 165.503C773.099 158.301 776.268 153.98 777.132 152.539C778.284 151.099 780.301 150.379 783.181 150.379C786.35 150.379 787.935 150.955 787.935 152.107C787.935 153.259 787.647 154.124 787.071 154.7L781.021 163.342C780.157 164.495 779.148 165.647 777.996 166.799C780.589 166.223 790.96 161.038 809.109 151.243C809.685 150.955 810.693 150.811 812.134 150.811C813.574 150.811 814.294 151.243 814.294 152.107C814.294 152.683 814.006 153.403 813.43 154.268C813.142 154.844 811.702 156.716 809.109 159.885C803.923 166.223 801.331 170.976 801.331 174.145C801.331 179.907 804.644 182.788 811.269 182.788Z" fill="#BDA1FF"/>' +
    '<path d="M656.691 216.061C667.926 216.061 680.458 210.3 694.286 198.776C708.114 186.965 716.18 176.882 718.485 168.528C718.485 165.071 716.324 162.19 712.003 159.885C707.682 157.293 702.784 155.996 697.311 155.996C684.059 155.996 671.815 161.758 660.58 173.281C649.633 184.516 644.16 194.455 644.16 203.098C644.16 211.74 648.337 216.061 656.691 216.061ZM701.2 149.082C711.283 149.082 719.637 152.683 726.263 159.885C726.551 159.885 728.856 157.725 733.177 153.403C735.193 150.235 737.498 148.65 740.091 148.65C742.684 148.65 743.98 149.946 743.98 152.539L742.251 156.428C741.387 157.869 735.626 164.927 724.966 177.602C714.596 190.278 708.546 197.768 706.817 200.073C705.377 202.377 704.657 205.834 704.657 210.444C704.657 213.613 706.673 215.197 710.706 215.197C719.061 215.197 730.872 208.283 746.14 194.455C747.005 193.303 747.869 192.727 748.733 192.727C749.886 192.727 750.462 193.447 750.462 194.887C750.462 198.344 744.556 203.818 732.745 211.308C721.221 218.798 710.85 222.543 701.632 222.543C695.294 222.543 692.125 219.23 692.125 212.604C692.125 210.3 691.693 209.147 690.829 209.147C690.253 209.147 689.821 209.291 689.532 209.579C675.128 219.086 661.445 223.839 648.481 223.839C635.805 223.839 629.467 218.078 629.467 206.555C629.467 194.455 636.669 181.924 651.074 168.96C665.478 155.708 682.186 149.082 701.2 149.082Z" fill="#BDA1FF"/>' +
    '<path d="M566.074 226C544.756 226 534.097 219.086 534.097 205.258C534.097 192.871 541.587 180.195 556.567 167.231C571.547 153.98 587.104 147.354 603.236 147.354C619.657 147.354 627.867 152.683 627.867 163.342C627.867 169.968 624.554 175.874 617.928 181.059C611.303 186.245 605.253 188.837 599.779 188.837C594.594 188.837 590.705 187.829 588.112 185.813C585.807 183.508 584.655 181.491 584.655 179.763C584.655 177.746 585.663 175.586 587.68 173.281C589.985 170.688 591.857 169.248 593.297 168.96C595.89 168.96 597.187 170.112 597.187 172.417C597.187 172.993 596.898 173.713 596.322 174.577C595.746 175.154 595.458 177.026 595.458 180.195C595.458 182.5 597.043 183.652 600.211 183.652C603.668 183.652 607.125 182.068 610.582 178.899C614.327 175.442 616.2 171.409 616.2 166.799C616.2 157.004 610.726 152.107 599.779 152.107C588.832 152.107 577.453 158.013 565.642 169.824C553.83 181.347 547.925 192.294 547.925 202.665C547.925 214.189 556.135 219.95 572.556 219.95C595.89 219.95 615.768 211.452 632.188 194.455C633.053 193.303 633.917 192.727 634.781 192.727C635.934 192.727 636.51 193.591 636.51 195.319C636.51 196.76 634.205 199.785 629.596 204.394C624.986 209.003 616.92 213.757 605.397 218.654C593.874 223.551 580.766 226 566.074 226Z" fill="#BDA1FF"/>' +
    '<path d="M467.756 198.776V201.801C500.021 189.414 516.153 177.026 516.153 164.639C516.153 158.301 512.12 155.132 504.054 155.132C496.276 155.132 488.21 160.029 479.855 169.824C471.789 179.619 467.756 189.27 467.756 198.776ZM526.957 161.182C526.957 178.467 507.655 193.447 469.052 206.122C471.357 212.748 477.695 216.061 488.065 216.061C505.638 216.061 522.347 208.859 538.192 194.455C539.056 193.303 539.92 192.727 540.784 192.727C541.937 192.727 542.513 193.735 542.513 195.751C542.513 197.48 539.92 200.505 534.735 204.826C529.549 209.147 522.203 213.324 512.696 217.358C503.19 221.391 493.827 223.407 484.609 223.407C465.019 223.407 455.224 216.205 455.224 201.801C455.224 189.99 461.13 178.034 472.941 165.935C485.041 153.836 498.004 147.786 511.832 147.786C521.915 147.786 526.957 152.251 526.957 161.182Z" fill="#BDA1FF"/>' +
    '<path d="M424.905 52.7189C424.905 65.6826 428.794 78.2142 436.572 90.3136C444.35 102.413 454.721 110.911 467.685 115.809C476.615 89.8815 481.081 67.6992 481.081 49.262C481.081 21.8942 472.294 8.21032 454.721 8.21032C447.231 8.21032 441.037 11.5233 436.14 18.1491C428.65 28.232 424.905 39.7553 424.905 52.7189ZM414.966 146.922C420.151 146.922 424.761 147.93 428.794 149.946C433.115 151.963 436.14 154.124 437.868 156.428L440.029 159.453C440.029 162.91 438.589 164.639 435.708 164.639C433.979 164.639 432.683 163.486 431.819 161.182C425.769 156.284 418.855 153.836 411.077 153.836C397.537 153.836 385.726 159.309 375.643 170.256C365.56 181.203 360.519 191.718 360.519 201.801C360.519 211.884 365.416 216.925 375.211 216.925C392.496 216.925 409.06 207.851 424.905 189.702C441.037 171.553 454.289 149.226 464.66 122.723C451.12 118.69 439.597 110.623 430.09 98.5239C420.584 86.4245 415.83 73.7489 415.83 60.4971C415.83 47.2454 419.575 33.8496 427.065 20.3097C434.844 6.76991 445.215 0 458.178 0C467.685 0 475.607 4.75334 481.945 14.26C488.571 23.7667 491.884 36.7304 491.884 53.1511C491.884 69.5717 486.986 91.3219 477.192 118.402C479.496 118.978 482.953 119.266 487.563 119.266C506.864 119.266 524.005 111.344 538.985 95.4991C542.73 91.754 545.179 89.8815 546.331 89.8815C547.772 89.8815 548.492 90.8897 548.492 92.9063C548.492 94.6348 547.339 96.6514 545.035 98.956C528.038 116.529 506.864 125.315 481.513 125.315C478.344 125.315 476.039 125.171 474.599 124.883C463.076 153.115 447.951 176.882 429.226 196.184C410.789 215.197 390.623 224.704 368.729 224.704C356.053 224.704 349.715 218.078 349.715 204.826C349.715 191.574 355.765 178.611 367.865 165.935C380.252 153.259 395.953 146.922 414.966 146.922Z" fill="#BDA1FF"/>' +
    '<path d="M375.39 109.759C372.797 112.64 371.501 115.377 371.501 117.969C371.501 121.714 373.517 123.587 377.55 123.587C379.567 123.587 382.015 122.435 384.896 120.13C388.065 117.825 389.65 115.377 389.65 112.784C389.65 110.191 388.929 108.319 387.489 107.166C386.337 105.726 384.608 105.006 382.304 105.006C380.287 105.006 377.982 106.59 375.39 109.759ZM310.571 210.444C310.571 213.613 312.588 215.197 316.621 215.197C324.975 215.197 336.787 208.283 352.055 194.455C352.919 193.303 353.783 192.727 354.648 192.727C355.8 192.727 356.376 193.447 356.376 194.887C356.376 198.344 350.471 203.818 338.659 211.308C327.136 218.798 316.765 222.543 307.546 222.543C301.209 222.543 298.04 219.23 298.04 212.604C298.04 208.859 299.912 204.394 303.657 199.208C305.098 197.48 306.97 195.319 309.275 192.727C311.58 189.846 313.596 187.253 315.325 184.948C317.341 182.644 321.23 178.178 326.992 171.553C332.754 164.639 337.219 159.165 340.388 155.132C343.845 151.099 346.149 148.65 347.302 147.786C348.454 146.634 349.75 146.057 351.191 146.057C352.919 146.057 354.216 146.489 355.08 147.354C356.232 148.218 356.808 149.226 356.808 150.379C356.808 151.531 355.944 152.971 354.216 154.7L321.806 191.43C314.316 199.496 310.571 205.834 310.571 210.444Z" fill="#BDA1FF"/>' +
    '<path d="M200.691 204.394C200.691 195.751 204.148 188.693 211.062 183.22C217.976 177.746 225.466 175.01 233.532 175.01C241.886 175.01 246.063 178.611 246.063 185.813C246.063 188.982 244.911 192.15 242.606 195.319C240.59 198.488 238.285 200.073 235.693 200.073C233.388 200.073 232.236 199.208 232.236 197.48C232.236 195.463 233.1 193.591 234.828 191.862C236.845 190.134 237.853 188.405 237.853 186.677C237.853 181.779 235.548 179.331 230.939 179.331C226.33 179.331 221.865 181.491 217.543 185.813C213.51 189.846 211.494 194.743 211.494 200.505C211.494 205.978 212.934 210.588 215.815 214.333C218.696 218.078 223.161 219.95 229.211 219.95C235.548 219.95 240.878 217.358 245.199 212.172C249.809 206.699 253.266 200.217 255.57 192.727C257.875 184.948 260.324 177.17 262.916 169.392C265.797 161.614 269.974 155.132 275.448 149.946C281.209 144.473 287.403 141.736 294.029 141.736C300.655 141.736 305.84 142.888 309.585 145.193C313.331 147.21 315.203 149.946 315.203 153.403C315.203 156.86 313.763 160.173 310.882 163.342C308.289 166.511 305.408 168.096 302.239 168.096C299.07 168.096 297.342 167.375 297.054 165.935C297.054 163.63 298.638 161.614 301.807 159.885C303.536 159.309 304.4 157.293 304.4 153.836C304.4 149.226 301.231 146.922 294.893 146.922C288.556 146.922 283.226 151.099 278.905 159.453C274.584 167.519 271.271 176.45 268.966 186.245C266.949 195.751 262.34 204.682 255.138 213.036C247.936 221.103 238.285 225.136 226.186 225.136C218.696 225.136 212.79 223.407 208.469 219.95C204.148 216.493 201.843 213.036 201.555 209.579L200.691 204.394Z" fill="#BDA1FF"/>' +
    '</svg>';

  // The quiet state. A corner pill, no overlay and no dialog role, because an invoice
  // nobody asked to pay is a fact rather than a question: it should be possible to ignore
  // it for the whole session without ever reading it. Tapping it opens the card below,
  // which is where the decision and the spend live.
  const PILL_CSS =
    '.pw{position:fixed;right:18px;bottom:18px;z-index:2147483647;' +
    'font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
    'opacity:0;transform:translateY(6px);transition:opacity .18s ease,transform .18s ease;}' +
    '.pw.in{opacity:1;transform:none;}' +
    '.pill{display:flex;align-items:center;gap:8px;padding:8px 10px 8px 11px;border-radius:999px;' +
    'border:1px solid {CARD_BORDER};{CARD_COLOR};' +
    // The card's own background, held at CARD SCALE rather than stretched to a pill: it is
    // two layers, and a radial tuned for a 340px card turns into a wash of its own top
    // corner at this size. Opaque either way, which a pill sitting on someone else's page
    // has to be.
    'background:{CARD_BACKGROUND};background-size:340px 240px;background-position:50% 0;' +
    'box-shadow:0 8px 24px rgba(0,0,0,0.38);cursor:pointer;font-size:13px;line-height:1;}' +
    '.pill:hover{border-color:{CARD_BORDER_FAINT};}' +
    '.pill .b{width:13px;height:auto;flex:0 0 auto;{CARD_GOLD};}' +
    '.pill .t{white-space:nowrap;}' +
    '.pill .t b{font-weight:600;}' +
    '.x{all:unset;cursor:pointer;padding:2px 4px;margin-left:2px;border-radius:6px;opacity:.55;font-size:14px;}' +
    '.x:hover{opacity:1;}' +
    // THE SAME CORNER, ONCE THE MONEY IS ALREADY MOVING (#270). Pay is pressed, the NWC
    // request is published, and nothing left on screen can stop it, so a full-page
    // overlay holding a disabled button was asking for attention that had nothing to buy.
    // The status moves down here, where everything Sidecar says about a payment nobody
    // has to answer already lives. Not pressable, because there is nothing left to press:
    // the .x still closes it, and closing it does not close the payment.
    '.pill.flight{cursor:default;}' +
    '.pill .sp{box-sizing:border-box;width:13px;height:13px;flex:0 0 auto;border-radius:50%;' +
    'border:2px solid currentColor;border-top-color:transparent;opacity:.5;animation:sc-spin .7s linear infinite;}' +
    '@keyframes sc-spin{to{transform:rotate(360deg);}}' +
    '.pill .ck{display:none;width:14px;height:14px;flex:0 0 auto;{CARD_SUCCESS};}' +
    '.pill.paid .sp{display:none;}' +
    '.pill.paid .ck{display:block;}' +
    '@media (prefers-reduced-motion:reduce){.pw{transition:none;}.pill .sp{animation:none;}}' +
    // A theme's own additions, last so they win ties. Empty for every theme but the few
    // whose look is a matter of shape rather than color (see CARD_EXTRA below).
    '{CARD_EXTRA}';

  const CARD_CSS =
    '.ov{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;' +
    'background:rgba(6,2,16,0.62);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);' +
    'font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;opacity:0;transition:opacity .18s ease;}' +
    '.ov.in{opacity:1;}' +
    '.card{box-sizing:border-box;width:100%;max-width:340px;text-align:center;{CARD_COLOR};padding:26px 24px 18px;' +
    'border-radius:20px;border:1px solid {CARD_BORDER};' +
    'background:{CARD_BACKGROUND};' +
    'box-shadow:0 24px 70px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.05);' +
    'transform:translateY(10px) scale(.985);transition:transform .2s cubic-bezier(.2,.8,.2,1);}' +
    '.ov.in .card{transform:none;}' +
    '.brand{display:flex;justify-content:center;}' +
    '.brand-logo{height:26px;width:auto;display:block;}' +
    '.eyebrow{margin-top:16px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;{CARD_MUTED};}' +
    '.amt{margin:7px 0 0;display:flex;align-items:baseline;justify-content:center;gap:6px;}' +
    '.amt .num{font-size:42px;font-weight:800;line-height:1;{CARD_GOLD};letter-spacing:-.01em;}' +
    '.amt .unit{font-size:15px;font-weight:600;{CARD_MUTED};}' +
    '.memo{margin:14px auto 0;max-width:282px;font-size:13.5px;line-height:1.5;{CARD_TEXT_2};overflow-wrap:anywhere;' +
    'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}' +
    '.site{margin-top:10px;font-size:12px;{CARD_MUTED};overflow-wrap:anywhere;text-wrap:balance;}' +
    '.site b{color:{CARD_LAV};font-weight:600;}' +
    '.pay{margin-top:20px;width:100%;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;' +
    'border:none;border-radius:13px;padding:14px;font-size:15px;font-weight:700;{CARD_PAY_TEXT};' +
    'background:{CARD_PAY_BG};' +
    'box-shadow:0 8px 22px {CARD_PAY_SHADOW},inset 0 1px 0 rgba(255,255,255,0.45);transition:filter .12s ease,transform .12s ease;}' +
    '.pay:hover{filter:brightness(1.05);}' +
    '.pay:active{transform:translateY(1px);}' +
    // There is no pending state on this button any more. Pressing Pay hands the payment
    // to the corner indicator and tears the card down, so the only thing left to draw is
    // an invoice that settled somewhere else while the card sat open, which must stop it
    // being pressed a second time.
    '.pay.done{cursor:default;background:none;box-shadow:none;{CARD_SUCCESS};}' +
    '.pay-bolt{height:16px;width:auto;display:block;}' +
    '.pay.done .pay-bolt{display:none;}' +
    '.pay-check{display:none;width:18px;height:18px;}' +
    '.pay.done .pay-check{display:block;}' +
    '.pay-status{margin-top:11px;font-size:12px;line-height:1.45;{CARD_MUTED};text-wrap:balance;}' +
    '.pay-status.err{{CARD_WARN};}' +
    '.cancel{margin-top:8px;width:100%;cursor:pointer;border:none;background:none;{CARD_MUTED};font-size:13px;padding:9px;border-radius:10px;}' +
    '.cancel:hover{color:{CARD_TEXT};background:{CARD_CANCEL_BG};}' +
    '.other{margin-top:8px;width:100%;cursor:pointer;border:none;background:none;{CARD_MUTED};font-size:13px;padding:9px;border-radius:10px;}' +
    '.other:hover{color:{CARD_TEXT};background:{CARD_CANCEL_BG};}' +
    // THE DECISION IS OUT, AND THE CARD IS STILL DOING A JOB. Sidecar is asking for
    // approval on its own surface, and until that comes back this overlay is the only
    // thing standing between the person and the page's own payment UI: a "Connect Wallet
    // to Pay" button that routes back here through the injected window.webln, and a QR a
    // phone can scan. Both are live the whole time, and either one is a second payment
    // for the same invoice. So the card stays, Not now goes (there is nothing to decide
    // here any more, and Reject is in Sidecar), and the Pay button is flattened into a
    // status line rather than left sitting there looking pressable.
    '.card.busy .cancel{display:none;}' +
    '.card.busy .other{display:none;}' +
    '.card.busy .tg{opacity:.4;pointer-events:none;}' +
    '.card.busy .pay{background:none;box-shadow:none;cursor:default;font-weight:600;color:{CARD_TEXT};}' +
    '.card.busy .pay:hover{filter:none;}' +
    '.card.busy .pay-bolt{display:none;}' +
    '.tg{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding-top:14px;' +
    'border-top:1px solid {CARD_BORDER_FAINT};cursor:pointer;}' +
    '.tg-label{font-size:12px;{CARD_MUTED};}' +
    '.tg-input{position:absolute;opacity:0;width:0;height:0;}' +
    '.tg-track{position:relative;flex-shrink:0;width:38px;height:22px;border-radius:11px;background:{CARD_TRACK};transition:background .15s ease;}' +
    '.tg-thumb{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#1c0c00;transition:transform .15s ease;}' +
    '.tg-input:checked~.tg-track .tg-thumb{transform:translateX(16px);}' +
    '.tg-input:not(:checked)~.tg-track{background:{CARD_TOGGLE_OFF};}' +
    '.tg-input:not(:checked)~.tg-track .tg-thumb{background:{CARD_THUMB_OFF};}' +
    '{CARD_EXTRA}';

  // Current theme for the payment card. Asked for at load and re-asked on any settings
  // or binding change, so a theme change in the panel also reaches pages already open.
  // The card can auto-render the moment an invoice is detected (before the answer
  // arrives), so if a card is on screen when the theme resolves, it's re-rendered in the
  // correct scheme. Defaults to speakeasy.
  //
  // ASKED FOR, not read from storage, and resolved by the background: it is the theme of
  // THE ACCOUNT THIS SITE IS BOUND TO (background.js, the clamped GET_SETTINGS). Themes
  // are per account, and three wrong answers shipped before this one:
  //   - settings.theme alone froze the card, since a per-account pick never writes it;
  //   - a "last theme picked anywhere" field matched only the account picked for most
  //     recently, so with two styled accounts the card was usually the wrong one;
  //   - the ACTIVE account's theme would match the panel, but the active identity can be
  //     one this site has never seen, and a card that changed colour on a switch is a
  //     switch detector a page can poll by cycling the invoice.
  // The bound account is the one whose pubkey this site already holds, so its theme is
  // not news to it, and it is what the panel shows whenever the site you are zapping on
  // is the account you are in.
  let cardTheme = 'speakeasy';
  // Keyed off one set rather than a chain of !==. The chain form silently dropped any
  // theme nobody remembered to add here, and the card then rendered in the wrong palette
  // with no error anywhere — see the THEME_VARS table below, which it must stay in step
  // with.
  const CARD_THEMES = new Set(['speakeasy', 'metropolis', 'film-noir', 'brownstone', 'nixie', 'cast-iron', 'wabi-sabi', 'constellation', 'jazz-age', 'departures', 'industria', 'aegean', 'bauhaus', 'populuxe', 'par-avion', 'werkstatte', 'ukiyo-e', 'mycelium', 'ben-day', 'turnstile', 'sleepy-hollow']);
  // Renamed themes, mapped on read — see the note beside THEME_ALIASES in sidepanel.js
  // for why the stored value is not rewritten.
  const THEME_ALIASES = { 'art-deco': 'industria' };
  function setCardTheme(t) {
    t = THEME_ALIASES[t] || t;
    if (!CARD_THEMES.has(t)) return;
    if (t === cardTheme) return;
    cardTheme = t;
    // Repaint whatever is actually showing, IN ITS OWN MODE. This used to call
    // renderCard unconditionally, which turned a pill into a full card the moment the
    // theme reply landed, and turned a payment already in flight into a fresh offer to
    // pay it.
    if (cardHost && shownInvoice) {
      if (shownMode === 'pill') renderPill(shownInvoice);
      else if (shownMode === 'flight') {
        const wasPaid = flightPaid;
        renderFlightPill(shownInvoice, flightAuto);
        if (wasPaid && cardControls) cardControls.setPaid();
      } else renderCard(shownInvoice);
    }
  }
  // The settings read below carries it too, but that one races the first scan; this asks
  // as early as possible so a card detected immediately still opens in the right palette.
  function askCardTheme() {
    try {
      chrome.runtime.sendMessage({ type: 'SIDECAR_GET_SETTINGS' }, (s) => {
        if (chrome.runtime.lastError) return; // keep whatever we have
        setCardTheme((s && s.result && s.result.cardTheme) || '');
      });
    } catch (_) { /* keep speakeasy default */ }
  }
  askCardTheme();
  try {
    // Re-ask rather than read the new value: the resolved answer depends on this site's
    // binding as well as the settings, and only the background may join those two.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.sidecar_settings || changes.sidecar_site_accounts)) askCardTheme();
    });
  } catch (_) { /* storage unavailable — keep speakeasy default */ }

  // Get theme colors for payment card theming
  // Ben Day's yellow dot wash (themes/ben-day-dots-wash.svg, from scripts/gen-ben-day.py),
  // inlined for the pay card. The card is in someone else's page, and pointing it at the
  // extension's file would mean making that file fetchable by any site, which is a way to
  // detect Sidecar; a data URI fetches nothing. Regenerate the file and paste its
  // URL-encoded text here if the wash changes (test/pay-card-themes.test.js compares them).
  const BEN_DAY_WASH = 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2236%22%20height=%22180%22%20viewBox=%220%200%2036%20180%22%3E%3Cg%20fill=%22%23FFD84D%22%3E%3Ccircle%20cx=%220.00%22%20cy=%223.90%22%20r=%223.50%22/%3E%3Ccircle%20cx=%229.00%22%20cy=%223.90%22%20r=%223.50%22/%3E%3Ccircle%20cx=%2218.00%22%20cy=%223.90%22%20r=%223.50%22/%3E%3Ccircle%20cx=%2227.00%22%20cy=%223.90%22%20r=%223.50%22/%3E%3Ccircle%20cx=%2236.00%22%20cy=%223.90%22%20r=%223.50%22/%3E%3Ccircle%20cx=%224.50%22%20cy=%2211.69%22%20r=%223.29%22/%3E%3Ccircle%20cx=%2213.50%22%20cy=%2211.69%22%20r=%223.29%22/%3E%3Ccircle%20cx=%2222.50%22%20cy=%2211.69%22%20r=%223.29%22/%3E%3Ccircle%20cx=%2231.50%22%20cy=%2211.69%22%20r=%223.29%22/%3E%3Ccircle%20cx=%220.00%22%20cy=%2219.49%22%20r=%223.09%22/%3E%3Ccircle%20cx=%229.00%22%20cy=%2219.49%22%20r=%223.09%22/%3E%3Ccircle%20cx=%2218.00%22%20cy=%2219.49%22%20r=%223.09%22/%3E%3Ccircle%20cx=%2227.00%22%20cy=%2219.49%22%20r=%223.09%22/%3E%3Ccircle%20cx=%2236.00%22%20cy=%2219.49%22%20r=%223.09%22/%3E%3Ccircle%20cx=%224.50%22%20cy=%2227.28%22%20r=%222.89%22/%3E%3Ccircle%20cx=%2213.50%22%20cy=%2227.28%22%20r=%222.89%22/%3E%3Ccircle%20cx=%2222.50%22%20cy=%2227.28%22%20r=%222.89%22/%3E%3Ccircle%20cx=%2231.50%22%20cy=%2227.28%22%20r=%222.89%22/%3E%3Ccircle%20cx=%220.00%22%20cy=%2235.07%22%20r=%222.70%22/%3E%3Ccircle%20cx=%229.00%22%20cy=%2235.07%22%20r=%222.70%22/%3E%3Ccircle%20cx=%2218.00%22%20cy=%2235.07%22%20r=%222.70%22/%3E%3Ccircle%20cx=%2227.00%22%20cy=%2235.07%22%20r=%222.70%22/%3E%3Ccircle%20cx=%2236.00%22%20cy=%2235.07%22%20r=%222.70%22/%3E%3Ccircle%20cx=%224.50%22%20cy=%2242.87%22%20r=%222.50%22/%3E%3Ccircle%20cx=%2213.50%22%20cy=%2242.87%22%20r=%222.50%22/%3E%3Ccircle%20cx=%2222.50%22%20cy=%2242.87%22%20r=%222.50%22/%3E%3Ccircle%20cx=%2231.50%22%20cy=%2242.87%22%20r=%222.50%22/%3E%3Ccircle%20cx=%220.00%22%20cy=%2250.66%22%20r=%222.31%22/%3E%3Ccircle%20cx=%229.00%22%20cy=%2250.66%22%20r=%222.31%22/%3E%3Ccircle%20cx=%2218.00%22%20cy=%2250.66%22%20r=%222.31%22/%3E%3Ccircle%20cx=%2227.00%22%20cy=%2250.66%22%20r=%222.31%22/%3E%3Ccircle%20cx=%2236.00%22%20cy=%2250.66%22%20r=%222.31%22/%3E%3Ccircle%20cx=%224.50%22%20cy=%2258.46%22%20r=%222.13%22/%3E%3Ccircle%20cx=%2213.50%22%20cy=%2258.46%22%20r=%222.13%22/%3E%3Ccircle%20cx=%2222.50%22%20cy=%2258.46%22%20r=%222.13%22/%3E%3Ccircle%20cx=%2231.50%22%20cy=%2258.46%22%20r=%222.13%22/%3E%3Ccircle%20cx=%220.00%22%20cy=%2266.25%22%20r=%221.94%22/%3E%3Ccircle%20cx=%229.00%22%20cy=%2266.25%22%20r=%221.94%22/%3E%3Ccircle%20cx=%2218.00%22%20cy=%2266.25%22%20r=%221.94%22/%3E%3Ccircle%20cx=%2227.00%22%20cy=%2266.25%22%20r=%221.94%22/%3E%3Ccircle%20cx=%2236.00%22%20cy=%2266.25%22%20r=%221.94%22/%3E%3Ccircle%20cx=%224.50%22%20cy=%2274.05%22%20r=%221.76%22/%3E%3Ccircle%20cx=%2213.50%22%20cy=%2274.05%22%20r=%221.76%22/%3E%3Ccircle%20cx=%2222.50%22%20cy=%2274.05%22%20r=%221.76%22/%3E%3Ccircle%20cx=%2231.50%22%20cy=%2274.05%22%20r=%221.76%22/%3E%3Ccircle%20cx=%220.00%22%20cy=%2281.84%22%20r=%221.58%22/%3E%3Ccircle%20cx=%229.00%22%20cy=%2281.84%22%20r=%221.58%22/%3E%3Ccircle%20cx=%2218.00%22%20cy=%2281.84%22%20r=%221.58%22/%3E%3Ccircle%20cx=%2227.00%22%20cy=%2281.84%22%20r=%221.58%22/%3E%3Ccircle%20cx=%2236.00%22%20cy=%2281.84%22%20r=%221.58%22/%3E%3Ccircle%20cx=%224.50%22%20cy=%2289.63%22%20r=%221.41%22/%3E%3Ccircle%20cx=%2213.50%22%20cy=%2289.63%22%20r=%221.41%22/%3E%3Ccircle%20cx=%2222.50%22%20cy=%2289.63%22%20r=%221.41%22/%3E%3Ccircle%20cx=%2231.50%22%20cy=%2289.63%22%20r=%221.41%22/%3E%3Ccircle%20cx=%220.00%22%20cy=%2297.43%22%20r=%221.24%22/%3E%3Ccircle%20cx=%229.00%22%20cy=%2297.43%22%20r=%221.24%22/%3E%3Ccircle%20cx=%2218.00%22%20cy=%2297.43%22%20r=%221.24%22/%3E%3Ccircle%20cx=%2227.00%22%20cy=%2297.43%22%20r=%221.24%22/%3E%3Ccircle%20cx=%2236.00%22%20cy=%2297.43%22%20r=%221.24%22/%3E%3Ccircle%20cx=%224.50%22%20cy=%22105.22%22%20r=%221.08%22/%3E%3Ccircle%20cx=%2213.50%22%20cy=%22105.22%22%20r=%221.08%22/%3E%3Ccircle%20cx=%2222.50%22%20cy=%22105.22%22%20r=%221.08%22/%3E%3Ccircle%20cx=%2231.50%22%20cy=%22105.22%22%20r=%221.08%22/%3E%3Ccircle%20cx=%220.00%22%20cy=%22113.02%22%20r=%220.92%22/%3E%3Ccircle%20cx=%229.00%22%20cy=%22113.02%22%20r=%220.92%22/%3E%3Ccircle%20cx=%2218.00%22%20cy=%22113.02%22%20r=%220.92%22/%3E%3Ccircle%20cx=%2227.00%22%20cy=%22113.02%22%20r=%220.92%22/%3E%3Ccircle%20cx=%2236.00%22%20cy=%22113.02%22%20r=%220.92%22/%3E%3Ccircle%20cx=%224.50%22%20cy=%22120.81%22%20r=%220.76%22/%3E%3Ccircle%20cx=%2213.50%22%20cy=%22120.81%22%20r=%220.76%22/%3E%3Ccircle%20cx=%2222.50%22%20cy=%22120.81%22%20r=%220.76%22/%3E%3Ccircle%20cx=%2231.50%22%20cy=%22120.81%22%20r=%220.76%22/%3E%3Ccircle%20cx=%220.00%22%20cy=%22128.60%22%20r=%220.62%22/%3E%3Ccircle%20cx=%229.00%22%20cy=%22128.60%22%20r=%220.62%22/%3E%3Ccircle%20cx=%2218.00%22%20cy=%22128.60%22%20r=%220.62%22/%3E%3Ccircle%20cx=%2227.00%22%20cy=%22128.60%22%20r=%220.62%22/%3E%3Ccircle%20cx=%2236.00%22%20cy=%22128.60%22%20r=%220.62%22/%3E%3Ccircle%20cx=%224.50%22%20cy=%22136.40%22%20r=%220.47%22/%3E%3Ccircle%20cx=%2213.50%22%20cy=%22136.40%22%20r=%220.47%22/%3E%3Ccircle%20cx=%2222.50%22%20cy=%22136.40%22%20r=%220.47%22/%3E%3Ccircle%20cx=%2231.50%22%20cy=%22136.40%22%20r=%220.47%22/%3E%3C/g%3E%3C/svg%3E';

  // Ben Day's ZAP! burst (themes/ben-day-zap.svg, from scripts/gen-ben-day.py), inlined
  // for the page-side strike for the same reason as the wash above; the panel shows the
  // same picture on its own strike. test/pay-card-themes.test.js compares the two.
  const BEN_DAY_ZAP = 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22220%22%20height=%22160%22%20viewBox=%220%200%20220%20160%22%3E%3Cpolygon%20points=%22110.0,6.0%20123.7,31.9%20144.2,21.2%20148.9,39.3%20181.3,29.2%20168.2,52.8%20188.8,56.8%20178.7,70.4%20218.2,80.0%20178.7,89.6%20196.5,105.5%20168.2,107.2%20179.9,129.7%20148.9,120.7%20141.8,134.7%20123.7,128.1%20110.0,155.5%2096.3,128.1%2075.0,140.2%2071.1,120.7%2037.9,131.3%2051.8,107.2%2029.3,103.8%2041.3,89.6%202.9,80.0%2041.3,70.4%2026.4,55.4%2051.8,52.8%2041.6,31.3%2071.1,39.3%2077.0,23.3%2096.3,31.9%22%20fill=%22%23FFD400%22%20stroke=%22%23111111%22%20stroke-width=%224%22%20stroke-linejoin=%22miter%22/%3E%3Cg%20transform=%22translate(110.0%2082.0)%20rotate(-7)%20skewX(-10)%20scale(0.92)%22%20fill-rule=%22evenodd%22%3E%3Cg%20transform=%22translate(4%204)%22%20fill=%22%23111111%22%20stroke=%22%23111111%22%20stroke-width=%225%22%20stroke-linejoin=%22round%22%3E%3Cpath%20transform=%22translate(-67.5%20-25)%22%20d=%22M0%200H34V9L13%2041H34V50H0V41L21%209H0Z%22/%3E%3Cpath%20transform=%22translate(-29.5%20-25)%22%20d=%22M0%2050L12%200H26L38%2050H27L24.6%2039H13.4L11%2050ZM15.4%2030H22.6L19%2013Z%22/%3E%3Cpath%20transform=%22translate(12.5%20-25)%22%20d=%22M0%200H22C31%200%2036%206%2036%2015C36%2024%2031%2030%2022%2030H11V50H0ZM11%209V21H21C24%2021%2025.5%2019%2025.5%2015C25.5%2011%2024%209%2021%209Z%22/%3E%3Cpath%20transform=%22translate(52.5%20-25)%22%20d=%22M2%200H13L11%2034H4ZM2.5%2039H12.5V50H2.5Z%22/%3E%3C/g%3E%3Cg%20fill=%22%23C8102E%22%20stroke=%22%23111111%22%20stroke-width=%225%22%20stroke-linejoin=%22round%22%20paint-order=%22stroke%22%3E%3Cpath%20transform=%22translate(-67.5%20-25)%22%20d=%22M0%200H34V9L13%2041H34V50H0V41L21%209H0Z%22/%3E%3Cpath%20transform=%22translate(-29.5%20-25)%22%20d=%22M0%2050L12%200H26L38%2050H27L24.6%2039H13.4L11%2050ZM15.4%2030H22.6L19%2013Z%22/%3E%3Cpath%20transform=%22translate(12.5%20-25)%22%20d=%22M0%200H22C31%200%2036%206%2036%2015C36%2024%2031%2030%2022%2030H11V50H0ZM11%209V21H21C24%2021%2025.5%2019%2025.5%2015C25.5%2011%2024%209%2021%209Z%22/%3E%3Cpath%20transform=%22translate(52.5%20-25)%22%20d=%22M2%200H13L11%2034H4ZM2.5%2039H12.5V50H2.5Z%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E';

  // A LETTERED CARD (Ben Day's Bangers on the amount and the Pay button). The card is in
  // the page and a font declared inside its shadow root is ignored, so the face is
  // registered with the page's document.fonts, and only for as long as a card is up:
  // the page can see it then, when the card already shows Sidecar is here, and not
  // otherwise. The bytes come from the background (SIDECAR_CARD_FONT) the first time
  // such a card opens, never from a web-accessible file a site could probe for.
  // Each lettered theme has its own faces (Ben Day's Bangers; Turnstile's enamel-sign
  // gothic for the lettering and a heavy grotesque for the figures), each fetched once and
  // kept by theme and role, since a page can show cards for two accounts in different
  // themes. Only the open card's faces are ever registered.
  const CARD_FONT_FACES = {
    'ben-day': { lettering: 'Sidecar Card Lettering' },
    turnstile: { lettering: 'Sidecar Card Lettering', figures: 'Sidecar Card Figures' },
  };
  const cardFontBytes = {};
  const cardFontFaces = {};
  const cardFontAsked = {};
  let cardFontMounted = [];
  function mountCardFont() {
    const theme = cardTheme;
    if (!Object.prototype.hasOwnProperty.call(CARD_FONT_FACES, theme)) return;
    unmountCardFont();
    for (const [face, family] of Object.entries(CARD_FONT_FACES[theme])) {
      const key = theme + ':' + face;
      const add = () => {
        try {
          const f = cardFontFaces[key] || (cardFontFaces[key] = new FontFace(family, cardFontBytes[key], { display: 'swap' }));
          if (!document.fonts.has(f)) document.fonts.add(f);
          if (!cardFontMounted.includes(f)) cardFontMounted.push(f);
          f.load().catch(() => {});
        } catch (_) { /* decoration: the card falls back to the system face */ }
      };
      if (cardFontBytes[key]) { add(); continue; }
      if (cardFontAsked[key]) continue;
      cardFontAsked[key] = true;
      try {
        chrome.runtime.sendMessage({ type: 'SIDECAR_CARD_FONT', theme, face }, (r) => {
          if (chrome.runtime.lastError || !r || !r.ok || typeof r.result !== 'string') { cardFontAsked[key] = false; return; }
          const bin = atob(r.result);
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          cardFontBytes[key] = u8.buffer;
          // Only if a card in that theme is still up: one closed while the bytes were in
          // flight must not leave the face registered behind it.
          if (cardHost && shownMode === 'card' && cardTheme === theme) add();
        });
      } catch (_) { cardFontAsked[key] = false; }
    }
  }
  function unmountCardFont() {
    for (const f of cardFontMounted) {
      try { if (document.fonts.has(f)) document.fonts.delete(f); } catch (_) {}
    }
    cardFontMounted = [];
  }

  function getThemeColors() {
    // Default to speakeasy theme if not set
    const themeColors = {
      speakeasy: {
        CARD_COLOR: 'color:#f1e8f8',
        CARD_BORDER: 'rgba(203,161,78,0.45)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(203,161,78,0.16),transparent 58%),linear-gradient(165deg,#23114a,#160a30)',
        CARD_MUTED: 'color:#9a86c4',
        CARD_GOLD: 'color:#cba14e',
        CARD_TEXT_2: 'color:#e8d5f0',
        CARD_LAV: '#bda1ff',
        CARD_PAY_TEXT: 'color:#1c0c00',
        CARD_PAY_BG: 'linear-gradient(180deg,#f6a85a,#ed8a3c 52%,#dd6f23)',
        CARD_CANCEL_BG: 'rgba(167,139,250,0.10)',
        CARD_TEXT: '#f1e8f8',
        CARD_BORDER_FAINT: 'rgba(167,139,250,0.16)',
        CARD_TOGGLE_OFF: 'rgba(167,139,250,0.25)',
        CARD_TRACK: '#cba14e',
        CARD_THUMB_OFF: '#9a86c4',
        CARD_WARN: 'color:#ffb38a',
        CARD_SUCCESS: 'color:#6ee7a8',
        CARD_PAY_SHADOW: 'rgba(221,111,35,0.36)'
      },
      /* Film Noir — black and white: the page-side card follows the panel's grayscale,
         white pay button and all, and the logo keeps its colors, as it does in the panel.
         CARD_GOLD is the amount slot and takes the balance's near-white. Mirrors
         themes/film-noir.css. */
      'film-noir': {
        CARD_COLOR: 'color:#e0e0e0',
        CARD_BORDER: 'rgba(192,192,192,0.30)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(255,255,255,0.06),transparent 58%),linear-gradient(165deg,#1e1e1e,#0a0a0a)',
        CARD_MUTED: 'color:#a0a0a0',
        CARD_GOLD: 'color:#f5f5f5',
        CARD_TEXT_2: 'color:#c0c0c0',
        CARD_LAV: '#e0e0e0',
        CARD_PAY_TEXT: 'color:#0a0a0a',
        CARD_PAY_BG: 'linear-gradient(180deg,#ffffff,#e4e4e4 52%,#b8b8b8)',
        CARD_CANCEL_BG: 'rgba(192,192,192,0.10)',
        CARD_TEXT: '#e0e0e0',
        CARD_BORDER_FAINT: 'rgba(192,192,192,0.12)',
        CARD_TOGGLE_OFF: 'rgba(192,192,192,0.20)',
        CARD_TRACK: '#c0c0c0',
        CARD_THUMB_OFF: '#a0a0a0',
        CARD_WARN: 'color:#d0d0d0',
        CARD_SUCCESS: 'color:#b0b0b0',
        CARD_PAY_SHADOW: 'rgba(255,255,255,0.14)'
      },
      'industria': {
        CARD_COLOR: 'color:#2a2a2a',
        CARD_BORDER: 'rgba(197,160,89,0.40)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(212,175,55,0.15),transparent 58%),linear-gradient(165deg,#E6DCC8,#F0EAD6)',
        CARD_MUTED: 'color:#6a6a6a',
        CARD_GOLD: 'color:#D4AF37',
        CARD_TEXT_2: 'color:#4a4a4a',
        CARD_LAV: '#8B7355',
        CARD_PAY_TEXT: 'color:#1a1a1a',
        CARD_PAY_BG: 'linear-gradient(180deg,#C5A059,#B8860B 52%,#8B7355)',
        CARD_CANCEL_BG: 'rgba(197,160,89,0.15)',
        CARD_TEXT: '#2a2a2a',
        CARD_BORDER_FAINT: 'rgba(139,115,85,0.20)',
        CARD_TOGGLE_OFF: 'rgba(139,115,85,0.25)',
        CARD_TRACK: '#D4AF37',
        CARD_THUMB_OFF: '#6a6a6a',
        CARD_WARN: 'color:#a8521f',
        CARD_SUCCESS: 'color:#2f7d52',
        CARD_PAY_SHADOW: 'rgba(184,134,11,0.36)'
      },
      // Aegean — marble, Aegean blue, Attic gold. Mirrors themes/aegean.css;
      // the card carries its own copy because it renders in the page's shadow DOM
      // with no access to the extension's stylesheets.
      // Brownstone — a dark theme, so the card keeps the light wordmark and the
      // near-black button text the other dark themes use.
      brownstone: {
        CARD_COLOR: 'color:#F2E7DD',
        CARD_BORDER: 'rgba(201,139,94,0.32)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(224,169,74,0.13),transparent 58%),linear-gradient(165deg,#1B1310,#120C0A)',
        CARD_MUTED: 'color:#A89383',
        CARD_GOLD: 'color:#E0A94A',
        CARD_TEXT_2: 'color:#D8C7B8',
        CARD_LAV: '#D69A6A',
        CARD_PAY_TEXT: 'color:#241A15',
        CARD_PAY_BG: 'linear-gradient(180deg,#F0C46B,#E0A94A 52%,#B48230)',
        CARD_CANCEL_BG: 'rgba(201,139,94,0.14)',
        CARD_TEXT: '#F2E7DD',
        CARD_BORDER_FAINT: 'rgba(201,139,94,0.18)',
        CARD_TOGGLE_OFF: 'rgba(201,139,94,0.25)',
        CARD_TRACK: '#E0A94A',
        CARD_THUMB_OFF: '#A89383',
        CARD_WARN: 'color:#C4574A',
        CARD_SUCCESS: 'color:#8FA05E',
        CARD_PAY_SHADOW: 'rgba(224,169,74,0.34)'
      },
      aegean: {
        CARD_COLOR: 'color:#14232E',
        CARD_BORDER: 'rgba(11,87,164,0.30)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(21,101,192,0.10),transparent 58%),linear-gradient(165deg,#FFFFFF,#F4F7F9)',
        CARD_MUTED: 'color:#5A6B78',
        // The amount slot. Blue here for the same reason the wallet balance is —
        // gold on whitewash reads as mustard. Mirrors themes/aegean.css.
        CARD_GOLD: 'color:#0B57A4',
        CARD_TEXT_2: 'color:#2C3E4C',
        CARD_LAV: '#1565C0',
        // White on the cobalt fill; the other themes' near-black is unreadable there.
        CARD_PAY_TEXT: 'color:#FFFFFF',
        CARD_PAY_BG: 'linear-gradient(180deg,#2A7BD4,#1565C0 52%,#0B4F94)',
        CARD_CANCEL_BG: 'rgba(11,87,164,0.10)',
        CARD_TEXT: '#14232E',
        CARD_BORDER_FAINT: 'rgba(11,87,164,0.16)',
        CARD_TOGGLE_OFF: 'rgba(11,87,164,0.25)',
        CARD_TRACK: '#1565C0',
        CARD_THUMB_OFF: '#5A6B78',
        CARD_WARN: 'color:#A8432A',
        CARD_SUCCESS: 'color:#4F6B3A',
        CARD_PAY_SHADOW: 'rgba(21,101,192,0.32)'
      },
      /* Cast Iron — jet cast metal, gray-warm steel accents, no whites and no gold.
         Mirrors themes/cast-iron.css. CARD_GOLD is the theme's --balance-ink
         (#968e7c, same value its struck figures wear) per the bauhaus note below;
         on this plate it clears large-text 3:1 with room to spare. The pay button
         reuses the raised-metal ramp the unread badge and End disc use in the side
         panel: pale metal fill, sunk-die ink — the one loud object short of the
         danger reds, because a pay button should not have to be hunted for.
         CARD_PAY_SHADOW is a plain dark seating rather than the colored glows the
         other themes throw, matching the theme's shadow tokens. */
      'cast-iron': {
        CARD_COLOR: 'color:#a59d8b',
        CARD_BORDER: 'rgba(216,209,196,0.12)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(216,209,196,0.06),transparent 58%),linear-gradient(165deg,#131110,#050404)',
        CARD_MUTED: 'color:#857d6c',
        CARD_GOLD: 'color:#968e7c',
        CARD_TEXT_2: 'color:#938b7a',
        CARD_LAV: '#948c79',
        CARD_PAY_TEXT: 'color:#12100e',
        CARD_PAY_BG: 'linear-gradient(180deg,#c5bdac,#b3ab99 52%,#948c79)',
        CARD_CANCEL_BG: 'rgba(197,189,175,0.08)',
        CARD_TEXT: '#a59d8b',
        CARD_BORDER_FAINT: 'rgba(216,209,196,0.08)',
        CARD_TOGGLE_OFF: 'rgba(197,189,175,0.22)',
        CARD_TRACK: '#b9b19f',
        CARD_THUMB_OFF: '#938b7a',
        CARD_WARN: 'color:#a98f6f',
        CARD_SUCCESS: 'color:#7f9a88',
        CARD_PAY_SHADOW: 'rgba(0,0,0,0.45)'
      },
      /* Metropolis — soot, concrete and tarnished brass. Mirrors themes/metropolis.css;
         the card carries its own copy because it renders in the page's shadow DOM with
         no access to the extension's stylesheets.
         CARD_GOLD is the theme's --balance-ink rather than its --gold, per the Bauhaus
         note below: its one use in CARD_CSS is the amount at display size, where the
         bar is WCAG large text at 3.0:1 and the lit brass is the right value.
         CARD_LAV takes the theme's re-pointed --lav (brass, not lavender), since the
         theme's whole argument is that nothing here is purple.
         Nothing mirrors the strike — that is one @keyframes block on the side panel's
         balance, and this card has no balance animation to hang it on. */
      metropolis: {
        CARD_COLOR: 'color:#E8E0D0',
        CARD_BORDER: 'rgba(168,132,60,0.34)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(168,132,60,0.14),transparent 58%),linear-gradient(165deg,#241F1A,#0D0C0A)',
        CARD_MUTED: 'color:#9A8F7C',
        CARD_GOLD: 'color:#E3B55C',
        CARD_TEXT_2: 'color:#C9BFAC',
        CARD_LAV: '#DCC084',
        CARD_PAY_TEXT: 'color:#17120A',
        CARD_PAY_BG: 'linear-gradient(180deg,#EBC97A,#C9A24A 52%,#8F6C28)',
        CARD_CANCEL_BG: 'rgba(168,132,60,0.12)',
        CARD_TEXT: '#E8E0D0',
        CARD_BORDER_FAINT: 'rgba(168,132,60,0.18)',
        CARD_TOGGLE_OFF: 'rgba(168,132,60,0.25)',
        CARD_TRACK: '#D3A94E',
        CARD_THUMB_OFF: '#9A8F7C',
        CARD_WARN: 'color:#E9A85E',
        CARD_SUCCESS: 'color:#7FB88C',
        CARD_PAY_SHADOW: 'rgba(168,132,60,0.30)'
      },
      /* Bauhaus — plaster, black rule lines, flat planes of primary. Mirrors
         themes/bauhaus.css; the card carries its own copy because it renders in the
         page's shadow DOM with no access to the extension's stylesheets. (Its font is
         the system stack at the top of CARD_CSS, so the theme's display face does not
         reach here and nothing about that needs mirroring.)
         Two values do NOT follow the theme file's naming and both are deliberate:
         CARD_GOLD is the theme's --balance-ink, NOT its --gold. Its one use in CARD_CSS
         is the amount at 42px/800, which is WCAG large text at 3.0:1 — so it takes the
         loud orange (3.79:1 on this card) for the same reason the side panel's balance
         does, and would fail the 4.5:1 bar --gold has to clear. If CARD_GOLD ever gains
         a second, smaller use, it needs splitting the way styles.css split the two.
         CARD_PAY_BG is a flat fill rather than the three-stop ramp every other theme
         uses here, matching the flat buttons in the theme file. */
      nixie: {
        CARD_COLOR: 'color:#edf1f5',
        CARD_BORDER: 'rgba(168,190,214,0.28)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(240,48,12,0.13),transparent 58%),linear-gradient(165deg,#171b22,#07080a)',
        CARD_MUTED: 'color:#a0aebc',
        CARD_GOLD: 'color:#ffd2ab',
        CARD_TEXT_2: 'color:#d3dae2',
        CARD_LAV: '#d8e3ee',
        CARD_PAY_TEXT: 'color:#1a0a02',
        CARD_PAY_BG: 'linear-gradient(180deg,#ff8a3a,#f2571c 52%,#c93c08)',
        CARD_CANCEL_BG: 'rgba(168,190,214,0.10)',
        CARD_TEXT: '#edf1f5',
        CARD_BORDER_FAINT: 'rgba(168,190,214,0.13)',
        CARD_TOGGLE_OFF: 'rgba(168,190,214,0.22)',
        CARD_TRACK: '#ff7a3c',
        CARD_THUMB_OFF: '#a0aebc',
        CARD_WARN: 'color:#ffb454',
        CARD_SUCCESS: 'color:#5fc9c4',
        CARD_PAY_SHADOW: 'rgba(240,48,12,0.36)'
      },
      bauhaus: {
        CARD_COLOR: 'color:#111111',
        CARD_BORDER: 'rgba(17,17,17,0.30)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(0,87,255,0.08),transparent 58%),linear-gradient(165deg,#FFFFFF,#F7F7F3)',
        CARD_MUTED: 'color:#55555F',
        CARD_GOLD: 'color:#E1552B',
        CARD_TEXT_2: 'color:#33333A',
        CARD_LAV: '#0057FF',
        CARD_PAY_TEXT: 'color:#FFFFFF',
        CARD_PAY_BG: '#0057FF',
        CARD_CANCEL_BG: 'rgba(0,87,255,0.10)',
        CARD_TEXT: '#111111',
        CARD_BORDER_FAINT: 'rgba(17,17,17,0.16)',
        CARD_TOGGLE_OFF: 'rgba(17,17,17,0.25)',
        CARD_TRACK: '#0057FF',
        CARD_THUMB_OFF: '#55555F',
        CARD_WARN: 'color:#C9161C',
        CARD_SUCCESS: 'color:#1F6B3F',
        CARD_PAY_SHADOW: 'rgba(0,87,255,0.30)'
      },
      populuxe: {
        CARD_COLOR: 'color:#1C1A17',
        CARD_BORDER: 'rgba(28,26,23,0.28)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(242,179,60,0.12),transparent 58%),linear-gradient(165deg,#FFFFFF,#F3E9D9)',
        CARD_MUTED: 'color:#5C6B5A',
        CARD_GOLD: 'color:#8A5A0B',
        CARD_TEXT_2: 'color:#1F4E4C',
        CARD_LAV: '#1F7C79',
        CARD_PAY_TEXT: 'color:#FFFFFF',
        CARD_PAY_BG: 'linear-gradient(180deg,#D64A32,#C43D26 52%,#B03520)',
        CARD_CANCEL_BG: 'rgba(31,124,121,0.10)',
        CARD_TEXT: '#1C1A17',
        CARD_BORDER_FAINT: 'rgba(28,26,23,0.15)',
        CARD_TOGGLE_OFF: 'rgba(28,26,23,0.22)',
        CARD_TRACK: '#1F7C79',
        CARD_THUMB_OFF: '#5C6B5A',
        CARD_WARN: 'color:#C0341C',
        CARD_SUCCESS: 'color:#1F6B3F',
        CARD_PAY_SHADOW: 'rgba(196,61,38,0.30)'
      },
      /* Par Avion — manila stock, the pen blue, the airmail red. Mirrors
         themes/par-avion.css. CARD_GOLD is the amount slot and takes the theme's
         --balance-ink, the same red the panel sets its wallet figure in (the bauhaus
         and cast-iron entries pair it the same way); the number is 42px/800, so the
         3.0 large-text floor applies and it measures 4.91 on the card's lower stop.
         The pay button is the BLUE, not the red, for the reason the theme file gives
         at length: red here means air mail rather than danger, but a button a user
         is about to spend money with is not the place to test that. CARD_TRACK is the
         primary's top stop lightened one step — the toggle thumb is hardcoded
         near-black in the shared CSS, and at the theme's own #1B4C8C it disappeared
         (2.23:1, under the 3.0 a non-text indicator needs); #3570B8 carries it at
         3.78 while still reading as the same blue. */
      'par-avion': {
        CARD_COLOR: 'color:#211E19',
        CARD_BORDER: 'rgba(29,58,107,0.30)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(27,76,140,0.08),transparent 58%),linear-gradient(165deg,#FCFAF3,#F1EADA)',
        CARD_MUTED: 'color:#5A4C3B',
        CARD_GOLD: 'color:#C0272D',
        CARD_TEXT_2: 'color:#1D3A6B',
        CARD_LAV: '#1B4C8C',
        CARD_PAY_TEXT: 'color:#FFFFFF',
        CARD_PAY_BG: 'linear-gradient(180deg,#2A63A8,#1B4C8C 52%,#123A6E)',
        CARD_CANCEL_BG: 'rgba(27,76,140,0.10)',
        CARD_TEXT: '#211E19',
        CARD_BORDER_FAINT: 'rgba(29,58,107,0.16)',
        CARD_TOGGLE_OFF: 'rgba(29,58,107,0.25)',
        CARD_TRACK: '#3570B8',
        CARD_THUMB_OFF: '#5A4C3B',
        CARD_WARN: 'color:#8E2226',
        CARD_SUCCESS: 'color:#3D6B3E',
        CARD_PAY_SHADOW: 'rgba(27,76,140,0.30)'
      },
      /* Werkstätte — white metal, near-black ink, and the leaf. Mirrors
         themes/werkstatte.css, including the decision that makes this entry look odd
         beside the others: the theme's accent is a FILL, so CARD_LAV and the pay button
         are the ink rather than a color. A black plate with white letters is the
         Secession poster, and it measures 15.92.
         CARD_GOLD is the amount slot and takes --balance-ink like the bauhaus,
         cast-iron and par-avion entries; 42px/800 puts it under the 3.0 large-text
         floor and it measures 3.71 on the card's lower stop.
         CARD_TRACK is the LEAF and nothing else would do. The toggle thumb is
         hardcoded #1c0c00 in the shared CSS, and this theme's accent (#3F3A22) is a
         bronze-black — a near-black thumb on it is a black dot on a black track. The
         gold carries it at 7.88, which is the one job in the card that a fill-only
         color is exactly right for. */
      werkstatte: {
        CARD_COLOR: 'color:#15171C',
        CARD_BORDER: 'rgba(21,23,28,0.30)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(201,162,39,0.10),transparent 58%),linear-gradient(165deg,#FAFBFC,#F0F2F5)',
        CARD_MUTED: 'color:#565C66',
        CARD_GOLD: 'color:#96791F',
        CARD_TEXT_2: 'color:#2C3038',
        CARD_LAV: '#3F3A22',
        CARD_PAY_TEXT: 'color:#FAFBFC',
        CARD_PAY_BG: 'linear-gradient(180deg,#2C3038,#1C1F26 52%,#15171C)',
        CARD_CANCEL_BG: 'rgba(21,23,28,0.08)',
        CARD_TEXT: '#15171C',
        CARD_BORDER_FAINT: 'rgba(21,23,28,0.15)',
        CARD_TOGGLE_OFF: 'rgba(21,23,28,0.25)',
        CARD_TRACK: '#C9A227',
        CARD_THUMB_OFF: '#565C66',
        CARD_WARN: 'color:#8C1D22',
        CARD_SUCCESS: 'color:#2F6B3A',
        CARD_PAY_SHADOW: 'rgba(21,23,28,0.28)'
      },
      /* Wabi-sabi — slate stoneware, ash glaze, and the kintsugi gold. Mirrors
         themes/wabi-sabi.css. The pay button is the gold leaf, as the panel's primary
         is, with the near-black ink the other dark themes use on a metallic fill.
         CARD_LAV is the ash glaze the theme puts in the purple slot. */
      'wabi-sabi': {
        CARD_COLOR: 'color:#ECE6DA',
        CARD_BORDER: 'rgba(167,182,194,0.26)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(217,174,85,0.10),transparent 58%),linear-gradient(165deg,#22252A,#131518)',
        CARD_MUTED: 'color:#A8A194',
        CARD_GOLD: 'color:#D9AE55',
        CARD_TEXT_2: 'color:#D3CCBF',
        CARD_LAV: '#BAC7D1',
        CARD_PAY_TEXT: 'color:#1A1408',
        CARD_PAY_BG: 'linear-gradient(180deg,#E8C170,#D9AE55 52%,#A9802F)',
        CARD_CANCEL_BG: 'rgba(167,182,194,0.10)',
        CARD_TEXT: '#ECE6DA',
        CARD_BORDER_FAINT: 'rgba(167,182,194,0.14)',
        CARD_TOGGLE_OFF: 'rgba(167,182,194,0.22)',
        CARD_TRACK: '#D9AE55',
        CARD_THUMB_OFF: '#A8A194',
        CARD_WARN: 'color:#D08A5C',
        CARD_SUCCESS: 'color:#8FAA7A',
        CARD_PAY_SHADOW: 'rgba(217,174,85,0.28)'
      },
      /* Ukiyo-e — the woodblock sky: Prussian blue on the near-white of the clouds.
         Mirrors themes/ukiyo-e.css. CARD_GOLD is the amount slot and takes
         --balance-ink, the same Prussian blue, like the bauhaus and par-avion entries;
         42px/800 puts it under the 3.0 large-text floor and it measures 8.49 on the
         card's lower stop. The pay button is the same blue block as the panel's
         primary. CARD_TRACK is a lighter blue so the shared near-black toggle thumb
         still shows on it (5.34:1). */
      'ukiyo-e': {
        CARD_COLOR: 'color:#1B2624',
        CARD_BORDER: 'rgba(29,70,116,0.32)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(47,94,138,0.10),transparent 58%),linear-gradient(165deg,#FBFAF5,#F1F1EA)',
        CARD_MUTED: 'color:#454C52',
        CARD_GOLD: 'color:#1D4674',
        CARD_TEXT_2: 'color:#1B3A5C',
        CARD_LAV: '#2F5E8A',
        CARD_PAY_TEXT: 'color:#FFFFFF',
        CARD_PAY_BG: 'linear-gradient(180deg,#2F5E8A,#1D4674 52%,#12345A)',
        CARD_CANCEL_BG: 'rgba(29,70,116,0.10)',
        CARD_TEXT: '#1B2624',
        CARD_BORDER_FAINT: 'rgba(29,70,116,0.18)',
        CARD_TOGGLE_OFF: 'rgba(29,70,116,0.25)',
        CARD_TRACK: '#6F9CC2',
        CARD_THUMB_OFF: '#454C52',
        CARD_WARN: 'color:#963D19',
        CARD_SUCCESS: 'color:#37603A',
        CARD_PAY_SHADOW: 'rgba(29,70,116,0.28)'
      },
      /* Constellation — gold engraved on black, the brightest stars in white. Mirrors
         themes/constellation.css. The pay button is the gold leaf of the panel's primary
         with near-black ink, as the other dark themes do on a metallic fill. The plates
         have one hue, so CARD_LAV is that gold at its palest rather than a second color. */
      constellation: {
        CARD_COLOR: 'color:#EAE1CC',
        CARD_BORDER: 'rgba(201,170,108,0.30)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(201,170,108,0.10),transparent 58%),linear-gradient(165deg,#1E1B15,#0E0C09)',
        CARD_MUTED: 'color:#A89D86',
        CARD_GOLD: 'color:#C9AA6C',
        CARD_TEXT_2: 'color:#D2C7AE',
        CARD_LAV: '#E6D6AE',
        CARD_PAY_TEXT: 'color:#16110A',
        CARD_PAY_BG: 'linear-gradient(180deg,#E3C98C,#C9AA6C 52%,#9C8048)',
        CARD_CANCEL_BG: 'rgba(201,170,108,0.10)',
        CARD_TEXT: '#EAE1CC',
        CARD_BORDER_FAINT: 'rgba(201,170,108,0.16)',
        CARD_TOGGLE_OFF: 'rgba(201,170,108,0.22)',
        CARD_TRACK: '#C9AA6C',
        CARD_THUMB_OFF: '#A89D86',
        CARD_WARN: 'color:#D89A6A',
        CARD_SUCCESS: 'color:#8FB894',
        CARD_PAY_SHADOW: 'rgba(201,170,108,0.24)'
      },
      /* Sleepy Hollow, the October special edition — indigo night, the moon's gold and the
         pumpkin. Mirrors themes/sleepy-hollow.css. The pay button is the lit pumpkin with
         near-black ink, and CARD_LAV is the mist over the brook. Only ever the card theme
         while the bound account is wearing it in season: background.js resolves it. */
      'sleepy-hollow': {
        CARD_COLOR: 'color:#ECE5D3',
        CARD_BORDER: 'rgba(235,184,103,0.30)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 80% 0%,rgba(120,104,168,0.18),transparent 60%),linear-gradient(165deg,#1A1726,#0B0A14)',
        CARD_MUTED: 'color:#A9A2B4',
        CARD_GOLD: 'color:#EBB867',
        CARD_TEXT_2: 'color:#D3CBB8',
        CARD_LAV: '#CDC7E3',
        CARD_PAY_TEXT: 'color:#1A0E05',
        CARD_PAY_BG: 'linear-gradient(180deg,#F4A852,#E48A32 52%,#B65F1F)',
        CARD_CANCEL_BG: 'rgba(235,184,103,0.10)',
        CARD_TEXT: '#ECE5D3',
        CARD_BORDER_FAINT: 'rgba(235,184,103,0.15)',
        CARD_TOGGLE_OFF: 'rgba(235,184,103,0.22)',
        CARD_TRACK: '#E48A32',
        CARD_THUMB_OFF: '#A9A2B4',
        CARD_WARN: 'color:#E9875A',
        CARD_SUCCESS: 'color:#93BA8C',
        CARD_PAY_SHADOW: 'rgba(228,138,50,0.28)'
      },
      /* Mycelium — oat, moss, and the fly agaric. Mirrors themes/mycelium.css.
         CARD_GOLD is the amount slot and takes --balance-ink, the fly agaric's red,
         like the bauhaus, par-avion and ukiyo-e entries; 42px/800 is large text and it
         measures 5.94 on the card's lower stop against a floor of 3.0. The pay button is
         the moss primary with white. CARD_TRACK is the lighter moss so the shared
         near-black toggle thumb still shows on it. */
      mycelium: {
        CARD_COLOR: 'color:#2A2118',
        CARD_BORDER: 'rgba(74,58,42,0.28)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(74,107,58,0.08),transparent 58%),linear-gradient(165deg,#FFFDF8,#F7F1E6)',
        CARD_MUTED: 'color:#54483B',
        CARD_GOLD: 'color:#A5352B',
        CARD_TEXT_2: 'color:#4A3A2A',
        CARD_LAV: '#46655E',
        CARD_PAY_TEXT: 'color:#FFFFFF',
        CARD_PAY_BG: 'linear-gradient(180deg,#5E8049,#4A6B3A 52%,#38532B)',
        CARD_CANCEL_BG: 'rgba(74,107,58,0.10)',
        CARD_TEXT: '#2A2118',
        CARD_BORDER_FAINT: 'rgba(74,58,42,0.15)',
        CARD_TOGGLE_OFF: 'rgba(74,58,42,0.25)',
        CARD_TRACK: '#7E9E68',
        CARD_THUMB_OFF: '#54483B',
        CARD_WARN: 'color:#A33A2A',
        CARD_SUCCESS: 'color:#2E6B4F',
        CARD_PAY_SHADOW: 'rgba(56,83,43,0.26)'
      },
      /* Jazz Age — the bandstand. Mirrors themes/jazz-age.css: a black card with the warm
         hairline, a crimson wash at its head, the amount in ivory, Pay the lit crimson with
         its ivory label (6.34 on the mid stop), and the toggles in crimson. */
      'jazz-age': {
        CARD_COLOR: 'color:#F3E7CF',
        CARD_BORDER: 'rgba(184,134,75,0.35)',
        CARD_BACKGROUND: 'radial-gradient(120% 90% at 50% 0%,rgba(224,50,75,0.12),transparent 58%),linear-gradient(165deg,#1A1311,#0C0908)',
        CARD_MUTED: 'color:#BBA78C',
        CARD_GOLD: 'color:#F3E7CF',
        CARD_TEXT_2: 'color:#E2D3B8',
        CARD_LAV: '#F58A95',
        CARD_PAY_TEXT: 'color:#FFF4E2',
        CARD_PAY_BG: 'linear-gradient(180deg,#E0324B,#B3122E 55%,#8E0B22)',
        CARD_CANCEL_BG: 'rgba(243,231,207,0.08)',
        CARD_TEXT: '#F3E7CF',
        CARD_BORDER_FAINT: 'rgba(184,134,75,0.22)',
        CARD_TOGGLE_OFF: 'rgba(243,231,207,0.18)',
        CARD_TRACK: '#E0324B',
        CARD_THUMB_OFF: '#BBA78C',
        CARD_WARN: 'color:#FF8A70',
        CARD_SUCCESS: 'color:#8FD4A0',
        CARD_PAY_SHADOW: 'rgba(200,20,40,0.45)',
        CARD_EXTRA:
          '.pay{text-shadow:0 0 8px rgba(255,190,170,0.7);' +
          'box-shadow:inset 0 1px 0 rgba(255,200,190,0.45),0 0 0 1px rgba(255,90,100,0.5),0 0 12px rgba(230,40,60,0.75),0 0 30px rgba(230,40,60,0.45);}' +
          '.tg-input:checked~.tg-track .tg-thumb{background:#FFF4E2;}'
      },
      /* Turnstile — the station. Mirrors themes/turnstile.css: a white enamel plate with
         its inset line, square-cornered, with a course of square gold tile and the maroon
         course along its head;
         the amount in the enamel's near-black, Pay the green enamel sign with cream
         lettering and its inset line, the quieter actions white enamel, and the toggles
         in the green. The amount, the eyebrow and Pay are lettered in the enamel signs'
         gothic, which reaches the page only while a card is up (see mountCardFont). */
      turnstile: {
        CARD_COLOR: 'color:#151A1E',
        CARD_BORDER: '#151A1E',
        CARD_BACKGROUND: '#FAF8F2',
        CARD_MUTED: 'color:#42474B',
        CARD_GOLD: 'color:#151A1E',
        CARD_TEXT_2: 'color:#2A2F33',
        CARD_LAV: '#1F4A3B',
        CARD_PAY_TEXT: 'color:#EFE8D2',
        CARD_PAY_BG: '#1F4A3B',
        CARD_CANCEL_BG: 'rgba(21,26,30,0.07)',
        CARD_TEXT: '#151A1E',
        CARD_BORDER_FAINT: 'rgba(21,26,30,0.18)',
        CARD_TOGGLE_OFF: 'rgba(21,26,30,0.18)',
        CARD_TRACK: '#1F4A3B',
        CARD_THUMB_OFF: '#FFFFFF',
        CARD_WARN: 'color:#9C2A1C',
        CARD_SUCCESS: 'color:#1F5A38',
        CARD_PAY_SHADOW: 'rgba(21,26,30,0.25)',
        CARD_EXTRA:
          '.card{border-radius:0;border:none;padding-top:26px;' +
          'background:repeating-linear-gradient(90deg,#D8C690 0 6px,#2A2621 6px 7px) 0 0/100% 7px no-repeat,' +
          'linear-gradient(#7A1F33,#7A1F33) 0 7px/100% 5px no-repeat,#FAF8F2;' +
          'box-shadow:inset 0 0 0 3px #FAF8F2,inset 0 0 0 4px #151A1E,0 20px 60px rgba(21,26,30,0.3);}' +
          '.eyebrow{font-family:"Sidecar Card Lettering",ui-sans-serif,system-ui,sans-serif;font-weight:400;font-size:17px;letter-spacing:.12em;color:#151A1E;}' +
          '.amt .num{font-family:"Sidecar Card Figures",ui-sans-serif,system-ui,sans-serif;font-weight:800;font-size:46px;letter-spacing:0;}' +
          '.amt .unit{font-family:"Sidecar Card Lettering",ui-sans-serif,system-ui,sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.08em;}' +
          '.pay{border-radius:0;box-shadow:inset 0 0 0 3px #1F4A3B,inset 0 0 0 4.5px #EFE8D2,0 1px 0 rgba(21,26,30,0.25);' +
          'font-family:"Sidecar Card Lettering",ui-sans-serif,system-ui,sans-serif;font-weight:400;font-size:21px;letter-spacing:.08em;text-transform:uppercase;}' +
          '.cancel,.other{border-radius:0;background:#F6F3EA;box-shadow:inset 0 0 0 3px #F6F3EA,inset 0 0 0 4px #151A1E;color:#151A1E;}' +
          '.tg-input:checked~.tg-track .tg-thumb{background:#EFE8D2;}' +
          '.pill{border-radius:0;box-shadow:inset 0 0 0 1.5px #151A1E;}' +
          '.x{border-radius:0;}'
      },
      /* Departures — the board. Mirrors themes/departures.css: a black strip with a hairline
         edge, the amount in the board's white, Pay the yellow with black lettering, and the
         toggles in the yellow with a black knob. */
      departures: {
        CARD_COLOR: 'color:#F2F1EA',
        CARD_BORDER: 'rgba(242,241,234,0.22)',
        CARD_BACKGROUND: 'linear-gradient(180deg,#141413,#0E0E0D)',
        CARD_MUTED: 'color:#A9A79D',
        CARD_GOLD: 'color:#F2F1EA',
        CARD_TEXT_2: 'color:#DCDBD3',
        CARD_LAV: '#F5C400',
        CARD_PAY_TEXT: 'color:#0E0E0D',
        CARD_PAY_BG: '#F5C400',
        CARD_CANCEL_BG: 'rgba(242,241,234,0.08)',
        CARD_TEXT: '#F2F1EA',
        CARD_BORDER_FAINT: 'rgba(242,241,234,0.16)',
        CARD_TOGGLE_OFF: 'rgba(242,241,234,0.18)',
        CARD_TRACK: '#F5C400',
        CARD_THUMB_OFF: '#A9A79D',
        CARD_WARN: 'color:#FF8A70',
        CARD_SUCCESS: 'color:#8FDBA4',
        CARD_PAY_SHADOW: 'rgba(0,0,0,0.6)',
        CARD_EXTRA:
          '.pay{text-transform:uppercase;letter-spacing:.06em;}' +
          '.tg-input:checked~.tg-track .tg-thumb{background:#0E0E0D;}'
      },
      /* Ben Day — the comic page. Mirrors themes/ben-day.css: a white panel with the black
         keyline, the pay button flat red with white (5.88), and the toggles as the panel
         draws its switches. CARD_EXTRA carries the shape. */
      'ben-day': {
        CARD_COLOR: 'color:#111111',
        CARD_BORDER: '#111111',
        CARD_BACKGROUND: '#FFFFFF',
        CARD_MUTED: 'color:#4A4A4A',
        CARD_GOLD: 'color:#111111',
        CARD_TEXT_2: 'color:#2A2A2A',
        CARD_LAV: '#111111',
        CARD_PAY_TEXT: 'color:#FFFFFF',
        CARD_PAY_BG: '#C8102E',
        CARD_CANCEL_BG: 'rgba(17,17,17,0.08)',
        CARD_TEXT: '#111111',
        CARD_BORDER_FAINT: 'rgba(17,17,17,0.22)',
        CARD_TOGGLE_OFF: '#FFFFFF',
        CARD_TRACK: '#C8102E',
        CARD_THUMB_OFF: '#111111',
        CARD_WARN: 'color:#B00D26',
        CARD_SUCCESS: 'color:#1F6B3F',
        CARD_PAY_SHADOW: 'transparent',
        // The comic page's shape, which the shared templates cannot express in color:
        // the yellow dot wash across the head of the card over a paper that shades down
        // into cream, square corners, the black keyline and a hard drop on the card, the pill and the
        // Pay button; the two quieter actions as cream caption tags; the amount lettered
        // like the panel's balance (white face, one outline round the whole figure, the
        // red plate offset behind it), which needs no font of the theme's own; and the
        // switches as the panel draws them, white with a black knob off, red with a white
        // knob on. The amount and the Pay button are lettered in Bangers, which reaches the
        // page only while a card is up (see mountCardFont); everything else keeps the
        // system face.
        CARD_EXTRA:
          '.card{border-radius:0;border:3px solid #111111;box-shadow:8px 8px 0 #111111;' +
          'background:url("' + BEN_DAY_WASH + '") repeat-x 0 0/36px 180px,linear-gradient(180deg,#FFFFFF 45%,#F6EFDC);}' +
          '.eyebrow{color:#111111;font-weight:700;}' +
          '.amt .num{color:#FFFFFF;letter-spacing:.03em;font-family:"Sidecar Card Lettering",ui-sans-serif,system-ui,sans-serif;font-weight:400;font-size:48px;' +
          'filter:drop-shadow(.06em 0 0 #111111) drop-shadow(-.06em 0 0 #111111) ' +
          'drop-shadow(0 .06em 0 #111111) drop-shadow(0 -.06em 0 #111111) drop-shadow(.08em .08em 0 #C8102E);}' +
          '.amt .unit{margin-left:5px;}' +
          '.pay{border-radius:0;box-shadow:inset 0 0 0 2.5px #111111,4px 4px 0 #111111;' +
          'font-family:"Sidecar Card Lettering",ui-sans-serif,system-ui,sans-serif;font-weight:400;font-size:20px;letter-spacing:.05em;}' +
          '.pay:active{transform:translate(2px,2px);box-shadow:inset 0 0 0 2.5px #111111,2px 2px 0 #111111;}' +
          '.cancel,.other{border-radius:0;background:#FFF4C2;box-shadow:inset 0 0 0 2px #111111;color:#111111;}' +
          '.cancel:hover,.other:hover{background:#FFD400;color:#111111;}' +
          '.tg{border-top:2px solid #111111;}' +
          '.tg-track{box-shadow:inset 0 0 0 2px #111111;}' +
          '.tg-input:checked~.tg-track .tg-thumb{background:#FFFFFF;}' +
          '.pill{border-radius:0;border:2.5px solid #111111;box-shadow:4px 4px 0 #111111;}' +
          '.x{border-radius:0;}'
      }
    };

    // The theme is read once at load into `cardTheme` (chrome.storage.get is
    // async and can't return a value synchronously here); fall back to speakeasy.
    // CARD_EXTRA is optional: CSS a theme appends to the card and the pill, for the
    // themes whose look is shape rather than color. The templates are otherwise shared
    // by all of them, so it defaults to nothing and every other theme renders exactly as
    // it did.
    return Object.assign({ CARD_EXTRA: '' }, themeColors[cardTheme] || themeColors.speakeasy);
  }

  // ---- lightning strike (a payment settled) ----
  // The same procedural bolt the side panel draws, thrown across the PAGE instead:
  // when you zap, the page is where you're looking, not the panel. Injected into a
  // shadow root with `all:initial` like the pay card, so no page stylesheet can
  // restyle it and nothing leaks the other way.
  //
  // Kept intentionally inert: pointer-events none, no page-visible globals, removes
  // itself, and every part is wrapped so decoration can't disturb the host page.
  function pageLightningStrike() {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const W = window.innerWidth || 1200;
      const H = window.innerHeight || 800;

      // Wider viewports get proportionally bigger steps, so the bolt reads the same
      // whether the page is a phone-width column or a wide desktop window.
      const startX = W * 0.2 + Math.random() * (W * 0.6);
      const segments = 8 + Math.floor(Math.random() * 4);
      const step = Math.max(30, W * 0.09);
      let x = startX;
      let y = 0;
      let d = 'M' + x.toFixed(1) + ',0';
      const edge = W * 0.05;
      for (let i = 0; i < segments; i++) {
        y += i === segments - 1 ? H - y : (H / segments) * (0.7 + Math.random() * 0.6);
        const pull = (W / 2 - x) / W;
        x += (Math.random() - 0.5 + pull * 0.5) * step * 2;
        x = Math.max(edge, Math.min(W - edge, x));
        d += ' L' + x.toFixed(1) + ',' + y.toFixed(1);
        if (Math.random() > 0.65) {
          let bx = x + (Math.random() - 0.5) * step * 2.2;
          bx = Math.max(edge, Math.min(W - edge, bx));
          const by = y + 14 + Math.random() * 34;
          d += ' M' + x.toFixed(1) + ',' + y.toFixed(1) +
               ' L' + bx.toFixed(1) + ',' + by.toFixed(1) +
               ' M' + x.toFixed(1) + ',' + y.toFixed(1);
        }
      }

      const host = document.createElement('div');
      // pointer-events is set INLINE, not just in the :host rule — `all:initial`
      // resets it, and relying on the overlay merely being transparent to stay
      // click-through is too fragile for something covering the whole page.
      //
      // z-index alone can't win here: a payment modal (Bitcoin Connect, and Sidecar's
      // own pay card) sits at the maximum 2147483647, so a bolt below that draws
      // BEHIND the very modal the payment came from. Instead promote the overlay to
      // the browser's TOP LAYER via the Popover API, which renders above every
      // z-index stacking context regardless of value. Supported by both floors this
      // extension targets (Chrome 114+, Firefox 128+); the max z-index below is the
      // fallback if showPopover throws.
      host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;border:0;background:transparent;';
      // Closed, like the card and the pill: the page must not be able to read the theme.
      const root = host.attachShadow({ mode: 'closed' });
      // Lemon yellow, the same bolt the panel strikes in every theme, or in Film Noir, whose
      // card is black and white, the white of the flash itself.
      const monoBolt = cardTheme === 'film-noir';
      const stroke = monoBolt ? '#ffffff' : Math.random() > 0.5 ? '#FFD600' : '#FFE234';
      const style = document.createElement('style');
      style.textContent =
        ':host{position:fixed;inset:0;pointer-events:none}' +
        // A popover is a top-layer box: clear its UA chrome so only the bolt shows.
        ':host(:popover-open){border:0;padding:0;margin:0;background:transparent;width:100%;height:100%;max-width:none;max-height:none;overflow:visible}' +
        '.layer{position:fixed;inset:0;pointer-events:none;animation:scf .28s ease-out}' +
        '.b{fill:none;stroke-linecap:round;stroke-linejoin:round;opacity:0;' +
        'animation:sci .12s ease-out forwards,sco .62s ease-in .2s forwards}' +
        '@keyframes scf{0%{background:rgba(255,255,255,.34)}100%{background:transparent}}' +
        '@keyframes sci{from{opacity:0}to{opacity:1}}' +
        '@keyframes sco{from{opacity:1}to{opacity:0}}';
      const layer = document.createElement('div');
      layer.className = 'layer';
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      // Two stacked glows — a tight white-hot core and a wide yellow bloom — so the
      // bolt reads as luminous on a light page too, where a single thin gold stroke
      // was getting lost.
      svg.setAttribute('style', 'position:absolute;inset:0;overflow:visible;' +
        'filter:drop-shadow(0 0 2px rgba(255,255,255,.95)) drop-shadow(0 0 10px ' +
        (monoBolt ? 'rgba(255,255,255,.7)' : 'rgba(255,214,0,.85)') + ')');
      const width = (2.4 + Math.random() * 2.4).toFixed(1);
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('class', 'b');
      p.setAttribute('d', d);
      p.setAttribute('stroke', stroke);
      p.setAttribute('stroke-width', width);
      svg.append(p);
      // A thin white core down the middle of the yellow, the white-hot center a bolt has,
      // as the panel draws it. Film Noir's bolt is white already.
      if (!monoBolt) {
        const core = p.cloneNode();
        core.setAttribute('stroke', '#ffffff');
        core.setAttribute('stroke-width', Math.max(0.8, Number(width) * 0.35).toFixed(1));
        svg.append(core);
      }
      layer.appendChild(svg);
      // Ben Day's sound effect, popped over the bolt the way the panel pops it: a drawn
      // picture, so there is nothing in it to translate.
      if (cardTheme === 'ben-day') {
        style.textContent +=
          '.zap{position:fixed;left:50%;top:42%;width:340px;height:248px;margin:-124px 0 0 -170px;' +
          'background:url("' + BEN_DAY_ZAP + '") center/contain no-repeat;opacity:0;' +
          'animation:sczap .88s cubic-bezier(.2,.9,.3,1) both}' +
          '@keyframes sczap{0%{opacity:0;transform:scale(.3) rotate(-14deg)}' +
          '22%{opacity:1;transform:scale(1.12) rotate(3deg)}36%{transform:scale(.96) rotate(-1deg)}' +
          '48%{transform:scale(1) rotate(0)}78%{opacity:1}100%{opacity:0;transform:scale(1.04)}}';
        const zap = document.createElement('div');
        zap.className = 'zap';
        layer.appendChild(zap);
      }
      root.append(style, layer);
      (document.body || document.documentElement).appendChild(host);
      // Top layer via popover — see the z-index note above. Falls back silently to the
      // max z-index already set inline if the browser or page state refuses.
      try {
        host.setAttribute('popover', 'manual');
        host.showPopover();
      } catch (_) { /* z-index fallback */ }
      setTimeout(() => { try { host.remove(); } catch (_) {} }, 950);
    } catch (_) { /* decoration only — never disturb the page */ }
  }

  function removeCard() {
    awaitingDecision = false; // whatever tore this down, no card is holding a decision now
    unmountCardFont();
    if (cardHost && cardHost.parentNode) cardHost.parentNode.removeChild(cardHost);
    cardHost = null;
    shownInvoice = '';
    shownMode = '';
    cardControls = null;
    if (escHandler) {
      window.removeEventListener('keydown', escHandler, true);
      escHandler = null;
    }
  }

  // Both corner states share one host: the pill for an invoice nobody asked about, and
  // the pill for a payment already going out. Same shadow root, same stylesheet, same
  // place on screen, so the only thing either one has to describe is its own contents.
  function mountPill(inner) {
    removeCard();
    cardHost = document.createElement('div');
    cardHost.style.cssText = 'all:initial;';
    // CLOSED, so the page's scripts cannot reach inside and read the palette, which is
    // the theme of the paying account (background.js, the clamped GET_SETTINGS).
    const sh = cardHost.attachShadow({ mode: 'closed' });
    const colors = getThemeColors();
    sh.innerHTML =
      '<style>' + PILL_CSS.replace(/\{(\w+)\}/g, (m, k) =>
        Object.prototype.hasOwnProperty.call(colors, k) ? colors[k] : m) + '</style>' +
      '<div class="pw">' + inner + '</div>';
    (document.body || document.documentElement).appendChild(cardHost);
    requestAnimationFrame(() => {
      const w = sh.querySelector('.pw');
      if (w) w.classList.add('in');
    });
    return sh;
  }

  // What an invoice nobody asked about gets: a pill, not the card. Reported by a user who
  // imported a key, logged into a client, and was met by a full-screen payment card for an
  // invoice the page had put on screen by itself. Everything about that card was correct
  // and none of it was wanted.
  function renderPill(invoice) {
    const sats = invoiceSats(invoice);
    const site = location.host.replace(/^www\./, '');
    const payable = sats != null
      ? msgHtml('payPillPayable', '$1 sats payable', ['<b>' + escapeHtml(fmtAmount(sats)) + '</b>'])
      : escapeHtml(msg('payPillInvoicePayable', 'An invoice payable'));
    const label = sats != null
      ? msg('payPillLabel', '$1 sat Lightning invoice is payable on $2. Open Sidecar to pay it.', [fmtAmount(sats), site])
      : msg('payPillLabelNoAmount', 'A Lightning invoice is payable on $1. Open Sidecar to pay it.', [site]);

    // mountPill clears shownInvoice/shownMode on its way in, so claim them after it.
    const sh = mountPill(
      '<div class="pill" role="button" tabindex="0" aria-label="' + escapeHtml(label) + '">' +
      bolt('b') + '<span class="t">' + payable + '</span>' +
      '<button class="x" type="button" aria-label="' + escapeHtml(msg('dismiss', 'Dismiss')) + '">\u00D7</button></div>'
    );
    shownInvoice = invoice;
    shownMode = 'pill';

    const open = () => renderCard(invoice);
    const pill = sh.querySelector('.pill');
    pill.addEventListener('click', (e) => {
      if (e.target.closest('.x')) return; // the dismiss button has its own job
      open();
    });
    pill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    sh.querySelector('.x').addEventListener('click', (e) => {
      e.stopPropagation();
      dismissedInvoice = invoice; // same memory the card's "Not now" uses
      removeCard();
    });
  }

  // A PAYMENT ALREADY ON ITS WAY (#270). There is no decision left in it: the request is
  // published, the wallet may settle it whatever this page does next, and the result
  // arrives as the page-wide flash and a line in the log whether or not anything is still
  // on screen. So it reports from the corner rather than holding the page, and the way
  // out is the same one every other corner notice has instead of a button that had to
  // explain it was not a cancel.
  //
  // `auto` is an auto-zap, the same state reached without being asked first. That one
  // used to open the full card as a receipt, which was the purest case of a card with
  // nothing on it to press.
  function renderFlightPill(invoice, auto) {
    const sats = invoiceSats(invoice);
    const bold = sats != null ? ['<b>' + escapeHtml(fmtAmount(sats)) + '</b>'] : null;
    const going = bold
      ? (auto ? msgHtml('flightZapping', 'Zapping $1 sats', bold) : msgHtml('flightSending', 'Sending $1 sats', bold))
      : escapeHtml(auto ? msg('flightZappingPayment', 'Zapping payment') : msg('flightSendingPayment', 'Sending payment'));
    const sh = mountPill(
      '<div class="pill flight" role="status" aria-live="polite">' +
      '<span class="sp"></span>' +
      '<svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" ' +
      'stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' +
      '<span class="t">' + going + '</span>' +
      '<button class="x" type="button" aria-label="' + escapeHtml(msg('hide', 'Hide')) + '">\u00D7</button></div>'
    );
    shownInvoice = invoice;
    shownMode = 'flight';
    flightAuto = !!auto;
    flightPaid = false;

    const pill = sh.querySelector('.pill');
    const text = sh.querySelector('.t');
    sh.querySelector('.x').addEventListener('click', () => {
      // Hides the indicator, not the payment. Remembered anyway, so the next DOM scan
      // cannot turn around and offer to pay an invoice that is already being paid.
      dismissedInvoice = invoice;
      removeCard();
    });

    cardControls = {
      invoice: invoice,
      setPaid: () => {
        flightPaid = true;
        pill.classList.add('paid');
        text.innerHTML = bold ? msgHtml('flightPaid', 'Paid $1 sats', bold) : escapeHtml(msg('paid', 'Paid'));
      },
      // A failure is a decision again, and a decision needs the room and the button that
      // only the card has. This is the one way back out of the corner.
      setError: (detail) => renderCard(invoice, detail),
    };
  }

  // The card is only ever a DECISION now: an invoice somebody reached for, or a payment
  // that failed and could be tried again. Everything from the moment Pay is pressed
  // belongs to renderFlightPill, auto-zaps included.
  function renderCard(invoice, errorText) {
    removeCard();
    shownInvoice = invoice;
    shownMode = 'card';
    const sats = invoiceSats(invoice);
    const memo = invoiceMemo(invoice);
    const site = location.host.replace(/^www\./, '');

    // A REQUEST AWAITING AUTHORIZATION, not an announcement. "You're paying 33,000 sats"
    // above a full-screen overlay reads as a charge already in progress, which is exactly
    // how it was reported. This wording also matches the approval window's, where a site
    // "wants to send a Lightning payment" and nothing moves until you say so.
    //
    // A spend already underway has no business on a card at all now. It goes to the
    // corner indicator, where the present tense is the honest tense.
    // The offer, for as long as it still is one: this invoice, on a site not signed in with
    // Sidecar, with Show on unconnected sites still off.
    const offer = invoice === offerInvoice && !connectedToSite && !pillAnywhere;
    const eyebrow = escapeHtml(offer
      ? msg('cardOfferEyebrow', 'Sidecar can pay this invoice')
      : msg('cardEyebrow', 'Request to pay'));
    const amountBlock =
      sats != null
        ? '<div class="amt"><span class="num">' + escapeHtml(fmtAmount(sats)) + '</span><span class="unit">' +
          escapeHtml(msg('unitSats', 'sats')) + '</span></div>'
        : '';
    const memoText = memo || (sats == null ? msg('cardNoAmountMemo', 'A Lightning invoice. Choose the amount in Sidecar.') : '');
    const memoBlock = memoText ? '<div class="memo">' + escapeHtml(memoText) + '</div>' : '';

    // Offer auto-zap only when this very payment is one it would cover, so the
    // amount on screen is the amount the setting would have handled. Never on a card
    // opened in its error state: see the note on the settings rows below.
    const canOfferAutoZap = !errorText && autoZapOffer > 0 && sats != null && sats <= autoZapOffer;
    const offerRow = canOfferAutoZap
      ? '<label class="tg tg-autozap"><span class="tg-label">' +
        escapeHtml(msg('cardAutoZapOffer', 'Turn on Auto Zaps ($1 sats max)', [fmtAmount(autoZapOffer)])) +
        '</span>' +
        '<input class="tg-input tg-autozap-input" type="checkbox">' +
        '<span class="tg-track"><span class="tg-thumb"></span></span></label>'
      : '';

    cardHost = document.createElement('div');
    cardHost.style.cssText = 'all:initial;';
    // Closed, for the same reason as the pill's (mountPill).
    const s = cardHost.attachShadow({ mode: 'closed' });
    const colors = getThemeColors();
    const cardCss = CARD_CSS.replace(/\{(\w+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(colors, k) ? colors[k] : m);
    // The wordmark's lettering is baked in as speakeasy's lavender (#BDA1FF), fine
    // on speakeasy/noir's dark cards but illegible on a light one — recolor
    // to the same darker purple icons/sidecar-logo-deco.svg uses for the side panel.
    // Every light theme needs it recoloured; the baked lavender vanishes on marble,
    // eggshell and plaster alike.
    // Sibling copies live in sidepanel.js (LIGHT_THEMES) and prompt.js (the approval
    // window's wordmark). A new light theme has to be registered in all three.
    const LIGHT_CARD_THEMES = new Set(['industria', 'aegean', 'bauhaus', 'populuxe', 'par-avion', 'werkstatte', 'ukiyo-e', 'mycelium', 'ben-day', 'turnstile']);
    const lightCard = LIGHT_CARD_THEMES.has(cardTheme);
    const logoSvg = lightCard ? LOGO_SVG.replace(/#BDA1FF/g, '#5a4a8a') : LOGO_SVG;
    s.innerHTML =
      '<style>' + cardCss + '</style>' +
      '<div class="ov">' +
      '<div class="card" role="dialog" aria-label="' + escapeHtml(msg('cardLabel', 'Pay with Sidecar')) + '">' +
      '<div class="brand">' + logoSvg + '</div>' +
      '<div class="eyebrow">' + eyebrow + '</div>' +
      amountBlock +
      memoBlock +
      '<div class="site">' + msgHtml('cardFoundOn', 'found on $1', ['<b>' + escapeHtml(site) + '</b>']) + '</div>' +
      '<button class="pay" type="button">' + bolt('pay-bolt') +
      '<svg class="pay-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' +
      '<span class="pay-label">' + escapeHtml(msg('cardPay', 'Pay with Sidecar')) + '</span></button>' +
      '<div class="pay-status" hidden></div>' +
      '<button class="other" type="button">' + escapeHtml(msg('cardOtherWallet', 'Open in another wallet')) + '</button>' +
      '<button class="cancel" type="button">' + escapeHtml(msg('cardNotNow', 'Not now')) + '</button>' +
      (offerRow || '') +
      // NOT ON THE ERROR CARD, and #208 is why. This toggle writes showPayButton: false,
      // which gates the manual scan-and-show path below and nothing else. It used to
      // render on the auto-zap card, where auto-zaps come straight off the worker's
      // `autopaying` event and never read the setting, so ticking it there kept every
      // auto card coming and silently removed the manual "Pay with Sidecar" card instead.
      // Auto-zaps no longer open a card at all, but a FAILED one reopens this card to
      // offer the retry, which is the same back door into the same wrong switch.
      //
      // It reads wrong there regardless: the prompt in front of you is a failure report,
      // not the scan prompt this would hide, so the card opened to report a decision is
      // the one card that offers no settings.
      (errorText
        ? ''
        : '<label class="tg"><span class="tg-label">' + escapeHtml(offer
            ? msg('cardOfferDontAsk', 'Don\'t ask again')
            : msg('cardDontShow', 'Don\'t show this prompt again')) + '</span>' +
          '<input class="tg-input tg-showcard-input" type="checkbox">' +
          '<span class="tg-track"><span class="tg-thumb"></span></span></label>') +
      '</div></div>';

    const ov = s.querySelector('.ov');
    const card = s.querySelector('.card');
    const payBtn = s.querySelector('.pay');
    let awaiting = false;

    function dismiss() {
      // Not while a decision is out. Esc and a background click must not take the card
      // away and hand the page's own pay button back, and there is nothing to dismiss
      // to: the answer is Reject, in Sidecar, which comes back here as a failure.
      if (awaiting) return;
      dismissedInvoice = invoice;
      removeCard();
    }

    const label = s.querySelector('.pay-label');
    const status = s.querySelector('.pay-status');
    // Pressed Pay, and now Sidecar is asking. Nothing has been sent, so this does not say
    // it has: the corner indicator takes over on the 'authorized' event, which is the
    // first moment "Sending" is true.
    function setAwaiting() {
      awaiting = true;
      awaitingDecision = true;
      card.classList.add('busy');
      payBtn.disabled = true;
      label.textContent = msg('cardConfirmInSidecar', 'Confirm in Sidecar');
      status.hidden = false;
      status.className = 'pay-status';
      status.textContent = msg('cardAwaiting', 'Approve it in Sidecar to send it. Nothing has left your wallet yet.');
    }
    // An invoice can settle while this card is still open: paid from the panel, or by the
    // page's own WebLN flow. Nothing to announce, but the button has to stop being
    // pressable or the next tap pays it twice. The handler clears the card a beat later.
    function setPaid() {
      payBtn.classList.add('done');
      payBtn.disabled = true;
      label.textContent = msg('paid', 'Paid');
      status.hidden = true;
    }
    function setError(detail) {
      awaiting = false;
      awaitingDecision = false;
      card.classList.remove('busy'); // Not now and the toggle come back for the retry
      payBtn.classList.remove('done');
      payBtn.disabled = false;
      label.textContent = msg('cardTryAgain', 'Try again');
      status.hidden = false;
      status.className = 'pay-status err';
      status.textContent = detail || msg('cardFailed', 'Payment failed. Please try again.');
    }
    cardControls = { invoice: invoice, setPaid: setPaid, setError: setError, setAwaiting: setAwaiting };

    const azBox = s.querySelector('.tg-autozap-input');
    if (azBox) {
      azBox.addEventListener('change', (e) => { offerAutoZapChecked = !!e.target.checked; });
    }

    payBtn.addEventListener('click', () => {
      try {
        chrome.runtime.sendMessage(
          {
            type: 'SIDECAR_PAY_PAGE_INVOICE',
            invoice,
            // Intent only. Sidecar's approval screen shows and confirms this, and
            // writes the setting only if the payment is approved.
            enableAutoZap: canOfferAutoZap && offerAutoZapChecked,
            // Intent only, like the one above: the approval screen asks whether to show
            // Sidecar on sites like this, and nothing changes unless that is approved.
            offerPayAnywhere: offer,
          },
          () => void chrome.runtime.lastError
        );
        // NOT the handover. Sidecar still has to ask, and until it has an answer this
        // card is the only thing covering the page's own pay button and QR. The corner
        // takes over on 'authorized'. Ordered after the send on purpose: if the extension
        // was updated out from under this page, sendMessage throws and the catch below
        // still has a live card to write the error into.
        setAwaiting();
      } catch (_) {
        setError('Sidecar was updated. Reload this page to pay.');
      }
    });
    s.querySelector('.cancel').addEventListener('click', dismiss);
    // THE WAY BACK TO THE WALLET THE PAGE WAS TALKING TO. Sidecar takes a tapped
    // `lightning:` link (see the click listener), so whatever app registered for the
    // scheme (BlueWallet, Zeus) no longer hears it. This hands the same invoice to it:
    // the link exactly as the page wrote it when it was the one tapped, a lightning: URI
    // of the invoice otherwise. Assigned rather than clicked through an anchor, because
    // an anchor would come straight back to the listener that took the first tap.
    s.querySelector('.other').addEventListener('click', () => {
      if (awaiting) return;
      const href = invoice === tappedInvoice && tappedHref ? tappedHref : 'lightning:' + invoice;
      dismissedInvoice = invoice;
      removeCard();
      try { location.href = href; } catch (_) {}
    });
    ov.addEventListener('click', (e) => {
      if (e.target === ov) dismiss();
    });
    // Target the show-card toggle specifically: `.tg-input` alone would match the
    // Auto Zaps checkbox, which renders above it. Optional-chained because the row has
    // been conditional before and would be again: without the guard, suppressing it
    // throws here and takes the whole card's wiring down with it.
    s.querySelector('.tg-showcard-input')?.addEventListener('change', (e) => {
      // Inverted from "Show this automatically" (on by default) to "Don't show this
      // prompt again" (off by default). Same stored setting, same outcome — now it's
      // ticking the box that hides the card, not unticking it.
      if (e.target.checked) {
        // The switch for the kind of site this is: "Show on Nostr sites" here on a signed-in
        // site, "Show on unconnected sites" anywhere else.
        const settings = offer ? { payOfferDismissed: true }
          : connectedToSite ? { showPayButton: false } : { payPillAnywhere: false };
        try {
          chrome.runtime.sendMessage(
            { type: 'SIDECAR_SET_SETTINGS', settings },
            () => void chrome.runtime.lastError
          );
        } catch (_) {}
        if (offer) payOfferDismissed = true;
        else if (connectedToSite) showCard = false; else pillAnywhere = false;
        removeCard();
      }
    });

    escHandler = (e) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', escHandler, true);

    (document.documentElement || document.body).appendChild(cardHost);
    mountCardFont();
    requestAnimationFrame(() => ov.classList.add('in'));
    // Reopened from the corner because the payment failed. Try again and Not now are the
    // right affordances the moment there is a decision to make again, which is the whole
    // reason a failure comes back to the card instead of staying in the indicator.
    if (errorText) setError(errorText);
  }

  // Auto-pay bookkeeping. The MutationObserver re-scans constantly, so a decision
  // in flight must not spawn a second attempt, and a decline must be remembered or
  // the card would never get to appear.
  let autopayPending = '';
  let autopayDeclined = '';

  function scanForInvoice() {
    if (retired) return;
    if (!extensionAlive()) { retire(); return; }
    // NOT THE PAGE'S TO TAKE DOWN, in either of the two states where money is at stake.
    //
    // A payment in flight, because pages routinely pull the invoice out of the DOM the
    // moment they believe it settled, and the corner indicator is its only report.
    //
    // And a card with a decision out on it, for a sharper reason: that overlay is what is
    // covering the page's own pay button and QR while Sidecar asks. A page that drops its
    // invoice at that moment would otherwise uncover itself mid-approval, and the card
    // would not be there to hand over to the corner when the answer came back.
    //
    // Both end the same way: 'paid' and 'payfailed' clear them, and so does the
    // indicator's own dismiss button.
    if (shownMode === 'flight' || awaitingDecision) return;
    // TWO SWITCHES, ONE PER KIND OF SITE. showCard is "Show on Nostr sites" and covers
    // sites signed in with Sidecar; pillAnywhere is "Show on unconnected sites" and
    // covers the rest. Neither reaches the other's sites.
    if (!connectedToSite) {
      // Nothing is offered unasked here, but a card the person opened by tapping a link
      // stays until they close it, pay, or the payment fails.
      if (cardHost && shownInvoice === tappedInvoice) return;
      if (!pillAnywhere) return removeCard();
      // OPTED IN: the corner pill, and only the pill. Only for an invoice in a payment
      // panel (beside a QR, in a dialog: a BTCPay checkout), never one merely sitting on
      // the page, and never the full-screen card: this site has not been signed into, so
      // Sidecar does not interrupt it. Tapping the pill opens the card; a card open from
      // the pill stays while the invoice does. No auto-zap check either: a zap is only
      // ever authorized on a site that signs with Sidecar.
      const offered = findPageInvoice();
      const inv = offered && offered.asked ? offered.invoice : '';
      if (!inv || inv === dismissedInvoice || !hasWallet) return removeCard();
      if (inv === shownInvoice && cardHost) return;
      return renderPill(inv);
    }
    if (!showCard) return removeCard();
    const found = findPageInvoice();
    const invoice = found && found.invoice;
    if (!invoice || invoice === dismissedInvoice) return removeCard();
    // No wallet, nothing to offer. Asked again here rather than only at load, because
    // the answer changes the moment someone connects one, and once per invoice is cheap.
    if (!hasWallet) {
      if (walletAsked !== invoice) {
        walletAsked = invoice;
        try {
          chrome.runtime.sendMessage({ type: 'SIDECAR_GET_SETTINGS' }, (r) => {
            if (chrome.runtime.lastError) return;
            if (r && r.result && r.result.hasWallet) { hasWallet = true; scanForInvoice(); }
          });
        } catch (_) {}
      }
      return removeCard();
    }
    if (invoice === shownInvoice && cardHost) return; // already showing this one
    if (invoice === autopayPending) return; // asking the worker; show nothing yet
    if (invoice !== autopayDeclined) {
      // Ask first whether this is just the invoice for a zap already authorized on
      // this page. If it is, the worker pays it and no card is ever needed.
      autopayPending = invoice;
      chrome.runtime
        .sendMessage({ type: 'SIDECAR_TRY_ZAP_AUTOPAY', invoice, host })
        .then((res) => {
          autopayPending = '';
          const r = (res && res.ok && res.result) || null;
          if (r && r.handled) {
            // Either way the auto card has already been shown and carries the result.
            // Mark the invoice spent so the next DOM mutation can't re-probe it — the
            // approval is single-use, so that second probe would be declined and would
            // replace the card (and, on failure, throw the error message away).
            autopayDeclined = invoice;
            if (r.paid) dismissedInvoice = invoice;
            return;
          }
          autopayDeclined = invoice;
          scanForInvoice();
        })
        .catch(() => {
          // Worker asleep or updating — fall back to asking the user, never to
          // paying silently.
          autopayPending = '';
          autopayDeclined = invoice;
          scanForInvoice();
        });
      return;
    }
    // The one decision this whole change is about: did the person ask?
    if (found.asked) renderCard(invoice);
    else renderPill(invoice);
  }

  // THE ONE PATH THAT STILL OPENS THE CARD BY ITSELF: a tapped `lightning:` link. That is
  // a person asking to pay something, which is the whole distinction this file now draws.
  //
  // THE TAP IS SIDECAR'S when it opens the card, so the default is prevented. It was
  // left alone once, so that an app registered for lightning: kept it, and on a BTCPay
  // checkout that meant the tap opened BlueWallet (in a new tab, from the link's
  // target=_blank) instead of the card it was meant to open. The card's "Open in another
  // wallet" hands the same link on, and turning off the Settings switch for that kind of
  // site gives its taps back to that app. A tap Sidecar declines (no wallet, expired, dismissed)
  // falls through to the app as it always did.
  //
  // ON AN UNCONNECTED SITE TOO. A BTCPay checkout's "Pay in wallet" is exactly this link
  // on a site with no Nostr in it. With "Show on unconnected sites" on, the tap opens the
  // card; off (the default), it opens the card as an OFFER (see payOfferDismissed), which
  // is how anyone finds out Sidecar pays these at all. "Don't ask again" on that offer
  // gives such a site's taps back to the registered app. Paying still goes through
  // Sidecar's approval, since such a site has no budget.
  //
  // composedPath rather than closest, because the anchor may live in a shadow root.
  document.addEventListener('click', (e) => {
    if (retired) return;
    if (!hasWallet) return;
    // A signed-in site answers to "Show on Nostr sites". Any other answers to "Show on
    // unconnected sites", and with that off, to whether the offer was dismissed.
    let offer = false;
    if (connectedToSite) { if (!showCard) return; }
    else if (!pillAnywhere) { if (payOfferDismissed) return; offer = true; }
    const path = (e.composedPath && e.composedPath()) || [];
    for (const el of path) {
      const href = el && el.getAttribute && el.getAttribute('href');
      if (!href || !/^lightning:/i.test(href)) continue;
      const m = INVOICE_RE.exec(href.replace(/^lightning:/i, ''));
      if (!m) return;
      const inv = m[0].toLowerCase();
      if (invoiceExpired(inv) || inv === dismissedInvoice) return;
      e.preventDefault();
      tappedInvoice = inv;
      tappedHref = href;
      if (offer) offerInvoice = inv;
      renderCard(inv);
      return;
    }
  }, true);

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanForInvoice, 400);
  }

  // React to events pushed from the worker: setting toggle, and payment success
  // (clear the card — the invoice link often lingers after "Paid").
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // The worker asking whether this tab has a live copy (reconnectOpenTabs). Only a copy
    // still connected to the extension can hear it, which is the whole question.
    if (msg && msg.type === 'SIDECAR_PING') { sendResponse(true); return; }
    if (!msg || msg.type !== 'SIDECAR_EVENT') return;
    if (msg.event === 'settings') {
      showCard = msg.showPayButton !== false;
      if ('payPillAnywhere' in msg) pillAnywhere = msg.payPillAnywhere === true;
      if ('payOfferDismissed' in msg) payOfferDismissed = msg.payOfferDismissed === true;
      if ('autoZapOffer' in msg) autoZapOffer = Number(msg.autoZapOffer) || 0;
      scanForInvoice();
    } else if (msg.event === 'autopaying') {
      // An auto-zap is going out for this invoice. There is no action to take, which is
      // exactly why it belongs in the corner rather than on a card: money moving with
      // nothing on screen is the wrong trade (background.js), and a full-screen overlay
      // for a decision nobody has to make is the other wrong one. 'paid' / 'payfailed'
      // below land on this same indicator.
      if (msg.invoice) renderFlightPill(msg.invoice, true);
    } else if (msg.event === 'authorized') {
      // The decision came back approved (or a site budget meant there was never one to
      // make), and the wallet call is going out. This is the handover: the card has
      // finished covering the page and the corner takes the rest. Guarded on the invoice
      // so a stale ping cannot replace a card that is asking about a different one.
      if (msg.invoice && shownInvoice === msg.invoice) renderFlightPill(msg.invoice);
    } else if (msg.event === 'paid') {
      dismissedInvoice = msg.invoice; // don't resurface even if the link lingers
      // Tell the page's payment modal, if it has one, that this invoice settled. We
      // paid it entirely outside the page — scraped from the DOM, sent over NWC — so
      // a Bitcoin Connect modal is otherwise left spinning on an invoice that is
      // already paid. Handed to the MAIN world (nostr-provider.js) because the event
      // detail has to be built in the page's own realm for its listeners to read it.
      try {
        window.postMessage(
          { ext: 'sidecar', kind: 'settled', invoice: msg.invoice, preimage: msg.preimage || '' },
          '*'
        );
      } catch (_) {}
      // Throw the bolt across the page whether or not our own card was up — a zap
      // sent from the client's own UI has no card, and that's the common case.
      pageLightningStrike();
      if (shownInvoice === msg.invoice) {
        if (cardControls) cardControls.setPaid(); // brief "Paid" flash, then clear
        const flashed = cardHost;
        setTimeout(() => { if (cardHost === flashed) removeCard(); }, 1000);
      }
    } else if (msg.event === 'paidflash') {
      // A WebLN payment (a zap from this page's own UI) settled. No card to dismiss —
      // just the flourish.
      pageLightningStrike();
    } else if (msg.event === 'payfailed') {
      // Don't dismiss — let the user retry from the same card.
      if (shownInvoice === msg.invoice && cardControls) cardControls.setError(msg.error);
    }
  });

  // Start detection immediately (default on); refine with the saved setting
  // async so a settings-fetch hiccup can't prevent the card from ever appearing.
  function startCard() {
    if (retired) return;
    scanObserver = new MutationObserver(scheduleScan);
    scanObserver.observe(document.documentElement, { childList: true, subtree: true });
    scanForInvoice();
  }
  if (document.body) startCard();
  else document.addEventListener('DOMContentLoaded', startCard);

  try {
    chrome.runtime.sendMessage({ type: 'SIDECAR_GET_SETTINGS' }, (s) => {
      if (chrome.runtime.lastError) return; // keep the default (on)
      // Control replies are { ok, result } envelopes — the setting is inside
      // result. (Reading it off the top level meant a saved "off" never applied
      // on page load, only via the live settings push.)
      const settings = (s && s.result) || {};
      showCard = settings.showPayButton !== false;
      autoZapOffer = Number(settings.autoZapOffer) || 0;
      hasWallet = settings.hasWallet === true;
      pillAnywhere = settings.payPillAnywhere === true;
      payOfferDismissed = settings.payOfferDismissed === true;
      setCardTheme(settings.cardTheme || ''); // same reply carries the palette
      scanForInvoice();
    });
  } catch (_) {}

  // Seed the connection state from the persistent site binding, so a page that
  // shows an invoice immediately on load (before its client re-auths this session)
  // still surfaces the card if we've connected to this site before.
  try {
    chrome.runtime.sendMessage({ type: 'SIDECAR_IS_CONNECTED' }, (r) => {
      if (chrome.runtime.lastError) return;
      if (r && r.connected) {
        connectedToSite = true;
        scanForInvoice();
      }
    });
  } catch (_) {}
})();
