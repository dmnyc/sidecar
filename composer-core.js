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
  // i18n.js loads before this file on every page that uses it.
  const I18N = window.SidecarI18n;
  const { t, tn } = I18N;
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');

  // ---- flat (line) icons — inherit currentColor ----
  const ICONS = {
    // Feather's folder, for the composer's saved drafts.
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>',
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
    'more-v': '<circle cx="12" cy="5" r="1.6" fill="currentColor"></circle><circle cx="12" cy="12" r="1.6" fill="currentColor"></circle><circle cx="12" cy="19" r="1.6" fill="currentColor"></circle>',
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
    // A single clockwise arrow: the profile screen's refresh mark (sidepanel.js). The
    // two-arrow `refresh` above reads as "sync"; this one reads as "try again".
    reload: '<path d="M20 12a8 8 0 1 1-2.34-5.66"></path><polyline points="20 4.5 20 9 15.5 9"></polyline>',
    'rotate-ccw': '<polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>',
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
    // A frame with a play mark, for the GIF picker: a picture that moves. Its label says
    // GIF beside it, which is what keeps it from reading as the video placeholder above.
    gif: '<rect x="2" y="4" width="20" height="16" rx="3"></rect><polygon points="10 9 15 12 10 15 10 9"></polygon>',
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
  const LIGHT_THEMES = new Set(['industria', 'aegean', 'bauhaus', 'populuxe', 'par-avion', 'werkstatte', 'ukiyo-e', 'mycelium', 'ben-day', 'turnstile']);
  // Light themes that draw a top bar dark, so a logo on that bar takes the light wordmark
  // the dark themes use. Two lists, because the bars differ: Ben Day's composer bar is its
  // black plate while its panel bars are white, and Turnstile's name tablet is on both.
  const COMPOSE_DARK_BAR_THEMES = new Set(['ben-day', 'turnstile']);
  const PANEL_DARK_BAR_THEMES = new Set(['turnstile']);
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
          h('span', { textContent: acResults.length ? t('Searching more…') : t('Searching Nostr…') }),
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
    const trackLabel = h('span', { textContent: t('Remove tracking tags') });
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
        ? t('Remove tracking tags')
        : t('Remove tracking tags from {{count}} links', { count: I18N.fmtNum(tracked.length) });
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
    const attachLabel = h('span', { textContent: t('Attach this image') });
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
    const attachX = h('button', { className: 'attach-x', title: t('Keep it as text'), type: 'button' });
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
        attachLabel.textContent = urlIsVideo(url) ? t('Attach this video') : t('Attach this image');
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
    //
    // ASKED OF purplepag.es TOO, and A MISS IS NOT CACHED. The configured relays alone
    // rarely carry a stranger's kind:0, and a miss written to the cache as an empty profile
    // read as "this person has no name" to everything after it: the full-size composer's
    // preview showed the mention, and then the embedded note's author, as an npub.
    const named = (pk) => { const r = deps.cachedProfile(pk); return !!(r && r.name); };
    const need = [...new Set(mentions.map((x) => x.pubkey))].filter((pk) => !named(pk));
    if (need.length) {
      try {
        const relays = [...new Set([...(await deps.relayUrls(false)), 'wss://purplepag.es'])];
        const events = await Promise.race([
          deps.poolQuerySync(relays, { kinds: [0], authors: need }),
          new Promise((res) => setTimeout(() => res([]), 6000)),
        ]);
        const latest = {};
        (events || []).forEach((ev) => {
          if (!latest[ev.pubkey] || ev.created_at > latest[ev.pubkey].created_at) latest[ev.pubkey] = ev;
        });
        need.forEach((pk) => {
          if (!latest[pk]) return;
          let content = {};
          try { content = JSON.parse(latest[pk].content) || {}; } catch (_) {}
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
          a.textContent = t('quoted note…');
          quotes.push({ el: a, bech });
          pushBlock(a);
        }
      } else if (m[3]) {
        // A fence is block-level, so it goes through pushBlock and takes the newlines
        // around it with it, the same as an image or a quote box.
        //
        // COUNTED AGAINST THE CAP, or a truncated context strip could be one enormous
        // listing. It is counted whole and refused whole: half a code block is worse
        // than a line saying there is one, because a reader cannot tell a cut from the
        // code actually ending there.
        if (!truncated) {
          if (used + m[3].length > maxLen) { pushText('…'); truncated = true; }
          else { pushBlock(codeBlockEl(m[3])); used += m[3].length; }
        }
      } else if (m[4]) {
        if (!truncated) {
          if (used + m[4].length > maxLen) { pushText('…'); truncated = true; }
          else { container.append(codeInlineEl(m[4])); used += m[4].length; }
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
      // Server lists are published to the account's write relays. Settings'
      // bootstrap set alone can miss them even when another client finds them.
      // Use the shared account policy in both composers, including write-only
      // relays and honoring the account's choice to exclude bootstrap relays.
      const map = await deps.call({ type: 'SIDECAR_GET_ACCOUNT_RELAYS', pubkey });
      const relays = Object.keys(map || {}).filter((url) => map[url].read || map[url].write);
      if (!relays.length) return [];
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
    // A relay failure or a missing event is not proof that this account has no
    // Blossom servers. Cache only usable lists, so the next upload can recover
    // immediately instead of silently using nostr.build for another five minutes.
    if (servers.length) {
      _blossomServerCache.set(pubkey, { servers, expiresAt: Date.now() + BLOSSOM_CACHE_TTL });
    } else {
      _blossomServerCache.delete(pubkey);
    }
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
        if (!resp.ok) throw new Error(t('HTTP {{status}}', { status: resp.status }));
        const data = await resp.json().catch(() => null);
        if (data && data.url) return data.url;
        throw new Error(t('No URL in Blossom response'));
      } catch (e) {
        clearTimeout(timer);
        console.warn('[Blossom] upload to ' + server + ' failed:', e);
        lastError = e;
      }
    }
    throw lastError || new Error(t('All Blossom servers failed'));
  }

  async function tryBlossomFirst(file, forPubkey) {
    // Through the page. The fallback used to read the panel's own state.activePubkey,
    // which is not a name this file can see and would have thrown on the first upload
    // from anywhere else.
    const pk = forPubkey || deps.activePubkey();
    if (!pk) return null;
    try {
      const servers = await fetchBlossomServers(pk);
      if (!servers.length) {
        console.warn('[Upload] no usable Blossom servers found; falling back to nostr.build. Discovery will retry on the next upload.');
        return null;
      }
      return await uploadToBlossom(file, servers, pk);
    } catch (e) {
      console.warn('[Upload] Blossom failed, falling back to nostr.build:', e);
      return null;
    }
  }

  async function uploadMedia(file, forPubkey) {
    const isImg = file.type.startsWith('image/');
    const isVid = file.type.startsWith('video/');
    if (!isImg && !isVid) throw new Error(t('Choose an image or video'));
    if (file.size > 100 * 1024 * 1024) throw new Error(t('File too large (max 100MB)'));
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
    if (!resp.ok) throw new Error(t('Upload failed ({{status}})', { status: resp.status }));
    const json = await resp.json().catch(() => null);
    const u = json && json.data && (Array.isArray(json.data) ? json.data[0] && json.data[0].url : json.data.url);
    if (!u) throw new Error(t('Upload returned no URL'));
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
    head.append(h('span', { className: 'compose-alt-hint', textContent: t('Describe this image for anyone who may not be able to see it.') }));
    if (initial) {
      const rm = h('button', { className: 'mini ghost compose-alt-remove', title: t('Remove the description'), type: 'button' });
      rm.append(icon('trash'));
      rm.addEventListener('click', () => commit(''));
      head.append(rm);
    }
    row.append(head);

    const field = h('textarea', { className: 'compose-alt-text', maxLength: ALT_MAX, placeholder: t('What does the image show?') });
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
    const save = h('button', { className: 'ghost compose-alt-save', type: 'button', textContent: t('Save description') });
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

  // ---- reply threading, shared by both composers ------------------------------------
  //
  // MOVED HERE so the panel and the expanded tab build byte-identical threading. It used
  // to live in sidepanel.js, which is why Expand was disabled on replies: the tab had no
  // way to produce these tags and popping a reply out would have published a top-level
  // note, detached from the thread, with nothing on screen saying so.
  //
  // selfPubkey is a parameter rather than a read of some global, because the two callers
  // keep the active account in different places and the one thing this must not get wrong
  // is which key to leave OUT of the p tags.
  const WEB_COMMENT_KIND = 1111;

  function replyTags(target, selfPubkey) {
    const tags = [];
    const tgTags = (target && target.tags) || [];
    const id = target && target.id;
    const author = target && target.pubkey;

    // Everyone already in the conversation, so they are notified. Deduped, and never
    // the replier themselves — self-p-tagging shows up as a notification from you.
    const people = [];
    const seenP = new Set([selfPubkey]);
    const addP = (pk) => {
      if (!pk || seenP.has(pk)) return;
      seenP.add(pk);
      people.push(['p', pk]);
    };
    addP(author);
    tgTags.forEach((t) => { if (t[0] === 'p' && t[1]) addP(t[1]); });

    if (target.kind === WEB_COMMENT_KIND) {
      // Scope, verbatim. A 1111 always carries its root in uppercase tags.
      tgTags.forEach((t) => { if (t[0] === 'I' || t[0] === 'K' || t[0] === 'E' || t[0] === 'A') tags.push(t.slice()); });
      // AND THE ROOT AUTHOR, which NIP-22 says a comment MUST carry and this did not.
      // It is the mirror of the bug this branch fixes: a client watching `#P` for replies
      // in its own threads could not see ours. Copied from the parent when the parent is
      // itself the root, since then the two are the same person.
      const rootP = tgTags.find((t) => t[0] === 'P' && t[1]);
      if (rootP) tags.push(rootP.slice());
      else {
        // No P on the parent. The spec also carries the root author as the FOURTH element
        // of the E tag, so that is where to look before giving up rather than guessing at
        // the parent's author, who is only the same person on a top-level comment. A
        // web-rooted comment (an I tag) has no author at all and correctly gets none.
        const rootE = tgTags.find((t) => t[0] === 'E' && t[3]);
        if (rootE) tags.push(['P', rootE[3]]);
      }
      // Parent: the comment being answered.
      tags.push(['e', id], ['k', String(target.kind)]);
      return { kind: WEB_COMMENT_KIND, tags: [...tags, ...people] };
    }

    // NIP-10. Reuse the target's root when it has one; otherwise the target is the root.
    const rootTag = tgTags.find((t) => t[0] === 'e' && t[3] === 'root' && t[1]);
    const root = rootTag ? rootTag[1] : id;
    tags.push(['e', root, '', 'root']);
    if (root !== id) tags.push(['e', id, '', 'reply']);
    return { kind: 1, tags: [...tags, ...people] };
  }

  // ---- what a note's text tags, shared by both composers ----------------------------
  //
  // MOVED HERE from sidepanel.js so the expanded tab tags a note's text the way the
  // panel does. It never did: from the tab's first release a mention went out with no p
  // tag and a quote with no q tag, so the people mentioned were never notified and a
  // quote did not read as one, while the same note written in the panel did both. Two
  // copies of a publish path is how that happens, so there is one now.

  // `p` tags for every profile mentioned in the text, deduped and in order.
  //
  // This is what makes a mention reach the person mentioned: notification discovery is
  // `{'#p': [pubkey]}`, so a mention with no p tag renders for every reader and is
  // invisible to its target.
  function mentionPTags(content, NT) {
    const out = [];
    const seen = new Set();
    const re = /nostr:(npub1[0-9a-z]+|nprofile1[0-9a-z]+)/g;
    let m;
    while ((m = re.exec(String(content || ''))) !== null) {
      try {
        const d = NT.nip19.decode(m[1]);
        const pk = d.type === 'npub' ? d.data : d.data.pubkey;
        if (pk && !seen.has(pk)) { seen.add(pk); out.push(['p', pk]); }
      } catch (_) { /* malformed mention — skip it, don't fail the post */ }
    }
    return out;
  }

  // NIP-18 `q` tags for the event references in a note's body, plus the pubkeys of the
  // quoted authors (noteBodyTags p-tags them).
  //
  // A bech32 reference in the content is not, on its own, a quote: without the `q` tag
  // the note goes out as plain text with a 210-character string in the middle of it.
  // Clients key quote rendering off `q`, the quoted author is never notified, and
  // Sidecar's own notification list tells "quoted your note" from a reply by it.
  //
  // note/nevent quote by event id; naddr quotes by "kind:pubkey:d" coordinate, since an
  // addressable event's id changes with every edit.
  const BODY_REF_RE = /nostr:(note1[0-9a-z]+|nevent1[0-9a-z]+|naddr1[0-9a-z]+)/g;
  function quoteTags(content, NT) {
    const tags = [];
    const authors = [];
    const seen = new Set();
    let m;
    BODY_REF_RE.lastIndex = 0;
    while ((m = BODY_REF_RE.exec(String(content || ''))) !== null) {
      let d = null;
      try { d = NT.nip19.decode(m[1]); } catch (_) { continue; } // malformed ref — skip it, don't fail the post
      let value = null;
      let relay = '';
      let author = '';
      if (d.type === 'note') {
        value = d.data;
      } else if (d.type === 'nevent') {
        value = d.data.id;
        relay = (d.data.relays || [])[0] || '';
        author = d.data.author || '';
      } else if (d.type === 'naddr') {
        value = d.data.kind + ':' + d.data.pubkey + ':' + d.data.identifier;
        relay = (d.data.relays || [])[0] || '';
        author = d.data.pubkey || '';
      }
      if (!value || seen.has(value)) continue;
      seen.add(value);
      // Positional tag, so an author can only be given if the relay slot is filled —
      // with an empty string when there's no hint, which is what other clients emit.
      tags.push(author ? ['q', value, relay, author] : relay ? ['q', value, relay] : ['q', value]);
      if (author) authors.push(author);
    }
    return { tags, authors };
  }

  // A BARE REFERENCE IS STILL A REFERENCE. Nobody should have to know that a pasted
  // npub1…, note1…, nevent1… or naddr1… only counts as a mention or a quote in its
  // nostr: form (NIP-27): the preview draws a bare one as a quote or a name, other clients
  // mostly draw it as text, and the tags that notify and link came only from the nostr:
  // form. So at Post a reference standing on its own is written as nostr:, and the note
  // goes out as the preview showed it. Left alone: one already in nostr: form, one inside
  // a link (njump.me/nevent1…), one inside code, and anything that does not decode.
  const BARE_REF_RE = /(^|[\s(\[{"'\u201c\u2018<])((?:npub1|nprofile1|note1|nevent1|naddr1)[02-9ac-hj-np-z]+)/g;
  function linkBareRefs(text, NT) {
    return String(text || '')
      .split(/(```[\s\S]*?```|`[^`\n]+`)/)
      .map((part, i) => (i % 2 ? part : part.replace(BARE_REF_RE, (whole, lead, ref) => {
        try { NT.nip19.decode(ref); } catch (_) { return whole; }
        return lead + 'nostr:' + ref;
      })))
      .join('');
  }

  // EVERYTHING A NOTE'S TEXT TAGS, in the order a note carries it: the people mentioned,
  // then the authors it quotes that are not already among them, less anyone the reply's
  // own threading tags already name (threadTags), and the q tags. Both composers place
  // these after the threading and client tags: p tags, then q tags, then imeta.
  function noteBodyTags(prose, NT, threadTags) {
    const pTags = mentionPTags(prose, NT);
    const quotes = quoteTags(prose, NT);
    const seenP = new Set(pTags.map((t) => t[1]));
    for (const pk of quotes.authors) {
      if (seenP.has(pk)) continue;
      seenP.add(pk);
      pTags.push(['p', pk]);
    }
    const already = new Set((threadTags || []).filter((t) => t[0] === 'p').map((t) => t[1]));
    return { p: pTags.filter((t) => !already.has(t[1])), q: quotes.tags };
  }

  // ---- dev-build composer fixtures, shared by both composers ------------------------
  //
  // Three tools for authoring test events from an unpacked build: an event kind other
  // than the one a reply would take, p tags the text never mentions, and a reply to any
  // event by id. Gated by the build in each composer, never here: these are pure, and the
  // gate belongs to the page that knows what build it is. Moved here so the panel and the
  // expanded tab produce the same events; two copies drift.

  // Typed keys to p-tag silently: npub1… or 64 hex, separated by spaces or commas.
  // Anything unreadable is DROPPED rather than guessed at, because a tag aimed at the
  // wrong key is worse than no tag and nothing in the note would reveal it.
  function parseSilentTags(text, NT) {
    const out = [];
    const seen = new Set();
    String(text || '').split(/[\s,]+/).forEach((tok) => {
      const t = tok.trim().replace(/^nostr:/i, '');
      if (!t) return;
      let hex = '';
      if (/^[0-9a-f]{64}$/i.test(t)) hex = t.toLowerCase();
      else if (/^npub1/i.test(t)) {
        try {
          const d = NT.nip19.decode(t);
          if (d && d.type === 'npub' && typeof d.data === 'string') hex = d.data;
        } catch (_) {}
      }
      if (hex && !seen.has(hex)) { seen.add(hex); out.push(hex); }
    });
    return out;
  }

  // An event reference: note1…, nevent1… (its relay hints and author come with it) or
  // 64 hex characters, with or without nostr:. Anything else is null, never a guess.
  function parseEventRef(text, NT) {
    const raw = String(text || '').trim().replace(/^nostr:/, '');
    if (/^[0-9a-f]{64}$/i.test(raw)) return { id: raw.toLowerCase(), relays: [], author: null };
    try {
      const d = NT.nip19.decode(raw);
      if (d.type === 'note' && typeof d.data === 'string') return { id: d.data, relays: [], author: null };
      if (d.type === 'nevent' && d.data && d.data.id) {
        return { id: d.data.id, relays: d.data.relays || [], author: d.data.author || null };
      }
    } catch (_) {}
    return null;
  }

  // The event, from its hints, the page's own read relays and its author's write relays
  // when the reference names one. via: ownRelays() and outboxOf(pubkey) resolve to
  // relay lists, get(relays, filter) to one event. Only an event whose id IS the one
  // asked for is accepted: a relay is not obliged to honor the filter.
  async function fetchEventRef(ref, via) {
    const own = await Promise.resolve().then(via.ownRelays).catch(() => []);
    let outbox = [];
    if (ref.author) {
      try { outbox = (await via.outboxOf(ref.author)) || []; } catch (_) {}
    }
    const relays = [...new Set([...(ref.relays || []), ...(own || []), ...outbox])];
    if (!relays.length) return null;
    const ev = await Promise.race([
      Promise.resolve().then(() => via.get(relays, { ids: [ref.id] })).catch(() => null),
      new Promise((res) => setTimeout(() => res(null), 8000)),
    ]);
    return ev && ev.id === ref.id ? ev : null;
  }

  // A reply's threading with its KIND chosen rather than inherited: kind 1 or kind 1111
  // answering anything, so a reader's handling of mixed threads can be tested. 0 (or no
  // choice) is the ordinary reply. authorOf(id) resolves to a note's author, for a
  // comment whose thread root the target names but does not carry the author of.
  async function devReplyTags(target, selectedKind, selfPubkey, authorOf) {
    if (!selectedKind) return target ? replyTags(target, selfPubkey) : null;
    if (!target) {
      if (selectedKind === WEB_COMMENT_KIND) throw new Error('Reply to a note to create a kind 1111 comment.');
      return null;
    }
    const normal = replyTags(target, selfPubkey);
    if (selectedKind === normal.kind) return normal;
    const people = normal.tags.filter((t) => t[0] === 'p');
    if (selectedKind === WEB_COMMENT_KIND) {
      const rootTag = (target.tags || []).find((t) => t[0] === 'e' && t[3] === 'root' && t[1]);
      const rootId = rootTag ? rootTag[1] : target.id;
      const rootAuthor = rootId === target.id ? target.pubkey
        : rootTag[4] || (await authorOf(rootId));
      if (!rootAuthor) throw new Error('Could not load the thread author. Try again before posting this comment.');
      return { kind: WEB_COMMENT_KIND, tags: [
        ['E', rootId, rootTag?.[2] || '', rootAuthor], ['K', '1'], ['P', rootAuthor],
        ['e', target.id, '', target.pubkey], ['k', String(target.kind)], ...people,
      ] };
    }
    // Intentionally nonstandard: useful for testing tolerant readers of mixed threads.
    const root = (target.tags || []).find((t) => t[0] === 'E' && t[1]);
    const rootId = root ? root[1] : target.id;
    const rootAuthor = (target.tags || []).find((t) => t[0] === 'P' && t[1])?.[1] || root?.[3];
    if (rootAuthor && rootAuthor !== selfPubkey && !people.some((t) => t[1] === rootAuthor)) {
      people.push(['p', rootAuthor]);
    }
    const tags = [['e', rootId, root?.[2] || '', 'root']];
    if (rootId !== target.id) tags.push(['e', target.id, '', 'reply']);
    return { kind: 1, tags: [...tags, ...people] };
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
        const cp = h('button', { className: 'compose-media-copy', title: t('Copy link'), type: 'button' });
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

  // cost() is a function so it is translated when read, not when this file loads, which
  // is before the language has.
  const POW_LEVELS = [
    { bits: 16, cost: () => t('Usually instant.') },
    { bits: 18, cost: () => t('About a second.') },
    { bits: 20, cost: () => t('A few seconds, sometimes fifteen.') },
    { bits: 22, cost: () => t('Ten seconds or so, sometimes a minute.') },
  ];
  const POW_DEFAULT_BITS = 18;
  const powLevelFor = (bits) => POW_LEVELS.find((l) => l.bits === bits) || POW_LEVELS[1];

  const IMG_EXT = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?.*)?$/i;

  const VID_EXT = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

  // CODE IS APPENDED, NOT PREPENDED, so m[1] and m[2] keep meaning what they meant to
  // every existing branch. It still wins over a URL inside a fence: the engine takes the
  // LEFTMOST match, and a fence opens before anything it contains.
  //
  // Fenced first, then inline, or ``` would match as an empty inline pair followed by a
  // stray backtick. Inline refuses newlines, so an unclosed backtick in prose cannot
  // swallow the rest of a note looking for its partner.
  const PREVIEW_RE = /(https?:\/\/[^\s]+)|(?:nostr:)?(npub1[0-9a-z]{58}|nprofile1[0-9a-z]{50,}|note1[0-9a-z]{58}|nevent1[0-9a-z]{50,}|naddr1[0-9a-z]{50,})|(```[\s\S]*?```)|(`[^`\n]+`)/gi;

  // The text inside a fence, without the fences and without the language tag authors put
  // on the opening line. The tag is dropped rather than shown: it is an instruction to a
  // highlighter, and there is no highlighter here.
  function fenceBody(raw) {
    let t = String(raw).slice(3, -3);
    t = t.replace(/^[^\n`]*\n/, '');   // ```js\n  -> drop the tag line
    return t.replace(/^\n+/, '').replace(/\s+$/, '');
  }

  // THE BLOCK IS COPYABLE, because the reason somebody pastes code into a note is for
  // you to run it, and a box that scrolls sideways is the worst possible thing to select
  // by hand on a phone or in a 360px panel.
  //
  // The button sits OUTSIDE the scrolling element, in a wrapper, or it would scroll away
  // with the content the moment a long line was read.
  function codeBlockEl(raw) {
    const body = fenceBody(raw);
    const wrap = h('div', { className: 'note-code-wrap' });
    const pre = h('pre', { className: 'note-code' });
    pre.append(h('code', { textContent: body }));

    const copy = h('button', { className: 'note-code-copy', type: 'button', title: t('Copy code') });
    copy.append(icon('copy'));
    copy.addEventListener('click', (e) => {
      // The block can sit inside a row that is itself a link to the note.
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(body).then(() => {
        copy.innerHTML = '';
        copy.append(icon('check'));
        copy.classList.add('ok');
        // Reverted rather than left as a tick: the next block down is a different block,
        // and a permanent tick on one of several says the wrong thing about which.
        setTimeout(() => {
          if (!copy.isConnected) return;
          copy.innerHTML = '';
          copy.append(icon('copy'));
          copy.classList.remove('ok');
        }, 1200);
      }, () => {});
    });

    wrap.append(pre, copy);
    return wrap;
  }

  // ---- polls, shared by both composers -------------------------------------------
  //
  // Moved here from sidepanel.js so the expanded tab can compose one too. Until it
  // could, the always-expanded setting had to refuse a poll draft outright, since a tab
  // with no poll editor shows the question and the options as nothing and then publishes
  // a plain note over the top of them.
  const POLL_KIND = 1068;
  const POLL_SINGLE = 'singlechoice';
  const POLL_MULTIPLE = 'multiplechoice';
  // A day rather than the week this started at, because a week is not what anyone means
  // by "I'm asking". Twitter defaults to a day and caps at seven; Amethyst's own poll
  // composer opens on oneDayAhead. Longer is still offered, up to thirty days, since a
  // poll about something slow is a real thing to want. The default is the common case.
  const POLL_DEFAULT_SECS = 86400;
  const POLL_DURATIONS = [
    { secs: 3600, label: '1 hour' },
    { secs: 6 * 3600, label: '6 hours' },
    { secs: POLL_DEFAULT_SECS, label: '1 day' },
    { secs: 3 * 86400, label: '3 days' },
    { secs: 7 * 86400, label: '7 days' },
    { secs: 14 * 86400, label: '14 days' },
    { secs: 30 * 86400, label: '30 days' },
  ];
  // The label above is English for tests and logs; what the select shows is built here,
  // since "6 hours" is a count and takes its language's plural form.
  function pollDurationLabel(secs) {
    if (secs < 86400) {
      const n = secs / 3600;
      return tn('{{count}} hour', '{{count}} hours', n);
    }
    const n = secs / 86400;
    return tn('{{count}} day', '{{count}} days', n);
  }
  // Four, matching what Jumble writes. These tags tell a voter where to publish, and a
  // long list is not more reachable: it is the same votes scattered wider, which makes
  // the count slower to gather and more likely to be partial.
  const POLL_RELAY_LIMIT = 4;

  // Alphanumeric, which is all NIP-88 asks of an option id. Nine characters matches what
  // Jumble writes, so ids from either client look the same on a relay.
  function pollOptionId() {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    let out = '';
    for (const b of bytes) out += abc[b % abc.length];
    return out;
  }

  function newPollDraft() {
    return {
      options: ['', ''],
      multiple: false,
      ends: { kind: 'in', secs: POLL_DEFAULT_SECS },
    };
  }

  // A DURATION IS RESOLVED AT PUBLISH, NOT AT DRAFT. Storing the absolute timestamp when
  // the editor opened meant a poll drafted on Monday and posted on Thursday went out with
  // three of its days already gone, and one left in a draft past its own duration
  // published already closed. `kind: 'at'` is the one case the author really did name a
  // moment, so that one is passed through untouched.
  function pollEndsAtFor(pollDraft, nowSecs) {
    const ends = pollDraft && pollDraft.ends;
    if (!ends || ends.kind === 'none') return null;
    if (ends.kind === 'at') return ends.at > 0 ? ends.at : null;
    return nowSecs + ends.secs;
  }

  // Two options with something in them is the floor: one option is not a question, and
  // a blank is not a choice anyone can pick. Blanks are dropped rather than rejected so
  // an author can leave the trailing empty row alone instead of tidying it.
  function pollDraftOptions(pollDraft) {
    return ((pollDraft && pollDraft.options) || []).map((o) => o.trim()).filter(Boolean);
  }

  function pollDraftIsPostable(pollDraft) {
    return pollDraftOptions(pollDraft).length >= 2;
  }

  // The tags that turn a note into a poll. Pure, so the shape of a published poll is
  // testable without a relay or a signer.
  //
  // Ids are generated here rather than in the editor because they are not the author's
  // business, and because an id has to be unique WITHIN the poll: pollOptions drops a
  // duplicate rather than merging it, so a collision would silently lose an option
  // between what the author typed and what anyone can vote for.
  function buildPollTags(pollDraft, nowSecs, relays) {
    const tags = [];
    const used = new Set();
    pollDraftOptions(pollDraft).forEach((label) => {
      let id = pollOptionId();
      while (used.has(id)) id = pollOptionId();
      used.add(id);
      tags.push(['option', id, label]);
    });
    // Written even for the default. NIP-88 says an absent polltype is singlechoice, so
    // this is redundant on paper, and it is the difference between a reader having to
    // know the default and being told.
    tags.push(['polltype', pollDraft.multiple ? POLL_MULTIPLE : POLL_SINGLE]);
    const endsAt = pollEndsAtFor(pollDraft, nowSecs);
    if (endsAt) tags.push(['endsAt', String(endsAt)]);
    (relays || []).slice(0, POLL_RELAY_LIMIT).forEach((u) => tags.push(['relay', u]));
    return tags;
  }

  // THE POLL EDITOR, built here so both composers have one.
  //
  // It used to live inside openComposer, which is why the expanded tab had no polls at
  // all and the always-expanded setting had to refuse a poll draft: a tab with no editor
  // shows the question and the options as nothing, then publishes a plain note over the
  // top of them.
  //
  // `d` is everything it used to close over, as accessors rather than values, because
  // the draft object is rebound under the tab when the account changes and a captured
  // reference would go on editing the previous account's poll.
  //
  //   poll()      the draft's poll, or null
  //   setPoll(p)  write it back
  //   changed()   the draft moved: repaint Post and save. BOTH, always: the two were
  //               separate calls here and two of the sites only ever saved, so folding
  //               them apart is how one of those silently stops updating the button.
  //   isReply()   polls are not offered on a reply
  //   hasMedia()  a poll and attachments are one or the other
  //   mediaBtn()  the button that stands down while a poll holds the draft
  //   gif()       optional, the GIF picker, which stands down with it
  //   devSelect() optional, the dev kind override to disable
  //
  // Returns the pieces the caller mounts: the editor itself, the button that starts one,
  // and the two paints, since adding media has to re-run the either-or from outside.
  // ---- saved drafts, listed ----
  //
  // One account holds a note draft and a reply draft per note it is answering. Both
  // composers list the others the same way, from here: the tab under its Saved drafts tab,
  // the panel behind the folder in its corner.
  //
  // ONLY DRAFTS WITH SOMETHING IN THEM. A reply keeps its slot while empty because the
  // slot holds the target, but an empty slot is nothing to go back to.
  function draftHasContent(d) {
    return !!(d && ((d.text && d.text.trim()) || (d.media && d.media.length)
      || (d.poll && d.poll.options && d.poll.options.some((o) => o && o.trim()))));
  }
  // Every draft of this account but the one on screen, the note first and then replies
  // newest first. `replyId` is the note a reply answers, or null for the note draft.
  function otherDraftEntries(all, pubkey, currentKey) {
    return Object.keys(all || {})
      .filter((k) => k !== currentKey && (k === pubkey || k.startsWith(pubkey + '|r:'))
        && draftHasContent(all[k]))
      .map((k) => ({
        key: k, draft: all[k], reply: k !== pubkey,
        replyId: k === pubkey ? null : k.slice(k.indexOf('|r:') + 3),
      }))
      .sort((a, b) => (a.reply - b.reply) || ((b.draft.savedAt || 0) - (a.draft.savedAt || 0)));
  }
  function draftSnippet(d) {
    const text = stripDraftMediaUrls(d.text || '', d.media).replace(/\s+/g, ' ').trim();
    if (text) return text;
    // A poll with its options typed and no question yet still says what it is.
    const opts = (d.poll && d.poll.options || []).map((o) => (o || '').trim()).filter(Boolean);
    if (opts.length) return opts.join(' · ');
    if (d.media && d.media.length) return tn('{{count}} attachment', '{{count}} attachments', d.media.length);
    return '';
  }
  // What a row is called: a reply, a poll, or the note.
  function draftKindLabel(entry, name) {
    if (entry.reply) return name ? t('Reply to {{name}}', { name }) : t('Reply');
    return entry.draft.poll ? t('Your poll') : t('Your note');
  }

  // The list itself. d: { entries, nameFor(pubkey) -> Promise<name|null>, onPick(entry),
  // onDelete(entry) -> Promise }.
  //
  // THE TRASH CONFIRMS BY REWRITING ITS OWN ROW, the account switcher's two taps: the
  // first turns the row into the question, the second, anywhere on it, deletes. A draft
  // lives only in this browser, so there is nothing to recover it from, and the toast
  // has no Undo to offer instead. The question goes back on its own after a few seconds.
  function buildSavedDraftList(d) {
    const list = h('div', { className: 'saved-drafts' });
    d.entries.forEach((entry) => {
      const label = h('span', { className: 'saved-draft-label', textContent: draftKindLabel(entry, null) });
      const when = h('span', { className: 'saved-draft-when',
        textContent: entry.draft.savedAt ? relTime(entry.draft.savedAt) : '' });
      const snip = h('span', { className: 'saved-draft-snip', dir: 'auto', textContent: draftSnippet(entry.draft) });
      const open = h('button', { className: 'saved-draft-open', type: 'button' }, [
        h('span', { className: 'saved-draft-top' }, [label, when]), snip,
      ]);
      const trash = h('button', { className: 'saved-draft-x', type: 'button', title: t('Delete draft') });
      trash.append(icon('trash'));
      const row = h('div', { className: 'saved-draft' }, [open, trash]);

      let name = null;
      if (entry.reply && entry.draft.replyTo && entry.draft.replyTo.pubkey && d.nameFor) {
        Promise.resolve(d.nameFor(entry.draft.replyTo.pubkey)).then((n) => {
          if (!n || !label.isConnected) return;
          name = n;
          if (!row.classList.contains('confirming')) label.textContent = draftKindLabel(entry, name);
        }).catch(() => {});
      }

      let timer = null;
      const settle = () => {
        clearTimeout(timer);
        row.classList.remove('confirming');
        label.textContent = draftKindLabel(entry, name);
        when.classList.remove('hidden');
        snip.textContent = draftSnippet(entry.draft);
      };
      const confirmDelete = () => {
        row.classList.add('confirming');
        label.textContent = t('Delete this draft?');
        when.classList.add('hidden');
        snip.textContent = t('Tap again to delete');
        timer = setTimeout(settle, 4000);
      };
      const remove = async () => {
        clearTimeout(timer);
        trash.disabled = true; open.disabled = true;
        try { await d.onDelete(entry); } catch (_) { settle(); trash.disabled = false; open.disabled = false; }
      };
      trash.addEventListener('click', () => { if (row.classList.contains('confirming')) remove(); else confirmDelete(); });
      open.addEventListener('click', () => { if (row.classList.contains('confirming')) remove(); else d.onPick(entry); });
      list.append(row);
    });
    return list;
  }

  function buildPollEditor(d) {
    const pollWrap = h('div', { className: 'poll-editor hidden' });
    const pollAdd = h('button', { className: 'mini compose-add' });
    pollAdd.append(icon('bar-chart'), h('span', { textContent: t('Poll') }));
    pollAdd.addEventListener('click', () => {
      d.setPoll(newPollDraft());
      paintPoll();
      // Turning a note into a poll RAISES the bar for posting: a note needs text or an
      // image, a poll needs its question and two filled options. Post was already enabled
      // under the note rule, and without this it stayed that way, so typing a question,
      // tapping here and tapping Post published a kind:1068 carrying no options at all.
      // Nothing downstream re-checks; the click handler only asks whether Post is
      // disabled. Remove poll has always done this, which is the tell.
      d.changed();
      const first = pollWrap.querySelector('.poll-option-input');
      if (first) first.focus();
    });

    // Rebuilt wholesale on add/remove. The rows carry an index in their own handlers,
    // and patching a list in place while indices shift underneath is how a remove
    // button ends up deleting the row below the one it sits on.
    function paintPollOptions(list) {
      list.innerHTML = '';
      const opts = d.poll().options;
      opts.forEach((value, i) => {
        const row = h('div', { className: 'poll-option' });
        row.append(h('span', { className: 'poll-option-num', textContent: String(i + 1) + '.' }));
        const input = h('input', {
          className: 'poll-option-input',
          type: 'text',
          value,
          maxLength: 200,
          placeholder: t('Option {{number}}', { number: i + 1 }),
        });
        input.addEventListener('input', () => {
          d.poll().options[i] = input.value;
          d.changed();
        });
        row.append(input);
        // TWO IS THE FLOOR, so below that there is nothing to remove and the button
        // would only ever be disabled. An icon-only control in the inline slot, per
        // the panel's row rules: a worded button here would leave the input no width.
        if (opts.length > 2) {
          const rm = h('button', { className: 'poll-option-x', title: t('Remove option {{number}}', { number: i + 1 }) });
          rm.append(icon('x'));
          rm.addEventListener('click', () => {
            d.poll().options.splice(i, 1);
            paintPollOptions(list);
            d.changed();
          });
          row.append(rm);
        }
        list.append(row);
      });
    }

    // A POLL AND ATTACHMENTS ARE ONE OR THE OTHER. A kind:1068 carrying appended
    // image URLs and imeta tags is a shape no NIP-88 client renders, and the tag
    // push in doPublish long claimed it could not arrive. Each side's button
    // stands down while the other holds the draft, so the pair is decided by what
    // refuses to appear rather than by what publishes.
    function paintEitherOr() {
      pollAdd.classList.toggle('hidden', !!d.poll() || d.isReply() || d.hasMedia());
      d.mediaBtn().classList.toggle('hidden', !!d.poll());
      // A GIF is an attachment like any other, so it follows Media off the row, and an
      // open picker closes rather than sitting under a poll it can no longer add to.
      const gif = d.gif && d.gif();
      if (gif) {
        gif.addBtn.classList.toggle('hidden', !!d.poll() || !gif.available);
        if (d.poll()) gif.close();
      }
    }
    function paintPoll() {
      pollWrap.innerHTML = '';
      pollWrap.classList.toggle('hidden', !d.poll());
      paintEitherOr();
      const devSelect = d.devSelect && d.devSelect();
      if (devSelect) devSelect.disabled = !!d.poll();
      if (!d.poll()) return;

      const list = h('div', { className: 'poll-options' });
      paintPollOptions(list);

      const addOpt = h('button', { className: 'poll-add-option' });
      addOpt.append(icon('plus'), h('span', { textContent: t('Add option') }));
      addOpt.addEventListener('click', () => {
        d.poll().options.push('');
        paintPollOptions(list);
        d.changed();
        const inputs = list.querySelectorAll('.poll-option-input');
        if (inputs.length) inputs[inputs.length - 1].focus();
      });

      const multi = h('input', { type: 'checkbox', checked: d.poll().multiple });
      multi.addEventListener('change', () => {
        d.poll().multiple = multi.checked;
        d.changed();
      });
      const multiRow = h('label', { className: 'toggle-row' }, [
        multi,
        h('span', { textContent: t('Allow multiple choices') }),
      ]);

      // Durations, plus the two ends of the range: a specific moment, and none at all.
      const sel = h('select', { className: 'poll-ends-select' });
      POLL_DURATIONS.forEach((d) => {
        sel.append(h('option', { value: 'in:' + d.secs, textContent: pollDurationLabel(d.secs) }));
      });
      sel.append(h('option', { value: 'at', textContent: t('Custom date and time…') }));
      sel.append(h('option', { value: 'none', textContent: t('No end date') }));
      sel.value =
        d.poll().ends.kind === 'in' ? 'in:' + d.poll().ends.secs : d.poll().ends.kind;

      const custom = h('input', { className: 'poll-ends-custom', type: 'datetime-local' });
      if (d.poll().ends.kind === 'at' && d.poll().ends.at) {
        // datetime-local wants local wall time with no zone, which is what an author
        // picked in the first place; toISOString would shift it by the offset.
        const d = new Date(d.poll().ends.at * 1000);
        const pad = (n) => String(n).padStart(2, '0');
        custom.value =
          d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
          'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      }
      custom.addEventListener('change', () => {
        const at = custom.value ? Math.floor(new Date(custom.value).getTime() / 1000) : 0;
        d.poll().ends = { kind: 'at', at };
        paintEndsNote();
        d.changed();
      });

      const endsNote = h('p', { className: 'hint poll-ends-note' });
      function paintEndsNote() {
        const k = d.poll().ends.kind;
        custom.classList.toggle('hidden', k !== 'at');
        endsNote.classList.toggle('warn', k === 'none');
        if (k === 'none') {
          // Said plainly rather than blocked. It is the author's poll, and there are
          // real uses for one that never closes, but a running total is not a result:
          // there is no moment the number means anything, and nothing stops a late
          // arrival moving it a year from now.
          endsNote.textContent = t('Not recommended: the count never settles, so the poll has no final result.');
        } else if (k === 'at' && !(d.poll().ends.at > 0)) {
          endsNote.textContent = t('Pick the date and time the poll should close.');
        } else {
          const at = pollEndsAtFor(d.poll(), Math.floor(Date.now() / 1000));
          endsNote.textContent = at && at <= Math.floor(Date.now() / 1000)
            ? t('That time has already passed, so the poll would close on posting.')
            : t('Votes stop counting when the poll closes.');
        }
      }
      sel.addEventListener('change', () => {
        const v = sel.value;
        if (v === 'none') d.poll().ends = { kind: 'none' };
        else if (v === 'at') d.poll().ends = { kind: 'at', at: d.poll().ends.at || 0 };
        else d.poll().ends = { kind: 'in', secs: parseInt(v.slice(3), 10) };
        paintEndsNote();
        d.changed();
      });
      paintEndsNote();

      // WHAT POSTING A POLL ACTUALLY COSTS, said where it can still change the decision.
      // A 1068 is not a kind:1, so a client that has not implemented NIP-88 does not render
      // it at all: it never appears in a feed filtered to notes, and the author gets no
      // signal. Silence from the other side is indistinguishable from nobody caring.
      //
      // A box rather than a second amber line, because the ends note directly above is
      // already amber text on the no-end-date case and two of those read as one sentence.
      // No glyph: .kind-warn is bordered and filled, so the warning is not carried by
      // color alone (the point made above .destructive-warn).
      const clientWarn = h('div', {
        className: 'kind-warn',
        textContent: t('Some clients cannot show polls. On those, this will not appear at all.'),
      });

      const remove = h('button', { className: 'poll-remove' });
      remove.append(icon('trash'), h('span', { textContent: t('Remove poll') }));
      remove.addEventListener('click', () => {
        d.setPoll(null);
        paintPoll();
        d.changed();
      });

      pollWrap.append(
        list,
        addOpt,
        h('div', { className: 'poll-editor-sep' }),
        multiRow,
        h('label', { className: 'poll-ends-label', textContent: t('Runs for') }),
        sel,
        custom,
        endsNote,
        h('div', { className: 'poll-editor-sep' }),
        clientWarn,
        remove
      );
    }

    paintPoll();
    return { wrap: pollWrap, addBtn: pollAdd, paint: paintPoll, paintEitherOr };
  }

  // ---- GIF search, from nostr.build ----
  //
  // gifs.nostr.build indexes the GIFs in nostr.build's free public upload pool, so every
  // result is already on a Nostr media host: picking one attaches its URL the way a
  // pasted image URL is attached, and nothing is uploaded.
  //
  // The API answers registered clients only, and Sidecar is one (the client "sidecar" on
  // the gifs.nostr.build dashboard). It knows a web app by its Origin and anything else by
  // a key. A key is the one way in for an extension: Firefox gives every install its own
  // moz-extension:// origin, and an extension cannot set its own User-Agent. Whatever
  // key goes here ships inside the extension, where anyone can read it, so it identifies
  // Sidecar rather than proving anything. If one is ever abused, revoke it on the
  // dashboard and ship a new one. Empty, the picker still opens and says search is
  // unavailable.
  //
  // Registering came with a promise: "GIFs from nostr.build", linked to nostr.build,
  // wherever these GIFs appear. That is the picker's header, and it stays there.
  const GIF_API = 'https://gifs.nostr.build/api/v1';
  const GIF_API_KEY = 'gnb_czDUdII67HX2eq_6g3lH2QHk_wmpNZhu0ZXn532gDTg';
  const GIF_PAGE_SIZE = 24;
  // A query's list is at most 200 long, and the API rejects an offset past 199.
  const GIF_LAST_OFFSET = 199;
  const GIF_QUERY_MAX = 500;
  const GIF_SUGGEST_LIMIT = 6;
  // There is no trending list to open on, so the picker opens on a search for a Nostr
  // staple and offers a few more as chips. Search terms, not interface text: they are
  // what the index is tagged with, and translating them would find nothing.
  const GIF_TOPICS = ['gm', 'gn', 'pv', 'zap', 'bitcoin', 'coffee', 'lfg', 'wow'];
  // The chips in the order the picker offers them: gm first through the day, gn first in
  // the evening and overnight, by the device's own clock. Nothing is searched until one
  // is tapped, so the clock only decides which comes first.
  function gifTopicsFor(now) {
    const hour = (now || new Date()).getHours();
    const first = hour >= 4 && hour < 18 ? 'gm' : 'gn';
    return [first, ...GIF_TOPICS.filter((t) => t !== first)];
  }
  const GIF_FORMATS = { gif: 'image/gif', webp: 'image/webp' };

  // safe=1 is the API's default, spelled out: adult GIFs stay out of a picker anyone
  // can open.
  function gifSearchUrl(query, offset) {
    const params = new URLSearchParams({
      q: String(query || '').trim().slice(0, GIF_QUERY_MAX),
      limit: String(GIF_PAGE_SIZE),
      offset: String(offset || 0),
      safe: '1',
    });
    return GIF_API + '/search?' + params;
  }
  function gifSuggestUrl(query) {
    const params = new URLSearchParams({
      q: String(query || '').trim().slice(0, GIF_QUERY_MAX),
      limit: String(GIF_SUGGEST_LIMIT),
      safe: '1',
    });
    return GIF_API + '/suggest?' + params;
  }

  const isHttps = (u) => typeof u === 'string' && /^https:\/\/\S+$/.test(u);

  // One result, or null when it cannot be shown and posted as it is. The URL goes into a
  // published note, so it has to be an https link in one of the two formats the index
  // serves. The grid shows the w240 preview, the size the API documents for column
  // grids, animated when it can be and its first frame when the GIF is too big to animate.
  function gifFromItem(item) {
    if (!item || typeof item !== 'object') return null;
    if (!isHttps(item.url) || !GIF_FORMATS[item.format]) return null;
    const pv = item.previews && (item.previews.w240 || item.previews.medium);
    const preview = pv && [pv.animated, pv.still].find(isHttps);
    const width = Number(item.width);
    const height = Number(item.height);
    if (!preview || !(width > 0) || !(height > 0)) return null;
    return {
      url: item.url,
      preview,
      width,
      height,
      title: typeof item.title === 'string' ? item.title.trim() : '',
    };
  }

  // A page of results, and the offset of the next page or null at the end. `count` is
  // the length of the query's whole list, so paging stops there or at the API's last
  // offset, whichever comes first.
  function parseGifPage(body) {
    const items = Array.isArray(body && body.items) ? body.items : [];
    const offset = Number(body && body.offset) || 0;
    const count = Number(body && body.count) || 0;
    const gifs = items.map(gifFromItem).filter(Boolean);
    const next = offset + items.length;
    return { gifs, next: items.length && next < count && next <= GIF_LAST_OFFSET ? next : null };
  }

  function parseGifSuggestions(body) {
    const terms = Array.isArray(body && body.terms) ? body.terms : [];
    const out = [];
    for (const entry of terms) {
      const term = entry && typeof entry.term === 'string' ? entry.term.trim() : '';
      if (term && !out.includes(term)) out.push(term);
    }
    return out.slice(0, GIF_SUGGEST_LIMIT);
  }

  // What the picker says when a request fails. 401 and 403 are the API refusing the key,
  // which nobody at the keyboard can fix, so it says so rather than suggesting a retry.
  function gifErrorMessage(status) {
    if (status === 401 || status === 403) return t('GIF search isn’t available right now.');
    if (status === 429) return t('Too many searches. Try again in a minute.');
    return t('Couldn’t load GIFs. Check your connection and try again.');
  }

  // No cookies and no referrer: the query is all nostr.build needs to answer it.
  async function gifRequest(url, signal) {
    let res;
    try {
      const headers = { Accept: 'application/json' };
      if (GIF_API_KEY) headers.Authorization = 'Bearer ' + GIF_API_KEY;
      res = await fetch(url, {
        headers,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal,
      });
      if (!res.ok) throw new Error(gifErrorMessage(res.status));
      return await res.json();
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new Error(res && !res.ok ? gifErrorMessage(res.status) : gifErrorMessage(0));
    }
  }

  // THE GIF PICKER, built here so both composers have one, the way the poll editor is.
  //
  // It opens under the toolbar rather than over the composer: the panel's composer is
  // already a sheet, and a sheet over a sheet would hide the note the GIF is for. Search
  // on top, chips under it (topics while the field is empty, suggestions while typing),
  // then two columns of previews that load more as they scroll. Tapping one attaches it
  // and closes the picker.
  //
  //   onPick(gif)  attach { url, width, height, title }; the picker closes itself after
  //
  // Returns the button for the toolbar, the picker to mount below it, and open/close.
  function buildGifPicker(d) {
    // WITHOUT A KEY THERE IS NO BUTTON. The API refuses every request then, so a GIF
    // button would open a picker that can only say search is unavailable: a control that
    // does nothing, shown to everyone. The callers that show and hide it with the poll
    // and the preview check this too, so nothing brings it back.
    const available = !!GIF_API_KEY;
    const addBtn = h('button', { className: 'mini compose-add' + (available ? '' : ' hidden'), type: 'button' });
    addBtn.append(icon('gif'), h('span', { textContent: t('GIF') }));
    addBtn.setAttribute('aria-expanded', 'false');

    const wrap = h('div', { className: 'gif-picker hidden' });
    const link = h('a', {
      href: 'https://nostr.build',
      target: '_blank',
      rel: 'noopener noreferrer',
      textContent: 'nostr.build',
    });
    const credit = h('span', { className: 'gif-credit' }, I18N.fill(t('GIFs from {{source}}'), { source: link }));
    const closeBtn = h('button', { className: 'gif-x', type: 'button', title: t('Close GIF search') });
    closeBtn.setAttribute('aria-label', t('Close GIF search'));
    closeBtn.append(icon('x'));
    const input = h('input', {
      className: 'gif-search',
      type: 'search',
      placeholder: t('Search GIFs'),
      maxLength: GIF_QUERY_MAX,
      autocomplete: 'off',
      spellcheck: false,
    });
    input.setAttribute('aria-label', t('Search GIFs'));
    const chips = h('div', { className: 'gif-chips' });
    // Columns filled shortest first, so GIFs of every shape pack without cropping. CSS
    // columns would do the packing, but reflow every earlier GIF on each new page.
    //
    // AS MANY AS THE WIDTH TAKES, about 170px each, two to five: two in the panel, more
    // in the expanded composer, where two columns made every GIF some 340px wide.
    const grid = h('div', { className: 'gif-grid' });
    let cols = [];
    const status = h('p', { className: 'hint gif-status hidden' });
    wrap.append(h('div', { className: 'gif-head' }, [credit, closeBtn]), input, chips, grid, status);

    let query = '';
    let next = null;
    let loading = false;
    let pageCtrl = null;
    let suggestCtrl = null;
    let typingTimer = null;
    let heights = [];
    let placed = [];
    const seen = new Set();
    const GIF_COL_WIDTH = 170;
    const columnsFor = () => Math.max(2, Math.min(5, Math.round((grid.clientWidth || wrap.clientWidth || 0) / GIF_COL_WIDTH) || 2));
    // Rebuild the columns and lay out what is already showing again, in its order.
    function layout(n) {
      const items = placed;
      cols = Array.from({ length: n }, () => h('div', { className: 'gif-col' }));
      grid.replaceChildren(...cols);
      heights = cols.map(() => 0);
      placed = [];
      seen.clear();
      place(items);
    }

    function setStatus(text, isError) {
      status.textContent = text || '';
      status.classList.toggle('hidden', !text);
      status.classList.toggle('error', !!isError);
    }

    function paintChips(terms) {
      chips.innerHTML = '';
      for (const term of terms) {
        const chip = h('button', { className: 'gif-chip', type: 'button', textContent: term });
        chip.addEventListener('click', () => {
          input.value = term;
          paintChips(gifTopicsFor());
          search(term);
        });
        chips.append(chip);
      }
      chips.classList.toggle('hidden', !terms.length);
    }

    function cellFor(gif) {
      const name = gif.title || t('GIF');
      const cell = h('button', { className: 'gif-cell', type: 'button', title: name });
      cell.setAttribute('aria-label', name);
      const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
      img.referrerPolicy = 'no-referrer';
      // Sized before it loads, so the columns hold their shape and the scroll position
      // does not jump as previews arrive.
      img.style.aspectRatio = gif.width + ' / ' + gif.height;
      img.src = gif.preview;
      cell.append(img);
      cell.addEventListener('click', () => {
        d.onPick(gif);
        close();
      });
      return cell;
    }

    function place(gifs) {
      for (const gif of gifs) {
        if (seen.has(gif.url)) continue;
        seen.add(gif.url);
        placed.push(gif);
        const col = heights.indexOf(Math.min(...heights));
        heights[col] += gif.height / gif.width;
        cols[col].append(cellFor(gif));
      }
    }

    async function load(offset) {
      if (pageCtrl) pageCtrl.abort();
      const mine = new AbortController();
      pageCtrl = mine;
      loading = true;
      if (!offset) setStatus(t('Loading GIFs…'));
      try {
        const page = parseGifPage(await gifRequest(gifSearchUrl(query, offset), mine.signal));
        if (pageCtrl !== mine) return;
        place(page.gifs);
        next = page.next;
        setStatus(!offset && !page.gifs.length ? t('No GIFs found for “{{query}}”.', { query }) : '');
      } catch (e) {
        if (pageCtrl !== mine || (e && e.name === 'AbortError')) return;
        setStatus(e.message, true);
      } finally {
        if (pageCtrl === mine) {
          pageCtrl = null;
          loading = false;
        }
      }
    }

    // NOTHING LOADS UNTIL SOMETHING IS ASKED FOR. An empty query clears the grid and
    // says what to do, rather than searching for a default nobody chose.
    function search(q) {
      clearTimeout(typingTimer);
      query = String(q || '').trim();
      if (pageCtrl) { pageCtrl.abort(); pageCtrl = null; loading = false; }
      placed = [];
      layout(columnsFor());
      next = null;
      grid.scrollTop = 0;
      if (!query) { setStatus(t('Search or pick a topic.')); return; }
      load(0);
    }

    async function suggest(q) {
      if (suggestCtrl) suggestCtrl.abort();
      const mine = new AbortController();
      suggestCtrl = mine;
      try {
        const terms = parseGifSuggestions(await gifRequest(gifSuggestUrl(q), mine.signal));
        if (suggestCtrl === mine && input.value.trim() === q) paintChips(terms);
      } catch (_) {
        // Suggestions are a nicety: a failure leaves the chips as they were.
      }
    }

    input.addEventListener('input', () => {
      clearTimeout(typingTimer);
      const q = input.value.trim();
      if (!q) paintChips(gifTopicsFor());
      // Searched once typing pauses, not per keystroke: each search is a request to
      // nostr.build and each one replaces the grid.
      typingTimer = setTimeout(() => {
        search(q);
        if (q) suggest(q);
      }, 350);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        search(input.value);
      } else if (e.key === 'Escape') {
        // The picker, not the sheet around it: Escape in the panel closes the composer.
        e.preventDefault();
        e.stopPropagation();
        close();
        addBtn.focus();
      }
    });
    grid.addEventListener('scroll', () => {
      if (loading || next == null) return;
      if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 160) load(next);
    });

    function open() {
      wrap.classList.remove('hidden');
      // Measured once it is showing: a hidden picker has no width to divide.
      if (cols.length !== columnsFor()) layout(columnsFor());
      addBtn.classList.add('compose-add-on');
      addBtn.setAttribute('aria-expanded', 'true');
      if (!seen.size && !pageCtrl) {
        paintChips(gifTopicsFor());
        search(input.value);
      }
      input.focus();
    }
    function close() {
      clearTimeout(typingTimer);
      if (pageCtrl) { pageCtrl.abort(); pageCtrl = null; loading = false; }
      if (suggestCtrl) { suggestCtrl.abort(); suggestCtrl = null; }
      // A search cut off by closing is run again on the next open.
      if (!seen.size) setStatus('');
      wrap.classList.add('hidden');
      addBtn.classList.remove('compose-add-on');
      addBtn.setAttribute('aria-expanded', 'false');
    }
    const isOpen = () => !wrap.classList.contains('hidden');
    // A window resized while the picker is open gets the column count for its new width.
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => {
        if (isOpen() && cols.length !== columnsFor()) layout(columnsFor());
      }).observe(grid);
    }

    addBtn.addEventListener('click', () => (isOpen() ? close() : open()));
    closeBtn.addEventListener('click', () => {
      close();
      addBtn.focus();
    });

    return { addBtn, wrap, open, close, isOpen, available };
  }

  // A PHOTO IN A QUOTED NOTE OPENS AT FULL SIZE.
  //
  // Not inline. The quote block is capped so the editor stays on screen, and growing the
  // image inside it only trades a 108px window for a 320px one: still a window, still
  // not the picture. In a 360px column "full size" can only mean taking the viewport,
  // so it takes the viewport.
  //
  // Self-contained rather than routed through the panel's openModal, because this runs
  // in two documents and the expanded page has no such thing. It owns its overlay, its
  // key handler and its teardown.
  function openMediaLightbox(src, isVideo) {
    const back = h('div', { className: 'media-lightbox' });
    const el = isVideo
      ? h('video', { className: 'media-lightbox-item', controls: true, autoplay: false })
      : h('img', { className: 'media-lightbox-item', alt: '' });
    el.referrerPolicy = 'no-referrer';
    el.src = src;

    const close = h('button', { className: 'media-lightbox-x', type: 'button', title: t('Close') });
    close.append(icon('x'));

    let gone = false;
    const shut = () => {
      if (gone) return;
      gone = true;
      document.removeEventListener('keydown', onKey, true);
      back.remove();
    };
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); shut(); } }
    // Capture, so Escape closes THIS and not whatever sheet is open behind it: the panel
    // has its own Escape handler and the quote is usually inside one of its modals.
    document.addEventListener('keydown', onKey, true);

    close.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); shut(); });
    // The backdrop closes, the media does not. Clicking a video means using its controls.
    back.addEventListener('click', (e) => { if (e.target === back) shut(); });

    back.append(el, close);
    document.body.append(back);
    return shut;
  }

  // The corner control on each piece of media in a quoted note.
  //
  // A BUTTON, NOT A CLICK ON THE MEDIA. A <video> carries its own controls and a click
  // there means play; overloading that would make one gesture mean two things depending
  // on where in the frame it landed. Same corner control the code block uses, so the
  // quote has one idiom rather than two.
  function makeMediaExpandable(block, body) {
    body.querySelectorAll('.note-media').forEach((el) => {
      if (el.parentNode && el.parentNode.classList.contains('note-media-wrap')) return;
      const wrap = h('div', { className: 'note-media-wrap' });
      el.replaceWith(wrap);
      wrap.append(el);

      const btn = h('button', { className: 'note-media-zoom', type: 'button', title: t('Show the full image') });
      btn.append(icon('arrow-up-right'));
      btn.addEventListener('click', (e) => {
        // The quote sits inside a sheet that closes on an outside click, and can sit
        // inside a link to the note.
        e.preventDefault();
        e.stopPropagation();
        openMediaLightbox(el.getAttribute('src') || el.src, el.tagName === 'VIDEO');
      });
      wrap.append(btn);
    });
  }

  // Text with code in it, and nothing else rendered. The notification list wants the
  // code boxes without the images, videos and quote cards renderNoteText also draws: a
  // row there is a snippet beside two dozen others, not a note.
  function renderTextWithCode(container, text) {
    const RE = /(```[\s\S]*?```)|(`[^`\n]+`)/g;
    let last = 0;
    let m;
    RE.lastIndex = 0;
    // The newlines an author puts around a fence are padding on top of the block's own
    // margin, and the containers this draws into are pre-wrap, so each one renders as a
    // full empty line. Trimmed either side of a BLOCK only; inline code stays in its
    // sentence and must not lose the spaces around it. Same rule as pushBlock.
    let skipLead = false;
    const pushText = (str) => {
      let t = str;
      if (skipLead) { t = t.replace(/^\s+/, ''); skipLead = false; }
      if (t) container.append(document.createTextNode(t));
    };
    while ((m = RE.exec(text)) !== null) {
      if (m.index > last) pushText(text.slice(last, m.index));
      if (m[1]) {
        const tail = container.lastChild;
        if (tail && tail.nodeType === Node.TEXT_NODE) {
          tail.textContent = tail.textContent.replace(/\s+$/, '');
        }
        container.append(codeBlockEl(m[1]));
        skipLead = true;
      } else {
        container.append(codeInlineEl(m[2]));
      }
      last = RE.lastIndex;
    }
    if (last < text.length) pushText(text.slice(last));
  }

  function codeInlineEl(raw) {
    return h('code', { className: 'note-code-inline', textContent: String(raw).slice(1, -1) });
  }

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
            card.textContent = t('Loading preview…');
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
          const card = h('div', { className: 'note-embed loading', textContent: t('Loading nostr event…') });
          embeds.push({ el: card, ref: embedRef(d) });
          pushBlock(card);
        } else {
          flushText(bech);
        }
      } else if (m[3]) {
        // No cap in the preview: this pane is what the note will look like, so a fence
        // shows whole or the preview is not one.
        pushBlock(codeBlockEl(m[3]));
      } else if (m[4]) {
        container.append(codeInlineEl(m[4]));
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
        el.textContent = t('nostr event (not found)');
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
    const stopped = new Error(t('Mining canceled'));
    stopped.canceled = true;
    powWorkerSettleAll(stopped);
  }

  function minePow(event, bits, onProgress) {
    if (typeof Worker !== 'function') {
      return Promise.reject(new Error(t('This browser cannot mine in the background')));
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
        else p.reject(new Error(error || t('Mining failed')));
      };
      powWorker.onerror = () => {
        // A packaging miss or a load failure. Settle everything waiting rather than
        // leaving a promise that never resolves and a composer stuck on "Mining".
        powWorker = null;
        powWorkerSettleAll(new Error(t('Mining failed to start')));
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
    const cancel = h('button', { className: 'ghost', textContent: t('Cancel') });

    async function fire() {
      stop();
      now.disabled = true;
      now.textContent = t('Posting…');
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
    if (s < 45) return t('just now');
    // Intl's narrow style is word for word what this wrote by hand in English ("5m ago"),
    // and every other language gets its own. numeric: 'always', or one day reads
    // "yesterday" where this has always said "1d ago".
    const rel = (v, unit) => I18N.fmtRelative(-v, unit, { numeric: 'always' });
    if (s < 3600) return rel(Math.round(s / 60), 'minute');
    if (s < 86400) return rel(Math.round(s / 3600), 'hour');
    if (s < 604800) return rel(Math.round(s / 86400), 'day');
    return I18N.fmtDate(ts);
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
        el.textContent = t('quoted note'); // not found — today's plain link-out
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
      if (hasInvoice) kids.push(h('div', { className: 'quote-inline-meta', textContent: t('⚡ invoice') }));
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

  // ---- the same note, twice ----
  //
  // A note can go out without the person who wrote it knowing: a minimized mine posts
  // when it finds, and the toast that says so is easy to miss. If the same words are
  // still in a composer afterwards, Post would publish them again. So each composer
  // remembers a fingerprint of what this account posted in the last fifteen minutes,
  // and an identical note asks once before it goes.
  //
  // The fingerprint is the account, the text, the attachments, what it answers and a
  // poll's options, hashed: the store holds no note text. The pages keep the store
  // (session storage, so it forgets with the browser), since settings and storage belong
  // to the page that reads them; this module only says what a fingerprint is and when one
  // has gone stale.
  const RECENT_POSTS_KEY = 'sidecar_recent_posts';
  const RECENT_POST_MS = 15 * 60 * 1000;
  async function postFingerprint(pubkey, draft, replyTo) {
    const d = draft || {};
    const poll = d.poll ? (d.poll.options || []).map((o) => String(o || '').trim()) : null;
    const shape = JSON.stringify([
      pubkey || '', String(d.text || '').trim(), (d.media || []).map((m) => m && m.url),
      (replyTo && replyTo.id) || '', poll,
    ]);
    return sha256Hex(new TextEncoder().encode(shape));
  }
  // The stored map with anything older than the window dropped.
  function freshRecentPosts(all, now) {
    const out = {};
    for (const [k, at] of Object.entries(all || {})) if (now - at < RECENT_POST_MS) out[k] = at;
    return out;
  }

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
    LIGHT_THEMES, COMPOSE_DARK_BAR_THEMES, PANEL_DARK_BAR_THEMES, logoSrcFor, avatarPhSrc,
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
    replyTags, WEB_COMMENT_KIND, mentionPTags, quoteTags, noteBodyTags, linkBareRefs,
    parseSilentTags, parseEventRef, fetchEventRef, devReplyTags,
    renderTextWithCode, makeMediaExpandable, openMediaLightbox,
    POLL_KIND, POLL_SINGLE, POLL_MULTIPLE, POLL_DEFAULT_SECS, POLL_DURATIONS,
    pollOptionId, newPollDraft, pollEndsAtFor, pollDraftOptions, pollDraftIsPostable, buildPollTags,
    buildPollEditor,
    GIF_TOPICS, gifTopicsFor, gifSearchUrl, gifSuggestUrl, gifFromItem, parseGifPage, parseGifSuggestions, buildGifPicker,
    loneMediaUrl, removeUrlFromEditor, urlOnBoundary,
    postFingerprint, freshRecentPosts, RECENT_POSTS_KEY,
    draftHasContent, otherDraftEntries, buildSavedDraftList,
  };
})();
