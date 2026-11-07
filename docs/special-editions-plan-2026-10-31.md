# Plan: five special editions — Red Envelope, Renaissance, Magic Act, Mint Julep, Scoreboard

**Written:** 2026-10-31, against `main` at `d062666` (1.16.4 prepared). Its code references
were rechecked against `main` at `0339ec4` (1.16.6) on 2026-11-07.
**Updated:** 2026-11-07, twice. Chinese New Year was added (§3). Then the calendar was
reorganized around Aurora Borealis (draft PR #477, December 7 – January 17), its rule
that no two editions are ever in season on the same day, and its seasonal packaging.
Then the Chinese New Year edition was named **Red Envelope** (`red-envelope`) and given
its look, with a mockup (§3). Its first, literal draft (lanterns, couplets, a door) was
replaced by a restrained one: light, material and color, no props. Then Ballpark was
renamed **Scoreboard**. Its designs already exist in the maintainer's local repository (§7).
**State:** a plan. Nothing is built. Each edition is meant to be its own pull request.
**Builds on:** the special-edition system that shipped Sleepy Hollow (`seasons.js`, #451),
and PR #477, which is expected to land first.

---

## 0. Decisions needed before anything is built

1. **Scoreboard (formerly Ballpark) is already designed,** in the maintainer's local
   repository. None of it has been pushed to GitHub, which is why this plan found no trace
   of it under either name. Start from those designs. §7 holds only what this plan adds to
   them.
2. **Magic Act's window.** §1 proposes **March 1 – April 7**: Houdini's birthday (March 24,
   1874) through April Fools' Day. It starts the day after Renaissance ends.
3. **Mint Julep's mode**, which the brief left open. Proposed: light, a spring afternoon.
   Scoreboard's mode is whatever its existing designs settle.
4. **The rest of the October brainstorm.** Aurora is built (PR #477). Harvest (November)
   would fit in the empty stretch from November 9 to December 6. Midnight (December 26 –
   January 7) falls inside Aurora's window, so under the no-overlap rule it can't exist
   as planned. Are either still on?
5. **Red Envelope's mode.** The name is decided. Proposed mode: dark, as the mockup draws
   it (§3).
6. **Years when the New Year comes late.** Red Envelope's window (January 18 –
   February 8) holds New Year's Eve through the third day of the New Year in 6 of the 10
   years 2027–2036. In 2029, 2032, 2034 and 2035 the New Year falls on February 8 or later.
   In those years it is inside Renaissance's window, and Red Envelope's window would
   close before it. The plan lists 2027 and 2028 only, so in any other year the edition is
   simply not offered (§3). Before January 2029, decide whether it sits those years out
   or Renaissance gives way that year.
7. **An edition offered before its art arrives.** Under PR #477's packaging, a release
   carries only the art of the edition in season on its tag date. The panel never checks
   whether an edition's art is installed (PR #477 doesn't touch `sidepanel.js`). So from
   the first day of a window until users install the release tagged inside it, the season
   card offers the edition and it is worn without its artwork. That is from reading the
   code, not running it. One fix covers every edition every year: offer and resolve an
   edition only when its art is in the package.

## 1. The calendar

Windows are `[month, day]` in local time, with both days included (`seasons.js`). The
season card stops being offered in an edition's last three days (`SEASON_CARD_QUIET_DAYS`).
**No two windows overlap:** PR #477 adds a test that fails if they do, and its packaging
refuses a tag date that falls inside two windows. The calendar below was checked day by
day from 2026 to 2036 against `seasons.js`, with Aurora's window in place, and no day
falls inside two windows.

| Edition | Mode | Window | Anchor | Tag its release on |
|---|---|---|---|---|
| Sleepy Hollow | dark | Oct 1 – Nov 8 | Halloween | Oct 1 *(shipped)* |
| Aurora Borealis | dark | Dec 7 – Jan 17 | Midwinter and the New Year | Mon Dec 7, 2026 *(PR #477, draft)* |
| **Red Envelope** (Chinese New Year) | dark *(proposed)* | **Jan 18 – Feb 8** (2027 and 2028, §3) | New Year's Eve Fri Feb 5, New Year's Day Sat Feb 6, 2027 | **Mon Jan 18, 2027** |
| **Renaissance** | light | **Feb 9 – Feb 28** | Valentine's Day, Sun Feb 14 | Tue Feb 9, 2027 |
| **Magic Act** | dark | **Mar 1 – Apr 7** *(proposed)* | Houdini's birthday, Mar 24; April 1 | Mon Mar 1, 2027 |
| **Mint Julep** | light | **Apr 15 – May 15** | Derby day, the first Saturday in May | Thu Apr 15, 2027 |
| **Scoreboard** (formerly Ballpark) | per its designs | **Jun 1 – Aug 31** *(proposed)* | Summer; July 4 | Tue Jun 1, 2027 |

What fixed the windows:

- **Red Envelope starts the day after Aurora ends,** January 18. That is as early as the
  calendar allows and 19 days before New Year's Day 2027. It ends February 8, which
  covers New Year's Eve, New Year's Day and the two days after, the heart of the festival
  (Hong Kong's 2027 holidays run February 6–9). The Lantern Festival (February 20) would
  fall inside Renaissance, so the window stops before it.
- **Renaissance moves from February 1 – 22 to February 9 – 28.** It starts the day after
  Red Envelope, 5 days before Valentine's Day, and the card is offered until February
  25. It ends on `[2, 28]` because of the trap below. On February 29 in a leap year no
  edition is in season.
- **Magic Act starts the day after Renaissance ends.**
- **Mint Julep's window covers every Derby date.** The Derby moves between May 1 and May 7
  (May 1, 2027; May 6, 2028; May 5, 2029). April 15 – May 15 holds each one with at least 8
  days to spare, so the window never needs editing from year to year.
- **The gaps:** April 8–14, May 16–31, September and November 9 – December 6 carry no
  edition. A release tagged in a gap carries no edition's art.

**A trap, verified:** `to: [2, 29]` runs the edition through **March 1** in a non-leap
year. `windowFor` builds `new Date(y, 1, 29)`, which rolls over. Checked with
`seasons.js` in Node: on 2027-03-01, an edition ending `[2, 29]` was still in season.
End February windows on `[2, 28]`, or have `windowFor` clamp the day. Clamping in code
needs a test that fails on today's code.

**Releases (PR #477).** A package keeps only the art of the edition in season on the
tagged commit's UTC date. The art lives in `themes/<key>-*`, and stylesheets always ship.
So an edition can't be shipped early: its art reaches users only in a release tagged
inside its window. Every window needs its own release, tagged on its first day (the last
column), and the art arrives once the stores approve it. An edition's code can merge any
time before then. Decision 7 is about the days in between.

## 2. Rules every edition follows

Inherited from the earlier theme handoffs and `CLAUDE.md`:

- **Period:** the source material is at least 75 years old. All pass that this plan describes: Red Envelope
  (red paper and gold, and a lattice from old window screens), Renaissance 15th–16th c., Magic
  Act 19th c., Mint Julep 19th c.–1930s. Check Scoreboard's sources, in its own designs,
  against the same rule.
- **Not a recolor** of an existing theme. Each section below names its nearest neighbors
  and what keeps it apart.
- **Words and icons never sit on a pattern.** Patterns go in gutters only, and every line
  of text sits on a solid surface. Check the account bar first.
- **Static art, drawn by a script in `scripts/`** (as `gen-sleepy-hollow.py` and
  `gen-borealis.py` do): a top layer pinned to the top and a bottom layer pinned to the
  bottom, plus `-wide` variants for the composer. Name every file `themes/<key>-*`, since
  that prefix is what the packaging prunes.
- **Display face from a category the `fonts.css` table doesn't already have.** Read its
  license record first. A face with a Reserved Font Name ships unmodified, which means no
  subsetting (the IM Fell precedent).
- The zap bolt stays lemon yellow. Contrast floors go in `test/theme-contrast.test.js`.
- Check each edition in the pseudo-locale, at panel width, in the composer at laptop and
  desktop widths, and on the lock screen.

New for these five:

- **Original drawings only.** Draw in the manner of the source, and never trace or
  reproduce a specific work. This matters most for Renaissance: Italian museums have taken
  commercial users to court over reproductions of the Vitruvian Man and Michelangelo's
  *David* under Italy's cultural-heritage code.
- **No trademarks in the art or the interface.** For Mint Julep: Churchill Downs' marks
  (the name "Kentucky Derby", "Run for the Roses", the Twin Spires silhouette). For
  Scoreboard: league and team names, logos and jersey scripts, ballpark names, and real
  players' likenesses. The README tribute may say in words what an edition honors, as
  Sleepy Hollow's does.
- **Package budget.** Under PR #477 a release carries one edition's art at most, so the
  budget is per release rather than cumulative. Aurora's art is about 215 KB; Sleepy
  Hollow's is about 449 KB. Aim at Aurora's. **Fonts are not pruned,** so a new face is
  carried all year by every release. Reuse a face that already ships where one fits, as
  Aurora did (Josefin Sans) and Mint Julep can (§6).

## 3. Red Envelope (dark, proposed) — January 18 – February 8

The Chinese New Year edition. **Key: `red-envelope`.**

**Mockup:** `docs/images/red-envelope-mock.webp`, rendered from `docs/red-envelope-mock.html`,
which loads the repository's own fonts and icons. It shows the Wallet tab, the lock screen,
and the pay card with the season card that offers the edition, all at panel width. It is a
sketch, and its display face is a stand-in. A first, literal draft (drawn lanterns, couplets and a
calligraphic 福 on a door) was rejected as heavy-handed: it read as costume, and Sidecar
is a classy Nostr signer. What follows is the second direction.

**Why the name.** The other editions are named for something you can see, not for the
holiday (Sleepy Hollow, not Halloween). The red envelope (红包) is the best-known New Year
custom: money for good luck, given in red paper. A zap is a gift of money, so the theme's
signature, the pay button drawn as an envelope, is also its name. It claims no more than
the art shows. "Lunar New Year" would promise Korea's and Vietnam's new years, but red
envelopes are given in China and in Vietnam (*lì xì*). And it doesn't depend on the zodiac
animal, so it can come back every year. Par Avion is also an envelope, an airmail one,
but the two are never in season together.

**When the key matters.** Once an edition has shipped, each account that wears it stores
the key (`red-envelope:2027`), and so does the season card's record of what it has
offered. A rename after shipping takes the edition off everyone wearing it and offers the
card again. Before an edition ships, a rename is a find-and-replace across its files,
tests and art names. That is true of Aurora too: unshipped, its key is still free to
change.

**Idea: lantern light, never lanterns.** The season is carried by light, material and
color, not by props. Three things do all the work:

- **The light.** A warm glow falls from above and out of frame, tinted red the way light
  through red paper is. It suggests lanterns without drawing one. On the lock screen it is
  seen out of focus, as soft discs of light, the way lanterns hung far off look at night.
- **The envelope.** The one object in the theme. Red paper with gold foil carries what
  matters: the balance, the primary buttons, the pay button and the gallery tile.
- **The emboss.** Pattern exists only as a blind emboss in the dark ground, tone on tone
  with no ink: a linked-coin lattice from old window screens, felt rather than seen. It
  never goes on the envelope, which stays plain red paper with a fine grain.

**The window: January 18 – February 8, a plain `[month, day]` window, for 2027 and 2028.**
The holiday moves every year, but this window holds the core of it in both years:

| Year | New Year's Day | Days of lead from Jan 18 | What the window holds |
|---|---|---|---|
| 2027 | Sat Feb 6 | 19 | New Year's Eve, the day, and the second and third days |
| 2028 | Wed Jan 26 | 8 | New Year's Eve through the fourteenth day (the Lantern Festival is Feb 9) |

- **2027 is verified.** Hong Kong's gazetted holidays put Lunar New Year's Day 2027 on
  Saturday, February 6 ([gov.hk](https://www.gov.hk/en/about/abouthk/holiday/2027.htm),
  [Labour Department](https://www.labour.gov.hk/eng/news/latest_holidays2027.htm)).
- **Later years come from ICU and need checking** against the Hong Kong Observatory's
  Gregorian–lunar conversion tables. The network here blocked them. By ICU, the window
  also fits 2030, 2031, 2033 and 2036, but not 2029 (Feb 13), 2032 (Feb 11), 2034 (Feb 19)
  or 2035 (Feb 8). See decision 6.
- **Don't compute the dates with `Intl`.** The Chinese calendar in Node 22's ICU (78.3)
  puts the 2027 New Year on **February 7**. That year's new moon falls just before
  midnight in Beijing, and ICU's approximation lands on the wrong side of it. ICU gives
  February 2 for 2030, another near-midnight year.

**Code this edition needs** (checked against `main` and PR #477):

1. **A `years` list on the edition:** `{ key: 'red-envelope', name: 'Red Envelope', …, from: [1, 18], to:
   [2, 8], years: [2027, 2028] }`. `windowFor` returns no window when the window's opening
   year isn't listed, so in a late year the edition fails closed instead of running a
   New Year theme that ends before the New Year. `seasonId`, `resolve` and PR #477's
   packaging all go through `windowFor`, so they follow without changes.
2. **The end-of-season toast** (`sidepanel.js:3769`) says "It comes back in January". That
   is true in 2027, but in the last listed year the toast must not promise a return. That
   needs one new string, through `t()`, with its keys added at the end of each locale
   file. `windowFor` and this toast are the only two readers of an edition's dates.
3. **PR #477's no-overlap test walks 2026 only.** Red Envelope isn't in season in 2026,
   so the test would never see it. Make it walk every year any edition lists (2026–2036
   is cheap).
4. Tests that run the code: in season January 18 – February 8, 2027 and 2028, and out of
   season in 2029. Check they fail before `years` exists.

The earlier version of this plan had a lunar date table and a fix to the season card. The
reorganized calendar needs neither: the window is fixed, and only one edition is ever in
season, so the card bug (verified, the second of two overlapping editions is never
offered) can't happen. If the no-overlap rule is ever relaxed, fix the card first.

**Mode: dark, proposed.** It is New Year's Eve, a night spent staying up to see the year
in. A light version (*nianhua* on cream paper) would also sit close to Ukiyo-e, the other
woodblock-print theme.

**Palette** (the mockup's values, measured)

| Role | Value | Contrast |
|---|---|---|
| Ground (lacquer black) | `#160B09` | |
| Panels, and their border | `#211412`, `#3A2420` | |
| Body text (cream) | `#F3E6CF` | 14.50 on panels |
| Muted text | `#BCA68B` | 7.64 on panels |
| Gold (on lacquer: tab, titles, icons) | `#E8BC57` | 10.02 on panels |
| Red paper: base, lit centre, shadow | `#9A2014`, `#AD2618`, `#8C1C10` | |
| Gold ink (small text on red paper) | `#F4D27A` | 4.68 at the lit centre, more elsewhere |
| Foil (large numerals only) | `#FBE7A6` → `#E9C064` | large text, 3:1 floor |
| Lantern light | `rgba(255,104,52,.30)` at most, from the top edge | |

The red leans orange (cinnabar), not crimson, which keeps it clear of Jazz Age's
stage-light red. **Measured, not guessed:** an earlier draft (`#AD2618` paper, `#E8BC57`
gold) gave 3.83:1, and 2.77:1 on the gradient's lit centre, where the small "Balance"
label sits. Hence the darker paper, a lit centre no lighter than `#AD2618`, a paler gold
ink for small text on red, and foil kept to large numerals. Put the floors in
`test/theme-contrast.test.js`, and check muted text where the light is strongest.

**How it is drawn** (as the mockup shows)

- **Chrome stays quiet.** The account bar and tabs are lacquer, with one gold hairline
  under the bar and a gold underline on the open tab.
- **The light** sits behind the content, fixed to the top of the panel, strongest at the
  top right and fading well before the lists. Nothing is drawn in it.
- **The balance card is the envelope:** plain red paper, a fine foil rule inset from the edge,
  the balance in foil, "Balance" and "sats" in gold ink.
- **Primary buttons are red paper** with gold ink (Send, Unlock, Wear it). Secondary
  buttons are lacquer with a gold outline.
- **Reading stays on lacquer:** the note and transaction lists sit on dark panels in
  cream, exactly as they do in other dark themes.
- **The lock screen is a sealed envelope:** a portrait red envelope with one crease and a
  gold seal, above the logo and the form. The seal carries Sidecar's own garnish, the
  half orange slice, **exactly as a missing avatar shows it**: the file itself,
  `icons/avatar-default-dark.svg` (the cut for light grounds, `#463F3A`, which suits gold),
  inset to 64% of the disc at 72% opacity, as `.avatar-ph img` does. It is not redrawn or
  recolored, so if the mark is ever redrawn, the seal follows. **Centered on its whole
  circle:** the slice is half a circle, and its missing half counts toward its shape, so
  the seal centers the circle it is cut from, not the slice's bounding box. In the file
  that circle's center is at (16.59, 16.59), where the rind arc is symmetric about x = y.
  The file's own center (viewBox `2.6 2.6 32 32`) is at (18.6, 18.6), so the seal shifts
  the mark `translate(6.28%, 6.28%)`, right and down. Measured in the mockup, the circle's
  center lands on the seal's center at 32, 36 and 120px. If the mark is redrawn,
  recompute the shift. It also nods to the mandarin
  given at New Year for luck. The seal has a fine rim, and the mockup shows it at actual
  size (36px) and enlarged. The PIN is what opens it. The light is out of focus behind it and may breathe slowly, never
  under Reduce motion. The form keeps the full width it has today.
- **The pay card's button is the envelope:** one crease and the same gold seal with the
  same garnish, so the envelope that pays is the envelope that locks. The pay card can't
  load the file: it runs in the page, the manifest has no `web_accessible_resources`, and
  `content.js` draws its images inline (the logo is an inline SVG at `content.js:608`). So
  the garnish's five paths go inline there too, centered on the same circle. The avatar
  files already ask to be kept in step with each other if the mark is redrawn; this copy
  is a third to keep in step. Any zap bolt
  the theme still draws, such as the strike when a payment lands, stays lemon yellow
  (`#FFD600`/`#FFE234`, white core), as in every theme.
- **The gallery tile and the season card** show the "21" in foil on a small red envelope,
  under the same light.
- **The full-tab composer** takes the same light across its width. Not drawn yet.

**Type.** The Latin display face should be crisp enough to read as foil-stamped, from a
category the `fonts.css` table doesn't have, with lining figures (the stand-in's default
old-style figures turned the "1" in 21,000 into an "I"). Never "chop suey" lettering
(Latin letters dressed up as brush strokes). **No Chinese characters anywhere** in the
theme, art included, so no CJK font is needed.

**Leave out.** The rule: if an element would read as costume, it goes. So no lanterns
drawn, no banners or couplets, no calligraphy or other characters, no door, no
firecrackers or firecracker paper, no dragons, fortune cookies (an American invention),
pandas or zodiac animals, no generic red-and-gold clip art, and no animation beyond the
light breathing on the lock screen.

**Review:** a Chinese reader still looks at the finished theme before it merges, even with
no characters in it: the name, the red and gold, and the emboss.

**Nearest neighbors:** Brownstone (warm off-frame lamplight on dark ground, but amber light
on carved sandstone, where this light is tinted by red paper and falls on lacquer). Jazz
Age (red on black, but its red is crimson stage light used as an accent, where here red is
cinnabar paper with foil on it). Wabi-sabi (gold on a dark ground, but slate and mended
seams). Aurora Borealis, the edition just before it, is never in season with it.

## 4. Renaissance (light) — February 9 – 28

**Idea:** a workshop sheet of studies: metalpoint and red chalk (sanguine) on
rose-prepared paper, heightened with white, with compass arcs and construction lines left
showing. The sources are Leonardo's notebooks and Michelangelo's red-chalk studies. The
Valentine's link comes through the materials rather than clip art: Florentine workshops
really did prepare their sheets with a rose-tinted ground. Hearts and cupids stay out.

**Palette (draft, not yet through the contrast test)**

| Role | Value |
|---|---|
| Ground (rose-prepared paper) | `#F4E6DE` |
| Surface (white-heightened sheet) | `#FFF9F4` |
| Text (iron-gall ink) | `#2B1D17` |
| Main accent (sanguine) | `#A3432A` |
| Second accent (lapis, sparingly) | `#2D4C8F` |
| Lines and borders (metalpoint) | `#8C8079` |

**Type:** a chancery italic (*cancelleresca*), the letterform the Italian Renaissance
invented (the Aldine italic of 1501, Arrighi's 1522 writing book). No theme uses this
category; Aegean already has the Roman inscriptional capitals (Cinzel). The candidate
faces, Fondamento among them, haven't been checked yet. Chancery italics usually have
old-style figures, so the balance may need Sleepy Hollow's trick: lining digits from a
second face through `unicode-range`.

**Art:** the top layer is a sheet of studies (proportion geometry, a flying-machine
sketch, a drapery fold). The bottom layer is a perspective pavement, the tiled floor
receding to one vanishing point that Alberti wrote down.

**Signature moments**
- The **reaction heart drawn as an anatomical study** in sanguine hatching, after
  Leonardo's heart studies of about 1511–13. This is the one Valentine's nod that isn't
  clip art. First check that the icon can be restyled per theme.
- **Lock screen:** the circle-and-square proportion construction behind the form. It uses
  the geometry only, never the figure.
- The balance on a white-heightened cartouche.

**Nearest neighbors:** Aegean (classical, but cool, carved and Greek, where this is warm
and drawn). Mycelium (oat ground with a red, but organic, with no line drawing). Par Avion
and Industria (cream paper, where this ground is rose).

**First light edition.** The "light" path has never run for an edition, and the test
doesn't cover all of it (§8, item 5).

## 5. Magic Act (dark) — March 1 – April 7, proposed

**Idea:** the plates in Victorian books that explained stage illusions: a stage cut away
in section, mirrors at 45°, hidden edges drawn dashed, dotted sightlines from the stalls,
parts keyed A, B, C. The sources are Professor Hoffmann's *Modern Magic* (1876), Albert
A. Hopkins's *Magic: Stage Illusions and Scientific Diversions* (1897) and the Pepper's
Ghost diagrams (1862). The dark ground is the black-velvet stage of the 1880s "black art"
act, where black on black reads as nothing.

**Palette (draft)**

| Role | Value |
|---|---|
| Ground (black velvet) | `#0D0B0C` |
| Surface (velvet with a nap) | `#1A1617` |
| Text and line work (bone) | `#ECE4D2` |
| Main accent (the ghost's glass, a pale aqua) | `#8FD3D0` |

Aqua is chosen because the dark half doesn't have it. Every dark theme's accent
(`--gold` and `--orange`) is warm or grey: brass, gold, pumpkin, Jazz Age's red, Nixie's
orange, Departures' yellow, and silver in Film Noir and Cast Iron. Aurora's mint and violet
are the nearest, and it is never in season with Magic Act.

**Type:** 19th-century playbill wood type, a Tuscan or Clarendon. Nothing in the table is
Victorian wood type: Cast Iron's face is a groove outline and Jazz Age's Fascinate is
deco Broadway. Rye is one candidate; none has been evaluated yet.

**Art:** the top layer is the proscenium and fly gallery in section. The bottom layer is
the stage floor in section, with a trap, a mirror at 45° and the sightlines.

**Signature moments**
- **Lock screen:** the cabinet. Its doors are drawn shut on either side of the form, as
  `aria-hidden` decor, the pattern Departures, Sleepy Hollow and Turnstile already use
  there. Whether the doors can swing open on unlock depends on whether the unlock
  transition can hold for a moment, so check that before promising it. Nothing moves
  under reduced motion.
- The balance in a playbill box.

**Guardrail:** the approval window and the pay card take the palette and the wordmark
only. A theme about deception doesn't put an illusion diagram behind a request to sign or
pay.

**Nearest neighbors:** Constellation (engraved line work on black, but star figures in
gold, where this is sections and rays in bone and aqua). Jazz Age (the stage, but no
curtain or footlight glow: this is the machinery under the stage). Sleepy Hollow
(engraving at night, but a landscape).

## 6. Mint Julep (light) — April 15 – May 15

**Idea:** Derby day in the South: a sterling julep cup gone white with frost, crushed ice,
spearmint, seersucker, roses, a white rail, and horses at the flying gallop as the
19th-century racing prints drew them. Kentucky silversmiths made julep cups in coin silver
from the early 1800s.

**Palette (draft)**

| Role | Value |
|---|---|
| Ground (pale mint) | `#EEF5EF` |
| Surface (frosted silver) | `#F6F8F7`, edge `#B9C0BF` |
| Text (ink navy) | `#1C2733` |
| Main accent (spearmint, darkened for contrast) | `#2F7356` |
| Second accent (rose) | `#B3263F` |
| Balance (bourbon) | `#A8641E` |

**Type:** **Pinyon Script, which already ships** (for the backup sheet). It is copperplate,
the hand engraved on a presentation cup, and costs no bytes. It isn't in the display
table, so no theme wears it yet. Its figures will need checking for the balance.

**Art:** seersucker stripe (mint and white) in the gutters. The top layer is a magnolia
branch under white-painted veranda lacework. The bottom layer is the rail and the turf,
with a generic grandstand roofline (not the Spires) and horses at the gallop.

**Signature moments**
- **The balance engraved on the julep cup:** a silver surface with beads of condensation.
- **Lock screen:** the frosted cup, with the form on its band.

**Nearest neighbors:** Turnstile (white tile with a dark-green accent, but no tile grid
here, the greens are mint and the metal is silver). Werkstätte (cool white-painted metal,
where this is frost on silver over a mint ground). Populuxe (teal on cream, but no
lattice).

## 7. Scoreboard (formerly Ballpark) — June 1 – August 31, proposed

**Designs exist in the maintainer's local repository.** Start from them. Nothing of them is
in this plan: the session that wrote it could only see GitHub, and they have not been
pushed there. An earlier version of this section sketched a ballpark from scratch, before
the designs were known. It has been removed so that it can't be mistaken for them.

What this plan still adds, whatever the designs say:

- **The window:** June 1 – August 31, proposed, which no other edition touches (§1). If
  the designs assume another window, keep it clear of Mint Julep (ends May 15) and of
  Sleepy Hollow (starts October 1), and tag its release on its first day.
- **The rules in §2:** source material at least 75 years old, original drawings only, and
  no league or team names, logos or jersey scripts, ballpark names, or real players'
  likenesses.
- **Registration (§8) and the packaging gate:** art in `themes/scoreboard-*`, or whatever
  key the designs use. Settle the key before it ships.
- **Two neighbors to check the designs against.** Departures puts every character on its
  own split flap. A scoreboard that hangs each digit on its own plate comes close to it,
  so check the two stay apart. Turnstile's primary actions are dark green, so a green
  scoreboard theme needs its own color for actions.

## 8. Registering an edition (checked against `main` and PR #477)

The earlier handoff's list, corrected for what has changed since:

1. An entry in `EDITIONS` in `seasons.js`: `{ key, name, mode, from, to }`, plus `years`
   for Red Envelope (§3). Its window must not touch another's (§1).
2. `themes/<key>.css`, and its field in `themes/patterns.css` (both the panel and
   `body.compose-page`).
3. Linked from **six** pages: `sidepanel.html`, `compose.html`, `prompt.html`,
   `help.html`, `wallets.html`, `welcome.html`. `test/seasons.test.js` enforces this.
   PR #477 also registers Aurora in `theme-tile.html` and `theme-tile.js`; follow it there.
4. `content.js`: the key in `CARD_THEMES`, and a palette in `getThemeColors` for the pay
   card.
5. **A light edition goes in four lists, and only one is tested.** They are
   `LIGHT_THEMES` in `composer-core.js` (tested), `LIGHT_THEMES` in `prompt.js` (which
   swaps the approval window's wordmark), and `LIGHT_CARD_THEMES` in `content.js`, which
   appears twice. Leave Renaissance out of `prompt.js` and nothing fails, but the approval
   window draws the dark wordmark on rose paper. Extend the season test to read all four,
   and check that it fails before the key is added.
6. `styles.css`: `.season-card-name[data-edition="<key>"]` for the name on the card.
7. Contrast floors in `test/theme-contrast.test.js`.
8. The face: an `@font-face` and a table row in `fonts.css`, the license in `fonts/`, the
   README font list and a README tribute paragraph.
9. `help.html`'s Themes section names Sleepy Hollow and its dates in one sentence. With
   seven editions that becomes a short list.
10. `scripts/gen-<key>.py` for the art, with `-wide` variants, every file named
    `themes/<key>-*`.
11. Lock-screen decor, if any: `aria-hidden` elements in `sidepanel.html`, empty and
    invisible in every other theme.
12. The changelog and What's new for the release tagged inside its window.

The season card's copy ("here until {{date}}") is written generically. The end-of-season
toast ("It comes back in {{month}}") needs the one new string from §3 for an edition's
last listed year.

## 9. Order of work

| When | Work |
|---|---|
| Now – late Nov | Decide §0. A mockup page for the five, each drawn as a 300px sidebar (as `new-themes-mockups.html` was), with palettes run through the contrast test early. Check the New Year dates against the Observatory, and find a reviewer for Red Envelope |
| December | PR #477 lands first: Aurora, the packaging gate and the no-overlap test, which the rest build on. Decision 7 belongs with it |
| Dec – early Jan | **Red Envelope** pull request, carrying `years`, the toast string and the wider no-overlap test. Merged before Jan 18 |
| Mon Jan 18, 2027 | Tag the Red Envelope release |
| Jan – early Feb | **Renaissance** pull request, with the four-list test fix (§8.5). Merged before Feb 9 |
| Tue Feb 9 | Tag the Renaissance release |
| Feb | **Magic Act**, if March is confirmed. Tag Mon Mar 1 |
| Mar – Apr | **Mint Julep**. Tag Thu Apr 15 |
| Apr – May | **Scoreboard**, from its existing designs. Tag Tue Jun 1 |

Preview any edition before its window: Settings → Developer → "Pretend today is"
(`settings.devDate`, local builds only). Merged code can be previewed this way any time.
Only the release tagged inside the window ships the art.
