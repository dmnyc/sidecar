// Sidecar — the expanded composer's first paint.
//
// The tab's theme and contents come from the background worker, two messages away, and
// the worker may have to wake up first. Until they arrive the page painted in the
// default theme with an empty card reading "Loading…", which on a quick refresh showed
// as a flash of the wrong page before the right one.
//
// So, synchronously in the head, before the first paint: the theme this tab last drew
// with (compose.js keeps it), and a mark that holds the card and the wordmark back until
// boot has built them. The mark lifts itself after three seconds whatever happens,
// because a composer that stays invisible is worse than one that flickers.
(function () {
  'use strict';
  const root = document.documentElement;
  try {
    const theme = localStorage.getItem('sidecar_compose_theme');
    if (theme && /^[a-z-]+$/.test(theme)) root.setAttribute('data-theme', theme);
  } catch (_) { /* storage blocked: boot applies the theme as it always did */ }
  root.classList.add('compose-booting');
  setTimeout(() => root.classList.remove('compose-booting'), 3000);
})();
