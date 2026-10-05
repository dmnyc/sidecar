# Handoff: Phantom Bouquet, the November special edition (pre-build, art stage)

**For:** the agent picking this up until the weekly limit resets.
**Written:** 2026-10-05.
**State:** design agreed; leaf art still being prototyped. Lives on branch
`feat/phantom-bouquet` in `docs/phantom-bouquet/` (pushed at the maintainer's request;
`scripts/package.sh` strips `docs/` from the extension package, so none of it ships). No PR.
No theme code yet: `seasons.js`, `themes/` and the pages are untouched.

---

## 1. Context you need

- Special editions are seasonal themes, a feature already shipped. `seasons.js` lists them;
  Sleepy Hollow is the first and now runs **Oct 1 – Nov 8**. Wearing one is per account,
  over the account's own theme (`settings.seasonalBy`). See `seasons.js`,
  `test/seasons.test.js`, and the Sleepy Hollow files (`themes/sleepy-hollow*.{css,svg}`,
  `scripts/gen-sleepy-hollow.py`) as the reference for how an edition is built and checked.
- Read CLAUDE.md first, especially the "Working rules (the 1.15.6 lessons)": ask before
  touching `main`, tags, CLAUDE.md or committing handoffs; check visual work at panel width,
  in the composer at laptop and desktop widths with its card over the scene, and on the
  lock screen; a PR body describes the final diff; PR attribution is a rotating drink line.

## 2. What the maintainer decided

- **Name: Phantom Bouquet.** This is the Victorian term for skeleton-leaf bouquets. Edward
  Parrish, *The Phantom Bouquet* (Lippincott, 1864); *Phantom Flowers* (J. E. Tilton,
  Boston, 1864). The maintainer called the name "amazing".
- **Subject: skeleton leaves**, meaning leaves reduced to their vein lace. It came out of
  fall leaf pressing; the maintainer supplied photos of pressed and dyed skeleton leaves.
