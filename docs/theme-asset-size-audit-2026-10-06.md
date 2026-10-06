# Theme assets and font size audit — October 6, 2026

## Decision

Prioritize smaller theme assets and fonts that preserve visual quality and character
coverage. Do not pursue application-code minification: keeping application code
readable and avoiding additional store-review/source-build requirements is part of
the decision, even if minification could reduce the package further.

The remaining straightforward font conversions offer a modest saving, not a major
reduction in the extension's download size. Larger savings need a new measurement
of current release contents and targeted experiments on the largest remaining assets.

This document records an investigation and local experiments. It does **not** ship
font conversions, modify artwork, change packaging, or claim the experiments have
been released. The font implementation was left uncommitted in the development
checkout; it is outside this documentation change.

## Measured baseline

The baseline is the local `sidecar-1.15.8-chrome.zip`, inspected on October 6, 2026.
The filename identifies the artifact; it is not evidence of a published release or
proof that its contents correspond to the current checkout.

- Archive size: **3,799,394 bytes** (3.80 MB).
- Expanded file contents: **8,381,277 bytes** (8.38 MB), across 218 entries.
- SHA-256: `66f9b1723640a4662f19fcc6cee8bb08935e9330c23e7236ef12bf289a644197`.
- Units below use decimal KB/MB. Compressed sizes are sums of ZIP entry sizes,
  excluding archive headers and directory overhead.

| Group | Expanded bytes | Compressed entry bytes |
| --- | ---: | ---: |
| Root files | 3,669,554 | 1,119,087 |
| Themes | 2,048,280 | 739,564 |
| Fonts | 2,031,238 | 1,329,062 |
| Help screenshots | 486,068 | 485,213 |
| Icons | 140,058 | 98,600 |
| `_locales` | 6,079 | 1,618 |
| **Total** | **8,381,277** | **3,773,144** |

The approximately **4.08 MB** figure refers to **themes plus fonts, expanded**.
Theme files alone account for 2.05 MB expanded and about 740 KB inside the ZIP.
Fonts are the larger download contributor: about 1.33 MB compressed. Theme and font
entries together occupy about 2.07 MB compressed, not 4 MB.

To inspect a future artifact using the same method:

```python
from collections import defaultdict
from pathlib import Path
from hashlib import sha256
from zipfile import ZipFile

archive = Path('dist/sidecar-<version>-chrome.zip')
groups = defaultdict(lambda: [0, 0])
with ZipFile(archive) as package:
    for entry in package.infolist():
        if entry.is_dir():
            continue
        group = entry.filename.split('/')[0] if '/' in entry.filename else 'root files'
        groups[group][0] += entry.file_size
        groups[group][1] += entry.compress_size
print('archive bytes:', archive.stat().st_size)
print('sha256:', sha256(archive.read_bytes()).hexdigest())
for group, sizes in sorted(groups.items()):
    print(group, 'expanded:', sizes[0], 'compressed:', sizes[1])
```

## Font findings

Earlier work already converted many display fonts to WOFF2. The remaining TTFs
have different constraints; there is no blanket rule that font compression is
forbidden by licensing.

| Font or group | Finding and recommended treatment |
| --- | --- |
| Sorts Mill Goudy | SIL OFL 1.1; no Reserved Font Name declared in the accompanying license record. A complete WOFF2 conversion is a candidate, with metadata and functional-equivalence verification. |
| Special Elite | Apache 2.0. Conversion is permitted subject to its license conditions, including notices for changed files and retention of applicable license/attribution notices. Update descriptions that currently call the distributed font unmodified. |
| Impressed Metal | The repository's provenance relies on a “100% Free” listing, with no license file in the original distribution and a restricted-embedding flag. That is insufficient evidence of modification permission. Leave unchanged pending clearer permission. |
| EB Garamond regular/italic, Pinyon Script, Playfair 500 TTFs | The custom PDF writer parses TTF tables directly. WOFF2 is not a drop-in replacement. A decoder would add code, complexity and its own size. Pre-subsetting could remove characters needed by user-provided text. Keep these inputs intact. |

