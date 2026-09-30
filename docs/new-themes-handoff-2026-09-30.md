# Handoff: four new themes (Ben Day, Underground, Departure, Jazz Age)

**For:** an agent picking this up cold.
**Written:** 2026-09-30.
**Ask:** review the direction below against the codebase, then build each theme as its own
pull request.

The visual reference is `docs/new-themes-mockups.html`. Open it in a browser: every theme is
drawn as a 300px sidebar with the same content (account bar, view title, wallet balance, a
note, a signing request), with the notes that led to each decision beside it. The mockups
are sketches. None of their colors have been through `test/theme-contrast.test.js`.

---

## 1. Where things stand

Sidecar has 16 themes, 8 dark and 8 light. These four take it to 20, ten of each, which
fills the two-column gallery (`.theme-selector`, `repeat(2, …)`) evenly on both halves.

| Theme | Mode | Slug | Status |
|---|---|---|---|
| Ben Day | light | `ben-day` | decided |
| Underground | light | `underground` (name not final, see §7) | decided |
| Departure | dark | `departure` | decided |
| Jazz Age | dark | `jazz-age` | decided |
| Arcade | dark | — | parked, outside the period |
| Hi-Fi | light | — | parked, outside the period |

The mockup page also shows the two parked themes, so they can be picked up later without
redrawing them.

## 2. Rules the four were chosen by

**Period.** Every new theme is drawn from material at least 75 years old. Arcade (1981) and
Hi-Fi (1970s) were cut for this reason alone. Two of the four sit near the line and have to
lean on the older end of their source:

- Ben Day draws on 1930s–40s comic-book printing, not on Lichtenstein's 1960s paintings.
  Nothing in the theme names or quotes Lichtenstein.
- Departure's familiar split-flap board is Solari's 1956 design, just inside the line. The
  theme should also draw on the station indicator boards the flap board replaced.

(Populuxe, 1954–64, predates this rule and is not affected by it.)

**Not a recolor of an existing theme.** The same test the existing themes apply to each
other (see the comparison notes at the top of `themes/metropolis.css`, and the
display-face table in `fonts.css`). Each theme below lists its nearest neighbors and what
keeps it apart.

**Words and icons never sit on a pattern.** This came up on Ben Day and was applied to all
four. Patterns live in gutters and open space. Every line of text and every icon sits on a
solid surface: a panel, a tablet, a plate, a tile, a strip. The account bar is the case
that failed first and is the one to check first.

The UI rules in `CLAUDE.md` apply as always: nothing shrinks to fit, and confirms with
words take their own row.

## 3. Ben Day (light)

A four-color comic page: Ben-Day dots, heavy black keylines, speech balloons and a yellow
caption box.

**Palette (draft)**

| Role | Value |
|---|---|
| Paper | `#FDFBF4` |
| Dot red | `#E3262B` |
| Caption yellow | `#FFD400` |
| Blue (sparingly: avatars) | `#1A5FB4` |
| Keyline and main accent | `#111111` |

**Type.** Bangers (SIL OFL) for view titles, the balance and button labels. It has
capitals only, so it never sets body text. Manrope stays the body face.

**Surfaces**

- The dots are a 9px grid of red at 55% opacity, in the gutters between panels only.
- The account bar is a white panel with a 3px black keyline under it. Icon buttons are
  white squares with a 2.5px outline and a heavier icon stroke (2.4).
- The view title sits in its own white box with a 3px keyline.
- The balance sits in the yellow caption box, with a small caption line above the figure
  ("Meanwhile, in the wallet…"). That line is user-facing text and goes through `t()`.
- Notes are speech balloons with a tail. The signing request is a square keylined panel.
- Buttons are square-cornered with 3px keylines. Primary is red with white text. Allow is
  black.

**Signature moment.** A POW! burst beside the balance when a payment arrives, positioned so
it never covers the figure. "POW!" is also text; decide whether it is translated or
treated as a drawn mark.

**Neighbors.** Bauhaus has the same primaries on white. What separates them is the dots,
the keylines, the balloons and black as the main accent. Blue must stay rare.

**Check.** White on `#E3262B` measures 4.59:1. That clears the 4.5:1 body-text floor by
very little, so a slightly deeper red is safer. Bangers is wide, so check German labels in the pseudo-locale.

## 4. Underground (light)

The 1904 IRT subway stations and the enamel signs that followed them: white glazed tile in
running bond, mosaic name tablets in glazed-tile borders, a tesserae frieze, and
porcelain-enamel signs for everything you press. Built from four reference photos:
34th Street and 23rd Street tablets, IND and BMT enamel signs.

