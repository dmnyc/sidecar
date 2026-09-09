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

  // THE ACTIVE ACCOUNT'S theme, with settings.theme as the default for an account that
  // has never chosen one. A theme belongs to an account (themeBy, see resolveTheme in
  // sidepanel.js), so reading only settings.theme would show these pages the default
  // rather than the theme the panel is wearing — which is the exact bug above, back for
  // anyone using per-account themes.
  //
  // RESOLVED HERE, not asked of the background, unlike the pay card. That card renders
  // into a web page that can see it, so it must never learn which account is active and
  // takes the theme of the account its own site is bound to instead (content.js). These
  // are chrome-extension:// documents. Nothing on the web can read them, so the account
  // on screen is the right answer and both keys are a plain local read away.
  function boot() {
    chrome.storage.local.get(['sidecar_settings', 'sidecar_active_pubkey'], (data) => {
      // Read errors are not worth surfacing on a documentation page: the default
      // is already applied by the stylesheets, so silence degrades to Speakeasy.
      if (chrome.runtime && chrome.runtime.lastError) return;
      const st = (data && data.sidecar_settings) || {};
      const pk = data && data.sidecar_active_pubkey;
      const by = st.themeBy || {};
      apply((pk && by[pk]) || st.theme || 'speakeasy');
    });
  }

  try {
    boot();

    // Change the theme in the panel — or switch account — while the guide is open in
    // another tab and the guide follows, rather than showing the old one until it is
    // reloaded.
    //
    // Both keys matter and each moves on its own: a pick writes sidecar_settings, a
    // switch writes sidecar_active_pubkey. So this re-reads both rather than taking the
    // one new value out of the change record.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!changes.sidecar_settings && !changes.sidecar_active_pubkey) return;
      boot();
    });
  } catch (_) {
    // Opened outside the extension (a plain file:// preview, say). The linked
    // stylesheets still render the default, which is the right thing to do.
  }
})();
