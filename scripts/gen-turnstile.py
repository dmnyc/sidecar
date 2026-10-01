"""Draws Turnstile's tilework. Run from the repo root:

    python3 scripts/gen-turnstile.py

Writes, in themes/:

  turnstile-wall.svg     the station wall: white glazed tile in running bond, each tile a
                         shade off its neighbor and glazed across its top edge, in a grout
                         joint. A tile the theme repeats behind everything.
  turnstile-frieze.svg   the band along the top of a wall: gold tesserae with green and
                         mauve diamonds over a maroon tile course. A tile repeated across.
  turnstile-<colorway>-field.svg, turnstile-<colorway>-ink.svg
                         a tablet's field of tesserae, and the cream tesserae its lettering
                         is filled with, for each station colorway (slate, rust, cobalt,
                         green, brown). The lettering is real text with the ink tile
                         clipped to it, so it stays text: find, copy, screen readers,
                         translation.
  turnstile-arrow.svg    the signs' arrow, with its notched tail.
  turnstile-green.svg, turnstile-olive.svg, turnstile-gold.svg
                         the frames round the tablets, glazed rectangular tile in sea green,
                         gray-green and gold, cut for border-image in 8px slices.

Every tile is seeded, so a run draws the same wall every time.
"""

import os
import random

ROOT = os.path.join(os.path.dirname(__file__), '..')
THEMES = os.path.join(ROOT, 'themes')


def svg(w, h, body):
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">%s</svg>\n'
            % (w, h, w, h, ''.join(body)))


def wall():
    # Two courses of 3x6 tile, the second shifted half a tile, so the tile repeats.
    rnd = random.Random(1904)
    TW, TH, J = 30, 15, 1.5
    W, H = TW * 4, TH * 2
    o = ['<rect width="%d" height="%d" fill="#DCD5C5"/>' % (W, H),
         '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
         '<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.55"/>'
         '<stop offset="0.35" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient></defs>']
    for row in range(2):
        off = 0 if row == 0 else -TW / 2
        for i in range(-1, 5):
            x = off + i * TW
            shade = rnd.choice(['#F5F2EA', '#F2EEE4', '#F7F4EC', '#EFEBE1', '#F4F0E7'])
            o.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="1" fill="%s"/>'
                     % (x + J / 2, row * TH + J / 2, TW - J, TH - J, shade))
            o.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="1" fill="url(#g)"/>'
                     % (x + J / 2, row * TH + J / 2, TW - J, TH - J))
    return svg(W, H, o)


def frieze():
    # A course of maroon tile under a band of gold tesserae, with a diamond of green
    # tesserae and a diamond of mauve in each repeat. The repeat is a whole number of
    # tesserae (22 of 3px) and each diamond is centered on a tessera in the middle of the
    # band's five rows, so every diamond is the same on all four sides and the band
    # repeats with no seam.
    rnd = random.Random(23)
    T, COLS, ROWS = 3, 22, 5
    W, BAND, H = T * COLS, T * ROWS, 22
    o = ['<rect width="%d" height="%d" fill="#B9A86F"/>' % (W, H)]
    golds = ['#D8C690', '#D2BF85', '#DDCC98', '#CDB97C']
    for row in range(ROWS):
        for col in range(COLS):
            col_ = rnd.choice(golds)
            # Diamonds by distance in tesserae from their centers: column 5 (green) and
            # column 16 (mauve), half a repeat apart, both on the middle row.
            for center, c in ((5, '#3E7A5E'), (16, '#8C5A78')):
                if abs(col - center) + abs(row - 2) <= 2:
                    col_ = c
            o.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s"/>'
                     % (col * T + 0.35, row * T + 0.35, T - 0.7, T - 0.7, col_))
    o.append('<rect x="0" y="%d" width="%d" height="%d" fill="#5C1A28"/>' % (BAND, W, H - BAND))
    for x in range(0, W, 22):
        o.append('<rect x="%d" y="%.1f" width="21" height="%.1f" rx="0.6" fill="#7A1F33"/>' % (x + 0.5, BAND + 0.6, H - BAND - 1.2))
        o.append('<rect x="%d" y="%.1f" width="21" height="1.8" rx="0.6" fill="#FFFFFF" fill-opacity="0.18"/>' % (x + 0.5, BAND + 0.6))
    return svg(W, H, o)