**Palette (draft)**

| Role | Value |
|---|---|
| Tile field | `#F3F0E7`, grout `#C9C1AF` |
| Header tablet field | `#141E26` (tesserae vary around it) |
| Header tablet border | `#6FA59A` (34th Street's sea green) |
| Balance tablet field | `#7E2A22` (23rd Street's faience red), gold fillet `#D9C98E` |
| Frieze | gold `#D8C690`, maroon band `#7A1F33` |
| Enamel: IND green | `#1F4A3B` with ink `#EFE8D2` |
| Enamel: cobalt | `#1E2E78` with ink `#F2F0E6` |
| Enamel: white | `#F6F3EA` with ink `#151A1E` |
| Tesserae lettering | cream `#F1EBDA` and neighbors |

**Type.** Pathway Gothic One (OFL) for enamel sign labels and the account name, uppercase
and letterspaced. The mosaic lettering is not a font. It is drawn from the real string:
Archivo at expanded width and weight 800 for the header title (34th Street style), Crimson
Pro 600 for the balance (23rd Street style). Both are OFL.

**Surfaces**

- A strip of frieze runs along the top: gold tesserae with green and mauve diamonds over a
  maroon tile band.
- The account bar and view title sit inside the header tablet: dark field, sea-green
  border, title in cream tesserae. This is the most legible header in the set.
- The balance is a red tablet with an olive tile border and a gold fillet. The fiat line
  sits under it on a small white plate.
- Buttons are enamel signs: an inset line in the ink color and a few chips at the edges.
  Send and Allow are green, Trust is cobalt, Receive is white.
- Notes and requests are white enamel plates with the inset line.

**How the mosaic works.** The mockup draws the text to an offscreen canvas, samples it on a
3px grid, and lays a slightly jittered tessera in each cell: cream where the text covers
the cell, a field color where it doesn't. A seeded random number generator keeps every
tessera in the same place on each render. For the real theme:

- The real text stays in the DOM, visually hidden, for screen readers, find and copying.
- Translated titles and any balance render correctly because the source is the string.
  Long strings shrink the tesserae rather than being cut off.
- Draw once per change, at the device pixel ratio, not on every frame.

**Signature moment.** When a payment arrives, the new figure's tesserae are set one by one
(about 1.4s in the mockup). With reduced motion, the new figure appears at once.

**Neighbors.** Brownstone is also New York: Brownstone is the street at night, Underground
is the station below it. Ben Day is the other light theme with chunky lettering, but tile
and enamel share nothing with dots and keylines.

## 5. Departure (dark)

A station departures board: every character of the title and the balance on its own flap
tile, with yellow for the platform-number accent.

**Palette (draft)**

| Role | Value |
|---|---|
| Board | `#1A1A19` |
| Tile and card | `#0E0E0D` |
| Flap ink | `#F2F1EA` |
| Accent yellow | `#F5C400` |
| Muted | `#A5A399` |

**Type.** Barlow Condensed 600/700 (OFL) for tiles, the account name, buttons and the fiat
line, uppercase.

**Surfaces**

- The background is a faded grid of empty flap tiles, each with its split line.
- The account bar sits on a solid board strip so the name and icons never cross the empty
  grid.
- The title and balance are rows of tiles. Each tile has a split line across the middle.
  The comma in a balance is a narrow gap, not a tile.
- The fiat line is yellow, uppercase, under the balance.
- Buttons: Send and Allow are yellow with black text. Receive and Trust are dark tiles
  with a hairline border.

**Signature moment.** Digits flip through to the new value, one tile after another (90ms
stagger in the mockup). With reduced motion, the new value appears at once.

**Translation.** The title's tile count depends on the translated string. Decide how a long
title behaves: tiles narrow down to a minimum width, then the row wraps or truncates.
Never shrink the letters below what reads.

**Neighbors.** Nixie also turns the balance into a display device, and is the closest
overlap any of the four has. Keep Departure mechanical where Nixie is electrical: no glow
on the figures. Underground is also lettered; the tiles and the dark board keep them apart.

## 6. Jazz Age (dark)

A 1920s jazz club: piano keys, stage lighting, and the balance written on a music staff.

**Palette (draft)**

| Role | Value |
|---|---|
| Stage | `#0C0908` |
| Crimson (primary buttons) | gradient `#E0324B` → `#B3122E` → `#8E0B22` |
| Ivory (text) | `#F3E7CF`, button labels `#FFF4E2` |
| Muted | `#BBA78C` |
| Cards | `rgba(21,15,14,.92)`, border `rgba(184,134,75,.28)` |
| Beams | warm white `255,214,160`, red gel `255,70,70`, amber `255,190,120` |

**Type.** Fascinate (OFL, Astigmatic) for the view title. It is drawn after Broadway
(1928), the lettering of Jazz Age posters and programs. Federo (OFL) for the balance.

**Surfaces**

- A keyboard strip runs along the top edge (30px, one octave as a repeating tile), in the
  place where Underground has its frieze.
- Stage lighting: three soft-edged beams from lamps above the frame (warm white from the
  upper left, a red gel from the upper right, a fainter amber) that land in a pool on the
  stage floor at the bottom. They are kept faint so ivory text stays clear where a beam
  crosses it.
- The balance sits on a staff: five lines 11px apart, an opening bar line and a closing
  double bar. A halo in the ground color knocks the lines out around each digit, so no
  line cuts through a figure. The fiat line sits under the staff.
- Buttons glow like a club sign: a hot core, a halo that spills onto the black, and a soft
  reflection underneath. Primary is crimson. Secondary is an ivory outline with a warm
  inner glow.

**Signature moment.** When a payment arrives, the digits on the staff bounce one after
another, as if the new balance had just been played. The primary button also breathes
slowly with one flicker. With reduced motion, both stay still.

**Neighbors.** Speakeasy is also a 1920s night out. Speakeasy is the hidden bar in purple
velvet and gold; Jazz Age is the bandstand in black, crimson and ivory, with no gold
anywhere.

**Tried and dropped:** a treble clef in front of the staff, a literal table lamp, a
cursive title (Yesteryear), engraved bronze instruments in the background (they got lost),
and a continuous-line drawing of instruments. The instrument shapes in that last one
worked; the line joining them did not. It is deferred, not rejected.

**Later option:** the staff digits could be set in Petaluma (OFL, Steinberg's jazz
lead-sheet font) so they read as handwritten on a chart. It is not on Google Fonts and
would be bundled like the rest.

## 7. Open questions for review

1. **Underground's name.** Underground reads well, but to many people it means the London
   Tube. Alternatives: Subway (the plain New York word), IRT (the 1904 line these stations
   belong to), Tesserae (names the tilework). The slug follows the name.
2. **Runtime lettering.** Underground's mosaic and Departure's tiles both render text
   themselves. Check they can meet the i18n rules (text through `t()`, the pseudo-locale's
   40% padding) and keep the real text accessible.
3. **Contrast.** Every palette above is a draft. Run each through
   `test/theme-contrast.test.js` and adjust the colors, never the floors.
4. **The POW! burst and the Ben Day caption line.** Are they translated text or drawn
   marks?
5. **Build order.** Suggested: Ben Day, then Departure, Jazz Age, and Underground last,
   since its mosaic renderer is the most engineering.

## 8. What adding a theme touches

Commit `260d24b` (Add Constellation and Mycelium themes) is the template: 26 files for two
themes. For each new theme:

- `themes/<slug>.css`, with a header comment in the house style: what the theme is, and
  what separates it from its neighbors.
- A `<link>` to it in `sidepanel.html`, `welcome.html`, `wallets.html`, `help.html`,
  `prompt.html` and `compose.html`.
- A `.theme-card` in `sidepanel.html` with the right `data-mode`.
- `sidepanel.js`: `THEME_LABELS` and `validThemes`.
- `composer-core.js`: `LIGHT_THEMES`, for light themes (they need the dark-wordmark logo).
- `content.js`: `CARD_THEMES`, a pay-card palette, and `LIGHT_CARD_THEMES` for light
  themes.
- `prompt.js`: `THEMES`, and `LIGHT_THEMES` for light themes.
- `compose.js`: its theme list.
- `themes/patterns.css` for the background, and any SVG assets beside it in `themes/`.
- `fonts.css`, the font files in `fonts/`, an `OFL-*.txt` license record for each new face,
  and `NOTICE`. The extension makes no font requests; everything is bundled. Add each new
  face to the display-face table at the top of `fonts.css`. Oswald and Pinyon Script are
  already bundled; Bangers, Pathway Gothic One, Archivo, Crimson Pro, Barlow Condensed,
  Fascinate and Federo are not.
- `test/theme-contrast.test.js` floors, and `test/theme-svg-assets.test.js` if the theme
  ships SVG assets.

`grep -rn mycelium --include=*.js --include=*.css --include=*.html .` lists every place;
a new theme should appear in each of them. Check new UI in the pseudo-locale (Settings →
Developer → Pseudo-locale).
