#!/usr/bin/env python3
"""Per-theme cuts of the Sidecar logo.

Each cut is icons/sidecar-logo.svg with only its colors changed: five of them, the garnish
and its shaded half, the glass and its shaded half, and the wordmark. The shapes are never
touched, so a cut is always the official logo in a theme's own inks.

    python3 scripts/gen-theme-logos.py

Run it after editing DYES. Three documents carry their own copy of the same table, because no
module system joins them (composer-core.js for the panel and composer pages, content.js for the
pay card, prompt.js for the approval window); test/theme-logos.test.js fails if any copy or any
file here disagrees with the others. Phantom Bouquet's cut was drawn by hand and is not made here.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# theme: (garnish, garnish shade, glass lit, glass shade, wordmark)
DYES = {
    # Strictly black and white, so the logo is silver on black and the glass loses its orange.
    'film-noir':  ('#F2F2F2', '#BDBDBD', '#C8C8C8', '#8E8E8E', '#E0E0E0'),
    # Bronze wordmark over a gold glass, the two metals of the theme.
    'brownstone': ('#F2E7DD', '#CDB9A7', '#D2AD70', '#A9843F', '#D69A6A'),
    # Warm iron: the wordmark and glass in the theme's own greys, shaded toward black.
    'cast-iron':  ('#D9D3C5', '#A39D8E', '#B9B19F', '#6E6858', '#948C79'),
    # Airmail: a blue wordmark and a stamp-red glass, its two inks.
    'par-avion':  ('#FFFFFF', '#E8E8EA', '#C0272D', '#A02C2E', '#1B4C8C'),
    # Ink brown wordmark over a brass glass.
    'industria':  ('#FFFFFF', '#E8E8EA', '#A67C1E', '#7A5A18', '#6B4E1C'),
    # Black, white and one metal: an ink wordmark over a leaf-gold glass, as the theme is drawn.
    'werkstatte': ('#FFFFFF', '#E8E8EA', '#A08018', '#7C6212', '#15171C'),
}

# What the stock logo paints each part with.
STOCK = ('white', '#D0D1D3', '#FFA01B', '#EA772F', '#BDA1FF')


def main():
    stock = open(os.path.join(ROOT, 'icons', 'sidecar-logo.svg'), encoding='utf-8').read()
    for theme, dyes in DYES.items():
        svg = stock
        for old, new in zip(STOCK, dyes):
            assert 'fill="%s"' % old in svg, 'stock logo no longer paints with ' + old
            svg = svg.replace('fill="%s"' % old, 'fill="%s"' % new)
        path = os.path.join(ROOT, 'icons', 'sidecar-logo-%s.svg' % theme)
        open(path, 'w', encoding='utf-8').write(svg)
        print('wrote', os.path.relpath(path, ROOT))


if __name__ == '__main__':
    main()
