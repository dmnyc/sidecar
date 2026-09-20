'use strict';

// ---- the panel's DOM toolkit, shared with any other page that needs one ----
//
// Sidecar has no build step, so "shared" means a second <script> both pages load rather
// than an import. Everything here was lifted out of sidepanel.js unchanged and still runs
// there: the panel destructures it back into its own scope, so its several thousand calls
// to h() and icon() did not have to move.
//
// The rule for what belongs here: it is used by a composer, and it has no idea which page
// it is drawing into. Anything that reaches for the panel's own state stays in the panel
// and is handed in instead.
window.SidecarCore = (function () {
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');

  // ---- flat (line) icons — inherit currentColor ----
  const ICONS = {
    plus: '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>',
    // A painter's palette, for the per-account theme override. Not `flower`, which is
    // already Blossom's own mark (see KIND_ICONS 10063/24242) and would read as a
    // media-server action sitting in the account menu. The wells are filled rather than
    // stroked, the same as `grip` below: at r=1.5 an unfilled circle is a ring with a
    // hole in it, not a dot of paint.
    palette: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c.93 0 1.68-.75 1.68-1.68 0-.44-.17-.83-.44-1.13a1.66 1.66 0 0 1 1.24-2.77h1.98A5.54 5.54 0 0 0 22 10.88C22 5.98 17.52 2 12 2z"></path><circle cx="6.5" cy="11.5" r="1.5" fill="currentColor"></circle><circle cx="9.5" cy="7.5" r="1.5" fill="currentColor"></circle><circle cx="14.5" cy="7.5" r="1.5" fill="currentColor"></circle><circle cx="17.5" cy="11.5" r="1.5" fill="currentColor"></circle>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
    trash: '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>',
    key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>',
    feather: '<path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"></path><line x1="16" y1="8" x2="2" y2="22"></line><line x1="17.5" y1="15" x2="9" y2="15"></line>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
    unlock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path>',
    wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line>',
    more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"></circle><circle cx="12" cy="12" r="1.6" fill="currentColor"></circle><circle cx="19" cy="12" r="1.6" fill="currentColor"></circle>',
    'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
    check: '<polyline points="20 6 9 17 4 12"></polyline>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    help: '<circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    grip: '<circle cx="9" cy="7" r="1.5" fill="currentColor"></circle><circle cx="15" cy="7" r="1.5" fill="currentColor"></circle><circle cx="9" cy="12" r="1.5" fill="currentColor"></circle><circle cx="15" cy="12" r="1.5" fill="currentColor"></circle><circle cx="9" cy="17" r="1.5" fill="currentColor"></circle><circle cx="15" cy="17" r="1.5" fill="currentColor"></circle>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>',
    x: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
    'arrow-down': '<line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline>',
    'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline>',
    'arrow-up': '<line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline>',
    'chevron-down': '<polyline points="6 9 12 15 18 9"></polyline>',
    'arrow-up-right': '<line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline>',
    'arrow-down-left': '<line x1="17" y1="7" x2="7" y2="17"></line><polyline points="17 17 7 17 7 7"></polyline>',
    refresh: '<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>',
    'eye-off': '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>',
    pin: '<path d="M12 17v5"></path><path d="M9 10.76V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6.76a2 2 0 0 0 .59 1.42l1.12 1.12A2 2 0 0 1 18 14.59V16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-1.41a2 2 0 0 1 .29-1.29l1.12-1.12A2 2 0 0 0 9 10.76Z"></path>',
    // Bare price line for the chart toggle on the wallet balance card — no axes (the
    // right angle read as boxy at 15px) and no arrowhead, which would imply a rising
    // price on a day the chart may well show falling.
    chart: '<polyline points="3 16 8 10 12 13 16 7 21 11"></polyline>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><path d="M14 14h3v3M21 14v7h-7v-3"></path>',
    share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line>',
    bug: '<path d="m8 2 1.88 1.88"></path><path d="M14.12 3.88 16 2"></path><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"></path><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"></path><path d="M12 20v-9"></path><path d="M6.53 9C4.6 8.8 3 7.1 3 5"></path><path d="M6 13H2"></path><path d="M3 21c0-2.1 1.7-3.9 3.8-4"></path><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"></path><path d="M22 13h-4"></path><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"></path>',
    // ---- activity-log kinds ----
    // Broadcast tower for relay auth. Drawn as stroke center-lines on the 24x24 grid
    // rather than imported as filled art: icon() forces viewBox="0 0 24 24" with
    // fill:none and stroke=currentColor, so a filled path renders as a hollow outline
    // of itself, in the wrong box. Apex emitter, A-frame mast with a cross-brace, and
    // two pairs of arcs for near/far signal.
    tower: '<circle cx="12" cy="6" r="1.6"></circle><path d="M10.6 9.4 7 22"></path><path d="M13.4 9.4 17 22"></path><path d="M9.2 15h5.6"></path><path d="M8.1 4a6 6 0 0 0 0 8"></path><path d="M15.9 4a6 6 0 0 1 0 8"></path><path d="M5.2 1.6a9.6 9.6 0 0 0 0 12.8"></path><path d="M18.8 1.6a9.6 9.6 0 0 1 0 12.8"></path>',
    // A vector resembling the cherry-blossom emoji the Blossom repo uses in its README
    // title (github.com/hzrd149/blossom — the protocol has no official vector mark).
    // Supplied by Daniel; a better read than the circles I first approximated it with.
    // FILLED art on a 58.48x63.59 viewBox, so
    // unlike every stroke icon here it needs two things icon() doesn't give it:
    //   fill="currentColor" stroke="none"  — icon() sets fill:none, which would
    //     render a filled path invisible (and stroking it draws a doubled outline)
    //   a transform into the 24x24 box   — scale 63.59 -> 21 and center
    // Result spans x 2.34..21.66, y 1.5..22.5, matching `tower` (1.6..22) so the two
    // carry the same weight side by side in the log. Same fill="currentColor" trick
    // the `more` and `grip` dot glyphs use, so it still follows the theme color.
    flower: '<g transform="translate(2.34 1.5) scale(0.3302)" fill="currentColor" stroke="none"><path d="M56.88,15.79c-3.15-5.5-10.05-7.56-15.71-4.71C40.66,4.48,34.9-.47,28.29.04c-5.9.45-10.6,5.14-11.05,11.05-5.96-2.89-13.14-.41-16.03,5.56-2.6,5.35-.88,11.8,4.03,15.15-5.42,3.82-6.72,11.3-2.9,16.72,3.33,4.73,9.57,6.41,14.83,3.99.51,6.61,6.27,11.55,12.88,11.05,5.9-.45,10.6-5.14,11.05-11.05,5.96,2.89,13.14.41,16.03-5.56,2.6-5.35.88-11.8-4.03-15.15,5.29-3.5,6.95-10.51,3.78-16ZM37.28,24.68c.91-3.41,3.14-6.32,6.2-8.08.91-.53,1.95-.81,3-.81,3.31,0,6,2.68,6.01,5.99,0,2.15-1.14,4.13-3.01,5.21-3.06,1.77-6.69,2.24-10.1,1.33l-2.87-.77.77-2.87ZM21.05,38.9c-.91,3.41-3.14,6.32-6.2,8.08-.91.53-1.95.81-3,.81-3.31,0-6-2.68-6.01-5.99,0-2.15,1.14-4.13,3.01-5.21,3.06-1.77,6.69-2.24,10.1-1.33l2.87.77-.77,2.87ZM18.95,28.31c-3.41.91-7.04.44-10.1-1.33-2.87-1.65-3.86-5.32-2.2-8.19,0,0,0,0,0,0,1.07-1.86,3.06-3,5.21-3,1.05,0,2.09.28,3,.81,3.06,1.76,5.29,4.67,6.2,8.08l.77,2.87-2.88.77ZM29.17,57.79c-3.31,0-6-2.69-6-6,0-3.53,1.4-6.92,3.9-9.41l2.1-2.1,2.1,2.1c2.5,2.49,3.91,5.88,3.9,9.41,0,3.31-2.69,6-6,6ZM25.17,31.79c0-2.21,1.79-4,4-4s4,1.79,4,4-1.79,4-4,4-4-1.79-4-4ZM31.27,21.2l-2.1,2.1-2.1-2.1c-2.5-2.49-3.91-5.88-3.9-9.41,0-3.31,2.69-6,6-6s6,2.69,6,6c0,3.53-1.4,6.92-3.9,9.41ZM51.69,44.79c-1.07,1.86-3.06,3-5.21,3-1.05,0-2.09-.28-3-.81-3.06-1.76-5.29-4.67-6.2-8.08l-.77-2.87,2.87-.77c3.41-.91,7.04-.44,10.1,1.33,2.87,1.65,3.86,5.32,2.2,8.19,0,0,0,0,0,0h.01Z"></path></g>',
    // Stock Feather at 24x24, stroke-width 2 (see icon()). Added so the Recent
    // activity list can distinguish what was signed instead of showing one quill
    // for everything — a column of identical feathers is unreadable when a client
    // fires a dozen relay auths.
    repeat: '<polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path>',
    heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>',
    wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"></path>',
    'help-circle': '<circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    // Proof of work. A pickaxe rather than the hash it computes: the hash is the subject
    // of the work, and a button needs the verb. A # also reads as a tag everywhere else on
    // nostr, which is the one thing it must not be mistaken for here.
    //
    // Curved head top right, handle running down to the bottom left on the 45. The angle
    // is what keeps it from reading as an umbrella, which is where a level head over a
    // vertical handle lands. Arc and handle meet at the arc's own apex, computed rather
    // than eyeballed, so the two strokes join cleanly instead of crossing.
    pickaxe: '<path d="M12.5 3.2a9 9 0 0 1 8.3 8.3"></path><line x1="18.2" y1="5.8" x2="3.5" y2="20.5"></line>',
    'badge-check': '<path d="M18.9 14.9Q22 12 18.9 9.1Q19.1 4.9 14.9 5.1Q12 2 9.1 5.1Q4.9 4.9 5.1 9.1Q2 12 5.1 14.9Q4.9 19.1 9.1 18.9Q12 22 14.9 18.9Q19.1 19.1 18.9 14.9Z"></path><polyline points="9 12 11 14 15.5 9"></polyline>',
    'user-check': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><polyline points="17 11 19 13 23 9"></polyline>',
    'user-x': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="18" y1="8" x2="23" y2="13"></line><line x1="23" y1="8" x2="18" y2="13"></line>',
    'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline>',
    mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline>',
    // Solid twin of message-circle. At 14px the stroked balloon reads thin and washes
    // out; filled, it carries the same weight as the zap bolt beside it.
    'message-filled': '<path d="M12 3C6.5 3 2 6.75 2 11.25c0 2.3 1.18 4.38 3.07 5.86L4 21.5l4.66-2.06c1.05.27 2.17.41 3.34.41 5.5 0 10-3.75 10-8.6S17.5 3 12 3z"></path>',
    'message-circle': '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>',
    award: '<circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>',
    'bar-chart': '<line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="16"></line>',
    globe: '<circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>',
  };

  // Icons that are SOLID shapes rather than strokes.
  //
  // Filling a stroked path does not work: Feather's outlines have the stroke width baked
  // into their proportions, so turning fill on gives a muddy blob with a hairline hole.
  // A solid glyph needs its own path, and then it must render with fill and no stroke —
  // which is what this set is for. The zap already lives outside ICONS for the same
  // reason (boltIcon).
  const FILLED_ICONS = new Set(['message-filled']);

  function icon(name) {
    const solid = FILLED_ICONS.has(name);
    const wrap = document.createElement('span');
    wrap.innerHTML =
      '<svg viewBox="0 0 24 24" fill="' + (solid ? 'currentColor' : 'none') +
      '" stroke="' + (solid ? 'none' : 'currentColor') +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[name] || '') +
      '</svg>';
    return wrap.firstElementChild;
  }


  function h(tag, props, children) {
    const el = document.createElement(tag);
    if (props) Object.assign(el, props);
    (children || []).forEach((c) => el.append(c));
    return el;
  }

  return { show, hide, ICONS, FILLED_ICONS, icon, h };
})();
