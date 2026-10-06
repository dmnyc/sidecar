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

## 7. Seventh turn (2026-10-05): the believability pass

The maintainer answered the sixth turn's sheet with five photographs of real skeleton
leaves: still not convinced, "a large believability gap". Studying the photos against
the render named what was missing, and all of it was interior structure — the outlines
were not the problem this time:

1. **Ladder rungs are the dominant texture.** Between neighbouring secondaries a real
   skeleton carries a dense, orderly ladder of slightly oblique rungs, a few px apart
   at panel scale. The old render had sparse, wandering rungs, so the inter-vein bands
   read as empty.
2. **Secondaries arc continuously** toward the tip and loop into their neighbour just
   inside the margin — a visible series of arches. The old ones ran straight and bent
   only at the end: a kink, not an arc.
3. **The lace is organised**: cells elongated along the vein direction, finer against
   the margins and veins, coarser mid-band. Isotropic same-size Voronoi everywhere was
   the "burnt paper" look.
4. **Four visible weights**: midrib, secondary, rung, hairline lace. The old render
   collapsed the middle two.

What changed in `skeleton.py`:

- `march()` arcs a secondary toward the tip along its whole length, turning harder as
  it nears the margin (a factor of about ten between mid-run and the edge).
- Secondaries come thinner (0.52 of the parent's width there), spacing jitter is wider
  (0.62–1.5), forks rarer.
- **Arches**: each consecutive pair of secondary ends is joined by a shallow quadratic
  bulging away from the parent vein — the brochidodromous loop, no longer dependent on
  the old margin-track walk (which the wider spacing jitter was breaking).
- **Ladders**: rungs connect same-fraction stations on neighbouring secondaries (the
  band's veins run roughly parallel, so same-fraction points face each other and the
  fan comes out orderly), with a touch of slide and bow. They are laid in a deferred
  pass, after **every** primary's secondaries exist, and a rung whose interior would
  land on any vein is dropped — this fixed the plum heart, whose midrib-band rungs
  used to run straight across the basal veins' secondaries laid after them.
- The hearts' basal veins now carry secondaries on their **outer side only** (the
  `sides == 'outer'` machinery existed but had never been used); inner ones crowded
  the midrib's lower secondaries into a tangle.
- **Lace**: `areoles()` adds boundary seeds along the region's rings (a third as many
  again), so cells finish finer against veins and margin; the sliver shape of the
  spaces elongates the cells along the flow for free. Cells a little larger (7.5 px)
  and the stroke lighter (0.55 opacity): airy, not grey.

**Result** (`stem-join-latest.png` at 2×, `curated-sheet-latest.png` at 2×,
`panel-latest.png`): the interiors now sit in the references' family — dominant midrib,
arcing secondaries with margin arches, orderly ladders, gradient lace. The willow, the
serrated oval and the madder heart are the convincing ones; the panel reads calm at
1×, and its layer dropped from 1.24 MB to 1.08 MB with the lighter lace.

**Where the remaining gap is:** the outlines. The clip-art silhouettes are symmetric
and slightly paunchy (the hearts), or lumpy (the maples); every photo the maintainer
supplied has an asymmetric, gracefully curved outline. `skeleton.py` can only dress
the outline it is given. Next lever, maintainer's call: better source silhouettes —
the source of `variety.svg` (still unrecorded, see section 2) may have better shapes,
or the outlines could be redrawn by hand against the photo references.

**Not yet seen by the maintainer.**

## 8. Eighth turn (2026-10-05): the outlines are now generated, not traced

The seventh turn's sheet came back with the strongest verdict yet — "incredibly
sloppy, they don't follow the basic geometry of real leaf shapes" — and then three
more reference images: a line-art sheet of six skeletons (serrate ovates,
lanceolates, a lobed mulberry-like form), and two maples. Reading them together
settled what the complaint was: not the venation, which the seventh turn fixed, but
the silhouettes themselves. The clip-art outlines from `variety.svg` are hand-drawn
cartoons: no width law, no proper base, no acuminate progression. Dressing them
better was never going to close the gap.

So `proto/genleaf.py` is new: outlines built from the law real leaves follow,
replacing `variety.svg` as the source of every shape.

- **Two-arc width profile.** Each side is convex from the base to the widest point
  (`peak`, 26–52% of the axis) and concave from there into an acuminate point. A
  `notch` factor drops both sides steeply into the petiole's sinus — without it the
  base closes as a flat shelf, which no leaf has (that exact bug cost one iteration).
- **Cordate bases**: the sides dip below the sinus as broad lobes around the petiole,
  reaching about halfway out the blade — not the narrow collar the first attempt
  gave.
