// Sidecar side panel — account manager / lock UI for the NIP-07 signer.
// All key material lives in the service worker; this panel only sends control messages.

(function () {
  'use strict';

  const NT = window.NostrTools;

  // Default "max per zap" (sats) for the auto-approve-zaps setting, used wherever
  // a stored value is missing or invalid.
  const AUTOZAP_DEFAULT_MAX = 200;
  const AUTOZAP_DAILY_MULT = 100; // default daily cap = 100× the per-zap cap
  // Ceilings on the no-confirmation path — mirrored from background.js, which is
  // where they are actually enforced. Reflected here only so a clamped entry snaps
  // back visibly instead of appearing to have been accepted as typed.
  const AUTOZAP_ABS_MAX = 1000;
  const AUTOZAP_ABS_DAILY_MAX = 100000;

  // ---- messaging ----
  // THE TRANSPORT HAS TO BE ABLE TO FAIL. It could not (#224).
  //
  // The old body was `new Promise((resolve) => chrome.runtime.sendMessage(message,
  // resolve))` — no reject anywhere in it, so the promise had exactly one way to finish:
  // Chrome invoking the callback. Under MV3 the service worker is killed at ~30s idle,
  // and a worker torn down MID-REQUEST never invokes it. The promise then stayed pending
  // forever and every `await call(...)` behind it hung silently — no timeout, no error,
  // no log. That is the wallet wedging: blank tab, panel reload no help, fixed only by
  // switching accounts, which re-enters through a different path after the worker wakes.
  //
  // A clean send failure was barely better: the callback got undefined, lastError went
  // unread (Chrome logs "Unchecked runtime.lastError" that nobody sees), and call() threw
  // a generic 'Request failed' naming no step.
  //
  // 30 SECONDS, and generous on purpose. The bug is "never fires", so ANY finite timeout
  // catches it — there is nothing to gain by being aggressive and a real regression to
  // risk. Nothing the panel sends runs long: the slowest are PBKDF2 at 600k rounds
  // (seconds, and only on unlock/init/PIN change) and SIDECAR_FETCH_OG, which carries its
  // own 8s abort in the worker. Payments do NOT come through here — the panel holds its
  // own NWC client and calls payInvoice directly — so this cannot cut one short.
  const BG_TIMEOUT_MS = 30000;
  function bg(message, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      };
      const timer = setTimeout(
        () => finish(reject, new Error('Sidecar’s background worker did not respond.')),
        timeoutMs || BG_TIMEOUT_MS
      );
      try {
        chrome.runtime.sendMessage(message, (resp) => {
          // Read INSIDE the callback and before anything else: this is what marks the
          // error as handled, and it is only readable here.
          const err = chrome.runtime.lastError;
          if (err) return finish(reject, new Error(err.message || 'Sidecar’s background worker is unavailable.'));
          finish(resolve, resp);
        });
      } catch (e) {
        // sendMessage throws synchronously if the extension context is gone.
        finish(reject, e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
  async function call(message) {
    const resp = await bg(message);
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Request failed');
    return resp.result;
  }

  const $ = (id) => document.getElementById(id);

  // ---- period quotes: what stands in where there is nothing ------------------------
  //
  // Empty states and the ends of lists, rather than a blank panel or a bare "nothing
  // here". All early twentieth century, to sit with the periods the themes draw on.
  //
  // CURATED, NOT VENDORED, and that is a licensing decision more than a taste one. The
  // open quote corpora are not usable here: JamesFT/Database-Quotes-JSON and
  // Quotes-500K carry no license at all, and the two MIT ones license their CODE —
  // wickedQuotes parses Wikiquote, whose text is CC BY-SA, and quotable documents
  // nothing about where its quotations came from. The WORKS below are a different
  // matter: all published 1930 or earlier, which is the US public-domain line as of
  // 2026 (95 years), and long out of copyright. Short
  // attributed quotation would be fair use regardless. Twenty lines we can vouch for
  // beat a megabyte we cannot.
  //
  // Kept short on purpose: this is a 360px panel that can be dragged narrower, and a
  // quote running to six lines stops being an ornament and becomes a wall.
  //
  // THIS LIST GROWS. Daniel's standing practice (2026-08-30): add one or two every
  // release, so someone who has had Sidecar a year keeps meeting lines they have not seen
  // before. It is a small, pleasant thing to do at release time rather than a backlog
  // item. The bar for a new entry is the bar the tests already enforce — published 1930
  // or earlier, an attribution ending in a year, under 140 characters — plus one thing
  // they cannot check: that the wording is actually right. Verify against a real edition
  // rather than a quote site, and prefer a writer not already on the list.
  const PERIOD_QUOTES = [
    { text: 'A book must be the axe for the frozen sea within us.', who: 'Franz Kafka, 1904' },
    { text: 'Be patient toward all that is unsolved in your heart.', who: 'Rainer Maria Rilke, 1903' },
    { text: 'Only connect.', who: 'E. M. Forster, 1910' },
    { text: 'Whereof one cannot speak, thereof one must be silent.', who: 'Ludwig Wittgenstein, 1921' },
    { text: 'I have measured out my life with coffee spoons.', who: 'T. S. Eliot, 1915' },
    { text: 'The real voyage of discovery consists not in seeking new landscapes, but in having new eyes.', who: 'Marcel Proust, 1923' },
    { text: 'A rose is a rose is a rose.', who: 'Gertrude Stein, 1922' },
    { text: 'The best way out is always through.', who: 'Robert Frost, 1914' },
    { text: 'Your daily life is your temple and your religion.', who: 'Kahlil Gibran, 1923' },
    { text: 'A woman must have money and a room of her own if she is to write fiction.', who: 'Virginia Woolf, 1929' },
    { text: 'The best lack all conviction, while the worst are full of passionate intensity.', who: 'W. B. Yeats, 1920' },
    { text: 'Welcome, O life! I go to encounter for the millionth time the reality of experience.', who: 'James Joyce, 1916' },
    { text: 'If you shut the door to all errors, truth will be shut out.', who: 'Rabindranath Tagore, 1916' },
    { text: 'Angels can fly because they can take themselves lightly.', who: 'G. K. Chesterton, 1908' },
    { text: 'There are two ways of spreading light: to be the candle or the mirror that reflects it.', who: 'Edith Wharton, 1902' },
    { text: 'Let be be finale of seem.', who: 'Wallace Stevens, 1923' },
    { text: 'All books are either dreams or swords.', who: 'Amy Lowell, 1914' },
    { text: 'Hold fast to dreams, for if dreams die, life is a broken-winged bird that cannot fly.', who: 'Langston Hughes, 1926' },
    { text: 'Rivers know this: there is no hurry. We shall get there some day.', who: 'A. A. Milne, 1928' },
    { text: 'Risk anything! Care no more for the opinions of others.', who: 'Katherine Mansfield, 1927' },
    {
      text: 'There are only two or three human stories, and they go on repeating themselves as fiercely as if they had never happened before.',
      who: 'Willa Cather, 1913',
    },
  ];

  // NEVER THE SAME ONE TWICE RUNNING. Independent draws from a short list collide often
  // — at this length that is a one-in-twenty-one chance every time — and two panels showing the
  // same line at once reads as a bug rather than as a coincidence, which is exactly how
  // it was reported. Remembering the last index costs nothing and removes the case
  // entirely for adjacent views.
  let _lastQuote = -1;
  function pickQuote() {
    if (PERIOD_QUOTES.length < 2) return PERIOD_QUOTES[0];
    let i = _lastQuote;
    while (i === _lastQuote) i = Math.floor(Math.random() * PERIOD_QUOTES.length);
    _lastQuote = i;
    return PERIOD_QUOTES[i];
  }

  // The full stand-in: a quote, its attribution, and one line saying how the space gets
  // filled. `hint` is what the user can DO — the quote is the furniture, not the answer.
  //
  // `q` lets a caller hand in a quote instead of drawing one, which is how a panel keeps
  // the SAME line as its content changes underneath it. Reported: the bell opened empty,
  // a notification landed a moment later, and the quote was swapped for a different one
  // at the bottom of the list before it had been read. A quote you cannot finish reading
  // is worse than no quote.
  function emptyQuote(hint, q) {
    q = q || pickQuote();
    return h('div', { className: 'bm-empty' }, [
      h('p', { className: 'bm-quote', textContent: '\u201C' + q.text + '\u201D' }),
      h('p', { className: 'bm-quote-who', textContent: q.who }),
      hint ? h('p', { className: 'hint', textContent: hint }) : h('span'),
    ]);
  }

  // The compact one, for the bottom of a list that has no more to give. Smaller and
  // quieter than the empty state: here it is a full stop, not the whole page.
  // Takes the same optional quote, so a list that began empty ends on the line it started
  // with rather than on a new one.
  function endQuote(q) {
    q = q || pickQuote();
    return h('div', { className: 'bm-empty bm-end' }, [
      h('p', { className: 'bm-quote', textContent: '\u201C' + q.text + '\u201D' }),
      h('p', { className: 'bm-quote-who', textContent: q.who }),
    ]);
  }


  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');

  // ---- flat (line) icons — inherit currentColor ----
  const ICONS = {
    plus: '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>',
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
    'badge-check': '<path d="M18.9 14.9Q22 12 18.9 9.1Q19.1 4.9 14.9 5.1Q12 2 9.1 5.1Q4.9 4.9 5.1 9.1Q2 12 5.1 14.9Q4.9 19.1 9.1 18.9Q12 22 14.9 18.9Q19.1 19.1 18.9 14.9Z"></path><polyline points="9 12 11 14 15.5 9"></polyline>',
    'user-check': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><polyline points="17 11 19 13 23 9"></polyline>',
    'user-x': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="18" y1="8" x2="23" y2="13"></line><line x1="23" y1="8" x2="18" y2="13"></line>',
    'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline>',
    mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline>',
    'message-circle': '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>',
    award: '<circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>',
    'bar-chart': '<line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="16"></line>',
    globe: '<circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>',
  };
  function icon(name) {
    const wrap = document.createElement('span');
    wrap.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[name] || '') +
      '</svg>';
    return wrap.firstElementChild;
  }

  // Chrome only adds `update_url` to the manifest object for extensions installed
  // from the Web Store (or with a configured update URL) — never for an unpacked
  // load. That makes it a reliable, permission-free way to tell a local dev build
  // apart from the shipped one, so dev-only UI never leaks into production.
  // Firefox/AMO never injects update_url, so there the same absence proves
  // nothing — ask management.getSelf() (async; getSelf is exempt from the
  // "management" permission) and fail closed until it answers: only a temporary
  // about:debugging load counts as dev. initDevBadge awaits devBuildReady so the
  // one-shot panel-boot render can't race the answer.
  let devBuild = (() => {
    if (typeof browser !== 'undefined') return false; // Firefox: resolved async below
    try { return !chrome.runtime.getManifest().update_url; } catch (_) { return false; }
  })();
  const devBuildReady = (() => {
    if (typeof browser === 'undefined') return Promise.resolve();
    try {
      return browser.management.getSelf()
        .then((info) => { devBuild = info.installType === 'development'; })
        .catch(() => {});
    } catch (_) { return Promise.resolve(); }
  })();
  function isDevBuild() { return devBuild; }

  // Filled lightning bolt (from wordswithzaps' bolt-yellow.svg). Inherits color
  // via currentColor; sized inline with text by the .bolt-ico class.
  function boltIcon(cls) {
    const wrap = document.createElement('span');
    wrap.innerHTML =
      '<svg class="bolt-ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 55 94" fill="currentColor">' +
      '<path d="M35.563 0V40.406H54.969L21.016 93.75V51.719H0L35.563 0Z"></path></svg>';
    return wrap.firstElementChild;
  }

  // ---- PIN / passphrase strength + confirmation UI ----
  // The keystore is encrypted at rest under a key derived from this secret, so its
  // length is the practical floor on that protection. Require a non-trivial minimum
  // and give live feedback: a green check appears in the first box once it's long
  // enough, and a second green check (or a red x on mismatch) as the confirmation
  // is typed. The proceed button stays disabled until both are satisfied.
  const MIN_PIN_LEN = 8;
  const MAX_PIN_LEN = 32;

  function pinMeetsLength(v) {
    return v.length >= MIN_PIN_LEN && v.length <= MAX_PIN_LEN;
  }

  function setPinIndicator(ind, state) {
    ind.classList.remove('ok', 'bad');
    ind.textContent = '';
    if (state === 'ok') { ind.classList.add('ok'); ind.appendChild(icon('check')); }
    else if (state === 'bad') { ind.classList.add('bad'); ind.appendChild(icon('x')); }
  }

  // Path to the full Sidecar logo for a given theme. Art Deco uses a variant
  // whose wordmark is dark purple (#5a4a8a) for legibility on the light
  // eggshell background; the cocktail-glass mark is identical in both files
  // (official colors), so only the wordmark changes.
  // Sibling copies live in content.js (LIGHT_CARD_THEMES, the page-side pay card) and
  // prompt.js (the approval window's wordmark). Three documents, no module system between
  // them; a new light theme has to be registered in all three.
  const LIGHT_THEMES = new Set(['industria', 'aegean', 'bauhaus', 'populuxe', 'par-avion', 'werkstatte']);
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

  // Swap every full-logo <img> in the panel to the variant for the active theme.
  function swapLogos(themeName) {
    const src = logoSrcFor(themeName);
    document.querySelectorAll('.brand-logo, .brand-logo-sm, .brand-foot img, .about-logo')
      .forEach(img => { img.src = src; });
  }

  // Apply theme by setting data-theme attribute on HTML element
  // Themes that have been renamed. The stored value in sidecar_settings.theme is
  // whatever was current when the user last chose, and it is never rewritten — so a
  // vault that picked Art Deco any time in the last year still holds 'art-deco'. Mapping
  // on READ is deliberate: rewriting settings to migrate would be a write on every
  // unlock for a cosmetic rename, and a failed write would strand the user on the
  // fallback. Aliased here, in prompt.js and in content.js, because those three
  // documents each read the setting for themselves.
  const THEME_ALIASES = { 'art-deco': 'industria' };

  function applyTheme(themeName) {
    themeName = THEME_ALIASES[themeName] || themeName;
    // Dark themes first, then light, matching the picker's order in
    // sidepanel.html (which is the canonical list).
    const validThemes = ['speakeasy', 'film-noir', 'brownstone', 'nixie', 'cast-iron', 'metropolis', 'industria', 'aegean', 'bauhaus', 'populuxe', 'par-avion', 'werkstatte'];
    if (!validThemes.includes(themeName)) themeName = 'speakeasy'; // default

    document.documentElement.setAttribute('data-theme', themeName);
    swapLogos(themeName);
    // Placeholders already on screen keep whatever cut they were built with, so they
    // are re-pointed here — the attribute above has to be set first, since avatarPhSrc
    // reads it.
    document.querySelectorAll('.avatar-ph img').forEach((img) => { img.src = avatarPhSrc(); });

    // Update active state in theme selector
    document.querySelectorAll('.theme-card').forEach(card => {
      card.classList.toggle('active', card.dataset.theme === themeName);
    });
    // Show the half of the gallery the active theme is in. Called on load too, so opening
    // Settings lands on your own theme's mode rather than always on Dark.
    const active = document.querySelector('.theme-card.active');
    if (active) showThemeMode(active.dataset.mode || 'dark');

    return themeName;
  }

  // Wrap a password <input> so a check/x indicator can sit at its right edge.
  // Works whether the input is already in the DOM or still detached (in which case
  // the caller appends the returned wrapper). Returns the indicator element.
  function addPinIndicator(input) {
    const wrap = document.createElement('div');
    wrap.className = 'pin-field';
    if (input.parentNode) input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const ind = document.createElement('span');
    ind.className = 'pin-indicator';
    ind.setAttribute('aria-hidden', 'true');
    wrap.appendChild(ind);
    return ind;
  }

  // Live-validate a create/confirm PIN pair and gate a submit button. Call after
  // both inputs are in the DOM. Returns validate(), which also reports validity.
  // The green check on the confirm box shows the instant it matches; the red x is
  // held back until the user pauses typing (MISMATCH_DELAY), so it doesn't flash
  // red while a matching value is still being entered.
  const PIN_MISMATCH_DELAY = 700; // ms of idle before flagging a mismatch
  function attachPinValidation(pinInput, confirmInput, submitBtn) {
    const pinInd = addPinIndicator(pinInput);
    const confInd = confirmInput ? addPinIndicator(confirmInput) : null;
    let mismatchTimer = null;
    const clearMismatchTimer = () => { if (mismatchTimer) { clearTimeout(mismatchTimer); mismatchTimer = null; } };
    function validate() {
      const pinOk = pinMeetsLength(pinInput.value);
      setPinIndicator(pinInd, pinOk ? 'ok' : null);
      let ready = pinOk;
      if (confInd) {
        const cv = confirmInput.value;
        clearMismatchTimer();
        if (!cv) {
          setPinIndicator(confInd, null);            // nothing typed yet
        } else if (cv === pinInput.value) {
          setPinIndicator(confInd, pinOk ? 'ok' : null); // contents match; green once the PIN is long enough
        } else {
          // Genuine mismatch — defer the red so it doesn't appear mid-keystroke.
          setPinIndicator(confInd, null);
          mismatchTimer = setTimeout(() => {
            if (confirmInput.value && confirmInput.value !== pinInput.value) setPinIndicator(confInd, 'bad');
          }, PIN_MISMATCH_DELAY);
        }
        ready = pinOk && cv.length > 0 && cv === pinInput.value;
      }
      if (submitBtn) submitBtn.disabled = !ready;
      return ready;
    }
    pinInput.addEventListener('input', validate);
    if (confirmInput) confirmInput.addEventListener('input', validate);
    validate();
    return validate;
  }

  // ---- toast notifications ----
  // An identical message already on screen is REPLACED rather than stacked: tapping a
  // button twice should restart one confirmation, not pile up two saying the same
  // thing. Different messages still stack, so a payment result and a lock notice can
  // coexist. Each toast owns its dismissal timer so replacing one can cancel it —
  // otherwise the outgoing toast's timer would later remove its replacement.
  const _toastTimers = new WeakMap();
  function toast(message, type) {
    const host = document.getElementById('toasts');
    const cls = 'toast toast-' + (type === 'error' ? 'error' : 'success');
    // Same text AND same kind — an error and a success reading alike are still two
    // different outcomes and shouldn't silently collapse into one.
    for (const prev of host.querySelectorAll('.toast')) {
      if (prev.dataset.msg === message && prev.className.indexOf(cls) === 0) {
        const timers = _toastTimers.get(prev);
        if (timers) { clearTimeout(timers.hide); clearTimeout(timers.remove); }
        prev.remove();
      }
    }
    const t = document.createElement('div');
    t.className = cls;
    t.dataset.msg = message;
    t.appendChild(icon(type === 'error' ? 'alert' : 'check'));
    const span = document.createElement('span');
    span.textContent = message;
    t.appendChild(span);
    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    const dismiss = () => {
      t.classList.remove('show');
      const rm = setTimeout(() => t.remove(), 250);
      const cur = _toastTimers.get(t);
      if (cur) cur.remove = rm;
    };
    const hide = setTimeout(dismiss, 3200);
    _toastTimers.set(t, { hide, remove: null });
    // A tap dismisses immediately: 3.2s is a long time to wait out a toast that
    // is sitting on something you want, and there was no way out at all. Runs
    // the timer's own exit (fade, then remove) rather than yanking the node, so
    // the transition plays and the replacement logic's timers stay coherent.
    t.addEventListener('click', () => {
      const timers = _toastTimers.get(t);
      if (timers) { clearTimeout(timers.hide); clearTimeout(timers.remove); }
      dismiss();
    });
    return t;
  }

  // ---- lightning strike (zap sent) ----
  // Ported from the CodepenLightning component shared by wordswithzaps, jumble-spark,
  // and primal-web-spark — rewritten as plain DOM since Sidecar has no build step and
  // no React. A procedurally-generated bolt zigzags top-to-bottom with occasional
  // branches, over a brief full-panel flash, then removes itself.
  //
  // Honors prefers-reduced-motion: a full-panel flash is exactly what that setting is
  // for, so there it's skipped entirely rather than shortened.
  function lightningStrike() {
    try {
      if (!zapFlash) return; // Settings → Payment animation
      // Reduce motion means Sidecar's animations, all of them. The toggle used to scope
      // itself to balances and countdowns, which left the loudest thing in the app — a
      // bolt across the whole panel — still firing at someone who had just asked for
      // less movement. The separate switch above stays: wanting no bolt is not the same
      // as wanting no animation anywhere.
      if (reduceBalanceMotion) return; // Settings → Reduce motion
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const host = document.createElement('div');
      host.className = 'lightning-layer';
      const W = document.documentElement.clientWidth || 380;
      const H = document.documentElement.clientHeight || 600;

      // Start in the central 60% so the bolt reads as crossing the panel, not grazing
      // an edge. More segments than the reference (which ran on a wide desktop
      // viewport): the panel is tall and narrow, so a 5-segment bolt looks like a
      // near-vertical line rather than lightning.
      const startX = W * 0.2 + Math.random() * (W * 0.6);
      const segments = 8 + Math.floor(Math.random() * 4); // 8-11
      // Each joint steps from the PREVIOUS one rather than from startX — offsetting a
      // fixed origin can't wander, which is what made early versions look like a
      // slightly wobbly straight line.
      const step = Math.max(26, W * 0.16);
      let x = startX;
      let y = 0;
      let d = 'M' + x.toFixed(1) + ',0';
      const edge = W * 0.06;
      for (let i = 0; i < segments; i++) {
        // The final segment always lands past the bottom edge, so the bolt exits the
        // panel instead of stopping short of it.
        y += i === segments - 1 ? H - y : (H / segments) * (0.7 + Math.random() * 0.6);
        // Bias each step back toward the middle so a run of same-direction jitter
        // can't pin the bolt to one wall.
        const pull = (W / 2 - x) / W;
        x += (Math.random() - 0.5 + pull * 0.5) * step * 2;
        x = Math.max(edge, Math.min(W - edge, x));
        d += ' L' + x.toFixed(1) + ',' + y.toFixed(1);
        // ~35% of joints sprout a short branch; return to the joint so the main bolt
        // continues from where it left off.
        if (Math.random() > 0.65) {
          let bx = x + (Math.random() - 0.5) * step * 2.2;
          bx = Math.max(W * 0.03, Math.min(W * 0.97, bx));
          const by = y + 12 + Math.random() * 28;
          d += ' M' + x.toFixed(1) + ',' + y.toFixed(1) +
               ' L' + bx.toFixed(1) + ',' + by.toFixed(1) +
               ' M' + x.toFixed(1) + ',' + y.toFixed(1);
        }
      }

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'lightning-svg');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('preserveAspectRatio', 'none');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'lightning-bolt');
      path.setAttribute('d', d);
      // Gold rather than the reference's white/yellow — it's the panel's accent, and
      // it reads as a Lightning payment rather than a weather effect.
      path.setAttribute('stroke', Math.random() > 0.5 ? 'var(--gold)' : 'var(--amber)');
      path.setAttribute('stroke-width', (1.6 + Math.random() * 2).toFixed(1));
      path.setAttribute('fill', 'none');
      svg.appendChild(path);
      host.appendChild(svg);
      document.body.appendChild(host);
      requestAnimationFrame(() => host.classList.add('flash'));
      setTimeout(() => host.remove(), 900); // after the bolt's fade-out completes
    } catch (_) { /* decoration only — never let it break a payment */ }
  }

  // ---- nsec paste guard ----
  // A secret key should only ever land in the key-import field. Block a paste of
  // an nsec anywhere else in the panel (note composer, PIN, wallet send, profile
  // fields, …) so it can't be leaked into the wrong box by a slip of the cursor.
  const NSEC_RE = /nsec1[a-z0-9]{20,}/i;
  document.addEventListener(
    'paste',
    (e) => {
      let text = '';
      try {
        text = ((e.clipboardData || window.clipboardData) || {}).getData('text') || '';
      } catch (_) {}
      if (!NSEC_RE.test(text)) return;
      const t = e.target;
      if (t && t.closest && t.closest('.nsec-field')) return; // the one allowed home
      e.preventDefault();
      e.stopPropagation();
      toast('That looks like a secret key. For safety, paste your nsec only into the key import field.', 'error');
    },
    true
  );

  // ---- timed clipboard clear for copied secrets ----
  // The reveal UI auto-hides a secret after 30s, but a COPY of it outlives the
  // modal: OS clipboard history and cross-device clipboard sync (Windows
  // clipboard history, Universal Clipboard) can hold an nsec or wallet
  // connection string indefinitely. So a secret copy schedules a clear of the
  // clipboard CLIPBOARD_CLEAR_S later. Best-effort on two counts: reading the
  // clipboard first (to avoid wiping something the user copied elsewhere in
  // the meantime) needs the clipboardRead permission, which Sidecar
  // deliberately doesn't request — so when the read fails the clear happens
  // blind. That blind clear is why every OTHER copy the panel makes goes
  // through copyPlain(), which cancels a pending clear: the public value has
  // replaced the secret on the clipboard, so there is nothing left to protect
  // and the timer would only destroy the user's copy. And writing needs a
  // focused document, so the clear can no-op if the panel has lost focus or
  // closed — same "reduce the window, don't promise to close it" stance as
  // wipe() in the keystore. The copy toast announces the countdown so a
  // clipboard entry vanishing a minute later is expected, not spooky.
  const CLIPBOARD_CLEAR_S = 60;
  let clipClearTimer = null;
  function cancelClipboardClear() {
    if (clipClearTimer) { clearTimeout(clipClearTimer); clipClearTimer = null; }
  }
  async function copyPlain(text) {
    cancelClipboardClear();
    await navigator.clipboard.writeText(text);
  }
  async function copySecret(secret) {
    await navigator.clipboard.writeText(secret);
    cancelClipboardClear();
    clipClearTimer = setTimeout(async () => {
      clipClearTimer = null;
      try {
        // If the clipboard is readable and no longer holds the secret, leave it.
        if ((await navigator.clipboard.readText()) !== secret) return;
      } catch (_) { /* no clipboardRead — proceed with the blind clear */ }
      try { await navigator.clipboard.writeText(''); } catch (_) { /* unfocused/closed */ }
    }, CLIPBOARD_CLEAR_S * 1000);
  }
  // A manual selection-copy (Ctrl+C) inside the panel also replaces the
  // clipboard; writeText() never fires this event, so a secret copy can't
  // cancel its own timer.
  document.addEventListener('copy', cancelClipboardClear, true);

  let state = null;
  // The LIVE mask state and the STORED preference are two different things, and they
  // came apart when the reveal got an optional timeout. With autoHideBalances OFF — the
  // default — the eye is the plain toggle it always was and the two track each other.
  // Switch it on and revealing becomes a PEEK: the panel unmasks for 30 seconds without
  // touching the preference, so it returns to masked on its own, on a reload, and after
  // a lock. That is the whole reason the preference needs a home in Settings: while
  // peeking, the eye can no longer turn masking off for good, and a preference with no
  // control is a preference you cannot undo.
  let hideBalances = false;      // what the panel is showing right now
  let hideBalancesPref = false;  // what the user chose; a peek does not move this
  let autoHideBalances = false;  // opt-in: does a reveal expire, or last until masked?
  let _balancePeekTimer = null;
  let pinBalanceBar = false;
  // Off by default: the balance animations are part of what each theme IS, so they
  // ship on. This is the escape hatch for someone who wants them gone without
  // turning motion down system-wide (which the theme files already honor on their
  // own, via prefers-reduced-motion).
  let reduceBalanceMotion = false;
  let fiatCurrency = 'USD';   // Settings preference; the "fiat" leg of the denom cycle
  let zapFlash = true; // lightning bolt on payment — on unless turned off
  let _firstPostSeenPubkeys = null;
  let balanceCache = { pubkey: null, sats: null }; // last known balance for instant display
  const _notifCache = new Map(); // pubkey → { events: Event[], liveSub: Closeable|null }
  const _notifProfiles = new Map(); // sender pubkey → display name string
  const _muteLists = new Map(); // pubkey → resolved mute set (see emptyMuteSet)
  const _muteListPromises = new Map(); // pubkey → Promise<Set> (dedupe in-flight loads)
  const _ownNoteIds = new Map(); // pubkey → Set<eventId> (this account's own recent kind:1 ids)
  const _ownNoteIdsPromises = new Map(); // pubkey → Promise<Set> (dedupe in-flight loads)
  let _notifSeenAt = {}; // pubkey → unix timestamp, persisted to chrome.storage.local
  let _notifSeenLoaded = false;
  // Set while the notification modal is open, so a live event arriving in the
  // background (addEvent, below) can append it to the visible list in place
  // instead of only updating the bell badge — otherwise the open modal only
  // ever reflected notifications as of the moment it was opened.
  let _openNotifBell = null; // { pubkey, list, buildItem, clearEmptyMessage } | null
  let _postBannerTimer = null; // auto-dismiss for #post-banner

  // Privacy masking is done in CSS (-webkit-text-security on `.balances-hidden`),
  // which masks each glyph at its real width so toggling never reflows. We always
  // render the true value; this helper just toggles the container class.
  function applyHideBalances() {
    const main = document.getElementById('view-main');
    if (main) main.classList.toggle('balances-hidden', hideBalances);
  }

  // Collapse the balance card into a slim sticky header as the wallet content
  // scrolls (mirrors zap.cooking). We watch a tiny sentinel placed *above* the
  // card with an IntersectionObserver rather than reading scrollTop: collapsing
  // the card resizes the layout, and a scrollTop threshold would feed that change
  // back into itself and flip the state every frame. The sentinel sits above the
  // card, so the card's resize never moves it — no feedback loop, no flicker.
  let walletCardObserver = null;
  // Re-measures the collapse delta after something changes the card's expanded height
  // (opening/closing the price chart). Set by observeWalletCard; null when no card.
  let remeasureWalletCard = null;
  function observeWalletCard(card, sentinel, spacer) {
    if (walletCardObserver) { walletCardObserver.disconnect(); walletCardObserver = null; }
    remeasureWalletCard = null;
    const root = document.querySelector('.content');
    if (!root || !('IntersectionObserver' in window)) return;
    // Defer until the card has laid out so we can measure its collapse delta.
    requestAnimationFrame(() => {
      // How much height the card loses when collapsed. A bottom spacer grows by
      // exactly this amount while compact, so collapsing never changes the total
      // scroll height. Without it, collapsing shrinks the document, the scroll
      // clamps at the bottom, the sentinel re-enters view, and it flickers —
      // worst on a short page like a wallet with no transactions.
      // `delta` is mutable because the expanded height isn't fixed: opening the price
      // chart makes the card taller, and a stale delta would under-compensate the
      // spacer (the page would jump on the next collapse). remeasure() recomputes it.
      let delta = 0;
      const wasCompact = () => card.classList.contains('compact');
      const measure = () => {
        const restore = wasCompact();
        card.classList.remove('compact');
        const expandedH = card.offsetHeight;
        card.classList.add('compact');
        const compactH = card.offsetHeight;
        card.classList.toggle('compact', restore);
        delta = Math.max(0, expandedH - compactH);
        if (spacer) spacer.style.height = restore ? delta + 'px' : '0px';
      };
      measure();
      remeasureWalletCard = measure;
      walletCardObserver = new IntersectionObserver(
        (entries) => {
          const compact = !entries[0].isIntersecting;
          card.classList.toggle('compact', compact);
          if (spacer) spacer.style.height = compact ? delta + 'px' : '0px';
        },
        { root, rootMargin: '48px 0px 0px 0px', threshold: 0 }
      );
      walletCardObserver.observe(sentinel);
    });
  }

  // Background broadcasts (e.g. a WebLN payment paid via the service worker
  // while the panel is open) — refresh the wallet if it's the visible tab.
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'SIDECAR_EVENT') return;
    if (msg.event === 'walletChanged' && state && !state.locked) {
      // No strike here. A WebLN payment from a page gets its bolt thrown across THAT
      // page by the content script (see notifyTabsPaidByHost) — where the user is
      // actually looking when they zap. Striking here as well would double it.
      const active = document.querySelector('.tab.active');
      if (active && active.dataset.tab === 'wallet') {
        // Update in place rather than full renderWallet(). A zap changes the balance
        // and the transaction list — rebuilding the entire wallet view (innerHTML='',
        // async relay round-trips, new DOM tree) made both flash blank behind a modal
        // overlay AND made the transaction list vanish and reappear. Targeted updates
        // paint specific elements without tearing the view down.
        refreshWalletBalance();
        refreshTransactionList();
      }
      renderPinnedBalanceBar(); // refresh the pinned bar on any tab
    }
    // Auto-lock (or a lock from elsewhere) fired in the background — drop to the
    // unlock screen now. refresh() closes any open modal and routes to view-lock.
    // Only an idle-timeout lock (auto) toasts — the user didn't trigger it, so
    // explain the sudden jump; manual lock / reset already show their own message.
    if (msg.event === 'locked') { refresh(); if (msg.auto) toast('Locked due to inactivity'); }
    // A relax window was granted, revoked, or expired — refresh the banner.
    if (msg.event === 'relaxChanged' && state && !state.locked) syncRelax();
  });

  // ---- timed "auto-sign" (relax) bottom status bar ----
  // Apogee-style persistent footer: while a relax window is active, pin a status
  // bar to the bottom of the panel with the signing account and a live mm:ss
  // countdown, plus an "End" button. Hidden when nothing is active so the panel
  // bottom stays clear. The background is the source of truth — we re-sync on
  // render and on every relaxChanged broadcast; a 1s ticker only repaints the
  // countdown from the cached expiry (no per-second query).
  let relaxGrants = []; // last-synced [{ host, pubkey, expiresAt }]
  let relaxTick = null;

  function fmtRelax(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    // Pad both fields so the string is always 5 chars (mm:ss) — combined with the
    // timer's fixed min-width this keeps its footprint stable, so it never nudges
    // the progress bar beside it as the countdown ticks (Playfair's figures aren't
    // fixed-width).
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function renderRelaxStatus() {
    const bar = $('relax-status');
    const view = $('view-main');
    if (!bar) return;
    if (!relaxGrants.length) {
      hide(bar);
      if (view) view.classList.remove('relax-active');
      if (relaxTick) { clearInterval(relaxTick); relaxTick = null; }
      return;
    }
    show(bar);
    if (view) view.classList.add('relax-active'); // lift the floating compose FAB off the bar
    if (!relaxTick) relaxTick = setInterval(renderRelaxStatus, 1000);
    const g = relaxGrants[0]; // one window at a time (grant enforces it)
    const accts = (state && state.accounts) || [];
    const acct = accts.find((a) => a.pubkey === g.pubkey);
    $('relax-status-name').textContent = acct ? displayName(acct) : 'this account';
    $('relax-status-host').textContent = g.host;
    const remaining = Math.max(0, g.expiresAt - Date.now());
    const total = g.duration || 15 * 60000;
    $('relax-status-time').textContent = fmtRelax(remaining);
    $('relax-status-fill').style.width = Math.max(0, Math.min(100, (remaining / total) * 100)) + '%';
    const dot = bar.querySelector('.relax-status-dot');
    if (dot) dot.classList.toggle('low', remaining < 60000); // green → amber under a minute
  }

  async function syncRelax() {
    if (!state || state.locked) { relaxGrants = []; renderRelaxStatus(); return; }
    let g = [];
    try { g = await call({ type: 'SIDECAR_GET_RELAX' }) || []; } catch (_) {}
    relaxGrants = g;
    renderRelaxStatus();
  }

  // "End" stops auto-signing entirely (ends every active window).
  $('relax-status-end').addEventListener('click', async () => {
    for (const g of relaxGrants) {
      try { await call({ type: 'SIDECAR_REVOKE_RELAX', host: g.host, pubkey: g.pubkey }); } catch (_) {}
    }
    await syncRelax();
  });

  // "Restart" winds the running window back to its full original duration — the
  // same act as approving the relax chips again, without leaving the page you're on.
  $('relax-status-restart').addEventListener('click', async () => {
    try { await call({ type: 'SIDECAR_RESTART_RELAX' }); } catch (_) {}
    await syncRelax();
  });

  // Reset the background idle auto-lock timer on active panel use (composing),
  // throttled so a burst of keystrokes doesn't spam the service worker — auto-lock
  // is minutes, so one ping every ~20s keeps it alive while you're actively typing.
  let lastActivityPing = 0;
  function noteActivity() {
    const now = Date.now();
    if (now - lastActivityPing < 20000) return;
    lastActivityPing = now;
    chrome.runtime.sendMessage({ type: 'SIDECAR_ACTIVITY' }).catch(() => {});
  }

  // ---- Par Avion's map leg -------------------------------------------------------
  // The field in that theme is a world map about three times the panel's width (see
  // themes/patterns.css), so only a slice of the world is on the paper at any moment.
  // Rather than pick one slice and print it forever, the window moves a leg further
  // round on every unlock: open the panel over the Atlantic, come back after lunch and
  // it is somewhere over the Indian Ocean. Nothing is announced and nothing is
  // configurable — it is meant to be noticed the third or fourth time, not the first.
  //
  // 37% a leg, from a random start. A step that shares no factor with 100 walks the
  // whole map before it repeats a position (0, 37, 74, 11, 48, 85, 22, …), where a
  // rounder number would bounce between two or three views forever; the random start
  // is what stops two browsers from flying in formation. Held in memory only: the
  // panel document survives lock and unlock, so the journey continues across a lock,
  // and a panel reload simply starts a new one somewhere else. Nothing worth a byte
  // of storage.
  //
  // Written for EVERY theme, not just this one. It is one custom property on <html>
  // that only par-avion's background reads; gating it on the active theme would mean
  // this had to be re-run on theme change, which is one more thing to forget.
  const MAP_LEG_STEP = 37;
  let mapLeg = Math.floor(Math.random() * 100);
  function advanceMapLeg() {
    mapLeg = (mapLeg + MAP_LEG_STEP) % 100;
    document.documentElement.style.setProperty('--map-leg', mapLeg + '%');
  }
  // True until the panel has shown the main view once, so the first render after a
  // load counts as an arrival and gets its own leg.
  let wasLocked = true;

  // ---- top-level routing ----
  // opts.keepWallet: the caller knows nothing wallet-related happened, so a wallet view
  // that is still valid should be updated in place instead of torn down. See the note at
  // the wallet branch below.
  async function refresh(opts) {
    // A pending signing approval is modal — it stays put until the user decides,
    // so don't let an incidental refresh navigate away from it.
    if (pendingApproval) {
      closeModal();
      showApproval();
      return;
    }
    state = await call({ type: 'SIDECAR_GET_STATE' });
    const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
    // Re-init means a lock, an unlock or a reload, and a peek does not survive any of
    // them: the timer is dropped and the live state goes back to the preference.
    if (_balancePeekTimer) { clearTimeout(_balancePeekTimer); _balancePeekTimer = null; }
    hideBalancesPref = !!(settings && settings.hideBalances);
    hideBalances = hideBalancesPref;
    autoHideBalances = !!(settings && settings.autoHideBalances);
    pinBalanceBar = !!(settings && settings.pinBalanceBar);
    reduceBalanceMotion = !!(settings && settings.reduceBalanceMotion);
    // A class on <html> rather than a JS check for the one animation that is pure
    // CSS: the hidden-balance discs strike from their ::after existing at all
    // (themes/nixie.css), so no paint call ever runs to gate.
    document.documentElement.classList.toggle('reduce-balance-motion', reduceBalanceMotion);
    fiatCurrency = (settings && settings.fiatCurrency) || 'USD';
    zapFlash = !(settings && settings.zapFlash === false); // default on
    applyTheme(settings.theme || 'speakeasy'); // default to speakeasy
    applyHideBalances();
    closeAcctMenu();
    [$('view-onboarding'), $('view-lock'), $('view-main'), $('view-settings'), $('view-profile-edit'), $('view-approval')].forEach(hide);
    if (!state.initialized) {
      // Clear any stale PIN left in the inputs (e.g. after a reset) — the panel is
      // an SPA, so values would otherwise persist across the view switch. Setting
      // .value doesn't fire an 'input' event, so the validity checkmarks won't
      // recompute on their own — re-validate explicitly or they'd keep showing
      // green next to now-empty fields.
      $('ob-pin').value = '';
      $('ob-pin2').value = '';
      $('ob-error').textContent = '';
      validateOnboardingPin();
      show($('view-onboarding'));
      setTimeout(() => $('ob-pin').focus(), 50);
    } else if (state.locked) {
      // Lock is a security boundary and always wins: tear down any open modal
      // (composer, wallet, key backup, …) so nothing sensitive sits over the lock
      // screen. The composer draft is autosaved, so it's offered again on unlock.
      closeModal();
      stopWalletMonitor();
      if (nwc) { try { nwc.close(); } catch (_) {} nwc = null; nwcPubkey = null; nwcConn = null; }
      balanceCache = { pubkey: null, sats: null };
      wasLocked = true; // the next unlock is a new leg — see advanceMapLeg
      show($('view-lock'));
      // On Never, the only thing that can have locked this is the browser closing —
      // the derived key lives in chrome.storage.session, which is memory-only and
      // cleared on browser close. Without saying so, "Never" reads as broken.
      call({ type: 'SIDECAR_GET_SETTINGS' })
        .then((s) => {
          if (s && s.autoLockMinutes === 0) {
            $('view-lock').querySelector('.lede').textContent =
              'Locked since your browser closed. Enter your PIN to unlock your accounts.';
          }
        })
        .catch(() => {});
      setTimeout(() => $('unlock-pin').focus(), 50);
    } else {
      // Coming from the lock screen (or from a fresh load): move the Par Avion map on
      // by a leg. Here rather than in the PIN handler because this is the one place
      // every route into the main view passes through — PIN, browser-close unlock,
      // and the first render after a reload alike.
      // Arriving from the lock screen is a first showing, so the balance strikes. #248
      // keyed the paint record by SLOT rather than by element, which correctly stopped a
      // rebuilt card from re-striking a figure that never moved — and incorrectly took
      // the strike off this route too, because the record outlives a lock in a panel
      // that stayed open. Only when wasLocked: the same refresh() runs when an approval
      // settles, and forgetting there would put bug B straight back.
      if (wasLocked) {
        advanceMapLeg();
        forgetBalancePaint('wallet');
        forgetBalancePaint('pinned');
      }
      wasLocked = false;
      show($('view-main'));
      dismissPostBanner(); // a note link is account-specific; clear on any state change
      renderMain();
      initNotifSubs();
      maybeShowAutoLockNotice(settings);
      // Re-render the visible tab so account-scoped views (Activity/Profile) follow the switch.
      const activeTab = document.querySelector('.tab.active');
      const name = activeTab && activeTab.dataset.tab;
      if (name === 'activity') renderActivity();
      else if (name === 'profile') renderProfile();
      else if (name === 'wallet') {
        // A FULL renderWallet() HERE IS A RELAY ROUND TRIP AND A TEARDOWN. It clears the
        // view, refetches the balance and refetches the transaction list, and the list
        // is paged from a view-local `offset` — so a rebuild silently drops anyone who
        // pressed "Show more" back to the first page.
        //
        // That is the right thing when the account moved, and pure collateral when it
        // did not. Signing an event with the panel sitting on Wallet did it every time:
        // the approval settles, refreshApproval() re-syncs the panel because an approval
        // CAN change global state (switchToPubkey, detach, a relax grant), and the wallet
        // got rebuilt for a signature that never touched it.
        //
        // So callers that know better say so, and the view still has to prove it is
        // reusable — walletRenderedFor catches the account actually having changed, and
        // the balance node catches the connect screen, where there is nothing to patch.
        // This is the same trade the walletChanged broadcast handler already makes, for
        // the same reasons, using the same two targeted helpers.
        const reusable = opts && opts.keepWallet
          && walletRenderedFor === state.activePubkey
          && document.querySelector('.wallet-balance');
        if (reusable) {
          refreshWalletBalance();
          refreshTransactionList();
        } else {
          renderWallet();
        }
      }
    }
    // Re-assert the approval overlay from the queue after rendering the base view,
    // so a panel reload while a request is pending re-surfaces it deterministically
    // (no race with the view-hiding above). Skipped implicitly by the top guard
    // when an approval is already showing.
    if (typeof syncApprovalOverlay === 'function') syncApprovalOverlay();
  }

  // ---- onboarding ----
  const validateOnboardingPin = attachPinValidation($('ob-pin'), $('ob-pin2'), $('ob-submit'));
  $('onboarding-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('ob-error');
    err.textContent = '';
    const pin = $('ob-pin').value;
    const pin2 = $('ob-pin2').value;
    if (pin.length < MIN_PIN_LEN) return (err.textContent = `Use at least ${MIN_PIN_LEN} characters.`);
    if (pin.length > MAX_PIN_LEN) return (err.textContent = `Use at most ${MAX_PIN_LEN} characters.`);
    if (pin !== pin2) return (err.textContent = 'PINs do not match.');
    try {
      await call({ type: 'SIDECAR_INIT', pin });
      // Hold the welcome/empty-state view behind this reminder until it's dismissed.
      pinReminderModal(async () => {
        await refresh();
        toast('Keystore created', 'success');
      });
    } catch (e) {
      err.textContent = e.message;
      toast(e.message, 'error');
    }
  });

  // ---- unlock ----
  // Unlock guard UI: show remaining attempts before the keystore self-erases and
  // enforce the same cooldown the background does (defense in depth is server-side;
  // this is just feedback). The <8-attempt window turns the warning urgent.
  let unlockCooldownTimer = null;
  // A refined "attempts remaining" notice — the count set in the display face with
  // a gold accent that turns red as the auto-erase threshold nears.
  function unlockNotice(remaining) {
    const low = remaining != null && remaining <= 5;
    const note = h('div', { className: 'unlock-note' + (low ? ' unlock-danger' : '') });
    note.append(h('div', { className: 'unlock-note-title', textContent: 'Incorrect PIN' }));
    if (remaining != null) {
      note.append(h('div', { className: 'unlock-note-sub' }, [
        h('span', { className: 'unlock-note-count', textContent: String(remaining) }),
        document.createTextNode((remaining === 1 ? ' attempt' : ' attempts') + ' left before this device erases'),
      ]));
    }
    return note;
  }
  function showUnlockRemaining(remaining) {
    const box = $('unlock-cooldown');
    $('unlock-error').textContent = '';
    box.innerHTML = '';
    box.append(unlockNotice(remaining));
    box.classList.remove('hidden');
  }
  function clearUnlockCooldown() {
    if (unlockCooldownTimer) { clearInterval(unlockCooldownTimer); unlockCooldownTimer = null; }
    const box = $('unlock-cooldown');
    box.classList.add('hidden');
    box.innerHTML = '';
  }
  // A small, classy countdown ring (mirrors the composer's, scaled down) while the
  // unlock is in cooldown — replaces the raw "try again in Ns" text.
  function startUnlockCooldown(ms, remaining, keepRemaining) {
    const err = $('unlock-error');
    const btn = $('unlock-form').querySelector('button[type=submit]');
    const pin = $('unlock-pin');
    const box = $('unlock-cooldown');
    if (unlockCooldownTimer) clearInterval(unlockCooldownTimer);
    err.textContent = '';
    btn.disabled = true;
    pin.disabled = true;

    const total = Math.max(1, Math.ceil(ms / 1000));
    let left = total;
    const R = 30, C = 2 * Math.PI * R;
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 72 72');
    ring.setAttribute('class', 'countdown-ring');
    ring.innerHTML =
      '<circle cx="36" cy="36" r="' + R + '" class="ring-track"/>' +
      '<circle cx="36" cy="36" r="' + R + '" class="ring-fill" stroke-dasharray="' + C + '" stroke-dashoffset="0" transform="rotate(-90 36 36)"/>';
    const num = h('div', { className: 'countdown-num' });
    paintCountdownNum(num, left);
    const wrap = h('div', { className: 'countdown-wrap' }, [ring, num]);
    const cap = remaining != null
      ? unlockNotice(remaining)
      : h('div', { className: 'unlock-note' }, [h('div', { className: 'unlock-note-title', textContent: 'Too many attempts' })]);
    box.innerHTML = '';
    box.append(wrap, cap);
    box.classList.remove('hidden');
    const fill = ring.querySelector('.ring-fill');

    unlockCooldownTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearUnlockCooldown();
        btn.disabled = false;
        pin.disabled = false;
        if (keepRemaining && remaining != null) showUnlockRemaining(remaining);
        pin.focus();
        return;
      }
      paintCountdownNum(num, left);
      fill.setAttribute('stroke-dashoffset', String(C * (1 - left / total)));
    }, 1000);
  }

  $('unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('unlock-error');
    const pin = $('unlock-pin');
    err.textContent = '';
    err.classList.remove('unlock-danger');
    let r;
    try {
      // SIDECAR_UNLOCK contract (see background.js): branch on result.status.
      r = await call({ type: 'SIDECAR_UNLOCK', pin: pin.value });
    } catch (ex) {
      err.textContent = ex.message;
      return;
    }
    pin.value = '';
    if (r.status === 'ok') { clearUnlockCooldown(); await refresh(); toast('Unlocked', 'success'); return; }
    if (r.status === 'wiped') { clearUnlockCooldown(); await refresh(); toast('Too many attempts — all data erased', 'error'); return; }
    if (r.status === 'throttled') { startUnlockCooldown(r.waitMs, r.remaining, false); return; }
    if (r.status === 'bad') {
      showUnlockRemaining(r.remaining);
      if (r.nextWaitMs > 0) startUnlockCooldown(r.nextWaitMs, r.remaining, true);
      return;
    }
    err.textContent = r.error || 'Could not unlock';
  });

  // Locked out (forgot PIN): let the user erase everything and start over, with a
  // type-to-confirm so it can't happen by accident.
  $('unlock-forgot').addEventListener('click', (e) => {
    e.preventDefault();
    openModal((modal) => {
      const err = h('div', { className: 'error' });
      const warn = h('p', {
        className: 'hint',
        textContent:
          "If you've lost your PIN there is no way to recover it. You can erase everything and start fresh — all accounts and private keys, wallet connections, permissions, and settings on this device are gone for good. Any account without a backed-up nsec cannot be recovered.",
      });
      const confirmInput = h('input', { type: 'text', placeholder: 'Type ERASE to confirm' });
      const del = h('button', { className: 'danger', textContent: 'Erase everything' });
      del.disabled = true;
      const matches = () => confirmInput.value.trim().toUpperCase() === 'ERASE';
      confirmInput.addEventListener('input', () => { del.disabled = !matches(); });
      del.addEventListener('click', async () => {
        if (!matches()) return;
        try {
          await call({ type: 'SIDECAR_RESET_ALL' });
          closeModal();
          await refresh(); // no keystore now → onboarding
          toast('Sidecar erased', 'success');
        } catch (ex) {
          err.textContent = ex.message;
          toast(ex.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Forgot your PIN?' }),
        warn,
        h('label', { textContent: 'Confirm' }),
        confirmInput,
        err,
        h('div', { className: 'actions' }, [del, cancel])
      );
      setTimeout(() => confirmInput.focus(), 50);
    });
  });

  // ---- lock ----
  $('lock-btn').addEventListener('click', async () => {
    await call({ type: 'SIDECAR_LOCK' });
    await refresh();
    toast('Locked', 'success');
  });

  $('compose-fab').addEventListener('click', () => {
    const balloon = $('first-post-balloon');
    const isFirstTime = balloon && !balloon.classList.contains('hidden') && state?.activePubkey;
    if (isFirstTime) {
      _firstPostSeenPubkeys = _firstPostSeenPubkeys || new Set();
      _firstPostSeenPubkeys.add(state.activePubkey);
      chrome.storage.local.set({ firstPostTipSeenPubkeys: [..._firstPostSeenPubkeys] });
      balloon.classList.add('hidden');
      openComposer('Just setting up my #Sidecar 🍸');
    } else {
      openComposer();
    }
  });

  // Dim the FAB while the content is actively scrolling so it doesn't distract;
  // snap back ~160ms after scrolling stops (mirrors zap.cooking's create FAB).
  (function fabScrollDim() {
    const fab = $('compose-fab');
    const scroller = document.querySelector('#view-main .content');
    if (!fab || !scroller) return;
    let t = null;
    scroller.addEventListener(
      'scroll',
      () => {
        fab.classList.add('is-scrolling');
        if (t) clearTimeout(t);
        t = setTimeout(() => fab.classList.remove('is-scrolling'), 160);
      },
      { passive: true }
    );
  })();

  // ---- notification bell (topbar) ----
  $('notif-bell-btn').addEventListener('click', () => {
    if (!state?.activePubkey) return;
    const a = state.accounts.find((acc) => acc.pubkey === state.activePubkey);
    if (a) showNotifModal(a);
  });

  // Bookmarks lives in the topbar's content group (bell, search, comment),
  // not as a tab: it's a list you dip into, not a surface you keep open.
  $('bookmarks-btn').addEventListener('click', () => {
    if (!state?.activePubkey) return;
    renderBookmarks();
  });

  // In-progress comment text, keyed by account + target URL. Clicking the overlay
  // dismisses the modal, and losing a half-written comment to a stray click is
  // infuriating in a panel this narrow.
  //
  // Memory only, NOT chrome.storage, unlike the note composer's drafts. A comment is
  // tied to a page you're looking at, so it only has to survive reopening the modal
  // while that URL is still around — outliving the panel would mean stashing text
  // about someone's browsing on disk, which is a worse trade than retyping.
  //
  // Keyed by pubkey too: the note composer scopes drafts per account, and finding
  // another account's half-written comment waiting for you would be a surprise.
  const webCommentDrafts = new Map();
  const WEB_COMMENT_DRAFT_MAX = 20; // abandoned drafts shouldn't accumulate forever

  const webCommentDraftKey = (pubkey, url) => String(pubkey) + '\n' + String(url);

  function saveWebCommentDraft(pubkey, url, text) {
    if (!url) return; // no target resolved yet — nothing to key on
    const key = webCommentDraftKey(pubkey, url);
    if (!text || !text.trim()) { webCommentDrafts.delete(key); return; }
    webCommentDrafts.delete(key); // re-insert so eviction below is least-recent-first
    webCommentDrafts.set(key, text);
    while (webCommentDrafts.size > WEB_COMMENT_DRAFT_MAX) {
      webCommentDrafts.delete(webCommentDrafts.keys().next().value);
    }
  }

  // Comment on the page in the active tab. Opened from the topbar pencil.
  //
  // Deliberately built to the New-note convention rather than its own shape: same
  // "Posting as" header, same Write/Preview tabs, same link card, same button
  // order. A second composer that looked different would read as a different app.
  function webCommentModal() {
    // Declared out here so the modal's onClose can reach it. Without that teardown a
    // countdown left running after the modal is dismissed would still fire and
    // publish the comment — closing the dialog has to mean it doesn't go out.
    let countdown = null;
    const stopCountdown = () => { if (countdown) { countdown.stop(); countdown = null; } };
    openModal((modal) => {
      const err = h('div', { className: 'error' });

      // Who this posts as. Same block the note composer uses — a public comment
      // signed by an account you might not have realized was active is exactly the
      // mistake this prevents.
      const active = state.accounts.find((a) => a.pubkey === state.activePubkey);
      const author = h('div', { className: 'compose-author' });
      author.append(avatarEl(active || {}, 'compose-author-av'));
      author.append(
        h('div', { className: 'compose-author-info' }, [
          h('span', { className: 'compose-author-eyebrow', textContent: 'Commenting as' }),
          h('span', { className: 'compose-author-name', textContent: active ? displayName(active) : '\u2014' }),
        ])
      );

      const tabWrite = h('button', { className: 'compose-tab active', textContent: 'Write' });
      const tabPreview = h('button', { className: 'compose-tab', textContent: 'Preview' });
      const tabBar = h('div', { className: 'compose-tabs' }, [tabWrite, tabPreview]);

      // The note composer's editor, reused verbatim, so a comment can tag people
      // the same way a note can. Mentions land as nostr: pills that
      // buildWebComment turns into the p tags a client needs to notify them.
      // onChange keeps the draft current on every keystroke rather than saving on
      // close \u2014 the overlay click path tears the modal down without going through
      // Cancel, so anything deferred to teardown is the thing that gets lost.
      const commentEditor = createMentionEditor({
        placeholder: 'Write a comment about this page\u2026',
        onChange: (text) => saveWebCommentDraft(state.activePubkey, target, text),
      });
      const previewPane = h('div', { className: 'compose-preview hidden' });

      const post = h('button', { className: 'primary', textContent: 'Post comment' });
      post.disabled = true;
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);

      let target = null;   // the normalized URL this comments on
      let ogMeta;          // undefined = not fetched, null = no preview available

      // The page being commented on. This sits ABOVE the tabs, not inside Preview,
      // because it's CONTEXT rather than content — the same reason "Commenting as"
      // is up there. A kind:1111 is defined by its target, so writing a comment
      // without being able to see what you're commenting on is the wrong shape; the
      // first version hid it behind the Preview tab and the Write pane was a blank
      // box with no subject.
      const targetBlock = h('div', { className: 'webcomment-target' });

      // Takes a container so the review countdown can render its own copy rather
      // than borrowing this one out of the editor pane and having to put it back.
      function renderTargetInto(into) {
        into.innerHTML = '';
        if (!target) return;
        if (ogMeta === undefined) {
          into.append(h('div', { className: 'link-card loading' }));
        } else if (ogMeta) {
          const card = h('a', { className: 'link-card' });
          renderLinkCard(card, target, ogMeta);
          into.append(card);
        }
        // The URL is what actually gets published, so it stays visible even when a
        // card renders — as a caption, not the headline.
        into.append(h('div', { className: 'webcomment-url', textContent: target }));
      }
      function renderTarget() { renderTargetInto(targetBlock); }

      // Preview now shows only the comment itself, since the target is permanent
      // above.
      function renderPreview() {
        previewPane.innerHTML = '';
        const text = commentEditor.getText().trim();
        if (!text) {
          previewPane.append(h('p', { className: 'hint', textContent: 'Nothing written yet.' }));
          return;
        }
        // renderNotePreview, not textContent: a mention serializes to a bare
        // `nostr:npub1…` token, so the raw string showed the reader a 63-character
        // key where the published comment shows a name.
        previewPane.append(commentBodyPreview(text));
      }

      // Shared by the Preview tab and the review countdown so they can't drift.
      function commentBodyPreview(text) {
        const body = h('div', { className: 'webcomment-preview-text' });
        renderNotePreview(body, text);
        return body;
      }

      function showTab(which) {
        const preview = which === 'preview';
        tabWrite.classList.toggle('active', !preview);
        tabPreview.classList.toggle('active', preview);
        commentEditor.wrap.classList.toggle('hidden', preview);
        previewPane.classList.toggle('hidden', !preview);
        if (preview) { commentEditor.close(); renderPreview(); }
      }
      tabWrite.addEventListener('click', () => showTab('write'));
      tabPreview.addEventListener('click', () => showTab('preview'));

      // Shown after posting: both links point at Jumble, since almost nothing else
      // renders a kind:1111 over a web target.
      const done = h('div', { className: 'webcomment-done hidden' });
      const link = (label, href) => {
        const a = h('a', { className: 'explore-link', href: '#', textContent: label });
        a.addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: href }); });
        return a;
      };

      const heading = h('h3', { textContent: 'Comment on this page' });
      const actions = h('div', { className: 'actions' }, [post, cancel]);

      // The editor pane. Re-appending the same nodes is enough to come back from the
      // countdown, which clears the modal to take it over.
      function showCommentEditor() {
        stopCountdown();
        modal.innerHTML = '';
        modal.append(
          heading,
          author,
          targetBlock, // above the tabs: the subject, not one of the two views
          tabBar,
          commentEditor.wrap,
          previewPane,
          err,
          done,
          actions
        );
      }

      async function doPost() {
        const text = commentEditor.getText().trim();
        showCommentEditor(); // the countdown may have replaced the pane
        post.disabled = true;
        post.textContent = 'Posting\u2026';
        try {
          // Same opt-out the note composer honours (Settings → "Show client tag").
          const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
          const withClient = !(settings && settings.showClientTag === false);
          const signed = await call({
            type: 'SIDECAR_OWNER_SIGN',
            event: buildWebComment(target, text, withClient),
          });
          await publishSigned(signed);
          // Only after it's actually out. Dropping the draft on a failed publish would
          // lose the text at the exact moment the user still needs it.
          saveWebCommentDraft(state.activePubkey, target, '');
          let nevent = '';
          try {
            nevent = NT.nip19.neventEncode({ id: signed.id, author: signed.pubkey, relays: [] });
          } catch (_) {}
          commentEditor.editor.contentEditable = 'false';
          tabBar.classList.add('hidden');
          commentEditor.wrap.classList.add('hidden');
          previewPane.classList.add('hidden');
          post.classList.add('hidden');
          done.classList.remove('hidden');
          done.append(
            h('div', { className: 'webcomment-done-title', textContent: 'Comment posted' }),
            // Jumble is named because it's currently the only client that renders a
            // kind:1111 over a web target \u2014 "view your comment" without saying where
            // suggests it's visible wherever you normally read Nostr, and it isn't.
            // Drop the name once other clients catch up.
            nevent ? link('View your comment on Jumble \u2192', jumbleNoteUrl(nevent)) : document.createTextNode(''),
            link('See all comments on this page \u2192', jumbleThreadUrl(target))
          );
          cancel.textContent = 'Close';
          toast('Comment posted', 'success');
        } catch (e) {
          err.textContent = (e && e.message) || 'Could not post that comment.';
          post.disabled = false;
          post.textContent = 'Post comment';
        }
      }

      post.addEventListener('click', async () => {
        const text = commentEditor.getText().trim();
        if (!target) return (err.textContent = 'No page to comment on.');
        if (!text) return (err.textContent = 'Write something first.');
        err.textContent = '';
        // Same setting the note composer reads — "Review countdown before posting"
        // covers everything publishable, so this doesn't get a switch of its own.
        const { on, secs } = await postCountdownSetting();
        if (!on) return doPost();
        // The review screen leads with the page, not the text. A comment inherits its
        // target from whichever tab was active when the modal opened, and that is the
        // mistake nothing else in the flow would catch — posting on the wrong page
        // isn't visible until it's already published on someone else's site.
        const cdPreview = h('div', { className: 'countdown-preview' });
        const cdTarget = h('div', { className: 'webcomment-target' });
        renderTargetInto(cdTarget);
        cdPreview.append(cdTarget, commentBodyPreview(text));
        countdown = showPostCountdown({
          modal,
          secs,
          title: 'Posting your comment',
          hint: 'Check the page and your comment before it posts.',
          preview: cdPreview,
          onFire: doPost,
          onCancel: () => {
            showCommentEditor();
            post.disabled = false;
            post.textContent = 'Post comment';
            commentEditor.focus();
          },
        });
      });

      showCommentEditor();

      // Resolve the tab only after the modal is up \u2014 never speculatively, since this
      // URL is about to be published.
      activeTabUrl().then((raw) => {
        const { url, error } = normalizeWebUrl(unwrapJumbleTarget(raw));
        if (error) {
          err.textContent = error;
          tabBar.classList.add('hidden');
          commentEditor.wrap.classList.add('hidden');
          return;
        }
        target = url;
        post.disabled = false;

        // Bring back whatever was being written for this page. The target resolves
        // asynchronously, so anything typed in the meantime already exists in the
        // editor and wins — restoring over it would delete what the user just typed
        // to hand them something older.
        const typedAlready = commentEditor.getText().trim();
        if (typedAlready) {
          saveWebCommentDraft(state.activePubkey, target, commentEditor.getText());
        } else {
          const saved = webCommentDrafts.get(webCommentDraftKey(state.activePubkey, target));
          if (saved) commentEditor.setText(saved);
        }

        renderTarget(); // shows the URL and a loading card immediately
        commentEditor.focus();
        // The card fills in when the fetch lands; the Write pane is usable throughout
        // and already shows the URL, so nothing waits on the network.
        call({ type: 'SIDECAR_FETCH_OG', url: target })
          .then((meta) => { ogMeta = meta || null; })
          .catch(() => { ogMeta = null; })
          .then(renderTarget);
      });
    }, stopCountdown);
  }

  // ---- search: paste an identifier, open it in your client ----
  // Deliberately has no index behind it. A NIP-19 string already *contains* what
  // it points at — the npub is the pubkey, the nevent is the event id — so this
  // is a local decode, not a lookup, and it can't be broken by a service going
  // away. A NIP-05 name is the one form that needs the network, and it resolves
  // against its own domain rather than anybody's directory.
  function setSearchStatus(msg, isError) {
    const el = $('search-status');
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  function closeSearch() {
    $('search-bar').classList.add('hidden');
    $('search-btn').setAttribute('aria-expanded', 'false');
    $('search-input').value = '';
    setSearchStatus('');
    clearSearchResults();
  }

  function openSearch() {
    $('search-bar').classList.remove('hidden');
    $('search-btn').setAttribute('aria-expanded', 'true');
    setSearchStatus('');
    paintSearchModeIcon();
    $('search-input').focus();
  }

  // Scope chip next to the search input: shows whether a name search runs
  // locally (your follows, users icon) or globally (Nostr Archives index,
  // globe icon), and is the always-available way to flip it. Unset counts as
  // local — nothing is sent while it's unset, so that's the honest display.
  // Clicking toward global shows the same one-time ask the dropdown shows,
  // because that click is the disclosure moment; clicking back to local is
  // immediate — that direction only ever withholds data.
  function paintSearchModeIcon() {
    naSetting().then((on) => {
      const btn = $('search-mode');
      btn.replaceChildren(icon(on === true ? 'globe' : 'users'));
      const title = global
        ? 'Searching every Nostr name (Nostr Archives index) — click to search only your follows'
        : 'Searching only your follows — click to also search every Nostr name';
      btn.title = title;
      btn.setAttribute('aria-label', title);
    });
  }
  $('search-mode').addEventListener('click', async () => {
    if ((await naSetting()) === true) {
      await naDecide(false);
      paintSearchModeIcon();
      updateSearchAc();
      return;
    }
    renderSearchResults([], false, naAskEl((decided) => {
      naDecide(decided).then(() => {
        paintSearchModeIcon();
        updateSearchAc();
      });
    }));
  });

  // A NIP-19 string, with or without a nostr: prefix or a web wrapper pasted
  // around it (njump.me/npub1…, primal.net/p/npub1… and friends all end in the
  // bech32 we want). Returns the bare identifier, or null.
  function extractEntity(raw) {
    const s = String(raw || '').trim().replace(/^(web\+)?nostr:/i, '');
    const m = s.match(/(?:npub1|nprofile1|note1|nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]+/i);
    return m ? m[0].toLowerCase() : null;
  }

  // name@domain, or a bare domain (NIP-05 treats that as the "_" name).
  const NIP05_RE = /^(?:[^\s@]+@)?[a-z0-9.-]+\.[a-z]{2,}$/i;

  async function resolveNip05ToPubkey(id) {
    const at = id.indexOf('@');
    const name = at === -1 ? '_' : id.slice(0, at);
    const domain = at === -1 ? id : id.slice(at + 1);
    const resp = await fetch(
      'https://' + domain + '/.well-known/nostr.json?name=' + encodeURIComponent(name),
      { signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) throw new Error('lookup failed');
    const data = await resp.json();
    const pk = data && data.names && data.names[name];
    if (!/^[0-9a-f]{64}$/i.test(pk || '')) throw new Error('not found');
    return pk.toLowerCase();
  }

  // Map a decoded entity onto the client's profile or note URL. naddr and nevent
  // pass through as-is: VIEW_CLIENTS.url() takes the bech32, and the notification
  // list has been handing it naddr this way already.
  function clientUrlFor(client, entity, decoded) {
    switch (decoded.type) {
      case 'npub':     return client.profile(entity);
      case 'nprofile': return client.profile(NT.nip19.npubEncode(decoded.data.pubkey));
      case 'note':     return client.url(NT.nip19.neventEncode({ id: decoded.data, relays: [] }));
      default:         return client.url(entity); // nevent, naddr
    }
  }

  async function runSearch() {
    const raw = $('search-input').value.trim();
    if (!raw) return;

    const entity = extractEntity(raw);
    let url = null;

    if (entity) {
      let decoded;
      try {
        decoded = NT.nip19.decode(entity);
      } catch (_) {
        setSearchStatus("That doesn't look like a valid Nostr identifier.", true);
        return;
      }
      const client = await preferredClient();
      try {
        url = clientUrlFor(client, entity, decoded);
      } catch (_) {
        setSearchStatus("Couldn't build a link for that identifier.", true);
        return;
      }
    } else if (NIP05_RE.test(raw)) {
      setSearchStatus('Looking up ' + raw + '…');
      let pubkey;
      try {
        pubkey = await resolveNip05ToPubkey(raw);
      } catch (_) {
        setSearchStatus("No Nostr address found at that domain.", true);
        return;
      }
      const client = await preferredClient();
      url = client.profile(NT.nip19.npubEncode(pubkey));
    } else {
      setSearchStatus('No match. Try a name, an npub, a note, or a name@domain address.', true);
      return;
    }

    openInClient(url);
    closeSearch();
  }

  // ---- name autocomplete in the search bar ----
  // Same two sources the composer's @-mention dropdown uses: your follow list
  // (local, instant once cached) and the Nostr Archives suggest endpoint for
  // everyone else. Follows are listed first and the global results are appended
  // as they land, so the box is useful before — and if — the network answers.
  let searchAcSeq = 0, searchAcTimer = null, searchResults = [], searchIndex = -1;

  function clearSearchResults() {
    if (searchAcTimer) { clearTimeout(searchAcTimer); searchAcTimer = null; }
    searchAcSeq++;
    searchResults = []; searchIndex = -1;
    $('search-results').innerHTML = '';
    $('search-results').classList.add('hidden');
  }

  function paintSearchActive() {
    $('search-results').querySelectorAll('.ac-item')
      .forEach((el, i) => el.classList.toggle('active', i === searchIndex));
  }

  async function openProfileFor(pubkey) {
    const client = await preferredClient();
    openInClient(client.profile(NT.nip19.npubEncode(pubkey)));
    closeSearch();
  }

  function renderSearchResults(items, loading, askEl) {
    const box = $('search-results');
    searchResults = items;
    if (!items.length && !loading && !askEl) { box.innerHTML = ''; box.classList.add('hidden'); return; }
    if (searchIndex >= items.length) searchIndex = items.length - 1;
    box.classList.remove('hidden');
    box.innerHTML = '';
    items.forEach((c, i) => {
      const item = h('div', { className: 'ac-item' + (i === searchIndex ? ' active' : '') });
      const av = h('span', { className: 'ac-item-av' });
      applyAvatar(av, c.picture ? { picture: c.picture } : {});
      item.append(av, h('span', { className: 'ac-item-name', textContent: c.name }));
      item.addEventListener('mousedown', (e) => { e.preventDefault(); openProfileFor(c.pubkey); });
      box.append(item);
    });
    if (loading) {
      box.append(h('div', { className: 'ac-loading' }, [
        h('span', { className: 'ac-spinner' }),
        h('span', { textContent: items.length ? 'Searching more…' : 'Searching Nostr…' }),
      ]));
    }
    // Above the results, same as the composer dropdown: this box caps and scrolls
    // too, and an appended ask vanished under the fold once matches rendered.
    if (askEl) box.prepend(askEl);
  }

  async function updateSearchAc() {
    const raw = $('search-input').value.trim();
    // An identifier resolves on Enter; there is nothing to suggest for it. Same
    // for a complete NIP-05 — that's a lookup, not a search.
    if (!raw || extractEntity(raw) || NIP05_RE.test(raw) || raw.length < 2) {
      clearSearchResults();
      return;
    }
    const seq = ++searchAcSeq;
    const q = raw.toLowerCase();
    const matchFollows = (list) => list.filter((c) => c.name && c.name.toLowerCase().includes(q));

    let follows = [];
    let globals = [];
    let globalPending = false;
    let askEl = null; // the one-time Nostr Archives ask, while the setting is unset
    const paint = () => {
      if (seq !== searchAcSeq) return;
      const seen = new Set(follows.map((c) => c.pubkey));
      const merged = follows.slice();
      for (const g of globals) { if (!seen.has(g.pubkey)) { seen.add(g.pubkey); merged.push(g); } }
      renderSearchResults(merged.slice(0, 8), globalPending, askEl);
    };

    const cached = (followListCache && followListPubkey === state.activePubkey) ? followListCache : null;
    if (cached) follows = matchFollows(cached);
    paint();
    if (!cached) {
      getFollowList().then((list) => {
        if (seq !== searchAcSeq) return;
        follows = matchFollows(list);
        paint();
      }).catch(() => {});
    }

    // The global slot is tri-state too (see the NA block): decided-on searches,
    // decided-off shows nothing, never-asked shows the one-time ask where the
    // spinner would be. Answering re-enters here with the decision written.
    if (!naAvailable()) return;
    const na = await naSetting();
    if (seq !== searchAcSeq) return;
    if (na === true) {
      globalPending = true;
      paint();
      if (searchAcTimer) clearTimeout(searchAcTimer);
      searchAcTimer = setTimeout(async () => {
        const res = await naSuggest(raw);
        if (seq !== searchAcSeq) return;
        globals = res;
        globalPending = false;
        paint();
      }, 250);
    } else if (na !== false) {
      askEl = naAskEl((on) => { naDecide(on).then(updateSearchAc); });
      paint();
    }
  }

  $('search-btn').addEventListener('click', () => {
    if ($('search-bar').classList.contains('hidden')) openSearch();
    else closeSearch();
  });
  $('search-close').addEventListener('click', closeSearch);
  $('search-input').addEventListener('input', () => { setSearchStatus(''); updateSearchAc(); });
  $('search-input').addEventListener('keydown', (e) => {
    const n = searchResults.length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault(); searchIndex = Math.min(searchIndex + 1, n - 1); paintSearchActive();
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault(); searchIndex = Math.max(searchIndex - 1, 0); paintSearchActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // A highlighted suggestion wins; then the top suggestion, since erroring
      // "that isn't an npub" with a list of matches on screen would be absurd;
      // otherwise decode what was actually typed.
      const pick = searchResults[searchIndex >= 0 ? searchIndex : 0];
      if (pick) openProfileFor(pick.pubkey);
      else runSearch();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (searchResults.length) clearSearchResults(); else closeSearch();
    }
  });

  $('comment-btn').addEventListener('click', webCommentModal);

  // ---- help & guides (opens as a full page in the main browser window) ----
  $('help-btn').addEventListener('click', () => {
    openExtensionPage('help.html');
  });
  // Release notes live in the help guide's "What's new" section — the guide is
  // updated as part of every release (see the RELEASE PRACTICE note in help.html).
  $('whats-new-link').addEventListener('click', (e) => {
    e.preventDefault();
    openExtensionPage('help.html', '#whats-new');
  });

  // ---- settings (gear icon ↔ overlay view) ----
  $('settings-btn').addEventListener('click', () => {
    hide($('view-main'));
    show($('view-settings'));
    renderSettings();
  });
  $('settings-close').addEventListener('click', () => {
    hide($('view-settings'));
    show($('view-main'));
  });
  $('settings-logo').addEventListener('click', () => {
    hide($('view-settings'));
    show($('view-main'));
  });

  // One-time tip shown on the first account switch: sites keep the identity
  // they logged in with, so users switching to post elsewhere need to know the
  // log-out → switch → log-in dance (and that in-client account menus can't
  // reach Sidecar). Banner sits below the tab bar so it's visible from any tab;
  // dismissing it persists forever.
  function maybeShowSwitchTip() {
    chrome.storage.local.get('switchTipDismissed', ({ switchTipDismissed }) => {
      if (switchTipDismissed || $('switch-tip')) return;
      const x = h('button', { className: 'switch-tip-x', title: 'Dismiss' });
      x.append(icon('x'));
      x.addEventListener('click', () => {
        chrome.storage.local.set({ switchTipDismissed: true });
        tip.remove();
      });
      const guideLink = h('a', {
        className: 'switch-tip-link',
        href: '#',
        textContent: 'Read the guide →',
      });
      guideLink.addEventListener('click', (e) => {
        e.preventDefault();
        openExtensionPage('help.html', '#switching');
      });
      const tip = h('div', { id: 'switch-tip', className: 'switch-tip' }, [
        h('div', { className: 'switch-tip-title' }, [
          icon('refresh'),
          h('span', { textContent: 'Switching accounts?' }),
        ]),
        h('p', {
          className: 'switch-tip-body',
          textContent:
            'Clients keep using the account you logged in with. Reload the page or log out and back in to switch accounts.',
        }),
        guideLink,
        x,
      ]);
      document.querySelector('nav.tabs').insertAdjacentElement('afterend', tip);
    });
  }

  // ---- header account switcher (dropdown) ----
  function buildAcctMenu() {
    const menu = $('acct-menu');
    menu.innerHTML = '';
    let pendingRow = null;

    function resetRow(row, a) {
      row.classList.remove('acct-row-pending');
      row.querySelector('.acct-row-name').textContent = displayName(a);
      row.querySelector('.acct-row-npub').textContent = shortNpub(a.npub);
      const c = row.querySelector('.acct-row-cancel');
      if (c) c.remove();
      if (pendingRow === row) pendingRow = null;
    }

    // THE CANCEL SITS WHERE THE CHECK SITS, which is what made the row stop being a
    // <button>. It used to be one, with the click handler on the row, and that ruled the
    // slot out twice over: a <button> inside a <button> is invalid, and a cancel nested
    // in the clickable region would bubble into the row's own handler, find
    // acct-row-pending, and CONFIRM the switch it exists to call off.
    //
    // So the row is a plain container now and the switch handler moved inward to
    // .acct-row-main — the same shape the Accounts tab has always had, where the trailing
    // slot holds the check and the actions and nothing nests. Keyboard access is
    // deliberately kept by making that inner element a real <button> rather than giving
    // the row a role: the row used to be focusable and activatable for free, and losing
    // that to a styling change would be a bad trade.
    //
    // The two never collide: you cannot switch to the account you are already on, so an
    // active row never arms.
    function armCancel(row, a) {
      const cancel = iconButton('Cancel', 'x', (e) => {
        e.stopPropagation();
        resetRow(row, a);
      });
      cancel.classList.add('acct-row-cancel');
      row.append(cancel);
    }

    state.accounts.forEach((a) => {
      const isActive = a.pubkey === state.activePubkey;
      const row = h('div', { className: 'acct-row' + (isActive ? ' active' : '') });
      const av = document.createElement('span');
      av.className = 'acct-row-av';
      applyAvatar(av, a);
      const info = h('div', { className: 'acct-row-info' }, [
        h('div', { className: 'acct-row-name', textContent: displayName(a) }),
        h('div', { className: 'acct-row-npub', textContent: shortNpub(a.npub) }),
      ]);
      // A real <button> when it does something, a plain div when it does not: the active
      // row is not a control, and a focusable element that ignores you is worse than one
      // that is not there.
      const main = h(isActive ? 'div' : 'button', { className: 'acct-row-main' }, [av, info]);
      row.append(main);
      if (isActive) {
        const c = icon('check');
        c.classList.add('acct-row-check');
        row.append(c);
      }
      if (!isActive) {
        main.addEventListener('click', async () => {
          if (pendingRow && pendingRow !== row) resetRow(pendingRow, state.accounts.find(x => x.pubkey === pendingRow.dataset.pubkey));
          if (row.classList.contains('acct-row-pending')) {
            closeAcctMenu();
            await call({ type: 'SIDECAR_SET_ACTIVE', pubkey: a.pubkey });
            await refresh();
            toast('Switched to ' + displayName(a), 'success');
            if (!(await offerTabReload())) maybeShowSwitchTip();
          } else {
            row.classList.add('acct-row-pending');
            row.querySelector('.acct-row-name').textContent = 'Switch to ' + displayName(a) + '?';
            row.querySelector('.acct-row-npub').textContent = 'Tap again to confirm';
            pendingRow = row;
            row.dataset.pubkey = a.pubkey;
            armCancel(row, a);
          }
        });
      }
      menu.append(row);
    });
    // Adding an account is the other thing you come to this menu for, and until now
    // it meant going to the Accounts tab first. Same modal the tab's button opens,
    // so there's one path to Generate/Import rather than two.
    const addRow = h('button', { className: 'acct-row foot' }, [
      h('span', { className: 'add-account-badge sm' }, [icon('plus')]),
      h('span', { className: 'acct-row-name', textContent: 'Add account' }),
    ]);
    addRow.addEventListener('click', () => {
      closeAcctMenu();
      addAccountModal();
    });
    menu.append(addRow);

    const foot = h('button', { className: 'acct-row foot' }, [
      h('span', { className: 'acct-row-name', textContent: 'Manage accounts' }),
    ]);
    foot.addEventListener('click', () => {
      closeAcctMenu();
      document.querySelector('.tab[data-tab="accounts"]').click();
    });
    menu.append(foot);
  }
  function openAcctMenu() {
    buildAcctMenu();
    show($('acct-menu'));
  }
  function closeAcctMenu() {
    hide($('acct-menu'));
  }
  $('acct-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if ($('acct-menu').classList.contains('hidden')) openAcctMenu();
    else closeAcctMenu();
  });
  document.addEventListener('click', (e) => {
    const menu = $('acct-menu');
    if (!menu.classList.contains('hidden') && !menu.contains(e.target) && !$('acct-btn').contains(e.target)) {
      closeAcctMenu();
    }
  });

  // ---- tabs ----
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      document.querySelectorAll('.tabview').forEach((v) => hide(v));
      show($('tab-' + name));
      // Every tab shares ONE scroll container, so the offset from the tab you just
      // left carries into the tab you arrive at. With a long account list that is
      // very visible: scroll down, tap "View full profile" (which clicks this tab
      // for you), and the Profile screen opens partway down — at Relays, or
      // wherever that pixel height happens to land — with no indication that
      // anything is above it.
      //
      // Reset only on a tab CHANGE. Re-renders of the tab you are already on
      // (an account switch, a settings change) deliberately keep your place, and
      // those paths call the render functions directly rather than coming through
      // here. Scoped to view-main because the profile editor has a .content of its
      // own, and instant rather than smooth: you are arriving somewhere new, so
      // animating the outgoing content is just noise.
      const scroller = $('view-main').querySelector('.content');
      if (scroller) scroller.scrollTop = 0;
      if (name === 'activity') { sitesShownN = 0; logShownN = 0; renderActivity(); }
      else if (name === 'profile') renderProfile();
      // Arriving on Wallet is the one card rebuild that earns a strike: the figure is
      // appearing, not being redrawn. Every other rebuild — an approval settling, a
      // wallet modal closing — now keeps whatever the slot last painted and stays put.
      else if (name === 'wallet') { forgetBalancePaint('wallet'); renderWallet(); }
      // Same deal for Accounts: the overview's stats (wallet connected/backed-up
      // badges especially) are whatever renderMain() last drew. Without this a
      // wallet disconnected on the Wallet tab still read "Connected" here until
      // some unrelated action re-rendered the panel.
      else if (name === 'accounts') renderMain();
      renderPinnedBalanceBar(); // show on non-wallet tabs, hide on Wallet
    });
  });

  // ---- activity sub-tabs: Connected sites | Recent activity ----
  // Both panes are populated by renderActivity regardless of which is showing;
  // this just toggles which one is visible so they're one tap apart instead of a
  // scroll. Selection persists across re-renders (renderActivity leaves the pane
  // containers' visibility alone).
  document.querySelectorAll('#activity-subtabs .modal-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#activity-subtabs .modal-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const sub = btn.dataset.subtab;
      $('activity-pane-sites').classList.toggle('hidden', sub !== 'sites');
      $('activity-pane-log').classList.toggle('hidden', sub !== 'log');
    });
  });

  // ---- main / accounts ----
  function shortNpub(npub) {
    return npub && npub.length > 20 ? npub.slice(0, 14) + '…' + npub.slice(-6) : npub || '';
  }

  // Name shown for an account: its kind:0 name, else a shortened npub.
  function displayName(a) {
    return a.name && a.name.trim() ? a.name.trim() : shortNpub(a.npub);
  }

  // Fill an element with an account avatar: its kind:0 picture, or the default garnish.
  function applyAvatar(box, a) {
    box.innerHTML = '';
    box.classList.remove('avatar-ph');
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    if (a && a.picture) {
      img.src = a.picture;
      img.onerror = () => {
        img.src = avatarPhSrc();
        img.onerror = null;
        box.classList.add('avatar-ph');
      };
    } else {
      img.src = avatarPhSrc();
      box.classList.add('avatar-ph');
    }
    box.appendChild(img);
  }
  // A circular avatar element: the account's kind:0 picture, or the default garnish.
  function avatarEl(a, cls) {
    const box = document.createElement('div');
    box.className = cls;
    applyAvatar(box, a);
    return box;
  }

  // ---- relay pool (fetch + publish) ----
  // enableReconnect: nostr-tools defaults it to false, which means a socket dropped
  // while the panel sat idle is never reopened — the same latent bug the NWC client
  // had. The panel is long-lived, so this pool is exactly where it bites: a composer
  // publish or profile fetch after the laptop wakes would go into a dead socket.
  let _pool = null;
  function getPool() {
    if (!_pool) _pool = new NT.SimplePool({ enableReconnect: true });
    return _pool;
  }
  const poolGet = (relays, filter) => getPool().get(relays, filter);

  async function relayUrls(writableOnly) {
    const map = await call({ type: 'SIDECAR_GET_RELAYS' });
    return Object.keys(map).filter((u) => (writableOnly ? map[u].write !== false : true));
  }

  // Is NIP-65-only mode on for THIS account? Per account, not global, because the
  // mode fails closed: one flag governing every account would leave an account with
  // no published relay list unable to read or publish at all.
  async function nip65OnlyFor(pubkey) {
    if (!pubkey) return false;
    try {
      const s = await call({ type: 'SIDECAR_GET_SETTINGS' });
      return !!(s && s.nip65OnlyBy && s.nip65OnlyBy[pubkey]);
    } catch (_) {
      return false; // can't read the setting → behave as if off, which keeps bootstrap
    }
  }

  // Relay set for reading an account's replaceable events (kind:3, kind:0, etc.).
  // The user's configured relays may not carry the freshest copy — NIP-65 declared
  // read relays often do, and purplepag.es aggregates kind:0/3/10002 as a fallback.
  // Without these, a stale or empty kind:3 on a configured relay can hide a healthy
  // 1000+ follow list that the account's NIP-65 relays do have.
  //
  // With NIP-65 only on for the account, configured/Settings relays are excluded —
  // the declared relays are the source of truth. The configured set still seeds the
  // initial NIP-65 fetch (via getNip65's own relayUrls call), but once the list is
  // loaded it doesn't participate in any further reads. purplepag.es stays as a
  // read-only aggregator regardless.
  async function readRelayUrls(pubkey) {
    const nip65 = await getNip65(pubkey);
    const declared = nip65 ? nip65.read : [];
    // Always include purplepag.es — it's a read-only aggregator, not a relay the
    // user publishes to, so it can't serve stale data the way a gossip relay can.
    const base = [...declared, 'wss://purplepag.es'];
    // Fail closed when this account opted out of bootstrap relays: an empty list
    // (genuinely absent, or a fetch that failed) must NOT silently fall back to the
    // relays the user excluded — that's the wrong failure direction for a privacy
    // setting. Per account, so a second account without a relay list is unaffected.
    if (await nip65OnlyFor(pubkey)) return [...new Set(base)];
    return [...new Set([...base, ...(await relayUrls(false))])];
  }

  // Derive the public key (hex) from a pasted nsec/hex secret, locally, so the
  // import modal can preview which account it belongs to before saving. The raw
  // secret is already in the panel's input; this only computes the public half.
  // Returns '' for anything that isn't a valid secret yet.
  function pubkeyFromSecret(secret) {
    try {
      let sk = null;
      if (/^nsec1/i.test(secret)) {
        const d = NT.nip19.decode(secret);
        if (d.type !== 'nsec') return '';
        sk = d.data; // Uint8Array
      } else if (/^[0-9a-f]{64}$/i.test(secret)) {
        sk = new Uint8Array(32);
        for (let i = 0; i < 32; i++) sk[i] = parseInt(secret.substr(i * 2, 2), 16);
      } else {
        return '';
      }
      return NT.getPublicKey(sk) || '';
    } catch (_) {
      return '';
    }
  }

  // Fetch just name + picture from kind 0 for a preview (without storing it).
  // ---- shared kind:0 profile cache ----
  // Many paths need a profile (active profile, import/mention previews, @-mention
  // name resolution). Without sharing, each re-fetches the same kind:0 from every
  // relay. This caches by pubkey with a short TTL (profiles change rarely) and
  // dedupes concurrent fetches, cutting repeat network reads. Invalidated on
  // self-edit so a freshly published profile shows immediately.
  const PROFILE_TTL = 5 * 60 * 1000;
  const _profileCache = new Map();    // pubkey -> { content, name, picture, expiresAt }
  const _profileInflight = new Map(); // pubkey -> Promise
  // Follow count per pubkey (see getFollowCount below). Session-lived with no TTL, so
  // the profile screen's refresh button clears it alongside _profileCache — declared
  // here rather than beside its function so both caches sit together.
  const followCountCache = new Map(); // pubkey -> number|null
  // Whether the collapsible stats drawer under the active account row is open.
  // Defaults open so a single-account panel isn't sparse; the user can collapse it.
  let accountStatsExpanded = true;
  function cacheProfile(pubkey, content) {
    const c = content || {};
    const rec = {
      content: c,
      name: c.display_name || c.displayName || c.name || '',
      picture: c.picture || '',
      expiresAt: Date.now() + PROFILE_TTL,
    };
    _profileCache.set(pubkey, rec);
    return rec;
  }
  function cachedProfile(pubkey) {
    const hit = _profileCache.get(pubkey);
    return hit && hit.expiresAt > Date.now() ? hit : null;
  }
  async function getProfile(pubkey) {
    if (!pubkey) return null;
    const hit = cachedProfile(pubkey);
    if (hit) return hit;
    if (_profileInflight.has(pubkey)) return _profileInflight.get(pubkey);
    const p = (async () => {
      try {
        const relays = await relayUrls(false);
        if (!relays.length) return null;
        const ev = await Promise.race([
          poolGet(relays, { kinds: [0], authors: [pubkey] }),
          new Promise((r) => setTimeout(() => r(null), 6000)),
        ]);
        let content = {};
        if (ev) { try { content = JSON.parse(ev.content) || {}; } catch (_) {} }
        return cacheProfile(pubkey, content); // cache even an absent profile briefly
      } catch (_) {
        return null;
      } finally {
        _profileInflight.delete(pubkey);
      }
    })();
    _profileInflight.set(pubkey, p);
    return p;
  }

  async function fetchPreviewProfile(pubkey) {
    const rec = await getProfile(pubkey);
    if (!rec) return null;
    return { name: rec.name, picture: rec.picture };
  }

  // ---- NIP-65 (kind 10002) relay list, cached per account ----
  const nip65Cache = new Map(); // pubkey -> { read:[], write:[] } | null

  async function getNip65(pubkey) {
    if (!pubkey) return null;
    if (nip65Cache.has(pubkey)) return nip65Cache.get(pubkey);
    let parsed = null;
    let gotEvent = false;
    try {
      const ev = await Promise.race([
        poolGet(await relayUrls(false), { kinds: [10002], authors: [pubkey] }),
        new Promise((res) => setTimeout(() => res(null), 6000)),
      ]);
      if (ev) {
        gotEvent = true;
        const read = [], write = [];
        ev.tags.forEach((t) => {
          if (t[0] !== 'r' || !t[1]) return;
          const marker = t[2];
          if (!marker) { read.push(t[1]); write.push(t[1]); }
          else if (marker === 'read') read.push(t[1]);
          else if (marker === 'write') write.push(t[1]);
        });
        if (read.length || write.length) parsed = { read, write };
      }
    } catch (_) {}
    // Only cache when we received a real event (including an event with no
    // relay tags — that's a genuine "no NIP-65 list"). A timeout or network
    // error leaves the cache cold so the next call retries instead of locking
    // in a null that readRelayUrls/postRelays would treat as "no list."
    if (gotEvent) nip65Cache.set(pubkey, parsed);
    return parsed;
  }

  // Where to publish the active account's events: its NIP-65 write relays UNION the
  // relays configured in Settings.
  //
  // It used to be one or the other — NIP-65 if present, else Settings. That put every
  // post at the mercy of the declared write set: if those relays lapse, gate on a
  // web-of-trust, or simply stop resolving, the note goes nowhere even though a
  // perfectly good relay is configured a few lines away. Publishing to both means a
  // note still lands, and still lands where the account claims to write.
  //
  // The nip65Only toggle is a knowing exception: a user who declares their relay list
  // and enables it accepts the trade-off (publish reaches fewer relays, and a lapsed
  // write relay means the note goes nowhere). Fail closed: when the toggle is on and
  // the NIP-65 list is unknown (fetch failed or genuinely absent), publish to declared
  // relays only — an empty set, which the downstream "no relays reachable" error path
  // will surface. Never silently fall back to bootstrap relays the user opted out of.
  async function postRelays() {
    const n = await getNip65(state.activePubkey);
    const declared = n ? n.write : [];
    if (await nip65OnlyFor(state.activePubkey)) return [...new Set(declared)];
    // No NIP-65 list → fall back to configured so a fresh account can still publish.
    if (!declared.length) return relayUrls(true);
    return [...new Set([...declared, ...(await relayUrls(true))])];
  }

  // A relay that could not be reached is NOT a successful publish. SimplePool.publish()
  // resolves with the string "connection failure: …" instead of rejecting in that case
  // (see nostr-tools.js — vendored and pinned, so this string is stable; re-check it if
  // that file is ever upgraded). Counting settled promises therefore counted dead
  // relays as wins: with enough of them every post reported success while landing
  // nowhere, which is exactly how notes went out with a valid id and reached no one.
  const publishFailed = (r) =>
    r.status === 'rejected' ||
    (typeof r.value === 'string' && r.value.startsWith('connection failure:'));

  async function publishToRelays(relays, signed) {
    if (!relays.length) throw new Error('No relays configured (add some in Settings)');
    // Dedupe the way the pool will. A plain Set over the raw strings keeps
    // 'wss://nos.lol' and 'wss://nos.lol/' as two entries, but SimplePool normalizes
    // before connecting and rejects the second with 'duplicate url' — which then
    // counts as a failed relay and muddies the error detail. Both spellings occur in
    // the wild: NIP-65 tags and relay hints disagree about the trailing slash.
    const targets = [...new Set(relays.map((u) => {
      try { return NT.utils.normalizeURL(u); } catch (_) { return u; }
    }))];
    const results = await Promise.allSettled(getPool().publish(targets, signed));
    const ok = results.filter((r) => !publishFailed(r)).length;
    if (!ok) {
      throw new Error(publishFailureMessage(targets, results));
    }
    return ok;
  }

  // One readable sentence instead of eight stacked "wss://…/: connection failure:
  // connection timed out" lines. The old message pasted every relay's raw error into
  // the toast — a wall of near-identical text that filled the panel and told the user
  // nothing they could act on.
  //
  // Groups by reason, because the reasons repeat: when every relay times out at once
  // the cause is almost never eight simultaneous outages but something local (no
  // network, or Sidecar holding too many connections). Says so, rather than making
  // the user infer it from a list.
  function publishFailureMessage(targets, results) {
    const reasonOf = (r) => {
      const raw = r.status === 'rejected'
        ? (r.reason && r.reason.message) || String(r.reason || 'rejected')
        : String(r.value || 'refused');
      // 'connection failure: connection timed out' → 'timed out'
      if (/timed?\s*out/i.test(raw)) return 'timed out';
      if (/connection failure|failed to connect|websocket/i.test(raw)) return "couldn't connect";
      if (/blocked|restricted|not allowed|forbidden/i.test(raw)) return 'refused the note';
      if (/rate|too many|slow down/i.test(raw)) return 'rate-limited us';
      if (/auth/i.test(raw)) return 'wants authentication';
      // Something specific and short enough to be worth showing verbatim.
      return raw.replace(/^connection failure:\s*/i, '').slice(0, 60);
    };

    const byReason = new Map();
    results.forEach((r, i) => {
      const why = reasonOf(r);
      if (!byReason.has(why)) byReason.set(why, []);
      byReason.get(why).push(hostOf(targets[i]));
    });

    const n = targets.length;
    const relayCount = n === 1 ? 'your relay' : `all ${n} of your relays`;
    // Every relay failed the same way — almost certainly local, so lead with that.
    if (byReason.size === 1) {
      const [why] = [...byReason.keys()];
      if (why === 'timed out' || why === "couldn't connect") {
        return `Couldn't reach ${relayCount}. Check your connection, then try again — your note is saved as a draft.`;
      }
      const subject = n === 1 ? 'Your relay' : `All ${n} relays`;
      return `${subject} ${why}. Your note is saved as a draft.`;
    }

    // Mixed reasons: name each group, capped so the toast stays a toast.
    const parts = [...byReason.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 3)
      .map(([why, hosts]) => {
        const shown = hosts.slice(0, 2).join(', ');
        const more = hosts.length > 2 ? ` +${hosts.length - 2} more` : '';
        return `${shown}${more} ${why}`;
      });
    return `Couldn't publish to any relay — ${parts.join('; ')}. Your note is saved as a draft.`;
  }

  // 'wss://relay.nostr.wine/' → 'relay.nostr.wine'
  function hostOf(url) {
    try { return new URL(url).host; } catch (_) { return String(url).replace(/^wss?:\/\//, '').replace(/\/$/, ''); }
  }

  // Publish an already-signed event to the account's write relays (NIP-65 → configured).
  async function publishSigned(signed) {
    return publishToRelays(await postRelays(), signed);
  }

  // ---- web comments (NIP-22 kind 1111 over a NIP-73 "web" target) -------------
  //
  // Comment on any page you're looking at. The event is a kind:1111 whose scope is
  // the page URL, which is how Jumble's external-content view finds it.
  //
  // Tag shape is taken from a REAL Jumble comment, fetched and decoded rather than
  // inferred from the spec — uppercase is the root scope, lowercase the parent, and
  // for a top-level comment they're the same:
  //
  //   ["I", url] ["K", "web"] ["i", url] ["k", "web"]
  //
  // The identifier is the URL itself, so normalization decides whether two people
  // commenting on the same page land in the same thread. Getting it wrong doesn't
  // error — it silently splits the conversation.
  const WEB_COMMENT_KIND = 1111;

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
  const HOST_TRACKING_PARAMS = [
    { host: /(^|\.)(youtube\.com|youtu\.be)$/i, params: ['si', 'pp', 'feature', 'kw'] },
  ];

  // Case-insensitive: the same vendor ships both `ScCid` and `sccid`, and a param
  // that survives on a capital letter splits the thread just as effectively.
  function isTrackingParam(name) {
    const n = String(name).toLowerCase();
    return TRACKING_PARAMS.includes(n) || TRACKING_PREFIXES.some((p) => n.startsWith(p));
  }

  // Reduce a page URL to the identifier the comment is tagged with.
  // Returns { url } or { error } — never throws, and never guesses on refusal.
  //
  // Deliberately NOT nostr-tools' utils.normalizeURL: that one is built for relay
  // URLs and rewrites https:// to wss://, which would tag every comment with an
  // address that threads with nothing.
  function normalizeWebUrl(raw) {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch (_) { return { error: 'That is not a URL Sidecar can comment on.' }; }
    // Only real web pages. chrome://, about:, moz-extension:// and friends aren't
    // public documents, and file:// would publish a path from this machine to a
    // relay — which is a privacy leak, not a comment.
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return { error: 'Only http and https pages can be commented on.' };
    }
    if (!u.hostname || u.hostname === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)) {
      return { error: 'That page is local, so nobody else could open the comment.' };
    }
    u.hash = ''; // NIP-73 requires no fragment: #section is the same document
    // Snapshot the keys first: deleting while iterating searchParams skips entries.
    for (const name of [...u.searchParams.keys()]) {
      if (isTrackingParam(name)) u.searchParams.delete(name);
    }
    for (const rule of HOST_TRACKING_PARAMS) {
      if (rule.host.test(u.hostname)) for (const p of rule.params) u.searchParams.delete(p);
    }
    // The query itself stays — for plenty of sites it IS the page identity
    // (youtube.com/watch?v=…), so stripping it would merge unrelated pages.
    u.searchParams.sort(); // ?b=1&a=2 and ?a=2&b=1 are the same page
    let out = u.toString();
    // A bare origin normalizes to a trailing slash; a path shouldn't gain one.
    if (u.pathname !== '/' && out.endsWith('/')) out = out.slice(0, -1);
    return { url: out };
  }

  // If the tab is already a Jumble external-content view, comment on the ARTICLE it
  // is showing rather than on the Jumble URL.
  //
  // Without this, reading a thread on Jumble and then commenting from Sidecar starts
  // a second thread addressed to `jumble.social/external-content?id=…` — which is a
  // different identifier, so it never joins the conversation the user is looking at.
  // Silent and confusing; caught because a screenshot happened to be taken on that
  // exact page.
  function unwrapJumbleTarget(raw) {
    try {
      const u = new URL(String(raw || ''));
      if (!/(^|\.)jumble\.social$/i.test(u.hostname)) return raw;
      if (u.pathname !== '/external-content') return raw;
      const inner = u.searchParams.get('id');
      // Only unwrap to something that is itself a web page — an `id` of anything
      // else (an npub, a note, junk) is left alone for normalizeWebUrl to refuse.
      if (inner && /^https?:\/\//i.test(inner)) return inner;
      return raw;
    } catch (_) { return raw; }
  }

  // `p` tags for every profile mentioned in the text, deduped and in order.
  //
  // This is what makes a mention reach the person mentioned: notification discovery
  // is `{'#p': [pubkey]}` (see the bell's own filter), so a mention with no p tag
  // renders for every reader and is invisible to its target. Shared by notes and
  // comments — it was inline in the note composer, and duplicating it is how the two
  // drifted apart in the first place.
  function mentionPTags(content) {
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
  // quoted authors (the caller p-tags them — see doPublish).
  //
  // A bech32 reference in the content is not, on its own, a quote: without the `q` tag
  // the note goes out as plain text with a 210-character string in the middle of it.
  // Clients key quote rendering off `q`, the quoted author is never notified, and
  // Sidecar's OWN notification list does exactly that (notificationKind's hasQ, which
  // is how "quoted your note" is told apart from a reply) — so a quote composed here
  // didn't read as a quote even in Sidecar.
  //
  // note/nevent quote by event id; naddr quotes by "kind:pubkey:d" coordinate, since an
  // addressable event's id changes with every edit.
  const BODY_REF_RE = /nostr:(note1[0-9a-z]+|nevent1[0-9a-z]+|naddr1[0-9a-z]+)/g;
  function quoteTags(content) {
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

  // `includeClientTag` comes from the same Settings toggle that governs notes, so
  // the switch means what it says rather than covering only kind 1. Verified that
  // Jumble renders it: ReplyNote and NotePage both mount <ClientTag> with no kind
  // gate, so this shows as "via Sidecar" beside the name in a thread.
  function buildWebComment(url, content, includeClientTag) {
    // Root and parent are identical: this is a top-level comment on the page, not a
    // reply to another comment.
    const tags = [['I', url], ['K', 'web'], ['i', url], ['k', 'web']];
    // Then who's involved, so a mention actually notifies the person mentioned.
    tags.push(...mentionPTags(content));
    // Appended rather than prepended (notes put it first): these four scope tags are
    // what was verified byte-for-byte against a real Jumble comment, so keeping them
    // as the leading shape means a future diff against one stays clean. The client
    // tag is metadata and position carries no meaning — readers use find().
    if (includeClientTag) tags.push(CLIENT_TAG.slice());
    return {
      kind: WEB_COMMENT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: content,
    };
  }

  // Jumble is where these are actually readable — most clients don't render
  // kind:1111 over a web target at all, which is why both links point there.
  const jumbleThreadUrl = (url) =>
    'https://jumble.social/external-content?id=' + encodeURIComponent(url);
  const jumbleNoteUrl = (nevent) => 'https://jumble.social/notes/' + nevent;

  // The URL of the page the user is looking at. Read only when the comment panel
  // is opened — never speculatively — because it's about to be published.
  function activeTabUrl() {
    return new Promise((resolve) => {
      if (!(chrome.tabs && chrome.tabs.query)) return resolve(null);
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve((tabs && tabs[0] && tabs[0].url) || null);
        });
      } catch (_) { resolve(null); }
    });
  }

  // Build and publish a NIP-65 (kind:10002) relay list from the editor's model:
  // [{ url, read, write }]. A relay with both markers gets a plain ['r', url]
  // tag (per spec, no marker = both); otherwise the single applicable marker.
  // Relays with neither checked are dropped instead of leaking a stray marker.
  async function publishNip65(pubkey, relayList) {
    const active = relayList.filter((r) => r.read || r.write);
    const tags = active.map((r) => {
      if (r.read && r.write) return ['r', r.url];
      return r.write ? ['r', r.url, 'write'] : ['r', r.url, 'read'];
    });
    const event = { kind: 10002, created_at: Math.floor(Date.now() / 1000), tags, content: '' };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event });

    // Publish to the union of: relays that already carry the account's prior
    // list (so anyone relying on it still sees the update), the relays now
    // marked write in the NEW list (so it lands where the account claims to
    // write), and the app's configured relays as a safety net.
    const prior = nip65Cache.get(pubkey);
    const newWrite = active.filter((r) => r.write).map((r) => r.url);
    const fallback = await relayUrls(true);
    const targets = [...new Set([...(prior ? prior.write : []), ...newWrite, ...fallback])];
    const ok = await publishToRelays(targets, signed);
    nip65Cache.delete(pubkey); // invalidate so getNip65()/postRelays() refetch fresh
    return ok;
  }

  // pubkey → { tries, at, settled }. `settled` means stop asking: either the profile
  // landed, or the relays gave a definitive answer that there's nothing to store.
  const profileFetchState = new Map();
  const PROFILE_FETCH_MAX_TRIES = 3;
  const PROFILE_FETCH_COOLDOWN_MS = 15000;

  // Returns true when the question is answered for good, false when it's worth
  // asking again. The distinction is the point: a relay timeout is transient, an
  // empty kind:0 is not.
  async function fetchAndStoreProfile(pubkey) {
    try {
      const relayMap = await call({ type: 'SIDECAR_GET_RELAYS' });
      const relays = Object.keys(relayMap || {});
      if (!relays.length) return false; // nothing configured yet — try again later
      const ev = await Promise.race([
        poolGet(relays, { kinds: [0], authors: [pubkey] }),
        new Promise((res) => setTimeout(() => res(null), 6000)),
      ]);
      // No event may mean "no profile" OR "the relays were slow" — and after a vault
      // import, with several of these in flight at once, slow is common. Retryable.
      if (!ev) return false;
      seedBaseline(pubkey, ev); // free ride — see seedBaseline
      let meta = {};
      try { meta = JSON.parse(ev.content) || {}; } catch (_) { return true; } // malformed: asking again won't help
      const name = meta.display_name || meta.displayName || meta.name || '';
      const picture = meta.picture || '';
      if (!name && !picture) return true; // a real answer: this profile has neither
      await call({ type: 'SIDECAR_SET_PROFILE', pubkey, name, picture });
      state = await call({ type: 'SIDECAR_GET_STATE' });
      if (!state.locked) renderMain();
      return true;
    } catch (_) {
      return false; // offline / transport error — retryable
    }
  }

  // Bounded retries, because the old version marked a pubkey as attempted BEFORE
  // fetching and never cleared it on failure. One transient miss — a timeout, three
  // concurrent queries competing after a vault import, a profile not yet propagated —
  // permanently blocked that account's avatar for the rest of the panel session. It
  // looked like a storage bug, and the giveaway was that reloading the extension
  // fixed it: a fresh Set, so the fetch got a second chance it should have had anyway.
  //
  // Capped and cooled down rather than retried freely: renderMain() runs on plenty of
  // events, and an unbounded retry would turn a burst of renders into a burst of
  // relay queries.
  function maybeFetchProfile(pubkey) {
    const s = profileFetchState.get(pubkey);
    if (s) {
      if (s.settled) return;
      if (s.tries >= PROFILE_FETCH_MAX_TRIES) return;
      if (Date.now() - s.at < PROFILE_FETCH_COOLDOWN_MS) return;
    }
    profileFetchState.set(pubkey, { tries: (s ? s.tries : 0) + 1, at: Date.now(), settled: false });
    fetchAndStoreProfile(pubkey).then((settled) => {
      const cur = profileFetchState.get(pubkey);
      if (cur && settled) cur.settled = true;
    });
  }

  // Does this account still need its name/picture pulled from kind:0?
  //
  // EITHER field missing is enough — not both. The earlier `!a.name && !a.picture`
  // treated a name with no picture as a complete profile, and vault import
  // produces exactly that: keystore writes `picture: ''` and never sets
  // placeholderName, so a restored account kept the placeholder avatar in the
  // chip and dropdown permanently, with no reload able to clear it.
  //
  // Over-fetching is cheap and bounded — maybeFetchProfile caps tries per pubkey and
  // marks a definitive answer as settled, so an account whose kind:0 genuinely carries
  // no picture costs one attempt per panel session, not one per render.
  function needsProfileBackfill(a) {
    if (!a) return false;
    return !!a.placeholderName || !a.name || !a.picture;
  }

  // ---- notification bell ----

  async function loadNotifSeen() {
    if (_notifSeenLoaded) return;
    _notifSeenLoaded = true;
    try {
      const r = await new Promise((res) => chrome.storage.local.get('sidecar_notif_seen', res));
      _notifSeenAt = (r && r.sidecar_notif_seen) || {};
    } catch (_) {}
  }

  async function saveNotifSeen(pubkey, ts) {
    _notifSeenAt[pubkey] = ts;
    try {
      await new Promise((res) =>
        chrome.storage.local.set({ sidecar_notif_seen: _notifSeenAt }, res)
      );
    } catch (_) {}
  }

  function notifUnseenCount(pubkey) {
    const cache = _notifCache.get(pubkey);
    if (!cache || !cache.events.length) return 0;
    const seenAt = _notifSeenAt[pubkey] || 0;
    return cache.events.filter((ev) => ev.created_at > seenAt).length;
  }

  function refreshBell() {
    const btn = $('notif-bell-btn');
    if (!btn) return;
    const pubkey = state?.activePubkey;
    const count = pubkey ? notifUnseenCount(pubkey) : 0;
    const badge = btn.querySelector('.notif-badge');
    if (!badge) return;
    badge.textContent = count > 99 ? '99+' : count > 0 ? String(count) : '';
    badge.classList.toggle('hidden', count === 0);
  }

  function relativeTime(ts) {
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 7 * 86400) return Math.floor(diff / 86400) + 'd ago';
    // Beyond a week it's a date, and a date without a year reads as this year —
    // "Mar 4" on something from 2024 is a quiet lie. Year only when it differs.
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric',
      year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    });
  }

  function notifLabel(ev) {
    if (ev.kind === 9735) {
      let sats = '';
      try {
        const descTag = ev.tags.find((t) => t[0] === 'description');
        if (descTag) {
          const inner = JSON.parse(descTag[1]);
          const amtTag = inner.tags && inner.tags.find((t) => t[0] === 'amount');
          if (amtTag) sats = Math.round(parseInt(amtTag[1], 10) / 1000) + ' sats';
        }
      } catch (_) {}
      return { glyph: '⚡', text: sats ? 'zapped ' + sats : 'zapped you' };
    }
    if (ev.kind === 6) return { glyph: '🔁', text: 'reposted your note' };
    if (ev.kind === 7) {
      const r = (ev.content || '').trim();
      const glyph = r === '+' ? '❤️' : r === '-' ? '👎' : r.length <= 4 && r ? r : '❤️';
      return { glyph, text: 'reacted to your note' };
    }
    // A NIP-22 comment that p-tags you. Worth its own wording: "mentioned you" sends
    // the reader looking for a note, and this is a comment on a page.
    if (ev.kind === WEB_COMMENT_KIND) return { glyph: '@', text: 'mentioned you in a comment' };
    // kind 1
    const hasQ = ev.tags.some((t) => t[0] === 'q' && t[1]); // NIP-18 quote repost
    // Ornamental quote mark (U+275D) — a text glyph like the '@' below, so it
    // inherits the light text color. The speech-bubble emoji (🗨️) rendered
    // near-black on the panel background.
    if (hasQ) return { glyph: '❝', text: 'quoted your note' };
    const hasE = ev.tags.some((t) => t[0] === 'e');
    return hasE
      ? { glyph: '💬', text: 'replied to your note' }
      : { glyph: '@', text: 'mentioned you' };
  }

  // The actual zapper for a kind:9735 receipt — the receipt's own pubkey is the
  // LNURL zap service, not the person. Prefer the `P` tag, then the embedded zap
  // request's pubkey; fall back to the receipt pubkey. For non-zaps, just the author.
  function zapSender(ev) {
    if (ev.kind !== 9735) return ev.pubkey;
    const P = ev.tags.find((t) => t[0] === 'P' && t[1]);
    if (P) return P[1];
    const desc = ev.tags.find((t) => t[0] === 'description');
    if (desc) {
      try { const r = JSON.parse(desc[1]); if (r && r.pubkey) return r.pubkey; } catch (_) {}
    }
    return ev.pubkey;
  }

  // Resolve where a notification should open, as a full client URL — always
  // something the client can actually render. A reply/mention opens the note
  // itself; a reaction/repost/zap opens the note (or article) it refers to.
  // Crucially, a *profile* zap (no e/a tag — zapping a person, not a note) opens
  // a PROFILE rather than the kind:9735 receipt, which clients like Jumble show
  // as "note not found". For zaps we also read the embedded zap request, since
  // the e/a/p tags and the zapper live there. Returns '' when there's no sensible
  // target (card just isn't clickable then).
  function notifLink(ev, client, acctPubkey) {
    try {
      // kind 1 (reply/mention) → the note itself. Same for a kind 1111 comment: it
      // carries I/i scope tags rather than `e`, so every branch below would miss it
      // and the row would render with no link at all.
      if (ev.kind === 1 || ev.kind === WEB_COMMENT_KIND) {
        return client.url(NT.nip19.neventEncode({ id: ev.id, author: ev.pubkey, relays: [] }));
      }

      let tags = ev.tags;
      let zapper = '';
      if (ev.kind === 9735) {
        zapper = zapSender(ev);
        const descTag = ev.tags.find((t) => t[0] === 'description');
        if (descTag) {
          try {
            const req = JSON.parse(descTag[1]);
            if (req && Array.isArray(req.tags)) tags = ev.tags.concat(req.tags);
          } catch (_) {}
        }
      }

      // A referenced note (reacted/reposted/zapped note, or reply target).
      const eTag = tags.filter((t) => t[0] === 'e' && t[1]).pop();
      if (eTag) {
        const pTag = tags.find((t) => t[0] === 'p' && t[1]); // note author = recipient
        return client.url(NT.nip19.neventEncode({ id: eTag[1], author: pTag ? pTag[1] : acctPubkey, relays: [] }));
      }

      // A referenced addressable event (e.g. a long-form article).
      const aTag = tags.filter((t) => t[0] === 'a' && t[1]).pop();
      if (aTag) {
        const parts = aTag[1].split(':');
        const kind = parseInt(parts[0], 10);
        if (parts[1] && !Number.isNaN(kind)) {
          return client.url(NT.nip19.naddrEncode({ kind, pubkey: parts[1], identifier: parts[2] || '', relays: [] }));
        }
      }

      // No note/article — a profile zap. Open a profile (renders everywhere):
      // the zapper if we know them, else the recipient.
      if (ev.kind === 9735) {
        const recipient = (tags.find((t) => t[0] === 'p' && t[1]) || [])[1];
        const who = zapper || recipient || acctPubkey;
        if (who) return client.profile(NT.nip19.npubEncode(who));
      }
    } catch (_) {}
    return '';
  }

  function notifAuthorName(pubkey) {
    const cached = _notifProfiles.get(pubkey);
    if (typeof cached === 'string' && cached) return cached;
    try { return shortNpub(NT.nip19.npubEncode(pubkey)); } catch (_) { return '—'; }
  }

  function prefetchNotifProfile(pubkey, relays) {
    if (_notifProfiles.has(pubkey)) return Promise.resolve();
    _notifProfiles.set(pubkey, ''); // mark as loading
    return poolGet(relays, { kinds: [0], authors: [pubkey] }).then((ev) => {
      if (!ev) return;
      const m = JSON.parse(ev.content) || {};
      _notifProfiles.set(pubkey, m.display_name || m.displayName || m.name || '');
    }).catch(() => {});
  }

  const IMG_RE = /https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|avif)(?:\?\S*)?/gi;
  const AV_RE = /https?:\/\/\S+\.(?:mp4|mov|webm|m3u8|mp3|wav|m4a|ogg)(?:\?\S*)?/gi;

  // Pull media URLs out of note content so they can render as previews instead
  // of as raw links in the text snippet.
  function extractMedia(content) {
    const images = content.match(IMG_RE) || [];
    const av = content.match(AV_RE) || [];
    return { images, av };
  }

  function cleanSnippet(content) {
    return content
      .replace(/nostr:(npub1\S+|nprofile1\S+)/g, (_, entity) => {
        try {
          const decoded = NT.nip19.decode(entity);
          const pk = decoded.type === 'npub' ? decoded.data : decoded.data && decoded.data.pubkey;
          if (pk) {
            const name = _notifProfiles.get(pk);
            if (name) return '@' + name;
            return '@' + entity.slice(0, 12) + '…';
          }
        } catch (_) {}
        return '@…';
      })
      .replace(/nostr:note1\S+/g, '[note]')
      .replace(/nostr:nevent1\S+/g, '[note]')
      .replace(/nostr:naddr1\S+/g, '[article]')
      .replace(IMG_RE, '') // shown as thumbnails
      .replace(AV_RE, '') // shown as a media chip
      .replace(/https?:\/\/([^\s/]+)\S*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ---- mute matching ----
  // A NIP-51 mute list carries four kinds of entry and this panel only ever read
  // one of them. `p` is people, `t` is hashtags, `word` is muted words, `e` is
  // muted threads; a list written by Amethyst or Jumble routinely has all four,
  // and the three we ignored simply did nothing here. Everything is lowercased on
  // the way in so matching never has to think about case again.
  const emptyMuteSet = () => ({ pubkeys: new Set(), hashtags: new Set(), words: [], threads: new Set(), size: 0 });

  function collectMuteTags(tags, into) {
    for (const t of tags || []) {
      if (!Array.isArray(t) || !t[1]) continue;
      const v = String(t[1]);
      if (t[0] === 'p') into.pubkeys.add(v);
      else if (t[0] === 't') into.hashtags.add(v.replace(/^#/, '').toLowerCase());
      else if (t[0] === 'word') into.words.push(v.toLowerCase());
      else if (t[0] === 'e') into.threads.add(v);
    }
    into.size = into.pubkeys.size + into.hashtags.size + into.words.length + into.threads.size;
    return into;
  }

  // Word characters, for deciding where a muted term is allowed to match. Unicode
  // aware on purpose: a mute list is not going to be all ASCII.
  const MUTE_WORDISH = /[\p{L}\p{N}_]/u;
  const isWordish = (s) => !!s && [...s].every((c) => MUTE_WORDISH.test(c));

  // A single word matches on word boundaries; anything else (a phrase, an emoji,
  // something with punctuation) matches as a plain substring. Muting "ass" should
  // not silence a note about a class, but muting "gm " or "🔥" has no boundaries
  // to speak of and the user clearly meant the literal text.
  function mutedTermHit(haystack, needle) {
    if (!needle || !haystack) return false;
    if (!isWordish(needle)) return haystack.includes(needle);
    let i = haystack.indexOf(needle);
    while (i !== -1) {
      const before = haystack[i - 1];
      const after = haystack[i + needle.length];
      if ((before === undefined || !MUTE_WORDISH.test(before))
          && (after === undefined || !MUTE_WORDISH.test(after))) return true;
      i = haystack.indexOf(needle, i + 1);
    }
    return false;
  }

  // A hashtag typed into the text without the client adding a `t` tag. Common
  // enough that checking only the tag would let half of them through.
  function mutedHashtagInText(text, tag) {
    const lit = '#' + tag;
    let i = text.indexOf(lit);
    while (i !== -1) {
      const after = text[i + lit.length];
      if (after === undefined || !MUTE_WORDISH.test(after)) return true;
      i = text.indexOf(lit, i + 1);
    }
    return false;
  }

  // What a notification actually SAYS, and what it references. For a zap receipt
  // both live in the embedded zap request rather than on the receipt: the receipt's
  // own content is empty and its tags belong to the LNURL service, while the
  // comment the user reads and the note being zapped are inside `description`.
  // Checking the receipt alone would mute nothing on a zap.
  function muteSubject(ev) {
    let text = ev.content || '';
    let tags = ev.tags || [];
    if (ev.kind === 9735) {
      const desc = (ev.tags || []).find((t) => t[0] === 'description');
      if (desc) {
        try {
          const req = JSON.parse(desc[1]);
          if (req && typeof req === 'object') {
            text = req.content || '';
            tags = tags.concat(Array.isArray(req.tags) ? req.tags : []);
          }
        } catch (_) {}
      }
    }
    return { text: text.toLowerCase(), tags };
  }

  function isMutedNotif(mute, ev) {
    if (!mute || !mute.size || !ev) return false;
    // zapSender, not ev.pubkey: a zap receipt is authored by the LNURL service, so
    // testing the receipt's author meant muting a person never hid their zaps.
    if (mute.pubkeys.size && mute.pubkeys.has(zapSender(ev))) return true;
    if (mute.pubkeys.size && mute.pubkeys.has(ev.pubkey)) return true;

    const { text, tags } = muteSubject(ev);

    if (mute.threads.size) {
      if (mute.threads.has(ev.id)) return true;
      for (const t of tags) {
        // e = the thread, q = a quote of it, E = the NIP-22 root of a comment
        if ((t[0] === 'e' || t[0] === 'q' || t[0] === 'E') && t[1] && mute.threads.has(t[1])) return true;
      }
    }
    if (mute.hashtags.size) {
      for (const t of tags) {
        if (t[0] === 't' && t[1] && mute.hashtags.has(String(t[1]).replace(/^#/, '').toLowerCase())) return true;
      }
      for (const tag of mute.hashtags) if (mutedHashtagInText(text, tag)) return true;
    }
    if (mute.words.length) {
      for (const w of mute.words) if (mutedTermHit(text, w)) return true;
      // The sender's display name — the string the notification row actually
      // shows. A word mute that only scans note text is blind to the one place a
      // sender fully controls and a reader sees first: a note can read as an
      // ordinary greeting while the row announces the thing the user asked never
      // to see. Rotating-key campaigns rely on exactly that split, which is why
      // the match has to cover the name and not just the body.
      //
      // Same sender identity as the pubkey checks above (zapSender), so the name
      // tested is the name displayed — for a zap that is the zapper, not the
      // LNURL service that signed the receipt.
      //
      // The name arrives from a separate fetch and often after the event, so this
      // arm cannot fire until the profile is cached. The late-arriving match is
      // pruned when the profile resolves (pruneNameMuted), which re-runs this
      // same check against the cache.
      const name = _notifProfiles.get(zapSender(ev));
      if (name) for (const w of mute.words) if (mutedTermHit(name.toLowerCase(), w)) return true;
    }
    return false;
  }

  // Re-check an account's cached notifications against whatever is known NOW —
  // the mute list and the sender profiles both — and drop what has become
  // muted. A name match cannot fire before the profile resolves, so this is the
  // authoritative pass, run whenever either half lands late: after the mute list
  // (loadMuteList), after a sender profile (addEvent's prefetch continuation),
  // or during the bell modal's reconciliation. Keeps the unseen count and the
  // next open honest, and pulls the row out of a bell that is open right now.
  function pruneNameMuted(pubkey) {
    const mute = _muteLists.get(pubkey);
    if (!mute || !mute.size) return;
    const cache = _notifCache.get(pubkey);
    if (!cache || !cache.events.length) return;
    const keep = cache.events.filter((e) => !isMutedNotif(mute, e));
    if (keep.length === cache.events.length) return;
    cache.events = keep;
    if (pubkey === state?.activePubkey) refreshBell();
    if (_openNotifBell && _openNotifBell.pubkey === pubkey) {
      // Re-checked against the EVENT, not the row's author: words, hashtags and
      // threads are properties of the note, and a zap's row carries the LNURL
      // service's pubkey rather than the zapper's.
      const ids = new Set(keep.map((e) => e.id));
      _openNotifBell.list.querySelectorAll('.notif-item[data-notif-id]').forEach((el) => {
        if (!ids.has(el.dataset.notifId)) el.remove();
      });
    }
  }

  // Load an account's mute list (kind 10000) — newest replaceable event across
  // relays, including both public p-tag mutes and private mutes encrypted in the
  // content. Private mutes may be NIP-04 (legacy NIP-51) or NIP-44 (newer clients
  // like Jumble) encrypted to self — try the format the ciphertext looks like,
  // then fall back to the other. Deduped per pubkey via a promise cache; when it
  // resolves it also drops any already-cached events from muted authors.
  //
  // The promise cache never expired on its own, so a mute added elsewhere after
  // the panel loaded (a long-lived pinned panel can run for hours) was invisible
  // for the rest of the session — the bell kept using the pre-mute list forever.
  // `force` (used when the bell is opened) bypasses the cache for a fresh fetch.
  function loadMuteList(pubkey, relays, force) {
    if (_muteListPromises.has(pubkey) && !force) return _muteListPromises.get(pubkey);
    const p = (async () => {
      const muted = emptyMuteSet();
      try {
        const evs = await getPool().querySync(relays, { kinds: [10000], authors: [pubkey] });
        const ev = (evs || []).sort((x, y) => y.created_at - x.created_at)[0];
        if (ev) {
          seedBaseline(pubkey, ev); // free ride — see seedBaseline
          collectMuteTags(ev.tags, muted);
          if (ev.content) {
            // NIP-04 ciphertext is "<base64>?iv=<base64>"; NIP-44 is a single
            // base64 blob. Try the matching scheme first, then the other.
            const order = ev.content.includes('?iv=') ? [4, 44] : [44, 4];
            for (const nip of order) {
              try {
                const plain = await call({ type: 'SIDECAR_OWNER_DECRYPT', ciphertext: ev.content, nip });
                const privateTags = JSON.parse(plain);
                if (Array.isArray(privateTags)) {
                  collectMuteTags(privateTags, muted);
                  break;
                }
              } catch (_) {}
            }
          }
        }
      } catch (_) {}
      _muteLists.set(pubkey, muted);
      // Drop any events that slipped into the cache before the list was ready
      // (first load), or that arrived from a user muted after the fact (a
      // later, force-triggered re-fetch when the bell is opened). pruneNameMuted
      // is the same re-check this always was — text, hashtags, threads, people —
      // now also name-aware, and clears an open bell's rows too.
      pruneNameMuted(pubkey);
      return muted;
    })();
    _muteListPromises.set(pubkey, p);
    return p;
  }

  // The account's most recent kind:1 note ids (not bounded by the notification
  // backfill window — a repost/quote happening now can reference a much older
  // note). Reposts (kind:6) and NIP-18 quote reposts (kind:1 with a `q` tag)
  // reference the original note by id via an `e`/`q` tag — a `p` tag naming the
  // author is only a convention, not required, so some clients omit it. Knowing
  // our own note ids lets the subscription match on the `e`/`q` tag directly and
  // catch those reposts/quotes even when the author isn't tagged.
  function loadOwnNoteIds(pubkey, relays) {
    if (_ownNoteIdsPromises.has(pubkey)) return _ownNoteIdsPromises.get(pubkey);
    const p = (async () => {
      const ids = new Set();
      try {
        const evs = await getPool().querySync(relays, { kinds: [1], authors: [pubkey], limit: 150 });
        (evs || [])
          .sort((x, y) => y.created_at - x.created_at)
          .slice(0, 150)
          .forEach((e) => ids.add(e.id));
      } catch (_) {}
      _ownNoteIds.set(pubkey, ids);
      return ids;
    })();
    _ownNoteIdsPromises.set(pubkey, p);
    return p;
  }

  // Close the live notification subscriptions for every account except `keepPubkey`.
  // Without this they accumulated for the life of the panel: initNotifSubs subscribed
  // for EVERY account, each with three filters, across every configured relay — with
  // 3 accounts and 8 relays that's 144 concurrent REQs on one shared pool. Relays cap
  // subscriptions per connection (paid ones like nostr.wine more tightly), so past the
  // limit they stop answering or drop the socket, and a publish then fails on every
  // relay at once with 'connection timed out' — which reads as an outage but is
  // Sidecar exhausting its own connections.
  function closeNotifSubsExcept(keepPubkey) {
    for (const [pk, cache] of _notifCache) {
      if (pk === keepPubkey) continue;
      if (cache && cache.liveSub) {
        try { cache.liveSub.close(); } catch (_) {}
        cache.liveSub = null;
      }
    }
  }

  async function initNotifSubs() {
    if (!state || !state.accounts || state.accounts.length === 0) return;
    await loadNotifSeen();
    const relays = await relayUrls(false);
    if (!relays.length) return;
    const since = Math.floor(Date.now() / 1000) - 7 * 24 * 3600; // notification backfill window

    // Only the ACTIVE account. refreshBell() reads state.activePubkey and nothing
    // renders an unseen count for any other account, so subscribing for the rest
    // bought nothing and cost a multiple of every relay connection. Switching
    // accounts calls this again, which subscribes the new one and drops the old.
    const active = state.accounts.find((a) => a.pubkey === state.activePubkey);
    if (!active) return;
    closeNotifSubsExcept(active.pubkey);

    for (const a of [active]) {
      if (_notifCache.has(a.pubkey) && _notifCache.get(a.pubkey).liveSub) continue;

      // Load mutes and own note ids BEFORE subscribing so addEvent filters from
      // the first event and the repost/quote filters below are ready. Cap the
      // wait so a slow relay can't stall notifications — the fetches keep
      // running and mutes prune the cache once it lands.
      const [, ownIds] = await Promise.all([
        Promise.race([loadMuteList(a.pubkey, relays), new Promise((r) => setTimeout(r, 5000))]),
        Promise.race([loadOwnNoteIds(a.pubkey, relays), new Promise((r) => setTimeout(() => r(new Set()), 5000))]),
      ]);

      // Reuse the existing cache when re-subscribing after an account switch — a
      // fresh object would throw away every notification already collected for this
      // account and reset its unseen count to zero.
      const cache = _notifCache.get(a.pubkey) || { events: [], liveSub: null };
      _notifCache.set(a.pubkey, cache);

      const addEvent = (ev) => {
        if (ev.pubkey === a.pubkey) return;
        if (isMutedNotif(_muteLists.get(a.pubkey), ev)) return;
        if (cache.events.some((e) => e.id === ev.id)) return;
        cache.events.push(ev);
        cache.events.sort((x, y) => y.created_at - x.created_at);
        if (cache.events.length > 100) cache.events.length = 100;
        // zapSender: fetch the profile of whoever the row will NAME — for a zap
        // that is the zapper, not the LNURL service that signed the receipt.
        // When it resolves, pruneNameMuted re-checks this event against the
        // now-known name, so a sender whose keyword lives only in their display
        // name disappears as soon as the name does — badge and open bell both.
        prefetchNotifProfile(zapSender(ev), relays).then(() => pruneNameMuted(a.pubkey));
        if (a.pubkey === state?.activePubkey) refreshBell();
        // The notif modal for this account is open right now — append the new
        // event to the visible list instead of leaving it to only show up the
        // next time the modal is reopened.
        if (_openNotifBell && _openNotifBell.pubkey === a.pubkey) {
          _openNotifBell.clearEmptyMessage();
          _openNotifBell.list.prepend(_openNotifBell.buildItem(ev));
          // The first live arrival into a bell that opened empty is what turns "nothing
          // here" into a list, and nothing else was going to mark the end of it.
          _openNotifBell.showEndNote();
        }
      };

      // Mentions/replies/reactions/zaps tagging the account, plus reposts
      // (kind:6, `e` tag) and quote reposts (kind:1, `q` tag) of the account's
      // own notes — matched by id so they're caught even without a `p` tag.
      const ownIdList = [...ownIds];
      function buildFilters(sinceTs, limit) {
        // 1111 is a NIP-22 comment (e.g. on a web page). Included so a mention inside
        // one reaches you: Sidecar writes p tags on comments now, and not querying
        // them would leave it a client that can send a mention but never receive one.
        const base = { kinds: [1, 6, 7, 1111, 9735], '#p': [a.pubkey], since: sinceTs };
        const list = [limit ? Object.assign({ limit }, base) : base];
        if (ownIdList.length) {
          const repost = { kinds: [6], '#e': ownIdList, since: sinceTs };
          const quote = { kinds: [1], '#q': ownIdList, since: sinceTs };
          list.push(limit ? Object.assign({ limit }, repost) : repost);
          list.push(limit ? Object.assign({ limit }, quote) : quote);
        }
        return list;
      }

      const liveSince = Math.floor(Date.now() / 1000);
      // nostr-tools ≥2.20 subscriptions take a single filter object, not an array —
      // open one subscription per filter (the pool shares the relay sockets).
      try {
        for (const f of buildFilters(since, 50)) {
          getPool().subscribeManyEose(relays, f, { onevent: addEvent });
        }
      } catch (_) {}
      try {
        const subs = buildFilters(liveSince).map((f) =>
          getPool().subscribeMany(relays, f, { onevent: addEvent })
        );
        cache.liveSub = { close: () => subs.forEach((s) => { try { s.close(); } catch (_) {} }) };
      } catch (_) {}
    }
  }

  async function showNotifModal(a) {
    const seenAt = _notifSeenAt[a.pubkey] || 0;
    const cache = _notifCache.get(a.pubkey) || { events: [] };
    const now = Math.floor(Date.now() / 1000);
    await saveNotifSeen(a.pubkey, now);
    refreshBell();

    const client = await preferredClient();
    const relays = await relayUrls(false);

    // Open with whatever's already cached — instant, no relay round-trip — using
    // the mute list from the last load/refresh. A fresh mute check and any
    // missing sender names are resolved in the background after the modal is
    // already open and interactive (see below), instead of blocking the modal
    // from appearing at all.
    const muted = _muteLists.get(a.pubkey);
    const events = muted && muted.size ? cache.events.filter((e) => !isMutedNotif(muted, e)) : cache.events;
    const PAGE = 25;

    function buildItem(ev) {
      const isNew = ev.created_at > seenAt;
      const { glyph, text } = notifLabel(ev);

      // Where this notification opens (a renderable note/article/profile URL), or
      // '' when there's no sensible target.
      const linkTarget = notifLink(ev, client, a.pubkey);

      // The whole card is the click target — open it in the preferred client.
      const item = linkTarget
        ? h('a', {
            className: 'notif-item notif-clickable' + (isNew ? ' notif-new' : ''),
            href: linkTarget,
            target: '_blank',
            rel: 'noreferrer noopener',
            title: 'Open in ' + client.label,
          })
        : h('div', { className: 'notif-item' + (isNew ? ' notif-new' : '') });
      // Lets the background mute re-check (see showNotifModal) remove this row in
      // place if the mute list turns out to cover it. The id is what that check keys
      // on — muting can turn on a word, a hashtag or a thread, none of which the
      // author's pubkey can answer for. The pubkey stays for everything else that
      // reads a row.
      item.dataset.pubkey = ev.pubkey;
      item.dataset.notifId = ev.id;

      // Reuse an existing client tab on a plain left-click; leave modified clicks
      // (cmd/ctrl/shift) to the anchor's default new-tab behavior.
      if (linkTarget) {
        item.addEventListener('click', (e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          openInClient(linkTarget);
        });
      }

      // Top row: glyph · name (truncated) · time · arrow
      const right = h('div', { className: 'notif-top-right' }, [
        h('span', { className: 'notif-time', textContent: relativeTime(ev.created_at) }),
      ]);
      if (linkTarget) {
        const arrow = h('span', { className: 'notif-link' });
        arrow.appendChild(icon('arrow-up-right'));
        right.appendChild(arrow);
      }
      // Renders with whatever name is cached now (often a short npub on first
      // sight of a sender); patched to the real name in place once the
      // background profile fetch below resolves.
      const authorEl = h('span', {
        className: 'notif-author',
        textContent: notifAuthorName(zapSender(ev)),
      });
      authorEl.dataset.senderPubkey = zapSender(ev);
      // Zap notifications use the crisp filled bolt (boltIcon, themed via
      // currentColor) instead of the ⚡ emoji, which washes out on light themes.
      const glyphEl = h('span', { className: 'notif-glyph' });
      if (glyph === '⚡') glyphEl.appendChild(boltIcon());
      else glyphEl.textContent = glyph;
      const topRow = h('div', { className: 'notif-top' }, [
        glyphEl,
        authorEl,
        right,
      ]);
      item.appendChild(topRow);

      // Action row
      item.appendChild(h('div', { className: 'notif-action', textContent: text }));

      if ((ev.kind === 1 || ev.kind === WEB_COMMENT_KIND) && ev.content) {
        const cleaned = cleanSnippet(ev.content);
        if (cleaned) {
          const snippet = cleaned.length > 140 ? cleaned.slice(0, 140) + '…' : cleaned;
          const contentEl = h('p', { className: 'notif-content', textContent: snippet });
          // data-note-id lets the background mention-name patch below (see
          // showNotifModal) find and re-render this snippet once a mentioned
          // profile resolves — it's rendered here with whatever names are
          // cached at build time, often just a truncated bech32.
          contentEl.dataset.noteId = ev.id;
          item.appendChild(contentEl);
        }

        const { images, av } = extractMedia(ev.content);
        if (images.length) {
          const media = h('div', { className: 'notif-media' });
          images.slice(0, 3).forEach((src) => {
            const img = document.createElement('img');
            img.className = 'notif-thumb';
            img.src = src;
            img.alt = '';
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            img.onerror = () => img.remove();
            media.appendChild(img);
          });
          item.appendChild(media);
        }
        if (av.length) {
          const isVideo = /\.(?:mp4|mov|webm|m3u8)(?:\?|$)/i.test(av[0]);
          item.appendChild(
            h('div', { className: 'notif-media-chip', textContent: (isVideo ? '🎬 ' : '🎵 ') + (isVideo ? 'Video' : 'Audio') })
          );
        }
      }
      return item;
    }

    openModal((modal) => {
      modal.classList.add('modal-sheet');

      const xBtn = h('button', { className: 'modal-x', title: 'Close' });
      xBtn.appendChild(icon('x'));
      xBtn.addEventListener('click', closeModal);
      modal.appendChild(xBtn);

      const heading = h('div', { className: 'notif-modal-head' });
      heading.append(
        avatarEl(a, 'notif-modal-av'),
        h('div', {}, [
          h('div', { className: 'notif-modal-title', textContent: 'Notifications' }),
          h('div', { className: 'notif-modal-sub', textContent: displayName(a) }),
        ])
      );
      modal.appendChild(heading);

      const scroll = h('div', { className: 'notif-scroll' });
      const list = h('div', { className: 'notif-list' });
      scroll.appendChild(list);
      modal.appendChild(scroll);

      // Shown only until the first real item arrives — either from the initial
      // page below, or live via addEvent while this modal stays open.
      // ONE QUOTE FOR THIS OPENING, drawn before anything is rendered and reused by both
      // the empty state and the end note. The bell is the surface where the two can appear
      // in sequence — empty, then a live arrival, then the end of the list — and drawing
      // twice meant the line changed under the reader.
      const panelQuote = pickQuote();
      // A new account opens this to nothing at all, which is the least welcoming screen in
      // the app and the one most likely to be someone's first.
      let emptyMsg = events.length
        ? null
        : emptyQuote('Replies, reactions and zaps show up here.', panelQuote);
      if (emptyMsg) scroll.appendChild(emptyMsg);
      function clearEmptyMessage() {
        if (emptyMsg) { emptyMsg.remove(); emptyMsg = null; }
      }

      let shown = 0;
      let moreBtn = null;
      let endNote = null;

      // THE BOTTOM OF THE LIST, wherever the list came from.
      //
      // This used to be built inline in loadMore, which meant it only ever appeared for a
      // modal that opened with events already in hand — `if (events.length) loadMore()`
      // below. Open the bell on a new account and it never ran: you got the empty-state
      // quote, then a live notification arrived, clearEmptyMessage took the quote away,
      // the item was prepended, and the list simply stopped at the last row with nothing
      // to say it had ended.
      //
      // Two guards, and both matter. A pending "Load more" means this is NOT the end, so
      // the note would be a lie. An empty list has no end to mark — the empty state is
      // already saying it, and two quotes stacked reads as a mistake.
      function showEndNote() {
        if (endNote || moreBtn) return;
        if (!list.children.length) return;
        const sub = h('p', { className: 'notif-end-sub' });
        let profileUrl = '';
        try { profileUrl = client.profile(NT.nip19.npubEncode(a.pubkey)); } catch (_) {}
        sub.appendChild(document.createTextNode('Visit '));
        if (profileUrl) {
          const link = document.createElement('a');
          link.className = 'notif-end-link';
          link.href = profileUrl;
          link.target = '_blank';
          link.rel = 'noreferrer noopener';
          link.textContent = client.label;
          sub.appendChild(link);
        } else {
          sub.appendChild(document.createTextNode(client.label));
        }
        sub.appendChild(document.createTextNode(' for more history.'));
        endNote = h('div', { className: 'notif-end' }, [
          h('p', { className: 'notif-end-title', textContent: "You're all caught up." }),
          sub,
          endQuote(panelQuote),
        ]);
        scroll.appendChild(endNote);
      }

      function loadMore() {
        const next = events.slice(shown, shown + PAGE);
        next.forEach((ev) => list.appendChild(buildItem(ev)));
        shown += next.length;
        if (shown >= events.length) {
          if (moreBtn) { moreBtn.remove(); moreBtn = null; }
          showEndNote();
        } else if (!moreBtn) {
          moreBtn = h('button', { className: 'notif-load-more', textContent: 'Load more' });
          moreBtn.addEventListener('click', loadMore);
          scroll.appendChild(moreBtn);
        }
      }

      if (events.length) loadMore();

      // Let a live event arriving while this modal is open (see addEvent in
      // initNotifSubs) prepend straight into the visible list.
      _openNotifBell = { pubkey: a.pubkey, list, buildItem, clearEmptyMessage, showEndNote };

      // Background reconciliation — runs after the modal is already open and
      // interactive, so neither of these ever blocks it from appearing:
      // 1. A fresh (force) mute-list fetch, in case a mute landed after the
      //    cached list above was last loaded — see loadMuteList.
      // 2. Resolving real names for senders/mentions still showing a short
      //    npub (whatever wasn't already cached).
      (async () => {
        const need = new Set();
        events.forEach((e) => {
          need.add(zapSender(e)); // the zapper for zaps, the author otherwise
          if ((e.kind === 1 || e.kind === WEB_COMMENT_KIND) && e.content) {
            const re = /nostr:(npub1[0-9a-z]+|nprofile1[0-9a-z]+)/g;
            let mm;
            while ((mm = re.exec(e.content)) !== null) {
              try {
                const d = NT.nip19.decode(mm[1]);
                const pk = d.type === 'npub' ? d.data : d.data && d.data.pubkey;
                if (pk) need.add(pk);
              } catch (_) {}
            }
          }
        });
        const uncached = [...need].filter((pk) => !_notifProfiles.get(pk));

        await Promise.all([
          Promise.race([loadMuteList(a.pubkey, relays, true), new Promise((r) => setTimeout(r, 3000))]),
          Promise.all(uncached.map((pk) => prefetchNotifProfile(pk, relays))),
        ]);

        // Drop any row the freshly-loaded list now covers — including rows whose
        // sender's display name only resolved in the prefetch that just finished
        // (see isMutedNotif). pruneNameMuted pulls them from the open list AND
        // from the cache, so the badge and the next open agree with what's shown.
        pruneNameMuted(a.pubkey);
        // Patch in any names that resolved after the row was first drawn.
        modal.querySelectorAll('.notif-author[data-sender-pubkey]').forEach((el) => {
          const name = _notifProfiles.get(el.dataset.senderPubkey);
          if (name) el.textContent = name;
        });
        // Re-clean note snippets too — cleanSnippet falls back to a truncated
        // bech32 for @mentions whose profile wasn't cached yet at build time,
        // and that first pass never gets revisited otherwise.
        const eventsById = new Map(events.map((e) => [e.id, e]));
        modal.querySelectorAll('.notif-content[data-note-id]').forEach((el) => {
          const e = eventsById.get(el.dataset.noteId);
          if (!e) return;
          const cleaned = cleanSnippet(e.content);
          el.textContent = cleaned.length > 140 ? cleaned.slice(0, 140) + '…' : cleaned;
        });
      })();
    }, () => {
      if (_openNotifBell && _openNotifBell.pubkey === a.pubkey) _openNotifBell = null;
    });
  }

  // Sparkle hero shown in the empty (no-account) state — a classy welcome that
  // carries the brand and points at the add buttons below.
  const SPARK_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c.7 6.4 5.6 11.3 12 12-6.4.7-11.3 5.6-12 12-.7-6.4-5.6-11.3-12-12C6.4 11.3 11.3 6.4 12 0Z"/></svg>';
  function buildWelcome() {
    const wrap = h('div', { className: 'welcome' });
    const sparks = h('div', { className: 'welcome-sparks' });
    ['s1', 's2', 's3', 's4', 's5'].forEach((c) => {
      const sp = document.createElement('span');
      sp.className = 'spark ' + c;
      sp.innerHTML = SPARK_SVG;
      sparks.append(sp);
    });
    const mark = h('div', { className: 'welcome-mark' });
    const img = document.createElement('img');
    img.src = 'icons/sidecar-mark.svg';
    img.alt = '';
    mark.append(img);
    wrap.append(
      sparks,
      mark,
      h('h2', { className: 'welcome-title', textContent: 'Welcome to Sidecar' }),
      h('p', {
        className: 'welcome-sub',
        textContent: 'A classy Nostr signer and Lightning wallet that lives in your browser sidebar.',
      }),
      h('p', { className: 'welcome-cta', textContent: 'Create a new account or import your nsec to begin.' })
    );
    return wrap;
  }

  // Set when renderMain() is skipped because something is covering the panel, so the
  // overlay's own teardown can run the render the user didn't see.
  let _mainRenderDeferred = false;

  // Is anything covering the panel right now? Two separate surfaces do it and only
  // one sets a class: openModal() adds `modal-open` to <html>, while the approval
  // screen is just #view-approval with its `hidden` class removed. Missing the
  // second would leave the flicker in place for exactly the screen where a
  // background repaint is most alarming — the one asking you to approve a signature.
  function panelIsCovered() {
    if (document.documentElement.classList.contains('modal-open')) return true;
    const approval = $('view-approval');
    return !!approval && !approval.classList.contains('hidden');
  }

  // Draw whatever was skipped while an overlay was up. Callers must clear their own
  // visible state FIRST, or panelIsCovered() still reports true and this no-ops.
  function flushDeferredMainRender() {
    if (!_mainRenderDeferred) return;
    if (panelIsCovered()) return;
    if (!state || state.locked) return;
    renderMain();
  }

  function renderMain() {
    // renderMain clears and rebuilds the header and the account list, and re-runs the
    // pinned balance bar. Behind an open modal that tear-down is visible as a flicker
    // through the overlay — reported while reading the notifications panel.
    //
    // The trigger is a loop: renderMain kicks off a profile backfill for any account
    // missing a kind:0, and each fetch that lands calls renderMain again. An account
    // whose profile never resolves keeps that cycling on the retry cooldown, so the
    // flicker repeats for as long as the panel is open.
    //
    // Deferring is safe because renderMain reads only from `state` — nothing is lost
    // by drawing once on close instead of N times underneath.
    if (panelIsCovered()) {
      _mainRenderDeferred = true;
      return;
    }
    _mainRenderDeferred = false;
    const active = state.accounts.find((a) => a.pubkey === state.activePubkey);

    // No accounts yet → the switcher chip has nothing to show or switch to, and the
    // "Accounts" heading is noise next to the welcome hero. Hide both; the topbar
    // actions stay anchored right (margin-left:auto). The dropdown now also offers
    // "Add account", but the empty state puts full-size Generate/Import buttons
    // right there, so the chip has nothing to add.
    const hasAccounts = state.accounts.length > 0;
    // Empty state: keep a dimmed placeholder avatar in the top-left for balance,
    // but make the chip inert (no name, no chevron, no dropdown) until an account exists.
    $('acct-btn').disabled = !hasAccounts;
    $('accounts-heading').classList.toggle('hidden', !hasAccounts);

    // Once an account exists, the two full-size Generate/Import buttons are no
    // longer the primary action on this tab — collapse them into a small link
    // that opens the same two choices in a compact menu.
    document.querySelector('#tab-accounts .add-actions').classList.toggle('hidden', hasAccounts);
    $('add-account-link').classList.toggle('hidden', !hasAccounts);

    // "Pinned and open" tip sits below the add buttons (where it won't get lost),
    // shown only while onboarding.
    let tip = $('welcome-tip');
    if (!hasAccounts && !tip) {
      tip = h('div', { id: 'welcome-tip', className: 'welcome-tip' }, [
        icon('pin'),
        h('span', { textContent: 'For the best experience, keep Sidecar pinned and open in your sidebar.' }),
      ]);
      document.querySelector('#tab-accounts .add-actions').insertAdjacentElement('afterend', tip);
    } else if (hasAccounts && tip) {
      tip.remove();
    }

    // No accounts → gate the rest of the app: the Activity/Profile/Wallet tabs and
    // the compose FAB are dimmed and inert until an account exists. Snap back to
    // the Accounts tab if a gated tab was active (e.g. after removing the last one).
    ['activity', 'profile', 'wallet'].forEach((name) => {
      const t = document.querySelector('.tab[data-tab="' + name + '"]');
      if (t) t.disabled = !hasAccounts;
    });
    $('compose-fab').disabled = !hasAccounts;
    const balloon = $('first-post-balloon');
    if (balloon) {
      const showBalloon = hasAccounts &&
        !!state.activePubkey &&
        _firstPostSeenPubkeys !== null &&
        !_firstPostSeenPubkeys.has(state.activePubkey);
      balloon.classList.toggle('hidden', !showBalloon);
    }
    if (!hasAccounts) {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      const acc = document.querySelector('.tab[data-tab="accounts"]');
      if (acc) acc.classList.add('active');
      document.querySelectorAll('.tabview').forEach((v) => hide(v));
      show($('tab-accounts'));
      // The only view change that does not go through the tab handler, so it needs
      // the same scroll reset for the same reason (see there).
      const scroller = $('view-main').querySelector('.content');
      if (scroller) scroller.scrollTop = 0;
    }

    // persistent header chip (current account)
    applyAvatar($('chip-av'), active || {});
    // The name is no longer drawn in the bar, so the tooltip has to carry it —
    // otherwise two accounts with similar avatars are indistinguishable here.
    $('acct-btn').title = active ? 'Switch account — ' + displayName(active) : 'No account';
    refreshBell();
    syncRelax();
    renderPinnedBalanceBar();

    // The active account already shows in the header chip and is marked (check +
    // highlight) in the list below, so the big "booth" card was a third copy.
    // Keep this slot only for the empty-state welcome hero.
    const head = $('active-account');
    head.innerHTML = '';
    head.classList.toggle('welcome-mode', !hasAccounts);
    head.classList.toggle('hidden', hasAccounts);
    if (!hasAccounts) head.appendChild(buildWelcome());

    const list = $('account-list');
    list.innerHTML = '';
    state.accounts.forEach((a) => {
      list.appendChild(accountRow(a));
      // Stats drawer sits right beneath the active account row, inside the
      // list but not draggable (no .item class, no draggable attr).
      if (a.pubkey === state.activePubkey) {
        list.appendChild(buildAccountStats(a.pubkey));
      }
    });
    makeSortable(list);

    // Lazily pull name + picture from kind:0 for accounts that still lack a real
    // (kind:0-sourced) profile — placeholder cocktail names don't count. Runs on
    // every render, so an install carrying accounts from an older vault import
    // heals itself the next time the list is drawn.
    state.accounts.forEach((a) => {
      if (needsProfileBackfill(a)) maybeFetchProfile(a.pubkey);
    });
  }

  function makeSortable(listEl) {
    let dragged = null;

    // The items that are actually draggable, excluding the dragged element itself.
    function dragTargets() {
      return [...listEl.querySelectorAll('.item[draggable]')].filter((el) => el !== dragged);
    }

    // Clear every drop indicator, then show one on the element the cursor is over.
    // Returns the target + 'before'|'after', or null when there's nowhere to drop.
    function highlightAt(clientY) {
      listEl.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach((el) => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      const items = dragTargets();
      if (!items.length) return null;

      // The cursor is ABOVE the first item → drop before it.
      const first = items[0];
      if (clientY < first.getBoundingClientRect().top + first.getBoundingClientRect().height / 2) {
        first.classList.add('drag-over-top');
        return { target: first, pos: 'before' };
      }

      // The cursor is BELOW the last item → drop after it. This is the case that
      // used to silently fail: dropping past the end hit the container, not an
      // item, so e.target.closest('.item[draggable]') returned null and nothing
      // happened — the item snapped back with no feedback.
      const last = items[items.length - 1];
      if (clientY >= last.getBoundingClientRect().top + last.getBoundingClientRect().height / 2) {
        last.classList.add('drag-over-bottom');
        return { target: last, pos: 'after' };
      }

      // Som in the middle — find whichever item the cursor is over.
      for (const el of items) {
        const r = el.getBoundingClientRect();
        if (clientY >= r.top && clientY < r.bottom) {
          const mid = r.top + r.height / 2;
          if (clientY < mid) { el.classList.add('drag-over-top'); return { target: el, pos: 'before' }; }
          el.classList.add('drag-over-bottom'); return { target: el, pos: 'after' };
        }
      }
      return null;
    }

    listEl.addEventListener('dragstart', (e) => {
      dragged = e.target.closest('.item[draggable]');
      if (!dragged) return;
      dragged.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    listEl.addEventListener('dragend', () => {
      if (dragged) dragged.classList.remove('dragging');
      listEl.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach((el) => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      dragged = null;
    });
    listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragged) return;
      e.dataTransfer.dropEffect = 'move';
      highlightAt(e.clientY);
    });
    listEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!dragged) return;
      // Capture the stats drawer before moving the row, so it follows on reorder.
      const drawer = dragged.nextElementSibling;
      const hasDrawer = drawer && drawer.classList.contains('account-stats');
      const drop = highlightAt(e.clientY);
      if (drop) {
        if (drop.pos === 'before') listEl.insertBefore(dragged, drop.target);
        else listEl.insertBefore(dragged, drop.target.nextSibling);
        if (hasDrawer) listEl.insertBefore(drawer, dragged.nextSibling);
      }
      listEl.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach((el) => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      const pubkeys = [...listEl.querySelectorAll('.item[data-pubkey]')].map((el) => el.dataset.pubkey);
      await call({ type: 'SIDECAR_REORDER_ACCOUNTS', pubkeys });
    });
  }

  function accountRow(a) {
    const row = document.createElement('div');
    row.className = 'item' + (a.pubkey === state.activePubkey ? ' item-active' : '');
    row.draggable = true;
    row.dataset.pubkey = a.pubkey;

    const grip = document.createElement('span');
    grip.className = 'grip-handle';
    grip.appendChild(icon('grip'));
    row.appendChild(grip);

    const av = avatarEl(a, 'avatar');
    row.appendChild(av);

    const main = document.createElement('div');
    main.className = 'item-main';
    const label = document.createElement('div');
    label.className = 'item-label';
    label.textContent = displayName(a);
    const sub = document.createElement('div');
    sub.className = 'item-sub';
    sub.textContent = shortNpub(a.npub);
    main.append(label, sub);

    const isActive = a.pubkey === state.activePubkey;

    // The actions slot is built BEFORE the confirm wiring below, because the confirm
    // swaps what is in it and needs the button to exist.
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    if (isActive) {
      const check = icon('check');
      check.classList.add('active-check');
      actions.appendChild(check);
    }
    const moreBtn = iconButton('Account options', 'more', () => accountMenuModal(a));
    actions.appendChild(moreBtn);

    if (!isActive) {
      // Both the avatar and the name area switch accounts on click — clicking the
      // PFP used to be a no-op because only `main` carried the handler. The grip
      // handle and the "more" actions are left out so drag and the menu still work.
      const clickables = [av, main];
      for (const el of clickables) {
        el.style.cursor = 'pointer';
        el.title = 'Set as active account';
      }
      // WHILE ARMED, THE SLOT HOLDS A CANCEL INSTEAD OF THE MENU. Arming a row used to
      // have no way out: the two lines rewrite to "Set as active?" / "Tap again to
      // confirm", and the only thing that cleared them was arming a DIFFERENT row or
      // leaving the tab — neither of which is available or discoverable when you have
      // one account and you have just changed your mind. The second tap switching the
      // account is the whole point of the confirm, so it cannot double as the way out.
      //
      // It replaces the menu button rather than joining it: the slot is flex-shrink: 0
      // and one icon swapped for another costs nothing, where a second button would
      // take width from the name beside it. The menu is not reachable for the moment
      // the row is armed, which is the right trade — you are mid-decision, and the way
      // out of that decision is the only action that matters.
      const cancelBtn = iconButton('Cancel', 'x', (e) => {
        e.stopPropagation();
        resetRow();
      });
      function resetRow() {
        row.classList.remove('item-pending');
        label.textContent = displayName(a);
        sub.textContent = shortNpub(a.npub);
        if (cancelBtn.parentElement) actions.replaceChild(moreBtn, cancelBtn);
      }
      const onActivate = async () => {
        const list = row.parentElement;
        list.querySelectorAll('.item-pending').forEach((el) => {
          if (el !== row && el._resetRow) el._resetRow();
        });
        if (row.classList.contains('item-pending')) {
          await call({ type: 'SIDECAR_SET_ACTIVE', pubkey: a.pubkey });
          await refresh();
          toast('Switched to ' + displayName(a), 'success');
          if (!(await offerTabReload())) maybeShowSwitchTip();
        } else {
          row.classList.add('item-pending');
          label.textContent = 'Set as active?';
          sub.textContent = 'Tap again to confirm';
          if (moreBtn.parentElement) actions.replaceChild(cancelBtn, moreBtn);
        }
      };
      clickables.forEach((el) => el.addEventListener('click', onActivate));
      row._resetRow = resetRow;
    }

    row.append(main, actions);
    return row;
  }

  // Collapsible stats drawer that sits beneath the active account row. A
  // prominent numeric top row (Following, Notifications, Relays) sits above
  // full-width identity rows (NIP-05, Lightning, Wallet) so long values have
  // room. Lazily loads on first expand; placeholder dots while in flight.
  function buildAccountStats(pubkey) {
    const drawer = document.createElement('div');
    drawer.className = 'account-stats' + (accountStatsExpanded ? '' : ' collapsed');

    const header = document.createElement('button');
    header.className = 'account-stats-toggle';
    const chev = icon('chevron-down');
    chev.classList.add('account-stats-chevron');
    if (!accountStatsExpanded) chev.style.transform = 'rotate(-90deg)';
    header.append(chev, document.createTextNode('Overview'));
    header.addEventListener('click', () => {
      accountStatsExpanded = !accountStatsExpanded;
      drawer.classList.toggle('collapsed', !accountStatsExpanded);
      chev.style.transform = accountStatsExpanded ? '' : 'rotate(-90deg)';
      if (accountStatsExpanded && !drawer.dataset.loaded) loadStats();
    });

    const body = document.createElement('div');
    body.className = 'account-stats-body';

    function placeholder() {
      const dots = document.createElement('span');
      dots.className = 'account-stat-loading';
      dots.textContent = '…';
      return dots;
    }

    // Top row: three numeric stat blocks, each with its own icon.
    const followNum = placeholder();
    const notifNum = placeholder();
    const relayNum = placeholder();
    // The relay label is variable, unlike the other two: the number is meaningless
    // without saying WHICH set it counts, so loadStats() rewrites it below.
    const relayLabel = h('span', { className: 'account-stat-block-label', textContent: 'Relays' });
    function statBlock(iconName, numEl, label) {
      const ic = icon(iconName);
      ic.classList.add('account-stat-block-ic');
      return h('div', { className: 'account-stat-block' }, [
        ic,
        numEl,
        typeof label === 'string'
          ? h('span', { className: 'account-stat-block-label', textContent: label })
          : label,
      ]);
    }
    const relayBlock = statBlock('wifi', relayNum, relayLabel);
    const topRow = h('div', { className: 'account-stat-grid' }, [
      statBlock('users', followNum, 'Following'),
      statBlock('bell', notifNum, 'Alerts'),
      relayBlock,
    ]);

    // Full-width identity rows, each led by a themed icon.
    function idRow(iconName, label, valueEl) {
      const ic = icon(iconName);
      ic.classList.add('account-stat-ic');
      return h('div', { className: 'account-stat-id' }, [
        ic,
        h('span', { className: 'account-stat-id-label', textContent: label }),
        valueEl,
      ]);
    }

    // "Not set" + a (?) glyph as ONE clickable target — a bare icon is a small
    // tap area, and the phrase is the part the eye lands on.
    function notSetLink(title, hash) {
      const btn = h('button', { className: 'account-stat-notset', title });
      const ic = icon('help-circle');
      ic.classList.add('account-stat-help');
      btn.append(ic, document.createTextNode('Not set'));
      btn.addEventListener('click', () => openExtensionPage('help.html', hash));
      return btn;
    }

    const nip05Val = h('div', { className: 'account-stat-id-val' });
    const lud16Val = h('div', { className: 'account-stat-id-val' });
    // Wallet row holds two mini status badges (connected / backed up).
    const walletVal = h('div', { className: 'account-stat-id-val wallet-status' });

    const idSection = h('div', { className: 'account-stat-ids' }, [
      idRow('badge-check', 'NIP-05', nip05Val),
      idRow('zap', 'Lightning', lud16Val),
      idRow('wallet', 'Wallet', walletVal),
    ]);

    // Profile link.
    const profileLink = h('button', { className: 'account-stats-link' }, [
      document.createTextNode('View full profile'),
      icon('arrow-up-right'),
    ]);
    profileLink.addEventListener('click', () => {
      const tab = document.querySelector('.tab[data-tab="profile"]');
      if (tab) tab.click();
    });

    body.append(topRow, idSection, profileLink);
    drawer.append(header, body);

    async function loadStats() {
      drawer.dataset.loaded = '1';

      // Numeric stats.
      getFollowCount(pubkey).then((n) => {
        followNum.textContent = n == null ? '—' : n.toLocaleString('en-US');
        followNum.classList.add('account-stat-num');
      });

      const unseen = notifUnseenCount(pubkey);
      notifNum.textContent = unseen > 0 ? String(unseen) : '0';
      notifNum.classList.add('account-stat-num');
      if (!unseen) notifNum.classList.add('account-stat-dim');

      // This number has to say WHICH relays, because it was misleading in both
      // directions when it didn't. It counted only the declared NIP-65 set, so an
      // account that had never published a relay list showed 0 while happily reading
      // and writing through the bootstrap relays — 0 reads as broken. And a user with
      // a declared list saw a count that didn't match the one in Settings, with
      // nothing on either screen saying they measure different sets.
      Promise.all([getNip65(pubkey), nip65OnlyFor(pubkey)]).then(async ([nip65, only]) => {
        const declared = nip65 ? new Set([...nip65.read, ...nip65.write]).size : 0;
        let count = declared;
        let label = 'Relays';
        let warn = false;
        if (!declared) {
          if (only) {
            // Fail-closed with nothing declared: this account genuinely cannot
            // publish. 0 is accurate here, but it's a fault to flag, not a neutral
            // zero to dim — the same failure the per-account fix was about.
            warn = true;
            relayBlock.title =
              'NIP-65 only is on for this account, but it has no published relay list — ' +
              'it can’t publish. Publish a relay list from the Profile tab, or turn the ' +
              'setting off in Settings.';
          } else {
            // Bootstrap relays are what this account is actually using. Naming them
            // keeps the number honest instead of silently reporting a different set.
            count = (await relayUrls(false)).length;
            label = 'Bootstrap';
            relayBlock.title =
              'Using Sidecar’s bootstrap relays. Publish a relay list from the Profile ' +
              'tab to use your own.';
          }
        }
        relayNum.textContent = String(count);
        relayNum.classList.add('account-stat-num');
        if (warn) relayNum.classList.add('account-stat-warn');
        else if (!count) relayNum.classList.add('account-stat-dim');
        relayLabel.textContent = label;
      });

      // Identity stats — need the profile.
      const rec = await getProfile(pubkey);
      const content = rec && rec.content ? rec.content : {};

      if (content.nip05) {
        // Per NIP-05, a local part of "_" means the user is verified at the
        // domain without exposing a handle. Display the bare domain.
        const nip05 = content.nip05.startsWith('_@') ? content.nip05.slice(2) : content.nip05;
        const badge = h('span', { className: 'nip05-badge' });
        nip05Val.append(badge, document.createTextNode(nip05));
        verifyNip05(content.nip05, pubkey).then((res) => paintNip05Badge(badge, res));
      } else {
        nip05Val.appendChild(notSetLink('What is a NIP-05?', '#nip05'));
      }

      if (content.lud16) {
        const ok = icon('check');
        ok.classList.add('stat-mini-ok');
        lud16Val.append(ok, document.createTextNode(content.lud16));
      } else {
        lud16Val.appendChild(notSetLink('What is a Lightning address?', '#lightning-address'));
      }

      // Wallet: two mini badges — connected and backed up — each with a
      // colored check or X so the state reads at a glance.
      call({ type: 'SIDECAR_NWC_META' }).then(async ({ has }) => {
        if (!has) {
          const link = h('button', { className: 'account-stat-add-link', textContent: 'Add wallet →' });
          link.addEventListener('click', () => {
            const tab = document.querySelector('.tab[data-tab="wallet"]');
            if (tab) tab.click();
          });
          walletVal.appendChild(link);
          return;
        }
        // Connected gets a green check.
        const connIc = icon('check');
        connIc.classList.add('stat-mini-ok');
        walletVal.appendChild(h('span', { className: 'wallet-badge' }, [connIc, document.createTextNode('Connected')]));
        // Backup status — green check if current, orange X if missing/stale.
        let backupOk = null;
        try {
          const backup = await nwcBackupState();
          backupOk = backup.state === 'current';
        } catch (_) {}
        if (backupOk === true) {
          const ic = icon('check');
          ic.classList.add('stat-mini-ok');
          walletVal.appendChild(h('span', { className: 'wallet-badge' }, [ic, document.createTextNode('Backed up')]));
        } else if (backupOk === false) {
          const ic = icon('x');
          ic.classList.add('stat-mini-no');
          walletVal.appendChild(h('span', { className: 'wallet-badge' }, [ic, document.createTextNode('Not backed up')]));
        }
      }).catch(() => {
        walletVal.textContent = '—';
        walletVal.classList.add('account-stat-dim');
      });
    }

    if (accountStatsExpanded) loadStats();

    return drawer;
  }

  function iconButton(title, name, onClick) {
    const b = document.createElement('button');
    b.className = 'icon-btn sm';
    b.title = title;
    b.appendChild(icon(name));
    b.addEventListener('click', onClick);
    return b;
  }

  function labelButton(id, name, text) {
    const b = $(id);
    b.textContent = '';
    b.append(icon(name), h('span', { textContent: text }));
  }
  labelButton('add-generate', 'user-plus', 'Generate new');
  labelButton('add-import', 'download', 'Import nsec');
  $('add-generate').addEventListener('click', () => generateAccount());
  $('add-import').addEventListener('click', () => importAccountModal());
  $('add-account-link').addEventListener('click', () => addAccountModal());
  $('explore-apps-link').addEventListener('click', (e) => {
    e.preventDefault();
    openExtensionPage('welcome.html');
  });

  // Share Sidecar via the OS's native share sheet when available (Messages, Mail,
  // AirDrop, …); fall back to copying the store link when Web Share isn't offered
  // (e.g. desktop Linux). Wired to the Accounts footer link + the Settings button.
  const SIDECAR_STORE_URL = 'https://chromewebstore.google.com/detail/sidecar-a-classy-nostr-si/moimlikilhheabdafocpmneehpblhiln';
  async function shareSidecar() {
    // Fold the link INTO the text (no separate `url` field): with both set, most
    // share targets use only the url and drop the message — embedding it keeps
    // the blurb + link together everywhere.
    const message = 'Sidecar — a classy Nostr signer right in your browser side panel.\n' + SIDECAR_STORE_URL;
    const shareData = { text: message };
    if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
      try { await navigator.share(shareData); return; }
      catch (e) { if (e && e.name === 'AbortError') return; } // dismissed → done; else fall through to copy
    }
    try {
      await copyPlain(message);
      toast('Message copied — share it with a friend', 'success');
    } catch (_) {
      toast('Could not share', 'error');
    }
  }
  const shareLink = $('share-sidecar-link');
  shareLink.prepend(icon('share'));
  shareLink.addEventListener('click', (e) => { e.preventDefault(); shareSidecar(); });
  const shareBtn = $('share-sidecar-btn');
  shareBtn.prepend(icon('share'));
  shareBtn.addEventListener('click', () => shareSidecar());

  // ---- first-post tip balloon (once per imported nsec) ----
  (function initFirstPostBalloon() {
    const balloon = $('first-post-balloon');
    if (!balloon) return;
    chrome.storage.local.get('firstPostTipSeenPubkeys', ({ firstPostTipSeenPubkeys }) => {
      _firstPostSeenPubkeys = new Set(Array.isArray(firstPostTipSeenPubkeys) ? firstPostTipSeenPubkeys : []);
      if (state?.accounts) renderMain();
    });
    balloon.addEventListener('click', () => {
      if (state?.activePubkey) {
        _firstPostSeenPubkeys = _firstPostSeenPubkeys || new Set();
        _firstPostSeenPubkeys.add(state.activePubkey);
        chrome.storage.local.set({ firstPostTipSeenPubkeys: [..._firstPostSeenPubkeys] });
      }
      balloon.classList.add('hidden');
      openComposer('Just setting up my #Sidecar 🍸');
    });
  })();

  // ---- modals ----
  let modalCleanup = null;
  function openModal(buildContent, onClose) {
    const modal = $('modal');
    modal.innerHTML = '';
    modal.classList.remove('modal-sheet'); // reset full-height variant; opt back in per modal
    modalCleanup = onClose || null;
    buildContent(modal);
    show($('modal-overlay'));
    document.documentElement.classList.add('modal-open');
  }
  // These modals are built from loose inputs + buttons (not a <form>), so Enter
  // wouldn't submit. Treat Enter in a text input as a click on the primary action.
  // (Textareas keep Enter for newlines.)
  $('modal').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    const primary = $('modal').querySelector('button.primary');
    if (primary && !primary.disabled) {
      e.preventDefault();
      primary.click();
    }
  });
  function closeModal() {
    if (modalCleanup) { try { modalCleanup(); } catch (_) {} modalCleanup = null; }
    hide($('modal-overlay'));
    $('modal').innerHTML = '';
    document.documentElement.classList.remove('modal-open');
    // Draw whatever was skipped while the modal covered the panel. The class is
    // removed above first, or panelIsCovered() would still report true and the panel
    // would keep showing stale account names until the next unrelated render.
    flushDeferredMainRender();
  }
  $('modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('modal-overlay')) closeModal();
  });

  function h(tag, props, children) {
    const el = document.createElement(tag);
    if (props) Object.assign(el, props);
    (children || []).forEach((c) => el.append(c));
    return el;
  }

  // Generate is instant — create the key, then surface the one-time backup modal.
  async function generateAccount() {
    try {
      const gen = await call({ type: 'SIDECAR_ADD_ACCOUNT', generate: true });
      // Make the new account active BEFORE anything can publish to it. Generate
      // only auto-activates the very first account; without this the setup wizard
      // would publish its kind:0 to whatever account was already active — which
      // once overwrote an unrelated existing profile.
      if (gen && gen.pubkey) await call({ type: 'SIDECAR_SET_ACTIVE', pubkey: gen.pubkey });
      await refresh(); // renderMain() then pulls the profile for the new account
      toast('Account created', 'success');
      if (gen && gen.nsec) {
        nsecModal({
          nsec: gen.nsec,
          title: 'Back up your new key',
          intro:
            'Sidecar generated a new account. This nsec is the only way to recover it — save it now. You can view it again later behind your PIN.',
          // A brand-new key has no profile yet — once they've backed it up, run a
          // short setup wizard (name → photo → bio), which publishes what they
          // fill in and lands them on the Profile tab to complete the rest.
          //
          // The backup sheet is offered AFTER the wizard, not here: it prints the
          // display name in its TO line, so a sheet taken before the profile exists
          // is addressed to "THE BEARER OF THIS SHEET" forever.
          //
          // This keeps gen.nsec reachable in the closure for the wizard's duration
          // rather than only the reveal modal's. Considered and accepted: JS strings
          // can't be zeroed, the panel already holds the key for the reveal, and the
          // alternative is a PIN step-up moments after the user set the PIN. It ends
          // when generateAccount's frame is collected.
          onDone: () =>
            profileSetupWizard(gen.pubkey, () => {
              const acct = (state.accounts || []).find((a) => a.pubkey === gen.pubkey);
              backupSheetPromptModal(gen.nsec, acct || null);
            }),
        });
      }
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ---- NIP-49 in a worker ----
  // scrypt at N=2^16 (nip49's default) is a second or more of memory-hard JS —
  // on the main thread that froze the whole panel, countdowns and buttons
  // included, every time a sheet minted or an import decrypted. nip49-worker.js
  // importScripts the same vendored bundle (the hash-pinned file itself never
  // changes), so the work happens off-thread and the panel stays live. Fails
  // closed to the synchronous call if workers aren't available or the worker
  // script fails to load: a frozen panel for a second beats a broken backup path.
  let nip49Worker = null;
  let nip49WorkerBroken = false;
  let nip49Seq = 0;
  const nip49Pending = new Map();
  function nip49(op, args) {
    const sync = () =>
      (op === 'decrypt' ? window.SidecarNip49.decrypt : window.SidecarNip49.encrypt).apply(null, args);
    if (nip49WorkerBroken || typeof Worker !== 'function') return Promise.resolve().then(sync);
    try {
      if (!nip49Worker) {
        nip49Worker = new Worker(chrome.runtime.getURL('nip49-worker.js'));
        nip49Worker.onmessage = (e) => {
          const { id, ok, result, error } = e.data || {};
          const settle = nip49Pending.get(id);
          if (!settle) return;
          nip49Pending.delete(id);
          if (ok) settle.resolve(result);
          else settle.reject(new Error(error || 'NIP-49 worker failed'));
        };
        nip49Worker.onerror = () => {
          // A packaging miss or a load failure: settle everything waiting and
          // go synchronous from now on, rather than leaving promises that will
          // never resolve.
          nip49WorkerBroken = true;
          for (const [id, settle] of nip49Pending) {
            nip49Pending.delete(id);
            settle.reject(new Error('NIP-49 worker failed'));
          }
        };
      }
    } catch (_) {
      return Promise.resolve().then(sync);
    }
    return new Promise((resolve, reject) => {
      const id = ++nip49Seq;
      nip49Pending.set(id, { resolve, reject });
      nip49Worker.postMessage({ id, op, args });
    });
  }

  // Read the scrypt logn byte out of an ncryptsec WITHOUT decrypting — a partial
  // bech32 read of the first two payload bytes (version, logn). Returns null when
  // the string doesn't decode that far; full validity stays nip49.decrypt's job.
  const NCRYPTSEC_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  function ncryptsecLogn(ncryptsec) {
    const s = String(ncryptsec || '');
    const sep = s.lastIndexOf('1');
    if (sep < 1) return null;
    let acc = 0, bits = 0;
    for (const ch of s.slice(sep + 1)) {
      const v = NCRYPTSEC_CHARSET.indexOf(ch);
      if (v < 0) return null;
      acc = (acc << 5) | v;
      bits += 5;
      if (bits >= 16) return (acc >> (bits - 16)) & 0xff; // second byte = logn
    }
    return null;
  }

  // Decrypt a NIP-49 ncryptsec string to an nsec, so the rest of the import path
  // (SIDECAR_ADD_ACCOUNT, decodeSecret) never has to know ncryptsec exists. Throws
  // a friendly message on a bad password or malformed string. Off-thread: the
  // scrypt inside is the worker's whole reason to exist (see nip49()).
  async function decryptNcryptsec(ncryptsec, password) {
    // Cost-byte pre-check. nip49.js is a hash-pinned vendored build, so the bound
    // can't live inside decrypt() — but logn is just a byte in the pasted string,
    // and a crafted one (24 → 16GB of scrypt) burns that memory in the worker
    // before the AEAD ever gets a chance to reject the key: off-thread saved the
    // panel's responsiveness, not the browser from an OOM. NIP-49's own table
    // tops out at 22 (4GiB); > 20 (1GiB) matches no known client, and real keys
    // are 16–18. A null (undecodable here) falls through — nip49.decrypt is
    // still the validity gate, this only caps the work we'll attempt.
    if (ncryptsecLogn(ncryptsec) > 20) {
      throw new Error('Incorrect password, or not a valid ncryptsec key.');
    }
    let sk;
    try {
      sk = await nip49('decrypt', [ncryptsec, password]);
      // nsecEncode inside the try too: a decrypt that returns wrong-length bytes
      // would otherwise throw nostr-tools' raw error at the user.
      return NT.nip19.nsecEncode(sk);
    } catch (_) {
      throw new Error('Incorrect password, or not a valid ncryptsec key.');
    }
  }

  // ---- reading a key out of a QR image (the printable backup sheet) ----
  // jsqr.js is ~250KB, so it is injected on first use rather than loaded with the
  // panel. It's a packaged extension resource, so a plain <script> is same-origin
  // and passes MV3's CSP; background.js does the equivalent with importScripts.
  let _jsqrPromise = null;
  function ensurePanelJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (_jsqrPromise) return _jsqrPromise;
    _jsqrPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'jsqr.js';
      s.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error('QR reader failed to load')));
      s.onerror = () => { _jsqrPromise = null; reject(new Error('QR reader failed to load')); };
      document.head.appendChild(s);
    });
    return _jsqrPromise;
  }

  // Pull an nsec or ncryptsec out of decoded QR text. Liberal about a `nostr:`
  // prefix; validation is left to the import field, which already does it.
  function extractSecretFromText(text) {
    const m = /(?:nostr:)?((?:nsec|ncryptsec)1[a-z0-9]{20,})/i.exec(String(text || ''));
    return m ? m[1].toLowerCase() : '';
  }

  // Decode `file` at one scale. Separated so callers can retry at a larger size:
  // a phone photo of the whole sheet puts the QR in a fraction of the frame, and
  // downscaling too far erases the modules.
  async function decodeQrAtScale(jsQR, bmp, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    // attemptBoth also catches a photo of a screen showing an inverted render.
    const res = jsQR(data, w, h, { inversionAttempts: 'attemptBoth' });
    return res && res.data ? res.data : '';
  }

  // Read a key straight out of the backup-sheet PDF. No rasterizing: the sheet
  // draws the nsec as a real text literal (that's what makes it selectable), so it
  // is present verbatim in the content stream. Far more reliable than decoding a
  // picture of the page, and the obvious thing to try when you kept the PDF —
  // which the sheet now tells you is fine.
  async function secretFromPdfFile(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    // latin1: one byte per code unit, so byte offsets survive the conversion.
    const asText = (bytes) => {
      let s = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return s;
    };
    const raw = asText(buf);
    let secret = extractSecretFromText(raw);
    if (secret) return secret;

    // Sidecar's own sheets are uncompressed, but a PDF re-saved by another tool
    // will have Flate-compressed streams. Inflate each one and look again.
    if (typeof DecompressionStream === 'function') {
      const re = /stream\r?\n/g;
      let m;
      while ((m = re.exec(raw))) {
        const start = m.index + m[0].length;
        let end = raw.indexOf('endstream', start);
        if (end === -1) continue;
        // Back off the EOL that precedes `endstream`. DecompressionStream rejects
        // trailing bytes after a complete zlib stream, so including that newline
        // fails every inflate — which is exactly the bug this comment replaces.
        while (end > start && (buf[end - 1] === 0x0a || buf[end - 1] === 0x0d)) end--;
        try {
          const slice = buf.subarray(start, end);
          const inflated = await new Response(
            new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate'))
          ).arrayBuffer();
          secret = extractSecretFromText(asText(new Uint8Array(inflated)));
          if (secret) return secret;
        } catch (_) { /* not a Flate stream, or truncated — try the next */ }
      }
    }
    throw new Error("No key found in that PDF — is it a Sidecar backup sheet?");
  }

  // Read a key from an image of the backup sheet. Entirely local — the image is a
  // plaintext key and never leaves the extension.
  async function secretFromImageFile(file) {
    if (!file) throw new Error('No image to read');
    if (file.type && !/^image\//.test(file.type)) throw new Error('That file is not an image');
    const jsQR = await ensurePanelJsQR();
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch (_) {
      throw new Error("Couldn't read that image");
    }
    try {
      // Ascending sizes: the small pass is fast and usually enough for a tight
      // crop of the code; the larger ones rescue a photo of the full page.
      for (const edge of [1400, 2400, 4000]) {
        const text = await decodeQrAtScale(jsQR, bmp, edge);
        if (!text) continue;
        const secret = extractSecretFromText(text);
        if (secret) return secret;
        // A QR was found but holds something else — an npub, a URL, a wallet
        // string. Say so rather than reporting "no code found".
        throw new Error('That QR code is not a private key');
      }
      throw new Error('No QR code found in that image');
    } finally {
      if (bmp.close) bmp.close();
    }
  }

  // Route on what the user actually picked, so the PDF and a photo of it both work.
  function secretFromFile(file) {
    if (!file) throw new Error('No file to read');
    const isPdf = /pdf/i.test(file.type || '') || /\.pdf$/i.test(file.name || '');
    return isPdf ? secretFromPdfFile(file) : secretFromImageFile(file);
  }

  function importAccountModal() {
    // Held outside the builder so the close handler below can stop the camera on
    // ANY exit — Save, Cancel, the X, Esc. A MediaStream left running keeps the
    // camera light on after the modal is gone, which looks like the extension
    // watching you.
    let stopCamera = null;
    openModal((modal) => {
      modal.append(h('h3', { textContent: 'Import account' }));
      const err = h('div', { className: 'error' });
      const secretInput = h('input', {
        type: 'password',
        className: 'nsec-field',
        placeholder: 'nsec1…, ncryptsec1…, or 64-char hex',
      });
      modal.append(h('label', { textContent: 'Private key' }), secretInput);

      // Read the key from a photo or scan of the printable backup sheet, so
      // restoring doesn't mean transcribing 63 bech32 characters by hand. Fills the
      // field above and fires its input event, so the existing validation, ncryptsec
      // detection and profile preview all run exactly as if it had been typed.
      // Stacked rather than side by side: "Scan with camera" wrapped to two lines in
      // a ~360px panel, which made the pair look cramped and unequal. Icon + label
      // matches the Generate/Import buttons on the Accounts tab (.add-actions).
      const camBtn = h('button', { className: 'secondary hidden', type: 'button' }, [
        icon('qr'),
        h('span', { textContent: 'Scan with camera' }),
      ]);
      const fileBtn = h('button', { className: 'secondary', type: 'button' }, [
        icon('file-text'),
        h('span', { textContent: 'Choose file' }),
      ]);
      const scanRow = h('div', { className: 'scan-qr-row' }, [camBtn, fileBtn]);
      // Labels live in their own spans: assigning textContent to the button would
      // remove the icon along with the text.
      const camLabel = camBtn.querySelector('span');
      const fileLabel = fileBtn.querySelector('span');

      camBtn.classList.remove('hidden');
      const scanHint = h('div', {
        className: 'hint compact scan-qr-hint',
        // Leads with the PDF because it's the most reliable path and the one people
        // are most likely to have — the sheet tells them keeping the file is fine.
        textContent: 'Choose your backup sheet — the PDF, a photo, or a scan. You can paste an image here too.',
      });
      const scanFile = document.createElement('input');
      scanFile.type = 'file';
      // The PDF matters as much as the image: the sheet tells people keeping the
      // file is fine, so uploading it is the obvious move — refusing it was a gap.
      scanFile.accept = 'application/pdf,image/*';
      scanFile.style.display = 'none';

      function accept(secret, how) {
        secretInput.value = secret;
        // Drive the existing pipeline rather than duplicating any of it.
        secretInput.dispatchEvent(new Event('input'));
        toast('Key read from ' + how, 'success');
      }

      async function readFile(file) {
        err.textContent = '';
        fileBtn.disabled = true;
        fileLabel.textContent = 'Reading…';
        try {
          accept(await secretFromFile(file), /pdf/i.test(file.type || '') ? 'PDF' : 'image');
        } catch (e) {
          err.textContent = e.message;
        }
        fileBtn.disabled = false;
        fileLabel.textContent = 'Choose file';
      }

      fileBtn.addEventListener('click', () => scanFile.click());
      scanFile.addEventListener('change', () => {
        const f = scanFile.files && scanFile.files[0];
        scanFile.value = ''; // let the same file be picked again after a failure
        if (f) readFile(f);
      });

      // The scan runs in its own popup window (scan-qr.html), not here: MV3 side
      // panels can't surface the camera permission prompt, so getUserMedia rejects
      // in this surface immediately. That window hands the key to the service worker,
      // which parks it for exactly one claim.
      //
      // Polling rather than an event: the panel doesn't own the window (the scanner
      // closes itself), so there's no id to hang windows.onRemoved on. A short poll
      // that stops on the first hit is simpler than tracking it.
      camBtn.addEventListener('click', async () => {
        err.textContent = '';
        if (stopCamera) stopCamera(); // a re-click replaces the previous poll
        camBtn.disabled = true;
        camLabel.textContent = 'Scanning…';
        try {
          await call({ type: 'SIDECAR_OPEN_QR_SCANNER' });
        } catch (_) {
          camBtn.disabled = false;
          camLabel.textContent = 'Scan with camera';
          err.textContent = "Couldn't open the scanner window.";
          return;
        }
        let tries = 0;
        const MAX = 180; // ~90s at 500ms, matching the worker's parked-value TTL
        const timer = setInterval(async () => {
          if (++tries > MAX) return stopCamera && stopCamera();
          let value = null;
          try {
            value = (await call({ type: 'SIDECAR_QR_SECRET_CLAIM' })).value;
          } catch (_) {
            return; // worker momentarily asleep; keep polling
          }
          if (!value) return;
          if (stopCamera) stopCamera();
          accept(value, 'camera');
        }, 500);
        // Assigned to stopCamera so the modal's close handler tears the poll down as
        // well — otherwise it keeps running after the modal is gone, and a late claim
        // would consume the one-shot key with nowhere to put it.
        stopCamera = () => {
          clearInterval(timer);
          stopCamera = null;
          camBtn.disabled = false;
          camLabel.textContent = 'Scan with camera';
        };
      });

      // Paste a screenshot straight in — the common case when the sheet was
      // photographed on a phone and sent over.
      modal.addEventListener('paste', (e) => {
        const items = (e.clipboardData && e.clipboardData.files) || [];
        const f = [...items].find((x) => /^image\//.test(x.type) || /pdf/i.test(x.type));
        if (!f) return;
        e.preventDefault();
        readFile(f);
      });
      modal.append(scanRow, scanHint, scanFile);

      // ncryptsec (NIP-49) is a password-encrypted key, so it needs a second field
      // to decrypt — shown only once the pasted value looks like one.
      const cryptPass = h('input', { type: 'password', placeholder: 'Decryption password' });
      const cryptRow = h('div', { className: 'stack hidden' }, [
        h('label', { textContent: 'Password' }),
        cryptPass,
      ]);
      modal.append(cryptRow);

      // Live preview: once the pasted key is valid, show whose account it is
      // (npub + kind 0 name/picture) so the user can confirm before importing.
      const pav = h('span', { className: 'ip-av' });
      const pname = h('div', { className: 'ip-name' });
      const pnpub = h('div', { className: 'ip-npub' });
      const preview = h('div', { className: 'import-preview hidden' }, [
        pav,
        h('div', { className: 'ip-info' }, [pname, pnpub]),
      ]);
      modal.append(preview);

      let previewSeq = 0;
      let previewTimer = null;
      async function updatePreview() {
        err.textContent = '';
        const raw = secretInput.value.trim();
        const isNcryptsec = /^ncryptsec1/i.test(raw);
        cryptRow.classList.toggle('hidden', !isNcryptsec);

        let pubkey = '';
        if (isNcryptsec) {
          if (!cryptPass.value) return preview.classList.add('hidden');
          try {
            // Awaited: this runs on the debounced password field, and each
            // keystroke re-runs a full N=2^16 scrypt — off-thread it can overlap
            // the next keystroke's run, with previewSeq sorting the winner.
            pubkey = pubkeyFromSecret(await decryptNcryptsec(raw, cryptPass.value));
          } catch (_) {
            preview.classList.add('hidden');
            return;
          }
        } else {
          pubkey = pubkeyFromSecret(raw);
        }

        const seq = ++previewSeq;
        if (!pubkey) return preview.classList.add('hidden');
        const npub = NT.nip19.npubEncode(pubkey);
        applyAvatar(pav, {});
        pname.textContent = 'Fetching profile…';
        pnpub.textContent = shortNpub(npub);
        preview.classList.remove('hidden');
        const prof = await fetchPreviewProfile(pubkey);
        if (seq !== previewSeq) return; // a newer key superseded this fetch
        if (prof && (prof.name || prof.picture)) {
          applyAvatar(pav, { picture: prof.picture, name: prof.name });
          pname.textContent = prof.name || shortNpub(npub);
        } else {
          pname.textContent = 'No profile found';
        }
      }
      secretInput.addEventListener('input', () => {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(updatePreview, 350);
      });
      cryptPass.addEventListener('input', () => {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(updatePreview, 350);
      });

      modal.append(
        h('p', {
          className: 'hint',
          textContent:
            'Your nsec stays encrypted on this device. Sidecar signs locally, so sites only get signatures, never your key. Much safer than pasting it into a website.',
        })
      );
      modal.append(err);

      const save = h('button', { className: 'primary', textContent: 'Import account' });
      save.addEventListener('click', async () => {
        err.textContent = '';
        // Busy through the decrypt: a ncryptsec import runs the same scrypt as
        // a sheet mint, and with the panel no longer frozen mid-click, an idle
        // button invites a second one.
        save.disabled = true;
        save.textContent = 'Importing…';
        try {
          const raw = secretInput.value.trim();
          if (!raw) throw new Error('Enter an nsec, ncryptsec, or hex private key.');
          const secret = /^ncryptsec1/i.test(raw) ? await decryptNcryptsec(raw, cryptPass.value) : raw;
          await call({ type: 'SIDECAR_ADD_ACCOUNT', secret });
          closeModal();
          await refresh();
          toast('Account added', 'success');
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
        save.disabled = false;
        save.textContent = 'Import account';
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(h('div', { className: 'actions' }, [save, cancel]));
      setTimeout(() => secretInput.focus(), 50);
    },
    () => { if (stopCamera) { stopCamera(); stopCamera = null; } });
  }

  // ---- npub QR ---------------------------------------------------------------------
  //
  // TWO ENCODINGS, because the clients that show one of these do not agree. Jumble encodes
  // `nostr:npub1…` (NIP-21, so a Nostr app can deep-link straight into the profile); Wisp
  // encodes the bare `npub1…`, deliberately — its rich-text parser handles nostr: URIs
  // elsewhere, so that is a choice rather than an oversight. Both scan.
  //
  // So the view offers both and defaults to `nostr:`. That default matches every other QR
  // Sidecar draws — the two Lightning-address codes and the invoice all carry their
  // scheme — and it is the form a Nostr client can act on rather than merely read. The
  // bare npub is one tap away for a scanner that would only show the user a URI it cannot
  // open, and for anyone who just wants the string.
  //
  // The choice is remembered for the session, not stored: it is a scanning preference
  // that depends on what the other person is holding, not a setting about this account.
  let _npubQrScheme = 'nostr';

  function npubQrModal(a) {
    const npub = a.npub;
    openModal((modal) => {
      const canvas = document.createElement('canvas');
      canvas.className = 'npub-qr';
      const value = h('button', { className: 'secondary npub-qr-value', title: 'Copy' });
      const valueText = h('span');
      value.append(valueText);

      const encoded = () => (_npubQrScheme === 'nostr' ? 'nostr:' + npub : npub);

      // 'H', NOT the 'M' every other QR in the panel uses, and the face is the reason.
      // A picture in the middle covers modules; H recovers up to ~30% of the code against
      // M's ~15%, which is what buys the room to cover any at all. The cost is a denser
      // grid for the same 69 characters, which at 220px is still comfortable — verified
      // by decoding the drawn code back with the face composited over it.
      function paint() {
        const v = encoded();
        try { window.SidecarQR.draw(canvas, v, 220, 'H'); } catch (_) {}
        valueText.textContent = v;
      }

      const chips = h('div', { className: 'npub-qr-modes' });
      [['nostr', 'nostr:'], ['bare', 'npub']].forEach(([mode, label]) => {
        const b = h('button', {
          className: 'npub-qr-mode' + (_npubQrScheme === mode ? ' active' : ''),
          textContent: label,
        });
        b.addEventListener('click', () => {
          _npubQrScheme = mode;
          chips.querySelectorAll('.npub-qr-mode').forEach((c) => c.classList.remove('active'));
          b.classList.add('active');
          paint();
        });
        chips.append(b);
      });

      value.addEventListener('click', async () => {
        // The ENCODED string, matching what was scanned — copying a bare npub from a
        // screen showing a nostr: URI would hand over something different from the code.
        try {
          await copyPlain(encoded());
          const prev = valueText.textContent;
          valueText.textContent = 'Copied ✓';
          setTimeout(() => { if (valueText.textContent === 'Copied ✓') valueText.textContent = prev; }, 1200);
        } catch (_) {}
      });

      const done = h('button', { className: 'ghost', textContent: 'Done' });
      done.addEventListener('click', closeModal);

      // The face sits OVER the code as an element rather than being drawn into it. Two
      // reasons: a remote picture drawn onto a canvas taints it, and stacking costs
      // nothing here — the avatar keeps applyAvatar's own loading and error handling
      // instead of this modal reimplementing it.
      //
      // Only when there IS a picture. The placeholder garnish would cover the same
      // modules while telling the scanner nothing, and an unnecessary hole in a code is
      // just a worse code.
      const stack = h('div', { className: 'npub-qr-stack' }, [canvas]);
      if (a && a.picture) {
        const face = h('div', { className: 'npub-qr-face' });
        applyAvatar(face, a);
        stack.append(face);
      }

      modal.append(
        h('h3', { textContent: displayName(a) || 'Your npub' }),
        h('div', { className: 'npub-qr-wrap' }, [stack, chips, value]),
        h('div', { className: 'actions' }, [done])
      );
      paint();
    });
  }

  function accountMenuModal(a) {
    openModal((modal) => {
      const menuItem = (label, name, onClick, danger) => {
        const b = h('button', { className: 'menu-item' + (danger ? ' danger' : '') });
        b.appendChild(icon(name));
        b.appendChild(h('span', { textContent: label }));
        b.addEventListener('click', onClick);
        return b;
      };
      const list = h('div', { className: 'menu-list' }, [
        menuItem('Copy npub', 'copy', () => {
          copyPlain(a.npub);
          toast('npub copied', 'success');
          closeModal();
        }),
        menuItem('Show npub QR', 'qr', () => npubQrModal(a)),
        menuItem('Back up private key', 'key', () => backupKeyModal(a)),
        menuItem('Rename', 'edit', () => renameModal(a)),
        menuItem('Remove account', 'trash', () => removeModal(a), true),
      ]);
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: displayName(a) }),
        list,
        h('div', { className: 'actions' }, [cancel])
      );
    });
  }

  // Compact "+ Add account" menu — once an account already exists, the two
  // full-size Generate/Import buttons collapse into this link, which opens the
  // same two choices without needing a full button each.
  function addAccountModal() {
    openModal((modal) => {
      const optionButton = (label, name, onClick) => {
        const b = h('button', { className: 'secondary' });
        b.append(icon(name), h('span', { textContent: label }));
        b.addEventListener('click', onClick);
        return b;
      };
      const generate = optionButton('Generate new', 'user-plus', () => {
        closeModal();
        generateAccount();
      });
      const importBtn = optionButton('Import nsec', 'download', () => {
        closeModal();
        importAccountModal();
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Add account' }),
        h('div', { className: 'add-actions modal-add-actions' }, [generate, importBtn]),
        h('div', { className: 'actions' }, [cancel])
      );
    });
  }

  // Renders the box/copy/QR/countdown UI for a revealed secret into `container`
  // (cleared first) and starts a 30s auto-hide timer. Shared by nsecModal (a
  // single-secret reveal) and keyBackupModal (a tabbed nsec/ncryptsec reveal),
  // so both auto-hide identically. Returns a stop() to clear the timer when the
  // container is about to be replaced or the modal is closing.
  const NSEC_REVEAL_TIMEOUT_S = 30;
  const QR_REVEAL_TIMEOUT_S = 30;
  function renderSecretReveal(container, opts) {
    container.innerHTML = '';
    container.classList.add('secret-reveal'); // full-width, evenly-stacked action buttons
    const secret = opts.secret;
    const noun = opts.noun || 'nsec';
    const qrLevel = opts.qrLevel || 'M';
    // For long secrets (NWC connection strings), the QR and the text box are an
    // either/or view — showing the QR hides the string + its copy button and back
    // — so the two don't stack into an overlong panel.
    const qrExclusive = !!opts.qrExclusive;
    const hideMsg = (s) => 'Hiding in ' + s + 's. Reveal again with your PIN.';

    // ---- text-secret auto-hide ----
    // The copyable string auto-hides after a short window; its countdown sits at
    // the bottom. Paused while the QR is open (see below) so the modal can't
    // close out from under a scan in progress.
    let remaining = NSEC_REVEAL_TIMEOUT_S;
    let mainTimer = null;
    const countdown = h('p', { className: 'hint', textContent: hideMsg(remaining) });
    function stopMain() { if (mainTimer) { clearInterval(mainTimer); mainTimer = null; } }
    function startMain() {
      stopMain();
      countdown.classList.remove('hidden');
      countdown.textContent = hideMsg(remaining);
      mainTimer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) { stopMain(); if (opts.onExpire) opts.onExpire(); return; }
        countdown.textContent = hideMsg(remaining);
      }, 1000);
    }

    // ---- scannable QR (opt-in, with its own timer) ----
    // For QR sign-in on mobile clients (e.g. Wisp), moving an ncryptsec to a
    // NIP-49-aware app, or importing an NWC wallet. A QR exposes the whole secret
    // at a glance and takes time to scan, so it's behind an explicit reveal,
    // generated only on click, and carries its OWN visible countdown that hides
    // just the QR when it lapses — while it's open the text auto-hide is paused.
    // Case-sensitive bech32/URI, so encode as-is (byte mode).
    const qrCanvasWrap = h('div', { className: 'qr-reveal hidden' });
    const qrHint = h('p', { className: 'hint hidden', textContent: opts.qrHint || 'Scan to sign in on a mobile client that supports QR login.' });
    const qrCountdown = h('p', { className: 'hint hidden' });
    const showQr = h('button', { className: 'secondary qr-reveal-btn' });
    let qrShown = false, qrCanvas = null, qrRemaining = QR_REVEAL_TIMEOUT_S, qrTimer = null;
    const qrMsg = (s) => 'QR code hiding in ' + s + 's.';
    const setQrLabel = () => {
      showQr.innerHTML = '';
      showQr.append(icon('qr'), h('span', { textContent: qrShown ? 'Hide QR code' : 'Show QR code' }));
    };
    function stopQr() { if (qrTimer) { clearInterval(qrTimer); qrTimer = null; } }
    function hideQr() {
      qrShown = false;
      stopQr();
      qrCanvasWrap.classList.add('hidden');
      qrHint.classList.add('hidden');
      qrCountdown.classList.add('hidden');
      if (qrExclusive) { box.classList.remove('hidden'); copy.classList.remove('hidden'); }
      setQrLabel();
      startMain(); // resume the text-secret auto-hide
    }
    function openQr() {
      qrShown = true;
      if (!qrCanvas) {
        qrCanvas = document.createElement('canvas');
        qrCanvas.className = 'recv-qr modal-qr';
        try { window.SidecarQR.draw(qrCanvas, secret, 220, qrLevel); } catch (_) {}
        qrCanvasWrap.append(qrCanvas);
      }
      if (qrExclusive) { box.classList.add('hidden'); copy.classList.add('hidden'); }
      qrCanvasWrap.classList.remove('hidden');
      qrHint.classList.remove('hidden');
      stopMain();
      countdown.classList.add('hidden'); // the paused text countdown would be a frozen distraction
      qrRemaining = QR_REVEAL_TIMEOUT_S;
      qrCountdown.textContent = qrMsg(qrRemaining);
      qrCountdown.classList.remove('hidden');
      stopQr();
      qrTimer = setInterval(() => {
        qrRemaining -= 1;
        if (qrRemaining <= 0) { hideQr(); return; }
        qrCountdown.textContent = qrMsg(qrRemaining);
      }, 1000);
      setQrLabel();
    }
    setQrLabel();
    showQr.addEventListener('click', () => { if (qrShown) hideQr(); else openQr(); });

    const box = h('div', { className: 'secret-box', textContent: secret });
    const copy = h('button', { className: 'secondary', textContent: 'Copy ' + noun });
    copy.addEventListener('click', async () => {
      try {
        await copySecret(secret);
        toast(noun + ' copied — clipboard clears in ' + CLIPBOARD_CLEAR_S + 's', 'success');
      } catch (_) {}
    });

    container.append(
      box,
      copy,
      showQr,
      qrCanvasWrap,
      qrHint,
      qrCountdown, // sits with the QR so its timer is always in view while scanning
      h('p', {
        className: 'hint warn',
        textContent: opts.warnText || 'Anyone with this key fully controls the account. Store it somewhere safe and never share it.',
      }),
      countdown
    );
    startMain();
    return () => { stopMain(); stopQr(); };
  }

  // Show a single secret string (nsec) with copy/QR/countdown — used only for
  // the post-generate "back this up now" flow (a brand-new key has no
  // ncryptsec-export use case yet). Backing up an *existing* account's key
  // goes through keyBackupModal instead, which offers both nsec and ncryptsec.
  // Save a blob through the File System Access API when available, so the user
  // chooses the destination instead of the file dropping into ~/Downloads —
  // which cloud sync clients commonly watch — by default. Falls back to a
  // plain a.download (Firefox, older Chromium). A user cancel is a quiet
  // no-op, not an error. Returns 'saved' | 'canceled' | 'downloaded'.
  async function saveFile(blob, filename) {
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
        });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        return 'saved';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'canceled';
        // Any other failure (no directory permission, picker unavailable):
        // fall back below rather than losing the download entirely.
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return 'downloaded';
  }

  // The invitation's four faces (pdf-backup.js embeds them). Same-origin reads of
  // files the extension ships, cached for the panel's lifetime so a second sheet
  // costs nothing. Any failure returns null and the PDF falls back to the
  // standard-14 Times trio — an uglier sheet still beats no sheet, and the plain
  // telegram never wanted these fonts in the first place.
  let sheetFontCache = null;
  async function sheetFonts() {
    if (sheetFontCache !== null) return sheetFontCache;
    const read = async (f) => new Uint8Array(await (await fetch(`fonts/${f}`)).arrayBuffer());
    try {
      sheetFontCache = {
        script: await read('pinyon-script.ttf'),
        text: await read('ebgaramond-regular.ttf'),
        textItalic: await read('ebgaramond-italic.ttf'),
        display: await read('playfair-500.ttf'),
      };
    } catch (e) {
      sheetFontCache = null; // stays null; `!== null` above re-fetches next time
    }
    return sheetFontCache;
  }

  // Download the printable backup sheet (see pdf-backup.js) for one account.
  // Generated entirely in the panel — the nsec never leaves the extension, and no
  // network call is involved. `ncryptsec` (optional) asks for the encrypted
  // masquerade sheet instead of the plain telegram; the password behind it never
  // reaches this function's inputs, let alone the PDF.
  async function downloadBackupSheet(nsec, account, ncryptsec) {
    try {
      const npub = (account && account.npub) || (nsec ? NT.nip19.npubEncode(NT.nip19.decode(nsec).data) : '');
      const blob = window.SidecarBackupPdf.build({
        nsec,
        npub,
        // Only present for an existing account; a key made seconds ago has no
        // profile yet, and the sheet falls back to "THE BEARER OF THIS SHEET".
        name: account && account.name ? displayName(account) : '',
        ncryptsec: ncryptsec || '',
        fonts: ncryptsec ? await sheetFonts() : null,
      });
      const how = await saveFile(blob, window.SidecarBackupPdf.filename(npub, ncryptsec));
      if (how === 'canceled') return true; // changed their mind; nothing to report
      // Addresses the file rather than the printed sheet. Keeping the PDF is fine —
      // a password manager or an encrypted drive is a good home for it. What isn't
      // fine is leaving it in ~/Downloads or mailing it to yourself, so say that
      // rather than telling people to delete something they may want to keep.
      toast('Saved — store it safely, never by email', 'success');
      return true;
    } catch (e) {
      toast("Couldn't create the backup sheet", 'error');
      return false;
    }
  }

  // Password fields for the encrypted backup sheet (audit #195), shown only when
  // the Profile page's "Encrypt the sheet" toggle sent the user here — the choice
  // was made before the PIN gate, so there is no second checkbox inside it.
  // Returns { block, collect } — collect(nsec, errEl) gives the ncryptsec on
  // success, or null with errEl filled when the password pair is invalid. The
  // password is used once, in-panel, and dropped — same discipline as the
  // ncryptsec tab in keyBackupModal, which this deliberately mirrors.
  function encryptedPageControls(goBtn) {
    const pass = h('input', { type: 'password', placeholder: 'At least 8 characters' });
    const pass2 = h('input', { type: 'password', placeholder: 'Confirm password' });
    const block = h('div', {}, [
      // Said up front, because the field looks like a login field: this is
      // not where an existing password gets entered, it's where a new one is
      // coined, for this sheet alone.
      h('p', {
        className: 'hint',
        textContent: 'This password is unique to the sheet — choose a new one, not one you use anywhere else.',
      }),
      h('label', { textContent: 'Set a password' }),
      pass,
      h('label', { textContent: 'Confirm password' }),
      pass2,
      // The two secrets get conflated the moment both are called passwords:
      // the PIN unlocks Sidecar on this device, this one travels with the
      // paper and is the only way back into the printed sheet.
      h('p', {
        className: 'hint',
        textContent: 'This unlocks the printed sheet. It is not your Sidecar PIN.',
      }),
    ]);
    // Live check/x feedback on the pair, same as the ncryptsec tab and PIN
    // creation, gating the go button: it starts disabled and opens only when
    // the pair is long enough and matching. The returned validate is for the
    // click handler's error paths, which must not blindly re-enable the button
    // while the pair stands invalid.
    // AFTER the block is assembled, not before: addPinIndicator wraps each
    // input in place, and on a detached input the wrap never travels — building
    // the block afterwards moves the inputs out of their wraps, orphaning the
    // checkmarks exactly where they're wanted. (The ncryptsec tab never hit
    // this because it validates after body.append.)
    const validate = attachPinValidation(pass, pass2, goBtn);
    return {
      validate,
      block,
      // Async: the NIP-49 mint is a second-plus of scrypt, off-thread via the
      // worker, so the modal's "Preparing…" state is real feedback rather than a
      // label the frozen panel could never paint.
      collect: async (nsec, errEl) => {
        if (!pass.value || pass.value.length < 8) {
          errEl.textContent = 'Use a password of at least 8 characters.';
          return null;
        }
        if (pass.value !== pass2.value) {
          errEl.textContent = 'Passwords do not match.';
          return null;
        }
        try {
          return await nip49('encrypt', [NT.nip19.decode(nsec).data, pass.value]);
        } catch (_) {
          errEl.textContent = 'Could not encrypt the key.';
          return null;
        }
      },
    };
  }

  // Offered once, after the setup wizard, so the sheet carries their name.
  // Dismissible: the key is already stored, so gating anything here would be
  // theatre. Copy is deliberately two lines — this renders in a ~360px panel,
  // and a wall of text in a small rectangle just gets clicked past.
  //
  // Plain sheet only, on purpose. This is a minute into the user's first
  // session, and almost nobody has heard of an ncryptsec — the encrypted sheet
  // is offered later, from Profile → Data backup, by people who know what
  // they're opting into.
  function backupSheetPromptModal(nsec, account) {
    openModal((modal) => {
      const grab = h('button', { className: 'primary', textContent: 'Download' });
      grab.addEventListener('click', () => {
        closeModal();
        downloadBackupSheet(nsec, account);
      });
      const skip = h('button', { className: 'ghost', textContent: 'Not now' });
      skip.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Print a backup sheet' }),
        h('p', {
          className: 'hint',
          textContent: 'One page with your key and a QR code. Print it, or keep the file somewhere safe.',
        }),
        h('div', { className: 'actions' }, [grab, skip])
      );
    });
  }

  function nsecModal(opts) {
    let stop = null;
    openModal(
      (modal) => {
        const body = h('div', {});
        const done = h('button', { className: 'primary', textContent: "I've saved it" });
        done.addEventListener('click', closeModal);

        // No sheet button here on purpose. At account creation there is no profile
        // yet, and the sheet prints the display name — one taken now is addressed to
        // "THE BEARER OF THIS SHEET" permanently. It's offered after the setup
        // wizard instead (see generateAccount), and from Profile → Data backup.
        modal.append(
          h('h3', { textContent: opts.title }),
          opts.intro ? h('p', { className: 'hint', textContent: opts.intro }) : document.createTextNode(''),
          body,
          h('div', { className: 'actions' }, [done])
        );
        stop = renderSecretReveal(body, {
          secret: opts.secret || opts.nsec,
          noun: opts.noun,
          warnText: opts.warnText,
          qrHint: opts.qrHint,
          onExpire: closeModal,
        });
      },
      () => {
        if (stop) stop();
        // Runs on any close (button, X, or the 30s auto-hide). Defer to a fresh
        // tick: onDone opens the setup wizard (another modal), and this
        // closeModal still nulls modalCleanup and clears #modal right after this
        // callback returns — running it inline would tear the wizard back down.
        if (opts.onDone) setTimeout(opts.onDone, 0);
      }
    );
  }

  // Shown once, right after the PIN is created — before the empty-state welcome
  // hero appears. There is no reset flow for this PIN (that's the point of local
  // encryption), so this is the one moment to make sure it actually got captured
  // somewhere durable, not just typed and forgotten. A gently swaying antique key
  // (distinct from the small modern 'key' glyph used elsewhere) draws the eye.
  function pinReminderModal(onDone) {
    openModal(
      (modal) => {
        const keyWrap = h('div', { className: 'pin-reminder-icon' });
        keyWrap.innerHTML =
          '<svg class="pin-reminder-key" viewBox="0 0 36 24" fill="none" stroke="currentColor" ' +
          'stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="8" cy="12" r="6" stroke-width="2.25"></circle>' +
          '<line x1="8" y1="9.5" x2="8" y2="14.5" stroke-width="1.4"></line>' +
          '<line x1="5.5" y1="12" x2="10.5" y2="12" stroke-width="1.4"></line>' +
          '<line x1="14" y1="12" x2="30" y2="12" stroke-width="2.25"></line>' +
          '<line x1="24" y1="12" x2="24" y2="17" stroke-width="2.25"></line>' +
          '<line x1="29" y1="12" x2="29" y2="16" stroke-width="2.25"></line>' +
          '</svg>';
        const ok = h('button', { className: 'primary', textContent: 'OK, got it' });
        ok.addEventListener('click', closeModal);
        const body = h('p', { className: 'hint pin-reminder-body' });
        body.append(
          document.createTextNode('Write it down, or save it in a password manager, before you go any further. '),
          h('strong', { className: 'pin-reminder-warn', textContent: "This PIN can't be recovered" }),
          document.createTextNode(' — only a separate backup of your keys can get your accounts back.')
        );
        modal.append(
          keyWrap,
          h('h3', { className: 'pin-reminder-title', textContent: 'Save your PIN somewhere safe' }),
          body,
          h('div', { className: 'actions' }, [ok])
        );
      },
      () => { if (onDone) setTimeout(onDone, 0); }
    );
  }

  // One-time notice for keystores that predate the 15-minute auto-lock default:
  // their Settings were never touched, so 1.4 turned auto-lock on for them
  // silently. Tell them — and remind them the unlock PIN is unrecoverable, since
  // they also predate the save-your-PIN reminder above. New keystores never see
  // this (SIDECAR_INIT stores the default explicitly). Writing the resolved value
  // back as their explicit setting also means a future default change can't
  // silently move it again.
  let autoLockNoticePending = false;
  async function maybeShowAutoLockNotice(settings) {
    if (autoLockNoticePending) return;
    if (!settings || !settings.autoLockDefaulted || settings.autoLockNoticeShown) return;
    autoLockNoticePending = true;
    try {
      await call({
        type: 'SIDECAR_SET_SETTINGS',
        settings: { autoLockMinutes: settings.autoLockMinutes, autoLockNoticeShown: true },
      });
    } catch (_) {
      autoLockNoticePending = false; // couldn't persist; try again next refresh
      return;
    }
    autoLockNoticeModal(settings.autoLockMinutes);
  }

  function autoLockNoticeModal(minutes) {
    openModal((modal) => {
      const body = h('p', { className: 'hint pin-reminder-body' });
      body.append(
        document.createTextNode('Sidecar now locks itself after ' + minutes + ' minutes of inactivity. Unlocking uses the PIN you chose when you set up Sidecar — '),
        h('strong', { className: 'pin-reminder-warn', textContent: "it can't be recovered" }),
        document.createTextNode(", so make sure it's written down or in a password manager. You can adjust or turn off auto-lock in Settings.")
      );
      const settingsBtn = h('button', { className: 'ghost', textContent: 'Auto-lock settings' });
      settingsBtn.addEventListener('click', () => {
        closeModal();
        hide($('view-main'));
        show($('view-settings'));
        // The control this button names sits in Security & backup — expand it, or
        // the button lands the user on a wall of collapsed headers.
        openSettingsSection('security');
        renderSettings();
      });
      const ok = h('button', { className: 'primary', textContent: 'OK, got it' });
      ok.addEventListener('click', closeModal);
      modal.append(
        h('h3', { className: 'pin-reminder-title', textContent: 'Sidecar now locks automatically' }),
        body,
        h('div', { className: 'actions' }, [settingsBtn, ok])
      );
    });
  }

  // PIN-gated step-up, then the tabbed nsec/ncryptsec backup view below.
  // opts.sheetOnly: the caller wants the printable sheet, so the PIN gate hands the
  // revealed nsec straight to the download instead of putting it on screen. Same
  // gate either way — the sheet is the key in another wrapper.
  // opts.encrypted (sheetOnly only): the masquerade sheet, so the export-password
  // pair rides this same flow — the user is already here with their PIN out.
  // Both callers now use the full flow (the Profile page's standalone sheet entry
  // went away once the modal itself offered every sheet variant), so these opts
  // currently have no caller — kept because the direct-to-print path is a working
  // variant we may re-expose, and removing it would take encryptedPageControls
  // with it.
  function backupKeyModal(a, opts) {
    const sheetOnly = !!(opts && opts.sheetOnly);
    const encrypted = sheetOnly && !!(opts && opts.encrypted);
    openModal((modal) => {
      const pin = h('input', { type: 'password', maxLength: 32 });
      const err = h('div', { className: 'error' });
      const goLabel = encrypted ? 'Download encrypted sheet' : sheetOnly ? 'Download sheet' : 'Reveal';
      const go = h('button', { className: 'primary', textContent: goLabel });
      // Built after go because the password pair gates it.
      const enc = encrypted ? encryptedPageControls(go) : null;
      go.addEventListener('click', async () => {
        err.textContent = '';
        if (!pin.value) return (err.textContent = 'Enter your PIN.');
        go.disabled = true;
        go.textContent = sheetOnly ? 'Preparing…' : 'Revealing…';
        try {
          const r = await call({ type: 'SIDECAR_REVEAL_NSEC', pubkey: a.pubkey, pin: pin.value });
          // Validate the optional password pair BEFORE closing: a mismatch must
          // keep this modal (and its typed PIN) up for a fix, not drop the user
          // back to the account list to start over.
          let nc = '';
          if (enc) {
            nc = await enc.collect(r.nsec, err);
            if (nc === null) {
              go.disabled = !enc.validate();
              go.textContent = goLabel;
              return;
            }
          }
          closeModal();
          if (sheetOnly) downloadBackupSheet(r.nsec, a, nc);
          else setTimeout(() => keyBackupModal(a, r.nsec), 0);
        } catch (e) {
          err.textContent = e.message;
          go.disabled = enc ? !enc.validate() : false;
          go.textContent = goLabel;
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: sheetOnly ? 'Download key sheet' : 'Back up private key' }),
        h('p', {
          className: 'hint',
          textContent: sheetOnly
            ? 'Enter your PIN to build a printable backup sheet for ' + displayName(a) + '.'
            : 'Enter your PIN to reveal the key for ' + displayName(a) + '.',
        }),
        h('label', { textContent: 'PIN' }),
        pin,
        ...(enc ? [enc.block] : []),
        err,
        h('div', { className: 'actions' }, [go, cancel])
      );
    });
  }

  // Tabbed nsec/ncryptsec backup view — one PIN-gated reveal (backupKeyModal,
  // above) covers both, since ncryptsec is just the same key in a different,
  // password-encrypted format (not a separate secret). Keeping them as tabs of
  // one screen makes that relationship obvious, instead of two menu items that
  // could read as two different exportable secrets.
  //
  // nsec shows immediately with the standard reveal UI. ncryptsec isn't a
  // passive view — switching to it shows a small "set an export password" form
  // first, then the standard reveal UI once submitted. Switching tabs stops
  // whatever's currently revealed (its own 30s countdown) rather than trying
  // to share one timer across both.
  function keyBackupModal(a, nsec) {
    let stopReveal = null;
    // The ncryptsec minted on the ncryptsec tab THIS visit — the only one the
    // sheet button may print, and cleared on every tab switch: the password
    // form resets with it, and a sheet printed later must never carry a secret
    // encrypted under a password nobody is looking at anymore.
    let currentNcryptsec = null;
    // The ncryptsec tab's password form, reachable from the sheet button: with
    // the form still up, a sheet click completes the form's job — validate,
    // mint, print — without the reveal.
    let ncPass = null, ncPass2 = null, ncErr = null;
    function stop() {
      if (stopReveal) { stopReveal(); stopReveal = null; }
    }

    openModal(
      (modal) => {
        const body = h('div', { className: 'key-backup-body' });

        function showNsecTab() {
          stop();
          stopReveal = renderSecretReveal(body, {
            secret: nsec,
            noun: 'nsec',
            warnText: 'Anyone with this key fully controls the account. Store it somewhere safe and never share it.',
            qrHint: 'Scan to sign in on a mobile client that supports QR login.',
            onExpire: closeModal,
          });
        }

        function showNcryptsecTab() {
          stop();
          body.innerHTML = '';
          const pass = h('input', { type: 'password', placeholder: 'At least 8 characters' });
          const pass2 = h('input', { type: 'password', placeholder: 'Confirm password' });
          const err = h('div', { className: 'error' });
          ncPass = pass;
          ncPass2 = pass2;
          ncErr = err;
          const go = h('button', { className: 'primary', textContent: 'Encrypt & show' });
          go.addEventListener('click', async () => {
            err.textContent = '';
            if (!pass.value || pass.value.length < 8) return (err.textContent = 'Use a password of at least 8 characters.');
            if (pass.value !== pass2.value) return (err.textContent = 'Passwords do not match.');
            go.disabled = true;
            go.textContent = 'Encrypting…';
            try {
              const ncryptsec = await nip49('encrypt', [NT.nip19.decode(nsec).data, pass.value]);
              currentNcryptsec = ncryptsec;
              revealNcryptsec(); // rebuilds the body, taking the form (and its button) with it
            } catch (e) {
              err.textContent = 'Could not encrypt the key.';
              // Restore through the pair's own validator, not blindly: the
              // button's enabled state belongs to the passwords, not to this click.
              go.disabled = !validatePair();
              go.textContent = 'Encrypt & show';
            }
          });
          body.append(
            h('p', {
              className: 'hint',
              textContent:
                "This is not the same as your nsec — it won't work anywhere that only accepts a plain nsec. Choose a password to encrypt it with; you'll need to give this exact password to wherever you import it.",
            }),
            h('label', { textContent: 'Password' }),
            pass,
            h('label', { textContent: 'Confirm password' }),
            pass2,
            err,
            h('div', { className: 'actions' }, [go])
          );
          // Live length/match feedback (green check / red x) on the export
          // password pair, same as PIN creation/change; gates the button.
          // validatePair is what the go handler's error path restores through.
          const validatePair = attachPinValidation(pass, pass2, go);
        }

        // The ncryptsec reveal, factored out so the sheet button can re-run it:
        // a fresh renderSecretReveal is a fresh 30s window, the same restart the
        // nsec tab's sheet click gets.
        function revealNcryptsec() {
          stop();
          stopReveal = renderSecretReveal(body, {
            secret: currentNcryptsec,
            noun: 'ncryptsec',
            warnText: 'Anyone with this ncryptsec and the password fully controls the account. Store them somewhere safe, separately from each other.',
            qrHint: 'Scan to import into another NIP-49-compatible app.',
            onExpire: closeModal,
          });
        }

        const tabNsec = h('button', { className: 'modal-tab active', textContent: 'nsec' });
        const tabNcrypt = h('button', { className: 'modal-tab', textContent: 'ncryptsec' });
        tabNsec.addEventListener('click', () => {
          if (tabNsec.classList.contains('active')) return;
          tabNsec.classList.add('active');
          tabNcrypt.classList.remove('active');
          currentNcryptsec = null;
          showNsecTab();
          syncSheetLabel();
        });
        tabNcrypt.addEventListener('click', () => {
          if (tabNcrypt.classList.contains('active')) return;
          tabNcrypt.classList.add('active');
          tabNsec.classList.remove('active');
          currentNcryptsec = null;
          showNcryptsecTab();
          syncSheetLabel();
        });

        const done = h('button', { className: 'primary', textContent: "I've saved it" });
        done.addEventListener('click', closeModal);

        // Also offered here, so someone who came to look at the key can leave with
        // the printable copy instead of reaching for a screenshot. Tab-aware: the
        // nsec tab prints the telegram; the ncryptsec tab prints the masquerade
        // page — from the typed password if the form is still up (the sheet goes
        // straight to paper, no reveal: the whole point of this variant is a
        // backup the secret never has to hit the screen for), or from the
        // ncryptsec already revealed. Never the plain sheet from this tab — being
        // here is a statement of intent, and honoring it is how the right version
        // gets printed from here as from the Profile page.
        const sheet = h('button', { className: 'secondary', textContent: 'Download backup sheet' });
        function syncSheetLabel() {
          sheet.textContent = tabNcrypt.classList.contains('active')
            ? 'Download encrypted sheet'
            : 'Download backup sheet';
        }
        sheet.addEventListener('click', async () => {
          if (!tabNcrypt.classList.contains('active')) {
            await downloadBackupSheet(nsec, a);
            // RESTART the 30s auto-hide rather than canceling it. Canceling
            // would leave the nsec on screen indefinitely; restarting gives a
            // full fresh window without removing the guard. After the save, not
            // before: the fresh window should start when the user is back, not
            // while a file picker holds their attention.
            showNsecTab();
            return;
          }
          if (currentNcryptsec) {
            await downloadBackupSheet(nsec, a, currentNcryptsec);
            // Same restart, for the revealed ncryptsec.
            revealNcryptsec();
            return;
          }
          // Password form still up: validate the typed pair (the form's own
          // checks, so the only messages here are the honest ones — too short,
          // mismatch), mint, print. "Encrypt & show" stays the other exit, for
          // those who also want to see it.
          if (!ncPass.value || ncPass.value.length < 8) return (ncErr.textContent = 'Use a password of at least 8 characters.');
          if (ncPass.value !== ncPass2.value) return (ncErr.textContent = 'Passwords do not match.');
          // Busy through the mint and the save: the scrypt is a second-plus even
          // off-thread, and with the panel live again a second click would queue
          // a second download.
          sheet.disabled = true;
          sheet.textContent = 'Preparing…';
          try {
            const ncryptsec = await nip49('encrypt', [NT.nip19.decode(nsec).data, ncPass.value]);
            // Deliberately NOT stored in currentNcryptsec: that would arm the
            // reveal-restart branch above, and a second click would then put the
            // ncryptsec on screen — the one thing this path's user declined.
            await downloadBackupSheet(nsec, a, ncryptsec);
          } catch (e) {
            ncErr.textContent = 'Could not encrypt the key.';
          }
          sheet.disabled = false;
          syncSheetLabel();
        });

        modal.append(
          h('h3', { textContent: 'Back up private key' }),
          h('p', {
            className: 'hint',
            textContent: 'Two formats of the same key for ' + displayName(a) + ' — nsec works with most apps; ncryptsec is password-protected, for apps that support it.',
          }),
          h('div', { className: 'modal-tabs' }, [tabNsec, tabNcrypt]),
          body,
          h('div', { className: 'actions' }, [sheet, done])
        );

        showNsecTab();
      },
      () => stop()
    );
  }

  function renameModal(a) {
    openModal((modal) => {
      const input = h('input', { type: 'text', value: a.name || '', placeholder: 'Display name' });
      const err = h('div', { className: 'error' });
      const save = h('button', { className: 'primary', textContent: 'Save' });
      save.addEventListener('click', async () => {
        try {
          await call({ type: 'SIDECAR_RENAME_ACCOUNT', pubkey: a.pubkey, name: input.value.trim() });
          closeModal();
          await refresh();
        } catch (e) {
          err.textContent = e.message;
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Rename account' }),
        h('label', { textContent: 'Name' }),
        input,
        h('p', { className: 'hint', textContent: 'Overrides the name from your Nostr profile on this device.' }),
        err,
        h('div', { className: 'actions' }, [save, cancel])
      );
    });
  }

  function removeModal(a) {
    openModal((modal) => {
      const err = h('div', { className: 'error' });
      const warn = h('p', {
        className: 'hint',
        textContent:
          'Removing ' +
          displayName(a) +
          ' deletes its encrypted key from this device. Make sure you have a backup of the nsec — this cannot be undone.',
      });
      const del = h('button', { className: 'danger', textContent: 'Remove account' });
      del.addEventListener('click', async () => {
        try {
          await call({ type: 'SIDECAR_REMOVE_ACCOUNT', pubkey: a.pubkey });
          closeModal();
          await refresh();
          toast('Account removed', 'success');
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(h('h3', { textContent: 'Remove account?' }), warn, err, h('div', { className: 'actions' }, [del, cancel]));
    });
  }

  // ---- settings ----
  async function renderSettings() {
    // version + update check
    const build = window.SIDECAR_BUILD || {};
    const ver = build.version || (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
    $('settings-version').textContent = ver
      ? 'Version ' + ver + (build.commit && build.commit !== 'dev' ? ' (' + build.commit + ')' : '')
      : '';
    $('check-update-status').textContent = '';

    // auto-lock
    const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
    $('autolock-select').value = String(settings.autoLockMinutes || 0);
    $('client-select').value = settings.defaultClient || DEFAULT_CLIENT;
    $('reuse-tab-toggle').checked = settings.reuseClientTab !== false; // default on
    $('paybutton-toggle').checked = settings.showPayButton !== false; // default on
    $('clienttag-toggle').checked = settings.showClientTag !== false; // default on
    $('datasync-toggle').checked = settings.confirmDataSync === true; // default off (auto-allow)
    $('na-toggle').checked = settings.nostrArchives === true; // tri-state: unset and false both render off (privacy: follow-list disclosure)
    $('pinbalance-toggle').checked = settings.pinBalanceBar === true; // default off
    $('hidebalance-toggle').checked = settings.hideBalances === true; // default off
    $('balancepeek-toggle').checked = settings.autoHideBalances === true; // default off
    syncPeekRow(); // greyed out until the switch above it is on
    $('reducemotion-toggle').checked = settings.reduceBalanceMotion === true; // default off
    // Populate from the shared list on first open, then select the saved currency.
    const fiatSel = $('fiat-select');
    if (fiatSel && !fiatSel.options.length) {
      FIAT_CURRENCIES.forEach(([code, name]) => {
        fiatSel.append(h('option', { value: code, textContent: name + ' (' + code + ')' }));
      });
    }
    fiatSel.value = settings.fiatCurrency || 'USD'; // default USD
    $('zapflash-toggle').checked = settings.zapFlash !== false; // default on
    syncFlashRow(); // disabled while Reduce motion is on, which already covers it
    // Per account: reflects the ACTIVE account, and the label below names it so the
    // scope is unmistakable when more than one account exists.
    const nip65Only = await nip65OnlyFor(state.activePubkey);
    $('nip65-only-toggle').checked = nip65Only;
    const relayBody = $('relay-section-body');
    if (relayBody) relayBody.classList.toggle('dimmed', nip65Only);
    const nip65Scope = $('nip65-only-scope');
    if (nip65Scope) {
      const acct = (state.accounts || []).find((a) => a.pubkey === state.activePubkey);
      nip65Scope.textContent = acct ? 'for ' + displayName(acct) : '';
    }
    $('autozap-toggle').checked = settings.autoZap === true;
    const azMax = Number(settings.autoZapMaxSats) || AUTOZAP_DEFAULT_MAX;
    $('autozap-max').value = String(azMax);
    $('autozap-daily-max').value = String(Number(settings.autoZapDailyMaxSats) || azMax * AUTOZAP_DAILY_MULT);
    $('autozap-max-row').classList.toggle('hidden', !$('autozap-toggle').checked);
    $('autozap-daily-row').classList.toggle('hidden', !$('autozap-toggle').checked);

    const cdOn = settings.noteCountdown !== false; // default on
    const cdSecs = NOTE_COUNTDOWN_PRESETS.includes(settings.noteCountdownSecs) ? settings.noteCountdownSecs : NOTE_COUNTDOWN_DEFAULT;
    $('countdown-toggle').checked = cdOn;
    $('countdown-presets').classList.toggle('hidden', !cdOn);
    $('countdown-presets').querySelectorAll('.preset-chip').forEach((c) =>
      c.classList.toggle('active', Number(c.dataset.secs) === cdSecs));

    // theme
    const theme = settings.theme || 'speakeasy'; // default to speakeasy
    applyTheme(theme);

    // relays
    const relays = await call({ type: 'SIDECAR_GET_RELAYS' });
    const rlist = $('relay-list');
    rlist.innerHTML = '';
    Object.keys(relays).forEach((url) => {
      const row = h('div', { className: 'item' });
      row.append(h('div', { className: 'item-main' }, [h('div', { className: 'item-sub', textContent: url })]));
      const rm = iconButton('Remove', 'trash', async () => {
        const next = { ...relays };
        delete next[url];
        await call({ type: 'SIDECAR_SET_RELAYS', relays: next });
        renderSettings();
      });
      row.append(h('div', { className: 'item-actions' }, [rm]));
      rlist.append(row);
    });
    // Same ws:// advisory as the Profile tab's NIP-65 editor, and for the same
    // reason: warn, don't reject — local and Tor relays are legitimate ws:// users.
    // Toggled here rather than in the Add handler so removals clear it too.
    $('relay-ws-warn').classList.toggle('hidden', !Object.keys(relays).some((url) => url.startsWith('ws://')));
  }

  // Currencies offered for the fiat leg of the balance display. One list feeds BOTH
  // pickers (Settings and the wallet screen), so they can't drift apart. Declared up
  // here with the other shared lists since renderSettings() below reads it.
  const FIAT_CURRENCIES = [
    ['USD', 'US dollar'], ['EUR', 'Euro'], ['GBP', 'British pound'],
    ['CAD', 'Canadian dollar'], ['AUD', 'Australian dollar'], ['CHF', 'Swiss franc'],
    ['JPY', 'Japanese yen'], ['CNY', 'Chinese yuan'], ['INR', 'Indian rupee'],
    ['BRL', 'Brazilian real'], ['MXN', 'Mexican peso'], ['NGN', 'Nigerian naira'],
    ['ZAR', 'South African rand'], ['KRW', 'South Korean won'], ['TRY', 'Turkish lira'],
    ['ARS', 'Argentine peso'],
  ];

  // ---- activity tab: connected sites (permission tiers) + signing history ----
  const LEVELS = [
    ['ask', 'Ask every time'],
    ['readonly', 'Read only'],
    ['trusted', 'Trusted'],
    ['blocked', 'Blocked'],
  ];
  const KIND_NAMES = {
    0: 'profile', 1: 'note', 3: 'contacts', 4: 'direct message', 5: 'deletion',
    6: 'repost', 7: 'reaction', 8: 'badge award', 62: 'vanish request',
    1018: 'poll response', 1059: 'gift wrap', 1068: 'poll', 1111: 'comment', 1222: 'voice message',
    1337: 'code snippet', 1985: 'label', 4454: 'DM device key', 4455: 'DM key transfer',
    4550: 'community post', 9041: 'zap goal', 9321: 'nutzap', 9734: 'zap request',
    9802: 'highlight', 10000: 'mute list', 10002: 'relay list', 10006: 'blocked relays',
    10007: 'search relays', 10012: 'favorite relays', 10015: 'interests', 10030: 'emoji list',
    10044: 'DM encryption key', 10050: 'DM relay list', 10063: 'blossom servers',
    22242: 'relay auth', 24133: 'connect', 24242: 'blossom auth', 27235: 'HTTP auth',
    30000: 'follow set', 30023: 'article', 30078: 'app data', 30315: 'status',
    30818: 'wiki article', 34550: 'community', 39089: 'starter pack', 39701: 'web bookmark',
  };

  // Which icon each signed kind gets in the Recent activity list. Everything used to
  // show the same feather, so a client firing a dozen relay auths produced an
  // unreadable column of identical quills — you couldn't see at a glance what you'd
  // actually reacted to or reposted.
  //
  // The feather is kept for genuine authorship (notes, articles, wiki, community
  // posts) so it still means "you wrote this". Everything else gets the glyph the
  // rest of Nostr already uses for it: a repeat arrow for reposts, a heart for
  // reactions, a bolt for zaps.
  //
  // Anything not listed falls back to the feather via KIND_ICON_DEFAULT, so a new
  // kind degrades to today's behavior rather than rendering blank.
  const KIND_ICON_DEFAULT = 'feather';
  const KIND_ICONS = {
    0: 'user-check',          // profile
    1: 'feather',             // note — the thing the quill is actually for
    3: 'users',               // contacts / follow list
    4: 'mail',                // direct message
    5: 'trash',               // deletion
    6: 'repeat',              // repost
    7: 'heart',               // reaction
    8: 'award',               // badge award
    62: 'trash',              // vanish request
    1018: 'bar-chart',        // poll response
    1059: 'lock',             // gift wrap
    1068: 'bar-chart',        // poll
    1111: 'message-circle',   // comment (NIP-22)
    1222: 'mail',             // voice message
    1337: 'file-text',        // code snippet
    1985: 'pin',              // label
    4454: 'key',              // DM device key
    4455: 'key',              // DM key transfer
    4550: 'users',            // community post
    9041: 'zap',              // zap goal
    9321: 'zap',              // nutzap
    9734: 'zap',              // zap request
    9802: 'edit',             // highlight
    10000: 'user-x',          // mute list
    10002: 'wifi',            // relay list
    10006: 'wifi',            // blocked relays
    10007: 'wifi',            // search relays
    10012: 'wifi',            // favorite relays
    10015: 'pin',             // interests
    10030: 'heart',           // emoji list
    10044: 'key',             // DM encryption key
    10050: 'wifi',            // DM relay list
    10063: 'flower',          // blossom servers
    22242: 'tower',           // relay auth — the flood this was mostly about
    24133: 'share',           // connect (NIP-46)
    24242: 'flower',          // blossom auth — Blossom's own mark is a blossom
    27235: 'globe',           // HTTP auth (NIP-98) — proving identity to a web server
    30000: 'users',           // follow set
    30023: 'file-text',       // article
    30078: 'copy',            // app data (NIP-78) — a client saving its own state
    30315: 'user-check',      // status
    30818: 'file-text',       // wiki article
    34550: 'users',           // community
    39089: 'users',           // starter pack
    39701: 'bookmark',        // web bookmark
  };

  const METHOD_META = {
    getPublicKey: { icon: 'key', label: () => 'Shared public key' },
    signEvent: {
      icon: (e) => KIND_ICONS[e.kind] || KIND_ICON_DEFAULT,
      label: (e) => 'Signed ' + (KIND_NAMES[e.kind] || ('kind ' + e.kind)),
    },
    getRelays: { icon: 'wifi', label: () => 'Read relay list' },
    'nip04.encrypt': { icon: 'lock', label: () => 'Encrypted a message' },
    'nip04.decrypt': { icon: 'unlock', label: () => 'Decrypted a message' },
    'nip44.encrypt': { icon: 'lock', label: () => 'Encrypted a message' },
    'nip44.decrypt': { icon: 'unlock', label: () => 'Decrypted a message' },
  };

  function relTime(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 604800) return Math.round(s / 86400) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  function siteRow(host, level, boundPk, authorizedPks, onForget) {
    const boundAcct = boundPk ? state.accounts.find((a) => a.pubkey === boundPk) : null;
    const isActiveBound = boundPk && boundPk === state.activePubkey;
    // 2+ accounts have signed in here — a multi-login client (Jumble, YakiHonne,
    // …) may be showing a different one than the binding reflects. Content
    // signs on a shared site confirm who's posting (see background.js); this
    // just surfaces that state and lets the user prune an account they no
    // longer use here, which collapses it back to a normal single-account site.
    const isShared = Array.isArray(authorizedPks) && authorizedPks.length >= 2;

    const row = h('div', { className: 'item site-item' });
    const main = h('div', { className: 'item-main' });
    main.append(h('div', { className: 'item-label', textContent: host }));
    if (boundAcct) {
      const who = h('div', { className: 'site-bound' + (isActiveBound ? '' : ' site-bound-other') });
      who.append(avatarEl(boundAcct, 'site-bound-av'));
      who.append(h('span', { textContent: 'Signs in as ' + displayName(boundAcct) }));
      main.append(who);
    }
    if (isShared) {
      const shared = h('div', { className: 'site-shared' });
      shared.append(icon('users'));
      shared.append(h('span', { textContent: authorizedPks.length + ' accounts have signed in here' }));
      const manage = h('button', { className: 'site-shared-manage', textContent: 'Manage' });
      manage.addEventListener('click', () => sharedSiteModal(host, authorizedPks));
      shared.append(manage);
      main.append(shared);
    }
    row.append(main);

    // Controls go on their own row below the host so the "Signs in as" line
    // always gets full width and never wraps mid-phrase.
    const controls = h('div', { className: 'site-controls' });
    row.append(controls);

    if (boundPk && !isActiveBound) {
      // Bound to a different account: the obvious path to switch profiles here.
      const active = state.accounts.find((a) => a.pubkey === state.activePubkey);
      const btn = h('button', {
        className: 'switch-site-btn',
        textContent: 'Use ' + (active ? displayName(active) : 'this account'),
        title: 'Switch ' + host + ' to the active account',
      });
      btn.addEventListener('click', () => switchSiteModal(host, boundAcct, active));
      controls.append(btn);
      return row;
    }

    // Bound to the active account (or unbound): tier selector + forget. Both the
    // forget confirm and its cancel act on THIS row in place (rather than
    // re-rendering the whole Activity view), so revoking a site deep in an
    // expanded list doesn't collapse it back to page one — you can act on the
    // neighbors right away.
    function buildControls() {
      controls.innerHTML = '';
      const sel = document.createElement('select');
      sel.className = 'level-select';
      LEVELS.forEach(([v, l]) => {
        const o = h('option', { value: v, textContent: l });
        if (v === level) o.selected = true;
        sel.append(o);
      });
      sel.addEventListener('change', () => call({ type: 'SIDECAR_SET_LEVEL', host, level: sel.value }));
      // Forget needs a deliberate step — first tap swaps the controls for an inline
      // "Forget this site?" confirm so a stray click can't wipe a site's trust.
      const rm = iconButton('Forget site', 'trash', () => {
        controls.innerHTML = '';
        const msg = h('span', { className: 'confirm-msg', textContent: 'Forget this site?' });
        const yes = h('button', { className: 'mini del-confirm', textContent: 'Forget' });
        const no = h('button', { className: 'mini ghost', textContent: 'Cancel' });
        no.addEventListener('click', buildControls); // restore controls in place
        yes.addEventListener('click', async () => {
          await call({ type: 'SIDECAR_REMOVE_HOST', host });
          row.remove();
          if (onForget) onForget();
        });
        controls.append(msg, yes, no);
      });
      controls.append(sel, rm);
    }
    buildControls();
    return row;
  }

  // Explain + confirm switching a site from its bound account to the active one.
  // Detaching alone isn't enough — the web client caches the old pubkey, so the
  // user must sign out and back in for Sidecar to re-bind it.
  function switchSiteModal(host, boundAcct, active) {
    const activeName = active ? displayName(active) : 'the active account';
    openModal((modal) => {
      const p = h('p', { className: 'hint' }, [
        document.createTextNode(host + ' is signing in as '),
        h('b', { textContent: displayName(boundAcct) }),
        document.createTextNode('. To use '),
        h('b', { textContent: activeName }),
        document.createTextNode(' instead:'),
      ]);
      const go = h('button', { className: 'primary', textContent: 'Detach ' + host });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      go.addEventListener('click', async () => {
        await call({ type: 'SIDECAR_CLEAR_BINDING', host });
        closeModal();
        toast('Detached. Sign out of ' + host + ' and back in as ' + activeName + '.', 'success');
        renderActivity();
      });
      modal.append(
        h('h3', { textContent: 'Switch ' + host }),
        p,
        h('ol', { className: 'restore-list' }, [
          h('li', { textContent: 'Detach the site below.' }),
          h('li', { textContent: 'On ' + host + ', sign out and sign back in.' }),
        ]),
        h('div', { className: 'actions' }, [go, cancel])
      );
    });
  }

  // Lists every account that has signed in on a shared (multi-login) site, with
  // a way to prune one the user no longer uses there. Dropping back to one
  // account collapses the site to normal — no more shared-identity confirms.
  function sharedSiteModal(host, authorizedPks) {
    openModal((modal) => {
      modal.append(
        h('h3', { textContent: host }),
        h('p', { className: 'hint', textContent: 'These accounts have signed in on this site. Every post, reaction, or message confirms who’s posting — a multi-account client’s own switcher can’t tell Sidecar which one you picked here. Remove an account below once you’re done using it on this site to go back to signing silently.' })
      );
      const list = h('div', { className: 'stack' });
      authorizedPks.forEach((pk) => {
        const a = state.accounts.find((x) => x.pubkey === pk);
        if (!a) return; // deleted account — pruned from the set server-side already
        const row = h('div', { className: 'shared-acct-row' });
        row.append(avatarEl(a, 'site-bound-av'));
        row.append(h('span', { className: 'shared-acct-name', textContent: displayName(a) }));
        const rm = iconButton('Remove from this site', 'trash', async () => {
          await call({ type: 'SIDECAR_REMOVE_SITE_ACCOUNT', host, pubkey: pk });
          closeModal();
          renderActivity();
          toast(displayName(a) + ' removed from ' + host, 'success');
        });
        row.append(rm);
        list.append(row);
      });
      modal.append(list);
      const close = h('button', { className: 'ghost', textContent: 'Close' });
      close.addEventListener('click', closeModal);
      modal.append(h('div', { className: 'actions' }, [close]));
    });
  }

  function activityRow(e) {
    // A request Sidecar refused on shape (see normalizeSignEventParams in
    // background.js) never reached the key, so it must not borrow METHOD_META's
    // "Signed …" wording — that would describe a signature that doesn't exist. The
    // reason is on the row and the shape fingerprint is on hover: this is the record
    // that was missing when the original "unrecognized kind" report came in with no
    // payload to look at.
    if (e.rejected) {
      const row = h('div', { className: 'item activity-item' });
      const iconBox = h('div', { className: 'act-icon' });
      iconBox.appendChild(icon('alert'));
      const main = h('div', { className: 'item-main' }, [
        h('div', { className: 'item-label', textContent: 'Refused an unreadable signing request' }),
        h('div', { className: 'item-sub', textContent: (e.host || '') + ' · ' + relTime(e.ts) }),
        h('div', { className: 'item-sub', textContent: String(e.rejected).replace(/^signEvent: /, '') }),
      ]);
      if (e.shape) {
        row.title = Object.keys(e.shape).map((k) => k + ': ' + e.shape[k]).join('\n');
      }
      row.append(iconBox, main);
      return row;
    }
    const meta = METHOD_META[e.method] || { icon: 'feather', label: () => e.method };
    const row = h('div', { className: 'item activity-item' });
    const iconBox = h('div', { className: 'act-icon' });
    // signEvent picks its icon from the event's kind, so `icon` may be a function.
    // Everything else is a fixed string.
    const iconName = typeof meta.icon === 'function' ? meta.icon(e) : meta.icon;
    iconBox.appendChild(icon(iconName || 'feather'));
    const main = h('div', { className: 'item-main' }, [
      h('div', { className: 'item-label', textContent: meta.label(e) }),
      h('div', { className: 'item-sub', textContent: e.host + ' · ' + relTime(e.ts) }),
    ]);
    row.append(iconBox, main);
    return row;
  }

  // How far each paginated Activity list is expanded, kept across re-renders so a
  // live refresh (a permission edit writes storage → the listener re-renders) or
  // a forget doesn't collapse a long list back to page one mid-edit. 0 = default
  // first page. Reset when the Activity tab is opened fresh (see the tab handler).
  let sitesShownN = 0;
  let logShownN = 0;
  async function renderActivity() {
    const [perms, bindings, authorized, log] = await Promise.all([
      call({ type: 'SIDECAR_GET_PERMISSIONS' }),
      call({ type: 'SIDECAR_GET_SITE_BINDINGS' }),
      call({ type: 'SIDECAR_GET_SITE_AUTHORIZED' }),
      call({ type: 'SIDECAR_GET_ACTIVITY' }),
    ]);
    const sites = $('sites-list');
    const sitesFilter = $('sites-filter');
    const sitesMore = $('sites-more');
    // Union of the active account's permissioned hosts and every bound host, so
    // a site pinned to a different account still shows up (and can be switched).
    // Ordered by most-recently-used first (per the activity log, which is already
    // newest-first) so an active site isn't buried pages deep behind stale ones;
    // sites with no logged activity yet sort after, alphabetically among themselves.
    const lastUsed = new Map();
    for (const e of log) if (e.host && !lastUsed.has(e.host)) lastUsed.set(e.host, e.ts);
    const hosts = [...new Set([...Object.keys(perms), ...Object.keys(bindings)])].sort((a, b) => {
      const ta = lastUsed.get(a), tb = lastUsed.get(b);
      if (ta != null && tb != null) return tb - ta;
      if (ta != null) return -1;
      if (tb != null) return 1;
      return a.localeCompare(b);
    });

    if (!hosts.length) {
      sites.innerHTML = '';
      sites.classList.add('empty');
      listState(sites, 'No sites have connected yet.');
      hide(sitesMore);
      hide(sitesFilter);
    } else {
      show(sitesFilter);
      sitesFilter.value = '';
      // A row forgotten in place removes just itself (see siteRow); if that was
      // the last one, drop to the empty state without a full re-render.
      const onSiteForgotten = () => {
        if (sites.querySelector('.site-item')) return;
        sites.classList.add('empty');
        listState(sites, 'No sites have connected yet.');
        hide(sitesMore);
        hide(sitesFilter);
      };
      const renderSites = () => {
        sites.innerHTML = '';
        const q = sitesFilter.value.trim().toLowerCase();
        const filtered = q ? hosts.filter((host) => host.toLowerCase().includes(q)) : hosts;
        sites.classList.toggle('empty', !filtered.length);
        if (!filtered.length) {
          listState(sites, 'No sites match "' + sitesFilter.value.trim() + '".');
          hide(sitesMore);
          return;
        }
        // The list can get long — show a handful, then paginate (like the log
        // below). Re-render restores however far it was expanded (sitesShownN) so
        // a live refresh or forget mid-edit doesn't collapse it to page one.
        const SITES_PAGE = 6;
        let shownSites = 0;
        const renderSitesPage = () => {
          const target = Math.min(Math.max(SITES_PAGE, sitesShownN), filtered.length);
          filtered.slice(shownSites, target).forEach((host) =>
            sites.append(siteRow(host, perms[host] ? perms[host].level : 'ask', bindings[host] || null, authorized[host] || null, onSiteForgotten))
          );
          shownSites = target;
          sitesShownN = target;
          if (shownSites >= filtered.length) hide(sitesMore);
          else {
            show(sitesMore);
            sitesMore.textContent = 'Show more (' + (filtered.length - shownSites) + ')';
          }
        };
        sitesMore.onclick = () => { sitesShownN = Math.min(shownSites + SITES_PAGE, filtered.length); renderSitesPage(); };
        renderSitesPage();
      };
      sitesFilter.oninput = renderSites;
      renderSites();
    }

    // "Forget all sites" — the bulk sibling of each row's "Forget site". Audit
    // M6/S2: the bindings, tiers, shared-identity history, and the site rows of
    // the log are otherwise permanent (and the site maps uncapped), so this is
    // the one-step way out. Two-tap inline confirm like the row-level forget,
    // and the confirm names tiers and Recent activity because those are things
    // people set up or read on purpose and wouldn't expect a bare "forget" to
    // touch. Rebuilt on every render: a live re-render mid-confirm collapses it
    // back to the resting button, which loses nothing (no typed input) and keeps
    // this a single code path.
    const forgetWrap = $('sites-forget-all-wrap');
    forgetWrap.innerHTML = '';
    if (hosts.length) {
      show(forgetWrap);
      const buildForgetAll = () => {
        forgetWrap.innerHTML = '';
        const btn = h('button', { className: 'ghost', textContent: 'Forget all sites' });
        btn.addEventListener('click', () => {
          forgetWrap.innerHTML = '';
          const yes = h('button', { className: 'mini del-confirm', textContent: 'Forget' });
          const no = h('button', { className: 'mini ghost', textContent: 'Cancel' });
          no.addEventListener('click', buildForgetAll);
          yes.addEventListener('click', async () => {
            await call({ type: 'SIDECAR_FORGET_ALL_SITES' });
            sitesShownN = 0;
            logShownN = 0;
            renderActivity();
          });
          forgetWrap.append(
            h('span', {
              className: 'confirm-msg',
              textContent: 'Forget every site? Pairings, permission tiers, and Recent activity are erased.',
            }),
            yes,
            no
          );
        });
        forgetWrap.append(btn);
      };
      buildForgetAll();
    } else {
      hide(forgetWrap);
    }

    const list = $('activity-list');
    const activityFilter = $('activity-filter');
    const more = $('activity-more');
    if (!log.length) {
      list.innerHTML = '';
      listState(list, 'No signing activity yet.');
      hide(more);
      hide(activityFilter);
      return;
    }
    show(activityFilter);
    activityFilter.value = '';
    const renderActivityLog = () => {
      list.innerHTML = '';
      const q = activityFilter.value.trim().toLowerCase();
      const filtered = q ? log.filter((e) => (e.host || '').toLowerCase().includes(q)) : log;
      if (!filtered.length) {
        listState(list, 'No activity matches "' + activityFilter.value.trim() + '".');
        hide(more);
        return;
      }
      const PAGE = 30;
      let shown = 0;
      function renderPage() {
        const target = Math.min(Math.max(PAGE, logShownN), filtered.length);
        filtered.slice(shown, target).forEach((e) => list.append(activityRow(e)));
        shown = target;
        logShownN = target;
        if (shown >= filtered.length) hide(more);
        else {
          show(more);
          more.textContent = 'Show more (' + (filtered.length - shown) + ')';
        }
      }
      more.onclick = () => { logShownN = Math.min(shown + PAGE, filtered.length); renderPage(); };
      renderPage();
    };
    activityFilter.oninput = renderActivityLog;
    renderActivityLog();
  }

  $('activity-clear').addEventListener('click', async () => {
    await call({ type: 'SIDECAR_CLEAR_ACTIVITY' });
    renderActivity();
  });

  // Live-refresh the Activity tab when the background records new signing
  // activity, a site binding moves (e.g. a login re-pairs a host), or a
  // permission changes — otherwise the visible list goes stale until the user
  // leaves and re-enters the tab. Skipped while either filter is in use, since
  // a re-render resets filter text and pagination.
  let activityRefreshTimer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    // Relax-grant changes (grant / revoke / expiry) live in session storage. This
    // system-level channel is more reliable than the runtime broadcast — it catches
    // the case where a window opens from the standalone popup while the panel is
    // open, so the bottom bar appears the moment the grant is written.
    if (area === 'session' && 'sidecar_relax_grants' in changes && state && !state.locked) syncRelax();
    if (area !== 'local') return;
    // The keystore's active account can change from another Sidecar view (e.g. a
    // second window switching accounts). Storage change events reach every view, so
    // treat an active-pubkey change as authoritative and re-sync — otherwise this
    // panel keeps showing (and composing/signing as) a stale account.
    if ('sidecar_active_pubkey' in changes && state && !state.locked
        && changes.sidecar_active_pubkey.newValue !== state.activePubkey) {
      refresh();
      return;
    }
    if (!('sidecar_activity' in changes) && !('sidecar_site_accounts' in changes) && !('sidecar_permissions' in changes)) return;
    if (!state || state.locked) return;
    const activeTab = document.querySelector('.tab.active');
    if (!activeTab || activeTab.dataset.tab !== 'activity') return;
    const sitesFilter = $('sites-filter');
    const actFilter = $('activity-filter');
    const filterBusy = (el) => el && !el.classList.contains('hidden') && (el.value.trim() || document.activeElement === el);
    if (filterBusy(sitesFilter) || filterBusy(actFilter)) return;
    clearTimeout(activityRefreshTimer);
    activityRefreshTimer = setTimeout(async () => {
      // Keep the scroll position across a live re-render (a permission edit lands
      // here via storage) so editing a site deep in the list doesn't jump to top.
      const scroller = $('tab-activity').closest('.content');
      const top = scroller ? scroller.scrollTop : 0;
      await renderActivity();
      if (scroller) scroller.scrollTop = top;
    }, 400);
  });

  // ---- profile (active account): view + edit + publish kind 0 ----
  // Fetch the active account's latest kind:0 (used for both display and edit-merge).
  async function fetchActiveProfile() {
    const pk = state.activePubkey;
    if (!pk) return { content: {}, event: null };
    const rec = await getProfile(pk);
    return { content: rec ? rec.content : {}, event: null };
  }

  // Skeleton placeholder mirroring the centered profile layout while kind:0 loads.
  function profileSkeleton() {
    const sk = h('div', { className: 'profile-skeleton' });
    sk.append(h('div', { className: 'sk sk-banner' }));
    sk.append(h('div', { className: 'sk sk-avatar' }));
    sk.append(h('div', { className: 'sk sk-line sk-name' }));
    sk.append(h('div', { className: 'sk sk-line sk-sub' }));
    sk.append(h('div', { className: 'sk sk-line sk-bio1' }));
    sk.append(h('div', { className: 'sk sk-line sk-bio2' }));
    return sk;
  }

  // Verify a NIP-05 identifier resolves, at its domain's /.well-known/nostr.json,
  // to this account's own pubkey. The endpoint is required by NIP-05 to allow CORS,
  // so this is a plain fetch — no extension permission beyond the existing
  // host_permissions. Returns false (not an error) for anything that doesn't
  // confirm a match, since a stale or unreachable NIP-05 is common and not
  // necessarily malicious.
  // NIP-05 VERIFICATION HAS SIX OUTCOMES, NOT TWO (#179).
  //
  // This used to return a bare boolean, so the badge said "Couldn't verify" for all of
  // them — and got the severity backwards in both directions at once. Someone offline saw
  // an alarming badge on a perfectly good NIP-05; someone whose handle now resolves to a
  // DIFFERENT KEY saw the same mild warning and had no reason to act. That second case is
  // the one worth interrupting a person over: they lost the handle, the host reassigned
  // it, or they are unknowingly impersonating.
  //
  // The split that matters is verdict versus ignorance:
  //   ok / mismatch / absent  — we asked, the domain answered, this IS the answer
  //   http / malformed / unreachable — we never got an answer; says nothing about them
  //
  // Note on CORS: NIP-05 requires the header and plenty of hosts get it wrong, but the
  // panel is an extension page holding host permissions, so it is not subject to CORS in
  // the first place. A host that omits the header still answers us. That is why there is
  // no 'cors' status here — from this context it is not a distinct outcome, and in a page
  // context it would be indistinguishable from being offline anyway.
  const NIP05_TIMEOUT = 6000;
  const NIP05_TTL = 10 * 60 * 1000;
  // A failure we could not explain expires fast: someone on a train should not carry a
  // stale "unreachable" for ten minutes after their connection comes back.
  const NIP05_TTL_UNKNOWN = 30 * 1000;
  const _nip05Cache = new Map(); // nip05|pubkey -> { res, expiresAt }

  async function checkNip05(nip05, pubkey) {
    const at = nip05.indexOf('@');
    const name = at === -1 ? '_' : nip05.slice(0, at);
    const domain = at === -1 ? nip05 : nip05.slice(at + 1);
    if (!domain || !name) return { status: 'malformed', ok: false, known: true };
    let res;
    try {
      res = await fetch(
        'https://' + domain + '/.well-known/nostr.json?name=' + encodeURIComponent(name),
        { signal: AbortSignal.timeout(NIP05_TIMEOUT) }
      );
    } catch (_) {
      // Offline, DNS failure, TLS failure, or a timeout. We did not reach the domain, so
      // we know nothing about the identifier — which is NOT the same as it being wrong.
      return { status: 'unreachable', ok: false, known: false };
    }
    if (!res.ok) return { status: 'http', ok: false, known: false, code: res.status };
    let data;
    try {
      data = await res.json();
    } catch (_) {
      return { status: 'malformed', ok: false, known: false };
    }
    const names = data && data.names;
    if (!names || typeof names !== 'object') return { status: 'malformed', ok: false, known: false };
    const key = Object.keys(names).find((k) => k.toLowerCase() === name.toLowerCase());
    // Checked, and the domain does not list this name at all.
    if (!key) return { status: 'absent', ok: false, known: true };
    // Checked, and it points somewhere else. The loud one.
    if (names[key] !== pubkey) return { status: 'mismatch', ok: false, known: true, found: names[key] };
    return { status: 'ok', ok: true, known: true };
  }

  // CACHED, because the overview drawer is expanded by default: every render of the
  // Accounts tab used to fire a request at a third party, telling that host when the user
  // is active and how often. Same answer, far fewer disclosures.
  async function verifyNip05(nip05, pubkey) {
    const cacheKey = nip05 + '|' + pubkey;
    const hit = _nip05Cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.res;
    const res = await checkNip05(nip05, pubkey);
    _nip05Cache.set(cacheKey, {
      res,
      expiresAt: Date.now() + (res.known ? NIP05_TTL : NIP05_TTL_UNKNOWN),
    });
    return res;
  }

  // SEVERITY FOLLOWS CERTAINTY, not just failure. A verdict against you is colored like
  // one; not having reached the host is neutral and shaped differently, so it cannot be
  // mistaken for a finding about the identifier.
  const NIP05_BADGE = {
    ok:          { cls: 'nip05-ok',      glyph: 'check', title: 'Verified' },
    mismatch:    { cls: 'nip05-alarm',   glyph: 'alert', title: 'This address points to a different key' },
    absent:      { cls: 'nip05-bad',     glyph: 'alert', title: 'This domain doesn’t list this name' },
    http:        { cls: 'nip05-unknown', glyph: 'help',  title: 'The domain didn’t serve its nostr.json' },
    malformed:   { cls: 'nip05-unknown', glyph: 'help',  title: 'The domain’s nostr.json isn’t valid' },
    unreachable: { cls: 'nip05-unknown', glyph: 'help',  title: 'Couldn’t reach the domain to check' },
  };
  function paintNip05Badge(badge, res) {
    const b = NIP05_BADGE[res && res.status] || NIP05_BADGE.unreachable;
    badge.classList.add(b.cls);
    badge.title = b.title;
    badge.append(icon(b.glyph));
  }

  async function renderProfile() {
    const view = $('profile-view');
    const active = state.accounts.find((a) => a.pubkey === state.activePubkey);
    view.innerHTML = '';
    if (!active) {
      view.append(h('p', { className: 'hint', textContent: 'No active account.' }));
      return;
    }
    view.append(profileSkeleton());
    const { content } = await fetchActiveProfile();
    view.innerHTML = '';

    const header = h('div', { className: 'profile-header' });
    if (content.banner) {
      const banner = document.createElement('img');
      banner.className = 'profile-banner';
      banner.alt = '';
      banner.referrerPolicy = 'no-referrer';
      banner.src = content.banner;
      banner.onerror = () => banner.classList.add('profile-banner-ph');
      header.append(banner);
    } else {
      header.append(h('div', { className: 'profile-banner profile-banner-ph' }));
    }
    header.append(avatarEl({ picture: content.picture || active.picture, npub: active.npub }, 'profile-avatar'));
    view.append(header);

    // centered identity + bio
    const body = h('div', { className: 'profile-body' });
    body.append(
      h('div', {
        className: 'profile-name',
        textContent: content.display_name || content.name || active.name || shortNpub(active.npub),
      })
    );
    if (content.nip05) {
      const nip05Badge = h('span', { className: 'nip05-badge' });
      const nip05Row = h('div', { className: 'profile-meta nip05-row' }, [
        h('span', { textContent: content.nip05 }),
        nip05Badge,
      ]);
      body.append(nip05Row);
      verifyNip05(content.nip05, active.pubkey).then((res) => {
        nip05Badge.innerHTML = '';
        paintNip05Badge(nip05Badge, res);
      });
    }
    // The chip copies; the button beside it shows the code. Two affordances rather than
    // one that does both, because the chip's whole behavior is copy-on-tap and adding a
    // second meaning to the same tap would make neither obvious.
    const qrBtn = iconButton('Show npub QR', 'qr', () => npubQrModal(active));
    qrBtn.classList.add('profile-npub-qr');
    body.append(h('div', { className: 'profile-npub-row' }, [npubChip(active.npub), qrBtn]));

    // Following count (fetched from the account's kind:3). Followers are out of
    // scope for now — they require an aggregating index, not a single event.
    const followNum = h('strong', { textContent: '…' });
    // This circular-arrow used to only scroll down to the backup section — it reads as
    // a refresh, so it is one now. Follow List Recovery already sits at the bottom of
    // this screen under its own clear label, so the jump wasn't earning the icon.
    //
    // Profile data is cached for PROFILE_TTL (5 min) and the follow count is cached for
    // the whole session, so an edit made elsewhere can look stuck. This drops both for
    // the active account and refetches.
    const refreshBtn = h('button', { className: 'profile-backup-jump', title: 'Refresh profile and follow count' });
    // Clockwise, near-closed circle with a short arrow at the top right — the
    // conventional "reload" glyph. The old mark was counter-clockwise and filled,
    // which reads more like "undo" than "refresh". Stroked so it inherits the same
    // weight as the panel's other icons.
    refreshBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M20 12a8 8 0 1 1-2.34-5.66"></path>' +
      '<polyline points="20 4.5 20 9 15.5 9"></polyline></svg>';
    refreshBtn.addEventListener('click', async () => {
      if (refreshBtn.disabled) return;
      refreshBtn.disabled = true;
      refreshBtn.classList.add('spinning');
      try {
        _profileCache.delete(active.pubkey);
        followCountCache.delete(active.pubkey);
        profileFetchState.delete(active.pubkey); // clear tries + settled so it refetches
        await fetchAndStoreProfile(active.pubkey);
        renderProfile();
        toast('Profile refreshed', 'success');
      } catch (_) {
        toast("Couldn't reach your relays", 'error');
      } finally {
        // renderProfile() may have replaced this button; guard against a detached node.
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('spinning');
      }
    });
    const followStat = h('div', { className: 'profile-stats' }, [
      h('span', { className: 'profile-stat' }, [followNum, document.createTextNode(' following')]),
      refreshBtn,
    ]);
    body.append(followStat);
    getFollowCount(active.pubkey).then((n) => {
      followNum.textContent = n == null ? '—' : n.toLocaleString('en-US');
    });

    const editBtn = h('button', { className: 'secondary profile-edit-cta' });
    editBtn.append(icon('edit'), h('span', { textContent: 'Edit profile' }));
    editBtn.addEventListener('click', () => openProfileEdit(content));
    body.append(editBtn);

    if (content.about) {
      const about = h('p', { className: 'profile-about' });
      body.append(about);
      renderAbout(about, content.about);
    }
    if (content.lud16) body.append(h('div', { className: 'profile-meta' }, [boltIcon(), document.createTextNode(' ' + content.lud16)]));
    if (content.website) {
      const w = h('div', { className: 'profile-meta' });
      const a = document.createElement('a');
      a.href = normalizeUrl(content.website);
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      a.textContent = content.website;
      w.append(a);
      body.append(w);
    }
    view.append(body);

    // Offer to sync the profile's lightning address to the connected wallet's
    // address (from the NWC string) when they differ — filled in async.
    const lud16Notice = h('div', { className: 'lud16-sync hidden' });
    view.append(lud16Notice);
    maybeSuggestLud16(lud16Notice, active, content);

    renderNip65Section(view, active);
    renderBackupSection(view, active);
  }

  // If the connected wallet advertises a lightning address (NWC lud16) that
  // differs from — or is missing on — the profile, offer a one-tap update so the
  // profile matches where zaps actually land. Dismissals are remembered for the
  // session so it doesn't nag.
  const _lud16SyncDismissed = new Set(); // `${pubkey}|${walletAddr}`
  async function maybeSuggestLud16(container, active, content) {
    let walletAddr = null;
    try {
      const { lud16 } = await call({ type: 'SIDECAR_NWC_META' });
      walletAddr = lud16 || null;
    } catch (_) {}
    if (!walletAddr) return; // no wallet address to sync
    if (state.activePubkey !== active.pubkey) return; // account switched during await
    const profileAddr = (content.lud16 || '').trim();
    if (profileAddr.toLowerCase() === walletAddr.toLowerCase()) return; // already matches
    const key = active.pubkey + '|' + walletAddr;
    if (_lud16SyncDismissed.has(key)) return;

    const title = h('div', { className: 'lud16-sync-title' }, [
      boltIcon('lud16-sync-bolt'),
      h('span', { textContent: 'Lightning address' }),
    ]);
    const msg = h('p', {
      className: 'lud16-sync-msg',
      textContent: profileAddr
        ? "Your profile's lightning address differs from your connected wallet's."
        : "Add your wallet's lightning address to your profile so people can zap you.",
    });
    const addr = h('div', { className: 'lud16-sync-addr', textContent: walletAddr });
    const useBtn = h('button', { className: 'primary', textContent: profileAddr ? 'Use wallet address' : 'Add to profile' });
    const dismiss = h('button', { className: 'ghost', textContent: 'Not now' });
    useBtn.addEventListener('click', async () => {
      useBtn.disabled = true;
      useBtn.textContent = 'Updating…';
      try {
        await publishProfile({ lud16: walletAddr }, null); // unlocked → no step-up PIN; additive
        toast('Lightning address updated', 'success');
        renderProfile(); // re-render: the address now matches, so the notice won't reappear
      } catch (e) {
        useBtn.disabled = false;
        useBtn.textContent = profileAddr ? 'Use wallet address' : 'Add to profile';
        toast(e.message, 'error');
      }
    });
    dismiss.addEventListener('click', () => { _lud16SyncDismissed.add(key); container.remove(); });
    container.append(title, msg, addr, h('div', { className: 'actions lud16-sync-actions' }, [useBtn, dismiss]));
    container.classList.remove('hidden');
  }

  // ---- rich about text: links + npub/nprofile mentions, with show more/less ----
  const normalizeUrl = (u) => (/^https?:\/\//i.test(u) ? u : 'https://' + u);
  const TOKEN_RE = /(https?:\/\/[^\s]+)|(?:nostr:)?((?:npub1|nprofile1)[0-9a-z]+)/gi;

  // Follow list cache for @mention autocomplete (invalidated on account switch)
  let followListCache = null;
  let followListPubkey = null;
  let followListInflight = null; // dedupe concurrent loads (rapid @-keystrokes)

  // Seed the destructive-overwrite baseline (replaceable-baseline.js) from a kind
  // 0/3/10000 the panel already fetched off relays, so the warning works on a fresh
  // install rather than only after Sidecar has signed that kind once. The background
  // keeps the record because the standalone prompt window can't reach relays itself.
  // Fire-and-forget: this is opportunistic seeding, never on a critical path.
  function seedBaseline(pubkey, ev) {
    if (!pubkey || !ev) return;
    call({ type: 'SIDECAR_SEED_BASELINE', pubkey, event: ev }).catch(() => {});
  }

  // Lightweight follow COUNT (unique p-tags on the account's kind:3) — avoids the
  // heavy kind:0 profile batch that getFollowList() does, since the profile just
  // needs a number. Cached per pubkey (the cache itself is declared up with
  // _profileCache, since the profile screen's refresh button clears both). A completed
  // query with no follow list means they aren't following anyone yet → 0 (common for a
  // fresh account); only a thrown error returns null, which the UI renders as "—".
  async function getFollowCount(pubkey) {
    if (!pubkey) return null;
    if (followCountCache.has(pubkey)) return followCountCache.get(pubkey);
    let count = null;
    try {
      const ev = await getPool().get(await readRelayUrls(pubkey), { kinds: [3], authors: [pubkey] }, { maxWait: 8000 });
      if (ev) {
        const set = new Set(ev.tags.filter((t) => t[0] === 'p' && t[1] && t[1].length === 64).map((t) => t[1]));
        count = set.size;
        // Free ride: we already have this account's real follow list, so seed the
        // overwrite baseline from it. Without this a fresh install can't warn about a
        // wipe until after it has signed a kind:3 itself. Fire-and-forget.
        // Skip when the event has zero p-tags: that is usually a stale wipe or a
        // brand-new account, and seeding it would set a zero baseline that makes a
        // future real wipe look like no change at all.
        if (set.size > 0) seedBaseline(pubkey, ev);
      } else {
        count = 0;
      }
    } catch (_) {}
    followCountCache.set(pubkey, count);
    return count;
  }

  // ---- Nostr Archives profile API ----
  // Global username search + bulk metadata, used to (A) find people to @mention
  // who aren't in your follow list and (B) resolve follow-list names the relays
  // didn't return. Best-effort: any error or rate-limit falls back to relay data.
  // Approved endpoints only.
  //
  // OPT-IN, asked ONCE on first use (#194). Both endpoints disclose something the
  // relays never see together: suggest sends what you're typing in the composer,
  // metadata sends your follow list in 500-pubkey chunks — a new centralized
  // observer that can correlate sessions by IP. That trade is the user's call, so
  // the first time a name search would fire, the dropdown carries a one-time ask
  // (see naAskEl) instead of the spinner; either answer is remembered, and the
  // Settings toggle ("Use the Nostr Archives name index") is the only way back.
  // Tri-state: undefined = never asked, true/false = decided. The first read
  // hits storage directly rather than via call() so autocomplete keystrokes
  // can't wake the SW; after that it's memoized (see below).
  const NA_BASE = 'https://api.nostrarchives.com';
  // Tri-state memo. Reading storage on every keystroke left a gap where the
  // ask blinked out of the dropdown — and with no follow matches the box
  // closed outright for the duration of the read. With the memo the ask paints
  // in the same frame as the follow matches. Every writer updates the memo too
  // (naDecide, the Settings toggle listener), and both live in this document,
  // so it cannot drift from what's stored.
  let naSettingMemo;
  let naSettingLoaded = false;
  function naSetting() {
    if (naSettingLoaded) return Promise.resolve(naSettingMemo);
    return new Promise((resolve) =>
      chrome.storage.local.get('sidecar_settings', (r) => {
        naSettingLoaded = true;
        naSettingMemo = ((r && r.sidecar_settings) || {}).nostrArchives;
        resolve(naSettingMemo);
      }));
  }
  function naSetSettingMemo(on) { naSettingLoaded = true; naSettingMemo = on; }
  async function naEnabled() { return (await naSetting()) === true; }
  // Either button on the ask writes the decision — a click may wake the service
  // worker, unlike the read above. The memo is set first, optimistically: if
  // the write somehow fails, showing the ask again right after a deliberate
  // "Just my follows" would be worse than re-asking next session.
  async function naDecide(on) {
    naSetSettingMemo(on);
    try { await call({ type: 'SIDECAR_SET_SETTINGS', settings: { nostrArchives: on } }); } catch (_) {}
  }
  // The ask itself, rendered where the search spinner would sit in whichever
  // surface fired first — the composer's @-mention dropdown or the topbar search
  // box. mousedown + preventDefault like the result rows: a plain click would
  // blur the composer first and close the dropdown before the decision lands.
  // onDecided(on) re-runs the host surface's update, which now sees a decision.
  function naAskEl(onDecided) {
    const row = h('div', { className: 'na-ask' });
    // The whole ask swallows mousedown, not just its buttons: a mousedown on
    // the paragraph is still a focus grab that blurs the composer, and its
    // blur handler closes the dropdown — withdrawing a question mid-read.
    row.addEventListener('mousedown', (e) => e.preventDefault());
    row.append(h('p', {
      className: 'na-ask-text',
      textContent: 'Also search every Nostr name? This uses a third-party index (api.nostrarchives.com) that sees what you type and who you follow.',
    }));
    const yes = h('button', { className: 'na-ask-yes', type: 'button', textContent: 'Search everyone' });
    const no = h('button', { className: 'na-ask-no', type: 'button', textContent: 'Just my follows' });
    const pick = (on) => (e) => { e.preventDefault(); e.stopPropagation(); onDecided(on); };
    yes.addEventListener('mousedown', pick(true));
    no.addEventListener('mousedown', pick(false));
    row.append(h('div', { className: 'na-ask-actions' }, [yes, no]));
    return row;
  }
  const isHex64 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);
  let naCooldownUntil = 0; // epoch ms; a 429 backs us off until this time
  const naAvailable = () => Date.now() >= naCooldownUntil;
  function naBackoff(retryAfter) {
    const secs = Math.min(3600, Math.max(30, Number(retryAfter) || 60));
    naCooldownUntil = Date.now() + secs * 1000;
  }
  const naName = (p) => p.display_name || p.preferred_name || p.name || null;

  // Global username search → [{pubkey, name, picture}]. Returns [] on any failure.
  async function naSuggest(query) {
    if (!query || query.length < 2 || !naAvailable()) return [];
    if (!(await naEnabled())) return [];
    try {
      const resp = await fetch(NA_BASE + '/v1/search/suggest?q=' + encodeURIComponent(query) + '&limit=8', {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.status === 429) { naBackoff(resp.headers.get('retry-after')); return []; }
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.suggestions || [])
        .filter((s) => s && isHex64(s.pubkey))
        .map((s) => {
          const pk = s.pubkey.toLowerCase();
          let name = naName(s);
          if (!name) { try { name = shortNpub(NT.nip19.npubEncode(pk)); } catch (_) { name = pk.slice(0, 10) + '…'; } }
          return { pubkey: pk, name, picture: s.picture || null };
        });
    } catch (_) { return []; }
  }

  // Bulk profile metadata for a set of pubkeys → Map(pubkey → {name, picture}).
  // Chunks to the API's 500-pubkey limit; stops early on a rate-limit.
  async function naMetadata(pubkeys) {
    const out = new Map();
    const ids = [...new Set((pubkeys || []).filter(isHex64).map((p) => p.toLowerCase()))];
    if (!ids.length || !naAvailable()) return out;
    if (!(await naEnabled())) return out;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      try {
        const resp = await fetch(NA_BASE + '/v1/profiles/metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pubkeys: chunk }),
          signal: AbortSignal.timeout(8000),
        });
        if (resp.status === 429) { naBackoff(resp.headers.get('retry-after')); break; }
        if (!resp.ok) continue;
        const data = await resp.json();
        (data.profiles || []).forEach((p) => {
          if (p && isHex64(p.pubkey)) out.set(p.pubkey.toLowerCase(), { name: naName(p), picture: p.picture || null });
        });
      } catch (_) { /* keep whatever resolved so far */ }
    }
    return out;
  }

  // Fire-and-forget: fill in names/pictures the relays didn't return, mutating the
  // cached follow-list objects in place so those follows become searchable by name
  // on the next keystroke. Never blocks the initial dropdown.
  async function enrichFollowNames(list, missingPubkeys) {
    if (!missingPubkeys.length) return;
    const meta = await naMetadata(missingPubkeys);
    if (!meta.size) return;
    const byPk = new Map(list.map((c) => [c.pubkey, c]));
    meta.forEach((m, pk) => {
      const c = byPk.get(pk);
      if (c && m.name) { c.name = m.name; if (!c.picture && m.picture) c.picture = m.picture; }
    });
  }

  async function getFollowList() {
    if (followListCache && followListPubkey === state.activePubkey) return followListCache;
    if (followListInflight) return followListInflight; // a load is already running
    if (!state.activePubkey) return [];
    followListInflight = (async () => {
    try {
      const relays = await readRelayUrls(state.activePubkey);
      // maxWait bounds each relay's own connect+EOSE wait individually (they
      // run in parallel) instead of racing the WHOLE fetch against an external
      // timeout — the previous approach discarded every result the moment the
      // race lost, even if most relays had already answered, so one slow relay
      // could wipe the entire follow list down to zero. Not cached on failure,
      // so the next @-mention attempt retries instead of being stuck all session.
      const ev = await getPool().get(relays, { kinds: [3], authors: [state.activePubkey] }, { maxWait: 8000 });
      if (!ev) return [];
      const pubkeys = (ev.tags || [])
        .filter((t) => t[0] === 'p')
        .map((t) => t[1])
        .filter((pk) => pk && pk.length === 64);
      if (!pubkeys.length) {
        followListPubkey = state.activePubkey;
        return (followListCache = []);
      }
      const profiles = await getPool().querySync(relays, { kinds: [0], authors: pubkeys }, { maxWait: 10000 });
      const byPk = {};
      (profiles || []).forEach((p) => {
        if (!byPk[p.pubkey] || p.created_at > byPk[p.pubkey].created_at) byPk[p.pubkey] = p;
      });
      const list = pubkeys.map((pk) => {
        let name = null, picture = null;
        const prof = byPk[pk];
        if (prof) {
          try {
            const c = JSON.parse(prof.content);
            name = c.display_name || c.name || null;
            picture = c.picture || null;
            cacheProfile(pk, c); // share with profile previews + @-mention resolution
          } catch (_) {}
        }
        // Keep follows with no resolvable profile (no relay had their kind:0,
        // or the profile fetch just missed them) — fall back to a short npub
        // so they're still selectable instead of silently vanishing from
        // @mention results.
        if (!name) {
          try { name = shortNpub(NT.nip19.npubEncode(pk)); } catch (_) { name = pk.slice(0, 10) + '…'; }
        }
        return { pubkey: pk, name, picture };
      });
      followListPubkey = state.activePubkey;
      followListCache = list;
      // Background: fill names the relays didn't return via Nostr Archives, so
      // those follows become searchable by name. Mutates the cached objects in
      // place; not awaited, so the first dropdown render stays instant.
      enrichFollowNames(list, pubkeys.filter((pk) => !byPk[pk]));
      return followListCache;
    } catch (_) {
      return [];
    }
    })();
    try { return await followListInflight; }
    finally { followListInflight = null; }
  }

  function npubChip(npub) {
    const el = h('div', { className: 'profile-npub', title: 'Copy npub' });
    el.append(icon('copy'), h('span', { textContent: shortNpub(npub) }));
    el.addEventListener('click', async () => {
      try {
        await copyPlain(npub);
        const span = el.querySelector('span');
        const prev = span.textContent;
        span.textContent = 'Copied ✓';
        setTimeout(() => (span.textContent = prev), 1200);
      } catch (_) {}
    });
    return el;
  }

  async function resolveMentions(mentions) {
    // Only fetch pubkeys not already in the shared profile cache; batch the rest
    // in one query (efficient for many authors) and populate the shared cache so
    // these results are reused by profile previews and future mentions.
    const need = [...new Set(mentions.map((x) => x.pubkey))].filter((pk) => !cachedProfile(pk));
    if (need.length) {
      try {
        const events = await Promise.race([
          getPool().querySync(await relayUrls(false), { kinds: [0], authors: need }),
          new Promise((res) => setTimeout(() => res([]), 6000)),
        ]);
        const latest = {};
        (events || []).forEach((ev) => {
          if (!latest[ev.pubkey] || ev.created_at > latest[ev.pubkey].created_at) latest[ev.pubkey] = ev;
        });
        need.forEach((pk) => {
          let content = {};
          if (latest[pk]) { try { content = JSON.parse(latest[pk].content) || {}; } catch (_) {} }
          cacheProfile(pk, content);
        });
      } catch (_) {}
    }
    mentions.forEach(({ el, pubkey }) => {
      const rec = _profileCache.get(pubkey);
      if (rec && rec.name) el.textContent = '@' + rec.name;
    });
  }

  // Render note text into `container`: inline images/videos, links, and
  // resolved nostr:npub/nprofile mentions — like renderNotePreview, but compact
  // for a quoted-note card (no OG link cards, no recursion into nested note
  // embeds). Once the visible-text budget (`maxLen`) is hit, the preview stops
  // cleanly at the "…" — nothing after the cut renders, so a mention or image
  // further down the note can't leak past the ellipsis.
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
        try { d = NT.nip19.decode(bech); } catch (_) {}
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

  // Fill the one-level-down quote previews renderNoteText collects: fetch the
  // quoted event and show @author + a snippet. Deliberately NOT renderEmbedCard
  // — this stays read-only and shallow, and quoteSnippet strips nested refs, so
  // a quote-of-a-quote-of-a-quote can't fan out into more fetches.
  async function resolveQuotePreviews(quotes) {
    for (const { el, bech } of quotes) {
      let d = null;
      try { d = NT.nip19.decode(bech); } catch (_) {}
      const ref = d ? embedRef(d) : null;
      let ev = null;
      if (ref) {
        try {
          const relays = [...new Set([...(await relayUrls(false)), ...(ref.relays || [])])];
          ev = await Promise.race([
            poolGet(relays, ref.filter),
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
        textContent: '@' + shortNpub(NT.nip19.npubEncode(ev.pubkey)),
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
      fetchPreviewProfile(ev.pubkey).then((p) => {
        if (p && p.name) who.textContent = '@' + p.name;
      });
    }
  }

  // Snippet text for a nested quote: plain text only. nostr entity refs and bare
  // URLs are stripped rather than rendered — a 63-char nevent or a long link
  // would otherwise be the entire snippet — and a BOLT11 invoice is stripped
  // outright too: the raw string is hundreds of characters of bech32 no human
  // can read, and resolveQuotePreviews shows a quiet "⚡ invoice" caption for
  // the whole note instead of a marker pretending to be prose. Returns '' when
  // nothing readable remains; the caller decides the placeholder.
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

  // First image URL in a nested quote's content, for the small thumbnail.
  // Video stays out of the interim preview — a playable element inside a link
  // inside an embed is a tangle, and posters aren't in the content string.
  function firstQuoteImage(text) {
    const urls = String(text || '').match(/https?:\/\/[^\s]+/g) || [];
    return urls.find((u) => IMG_EXT.test(u)) || null;
  }

  function renderAbout(container, text) {
    const bodyEl = h('div', { className: 'about-clamp' });
    const mentions = [];
    let last = 0;
    let m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      if (m.index > last) bodyEl.append(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) {
        const a = document.createElement('a');
        a.href = m[1];
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        a.textContent = m[1];
        bodyEl.append(a);
      } else if (m[2]) {
        const bech = m[2];
        let pubkey = null;
        try {
          const d = NT.nip19.decode(bech);
          pubkey = d.type === 'npub' ? d.data : d.type === 'nprofile' ? d.data.pubkey : null;
        } catch (_) {}
        if (pubkey) {
          const a = document.createElement('a');
          a.className = 'mention';
          a.target = '_blank';
          a.rel = 'noreferrer noopener';
          a.href = 'https://njump.me/' + bech;
          a.textContent = '@' + bech.slice(0, 10) + '…';
          mentions.push({ el: a, pubkey });
          bodyEl.append(a);
        } else {
          bodyEl.append(document.createTextNode(m[0]));
        }
      }
      last = TOKEN_RE.lastIndex;
    }
    if (last < text.length) bodyEl.append(document.createTextNode(text.slice(last)));
    container.append(bodyEl);
    resolveMentions(mentions);

    requestAnimationFrame(() => {
      if (bodyEl.scrollHeight > bodyEl.clientHeight + 4) {
        const toggle = h('button', { className: 'show-toggle', textContent: 'Show more' });
        let expanded = false;
        toggle.addEventListener('click', () => {
          expanded = !expanded;
          bodyEl.classList.toggle('about-clamp', !expanded);
          toggle.textContent = expanded ? 'Show less' : 'Show more';
        });
        container.append(toggle);
      } else {
        bodyEl.classList.remove('about-clamp');
      }
    });
  }

  // ---- Blossom upload (BUD-02, kind:24242) with graceful fallback ----
  // Mirrors zap.cooking: try the user's own Blossom servers (kind:10063) first,
  // then fall back to the nostr.build NIP-98 flow below. No hardcoded server, so
  // users without a Blossom list keep the existing behavior unchanged.
  const BLOSSOM_AUTH_KIND = 24242;
  const BLOSSOM_SERVER_LIST_KIND = 10063;
  const BLOSSOM_CACHE_TTL = 5 * 60 * 1000;
  const BLOSSOM_UPLOAD_TIMEOUT = 30000;
  const _blossomServerCache = new Map(); // pubkey -> { servers, expiresAt }

  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function fetchBlossomServers(pubkey) {
    const cached = _blossomServerCache.get(pubkey);
    if (cached && cached.expiresAt > Date.now()) return cached.servers;
    let servers = [];
    try {
      const relays = await relayUrls(false);
      const ev = await poolGet(relays, { kinds: [BLOSSOM_SERVER_LIST_KIND], authors: [pubkey] });
      if (ev) {
        servers = ev.tags
          .filter((t) => t[0] === 'server' && t[1] && t[1].startsWith('https://'))
          .map((t) => t[1].replace(/\/$/, ''));
      }
    } catch (_) {}
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
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event: authEvent, expectedPubkey: forPubkey });
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

  // Returns a hosted URL via Blossom, or null when Blossom isn't usable (no
  // active account, no server list, or every server failed) — caller then falls
  // back to nostr.build.
  async function tryBlossomFirst(file, forPubkey) {
    const pk = forPubkey || state.activePubkey;
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

  // ---- image upload (Blossom → nostr.build via NIP-98) ----
  async function uploadImage(file, kind, forPubkey) {
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file');
    if (file.size > 10 * 1024 * 1024) throw new Error('Image too large (max 10MB)');
    const forPk = forPubkey || state.activePubkey;
    const blossomUrl = await tryBlossomFirst(file, forPk);
    if (blossomUrl) return blossomUrl;
    const url = 'https://nostr.build/api/v2/upload/' + (kind === 'profile' ? 'profile' : 'files');
    const authEvent = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['u', url], ['method', 'POST']],
      content: '',
    };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event: authEvent, expectedPubkey: forPk });
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

  // ---- note media upload (Blossom → nostr.build via NIP-98, images + video) ----
  async function uploadMedia(file, forPubkey) {
    const isImg = file.type.startsWith('image/');
    const isVid = file.type.startsWith('video/');
    if (!isImg && !isVid) throw new Error('Choose an image or video');
    if (file.size > 100 * 1024 * 1024) throw new Error('File too large (max 100MB)');
    const forPk = forPubkey || state.activePubkey;
    const blossomUrl = await tryBlossomFirst(file, forPk);
    if (blossomUrl) return blossomUrl;
    const url = 'https://nostr.build/api/v2/upload/files';
    const authEvent = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['u', url], ['method', 'POST']],
      content: '',
    };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event: authEvent, expectedPubkey: forPk });
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

  // ---- compose a kind:1 note (FAB) with Wisp-style send countdown ----
  // The review countdown is user-configurable (Settings): a toggle plus a
  // duration preset. Off → post immediately with no countdown.
  const NOTE_COUNTDOWN_PRESETS = [5, 10, 15, 25, 30];
  const NOTE_COUNTDOWN_DEFAULT = 15;
  // NIP-89 client tag. Positions 3–4 are meant to be a kind:31990 handler
  // coordinate + relay hint; we don't publish a handler, so a bare name is the
  // correct minimal form and avoids adding dead bytes to every note.
  const CLIENT_TAG = ['client', 'Sidecar'];
  // ---- About / zap-the-creator ----
  const GITHUB_URL = 'https://github.com/dmnyc/sidecar';
  const SIDECAR_SITE_URL = 'https://sidecar.top';
  const CREATOR_NPUB = 'npub1aeh2zw4elewy5682lxc6xnlqzjnxksq303gwu2npfaxd49vmde6qcq4nwx';
  const CREATOR_LN = 'daniel@breez.tips';
  const IMG_EXT = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?.*)?$/i;
  const VID_EXT = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

  // Web clients that can open a single note. Each maps a NIP-19 nevent → a URL.
  const VIEW_CLIENTS = {
    primal: { label: 'Primal', url: (ne) => 'https://primal.net/e/' + ne, profile: (np) => 'https://primal.net/p/' + np },
    jumble: { label: 'Jumble', url: (ne) => 'https://jumble.social/notes/' + ne, profile: (np) => 'https://jumble.social/users/' + np },
    yakihonne: { label: 'YakiHonne', url: (ne) => 'https://yakihonne.com/note/' + ne, profile: (np) => 'https://yakihonne.com/profile/' + np },
    iris: { label: 'Iris', url: (ne) => 'https://iris.to/' + ne, profile: (np) => 'https://iris.to/' + np },
    snort: { label: 'Snort', url: (ne) => 'https://snort.social/' + ne, profile: (np) => 'https://snort.social/' + np },
    nostrudel: { label: 'noStrudel', url: (ne) => 'https://nostrudel.ninja/#/n/' + ne, profile: (np) => 'https://nostrudel.ninja/#/u/' + np },
    zapcooking: { label: 'Zap Cooking', url: (ne) => 'https://zap.cooking/' + ne, profile: (np) => 'https://zap.cooking/user/' + np },
    noornote: { label: 'NoorNote', url: (ne) => 'https://noornote.app/note/' + ne, profile: (np) => 'https://noornote.app/profile/' + np },
    jank: { label: 'JANK', url: (ne) => 'https://jank.army/notes/' + ne, profile: (np) => 'https://jank.army/users/' + np },
    nostrich: { label: 'Nostrich', url: (ne) => 'https://nostrich.org/e/' + ne, profile: (np) => 'https://nostrich.org/p/' + np },
    coracle: { label: 'Coracle', url: (ne) => 'https://coracle.social/' + ne, profile: (np) => 'https://coracle.social/' + np },
    njump: { label: 'njump', url: (ne) => 'https://njump.me/' + ne, profile: (np) => 'https://njump.me/' + np },
  };
  const DEFAULT_CLIENT = 'jumble';

  async function preferredClient() {
    const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
    const key = (settings && settings.defaultClient) || DEFAULT_CLIENT;
    return VIEW_CLIENTS[key] || VIEW_CLIENTS[DEFAULT_CLIENT];
  }

  // Open a client URL. When the "reuse open client tab" setting is on (default),
  // navigate a tab already on that client's host and focus its window instead of
  // piling up new tabs; otherwise always open a new tab. Reading tab URLs is
  // covered by the existing host_permissions (https://*/*).
  async function openInClient(url) {
    let host = null;
    try { host = new URL(url).host; } catch (_) {}
    let reuse = true;
    try { const s = await call({ type: 'SIDECAR_GET_SETTINGS' }); reuse = s.reuseClientTab !== false; } catch (_) {}
    if (!(chrome.tabs && chrome.tabs.query)) { window.open(url, '_blank', 'noopener'); return; }
    if (!reuse || !host) { chrome.tabs.create({ url }); return; }
    chrome.tabs.query({}, (tabs) => {
      const match = (tabs || []).find((t) => {
        try { return t.url && new URL(t.url).host === host; } catch (_) { return false; }
      });
      if (match) {
        chrome.tabs.update(match.id, { active: true, url });
        if (match.windowId != null) chrome.windows.update(match.windowId, { focused: true });
      } else {
        chrome.tabs.create({ url });
      }
    });
  }

  // Open one of Sidecar's own pages (help, welcome, wallets), reusing the tab we
  // already opened it in rather than stacking duplicates.
  //
  // Deliberately NOT openInClient's approach of matching on host: every extension
  // page shares one origin, so a host match would collide across help/welcome/wallets.
  // And not tabs.query({url}) either — filtering by url needs the `tabs` permission
  // or a matching host permission, and Sidecar has neither for its own
  // chrome-extension:// origin, so that query could silently return nothing and this
  // would fix nothing. Remembering the tab id we created needs no permission at all.
  //
  // The map lives in the panel's memory, so reopening the panel forgets it and the
  // next click opens a fresh tab — the old behavior, which is the right way to be
  // wrong. `url` is re-set on focus so clicking What's new while the guide is already
  // open jumps to that section instead of appearing to do nothing.
  const ownPageTabs = {};
  function openExtensionPage(page, hash) {
    const url = chrome.runtime.getURL(page) + (hash || '');
    if (!(chrome.tabs && chrome.tabs.update)) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    const remember = (tab) => {
      void chrome.runtime.lastError;
      if (tab && tab.id != null) ownPageTabs[page] = tab.id;
    };
    const known = ownPageTabs[page];
    if (known == null) {
      chrome.tabs.create({ url }, remember);
      return;
    }
    chrome.tabs.update(known, { active: true, url }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        // Closed since we opened it — start over rather than losing the click.
        delete ownPageTabs[page];
        chrome.tabs.create({ url }, remember);
        return;
      }
      if (tab.windowId != null) chrome.windows.update(tab.windowId, { focused: true });
    });
  }

  // Resolve a kind:0 display name for an npub (best-effort, for the About credit).
  async function fetchProfileName(npub) {
    try {
      const hex = NT.nip19.decode(npub).data;
      const ev = await Promise.race([
        poolGet(await relayUrls(false), { kinds: [0], authors: [hex] }),
        new Promise((r) => setTimeout(() => r(null), 5000)),
      ]);
      if (!ev) return null;
      const c = JSON.parse(ev.content);
      return c.display_name || c.name || null;
    } catch (_) {
      return null;
    }
  }

  async function neventFor(signed) {
    let relays = [];
    try { relays = (await postRelays()).slice(0, 2); } catch (_) {}
    return NT.nip19.neventEncode({ id: signed.id, author: signed.pubkey, relays });
  }

  // Persistent "your note is live" banner with an open-in-client link.
  function dismissPostBanner() {
    if (_postBannerTimer) { clearTimeout(_postBannerTimer); _postBannerTimer = null; }
    const banner = $('post-banner');
    if (banner) hide(banner);
  }

  async function showPostBanner(signed) {
    const banner = $('post-banner');
    if (!banner) return;
    let nevent;
    try { nevent = await neventFor(signed); } catch (_) { return; }
    const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
    const key = (settings && settings.defaultClient) || DEFAULT_CLIENT;
    const client = VIEW_CLIENTS[key] || VIEW_CLIENTS[DEFAULT_CLIENT];

    if (_postBannerTimer) clearTimeout(_postBannerTimer); // only one note's link shown at a time

    banner.innerHTML = '';
    const msg = h('span', { className: 'post-banner-msg', textContent: 'Your note is live.' });
    const open = document.createElement('a');
    open.className = 'post-banner-link';
    open.href = client.url(nevent);
    open.target = '_blank';
    open.rel = 'noreferrer noopener';
    open.append(h('span', { textContent: 'Open in ' + client.label }));
    const close = h('button', { className: 'post-banner-x', title: 'Dismiss' });
    close.append(icon('x'));
    close.addEventListener('click', dismissPostBanner);
    banner.append(msg, open, close);
    show(banner);
    _postBannerTimer = setTimeout(dismissPostBanner, 60000);
  }

  let _reloadBannerTimer = null; // auto-dismiss for #reload-banner
  function dismissReloadBanner() {
    if (_reloadBannerTimer) { clearTimeout(_reloadBannerTimer); _reloadBannerTimer = null; }
    const banner = $('reload-banner');
    if (banner) hide(banner);
  }
  // After switching the active account, most clients keep signing as the account
  // they were logged in with until the page re-auths (NIP-07 gives us no way to
  // push the change). If the focused tab is a site we're connected to, offer a
  // one-tap reload so the switch takes effect there. Returns true if it showed —
  // callers use that to skip the educational tip when we've offered the action.
  async function offerTabReload() {
    if (!(chrome.tabs && chrome.tabs.query && chrome.tabs.reload)) return false;
    let tab;
    try {
      const tabs = await new Promise((res) => chrome.tabs.query({ active: true, lastFocusedWindow: true }, res));
      tab = tabs && tabs[0];
    } catch (_) { return false; }
    if (!tab || tab.id == null || !tab.url) return false;
    let host;
    try { host = new URL(tab.url).host; } catch (_) { return false; }
    if (!host) return false;
    // Only offer for a site we're actually connected to (has a per-host binding);
    // a plain browsing tab or a not-yet-logged-in site has nothing to re-auth.
    let bindings;
    try { bindings = await call({ type: 'SIDECAR_GET_SITE_BINDINGS' }); } catch (_) { return false; }
    if (!bindings || !bindings[host]) return false;
    const banner = $('reload-banner');
    if (!banner) return false;
    if (_reloadBannerTimer) clearTimeout(_reloadBannerTimer);
    banner.innerHTML = '';
    // "Reload client window", not "Reload jumble.social". The host was noise — this
    // banner only ever offers the tab you're already looking at, so naming it told
    // the user something they could see, and a long host stretched the button.
    const reload = h('button', { className: 'reload-banner-btn' }, [icon('refresh'), h('span', { textContent: 'Reload client window' })]);
    reload.title = 'Reload ' + host; // still available on hover, just not shouted
    reload.addEventListener('click', () => {
      try { chrome.tabs.reload(tab.id); } catch (_) {}
      dismissReloadBanner();
    });
    // Dismissable: the banner is a suggestion, not a task. It auto-clears after 30s,
    // but a user who has decided not to reload shouldn't have to wait it out.
    const close = h('button', {
      className: 'reload-banner-x',
      title: 'Dismiss',
      textContent: '✕',
    });
    // setAttribute, not h(): h() does Object.assign, which sets a JS PROPERTY named
    // 'aria-label' and never reaches the attribute — so this button had no accessible
    // name at all, only a hover title. Same trap as elsewhere in this file.
    close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', dismissReloadBanner);
    banner.append(reload, close);
    show(banner);
    _reloadBannerTimer = setTimeout(dismissReloadBanner, 30000);
    return true;
  }

  // Render composed note content the way a client will: text + inline media + @mentions.
  // Composer preview: inline media / links, profile mentions (@name), and nostr
  // event refs (note1/nevent/naddr) rendered as embed cards fetched from the
  // user's own relays.
  // npub1/note1 are always exactly 63 chars (5+58); use {58} to prevent the regex
  // from greedily consuming adjacent lowercase words as bech32 characters.
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
        try { d = NT.nip19.decode(bech); } catch (_) {}
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

  // Decode a nostr entity into a relay filter (+ any relay hints) for fetching.
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
        const relays = [...new Set([...(await relayUrls(false)), ...(ref.relays || [])])];
        ev = await Promise.race([
          poolGet(relays, ref.filter),
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
    applyAvatar(av, {});
    const name = h('span', { className: 'embed-name', textContent: shortNpub(NT.nip19.npubEncode(ev.pubkey)) });
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
    fetchPreviewProfile(ev.pubkey).then((p) => {
      if (!p) return;
      if (p.picture) applyAvatar(av, { picture: p.picture });
      if (p.name) name.textContent = '@' + p.name;
    });
  }

  // ---- OG / link preview cards ----
  const ogCache = new Map(); // url → { title, description, image, site } | null

  async function fetchOgMeta(url) {
    if (ogCache.has(url)) return ogCache.get(url);
    ogCache.set(url, null); // mark in-flight so parallel calls don't double-fetch
    try {
      const meta = await call({ type: 'SIDECAR_FETCH_OG', url });
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
        const decoded = NT.nip19.decode(m[1]);
        pubkey = decoded.type === 'npub' ? decoded.data : decoded.data.pubkey;
        fallback = shortNpub(NT.nip19.npubEncode(pubkey));
      } catch (_) {}
      const pill = document.createElement('span');
      pill.className = 'mention-pill';
      pill.contentEditable = 'false';
      pill.dataset.bech32 = bech32;
      const cached = pubkey ? cachedProfile(pubkey) : null;
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
        fetchPreviewProfile(pubkey).then((p) => { if (p && p.name) pill.textContent = '@' + p.name; });
      }
    }
    if (last < text.length) appendText(text.slice(last));
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
      pill.dataset.bech32 = 'nostr:' + NT.nip19.npubEncode(contact.pubkey);
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
        applyAvatar(av, c.picture ? { picture: c.picture } : {});
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
      const willSearchGlobal = ctx.query.length >= 2 && naAvailable();

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
      const cached = (followListCache && followListPubkey === state.activePubkey) ? followListCache : null;
      if (cached) followMatches = matchFollows(cached);
      paint(); // instant feedback: local matches (maybe none)
      if (!cached) {
        getFollowList().then((list) => { if (seq === acSeq) { followMatches = matchFollows(list); paint(); } });
      }

      // Global search across all of Nostr so you can tag people you don't
      // follow. Debounced; best-effort — a failure/rate-limit just clears the
      // spinner and leaves the follow matches. With the Nostr Archives setting
      // still unset, the spinner's slot carries the one-time ask instead;
      // answering it re-enters here with the decision written.
      if (!willSearchGlobal) return;
      const na = await naSetting();
      if (seq !== acSeq) return;
      if (na === true) {
        globalPending = true;
        paint();
        if (acSuggestTimer) clearTimeout(acSuggestTimer);
        acSuggestTimer = setTimeout(async () => {
          const res = await naSuggest(ctx.query);
          if (seq !== acSeq) return; // query changed since
          globals = res;
          globalPending = false;
          paint();
        }, 250);
      } else if (na !== false) {
        askEl = naAskEl((on) => { naDecide(on).then(updateAcDropdown); });
        paint();
      }
    }

    editor.addEventListener('input', () => {
      emit();
      updateAcDropdown();
      noteActivity(); // composing counts as activity — keep auto-lock at bay
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
      },
      focus: () => editor.focus(),
      close: closeAcDropdown,
    };
  }

  // ---- composer draft autosave (per account, encrypted at rest) ----
  // Routed through the background's secret store (audit M5/S1): the draft text
  // never sits in chrome.storage.local as plaintext. Read-modify-write of the
  // whole map, same shape the old direct-storage version had — the 400ms save
  // debounce is the only concurrency limiter either way.
  function loadComposeDraft(pubkey) {
    return call({ type: 'SIDECAR_SECRET_GET', store: 'drafts' })
      .then((all) => (all && all[pubkey]) || null)
      .catch(() => null);
  }
  function saveComposeDraft(pubkey, draft) {
    const hasContent = !!((draft.text && draft.text.trim()) || (draft.media && draft.media.length));
    (async () => {
      const all = (await call({ type: 'SIDECAR_SECRET_GET', store: 'drafts' })) || {};
      if (hasContent) all[pubkey] = { text: draft.text, media: draft.media, savedAt: Date.now() };
      else delete all[pubkey];
      await call({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: all });
    })().catch(() => {
      // Swallowed on purpose: the one realistic failure is Sidecar locking
      // between keystrokes — every pre-lock keystroke was already saved, and the
      // editor in memory still holds the text. A rejected save must not spam the
      // console for a draft nobody is typing into anymore.
    });
  }
  async function clearComposeDraft(pubkey) {
    try {
      const all = (await call({ type: 'SIDECAR_SECRET_GET', store: 'drafts' })) || {};
      if (!(pubkey in all)) return;
      delete all[pubkey];
      await call({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: all });
    } catch (_) {}
  }

  // The review window before something irreversible goes out, shared by the note
  // composer and page comments. Takes over `modal` and returns a stop() so the caller
  // can clear the interval if it tears the modal down another way.
  //
  // Signing happens inside onFire, never here — canceling must not have produced a
  // signature, and the countdown is the last point where canceling is still free.
  //
  // `preview` is whatever the caller wants reviewed: the note composer passes its
  // rendered note, a comment passes the target link card plus the comment text. That
  // is the whole reason this is parameterized rather than duplicated — for a comment
  // the URL is the thing most worth a second look, since it was captured from
  // whichever tab happened to be active.
  function showPostCountdown(opts) {
    const { modal, secs, title, hint, preview, confirmLabel, onFire, onCancel } = opts;
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

    // Same identity strip as the editor — who's posting shouldn't be ambiguous right
    // before it actually publishes.
    const active = state.accounts.find((acc) => acc.pubkey === state.activePubkey);
    const author = h('div', { className: 'compose-author' });
    author.append(avatarEl(active || {}, 'compose-author-av'));
    author.append(
      h('div', { className: 'compose-author-info' }, [
        h('span', { className: 'compose-author-eyebrow', textContent: 'Posting as' }),
        h('span', { className: 'compose-author-name', textContent: active ? displayName(active) : '—' }),
      ])
    );

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
      author,
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

  // Resolved once per post: the toggle is worded "Review countdown before posting"
  // and covers everything publishable, so comments read the same setting as notes
  // rather than adding a second switch that would drift out of step.
  async function postCountdownSetting() {
    let s = {};
    try { s = (await call({ type: 'SIDECAR_GET_SETTINGS' })) || {}; } catch (_) {}
    const secs = NOTE_COUNTDOWN_PRESETS.includes(s.noteCountdownSecs)
      ? s.noteCountdownSecs
      : NOTE_COUNTDOWN_DEFAULT;
    return { on: s.noteCountdown !== false, secs }; // default on
  }

  async function openComposer(initialText) {
    if (!state.activePubkey) {
      toast('Add an account first', 'error');
      return;
    }
    const pubkey = state.activePubkey;
    let draft = { text: initialText || '', media: [] };
    const modal = $('modal');
    let countdown = null; // active review countdown, if any (see showPostCountdown)
    let saveTimer = null;
    let published = false;
    let enteredEditor = false;

    function persistDraft() { saveComposeDraft(pubkey, draft); }
    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(persistDraft, 400);
    }

    async function doPublish() {
      const content = draft.text.trim();
      // Shared with the page-comment path — see mentionPTags. Was inline here, which
      // is how comments ended up shipping without it.
      const pTags = mentionPTags(content);
      // A body reference makes this a NIP-18 quote — see quoteTags. The quoted author
      // gets a `p` tag as well (that's what turns the quote into a notification for
      // them), without duplicating an @mention of the same person.
      const quotes = quoteTags(content);
      const seenP = new Set(pTags.map((t) => t[1]));
      for (const pk of quotes.authors) {
        if (seenP.has(pk)) continue;
        seenP.add(pk);
        pTags.push(['p', pk]);
      }
      // The "client" tag (attributes the note to Sidecar) is opt-out via Settings.
      const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
      const tags = settings && settings.showClientTag === false
        ? [...pTags, ...quotes.tags]
        : [CLIENT_TAG.slice(), ...pTags, ...quotes.tags];
      const event = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content,
      };
      const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event, expectedPubkey: pubkey });
      await publishSigned(signed);
      return signed;
    }

    function showEditor() {
      stopCountdown();
      enteredEditor = true;
      modal.innerHTML = '';

      // Write / Preview tab bar
      let preview = false;
      const tabWrite = h('button', { className: 'compose-tab active', textContent: 'Write' });
      const tabPreview = h('button', { className: 'compose-tab', textContent: 'Preview' });
      const tabBar = h('div', { className: 'compose-tabs' }, [tabWrite, tabPreview]);

      // Rich text box with @mention autocomplete, shared with the page-comment
      // modal. Edits flow back through onChange into the draft + Post button.
      const mentionEditor = createMentionEditor({
        placeholder: "What’s on your mind?",
        onChange: (text) => { draft.text = text; updatePostState(); scheduleSave(); },
      });
      mentionEditor.setText(draft.text);
      const editor = mentionEditor.editor;
      const editorWrap = mentionEditor.wrap;

      const previewPane = h('div', { className: 'compose-preview hidden' });
      function renderPreview() {
        previewPane.innerHTML = '';
        const bodyText = draft.text.trim();
        if (bodyText) {
          const body = h('div', { className: 'preview-body' });
          renderNotePreview(body, bodyText);
          previewPane.append(body);
        } else {
          previewPane.append(h('p', { className: 'hint', textContent: 'Nothing to preview yet.' }));
        }
      }
      function setMode(p) {
        preview = p;
        tabWrite.classList.toggle('active', !p);
        tabPreview.classList.toggle('active', p);
        editorWrap.classList.toggle('hidden', p);
        thumbs.classList.toggle('hidden', p);
        addBtn.classList.toggle('hidden', p);
        previewPane.classList.toggle('hidden', !p);
        if (p) { mentionEditor.close(); renderPreview(); }
      }
      tabWrite.addEventListener('click', () => setMode(false));
      tabPreview.addEventListener('click', () => setMode(true));

      const thumbs = h('div', { className: 'compose-thumbs' });
      function renderThumbs() {
        thumbs.innerHTML = '';
        draft.media.forEach((m, i) => {
          const cell = h('div', { className: 'compose-thumb' });
          const el = m.isVideo ? document.createElement('video') : document.createElement('img');
          // Match the rest of the app: many media hosts (e.g. Blossom) reject the
          // chrome-extension:// referrer and 403, which renders as a broken thumb.
          el.referrerPolicy = 'no-referrer';
          el.src = m.url;
          if (m.isVideo) el.muted = true;
          cell.append(el);
          const rm = h('button', { className: 'compose-thumb-x', title: 'Remove' });
          rm.append(icon('trash'));
          rm.addEventListener('click', () => {
            const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
            let wn;
            while ((wn = walker.nextNode())) {
              if (wn.textContent.includes(m.url)) {
                wn.textContent = wn.textContent.replace('\n' + m.url, '').replace(m.url, '');
                break;
              }
            }
            draft.media.splice(i, 1);
            mentionEditor.sync();
            renderThumbs();
          });
          cell.append(rm);
          thumbs.append(cell);
        });
      }
      renderThumbs();

      // Append a media URL on its own line. Decides the separator from the
      // SERIALIZED text (what gets posted), and breaks on a newline rather than
      // any trailing whitespace — so an image pasted right after a mention/tag
      // can never glue to it (a bech32 or #hashtag followed by a URL corrupts
      // both when the note is parsed). No-ops the break for an empty editor or
      // one already ending in a newline.
      function appendMediaUrl(url) {
        const existing = serializeEditor(editor);
        const sep = existing && !/\n$/.test(existing) ? '\n' : '';
        editor.append(document.createTextNode(sep + url));
      }

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*,video/*';
      fileInput.style.display = 'none';
      const addBtn = h('button', { className: 'mini compose-add' });
      addBtn.append(icon('camera'), h('span', { textContent: 'Add photo or video' }));
      addBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        err.textContent = '';
        addBtn.disabled = true;
        const lbl = addBtn.querySelector('span');
        const prev = lbl.textContent;
        lbl.textContent = 'Uploading…';
        try {
          const url = await uploadMedia(file, pubkey);
          draft.media.push({ url, isVideo: file.type.startsWith('video/') });
          appendMediaUrl(url);
          mentionEditor.sync();
          renderThumbs();
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
        addBtn.disabled = false;
        lbl.textContent = prev;
        fileInput.value = '';
      });

      editor.addEventListener('paste', async (e) => {
        const imageFiles = Array.from(e.clipboardData?.items ?? [])
          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter((f) => f !== null);
        if (imageFiles.length === 0) {
          e.preventDefault();
          const plain = e.clipboardData.getData('text/plain');
          if (plain) document.execCommand('insertText', false, plain);
          return;
        }
        e.preventDefault();
        addBtn.disabled = true;
        const lbl = addBtn.querySelector('span');
        const prev = lbl.textContent;
        lbl.textContent = 'Uploading…';
        try {
          for (const file of imageFiles) {
            const url = await uploadMedia(file, pubkey);
            draft.media.push({ url, isVideo: false });
            appendMediaUrl(url);
          }
          mentionEditor.sync();
          renderThumbs();
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
        addBtn.disabled = false;
        lbl.textContent = prev;
      });

      const err = h('div', { className: 'error' });
      const post = h('button', { className: 'primary', textContent: 'Post' });
      function updatePostState() { post.disabled = !draft.text.trim() && !draft.media.length; }
      post.addEventListener('click', async () => {
        if (post.disabled) return;
        const { on, secs } = await postCountdownSetting();
        if (on) {
          showCountdown(secs);
        } else {
          post.disabled = true;
          post.textContent = 'Posting…';
          finishPublish();
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);

      // Show which account is posting so the user is never confused about identity.
      const active = state.accounts.find((a) => a.pubkey === state.activePubkey);
      const author = h('div', { className: 'compose-author' });
      author.append(avatarEl(active || {}, 'compose-author-av'));
      author.append(
        h('div', { className: 'compose-author-info' }, [
          h('span', { className: 'compose-author-eyebrow', textContent: 'Posting as' }),
          h('span', { className: 'compose-author-name', textContent: active ? displayName(active) : '—' }),
        ])
      );

      modal.append(
        h('h3', { textContent: 'New note' }),
        author,
        tabBar,
        editorWrap,
        previewPane,
        thumbs,
        addBtn,
        fileInput,
        err,
        h('div', { className: 'actions' }, [post, cancel])
      );
      updatePostState();
      editor.focus();
    }

    // Publish the note and finish (clear draft, close, banner) — shared by the
    // countdown's auto/now fire and the immediate (countdown-off) post path.
    async function finishPublish() {
      try {
        const signed = await doPublish();
        published = true;
        clearComposeDraft(pubkey);
        closeModal();
        toast('Note published', 'success');
        showPostBanner(signed);
      } catch (e) {
        toast(e.message, 'error');
        showEditor(); // keep the draft so they can retry
      }
    }

    // Delegates to the shared countdown; the composer supplies the note preview and
    // what to do when it fires or is canceled.
    function showCountdown(secs) {
      const previewScroll = h('div', { className: 'countdown-preview' });
      const previewBody = h('div', { className: 'preview-body' });
      const bodyText = draft.text.trim();
      if (bodyText) renderNotePreview(previewBody, bodyText);
      else previewBody.append(h('p', { className: 'hint', textContent: 'Empty note.' }));
      previewScroll.append(previewBody);
      countdown = showPostCountdown({
        modal,
        secs,
        title: 'Posting your note',
        preview: previewScroll,
        onFire: finishPublish,
        onCancel: showEditor,
      });
    }

    function stopCountdown() {
      if (countdown) { countdown.stop(); countdown = null; }
    }

    // Offer to resume a saved draft (or start fresh) before opening the editor.
    function showDraftChooser(saved) {
      modal.innerHTML = '';
      // Collapse horizontal whitespace and cap long blank-line runs, but keep
      // real newlines — this preview renders with white-space: pre-wrap, and
      // "Resume draft" loads the exact saved text, so the preview should look
      // like what's about to be restored instead of flattening it to one line.
      // No length-based truncation here: a fixed character cutoff could slice
      // through the middle of a nostr:npub1… mention, breaking it — the box
      // already clips visually (max-height + overflow:hidden), matching how
      // the Preview tab and the final review screen handle the same text.
      const preview = (saved.text || '').trim().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
      const when = saved.savedAt ? ' from ' + relativeTime(Math.floor(saved.savedAt / 1000)) : '';
      const mediaNote = saved.media && saved.media.length
        ? saved.media.length + ' attachment' + (saved.media.length > 1 ? 's' : '')
        : '';

      const resume = h('button', { className: 'primary', textContent: 'Resume draft' });
      resume.addEventListener('click', () => {
        draft = { text: saved.text || '', media: (saved.media || []).slice() };
        showEditor();
      });
      const fresh = h('button', { className: 'ghost', textContent: 'Start fresh' });
      fresh.addEventListener('click', () => {
        clearComposeDraft(pubkey);
        draft = { text: initialText || '', media: [] };
        showEditor();
      });

      const parts = [
        h('h3', { textContent: 'Resume your draft?' }),
        h('p', { className: 'hint', textContent: 'You have an unsaved draft' + when + '.' }),
      ];
      if (preview) {
        const previewBox = h('div', { className: 'draft-preview' });
        renderNotePreview(previewBox, preview);
        parts.push(previewBox);
      }
      if (mediaNote) parts.push(h('p', { className: 'draft-preview-meta', textContent: mediaNote }));
      parts.push(h('div', { className: 'actions' }, [resume, fresh]));
      modal.append(...parts);
    }

    const saved = await loadComposeDraft(pubkey);
    const hasSaved = !!(saved && ((saved.text && saved.text.trim()) || (saved.media && saved.media.length)));

    openModal(
      () => { if (hasSaved) showDraftChooser(saved); else showEditor(); },
      () => {
        stopCountdown();
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        // Persist on close only once the user has actually edited — closing the
        // chooser without choosing must not overwrite the saved draft.
        if (!published && enteredEditor) persistDraft();
      }
    );
  }

  // ---- edit profile (full-panel overlay) ----
  // A textarea that grows with what's in it, so a long bio is visible while it's
  // being edited instead of hiding in a 76px slot. The .autosize class caps the
  // growth (max-height) with internal scrolling past the cap, and the native
  // resize handle stays for manual control. fit() runs once here so opening an
  // editor on an existing long bio shows it tall immediately.
  function autosizeTextarea(el) {
    el.classList.add('autosize');
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    };
    el.addEventListener('input', fit);
    // Size now if the element is already in the document. A detached textarea
    // has no layout and scrollHeight reads 0 — sizing it then collapses the
    // field back to its minimum, which is exactly the long-existing-bio case
    // this helper exists for. Call after append for a clean first paint; the
    // frame fallback covers any caller that doesn't.
    if (el.isConnected) fit();
    else requestAnimationFrame(fit);
    return fit;
  }

  function openProfileEdit(current) {
    const draft = { ...current };
    const body = $('profile-edit-body');
    body.innerHTML = '';
    const err = h('div', { className: 'error' });
    const urlInputs = {};
    const setPreviewFns = {};

    const makeUpload = (label, kind, field, isBanner) => {
      const prev = h('div', { className: 'upload-preview' + (isBanner ? ' banner' : '') });
      const overlay = h('span', { className: 'upload-overlay' });
      overlay.append(icon('camera'));
      function setPreview(url) {
        prev.innerHTML = '';
        prev.classList.toggle('empty', !url);
        if (url) {
          const im = document.createElement('img');
          im.referrerPolicy = 'no-referrer';
          im.src = url;
          prev.append(im);
        }
        prev.append(overlay);
        if (capLabel) capLabel.textContent = url ? 'Change ' + label.toLowerCase() : 'Upload ' + label.toLowerCase();
      }

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      const capLabel = h('span', { className: 'upload-cap-label' });
      const capHint = h('span', { className: 'upload-cap-hint', textContent: 'JPG, PNG or GIF' });
      const caption = h('div', { className: 'upload-caption' }, [capLabel, capHint]);

      setPreviewFns[field] = setPreview;
      setPreview(draft[field]);

      const trigger = () => input.click();
      prev.addEventListener('click', trigger);
      caption.addEventListener('click', trigger);

      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        err.textContent = '';
        prev.classList.add('uploading');
        const before = capLabel.textContent;
        capLabel.textContent = 'Uploading…';
        try {
          const u = await uploadImage(file, kind);
          draft[field] = u;
          setPreview(u);
          if (urlInputs[field]) urlInputs[field].value = u;
        } catch (e) {
          err.textContent = e.message;
          capLabel.textContent = before;
          toast(e.message, 'error');
        }
        prev.classList.remove('uploading');
        input.value = '';
      });
      body.append(
        h('label', { className: 'field-label', textContent: label }),
        h('div', { className: 'upload-row' + (isBanner ? ' banner' : ''), role: 'button' }, [prev, caption, input])
      );
    };

    makeUpload('Avatar', 'profile', 'picture', false);
    makeUpload('Banner', 'files', 'banner', true);

    const fieldDefs = [
      ['display_name', 'Display name', 'text'],
      ['name', 'Username', 'text'],
      ['about', 'About', 'textarea'],
      ['nip05', 'NIP-05 identifier', 'text'],
      ['lud16', 'Lightning address', 'text'],
      ['website', 'Website', 'text'],
    ];
    const inputs = {};
    fieldDefs.forEach(([key, label, type]) => {
      body.append(h('label', { className: 'field-label', textContent: label }));
      const el = document.createElement(type === 'textarea' ? 'textarea' : 'input');
      if (type !== 'textarea') el.type = 'text';
      el.value = current[key] || '';
      inputs[key] = el;
      body.append(el);
      if (type === 'textarea') autosizeTextarea(el); // after append — see the helper
    });

    // advanced: raw image URLs
    const adv = document.createElement('details');
    adv.className = 'advanced';
    const sum = document.createElement('summary');
    sum.textContent = 'Advanced — image URLs';
    adv.append(sum);
    [['picture', 'Avatar URL'], ['banner', 'Banner URL']].forEach(([field, label]) => {
      adv.append(h('label', { className: 'field-label', textContent: label }));
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = draft[field] || '';
      urlInputs[field] = inp;
      inp.addEventListener('input', () => {
        draft[field] = inp.value.trim();
        if (setPreviewFns[field]) setPreviewFns[field](draft[field]);
      });
      adv.append(inp);
    });
    body.append(adv);

    body.append(h('label', { className: 'field-label', textContent: 'PIN (required to publish)' }));
    const pin = h('input', { type: 'password', maxLength: 32 });
    body.append(pin, err);

    const publish = h('button', { className: 'primary', textContent: 'Publish profile' });
    publish.addEventListener('click', async () => {
      err.textContent = '';
      if (!pin.value) return (err.textContent = 'Enter your PIN to publish.');
      publish.disabled = true;
      publish.textContent = 'Publishing…';
      try {
        const fields = { picture: draft.picture || '', banner: draft.banner || '' };
        fieldDefs.forEach(([k]) => (fields[k] = inputs[k].value));
        await publishProfile(fields, pin.value);
        hide($('view-profile-edit'));
        show($('view-main'));
        renderProfile();
        renderMain();
        toast('Profile published', 'success');
      } catch (e) {
        err.textContent = e.message;
        publish.disabled = false;
        publish.textContent = 'Publish profile';
        toast(e.message, 'error');
      }
    });
    body.append(h('div', { className: 'actions' }, [publish]));

    hide($('view-main'));
    show($('view-profile-edit'));
    const content = $('view-profile-edit').querySelector('.content');
    if (content) content.scrollTop = 0;
  }

  $('profile-edit-close').addEventListener('click', () => {
    hide($('view-profile-edit'));
    show($('view-main'));
  });

  // First-run profile setup for a freshly generated key: a short, skippable
  // wizard (name → photo → bio). On exit it publishes whatever was filled in
  // (kind:0) and lands on the Profile tab to finish the rest. The keystore is
  // unlocked from account creation, so signing needs no PIN. Every exit path —
  // Finish, "I'll do this later", the X, or the backdrop — runs `commit` once
  // (guarded), which publishes BEFORE closing so the profile never flashes the
  // interim auto-generated cocktail name.
  // onDone runs after the wizard commits, whichever way it exits (finish, "later",
  // or the X) — commit() is the single exit for all three.
  function profileSetupWizard(newPubkey, onDone) {
    const draft = { display_name: '', picture: '', about: '' };
    const STEPS = 3;
    let step = 1;
    let committing = false;

    async function commit() {
      if (committing) return;
      committing = true;
      // Only send fields the user actually filled in. publishProfile deletes any
      // empty field it's handed, so passing blanks would wipe metadata rather
      // than leave it untouched — keep this purely additive.
      const fields = {};
      if (draft.display_name.trim()) fields.display_name = draft.display_name.trim();
      if (draft.picture) fields.picture = draft.picture;
      if (draft.about.trim()) fields.about = draft.about.trim();
      const hasContent = Object.keys(fields).length > 0;
      // Safety net: publishProfile signs with whatever account is active. Only
      // publish if the active account is still the one this wizard was opened
      // for — never risk overwriting a different account's profile.
      const targetOk = !newPubkey || state.activePubkey === newPubkey;
      if (hasContent && !targetOk) {
        toast('Profile setup skipped — active account changed.', 'error');
      } else if (hasContent) {
        const primaryBtn = $('modal').querySelector('button.primary');
        if (primaryBtn) { primaryBtn.disabled = true; primaryBtn.textContent = 'Saving…'; }
        // Publish and wait for the store to update BEFORE navigating/closing, so
        // the Profile tab renders the chosen name, not the interim cocktail name.
        try {
          await publishProfile(fields, null); // keystore unlocked → no step-up PIN
        } catch (e) {
          toast(e.message, 'error');
        }
      }
      const tab = document.querySelector('.tab[data-tab="profile"]');
      if (tab) tab.click();
      renderMain();
      closeModal();
      if (hasContent && targetOk) toast('Profile saved', 'success');
      // Deferred a tick for the same reason nsecModal defers: closeModal clears
      // #modal right after this returns, and onDone opens another modal.
      if (onDone) setTimeout(onDone, 0);
    }

    openModal(
      (modal) => {
        const xBtn = h('button', { className: 'modal-x', title: 'Skip' });
        xBtn.appendChild(icon('x'));
        xBtn.addEventListener('click', commit);
        const body = h('div', { className: 'setup-modal' });
        modal.append(xBtn, body);

        const head = (title, sub) => {
          const parts = [
            h('div', { className: 'setup-progress', textContent: 'Step ' + step + ' of ' + STEPS }),
            h('h3', { textContent: title }),
          ];
          if (sub) parts.push(h('p', { className: 'hint', textContent: sub }));
          return parts;
        };

        const footer = (primaryLabel, onPrimary) => {
          const row = h('div', { className: 'actions setup-actions' });
          if (step > 1) {
            const back = h('button', { className: 'ghost', textContent: 'Back' });
            back.addEventListener('click', () => { step -= 1; render(); });
            row.append(back);
          }
          const primary = h('button', { className: 'primary', textContent: primaryLabel });
          primary.addEventListener('click', onPrimary);
          row.append(primary);
          const later = h('button', { className: 'setup-skip', textContent: "I'll do this later" });
          later.addEventListener('click', commit);
          return h('div', {}, [row, later]);
        };

        function render() {
          body.innerHTML = '';
          if (step === 1) renderName();
          else if (step === 2) renderPhoto();
          else renderBio();
        }

        function renderName() {
          const input = h('input', { type: 'text', placeholder: 'e.g. Gatsby' });
          input.value = draft.display_name;
          input.addEventListener('input', () => { draft.display_name = input.value; });
          body.append(
            ...head('What should people call you?', 'Your display name — you can change it any time.'),
            h('label', { className: 'field-label', textContent: 'Display name' }),
            input,
            footer('Continue', () => { step = 2; render(); })
          );
          setTimeout(() => input.focus(), 30);
        }

        function renderPhoto() {
          const prev = h('div', { className: 'upload-preview' });
          const overlay = h('span', { className: 'upload-overlay' });
          overlay.append(icon('camera'));
          const fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.accept = 'image/*';
          fileInput.style.display = 'none';
          const capLabel = h('span', { className: 'upload-cap-label' });
          const capHint = h('span', { className: 'upload-cap-hint', textContent: 'JPG, PNG or GIF' });
          const setPreview = (url) => {
            prev.innerHTML = '';
            prev.classList.toggle('empty', !url);
            if (url) {
              const im = document.createElement('img');
              im.referrerPolicy = 'no-referrer';
              im.src = url;
              prev.append(im);
            }
            prev.append(overlay);
            capLabel.textContent = url ? 'Change photo' : 'Upload a photo';
          };
          setPreview(draft.picture);
          const trigger = () => fileInput.click();
          prev.addEventListener('click', trigger);
          const caption = h('div', { className: 'upload-caption' }, [capLabel, capHint]);
          caption.addEventListener('click', trigger);
          fileInput.addEventListener('change', async () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            prev.classList.add('uploading');
            const before = capLabel.textContent;
            capLabel.textContent = 'Uploading…';
            try {
              const u = await uploadImage(file, 'profile');
              draft.picture = u;
              setPreview(u);
            } catch (e) {
              capLabel.textContent = before;
              toast(e.message, 'error');
            }
            prev.classList.remove('uploading');
            fileInput.value = '';
          });
          body.append(
            ...head('Add a photo', 'Optional — a picture helps people recognize you.'),
            h('div', { className: 'upload-row', role: 'button' }, [prev, caption, fileInput]),
            footer('Continue', () => { step = 3; render(); })
          );
        }

        function renderBio() {
          const ta = document.createElement('textarea');
          ta.value = draft.about;
          ta.placeholder = 'A sentence or two about you.';
          ta.addEventListener('input', () => { draft.about = ta.value; });
          body.append(
            ...head('Write a short bio', 'Optional — you can flesh out your profile next.'),
            h('label', { className: 'field-label', textContent: 'About' }),
            ta,
            footer('Finish', commit)
          );
          autosizeTextarea(ta); // after append — see the helper
        }

        render();
      },
      commit
    );
  }

  // Fetch-merge-sign-publish: preserve unknown fields, overlay edits, sign (step-up PIN), publish.
  async function publishProfile(fields, pin) {
    const { content } = await fetchActiveProfile();
    const merged = { ...content };
    Object.keys(fields).forEach((k) => {
      const v = (fields[k] || '').trim();
      if (v) merged[k] = v;
      else delete merged[k];
    });
    const event = { kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(merged) };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event, pin });
    await publishSigned(signed);
    // Refresh the shared profile cache with what we just published so the profile
    // view / previews reflect the edit immediately instead of a stale cached copy.
    cacheProfile(state.activePubkey, merged);
    await call({
      type: 'SIDECAR_SET_PROFILE',
      pubkey: state.activePubkey,
      name: merged.display_name || merged.name || '',
      picture: merged.picture || '',
    });
    state = await call({ type: 'SIDECAR_GET_STATE' });
  }

  // ---- Bookmarks (topbar icon → modal): the account's bookmark lists, as other clients wrote them ----
  // NIP-51 keeps bookmarks in two shapes: kind 10003 is the flat list every
  // client agrees on, and kind 30001 is one replaceable event per named
  // category (its d-tag). Sidecar writes none of them — this modal reads what
  // the account's clients published, groups by category where categories
  // exist, and removes an entry by republishing the owning list without that
  // e-tag. Rows hand off to the preferred web client: Sidecar is the signer,
  // not the reader.
  const HEX_ID = /^[0-9a-f]{64}$/;
  const BM_KIND_LABEL = { 0: 'profile', 1: 'note', 6: 'repost', 30023: 'article', 1063: 'live event', 1068: 'live chat' };

  // Every bookmark list event, raw, for bookmarkSections to shape.
  async function fetchBookmarkLists() {
    return getPool().querySync(
      await readRelayUrls(state.activePubkey),
      { kinds: [10003, 30001], authors: [state.activePubkey] },
      { maxWait: 6000 }
    );
  }

  // Pure: raw kind 10003/30001 events → ordered sections. The flat 10003 comes
  // first (it's what clients without categories write), then one section per
  // 30001 d-tag, by name. Replaceable events arrive as copies; newest
  // created_at per key wins, the same rule loadMuteList applies to kind 10000.
  // Lifted into test/bookmark-sections.test.js.
  function bookmarkSections(evs) {
    const latest = new Map();
    for (const ev of evs || []) {
      const d = ev.kind === 10003 ? '' : (ev.tags.find((t) => t[0] === 'd') || [])[1] || '';
      const key = (ev.kind === 10003 ? 'F|' : 'C|') + d;
      const cur = latest.get(key);
      if (!cur || ev.created_at >= cur.created_at) latest.set(key, ev);
    }
    const sections = [];
    const flat = latest.get('F|');
    if (flat) sections.push({ title: '', ev: flat });
    [...latest.entries()]
      .filter(([k]) => k[0] === 'C')
      .sort((a, b) => a[0].slice(2).localeCompare(b[0].slice(2)))
      .forEach(([k, ev]) => sections.push({ title: k.slice(2), ev }));
    return sections;
  }

  // The bookmarked events themselves. Relays cap ids per filter, so ids go out
  // in chunks; whichever relay answers first for an id is fine — same id,
  // same event. A row whose event never comes back still renders (and can
  // still be opened by id or removed); it just shows no preview.
  async function fetchEventsByIds(ids) {
    const relays = await readRelayUrls(state.activePubkey);
    const found = new Map();
    const chunks = [];
    for (let i = 0; i < ids.length; i += 64) chunks.push(ids.slice(i, i + 64));
    await Promise.all(chunks.map(async (chunk) => {
      try {
        const evs = await getPool().querySync(relays, { ids: chunk }, { maxWait: 5000 });
        (evs || []).forEach((ev) => { if (!found.has(ev.id)) found.set(ev.id, ev); });
      } catch (_) {}
    }));
    return found;
  }

  // Opened from the topbar icon: a full-height modal (modal-sheet) that paints
  // at full size immediately, spinner or cached rows inside — the sheet is the
  // modal, not something content has to grow into. A modal closed mid-fetch
  // leaves its DOM merely hidden, so "gone" is the overlay check, not
  // isConnected.
  function renderBookmarks() {
    if (!state?.activePubkey) return;
    openModal((modal) => {
      modal.classList.add('modal-sheet');
      const x = h('button', { className: 'modal-x', title: 'Close' });
      x.appendChild(icon('x'));
      x.addEventListener('click', closeModal);
      const scroll = h('div', { className: 'bm-scroll' });
      modal.append(x, h('h3', { textContent: 'Bookmarks' }), scroll);
      const gone = () => $('modal-overlay').classList.contains('hidden');
      if (_bmCache.pubkey === state.activePubkey && _bmCache.evs) {
        fillBookmarks(scroll, gone, _bmCache.evs, _bmCache.events);
        // Quiet refresh behind the cached rows: the screen only moves when the
        // relays actually say something different, and never while a removal
        // confirm is on screen (a swap there would eat the user's tap).
        refreshBookmarks().then((changed) => {
          if (changed && !gone() && !scroll.querySelector('.del-confirm')) {
            fillBookmarks(scroll, gone, _bmCache.evs, _bmCache.events);
          }
        });
      } else {
        scroll.append(h('div', { className: 'recv-waiting' }, [
          h('span', { className: 'recv-spinner' }),
          h('span', { textContent: 'Reading your relays…' }),
        ]));
        refreshBookmarks().then(() => {
          if (!gone()) fillBookmarks(scroll, gone, _bmCache.evs, _bmCache.events);
        });
      }
    });
  }

  // Session cache per account: the modal opens instantly from the last fetch,
  // and a background refresh keeps it honest. Signatures compare which list
  // events exist (id + created_at) and which bookmark ids resolved, so an
  // unchanged refresh costs nothing on screen.
  const _bmCache = { pubkey: null, evs: null, events: null };
  const bmListsSig = (evs) => (evs || []).map((e) => e.id + ':' + e.created_at).sort().join('|');
  const bmFoundSig = (events) => [...(events || new Map()).keys()].sort().join(',');
  async function refreshBookmarks() {
    const pubkey = state.activePubkey;
    let evs;
    try {
      evs = await fetchBookmarkLists();
    } catch (_) {
      return false;
    }
    const ids = [];
    const seen = new Set();
    bookmarkSections(evs).forEach((s) => s.ev.tags.forEach((t) => {
      const id = t && t[0] === 'e' && t[1];
      if (HEX_ID.test(id || '') && !seen.has(id)) { seen.add(id); ids.push(id); }
    }));
    const events = await fetchEventsByIds(ids);
    const changed = _bmCache.pubkey !== pubkey ||
      bmListsSig(_bmCache.evs) !== bmListsSig(evs) ||
      bmFoundSig(_bmCache.events) !== bmFoundSig(events);
    _bmCache.pubkey = pubkey;
    _bmCache.evs = evs;
    _bmCache.events = events;
    return changed;
  }

  async function fillBookmarks(scroll, gone, evs, events) {
    // The scroll container is cleared rather than appended to: the quiet
    // refresh re-runs this on a scroll that already holds rows (and the first
    // run replaces the spinner), and a second .bm-list under the first would
    // duplicate every bookmark.
    scroll.textContent = '';
    // Sections: the flat list first (what clients without categories write),
    // then categories by name. A list with no e-tags renders nothing — no
    // entries to show, none to remove.
    const sections = bookmarkSections(evs);

    // Same rule as the bell: one quote for this rendering, so the two places it can
    // appear never disagree. Bookmarks cannot show both at once today — an empty list
    // returns before the end note — but drawing twice per render would burn through the
    // no-repeat guard for nothing.
    const panelQuote = pickQuote();
    const empty = () => {
      scroll.textContent = '';
      scroll.append(emptyQuote('Bookmark a note from any Nostr client and it shows up here.', panelQuote));
    };
    if (!sections.length) return empty();

    // Profiles for the authors (getProfile is cached, so repeat authors are
    // cheap and a cached reopen resolves instantly).
    const authors = [...new Set([...events.values()].map((e) => e.pubkey))];
    const profiles = new Map(await Promise.all(authors.map(async (pk) => [pk, await getProfile(pk)])));
    if (gone()) return;

    const list = h('div', { className: 'bm-list' });
    scroll.append(list);

    // One bookmark: the referenced event's author and a snippet, opening in
    // the preferred web client, removable by republishing the owning list.
    // `missing` rows (the relays no longer return the event) still render —
    // dimmed, sorted below the found ones — because they remain bookmarks:
    // openable by id, and removable.
    const buildRow = (id, parent, missing) => {
      const ref = missing ? null : events.get(id);
      const prof = ref ? profiles.get(ref.pubkey) : null;
      let npub = '';
      if (ref) { try { npub = NT.nip19.npubEncode(ref.pubkey); } catch (_) {} }
      const item = h('div', { className: 'bm-item' + (missing ? ' bm-missing' : ''), title: 'Open in your web client' });
      const main = h('div', { className: 'bm-main' }, [
        h('div', { className: 'bm-head' }, [
          avatarEl({ picture: prof && prof.picture, npub }, 'bm-av'),
          h('div', { className: 'bm-name', textContent: (prof && prof.name) || (npub ? shortNpub(npub) : 'Unknown author') }),
        ]),
        h('div', {
          className: 'bm-snippet',
          textContent: missing
            ? id.slice(0, 8) + '…' + id.slice(-6)
            : quoteSnippet(ref.content) || '“' + (BM_KIND_LABEL[ref.kind] || 'kind ' + ref.kind) + '”',
        }),
        h('div', {
          className: 'bm-meta',
          textContent: missing ? 'not found on your relays' : (BM_KIND_LABEL[ref.kind] || 'kind ' + ref.kind) + ' · ' + relativeTime(ref.created_at),
        }),
      ]);
      const actions = h('div', { className: 'item-actions' });
      // The resting row keeps a lone icon button in the inline slot; the confirm
      // has words, so it takes its own full-width row under the content (the
      // connected-site grammar) instead of squeezing a label and two buttons
      // beside a 300px-wide row.
      const confirmRow = h('div', { className: 'bm-confirm' });
      let confirming = false;
      const drawResting = () => {
        confirming = false;
        item.classList.remove('bm-confirming');
        confirmRow.remove();
        confirmRow.textContent = '';
        actions.textContent = '';
        actions.append(iconButton('Remove bookmark', 'x', (e) => {
          e.stopPropagation();
          drawConfirm();
        }));
      };
      const drawConfirm = () => {
        confirming = true;
        item.classList.add('bm-confirming');
        confirmRow.textContent = '';
        const yes = h('button', { className: 'mini del-confirm', textContent: 'Remove' });
        const no = h('button', { className: 'mini ghost', textContent: 'Cancel' });
        yes.addEventListener('click', async (e) => {
          e.stopPropagation();
          yes.disabled = true;
          yes.textContent = 'Removing…';
          // Republish the owning list minus EVERY e-tag for this id — a client
          // that wrote the same bookmark twice should see both copies go. The
          // 30001's d-tag rides through untouched (only e-tags are filtered),
          // so the category stays the same replaceable stream.
          const tags = parent.tags.filter((t) => !(t[0] === 'e' && t[1] === id));
          try {
            const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event: { kind: parent.kind, created_at: Math.floor(Date.now() / 1000), tags, content: parent.content || '' } });
            await publishSigned(signed);
            parent.tags = tags; // keep the in-memory copy honest for this session
            const group = item.closest('.bm-group');
            item.remove();
            if (group && !group.querySelector('.bm-item')) group.remove();
            if (!list.querySelector('.bm-item')) empty();
            toast('Bookmark removed', 'success');
          } catch (err) {
            toast((err && err.message) || 'Could not remove the bookmark', 'error');
            drawResting();
          }
        });
        no.addEventListener('click', (e) => { e.stopPropagation(); drawResting(); });
        confirmRow.append(h('span', { className: 'confirm-msg', textContent: 'Remove this bookmark?' }), yes, no);
        item.append(confirmRow);
      };
      drawResting();
      item.addEventListener('click', async () => {
        // While the confirm is open the row isn't a link — a tap on the message
        // (or the gap beside it) must not open the client behind the confirm.
        if (confirming) return;
        const client = await preferredClient();
        try {
          openInClient(client.url(NT.nip19.neventEncode({ id, author: ref ? ref.pubkey : undefined, relays: [] })));
        } catch (_) {}
      });
      item.append(main, actions);
      return item;
    };

    sections.forEach((s) => {
      // NEWEST NOTE FIRST, not the order the tags happen to sit in.
      //
      // This used to render the e-tags in list order, on the reasoning that it was "the
      // owning client's own order". It isn't an order — a kind 10003 is replaceable, so
      // every client rewrites the whole list on every add and remove, and they do not
      // agree on where a new entry goes. Some prepend, some append, some rebuild from
      // their own internal state. What we were faithfully displaying was whatever the
      // last client to touch the list happened to emit, which is why the same bookmarks
      // read in one order here and a completely different one in Jumble or Wisp.
      //
      // Sorting by the referenced note's created_at gives the same list the same shape in
      // every client, and it matches what the others already show.
      //
      // Not "recently bookmarked", which would be the better sort and is not available:
      // nothing in a kind 10003 records WHEN an entry was added. That absence is the
      // whole reason this drifts between clients.
      //
      // Entries whose events no longer resolve sort to the bottom under their own divider
      // — they're still bookmarks, but they can't be previewed (or dated), and a wall of
      // "not found" ahead of real notes reads as a broken modal.
      const found = [];
      const missing = [];
      const seen = new Set();
      s.ev.tags.forEach((t) => {
        const id = t && t[0] === 'e' && t[1];
        if (!HEX_ID.test(id || '') || seen.has(id)) return;
        seen.add(id);
        (events.has(id) ? found : missing).push(id);
      });
      // Ties keep tag order, which is at least stable within one read.
      found.sort((a, b) => (events.get(b).created_at || 0) - (events.get(a).created_at || 0));
      if (!found.length && !missing.length) return;
      const group = h('div', { className: 'bm-group' });
      if (s.title) group.append(h('div', { className: 'bm-cat', textContent: s.title }));
      found.forEach((id) => group.append(buildRow(id, s.ev, false)));
      if (missing.length) {
        if (found.length) group.append(h('div', { className: 'bm-missing-head', textContent: 'Not on your relays' }));
        missing.forEach((id) => group.append(buildRow(id, s.ev, true)));
      }
      list.append(group);
    });

    // Lists can exist and hold nothing: remove your last bookmark and the kind 10003 is
    // republished empty rather than deleted. That used to render as a blank panel.
    if (!list.children.length) {
      list.remove();
      return empty();
    }

    // The bottom of a list that has no more to give. Bookmarks do not paginate, so
    // reaching the end here is always the real end.
    scroll.append(endQuote(panelQuote));
    if (!list.children.length) return empty();
  }

  const BACKUP_TYPES = [
    { key: 'profile', label: 'Profile', kind: 0, dtag: 'sidecar:profile-backup' },
    { key: 'follows', label: 'Follows', kind: 3, dtag: 'sidecar:follows-backup' },
    { key: 'mute', label: 'Mute list', kind: 10000, dtag: 'sidecar:mute-backup' },
  ];

  // The newest copy of a replaceable identity event (kind 0/3/10002/10000) —
  // what backups snapshot, exports write to file, and the restore confirm
  // compares against. Read from the account's declared NIP-65 relays plus
  // purplepag.es plus Settings, never Settings alone: replaceable events go
  // stale independently per relay, and one configured relay holding an old copy
  // (here: an empty kind 3 from two months back) can be the only answer within
  // the window while the relays actually carrying the current 1000+ list sit
  // outside the configured set — a backup exported from that read captures the
  // wipe it exists to undo. readRelayUrls is resolved before the race so its
  // own (cached) NIP-65 fetch doesn't eat the 6s query budget.
  async function fetchLatestEvent(kind) {
    const relays = await readRelayUrls(state.activePubkey);
    return Promise.race([
      poolGet(relays, { kinds: [kind], authors: [state.activePubkey] }),
      new Promise((res) => setTimeout(() => res(null), 6000)),
    ]).catch(() => null);
  }
  async function fetchBackupEvent(dtag) {
    return Promise.race([
      poolGet(await relayUrls(false), { kinds: [30078], authors: [state.activePubkey], '#d': [dtag] }),
      new Promise((res) => setTimeout(() => res(null), 6000)),
    ]).catch(() => null);
  }

  // Snapshot the active account's latest kind:0/3/10000, encrypt to self, store as NIP-78.
  async function createBackup(t) {
    const src = await fetchLatestEvent(t.kind);
    if (!src) throw new Error('Nothing to back up yet for ' + t.label.toLowerCase());
    const blob = {
      v: 1,
      ts: Math.floor(Date.now() / 1000),
      source: { kind: src.kind, created_at: src.created_at, tags: src.tags, content: src.content },
    };
    // Prefer NIP-44, but it caps plaintext at 65535 bytes — large follow lists
    // exceed that, so fall back to NIP-04 (no hard cap). The `encrypted` tag
    // records which scheme was used so restore decrypts correctly.
    const plaintext = JSON.stringify(blob);
    let ciphertext, algo;
    try {
      ciphertext = await call({ type: 'SIDECAR_OWNER_ENCRYPT', plaintext, nip: 44 });
      algo = 'nip44';
    } catch (_) {
      ciphertext = await call({ type: 'SIDECAR_OWNER_ENCRYPT', plaintext, nip: 4 });
      algo = 'nip04';
    }
    const event = {
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', t.dtag], ['encrypted', algo]],
      content: ciphertext,
    };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event });
    await publishSigned(signed);
  }

  // What a list restore would change, as plain numbers. Counts are p-tags;
  // DROPPED and ADDED are set differences, because counts alone can hide the
  // danger both ways: 289 vs 312 can be a reshuffle rather than a loss, and a
  // same-count swap can be a total loss. "23 you follow today are not in the
  // backup" is the number that stops a bad restore.
  function listDiff(currentTags, backupTags) {
    // x[1] required: a valueless ['p'] tag is malformed, and counting it as an
    // undefined member inflates both sides and can fake a difference between
    // identical lists.
    const cur = new Set((currentTags || []).filter((x) => x && x[0] === 'p' && x[1]).map((x) => x[1]));
    const bak = new Set((backupTags || []).filter((x) => x && x[0] === 'p' && x[1]).map((x) => x[1]));
    const dropped = [...cur].filter((p) => !bak.has(p)).length;
    const added = [...bak].filter((p) => !cur.has(p)).length;
    return { current: cur.size, backup: bak.size, dropped, added };
  }

  // A mute list's p-tags from both places they can live: public event tags, and
  // the private list encrypted to self in content (NIP-44, or legacy NIP-04
  // whose ciphertext carries "?iv="). loadMuteList merges the same two sources
  // when it applies mutes; any count of a mute list has to merge them too, or
  // every private list reads as empty — and against the hundreds the user
  // actually mutes, "0 muted" is not a smaller number, it's the wrong number.
  // ok=false means content exists but wouldn't decrypt (keystore locked, bad
  // ciphertext), so callers say that instead of printing the public-only count
  // as if it were the whole list.
  async function muteTags(ev) {
    const tags = (ev && ev.tags) || [];
    if (!ev || !ev.content) return { tags, private: false, ok: true };
    const order = ev.content.includes('?iv=') ? [4, 44] : [44, 4];
    for (const nip of order) {
      try {
        const privateTags = JSON.parse(await call({ type: 'SIDECAR_OWNER_DECRYPT', ciphertext: ev.content, nip }));
        if (Array.isArray(privateTags)) return { tags: tags.concat(privateTags), private: true, ok: true };
      } catch (_) {}
    }
    return { tags, private: true, ok: false };
  }

  // Decrypt a backup event's source payload. Restore only PIN-gates the SIGN;
  // the panel may read its own backups freely (the panel is unlocked to be here).
  async function decryptBackupSource(ev) {
    const scheme = (ev.tags.find((x) => x[0] === 'encrypted') || [])[1];
    const nip = scheme === 'nip44' ? 44 : 4; // older backups are NIP-04
    const plaintext = await call({ type: 'SIDECAR_OWNER_DECRYPT', ciphertext: ev.content, nip });
    const blob = JSON.parse(plaintext);
    if (!blob || !blob.source) throw new Error('Backup could not be read');
    return blob.source;
  }

  // Decrypt the latest backup and re-publish it as the current event (PIN-gated).
  async function restoreBackup(t, pin) {
    const ev = await fetchBackupEvent(t.dtag);
    if (!ev) throw new Error('No backup found for ' + t.label.toLowerCase());
    const s = await decryptBackupSource(ev);
    const event = { kind: s.kind, created_at: Math.floor(Date.now() / 1000), tags: s.tags || [], content: s.content || '' };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event, pin });
    await publishSigned(signed);
  }

  // ---- wallet (NWC) backup to relays — NIP-78, encrypted to self ----
  // Mirrors zap.cooking: the connection string is a spendable secret, so it is
  // encrypted to the account's own key with NIP-44 and stored as a replaceable
  // kind:30078 record that can be restored on another device. NIP-04 only, never
  // written (deprecated crypto; the follow/mute-list backup keeps its fallback for
  // the 65KB-event cap, which doesn't apply to a ~200-char string) — old NIP-04
  // backups are still READ (see nwcBackupState).
  const NWC_BACKUP_DTAG = 'sidecar:nwc-backup';

  // Compare the backup against the wallet actually connected — don't just detect
  // that some backup exists. The d-tag is replaceable, so connecting a new wallet
  // leaves the previous ciphertext in place: a bare existence check then reports
  // "Backed up" for a string the user no longer holds, which is the one case where
  // the reassurance is actively harmful.
  //
  // Fails closed. Anything we can't verify (no connection, decrypt failed, relays
  // timed out) is 'unknown', never 'current'.
  //
  //   none    → no backup event on the relays
  //   current → the backup decrypts to the connected string
  //   stale   → a backup exists, but for a different wallet
  //   unknown → couldn't tell
  //
  // Compares the whole string rather than the parsed wallet pubkey + secret: two
  // URIs for one wallet can differ in param order or an added lud16, so a byte
  // compare can say 'stale' when the wallet is really the same. That false positive
  // only prompts a harmless re-backup, where a false 'current' is the bug itself.
  async function nwcBackupState() {
    const ev = await fetchBackupEvent(NWC_BACKUP_DTAG);
    if (!ev) return { state: 'none' };
    // Presence comes from the metadata view; the decrypt-and-compare runs in the
    // service worker (SIDECAR_NWC_BACKUP_MATCHES) so the raw connection string
    // never crosses to a page just to be compared against the backup.
    let has = false;
    try { has = !!(await call({ type: 'SIDECAR_NWC_META' })).has; } catch (_) {}
    if (!has) return { state: 'unknown', at: ev.created_at };
    try {
      const scheme = (ev.tags.find((x) => x[0] === 'encryption') || [])[1];
      const { matches } = await call({
        type: 'SIDECAR_NWC_BACKUP_MATCHES',
        ciphertext: ev.content,
        nip: scheme === 'nip04' ? 4 : 44,
      });
      return { state: matches ? 'current' : 'stale', at: ev.created_at };
    } catch (_) {
      return { state: 'unknown', at: ev.created_at };
    }
  }

  // Pubkey whose backup nudge was dismissed this session (see renderWalletConnected).
  let nwcNudgeDismissed = null;

  // Short by design — this renders in a ~360px sidebar and the pill ellipsizes.
  //
  // 'stale' and 'none' share a headline on purpose. If the stored copy isn't this
  // wallet then this wallet isn't backed up, and that's the claim the user needs;
  // describing the backup instead ("Out of date") reads as if the CONNECTION were
  // old, since the pill sits beside a "Wallet connection" label. What separates the
  // two is the warn color and the line underneath — don't "fix" the duplication.
  const NWC_BACKUP_LABEL = {
    current: 'Backed up ✓',
    stale: 'Not backed up',
    none: 'Not backed up',
    unknown: "Couldn't check",
  };

  async function backupNwcToRelays() {
    // The encryption runs in the service worker against the stored string, so
    // the raw connection never crosses to a page just to be re-encrypted. No
    // NIP-04 fallback there either — see the worker-side rationale.
    const { ciphertext, algo } = await call({ type: 'SIDECAR_NWC_BACKUP_CIPHERTEXT' });
    const event = {
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', NWC_BACKUP_DTAG], ['encryption', algo]],
      content: ciphertext,
    };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event });
    await publishSigned(signed);
  }

  async function restoreNwcFromRelays() {
    const ev = await fetchBackupEvent(NWC_BACKUP_DTAG);
    if (!ev) throw new Error('No wallet backup found on your relays');
    const scheme = (ev.tags.find((x) => x[0] === 'encryption') || [])[1];
    const nip = scheme === 'nip04' ? 4 : 44;
    const connection = await call({ type: 'SIDECAR_OWNER_DECRYPT', ciphertext: ev.content, nip });
    if (!connection || !connection.startsWith('nostr+walletconnect://')) {
      throw new Error('Backup could not be read');
    }
    // Validate with a getInfo round-trip before saving, like manual connect.
    const client = window.SidecarNWC.makeClient(connection);
    await client.getInfo();
    client.close();
    await call({ type: 'SIDECAR_SET_NWC', connection });
    // ensureNwc() drops the stale balance too, but it runs after the wallet screen
    // has already painted from cache — clearing here means the restored wallet never
    // shows the previous one's balance, not even for a frame.
    balanceCache = { pubkey: null, sats: null };
  }

  // Plain signed-JSON export of the account's identity events (download, no relays).
  async function exportBundle(active) {
    const events = [];
    for (const k of [0, 3, 10002, 10000]) {
      const ev = await fetchLatestEvent(k);
      if (ev) events.push(ev);
    }
    if (!events.length) throw new Error('Nothing found to export');
    const bundle = { version: 1, exportedAt: new Date().toISOString(), pubkey: active.pubkey, npub: active.npub, events };
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sidecar-backup-' + active.npub.slice(0, 12) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  const KIND_LABELS = { 0: 'Profile', 3: 'Follows', 10000: 'Mute list', 10002: 'Relay list' };
  const kindLabel = (k) => KIND_LABELS[k] || ('kind ' + k);

  // Import a downloaded backup file: verify signatures + ownership, then rebroadcast.
  function importBundleModal(bundle, active) {
    const events = Array.isArray(bundle && bundle.events) ? bundle.events : null;
    if (!events || !events.length) {
      toast('That file has no events to restore', 'error');
      return;
    }
    // Keep only well-formed, validly-signed events authored by the active account.
    const valid = events.filter((ev) => {
      try {
        return ev && ev.pubkey === active.pubkey && NT.verifyEvent(ev);
      } catch (_) {
        return false;
      }
    });
    const foreign = events.filter((ev) => ev && ev.pubkey && ev.pubkey !== active.pubkey).length;

    openModal((modal) => {
      const go = h('button', { className: 'primary', textContent: 'Restore to relays' });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);

      const children = [
        h('h3', { textContent: 'Restore from file' }),
      ];
      if (!valid.length) {
        go.disabled = true;
        children.push(
          h('p', {
            className: 'hint',
            textContent: foreign
              ? 'This backup belongs to a different account, so nothing here can be restored to ' + displayName(active) + '.'
              : 'No valid, signed events were found in this file.',
          })
        );
        modal.append(...children, h('div', { className: 'actions' }, [cancel]));
        return;
      }

      const summary = h('ul', { className: 'restore-list' });
      // Each row's second line — what the file holds vs what's live — fills in
      // async below; Restore stays disabled until it has, because the counts ARE
      // the confirmation (a backup file older than a live list is how lists get
      // shrunk, and the row is where that has to be visible).
      const subs = new Map();
      valid.forEach((ev) => {
        const sub = h('div', { className: 'restore-list-sub' }, [
          h('span', { className: 'recv-spinner' }),
          document.createTextNode(' checking relays…'),
        ]);
        subs.set(ev, sub);
        summary.append(h('li', {}, [h('div', { className: 'item-label', textContent: kindLabel(ev.kind) }), sub]));
      });
      go.disabled = true;
      children.push(
        h('p', {
          className: 'hint',
          textContent: 'Re-publishes these already-signed events to your relays as your current data:',
        }),
        summary
      );
      (async () => {
        const kinds = [...new Set(valid.map((ev) => ev.kind))];
        const live = new Map(await Promise.all(kinds.map(async (k) => [k, await fetchLatestEvent(k)])));
        for (const ev of valid) {
          const sub = subs.get(ev);
          if (!sub || !sub.isConnected) continue;
          sub.innerHTML = '';
          const cur = live.get(ev.kind);
          if (ev.kind === 0) {
            let incoming = {};
            try { incoming = JSON.parse(ev.content || '{}'); } catch (_) {}
            sub.append(profilePreviewPane(incoming));
          } else if (ev.kind === 3 || ev.kind === 10000) {
            const noun = ev.kind === 10000 ? 'muted' : 'followed';
            // Mute lists carry their members encrypted in content as often as in
            // tags — count both sources on both sides, or a private list reads
            // as empty on every line.
            const bak = ev.kind === 10000
              ? await muteTags(ev)
              : { tags: ev.tags, private: false, ok: true };
            const now = ev.kind === 10000 && cur ? await muteTags(cur) : null;
            const liveTags = ev.kind === 10000 ? (now && now.ok ? now.tags : null) : (cur && cur.tags);
            if (!bak.ok) {
              sub.classList.add('warn');
              sub.textContent = 'Private mute list in this file — Sidecar could not decrypt it to count';
            } else {
              const d = listDiff(liveTags, bak.tags);
              if (!d.backup) {
                // An empty list in the file is a state to name, not a count to
                // print: "0 followed" reads like a measured zero, and restoring
                // publishes that emptiness over whatever is live.
                sub.classList.add('warn');
                sub.textContent = 'Empty ' + (ev.kind === 10000 ? 'mute' : 'follow') + ' list in this file';
                if (cur && liveTags && d.current) {
                  sub.textContent += ' · ' + d.current.toLocaleString('en-US') + ' live now would be ' + (ev.kind === 10000 ? 'unmuted' : 'lost');
                }
              } else {
                sub.textContent = d.backup.toLocaleString('en-US') + ' ' + noun +
                  (bak.private ? ' (private list)' : '') +
                  (cur ? (liveTags ? ' · ' + d.current.toLocaleString('en-US') + ' now' : ' · live list unreadable') : ' · nothing live now');
                if (liveTags && (d.dropped || d.added)) {
                  sub.classList.add('warn');
                  sub.textContent += ' · ' + (d.dropped ? d.dropped.toLocaleString('en-US') + ' will be ' + (ev.kind === 10000 ? 'unmuted' : 'removed') : '') +
                    (d.dropped && d.added ? ', ' : '') + (d.added ? d.added.toLocaleString('en-US') + ' added' : '');
                }
              }
            }
          } else if (ev.kind === 10002) {
            const n = (ev.tags || []).filter((x) => x && x[0] === 'r').length;
            sub.textContent = n.toLocaleString('en-US') + ' relay' + (n === 1 ? '' : 's');
          } else {
            sub.textContent = '';
          }
        }
        if (summary.isConnected) go.disabled = false;
      })();
      if (foreign) {
        children.push(h('p', { className: 'hint warn', textContent: foreign + ' event(s) from another account were skipped.' }));
      }

      const err = h('div', { className: 'error' });
      go.addEventListener('click', async () => {
        err.textContent = '';
        go.disabled = true;
        go.textContent = 'Restoring…';
        let ok = 0;
        for (const ev of valid) {
          try {
            await publishSigned(ev);
            ok++;
          } catch (_) {}
        }
        closeModal();
        if (ok) {
          toast('Restored ' + ok + ' item(s) to your relays', 'success');
          renderProfile();
          renderMain();
        } else {
          toast('Could not publish to any relay', 'error');
        }
      });

      modal.append(...children, err, h('div', { className: 'actions' }, [go, cancel]));
    });
  }

  // ---- vault export/import: every account's key + wallet connection, in one
  // password-encrypted file. Distinct from a single account's nsec/ncryptsec
  // export — this covers the whole device. Uses SidecarCrypto (PBKDF2 -> AES-GCM,
  // same primitive the keystore itself uses at rest) with a password the user
  // chooses fresh here, independent of their Sidecar PIN.
  function exportVaultModal() {
    openModal((modal) => {
      const pin = h('input', { type: 'password', maxLength: 32 });
      const err = h('div', { className: 'error' });
      const go = h('button', { className: 'primary', textContent: 'Continue' });
      go.addEventListener('click', async () => {
        err.textContent = '';
        if (!pin.value) return (err.textContent = 'Enter your PIN.');
        go.disabled = true;
        go.textContent = 'Verifying…';
        try {
          const { valid } = await call({ type: 'SIDECAR_VERIFY_PIN', pin: pin.value });
          if (!valid) throw new Error('Incorrect PIN');
          closeModal();
          setTimeout(() => encryptVaultModal(pin.value), 0);
        } catch (e) {
          err.textContent = e.message;
          go.disabled = false;
          go.textContent = 'Continue';
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Export vault' }),
        h('p', { className: 'hint', textContent: 'Enter your PIN to export every account on this device.' }),
        h('label', { textContent: 'PIN' }),
        pin,
        err,
        h('div', { className: 'actions' }, [go, cancel])
      );
    });
  }

  function encryptVaultModal(pin) {
    openModal((modal) => {
      const pass = h('input', { type: 'password', placeholder: 'At least 8 characters' });
      const pass2 = h('input', { type: 'password', placeholder: 'Confirm password' });
      const err = h('div', { className: 'error' });
      const go = h('button', { className: 'primary', textContent: 'Export' });
      go.addEventListener('click', async () => {
        err.textContent = '';
        if (!pass.value || pass.value.length < 8) return (err.textContent = 'Use a password of at least 8 characters.');
        if (pass.value !== pass2.value) return (err.textContent = 'Passwords do not match.');
        go.disabled = true;
        go.textContent = 'Exporting…';
        try {
          const accounts = [];
          for (const a of state.accounts) {
            const { nsec } = await call({ type: 'SIDECAR_REVEAL_NSEC', pubkey: a.pubkey, pin });
            let nwc = null;
            const { has } = await call({ type: 'SIDECAR_HAS_NWC', pubkey: a.pubkey });
            if (has) {
              const r = await call({ type: 'SIDECAR_REVEAL_NWC', pubkey: a.pubkey, pin });
              nwc = r.connection || null;
            }
            // picture rides along so a restored account shows its avatar right
            // away instead of waiting on a kind:0 round trip — and so the vault
            // stops silently dropping data it already had in hand.
            accounts.push({ pubkey: a.pubkey, npub: a.npub, name: a.name, picture: a.picture || '', nsec, nwc });
          }
          const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), accounts });
          const kdf = window.SidecarCrypto.newKdf();
          const key = await window.SidecarCrypto.deriveKey(pass.value, kdf);
          const { iv, ct } = await window.SidecarCrypto.encryptString(key, payload);
          const file = { version: 1, exportedAt: new Date().toISOString(), kdf, iv, ct };
          const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
          const a2 = document.createElement('a');
          a2.href = url;
          a2.download = 'sidecar-vault-' + new Date().toISOString().slice(0, 10) + '.json';
          a2.click();
          URL.revokeObjectURL(url);
          closeModal();
          toast('Exported ' + accounts.length + ' account(s)', 'success');
        } catch (e) {
          err.textContent = e.message || 'Could not export the vault.';
          go.disabled = false;
          go.textContent = 'Export';
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Set an export password' }),
        h('p', {
          className: 'hint',
          textContent:
            "Choose a password to encrypt the vault file. Use something other than your Sidecar PIN — you'll need this exact password to restore it.",
        }),
        h('label', { textContent: 'Password' }),
        pass,
        h('label', { textContent: 'Confirm password' }),
        pass2,
        err,
        h('div', { className: 'actions' }, [go, cancel])
      );
    });
  }

  // Restore from a vault file: decrypt, then add any account not already present.
  // Never overwrites an existing account — a pubkey already on this device is
  // counted as "already have it" and simply skipped.
  function importVaultModal(file) {
    openModal((modal) => {
      const pass = h('input', { type: 'password', placeholder: 'Vault export password' });
      const err = h('div', { className: 'error' });
      const go = h('button', { className: 'primary', textContent: 'Restore' });
      go.addEventListener('click', async () => {
        err.textContent = '';
        if (!pass.value) return (err.textContent = 'Enter the export password.');
        go.disabled = true;
        go.textContent = 'Restoring…';
        try {
          if (!file || !file.kdf || !file.iv || !file.ct) throw new Error('Not a valid Sidecar vault file.');
          const key = await window.SidecarCrypto.deriveKey(pass.value, file.kdf);
          let payload;
          try {
            payload = await window.SidecarCrypto.decryptString(key, { iv: file.iv, ct: file.ct });
          } catch (_) {
            throw new Error('Incorrect password, or a corrupted file.');
          }
          const bundle = JSON.parse(payload);
          const accounts = Array.isArray(bundle.accounts) ? bundle.accounts : [];
          if (!accounts.length) throw new Error('That vault has no accounts to restore.');
          let imported = 0, skipped = 0;
          for (const a of accounts) {
            try {
              const added = await call({ type: 'SIDECAR_ADD_ACCOUNT', secret: a.nsec, name: a.name || '' });
              imported++;
              // Vaults written before this field existed have no picture; those
              // accounts fall back to the kind:0 backfill in renderAccounts.
              if (a.picture) {
                await call({ type: 'SIDECAR_SET_PROFILE', pubkey: added.pubkey, name: a.name || '', picture: a.picture });
              }
              // The pubkey is derived from the secret, so a successful add always
              // lands under added.pubkey — safe to attach the wallet connection now.
              if (a.nwc) await call({ type: 'SIDECAR_SET_NWC', pubkey: added.pubkey, connection: a.nwc });
            } catch (_) {
              skipped++; // already exists on this device
            }
          }
          closeModal();
          await refresh();
          toast('Imported ' + imported + ' account(s)' + (skipped ? ', ' + skipped + ' already present' : ''), 'success');
        } catch (e) {
          err.textContent = e.message || 'Could not restore the vault.';
          go.disabled = false;
          go.textContent = 'Restore';
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Restore vault' }),
        h('p', { className: 'hint', textContent: 'Enter the password this vault was exported with. Accounts already on this device are left untouched.' }),
        h('label', { textContent: 'Password' }),
        pass,
        err,
        h('div', { className: 'actions' }, [go, cancel])
      );
      setTimeout(() => pass.focus(), 50);
    });
  }

  // The restore confirm. This used to be a PIN box and a promise: it re-published
  // whatever the latest backup held, sight unseen, and a backup older than a live
  // list that had moved on would silently shrink it. Restoring over newer data is
  // the destructive-event case the panel warns about everywhere else, so both
  // sides are fetched first — the backup (readable without the PIN; only the
  // signing step is gated) and the current live event — and the modal shows what
  // will change before it ever asks for the PIN.
  //
  // For the lists the headline is the SET difference, not the counts: "289 vs
  // 312" can be a reshuffle, "23 you follow today are not in the backup" cannot
  // be anything but a loss. For the profile the same job is done by a preview
  // pane — the bio rendered as the bio, not as a JSON diff.
  function restoreModal(t) {
    openModal((modal) => {
      const pin = h('input', { type: 'password', maxLength: 32 });
      const err = h('div', { className: 'error' });
      const go = h('button', { className: 'primary', textContent: 'Restore' });
      go.disabled = true; // until the comparison has rendered
      go.addEventListener('click', async () => {
        err.textContent = '';
        if (!pin.value) return (err.textContent = 'Enter your PIN.');
        go.disabled = true;
        go.textContent = 'Restoring…';
        try {
          await restoreBackup(t, pin.value);
          closeModal();
          toast(t.label + ' restored', 'success');
        } catch (e) {
          err.textContent = e.message;
          go.disabled = false;
          go.textContent = 'Restore';
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);

      const compare = h('div', { className: 'restore-compare' }, [
        h('div', { className: 'recv-waiting' }, [
          h('span', { className: 'recv-spinner' }),
          h('span', { textContent: 'Checking your relays…' }),
        ]),
      ]);

      modal.append(
        h('h3', { textContent: 'Restore ' + t.label }),
        h('p', {
          className: 'hint',
          textContent:
            'Re-publishes your latest ' + t.label.toLowerCase() + ' backup as your current ' + t.label.toLowerCase() + '. Requires your PIN.',
        }),
        compare,
        h('label', { textContent: 'PIN' }),
        pin,
        err,
        h('div', { className: 'actions' }, [go, cancel])
      );

      (async () => {
        const [ev, cur] = await Promise.all([fetchBackupEvent(t.dtag), fetchLatestEvent(t.kind)]);
        if (!compare.isConnected) return; // the modal was closed mid-fetch
        compare.innerHTML = '';
        if (!ev) {
          compare.append(h('p', { className: 'hint warn', textContent: 'No backup found for ' + t.label.toLowerCase() + '. Try backing up first.' }));
          pin.disabled = true;
          return;
        }
        let s;
        try {
          s = await decryptBackupSource(ev);
        } catch (e) {
          compare.append(h('p', { className: 'hint warn', textContent: (e && e.message) || 'Backup could not be read.' }));
          pin.disabled = true;
          return;
        }
        compare.append(await buildRestoreCompare(t, s, ev.created_at, cur));
        if (compare.isConnected) go.disabled = false;
      })();
    });
  }

  // The comparison block itself, shared shape for every backup type. `cur` is the
  // live event (or null when the relays hold none — then the restore is a first
  // publish, not an overwrite, and saying so is the honest framing). Async
  // because mute lists count through muteTags, which decrypts the private half
  // of the list out of content.
  async function buildRestoreCompare(t, source, backupAt, cur) {
    const wrap = h('div');
    const when = relativeTime(backupAt);

    if (t.kind === 0) {
      let incoming = {};
      try { incoming = JSON.parse(source.content || '{}'); } catch (_) {}
      let live = null;
      if (cur) { try { live = JSON.parse(cur.content || '{}'); } catch (_) {} }
      const changed = live === null || JSON.stringify(live) !== JSON.stringify(incoming);
      wrap.append(profilePreviewPane(incoming));
      wrap.append(
        h('p', {
          className: 'hint' + (changed ? ' warn' : ''),
          textContent: live === null
            ? 'No profile on your relays yet — this will publish the backup above.'
            : changed
              ? 'This replaces the profile you have live now.'
              : 'Same profile as what you have live now.',
        })
      );
      return wrap;
    }

    const noun = t.key === 'mute' ? 'muted' : 'followed';
    const bak = t.key === 'mute' ? await muteTags(source) : { tags: source.tags, private: false, ok: true };
    const now = t.key === 'mute' && cur ? await muteTags(cur) : null;
    // null liveTags = no live event at all, or a private live list that wouldn't
    // decrypt — both mean the diff numbers can't be trusted, so none are shown.
    const liveTags = t.key === 'mute' ? (now && now.ok ? now.tags : null) : (cur && cur.tags);

    if (!bak.ok) {
      wrap.append(h('div', { className: 'recovery-confirm' }, [
        h('div', { className: 'recovery-count-lg' }, [
          h('strong', { textContent: 'Private mute list' }),
        ]),
        h('div', { className: 'recovery-sub', textContent: 'Sidecar could not decrypt it to count · backup from ' + when }),
      ]));
      return wrap;
    }

    const d = listDiff(liveTags, bak.tags);
    if (!d.backup) {
      // Name the state, don't print its count: "0 accounts followed in the
      // backup" reads like a measured zero, and the restore publishes that
      // emptiness over whatever is live.
      wrap.append(h('div', { className: 'recovery-confirm' }, [
        h('div', { className: 'recovery-count-lg' }, [
          h('strong', { textContent: 'Empty ' + (t.key === 'mute' ? 'mute' : 'follow') + ' list' }),
        ]),
        h('div', {
          className: 'recovery-sub',
          textContent: (liveTags ? d.current.toLocaleString('en-US') + ' ' + noun + ' live now' : cur ? 'Live list unreadable' : 'Nothing live on your relays now') + ' · backup from ' + when,
        }),
      ]));
      if (liveTags && d.current) {
        wrap.append(h('p', {
          className: 'hint warn',
          textContent: 'The backup holds no ' + noun + ' accounts — restoring publishes the empty list over the ' + d.current.toLocaleString('en-US') + ' you have now.',
        }));
      }
      return wrap;
    }

    const rows = h('div', { className: 'recovery-confirm' }, [
      h('div', { className: 'recovery-count-lg' }, [
        h('strong', { textContent: d.backup.toLocaleString('en-US') }),
        document.createTextNode(' accounts ' + noun + ' in the backup'),
      ]),
      h('div', {
        className: 'recovery-sub',
        textContent:
          (liveTags ? d.current.toLocaleString('en-US') + ' ' + noun + ' now' : cur ? 'Live list unreadable' : 'Nothing live on your relays now') +
          ' · backup from ' + when + (bak.private ? ' · private list' : ''),
      }),
    ]);
    wrap.append(rows);
    if (!liveTags) return wrap;
    if (d.dropped || d.added) {
      const parts = [];
      if (d.dropped) parts.push(d.dropped.toLocaleString('en-US') + (t.key === 'mute' ? ' currently muted will be unmuted' : ' you follow today are not in the backup and will be removed'));
      if (d.added) parts.push(d.added.toLocaleString('en-US') + (t.key === 'mute' ? ' currently audible will be muted' : ' in the backup are new'));
      wrap.append(h('p', { className: 'hint warn', textContent: parts.join('; ') + '.' }));
    } else {
      wrap.append(h('p', { className: 'hint', textContent: 'Same accounts as what you have live now.' }));
    }
    return wrap;
  }

  // The bio as the bio: a profile-shaped preview of what the restore will
  // publish, so "is this MY bio?" is answered by looking rather than by diffing
  // field names. Plain text only — the profile view linkifies the live copy, but
  // a preview of an about-to-be-written event has no business pretending to be
  // interactive.
  function profilePreviewPane(p) {
    const pane = h('div', { className: 'restore-preview' });
    const head = h('div', { className: 'restore-preview-head' }, [
      avatarEl({ picture: p.picture || '', npub: state.activePubkey }, 'restore-preview-av'),
      h('div', { className: 'restore-preview-id' }, [
        h('div', { className: 'profile-name restore-preview-name', textContent: p.display_name || p.name || '(no name)' }),
        p.nip05 ? h('div', { className: 'hint restore-preview-nip05', textContent: p.nip05 }) : null,
      ]),
    ]);
    pane.append(head);
    pane.append(
      p.about
        ? h('div', { className: 'profile-about restore-preview-about', textContent: p.about })
        : h('p', { className: 'hint', textContent: '(no bio in this backup)' })
    );
    return pane;
  }

  // ---- NIP-65 relay list editor (Profile tab) ----
  // Loads the account's published read/write relays; if none exist yet, seeds
  // the editor from Sidecar's own configured relays as a starting point.
  async function loadNip65Editor(pubkey) {
    const n = await getNip65(pubkey);
    if (n) {
      const urls = [...new Set([...n.read, ...n.write])];
      return urls.map((url) => ({ url, read: n.read.includes(url), write: n.write.includes(url) }));
    }
    const configured = await call({ type: 'SIDECAR_GET_RELAYS' });
    return Object.keys(configured).map((url) => ({
      url,
      read: configured[url].read !== false,
      write: configured[url].write !== false,
    }));
  }

  function renderNip65Section(view, active) {
    const setting = h('div', { className: 'setting nip65-setting' });
    setting.append(
      h('h3', { textContent: 'Relays' }),
      h('p', {
        className: 'hint',
        textContent:
          'Your public relay list (NIP-65) — tells other Nostr apps where to find your notes and where to send you replies and DMs. Keep it small and reliable.',
      })
    );

    const status = h('p', { className: 'hint compact nip65-status', textContent: 'Loading…' });
    const list = h('div', { className: 'list flat nip65-list' });
    const warn = h('p', { className: 'hint warn nip65-warn' });
    const addInput = h('input', { type: 'text', placeholder: 'wss://relay.example.com' });
    const addBtn = h('button', { className: 'secondary', textContent: 'Add' });
    const err = h('div', { className: 'error' });
    const publishBtn = h('button', { className: 'primary', textContent: 'Publish relay list' });

    // MANUAL, NEVER ON RENDER. Probing opens a socket to every relay in the list; doing
    // that on each repaint would hammer them for nothing and make the panel's presence
    // legible to anyone watching. It runs when asked and the answers are kept for the
    // session.
    const checkBtn = h('button', { className: 'secondary nip65-check', textContent: 'Check relay health' });

    setting.append(
      status,
      list,
      warn,
      h('div', { className: 'row-actions' }, [addInput, addBtn]),
      err,
      h('div', { className: 'actions nip65-check-row' }, [checkBtn]),
      h('div', { className: 'actions nip65-publish' }, [publishBtn])
    );
    view.append(setting);

    let relayList = [];
    // url -> result | 'checking'. Session-lived and keyed by URL rather than by index so
    // it survives adds, removes and reorders — the row a verdict belongs to is the one
    // with that URL, not the one that was third when the probe started.
    const health = new Map();

    function updateWarn() {
      // ws:// first: it's the one of these three that leaks plaintext to the network,
      // and it can arrive from a PUBLISHED list as easily as from the input below —
      // this check covers both, which is why it doesn't live in the Add handler.
      if (relayList.some((r) => r.url.startsWith('ws://'))) {
        warn.textContent = 'A ws:// relay is unencrypted — fine for a local or Tor relay, but anything on the open internet should be wss://.';
      } else if (!relayList.some((r) => r.write)) {
        warn.textContent = 'No write relays selected — other apps may not find your new notes.';
      } else if (!relayList.some((r) => r.read)) {
        warn.textContent = 'No read relays selected — you may not see replies or mentions here.';
      } else {
        warn.textContent = '';
      }
    }

    // WORD PLUS COLOR, never color alone (WCAG 1.4.1) — and the word carries the whole
    // verdict, so a theme that renders the dot poorly still leaves the row readable.
    const VERDICT_TEXT = {
      healthy: 'Healthy',
      gated: 'Gated',
      'auth-gated': 'Needs login',
      'not-serving': 'Not answering',
      down: 'Unreachable',
    };
    function healthLine(url) {
      const r = health.get(url);
      if (!r) return null;
      const line = h('div', { className: 'nip65-health' });
      if (r === 'checking') {
        line.classList.add('checking');
        line.append(h('span', { className: 'nip65-dot' }), document.createTextNode('Checking…'));
        return line;
      }
      line.classList.add('v-' + r.verdict);
      const bits = [VERDICT_TEXT[r.verdict] || r.verdict];
      if (r.verdict === 'healthy' && r.probe && r.probe.connectMs != null) bits.push(r.probe.connectMs + 'ms');
      // The keep-or-drop signal, and the one no client shows: up, serving, and holding
      // nothing of yours. Only stated when the probe actually asked for this account.
      if (r.probe && r.probe.served && r.probe.hasAuthorData === false) bits.push('no notes here');
      // "Writes unknown" rather than silence: NIP-11 not answering is not evidence that
      // posting works, and this screen exists to decide whether to keep a relay.
      if (r.verdict === 'healthy' && r.writeKnown === false) bits.push('writes unverified');
      if (r.why) bits.push(r.why);
      line.append(h('span', { className: 'nip65-dot' }), document.createTextNode(bits.join(' · ')));
      return line;
    }

    async function runHealthCheck() {
      const RH = self.SidecarRelayHealth;
      const urls = relayList.map((r) => r.url);
      if (!RH || !urls.length) return;
      checkBtn.disabled = true;
      checkBtn.textContent = 'Checking…';
      urls.forEach((u) => health.set(u, 'checking'));
      renderRows();
      try {
        // The active account's key, so "no notes here" means THIS account rather than
        // "the relay is empty". Without one the probe still works, it just cannot answer
        // that question.
        await RH.audit(urls, state.activePubkey || null, {
          onResult: (res) => {
            health.set(res.url, res);
            renderRows(); // rows settle one at a time rather than after the slowest
          },
        });
      } catch (_) {
        // A probe that throws must not leave every row saying "Checking…" forever.
        urls.forEach((u) => { if (health.get(u) === 'checking') health.delete(u); });
        renderRows();
      } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = 'Check relay health';
      }
    }
    checkBtn.addEventListener('click', runHealthCheck);

    function renderRows() {
      if (!relayList.length) {
        listState(list, 'No relays yet — add one below.');
        updateWarn();
        return;
      }
      list.innerHTML = '';
      relayList.forEach((r, i) => {
        const readCb = h('input', { type: 'checkbox' });
        readCb.checked = r.read;
        readCb.addEventListener('change', () => { r.read = readCb.checked; updateWarn(); });
        const writeCb = h('input', { type: 'checkbox' });
        writeCb.checked = r.write;
        writeCb.addEventListener('change', () => { r.write = writeCb.checked; updateWarn(); });

        const rm = iconButton('Remove', 'trash', () => {
          relayList.splice(i, 1);
          renderRows();
        });
        rm.classList.add('nip65-rm');

        // Stacked layout: the URL wraps on its own line, then a toggles row —
        // the sidebar is too narrow to keep the URL and Read/Write on one line.
        const row = h('div', { className: 'item nip65-row' }, [
          h('div', { className: 'nip65-url', textContent: r.url }),
          h('div', { className: 'nip65-controls' }, [
            h('label', { className: 'nip65-chip' }, [readCb, document.createTextNode('Read')]),
            h('label', { className: 'nip65-chip' }, [writeCb, document.createTextNode('Write')]),
            rm,
          ]),
        ]);
        // ITS OWN LINE, not squeezed alongside the URL. .nip65-url is break-all and wraps
        // to as many lines as it needs, so a glyph and a latency sharing that line would
        // interleave with the wrap. Stacking is the panel's answer to a narrow column.
        const hEl = healthLine(r.url);
        if (hEl) row.insertBefore(hEl, row.lastChild);
        list.append(row);
      });
      updateWarn();
    }

    addBtn.addEventListener('click', () => {
      let url = addInput.value.trim();
      if (!url) return;
      if (!/^wss?:\/\//i.test(url)) url = 'wss://' + url;
      url = url.replace(/\/+$/, ''); // drop trailing slash so wss://x and wss://x/ dedupe
      if (!/^wss?:\/\/[^/]+/i.test(url)) { err.textContent = "That doesn't look like a relay URL."; return; }
      if (relayList.some((r) => r.url === url)) { addInput.value = ''; return; }
      err.textContent = '';
      relayList.push({ url, read: true, write: true });
      addInput.value = '';
      renderRows();
    });

    publishBtn.addEventListener('click', async () => {
      err.textContent = '';
      if (!relayList.length) { err.textContent = 'Add at least one relay first.'; return; }
      if (!relayList.some((r) => r.read || r.write)) {
        err.textContent = 'Check Read or Write on at least one relay first.';
        return;
      }
      publishBtn.disabled = true;
      publishBtn.textContent = 'Publishing…';
      try {
        await publishNip65(active.pubkey, relayList);
        status.textContent = 'Published ✓';
        status.classList.add('done');
        toast('Relay list published', 'success');
        // Offer to switch to NIP-65-only mode if bootstrap relays are still active.
        if (!(await nip65OnlyFor(active.pubkey))) {
          maybeOfferNip65Only(active.pubkey);
        }
      } catch (e) {
        err.textContent = e.message;
        toast(e.message, 'error');
      }
      publishBtn.disabled = false;
      publishBtn.textContent = 'Publish relay list';
    });

    loadNip65Editor(active.pubkey)
      .then((initial) => {
        relayList = initial;
        status.textContent = relayList.length ? 'Loaded from your current relay list.' : 'Not published yet.';
        renderRows();
      })
      .catch(() => {
        status.textContent = 'Could not load your current relay list.';
        renderRows();
      });
  }

  // After the user publishes a NIP-65 relay list, offer to stop using Sidecar's
  // bootstrap relays. The user's declared relays are now the source of truth;
  // the bootstrap set only added noise (and stale data, as the follow-count bug
  // showed). A one-time confirmation modal — not a silent settings change.
  //
  // Tracked per pubkey, because the setting is per account: declining for one
  // identity must not silently swallow the offer for the next one you publish from.
  const nip65OnlyNudged = new Set();
  function maybeOfferNip65Only(pubkey) {
    if (!pubkey || nip65OnlyNudged.has(pubkey)) return;
    nip65OnlyNudged.add(pubkey);
    openModal((modal) => {
      modal.append(
        h('div', { className: 'setup-modal' }, [
          h('h3', { textContent: 'Switch to your relay list?' }),
          h('p', { className: 'hint', textContent:
            'You’ve published a relay list (NIP-65). Sidecar can now read and publish through those relays exclusively, leaving the bootstrap relays behind. They’ll stay in Settings if you ever need them again.'
          }),
          h('div', { className: 'row-actions' }, [
            h('button', { className: 'secondary', textContent: 'Not now', onclick: closeModal }),
            h('button', { className: 'primary', textContent: 'Use my relays only', onclick: async () => {
              // `pubkey`, not state.activePubkey — the account whose list was just
              // published is the one this applies to, even if the active one changed.
              await call({ type: 'SIDECAR_SET_NIP65_ONLY', pubkey, on: true });
              closeModal();
              toast('Now using your NIP-65 relays only', 'success');
            }}),
          ]),
        ])
      );
    });
  }

  // ---- Follow-list recovery (Powered by Mutable — ported from github.com/dmnyc/mutable) ----
  // kind:3 is replaceable, so a buggy client publishing an empty/short list
  // overwrites your follows everywhere. Relays don't delete old versions though —
  // they just stop serving them as "current". Scanning a broad relay set with a
  // limit>1 turns them up, so the user can republish a healthy earlier version.
  // Cast a WIDE net when scanning for old versions — coverage beats reliability
  // here (dead relays just time out). Includes the big general relays where a
  // user likely published over the years, plus archival/cache relays that keep
  // historical events. Queried on top of the user's own configured + NIP-65 relays.
  const FOLLOW_SCAN_RELAYS = [
    'wss://purplepag.es',        // aggregates kind:0/3/10002
    'wss://relay.primal.net',
    'wss://cache0.primal.net',   // Primal caches keep historical events
    'wss://cache1.primal.net',
    'wss://cache2.primal.net',
    'wss://nos.lol',
    'wss://relay.snort.social',
    'wss://relay.damus.io',      // dying, but historically the biggest default → old copies live here
    'wss://nostr.wine',
    'wss://offchain.pub',
    'wss://nostr.mom',
    'wss://relay.noswhere.com',
  ];
  // Where a RESTORED list is republished (in addition to the account's own write
  // relays) — writable, broad-reach relays only, so the restore actually lands.
  const FOLLOW_PUBLISH_RELAYS = ['wss://purplepag.es', 'wss://nos.lol', 'wss://offchain.pub', 'wss://nostr.mom'];

  async function scanFollowListHistory(pubkey) {
    const configured = await relayUrls(false);
    const n = await getNip65(pubkey);
    const nip65 = n ? [...n.read, ...n.write] : [];
    const relays = [...new Set([...configured, ...nip65, ...FOLLOW_SCAN_RELAYS])];

    const byId = new Map();
    const responding = new Set();
    await Promise.all(
      relays.map(async (relay) => {
        try {
          const evs = await Promise.race([
            getPool().querySync([relay], { kinds: [3], authors: [pubkey], limit: 20 }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000)),
          ]);
          if (evs && evs.length) responding.add(relay);
          (evs || []).forEach((ev) => {
            if (ev.kind !== 3 || ev.pubkey !== pubkey) return;
            let c = byId.get(ev.id);
            if (!c) {
              const set = new Set(ev.tags.filter((t) => t[0] === 'p' && t[1] && t[1].length === 64).map((t) => t[1]));
              c = { event: ev, eventId: ev.id, createdAt: ev.created_at, followCount: set.size, foundOnRelays: [] };
              byId.set(ev.id, c);
            }
            if (!c.foundOnRelays.includes(relay)) c.foundOnRelays.push(relay);
          });
        } catch (_) {}
      })
    );

    const candidates = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
    const current = candidates[0] || null;
    const recommended = pickRecommendedRecovery(candidates, current);
    return { current, candidates, recommended, respondingRelays: [...responding] };
  }

  function pickRecommendedRecovery(candidates, current) {
    const ranked = [...candidates]
      .sort((a, b) => b.followCount - a.followCount || b.createdAt - a.createdAt)
      .filter((c) => c.followCount > 0);
    const currentCount = current ? current.followCount : 0;
    const currentId = current ? current.eventId : null;
    for (const c of ranked) {
      if (c.eventId === currentId) continue;
      if (c.followCount > currentCount) return c;
    }
    return null;
  }

  async function recoverFollowList(candidate) {
    const preserved = candidate.event.tags.filter((t) => t[0] === 'p' && t[1] && t[1].length === 64);
    const event = {
      kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      tags: preserved,
      content: candidate.event.content || '',
    };
    const signed = await call({ type: 'SIDECAR_OWNER_SIGN', event });
    const targets = [...new Set([...(await postRelays()), ...FOLLOW_PUBLISH_RELAYS])];
    return publishToRelays(targets, signed);
  }

  function mutableAttribution() {
    const a = h('a', {
      className: 'mutable-credit',
      href: 'https://mutable.top',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    const logo = document.createElement('img');
    logo.className = 'mutable-logo';
    logo.src = 'icons/apps/mutable.svg';
    logo.alt = '';
    a.append(logo, h('span', { textContent: 'Powered by Mutable' }));
    return a;
  }

  function followRecoveryModal(active) {
    openModal((modal) => {
      const xBtn = h('button', { className: 'modal-x', title: 'Close' });
      xBtn.appendChild(icon('x'));
      xBtn.addEventListener('click', closeModal);
      const body = h('div', { className: 'recovery-modal' });
      modal.append(xBtn, body);

      let lastRes = null;
      const clear = () => { body.innerHTML = ''; };
      const spinner = (text) =>
        h('div', { className: 'recv-waiting' }, [h('span', { className: 'recv-spinner' }), h('span', { textContent: text })]);

      function showIntro() {
        clear();
        const scan = h('button', { className: 'primary', textContent: 'Scan relays' });
        scan.addEventListener('click', runScan);
        body.append(
          h('h3', { textContent: 'Restore follow list' }),
          h('p', {
            className: 'hint',
            textContent:
              'If another app wiped or shrank your follows, scan your relays for older versions of your follow list and republish a healthy one.',
          }),
          h('div', { className: 'actions' }, [scan]),
          mutableAttribution()
        );
      }

      async function runScan() {
        clear();
        body.append(h('h3', { textContent: 'Scanning…' }), spinner('Checking your relays for older versions…'));
        try {
          lastRes = await scanFollowListHistory(active.pubkey);
          showResults();
        } catch (e) {
          showError(e.message);
        }
      }

      function showResults() {
        clear();
        const res = lastRes;
        // Empty (0-follow) versions are the damage, not something worth restoring — hide them.
        const shown = res.candidates.filter((c) => c.followCount > 0);
        if (!shown.length) {
          const retry = h('button', { className: 'secondary', textContent: 'Scan again' });
          retry.addEventListener('click', runScan);
          body.append(
            h('h3', { textContent: 'No versions found' }),
            h('p', { className: 'hint', textContent: 'No follow-list versions with follows turned up on your relays.' }),
            h('div', { className: 'actions' }, [retry])
          );
          return;
        }
        body.append(
          h('h3', { textContent: 'Choose a version to restore' }),
          h('p', {
            className: 'hint',
            textContent:
              'Found ' + shown.length + ' version' + (shown.length === 1 ? '' : 's') +
              ' across ' + res.respondingRelays.length + ' relay' + (res.respondingRelays.length === 1 ? '' : 's') + '.',
          })
        );
        const list = h('div', { className: 'list flat recovery-list' });
        shown.forEach((c) => {
          const isCurrent = res.current && c.eventId === res.current.eventId;
          const isRec = res.recommended && c.eventId === res.recommended.eventId;
          const badges = [];
          if (isCurrent) badges.push(h('span', { className: 'recovery-badge cur', textContent: 'Current' }));
          if (isRec) badges.push(h('span', { className: 'recovery-badge rec', textContent: 'Recommended' }));
          const meta = h('div', { className: 'recovery-meta' }, [
            h('div', { className: 'recovery-count' }, [
              h('strong', { textContent: c.followCount.toLocaleString('en-US') }),
              document.createTextNode(' following'),
            ]),
            h('div', {
              className: 'recovery-sub',
              textContent: relativeTime(c.createdAt) + ' · ' + c.foundOnRelays.length + ' relay' + (c.foundOnRelays.length === 1 ? '' : 's'),
            }),
            badges.length ? h('div', { className: 'recovery-badges' }, badges) : document.createTextNode(''),
          ]);
          const row = h('div', { className: 'item recovery-row' + (isRec ? ' rec' : '') }, [meta]);
          if (!isCurrent && c.followCount > 0) {
            const pick = h('button', { className: 'mini', textContent: 'Restore' });
            pick.addEventListener('click', () => showConfirm(c));
            row.append(h('div', { className: 'item-actions' }, [pick]));
          }
          list.append(row);
        });
        body.append(list, mutableAttribution());
      }

      function showConfirm(c) {
        clear();
        const restore = h('button', { className: 'primary', textContent: 'Restore' });
        restore.addEventListener('click', () => runRestore(c));
        const back = h('button', { className: 'ghost', textContent: 'Back' });
        back.addEventListener('click', showResults);
        body.append(
          h('h3', { textContent: 'Restore this version?' }),
          h('p', { className: 'hint warn', textContent: 'This replaces your current follow list everywhere and cannot be automatically undone.' }),
          h('div', { className: 'recovery-confirm' }, [
            h('div', { className: 'recovery-count-lg' }, [
              h('strong', { textContent: c.followCount.toLocaleString('en-US') }),
              document.createTextNode(' accounts followed'),
            ]),
            h('div', {
              className: 'recovery-sub',
              textContent: new Date(c.createdAt * 1000).toLocaleString() + ' · ' + relativeTime(c.createdAt),
            }),
          ]),
          h('div', { className: 'actions' }, [restore, back])
        );
      }

      async function runRestore(c) {
        clear();
        body.append(h('h3', { textContent: 'Restoring…' }), spinner('Publishing your follow list…'));
        try {
          const ok = await recoverFollowList(c);
          // Invalidate cached follow data so the profile count + @mention list
          // reflect the restore.
          followCountCache.delete(active.pubkey);
          followListCache = null;
          followListPubkey = null;
          showDone(ok, c);
          toast('Follow list restored', 'success');
        } catch (e) {
          showError(e.message);
        }
      }

      function showDone(ok, c) {
        clear();
        const done = h('button', { className: 'primary', textContent: 'Done' });
        done.addEventListener('click', () => { closeModal(); renderProfile(); });
        body.append(
          h('h3', { textContent: 'Follow list restored' }),
          h('p', {
            className: 'hint',
            textContent:
              'Republished ' + c.followCount.toLocaleString('en-US') + ' follows to ' + ok + ' relay' + (ok === 1 ? '' : 's') + '.',
          }),
          h('div', { className: 'actions' }, [done])
        );
      }

      function showError(msg) {
        clear();
        const retry = h('button', { className: 'secondary', textContent: 'Try again' });
        retry.addEventListener('click', lastRes ? showResults : runScan);
        body.append(
          h('h3', { textContent: 'Something went wrong' }),
          h('p', { className: 'error', textContent: msg || 'Please try again.' }),
          h('div', { className: 'actions' }, [retry])
        );
      }

      showIntro();
    });
  }

  function renderBackupSection(view, active) {
    const setting = h('div', { className: 'setting backup-setting' });
    setting.append(
      h('h3', { textContent: 'Data backup' }),
      h('p', { className: 'hint', textContent: 'Your profile, follows, and mute list — data only, never your secret key — stored on your relays as an encrypted record you can restore here (NIP-78, NIP-44; NIP-04 for very large lists), or saved to a file below.' })
    );
    const list = h('div', { className: 'list flat' });
    const statuses = new Map();
    // "Backed up" and when, on two lines: the status column is narrow, and a
    // gold "Backed up · 2 days ago" ran into the buttons on exactly the rows
    // that had both. The when is furniture, not the signal — gray, below. The
    // check mirrors the wallet badge, so "Backed up" reads the same everywhere.
    const setBackedUp = (status, when) => {
      status.textContent = '';
      status.classList.add('done');
      const tick = icon('check');
      tick.classList.add('backup-check');
      status.append(tick, 'Backed up', h('div', { className: 'backup-status-time', textContent: when }));
    };
    BACKUP_TYPES.forEach((t) => {
      const status = h('div', { className: 'backup-status', textContent: 'Not backed up' });
      statuses.set(t.key, status);
      const backup = h('button', { className: 'mini', textContent: 'Back up' });
      backup.addEventListener('click', async () => {
        backup.disabled = true;
        backup.textContent = 'Backing up…';
        try {
          await createBackup(t);
          setBackedUp(status, 'just now');
          toast(t.label + ' backed up', 'success');
        } catch (e) {
          // Keep the row tidy — surface the detail in a toast, not inline.
          toast(e.message, 'error');
        }
        backup.disabled = false;
        backup.textContent = 'Back up';
      });
      const restore = h('button', { className: 'mini ghost', textContent: 'Restore' });
      restore.addEventListener('click', () => restoreModal(t));
      const row = h('div', { className: 'item' }, [
        h('div', { className: 'item-main' }, [h('div', { className: 'item-label', textContent: t.label }), status]),
        h('div', { className: 'item-actions' }, [backup, restore]),
      ]);
      list.append(row);
    });
    // The last-backup time comes from the relays, not from memory: the row used
    // to say "Not backed up" on every open until you backed up again in that
    // session, which read as the backup having been lost. The kind:30078 event's
    // created_at IS when the backup was taken. isConnected guards a rerender
    // that replaced the section while the fetch was out.
    BACKUP_TYPES.forEach(async (t) => {
      const status = statuses.get(t.key);
      const ev = await fetchBackupEvent(t.dtag);
      if (!ev || !status.isConnected) return;
      setBackedUp(status, relativeTime(ev.created_at));
    });
    setting.append(list);

    const exportWrap = h('div', { className: 'export-block' });
    exportWrap.append(
      h('p', {
        className: 'hint',
        textContent:
          'Or save a signed copy of your profile, follows, and lists as a file — an offline safety copy you can restore here later. This file holds no secret key.',
      })
    );
    const exportBtn = h('button', { className: 'secondary', textContent: 'Download data backup' });
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      try {
        await exportBundle(active);
        toast('Data backup downloaded (no secret key)', 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
      exportBtn.disabled = false;
    });

    // The key itself. Deliberately in its own block below the JSON export with
    // its own heading and warning: that file contains no secret and is safe to
    // click, this one IS the key. Two lookalike buttons side by side would invite
    // exactly the mistake that matters most here.
    const keyBackupWrap = h('div', { className: 'export-block' });
    keyBackupWrap.append(
      h('h3', { textContent: 'Private key backup' }),
      h('p', {
        className: 'hint',
        textContent:
          'Export your secret key as copyable text or an encrypted ncryptsec, or print it as a one-page sheet. This IS your key — never send it by email or chat.',
      })
    );
    // The Accounts screen's "Back up private key" entry, mirrored here — the backup
    // screen is where someone backing everything up should find the key export,
    // not only via the account row's menu. Same modal, same PIN step-up, so there
    // is exactly one key-backup flow to reason about. The printable sheet is an
    // action INSIDE the modal (plain from the nsec tab, encrypted masquerade from
    // the ncryptsec tab — printable straight from the typed password), which is
    // why this block carries no sheet button or encrypt toggle of its own.
    const keyBtn = h('button', { className: 'secondary', textContent: 'Back up private key' });
    keyBtn.addEventListener('click', () => backupKeyModal(active));
    keyBackupWrap.append(keyBtn);

    const importBtn = h('button', { className: 'secondary', textContent: 'Restore from file' });
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.style.display = 'none';
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        importBundleModal(JSON.parse(text), active);
      } catch (_) {
        toast('That file is not a valid Sidecar backup', 'error');
      }
      fileInput.value = '';
    });

    exportWrap.append(exportBtn, importBtn, fileInput);
    setting.append(exportWrap, keyBackupWrap);

    // Follow-list recovery — scan relays for an older kind:3 and republish it.
    const recoveryWrap = h('div', { className: 'export-block recovery-block' });
    recoveryWrap.append(
      h('p', {
        className: 'hint',
        textContent: 'Lost follows to a buggy client? Scan your relays for an older version of your follow list and restore it.',
      })
    );
    const recoveryBtn = h('button', { className: 'secondary', textContent: 'Follow List Recovery' });
    recoveryBtn.addEventListener('click', () => followRecoveryModal(active));
    recoveryWrap.append(recoveryBtn, mutableAttribution());
    setting.append(recoveryWrap);

    view.append(setting);
  }

  // ====================== Wallet (NWC / NIP-47) ======================
  let nwc = null; // active SidecarNWC client for the current account
  let nwcPubkey = null; // which account the client belongs to
  let nwcConn = null; // the connection string it was built from — see ensureNwc
  let nwcNotifSub = null; // NIP-47 notification subscription handle
  let nwcPollTimer = null; // fallback balance polling interval
  const fmtSats = (n) => Math.round(n).toLocaleString('en-US');
  const msatToSat = (m) => Math.floor((m || 0) / 1000);

  // ---- balance denomination (sats → BTC → fiat, cycled by tapping the balance) ----
  // Only the two balance DISPLAYS cycle (the pinned bar and the wallet card). Amounts
  // you're about to act on — invoices, budgets, transaction rows — stay in sats, so a
  // stale exchange rate can never misrepresent what's being paid.
  const DENOM_ORDER = ['sats', 'btc', 'fiat'];
  let denom = 'sats';

  // Bitcoin's smallest unit is one sat, so 8 decimals is exact, not a rounding choice.
  const fmtBtc = (sats) => (Math.round(sats) / 1e8).toFixed(8);

  // Intl picks the right minor-unit count per currency (2 for USD, 0 for JPY), which
  // hand-rolled toFixed(2) would get wrong for yen and friends. Returns the symbol
  // SEPARATELY from the digits: at the balance's 40px Playfair, a currency glyph set
  // in the same face swamps the number — worse for the currencies Intl renders as a
  // three-letter code ("CHF", "NGN"). The caller sets the symbol in the UI font at a
  // smaller size (see .wallet-fiat-sym / .pinned-fiat-sym).
  function fmtFiatParts(value, currency) {
    try {
      const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency }).formatToParts(value);
      const sym = parts.filter((p) => p.type === 'currency').map((p) => p.value).join('');
      // Trim the space Intl inserts after code-style symbols — the CSS gap spaces them.
      const num = parts.filter((p) => p.type !== 'currency').map((p) => p.value).join('').trim();
      return { sym, num };
    } catch (_) {
      return { sym: currency || '', num: value.toFixed(2) }; // unknown code — still show something
    }
  }

  // Cached BTC price, shaped like balanceCache so the staleness check reads the same.
  let priceCache = { currency: null, price: null, ts: 0 };
  const PRICE_TTL = 5 * 60000; // 5 min — a balance display doesn't need tick-by-tick

  // Currencies mempool.space quotes directly — one keyless call, no rate limit, and
  // bitcoin-native. Anything else falls through to Coinbase's keyless spot endpoint.
  // CoinGecko is deliberately NOT used: its free tier 429s after a handful of calls,
  // which showed up as the fiat display silently reverting to sats mid-session.
  const MEMPOOL_FIATS = new Set(['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY']);

  async function fetchPriceMempool(cur) {
    const r = await fetch('https://mempool.space/api/v1/prices');
    if (!r.ok) throw new Error('mempool ' + r.status);
    const j = await r.json();
    const p = j && j[cur];
    if (typeof p !== 'number') throw new Error('mempool has no ' + cur);
    return p;
  }

  async function fetchPriceCoinbase(cur) {
    const r = await fetch('https://api.coinbase.com/v2/prices/BTC-' + encodeURIComponent(cur) + '/spot');
    if (!r.ok) throw new Error('coinbase ' + r.status);
    const j = await r.json();
    const p = j && j.data && parseFloat(j.data.amount);
    if (!isFinite(p)) throw new Error('coinbase has no ' + cur);
    return p;
  }

  // Resolve a BTC price, trying the best source for this currency then the other.
  // Returns null only when both fail AND nothing is cached — callers treat null as
  // "can't convert" and keep showing sats rather than a guessed number.
  async function getBtcPrice(currency) {
    const cur = (currency || 'USD').toUpperCase();
    if (priceCache.currency === cur && priceCache.price != null && Date.now() - priceCache.ts < PRICE_TTL) {
      return priceCache.price;
    }
    const sources = MEMPOOL_FIATS.has(cur)
      ? [fetchPriceMempool, fetchPriceCoinbase]
      : [fetchPriceCoinbase, fetchPriceMempool];
    for (const src of sources) {
      try {
        const p = await src(cur);
        priceCache = { currency: cur, price: p, ts: Date.now() };
        return p;
      } catch (_) { /* try the next source */ }
    }
    // Serve a stale price over showing nothing; null means "couldn't convert".
    return priceCache.currency === cur ? priceCache.price : null;
  }

  // ---- 24h price history (the chart on the wallet balance card) ----
  // Coinbase only runs BTC candle markets for a handful of quote currencies (USD, EUR,
  // GBP, INR — not JPY, CHF, NGN…). Rather than showing a chart for four currencies and
  // nothing for the rest, always pull the BTC-USD series and scale it by
  // spot(target) / lastUsdClose. The shape of the day is what the chart conveys, and it
  // ends exactly on the spot price the balance is showing — verified to land within a
  // unit across JPY/CHF/NGN/KRW.
  // Ranges the chart offers, in display order.
  const PRICE_RANGES = [
    { key: '24h', label: '24H' },
    { key: '7d', label: '7D' },
    { key: '30d', label: '30D' },
    { key: '1y', label: '1Y' },
    { key: 'all', label: 'ALL' },
  ];
  const RANGE_SECONDS = {
    '24h': 24 * 3600,
    '7d': 7 * 24 * 3600,
    '30d': 30 * 24 * 3600,
    '1y': 365 * 24 * 3600,
    all: null, // everything upstream has
  };

  let historyCache = { currency: null, points: null, ts: 0 };
  const HISTORY_TTL = 10 * 60000;

  // Full BTC history from mempool.space — already a Sidecar price source, so no new
  // third party. One response covers every range beyond 24h, so switching ranges
  // after the first load costs nothing. It IS about a megabyte, which is why 24h
  // stays on Coinbase candles below: that's the default view and the one most
  // people only ever look at.
  let rawHistoryCache = { usd: null, times: null, ts: 0 };
  const RAW_HISTORY_TTL = 10 * 60000;

  async function getRawHistory() {
    if (rawHistoryCache.usd && Date.now() - rawHistoryCache.ts < RAW_HISTORY_TTL) return rawHistoryCache;
    const r = await fetch('https://mempool.space/api/v1/historical-price?currency=USD', {
      signal: AbortSignal.timeout(15000), // large payload; generous, but never hang the panel
    });
    if (!r.ok) throw new Error('history ' + r.status);
    const j = await r.json();
    if (!Array.isArray(j.prices)) throw new Error('history malformed');
    // Upstream is newest-first. Keep time and price together through the filter so a
    // bad row can't shift the axis, and require time > 0 so an absurd timestamp
    // can't stretch the whole span.
    const rows = j.prices
      .map((p) => ({ t: Number(p.time) * 1000, v: Number(p.USD) }))
      .filter((p) => isFinite(p.t) && p.t > 0 && isFinite(p.v) && p.v > 0)
      .sort((a, b) => a.t - b.t);
    if (rows.length < 2) throw new Error('history too short');
    rawHistoryCache = { usd: rows.map((p) => p.v), times: rows.map((p) => p.t), ts: Date.now() };
    return rawHistoryCache;
  }

  // Longer ranges: slice the full series to the window, then scale USD → target the
  // same way the 24h path does. Deliberately NOT the response's own exchangeRates —
  // those cover six currencies and Sidecar offers sixteen, so nine would silently
  // fail. Scaling by present-day spot is also the honest reading: this is a USD
  // history shown in another unit, not a historical FX series.
  async function getRangeHistory(cur, range) {
    const raw = await getRawHistory();
    const secs = RANGE_SECONDS[range];
    const latest = raw.times[raw.times.length - 1];
    let from = 0;
    if (secs != null) {
      const cutoff = latest - secs * 1000;
      from = raw.times.findIndex((t) => t >= cutoff);
      if (from < 0) from = 0;
    }
    let values = raw.usd.slice(from);
    let times = raw.times.slice(from);
    // Too thin to draw — fall back to everything rather than rendering an error.
    if (values.length < 2) { values = raw.usd.slice(); times = raw.times.slice(); }
    if (cur !== 'USD') {
      const spot = await getBtcPrice(cur);
      if (spot == null) throw new Error('no spot for ' + cur);
      const k = spot / values[values.length - 1];
      values = values.map((v) => v * k);
    }
    return { values, times };
  }

  async function getPriceHistory(currency, range) {
    const cur = (currency || 'USD').toUpperCase();
    const rng = RANGE_SECONDS[range] !== undefined ? range : '24h';
    const cacheKey = cur + '|' + rng;
    if (historyCache.currency === cacheKey && historyCache.points && Date.now() - historyCache.ts < HISTORY_TTL) {
      return historyCache.points;
    }
    if (rng !== '24h') {
      try {
        const points = await getRangeHistory(cur, rng);
        historyCache = { currency: cacheKey, points, ts: Date.now() };
        return points;
      } catch (_) {
        return null; // a stale 24h series would be mislabeled under another range
      }
    }
    try {
      const end = new Date();
      const start = new Date(Date.now() - 24 * 3600 * 1000);
      const url = 'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900' +
        '&start=' + encodeURIComponent(start.toISOString()) +
        '&end=' + encodeURIComponent(end.toISOString());
      const r = await fetch(url);
      if (!r.ok) throw new Error('candles ' + r.status);
      const raw = await r.json();
      if (!Array.isArray(raw) || raw.length < 2) throw new Error('no candles');
      // [time, low, high, open, close, volume], newest-first from the API.
      const rows = raw.slice().sort((a, b) => a[0] - b[0]);
      // Keep each close paired with its own candle time. Filtering the values
      // alone would decouple them from the rows, so one bad close would shift
      // every later timestamp by a slot and the hover label would read the wrong
      // time. Candle times are unix SECONDS; store milliseconds.
      const kept = rows.filter((c) => isFinite(Number(c[4])) && Number(c[4]) > 0);
      if (kept.length < 2) throw new Error('no closes');
      const usd = kept.map((c) => Number(c[4]));
      const times = kept.map((c) => Number(c[0]) * 1000);
      let values = usd;
      if (cur !== 'USD') {
        const spot = await getBtcPrice(cur);
        if (spot == null) throw new Error('no spot for ' + cur);
        const k = spot / usd[usd.length - 1];
        values = usd.map((v) => v * k);
      }
      const points = { values, times };
      historyCache = { currency: cacheKey, points, ts: Date.now() };
      return points;
    } catch (_) {
      return historyCache.currency === cacheKey ? historyCache.points : null;
    }
  }

  // Thin a series down to what the chart can actually show, preserving the envelope.
  //
  // ALL arrives as ~32k points drawn into 300 viewBox units — measured, only ~1,400
  // land on distinct x positions, so ~96% overplot and the path string runs to
  // 379 KB. Bucketing by x and keeping each bucket's min AND max (in the order they
  // occurred) keeps every spike and trough that's visible at this width while
  // cutting the path to a few KB. Dropping to one point per bucket would flatten
  // real volatility, which on a price chart is the whole signal.
  //
  // Returns { values, times } unchanged when the series is already small enough.
  function decimateSeries(values, times, buckets) {
    const n = values.length;
    if (n <= buckets * 2) return { values, times };
    const tFirst = times[0], tSpan = times[n - 1] - tFirst;
    if (!(tSpan > 0)) return { values, times };
    const outV = [], outT = [];
    let bStart = 0;
    let bIndex = 0;
    for (let i = 0; i <= n; i++) {
      const b = i < n ? Math.min(buckets - 1, Math.floor(((times[i] - tFirst) / tSpan) * buckets)) : -1;
      if (i === n || b !== bIndex) {
        // Flush [bStart, i): emit the bucket's extremes in chronological order.
        let loI = bStart, hiI = bStart;
        for (let k = bStart + 1; k < i; k++) {
          if (values[k] < values[loI]) loI = k;
          if (values[k] > values[hiI]) hiI = k;
        }
        const a = Math.min(loI, hiI), z = Math.max(loI, hiI);
        outV.push(values[a]); outT.push(times[a]);
        if (z !== a) { outV.push(values[z]); outT.push(times[z]); }
        if (i === n) break;
        bStart = i;
        bIndex = b;
      }
    }
    // Always land on the true last point — it's the one the balance is showing.
    if (outT[outT.length - 1] !== times[n - 1]) { outV.push(values[n - 1]); outT.push(times[n - 1]); }
    return { values: outV, times: outT };
  }

  // Currency formatter that doesn't collapse sub-unit values to zero. Bitcoin's
  // early history is cents, so ALL's low is $0.05 and Intl's default 2-decimal
  // currency style renders the low/high readout as "$0 – $126,073".
  function fmtChartPrice(v, currency) {
    if (v > 0 && v < 1) {
      try {
        const parts = new Intl.NumberFormat('en-US', {
          style: 'currency', currency, minimumSignificantDigits: 1, maximumSignificantDigits: 2,
        }).formatToParts(v);
        const sym = parts.filter((p) => p.type === 'currency').map((p) => p.value).join('');
        const num = parts.filter((p) => p.type !== 'currency').map((p) => p.value).join('').trim();
        return sym + num;
      } catch (_) { /* fall through */ }
    }
    const p = fmtFiatParts(v, currency);
    return p.sym + p.num;
  }

  // Nearest index to `target` in a sorted times array. Binary search rather than a
  // scan: ALL runs to ~32k points and this is called on every pointer move.
  function nearestTimeIndex(times, target) {
    let lo = 0, hi = times.length - 1;
    if (hi < 1) return 0;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= target) lo = mid; else hi = mid;
    }
    return target - times[lo] <= times[hi] - target ? lo : hi;
  }

  // Label for a scrubbed point. Shorter ranges want the clock, longer ones the date —
  // "14:32" is meaningless on ALL and "2019" is useless on 24H.
  function fmtScrubTime(ms, range) {
    const d = new Date(ms);
    try {
      if (range === '24h') return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (range === '7d') return d.toLocaleString([], { weekday: 'short', hour: 'numeric' });
      if (range === '30d') return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      if (range === '1y') return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      return d.toLocaleDateString([], { month: 'short', year: 'numeric' });
    } catch (_) { return d.toISOString().slice(0, 10); }
  }

  // Hand-rolled SVG sparkline — no charting library, consistent with the rest of the
  // panel. Gradient fill under a gold stroke, a range selector, and a hover scrub
  // that reads out the price and time under the pointer.
  //
  // `history` is { values, times }; `onRange(key)` is called when a range is picked.
  function buildPriceChart(history, currency, range, onRange) {
    const W = 300, H = 96, PAD_T = 8, PAD_B = 14;
    // One bucket per viewBox unit. Also caps Math.min/max below: spreading 32k
    // arguments with ...series risks a call-stack overflow, quite apart from the
    // 379 KB path string it would build.
    const thin = decimateSeries(history.values, history.times, W);
    const series = thin.values, times = thin.times;
    const min = Math.min(...series), max = Math.max(...series);
    const span = max - min || 1; // flat series would divide by zero
    const tFirst = times[0], tLast = times[times.length - 1];
    const tSpan = tLast - tFirst;
    // x maps from TIME, not index. Upstream resolution is uneven — mempool's early
    // history steps in days while recent points step in hours — so spacing points
    // evenly by index would put 2013 where 2011 belongs on ALL.
    const x = (i) => (tSpan > 0 ? ((times[i] - tFirst) / tSpan) * W : (i / Math.max(1, series.length - 1)) * W);
    const y = (v) => PAD_T + (1 - (v - min) / span) * (H - PAD_T - PAD_B);

    const line = series.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
    const area = line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'wallet-chart-svg');
    // The gradient id is fixed: only one chart is ever on screen at a time.
    svg.innerHTML =
      '<defs><linearGradient id="sc-chart-grad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="var(--gold)" stop-opacity="0.34"/>' +
      '<stop offset="100%" stop-color="var(--gold)" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#sc-chart-grad)"/>' +
      '<path d="' + line + '" fill="none" stroke="var(--gold)" stroke-width="1.6" ' +
      'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>';

    // Scrub marker, appended after the trace so it draws on top. A ring rather than
    // a filled disc: preserveAspectRatio="none" would squash a circle into an
    // ellipse, but a hairline stroke stays round under vector-effect.
    const NS = 'http://www.w3.org/2000/svg';
    const markGroup = document.createElementNS(NS, 'g');
    markGroup.setAttribute('class', 'wallet-chart-mark');
    const markLine = document.createElementNS(NS, 'line');
    markLine.setAttribute('y1', '0');
    markLine.setAttribute('y2', String(H));
    markLine.setAttribute('stroke', 'var(--gold)');
    markLine.setAttribute('stroke-width', '0.75');
    markLine.setAttribute('opacity', '0.5');
    markLine.setAttribute('vector-effect', 'non-scaling-stroke');
    const markDot = document.createElementNS(NS, 'circle');
    markDot.setAttribute('r', '1.6');
    markDot.setAttribute('fill', 'var(--velvet-1)');
    markDot.setAttribute('stroke', 'var(--gold)');
    markDot.setAttribute('stroke-width', '1.5');
    markDot.setAttribute('vector-effect', 'non-scaling-stroke');
    markGroup.append(markLine, markDot);
    svg.append(markGroup);

    const first = series[0], last = series[series.length - 1];
    const pct = first ? ((last - first) / first) * 100 : 0;
    const fmt = (v) => fmtChartPrice(v, currency);

    const wrap = h('div', { className: 'wallet-chart' });

    // Range selector. Spaced text rather than pills — the card already carries
    // enough chrome.
    const rangeRow = h('div', { className: 'wallet-chart-ranges' });
    PRICE_RANGES.forEach(({ key, label }) => {
      const b = h('button', {
        className: 'wallet-chart-range-btn' + (key === range ? ' active' : ''),
        textContent: label,
      });
      b.addEventListener('click', (e) => {
        e.stopPropagation(); // the card itself has a click handler
        if (key !== range && onRange) onRange(key);
      });
      rangeRow.append(b);
    });
    wrap.append(rangeRow);

    const plot = h('div', { className: 'wallet-chart-plot' });
    plot.append(svg);
    const scrub = h('div', { className: 'wallet-chart-scrub' });
    const scrubPrice = h('span', { className: 'wallet-chart-scrub-price' });
    const scrubWhen = h('span', { className: 'wallet-chart-scrub-time' });
    scrub.append(scrubPrice, scrubWhen);
    plot.append(scrub);
    wrap.append(plot);

    // ---- hover scrub ----
    // Fraction across the ELEMENT, not SVG coordinates: under
    // preserveAspectRatio="none" the viewBox is stretched, so clientX has to be
    // measured against the rendered box.
    function moveTo(clientX) {
      const rect = plot.getBoundingClientRect();
      if (rect.width <= 0 || series.length < 2) return;
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const i = tSpan > 0
        ? nearestTimeIndex(times, tFirst + frac * tSpan)
        : Math.round(frac * (series.length - 1));
      const px = x(i), py = y(series[i]);
      markLine.setAttribute('x1', String(px));
      markLine.setAttribute('x2', String(px));
      markDot.setAttribute('cx', String(px));
      markDot.setAttribute('cy', String(py));
      scrubPrice.textContent = fmt(series[i]);
      scrubWhen.textContent = fmtScrubTime(times[i], range);
      // Positioned as a percentage in the DOM so the text renders crisp rather than
      // stretched with the viewBox. Clamped so it can't hang off either edge, and
      // flipped to whichever half the point ISN'T in, so it never covers the trace.
      scrub.style.left = Math.min(85, Math.max(15, (px / W) * 100)) + '%';
      scrub.classList.toggle('low', py < H / 2);
      wrap.classList.add('scrubbing');
    }
    function endScrub() { wrap.classList.remove('scrubbing'); }

    plot.addEventListener('pointermove', (e) => moveTo(e.clientX));
    plot.addEventListener('pointerdown', (e) => moveTo(e.clientX));
    plot.addEventListener('pointerleave', endScrub);
    plot.addEventListener('pointercancel', endScrub);

    wrap.append(
      h('div', { className: 'wallet-chart-meta' }, [
        h('span', {
          className: 'wallet-chart-delta ' + (pct >= 0 ? 'up' : 'down'),
          textContent: (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(2) + '%',
        }),
        h('span', { className: 'wallet-chart-lowhigh', textContent: fmt(min) + ' – ' + fmt(max) }),
        h('span', { className: 'wallet-chart-price', textContent: fmt(last) }),
      ])
    );
    return wrap;
  }

  // Render `sats` in the active denomination. Returns { text, unit, sym } — `sym` is
  // the currency symbol for fiat (empty otherwise), kept out of `text` so callers can
  // set it in a smaller UI font instead of the balance's display face.
  // Fiat with no available rate falls back to sats rather than showing a wrong number.
  // `sats` rides along unformatted so paintBalanceEl can decide whether the figure
  // has actually changed. Keying that on the rendered text instead would count a
  // sats → BTC → fiat toggle as a new balance.
  function denomParts(sats) {
    // Three middots, not an ellipsis: U+2026 is absent from Apogee Telemetry, so in
    // Nixie the '…' silently fell back to another face — small baseline dots in the
    // wrong typeface where the figure should be. periodcentered is in the font, sits
    // at mid height, and reads as three unlit tubes waiting for a number.
    if (sats == null) return { text: '···', unit: 'sats', sym: '', sats: null };
    if (denom === 'btc') return { text: fmtBtc(sats), unit: 'BTC', sym: '', sats };
    if (denom === 'fiat') {
      const p = priceCache.price;
      if (priceCache.currency === fiatCurrency.toUpperCase() && p != null) {
        const { sym, num } = fmtFiatParts((sats / 1e8) * p, fiatCurrency);
        return { text: num, unit: fiatCurrency.toUpperCase(), sym, sats };
      }
      return { text: fmtSats(sats), unit: 'sats', sym: '', sats }; // no rate yet — don't guess
    }
    return { text: fmtSats(sats), unit: 'sats', sym: '', sats };
  }

  // Ragged per-glyph timing, from apogee's digit-cycle.ts. Deterministic and keyed
  // on the glyph's position rather than random: a repaint mid-animation can't
  // re-roll a glyph's beat and restart it, and the pattern is reproducible when
  // tuning it. The two primes give a long-period sequence — no two adjacent glyphs
  // share a beat, so a figure lights raggedly instead of sweeping left to right
  // (which is what the first pass's flat 60ms-per-glyph stagger did).
  //
  // Only Nixie reads these two; a theme whose animation wants an even stagger uses
  // --i and --n instead (see splitGlyphs). Longer than apogee's 620-980ms
  // because Nixie's keyframes carry a longer settle at the end.
  //
  // The delays are then squeezed into a fixed WINDOW, the same clamp the CSS themes
  // apply to their own staggers: without it a figure's arrival got longer the more
  // digits it had, because the last glyph's delay grew with its index. The window is
  // 111ms — the span the raw sequence already covers at four glyphs — so three- and
  // four-glyph figures (and the countdown rings, which are one or two) are untouched
  // and only longer figures compress. Scaling rather than clamping each value keeps
  // the ragged ORDER intact: it is the same pattern played faster, not a different one.
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

  // The figure each balance SURFACE last painted, as raw sats, per account. Two jobs:
  //
  //   1. deciding when a strike is earned. Three of the four repaint paths fire on
  //      a timer or a tab switch, so without this the tubes would re-ignite every
  //      poll — the mistake apogee's balance-warmup.ts exists to avoid.
  //   2. deciding whether to touch the DOM at all (see paintBalanceEl).
  //
  // KEYED BY SLOT, NOT BY ELEMENT, and that is the fix for a real bug rather than a
  // tidy-up. This was a WeakMap on the node, which quietly made "has this figure
  // changed?" mean "is this the same DOM node?" — so every rebuild of the wallet card
  // struck a balance that had not moved. The pinned bar was never affected: its node
  // lives for the life of the panel, so its record always survived.
  //
  // What rebuilds the card is not rare. refreshApproval() calls refresh() as soon as
  // the queue empties, and refresh() re-renders the active tab — so signing anything
  // while sitting on Wallet re-struck the balance. Every wallet modal that closes with
  // renderWallet() (send, receive, budgets, disconnect) did the same.
  //
  // The account is part of the key because switching accounts SHOULD strike: those
  // numerals really are new. Under element keying that came for free, since the switch
  // rebuilt the card; by slot it has to be said out loud, or two accounts holding the
  // same balance would switch between each other in silence.
  const paintedSats = new Map(); // slot -> { pubkey, key }

  // Which of the two balance surfaces an element is. Only these two exist — every
  // paintBalanceEl caller passes #pinned-balance-amt or the card's .wallet-balance.
  function balanceSlot(el) {
    return el.id === 'pinned-balance-amt' ? 'pinned' : 'wallet';
  }

  // Make a surface strike on its next paint whatever it is already showing. Used where
  // the numerals genuinely are arriving for the first time (entering the Wallet tab) or
  // where what they SHOW has changed without the balance changing (masking).
  function forgetBalancePaint(slot) {
    paintedSats.delete(slot);
  }

  // Paint a balance element with an optional smaller-font currency symbol prefix.
  // Uses textContent for the number (never innerHTML — the symbol comes from Intl,
  // but the habit matters in a signer).
  function paintBalanceEl(el, parts, symClass) {
    if (!el) return;
    const key = parts.sats == null ? null : String(parts.sats);
    const slot = balanceSlot(el);
    const pubkey = (state && state.activePubkey) || null;
    const rec = paintedSats.get(slot);
    const prev = rec && rec.pubkey === pubkey ? rec.key : undefined;

    // Already showing exactly this figure? Leave the DOM alone. Refresh paints
    // twice — once from the cache while the card is being built, then again when
    // the fetch returns the same number — and rewriting identical content the
    // second time replaced the striking spans with a plain text node partway
    // through the animation. The figure snapped to full brightness, so a refreshed
    // balance flickered for a fraction of the time a freshly loaded one did.
    //
    // The content is re-read from the DOM rather than trusted from the record,
    // because other code writes these elements directly: the error path sets '—'
    // and the pinned bar sets the '···' placeholder. Without that check, a figure
    // that went to a placeholder and back to the SAME balance would match the
    // record and never be repainted.
    if (prev === key && el.textContent === (parts.sym || '') + parts.text) return;

    // The figure is always split (see splitGlyphs below for the class contract),
    // so a denomination toggle re-deals Cast Iron's dice even when it does not
    // strike: the tap shows the new figure straight away, sitting just as crooked,
    // while the full press run plays only on a genuine balance change — the same
    // contract every theme keeps ("a balance change re-animates; a denomination
    // toggle does not", test/balance-fiat-symbol.test.js). Whether the re-dealt
    // pose shows is a theme-CSS question, not this flag's; that split is what
    // lets both halves hold at once.
    const animate = key != null && prev !== key && !reduceBalanceMotion;
    paintedSats.set(slot, { pubkey, key });

    // ORDER MATTERS HERE. splitGlyphs clears the element before it builds, so the
    // symbol has to go on AFTER the figure, not before it. Appending it first was a
    // silent drop: the span was created and then removed by the very next line, and
    // fiat mode lost its currency glyph entirely.
    //
    // It cost more than the glyph. The early return above compares el.textContent
    // against sym + text, and with the symbol never surviving that could not be true
    // in fiat — so the guard never fired there, and every repaint rebuilt the figure,
    // which is exactly the mid-animation teardown the guard exists to prevent.
    splitGlyphs(el, parts.text, () => animate);
    if (parts.sym) el.prepend(h('span', { className: symClass, textContent: parts.sym }));
  }

  // Build a figure one glyph at a time, so the active theme can style and animate
  // it in its own idiom — a nixie tube striking, a projector flickering, a
  // split-flap board turning over, a comma held in the theme's second color.
  // All of that lives in the theme file; this code stays ignorant of which theme
  // is active and just publishes what it knows about each glyph:
  //
  //   .bal-glyph  every glyph, always.
  //   .bal-sep    the ones that are not digits — the thousands separator, the
  //               decimal point. A theme that wants to treat punctuation
  //               differently cannot ask CSS "is this a comma", so it is said
  //               here.
  //   .bal-alt    every second glyph, counted among GLYPHS. Same reasoning as
  //               .bal-sep: :nth-child(even) would do this until the element gains
  //               a sibling that isn't a glyph, and in fiat it does — the currency
  //               symbol is prepended into the same parent, which shifts every
  //               index by one and silently flips a theme's alternation between
  //               sats and fiat. Bauhaus alternates its drop and rise on this.
  //   .bal-in     only on an arrival that has earned an animation. Splitting and
  //               animating used to be the same decision, which meant any
  //               per-glyph STYLING vanished on a repaint that did not animate —
  //               a denomination toggle, or Reduce motion — and a permanently
  //               colored comma would have flickered in and out of existence.
  //   --i / --n   this glyph's index and the total. Enough for a stagger, a
  //               center-out reveal, or alternating directions.
  //
  //               EVERY THEME'S STAGGER IS A WINDOW, NOT A STEP, and --n is what
  //               makes that expressible:
  //
  //                 calc(var(--i) * min(<step>, <3 x step> / max(var(--n) - 1, 1)))
  //
  //               A flat per-glyph step made a balance take longer to arrive the
  //               more digits it had — 506ms for three glyphs against 734ms for ten
  //               in Populuxe, 1190 against 1867 in Brownstone, which read as the
  //               big number being slower rather than bigger. Clamping the last
  //               glyph to a fixed distance behind the first holds the arrival at
  //               one length. The window is three steps wide so that short figures
  //               keep exactly the timing they had and only long ones compress —
  //               and so the countdown rings, which come through here with one or
  //               two glyphs, are untouched by it.
  //   --strike-delay / --strike-dur  the ragged beat above, which only Nixie
  //               uses. Emitted for every theme because it is two custom
  //               properties, not two DOM nodes.
  //   --iron-rot / --iron-dx / --iron-dy  Cast Iron's strike reads these as the
  //               cant its press lands with, so they are dealt RANDOMLY per glyph
  //               at every split — rotation within +-3deg, slippage within
  //               +-0.035em sideways and +-0.03em of seat height — rather than
  //               derived from --i, which would land the same figure in the same
  //               place forever. Emitted for every theme like the pairs above,
  //               and consumed by none of the others.
  //
  // The balances and the countdown rings share this; the theme rules key off the
  // classes, not off where the figure hangs.
  // The strike dice, dealt wherever they are needed. The limits are tight on
  // purpose — rotation within +-3deg, slippage within +-0.035em sideways, seat
  // height within +-0.03em up or down — enough that no two strikes of the same
  // figure ever land alike (a hand-held stamp is never twice in the same place)
  // without threatening legibility even at 9px. Emitted for every theme; the
  // cast-iron rules are the only consumers.
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

  // ---- hand-stamped display type -------------------------------------------------
  // splitGlyphs strikes the figures; this extends the same deal-every-character-dice
  // contract to the HEADLINES listed below, the short big display-face titles where a
  // hand-set pose reads as intention. Deliberately narrower than cast-iron.css's full
  // struck-type list: navigation subheads (section titles, view headers, row labels)
  // live in tight flex rows where a letter-level pose fights the layout rather than
  // adding to it — tried everywhere first and reverted to just the headlines. In the
  // theme picker only the Cast Iron plate strikes; each neighbor previews its own
  // theme and keeps its own face square. The CSS mask/lip treatment still covers
  // every heading regardless of this list, which is why both sides are kept in sync.
  //
  // Splitting is word-preserving: whitespace stays as real text nodes, so wrapping and
  // justification behave exactly as before, while each printable character becomes one
  // span holding its own dice. Only cast-iron.css reads the custom properties — every
  // other theme inherits identical-looking runs of spans (same emit-for-every-theme
  // precedent as the balance vars above).
  //
  // Delivery is an observer, deliberately: views repaint wholesale through ~80
  // innerHTML sites, and wiring every renderer would be exactly the kind of contract
  // that silently stops being honored by the next feature. Any headline that enters
  // the DOM gets struck whatever produced it. Our own splits are filtered out, so
  // the observer never feeds itself.
  //
  // Accessibility: the original string is mirrored onto aria-label, so a screen reader
  // hears "Wallet", not "W a l l e t" — the pose is presentation only.
  const STAMPED_TYPE_SELECTOR = [
    '.headline',
    '.lud16-sync-title',
    '.profile-name',
    '.unlock-note-title',
    '.notif-modal-title',
    '.welcome-title',
    '.destructive-warn-title',
    '.recv-success-title',
    '.theme-card[data-theme="cast-iron"] .theme-name',
  ].join(',');

  function stampedHasRawText(el) {
    return Array.prototype.some.call(
      el.childNodes,
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()
    );
  }

  function splitStampedType(el) {
    // Already fully struck: the common case on every observer pass (our own spans
    // keep re-entering the record list). An element flagged stamped but carrying
    // fresh raw text was rewritten in place — strike the replacement too.
    if (el.dataset.stamped === '1' && !stampedHasRawText(el)) return;
    const label = el.textContent;
    // Empty labels have nothing to strike, and beyond ~200 characters the pose
    // stops reading as handiwork and starts reading as misprint: leave long hosts
    // square. Both are per-element, so nesting stays safe.
    if (!label || !label.trim() || label.length > 200) return;
    el.dataset.stamped = '1';
    let strung = false;
    const strikeLevel = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          if (!child.textContent.trim()) return; // whitespace is layout, leave it be
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((piece) => {
            if (!piece.trim()) { frag.append(piece); return; }
            for (const ch of Array.from(piece)) {
              strung = true;
              frag.append(h('span', {
                className: 'stamped-glyph',
                textContent: ch,
                style: ironDiceStyle(),
              }));
            }
          });
          child.replaceWith(frag);
        } else if (child.nodeType === Node.ELEMENT_NODE && !/^svg$/i.test(child.tagName)) {
          strikeLevel(child);
        }
      });
      // A struck element that ITSELF lays out as flex or grid would turn every
      // glyph span into an item — with justify-content distributing them across
      // the full row (the settings section titles once rendered letterspaced to
      // oblivion exactly this way). Regroup this level's children into one run
      // wrapper, so the container sees the item count it always did: label run,
      // then whatever structural children (the toggle's chevron) follow.
      const disp = getComputedStyle(node).display;
      if (/flex|grid/.test(disp) && node.children.length > 1) {
        const runs = Array.from(node.childNodes).filter((n) =>
          (n.nodeType === Node.TEXT_NODE && n.textContent.trim())
          || (n.nodeType === Node.ELEMENT_NODE && !/^svg$/i.test(n.tagName)));
        if (runs.length > 1 || (runs.length === 1 && runs[0].nodeType === Node.TEXT_NODE)) {
          const wrap = document.createElement('span');
          wrap.className = 'stamped-run';
          node.insertBefore(wrap, runs[0]);
          runs.forEach((n) => wrap.appendChild(n));
        }
      }
    };
    strikeLevel(el);
    if (strung) el.setAttribute('aria-label', label.trim().replace(/\s+/g, ' '));
  }

  function initStampedType() {
    const sweep = (rootEl) => {
      if (!rootEl || rootEl.nodeType !== Node.ELEMENT_NODE || !rootEl.matches) return;
      if (rootEl.matches(STAMPED_TYPE_SELECTOR)) splitStampedType(rootEl);
      if (rootEl.querySelectorAll) {
        rootEl.querySelectorAll(STAMPED_TYPE_SELECTOR).forEach(splitStampedType);
      }
    };
    sweep(document.body);
    let queued = false;
    const mo = new MutationObserver((records) => {
      if (queued) return;
      const foreign = records.some((r) => Array.prototype.some.call(
        r.addedNodes,
        (n) => n.nodeType === Node.ELEMENT_NODE
          && !(n.classList && n.classList.contains('stamped-glyph'))
          && !(n.closest && n.closest('[data-stamped="1"]'))
      ));
      if (!foreign) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        sweep(document.body);
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // Paint a countdown ring's number in the theme's hand, with the same arrival
  // animation the balance gets on the digits that CHANGE as it counts — a tube
  // re-strikes when what it displays changes, and a countdown is the one place in
  // the panel where that happens every second. Only the digits that actually
  // moved strike ("15" → "14" re-lights the 4, not the 1), compared right-aligned
  // so units line up with units when the figure loses a digit; the first paint
  // on a fresh element strikes everything, because the number is arriving.
  // Reduce motion (settings) keeps the figure plain, and the OS-level
  // prefers-reduced-motion overrides in each theme file are the second gate.
  function paintCountdownNum(el, n) {
    const text = String(Math.max(n, 0));
    const fresh = !el.querySelector('.bal-glyph');
    const prev = el.textContent;
    const off = prev.length - text.length;
    splitGlyphs(el, text, (i) =>
      !reduceBalanceMotion && (fresh || prev.charAt(off + i) !== text.charAt(i)));
  }

  // Force both balance surfaces to strike on their next paint, whatever figure they
  // are already showing. Hiding or revealing balances changes what the tube
  // DISPLAYS without changing the balance, and a tube re-strikes on any change of
  // what it shows — so the guard that suppresses a repeat of the same number gets
  // cleared deliberately here rather than loosened for everyone.
  function restrikeBalances() {
    forgetBalancePaint('pinned');
    forgetBalancePaint('wallet');
    repaintBalances();
  }

  // Advance the cycle, persist nothing (it's a view preference, not a setting), warm
  // the price if we're landing on fiat, then repaint both balance surfaces.
  //
  // If no rate can be had, skip the fiat leg entirely rather than landing on a step
  // that silently renders as sats — otherwise the tap looks like it did nothing, and
  // the display looks identical to the step before it. Says so once, out loud.
  async function cycleDenom() {
    const next = DENOM_ORDER[(DENOM_ORDER.indexOf(denom) + 1) % DENOM_ORDER.length];
    if (next === 'fiat') {
      const p = await getBtcPrice(fiatCurrency);
      if (p == null) {
        toast("Couldn't reach a price source — showing sats", 'error');
        denom = 'sats';
        repaintBalances();
        return;
      }
    }
    denom = next;
    repaintBalances();
  }

  // Apply a currency change from either picker: persist it, drop the now-wrong
  // cached rate (it's per-currency), refetch if fiat is showing, repaint, and keep
  // the other picker in sync — same shape as syncPinControls/syncHideControls.
  async function setFiatCurrency(code) {
    fiatCurrency = code || 'USD';
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { fiatCurrency } });
    priceCache = { currency: null, price: null, ts: 0 };
    historyCache = { currency: null, points: null, ts: 0 };
    // Force the open chart (if any) to redraw in the new currency on next open.
    const slot = document.querySelector('.wallet-chart-slot');
    if (slot) { delete slot.dataset.currency; slot.innerHTML = ''; }
    const openCard = document.querySelector('.wallet-card.chart-open');
    if (openCard) openCard.classList.remove('chart-open');
    const cb = document.querySelector('.wallet-chart-btn.active');
    if (cb) cb.classList.remove('active');
    if (denom === 'fiat') await getBtcPrice(fiatCurrency);
    const s = $('fiat-select');
    if (s) s.value = fiatCurrency;
    const w = $('wallet-fiat-select');
    if (w) w.value = fiatCurrency;
    repaintBalances();
  }

  // The wallet screen's copy of the currency preference — same setting as Settings,
  // placed here because this is where you are when you tap the balance.
  function renderFiatPicker() {
    const wrap = h('div', { className: 'setting' });
    wrap.append(h('h3', { textContent: 'Local currency' }));
    wrap.append(h('p', {
      className: 'hint',
      textContent: 'Tap your balance to switch between sats, BTC, and this currency.',
    }));
    const sel = h('select', { id: 'wallet-fiat-select' });
    FIAT_CURRENCIES.forEach(([code, name]) => {
      sel.append(h('option', { value: code, textContent: name + ' (' + code + ')' }));
    });
    sel.value = fiatCurrency;
    sel.addEventListener('change', (e) => setFiatCurrency(e.target.value));
    wrap.append(sel);
    return wrap;
  }

  // Is the wallet card's unit line currently showing a failure instead of a unit?
  // A repaint must not overwrite it with 'sats' — that would claim a balance loaded
  // when none did. Kept as one predicate because there are several such strings now
  // (#120 added the relay-specific one) and comparing against a single literal is
  // how the previous guard quietly stopped covering all of them.
  const BALANCE_ERROR_UNITS = ['balance unavailable', 'wallet relay unreachable'];
  const isBalanceErrorUnit = (s) => BALANCE_ERROR_UNITS.includes(String(s || '').trim());

  // Repaint whichever balance surfaces are on screen, from the cached balance.
  function repaintBalances() {
    const sats = balanceCache && balanceCache.pubkey === (state && state.activePubkey) ? balanceCache.sats : null;
    const parts = denomParts(sats);
    paintBalanceEl($('pinned-balance-amt'), parts, 'pinned-fiat-sym');
    paintBalanceEl(document.querySelector('.wallet-balance'), parts, 'wallet-fiat-sym');
    const cardUnit = document.querySelector('.wallet-unit');
    if (cardUnit && !isBalanceErrorUnit(cardUnit.textContent)) cardUnit.textContent = parts.unit;
  }

  // Optional pinned balance bar — compact balance + Send/Receive under the nav,
  // on every tab except Wallet (which has the full display). Only renders when
  // the setting is on, an account is active, and a wallet is connected. Paints
  // the shared balanceCache instantly, then fetches fresh if it's empty or stale
  // (>60s) for this account.
  async function renderPinnedBalanceBar() {
    const bar = $('pinned-balance');
    if (!bar) return;
    if (!pinBalanceBar || !state || !state.activePubkey) { hide(bar); return; }
    let has = false;
    try { has = !!(await call({ type: 'SIDECAR_HAS_NWC' })).has; } catch (_) {}
    if (!has) { hide(bar); return; } // no wallet for this account — Wallet tab owns onboarding
    show(bar);
    const hideBtn = $('pinned-hide');
    if (hideBtn) { hideBtn.innerHTML = ''; hideBtn.appendChild(icon(hideBalances ? 'eye-off' : 'eye')); hideBtn.title = hideBalances ? 'Show balances' : 'Hide balances'; }
    const amt = $('pinned-balance-amt');
    if (!amt) return;
    // Tap the amount to cycle sats → BTC → fiat. Bound once (renderPinnedBalanceBar
    // runs on every tab switch), hence onclick rather than addEventListener.
    amt.onclick = cycleDenom;
    amt.title = 'Tap to change units';
    const cached = balanceCache && balanceCache.pubkey === state.activePubkey && balanceCache.sats != null;
    if (cached) paintBalanceEl(amt, denomParts(balanceCache.sats), 'pinned-fiat-sym');
    else amt.textContent = '···';
    const stale = !cached || !balanceCache.ts || Date.now() - balanceCache.ts > 60000;
    if (stale) {
      try {
        const client = await ensureNwc();
        if (client) {
          const b = await client.getBalance();
          balanceCache = { pubkey: state.activePubkey, sats: msatToSat(b && b.balance), ts: Date.now() };
          paintBalanceEl(amt, denomParts(balanceCache.sats), 'pinned-fiat-sym');
        }
      } catch (_) {}
    }
  }

  // Keep the three pin affordances (settings checkbox, wallet-card pin icon, the
  // bar itself) in sync after any of them toggles pinBalanceBar.
  function syncPinControls() {
    const cb = $('pinbalance-toggle');
    if (cb) cb.checked = pinBalanceBar;
    const wt = $('tab-wallet');
    if (wt) wt.classList.toggle('wallet-pinned', pinBalanceBar); // hide/show the wallet's own balance card
    renderPinnedBalanceBar();
  }

  // Keep the two hide-balances affordances (bar eye + wallet-card eye) in sync.
  function syncHideControls() {
    applyHideBalances();
    // Both ends of the toggle are a change point for the tube: the discs re-strike
    // from CSS as their ::after is created (themes/nixie.css), and the figure needs
    // its paint record cleared or the reveal would repaint the same number and
    // suppress the strike. Harmless in the other five themes, which never strike.
    restrikeBalances();
    const setEye = (btn) => { if (!btn) return; btn.innerHTML = ''; btn.appendChild(icon(hideBalances ? 'eye-off' : 'eye')); btn.title = hideBalances ? 'Show balances' : 'Hide balances'; };
    setEye($('pinned-hide'));
    document.querySelectorAll('.wallet-eye').forEach(setEye);
    const cb = $('hidebalance-toggle');
    if (cb) cb.checked = hideBalancesPref; // the row tracks the PREFERENCE, not the peek
    syncPeekRow();
  }

  // The expiry switch only means something while there is something to reveal, and with
  // hiding off nothing is ever masked — the eye's own mask route turns the preference on,
  // so "not hiding" and "something masked" cannot both be true. Left disabled rather than
  // removed, and its stored answer left alone, so turning hiding back on restores the
  // choice instead of quietly resetting it.
  function syncPeekRow() {
    const peek = $('balancepeek-toggle');
    if (peek) peek.disabled = !hideBalancesPref;
  }

  // Reduce motion already suppresses the bolt, so leaving this switch live would be a
  // control that does nothing when you flip it — the shape of #208. Disabled and
  // explained instead, the same way the peek row follows the switch above it.
  function syncFlashRow() {
    const flash = $('zapflash-toggle');
    if (!flash) return;
    flash.disabled = reduceBalanceMotion;
    flash.title = reduceBalanceMotion ? 'Reduce motion is on, which already turns this off.' : '';
  }

  // ---- the peek ------------------------------------------------------------------
  // A revealed balance closes itself. Nothing counts down on screen — a ticking number
  // beside a figure reads as part of the figure, and this is the one place in the app
  // where a countdown would sit against live digits — so the snap back is announced
  // afterwards by a toast, which is also the only thing that says the panel did it
  // rather than you. Same 30 seconds the secret reveal uses (NSEC_REVEAL_TIMEOUT_S),
  // which does show its countdown, because there the number IS the secret.
  const BALANCE_PEEK_MS = 30000;

  function beginBalancePeek() {
    if (_balancePeekTimer) clearTimeout(_balancePeekTimer);
    hideBalances = false;
    syncHideControls();
    _balancePeekTimer = setTimeout(() => {
      _balancePeekTimer = null;
      hideBalances = true;
      syncHideControls();
      toast('Balances hidden again');
    }, BALANCE_PEEK_MS);
  }

  // Ending a peek early is silent: the user asked for it, so there is nothing to report.
  function endBalancePeek() {
    if (_balancePeekTimer) { clearTimeout(_balancePeekTimer); _balancePeekTimer = null; }
    hideBalances = hideBalancesPref;
    syncHideControls();
  }

  async function setHideBalancesPref(v) {
    if (_balancePeekTimer) { clearTimeout(_balancePeekTimer); _balancePeekTimer = null; }
    hideBalancesPref = v;
    hideBalances = v;
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { hideBalances: v } });
    syncHideControls();
  }

  // Both eyes — the wallet card's and the pinned bar's — are this.
  //
  // Revealing is the only branch autoHideBalances changes, and it is worth being exact
  // about why. Off, a reveal is a decision and is written down like one. On, a reveal is
  // a glance: it must NOT be written down, or the expiry would have to write the user's
  // real choice back over itself half a minute later.
  //
  // Masking is durable either way, because masking MORE is never the unsafe direction to
  // take without asking. Ending a peek early is the one masking route that writes
  // nothing, and it does not need to: the preference already says masked.
  async function onBalanceEye() {
    if (hideBalances) {
      if (autoHideBalances) beginBalancePeek();
      else await setHideBalancesPref(false);
      return;
    }
    if (_balancePeekTimer) { endBalancePeek(); return; }
    await setHideBalancesPref(true);
  }

  // Lightning address for receiving. Some NWC connection strings embed a `lud16`
  // (the wallet's own address) — prefer that, then fall back to the account's
  // profile lud16. Returns null when neither is present.
  function parseNwcLud16(connection) {
    try {
      const q = connection.split('?')[1];
      if (!q) return null;
      const v = new URLSearchParams(q).get('lud16');
      return v && v.includes('@') ? v.trim() : null;
    } catch (_) { return null; }
  }
  // Primal's wallet is Spark-based and only works inside Primal's own apps, over their
  // own nostrconnect session — the NWC string it hands out (routed through a primal.net
  // relay) can't be driven as a standalone NWC wallet, so a getInfo round-trip just
  // hangs. Detect it from the relay host and reject up front with a clear reason.
  function isPrimalNwc(connection) {
    try {
      const q = connection.split('?')[1];
      if (!q) return false;
      return new URLSearchParams(q).getAll('relay').some((r) => {
        let host;
        try { host = new URL(r).hostname; } catch (_) { host = String(r); }
        return /(^|\.)primal\.net$/i.test(host);
      });
    } catch (_) { return false; }
  }
  // A ws:// relay in an NWC string means every wallet command and response —
  // including pay requests — crosses that hop in cleartext. Legitimate for a wallet
  // on localhost or behind Tor, so warn in the console rather than reject.
  function warnIfInsecureNwcRelay(connection) {
    try {
      const q = connection.split('?')[1];
      if (!q) return;
      if (new URLSearchParams(q).getAll('relay').some((r) => String(r).trim().startsWith('ws://'))) {
        console.warn('Sidecar: this NWC connection uses an unencrypted ws:// relay — wallet commands will cross that hop in cleartext.');
      }
    } catch (_) {}
  }
  async function getLightningAddress() {
    try {
      const { lud16 } = await call({ type: 'SIDECAR_NWC_META' });
      if (lud16) return lud16;
    } catch (_) {}
    try {
      const { content } = await fetchActiveProfile();
      if (content && content.lud16) return content.lud16;
    } catch (_) {}
    return null;
  }

  // Shared sats cap + a numeric-only, capped amount input used by send/receive/zap.
  const MAX_SATS = 100000000; // 100M
  function satsInput(placeholder) {
    const el = h('input', { type: 'text', inputMode: 'numeric', placeholder: placeholder });
    el.addEventListener('input', () => {
      let v = el.value.replace(/[^0-9]/g, '');
      if (v) v = String(Math.min(parseInt(v, 10), MAX_SATS));
      el.value = v;
    });
    return el;
  }
  const isLnInvoice = (v) => /^ln(bc|tb)[0-9]/i.test(v);
  const isLnAddress = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

  // Amount encoded in a BOLT11's human-readable part, in sats. Mirrors invoiceSats()
  // in background.js — the panel pays invoices the user pasted, so it needs to read
  // the amount for its own confirmation, and this is pure string math (no decode).
  // Returns null for an amountless invoice, which is a valid thing to be handed.
  function bolt11Sats(bolt11) {
    if (!bolt11) return null;
    // The amount must be followed by a multiplier or the '1' separator. Without that
    // anchor, an AMOUNTLESS invoice ("lnbc1p3x…") matches its own separator as the
    // digits and reports 0 sats — i.e. it would claim "Sent 0 sats" for an invoice
    // whose amount we don't actually know.
    const m = /^ln(?:bc|tb|bcrt)(\d+)([munp])?1/i.exec(String(bolt11).replace(/^lightning:/i, '').trim());
    if (!m || !m[1]) return null;
    const FACTOR = { m: 1e5, u: 1e2, n: 1e-1, p: 1e-4, '': 1e8 };
    const sats = Math.round(Number(m[1]) * FACTOR[(m[2] || '').toLowerCase()]);
    return sats > 0 ? sats : null;
  }

  // ---- Live balance updates (NIP-47 notifications + fallback polling) ----

  // Fetch the current balance, update the cache, and refresh visible displays.
  // Called when a payment notification arrives or the poll timer fires.
  async function refreshWalletBalance() {
    if (!state || state.locked) return;
    try {
      const client = await ensureNwc();
      if (!client || state.locked) return; // state may have changed during await
      const b = await client.getBalance();
      if (state.locked) return; // re-check after network call
      const prevSats = balanceCache ? balanceCache.sats : null;
      const newSats = msatToSat(b && b.balance);
      const changed = !balanceCache || balanceCache.sats !== newSats;
      balanceCache = { pubkey: state.activePubkey, sats: newSats, ts: Date.now() };
      if (changed) {
        // Paint in the active denomination, so a live update doesn't silently snap
        // the display back to sats while the user is reading BTC or fiat.
        const parts = denomParts(newSats);
        // Update pinned bar in place
        const pinAmt = $('pinned-balance-amt');
        paintBalanceEl(pinAmt, parts, 'pinned-fiat-sym');
        // Update wallet card balance in place (avoid full re-render)
        const cardBal = document.querySelector('.wallet-balance');
        if (cardBal) { cardBal.classList.remove('loading'); paintBalanceEl(cardBal, parts, 'wallet-fiat-sym'); }
        const cardUnit = document.querySelector('.wallet-unit');
        if (cardUnit && !isBalanceErrorUnit(cardUnit.textContent)) cardUnit.textContent = parts.unit;
        // Glow pulse when balance increases
        if (prevSats != null && newSats > prevSats) {
          [pinAmt, cardBal].forEach((el) => {
            if (!el) return;
            el.classList.remove('balance-bump');
            void el.offsetWidth; // force reflow to restart animation
            el.classList.add('balance-bump');
            setTimeout(() => el.classList.remove('balance-bump'), 5000);
          });
        }
      }
    } catch (_) {}
  }

  function stopWalletMonitor() {
    if (nwcNotifSub) { try { nwcNotifSub.close(); } catch (_) {} nwcNotifSub = null; }
    if (nwcPollTimer) { clearInterval(nwcPollTimer); nwcPollTimer = null; }
  }

  function startWalletMonitor(client) {
    stopWalletMonitor();
    // Push: listen for NIP-47 kind:23196 payment notifications.
    nwcNotifSub = client.subscribeNotifications((payload) => {
      if (!state || state.locked) return;
      const type = payload && payload.notification_type;
      if (type === 'payment_received' || type === 'payment_sent') {
        refreshWalletBalance();
        if (type === 'payment_received') {
          const amt = payload.notification && payload.notification.amount;
          if (amt) toast('Received ' + fmtSats(msatToSat(amt)) + ' sats', 'success');
          else toast('Payment received', 'success');
        }
      }
    });
    // Fallback: poll every 30s for wallets that don't send notifications.
    nwcPollTimer = setInterval(() => {
      if (state && !state.locked) refreshWalletBalance();
    }, 30000);
  }

  // Build (or reuse) the NWC client for the active account from its stored string.
  // Keyed on the CONNECTION, not just the account. Swapping wallets within one
  // account (Restore, or connecting a different string) leaves activePubkey
  // unchanged, so an account-only key handed back a client still talking to the
  // previous wallet: the balance and history came from the wallet you just replaced.
  // Disconnect happened to nulls the client by hand, which is why removing and
  // re-importing the same string "fixed" it.
  //
  // Reading the connection every call costs a message round-trip, but it can't go
  // stale. The alternative — having each write broadcast an invalidation — is the
  // shape that produced this bug: Disconnect remembered to reset, Restore didn't.
  async function ensureNwc() {
    const pk = state.activePubkey;
    const { connection } = await call({ type: 'SIDECAR_GET_NWC' });
    if (nwc && nwcPubkey === pk && nwcConn === connection) return nwc;
    stopWalletMonitor();
    if (nwc) { try { nwc.close(); } catch (_) {} nwc = null; nwcPubkey = null; nwcConn = null; }
    // A balance for the old wallet must not survive into the new one — it's keyed by
    // account, so nothing else would notice it's now the wrong number.
    if (balanceCache && balanceCache.pubkey === pk) balanceCache = { pubkey: null, sats: null };
    if (!connection) return null;
    nwc = window.SidecarNWC.makeClient(connection);
    nwcPubkey = pk;
    nwcConn = connection;
    startWalletMonitor(nwc);
    return nwc;
  }

  let walletRenderSeq = 0;
  // Which account the wallet view currently on screen was built for, or null when the
  // view is the connect screen rather than a wallet. Read by refresh() to decide whether
  // a rebuild is actually needed — see the keepWallet note there.
  let walletRenderedFor = null;
  // Set by loadTransactions so the walletChanged handler can prepend new entries
  // without tearing the whole view down. Null when the wallet view isn't mounted.
  let _refreshTxList = null;

  // Prepend any transactions not already in the list, without clearing it.
  // Called from the walletChanged handler so a zap doesn't make the history blink.
  function refreshTransactionList() {
    if (_refreshTxList) _refreshTxList();
  }

  async function renderWallet() {
    const view = $('wallet-view');
    const seq = ++walletRenderSeq;
    if (!state.activePubkey) {
      view.innerHTML = '';
      view.append(h('p', { className: 'hint', textContent: 'No active account.' }));
      return;
    }
    // A DELAYED placeholder, not an immediate one. renderWallet runs often — a tab
    // switch, a zap landing, a manual refresh — and painting a spinner on every one
    // would flash on the fast path, which is nearly all of them. 400ms is long enough
    // that a normal render never shows it, short enough that a stalled one stops looking
    // like a dead panel.
    //
    // Something has to be painted before the first await at all, which is the other half
    // of #224: everything above here only handles the no-account case, so on a fresh
    // panel a hung await left the tab exactly as it found it — empty, with no spinner and
    // no error to say why.
    const slow = setTimeout(() => {
      if (seq !== walletRenderSeq) return;
      view.innerHTML = '';
      view.append(h('p', { className: 'hint', textContent: 'Loading wallet…' }));
    }, 400);

    let has;
    try {
      ({ has } = await call({ type: 'SIDECAR_HAS_NWC' }));
    } catch (e) {
      if (seq !== walletRenderSeq) return;
      walletLoadFailed(view, e);
      return;
    } finally {
      clearTimeout(slow);
    }

    // Bail if another renderWallet() started during the await — otherwise both
    // would clear + append a card, leaving two overlapping sticky cards.
    if (seq !== walletRenderSeq) return;
    _refreshTxList = null; // previous view's transaction refresh callback is stale
    view.innerHTML = '';
    walletRenderedFor = has ? state.activePubkey : null;
    if (!has) {
      renderWalletConnect(view);
      return;
    }
    // Guarded for the same reason: it is async and not awaited, so anything it throws
    // would abort the render as an unhandled rejection and leave the tab blank — the
    // exact symptom, reached by a different road.
    try {
      const p = renderWalletConnected(view);
      if (p && typeof p.catch === 'function') {
        p.catch((e) => { if (seq === walletRenderSeq) walletLoadFailed(view, e); });
      }
    } catch (e) {
      walletLoadFailed(view, e);
    }
  }

  // The tab must never be blank and silent. Whatever went wrong, say so and offer the
  // one action that helps — the old behavior offered neither, so the only recovery
  // anyone found was switching accounts and back.
  function walletLoadFailed(view, e) {
    view.innerHTML = '';
    view.append(
      h('p', {
        className: 'hint',
        textContent: (e && e.message) || 'Could not load your wallet.',
      })
    );
    const retry = h('button', { className: 'secondary', textContent: 'Try again' });
    retry.addEventListener('click', () => {
      forgetBalancePaint('wallet');
      renderWallet();
    });
    view.append(h('div', { className: 'actions' }, [retry]));
  }

  // ---- Rizful quick start ----------------------------------------------------
  //
  // The hard part of connecting a wallet isn't pasting the string — it's that a user
  // with no Lightning wallet has to go find one first. Rizful publishes a token
  // exchange for exactly this: the user signs up, copies a short one-time code, and
  // we trade it for a standard NWC connection string. Same flow Jumble uses.
  //
  // Nothing about Sidecar's architecture changes: what comes back is an ordinary
  // `nostr+walletconnect://` URI that goes through the same SIDECAR_SET_NWC path as a
  // hand-pasted one. This is purely a friendlier way to obtain it.
  //
  // Rizful is CUSTODIAL — they hold the funds. That's stated plainly in the UI rather
  // than buried, because Sidecar's whole position is that it never holds your money,
  // and offering a one-tap wallet shouldn't quietly blur that.
  const RIZFUL_ORIGIN = 'https://rizful.com';
  const RIZFUL_SIGNUP_URL = RIZFUL_ORIGIN + '/create-account';
  const RIZFUL_GET_CODE_URL = RIZFUL_ORIGIN + '/nostr_onboarding_auth_token/get_token';
  const RIZFUL_EXCHANGE_URL = RIZFUL_ORIGIN + '/nostr_onboarding_auth_token/post_for_secrets';

  // Trade a one-time code for an NWC string. Returns { nwcUri, lightningAddress }.
  //
  // The response is treated as untrusted: a `nwc_uri` that isn't actually an NWC URI
  // is rejected rather than handed to SIDECAR_SET_NWC, so a compromised or confused
  // endpoint can't get an arbitrary string stored as the user's wallet.
  async function rizfulExchangeCode(code, pubkey) {
    const res = await fetch(RIZFUL_EXCHANGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit', // never attach cookies to a token exchange
      body: JSON.stringify({ secret_code: String(code).trim(), nostr_public_key: pubkey }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch (_) {}
      throw new Error(detail || 'Rizful rejected that code (' + res.status + ').');
    }
    let data;
    try { data = await res.json(); } catch (_) { throw new Error('Rizful sent a response Sidecar could not read.'); }
    const nwcUri = data && typeof data.nwc_uri === 'string' ? data.nwc_uri.trim() : '';
    if (!nwcUri.startsWith('nostr+walletconnect://')) {
      throw new Error('Rizful did not return a wallet connection.');
    }
    warnIfInsecureNwcRelay(nwcUri);
    const addr = data && typeof data.lightning_address === 'string' ? data.lightning_address.trim() : '';
    return { nwcUri, lightningAddress: addr && addr.includes('@') ? addr : parseNwcLud16(nwcUri) };
  }

  function rizfulQuickStartModal() {
    openModal((modal) => {
      const err = h('div', { className: 'error' });
      const code = h('input', {
        type: 'text', className: 'rizful-code', spellcheck: false, autocomplete: 'off',
        placeholder: 'Paste your one-time code',
      });
      const go = h('button', { className: 'primary', textContent: 'Connect wallet' });

      go.addEventListener('click', async () => {
        const value = code.value.trim();
        if (!value) return (err.textContent = 'Paste the code from Rizful.');
        err.textContent = '';
        go.disabled = true;
        go.textContent = 'Connecting…';
        try {
          const { nwcUri, lightningAddress } = await rizfulExchangeCode(value, state.activePubkey);
          // Prove it works before storing it — same check the paste path makes.
          const client = window.SidecarNWC.makeClient(nwcUri);
          await client.getInfo();
          client.close();
          await call({ type: 'SIDECAR_SET_NWC', connection: nwcUri });
          closeModal();
          toast(lightningAddress ? 'Wallet connected — ' + lightningAddress : 'Wallet connected', 'success');
          // The Profile screen's existing lud16 prompt picks it up from here and
          // offers to publish the address, which is what makes zaps reachable.
          renderWallet();
        } catch (e) {
          err.textContent = (e && e.message) || 'Could not connect that wallet.';
          go.disabled = false;
          go.textContent = 'Connect wallet';
        }
      });
      code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });

      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);

      // Two buttons, in order, then the field.
      //
      // These were briefly one button ("Get a code from Rizful") with signup as a
      // quiet link underneath. That was wrong: a user without an account clicks the
      // big button, gets redirected to Rizful's signup, finishes it, and is then
      // nowhere near a code — so they have to come back and click the same button
      // again to actually get one. One control silently doing two different things on
      // two clicks is exactly the confusion that caused.
      //
      // Signup is a real button now, sized like the other, so the two trips to Rizful
      // are visible up front. Anyone who already has an account just skips the first.
      // Still no step numbers — top-to-bottom order carries the sequence.
      const signup = h('button', {
        className: 'secondary rizful-get', textContent: 'Create a Rizful account',
      });
      signup.addEventListener('click', () => chrome.tabs.create({ url: RIZFUL_SIGNUP_URL }));

      const getCode = h('button', {
        className: 'secondary rizful-get', textContent: 'Get your one-time code',
      });
      getCode.addEventListener('click', () => chrome.tabs.create({ url: RIZFUL_GET_CODE_URL }));

      // Custody still gets said plainly, but as a closing note rather than a wall the
      // user has to read past. "Hosted" is in the line above, which is the word that
      // actually carries the warning.
      const note = h('p', { className: 'rizful-note' });
      note.append(document.createTextNode('Run by '));
      const megalith = h('a', { href: '#', className: 'explore-link inline', textContent: 'Megalith' });
      megalith.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: 'https://megalithic.me/' });
      });
      note.append(
        megalith,
        document.createTextNode('. They hold the funds, not Sidecar — you can switch to a self-custodial wallet later.')
      );

      const actions = h('div', { className: 'actions setup-actions' }, [cancel, go]);

      modal.append(
        h('h3', { textContent: 'Start with Rizful' }),
        h('p', { className: 'rizful-lede', textContent: 'A hosted Lightning wallet, ready in about a minute.' }),
        signup,
        getCode,
        code,
        err,
        actions,
        note
      );
      setTimeout(() => code.focus(), 50);
    });
  }

  function renderWalletConnect(view) {
    view.append(h('h2', { textContent: 'Wallet' }));

    view.append(
      h('p', {
        className: 'hint',
        textContent:
          'Paste a Nostr Wallet Connect (NWC) connection string from Alby Hub, Rizful, YakiHonne, or other NWC-capable wallets. Sidecar never holds your funds.',
      })
    );
    const input = h('textarea', { className: 'compose-text nwc-input', placeholder: 'nostr+walletconnect://…' });
    const err = h('div', { className: 'error' });
    // Primal's string isn't a mistake — it's well-formed, just fundamentally
    // incompatible — so it gets its own calm, non-error styling rather than the
    // red validation-error tone above, plus a way straight to a working wallet.
    const primalNotice = h('p', { className: 'hint wallet-notice hidden' });
    primalNotice.append(
      h('strong', { textContent: "Primal's NWC connection only works inside Primal's own apps " }),
      document.createTextNode("— it doesn't support external apps like Sidecar."),
      document.createElement('br')
    );
    const primalLink = h('a', { href: '#', className: 'explore-link', textContent: 'More Lightning wallet options →' });
    primalLink.addEventListener('click', (e) => {
      e.preventDefault();
      openExtensionPage('wallets.html');
    });
    primalNotice.append(primalLink);
    const connect = h('button', { className: 'primary wallet-connect-btn', textContent: 'Connect wallet' });
    connect.addEventListener('click', async () => {
      const conn = input.value.trim();
      primalNotice.classList.add('hidden');
      if (!conn) return (err.textContent = 'Paste a connection string.');
      if (!conn.startsWith('nostr+walletconnect://')) return (err.textContent = "That doesn't look like an NWC string.");
      warnIfInsecureNwcRelay(conn);
      if (isPrimalNwc(conn)) {
        err.textContent = '';
        primalNotice.classList.remove('hidden');
        return;
      }
      err.textContent = '';
      connect.disabled = true;
      connect.textContent = 'Connecting…';
      try {
        // Validate by parsing + a getInfo round-trip before saving.
        const client = window.SidecarNWC.makeClient(conn);
        await client.getInfo();
        client.close();
        await call({ type: 'SIDECAR_SET_NWC', connection: conn });
        toast('Wallet connected', 'success');
        renderWallet();
      } catch (e) {
        err.textContent = e.message || 'Could not reach that wallet.';
        toast('Could not connect wallet', 'error');
        connect.disabled = false;
        connect.textContent = 'Connect wallet';
      }
    });
    view.append(input, err, primalNotice, connect);

    // Restore a previously backed-up connection from the user's relays. Kept in
    // its own block (with its own status line) so its messages don't land in the
    // middle of the connect form.
    const restoreBlock = h('div', { className: 'wallet-restore-block' });
    restoreBlock.append(h('div', { className: 'wallet-or', textContent: 'or' }));
    const restore = h('button', { className: 'secondary', textContent: 'Restore from Nostr' });
    const restoreNote = h('p', { className: 'hint compact', textContent: 'Restore a wallet you backed up to your relays.' });
    restore.addEventListener('click', async () => {
      restore.disabled = true;
      restore.textContent = 'Checking relays…';
      try {
        await restoreNwcFromRelays();
        toast('Wallet restored', 'success');
        renderWallet();
      } catch (e) {
        toast(e.message, 'error');
        restore.disabled = false;
        restore.textContent = 'Restore from Nostr';
      }
    });
    restoreBlock.append(restore, restoreNote);
    view.append(restoreBlock);

    // Quick start comes AFTER connect and restore, not before. Someone who already
    // has a wallet — which is most people opening this screen deliberately — should
    // reach their own path first and not have to scroll past an onboarding pitch. It
    // sits last because it reads onward into the suggestions link below it.
    // The divider goes OUTSIDE the card — .wallet-quickstart has its own border and
    // background, and a rule inside it reads as a stray line rather than a separator.
    view.append(h('div', { className: 'wallet-or quickstart-or', textContent: 'or' }));
    const quick = h('div', { className: 'wallet-quickstart' });
    quick.append(h('div', { className: 'wallet-quickstart-title', textContent: 'New to Lightning?' }));
    quick.append(h('p', {
      className: 'hint compact',
      textContent: 'Set up a hosted wallet with Rizful in about a minute, and start receiving zaps.',
    }));
    // Rizful carries the recommended tint — it's the one-minute path for someone
    // with no wallet at all. The directory link sits in the same card as a
    // co-equal second choice rather than a footnote below it, so "I'd rather pick
    // my own" is visible at the same moment as "just set one up for me".
    const quickBtn = h('button', { className: 'secondary wallet-quickstart-primary', textContent: 'Quick start with Rizful' });
    quickBtn.addEventListener('click', rizfulQuickStartModal);
    quick.append(quickBtn);
    const browseBtn = h('button', { className: 'secondary wallet-quickstart-browse', textContent: 'Browse all wallets' });
    browseBtn.addEventListener('click', () => openExtensionPage('wallets.html'));
    quick.append(browseBtn);
    view.append(quick);
  }

  async function renderWalletConnected(view) {
    // When the balance bar is pinned, hide this screen's own big balance card —
    // the pinned bar already shows it (avoids a double display).
    $('tab-wallet').classList.toggle('wallet-pinned', pinBalanceBar);
    // ...and since the card is now hidden, make sure the bar is actually showing
    // the balance. This is the choke point for a freshly connected/restored
    // wallet, and SIDECAR_SET_NWC doesn't broadcast walletChanged, so without
    // this the bar stays hidden (nothing was connected when it last rendered) —
    // leaving the balance invisible on the Wallet screen until a tab switch.
    if (pinBalanceBar) renderPinnedBalanceBar();
    // Balance card — show the last-known balance instantly, refresh below.
    const cached = balanceCache.pubkey === state.activePubkey && balanceCache.sats != null;
    // Sentinel above the card; its visibility (not scrollTop) drives the collapse.
    const sentinel = h('div', { className: 'wallet-sentinel' });
    view.append(sentinel);
    const card = h('div', { className: 'wallet-card' });
    // When collapsed, tapping the card (outside its buttons) scrolls back to top.
    card.addEventListener('click', (e) => {
      if (card.classList.contains('compact') && !e.target.closest('button')) {
        document.querySelector('.content').scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    const bal = h('div', {
      className: 'wallet-balance' + (cached ? '' : ' loading'),
      textContent: '···',
      title: 'Tap to change units',
    });
    if (cached) paintBalanceEl(bal, denomParts(balanceCache.sats), 'wallet-fiat-sym');
    // Tap the number to cycle sats → BTC → fiat. stopPropagation so it doesn't also
    // trigger the card's scroll-to-top handler while the card is collapsed.
    bal.addEventListener('click', (e) => { e.stopPropagation(); cycleDenom(); });
    const unit = h('div', { className: 'wallet-unit', textContent: denomParts(cached ? balanceCache.sats : null).unit });
    const refresh = h('button', { className: 'wallet-refresh', title: 'Refresh' });
    refresh.appendChild(icon('refresh'));
    // Refresh is a deliberate ask, so it strikes whatever comes back — including the
    // same figure, which is the answer most refreshes give and the only feedback that
    // the button did anything. Without this the slot record survives the rebuild and
    // the card silently redraws (#248 keyed the record by slot; before that every
    // rebuild minted a new node and struck by accident).
    refresh.addEventListener('click', () => { forgetBalancePaint('wallet'); renderWallet(); });
    // Privacy toggle on the balance card (masks balance, history, budgets).
    const eye = h('button', { className: 'wallet-eye', title: hideBalances ? 'Show balances' : 'Hide balances' });
    eye.appendChild(icon(hideBalances ? 'eye-off' : 'eye'));
    eye.addEventListener('click', onBalanceEye);
    // Pin the balance bar from the card's corner. Only reachable while the bar is
    // unpinned (the card hides once pinned), so this is a one-way "pin" affordance.
    const pin = h('button', { className: 'wallet-pin', title: 'Pin balance bar' });
    pin.appendChild(icon('pin'));
    pin.addEventListener('click', async () => {
      pinBalanceBar = true;
      await call({ type: 'SIDECAR_SET_SETTINGS', settings: { pinBalanceBar: true } });
      syncPinControls();
    });
    // Price chart toggle, bottom-left corner (mirroring the pin at bottom-right).
    // Expands the card to reveal a 24h BTC price chart in the chosen currency.
    // Wallet screen only — the pinned bar stays compact by design.
    const chartBtn = h('button', { className: 'wallet-chart-btn', title: 'Bitcoin price, last 24 hours' });
    chartBtn.appendChild(icon('chart'));
    const chartSlot = h('div', { className: 'wallet-chart-slot' });
    // Opening/closing the chart changes the card's expanded height, so the collapse
    // observer's delta has to be recomputed — after the max-height transition ends,
    // or we'd measure mid-animation.
    const remeasureAfterToggle = () => {
      setTimeout(() => { if (remeasureWalletCard) remeasureWalletCard(); }, 280);
    };
    // Selected range persists while the panel is open, so reopening the chart or
    // switching currency keeps whatever the user last looked at.
    let chartRange = '24h';
    let chartSeq = 0; // a slow fetch must not paint over a newer selection

    async function paintChart() {
      const seq = ++chartSeq;
      chartSlot.innerHTML = '';
      chartSlot.append(h('div', { className: 'wallet-chart-loading', textContent: 'Loading…' }));
      const history = await getPriceHistory(fiatCurrency, chartRange);
      if (seq !== chartSeq) return; // a newer range was picked while this was in flight
      chartSlot.innerHTML = '';
      if (!history) {
        // Leave the slot open with an explanation rather than silently collapsing.
        chartSlot.append(h('div', { className: 'wallet-chart-loading', textContent: 'Price history unavailable' }));
        chartSlot.dataset.currency = '';
        remeasureAfterToggle();
        return;
      }
      chartSlot.dataset.currency = fiatCurrency;
      chartSlot.dataset.range = chartRange;
      chartSlot.append(buildPriceChart(history, fiatCurrency, chartRange, (key) => {
        chartRange = key;
        paintChart();
      }));
      remeasureAfterToggle();
    }

    chartBtn.addEventListener('click', async (e) => {
      e.stopPropagation(); // don't trigger the card's scroll-to-top handler
      const open = card.classList.toggle('chart-open');
      chartBtn.classList.toggle('active', open);
      if (!open) { remeasureAfterToggle(); return; }
      // Already showing this currency and range — nothing to refetch.
      if (chartSlot.dataset.currency === fiatCurrency && chartSlot.dataset.range === chartRange) {
        remeasureAfterToggle();
        return;
      }
      await paintChart();
    });
    card.append(eye, refresh, h('div', { className: 'wallet-bal-label', textContent: 'Balance' }), bal, unit, chartSlot, chartBtn, pin);
    view.append(card);

    // Actions
    const actions = h('div', { className: 'wallet-actions' });
    const sendBtn = h('button', { className: 'primary' }, [icon('arrow-up-right'), h('span', { textContent: 'Send' })]);
    const recvBtn = h('button', { className: 'secondary' }, [icon('arrow-down-left'), h('span', { textContent: 'Receive' })]);
    sendBtn.addEventListener('click', () => sendModal());
    recvBtn.addEventListener('click', () => receiveModal());
    actions.append(sendBtn, recvBtn);
    view.append(actions);

    // Backup nudge. The Backup card is far below the transaction list, so after
    // connecting a wallet nothing on the first screen says it isn't saved — and a
    // stale backup used to read as "Backed up" down there. One line, dismissible:
    // some people deliberately never put a connection string on relays.
    const backupState = nwcBackupState();
    let nudgeStateName = 'unknown';
    const nudge = h('p', { className: 'hint wallet-notice wallet-backup-nudge hidden' });
    const nudgeText = h('span', { textContent: '' });
    const nudgeBtn = h('button', { className: 'explore-link', textContent: 'Back up' });
    const doNudgeBackup = async () => {
      nudgeBtn.disabled = true;
      try {
        await backupNwcToRelays();
        toast('Wallet backed up', 'success');
        renderWallet();
      } catch (e) {
        toast(e.message, 'error');
        nudgeBtn.disabled = false;
      }
    };
    nudgeBtn.addEventListener('click', () => {
      // Same guard as the Backup card: from here the nudge only ever shows for
      // 'none' or 'stale', so this asks exactly when a stored wallet is at risk.
      if (nudgeStateName === 'stale') {
        confirmOverwriteNwcBackup('stale', doNudgeBackup);
        return;
      }
      doNudgeBackup();
    });
    const nudgeX = h('button', { className: 'wallet-nudge-x', textContent: '×', title: 'Dismiss' });
    nudgeX.addEventListener('click', () => {
      // Per account, and only for this session — renderWallet() runs often enough
      // that a render-scoped dismissal would reappear immediately, but a permanent
      // opt-out isn't right either for "your wallet isn't saved anywhere".
      nwcNudgeDismissed = state.activePubkey;
      hide(nudge);
    });
    nudge.append(nudgeText, ' ', nudgeBtn, nudgeX);
    view.append(nudge);
    backupState.then((r) => {
      const s = (r && r.state) || 'unknown';
      if (s !== 'none' && s !== 'stale') return;
      if (nwcNudgeDismissed === state.activePubkey) return;
      nudgeStateName = s;
      nudgeText.textContent = s === 'stale'
        ? 'Your backup is a different wallet.'
        : "This wallet isn't backed up.";
      nudge.classList.remove('hidden');
    }).catch(() => {});

    // Lightning address card (only if one is available). Shows the copyable
    // address with a QR icon that toggles a scannable QR inline.
    const addrCard = h('div', { className: 'setting address-card hidden' });
    view.append(addrCard);
    getLightningAddress().then((lud16) => {
      if (!lud16) return;
      const row = h('div', { className: 'address-row' });
      const addr = h('button', { className: 'address-value', title: 'Copy address' }, [
        boltIcon(), h('span', { textContent: lud16 }),
      ]);
      addr.addEventListener('click', async () => {
        try {
          await copyPlain(lud16);
          const s = addr.querySelector('span');
          const prev = s.textContent;
          s.textContent = 'Copied ✓';
          setTimeout(() => (s.textContent = prev), 1200);
        } catch (_) {}
      });
      const qrToggle = h('button', { className: 'address-qr-toggle', title: 'Show QR code' });
      qrToggle.appendChild(icon('qr'));
      const qrBox = h('div', { className: 'address-qr hidden' });
      let built = false;
      qrToggle.addEventListener('click', () => {
        if (!built) {
          built = true;
          const canvas = document.createElement('canvas');
          canvas.className = 'recv-qr';
          try { window.SidecarQR.draw(canvas, 'lightning:' + lud16, 200, 'M'); } catch (_) {}
          qrBox.append(canvas);
        }
        const showing = qrBox.classList.toggle('hidden');
        qrToggle.classList.toggle('active', !showing);
      });
      row.append(addr, qrToggle);
      addrCard.append(h('h3', { textContent: 'Lightning address' }), row, qrBox);
      addrCard.classList.remove('hidden');
    });

    // Transactions
    const txWrap = h('div', { className: 'setting' });
    txWrap.append(h('h3', { textContent: 'Recent transactions' }));
    const txList = h('div', { className: 'list flat' });
    txWrap.append(txList);
    view.append(txWrap);

    // Backup to relays (detection mirrors zap.cooking)
    view.append(renderWalletBackup(backupState));

    // Per-site WebLN spending budgets
    view.append(renderSitePayments());

    // Local currency — the same preference as Settings, surfaced here because this
    // is where you're looking when you tap the balance and want a different currency.
    view.append(renderFiatPicker());

    // Disconnect
    const disc = h('button', { className: 'ghost wallet-disconnect', textContent: 'Disconnect wallet' });
    disc.addEventListener('click', () => disconnectModal());
    view.append(disc);

    // Self-custody disclaimer (bottom of the wallet screen).
    view.append(
      h('p', { className: 'wallet-disclaimer' }, [
        h('strong', { textContent: 'IMPORTANT: ' }),
        document.createTextNode(
          'Sidecar never holds user funds. You manage your own wallet and are responsible for securing it properly.'
        ),
      ])
    );

    // Bottom spacer that absorbs the card's collapse delta so the page height
    // stays constant when the balance card compacts (prevents scroll flicker).
    // The collapse observer is attached later, once content has loaded — see below.
    const spacer = h('div', { className: 'wallet-spacer' });
    view.append(spacer);

    // Load data
    let client = null;
    try { client = await ensureNwc(); } catch (_) {}
    if (!client) { view.innerHTML = ''; renderWalletConnect(view); return; }
    try {
      const b = await client.getBalance();
      balanceCache = { pubkey: state.activePubkey, sats: msatToSat(b && b.balance), ts: Date.now() };
      const parts = denomParts(balanceCache.sats);
      paintBalanceEl(bal, parts, 'wallet-fiat-sym');
      unit.textContent = parts.unit;
    } catch (e) {
      if (!cached) {
        bal.textContent = '—';
        // Name the cause when the client could work it out (#120): a relay that's
        // down reads as a Sidecar failure otherwise. Kept short — this sits under
        // the balance in a narrow panel; the full sentence goes in the toast.
        unit.textContent = e && e.relayDown
          ? 'wallet relay unreachable'
          : e && e.staleSocket
            ? 'connection lost — retry'
            : 'balance unavailable';
        if (e && (e.relayDown || e.walletSilent || e.staleSocket)) toast(e.message, 'error');
      }
    }
    bal.classList.remove('loading');
    // Attach the collapse observer only after the balance and transactions have
    // loaded — while content is still resizing, an active observer would cross the
    // collapse trigger repeatedly and flicker (worst on the loading "…" state).
    await loadTransactions(txList, client);
    observeWalletCard(card, sentinel, spacer);
  }

  // Centered placeholder for list cards (loading / empty / error) so the text
  // sits in the middle of the card instead of jammed in the top-left corner.
  function listState(listEl, text) {
    listEl.innerHTML = '';
    listEl.append(h('p', { className: 'list-state', textContent: text }));
  }

  // Locally-recorded payment metadata (counterparty/comment/fee), keyed by the
  // BOLT11 invoice. NWC's list_transactions doesn't carry who we paid, so for
  // lightning-address sends we stash the address here and match it back by
  // invoice when rendering history. Capped to the most recent entries. Encrypted
  // at rest via the background's secret store (audit M5/S1) — counterparties and
  // user-typed comments are no one else's business, including anyone holding the
  // profile on disk.
  function getPayMeta() {
    return call({ type: 'SIDECAR_SECRET_GET', store: 'paymeta' })
      .then((m) => m || {})
      .catch(() => ({}));
  }
  async function savePayMeta(invoice, meta) {
    if (!invoice) return;
    try {
      const all = (await getPayMeta()) || {};
      all[invoice] = Object.assign({}, all[invoice], meta, { ts: Date.now() });
      const keys = Object.keys(all);
      if (keys.length > 300) {
        keys
          .sort((a, b) => (all[a].ts || 0) - (all[b].ts || 0))
          .slice(0, keys.length - 300)
          .forEach((k) => delete all[k]);
      }
      await call({ type: 'SIDECAR_SECRET_SET', store: 'paymeta', value: all });
    } catch (_) {}
  }

  const satsLabel = (n) => fmtSats(n) + (Math.round(n) === 1 ? ' sat' : ' sats');
  // fees_paid is in msats; show it rounded to the nearest whole sat.
  function fmtFeeMsat(msat) {
    return msat == null ? null : satsLabel(Math.round(msat / 1000));
  }
  function truncMid(s, head, tail) {
    s = String(s || '');
    head = head || 10; tail = tail || 8;
    return s.length > head + tail + 1 ? s.slice(0, head) + '…' + s.slice(-tail) : s;
  }

  async function loadTransactions(listEl, client) {
    const PAGE = 15;
    let offset = 0;
    let loading = false;
    const metaMap = await getPayMeta();
    const host = listEl.parentNode; // append the "Show more" button below the card
    const more = h('button', { className: 'ghost show-more-btn' });
    hide(more);
    more.textContent = 'Show more';
    if (host) host.append(more);

    listState(listEl, 'Loading…');

    async function loadPage() {
      if (loading) return;
      loading = true;
      try {
        const res = await client.listTransactions({ limit: PAGE, offset, unpaid: false });
        const txns = (res && res.transactions) || [];
        if (offset === 0) {
          if (!txns.length) { listState(listEl, 'No transactions yet.'); hide(more); return; }
          listEl.innerHTML = '';
        }
        txns.forEach((tx) => listEl.append(txRow(tx, metaMap)));
        offset += txns.length;
        // A full page back suggests there may be more to fetch.
        if (txns.length >= PAGE) { show(more); more.textContent = 'Show more'; }
        else hide(more);
      } catch (e) {
        if (offset === 0) listState(listEl, 'Could not load transactions.');
        hide(more);
      } finally {
        loading = false;
      }
    }

    // Prepend any transactions that aren't already in the list, without clearing it.
    // Keyed on payment_hash (unique per payment) so a re-fetch after a zap adds only
    // the new entry — the existing rows stay in place, no flash.
    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const res = await client.listTransactions({ limit: PAGE, offset: 0, unpaid: false });
        const txns = (res && res.transactions) || [];
        const existing = new Set(
          [...listEl.querySelectorAll('.tx-row[data-ph]')].map((el) => el.dataset.ph)
        );
        // Find new entries in reverse so prepend lands them newest-first.
        const fresh = txns.filter((tx) => tx.payment_hash && !existing.has(tx.payment_hash));
        if (fresh.length) {
          // If the list was showing "No transactions yet.", clear that placeholder.
          const placeholder = listEl.querySelector('.list-state');
          if (placeholder) placeholder.remove();
          const freshMeta = await getPayMeta();
          fresh.reverse().forEach((tx) => listEl.prepend(txRow(tx, freshMeta)));
          show(more);
          more.textContent = 'Show more';
        }
      } catch (_) {
        // Best-effort — a failed refresh is silent (the next full renderWallet picks
        // everything up). Don't clear the list or show an error.
      } finally {
        loading = false;
      }
    }

    more.addEventListener('click', () => { more.textContent = 'Loading…'; loadPage(); });
    _refreshTxList = refresh;
    loadPage();
  }

  // A ZAP'S DESCRIPTION IS A WHOLE NOSTR EVENT. NIP-57 has the wallet store the kind 9734
  // zap request verbatim in the invoice description, so tx.description arrives as a
  // stringified event object rather than as anything a human wrote. Pulled apart here so
  // the wallet can say who zapped and what they said instead of printing the JSON (#243).
  //
  // Returns null for everything else, including the text/plain array shape some wallets
  // send — that stays normalizeDescription's job. Kept pure and DOM-free so it can be
  // lifted into a vm the way normalizeDescription already is.
  function parseZapRequest(desc) {
    if (desc == null) return null;
    let ev = desc;
    if (typeof ev === 'string') {
      // A cheap reject before the parse: descriptions are mostly short human strings and
      // JSON.parse on every transaction's note is wasted work.
      const t = ev.trim();
      if (t.charAt(0) !== '{') return null;
      try { ev = JSON.parse(t); } catch (_) { return null; }
    }
    // Wallets that put the event in `metadata` hand it over already parsed, so an object
    // is as valid an input here as a string.
    if (!ev || typeof ev !== 'object' || ev.kind !== 9734) return null;
    const tags = Array.isArray(ev.tags) ? ev.tags : [];
    const tag = (name) => {
      const hit = tags.find((x) => Array.isArray(x) && x[0] === name && x[1]);
      return hit ? String(hit[1]) : '';
    };
    return {
      // The zapper. On an incoming zap this is who sent it; on one you sent it is you,
      // and the interesting party is the p tag instead.
      pubkey: typeof ev.pubkey === 'string' ? ev.pubkey : '',
      recipient: tag('p'),
      eventId: tag('e'),
      content: typeof ev.content === 'string' ? ev.content.trim() : '',
    };
  }

  // WHERE THE ZAP REQUEST ACTUALLY LIVES VARIES BY WALLET, which is the whole reason this
  // is a search rather than a field read. NIP-57 says the 9734 goes in the invoice
  // description, and some wallets do exactly that; NIP-47 also allows a `metadata` object
  // on a transaction, and others put it there under `nostr` or `zap_request`. A third
  // group sends only the comment the zapper typed and keeps the event to itself — for
  // those there is no pubkey anywhere in the payload and no name can be shown, which is a
  // limit of the wallet rather than something to work around.
  function zapFromTx(tx) {
    if (!tx) return null;
    const m = tx.metadata;
    const candidates = [tx.description, m, m && m.nostr, m && m.zap_request, m && m.zapRequest];
    for (const c of candidates) {
      const zap = parseZapRequest(c);
      if (zap) return zap;
    }
    return null;
  }

  function normalizeDescription(desc) {
    if (desc == null) return '';
    let val = desc;
    if (typeof val === 'string') {
      // A zap request reduces to whatever the zapper actually typed, which is usually an
      // emoji, sometimes a sentence, and often nothing. Empty is correct and lets the
      // caller fall back rather than printing an event.
      const zap = parseZapRequest(val);
      if (zap) return zap.content;
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) val = parsed;
        else return val;
      } catch (_) { return val; }
    }
    if (Array.isArray(val)) {
      const plain = val.find((t) => Array.isArray(t) && t[0] === 'text/plain');
      return plain ? String(plain[1] || '') : '';
    }
    return String(val);
  }

  function txDetailRow(label, value, copyValue, prose) {
    if (value == null || value === '') return null;
    const val = h('span', { className: 'tx-d-val' + (prose ? ' prose' : ''), textContent: String(value) });
    if (copyValue) {
      val.classList.add('copyable');
      val.title = 'Copy';
      val.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await copyPlain(String(copyValue));
          const old = val.textContent;
          val.textContent = 'Copied';
          val.classList.add('copied');
          setTimeout(() => { val.textContent = old; val.classList.remove('copied'); }, 1000);
        } catch (_) {}
      });
    }
    return h('div', { className: 'tx-d-row' }, [
      h('span', { className: 'tx-d-label', textContent: label }),
      val,
    ]);
  }

  // "Zap from alice" once the profile lands, "Zap from npub1abcd…wxyz" until it does, and
  // just "Zap" when the event carried no usable key. Never the raw hex, which is 64
  // characters of noise in a 328px row.
  function zapLabel(incoming, pubkey, rec) {
    const verb = incoming ? 'Zap from ' : 'Zap to ';
    if (rec && rec.name) return verb + rec.name;
    if (!pubkey) return 'Zap';
    let npub = '';
    try { npub = NT.nip19.npubEncode(pubkey); } catch (_) { return 'Zap'; }
    return verb + npub.slice(0, 10) + '…' + npub.slice(-4);
  }

  // Swap the direction arrow for the zapper's face, keeping the arrow as a corner badge.
  // Called twice per zap — once from the cache so a warm list draws faces immediately,
  // once when the fetch lands — so it has to be idempotent and cheap. No picture means no
  // swap: the plain arrow disc is a better row than a wall of identical placeholders.
  function showZapFace(iconEl, incoming, rec) {
    if (!iconEl || !rec || !rec.picture) return;
    if (iconEl.dataset.face === rec.picture) return;
    iconEl.dataset.face = rec.picture;
    iconEl.innerHTML = '';
    iconEl.classList.add('has-av');
    applyAvatar(iconEl, rec);
    const dir = h('span', { className: 'tx-dir' });
    dir.append(icon(incoming ? 'arrow-down' : 'arrow-up'));
    iconEl.append(dir);
  }

  function txRow(tx, metaMap) {
    const incoming = tx.type === 'incoming';
    const sats = msatToSat(tx.amount);
    const meta = (metaMap && tx.invoice && metaMap[tx.invoice]) || {};
    const counterparty = incoming ? '' : meta.address || '';

    const row = h('div', { className: 'item tx-row' });
    if (tx.payment_hash) row.dataset.ph = tx.payment_hash;
    const ic = h('span', { className: 'tx-icon ' + (incoming ? 'in' : 'out') });
    ic.append(icon(incoming ? 'arrow-down' : 'arrow-up'));
    // A zap names the other party in the description itself, which nothing else here does
    // — so it gets its own label rather than the generic Received/Sent. The party that
    // matters flips with direction: on one you received, it is whoever zapped you; on one
    // you sent, you are the zapper and the p tag is the recipient.
    const zap = zapFromTx(tx);
    // A SENT ZAP CARRIES NOTHING TO PARSE. NIP-57 step 6 has the lnurl server issue a
    // description_hash invoice — the request is committed to, never carried — so
    // zapFromTx finds nothing on anything we paid, and an outgoing zap used to render as
    // a bare "Sent" or a lightning address. Sidecar signed that request seconds before
    // the payment, so the background records who it was for; that is the only place the
    // recipient exists on this side (#253).
    // Only ever consulted for outgoing: an incoming zap has the real event to read, and
    // payMeta is keyed by an invoice we paid.
    const zapParty = zap ? (incoming ? zap.pubkey : zap.recipient) : (!incoming && meta.zapPubkey) || '';
    // Either source makes it a zap. Note this is the recorded pubkey, so a zap sent from
    // another client and paid by the same wallet still reads as a plain payment — there
    // is nothing on it that says otherwise.
    const isZap = !!zap || !!zapParty;
    const labelEl = h('div', { className: 'item-label' });
    if (isZap) {
      // The name may not be cached yet, and a wallet list must not wait on a relay to
      // render. Show the short key immediately and let the fetch upgrade it in place,
      // which is the same two-step the note mentions use.
      labelEl.textContent = zapLabel(incoming, zapParty, cachedProfile(zapParty));
      showZapFace(ic, incoming, cachedProfile(zapParty));
      if (zapParty) {
        getProfile(zapParty)
          .then((rec) => {
            if (!rec) return;
            if (rec.name) labelEl.textContent = zapLabel(incoming, zapParty, rec);
            showZapFace(ic, incoming, rec);
          })
          .catch(() => {});
      }
    } else {
      labelEl.textContent = counterparty || normalizeDescription(tx.description) || (incoming ? 'Received' : 'Sent');
    }
    const main = h('div', { className: 'item-main' }, [
      labelEl,
      h('div', { className: 'item-sub', textContent: tx.settled_at ? relTime(tx.settled_at * 1000) : 'pending' }),
    ]);
    const amt = h('div', { className: 'tx-amt ' + (incoming ? 'in' : 'out'), textContent: (incoming ? '+' : '−') + fmtSats(sats) });
    const caret = h('span', { className: 'tx-caret' });
    caret.append(icon('chevron-down'));
    const head = h('div', { className: 'tx-head' }, [ic, main, amt, caret]);

    // Expandable invoice/payment details — built lazily on first open.
    const details = h('div', { className: 'tx-details hidden' });
    let built = false;
    function buildDetails() {
      const fee = tx.fees_paid != null ? tx.fees_paid : meta.feeMsat;
      const when = tx.settled_at || tx.created_at;
      const normDesc = normalizeDescription(tx.description);
      const note = meta.comment || (normDesc && normDesc !== counterparty ? normDesc : '');
      // For a zap the counterparty is in the event rather than in the invoice, so the
      // From/To row above would otherwise be blank on every one of them.
      const zapWho = isZap ? zapLabel(incoming, zapParty, cachedProfile(zapParty)).replace(/^Zap (from|to) /, '') : '';
      const rows = [
        txDetailRow(incoming ? 'From' : 'To', counterparty || zapWho),
        txDetailRow('Note', note, null, true),
        txDetailRow('Amount', satsLabel(sats)),
        incoming ? null : txDetailRow('Fee', fmtFeeMsat(fee)),
        txDetailRow('Date', when ? new Date(when * 1000).toLocaleString() : null),
        txDetailRow('Payment hash', tx.payment_hash ? truncMid(tx.payment_hash, 12, 8) : null, tx.payment_hash),
        txDetailRow('Preimage', tx.preimage ? truncMid(tx.preimage, 12, 8) : null, tx.preimage),
        txDetailRow('Invoice', tx.invoice ? truncMid(tx.invoice, 12, 10) : null, tx.invoice),
      ].filter(Boolean);
      if (!rows.length) {
        rows.push(h('div', { className: 'tx-d-row' }, [h('span', { className: 'tx-d-label', textContent: 'No extra details.' })]));
      }
      rows.forEach((r) => details.append(r));
      built = true;
    }

    head.addEventListener('click', () => {
      if (!built) buildDetails();
      const nowHidden = details.classList.toggle('hidden');
      row.classList.toggle('open', !nowHidden);
    });

    row.append(head, details);
    return row;
  }

  // Backup the NWC connection to relays, with detection of an existing backup.
  // Export the raw NWC connection string — PIN-gated step-up, then a copyable
  // reveal that auto-hides (mirrors the nsec reveal).
  function exportNwcModal() {
    if (!state.activePubkey) { toast('No active account', 'error'); return; }
    openModal((modal) => {
      const pin = h('input', { type: 'password', maxLength: 32 });
      const err = h('div', { className: 'error' });
      const go = h('button', { className: 'primary', textContent: 'Reveal' });
      go.addEventListener('click', async () => {
        err.textContent = '';
        if (!pin.value) return (err.textContent = 'Enter your PIN.');
        go.disabled = true;
        go.textContent = 'Revealing…';
        try {
          const r = await call({ type: 'SIDECAR_REVEAL_NWC', pubkey: state.activePubkey, pin: pin.value });
          if (!r.connection) throw new Error('No wallet connection saved for this account');
          nwcRevealModal(r.connection);
        } catch (e) {
          err.textContent = e.message;
          go.disabled = false;
          go.textContent = 'Reveal';
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Export wallet connection' }),
        h('p', { className: 'hint', textContent: 'Enter your PIN to reveal the NWC connection string for this account.' }),
        h('label', { textContent: 'PIN' }),
        pin,
        err,
        h('div', { className: 'actions' }, [go, cancel])
      );
      setTimeout(() => pin.focus(), 50);
    });
  }

  function nwcRevealModal(connection) {
    let stop = null;
    openModal(
      (modal) => {
        const body = h('div', {});
        const done = h('button', { className: 'primary', textContent: "I've saved it" });
        done.addEventListener('click', closeModal);
        modal.append(
          h('h3', { textContent: 'Wallet connection string' }),
          h('p', { className: 'hint', textContent: 'Copy the string to connect the same wallet elsewhere, or show a QR to scan it into an NWC-compatible app.' }),
          body,
          h('div', { className: 'actions' }, [done])
        );
        // Same reveal UX as the nsec/ncryptsec backup: copyable string with an
        // auto-hide, and an opt-in QR that carries its own timer. NWC URIs are
        // longer, so the QR uses level 'L' for the extra capacity.
        stop = renderSecretReveal(body, {
          secret: connection,
          noun: 'connection string',
          qrLevel: 'L',
          qrExclusive: true, // the URI is long — show the string OR the QR, not both
          qrHint: 'Scan in an NWC-compatible app to connect the same wallet.',
          warnText: 'This string can spend from your wallet up to its limits. Store it safely and never share it.',
          onExpire: closeModal,
        });
      },
      () => { if (stop) stop(); }
    );
  }

  // Backing up replaces the stored wallet. The d-tag is replaceable, so the old
  // ciphertext is discarded — and if the relays were the only place that connection
  // lived, it's gone.
  //
  // Deliberately does NOT say "export it first": Export reveals the CONNECTED
  // wallet, which is the new one. Saving the old string means restoring it first,
  // so that's what this points at.
  function confirmOverwriteNwcBackup(backupState, onConfirm) {
    openModal((modal) => {
      const body = h('p', { className: 'hint' });
      body.append(
        document.createTextNode(
          backupState === 'stale'
            ? 'Your relays hold a different wallet. Backing up replaces it. '
            : "Sidecar couldn't check what your relays hold. Backing up replaces it. "
        ),
        h('strong', { textContent: 'Restore it first if you still need it.' })
      );
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      // Action first, Cancel last — matching disconnectModal, the other wallet
      // confirm. 'danger' not 'primary': this discards a stored wallet, so it
      // shouldn't wear the color reserved for the encouraged choice.
      const go = h('button', { className: 'danger', textContent: 'Replace backup' });
      go.addEventListener('click', () => { closeModal(); onConfirm(); });
      modal.append(
        h('h3', { textContent: 'Replace saved backup?' }),
        body,
        h('div', { className: 'actions' }, [go, cancel])
      );
    });
  }

  // Restore replaces the connected wallet. Say what is lost, in one line.
  function confirmRestoreNwc(backupState, onConfirm) {
    openModal((modal) => {
      const body = h('p', { className: 'hint' });
      body.append(
        document.createTextNode(
          backupState === 'stale'
            ? 'The backup is a different wallet. '
            : "Sidecar couldn't check what the backup holds. "
        ),
        h('strong', { textContent: 'The wallet you have connected now will be replaced.' })
      );
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      const go = h('button', { className: 'danger', textContent: 'Replace it' });
      go.addEventListener('click', () => { closeModal(); onConfirm(); });
      modal.append(
        h('h3', { textContent: 'Replace connected wallet?' }),
        body,
        h('div', { className: 'actions' }, [go, cancel])
      );
    });
  }

  // `statePromise` is shared with the nudge in renderWalletConnected so the relay
  // fetch + decrypt happens once per wallet render, not once per consumer.
  function renderWalletBackup(statePromise) {
    const wrap = h('div', { className: 'setting wallet-backup' });
    wrap.append(h('h3', { textContent: 'Backup' }));
    wrap.append(h('p', { className: 'hint', textContent: 'Encrypt your wallet connection to your own key and store it on your relays (NIP-78). Restore it on another device or after a reset.' }));

    let backupState = 'unknown';
    const status = h('span', { className: 'backup-status', textContent: 'Checking…' });
    // Only shown for 'stale', where the pill alone can't say what's wrong.
    const staleNote = h('p', { className: 'hint backup-stale-note hidden', textContent: 'The backup is a different wallet.' });
    const back = h('button', { className: 'secondary', textContent: 'Back up' });
    const restore = h('button', { className: 'secondary', textContent: 'Restore' });
    const doBackup = async () => {
      back.disabled = true;
      back.textContent = 'Backing up…';
      try {
        await backupNwcToRelays();
        backupState = 'current';
        status.textContent = NWC_BACKUP_LABEL.current;
        status.classList.add('done');
        status.classList.remove('warn');
        staleNote.classList.add('hidden');
        toast('Wallet backed up', 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
      back.disabled = false;
      back.textContent = 'Back up';
    };
    back.addEventListener('click', () => {
      // Only when there's something to lose. 'none' has no stored wallet and
      // 'current' would rewrite the same string.
      if (backupState === 'stale' || backupState === 'unknown') {
        confirmOverwriteNwcBackup(backupState, doBackup);
        return;
      }
      doBackup();
    });
    const doRestore = async () => {
      restore.disabled = true;
      restore.textContent = 'Restoring…';
      try {
        await restoreNwcFromRelays();
        toast('Wallet restored', 'success');
        renderWallet();
      } catch (e) {
        toast(e.message, 'error');
        restore.disabled = false;
        restore.textContent = 'Restore';
      }
    };
    restore.addEventListener('click', () => {
      // Restore overwrites the connected wallet via SIDECAR_SET_NWC. When the
      // backup is a different wallet, that silently discards the string in use —
      // and it's the case where someone reaching for Restore is most likely to be
      // guessing. Confirm first; 'current' is a no-op so it doesn't ask.
      if (backupState === 'stale' || backupState === 'unknown') {
        confirmRestoreNwc(backupState, doRestore);
        return;
      }
      doRestore();
    });
    const exportBtn = h('button', { className: 'wallet-export-link', textContent: 'Export connection string' });
    exportBtn.append(icon('key'));
    exportBtn.addEventListener('click', exportNwcModal);
    hide(exportBtn); // shown only when a connection exists for the active account

    const card = h('div', { className: 'wallet-backup-card' }, [
      h('div', { className: 'wallet-backup-head' }, [
        h('span', { className: 'item-label', textContent: 'Wallet connection' }),
        status,
      ]),
      staleNote,
      h('div', { className: 'wallet-backup-actions' }, [back, restore]),
      exportBtn,
    ]);
    wrap.append(card);

    (statePromise || nwcBackupState())
      .then((r) => {
        backupState = (r && r.state) || 'unknown';
        status.textContent = NWC_BACKUP_LABEL[backupState] || NWC_BACKUP_LABEL.unknown;
        status.classList.toggle('done', backupState === 'current');
        status.classList.toggle('warn', backupState === 'stale');
        staleNote.classList.toggle('hidden', backupState !== 'stale');
      })
      .catch(() => {
        backupState = 'unknown';
        status.textContent = NWC_BACKUP_LABEL.unknown;
      });
    // Only offer export when this account actually has a connection saved.
    call({ type: 'SIDECAR_HAS_NWC', pubkey: state.activePubkey })
      .then((r) => { if (r && r.has) show(exportBtn); })
      .catch(() => {});
    return wrap;
  }

  // Per-site WebLN spending budgets: sites allowed to pay from the wallet without
  // a prompt, up to a daily allowance. Lets the user review and revoke them.
  function renderSitePayments() {
    const wrap = h('div', { className: 'setting wallet-budgets' });
    wrap.append(h('h3', { textContent: 'Site payments' }));
    wrap.append(h('p', { className: 'hint', textContent: 'Sites allowed to pay from your wallet without asking, up to a daily budget. Revoke any time.' }));
    const list = h('div', { className: 'list flat' });
    wrap.append(list);
    listState(list, 'Loading…');
    call({ type: 'SIDECAR_GET_BUDGETS' })
      .then((budgets) => {
        const hosts = Object.keys(budgets || {}).sort();
        // Budgets can only be created from a payment prompt, so an empty list has to
        // say how — otherwise the feature is invisible to anyone who ever unticked it.
        if (!hosts.length) {
          list.classList.add('empty');
          listState(list, 'No sites have a spending budget. Tick “remember a budget” when you approve a payment.');
          return;
        }
        list.classList.remove('empty');
        list.innerHTML = '';
        hosts.forEach((host) => list.append(budgetRow(host, budgets[host])));
      })
      .catch(() => listState(list, 'Could not load budgets.'));
    return wrap;
  }

  // NOT MASKED BY hideBalances, and that is the point rather than an oversight. The mask
  // exists so a glance at the screen does not reveal what you HOLD. A budget is not a
  // holding: it is a cap you set for one site, and both halves of "400 of 1,000 sats left
  // today" are numbers you chose. Masking them protects nothing and costs the row its
  // only job — this list exists to be read before you revoke something, and "•••• of
  // ••••" cannot be read. The amounts either side of it, the balance and the transaction
  // figures, stay masked.
  function budgetRow(host, b) {
    const row = h('div', { className: 'item' });
    const sub = h('div', { className: 'item-sub' }, [
      h('span', { textContent: fmtSats(b.remainingSats) }),
      document.createTextNode(' of '),
      h('span', { textContent: fmtSats(b.budgetSats) }),
      document.createTextNode(' sats left today'),
    ]);
    const main = h('div', { className: 'item-main' }, [
      h('div', { className: 'item-label', textContent: host }),
      sub,
    ]);
    const edit = iconButton('Edit budget', 'edit', () => editBudgetModal(host, b));
    const rm = iconButton('Revoke budget', 'trash', async () => {
      await call({ type: 'SIDECAR_REVOKE_BUDGET', host });
      renderWallet();
    });
    row.append(main, h('div', { className: 'item-actions' }, [edit, rm]));
    return row;
  }

  function editBudgetModal(host, b) {
    openModal((modal) => {
      const err = h('div', { className: 'error' });
      const input = h('input', { type: 'text', inputMode: 'numeric', value: String(b.budgetSats || 0) });
      const save = h('button', { className: 'primary', textContent: 'Save budget' });
      save.addEventListener('click', async () => {
        err.textContent = '';
        const budgetSats = parseInt(input.value, 10);
        if (!budgetSats || budgetSats < 1) {
          err.textContent = 'Enter a daily budget in sats.';
          return;
        }
        try {
          await call({ type: 'SIDECAR_SET_BUDGET', host, budgetSats, perPaymentSats: b.perPaymentSats || 0 });
          closeModal();
          renderWallet();
          toast('Budget updated', 'success');
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Edit budget' }),
        h('p', {
          className: 'hint',
          textContent:
            'Daily amount ' + host + ' can spend without a prompt. Saving resets the remaining amount for today.',
        }),
        h('label', { textContent: 'Daily budget (sats)' }),
        input,
        err,
        h('div', { className: 'actions' }, [save, cancel])
      );
      setTimeout(() => input.focus(), 50);
    });
  }

  function sendModal() {
    openModal((modal) => {
      const input = h('textarea', { className: 'compose-text', placeholder: 'Lightning invoice (lnbc…) or lightning address' });
      const amountLabel = h('label', { className: 'hidden', textContent: 'Amount (sats)' });
      const amount = satsInput('Amount in sats');
      amount.classList.add('hidden');
      const comment = h('input', { className: 'send-comment', type: 'text', maxLength: 280, placeholder: 'Comment (optional)' });
      const err = h('div', { className: 'error' });
      const pay = h('button', { className: 'primary', textContent: 'Pay' });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);

      // The recipient card: who the address resolved to, and on what terms.
      const card = h('div', { className: 'ln-recipient hidden' });
      const commentDefault = comment.placeholder;
      let resolved = null;      // params for the address currently in the card
      let resolveSeq = 0;       // guards against a slow lookup landing after a newer one
      let debounce = null;

      function resetCard() {
        resolved = null;
        card.textContent = '';
        card.classList.add('hidden');
        card.classList.remove('checking', 'failed');
        comment.disabled = false;
        comment.maxLength = 280;
        comment.placeholder = commentDefault;
      }

      function renderCard(p) {
        card.textContent = '';
        card.classList.remove('hidden', 'checking', 'failed');
        const head = h('div', { className: 'ln-recipient-head' });
        if (p.image) {
          head.append(h('img', { className: 'ln-recipient-avatar', src: p.image, alt: '' }));
        }
        const who = h('div', { className: 'ln-recipient-who' });
        // textContent throughout — every string here came from the recipient's server.
        who.append(h('span', { className: 'ln-recipient-name', textContent: p.identifier || p.addr }));
        const limits = p.minSats === p.maxSats
          ? fmtSats(p.minSats) + ' sats only'
          : fmtSats(p.minSats) + ' to ' + fmtSats(p.maxSats) + ' sats';
        who.append(h('span', { className: 'ln-recipient-limits', textContent: limits }));
        head.append(who);
        card.append(head);
        if (p.description) {
          card.append(h('p', { className: 'ln-recipient-desc', textContent: p.description }));
        }
        const tags = h('div', { className: 'ln-recipient-tags' });
        tags.append(h('span', {
          className: 'ln-recipient-tag',
          textContent: p.commentAllowed ? 'Comments up to ' + p.commentAllowed : 'No comments',
        }));
        if (p.zappable) tags.append(h('span', { className: 'ln-recipient-tag', textContent: 'Zappable' }));
        card.append(tags);

        // Match the comment field to what this recipient will actually accept,
        // rather than letting someone write 280 characters that get truncated or
        // dropped without explanation.
        if (p.commentAllowed) {
          comment.disabled = false;
          comment.maxLength = p.commentAllowed;
          comment.placeholder = commentDefault;
        } else {
          comment.disabled = true;
          comment.value = '';
          comment.placeholder = 'This wallet does not accept comments';
        }
      }

      async function lookup(addr) {
        const seq = ++resolveSeq;
        card.textContent = '';
        card.classList.remove('hidden', 'failed');
        card.classList.add('checking');
        card.append(h('span', { className: 'ln-recipient-status', textContent: 'Checking ' + addr + '…' }));
        try {
          const p = await lnAddressParams(addr);
          if (seq !== resolveSeq) return; // a newer address is being checked
          resolved = { ...p, addr };
          renderCard(resolved);
        } catch (e) {
          if (seq !== resolveSeq) return;
          resolved = null;
          card.textContent = '';
          card.classList.remove('checking');
          card.classList.add('failed');
          // Last line of defense. Every throw above is written to be read aloud,
          // but anything unforeseen (a parser, a platform error) would arrive
          // here as jargon, and jargon in a payment dialog reads as a fault in
          // Sidecar rather than a fact about the address.
          const raw = (e && e.message) || '';
          const speakable = raw && raw.length <= 90 && !/[{}<>]|JSON|token|undefined|TypeError/i.test(raw);
          card.append(h('span', {
            className: 'ln-recipient-fail-title',
            textContent: speakable ? raw : "Couldn't check that address",
          }));
          card.append(h('span', {
            className: 'ln-recipient-status',
            textContent: 'Check the spelling, or paste an invoice instead.',
          }));
        }
      }

      // Auto-detect: only a lightning address needs an amount (invoices carry it).
      function detect() {
        const v = input.value.replace(/^lightning:/i, '').trim();
        const isAddr = isLnAddress(v) && !isLnInvoice(v);
        amount.classList.toggle('hidden', !isAddr);
        amountLabel.classList.toggle('hidden', !isAddr);

        if (debounce) { clearTimeout(debounce); debounce = null; }
        if (!isAddr) { resolveSeq++; resetCard(); return; }
        if (resolved && resolved.addr === v) return; // already showing this one

        resetCard();
        // Debounced, and only once the address is complete enough to be real.
        // Every lookup is a request to a stranger's server announcing an intent
        // to pay them, so this must not fire on each keystroke of a half-typed
        // domain — that would hand a trail to every typo along the way.
        //
        // isLnAddress is deliberately not reused for the gate: it accepts a
        // one-character TLD, which is right for deciding whether to show the
        // amount field and wrong for deciding whether to make a request. Pausing
        // mid-word should not send anything to `breez.t`.
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)) return;
        debounce = setTimeout(() => lookup(v), 600);
      }
      input.addEventListener('input', detect);

      pay.addEventListener('click', async () => {
        const val = input.value.replace(/^lightning:/i, '').trim();
        if (!val) return (err.textContent = 'Paste an invoice or lightning address.');
        err.textContent = '';
        const note = comment.value.trim();
        let address = ''; // lightning address, when sending to one
        try {
          const client = await ensureNwc();
          let invoice = val;
          if (isLnInvoice(val)) {
            // BOLT11 — amount is already in the invoice.
          } else if (isLnAddress(val)) {
            const sats = parseInt(amount.value, 10);
            if (!sats || sats < 1) return (err.textContent = 'Enter an amount in sats.');
            // Check against the limits we already fetched, so an out-of-range
            // amount is caught here rather than after a round trip. The server
            // still enforces its own at invoice time — this only saves the trip.
            if (resolved && resolved.addr === val && (sats < resolved.minSats || sats > resolved.maxSats)) {
              return (err.textContent = resolved.minSats === resolved.maxSats
                ? 'This address only accepts ' + fmtSats(resolved.minSats) + ' sats.'
                : 'Amount must be between ' + fmtSats(resolved.minSats) + ' and ' + fmtSats(resolved.maxSats) + ' sats.');
            }
            address = val;
            pay.disabled = true;
            pay.textContent = 'Paying…';
            invoice = await lnAddressToInvoice(val, sats * 1000, note || 'Sidecar payment');
          } else {
            return (err.textContent = 'Enter a BOLT11 invoice (lnbc…) or a lightning address.');
          }
          pay.disabled = true;
          pay.textContent = 'Paying…';
          const res = await client.payInvoice(invoice);
          // Record what NWC history won't keep: who we paid, the note, the fee —
          // keyed by invoice so txRow can match it back.
          const feeMsat = res && res.fees_paid;
          if (address || note || feeMsat != null) {
            await savePayMeta(invoice, { address, comment: note, feeMsat });
          }
          closeModal();
          lightningStrike(); // only after the payment actually settles
          // Lead with the amount — "Payment sent" alone doesn't tell you what left.
          // A pasted BOLT11 carries its own amount; a lightning address took one from
          // the field above. An amountless invoice leaves us nothing honest to state,
          // so it falls back to the bare confirmation rather than guessing.
          const paidSats = isLnInvoice(val) ? bolt11Sats(val) : parseInt(amount.value, 10) || null;
          toast(
            (paidSats != null ? 'Sent ' + fmtSats(paidSats) + ' sats' : 'Payment sent') +
              (feeMsat != null ? ' · fee ' + fmtFeeMsat(feeMsat) : ''),
            'success'
          );
          renderWallet();
          renderPinnedBalanceBar();
        } catch (e) {
          err.textContent = e.message;
          pay.disabled = false;
          pay.textContent = 'Pay';
        }
      });
      modal.append(
        h('h3', { textContent: 'Send' }),
        input,
        card,
        amountLabel,
        amount,
        comment,
        err,
        h('div', { className: 'actions' }, [pay, cancel])
      );
    });
  }

  const RECEIVE_PRESETS = [100, 1000, 5000, 10000];

  function receiveModal() {
    let pollTimer = null;
    const stopPoll = () => { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } };

    openModal((modal) => {
      const xClose = h('button', { className: 'modal-x', title: 'Close' });
      xClose.append(icon('x'));
      xClose.addEventListener('click', closeModal);
      modal.append(xClose, h('h3', { textContent: 'Receive' }));

      // Tabs: Invoice (always) + Lightning address (added if the profile has lud16).
      const tabs = h('div', { className: 'compose-tabs' });
      const tabInvoice = h('button', { className: 'compose-tab active', textContent: 'Invoice' });
      tabs.append(tabInvoice);
      modal.append(tabs);
      const body = h('div');
      modal.append(body);

      function showInvoiceMode() {
        stopPoll();
        body.innerHTML = '';
        const presets = h('div', { className: 'amount-presets' });
        const amount = satsInput('Amount in sats');
        const chipLabel = (n) => (n >= 1000 ? n / 1000 + 'K' : String(n));
        RECEIVE_PRESETS.forEach((p) => {
          const b = h('button', { className: 'preset-chip', textContent: chipLabel(p) });
          b.addEventListener('click', () => {
            amount.value = String(p);
            presets.querySelectorAll('.preset-chip').forEach((c) => c.classList.remove('active'));
            b.classList.add('active');
          });
          presets.append(b);
        });
        const memo = h('input', { type: 'text', placeholder: 'Note (optional)' });
        const err = h('div', { className: 'error' });
        const create = h('button', { className: 'primary', textContent: 'Create invoice' });
        create.addEventListener('click', async () => {
          const sats = parseInt(amount.value, 10);
          if (!sats || sats < 1) return (err.textContent = 'Enter an amount in sats.');
          err.textContent = '';
          create.disabled = true;
          create.textContent = 'Creating…';
          try {
            const client = await ensureNwc();
            const res = await client.makeInvoice(sats * 1000, memo.value.trim());
            const invoice = res && (res.invoice || res.payment_request || res.bolt11);
            if (!invoice) throw new Error('Wallet returned no invoice');
            // Swap the whole form for the invoice + QR; the corner ✕ cancels.
            showInvoice(body, invoice);
            // Poll for settlement so we can show a success state — with a backoff
            // and an overall cap so a receive QR left open doesn't hammer the
            // wallet relay indefinitely (starts at 2.5s, eases to 15s, stops
            // after 5 minutes).
            const lookupArg = res.payment_hash ? { payment_hash: res.payment_hash } : { invoice };
            const POLL_MAX = 15000;
            const pollDeadline = Date.now() + 5 * 60 * 1000;
            let pollDelay = 2500;
            const pollOnce = async () => {
              try {
                const inv = await client.lookupInvoice(lookupArg);
                if (inv && (inv.settled_at || inv.preimage || inv.state === 'settled')) {
                  stopPoll();
                  showReceiveSuccess(body, sats);
                  renderWallet();
                  renderPinnedBalanceBar();
                  return;
                }
              } catch (_) {}
              if (Date.now() >= pollDeadline) { stopPoll(); return; }
              pollDelay = Math.min(Math.round(pollDelay * 1.5), POLL_MAX);
              pollTimer = setTimeout(pollOnce, pollDelay);
            };
            pollTimer = setTimeout(pollOnce, pollDelay);
          } catch (e) {
            err.textContent = e.message;
            create.disabled = false;
            create.textContent = 'Create invoice';
          }
        });
        body.append(
          h('label', { textContent: 'Amount (sats)' }),
          presets,
          amount,
          h('label', { textContent: 'Note' }),
          memo,
          err,
          h('div', { className: 'actions' }, [create])
        );
      }

      function showAddressMode(lud16) {
        stopPoll();
        body.innerHTML = '';
        const out = h('div', { className: 'recv-out' });
        const canvas = document.createElement('canvas');
        canvas.className = 'recv-qr';
        try { window.SidecarQR.draw(canvas, 'lightning:' + lud16, 220, 'M'); } catch (_) {}
        // Truncate to one line if it overflows — the full address is still copied.
        const copy = h('button', { className: 'secondary recv-addr', title: 'Copy address' });
        const addrText = h('span', { textContent: lud16 });
        copy.append(addrText);
        copy.addEventListener('click', async () => {
          try {
            await copyPlain(lud16);
            addrText.textContent = 'Copied ✓';
            setTimeout(() => (addrText.textContent = lud16), 1200);
          } catch (_) {}
        });
        out.append(canvas, copy, h('p', { className: 'hint', textContent: 'Your reusable lightning address — anyone can pay it any amount.' }));
        body.append(out);
      }

      tabInvoice.addEventListener('click', () => {
        tabs.querySelectorAll('.compose-tab').forEach((t) => t.classList.remove('active'));
        tabInvoice.classList.add('active');
        showInvoiceMode();
      });
      showInvoiceMode();

      // If a lightning address is available (NWC string or profile), add an
      // Address tab so the user can toggle between an invoice and their address.
      getLightningAddress().then((lud16) => {
        if (!lud16) return;
        const tabAddress = h('button', { className: 'compose-tab', textContent: 'Address' });
        tabAddress.addEventListener('click', () => {
          tabs.querySelectorAll('.compose-tab').forEach((t) => t.classList.remove('active'));
          tabAddress.classList.add('active');
          showAddressMode(lud16);
        });
        tabs.append(tabAddress);
      });
    }, stopPoll);
  }

  function showReceiveSuccess(container, sats) {
    container.innerHTML = '';
    const wrap = h('div', { className: 'recv-success' });
    const badge = h('div', { className: 'recv-check' });
    badge.append(icon('check'));
    wrap.append(
      badge,
      h('div', { className: 'recv-success-title', textContent: 'Payment received' }),
      h('div', { className: 'recv-success-amt', textContent: '+' + fmtSats(sats) + ' sats' })
    );
    const done = h('button', { className: 'primary', textContent: 'Done' });
    done.addEventListener('click', closeModal);
    container.append(wrap, h('div', { className: 'actions' }, [done]));
  }

  function showInvoice(container, invoice) {
    container.innerHTML = '';
    const out = h('div', { className: 'recv-out' });
    const canvas = document.createElement('canvas');
    canvas.className = 'recv-qr';
    try {
      window.SidecarQR.draw(canvas, invoice.toUpperCase(), 220, 'M');
    } catch (_) {}
    // Show a short middle-ellipsis of the invoice; the full string is on Copy.
    const short = invoice.length > 36 ? invoice.slice(0, 22) + '…' + invoice.slice(-10) : invoice;
    const copy = h('button', { className: 'secondary recv-copy', textContent: 'Copy invoice' });
    copy.addEventListener('click', async () => {
      try {
        await copyPlain(invoice);
        copy.textContent = 'Copied ✓';
        setTimeout(() => (copy.textContent = 'Copy invoice'), 1200);
      } catch (_) {}
    });
    const waiting = h('div', { className: 'recv-waiting' }, [h('span', { className: 'recv-spinner' }), h('span', { textContent: 'Waiting for payment…' })]);
    out.append(canvas, h('div', { className: 'recv-bolt', textContent: short }), copy, waiting);
    container.append(out);
  }

  function disconnectModal() {
    openModal((modal) => {
      const go = h('button', { className: 'danger', textContent: 'Disconnect' });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      go.addEventListener('click', async () => {
        await call({ type: 'SIDECAR_CLEAR_NWC' });
        stopWalletMonitor();
        if (nwc) { try { nwc.close(); } catch (_) {} nwc = null; nwcPubkey = null; nwcConn = null; }
        closeModal();
        toast('Wallet disconnected', 'success');
        renderWallet();
      });
      modal.append(
        h('h3', { textContent: 'Disconnect wallet?' }),
        h('p', { className: 'hint', textContent: "Removes this account's saved NWC connection from Sidecar. Your wallet and funds are unaffected." }),
        h('div', { className: 'actions' }, [go, cancel])
      );
    });
  }

  // ---- LNURL-pay resolution -------------------------------------------------
  //
  // Everything below the fetch is attacker-controlled: the domain owner writes
  // the description, the identifier, the image, and the limits. It is rendered
  // with textContent only, never markup, and every field is clamped to a size
  // that cannot push the rest of the form off screen. A recipient does not get
  // to redesign the send dialog.

  const LN_DESC_MAX = 200;      // characters of description we will show
  const LN_IMAGE_MAX = 200000;  // characters of base64 — roughly 150KB decoded

  // Pull the human-readable parts out of LNURL-pay's `metadata`, which is a
  // JSON-encoded array of [mimeType, value] pairs.
  function parseLnMetadata(raw) {
    const out = { description: '', identifier: '', image: '' };
    let entries;
    try { entries = JSON.parse(raw); } catch (_) { return out; }
    if (!Array.isArray(entries)) return out;
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [type, value] = entry;
      if (typeof type !== 'string' || typeof value !== 'string') continue;
      // Collapse whitespace: a description full of newlines would otherwise
      // stretch the dialog to whatever height the recipient felt like.
      if (type === 'text/plain' && !out.description) {
        out.description = value.replace(/\s+/g, ' ').trim().slice(0, LN_DESC_MAX);
      } else if ((type === 'text/identifier' || type === 'text/email') && !out.identifier) {
        out.identifier = value.replace(/\s+/g, '').slice(0, 128);
      } else if (!out.image && /^image\/(png|jpeg);base64$/.test(type) && value.length <= LN_IMAGE_MAX) {
        // Only the two types LUD-06 defines, and only as a data: URI, so it can
        // never become a request back to the recipient's server.
        if (/^[A-Za-z0-9+/=]+$/.test(value)) out.image = 'data:' + type.split(';')[0] + ';base64,' + value;
      }
    }
    return out;
  }

  // Fetch a lightning address's pay parameters. Separate from the invoice call
  // so the Send form can show the recipient's terms before anyone commits to an
  // amount — previously min/max were only discovered by having a payment
  // rejected, after the amount was already typed.
  async function lnAddressParams(addr) {
    const [name, domain] = String(addr || '').split('@');
    if (!name || !domain) throw new Error('That does not look like a lightning address');

    // Each failure gets its own sentence, because they mean different things to
    // whoever is standing there with an address they expected to work: the
    // domain is unreachable, or it is reachable and simply has no such address,
    // or it answered with something that is not a lightning address at all.
    // What must never surface is the underlying parser complaining about a
    // DOCTYPE, which is what a 404 HTML page produces and tells the user nothing.
    let res;
    try {
      res = await fetch('https://' + domain + '/.well-known/lnurlp/' + name);
    } catch (_) {
      throw new Error("Couldn't reach " + domain);
    }
    if (!res.ok) throw new Error(domain + ' has no lightning address for ' + name);
    let meta;
    try {
      meta = await res.json();
    } catch (_) {
      // A web page where a lightning address should be. Same thing, from the
      // user's side, as the address not existing.
      throw new Error(domain + ' has no lightning address for ' + name);
    }
    if (!meta || meta.tag !== 'payRequest' || !meta.callback) {
      throw new Error(domain + ' answered, but not with a lightning address');
    }
    const minMsat = Number(meta.minSendable);
    const maxMsat = Number(meta.maxSendable);
    if (!Number.isFinite(minMsat) || !Number.isFinite(maxMsat) || minMsat < 0 || maxMsat < minMsat) {
      throw new Error(domain + ' returned payment limits that make no sense');
    }
    const comment = Number(meta.commentAllowed);
    return {
      meta,
      minSats: Math.ceil(minMsat / 1000),
      maxSats: Math.floor(maxMsat / 1000),
      commentAllowed: Number.isFinite(comment) && comment > 0 ? Math.min(comment, 1000) : 0,
      zappable: !!(meta.allowsNostr && meta.nostrPubkey),
      ...parseLnMetadata(meta.metadata),
    };
  }

  // Resolve a lightning address (user@domain) to a BOLT11 invoice via LNURL-pay.
  async function lnAddressToInvoice(addr, msats, comment) {
    // Re-fetched rather than reusing whatever the form previewed: the preview
    // may be minutes old, and the limits it showed are not the ones that will be
    // enforced. The server's answer at payment time is the only one that counts.
    const { meta } = await lnAddressParams(addr);
    if (msats < meta.minSendable || msats > meta.maxSendable) {
      throw new Error('Amount must be ' + Math.ceil(meta.minSendable / 1000) + '–' + Math.floor(meta.maxSendable / 1000) + ' sats');
    }
    const cb = new URL(meta.callback);
    // The callback URL is chosen by whoever runs the lightning-address domain —
    // an http:// one sends the payment request (and its amount/comment) in
    // cleartext and is trivially swapped by a MITM. LNURL-pay callbacks are
    // https in practice, so refuse anything else.
    if (cb.protocol !== 'https:') throw new Error('Lightning address returned an insecure callback URL');
    cb.searchParams.set('amount', String(msats));
    if (comment && meta.commentAllowed > 0) cb.searchParams.set('comment', comment.slice(0, meta.commentAllowed));
    const res = await (await fetch(cb.toString())).json();
    if (!res.pr) throw new Error(res.reason || 'No invoice returned');
    return res.pr;
  }

  // Chrome already checks the Web Store for updates every few hours on its own;
  // requestUpdateCheck() is the one sanctioned way to trigger that early from a
  // user-initiated button click (not a timer). It only fetches the update —
  // installing it still waits for the background worker/browser to restart, or
  // an explicit chrome.runtime.reload() (which we don't call here, since that
  // would abruptly tear down an in-progress unlock/signing/wallet flow).
  async function checkForUpdates(btn, statusEl) {
    const prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Checking…';
    statusEl.textContent = '';
    try {
      const result = await chrome.runtime.requestUpdateCheck();
      const status = result && result.status;
      if (status === 'update_available') {
        const v = result.version ? ' (v' + result.version + ')' : '';
        statusEl.textContent = 'Update found' + v + ' — it installs the next time Sidecar restarts.';
      } else if (status === 'throttled') {
        statusEl.textContent = 'Checked recently — try again in a few minutes.';
      } else {
        statusEl.textContent = "You're on the latest version.";
      }
    } catch (_) {
      statusEl.textContent = 'Could not check for updates.';
    }
    btn.disabled = false;
    btn.textContent = prevLabel;
  }

  // ---- About + zap the creator (opened from the Sidecar logo) ----
  function aboutModal() {
    openModal((modal) => {
      const build = window.SIDECAR_BUILD || {};
      const ver = build.version || (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
      const verText = 'Version ' + ver + (build.commit && build.commit !== 'dev' ? ' (' + build.commit + ')' : '');

      const xClose = h('button', { className: 'modal-x', title: 'Close' });
      xClose.append(icon('x'));
      xClose.addEventListener('click', closeModal);

      const logo = h('img', { className: 'about-logo', src: logoSrcFor(document.documentElement.dataset.theme), alt: 'Sidecar' });
      const creator = h('a', {
        className: 'about-creator-link', textContent: shortNpub(CREATOR_NPUB),
        href: '#', target: '_blank', rel: 'noopener noreferrer',
      });
      // Open the creator's profile in the user's preferred client; resolve their
      // current kind:0 name instead of a hardcoded handle.
      preferredClient().then((client) => { creator.href = client.profile(CREATOR_NPUB); }).catch(() => {});
      fetchProfileName(CREATOR_NPUB).then((name) => { if (name) creator.textContent = '@' + name.replace(/^@/, ''); });

      const website = h('a', { className: 'about-link', textContent: 'Website', href: SIDECAR_SITE_URL, target: '_blank', rel: 'noopener noreferrer' });
      const privacy = h('a', { className: 'about-link', textContent: 'Privacy Policy', href: SIDECAR_SITE_URL + '/privacy', target: '_blank', rel: 'noopener noreferrer' });
      const repo = h('a', { className: 'about-link', textContent: 'GitHub', href: GITHUB_URL, target: '_blank', rel: 'noopener noreferrer' });
      const support = h('a', { className: 'about-link', textContent: 'Support', href: SIDECAR_SITE_URL + '/support', target: '_blank', rel: 'noopener noreferrer' });
      const zap = h('button', { className: 'about-link about-link-btn' }, [document.createTextNode('Donate '), boltIcon()]);
      zap.addEventListener('click', () => { closeModal(); creatorZapModal(); });

      // Firefox has no requestUpdateCheck — the browser updates add-ons itself.
      const canCheckUpdates = typeof chrome.runtime.requestUpdateCheck === 'function';
      const updateBtn = h('button', { className: 'about-update-btn', textContent: 'Check for updates' });
      const updateStatus = h('p', { className: 'hint about-update-status' });
      updateBtn.addEventListener('click', () => checkForUpdates(updateBtn, updateStatus));

      modal.append(
        xClose,
        h('div', { className: 'about-modal' }, [
          logo,
          h('p', { className: 'about-description', textContent: 'A classy multi-account Nostr signer with a built-in Lightning wallet. Your keys stay encrypted on this device.' }),
          h('div', { className: 'about-creator' }, [document.createTextNode('Created by '), creator]),
          ver ? h('div', { className: 'about-version', textContent: verText }) : document.createTextNode(''),
          canCheckUpdates ? updateBtn : document.createTextNode(''),
          canCheckUpdates ? updateStatus : document.createTextNode(''),
          h('div', { className: 'about-links' }, [website, repo, support, privacy, zap]),
        ])
      );
    });
  }

  async function creatorZapModal() {
    const { has } = await call({ type: 'SIDECAR_HAS_NWC' });
    openModal((modal) => {
      const xClose = h('button', { className: 'modal-x', title: 'Close' });
      xClose.append(icon('x'));
      xClose.addEventListener('click', closeModal);
      modal.append(xClose, h('h3', {}, [document.createTextNode('Zap the creator '), boltIcon()]));

      const qr = h('div', { className: 'recv-out' });
      const canvas = document.createElement('canvas');
      canvas.className = 'recv-qr';
      try { window.SidecarQR.draw(canvas, 'lightning:' + CREATOR_LN, 200, 'M'); } catch (_) {}
      const copy = h('button', { className: 'secondary', textContent: CREATOR_LN });
      copy.addEventListener('click', async () => {
        try {
          await copyPlain(CREATOR_LN);
          copy.textContent = 'Copied ✓';
          setTimeout(() => (copy.textContent = CREATOR_LN), 1200);
        } catch (_) {}
      });
      qr.append(canvas, copy, h('p', { className: 'hint', textContent: 'Scan to zap from any wallet.' }));
      modal.append(qr);

      // No connected wallet: leave the QR/address only, with a gentle nudge.
      if (!has) {
        modal.append(h('p', { className: 'hint zap-noconnect', textContent: 'Connect a wallet in the Wallet tab to zap from here.' }));
        return;
      }

      // Inline send via the connected NWC wallet.
      const err = h('div', { className: 'error' });
      const message = h('input', { type: 'text', placeholder: 'Message (optional)', value: 'Thanks for Sidecar! 🍸', maxLength: 200 });
      const amount = satsInput('sats');
      const send = h('button', { className: 'primary', textContent: 'Zap' });
      send.addEventListener('click', async () => {
        const sats = parseInt(amount.value, 10);
        if (!sats || sats < 1) return (err.textContent = 'Enter an amount in sats.');
        err.textContent = '';
        send.disabled = true;
        send.textContent = 'Sending…';
        try {
          const client = await ensureNwc();
          if (!client) throw new Error('Wallet unavailable — reconnect in the Wallet tab.');
          const invoice = await lnAddressToInvoice(CREATOR_LN, sats * 1000, message.value.trim() || 'Sidecar zap');
          await client.payInvoice(invoice);
          closeModal();
          lightningStrike(); // only after the payment actually settles
          toast('Thank you! Zapped ' + fmtSats(sats) + ' sats', 'success');
        } catch (e) {
          err.textContent = e.message;
          send.disabled = false;
          send.textContent = 'Zap';
        }
      });
      modal.append(
        h('label', { textContent: 'Message' }),
        message,
        h('div', { className: 'zap-inline' }, [amount, send]),
        err
      );
    });
  }

  // Footer logo on every screen (main tabs + settings) opens the About card.
  document.querySelectorAll('.brand-foot').forEach((foot) => {
    foot.classList.add('brand-foot-btn');
    foot.title = 'About Sidecar';
    foot.addEventListener('click', aboutModal);
  });

  $('autolock-select').addEventListener('change', async (e) => {
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { autoLockMinutes: Number(e.target.value) } });
  });

  $('client-select').addEventListener('change', async (e) => {
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { defaultClient: e.target.value } });
  });

  $('reuse-tab-toggle').addEventListener('change', async (e) => {
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { reuseClientTab: e.target.checked } });
  });

  $('paybutton-toggle').addEventListener('change', async (e) => {
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { showPayButton: e.target.checked } });
  });

  $('clienttag-toggle').addEventListener('change', async (e) => {
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { showClientTag: e.target.checked } });
  });

  $('datasync-toggle').addEventListener('change', async (e) => {
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { confirmDataSync: e.target.checked } });
  });

  $('na-toggle').addEventListener('change', async (e) => {
    naSetSettingMemo(e.target.checked); // keep this document's ask/gate in sync with the write
    paintSearchModeIcon(); // the scope chip shows the same answer
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { nostrArchives: e.target.checked } });
  });

  $('hidebalance-toggle').addEventListener('change', async (e) => {
    await setHideBalancesPref(e.target.checked);
  });

  $('balancepeek-toggle').addEventListener('change', async (e) => {
    autoHideBalances = e.target.checked;
    // Switched off mid-peek, the reveal simply stops expiring. The preference is left
    // alone deliberately: promoting the peek to a real reveal would silently uncheck
    // "Hide balances by default" above, which the user did not touch. So the balance
    // stays up for this session and the next unlock masks it again, per the preference.
    if (!autoHideBalances && _balancePeekTimer) {
      clearTimeout(_balancePeekTimer);
      _balancePeekTimer = null;
    }
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { autoHideBalances: e.target.checked } });
  });

  $('pinbalance-toggle').addEventListener('change', async (e) => {
    pinBalanceBar = e.target.checked;
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { pinBalanceBar: e.target.checked } });
    syncPinControls();
  });

  $('reducemotion-toggle').addEventListener('change', async (e) => {
    reduceBalanceMotion = e.target.checked;
    document.documentElement.classList.toggle('reduce-balance-motion', reduceBalanceMotion);
    // The theme previews are separate documents, so the class above does not reach them.
    syncPreviewMotion();
    syncFlashRow();
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { reduceBalanceMotion: e.target.checked } });
    // Repaint so the change is visible now rather than at the next balance: turning
    // it on collapses the figure back to a plain text node, turning it off gives the
    // next arrival its animation. restrikeBalances clears the paint record, which is
    // what lets an unchanged number be re-rendered at all.
    restrikeBalances();
  });

  $('fiat-select').addEventListener('change', (e) => setFiatCurrency(e.target.value));

  // One switch covers both bolts: the in-panel one (payments started here) and the
  // page one (a zap from a client) — the background reads the same flag before
  // notifying the tab. Stored as an explicit false so the default stays on.
  $('zapflash-toggle').addEventListener('change', async (e) => {
    zapFlash = e.target.checked;
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { zapFlash: e.target.checked } });
    // Show the thing you just switched on, so the setting explains itself.
    if (zapFlash) lightningStrike();
  });

  // NIP-65 only — exclude Sidecar's configured relays from reads and publishes
  // once the account has a declared relay list. The configured set still seeds
  // the initial NIP-65 fetch; this toggle governs everything after that.
  $('nip65-only-toggle').addEventListener('change', async (e) => {
    await call({ type: 'SIDECAR_SET_NIP65_ONLY', pubkey: state.activePubkey, on: e.target.checked });
    $('relay-section-body')?.classList.toggle('dimmed', e.target.checked);
  });

  // Pinned balance bar — left: Send/Receive (wallet modals); right: hide balances
  // + unpin. The bar only renders when a wallet is connected.
  $('pinned-send').append(icon('arrow-up-right'));
  $('pinned-receive').append(icon('arrow-down-left'));
  $('pinned-unpin').append(icon('x'));
  $('pinned-send').addEventListener('click', () => sendModal());
  $('pinned-receive').addEventListener('click', () => receiveModal());
  $('pinned-hide').addEventListener('click', onBalanceEye);
  $('pinned-unpin').addEventListener('click', async () => {
    pinBalanceBar = false;
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { pinBalanceBar: false } });
    syncPinControls();
  });

  $('countdown-toggle').addEventListener('change', async (e) => {
    const on = e.target.checked;
    $('countdown-presets').classList.toggle('hidden', !on);
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { noteCountdown: on } });
  });

  $('countdown-presets').addEventListener('click', async (e) => {
    const btn = e.target.closest('.preset-chip');
    if (!btn) return;
    const secs = Number(btn.dataset.secs);
    $('countdown-presets').querySelectorAll('.preset-chip').forEach((c) => c.classList.toggle('active', c === btn));
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { noteCountdownSecs: secs } });
  });

  // ---- the theme gallery ----------------------------------------------------------
  // Each card previews its theme in an iframe. theme-tile.html says why a document and
  // not a div; the short of it is that a themed preview nested in the themed panel
  // matches every `[data-theme="x"] .thing` rule twice and stylesheet order picks the
  // winner, so every card animated as whichever theme loaded last.
  //
  // MOUNTED LAZILY, on the mode being shown rather than on panel start. Twelve documents
  // at boot would be twelve stylesheet loads for a screen most sessions never open, and
  // only half are ever on screen at once. Once mounted a card stays mounted: the cost is
  // paid, and re-creating the frame on every filter flip would reload the sheets.
  function mountThemePreview(card) {
    const slot = card.querySelector('.theme-preview');
    if (!slot || slot.firstChild) return;
    const frame = document.createElement('iframe');
    // No title and aria-hidden: the card's own label already names the theme, and a
    // screen reader announcing a nested document here would be noise.
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.setAttribute('scrolling', 'no');
    frame.src = 'theme-tile.html?t=' + encodeURIComponent(card.dataset.theme);
    frame.addEventListener('load', syncPreviewMotion);
    slot.appendChild(frame);
    scaleThemePreview(slot);
  }

  // The frame is a fixed-width document shrunk to whatever the card actually is. Measured
  // rather than hardcoded because the side panel is resizable: one fixed factor fits one
  // width and clips or letterboxes at every other.
  //
  // TRUE PANEL WIDTH, and it has to be. A narrower document magnifies the repeating
  // patterns, which was tempting — but a theme's field is not resolution-independent.
  // Several are built from layers sized in absolute pixels, tuned to sit at the top of a
  // 700px panel, and in a small document the same glow floods all of it. Nixie previewed
  // red and Speakeasy warm when they are near-black and deep violet.
  // So the document is a panel and the card crops it to the top band. See theme-tile.html.
  const PREVIEW_W = 360;
  function scaleThemePreview(slot) {
    if (!slot) return;
    const frame = slot.querySelector('iframe');
    if (!frame) return;
    // Zero means the card is in the hidden half, and a display:none element has no layout
    // to measure. There is nothing to do about that here — the scale is applied when the
    // card is revealed instead. See showThemeMode.
    const w = slot.clientWidth;
    if (!w) return;
    frame.style.transform = 'scale(' + w / PREVIEW_W + ')';
  }

  // Re-scale on any change to the gallery's own width. Observing the grid rather than the
  // window catches the accordion opening and the panel being dragged with one hook.
  const _themeGrid = document.querySelector('.theme-selector');
  if (_themeGrid && typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      document.querySelectorAll('.theme-preview').forEach(scaleThemePreview);
    }).observe(_themeGrid);
  }

  // Ask a mounted preview to run its balance animation again. Same-origin, so this is a
  // direct call rather than postMessage; guarded because the frame may still be loading.
  //
  // REDUCE MOTION IS DECIDED HERE, in the caller, because that is where it is enforced
  // everywhere else: paintBalanceEl gates .bal-in on the flag rather than on a CSS rule,
  // and the class on <html> only covers the masked-disc animation. A preview is its own
  // document and cannot read the setting, so the panel tells it.
  // It is passed rather than withheld — the preview repaints STILL — so a figure left
  // mid-animation by an earlier click is cleared instead of frozen where it stopped.
  function replayThemePreview(card) {
    const frame = card.querySelector('.theme-preview iframe');
    try {
      if (frame && frame.contentWindow && frame.contentWindow.replayPreview) {
        frame.contentWindow.replayPreview(!reduceBalanceMotion);
      }
    } catch (_) {}
  }

  // Carry the class into each mounted preview as well. Nothing in a preview depends on it
  // today — they show no masked balance — but a theme that ever keys an ambient animation
  // on it would otherwise keep running inside the iframe with the setting on, and the
  // iframe is the one place the panel's own <html> class cannot reach.
  function syncPreviewMotion() {
    document.querySelectorAll('.theme-preview iframe').forEach((frame) => {
      try {
        const doc = frame.contentDocument;
        if (doc) doc.documentElement.classList.toggle('reduce-balance-motion', reduceBalanceMotion);
      } catch (_) {}
    });
  }

  function showThemeMode(mode) {
    document.querySelectorAll('.theme-mode').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    document.querySelectorAll('.theme-card').forEach((card) => {
      const on = card.dataset.mode === mode;
      card.classList.toggle('hidden-mode', !on);
      if (!on) return;
      // Mounted, not replayed. Six animations firing together on a filter switch is a
      // fairground, and it fights the one thing the grid is for — comparing them side by
      // side. A card moves when you pick it and not before.
      mountThemePreview(card);
      // AND RE-SCALED, every time, not just on the mount. The ResizeObserver above runs
      // for all twelve cards, but the six in the hidden half are display:none and measure
      // zero, so they keep the scale they had when they were last on screen. Widen the
      // panel on Dark and the Light cards still render at the old width — a frame too
      // small for its card, with the theme's field stopping short of the edge.
      // Revealing them is the first moment they can be measured, so that is where it
      // happens. mountThemePreview returns early once a card has its frame, so it cannot
      // be the place this is done.
      scaleThemePreview(card.querySelector('.theme-preview'));
    });
  }

  document.querySelectorAll('.theme-mode').forEach((b) => {
    b.addEventListener('click', () => showThemeMode(b.dataset.mode));
  });

  document.querySelectorAll('.theme-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      const selectedTheme = card.dataset.theme;
      applyTheme(selectedTheme);
      // The panel just changed theme under the previews; the one you picked replays so
      // the choice confirms itself with the animation you chose it for.
      replayThemePreview(card);
      await call({ type: 'SIDECAR_SET_SETTINGS', settings: { theme: selectedTheme } });
    });
  });

  $('autozap-toggle').addEventListener('change', async (e) => {
    const on = e.target.checked;
    $('autozap-max-row').classList.toggle('hidden', !on);
    $('autozap-daily-row').classList.toggle('hidden', !on);
    const max = Math.min(AUTOZAP_ABS_MAX, Math.max(1, parseInt($('autozap-max').value, 10) || AUTOZAP_DEFAULT_MAX));
    $('autozap-max').value = String(max);
    const daily = Math.min(AUTOZAP_ABS_DAILY_MAX, Math.max(max, parseInt($('autozap-daily-max').value, 10) || max * AUTOZAP_DAILY_MULT));
    $('autozap-daily-max').value = String(daily);
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { autoZap: on, autoZapMaxSats: max, autoZapDailyMaxSats: daily } });
  });

  $('autozap-max').addEventListener('change', async (e) => {
    const max = Math.min(AUTOZAP_ABS_MAX, Math.max(1, parseInt(e.target.value, 10) || AUTOZAP_DEFAULT_MAX));
    e.target.value = String(max);
    // Keep the daily total at or above the per-zap cap.
    const daily = Math.min(AUTOZAP_ABS_DAILY_MAX, Math.max(max, parseInt($('autozap-daily-max').value, 10) || max * AUTOZAP_DAILY_MULT));
    $('autozap-daily-max').value = String(daily);
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { autoZapMaxSats: max, autoZapDailyMaxSats: daily } });
  });

  $('autozap-daily-max').addEventListener('change', async (e) => {
    const perZap = Math.min(AUTOZAP_ABS_MAX, Math.max(1, parseInt($('autozap-max').value, 10) || AUTOZAP_DEFAULT_MAX));
    const daily = Math.min(AUTOZAP_ABS_DAILY_MAX, Math.max(perZap, parseInt(e.target.value, 10) || perZap * AUTOZAP_DAILY_MULT));
    e.target.value = String(daily);
    await call({ type: 'SIDECAR_SET_SETTINGS', settings: { autoZapDailyMaxSats: daily } });
  });

  $('relay-add').addEventListener('click', async () => {
    const input = $('relay-input');
    let url = input.value.trim();
    if (!url) return;
    if (!/^wss?:\/\//.test(url)) url = 'wss://' + url;
    const relays = await call({ type: 'SIDECAR_GET_RELAYS' });
    relays[url] = { read: true, write: true };
    await call({ type: 'SIDECAR_SET_RELAYS', relays });
    input.value = '';
    renderSettings();
  });

  if (typeof chrome.runtime.requestUpdateCheck === 'function') {
    $('check-update-btn').addEventListener('click', () => {
      checkForUpdates($('check-update-btn'), $('check-update-status'));
    });
  } else {
    // Firefox has no on-demand update check — the browser updates add-ons itself.
    $('check-update-btn').hidden = true;
    $('check-update-status').textContent = 'Updates install automatically through your browser.';
  }

  $('export-vault-btn').addEventListener('click', () => exportVaultModal());
  $('import-vault-btn').addEventListener('click', () => $('import-vault-file').click());
  $('import-vault-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const file = JSON.parse(await f.text());
      importVaultModal(file);
    } catch (_) {
      toast('That file is not valid JSON.', 'error');
    }
  });

  // Danger zone: wipe all Sidecar data. Type-to-confirm, since it's irreversible
  // and destroys keys. The destructive button is .danger (not .primary), so the
  // modal's Enter-to-submit shortcut won't fire it — a deliberate click is required.
  $('reset-all-btn').addEventListener('click', () => {
    openModal((modal) => {
      const err = h('div', { className: 'error' });
      const warn = h('p', {
        className: 'hint',
        textContent:
          'This erases everything on this device: all accounts and private keys, wallet connections, per-site permissions, and settings. It cannot be undone — any account without a backed-up nsec is lost for good.',
      });
      const confirmInput = h('input', { type: 'text', placeholder: 'Type RESET to confirm' });
      const del = h('button', { className: 'danger', textContent: 'Erase everything' });
      del.disabled = true;
      const matches = () => confirmInput.value.trim().toUpperCase() === 'RESET';
      confirmInput.addEventListener('input', () => { del.disabled = !matches(); });
      del.addEventListener('click', async () => {
        if (!matches()) return;
        try {
          await call({ type: 'SIDECAR_RESET_ALL' });
          closeModal();
          await refresh(); // no keystore now → onboarding
          toast('Sidecar reset', 'success');
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Reset Sidecar?' }),
        warn,
        h('label', { textContent: 'Confirm' }),
        confirmInput,
        err,
        h('div', { className: 'actions' }, [del, cancel])
      );
      setTimeout(() => confirmInput.focus(), 50);
    });
  });

  $('change-pin-btn').addEventListener('click', () => {
    openModal((modal) => {
      const oldP = h('input', { type: 'password', placeholder: 'Current PIN', maxLength: MAX_PIN_LEN });
      const newP = h('input', { type: 'password', placeholder: 'New PIN', maxLength: MAX_PIN_LEN });
      const newP2 = h('input', { type: 'password', placeholder: 'Confirm new PIN', maxLength: MAX_PIN_LEN });
      const err = h('div', { className: 'error' });
      const save = h('button', { className: 'primary', textContent: 'Change PIN' });
      save.addEventListener('click', async () => {
        err.textContent = '';
        if (newP.value.length < MIN_PIN_LEN) return (err.textContent = `New PIN must be at least ${MIN_PIN_LEN} characters.`);
        if (newP.value.length > MAX_PIN_LEN) return (err.textContent = `Max ${MAX_PIN_LEN} characters.`);
        if (newP.value !== newP2.value) return (err.textContent = 'New PINs do not match.');
        try {
          await call({ type: 'SIDECAR_CHANGE_PIN', oldPin: oldP.value, newPin: newP.value });
          closeModal();
          toast('PIN changed', 'success');
        } catch (e) {
          err.textContent = e.message;
          toast(e.message, 'error');
        }
      });
      const cancel = h('button', { className: 'ghost', textContent: 'Cancel' });
      cancel.addEventListener('click', closeModal);
      modal.append(
        h('h3', { textContent: 'Change PIN' }),
        oldP,
        newP,
        newP2,
        err,
        h('div', { className: 'actions' }, [save, cancel])
      );
      // Live strength/match feedback on the new-PIN pair; gates the Change button.
      attachPinValidation(newP, newP2, save);
    });
  });

  // ---- inline signing approval ----
  // The service worker owns an observable approval queue. While this panel's
  // "sidepanel" port is open it pings SIDECAR_QUEUE_UPDATED on every change; we
  // pull the authoritative state with SIDECAR_GET_PENDING and render the head
  // approval inline (replying with SIDECAR_PROMPT_RESULT), plus the backlog and
  // any interrupted tombstones. When the panel is closed the worker falls back to
  // a popup window instead.
  let pendingApproval = null; // { id, data, chosenPubkey }

  const APPROVAL_METHOD_LABELS = {
    getPublicKey: 'see your public key (npub)',
    signEvent: 'sign an event with your key',
    getRelays: 'read your relay list',
    'nip04.encrypt': 'encrypt a message (NIP-04)',
    'nip04.decrypt': 'decrypt a message (NIP-04)',
    'nip44.encrypt': 'encrypt a message (NIP-44)',
    'nip44.decrypt': 'decrypt a message (NIP-44)',
    'webln.getInfo': 'see your wallet info',
    'webln.getBalance': 'see your wallet balance',
    'webln.makeInvoice': 'create a Lightning invoice',
  };

  const isPaymentApproval = (data) => data.scope === 'webln' && data.method === 'sendPayment';

  // Human-readable labels for the event kinds sites most commonly ask Sidecar to
  // sign (not exhaustive — see https://nips.nostr.com for the full registry).
  // Prefixed APPROVAL_ to avoid colliding with the small KIND_LABELS map used by
  // the backup/restore UI (kind:0/3/10000/10002 only).
  const APPROVAL_KIND_LABELS = {
    0: 'Profile metadata', 1: 'Note', 3: 'Follow list', 4: 'Encrypted DM (legacy)',
    5: 'Delete request', 6: 'Repost', 7: 'Reaction', 8: 'Badge award', 9: 'Chat message',
    11: 'Thread', 13: 'Seal', 14: 'Direct message', 15: 'File message', 16: 'Generic repost',
    17: 'Reaction (website)', 20: 'Picture', 21: 'Video', 22: 'Short video',
    62: 'Request to vanish',
    1018: 'Poll response', 1063: 'File metadata', 1068: 'Poll', 1111: 'Comment',
    1222: 'Voice message', 1244: 'Voice message reply', 1311: 'Live chat message',
    1337: 'Code snippet', 1984: 'Report', 1985: 'Label',
    4454: 'DM device key', 4455: 'DM key transfer', 4550: 'Community post approval',
    9041: 'Zap goal', 9321: 'Nutzap', 9734: 'Zap request', 9735: 'Zap receipt', 9802: 'Highlight',
    10000: 'Mute list', 10001: 'Pin list', 10002: 'Relay list', 10003: 'Bookmark list',
    10004: 'Communities list', 10005: 'Public chats list', 10006: 'Blocked relays list',
    10007: 'Search relays list', 10008: 'Profile badges', 10009: 'Groups list',
    10012: 'Favorite relays list', 10015: 'Interests list', 10020: 'Media follows',
    10030: 'Emoji list', 10044: 'DM encryption key', 10050: 'DM relay list',
    10063: 'Blossom server list',
    13194: 'Wallet info', 22242: 'Relay auth', 23194: 'Wallet request', 23195: 'Wallet response',
    24133: 'Remote signing handshake', 24242: 'Blossom authorization', 27235: 'HTTP auth',
    30000: 'Follow set', 30002: 'Relay set', 30003: 'Bookmark set', 30004: 'Curation set',
    30005: 'Video set', 30008: 'Badge set', 30009: 'Badge definition', 30015: 'Interest set',
    30017: 'Marketplace stall', 30018: 'Marketplace product', 30023: 'Long-form article',
    30024: 'Article draft', 30030: 'Emoji set', 30040: 'Publication index',
    30041: 'Publication content', 30078: 'App data', 30311: 'Live event',
    30312: 'Interactive room', 30313: 'Conference event', 30315: 'User status',
    30402: 'Classified listing', 30403: 'Classified listing draft', 30818: 'Wiki article',
    31234: 'Draft event', 31922: 'Calendar event (date)', 31923: 'Calendar event (time)',
    31924: 'Calendar', 31925: 'Calendar RSVP', 31989: 'Handler recommendation',
    31990: 'Handler info', 34235: 'Video (addressable)', 34236: 'Short video (addressable)',
    34550: 'Community definition', 39089: 'Starter pack', 39092: 'Media starter pack',
    39701: 'Web bookmark',
  };
  // Kinds worth a second look before signing: they either move/delete other
  // events, or normally belong to a wallet's own key rather than a NIP-07 site.
  const APPROVAL_KIND_WARNINGS = {
    5: 'Deletes other events — make sure you intended this.',
    62: 'Asks relays to delete all of your events — make sure you intended this.',
    23194: "Wallet requests are normally signed by the wallet app's own key, not your identity key. Unusual for a site to ask for this.",
    23195: "Wallet responses are normally signed by the wallet app's own key, not your identity key. Unusual for a site to ask for this.",
    24133: 'This is a remote-signing handshake — approving it could hand control of your account to another app or device.',
  };
  function approvalKindLabel(kind) {
    if (kind == null) return '—';
    return APPROVAL_KIND_LABELS[kind] ? kind + ' — ' + APPROVAL_KIND_LABELS[kind] : kind + ' (unrecognized kind)';
  }
  function approvalKindWarning(kind) {
    if (kind == null) return null;
    return APPROVAL_KIND_WARNINGS[kind] || (!APPROVAL_KIND_LABELS[kind] ? 'Unrecognized event kind — review carefully before approving.' : null);
  }
  // A request we can't read as an event at all — no integer kind, so there is nothing
  // to label, no tag count, and no content to preview. normalizeSignEventParams in
  // background.js now rejects these at the RPC boundary, so this should be
  // unreachable; it stays because the failure it replaces was a signing card showing a
  // bare "—" where the event should be, with Allow looking as ordinary as ever. If one
  // ever gets through again, say so on the card instead of showing a blank.
  // Duplicated verbatim in prompt.js — same words on both approval surfaces.
  const APPROVAL_UNREADABLE_WARNING =
    "Sidecar can't read this request as a nostr event. Don't allow it unless you know what this site is doing.";
  function approvalKindUnreadable(ev) {
    return !Number.isInteger(ev && ev.kind);
  }

  // The renderable note text for an event: kind:1 → its content; kind 6/16 reposts →
  // the embedded original event's content (a repost's content field is that event's
  // JSON). Falls back to the raw content if it isn't a parseable embedded event.
  function noteTextForEvent(ev) {
    if (ev.kind === 6 || ev.kind === 16) {
      try { const inner = JSON.parse(ev.content); if (inner && typeof inner.content === 'string') return inner.content; } catch (_) {}
    }
    return String(ev.content == null ? '' : ev.content);
  }

  // Event-content preview: short by default (keeps the "Signing as" account card in
  // view), expandable, with a Formatted/Raw toggle for note-like kinds (1, and 6/16
  // reposts). "Formatted" reuses the composer's renderNotePreview so @mentions, media,
  // and note/nevent/naddr embeds render as a client would show them; "Raw" is the
  // exact signed content. Other kinds show Raw only.
  function appendEventContent(container, ev) {
    const raw = String(ev.content == null ? '' : ev.content);
    const noteLike = ev.kind === 1 || ev.kind === 6 || ev.kind === 16;
    // Views: Formatted (composer render, note-like only), Raw (the content string),
    // JSON (the whole event pretty-printed — exactly what's being signed).
    const eventJson = () => { try { return JSON.stringify(ev, null, 2); } catch (_) { return raw; } };
    const modes = noteLike ? ['formatted', 'raw', 'json'] : ['raw', 'json'];
    const LABEL = { formatted: 'Formatted', raw: 'Raw', json: 'JSON' };
    let mode = modes[0];
    let expanded = false;

    const view = document.createElement('div');
    const paintView = () => {
      view.className = 'evpreview' + (expanded ? '' : ' clamped') + (mode === 'formatted' ? '' : ' mono');
      view.innerHTML = '';
      if (mode === 'formatted') renderNotePreview(view, noteTextForEvent(ev));
      else if (mode === 'json') view.textContent = eventJson();
      else view.textContent = raw;
    };
    paintView();
    container.appendChild(view);

    const controls = document.createElement('div');
    controls.className = 'evpreview-controls';

    // Mode buttons (Formatted / Raw / JSON) — the active one is highlighted.
    const modeRow = document.createElement('div');
    modeRow.className = 'evpreview-modes';
    const btns = {};
    const syncModes = () => { for (const md of modes) btns[md].classList.toggle('active', md === mode); };
    for (const md of modes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'evpreview-mode';
      b.textContent = LABEL[md];
      b.addEventListener('click', () => {
        if (mode === md) return;
        mode = md; paintView(); syncModes();
      });
      btns[md] = b;
      modeRow.appendChild(b);
    }
    syncModes();
    controls.appendChild(modeRow);

    // Show more/less — always available on every mode; toggles the clamp so the
    // preview stays compact (keeping the account card in view) but can expand.
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'evpreview-toggle';
    more.textContent = 'Show more';
    more.addEventListener('click', () => {
      expanded = !expanded;
      view.classList.toggle('clamped', !expanded);
      more.textContent = expanded ? 'Show less' : 'Show more';
    });
    controls.appendChild(more);
    container.appendChild(controls);
  }

  function renderApprovalPreview(data) {
    const box = $('approval-preview');
    box.innerHTML = '';
    const row = (k, v) =>
      h('div', { className: 'row' }, [h('span', { textContent: k }), h('span', { textContent: v })]);
    // Counterparty for encrypt/decrypt — never raw hex. Show an @name when we can
    // resolve one (cached now, or fetched to upgrade in place), otherwise an npub.
    const peerRow = (label, pubkey) => {
      let npub = '';
      try { npub = pubkey ? NT.nip19.npubEncode(pubkey) : ''; } catch (_) {}
      const cached = pubkey ? cachedProfile(pubkey) : null;
      const idFull = npub || pubkey || '';
      const idShort = npub ? shortNpub(npub) : (pubkey || '—');
      // Raw hex on hover; click the npub to reveal (and select) the full key.
      const idTitle = [npub && ('npub: ' + npub), pubkey && ('hex: ' + pubkey)].filter(Boolean).join('\n');
      // Truncated by default; click toggles to the full, untruncated key and back.
      const idSpan = (cls) => {
        const s = h('span', { className: cls, textContent: idShort, title: idTitle });
        if (idFull && idFull !== idShort) {
          let full = false;
          s.classList.add('peer-npub-toggle');
          s.addEventListener('click', () => {
            full = !full;
            s.textContent = full ? idFull : idShort;
            s.classList.toggle('full', full);
          });
        }
        return s;
      };
      const val = h('span', { className: 'peer-val' });
      // Show the resolved @name when we have one, but ALWAYS keep the npub visible
      // beneath it as a verifiable key — a display name on its own is spoofable.
      // With no name, the npub is the only line.
      const paint = (name) => {
        val.innerHTML = '';
        if (name) {
          val.append(h('span', { className: 'peer-name', textContent: '@' + name }));
          val.append(idSpan('peer-npub'));
        } else {
          val.append(idSpan('peer-id'));
        }
      };
      paint(cached && cached.name);
      if (pubkey && !(cached && cached.name)) {
        fetchPreviewProfile(pubkey).then((p) => { if (p && p.name) paint(p.name); });
      }
      return h('div', { className: 'row' }, [h('span', { textContent: label }), val]);
    };
    if (isPaymentApproval(data)) {
      box.append(row('Amount', data.amountSats != null ? fmtSats(data.amountSats) + ' sats' : 'set by invoice'));
      if (data.memo) box.append(row('Memo', String(data.memo)));
    } else if (data.method === 'signEvent') {
      const ev = (data.params && (data.params.event || data.params)) || {};
      const unreadable = approvalKindUnreadable(ev);
      box.append(row('Kind', unreadable ? 'Unreadable' : approvalKindLabel(ev.kind)));
      if (Array.isArray(ev.tags)) box.append(row('Tags', String(ev.tags.length)));
      const warning = unreadable ? APPROVAL_UNREADABLE_WARNING : approvalKindWarning(ev.kind);
      if (warning) box.append(h('div', { className: 'kind-warn', textContent: warning }));
      // Destructive replaceable overwrite (see replaceable-baseline.js) — louder than
      // the kind warning above, because this one is about losing data you already have.
      if (data.destructive && data.destructive.message) {
        // Reject sits INSIDE the warning and Allow/Trust start disabled, unlocked only
        // by an explicit "I understand". Approving normally means tapping where Allow
        // always is — muscle memory that's fine for a note and wrong for a wipe. The
        // safe choice should be the reachable one; the destructive choice should cost
        // a deliberate second action.
        const reject = h('button', {
          className: 'destructive-warn-reject',
          textContent: "Don't allow",
        });
        reject.addEventListener('click', () => decideApproval('reject'));
        const ack = h('button', {
          className: 'destructive-warn-ack',
          textContent: 'I understand',
        });
        ack.addEventListener('click', () => {
          setApprovalLocked(false);
          ack.remove();
          // Say what changed rather than just removing the button — otherwise the
          // buttons below silently become live and it isn't obvious why.
          box.querySelector('.destructive-warn').append(
            h('p', { className: 'destructive-warn-unlocked', textContent: 'Approval unlocked below.' })
          );
        });
        box.append(
          h('div', { className: 'destructive-warn' }, [
            h('div', { className: 'destructive-warn-title' }, [
              icon('alert'),
              h('span', { textContent: 'This action erases data' }),
            ]),
            h('p', { className: 'destructive-warn-body', textContent: data.destructive.message }),
            h('p', {
              className: 'destructive-warn-hint',
              textContent: 'If you didn\'t mean to do this, don\'t allow it — the version on your relays stays as it is.',
            }),
            h('div', { className: 'destructive-warn-actions' }, [reject, ack]),
          ])
        );
      }
      // Unreadable: show the payload even with no content field, because the JSON view
      // is then the only description of what's being signed.
      if (ev.content || unreadable) appendEventContent(box, ev);
    } else if (data.method === 'nip04.decrypt' || data.method === 'nip44.decrypt') {
      box.append(peerRow('From', data.params && data.params.pubkey));
    } else if (data.method === 'nip04.encrypt' || data.method === 'nip44.encrypt') {
      box.append(peerRow('To', data.params && data.params.pubkey));
    } else {
      hide(box);
      return;
    }
    show(box);
  }

  // All accounts selectable in this prompt: the one it opened with, plus (only
  // for a fresh-site login — see canOfferAccountSwitch in background.js) any
  // others the user could switch to before approving.
  function approvalAccountList(data) {
    return [
      { pubkey: data.activePubkey, npub: data.npub, name: data.accountName, picture: data.accountPicture },
      ...(data.otherAccounts || []),
    ];
  }

  // Shared-identity explainer: the first time a shared-host confirm appears, show a
  // one-time "Heads up!" card; after the user dismisses it, every later confirm just
  // carries a compact "Multiple accounts used" caption above the "Signing as" line.
  let sharedHeadsUpDismissed = false;
  chrome.storage.local.get('sharedHeadsUpDismissed', (r) => {
    sharedHeadsUpDismissed = !!(r && r.sharedHeadsUpDismissed);
  });
  function renderSharedNote(data) {
    const existing = $('approval-shared-note');
    if (existing) existing.remove();
    if (!data.sharedIdentity) {
      $('approval-switch-toggle').textContent = 'Sign in with a different account';
      return;
    }
    $('approval-switch-toggle').textContent = 'Sign as a different account';
    const acct = $('approval-account');
    if (!acct) return;
    let note;
    if (sharedHeadsUpDismissed) {
      note = h('div', { id: 'approval-shared-note', className: 'shared-caption' }, [
        icon('users'),
        h('span', { textContent: 'Multiple accounts used' }),
      ]);
    } else {
      note = h('div', { id: 'approval-shared-note', className: 'shared-headsup' }, [
        h('div', { className: 'shared-headsup-title' }, [icon('users'), h('span', { textContent: 'Heads up!' })]),
        h('p', {
          className: 'shared-headsup-body',
          textContent: "Multiple accounts are signed in here — confirm who's posting each time.",
        }),
      ]);
      const got = h('button', { className: 'shared-headsup-btn', textContent: 'Got it' });
      got.addEventListener('click', () => {
        sharedHeadsUpDismissed = true;
        chrome.storage.local.set({ sharedHeadsUpDismissed: true });
        renderSharedNote(data); // collapse to the compact caption immediately
      });
      note.append(got);
    }
    acct.parentNode.insertBefore(note, acct);
  }

  // Scope-of-consent note: some Allows are broader than the single request on
  // screen. A decrypt Allow covers a burst for about a minute (so a client can
  // load an inbox without a prompt per message), and a WebLN-read Allow covers
  // the rest of the session (the gate lives in background.js). The popup says
  // this under its preview card; the panel's approval card must say it too —
  // approvals render in BOTH surfaces, and only the popup had the notes. Wording
  // matches prompt.js exactly so the two never drift into different stories.
  function renderConsentNote(data) {
    const note = $('approval-consent-note');
    if (!note) return;
    if (data.method === 'nip04.decrypt' || data.method === 'nip44.decrypt') {
      let text =
        'Allowing lets ' + data.host + ' decrypt your messages for about a minute — enough to load a conversation or inbox without asking for each one.';
      // Audit K4: decrypt is the sharpest edge of the Trust tier — a trusted site
      // silently reads every future DM until revoked. Only while the Trust button
      // is visible in showApproval (pure-unlock and shared-identity hide it;
      // decrypts never batch). Identical condition and sentence as prompt.js —
      // keep the two surfaces in step.
      if (!(data.needUnlock && !data.needApproval) && !data.sharedIdentity) {
        text += ' Trust this site and it can read your messages without asking, until you revoke.';
      }
      note.textContent = text;
    } else if (data.method === 'webln.getBalance' || data.method === 'webln.getInfo' || data.method === 'webln.makeInvoice') {
      note.textContent =
        'Allowing lets ' + data.host + ' read wallet info from Sidecar for the rest of this session.';
    } else {
      hide(note);
      return;
    }
    show(note);
  }

  // Disable/enable the approval prompt's Allow once + Trust this site while a
  // destructive overwrite is unacknowledged. Reject is deliberately left alone — the
  // safe way out must never be gated. The class on the footer dims the pair so they
  // read as unavailable rather than merely unresponsive.
  function setApprovalLocked(locked) {
    const allow = $('approval-allow');
    const trust = $('approval-trust');
    if (allow) allow.disabled = locked;
    if (trust) trust.disabled = locked;
    const actions = allow && allow.parentNode; // .approval-actions, not the card
    if (actions) actions.classList.toggle('approval-locked', locked);
  }

  function renderApprovalAccountCapsule(data) {
    const payment = isPaymentApproval(data);
    const list = approvalAccountList(data);
    const chosen = list.find((a) => a.pubkey === pendingApproval.chosenPubkey) || list[0];

    const acct = $('approval-account');
    acct.innerHTML = '';
    acct.append(h('div', { className: 'approval-as', textContent: payment ? 'Paying from' : 'Signing as' }));
    acct.append(
      h('div', { className: 'active-account approval-capsule' }, [
        avatarEl({ picture: chosen.picture }, 'aa-avatar'),
        h('div', { className: 'aa-info' }, [
          h('div', { className: 'aa-label', textContent: chosen.name || shortNpub(chosen.npub) }),
          h('div', { className: 'aa-npub', textContent: shortNpub(chosen.npub) }),
        ]),
      ])
    );

    const toggle = $('approval-switch-toggle');
    const menu = $('approval-switch-menu');
    const canSwitch = !payment && Array.isArray(data.otherAccounts) && data.otherAccounts.length > 0;
    menu.innerHTML = '';
    hide(menu);
    if (!canSwitch) {
      hide(toggle);
      return;
    }
    show(toggle);
    toggle.onclick = () => {
      if (menu.classList.contains('hidden')) {
        buildApprovalSwitchMenu(data, list, chosen.pubkey);
        show(menu);
      } else {
        hide(menu);
      }
    };
  }

  function buildApprovalSwitchMenu(data, list, chosenPubkey) {
    const menu = $('approval-switch-menu');
    menu.innerHTML = '';
    list.forEach((a) => {
      const isChosen = a.pubkey === chosenPubkey;
      const row = h('button', { className: 'acct-row' + (isChosen ? ' active' : '') });
      const av = document.createElement('span');
      av.className = 'acct-row-av';
      applyAvatar(av, a);
      row.append(
        av,
        h('div', { className: 'acct-row-info' }, [
          h('div', { className: 'acct-row-name', textContent: a.name || shortNpub(a.npub) }),
          h('div', { className: 'acct-row-npub', textContent: shortNpub(a.npub) }),
        ])
      );
      if (isChosen) {
        const c = icon('check');
        c.classList.add('acct-row-check');
        row.append(c);
      }
      row.addEventListener('click', () => {
        pendingApproval.chosenPubkey = a.pubkey;
        hide(menu);
        renderApprovalAccountCapsule(data);
      });
      menu.append(row);
    });
  }

  // "Wrong account?" escape. Offers exactly the accounts the switcher above cannot: it
  // appears only once 2+ accounts have logged in on this host, and even then it is scoped
  // to those accounts, so a user whose intended identity is a third one has no control at
  // all. This is that control. See the gate in background.js — the two lists are disjoint
  // by construction, so this never repeats a row the switcher already offers.
  //
  // Picking a row detaches the host and makes that account active — the same primitive as
  // Settings -> Sites -> "Use <account>", reachable from the moment the problem is
  // actually discovered instead of three levels into Settings.
  //
  // Shown generously (see the gate in background.js — any content sign with 2+ accounts).
  // Sidecar can't see the client's UI, so it can't tell a correct prompt from a wrong one;
  // only the user can.
  function renderWrongAcctEscape(data) {
    const hint = $('approval-wrong-acct');
    const toggle = $('approval-wrong-acct-toggle');
    const list = $('approval-wrong-acct-list');
    if (!hint || !toggle || !list) return;
    // Collapse on every render, not just the first: the panel re-shows the approval on
    // queue advance and unlock, and an expanded list left over from the previous request
    // would be offering to detach a different host.
    list.innerHTML = '';
    hide(list);
    toggle.setAttribute('aria-expanded', 'false');
    const accts = Array.isArray(data.allAccounts) ? data.allAccounts : [];
    if (!data.wrongAccountEscape || !accts.length) {
      hide(hint);
      return;
    }
    show(hint);
    toggle.onclick = () => {
      if (list.classList.contains('hidden')) {
        buildWrongAcctList(data, accts);
        show(list);
        toggle.setAttribute('aria-expanded', 'true');
      } else {
        hide(list);
        toggle.setAttribute('aria-expanded', 'false');
      }
    };
  }

  function buildWrongAcctList(data, accts) {
    const list = $('approval-wrong-acct-list');
    list.innerHTML = '';
    // Only the two things the user can't learn afterwards: that this cancels, and that the
    // switch is app-wide rather than just this site. "Makes the selected account active"
    // carries the second in Sidecar's own vocabulary, tying to the ACTIVE tag on the row
    // below.
    // The reconnect instruction is deliberately NOT here — it lands as a toast the moment
    // the detach settles, with the account name filled in, which this can't do. Three lines
    // of lede in a sidebar to pre-announce it was too much.
    list.append(h('p', { className: 'wrong-acct-lede', textContent: 'Cancels this request and makes the selected account active.' }));
    accts.forEach((a) => {
      const row = h('button', { className: 'acct-row' });
      const av = document.createElement('span');
      av.className = 'acct-row-av';
      applyAvatar(av, a);
      row.append(
        av,
        h('div', { className: 'acct-row-info' }, [
          h('div', { className: 'acct-row-name', textContent: a.name || shortNpub(a.npub) }),
          h('div', { className: 'acct-row-npub', textContent: shortNpub(a.npub) }),
        ])
      );
      if (a.active) row.append(h('span', { className: 'wrong-acct-tag', textContent: 'Active' }));
      row.addEventListener('click', () => decideApproval('detach', { detachPubkey: a.pubkey }));
      list.append(row);
    });
  }

  function showApproval() {
    if (!pendingApproval) return;
    const data = pendingApproval.data;
    // Only initialize once per prompt — an incidental refresh() re-render (the
    // panel treats a pending approval as modal and re-shows it) must not stomp
    // a switch the user already picked.
    if (pendingApproval.chosenPubkey == null) pendingApproval.chosenPubkey = data.activePubkey;
    closeAcctMenu();
    // A signing approval outranks anything else on screen. An open modal — the
    // notifications list, the composer, settings — used to cover it: .modal-overlay
    // is z-index 100 and this was 50, so the request sat hidden and silently timed
    // out while the user read something else. The CSS now puts this at 120, but
    // leaving a modal open underneath is still a trap: dismissing the approval would
    // reveal a stale modal the user had forgotten, and the approval's own backdrop
    // click would land on it.
    //
    // Non-destructive: both draft-bearing modals persist on close (the composer via
    // its onClose -> persistDraft, page comments on every keystroke), so nothing the
    // user typed is lost.
    // Show FIRST, then close the modal. The reverse order leaves the panel briefly
    // uncovered between the two calls, which lets a deferred renderMain() (see
    // panelIsCovered) fire in the gap and delays the approval by a frame.
    show($('view-approval'));
    if (document.documentElement.classList.contains('modal-open')) closeModal();

    const payment = isPaymentApproval(data);
    $('approval-host').textContent = data.host;
    $('approval-ask').textContent = payment
      ? 'wants to send a Lightning payment'
      : 'wants to ' + (APPROVAL_METHOD_LABELS[data.method] || data.method);

    renderApprovalAccountCapsule(data);
    renderWrongAcctEscape(data);

    // Shared-identity confirm: host signed in with 2+ of your accounts. Make the
    // "who's posting" choice explicit; relabel the switcher for signing context.
    renderSharedNote(data);

    renderApprovalPreview(data);

    // After the preview so the note sits just under it, mirroring prompt.html.
    renderConsentNote(data);

    $('approval-error').textContent = '';
    $('approval-pin-error').textContent = '';
    // Lock Allow/Trust behind the warning's "I understand" when this event destroys
    // data. Applied here, after renderApprovalPreview built the warning, so a re-render
    // (queue advance, unlock) re-locks rather than leaving a previous acknowledgement
    // standing for a different event.
    setApprovalLocked(!!(data.destructive && data.destructive.message));
    const allow = $('approval-allow');
    const trust = $('approval-trust');
    const pin = $('approval-pin');
    pin.value = '';
    if (data.needUnlock) {
      show($('approval-unlock'));
      // With auto-lock on Never, the only thing that can have locked this is the
      // browser closing — the key lives in memory for the session, never on disk.
      // Say so, or the setting looks broken. Mirrors prompt.js.
      const unlockLabel = $('approval-unlock').querySelector('label');
      if (unlockLabel) {
        unlockLabel.textContent = data.autoLockNever
          ? 'Enter your PIN — first unlock since your browser started'
          : 'Enter your PIN to unlock';
      }
      setTimeout(() => pin.focus(), 50);
    } else {
      hide($('approval-unlock'));
    }

    // The payment card offered to enable automatic zaps; confirm it here.
    if (data.offerAutoZap > 0) {
      $('approval-autozap-offer').classList.remove('hidden');
      $('approval-autozap-offer-label').textContent =
        'Turn on Auto Zaps (' + fmtSats(data.offerAutoZap) + ' sats max)';
    }

    // Payment: one Pay button + an optional "remember a budget" toggle (no Trust).
    const remember = $('approval-remember');
    const rememberBudget = $('approval-remember-budget');
    const budgetAmount = $('approval-budget-amount');
    if (payment) {
      allow.textContent = data.amountSats != null ? 'Pay ' + fmtSats(data.amountSats) + ' sats' : 'Pay';
      hide(trust);
      show(remember);
      rememberBudget.checked = false;
      budgetAmount.value = String(data.amountSats != null ? Math.max(data.amountSats * 5, 5000) : 5000);
      budgetAmount.disabled = true;
      rememberBudget.onchange = () => {
        budgetAmount.disabled = !rememberBudget.checked;
        if (rememberBudget.checked) budgetAmount.focus();
      };
    } else {
      hide(remember);
      // A pure unlock (site already trusted, keystore just locked) has nothing to
      // approve — relabel and drop the "Trust this site" choice.
      if (data.needUnlock && !data.needApproval) {
        allow.textContent = 'Unlock & continue';
        hide(trust);
      } else {
        // WebLN reads grant the rest of the session (the consent note under the
        // preview says so) — the button can't claim "once" when it means "until
        // Sidecar locks". Mirrors the payment relabel just above.
        allow.textContent =
          data.method === 'webln.getBalance' || data.method === 'webln.getInfo' || data.method === 'webln.makeInvoice'
            ? 'Allow this session'
            : 'Allow once';
        show(trust);
      }
    }
    // Shared-identity confirms happen on EVERY content sign to this host, not
    // just a detected mismatch, so "Trust this site" can't skip future ones —
    // the same signature that's fine now could be wrong next time. Hide it
    // rather than over-promise (must run after the payment/unlock branches
    // above, which otherwise re-show it).
    if (data.sharedIdentity) hide(trust);

    // Batch: a burst of same-site/same-account/same-kind content signs (e.g.
    // Primal's app-data sync) collapses into one "Allow all (N)" so the user
    // isn't nagged per event. The preview still shows one representative and the
    // kind, so it's clear what the N are. (Must run last so it wins the labels.)
    const groupN = pendingApproval.groupIds ? pendingApproval.groupIds.length : 1;
    if (!payment && groupN > 1) {
      $('approval-ask').textContent = 'wants to sign ' + groupN + ' events with your key';
      allow.textContent = 'Allow all (' + groupN + ')';
      hide(trust);
    }

    // Offer a timed auto-sign window on single content-sign approvals — the
    // shared-host escape hatch, and a middle rung between Allow once and Trust.
    // Hidden for payments, decrypts, relay-auth, pure unlocks, and batched bursts
    // (those already collapse into "Allow all").
    //
    // Also hidden on a destructive overwrite. Offering "auto-sign for 30 min" directly
    // beneath "this erases data" invites the one tap that does real harm: approving the
    // wipe ALSO makes the wiped list the new baseline, so within that window a second
    // overwrite has nothing left to lose and won't warn. A client that just tried to
    // clear your follow list is precisely the one that shouldn't get a free window.
    //
    // `relaxEligible` comes from the background (RELAX.neverRelaxes) and is the
    // authority on which KINDS a window may ever cover — account/wallet-control, and
    // the replaceable 0/3/10000 whose next write inside the window would go through
    // unwarned. Honoring the flag rather than re-deriving the rule is the point: this
    // gate, prompt.js's, and the background's were three separate copies, and a
    // profile edit that wasn't itself destructive slipped past all but the background.
    const relaxRow = $('approval-relax-row');
    const offerRelax =
      !payment && groupN === 1 && data.needApproval && !data.destructive &&
      data.relaxEligible !== false &&
      (data.method === 'signEvent' || data.method === 'nip04.encrypt' || data.method === 'nip44.encrypt');
    if (offerRelax) {
      show(relaxRow);
      relaxRow.querySelectorAll('.relax-chip').forEach((chip) => {
        chip.onclick = () => decideApproval('relax', { relaxMs: Number(chip.dataset.mins) * 60000 });
      });
    } else {
      hide(relaxRow);
    }

    // Point at Trust once this site has been approved one-time several times over.
    // textContent, never innerHTML — `host` is attacker-controlled.
    const nudge = $('approval-trust-nudge');
    nudge.textContent = '';
    if (data.nudgeTrust && !payment) {
      const strong = h('strong', { textContent: data.host || 'this site' });
      nudge.append(
        document.createTextNode('Approving this often? Trust '),
        strong,
        document.createTextNode(' to stop being asked.')
      );
      show(nudge);
    } else {
      hide(nudge);
    }
  }

  async function decideApproval(action, opts) {
    if (!pendingApproval) return;
    const { id, data } = pendingApproval;
    const err = $('approval-error');
    const pinErr = $('approval-pin-error');
    err.textContent = '';
    pinErr.textContent = '';
    // Unlock first if needed. 'detach' is in here even though it never signs: it clears
    // the site binding and moves the GLOBAL active account, and without it a locked prompt
    // would be the one surface that can change persistent state with no authentication —
    // reachable by anyone at an unattended browser who can make a site ask for a
    // signature. Reject stays ungated; the safe way out must never need a PIN.
    if (data.needUnlock && (action === 'once' || action === 'trust' || action === 'relax' || action === 'detach')) {
      const pin = $('approval-pin').value;
      if (!pin) {
        pinErr.textContent = 'Enter your PIN.';
        return;
      }
      // SIDECAR_UNLOCK contract (see background.js): branch on result.status, not ok.
      const resp = await bg({ type: 'SIDECAR_UNLOCK', pin });
      const st = resp && resp.ok && resp.result;
      if (!st || st.status !== 'ok') {
        pinErr.textContent =
          st && st.status === 'throttled' ? 'Too many attempts. Try again in ' + Math.ceil(st.waitMs / 1000) + 's.'
          : st && st.status === 'bad' ? 'Incorrect PIN — ' + st.remaining + ' attempt' + (st.remaining === 1 ? '' : 's') + ' left before all data is erased.'
          : st && st.status === 'wiped' ? 'Too many attempts — all data on this device was erased.'
          : (resp && resp.error) || 'Incorrect PIN';
        $('approval-pin').value = '';
        $('approval-pin').focus();
        return;
      }
    }
    let extra = null;
    // Payment + "remember a budget" checked → set an allowance for this site.
    if (isPaymentApproval(data) && action === 'once' && $('approval-remember-budget').checked) {
      const budgetSats = parseInt($('approval-budget-amount').value, 10);
      if (!budgetSats || budgetSats < 1) {
        err.textContent = 'Enter a budget in sats, or uncheck the box.';
        return;
      }
      action = 'budget';
      // Merge, don't assign — other flags share this object (see prompt.js).
      extra = Object.assign({}, extra, { budgetSats, perPaymentSats: 0 });
    }
    // "Wrong account" escape: carry the account to make active. The background detaches
    // and then throws, so this never signs.
    if (action === 'detach') {
      extra = Object.assign({}, extra, { detachPubkey: (opts && opts.detachPubkey) || '' });
    }
    // Timed auto-sign window chosen via the relax chips.
    if (action === 'relax') {
      extra = Object.assign({}, extra, { relaxMs: (opts && opts.relaxMs) || 15 * 60000 });
    }
    // Carry the still-ticked auto-zap offer back with the approval. Only an approval
    // reaches here, so declining the payment can never enable the setting.
    if (pendingApproval && pendingApproval.data && pendingApproval.data.offerAutoZap > 0 &&
        $('approval-autozap-offer-box').checked) {
      extra = Object.assign({}, extra, { enableAutoZap: true });
    }
    // Picked a different account in the switcher (fresh-login prompts only).
    if (pendingApproval.chosenPubkey && pendingApproval.chosenPubkey !== data.activePubkey) {
      extra = Object.assign({}, extra, { switchToPubkey: pendingApproval.chosenPubkey });
    }
    // Batch: an "Allow all (N)" / "Reject all" on a same-kind burst applies the
    // same decision (and account choice) to every grouped request at once. Trust
    // and budget are never batched (they're single-item / payment concerns).
    const groupIds = pendingApproval.groupIds || [id];
    if (groupIds.length > 1 && (action === 'once' || action === 'reject')) {
      await bg({ type: 'SIDECAR_PROMPT_RESULT_BATCH', ids: groupIds, action, extra });
    } else {
      await bg({ type: 'SIDECAR_PROMPT_RESULT', id, action, extra });
    }
    // Detach settled: say what to do next, in Sidecar. The background throws the same
    // instruction as the signing error, but that goes to the CLIENT — a client that
    // swallows signing errors would leave the user with no next step at all. Same string
    // as switchSiteModal's, so the Settings route and this one read identically.
    if (action === 'detach') {
      const picked = (data.allAccounts || []).find((a) => a.pubkey === (opts && opts.detachPubkey));
      toast(
        'Detached. Sign out of ' + data.host + ' and back in as ' +
          ((picked && picked.name) || 'that account') + '.',
        'success'
      );
    }
    $('approval-pin').value = '';
    // Leave pendingApproval set so refreshApproval() knows an approval was up:
    // it shows the next queued one, or (queue empty) restores + re-syncs the base
    // view. Nulling it here would skip that base refresh, leaving panel state stale.
    await refreshApproval();
    // The relax grant is written in the background AFTER SIDECAR_PROMPT_RESULT
    // responds, so the broadcast can land before/after this point. Re-sync shortly
    // to make sure the bottom status bar appears the moment the window opens.
    if (action === 'relax') setTimeout(syncRelax, 500);
  }

  $('approval-allow').addEventListener('click', () => decideApproval('once'));
  $('approval-trust').addEventListener('click', () => decideApproval('trust'));
  $('approval-reject').addEventListener('click', () => decideApproval('reject'));
  // Escape hatch: reject the whole backlog at once (this request + all waiting).
  $('approval-reject-all').addEventListener('click', async () => {
    pendingApproval = null;
    await bg({ type: 'SIDECAR_REJECT_ALL_PENDING' });
    await refreshApproval();
  });
  // Tapping the dimmed backdrop (outside the card) rejects, like closing the popup.
  $('view-approval').addEventListener('click', (e) => {
    if (e.target === $('view-approval')) decideApproval('reject');
  });
  $('approval-pin').addEventListener('keydown', (e) => {
    // Respect the destructive lock: Enter here calls decideApproval directly, so
    // without this check it would approve a wipe that the disabled Allow button is
    // supposed to be holding back.
    if (e.key === 'Enter' && !$('approval-allow').disabled) decideApproval('once');
  });
  // Numeric-only, capped budget input (static element, so not built via satsInput).
  $('approval-budget-amount').addEventListener('input', (e) => {
    let v = e.target.value.replace(/[^0-9]/g, '');
    if (v) v = String(Math.min(parseInt(v, 10), MAX_SATS));
    e.target.value = v;
  });

  // The background owns the observable approval queue; the panel is a pure view
  // of it. Pull the authoritative state and render: the head card, the "N more
  // waiting" strip + Reject all, and any interrupted tombstones. Called on port
  // (re)connect, on every SIDECAR_QUEUE_UPDATED ping, and after each decision —
  // so the panel can never desync from what's actually pending.
  // Render the approval overlay from the queue. Returns whether a head is showing.
  // Non-recursive (never calls refresh) so it's safe to invoke from refresh() at
  // render time — that's what makes the overlay survive a panel reload with a
  // pending approval (no race where refresh() hides what this just showed).
  async function syncApprovalOverlay() {
    let resp;
    try { resp = await bg({ type: 'SIDECAR_GET_PENDING' }); } catch (_) { return !!pendingApproval; }
    const view = resp && resp.ok ? resp.result : null;
    if (!view) return !!pendingApproval;
    renderInterrupted(view.interrupted || []);
    const head = view.head;
    if (head) {
      const group = head.groupIds && head.groupIds.length ? head.groupIds : [head.id];
      if (!pendingApproval || pendingApproval.id !== head.id) {
        pendingApproval = { id: head.id, data: head.data, groupIds: group, chosenPubkey: null };
        closeModal();
        showApproval();
      } else if (!pendingApproval.groupIds || pendingApproval.groupIds.length !== group.length) {
        // Same head, but more same-kind requests arrived (or drained) — re-render
        // the batch count without resetting the user's account pick.
        pendingApproval.groupIds = group;
        showApproval();
      } else {
        // Same head, already built — just ensure the overlay is visible. This is
        // what makes it robust to an intervening refresh() that hid all views
        // (e.g. on a panel reload while a request is pending): showApproval only
        // runs on a head change, so without this the overlay could stay hidden.
        show($('view-approval'));
      }
      renderBacklog(view.waiting || []);
      return true;
    }
    pendingApproval = null;
    renderBacklog([]);
    hide($('view-approval'));
    flushDeferredMainRender(); // the approval card is gone — draw anything skipped behind it
    return false;
  }

  // The background owns the observable approval queue; the panel is a pure view
  // of it. Called on port (re)connect, on every SIDECAR_QUEUE_UPDATED ping, and
  // after each decision. When the queue empties while an approval was up, restore
  // the normal view.
  async function refreshApproval() {
    const wasShowing = !!pendingApproval;
    const hasHead = await syncApprovalOverlay();
    // keepWallet: an approval can move the active account, and refresh() checks for that
    // itself — but it cannot change what is IN a wallet, so the view does not need
    // rebuilding from the relay just because a signature was approved.
    if (!hasHead && wasShowing) refresh({ keepWallet: true });
  }

  // "N more waiting" strip inside the approval card + a Reject all escape hatch.
  function renderBacklog(waiting) {
    const strip = $('approval-backlog');
    if (!strip) return;
    if (!waiting.length) { hide(strip); return; }
    const count = $('approval-backlog-count');
    count.textContent = waiting.length + (waiting.length === 1 ? ' more request waiting' : ' more requests waiting');
    show(strip);
  }

  // Requests that were in flight when Sidecar's service worker restarted. Their
  // page channels are gone (the sites already got an error/timeout), so they
  // can't be signed — surface them honestly as dismissible tombstones.
  function renderInterrupted(list) {
    const banner = $('interrupted-banner');
    if (!banner) return;
    if (!list.length) { hide(banner); banner.innerHTML = ''; return; }
    banner.innerHTML = '';
    const msg = h('span', { className: 'interrupted-msg', textContent:
      list.length + (list.length === 1 ? ' signing request was' : ' signing requests were') +
      ' interrupted when Sidecar restarted — the site' + (list.length === 1 ? '' : 's') + ' will ask again.' });
    const dismiss = h('button', { className: 'interrupted-dismiss', textContent: 'Dismiss' });
    dismiss.addEventListener('click', async () => { await bg({ type: 'SIDECAR_DISMISS_INTERRUPTED' }); refreshApproval(); });
    banner.append(msg, dismiss);
    show(banner);
  }

  // Keep a live port to the worker: it's the SIDECAR_QUEUE_UPDATED signal channel
  // AND a keepalive that wakes/holds the worker. MV3 recycles it (~5 min, or on
  // SW sleep); on any drop we reconnect and re-pull. The background REVERTS (not
  // rejects) a shown approval when this port drops, so a blip can't lose a
  // request — it re-surfaces on reconnect.
  function connectApprovalPort() {
    let port;
    try {
      port = chrome.runtime.connect({ name: 'sidepanel' });
    } catch (_) {
      setTimeout(connectApprovalPort, 1000);
      return;
    }
    // Tell the worker which window this panel lives in. A side panel is
    // per-window, so the worker uses this to keep a cross-window request's
    // approval off this panel and on a popup over the right window instead.
    try {
      chrome.windows.getCurrent((w) => {
        if (!chrome.runtime.lastError && w && w.id != null) {
          try { port.postMessage({ type: 'panelWindow', windowId: w.id }); } catch (_) {}
        }
      });
    } catch (_) {}
    port.onMessage.addListener((msg) => {
      if (msg && msg.type === 'SIDECAR_QUEUE_UPDATED') refreshApproval();
      if (msg && msg.type === 'SIDECAR_LOG_UPDATED' && debugPanelRefresh) debugPanelRefresh();
    });
    port.onDisconnect.addListener(() => {
      // Not a failure: the background keeps pending requests alive and re-surfaces
      // them. Just hide the (now un-decidable) card and reconnect; refreshApproval
      // on reconnect restores the true state.
      pendingApproval = null;
      hide($('view-approval'));
      flushDeferredMainRender(); // the approval card is gone — draw anything skipped behind it
      setTimeout(connectApprovalPort, 250);
    });
    // Pull authoritative state on (re)connect.
    refreshApproval();
  }
  connectApprovalPort();

  // ---- dev build indicator ----
  // Local/unpacked builds only (see isDevBuild). On by default in dev so it's
  // immediately obvious which build is loaded; the toggle lets it be hidden for
  // clean screenshots. Never appears on the Chrome Web Store build, regardless of
  // a stored setting.
  async function initDevBadge() {
    await devBuildReady; // Firefox: don't decide before management.getSelf answers
    if (!isDevBuild()) return;
    show($('dev-settings-section'));
    syncSettingsSectionVisibility();
    const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
    $('dev-indicator-toggle').checked = settings.devIndicator !== false;
    applyDevBadge(settings.devIndicator !== false);
    $('dev-indicator-toggle').addEventListener('change', async (e) => {
      await call({ type: 'SIDECAR_SET_SETTINGS', settings: { devIndicator: e.target.checked } });
      applyDevBadge(e.target.checked);
    });
  }
  function applyDevBadge(on) {
    if (!isDevBuild()) return; // belt-and-suspenders: never show on a store build
    $('dev-badge').classList.toggle('hidden', !on);
  }

  // ---- debug panel ----
  // Reads the in-memory trace log the background keeps (message dispatch,
  // timings, uncaught SW errors — see background.js). Dev builds only, same
  // gate as the badge itself.
  let debugPanelRefresh = null; // set while the panel is open; re-pulls on SIDECAR_LOG_UPDATED

  function debugLogRow(e) {
    const row = h('div', { className: 'item debug-log-row debug-log-' + e.level });
    const parts = [];
    if (e.data) {
      if (e.data.method) parts.push(e.data.method);
      if (e.data.host) parts.push(e.data.host);
      if (e.data.ms != null) parts.push(e.data.ms + 'ms');
      if (e.data.version) parts.push('v' + e.data.version);
      if (e.data.error) parts.push(e.data.error);
      if (e.data.message) parts.push(e.data.message);
      if (e.data.reason) parts.push(e.data.reason);
      if (e.data.filename) parts.push(e.data.filename + (e.data.lineno != null ? ':' + e.data.lineno : ''));
    }
    row.append(h('div', { className: 'item-main' }, [
      h('div', { className: 'item-label', textContent: '[' + e.tag + '] ' + e.msg }),
      h('div', { className: 'item-sub', textContent: [new Date(e.ts).toLocaleTimeString(), ...parts].join(' · ') }),
    ]));
    return row;
  }

  function debugLogText(entries) {
    return entries.map((e) => {
      const meta = e.data ? ' ' + JSON.stringify(e.data) : '';
      return '[' + new Date(e.ts).toISOString() + '] ' + e.level.toUpperCase() + ' ' + e.tag + ': ' + e.msg + meta;
    }).join('\n');
  }

  async function openDebugPanel() {
    let entries = [];
    try { entries = await call({ type: 'SIDECAR_GET_DEBUG_LOG' }); } catch (_) {}

    openModal((modal) => {
      modal.classList.add('modal-sheet');

      const xBtn = h('button', { className: 'modal-x', title: 'Close' });
      xBtn.appendChild(icon('x'));
      xBtn.addEventListener('click', closeModal);
      modal.appendChild(xBtn);

      const build = window.SIDECAR_BUILD || {};
      const ver = build.version || (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
      const verText = ver + (build.commit && build.commit !== 'dev' ? ' (' + build.commit + ')' : '');
      modal.append(
        h('div', {}, [
          h('div', { className: 'notif-modal-title', textContent: 'Debug log' }),
          h('div', { className: 'hint', textContent: 'Sidecar ' + verText + ' · dev build' }),
        ])
      );

      const scroll = h('div', { className: 'notif-scroll' });
      const list = h('div', { className: 'list' });
      scroll.appendChild(list);
      modal.appendChild(scroll);

      function render() {
        if (!entries.length) {
          listState(list, 'No log entries yet — use the app and they’ll appear here.');
          return;
        }
        list.innerHTML = '';
        entries.slice().reverse().forEach((e) => list.append(debugLogRow(e)));
      }
      render();
      debugPanelRefresh = async () => {
        try { entries = await call({ type: 'SIDECAR_GET_DEBUG_LOG' }); } catch (_) { return; }
        render();
      };

      const copyBtn = h('button', { className: 'secondary', textContent: 'Copy' });
      copyBtn.addEventListener('click', async () => {
        try {
          await copyPlain(debugLogText(entries) || '(empty)');
          copyBtn.textContent = 'Copied ✓';
          setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
        } catch (_) {}
      });
      const clearBtn = h('button', { className: 'ghost', textContent: 'Clear' });
      clearBtn.addEventListener('click', async () => {
        try { entries = await call({ type: 'SIDECAR_CLEAR_DEBUG_LOG' }); } catch (_) { return; }
        render();
      });
      modal.append(h('div', { className: 'actions' }, [clearBtn, copyBtn]));
    }, () => { debugPanelRefresh = null; });
  }

  $('dev-badge').addEventListener('click', openDebugPanel);
  $('dev-badge').appendChild(icon('bug'));

  // ---- host (site) permission guard ----
  // Firefox MV3 shows https://*/* as a checkbox in the install prompt and lets
  // the user revoke it later from about:addons. Without the grant there is no
  // content script — no window.nostr, no paste guard, no pay card — and
  // background fetches lose their CORS exemption, so the signer just looks dead.
  // Detect it, explain it, and offer the one-click re-grant. Chrome grants
  // host_permissions at install, so contains() is normally true there and the
  // banner never renders (unless the user manually restricted site access — in
  // which case this same recovery path is exactly what they need).
  const HOST_ORIGINS = { origins: ['https://*/*'] };
  // browser.* is promise-based on Firefox; chrome.* is promise-capable on Chrome MV3.
  const PERMS_API = (typeof browser !== 'undefined' && browser.permissions) ? browser.permissions : chrome.permissions;
  async function syncHostPermBanner() {
    let granted = true;
    try { granted = await PERMS_API.contains(HOST_ORIGINS); } catch (_) {}
    $('host-perm-banner').classList.toggle('hidden', granted);
  }
  function initHostPermGuard() {
    if (!PERMS_API || !PERMS_API.contains) return; // fail open: banner stays hidden
    $('host-perm-grant-btn').addEventListener('click', () => {
      // request() must run inside the click gesture — no awaits before it.
      PERMS_API.request(HOST_ORIGINS).then(syncHostPermBanner).catch(() => {});
    });
    // Flip live if the user grants/revokes from about:addons mid-session.
    try {
      if (PERMS_API.onAdded) PERMS_API.onAdded.addListener(syncHostPermBanner);
      if (PERMS_API.onRemoved) PERMS_API.onRemoved.addListener(syncHostPermBanner);
    } catch (_) {}
    syncHostPermBanner();
  }

  // ---- collapsible settings sections ----
  // Accordion contract: at most one section open. Opening one folds the others;
  // tapping the open header closes it and leaves none open. State lives in
  // sidecar_settings.settingsSectionsOpen, written as one whole map on every flip
  // (this panel is the sole writer; a two-panel race costs one flip at worst).
  // Appearance defaults open so the theme picker greets a first run.
  // Everything here wires up exactly once — never in renderSettings(), which runs
  // on every gear entry and every relay add/remove and would stack listeners.
  const SETTINGS_SECTION_DEFAULTS = {
    appearance: true,
    posting: false,
    apps: false,
    wallet: false,
    relays: false,
    security: false,
    about: false,
    developer: false,
  };
  let settingsSectionsOpen = { ...SETTINGS_SECTION_DEFAULTS };

  function applySettingsSectionState(section, open) {
    section.classList.toggle('open', open);
    const btn = section.querySelector('.settings-section-toggle');
    if (btn) btn.setAttribute('aria-expanded', String(open));
  }

  // One function owns the accordion rule so the toggle, the boot restore, and the
  // auto-lock deep link cannot drift apart. open === null folds everything (unused
  // today, kept for symmetry with "none open" being a legal state).
  function applyAccordion(nextKey, open) {
    document.querySelectorAll('#view-settings .settings-section').forEach((el) => {
      const isOpen = el.dataset.section === nextKey && !!open;
      settingsSectionsOpen[el.dataset.section] = isOpen;
      applySettingsSectionState(el, isOpen);
    });
  }

  function setSettingsSection(key, open) {
    if (!document.querySelector('#view-settings .settings-section[data-section="' + key + '"]')) return;
    applyAccordion(key, open);
    call({ type: 'SIDECAR_SET_SETTINGS', settings: { settingsSectionsOpen } }).catch(() => {});
  }

  // Deep links (the auto-lock notice's "Auto-lock settings") land on a control the
  // collapsed map would bury. Expanding here is arrival, not arrangement, so it
  // isn't persisted; it still obeys the accordion rule.
  function openSettingsSection(key) {
    if (!document.querySelector('#view-settings .settings-section[data-section="' + key + '"]')) return;
    applyAccordion(key, true);
  }

  // A section whose every block is hidden goes away entirely — the Developer
  // section on store builds is the live case. Blocks that hide individually
  // (Passkeys where WebAuthn can't run) just leave their siblings in place.
  function syncSettingsSectionVisibility() {
    document.querySelectorAll('#view-settings .settings-section').forEach((section) => {
      const blocks = section.querySelectorAll('.settings-section-body > .setting');
      const anyVisible = Array.prototype.some.call(blocks, (b) => !b.classList.contains('hidden'));
      section.classList.toggle('hidden', !anyVisible);
    });
  }

  async function initSettingsSections() {
    document.querySelectorAll('#view-settings .settings-section-toggle').forEach((btn) => {
      btn.append(icon('chevron-down'));
      btn.addEventListener('click', () => {
        const key = btn.closest('.settings-section').dataset.section;
        setSettingsSection(key, !settingsSectionsOpen[key]);
      });
    });
    let stored = {};
    try {
      const settings = await call({ type: 'SIDECAR_GET_SETTINGS' });
      if (settings && typeof settings.settingsSectionsOpen === 'object' && settings.settingsSectionsOpen) stored = settings.settingsSectionsOpen;
    } catch (_) {} // unreadable storage falls back to all-collapsed defaults
    settingsSectionsOpen = { ...SETTINGS_SECTION_DEFAULTS, ...stored };
    document.querySelectorAll('#view-settings .settings-section').forEach((section) => {
      applySettingsSectionState(section, settingsSectionsOpen[section.dataset.section] === true);
    });
    // Defend at-most-one even over a corrupted or hand-edited stored map: the
    // first open section in document order wins; any extra folds.
    let opened = false;
    document.querySelectorAll('#view-settings .settings-section').forEach((section) => {
      if (!section.classList.contains('open')) return;
      if (opened) {
        settingsSectionsOpen[section.dataset.section] = false;
        applySettingsSectionState(section, false);
      } else {
        opened = true;
      }
    });
    // Same gate as initDevBadge: wait out the store/dev decision before deciding
    // which whole sections vanish. On a store build initDevBadge returns before
    // its show(), so this call is what hides the Developer section there.
    try { await devBuildReady; } catch (_) {}
    syncSettingsSectionVisibility();
  }

  // ---- boot ----
  document.addEventListener('DOMContentLoaded', refresh);
  if (document.readyState !== 'loading') refresh();
  initDevBadge();
  initHostPermGuard();
  initSettingsSections();
  initStampedType();
})();
