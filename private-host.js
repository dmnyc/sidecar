// Which hostnames a fetch must never be pointed at: loopback, private, link-local
// (including cloud metadata at 169.254.169.254), CGNAT and reserved space, plus the
// local-network name suffixes.
//
// A string check on the hostname the URL parser hands back, which is normalized: a
// decimal or hex IPv4 literal arrives as dotted quad. It cannot see what a public name
// resolves to, so it is a guard on what is typed or linked, not a DNS-rebinding defense.
//
// Shared by the service worker (link previews, see safeFetchUrl in background.js) and
// the panel (LNURL-withdraw links, see lnurl-withdraw.js), which fetch addresses chosen
// by someone else. Loaded before both.

(function (root) {
  'use strict';

  function isPrivateHostname(host) {
    // URL.hostname keeps the brackets on an IPv6 literal ("[::1]"), so they come off first;
    // without that, no IPv6 check below could ever match what a parsed URL hands in.
    const h = (host || '').toLowerCase().replace(/^\[(.*)\]$/, '$1');
    if (!h) return true;
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (v4) {
      const a = +v4[1], b = +v4[2];
      if ([a, b, +v4[3], +v4[4]].some((n) => n > 255)) return true;
      if (a === 0 || a === 10 || a === 127) return true;         // this-host, private, loopback
      if (a === 169 && b === 254) return true;                    // link-local + metadata
      if (a === 172 && b >= 16 && b <= 31) return true;           // private
      if (a === 192 && b === 168) return true;                    // private
      if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT
      if (a >= 224) return true;                                  // multicast / reserved
      return false;
    }
    // IPv6 literals only: a name like fcbarcelona.com is not an address.
    if (h.includes(':')) {
      if (h === '::1' || h === '::') return true;
      if (h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true; // link-local / ULA
      if (h.startsWith('::ffff:')) return true; // IPv4-mapped
    }
    return false;
  }

  root.SidecarPrivateHost = { isPrivateHostname };
})(typeof self !== 'undefined' ? self : this);
