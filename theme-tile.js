// Sidecar — one theme preview, rendered in its own document.
//
// EXTERNAL, NOT INLINE, and that is not style: MV3's default page CSP is
// `script-src 'self'`, so an inline <script> in an extension page is silently refused.
// This shipped inline once and the symptom was a preview that looked "empty" — the
// palette fell back to :root, the theme sheet was never appended and the figure never
// painted, while the static markup around it rendered fine. Nothing in the page reports
// it. Every other page in this extension loads its script from a file for the same
// reason.

(function () {
  var theme = new URLSearchParams(location.search).get('t') || 'speakeasy';

  // Set before the sheet is requested, so the palette is never briefly the default.
  document.documentElement.setAttribute('data-theme', theme);

  // INSERTED BEFORE patterns.css, not appended, because the panel loads them in that
  // order and cascade order is part of what a theme looks like. par-avion.css sets
  // background-attachment on body and patterns.css sets it again; whichever comes last
  // wins, so appending here would render that theme's field differently from the panel it
  // is supposed to be previewing.
  var patterns = document.querySelector('link[href*="patterns.css"]');
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'themes/' + encodeURIComponent(theme) + '.css';
  document.head.insertBefore(link, patterns);

  // 21 rather than a realistic balance. A short figure is what buys the size: at five
  // digits the number has to shrink until the display face stops being legible, and the
  // face is the one thing a theme preview exists to show.
  var FIG = '21';

  // Mirrors splitGlyphs in sidepanel.js. --i and --n are the contract every theme's
  // balance animation sequences on, so the preview animates by the same rule the real
  // wallet does rather than by a copy of it that can drift.
  //
  // ANIMATE IS OPT-IN, and the default is still. Six cards playing six different
  // animations the moment a filter is switched is a fairground, and it competes with the
  // thing the grid is for, which is comparing them. The figure is painted at rest and
  // moves only when a card is picked — .bal-in is what every theme keys its animation on,
  // so leaving it off is the whole mechanism.
  function paint(animate) {
    var bal = document.getElementById('bal');
    if (!bal) return;
    bal.textContent = '';
    for (var i = 0; i < FIG.length; i++) {
      var s = document.createElement('span');
      s.className = 'bal-glyph' + (animate ? ' bal-in' : '');
      s.style.display = 'inline-block';
      s.style.setProperty('--i', i);
      s.style.setProperty('--n', FIG.length);
      s.textContent = FIG.charAt(i);
      bal.appendChild(s);
    }
  }

  // The gallery calls this only for the card you picked.
  window.replayPreview = function () { paint(true); };

  link.addEventListener('load', function () { paint(false); });
  paint(false);
})();
