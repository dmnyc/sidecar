// Sidecar — the special editions: themes that are only worn for part of the year.
//
// ONE LIST, read by every document that decides what a page wears: the panel, the
// expanded composer and the background (which resolves the theme for the approval window
// and the pay card). A seasonal theme is therefore registered here once, and the places
// that validate a theme name take the keys from here rather than from a copy.
//
// AN OVERLAY, NOT A THEME CHOICE. Wearing one writes settings.seasonalBy[pubkey] and
// leaves themeBy alone, so the account's own theme is still there underneath. What is
// written is the season, not just the edition ("sleepy-hollow:2026"), so when the window
// closes the edition stops resolving for good and every account is back in what it chose,
// with no write and no migration — the panel does not even have to be open on the day,
// and an account nobody opens until next year's window does not wake up wearing it again.
// See resolve() below.
//
// THE DATE IS THE DEVICE'S OWN, read the way sky-plate.js reads it, and nothing is fetched:
// release packaging includes only the artwork in season on the tag's commit date.
// A new release supplies each edition when its window opens. The calendar decides
// whether an edition is offered. Windows are inclusive of both days and are in local time,
// so an edition arrives at midnight wherever the user is.
//
// A window that crosses New Year (to is earlier in the year than from) is supported: the
// year an edition belongs to is the year its window opened, which is what the "already
// offered this season" record is keyed on.
(function (root) {
  'use strict';

  // from and to are [month, day], both days included. mode is the gallery half the theme
  // would belong to, which is what decides its logo and its approval-window wordmark.
  // Windows do not overlap. Aurora Borealis crosses New Year until January 17.
  const EDITIONS = [
    { key: 'sleepy-hollow', name: 'Sleepy Hollow', mode: 'dark', from: [10, 1], to: [11, 8] },
    { key: 'borealis', name: 'Aurora Borealis', mode: 'dark', from: [12, 7], to: [1, 17] },
  ];

  const byKey = (key) => EDITIONS.find((e) => e.key === key) || null;

  // TODAY, or the day a developer has asked to pretend it is (Settings → Developer, which a
  // store build never shows). Midday, so a timezone shift in either direction cannot move
  // a pretend date across midnight.
  function now(settings) {
    const d = settings && settings.devDate;
    const m = typeof d === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    return new Date();
  }

  // The window an edition is open for that contains `date`, as { start, end }, or null.
  function windowFor(key, date) {
    const ed = byKey(key);
    if (!ed) return null;
    const at = date || new Date();
    const y = at.getFullYear();
    const wraps = ed.to[0] < ed.from[0] || (ed.to[0] === ed.from[0] && ed.to[1] < ed.from[1]);
    // For a window that wraps, the one that could contain a January date opened last year.
    const startYear = wraps && (at.getMonth() + 1 < ed.from[0]
      || (at.getMonth() + 1 === ed.from[0] && at.getDate() < ed.from[1])) ? y - 1 : y;
    const start = new Date(startYear, ed.from[0] - 1, ed.from[1]);
    const end = new Date(wraps ? startYear + 1 : startYear, ed.to[0] - 1, ed.to[1], 23, 59, 59, 999);
    return at >= start && at <= end ? { start, end } : null;
  }

  const inSeason = (key, date) => !!windowFor(key, date);
  const isSeasonal = (key) => !!byKey(key);
  const current = (date) => EDITIONS.filter((e) => inSeason(e.key, date));

  // "sleepy-hollow:2026" — one season of one edition, which is what the arrival card is
  // shown once for. Null out of season.
  function seasonId(key, date) {
    const w = windowFor(key, date);
    return w ? key + ':' + w.start.getFullYear() : null;
  }

  // The edition a stored value names: "sleepy-hollow:2026" and a bare "sleepy-hollow"
  // (written before the season was recorded) both name sleepy-hollow.
  const keyOf = (worn) => (typeof worn === 'string' ? worn.split(':')[0] : '');

  // WHAT THIS ACCOUNT IS WEARING ON TOP OF ITS OWN THEME, or null. Only for the season it
  // was put on in: an edition worn last year resolves to nothing this year until it is put
  // on again, which is why the stored value can be left behind after a window closes
  // without changing anything. A bare key counts for whichever season is open.
  function resolve(settings, pubkey, date) {
    const by = (settings && settings.seasonalBy) || null;
    const worn = by && pubkey ? by[pubkey] : null;
    const key = keyOf(worn);
    if (!key) return null;
    const at = date || now(settings);
    const id = seasonId(key, at);
    return id && (worn === key || worn === id) ? key : null;
  }

  root.SidecarSeasons = { EDITIONS, KEYS: EDITIONS.map((e) => e.key), byKey, now, windowFor, inSeason, isSeasonal, current, seasonId, keyOf, resolve };
})(typeof self !== 'undefined' ? self : globalThis);
