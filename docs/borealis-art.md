# Aurora Borealis artwork

Aurora Borealis's two still scenes are original procedural artwork. The generator does not
load, sample, trace or embed reference photographs. The provided aurora photographs
informed the composition: diffuse green/violet curtains, snowy coastal mountains
and reflected light on water.

## Reproduce

The extension reads the committed AVIFs directly; no renderer runs at runtime or package time. Runtime CSS animates a masked light
field on the lock screen; shared digit spans expose a decorative reflection attribute. Development tools are pinned in
`scripts/borealis-requirements.txt` (Python 3.13 was used):

```sh
python3 -m venv /tmp/sidecar-borealis-tools
/tmp/sidecar-borealis-tools/bin/pip install -r scripts/borealis-requirements.txt
/tmp/sidecar-borealis-tools/bin/python scripts/gen-borealis.py
node --test test/borealis-plates.test.js
```

The Node tests invoke `python3`; activate that environment first if the dependencies
are not also installed in the default interpreter. The renderer also supports
`--output-dir /tmp/borealis-study --preview` for lossless PNG studies outside the
shipped theme directory. Do not package these PNG masters.

| Asset | Dimensions | Bytes |
| --- | --- | ---: |
| `themes/borealis-night.avif` | 720 × 1520 | 41,961 |
| `themes/borealis-night-wide.avif` | 1920 × 1200 | 112,771 |
| `themes/borealis-shimmer.png` | 180 × 380 | 15,524 |
| `themes/borealis-shimmer-wide.png` | 480 × 300 | 31,365 |
| `themes/borealis-water.png` | 180 × 380 | 4,649 |
| `themes/borealis-water-wide.png` | 480 × 300 | 8,293 |

The two scenes use AVIF quality 72, speed 6, 4:4:4 chroma and one encoder thread. The scenes total
154,732 bytes before ZIP overhead; lossless grayscale PNG emission and water masks add 59,831
bytes, bringing all six assets to 214,563 bytes. The prior ten SVGs occupied about 31 KB zipped;
the two detailed scenes cost about 124 KB more in a seasonal package, with roughly
another 60 KB for the sky and water masks. The
existing seasonal packaging rule excludes Aurora Borealis art from out-of-window releases.

## Rendering and integration

- Seeded, continuous noise modulates overlapping aurora curtains. Emission fades
  vertically and below the folds; there are no stroked ribbon outlines.
- A perspective terrain height field supplies real occlusion, surface normals and
  slope-dependent snow. A shoreline and rippled reflection tie the land to the sky.
- Each output is fully opaque. The reading-view wash darkens the complete image;
  reducing mountain opacity must never expose stars through rock.
- `themes/patterns.css` chooses the portrait/wide composition, uses the wide scene
  in gallery tiles, cropping to sky and mountaintops in the visible 175px preview
  band rather than the full iframe height, and sets distinct reading, composer and lock-screen washes.
  The composer can show a brighter scene because its prose sits on an opaque sheet.
- The lock screen sweeps a translucent light field over seven seconds in each
  direction through stationary emission
  masks generated from the same aurora. The masks contain no stars and fade to zero
  above each column’s skyline. Mountains and stars never translate or scale. A second mask reflects curtain
  emission using the still image’s water projection, excluding land and reflected
  mountains. Its light sweep follows the sky’s timing, with traveling horizontal
  ripple highlights. Neither mask moves, so the shoreline remains fixed.
  Both OS reduced motion and the app’s Reduce motion setting hide both light layers.
- Wallet and pinned mini-wallet digits blend mint into violet; straight inverted CSS copies fade
  through an SVG refraction filter. Anisotropic fractal noise displaces the light
  sideways. A separate horizontally stretched noise field creates transparent
  troughs between irregular highlights, without periodic stripe masks. The filter definitions live in the panel and theme-tile documents. Empty alternative text keeps those decorative
  copies out of spoken content. Reflections are positioned outside the text flow;
  the wallet centers the numeral ink, not the combined number and reflection. The reflection disappears for hidden balances,
  compact cards and the Bitcoin-only joke. The pinned bar uses a shallower
  reflection to fit its existing height, with the numeral ink optically centered. It does not appear on countdowns.
  On a balance change, the reflected digits gently stretch and shimmer through
  the irregular surface for 3.2 seconds, with diminishing movement that settles
  into the still reflection;
  the readable digits stay fixed. Reduced motion stops the reflection. Gallery
  reflections remain still until selected. No ambient snow is added.

The asset test regenerates both scenes and compares decoded pixels within AVIF
encoding tolerance. A second test replaces the sky with black and white fields and
requires terrain pixels to remain identical. These checks establish reproducibility
and occlusion, not subjective visual quality. A mask test also verifies regenerated
values and zero sky-layer light across terrain and below the waterline. The water-mask
test verifies zero reflected light on terrain and above the waterline.

Before shipping, review the scene in the real extension at panel width, in the
composer at laptop and desktop widths, on the lock screen, and in the gallery. The
local previews use sample data for artwork/layout review and are not a substitute for
checking extension behavior, account state or the special-edition controls.
