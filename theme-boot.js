'use strict';

// Apply the user's chosen theme to Sidecar's full-page documents.
//
// help.html, welcome.html and wallets.html each link all twelve theme
// stylesheets and none of them ever set [data-theme], so every one of them
// rendered Speakeasy no matter what the panel was wearing. Someone on Par Avion
// opening the guide got a dark page out of nowhere.
//
// WHY A SHARED FILE HERE, when sidepanel.js, prompt.js and content.js each keep
// their own copy on purpose (see the note beside LIGHT_THEMES in prompt.js).
// That reasoning was about three documents that already have scripts of their
// own; sharing would have meant a fourth file to hold ten strings. These three
// pages have no theme code at all, so the alternative is three more copies, not
// one fewer. One file for three documents is the cheaper side of the same trade.
//
// The cost the prompt.js note names still applies: a new theme has to be
// registered in every copy. test/theme-list-parity.test.js now fails when they
// drift, which is the part that was previously left to memory.
(() => {
  // Same allowlist and order as sidepanel.js's applyTheme (dark first, then
  // light), which is canonical.
  const THEMES = [
    'speakeasy', 'film-noir', 'brownstone', 'nixie', 'cast-iron', 'metropolis',
    'industria', 'aegean', 'bauhaus', 'populuxe', 'par-avion', 'werkstatte',
  ];
  // The wordmark is baked lavender for a dark field and disappears on a light
  // one. sidepanel.js, prompt.js and content.js each carry this list too.
  const LIGHT_THEMES = ['industria', 'aegean', 'bauhaus', 'populuxe', 'par-avion', 'werkstatte'];
  // A vault that picked Art Deco before the Industria rename still holds the old
  // string, and nothing rewrites it. Mapped on read, exactly as the other three do.
  const THEME_ALIASES = { 'art-deco': 'industria' };

  function apply(raw) {
    const named = THEME_ALIASES[raw] || raw;
    // An unrecognised value falls back rather than writing an arbitrary string
    // into the DOM, so a theme removed in a later build degrades to the default
    // instead of leaving the page unstyled.
    const theme = THEMES.includes(named) ? named : 'speakeasy';
    document.documentElement.setAttribute('data-theme', theme);

    // NO WORDMARK SWAP HERE, unlike the panel and the prompt window.
    //
    // Those swap because their whole surface changes color with the theme. On
    // these pages the top nav is permanently dark chrome (.helpnav is a
    // hardcoded rgba(10, 1, 24, 0.88) in welcome.css) and stays dark under a
    // light theme, so the logo sitting on it always wants the dark-field cut.
    // Swapping to the deco mark put dark ink on a near-black bar.
    //
    // What the light themes DO break is the nav's text, which inherits their
    // near-black ink onto that same dark bar. The class below lets one CSS rule
    // pin those tokens back without listing the light themes a fifth time.
    document.documentElement.classList.toggle('theme-light', LIGHT_THEMES.includes(theme));
  }

  try {
    chrome.storage.local.get('sidecar_settings', (data) => {
      // Read errors are not worth surfacing on a documentation page: the default
      // is already applied by the stylesheets, so silence degrades to Speakeasy.
      if (chrome.runtime && chrome.runtime.lastError) return;
      apply((data && data.sidecar_settings && data.sidecar_settings.theme) || 'speakeasy');
    });

    // Change the theme in the panel while the guide is open in another tab and
    // the guide follows, rather than showing the old one until it is reloaded.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.sidecar_settings) return;
      const next = changes.sidecar_settings.newValue;
      apply((next && next.theme) || 'speakeasy');
    });
  } catch (_) {
    // Opened outside the extension (a plain file:// preview, say). The linked
    // stylesheets still render the default, which is the right thing to do.
  }
})();
