// Sidecar — which Constellation plate this page shows.
//
// Constellation's field is a star-atlas plate, and there are four, one for each season's
// evening sky (scripts/gen-constellation-mycelium.py): the stretch of sky that is high
// after dark in those months, the way an atlas grouped its plates. This reads the month
// once, as the page loads, and marks the document with the season's plate;
// themes/patterns.css does the rest. Once per session is all it needs: the sky a plate
// shows turns over in a quarter of a year, not while the panel is open.
//
// Every page that applies the user's theme loads this (the panel, the approval window,
// the composer and the gallery preview), so they all show the same sky; a page without it
// falls back to the winter plate. It sets the mark whatever the theme, because it costs
// nothing and a theme switched to Constellation later in the session then needs no second
// pass. The month is the device's own clock. No location is read: the evening sky's
// position by date is the same in both hemispheres, and asking where someone is to choose
// a background is not something a signer should do.
(function () {
  'use strict';
  // January through December.
  const PLATES = [
    'orion', 'orion',                  // winter: December to February
    'leo', 'leo', 'leo',               // spring: March to May
    'cygnus', 'cygnus', 'cygnus',      // summer: June to August
    'andromeda', 'andromeda', 'andromeda', // autumn: September to November
    'orion',
  ];
  document.documentElement.dataset.sky = PLATES[new Date().getMonth()];
})();
