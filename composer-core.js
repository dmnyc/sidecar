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
    // Feather's video: a camera body with the lens flare cut out of its side. Used as
    // the placeholder on a video attachment's thumbnail, where a decoded frame is both
    // expensive and, in a 72px square, not actually informative.
    video: '<polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>',
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
    // arrow-left's mirror, for the thumbnail reorder steppers. Rotating one icon
    // for the other reads fine at 24px and wrong at 14px, where the join shows.
    'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>',
    'chevron-down': '<polyline points="6 9 12 15 18 9"></polyline>',
    'arrow-up-right': '<line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline>',
    'arrow-down-left': '<line x1="17" y1="7" x2="7" y2="17"></line><polyline points="17 17 7 17 7 7"></polyline>',
    // A four-pointed star, for the card shown once after an update. Drawn rather than
    // borrowed: the nearest existing glyphs are the pickaxe and the feather, and both
    // already mean something specific in this panel.
    sparkle: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3z"></path>',
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

  // Params that identify where a visitor came FROM, never which page they're on.
  // Left in, every share link spawns its own thread.
  //
  // Deliberately a denylist, never "strip the whole query". For plenty of sites the
  // query IS the page (youtube.com/watch?v=…), and dropping a load-bearing param is
  // strictly worse than a split thread: the published identifier would then point at
  // a URL rendering different content, or nothing. Anything ambiguous stays — `ref`
  // in particular is functional often enough to leave alone.
  const TRACKING_PARAMS = [
    // ad-click IDs
    'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'twclid', 'ttclid',
    'yclid', 'igshid', 'li_fat_id', 'epik', 'rdt_cid', 'sccid', 'srsltid', 's_kwcid',
    // email + marketing platforms
    'mc_cid', 'mc_eid', 'mkt_tok', '_hsenc', '_hsmi', 'vero_conv', 'vero_id',
    'oly_anon_id', 'oly_enc_id', '__s',
    // analytics and referrer echoes
    '_ga', '_openstat', 'ref_src', 'ref_url', 'ncid', 'spm', 'at_medium', 'at_campaign',
    // Yahoo consent-redirect residue
    'guccounter', 'guce_referrer', 'guce_referrer_sig',
    // Facebook share callbacks
    'fb_action_ids', 'fb_action_types', 'fb_ref', 'fb_source',
    'action_object_map', 'action_type_map', 'action_ref_map',
  ];

  // Namespaces that exist only for analytics, so the whole family goes without
  // enumerating it. `utm_` alone has a dozen variants past the common five
  // (utm_name, utm_source_platform, utm_marketing_tactic, …) and vendors keep adding
  // more — matching the prefix is what actually answers "utm junk", where a fixed
  // list silently rots.
  const TRACKING_PREFIXES = ['utm_', 'pk_', 'piwik_', 'mtm_', 'hsa_'];

  // Pure tracking on a specific host, but possibly load-bearing elsewhere, so only
  // stripped where we know what it means. YouTube's `si` is the most common
  // real-world splitter there is: every press of Share mints a fresh one, so one
  // video would otherwise carry a separate thread per sharer.
  //
  // Amazon is deliberately absent. Its `tag` is an affiliate code, which is sometimes
  // the entire reason somebody shared the link, and a button offering to remove
  // "tracking" should not quietly be a button that removes their earnings.
  const HOST_TRACKING_PARAMS = [
    { host: /(^|\.)(youtube\.com|youtu\.be)$/i, params: ['si', 'pp', 'feature', 'kw'] },
    // Same shape as YouTube's `si`, and the same consequence: `t` is minted fresh on
    // every press of Share, so one post would carry a separate thread per sharer.
    { host: /^(x\.com|twitter\.com)$/i, params: ['s', 't'] },
    { host: /(^|\.)spotify\.com$/i, params: ['si', 'nd', 'nd_lfid'] },
    { host: /(^|\.)tiktok\.com$/i, params: ['is_from_webapp', 'sender_device', '_r', '_t'] },
    { host: /(^|\.)reddit\.com$/i, params: ['share_id', 'rdt', 'correlation_id', 'ref_source', 'ref_campaign'] },
    { host: /(^|\.)linkedin\.com$/i, params: ['trk', 'trackingid'] },
  ];

  // Case-insensitive: the same vendor ships both `ScCid` and `sccid`, and a param
  // that survives on a capital letter splits the thread just as effectively.
  function isTrackingParam(name) {
    const n = String(name).toLowerCase();
    return TRACKING_PARAMS.includes(n) || TRACKING_PREFIXES.some((p) => n.startsWith(p));
  }

  // ---- the same list, for a link pasted into a composer ----
  //
  // A link copied out of a browser usually arrives with a tail describing the person who
  // copied it rather than the thing it points at: which campaign reached them, which app
  // they were in, and an id that ties that click back to them. Posting it forwards all of
  // that to everyone who reads the note, which is not something anyone means to do by
  // pasting a link.
  //
  // OFFERED, NEVER DONE FOR YOU. Sidecar's claim is that it signs what you asked it to
  // sign, and quietly rewriting the words in a composer is the same kind of act as
  // quietly rewriting an event. So a paste that carries a tail says so, once, and one
  // button takes it off.
  //
  // NOT normalizeWebUrl, which is next door and looks like it would do. That one builds a
  // THREAD IDENTIFIER: it sorts the query and drops the fragment so two people reach the
  // same address, both of which would be edits to a link the user did not ask us to edit.
  // What is shared is the list of what counts as tracking, which is the part worth having
  // in one place.
  function hostTrackingParams(hostname) {
    const rule = HOST_TRACKING_PARAMS.find((r) => r.host.test(String(hostname || '')));
    return rule ? rule.params : null;
  }

  // Cuts whole k=v segments out of the query, textually. Rebuilding through URL or
  // URLSearchParams would re-encode every parameter being KEPT: a %20 comes back a +, an
  // unescaped bracket comes back escaped. That is a change to a link nobody asked us to
  // change, on a path whose entire promise is that it changes nothing else.
  //
  // The query only, never the path. Several sites carry tracking in path segments too,
  // and nothing tells those apart from an id without knowing the site. Confining this to
  // whole parameters is what makes it safe against a URL for a site nobody here has heard
  // of: the output is the input minus entire parameters, so a link that worked still
  // works. Returns null when there is nothing to take off.
  function cleanTrackedUrl(raw) {
    const s = String(raw || '');
    if (!/^https?:\/\//i.test(s)) return null;
    const q = s.indexOf('?');
    if (q === -1) return null;
    let hostname;
    try { hostname = new URL(s).hostname; } catch (_) { return null; }
    const hashAt = s.indexOf('#', q);
    const head = s.slice(0, q);
    const tail = hashAt === -1 ? '' : s.slice(hashAt);
    const query = s.slice(q + 1, hashAt === -1 ? undefined : hashAt);
    const hostParams = hostTrackingParams(hostname);
    const parts = query.split('&').filter((part) => part !== '');
    const kept = parts.filter((part) => {
      const eq = part.indexOf('=');
      const encoded = (eq === -1 ? part : part.slice(0, eq)).replace(/\+/g, ' ');
      let name = encoded;
      try { name = decodeURIComponent(encoded); } catch (_) { /* a stray % is still a name */ }
      if (isTrackingParam(name)) return false;
      return !hostParams || hostParams.indexOf(name.toLowerCase()) === -1;
    });
    if (kept.length === parts.length) return null;
    return head + (kept.length ? '?' + kept.join('&') : '') + tail;
  }

  // Trailing punctuation belongs to the sentence, not to the link. A URL written at the
  // end of a line takes the period with it otherwise, and the cleaned version would come
  // back without one.
  function trimUrlTail(url) {
    let out = url;
    for (;;) {
      const before = out;
      out = out.replace(/[.,;:!?'"]+$/, '');
      for (const [close, open] of [[')', '('], [']', '['], ['}', '{']]) {
        if (!out.endsWith(close)) continue;
        if (out.split(close).length > out.split(open).length) out = out.slice(0, -1);
      }
      if (out === before) return out;
    }
  }

  function findTrackedUrls(text) {
    const out = [];
    const seen = new Set();
    const re = /https?:\/\/[^\s<>"'`]+/gi;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const raw = trimUrlTail(m[0]);
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      const clean = cleanTrackedUrl(raw);
      if (clean && clean !== raw) out.push({ raw, clean });
    }
    // Longest first, so replacing one link cannot eat the front of another that starts
    // with it. Two shares of the same page with different campaign ids do exactly that.
    out.sort((a, b) => b.raw.length - a.raw.length);
    return out;
  }

  // ---- which cut of the artwork this theme wants ----
  //
  // Here rather than in the panel because the comment below already says why: it is the
  // place a new light theme has to be registered, and the expanded composer page would
  // have been one more. Everything in this block is a pure function of the theme name or
  // of the live data-theme attribute, so any page can call it.
  // Path to the full Sidecar logo for a given theme. Art Deco uses a variant
  // whose wordmark is dark purple (#5a4a8a) for legibility on the light
  // eggshell background; the cocktail-glass mark is identical in both files
  // (official colors), so only the wordmark changes.
  // Sibling copies live in content.js (LIGHT_CARD_THEMES, the page-side pay card) and
  // prompt.js (the approval window's wordmark). Three documents, no module system between
  // them; a new light theme has to be registered in all three.
  const LIGHT_THEMES = new Set(['industria', 'aegean', 'bauhaus', 'populuxe', 'par-avion', 'werkstatte', 'ukiyo-e']);
  function logoSrcFor(themeName) {
    // EVERY light theme needs the dark-wordmark variant; the default is baked
    // lavender for a dark field and disappears on marble, eggshell or plaster.
    // A set rather than a chain of ||, because this is the fourth place a theme
    // has to be registered and the chain form is the one that gets forgotten.
    return LIGHT_THEMES.has(themeName)
      ? 'icons/sidecar-logo-deco.svg'
      : 'icons/sidecar-logo.svg';
  }

  // Which cut of the placeholder garnish to use. It is drawn in white for a dark
  // avatar disc, and on the five light themes that is white on white — the slice was
  // simply not there, on the account switcher, the rows, the compose author, the
  // notification modal, everywhere. Same shape as logoSrcFor above and for exactly the
  // same reason, so it reads the same LIGHT_THEMES set: one place to register a theme,
  // not two.
  //
  // Reads the live attribute rather than taking a parameter, because applyAvatar is
  // called from a dozen renderers that have no idea what the theme is and should not
  // have to be told.
  function avatarPhSrc() {
    return LIGHT_THEMES.has(document.documentElement.getAttribute('data-theme'))
      ? 'icons/avatar-default-dark.svg'
      : 'icons/avatar-default.svg';
  }

  // ---- the composer's editor ----
  //
  // Everything below was the panel's, and still reads exactly as it did there. What
  // changed is where its collaborators come from: profile lookups, the follow list, the
  // global name search and its consent ask are all page-level services, so the page
  // hands them in and this file stays ignorant of which one it is drawing into.
  //
  // One mutable binding rather than an argument threaded through thirty functions. A
  // document only ever runs one page, so there is only ever one installer, and keeping
  // the moved code otherwise byte-identical was worth more than the purity.
  // THE THROTTLE LIVES HERE, not at each call site. This fires on every input event, and
  // the panel wrapped its own in a 20s guard while the expanded composer page passed the
  // bare message: a keystroke each, waking the service worker the whole time somebody is
  // writing. Only one of the two was going to be remembered, so neither is asked to.
  let lastActivityPing = 0;
  function pingActivity() {
    const now = Date.now();
    if (now - lastActivityPing < 20000) return;
    lastActivityPing = now;
    try { deps.noteActivity(); } catch (_) {}
  }

  let deps = null;
  function installComposer(d) {
    deps = d;
    return {
      serializeEditor, hydrateEditorFromText, createMentionEditor,
      renderNotePreview, uploadMedia, minePow, powCancel,
      resolveClient, showPostCountdown, splitGlyphs, ironDiceStyle,
      resolveQuotePreviews, sha256Hex, glyphBeat, relTime, quoteSnippet, firstQuoteImage,
      powSetting, postCountdownSetting,
      // The panel calls these directly as well as through renderNotePreview: the about
      // box resolves its own mentions, a quote preview needs embedRef, a reply's context
      // strip renders with renderNoteText, the web-comment sheet draws its own link card,
      // the unlock cooldown paints with paintCountdownNum, and the profile-picture
      // uploader tries Blossom first. Every one of them is a name that used to be in the
      // panel's scope for free.
      renderNoteText, renderLinkCard, resolveMentions, embedRef, tryBlossomFirst,
      paintCountdownNum,
    };
  }

  // Serialize a contenteditable editor div to plain nostr text.
  // Text nodes → text, BR → \n, block divs → \n prefix, pill spans → their data-bech32.
  //   (NBSP used after pills to prevent browser whitespace collapse) → regular space.
  function serializeEditor(el) {
    let out = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent.replace(/ /g, ' ');
      } else if (node.nodeName === 'BR') {
        out += '\n';
      } else if (node.dataset && node.dataset.bech32) {
        out += node.dataset.bech32;
      } else {
        const isBlock = node.nodeName === 'DIV' || node.nodeName === 'P';
        if (isBlock && out && !out.endsWith('\n')) out += '\n';
        node.childNodes.forEach(walk);
      }
    };
    el.childNodes.forEach(walk);
    return out;
  }

  // Inverse of serializeEditor: rebuild the editor's rich DOM (mention pills,
  // line breaks) from a raw saved string — used when resuming a draft, since
  // just setting .textContent leaves 'nostr:npub1…' as visible plain text
  // instead of a resolved @name pill. A pill's name resolves instantly from the
  // profile cache when available, else shows a short npub that upgrades in
  // place once the profile loads (same pattern as embed cards elsewhere).
  function hydrateEditorFromText(editor, text) {
    editor.innerHTML = '';
    const appendText = (s) => {
      const lines = s.split('\n');
      lines.forEach((line, i) => {
        if (line) editor.appendChild(document.createTextNode(line));
        if (i < lines.length - 1) editor.appendChild(document.createElement('br'));
      });
    };
    const mentionRe = /nostr:(npub1[0-9a-z]+|nprofile1[0-9a-z]+)/g;
    let last = 0, m;
    while ((m = mentionRe.exec(text)) !== null) {
      if (m.index > last) appendText(text.slice(last, m.index));
      const bech32 = m[0];
      let pubkey = null, fallback = bech32;
      try {
        const decoded = deps.NT.nip19.decode(m[1]);
        pubkey = decoded.type === 'npub' ? decoded.data : decoded.data.pubkey;
        fallback = deps.shortNpub(deps.NT.nip19.npubEncode(pubkey));
      } catch (_) {}
      const pill = document.createElement('span');
      pill.className = 'mention-pill';
      pill.contentEditable = 'false';
      pill.dataset.bech32 = bech32;
      const cached = pubkey ? deps.cachedProfile(pubkey) : null;
      pill.textContent = '@' + (cached && cached.name ? cached.name : fallback);
      editor.appendChild(pill);
      last = mentionRe.lastIndex;
      // A plain space right after the mention is the pill's trailing separator —
      // render it as NBSP (matching live insertion via the @-autocomplete) so it
      // isn't visually collapsed; serializeEditor turns it back into a space.
      if (text[last] === ' ') {
        editor.appendChild(document.createTextNode(' '));
        last += 1;
        mentionRe.lastIndex = last;
      }
      if (pubkey && !(cached && cached.name)) {
        deps.fetchPreviewProfile(pubkey).then((p) => { if (p && p.name) pill.textContent = '@' + p.name; });
      }
    }
    if (last < text.length) appendText(text.slice(last));
  }

  // ---- a URL pasted on its own is a picture asking to be attached ----
  //
  // Offered, never done — the same rule the tracking-tags row lives by. A paste whose
  // whole content is one image URL gets a single offer to become an attachment
  // (thumbnail in the strip, URL appended to the note's end at publish, exactly as
  // if it had been uploaded), and the offer is one button that the next keystroke
  // withdraws. Riding inside a larger paste is prose and stays prose.
  // A VIDEO IS AS ATTACHABLE AS AN IMAGE. This gated on IMG_EXT alone, so pasting a
  // .mp4 got no offer at all and the URL stayed as prose, while the identical paste of
  // a .png became an attachment. VID_EXT was already in this file and already used to
  // decide how a URL RENDERS; the offer simply never asked it.
  function loneMediaUrl(text) {
    const s = String(text || '').trim();
    if (!/^https?:\/\/\S+$/i.test(s)) return null;
    return IMG_EXT.test(s) || VID_EXT.test(s) ? s : null;
  }

  // Which of the two it was, for the draft slot. Read here rather than at each call
  // site, so the thumbnail strip and the offer can never disagree about a URL.
  function urlIsVideo(url) {
    return VID_EXT.test(String(url || ''));
  }

  // Where the pasted URL landed. An offer may cut it out of the text only when it
  // sits on a boundary: alone on its line, or glued to either END of one — a paste
  // straight after a paragraph, no return pressed, is attach intent too. A URL with
  // words on both sides of it is inside a sentence and stays in the sentence; a URL
  // appearing twice on one line is ambiguous and declines.
  function urlOnBoundary(lines, url) {
    for (const raw of lines) {
      const t = raw.trim();
      if (!t.includes(url)) continue;
      const parts = t.split(url);
      if (parts.length !== 2) return false;
      return !parts[0].trim() || !parts[1].trim();
    }
    return false;
  }

  // Cut a URL line back out of the editor — the reverse of appending it. Text-node
  // surgery rather than a rebuild, so the caret and every other word stay where the
  // user left them.
  function removeUrlFromEditor(editor, url) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let wn;
    while ((wn = walker.nextNode())) {
      if (wn.textContent.includes(url)) {
        wn.textContent = wn.textContent.replace('\n' + url, '').replace(url, '');
        return true;
      }
    }
    return false;
  }

  // A rich text box with @mention autocomplete and pills, shared by the note
  // composer and the page-comment modal. Owns its own dropdown state so two can
  // coexist; the caller supplies `onChange` for whatever it does with the text
  // (draft autosave, enabling a Post button, repainting a preview).
  //
  // Returns { wrap, editor, getText, setText, focus, close }. Append `wrap` —
  // not `editor` — since the dropdown positions itself against the wrapper.
  function createMentionEditor(opts) {
    const onChange = (opts && opts.onChange) || (() => {});
    // The attachment offer only exists where a draft can hold one: the note
    // composers hand in the conversion, and an editor without one (the page-comment
    // box) never shows the row.
    const onAttachUrl = (opts && opts.onAttachUrl) || null;
    const editor = h('div', { className: 'compose-text compose-editor is-empty', contentEditable: 'true' });
    editor.dataset.placeholder = (opts && opts.placeholder) || '';
    const wrap = h('div', { className: 'compose-editor-wrap' });
    wrap.append(editor);

    let acDropdown = null, acResults = [], acIndex = 0;
    let acSeq = 0, acSuggestTimer = null; // guard stale async + debounce global search

    function syncEmptyClass() {
      const isEmpty = !editor.textContent.trim() && !editor.querySelector('[data-bech32]');
      editor.classList.toggle('is-empty', isEmpty);
      if (isEmpty) editor.innerHTML = '';
    }

    // Report the text upward, keeping the placeholder state in sync first.
    function emit() {
      const text = serializeEditor(editor);
      syncEmptyClass();
      onChange(text);
    }

    function getCaretContext() {
      const sel = window.getSelection();
      if (!sel.rangeCount) return null;
      const range = sel.getRangeAt(0);
      if (!range.collapsed) return null;
      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE || !editor.contains(node)) return null;
      const before = node.textContent.slice(0, range.startOffset);
      const match = before.match(/@([^\s@]*)$/);
      if (!match) return null;
      return { node, query: match[1] };
    }

    function closeAcDropdown() {
      if (acDropdown) { acDropdown.remove(); acDropdown = null; }
      acResults = []; acIndex = 0;
    }

    function updateAcActiveItem() {
      if (!acDropdown) return;
      acDropdown.querySelectorAll('.ac-item').forEach((el, i) => el.classList.toggle('active', i === acIndex));
    }

    function selectAcItem(contact, query) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) return;
      const offset = range.startOffset;
      // Text before the '@'. Trim any trailing whitespace and re-add exactly one
      // space, so the mention is always preceded by a single space (or nothing
      // at line start). Trimming the whole run both collapses a stray double
      // space and sidesteps the old single-code-unit check, which mis-read an
      // emoji's surrogate half (e.g. 🤝) as a non-space char and inserted an
      // extra space.
      const beforeAt = node.textContent.slice(0, Math.max(0, offset - (query.length + 1)));
      const trimmed = beforeAt.replace(/\s+$/, '');
      const atStart = trimmed.length;
      const needsLeadingSpace = trimmed.length > 0;
      range.setStart(node, atStart);
      range.setEnd(node, offset);
      range.deleteContents();
      const pill = document.createElement('span');
      pill.className = 'mention-pill';
      pill.contentEditable = 'false';
      pill.dataset.bech32 = 'nostr:' + deps.NT.nip19.npubEncode(contact.pubkey);
      pill.textContent = '@' + contact.name;
      if (needsLeadingSpace) range.insertNode(document.createTextNode(' '));
      range.collapse(false);
      range.insertNode(pill);
      // NBSP after pill: never collapsed by the browser, normalized to space by serializer.
      const trailingSpace = document.createTextNode(' ');
      range.setStartAfter(pill);
      range.insertNode(trailingSpace);
      range.setStartAfter(trailingSpace);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      closeAcDropdown();
      emit();
    }

    // Anchor the dropdown just under the caret line rather than the bottom of
    // the (tall) editor box. Falls back to the CSS default if no caret rect.
    function positionAcDropdown() {
      if (!acDropdown) return;
      try {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (!r || (!r.top && !r.bottom)) return;
        const wrapRect = wrap.getBoundingClientRect();
        acDropdown.style.top = Math.round(r.bottom - wrapRect.top + 4) + 'px';
      } catch (_) {}
    }

    // `loading` shows a "Searching Nostr…" footer while the global lookup runs,
    // and keeps the dropdown open even when there are no local matches yet.
    // `askEl` is the one-time Nostr Archives ask standing in for that footer
    // while the setting is unset (see the NA block).
    function renderAcResults(items, ctx, loading, askEl) {
      acResults = items;
      if (!acResults.length && !loading && !askEl) { closeAcDropdown(); return; }
      acIndex = Math.max(0, Math.min(acIndex, Math.max(0, acResults.length - 1)));
      if (!acDropdown) {
        acDropdown = h('div', { className: 'ac-dropdown' });
        wrap.append(acDropdown);
      }
      positionAcDropdown();
      acDropdown.innerHTML = '';
      acResults.forEach((c, i) => {
        const item = h('div', { className: 'ac-item' + (i === acIndex ? ' active' : '') });
        const av = h('span', { className: 'ac-item-av' });
        deps.applyAvatar(av, c.picture ? { picture: c.picture } : {});
        item.append(av, h('span', { className: 'ac-item-name', textContent: '@' + c.name }));
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const fresh = getCaretContext();
          selectAcItem(c, fresh ? fresh.query : ctx.query);
        });
        acDropdown.append(item);
      });
      if (loading) {
        acDropdown.append(h('div', { className: 'ac-loading' }, [
          h('span', { className: 'ac-spinner' }),
          h('span', { textContent: acResults.length ? 'Searching more…' : 'Searching Nostr…' }),
        ]));
      }
      // The ask goes ABOVE the results: the box caps at 200px and scrolls, and
      // appended last it landed below the fold as soon as matches rendered —
      // withdrawn from view exactly when results populated, unread.
      if (askEl) acDropdown.prepend(askEl);
    }

    // Two async sources feed the dropdown: your follow list (instant from
    // cache, else a slow first relay load) and a global Nostr search. NEVER
    // block the UI on the follow list — the first load hits relays and can take
    // many seconds. Paint immediately (with a spinner), then repaint as each
    // source resolves. `paint()` renders the deduped union + loading state.
    async function updateAcDropdown() {
      const ctx = getCaretContext();
      if (!ctx || ctx.query.length === 0) { closeAcDropdown(); return; }
      const seq = ++acSeq;
      const q = ctx.query.toLowerCase();
      const willSearchGlobal = ctx.query.length >= 2 && deps.naAvailable();

      const matchFollows = (list) => list.filter((c) => c.name && c.name.toLowerCase().includes(q));
      let followMatches = [];
      let globals = [];
      let globalPending = false;
      let askEl = null; // the one-time Nostr Archives ask, while the setting is unset
      const paint = () => {
        if (seq !== acSeq) return;
        const seen = new Set(followMatches.map((c) => c.pubkey));
        const merged = followMatches.slice();
        for (const g of globals) { if (!seen.has(g.pubkey)) { seen.add(g.pubkey); merged.push(g); } }
        renderAcResults(merged.slice(0, 8), ctx, globalPending, askEl);
      };

      // Follows: use the cache synchronously if present; otherwise load in the
      // background and repaint when ready (no await here).
      //
      // Through the page rather than off its own globals. This read used to reach straight
      // into the panel's followListCache and state.activePubkey, which is exactly the kind
      // of reach that stops working the moment this file is loaded by anything else: those
      // names are not in scope here at all, so it would have thrown on the first @ typed in
      // the expanded composer.
      const cached = deps.cachedFollowList();
      if (cached) followMatches = matchFollows(cached);
      paint(); // instant feedback: local matches (maybe none)
      if (!cached) {
        deps.getFollowList().then((list) => { if (seq === acSeq) { followMatches = matchFollows(list); paint(); } });
      }

      // Global search across all of Nostr so you can tag people you don't
      // follow. Debounced; best-effort — a failure/rate-limit just clears the
      // spinner and leaves the follow matches. With the Nostr Archives setting
      // still unset, the spinner's slot carries the one-time ask instead;
      // answering it re-enters here with the decision written.
      if (!willSearchGlobal) return;
      const na = await deps.naSetting();
      if (seq !== acSeq) return;
      if (na === true) {
        globalPending = true;
        paint();
        if (acSuggestTimer) clearTimeout(acSuggestTimer);
        acSuggestTimer = setTimeout(async () => {
          const res = await deps.naSuggest(ctx.query);
          if (seq !== acSeq) return; // query changed since
          globals = res;
          globalPending = false;
          paint();
        }, 250);
      } else if (na !== false) {
        askEl = deps.naAskEl((on) => { deps.naDecide(on).then(updateAcDropdown); });
        paint();
      }
    }

    editor.addEventListener('input', () => {
      emit();
      updateAcDropdown();
      pingActivity(); // composing counts as activity, which keeps auto-lock at bay
      // Typing does not withdraw the attachment offer — writing the caption that
      // goes with the picture is exactly what a user who intends to accept is
      // about to do. The offer re-checks instead: it stands while the URL still
      // sits on its own line, and goes only when that line does.
      refreshAttachOffer();
    });

    editor.addEventListener('keydown', (e) => {
      if (!acDropdown) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); acIndex = Math.min(acIndex + 1, acResults.length - 1); updateAcActiveItem(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); acIndex = Math.max(acIndex - 1, 0); updateAcActiveItem(); }
      else if (e.key === 'Enter' || e.key === 'Tab') {
        if (acResults[acIndex]) { e.preventDefault(); const ctx = getCaretContext(); selectAcItem(acResults[acIndex], ctx ? ctx.query : ''); }
      } else if (e.key === 'Escape') { e.preventDefault(); closeAcDropdown(); }
    });

    // A pending one-time ask is a consent question, not search chrome: focus
    // moving away (a click elsewhere in the panel, another window) must not
    // withdraw it before it's answered. Escape still dismisses, and an
    // unanswered ask simply returns on the next @-keystroke.
    editor.addEventListener('blur', () => setTimeout(() => {
      if (acDropdown && acDropdown.querySelector('.na-ask')) return;
      closeAcDropdown();
    }, 150));

    // ---- the offer, for a link that arrived with a tail ----
    //
    // In the wrapper rather than the note composer's own toolbar, because the page
    // comment box is a composer too and gets its links pasted the same way. Both are
    // built here, so both get this at once.
    const trackRow = h('div', { className: 'track-row hidden' });
    const trackBtn = h('button', { className: 'mini ghost compose-add track-clean', type: 'button' });
    const trackLabel = h('span', { textContent: 'Remove tracking tags' });
    trackBtn.append(icon('eye-off'), trackLabel);
    trackRow.append(trackBtn);
    wrap.append(trackRow);

    let tracked = [];
    function scanTracking() {
      tracked = findTrackedUrls(serializeEditor(editor));
      if (!tracked.length) { hide(trackRow); return; }
      // The count only when there is more than one, because "Remove tracking tags from 1
      // link" is a sentence nobody writes.
      trackLabel.textContent = tracked.length === 1
        ? 'Remove tracking tags'
        : 'Remove tracking tags from ' + tracked.length + ' links';
      show(trackRow);
    }
    trackBtn.addEventListener('click', () => {
      let text = serializeEditor(editor);
      for (const hit of tracked) text = text.split(hit.raw).join(hit.clean);
      editor.innerHTML = '';
      if (text) hydrateEditorFromText(editor, text);
      syncEmptyClass();
      emit(); // the draft and the Post button both read the text, not the DOM
      scanTracking();
      // BACK WHERE YOU WERE WRITING. The rewrite replaces every node in the editor, and
      // focus() on its own leaves the caret at the very top, so tapping this would cost
      // a click to get back to the end of the sentence you were in the middle of. One
      // button, one tap, nothing to put right afterwards.
      editor.focus();
      const sel = window.getSelection();
      if (sel) {
        const end = document.createRange();
        end.selectNodeContents(editor);
        end.collapse(false);
        sel.removeAllRanges();
        sel.addRange(end);
      }
    });
    // AFTER the paste lands, not instead of it. The note composer has its own paste
    // handler that inserts the plain text itself, and the comment box has none at all;
    // a scan on the next tick reads whatever either of them ended up with.
    editor.addEventListener('paste', () => setTimeout(scanTracking, 0));

    // ---- the attachment offer, for a URL pasted on its own ----
    //
    // The paste is checked, not the editor: only a paste whose whole content is one
    // image URL qualifies. The offer sits ABOVE the editor, where the eye starts —
    // under a long note it was below the fold and read as nothing — and it wears
    // the accent for the same reason. It stays up while the offered URL still sits
    // on its own line, so typing the caption beside it never loses the offer; the
    // moment the line is edited away, the offer follows.
    const attachRow = h('div', { className: 'attach-row hidden' });
    const attachBtn = h('button', { className: 'mini ghost compose-add attach-accept', type: 'button' });
    // Named per paste, not fixed: the offer now covers video too, and "Attach this
    // image" over an .mp4 is the offer describing something else.
    const attachLabel = h('span', { textContent: 'Attach this image' });
    attachBtn.append(icon('plus'), attachLabel);
    attachRow.append(attachBtn);
    wrap.prepend(attachRow);
    let offeredUrl = null;
    function hideAttachOffer() {
      offeredUrl = null;
      attachRow.classList.add('hidden');
    }
    function refreshAttachOffer() {
      if (!offeredUrl) return;
      if (urlOnBoundary(serializeEditor(editor).split('\n'), offeredUrl)) return;
      // The line is gone, so the dismissal expires with it: pasting the same URL
      // afresh later is a new question.
      attachDismissed.delete(offeredUrl);
      hideAttachOffer();
    }
    attachBtn.addEventListener('click', () => {
      const url = offeredUrl;
      hideAttachOffer();
      if (url) onAttachUrl(url);
    });
    // A WAY TO SAY "NOT THIS ONE". The offer stands while the URL line stands —
    // that is what keeps it from vanishing under the typing — but a user who means
    // the URL as prose was left with an accented row indefinitely and no answer to
    // it. The ✕ dismisses for THIS url; the offer returns only after the line has
    // gone and the url is pasted afresh, so a deliberate no is not a forever no.
    const attachDismissed = new Set();
    const attachX = h('button', { className: 'attach-x', title: 'Keep it as text', type: 'button' });
    attachX.append(icon('x'));
    attachRow.append(attachX);
    attachX.addEventListener('click', () => {
      if (offeredUrl) attachDismissed.add(offeredUrl);
      hideAttachOffer();
    });
    editor.addEventListener('paste', (e) => {
      if (!onAttachUrl) return;
      const url = loneMediaUrl(e.clipboardData && e.clipboardData.getData('text/plain'));
      if (!url || attachDismissed.has(url)) return;
      setTimeout(() => {
        // On a line boundary — alone on the line, or glued to one end of it. A URL
        // with words on both sides is inside a sentence, and the offer would be to
        // rip it out of one.
        if (!urlOnBoundary(serializeEditor(editor).split('\n'), url)) return;
        offeredUrl = url;
        attachLabel.textContent = 'Attach this ' + (urlIsVideo(url) ? 'video' : 'image');
        attachRow.classList.remove('hidden');
      }, 0);
    });

    return {
      wrap,
      editor,
      getText: () => serializeEditor(editor),
      // Re-read the editor after the caller mutated its DOM directly (e.g.
      // appending an uploaded media URL) so the text, placeholder and any
      // onChange-driven state agree with what's on screen.
      sync: emit,
      setText(text) {
        editor.innerHTML = '';
        if (text) hydrateEditorFromText(editor, text);
        syncEmptyClass();
        // A paste is not the only way a tail arrives. This is the path a restored draft
        // takes, so a link pasted yesterday is still offered today.
        scanTracking();
      },
      focus: () => editor.focus(),
      close: closeAcDropdown,
    };
  }

  // ---- the rest of a composer's furniture ----
  //
  // Rendering a note preview, putting a file on a media server, and mining a proof of
  // work. All three were the panel's, and all three are things any composer needs, so
  // they travel with the editor rather than being rebuilt beside it.
  //
  // Their collaborators are injected like the editor's. The relay reads are the ones
  // that matter: this file never touches the panel's pool, so a page hands in its own
  // poolGet and poolQuerySync and the preview resolves mentions and embeds through
  // whatever sockets that page already owns.
  async function resolveMentions(mentions) {
    // Only fetch pubkeys not already in the shared profile cache; batch the rest
    // in one query (efficient for many authors) and populate the shared cache so
    // these results are reused by profile previews and future mentions.
    const need = [...new Set(mentions.map((x) => x.pubkey))].filter((pk) => !deps.cachedProfile(pk));
    if (need.length) {
      try {
        const events = await Promise.race([
          deps.poolQuerySync(await deps.relayUrls(false), { kinds: [0], authors: need }),
          new Promise((res) => setTimeout(() => res([]), 6000)),
        ]);
        const latest = {};
        (events || []).forEach((ev) => {
          if (!latest[ev.pubkey] || ev.created_at > latest[ev.pubkey].created_at) latest[ev.pubkey] = ev;
        });
        need.forEach((pk) => {
          let content = {};
          if (latest[pk]) { try { content = JSON.parse(latest[pk].content) || {}; } catch (_) {} }
          deps.cacheProfile(pk, content);
        });
      } catch (_) {}
    }
    mentions.forEach(({ el, pubkey }) => {
      // Through cachedProfile rather than reaching into the Map it reads, so this works
      // in any page that can answer the question rather than only the one that owns it.
      const rec = deps.cachedProfile(pubkey);
      if (rec && rec.name) el.textContent = '@' + rec.name;
    });
  }

  function renderNoteText(container, text, maxLen) {
    const mentions = [];
    const quotes = [];
    let last = 0;
    let used = 0;
    let truncated = false;
    // Set after a block-level item: the next text run's leading whitespace
    // would render under pre-wrap as a blank line stacked on the item's margin.
    let skipLead = false;
    let m;
    PREVIEW_RE.lastIndex = 0;
    const pushText = (s) => {
      if (!s || truncated) return;
      if (skipLead) { s = s.replace(/^\s+/, ''); skipLead = false; if (!s) return; }
      if (used + s.length > maxLen) {
        container.append(document.createTextNode(s.slice(0, Math.max(0, maxLen - used)) + '…'));
        truncated = true;
      } else {
        container.append(document.createTextNode(s));
        used += s.length;
      }
    };
    // Media and the quote box are block-level and carry their own margins, so
    // the newlines an author puts around the ref are padding on top of that —
    // pre-wrap renders each one as a full empty line between the prose and the
    // block. Trim the whitespace off the text node before the block and out of
    // the run after it; the block's margin is the separation. Mentions and
    // plain links stay inline, which is why only this path trims.
    const pushBlock = (el) => {
      const tail = container.lastChild;
      if (tail && tail.nodeType === Node.TEXT_NODE) tail.textContent = tail.textContent.replace(/\s+$/, '');
      container.append(el);
      skipLead = true;
    };
    while ((m = PREVIEW_RE.exec(text)) !== null) {
      if (m.index > last) pushText(text.slice(last, m.index));
      // Text before this token filled the budget → stop; don't render the token
      // (mention/link/media) that sits past the truncation point.
      if (truncated) break;
      if (m[1]) {
        const url = m[1];
        if (IMG_EXT.test(url)) {
          const im = document.createElement('img');
          im.className = 'note-media';
          im.referrerPolicy = 'no-referrer';
          im.src = url;
          pushBlock(im);
        } else if (VID_EXT.test(url)) {
          const v = document.createElement('video');
          v.className = 'note-media';
          v.controls = true;
          // Same host-privacy reason the img branch gives: no referrer to media hosts.
          v.referrerPolicy = 'no-referrer';
          v.src = url;
          pushBlock(v);
        } else {
          const a = document.createElement('a');
          a.href = url; a.target = '_blank'; a.rel = 'noreferrer noopener';
          a.textContent = url;
          container.append(a);
        }
      } else if (m[2]) {
        const bech = m[2];
        let d = null;
        try { d = deps.NT.nip19.decode(bech); } catch (_) {}
        if (d && (d.type === 'npub' || d.type === 'nprofile')) {
          const pubkey = d.type === 'npub' ? d.data : d.data.pubkey;
          const span = h('span', { className: 'mention', textContent: '@' + bech.slice(0, 10) + '…' });
          if (pubkey) mentions.push({ el: span, pubkey });
          container.append(span);
        } else {
          // Nested note/nevent/naddr ref — one level down only: a truncated
          // link-out preview (see resolveQuotePreviews), never a second full
          // embed card. Quoting a note that quotes a note is common, and the
          // old plain "quoted note" link showed nothing of what's inside.
          const a = document.createElement('a');
          a.className = 'quote-inline loading';
          a.href = 'https://njump.me/' + bech;
          a.target = '_blank'; a.rel = 'noreferrer noopener';
          a.textContent = 'quoted note…';
          quotes.push({ el: a, bech });
          pushBlock(a);
        }
      }
      last = PREVIEW_RE.lastIndex;
    }
    if (last < text.length) pushText(text.slice(last));
    resolveMentions(mentions);
    resolveQuotePreviews(quotes);
  }

  async function fetchBlossomServers(pubkey) {
    const cached = _blossomServerCache.get(pubkey);
    if (cached && cached.expiresAt > Date.now()) return cached.servers;
    let servers = [];
    try {
      const relays = await deps.relayUrls(false);
      const ev = await deps.poolGet(relays, { kinds: [BLOSSOM_SERVER_LIST_KIND], authors: [pubkey] });
      if (ev) {
        servers = ev.tags
          .filter((t) => t[0] === 'server' && t[1] && t[1].startsWith('https://'))
          .map((t) => t[1].replace(/\/$/, ''));
      }
    } catch (e) {
      // NOT SILENT. This swallowed a ReferenceError for BLOSSOM_SERVER_LIST_KIND, left
      // behind in the panel when the uploader moved here, and an empty list reads exactly
      // like an account with no Blossom server: every upload went to nostr.build instead,
      // in both composers, with nothing said anywhere.
      console.warn('[Upload] could not read the Blossom server list:', e);
    }
    _blossomServerCache.set(pubkey, { servers, expiresAt: Date.now() + BLOSSOM_CACHE_TTL });
    return servers;
  }

  async function uploadToBlossom(file, servers, forPubkey) {
    const buffer = await file.arrayBuffer();
    const hash = await sha256Hex(buffer);
    const now = Math.floor(Date.now() / 1000);
    const authEvent = {
      kind: BLOSSOM_AUTH_KIND,
      created_at: now,
      tags: [['t', 'upload'], ['x', hash], ['expiration', String(now + 300)]],
      content: 'Upload file',
    };
    const signed = await deps.call({ type: 'SIDECAR_OWNER_SIGN', event: authEvent, expectedPubkey: forPubkey });
    const authorization = 'Nostr ' + btoa(JSON.stringify(signed));
    let lastError;
    for (const server of servers) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), BLOSSOM_UPLOAD_TIMEOUT);
      try {
        const resp = await fetch(server + '/upload', {
          method: 'PUT',
          body: file,
          headers: { Authorization: authorization, 'Content-Type': file.type || 'application/octet-stream' },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json().catch(() => null);
        if (data && data.url) return data.url;
        throw new Error('No URL in Blossom response');
      } catch (e) {
        clearTimeout(timer);
        console.warn('[Blossom] upload to ' + server + ' failed:', e);
        lastError = e;
      }
    }
    throw lastError || new Error('All Blossom servers failed');
  }

  async function tryBlossomFirst(file, forPubkey) {
    // Through the page. The fallback used to read the panel's own state.activePubkey,
    // which is not a name this file can see and would have thrown on the first upload
    // from anywhere else.
    const pk = forPubkey || deps.activePubkey();
    if (!pk) return null;
    try {
      const servers = await fetchBlossomServers(pk);
      if (!servers.length) return null;
      return await uploadToBlossom(file, servers, pk);
    } catch (e) {
      console.warn('[Upload] Blossom failed, falling back to nostr.build:', e);
      return null;
    }
  }

  async function uploadMedia(file, forPubkey) {
    const isImg = file.type.startsWith('image/');
    const isVid = file.type.startsWith('video/');
    if (!isImg && !isVid) throw new Error('Choose an image or video');
    if (file.size > 100 * 1024 * 1024) throw new Error('File too large (max 100MB)');
    const forPk = forPubkey || deps.activePubkey();
    const blossomUrl = await tryBlossomFirst(file, forPk);
    if (blossomUrl) return blossomUrl;
    const url = 'https://nostr.build/api/v2/upload/files';
    const authEvent = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['u', url], ['method', 'POST']],
      content: '',
    };
    const signed = await deps.call({ type: 'SIDECAR_OWNER_SIGN', event: authEvent, expectedPubkey: forPk });
    const token = 'Nostr ' + btoa(JSON.stringify(signed));
    const form = new FormData();
    form.append('file', file);
    const resp = await fetch(url, { method: 'POST', headers: { Authorization: token }, body: form });
    if (!resp.ok) throw new Error('Upload failed (' + resp.status + ')');
    const json = await resp.json().catch(() => null);
    const u = json && json.data && (Array.isArray(json.data) ? json.data[0] && json.data[0].url : json.data.url);
    if (!u) throw new Error('Upload returned no URL');
    return u;
  }

  // ---- NIP-92 imeta alt text, the write side ----
  //
  // Sidecar never renders the images inside a note — the client reading the note does
  // that — so there is no read path here to keep honest. What a composer owes the note
  // is the tag: one `imeta` per described attachment, its `alt` slot carrying the
  // description the way zap.cooking writes them (and Amethyst and Gossip before it),
  // so the words typed here are what a screen reader says somewhere else.
  //
  // A slot's value is everything after its first space, so a description keeps its
  // spaces, its quotes and its line breaks: JSON escapes them on the wire, the event id
  // hashes the same bytes either way, and no client has to decode anything. Line breaks
  // are normalized rather than stripped — CRLF to LF, each line trimmed, runs of blank
  // lines capped at one paragraph gap — the same shape zap.cooking ships after
  // learning the flattened version the hard way.
  const ALT_MAX = 2000;

  function normalizeAltBreaks(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // The cap counts CHARACTERS, not code units: a hard .slice(0, ALT_MAX) can land
  // mid-emoji and ship half of one down the wire. Astral pairs are two code units
  // for one character, so the cut goes by code points and never splits a pair.
  function capAltText(text) {
    return Array.from(String(text || '')).slice(0, ALT_MAX).join('');
  }

  // One tag row for one attachment, or null when there is nothing to say: an empty
  // description means no alt slot and no imeta tag at all — never empty metadata. The
  // cap is applied here as well as in the editor because a draft can be restored into
  // a composer that publishes without the editor ever being opened.
  function buildImetaTag(url, alt) {
    const cleaned = capAltText(normalizeAltBreaks(alt));
    if (!url || !cleaned) return null;
    return ['imeta', 'url ' + url, 'alt ' + cleaned];
  }

  // In draft order, one tag per described attachment. Undescribed media contributes
  // nothing, so a note of bare URLs publishes exactly as it did before this existed.
  function imetaTagsForMedia(media) {
    const out = [];
    for (const m of media || []) {
      const tag = buildImetaTag(m && m.url, m && m.alt);
      if (tag) out.push(tag);
    }
    return out;
  }

  // The ALT editor as one full-width row: thumbnail and explainer on top, the
  // multiline field beneath, a meter of the room left and its Save stretched under
  // that. Stacked rather than beside anything, per the only grammar a 360px column
  // has room for. Both composers seat it under the thumbnail strip; this file builds
  // it and knows nothing about which one is asking.
  //
  // IT AUTOSAVES, like everything else in this composer: a keystroke in the editor
  // saves the note, so a keystroke here saves the description — `onChange` fires
  // with the field's text as it is, debounced half a second, and no exit asks
  // whether the user meant it. `onSave` fires on the way out — Save description,
  // Escape, the trash (which saves an empty description, which is how one is
  // removed) — always with the field's current text, so the tail never depends on
  // the timer. The old contract, commit-on-Save alone, was the trap: the composer
  // promises that closing is safe, and a field where closing meant losing the words
  // broke that promise with the rest of the draft there to vouch for it.
  function buildAltEditorRow(opts) {
    const initial = normalizeAltBreaks(opts.alt || '');
    const onSave = opts.onSave || function () {};
    const onChange = opts.onChange || function () {};
    const row = h('div', { className: 'compose-alt-row' });

    const head = h('div', { className: 'compose-alt-head' });
    if (opts.url) {
      const im = document.createElement('img');
      im.className = 'compose-alt-thumb';
      // Same reason every other media element here carries it: media hosts 403 a
      // chrome-extension:// referrer.
      im.referrerPolicy = 'no-referrer';
      im.src = opts.url;
      head.append(im);
    }
    head.append(h('span', { className: 'compose-alt-hint', textContent: 'Describe this image for anyone who may not be able to see it.' }));
    if (initial) {
      const rm = h('button', { className: 'mini ghost compose-alt-remove', title: 'Remove the description', type: 'button' });
      rm.append(icon('trash'));
      rm.addEventListener('click', () => commit(''));
      head.append(rm);
    }
    row.append(head);

    const field = h('textarea', { className: 'compose-alt-text', maxLength: ALT_MAX, placeholder: 'What does the image show?' });
    field.value = initial;
    row.append(field);

    // THE ROOM LEFT IS A RING WITH A NUMBER BESIDE IT, NOT A COUNT THE BUTTON
    // ANSWERS TO. Save is the quietest button in the row — a ghost at its natural
    // width, not a filled one stretched across it — and what decides its width must
    // never change: the ring is a fixed 20px and the count is fixed at four digits
    // (tabular, right-aligned), so "2000" and "12" occupy the same box and the
    // button never readjusts. The count carries no word; the ring carries the
    // proportion, amber for the last tenth of the cap.
    const RING_R = 8;
    const RING_C = 2 * Math.PI * RING_R;
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 20 20');
    ring.setAttribute('class', 'compose-alt-ring');
    ring.innerHTML =
      '<circle cx="10" cy="10" r="' + RING_R + '" class="ring-track"/>' +
      '<circle cx="10" cy="10" r="' + RING_R + '" class="ring-fill" ' +
      'stroke-dasharray="' + RING_C + '" stroke-dashoffset="' + RING_C + '" transform="rotate(-90 10 10)"/>';
    const count = h('span', { className: 'compose-alt-count' });
    const save = h('button', { className: 'ghost compose-alt-save', type: 'button', textContent: 'Save description' });
    row.append(h('div', { className: 'compose-alt-foot' }, [ring, count, save]));

    function paintMeter() {
      count.textContent = String(ALT_MAX - field.value.length);
      const used = field.value.length / ALT_MAX;
      ring.querySelector('.ring-fill').setAttribute('stroke-dashoffset', String(RING_C * (1 - used)));
      ring.classList.toggle('is-near', used >= 0.9); // the last stretch, said in color
    }
    let asTimer = null;
    function scheduleAutosave() {
      if (asTimer) clearTimeout(asTimer);
      asTimer = setTimeout(() => { asTimer = null; onChange(field.value); }, 500);
    }
    // Every way out commits what is in the field first, so the last half second
    // never depends on the timer.
    function commit(value) {
      if (asTimer) { clearTimeout(asTimer); asTimer = null; }
      row.remove();
      onSave(value);
    }
    field.addEventListener('input', () => { paintMeter(); scheduleAutosave(); });
    paintMeter();
    save.addEventListener('click', () => commit(field.value));
    field.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation(); // the composer underneath stays open
      commit(field.value);
    });
    // The caller appends the row the moment this returns; focus lands on the next
    // frame, once the row is actually in a document.
    requestAnimationFrame(() => { if (row.isConnected) field.focus(); });
    // A PENDING AUTOSAVE THE PAGE CAN FLUSH ON ITS OWN CLOSE PATHS. The row commits
    // on its three own exits, but pages close it for their own reasons — a chip
    // toggle, the review window starting, an account moving under the tab — and a
    // close that skips this drops the last half-second of typing on the floor. The
    // page decides when the slot is still the one the row was opened for; flushing
    // after the media array has been spliced would write one image's words onto
    // another.
    row.flushPending = () => {
      if (!asTimer) return;
      clearTimeout(asTimer);
      asTimer = null;
      onChange(field.value);
    };
    return row;
  }

  // ---- media in the composer: held beside the prose, appended at publish ----
  //
  // The composer shows the prose only. A 100-character CDN URL is not text anybody
  // is thinking about while writing, and it pushed every real sentence down the
  // panel; the attachments live in the draft's media slot and are appended to the
  // content at publish, each URL on its own line after a blank line. The wire format
  // does not change — the URL in the content is still what most clients read, and
  // the imeta tags beside it describe those same URLs in the same order.

  // What the note says on the wire, and what the preview should show: the one place
  // prose and attachments meet again, so the review window previews the note that
  // will actually go out rather than the half of it the editor was showing.
  function composeNoteContent(text, media) {
    const prose = String(text || '').trim();
    const urls = (media || []).map((m) => m && m.url).filter(Boolean);
    if (!urls.length) return prose;
    return (prose ? prose + '\n\n' : '') + urls.join('\n');
  }

  // Drafts saved before the URLs moved out of the editor carry them in the saved
  // text — the same URLs the media slot holds. Stripped on restore, or the publish
  // would append them a second time. A no-op on drafts saved since, and on prose a
  // user typed that merely looks like a URL: only a line matching an attachment's
  // own URL is taken out.
  function stripDraftMediaUrls(text, media) {
    // A LINE-BOUNDARY OCCURRENCE AT A TIME, never every occurrence: the old format
    // wrote each URL on its own line, so only boundary occurrences are migration
    // leftovers. A URL the user deliberately put inside a sentence — "mirror at
    // https://x/a.png if the first dies" — is authored prose and stays; a URL twice
    // on one line is ambiguous and stays too. The same rule the paste offer uses to
    // decide what it may cut out (urlOnBoundary), pointed the other way.
    const urls = (media || []).map((m) => m && m.url).filter(Boolean);
    if (!urls.length) return String(text || '');
    const kept = String(text || '').split('\n').map((line) => {
      for (const url of urls) {
        if (!line.includes(url)) continue;
        const parts = line.split(url);
        if (parts.length === 2 && (!parts[0].trim() || !parts[1].trim())) return line.replace(url, '');
      }
      return line;
    });
    return kept.join('\n').replace(/\s+$/, '');
  }

  // THE COVER A VIDEO WEARS INSTEAD OF A FRAME.
  //
  // A <video> in a 72px cell is a bad thumbnail three ways: it paints black until it has
  // decoded something, it downloads part of a file nobody asked to watch, and a single
  // frame at that size tells you less than the word VIDEO does. The element stays in the
  // cell, at preload=metadata, purely so a 404 is still detectable; this covers it.
  //
  // It carries the extension because two videos in a strip are otherwise the same square
  // twice, and the strip's whole job is to say what is attached and in what order.
  // A FRAME IS WORTH MORE THAN A GLYPH, but it has to be asked for. preload=metadata
  // fetches the header and stops: dimensions and duration, no decoded picture, so the
  // element paints nothing. Seeking a fraction of a second in forces exactly one frame
  // to decode, and the browser range-requests only what that needs.
  //
  // NOT 0. The first frame of a video is very often black or a fade-in, which is a
  // thumbnail that says less than the glyph it replaced. A tenth of a second in is past
  // most of them and still the opening shot. Clamped to the duration, because a clip
  // shorter than that would seek past its end and never fire `seeked`.
  //
  // Everything here is best-effort and silent on failure. A codec the browser will not
  // decode, a host that refuses range requests, a seek that never completes: each leaves
  // the cover exactly as it was, which is a working thumbnail, so none of them is worth
  // an error anybody has to read.
  function primeVideoThumb(el, cell) {
    let asked = false;
    el.addEventListener('loadedmetadata', () => {
      if (asked) return;
      asked = true;
      try {
        const d = Number(el.duration);
        el.currentTime = Number.isFinite(d) && d > 0 ? Math.min(0.1, d / 2) : 0.1;
      } catch (_) {}
    });
    // The frame is on screen from here, so the cover gets out of its way and becomes a
    // corner badge. Still a badge, because a still frame does not say "this is a video"
    // and the strip's job is to say what is attached.
    el.addEventListener('seeked', () => cell.classList.add('has-frame'));
  }

  function videoThumbCover(url) {
    const cover = h('div', { className: 'compose-thumb-vid' });
    cover.append(icon('video'));
    // From the PATH, never the query: a signed URL can carry ?x=y.mp4 and the extension
    // is not whatever the last dot in the whole string happens to precede.
    const m = /\.([a-z0-9]{2,5})$/i.exec(String(url || '').split('?')[0].split('#')[0]);
    if (m) cover.append(h('span', { textContent: m[1].toUpperCase() }));
    return cover;
  }

  // The attachments' reference drawer: one collapsed line saying how many and where
  // they go, expanding to one row per attachment — the URL, truncated, with a copy
  // button in the icon slot. Read-only on purpose: the order shown is the thumbs'
  // order, and reordering happens on the thumbnails themselves. `getMedia` is a
  // function because the draft is rebound when the account moves under the tab; the
  // drawer re-reads it on every sync.
  function buildMediaDrawer(getMedia, opts) {
    const wrap = h('div', { className: 'compose-media-note hidden' });
    const toggle = h('button', { className: 'compose-media-toggle', type: 'button' });
    const chev = icon('chevron-down');
    const label = h('span', { className: 'compose-media-toggle-label' });
    toggle.append(chev, label);
    const drawer = h('div', { className: 'compose-media-drawer hidden' });
    wrap.append(toggle, drawer);

    function sync() {
      const media = (getMedia && getMedia()) || [];
      const urls = media.filter((m) => m && m.url);
      if (!urls.length) {
        wrap.classList.add('hidden');
        drawer.classList.add('hidden');
        toggle.classList.remove('open');
        return;
      }
      wrap.classList.remove('hidden');
      label.textContent = urls.length + (urls.length === 1 ? ' attachment' : ' attachments')
        + ' — added to the end of your post';
      drawer.innerHTML = '';
      for (const m of urls) {
        const rowEl = h('div', { className: 'compose-media-row' });
        const u = h('span', { className: 'compose-media-url', textContent: m.url });
        u.title = m.url;
        const cp = h('button', { className: 'compose-media-copy', title: 'Copy link', type: 'button' });
        cp.append(icon('copy'));
        cp.addEventListener('click', () => {
          navigator.clipboard.writeText(m.url).then(() => {
            cp.innerHTML = '';
            cp.append(icon('check'));
            cp.classList.add('did');
            setTimeout(() => {
              cp.innerHTML = '';
              cp.append(icon('copy'));
              cp.classList.remove('did');
            }, 900);
          }).catch(() => {});
        });
        rowEl.append(u, cp);
        drawer.append(rowEl);
      }
    }
    toggle.addEventListener('click', () => {
      drawer.classList.toggle('hidden');
      toggle.classList.toggle('open', !drawer.classList.contains('hidden'));
    });
    sync();
    return { wrap, drawer, sync };
  }

  const POW_LEVELS = [
    { bits: 16, cost: 'Usually instant.' },
    { bits: 18, cost: 'About a second.' },
    { bits: 20, cost: 'A few seconds, sometimes fifteen.' },
    { bits: 22, cost: 'Ten seconds or so, sometimes a minute.' },
  ];
  const POW_DEFAULT_BITS = 18;
  const powLevelFor = (bits) => POW_LEVELS.find((l) => l.bits === bits) || POW_LEVELS[1];

  const IMG_EXT = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?.*)?$/i;

  const VID_EXT = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

  const PREVIEW_RE = /(https?:\/\/[^\s]+)|(?:nostr:)?(npub1[0-9a-z]{58}|nprofile1[0-9a-z]{50,}|note1[0-9a-z]{58}|nevent1[0-9a-z]{50,}|naddr1[0-9a-z]{50,})/gi;

  function renderNotePreview(container, text) {
    const mentions = [];
    const embeds = [];
    let last = 0;
    let skipLead = false; // see pushBlock in renderNoteText
    let m;
    PREVIEW_RE.lastIndex = 0;
    const flushText = (s) => {
      if (!s) return;
      if (skipLead) { s = s.replace(/^\s+/, ''); skipLead = false; if (!s) return; }
      container.append(document.createTextNode(s));
    };
    // Same pre-wrap blank-line problem as renderNoteText, for this pane's own
    // block items: embed cards, link cards, media.
    const pushBlock = (el) => {
      const tail = container.lastChild;
      if (tail && tail.nodeType === Node.TEXT_NODE) tail.textContent = tail.textContent.replace(/\s+$/, '');
      container.append(el);
      skipLead = true;
    };
    while ((m = PREVIEW_RE.exec(text)) !== null) {
      if (m.index > last) flushText(text.slice(last, m.index));
      if (m[1]) {
        const url = m[1];
        if (IMG_EXT.test(url)) {
          const im = document.createElement('img');
          im.className = 'note-media';
          im.referrerPolicy = 'no-referrer';
          im.src = url;
          pushBlock(im);
        } else if (VID_EXT.test(url)) {
          const v = document.createElement('video');
          v.className = 'note-media';
          v.controls = true;
          // Same host-privacy reason the img branch gives: no referrer to media hosts.
          v.referrerPolicy = 'no-referrer';
          v.src = url;
          pushBlock(v);
        } else {
          const a = document.createElement('a');
          a.href = url; a.target = '_blank'; a.rel = 'noreferrer noopener';
          a.textContent = url;
          container.append(a);
          if (url.startsWith('https://')) {
            const card = document.createElement('a');
            card.className = 'link-card loading';
            card.textContent = 'Loading preview…';
            pushBlock(card);
            fetchOgMeta(url).then((meta) => renderLinkCard(card, url, meta));
          }
        }
      } else if (m[2]) {
        const bech = m[2];
        let d = null;
        try { d = deps.NT.nip19.decode(bech); } catch (_) {}
        if (d && (d.type === 'npub' || d.type === 'nprofile')) {
          const pubkey = d.type === 'npub' ? d.data : d.data.pubkey;
          const a = h('span', { className: 'mention', textContent: '@' + bech.slice(0, 10) + '…' });
          if (pubkey) mentions.push({ el: a, pubkey });
          container.append(a);
        } else if (d && (d.type === 'note' || d.type === 'nevent' || d.type === 'naddr')) {
          const card = h('div', { className: 'note-embed loading', textContent: 'Loading nostr event…' });
          embeds.push({ el: card, ref: embedRef(d) });
          pushBlock(card);
        } else {
          flushText(bech);
        }
      }
      last = PREVIEW_RE.lastIndex;
    }
    flushText(text.slice(last));
    resolveMentions(mentions);
    resolveEmbeds(embeds);
  }

  function embedRef(d) {
    if (d.type === 'note') return { filter: { ids: [d.data] } };
    if (d.type === 'nevent') return { filter: { ids: [d.data.id] }, relays: d.data.relays || [] };
    return {
      filter: { kinds: [d.data.kind], authors: [d.data.pubkey], '#d': [d.data.identifier] },
      relays: d.data.relays || [],
    };
  }

  async function resolveEmbeds(embeds) {
    for (const { el, ref } of embeds) {
      let ev = null;
      try {
        const relays = [...new Set([...(await deps.relayUrls(false)), ...(ref.relays || [])])];
        ev = await Promise.race([
          deps.poolGet(relays, ref.filter),
          new Promise((r) => setTimeout(() => r(null), 6000)),
        ]);
      } catch (_) {}
      if (!ev) {
        el.classList.remove('loading');
        el.classList.add('embed-missing');
        el.textContent = 'nostr event (not found)';
        continue;
      }
      renderEmbedCard(el, ev);
    }
  }

  function renderEmbedCard(el, ev) {
    el.classList.remove('loading');
    el.textContent = '';
    const av = h('span', { className: 'embed-av' });
    deps.applyAvatar(av, {});
    const name = h('span', { className: 'embed-name', textContent: deps.shortNpub(deps.NT.nip19.npubEncode(ev.pubkey)) });
    const head = h('div', { className: 'embed-head' }, [
      av,
      h('div', { className: 'embed-who' }, [
        name,
        h('span', { className: 'embed-time', textContent: relTime((ev.created_at || 0) * 1000) }),
      ]),
    ]);
    const titleTag = (ev.tags || []).find((t) => t[0] === 'title');
    const text = (titleTag && titleTag[1]) || ev.content || '';
    const body = h('div', { className: 'embed-body' });
    renderNoteText(body, text, 280);
    el.append(head, body);
    deps.fetchPreviewProfile(ev.pubkey).then((p) => {
      if (!p) return;
      if (p.picture) deps.applyAvatar(av, { picture: p.picture });
      if (p.name) name.textContent = '@' + p.name;
    });
  }

  const ogCache = new Map(); // url → { title, description, image, site } | null

  async function fetchOgMeta(url) {
    if (ogCache.has(url)) return ogCache.get(url);
    ogCache.set(url, null); // mark in-flight so parallel calls don't double-fetch
    try {
      const meta = await deps.call({ type: 'SIDECAR_FETCH_OG', url });
      ogCache.set(url, meta);
      return meta;
    } catch (_) { return null; }
  }

  function decodeHtml(s) {
    if (!s) return s;
    const t = document.createElement('textarea');
    t.innerHTML = s;
    return t.value;
  }

  function renderLinkCard(container, url, meta) {
    container.classList.remove('loading');
    if (!meta) { container.remove(); return; }
    container.innerHTML = '';
    const body = h('div', { className: 'link-card-body' });
    if (meta.site) body.append(h('div', { className: 'link-card-site', textContent: decodeHtml(meta.site) }));
    if (meta.title) body.append(h('div', { className: 'link-card-title', textContent: decodeHtml(meta.title) }));
    if (meta.description) body.append(h('div', { className: 'link-card-desc', textContent: decodeHtml(meta.description) }));
    const isHttps = (s) => typeof s === 'string' && s.startsWith('https://');
    if (isHttps(meta.image)) {
      const img = document.createElement('img');
      img.className = 'link-card-img';
      img.referrerPolicy = 'no-referrer';
      img.src = meta.image;
      img.onerror = () => img.remove();
      container.append(img);
    }
    container.append(body);
    container.href = url;
    container.target = '_blank';
    container.rel = 'noreferrer noopener';
  }

  let powWorker = null;
  let powSeq = 0;
  const powPending = new Map();

  function powWorkerSettleAll(err) {
    for (const [id, p] of powPending) {
      powPending.delete(id);
      p.reject(err);
    }
  }

  function powCancel() {
    // Nothing in flight: leave the warm worker alone. Called unconditionally when the
    // composer closes, and terminating an idle one there would make the next Low mine pay
    // to load nostr-tools again for no reason.
    if (!powPending.size) return;
    if (powWorker) {
      powWorker.terminate();
      powWorker = null;
    }
    // Flagged rather than matched on its message: stopping a mine is a decision, and the
    // composer has to be able to tell it apart from a mine that broke, which reads the
    // same way through a rejected promise.
    const stopped = new Error('Mining canceled');
    stopped.canceled = true;
    powWorkerSettleAll(stopped);
  }

  function minePow(event, bits, onProgress) {
    if (typeof Worker !== 'function') {
      return Promise.reject(new Error('This browser cannot mine in the background'));
    }
    if (!powWorker) {
      powWorker = new Worker(chrome.runtime.getURL('pow-worker.js'));
      powWorker.onmessage = (e) => {
        const { id, ok, event: mined, error, progress, attempts, best, difficulty } = e.data || {};
        const p = powPending.get(id);
        if (!p) return;
        if (progress) { if (p.onProgress) p.onProgress({ attempts, best }); return; }
        powPending.delete(id);
        if (ok) p.resolve({ event: mined, attempts, difficulty });
        else p.reject(new Error(error || 'Mining failed'));
      };
      powWorker.onerror = () => {
        // A packaging miss or a load failure. Settle everything waiting rather than
        // leaving a promise that never resolves and a composer stuck on "Mining".
        powWorker = null;
        powWorkerSettleAll(new Error('Mining failed to start'));
      };
    }
    return new Promise((resolve, reject) => {
      const id = ++powSeq;
      powPending.set(id, { resolve, reject, onProgress });
      powWorker.postMessage({ id, event, bits });
    });
  }

  // ---- where a note can be read ----
  //
  // Sidecar is a companion, not a client, so every note it publishes needs somewhere to
  // hand you off to. The directory is pure data and a url builder each, and both pages
  // need it: the panel's post banner and the expanded composer's confirmation are the
  // same question asked twice.
  function razrEntity(entity) {
    try {
      const d = deps.NT.nip19.decode(entity);
      if (d.type === 'nevent') return deps.NT.nip19.noteEncode(d.data.id);
    } catch (_) { /* not bech32 we know, so hand it over unchanged */ }
    return entity;
  }

  const VIEW_CLIENTS = {
    // DEFAULT_CLIENT leads the list; the rest are in the order they were added.
    jumble: { label: 'Jumble', url: (ne) => 'https://jumble.social/notes/' + ne, profile: (np) => 'https://jumble.social/users/' + np },
    primal: { label: 'Primal', url: (ne) => 'https://primal.net/e/' + ne, profile: (np) => 'https://primal.net/p/' + np },
    yakihonne: { label: 'YakiHonne', url: (ne) => 'https://yakihonne.com/note/' + ne, profile: (np) => 'https://yakihonne.com/profile/' + np },
    iris: { label: 'Iris', url: (ne) => 'https://iris.to/' + ne, profile: (np) => 'https://iris.to/' + np },
    snort: { label: 'Snort', url: (ne) => 'https://snort.social/' + ne, profile: (np) => 'https://snort.social/' + np },
    nostrudel: { label: 'noStrudel', url: (ne) => 'https://nostrudel.ninja/#/n/' + ne, profile: (np) => 'https://nostrudel.ninja/#/u/' + np },
    zapcooking: { label: 'Zap Cooking', url: (ne) => 'https://zap.cooking/' + ne, profile: (np) => 'https://zap.cooking/user/' + np },
    noornote: { label: 'NoorNote', url: (ne) => 'https://noornote.app/note/' + ne, profile: (np) => 'https://noornote.app/profile/' + np },
    jank: { label: 'JANK', url: (ne) => 'https://jank.army/notes/' + ne, profile: (np) => 'https://jank.army/users/' + np },
    nostrich: { label: 'Nostrich', url: (ne) => 'https://nostrich.org/e/' + ne, profile: (np) => 'https://nostrich.org/p/' + np },
    ditto: { label: 'Ditto', url: (ne) => 'https://ditto.pub/' + ne, profile: (np) => 'https://ditto.pub/' + np },
    // ROUTES, not a catch-all: /e/ for an event and /p/ for a profile. Its own links are
    // /e/note1… and /e/naddr…, built with encodeNote, so /e/ is known to take a note1
    // and a naddr, and an nevent is reduced to the note1 Razr writes for itself rather
    // than handed over on the assumption it decodes one. See razrEntity.
    razr: { label: 'Razr', url: (ne) => 'https://razr.social/e/' + razrEntity(ne), profile: (np) => 'https://razr.social/p/' + np },
    // A COMMAND LINE, not routes. `open <bech32>` resolves note, nevent and naddr into
    // the same viewer, since all three are cases in its own decoder, and a profile has its
    // own verb, which is what Grimoire builds for itself (`profile <npub>`).
    grimoire: {
      label: 'Grimoire',
      url: (ne) => 'https://grimoire.rocks/run?cmd=' + encodeURIComponent('open ' + ne),
      profile: (np) => 'https://grimoire.rocks/run?cmd=' + encodeURIComponent('profile ' + np),
    },
    coracle: { label: 'Coracle', url: (ne) => 'https://coracle.social/' + ne, profile: (np) => 'https://coracle.social/' + np },
    njump: { label: 'njump', url: (ne) => 'https://njump.me/' + ne, profile: (np) => 'https://njump.me/' + np },
  };
  const DEFAULT_CLIENT = 'jumble';

  function resolveClient(settings, pubkey) {
    const by = (settings && settings.defaultClientBy) || null;
    const key = (by && pubkey && by[pubkey]) || (settings && settings.defaultClient) || DEFAULT_CLIENT;
    return VIEW_CLIENTS[key] || VIEW_CLIENTS[DEFAULT_CLIENT];
  }

  // ---- the review window before something irreversible goes out ----
  //
  // Already parameterized on its container and its preview, because the note composer
  // and the page-comment sheet had different things worth a second look. The expanded
  // composer is the third caller, and the only thing left that knew which document it
  // was drawing into was the identity strip, which is now passed in like the rest.
  function showPostCountdown(opts) {
    const { modal, secs, title, hint, preview, confirmLabel, onFire, onCancel } = opts;
    // WHO IS POSTING, supplied rather than looked up. It was read off the panel's own
    // state here, which is the one thing in this function that knew which document it was
    // drawing into. The expanded composer asks the same question of a different page.
    const author = opts.author || null;
    modal.innerHTML = '';
    let remaining = secs;
    let timer = null;

    const R = 30;
    const C = 2 * Math.PI * R;
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 72 72');
    ring.setAttribute('class', 'countdown-ring');
    ring.innerHTML =
      '<circle cx="36" cy="36" r="' + R + '" class="ring-track"/>' +
      '<circle cx="36" cy="36" r="' + R + '" class="ring-fill" ' +
      'stroke-dasharray="' + C + '" stroke-dashoffset="0" transform="rotate(-90 36 36)"/>';
    const num = h('div', { className: 'countdown-num' });
    paintCountdownNum(num, remaining);
    const ringWrap = h('div', { className: 'countdown-wrap' }, [ring, num]);


    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const now = h('button', { className: 'primary', textContent: confirmLabel || 'Post now' });
    const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });

    async function fire() {
      stop();
      now.disabled = true;
      now.textContent = 'Posting…';
      await onFire();
    }
    now.addEventListener('click', fire);
    cancel.addEventListener('click', () => { stop(); onCancel(); });

    modal.append(
      h('h3', { textContent: title }),
      ...(author ? [author] : []),
      h('p', { className: 'hint', textContent: hint || 'Review before it posts.' }),
      preview,
      ringWrap,
      h('div', { className: 'actions' }, [now, cancel])
    );

    const fill = ring.querySelector('.ring-fill');
    timer = setInterval(() => {
      remaining -= 1;
      paintCountdownNum(num, remaining);
      fill.setAttribute('stroke-dashoffset', String(C * (1 - remaining / secs)));
      if (remaining <= 0) fire();
    }, 1000);

    return { stop };
  }

  // The strike dice, dealt wherever they are needed. The limits are tight on
  // purpose — rotation within +-3deg, slippage within +-0.035em sideways, seat
  // height within +-0.03em up or down — enough that no two strikes of the same
  // figure ever land alike (a hand-held stamp is never twice in the same place)
  // without threatening legibility even at 9px. Emitted for every theme; the
  // cast-iron rules are the only consumers.
  //
  // Here because splitGlyphs calls it on every character it deals. Left behind in the
  // panel it was a ReferenceError inside the review countdown's own digits, thrown after
  // the editor had been hidden to make room for the countdown, so the card went blank and
  // the note looked lost. The panel's balance figures strike through the same call.
  function ironDiceStyle() {
    return '--iron-rot:' + ((Math.random() * 6) - 3).toFixed(2) + 'deg'
      + ';--iron-dx:' + ((Math.random() * 0.07) - 0.035).toFixed(3) + 'em'
      + ';--iron-dy:' + ((Math.random() * 0.06) - 0.03).toFixed(3) + 'em';
  }

  function splitGlyphs(el, text, strike) {
    el.textContent = '';
    const glyphs = Array.from(text);
    // Fresh dice at every split (see ironDiceStyle) — not seeded off --i or the
    // glyph itself, because re-rendering the same balance should land differently.
    glyphs.forEach((ch, i) => {
      const { delay, duration } = glyphBeat(i, glyphs.length);
      el.append(h('span', {
        className: 'bal-glyph' + (/[0-9]/.test(ch) ? '' : ' bal-sep')
          + (i % 2 ? ' bal-alt' : '') + (strike(i) ? ' bal-in' : ''),
        textContent: ch,
        style: `--i:${i};--n:${glyphs.length};--strike-delay:${delay}ms;--strike-dur:${duration}ms`
          + ';' + ironDiceStyle(),
      }));
    });
  }

  function paintCountdownNum(el, n) {
    const text = String(Math.max(n, 0));
    const fresh = !el.querySelector('.bal-glyph');
    const prev = el.textContent;
    const off = prev.length - text.length;
    splitGlyphs(el, text, (i) =>
      !deps.reduceBalanceMotion() && (fresh || prev.charAt(off + i) !== text.charAt(i)));
  }


  function quoteSnippet(text) {
    const s = String(text || '')
      .replace(/(?:nostr:)?(?:npub1|nprofile1|note1|nevent1|naddr1)[0-9a-z]+/gi, '')
      .replace(/ln(?:bc|tb)[0-9a-z]+/gi, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) return '';
    return s.length > 140 ? s.slice(0, 140).trimEnd() + '…' : s;
  }

  function firstQuoteImage(text) {
    const urls = String(text || '').match(/https?:\/\/[^\s]+/g) || [];
    return urls.find((u) => IMG_EXT.test(u)) || null;
  }
  // WHAT THIS ACCOUNT'S PROOF OF WORK IS, seeded into a composer and never written back:
  // the button in the editor is a decision about this note, not about the account.
  //
  // Shared because the expanded composer was starting every note at off regardless, so
  // an account that had asked for 20 bits in Settings got none of them in a tab. Two
  // readings of one setting is one too many.
  async function powSetting(pubkey) {
    let s = {};
    try { s = (await deps.call({ type: 'SIDECAR_GET_SETTINGS' })) || {}; } catch (_) {}
    const bits = ((s && s.powBy) || {})[pubkey];
    return POW_LEVELS.some((l) => l.bits === bits)
      ? { on: true, bits }
      : { on: false, bits: POW_DEFAULT_BITS }; // default OFF: this spends the user's time
  }

  // THE REVIEW WINDOW, as the account set it. Shared for the reason the last two were:
  // the expanded composer read the setting for itself and defaulted to five seconds
  // where the panel defaults to fifteen, so the same account got three times less time
  // to catch a mistake depending on which composer it was in. The presets are a list
  // rather than a range because a stored value outside them is a hand-edited settings
  // file, not a choice, and falling back to the default beats honoring it.
  const NOTE_COUNTDOWN_PRESETS = [5, 10, 15, 25, 30];
  const NOTE_COUNTDOWN_DEFAULT = 15;
  async function postCountdownSetting() {
    let s = {};
    try { s = (await deps.call({ type: 'SIDECAR_GET_SETTINGS' })) || {}; } catch (_) {}
    const secs = NOTE_COUNTDOWN_PRESETS.includes(s.noteCountdownSecs)
      ? s.noteCountdownSecs
      : NOTE_COUNTDOWN_DEFAULT;
    return { on: s.noteCountdown !== false, secs }; // default on
  }

  // ---- the tail the first pass missed ----
  //
  // Each of these is called by something that already moved here and was left behind in
  // the panel, which is a ReferenceError in whichever document runs the caller first.
  // Found together rather than one screen at a time, because the guard in
  // composer-core.test.js reads calls and member bases through a tokenizer now instead
  // of trying to strip strings and comments with a regex.
  function relTime(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 604800) return Math.round(s / 86400) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  async function resolveQuotePreviews(quotes) {
    for (const { el, bech } of quotes) {
      let d = null;
      try { d = deps.NT.nip19.decode(bech); } catch (_) {}
      const ref = d ? embedRef(d) : null;
      let ev = null;
      if (ref) {
        try {
          const relays = [...new Set([...(await deps.relayUrls(false)), ...(ref.relays || [])])];
          ev = await Promise.race([
            deps.poolGet(relays, ref.filter),
            new Promise((r) => setTimeout(() => r(null), 6000)),
          ]);
        } catch (_) {}
      }
      el.classList.remove('loading');
      if (!ev) {
        el.textContent = 'quoted note'; // not found — today's plain link-out
        continue;
      }
      const who = h('span', {
        className: 'mention',
        textContent: '@' + deps.shortNpub(deps.NT.nip19.npubEncode(ev.pubkey)),
      });
      // The text lives in its own clamped element (the <a> can't clamp once it
      // also holds a thumbnail), media gets a small thumb below it, and an
      // invoice becomes a quiet caption under everything — it's metadata about
      // the note, not prose, and inline it read as a sentence placed above the
      // image it follows in the content (zap receipts are image + invoice and
      // nothing else).
      const content = String(ev.content || '');
      const hasInvoice = /\bln(?:bc|tb)[0-9a-z]+\b/i.test(content);
      const text = h('div', { className: 'quote-inline-text' }, [who]);
      const snip = quoteSnippet(content);
      const img = firstQuoteImage(content);
      if (snip) text.append(document.createTextNode(' ' + snip));
      else if (!img && !hasInvoice) text.append(document.createTextNode(' (no text)'));
      const kids = [text];
      if (img) {
        const im = document.createElement('img');
        im.className = 'quote-inline-thumb';
        im.referrerPolicy = 'no-referrer';
        im.src = img;
        im.onerror = () => im.remove();
        kids.push(im);
      }
      if (hasInvoice) kids.push(h('div', { className: 'quote-inline-meta', textContent: '⚡ invoice' }));
      el.replaceChildren(...kids);
      deps.fetchPreviewProfile(ev.pubkey).then((p) => {
        if (p && p.name) who.textContent = '@' + p.name;
      });
    }
  }

  const BLOSSOM_SERVER_LIST_KIND = 10063;
  const BLOSSOM_AUTH_KIND = 24242;
  const BLOSSOM_UPLOAD_TIMEOUT = 30000;
  const BLOSSOM_CACHE_TTL = 5 * 60 * 1000;

  const _blossomServerCache = new Map(); // pubkey -> { servers, expiresAt }

  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const STRIKE_DELAY_MOD_MS = 300;
  const STRIKE_DELAY_WINDOW_MS = 111;
  const STRIKE_DUR_BASE_MS = 900;
  const STRIKE_DUR_STEPS = 5;
  const STRIKE_DUR_STEP_MS = 90;
  const rawStrikeDelay = (i) => (i * 37) % STRIKE_DELAY_MOD_MS;
  const glyphBeat = (i, n) => {
    // The widest raw delay this many glyphs actually reaches — not the modulus, which
    // only a long figure gets near.
    let span = 0;
    for (let k = 0; k < n; k++) span = Math.max(span, rawStrikeDelay(k));
    const squeeze = span > STRIKE_DELAY_WINDOW_MS ? STRIKE_DELAY_WINDOW_MS / span : 1;
    return {
      delay: Math.round(rawStrikeDelay(i) * squeeze),
      duration: STRIKE_DUR_BASE_MS + ((i * 53) % STRIKE_DUR_STEPS) * STRIKE_DUR_STEP_MS,
    };
  };

  return {
    show, hide, ICONS, FILLED_ICONS, icon, h,
    TRACKING_PARAMS, TRACKING_PREFIXES, HOST_TRACKING_PARAMS, isTrackingParam,
    hostTrackingParams, cleanTrackedUrl, trimUrlTail, findTrackedUrls,
    LIGHT_THEMES, logoSrcFor, avatarPhSrc,
    installComposer,
    // Furniture: the same three things every composer needs, wired through installComposer
    // so they read their relays and their profile cache from whichever page installed it.
    POW_LEVELS, POW_DEFAULT_BITS, powLevelFor,
    NOTE_COUNTDOWN_PRESETS, NOTE_COUNTDOWN_DEFAULT,
    VIEW_CLIENTS, DEFAULT_CLIENT,
    IMG_EXT, VID_EXT, urlIsVideo,
    // The imeta write side and its editor row: pure of deps, so both pages take them
    // straight off the global like IMG_EXT rather than through installComposer.
    ALT_MAX, normalizeAltBreaks, capAltText, buildImetaTag, imetaTagsForMedia, buildAltEditorRow,
    composeNoteContent, stripDraftMediaUrls, buildMediaDrawer, videoThumbCover, primeVideoThumb,
    loneMediaUrl, removeUrlFromEditor, urlOnBoundary,
  };
})();