- **Serration**: regular teeth spaced in arc length, graded to the local blade width,
  each leaning tipward (long baseward slope, sharp drop — peak at g≈0.85). Teeth
  displace along the polygon-orientation outward normal, which fixed the old
  reference-point test that broke on the maple's radial ring.
- **Asymmetry**: a few percent of low-frequency difference between the sides, plus
  jittered peak positions — no leaf is a mirror of itself.
- **`palmate()`** for the maple: lobe tips fan from the base with per-lobe radii
  (central longest), rounded sinus floors between them, everything jittered a few
  percent so it is not a star symmetry. The existing palmate venation branch picks
  the lobe tips up automatically and fans a primary to each.

The vein pipeline is untouched and adapts on its own: generated leaves are returned
in the same `{'blade', 'stem'}` shape `traced.load()` produced, so `skeleton.py`
cannot tell the difference. Type sets are re-pointed in `lab7.py`
(`T.PALMATE = {7}`, `T.BROAD`, `SK.TOOTHED`). The maple is form 7; the sheet is now
eight forms — two hearts, a serrated cordate, a round serrated cordate, an
ovate-lanceolate, a lanceolate, the willow, and the maple.

`panel2.py` still renders the old traced shapes — the panel is rebuilt only after
the maintainer signs off on the sheet, per the rule that has governed every turn.

**Where this now stands** (`curated-sheet-latest.png` at 2×, `stem-join-latest.png`
closeups at 2×): every outline obeys the geometry law; serration reads as cut; the
maple's structure matches the white reference — fan of primaries, ladders in lobes,
deep rounded sinuses. Weak spots, named honestly: the hearts' basal lobes are
slightly horned where the dip meets the rising profile; the maple's lobes are a
little uniform and could carry one more secondary each; and leaf-to-leaf the family
is still tidier than a real 1864 bouquet, which had torn and damaged leaves.

**Next step:** show the maintainer. If the shapes pass, the theme build (section 4,
step 2) follows on this branch — and the generator dependency question there grows
one more answer: `genleaf.py` itself needs only numpy.

**To run the new sheets:**

```
python3 lab7.py && node ~/.zcode/shot-tools/shot.js file://$PWD/lab7.svg lab7.png 1500 780 2
python3 lab8.py && node ~/.zcode/shot-tools/shot.js file://$PWD/lab8.svg lab8.png 1500 900 2
```

**Not yet seen by the maintainer.**

## 9. Ninth turn (2026-10-05): contour and vein geometry corrections

Continued on `feat/phantom-bouquet`. No commits, pushes, or theme integration.
The two current PNGs are refreshed: `curated-sheet-latest.png` (280px specimens,
2× capture) and `stem-join-latest.png` (460px closeups, 2× capture).

Corrections in this pass:

- `genleaf.py` uses cubic contours with a real cordate sinus at (0, 0), rounded
  lobes below it, and an acuminate upper contour. The previous generated contour
  closed below the intended petiole attachment; the test specimen's margin was
  9.34 source units away from that attachment. Generated specimens now carry
  explicit base/tip landmarks, honored by `traced.base_and_tips()`.
- The trial maple has shorter lower lobes, a narrower fan, and pointed lobe ends
  instead of cosine-rounded ends. It remains an art trial, not an identified species.
- Rung normals are normalized. Previously displacement grew with gap squared;
  one regression specimen had a bend 42% of its span. Rungs now follow sampled
  quadratic curves, with maximum bow below 6.1% of their span.
- Rung collision checks use the actual connecting geometry instead of three
  isolated point tests against zero-width lines.
- Secondary and fork growth now sees previously laid veins and stops at the exact
  intersection rather than one integration step beyond it. Secondaries grow from
  the apex downward, with narrower spacing variation and more continuous curvature.
- The marginal arch code was using a tangent as a position (`T.along` returns
  position, tangent); that is corrected. Arches outside the blade are rejected.
- Cross-vein spacing is denser and the allowed inter-secondary gap is wider.

Validation: `cd docs/phantom-bouquet/proto && python3 -m unittest test_geometry`
passes all three behavioral checks (petiole attachment, exact collision endpoint,
and bounded/noncrossing rungs). All three fail against the previous HEAD's modules.
`git diff --check` passes. Both specimen sheets were generated and visually inspected.
The Browser plugin could not initialize because of a local native-module code-signing
error; the handoff's local Playwright screenshot helper worked outside the sandbox.