- **A light theme.** Warm linen ground (#ECE5D6 with a faint weave). Ivory, bleached
  skeletons fill the background behind the content. A few leaves are tinted in autumn dyes:
  madder #A3443A, ochre #B7832A, rust #9E4F27, olive #66733A, plum #6B3B5A. Tinted leaves use
  `mix-blend-mode: multiply`, so colours deepen where they overlap.
- **Window: Nov 9 – Nov 30.** It follows Sleepy Hollow, and Aurora would start Dec 1. Not
  yet in `seasons.js`.
- **Liked:**
  - The large ivory leaf filling the field "without being an obstruction" (see
    `bodhi-closeup-liked.png` for the look).
  - "Leaf layering and translucency is excellent."
  - Leaves cropped by the panel's edges.
  - Lace lines at a constant on-screen width.
- **Must hold:**
  - Veins stay inside the leaf outline (clip to the outline; only the margin line and the
    stem sit outside).
  - Overlapping leaves are offset, especially at the top, so none hides another.
  - Veins are **connected**, never floating, and **taper**: thick at the stem, fine at the
    margin.
  - Nothing sits under the tab labels or topbar icons. The row between the tab bar
    (y ≈ 88) and the first card (y ≈ 148) holds one tinted leaf, whole.
- **Rejected:**
  - Procedurally invented leaf outlines (`proto/leaves.py`). The maintainer said "all
    unacceptable". The maple never convinced.
  - Do not trace the maintainer's reference photos. They are commercial clip art, one
    watermarked.
- **Source for outlines:** `proto/variety.svg`, "Variety of Leaves", which the maintainer
  says is **public domain**. Ask where it's from (Openclipart? Commons?) and record the
  source and its public-domain status in NOTICE when it ships. It has no metadata inside.

## 3. The current prototype (`proto/traced.py`)

`load()` parses `variety.svg` with svgelements, giving 14 groups (9 distinct shapes:
indices 0, 1, 2, 4, 5, 6, 7, 9, 12; the others are recolours). For each group:

- The **blade** is the largest path, and its exterior becomes the outline and the clip.
- Paths the size of the blade are outline rings and are skipped.
- The **stem** is whatever part of the other paths lies outside the blade, turned into a
  centreline stroke. Leaves 2, 6 and 7 have no stem.

`render()` places a leaf by its blade centre, its longest side in px, and **the direction
its tip points**. It draws:

- a tint fill;
- two Voronoi lace meshes using non-scaling strokes;
- the grown vein network (`vein_paths`), as tapered filled shapes;
- the margin and the stem.

The clip-art's own floating veins are deliberately not used.

**Fixed in the second turn (2026-10-05), not yet reviewed by the maintainer:**

1. **Slits in the blade outline.** The source cuts its veins out of the blade as thin slits.
   The blade is now sealed with `buffer(6).buffer(-6)` (mitre joins) before anything uses
   it. Midribs on leaves 0, 5 and 9 now run straight down the middle; leaf 5's stem
   attaches at its notch. Check with `debug-midrib.png`: green = base, orange = tip(s),
   red = midrib.
2. **Leaf 2's base was reversed.** It is now in `BASE_AT_NARROW_END`, which flips the
   heuristic.
3. **The lobe-tip picker always passed** (the `for t in []` clause made `all()` true), so
   neighbouring points were picked. Fixed; maples now get 3 or 5 real lobe tips.
4. **Maples:** 3 secondaries per primary (4 on the main one), starting 30–85% along it,
   each at most 0.38 of the primary's length.
5. **Hearts (`BROAD = {0, 5, 9, 10}`):** veins spread wider (100° at the base, 72→42°
   further up) and bend less (0.012 per step, against 0.03 for narrow leaves), so they no
   longer read as feathers.
6. **The top leaf** is now leaf 2, madder, whole, lying across the heading row with its
   tip pointing left.
7. **The foot is down to two leaves** (rust maple, ochre drop). A third was always either
   under the compose button or cut away by the bottom edge.
8. `render()` now takes the **tip direction** (degrees clockwise from up) instead of a raw
   rotation, plus `idx=` (the leaf's index in the source).

**Fourth turn: `proto/skeleton.py`, a new renderer (the current one).** Written after the
honest assessment above; it replaces `traced.render` for both `lab3.py` (sheet) and
`panel2.py`. Outlines and stems still come from `traced.py`. The vein hierarchy is built the
way real leaves are:

- **Primaries:** the midrib (centre path), or for maples one vein per lobe tip plus up to two
  short ones into the lower lobes. Hearts (`BROAD`) get a pair of basal veins leaving the
  midrib just above the notch.
- **Secondaries:** staggered (one side offset half a spacing), spacing and angle jittered,
  about 35% fork near their ends. They run straight and bend toward the tip only near the
  margin (`march`, bend scaled by closeness to the edge).
- **Collision:** every primary is laid first; a secondary that meets an existing vein
  joins it and stops (`_Others` ignores its own parent near its start). This removed the
  crossings.
- **Loops at the margin** on smooth-edged leaves; toothed ones (`TOOTHED`) run out to the
  edge.
- **Tertiaries:** irregular rungs between neighbouring secondaries, some skipped.
- **Lace** is grown inside each space the veins enclose (`areoles`), so every strand ends
  on a vein.
- **No outline:** a fine 0.55px marginal vein instead. The tint deepens along the veins
  (a halo fill).

My view: this is the first version that reads as skeleton leaves. See
`leaf-detail-latest.png` (heart, maple, plum heart at 2x), `leaf-shapes-latest.png` and
`panel-latest.png`. **Not yet seen by the maintainer.**

Known weaknesses of this version:
- **File size is the blocker:** the panel layer is 1.24 MB (326 KB gzipped). Fixes, in
  order:
  - coarser lace on the big faint ivory leaves (cell size from leaf size and opacity);
  - drop lace where cards cover it;
  - merge all of a leaf's vein shapes into one `<path>`;
  - 0 decimal places.
- **Plum heart (leaf 5):** the left lower lobe has lace but no secondaries (its basal vein
  is short).
- **Madder top leaf (leaf 2):** its veins look sparse at 136px.
- **Run time** is about 6 s for the sheet; fine.

**Still open:**

- **File size:** the panel layer is about 358 KB. Simplify the outlines more, round
  coordinates, and drop the fine lace where cards cover it. Target: near Sleepy Hollow's
  layers.
- **Leaf 2's narrow tail** shows as a double line at its base (its petiole is part of the
  blade outline). Acceptable, or trim it.
- **Not yet checked by the maintainer:** connected and tapering veins on all nine leaves
  (`leaf-shapes-latest.png`) and the new panel (`panel-latest.png`). Ask before building.

**To run:**

```
pip install scipy shapely svgelements numpy
cd docs/phantom-bouquet/proto
mkdir -p lite
python3 lab2.py
node shot.js file://$PWD/lab2.svg lab2.png 1500 640 1
python3 panel2.py
node shot.js file://$PWD/mock-lite.html mock.png 360 760 2
```

- `lab2.py` writes a specimen sheet of the 9 shapes.
- `panel2.py` writes `lite/panel.svg` (`mkdir lite` first).
- `mock-lite.html` shows it under stand-in UI blocks.
- The scripts import each other by relative path. `traced.py` has `SRC` hardcoded to the
  old scratchpad path; point it at `variety.svg` in the same folder.
- `shot.js` loads Playwright from `/opt/node-tools/node_modules/playwright`, the global
  install in the cloud container; adjust the path elsewhere.
- Generated renders (`lab*.svg/png`, `lite/`, `dbg*`) are git-ignored by
  `proto/.gitignore`.

## 4. Next steps (in order)

1. Fix bugs 1–3 and 5, render the specimen sheet, and show the maintainer before going
   further. **Get sign-off on the leaves before building the theme.** Shape quality is
   where every previous round failed.
2. Then build the theme on a `feat/` branch, following Sleepy Hollow's pattern:
   - a generator script `scripts/gen-phantom-bouquet.py`. Note it needs scipy, shapely and
     svgelements, which other generators don't; ask whether that is acceptable or whether
     the lace should be stdlib-only;
   - `themes/phantom-bouquet.css` and its plates;
   - the `seasons.js` entry, `content.js` CARD_THEMES and palette, `LIGHT_THEMES` in
     `composer-core.js`, `prompt.js` and `content.js`;
   - links on all six pages, contrast floors, and a measured opacity limit plus a test so
     hint text stays readable over the field (see the Werkstätte and Ukiyo-e tests in
     `test/theme-svg-assets.test.js`).
3. **Type:** proposed Sorts Mill Goudy (OFL, Barry Schwartz; has an `lnum` feature so the
   balance can use lining figures). Read its licence record before bundling.
4. **Proposed but not yet built:**
   - balance figures arrive as a soft tint and sharpen into lines;
   - the lock screen as a garland of skeleton leaves on twine, swaying slightly, still under
     Reduce motion;
   - the composer gets its own wide arrangement.
5. Unanswered question: the panel layout was tuned to the Accounts tab; other tabs need
   checking.

## 5. Fifth turn (2026-10-05): maintainer feedback on `skeleton.py`, then a grown-vein attempt

**Feedback on the `skeleton.py` version** (`leaf-detail-latest.png`): "an improvement", but:

- "when I zoom in … the stem is disconnected from the spine";
- "many leaves still appear deformed";
- "still lacks a degree of believability".

My diagnosis:

- **The stem gap** is real. The stem is a separate stroke from the traced centreline and
  the primaries start at `base`; they meet near each other, not as one shape.
- **"Deformed"** is mostly the source outlines: curled teardrops 2 and 4 (paisley shapes)
  and the cartoon-lumpy maples 1 and 12.
- **Believability:** the fishbone of evenly spaced secondaries plus ladder-like tertiaries
  reads synthetic.

**Curation decided this turn:**

- Drop the curled drops (2, 4).
- Keep the hearts (0 has a bodhi-like drip tip; 5; 9), the serrated oval (7) and the
  willow (6).
- Keep the maples (1, 12) only on trial.
- Evaluated and rejected: the game-icons leaf silhouettes (CC BY 3.0, too stylised).

**The attempt: `venation.py` + `vrender.py` (sheet: `lab4.py`; output
`grown-veins-latest.png`).**

- Space colonisation after Runions et al. 2005, with leaf growth: the simulation runs in
  final coordinates with D, kill and birth distances divided by the current scale.
- Primaries are seeded (midrib, or a maple's lobe veins); everything else grows from them.
- Widths use the pipe model (n = 2.6).
- Long strokes are cut by heaviest-child chains.
- Free ends are joined into loops.
- Voronoi lace fills the spaces between veins.
- Runs in under a second per leaf.

**Result, honestly:**

- **The stem fix works.** The stem is drawn as the first stretch of the midrib's own
  filled stroke, so there is no join. Port this to whatever renderer wins.
- **The grown secondaries are worse than `skeleton.py`'s.** They come out as right-angled,
  meandering lines, like circuit-board traces (see the hearts in `grown-veins-latest.png`).
  The likely cause is the huge early step (D/s with s0 = 0.1 is about 16 px), which makes
  blocky L-turns, plus no constraint pulling secondaries toward the tip. Options:
  - s0 nearer 0.3, more growth steps, and a fixed D rather than D/s;
  - a directional bias toward the tip and the margin;
  - heavier smoothing of chains.
  Or abandon growth and keep `skeleton.py`'s structure with the stem fix ported in.
- **This version has not been shown to the maintainer.**

**Recommended next step:** take `skeleton.py` (the version the maintainer called an
improvement), port the continuous stem from `vrender.py` (stem points + primary in one
`tapered_var` stroke), apply the curation above, then show the maintainer a sheet at 2×
before touching the panel.

**Maintainer request on process:** keep this handoff updated after every turn.

## 6. Sixth turn (2026-10-05): the recommended step, done — stem ported, curation applied

Picked up from a fresh checkout (the branch had to be fetched: it existed only on
origin). Toolchain set up on the maintainer's Mac: `pip3 install --user scipy shapely
svgelements numpy`, and Playwright installed at `~/.zcode/shot-tools` with a `shot.js`
that drives the cached Playwright Chromium (`~/Library/Caches/ms-playwright/
chromium-1243/…`) — the repo's `proto/shot.js` still points at the cloud container's
`/opt/node-tools`, so the local copy was used for every screenshot below.

**The recommended step was taken in full:** `skeleton.py` keeps its structure — the one
the maintainer called an improvement — and the continuous stem from `vrender.py` is
ported in. Specifically:

- `tapered_ws` (was `vrender.tapered_var`): a filled stroke whose width is given point
  by point, so a stem of constant width can flow into a tapering midrib as one shape.
- `network()` now returns the primaries as `(pts, ws)` pairs. After the secondaries are
  laid (so their positions along the midrib are unchanged), the stem's centreline is
  prepended to the widest primary — the midrib, or a maple's main lobe vein — with the
  stem's width a little heavier than the midrib's base, exactly as `vrender.leaf_svg`
  did. Secondaries and tertiaries are untouched.
- In `render()`, the primaries are drawn **outside the clip** (the stem lies out past
  the margin) and `T.stem_path` is gone from the leaf: no separate stroke, no join.

**The curation is applied** in the new `proto/lab5.py` (the specimen sheet) and
`proto/lab6.py` (closeups at 400 px): the curled drops (2, 4) are out; the hearts
(0, 5, 9), the serrated oval (7) and the willow (6) are in; the maples (1, 12) are on
trial. `panel2.py` still runs unchanged over all shapes, including the dropped ones —
the panel is not being rebuilt yet.

**Result:** in `stem-join-latest.png` (closeups at 2×) the stem meets the spine as one
continuous taper on every stemmed shape — the discontinuity the maintainer saw in
`leaf-detail-latest.png` is gone. In `curated-sheet-latest.png` the seven kept shapes
stand together at 2×. `panel-latest.png` is re-rendered through the ported renderer;
its stems (the rust maple's, at the foot) are continuous now too.

**Not yet seen by the maintainer** — this sheet is what turn 5 recommended showing,
and it is the gate for everything else.

**Known issues, unchanged from turn 4's list:** plum heart 5's left lower lobe can end
up lace without secondaries when its basal vein comes out short (seed-dependent; the
sheet's seed gives it veins); the maples' outlines are still the source's cartoon-lumpy
ones, which is why they are on trial; the panel layer is still ~1.24 MB — the size work
starts only after the leaves are signed off.

**Next step:** show `curated-sheet-latest.png` (and `stem-join-latest.png`) to the
maintainer. If the leaves pass, the next session builds the theme per section 4,
step 2 — and asks the two open questions there (scipy/shapely/svgelements as generator
dependencies, and the source of `variety.svg` for NOTICE).

**To run locally (Mac):**

```
pip3 install --user scipy shapely svgelements numpy
cd docs/phantom-bouquet/proto
mkdir -p lite
python3 lab5.py && node ~/.zcode/shot-tools/shot.js file://$PWD/lab5.svg lab5.png 1500 780 2
python3 lab6.py && node ~/.zcode/shot-tools/shot.js file://$PWD/lab6.svg lab6.png 1500 900 2
python3 panel2.py && node ~/.zcode/shot-tools/shot.js file://$PWD/mock-lite.html panel.png 360 760 2
```

(The original container instructions are in section 3; only `shot.js` differs.)