# THE TABLETS, as a tile-setter makes one: a field of tesserae on a straight grid, and
# letters from the real font filled with tesserae of their own, cut where a letter's edge
# crosses one. The letters and the field share a cell size, so where a whole title is one
# element their grids line up. One field tile and one ink tile per station colorway; the
# ink's joint is a dark tone of the field, so a joint inside a letter reads as the field
# showing through. Every field shade against every cream clears AA (test/theme-svg-assets).
CELL = 3.5   # px; drawn at 8 by 8, so the repeat is not visible
CREAMS = ['#F1EBDA', '#EDE6D2', '#F5F0E3', '#E9E1CC']
COLORWAYS = {
    # name: (field shades, field joint, ink joint)
    'slate': (['#141E26', '#17232C', '#121B22', '#1A2830', '#101A21', '#1C2B33'], '#0A1015', '#3E4448'),
    'rust': (['#7E2A22', '#86301F', '#74251E', '#8A3426', '#782A24'], '#2A1714', '#6E5A52'),
    'cobalt': (['#22307F', '#283890', '#1E2B72', '#2C3C96', '#1B2768', '#2F5E73'], '#0E1438', '#4A5070'),
    'green': (['#1C3F33', '#21483A', '#183A2E', '#24503F', '#1A3B30'], '#0B1A14', '#4A5A52'),
    'brown': (['#5E3322', '#663826', '#56301F', '#6C3D29', '#5A3121'], '#22120C', '#6A584E'),
}


def tesserae(cols, joint, seed, n=8, cell=CELL):
    rnd = random.Random(seed)
    w = cell * n
    o = ['<rect width="%.1f" height="%.1f" fill="%s"/>' % (w, w, joint)]
    for y in range(n):
        for x in range(n):
            o.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.3" fill="%s"/>'
                     % (x * cell + 0.4, y * cell + 0.4, cell - 0.8, cell - 0.8, rnd.choice(cols)))
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%.1f" height="%.1f" viewBox="0 0 %.1f %.1f">%s</svg>\n'
            % (w, w, w, w, ''.join(o)))


def running_bond(colors, joint, seed):
    # A frame of glazed rectangular tiles for border-image, 48x48 in 8px slices: a square
    # tile at each corner, and along each edge tiles two and a bit cells long, laid the long
    # way, so the frame reads as the band of brick-shaped tile round a station's tablet.
    rnd = random.Random(seed)
    W = 48
    o = ['<rect width="%d" height="%d" fill="%s"/>' % (W, W, joint)]
    def tile(x, y, w, h):
        col = rnd.choice(colors)
        o.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="0.6" fill="%s"/>' % (x + 0.6, y + 0.6, w - 1.2, h - 1.2, col))
        o.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="0.6" fill="#FFFFFF" fill-opacity="0.16"/>' % (x + 0.6, y + 0.6, w - 1.2, min(2.0, h - 1.2)))
    for cx in (0, 40):
        for cy in (0, 40):
            tile(cx, cy, 8, 8)
    for x in (8, 24):
        tile(x, 0, 16, 8)
        tile(x, 40, 16, 8)
    for y in (8, 24):
        tile(0, y, 8, 16)
        tile(40, y, 8, 16)
    return svg(W, W, o)


def arrow():
    # The arrow on the station signs: a notched block for the tail, a long shaft and a
    # pointed head, in the mosaic cream. Points right; a right-to-left page turns it round.
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="12" viewBox="0 0 48 12">'
            '<path d="M0 2.5 H10 L12 6 L10 9.5 H0 L3 6 Z" fill="#F1EBDA"/>'
            '<rect x="11" y="5" width="27" height="2" fill="#F1EBDA"/>'
            '<path d="M36 1 L48 6 L36 11 L38.5 6 Z" fill="#F1EBDA"/></svg>\n')


def main():
    out = {
        'turnstile-wall.svg': wall(),
        'turnstile-frieze.svg': frieze(),
        'turnstile-green.svg': running_bond(['#6FA59A', '#7FB3A7', '#5E9589', '#689E92'], '#0A1015', 3),
        'turnstile-olive.svg': running_bond(['#6E7563', '#7C8270', '#5F6656', '#747A66'], '#2A1714', 7),
        'turnstile-arrow.svg': arrow(),
        'turnstile-gold.svg': running_bond(['#D8C690', '#D2BF85', '#DDCC98', '#CDB97C'], '#3A2F1C', 11),
    }
    for i, (name, (field, joint, ink_joint)) in enumerate(COLORWAYS.items()):
        out['turnstile-%s-field.svg' % name] = tesserae(field, joint, 100 + i)
        out['turnstile-%s-ink.svg' % name] = tesserae(CREAMS, ink_joint, 200 + i)
    for name, body in out.items():
        with open(os.path.join(THEMES, name), 'w') as f:
            f.write(body)


if __name__ == '__main__':
    main()