Reference consulted for the distinction between venation patterns:
[Manual of Leaf Architecture](https://repository.si.edu/server/api/core/bitstreams/9b5627fb-50bf-4c68-b887-d291c5be6bc0/content).
No reference image was traced or bundled.

Assessment: the tangled/angular cross-veins and buried petiole problem are improved.
Some broad patches still rely mostly on fine lace, and the maple remains stylized.
Do not call the art approved or botanically exact. The panel mock is still the older
arrangement; composer and lock-screen work has not begun. Get visual feedback on
these specimens before integrating the theme, as already agreed in the handoff.

## 10. Tenth turn (2026-10-05): outward branching is the actual target

The maintainer rejected the ninth-turn specimens as missing the desired qualities,
and supplied four additional maple skeleton references. The explicit direction:
veins must visibly emanate from the stem and spine outward, with natural, organic
geometry. This is not solved by correcting rung intersections alone. The prior
ladder/Voronoi construction still read as strong lines over a separate mesh.

A separate experiment, `proto/outward.py`, now renders **one maple only**. It does
not replace the previous sheets or integrate anything into the theme. Run it from
the prototype directory with `python3 outward.py`; output is `lab-outward.svg`.
The saved review image is `outward-maple-latest.png`.

- Original asymmetric five-lobed contour with broader lobes and unequal teeth;
  no supplied image was traced or bundled.
- Five primaries start at the petiole, with curved, oblique secondaries leaving
  those primaries. Secondary paths stop at existing framework intersections.
- Minor branches grow from that framework toward progressively finer source
  points, using small fixed steps and directional inertia. No Voronoi fill or
  independent ladder bands. Every growth node has a parent leading to the root.
- Terminal branches join nearby, unrelated branches in their forward direction.
  These joins close the fine network. Junctions are smoothed together in the graph,
  rather than moving individual strokes apart at attachment points.
- Width comes from downstream branch flow. Interior geometry is clipped to the
  blade; the exact petiole section of the rooted stroke is repeated outside it.

Three iterations were inspected: the first had many short spurs and framework
crossings; the second closed more of the net but was too angular; the third smooths
shared junctions and regularizes the margin sampling. The final graph has 26,076
nodes; a runtime check confirmed a single root and an earlier parent for every
other node. Raw geometry had a few short excursions at the margin (maximum 2.8px
on an edge), hence the explicit blade clip. The existing three `test_geometry`
checks still pass; those cover the older renderer, not the whole new experiment.

Assessment: the new specimen better expresses a continuous stem-to-edge hierarchy,
but the minor cells and some branch departures still look more regular than the
references. It is **not approved**. Show the new maple close-up and use the
maintainer's visual feedback before adapting other leaf shapes. File size remains
prototype-scale (~954 KB SVG); optimization and theme integration come later.
No commits or pushes.

## 11. Eleventh turn (2026-10-05): start fresh; establish the anatomy first

The maintainer rejected `outward-maple-latest.png` and explicitly authorized
starting fresh if the generator is not working. Do not keep refining that failed
specimen or treat any previous art as accepted.

Started over with the built-in image generation tool, producing a **raster botanical
structure study**, `maple-structure-study.png`. It shows a broad five-lobed maple,
pointed subsidiary teeth, deep rounded sinuses, a curved petiole, and tapering
primary/secondary veins. It intentionally omits the fine skeleton lace so the
silhouette and branching can be judged first. The prompt is saved in
`maple-structure-study-prompt.txt`. This is an art-direction study, not a finished
transparent theme asset or a new procedural generator. No supplied reference image
was traced. The old experiments are preserved, but are not the basis of this study.

The generated result is visibly more recognizable as a maple than the procedural
attempts. It still requires the maintainer's judgment; do not assume approval.
Next: get feedback on this structure before adding fine lace or implementing a
production asset. No commits, pushes, or theme integration.

## 12. Twelfth turn (2026-10-05): approved structure, first lace study

The maintainer explicitly approved `maple-structure-study.png` ("yes") and then
approved continuing to the fine lace ("ok"). **That structure is now the approved
foundation.** Preserve its silhouette, petiole, and main vein layout.

Used the built-in image generation tool to edit that exact saved image, adding
fine interconnected venation. Saved the result separately as `maple-lace-study.png`
and its exact prompt as `maple-lace-study-prompt.txt`. The approved structure image
is preserved. The result visually retains the outline and major branching, with
fine lace throughout the blade. This remains an ivory-background raster study,
not a transparent production asset. Fine-lace appearance has not yet been approved.
No theme integration, commits, or pushes.

## 13. Thirteenth turn (2026-10-06): lace approved; expand the set

The maintainer called `maple-lace-study.png` "absolutely perfect", authorized
committing the approved work, and requested a variety of companion leaf shapes.
**Both the maple structure and lace are approved.** Use the approved lace study as
the visual standard for all new leaves. The provided
`/Users/daniel/Downloads/Variety-Of-Leaves.svg` is inspiration for outer shapes.

The approved maple studies, exact prompts, and this handoff are being committed.
Failed procedural experiments described above remain uncommitted in the working
tree and are not approved production assets. No push was requested.
