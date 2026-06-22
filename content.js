// Sidecar content script — bridges the page's window.nostr (nostr-provider.js) to the
// extension service worker. Injects the provider at document_start, then relays each
// request to the background, attaching the TRUSTED host (taken from location here, never
// from the page), and posts the response back to the page.

(function () {
  'use strict';

  // Inject the page-context provider as early as possible.
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('nostr-provider.js');
  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  const host = location.host; // trusted origin identity (includes port, e.g. localhost:3000)

  // Whether this page is signed into Sidecar's signer. Seeded from the persistent
  // site binding on startup, then flipped live the moment the page successfully
  // uses window.nostr. The "Pay with Sidecar" card only shows when this is true:
  // a live invoice on a nostr client you're signed into is a real pay intent; an
  // invoice anywhere else is almost always noise (and invoices are time-sensitive).
  let connectedToSite = false;

  const SCOPE_TO_TYPE = {
    nostr: 'SIDECAR_NOSTR_RPC',
    webln: 'SIDECAR_WEBLN_RPC',
  };

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.ext !== 'sidecar' || d.kind !== 'request') return;
    const type = SCOPE_TO_TYPE[d.scope];
    if (!type) return;

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

    try {
      chrome.runtime.sendMessage(
        { type, scope: d.scope, method: d.method, params: d.params, host },
        function (response) {
          let err;
          try { err = chrome.runtime.lastError; } catch (_) {
            return reply({ ok: false, error: 'Sidecar was updated — reload this page to reconnect.' });
          }
          // A successful nostr call means the page is signed in — unlock the pay
          // card and re-scan in case an invoice is already on screen.
          if (!err && d.scope === 'nostr' && response && response.ok && !connectedToSite) {
            connectedToSite = true;
            scheduleScan();
          }
          reply(err ? { ok: false, error: err.message } : response);
        }
      );
    } catch (e) {
      reply({ ok: false, error: 'Sidecar was updated — reload this page to reconnect.' });
    }
  });

  // ===== "Pay with Sidecar" confirmation card =====
  // When the page shows a Lightning invoice (a lightning: link, an input/QR value,
  // or a BOLT11 in the page text — e.g. a zap modal or Bitcoin Connect), present a
  // centered, style-isolated card over a dimmed backdrop showing what's being paid,
  // the amount, and the originating site, with one clear "Pay with Sidecar" action.
  // A corner pill kept getting buried under docked bars; a modal can't be lost.
  let showCard = true; // setting (default on)
  let cardHost = null;
  let shownInvoice = '';
  let dismissedInvoice = '';
  let escHandler = null;
  let cardControls = null; // { invoice, setPaid, setError } for the live card

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
  // Returns the first BOLT11 invoice found on the page (lowercased), or ''.
  function findPageInvoice() {
    // Pierce shadow DOM — web-component modals (e.g. Bitcoin Connect) render the
    // link inside a shadow root. Scan lightning: links, then input/textarea values
    // (satellite.earth puts a bare lnbc... in a readonly input), then page text.
    const roots = [document];
    for (let i = 0; i < roots.length && i < 2000; i++) {
      let links, fields, all;
      try {
        links = roots[i].querySelectorAll('a[href^="lightning:" i]');
        fields = roots[i].querySelectorAll('input, textarea');
        all = roots[i].querySelectorAll('*');
      } catch (_) {
        continue;
      }
      for (const a of links) {
        const m = INVOICE_RE.exec((a.getAttribute('href') || '').replace(/^lightning:/i, ''));
        if (m) return m[0].toLowerCase();
      }
      for (const f of fields) {
        const m = INVOICE_RE.exec(f.value || f.getAttribute('value') || '');
        if (m) return m[0].toLowerCase();
      }
      for (const el of all) if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    // Fallback: a BOLT11 in the page's visible text (a copyable invoice field).
    const m2 = /ln(?:bc|tb)[0-9][a-z0-9]{40,}/i.exec(document.body ? document.body.innerText : '');
    return m2 ? m2[0].toLowerCase() : '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
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

  const CARD_CSS =
    '.ov{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;' +
    'background:rgba(6,2,16,0.62);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);' +
    'font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;opacity:0;transition:opacity .18s ease;}' +
    '.ov.in{opacity:1;}' +
    '.card{box-sizing:border-box;width:100%;max-width:340px;text-align:center;color:#f1e8f8;padding:26px 24px 18px;' +
    'border-radius:20px;border:1px solid rgba(203,161,78,0.45);' +
    'background:radial-gradient(120% 90% at 50% 0%,rgba(203,161,78,0.16),transparent 58%),linear-gradient(165deg,#23114a,#160a30);' +
    'box-shadow:0 24px 70px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.05);' +
    'transform:translateY(10px) scale(.985);transition:transform .2s cubic-bezier(.2,.8,.2,1);}' +
    '.ov.in .card{transform:none;}' +
    '.brand{display:flex;justify-content:center;}' +
    '.brand-logo{height:26px;width:auto;display:block;}' +
    '.eyebrow{margin-top:16px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9a86c4;}' +
    '.amt{margin:7px 0 0;display:flex;align-items:baseline;justify-content:center;gap:6px;}' +
    '.amt .num{font-size:42px;font-weight:800;line-height:1;color:#cba14e;letter-spacing:-.01em;}' +
    '.amt .unit{font-size:15px;font-weight:600;color:#9a86c4;}' +
    '.memo{margin:14px auto 0;max-width:282px;font-size:13.5px;line-height:1.5;color:#e8d5f0;overflow-wrap:anywhere;' +
    'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}' +
    '.site{margin-top:10px;font-size:12px;color:#9a86c4;overflow-wrap:anywhere;text-wrap:balance;}' +
    '.site b{color:#bda1ff;font-weight:600;}' +
    '.pay{margin-top:20px;width:100%;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;' +
    'border:none;border-radius:13px;padding:14px;font-size:15px;font-weight:700;color:#1c0c00;' +
    'background:linear-gradient(180deg,#f6a85a,#ed8a3c 52%,#dd6f23);' +
    'box-shadow:0 8px 22px rgba(221,111,35,0.36),inset 0 1px 0 rgba(255,255,255,0.45);transition:filter .12s ease,transform .12s ease;}' +
    '.pay:hover{filter:brightness(1.05);}' +
    '.pay:active{transform:translateY(1px);}' +
    '.pay.pending{cursor:default;opacity:.94;}' +
    '.pay.done{cursor:default;background:none;box-shadow:none;color:#6ee7a8;}' +
    '.pay-bolt{height:16px;width:auto;display:block;}' +
    '.pay.pending .pay-bolt,.pay.done .pay-bolt{display:none;}' +
    '.pay-check{display:none;width:18px;height:18px;}' +
    '.pay.done .pay-check{display:block;}' +
    '.pay-spin{display:none;width:16px;height:16px;border-radius:50%;border:2px solid rgba(28,12,0,0.3);border-top-color:#1c0c00;animation:sc-spin .7s linear infinite;}' +
    '.pay.pending .pay-spin{display:block;}' +
    '@keyframes sc-spin{to{transform:rotate(360deg);}}' +
    '.pay-status{margin-top:11px;font-size:12px;line-height:1.45;color:#9a86c4;text-wrap:balance;}' +
    '.pay-status.err{color:#ffb38a;}' +
    '.cancel{margin-top:8px;width:100%;cursor:pointer;border:none;background:none;color:#9a86c4;font-size:13px;padding:9px;border-radius:10px;}' +
    '.cancel:hover{color:#f1e8f8;background:rgba(167,139,250,0.10);}' +
    '.card.busy .cancel{display:none;}' +
    '.card.busy .tg{opacity:.4;pointer-events:none;}' +
    '.tg{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding-top:14px;' +
    'border-top:1px solid rgba(167,139,250,0.16);cursor:pointer;}' +
    '.tg-label{font-size:12px;color:#9a86c4;}' +
    '.tg-input{position:absolute;opacity:0;width:0;height:0;}' +
    '.tg-track{position:relative;flex-shrink:0;width:38px;height:22px;border-radius:11px;background:#cba14e;transition:background .15s ease;}' +
    '.tg-thumb{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#1c0c00;transition:transform .15s ease;}' +
    '.tg-input:checked~.tg-track .tg-thumb{transform:translateX(16px);}' +
    '.tg-input:not(:checked)~.tg-track{background:rgba(167,139,250,0.25);}' +
    '.tg-input:not(:checked)~.tg-track .tg-thumb{background:#9a86c4;}';

  function removeCard() {
    if (cardHost && cardHost.parentNode) cardHost.parentNode.removeChild(cardHost);
    cardHost = null;
    shownInvoice = '';
    cardControls = null;
    if (escHandler) {
      window.removeEventListener('keydown', escHandler, true);
      escHandler = null;
    }
  }

  function renderCard(invoice) {
    removeCard();
    shownInvoice = invoice;
    const sats = invoiceSats(invoice);
    const memo = invoiceMemo(invoice);
    const site = location.host.replace(/^www\./, '');

    const eyebrow = sats != null ? "You're paying" : 'Pay with Sidecar';
    const amountBlock =
      sats != null
        ? '<div class="amt"><span class="num">' + sats.toLocaleString('en-US') + '</span><span class="unit">sats</span></div>'
        : '';
    const memoText = memo || (sats == null ? 'A Lightning invoice — choose the amount in Sidecar.' : '');
    const memoBlock = memoText ? '<div class="memo">' + escapeHtml(memoText) + '</div>' : '';

    cardHost = document.createElement('div');
    cardHost.style.cssText = 'all:initial;';
    const s = cardHost.attachShadow({ mode: 'open' });
    s.innerHTML =
      '<style>' + CARD_CSS + '</style>' +
      '<div class="ov">' +
      '<div class="card" role="dialog" aria-label="Pay with Sidecar">' +
      '<div class="brand">' + LOGO_SVG + '</div>' +
      '<div class="eyebrow">' + eyebrow + '</div>' +
      amountBlock +
      memoBlock +
      '<div class="site">to an invoice on <b>' + escapeHtml(site) + '</b></div>' +
      '<button class="pay" type="button"><span class="pay-spin"></span>' + bolt('pay-bolt') +
      '<svg class="pay-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' +
      '<span class="pay-label">Pay with Sidecar</span></button>' +
      '<div class="pay-status" hidden></div>' +
      '<button class="cancel" type="button">Not now</button>' +
      '<label class="tg"><span class="tg-label">Show this automatically</span>' +
      '<input class="tg-input" type="checkbox" checked>' +
      '<span class="tg-track"><span class="tg-thumb"></span></span></label>' +
      '</div></div>';

    const ov = s.querySelector('.ov');
    const card = s.querySelector('.card');
    const payBtn = s.querySelector('.pay');
    let sending = false;

    function dismiss() {
      if (sending) return; // don't let a dismiss interrupt an in-flight payment
      dismissedInvoice = invoice;
      removeCard();
    }

    // Payment is async (an NWC relay round-trip, a few seconds). Show a spinner
    // and a reassuring status line so the user knows it's working and doesn't hit
    // back or re-tap. The background reports the outcome via 'paid' / 'payfailed'.
    const label = s.querySelector('.pay-label');
    const status = s.querySelector('.pay-status');
    function setSending() {
      sending = true;
      card.classList.add('busy'); // dims + disables Not now / the toggle
      payBtn.classList.remove('done');
      payBtn.classList.add('pending');
      payBtn.disabled = true;
      label.textContent = 'Sending payment…';
      status.hidden = false;
      status.className = 'pay-status';
      status.textContent = 'Confirming with your wallet. This can take a few seconds.';
    }
    function setPaid() {
      payBtn.classList.remove('pending');
      payBtn.classList.add('done');
      payBtn.disabled = true;
      label.textContent = 'Paid';
      status.hidden = true;
    }
    function setError(detail) {
      sending = false;
      card.classList.remove('busy'); // re-enable Not now / the toggle for retry
      payBtn.classList.remove('pending', 'done');
      payBtn.disabled = false;
      label.textContent = 'Try again';
      status.hidden = false;
      status.className = 'pay-status err';
      status.textContent = detail || 'Payment failed. Please try again.';
    }
    cardControls = { invoice: invoice, setPaid: setPaid, setError: setError };

    payBtn.addEventListener('click', () => {
      setSending();
      try {
        chrome.runtime.sendMessage({ type: 'SIDECAR_PAY_PAGE_INVOICE', invoice }, () => void chrome.runtime.lastError);
      } catch (_) {
        setError('Sidecar was updated. Reload this page to pay.');
      }
    });
    s.querySelector('.cancel').addEventListener('click', dismiss);
    ov.addEventListener('click', (e) => {
      if (e.target === ov) dismiss();
    });
    s.querySelector('.tg-input').addEventListener('change', (e) => {
      if (!e.target.checked) {
        try {
          chrome.runtime.sendMessage(
            { type: 'SIDECAR_SET_SETTINGS', settings: { showPayButton: false } },
            () => void chrome.runtime.lastError
          );
        } catch (_) {}
        showCard = false;
        removeCard();
      }
    });

    escHandler = (e) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', escHandler, true);

    (document.documentElement || document.body).appendChild(cardHost);
    requestAnimationFrame(() => ov.classList.add('in'));
  }

  function scanForInvoice() {
    if (!showCard || !connectedToSite) return removeCard();
    const invoice = findPageInvoice();
    if (!invoice || invoice === dismissedInvoice) return removeCard();
    if (invoice === shownInvoice && cardHost) return; // already showing this one
    renderCard(invoice);
  }

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanForInvoice, 400);
  }

  // React to events pushed from the worker: setting toggle, and payment success
  // (clear the card — the invoice link often lingers after "Paid").
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'SIDECAR_EVENT') return;
    if (msg.event === 'settings') {
      showCard = msg.showPayButton !== false;
      scanForInvoice();
    } else if (msg.event === 'paid') {
      dismissedInvoice = msg.invoice; // don't resurface even if the link lingers
      if (shownInvoice === msg.invoice) {
        if (cardControls) cardControls.setPaid(); // brief "Paid" flash, then clear
        const flashed = cardHost;
        setTimeout(() => { if (cardHost === flashed) removeCard(); }, 1000);
      }
    } else if (msg.event === 'payfailed') {
      // Don't dismiss — let the user retry from the same card.
      if (shownInvoice === msg.invoice && cardControls) cardControls.setError(msg.error);
    }
  });

  // Start detection immediately (default on); refine with the saved setting
  // async so a settings-fetch hiccup can't prevent the card from ever appearing.
  function startCard() {
    new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
    scanForInvoice();
  }
  if (document.body) startCard();
  else document.addEventListener('DOMContentLoaded', startCard);

  try {
    chrome.runtime.sendMessage({ type: 'SIDECAR_GET_SETTINGS' }, (s) => {
      if (chrome.runtime.lastError) return; // keep the default (on)
      showCard = !(s && s.showPayButton === false);
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
