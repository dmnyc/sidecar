# Phantom Bouquet — approved art handoff

Updated: 2026-10-06. Branch: `feat/phantom-bouquet`.

## Approved artwork

The maintainer approved the maple structure, called its completed lace study
"absolutely perfect", and subsequently authorized committing the companion set
and oak. The set has six distinct forms:

- `maple-lace-study.png`: approved maple skeleton and the visual standard.
- `companion-leaves-study.png`: one plate with cordate/drip-tip, serrated ovate,
  smooth ovate-lanceolate, and slender lanceolate leaves.
- `oak-lace-study.png`: rounded, irregular oak lobes with a single midrib and
  outward branches into the lobes.
- `maple-structure-study.png`: approved outline and major-vein foundation,
  retained as a useful source for edits.

Each study has an accompanying `*-prompt.txt` with its exact generation prompt.
All were made with the built-in image generation tool. They are brown-on-ivory
raster studies, **not yet transparent production assets**. Companion leaves are
still on a single plate. No theme code or seasonal registration has been added.

## Art direction

The leaf must read as one continuous structure: petiole into midrib or primary
fan, outward secondaries, smaller branching veins, then delicate connected lace.
Preserve clear taper and hierarchy. Fine veins connect to parents and neighbors;
they do not float or look like a separate uniform mesh. Natural asymmetry,
recognizable silhouettes, and organic branching matter more than algorithmic
regularity. The oak has successive branches along its midrib; the maple has a
basal fan. Do not substitute one anatomy for the other.

The procedural attempts were rejected. The image-generated maple established the
approved direction. Future work should use these approved images as references.
The supplied `/Users/daniel/Downloads/Variety-Of-Leaves.svg` inspired the range of
outer shapes, and supplied oak photographs informed oak anatomy. These were visual
references, not traced production assets. If the original SVG is ever bundled,
confirm and record its source and public-domain status first; that source remains
unrecorded.

## Planned edition

- Name: **Phantom Bouquet**, inspired by Victorian skeleton-leaf bouquets.
- Light theme, warm linen ground `#ECE5D6` with a faint weave.
- Large translucent ivory skeleton leaves behind content, with a few autumn-dyed
  leaves: madder `#A3443A`, ochre `#B7832A`, rust `#9E4F27`, olive `#66733A`,
  plum `#6B3B5A`. Earlier composition work used multiply blending for tinted leaves.
- Proposed availability: **Nov 9–Nov 30**, following Sleepy Hollow.
- Favor layering, translucency, leaves cropped by panel edges, and fine lines that
  remain legible at their actual display sizes. Keep decorative leaves clear of
  tab labels and topbar icons. The heading row between tabs and the first card was
  intended to contain one whole tinted leaf.
- Proposed typography: Sorts Mill Goudy. Not bundled; read its license before use.
- Proposed lock screen: a skeleton-leaf garland on twine, with restrained motion
  respecting Reduce motion. Composer needs its own wide arrangement.

## Next implementation work

1. Prepare separate, transparent production assets from the approved artwork,
   preserving the shapes and vein hierarchy. Check image size, alpha, and delicate
   line quality at panel scale before choosing the final asset format.
2. Build the edition using Sleepy Hollow as the implementation reference:
   `seasons.js`, `themes/sleepy-hollow*`, and `scripts/gen-sleepy-hollow.py`.
   Integrate the palette and light-theme registrations in the relevant pages,
   `content.js`, `composer-core.js`, and `prompt.js` after inspecting current code.
3. Check panel tabs, the composer at laptop and desktop widths with its card over
   the scene, and the lock screen. Verify hint-text contrast, layering, and reduced
   motion. Follow the existing theme asset tests and repository i18n rules.

## Cleanup and backup

The maintainer explicitly requested committing the approved set while keeping old
versions in an **external backup**, outside the repo. The failed prototypes,
diagnostic images, old panel mocks, and ignored generated renders were removed
from this branch's working tree after checking their references and verifying
backup checksums. No production code depended on them. Git history was not rewritten.

Backup location on the maintainer's Mac:
`/Users/daniel/Sidecar Backups/phantom-bouquet-2026-10-06/`

- `working-art.tar.gz`: complete art directory before cleanup, including the full
  experimental handoff, uncommitted code, and ignored renders (61 verified files).
- `SHA256.json`: per-file checksums for that snapshot.
- `committed-art.tar.gz`: art from commit `f488cc7`, preserving previous tracked
  versions in addition to the working snapshot.
- `README.txt`: backup contents and recovery context.

The approved maple was committed as `f488cc7`. The companion/oak additions and
cleanup are authorized for a subsequent commit. No push or merge was requested.
