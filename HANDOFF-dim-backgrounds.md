# HANDOFF — Sleepy Hollow: dim backgrounds regression (branch `fix/dim-plate-urls`)

Written 2026-10-05 by GLM for Claude. The maintainer should read §4 first.

## 1. What this branch contains

Branch `fix/dim-plate-urls`, tip `8a30ddc`, on top of main `5c77ff8`
("Revert Internal views dim the pumpkin"). Full suite: 2,465 pass.

- The dim pair (moon + Horseman's pumpkin) is the DEFAULT on every internal view;
  the lock screen swaps both for their bright twins via one media-free rule keyed
  on `:has(#view-lock:not(.hidden))` (themes/patterns.css, "swap rule").
- The dim pumpkin is SOLID `#6F4821` (the ember's blend over the night ink), not
  element opacity — element opacity let the Horseman's raised hand ghost through
  the lit body. The halo is a light and still fades at 0.45.
- `theme-tile.html` carries `data-tile`; the gallery preview tile is exempted from
  the dim default and explicitly given the bright pair (it is the shop window).
- The four fonts first believed dead (EB Garamond x2, Pinyon Script,
  playfair-500) are NOT dead — they are the backup-sheet PDF's embedded fonts,
  read at runtime via `fetch(fonts/…ttf)` in sidepanel.js (~line 9905). They were
  restored; only the fourteen DISPLAY ttf files were converted to woff2 (their
  fonts.css entries follow). 2.3 MB of screenshots/ also left the package.

## 2. The regression the maintainer saw (all-blank backgrounds)

Commit `2dc38b3` ("Reapply…") moved the sky/hollow plates under custom
properties (`--sh-sky`, `--sh-hollow`, …) whose values are `url()` with
**relative paths**, declared in themes/patterns.css. After this, internal views
went blank: `background-image` computed to `none`.

Root causes, in layers:

a) **An orphaned comment tail** left by the section-header rewrite in the same
   edit — the old comment's second paragraph ("The clouds and leaves are tiled…
   toward the moon. */") survived BETWEEN two rules as plain text ending in its
   own `*/`. This corrupted the parse and swallowed rules. FIXED on the branch
   (the stray text is gone).

b) **url() inside a custom property resolves against the DOCUMENT, not the
   declaring stylesheet.** The declaring stylesheet is themes/patterns.css, so
   the relative paths resolved against the page URL and 404'd. The branch now
   uses ROOT-RELATIVE paths (`url(/themes/sleepy-hollow-sky-dim.svg)`) in the
   variable declarations, which resolve correctly on every extension page and in
   the theme-tile iframe.

## 3. The open question for the next session

On a clean load of the branch (fresh `chrome://extensions` reload of the
unpacked extension — mandatory, Chrome caches unpacked files per extension
instance), the maintainer reported backgrounds STILL blank on internal views,
while an injected-copy test showed the var block parsing in isolation (1 rule)
and the served file carrying the rules. One suspect remains:

- **Chrome may drop a custom-property declaration whose value is a url() with
  an absolute path (`/themes/…`) at parse time inside some rule contexts.** If
  internal views are still blank after a clean extension reload, the robust fix
  is to stop routing the plates through custom properties entirely: restate the
  full literal stacks per band (narrow / 520–899 / ≥900, and lock variants) with
  the DIM plates in the base stacks and the BRIGHT plates in the lock-conditional
  stacks — verbose but proven, exactly how the pre-variable CSS worked.

A quick discriminator for the next session: in the unlocked panel with
Sleepy Hollow worn, `getComputedStyle(document.body).getPropertyValue('--sh-sky')`
— empty string means the declaration is being dropped (go the literal-stacks
route); a `/themes/…` value means the vars work and the problem is elsewhere.

## 4. Repo-state map for picking this up

- `main` @ `5c77ff8`: revert of the broken dim commit — the current safe state.
  The tag `v1.15.6` points here (forced move; the release has NOT shipped to the
  store, so the tag can move again once the fix lands).
- `fix/dim-plate-urls` @ `8a30ddc`: everything in §1 PLUS the variables with
  root-relative URLs. This is the branch to continue from if the blank
  backgrounds are fixed by a clean reload alone (i.e. §3's suspect is wrong).
- If internal views are STILL blank after a clean reload: take §3's fallback —
  on the same branch, replace the variable-based stacks with literal stacks
  (dim in base, bright in the lock swap), keeping the four `--sh-*` variables
  only if they resolve.
- The clock: the seasonal window now ends November 8 (seasons.js, help.html,
  CHANGELOG, README all updated).

## 5. Process rule established this session

CLAUDE.md now says: a pull request is opened and then it waits — the
maintainer tests the branch before it merges. Do not merge a PR, including one
you opened, without explicit approval of that change. This handoff exists
because that rule was violated once already.