The [OFL's official webfont guidance](https://openfontlicense.org/webfonts-and-reserved-font-names/)
explicitly covers WOFF and WOFF2. Its conditions for retaining reserved names
include preserving original font data apart from compression and preserving the
required metadata. Subsetting and outline changes need separate consideration;
compression alone must not be used as a reason to strip glyphs or license metadata.

[Apache 2.0 section 4](https://www.apache.org/licenses/LICENSE-2.0.html) covers
redistribution, change notices and retention of applicable notices. Freeware and
open-source licensing are not interchangeable; each font needs its own review.

### Local conversion experiment

Using Python 3.13, fontTools 4.63.0 and Brotli 1.2.0, the two candidate fonts were
converted with their complete character sets, original names and license metadata.

| Font | Original TTF bytes | Experimental WOFF2 bytes |
| --- | ---: | ---: |
| Special Elite | 166,180 | 65,679 |
| Sorts Mill Goudy | 121,372 | 37,968 |

Special Elite's output includes a conversion notice in WOFF2 wrapper metadata.
WOFF2 repacks the glyph/location tables, recomputes the font header checksum, and
sets the lossless-transform flag. Sorts Mill Goudy's empty digital-signature table
(zero signatures) is removed. These storage changes were disclosed, rather than
calling the converted files byte-identical originals.

Verification in the local experiment:

- All decoded glyph contours, composites and hints matched. Other font tables
  matched byte-for-byte except the documented storage changes.
- Source and output SHA-256 checks verified deterministic reproduction with the
  pinned tools. A deliberately changed advance width was rejected by verification.
- Both production CSS font URLs loaded in the browser. Across 368 Special Elite
  characters and 392 Sorts Mill Goudy characters, at five sizes (12, 16, 24, 42,
  64 px) and two weights (400, 700), **7,600 individual-character canvas comparisons
  produced zero pixel differences**. This was one browser environment, not a
  cross-browser or full application-layout certification.
- All 24 targeted font-reference, theme-asset and pay-card tests passed.

The measured ZIP reduction was approximately **35.5 KB**, including the proposed
license/disclosure additions and ZIP entry overhead. It was calculated by comparing
ZIPs of the affected files at DEFLATE level 6, not by building a new release.
That is roughly **0.9% of the 3.80 MB baseline archive**. The approximately 184 KB
reduction in raw font bytes should not be mistaken for the download saving.

Any eventual implementation should include the original sources outside the shipped
package, original/output hashes, pinned tools, reproducible conversion and verification
instructions, retained licenses and updated provenance/NOTICE records. Reviewer notes
should describe the asset conversion accurately. Disclosure belongs in the public
repository and applicable shipped notices, not only in a PR discussion.

## Theme SVG audit

Constellation and Wabi-Sabi were inspected because they are among the larger
non-seasonal theme assets. Their generators already emit most geometry with one
decimal place. Reducing that precision further would change geometry.

An in-memory experiment removing redundant `.0` suffixes, without changing numeric
values, measured these reductions at DEFLATE level 6:

| Family | Files inspected | Compressed saving |
| --- | ---: | ---: |
| Constellation | Eight portrait/wide sky plates | 2,019 bytes |
| Wabi-Sabi | Two portrait/wide seam plates | 1,057 bytes |
| **Total** | **10** | **3,076 bytes** |

No SVG changes were retained. This narrow cleanup is a small opportunity; it does
not establish that all possible SVG optimizations have been exhausted. More
substantial changes would need measurement and visual checks at panel, composer
(laptop and desktop) and lock-screen sizes, including fine lines and transparency.

## Next measurements and boundaries

The development branch had already added Phantom Bouquet AVIF plates and pruning of
out-of-season special-edition art. Those changes must not be counted as new savings
from this audit or inferred from the older ZIP's totals. Measure a fresh intended
release artifact first, using its actual release-date seasonal window.

Development context: [AVIF plates](https://github.com/dmnyc/sidecar/commit/5827bfecc8ba26ab1a920037cfb9797dd5f603f0)
and [seasonal art packaging](https://github.com/dmnyc/sidecar/commit/f7e88c980203993efb73b8cb1ef15bb009315392).
The investigation used checkout `7c28045ecf07dfd9248274d272db274b3a9b69e6` plus
the local font experiment described above; these links establish development
context, not inclusion in the measured baseline ZIP.

Then rank the remaining theme assets by their **compressed package contribution**.
Investigate image dimensions/encoding and exclusive seasonal font usage where there
is evidence of meaningful savings. Check all consumers before omitting an asset;
seasonal art pruning does not automatically prove that a theme's font can be pruned.

Help screenshots already use WebP and are loaded by Help, so deleting that directory
would break shipped content. Any re-encoding needs a readability comparison. Keep
licensing records and required notices regardless of their small size.

Do not pursue code minification, indiscriminate glyph subsetting, or visible loss of
fine artwork detail to meet an arbitrary size target. Record both the raw and ZIP
savings of each future experiment, its tool/settings, and what was verified before
accepting a change.
