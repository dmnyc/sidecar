# Handoff: special-edition (seasonal) themes, and Sleepy Hollow

**For:** an agent picking this up cold.
**Written:** 2026-10-03.
**State:** built, tested and pushed on branch `feat/seasonal-themes` (commit `ddf2a16`, plus
this file). **No pull request.** The maintainer is reviewing the branch locally and asked
for none to be opened. Do not open one unless asked.

---

## 1. What was asked

The maintainer wants themes that are only available for a date range, each announced by a
card when the user first opens the panel, so they understand it is a **special edition**
and can turn it on. Two other questions were open: how these appear in the theme gallery,
and how they are turned on and off.

The first one had to ship within about 24 hours, because October had already started:
**Sleepy Hollow**, which the maintainer chose as the Halloween subject.

## 2. What was decided (agreed in conversation)

The maintainer accepted these recommendations ("Yes, let's aim to get Sleepy Hollow out in
the next 24 hours"):

- **Worn per account, over the account's own theme.** "Wear it" applies to the account you
  are in, the same as the gallery. It is stored as `settings.seasonalBy[pubkey]` beside
  `themeBy`, never in it, so taking it off (or the season ending) puts back exactly what the
  account had. Expiry needs no write: the edition stops resolving on its own.
- **Art ships in the extension all year; only the local date decides.** Nothing is fetched.
  No location is read; that matches `sky-plate.js`.
- **The card is shown once a season** (keyed `key:year`, where year is the year the window
  opened). It has "Wear it" and "Not now", both remembered. It is not offered in the last 3
  days of a window, and never while the update card is waiting.
- **Gallery:** a "Special edition" slot above the Dark/Light filter, shown only while an
  edition is in season and only when there is an account. It is **not** in the account
  menu's theme list (`THEME_LABELS`). There are no greyed-out or "coming soon" cards out of
  season; that was rejected as clutter.
- **Taking it off:** choose any other theme (in the gallery or the account menu), or press
  "Back to <own theme>" under the special card.
- **End of season:** a toast is shown once, "Sleepy Hollow is over for this year. It comes
  back in October.", and `seasonalBy` is cleared so next year's card offers it fresh.
- **Opt-out:** Settings → Appearance → Special editions → "Tell me when one arrives" (default
  on). This turns off only the card; the gallery slot stays.
- **Dev preview:** Settings → Developer → "Pretend today is" (local builds only). It writes
  `settings.devDate`, which the panel, the composer and the background all honor. Changing
  it clears the card's seen-record and reloads the panel.

### The roadmap brainstorm (not built; agreed in principle only)

| Edition | Mode | Window | Notes |
|---|---|---|---|
| Sleepy Hollow | dark | Oct 1 – Nov 2 | **Built.** |
| Harvest | light | Nov 3 – Nov 30 | Reframed from "Thanksgiving": avoid pilgrim imagery, and Canada's Thanksgiving is in October. Proposed as apple-crate label art (lithographed 1920s–50s fruit-crate labels, Hudson Valley), cream paper, cranberry and mustard. Possible zap-as-thanks tie-in. |
| Aurora | dark | Dec 1 – Feb 28 | Northern lights over snow, as a Nordic woodcut: spruce, one lit cabin window, the aurora as a slow gradient. Keep stars sparse so it doesn't read as Constellation. |
| Midnight | dark | Dec 26 – Jan 7 | New Year: fireworks and champagne, very on-brand (a Sidecar is a cocktail). Midnight blue with silver and champagne, so it isn't Jazz Age or Industria. Static engraved bursts; the only motion is bubbles rising in a coupe. Overlaps Aurora on purpose. |

The maintainer did not explicitly confirm the Harvest reframing, so ask before building it.
Any edition can ship in any release before its window, because the calendar gates it.
Southern-hemisphere seasonal mismatch was noted and accepted.

## 3. How it is built

| Piece | Where |
|---|---|
| The list of editions, windows, `inSeason`, `seasonId`, `resolve`, `now` (honors `devDate`) | `seasons.js` (new). Loaded by `sidepanel.html`, `compose.html` and `prompt.html` before their own scripts, by `background.js` `importScripts`, and in `manifest.json` `background.scripts` (Firefox) |
| Resolution: the edition wins while in season | `sidepanel.js` `resolveTheme`, `compose.js` `applyTheme`, `background.js` (approval window `theme:` and the pay card `cardTheme:`, which is resolved for the site's **bound** account, never the active one) |
| Allowlists | `validThemes`, `VALID_THEMES` and `THEMES` in panel, composer and prompt take `.concat(SidecarSeasons.KEYS)`. `content.js` `CARD_THEMES` names each edition literally (a content script can't load `seasons.js`), plus a palette entry in `getThemeColors` |
| Store / clear | `SIDECAR_SET_SEASONAL_FOR` in `background.js`. It rejects any key that isn't an edition |
| Card, end-of-season toast, gallery slot | `sidepanel.js`, section "special editions: the seasonal themes" (`maybeShowSeasonCard`, `maybeSayFarewell`, `paintSpecialEditions`, `wearEdition`), called from `render()`'s main branch and the settings load. Special cards are generated from `SEASONS.EDITIONS` before the gallery's click listeners attach. `showThemeMode` leaves them out of the Dark/Light filter |
| Markup / styles | `sidepanel.html` (`#theme-special`, the toggle, `#dev-date`); `styles.css` (`.season-card*`, `.theme-special*`, `.theme-until`, `.dev-date-row`). The card follows CLAUDE.md rule 2: buttons with words go on their own full-width row |
| Theme | `themes/sleepy-hollow.css`; field in `themes/patterns.css` (panel and `body.compose-page`); linked from all six pages that link themes |
| Art | `scripts/gen-sleepy-hollow.py` writes `themes/sleepy-hollow-{sky,hollow}{,-wide}.svg`: a sky layer pinned to the top (moon under the tab bar, tulip tree) and a hollow layer pinned to the bottom (hills, church, bridge, Horseman), both full width, `background-attachment: fixed`. Two layers because one cover-sized plate put the moon under the tab labels and moved with panel height |
| Font | `fonts/im-fell-english-sc.ttf`, the unmodified original from Google Fonts (it has a Reserved Font Name, so it is not subset). License is in `fonts/OFL-IMFellEnglishSC.txt`. Its figures are old-style with no lining set, so `fonts.css` declares `'Hollow Figures'`, Cormorant's existing file limited to digits by `unicode-range`, first in the theme's stack |
| Tests | `test/seasons.test.js` (new, 16 tests: calendar, overlay, every registration point, card rules). Updated: `per-account-theme`, `theme-contrast` (Sleepy Hollow floors: muted 7.13, faint 4.39, gold 9.70), `i18n-wiring` (`seasons.js` may load before `i18n.js`) |
| Docs | `README.md` (tribute and fonts), `help.html` Themes section, `CHANGELOG.md` Unreleased |

**Adding the next edition:** add an entry to `EDITIONS` in `seasons.js`. Ship
`themes/<key>.css` and link it from the six pages. Add the key to `CARD_THEMES` with a
palette in `content.js`. If it is light, add it to the `LIGHT_THEMES` lists. Add contrast
floors, and a `.season-card-name[data-edition="<key>"]` rule for its name face.
`test/seasons.test.js` will fail until each of these is done.

## 4. Verified

- `npm test`: 2412 of 2412 pass.
- Driven in real headless Chromium with the extension loaded: onboarding, the card in
  Speakeasy and in Industria (light), "Wear it", the gallery slot with a live preview and
  "Back to Speakeasy", the expanded composer, the end of season (devDate Nov 5: theme
  reverts, `seasonalBy` cleared, toast shown), and the pseudo-locale (no overflow).
- **Not seen rendered:** the approval window and the pay card on a page. They are covered
  only by tests.

## 5. Open items for the maintainer

1. Review the font licensing (the TTF has a Reserved Font Name and ships unmodified).
2. No version bump; it is under Unreleased in the changelog.
3. The Horseman sits behind the "On this day" text at the foot of the Accounts tab.
   Cosmetic.
4. If store review is slow, extend Sleepy Hollow's end date in `seasons.js` (one line).
5. Commits are authored as `The Daniel <dmnyc@users.noreply.github.com>` with no tool
   attribution (CLAUDE.md). Branches use `feat/`, never `claude/`.
