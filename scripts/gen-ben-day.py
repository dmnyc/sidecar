"""Draws the two pictures Ben Day paints with. Run from the repo root:

    python3 scripts/gen-ben-day.py

Writes themes/ben-day-dots.svg, themes/ben-day-dots-yellow.svg, themes/ben-day-dots-wash.svg,
themes/ben-day-card.svg and themes/ben-day-zap.svg.

THE DOTS — two Ben-Day tints as a 1930s comic printer laid them: screens of round dots
on a hexagonal grid, 9px apart, the pitch of a coarse newsprint screen at panel size. The
tone is carried by the SIZE of the dot, not its color, which is how a halftone works. Red
comes down from the top and yellow up from the bottom, each gone 340px in, so the middle
of the panel is plain paper. Each tile is a column 36px wide (four dots, so the offset
rows meet across the seam), repeated sideways only.

The red is pale, and that is the contrast budget rather than a taste. Prose can land on
this field, so a dot's color is the darkest thing a hint can sit on. #F4B4AC keeps
--faint (#505050) at 4.6:1 on a red dot, and the yellow #FFD84D is lighter still;
test/theme-svg-assets.test.js measures both.

THE CARD — see card() below.

THE BURST — the ZAP! sound effect, as a letterer would have inked it: a jagged starburst
in caption yellow with a black keyline, and the word in red with a black outline and a
hard black drop. The letters are drawn as paths rather than set as text, so the picture
needs no font and there is nothing in it to translate; a comic's sound effects are
printed, not lettered in the reader's language. Shown by .lightning-layer (themes/ben-day.css).
"""

import math
import os

ROOT = os.path.join(os.path.dirname(__file__), '..')
THEMES = os.path.join(ROOT, 'themes')

DOT = '#F4B4AC'
DOT_YELLOW = '#FFD84D'
INK = '#111111'
RED = '#C8102E'
YELLOW = '#FFD400'


def dots(fill, from_bottom=False, height=360, fade=340.0):
    """One screen of dots, full at one edge and gone `fade` px in. The panel's top screen
    is red and its bottom one yellow; they run toward each other and stop short, so the
    middle of the panel is plain paper and the logo on the lock screen stands clear of
    both. The short yellow wash heads the full-height sheets and the pay card."""
    pitch = 9.0
    row = pitch * math.sqrt(3) / 2  # hexagonal rows
    width = pitch * 4
    rmax = 3.6
    out = []
    y = row / 2
    i = 0
    while y < height:
        t = min(1.0, y / fade)
        r = rmax * (1 - t) ** 1.25
        if r >= 0.35:
            x0 = pitch / 2 if i % 2 else 0.0
            x = x0
            cy = height - y if from_bottom else y
            while x <= width + 0.01:
                out.append('<circle cx="%.2f" cy="%.2f" r="%.2f"/>' % (x, cy, r))
                x += pitch
        y += row
        i += 1
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
        '<g fill="%s">%s</g></svg>\n' % (width, height, width, height, fill, ''.join(out))
    )


# Block capitals on a 50-unit cap height. Each letter is (width, path); holes are
# subpaths filled with evenodd.
LETTERS = [
    (34, 'M0 0H34V9L13 41H34V50H0V41L21 9H0Z'),
    (38, 'M0 50L12 0H26L38 50H27L24.6 39H13.4L11 50ZM15.4 30H22.6L19 13Z'),
    (36, 'M0 0H22C31 0 36 6 36 15C36 24 31 30 22 30H11V50H0ZM11 9V21H21C24 21 25.5 19 25.5 15C25.5 11 24 9 21 9Z'),
    (15, 'M2 0H13L11 34H4ZM2.5 39H12.5V50H2.5Z'),
]
GAP = 4



def burst(letters=None, star_fill=None, word_fill=None, fit=0.92, W=220, H=160):
    letters = letters or LETTERS
    star_fill = star_fill or YELLOW
    word_fill = word_fill or RED
    cx, cy = W / 2, H / 2
    # A starburst with uneven points, fixed rather than random so the file is stable.
    spikes = [1.00, 0.86, 0.97, 0.82, 1.04, 0.90, 0.95, 0.80,
              1.02, 0.88, 0.98, 0.84, 1.03, 0.87, 0.93, 0.83]
    n = len(spikes)
    pts = []
    for k in range(n * 2):
        a = -math.pi / 2 + k * math.pi / n
        if k % 2 == 0:
            s = spikes[k // 2]
            rx, ry = 104 * s, 74 * s
        else:
            rx, ry = 70, 49
        pts.append('%.1f,%.1f' % (cx + rx * math.cos(a), cy + ry * math.sin(a)))
    star = ' '.join(pts)

    total = sum(w for w, _ in letters) + GAP * (len(letters) - 1)
    x = -total / 2
    word = []
    for w, d in letters:
        word.append('<path transform="translate(%.1f -25)" d="%s"/>' % (x, d))
        x += w + GAP
    word = ''.join(word)
    # Skewed and tipped the way the effect is always drawn: leaning into the action.
    place = 'translate(%.1f %.1f) rotate(-7) skewX(-10) scale(%.2f)' % (cx, cy + 2, fit)

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
        '<polygon points="%s" fill="%s" stroke="%s" stroke-width="4" stroke-linejoin="miter"/>'
        '<g transform="%s" fill-rule="evenodd">'
        '<g transform="translate(4 4)" fill="%s" stroke="%s" stroke-width="5" stroke-linejoin="round">%s</g>'
        '<g fill="%s" stroke="%s" stroke-width="5" stroke-linejoin="round" paint-order="stroke">%s</g>'
        '</g></svg>\n'
        % (W, H, W, H, star, star_fill, INK, place, INK, INK, word, word_fill, INK, word)
    )


def card():
    """The wallet card: a splash panel, the page a comic saves for its big moment. A
    yellow-orange field with sharp orange speed lines running in from the edges, white
    streaks between them, and a halftone screen that is heaviest in the center and
    comes back at the rim. Drawn at 400x240 and laid on the card with background-size: cover, so it
    scales uniformly and the dots stay round.

    THE TEXT RIDES ON IT, so every color here is a light one: the label, the unit and the
    figure's outline are black, and the darkest orange is 6.19:1 against black. Red
    bolts were tried round the rim and taken out: they were the one mark dark enough to
    fight the type, and the rays already say "burst"."""
    W, H = 400, 240
    cx, cy = W / 2, H / 2
    out = []
    out.append('<defs><radialGradient id="g" cx="50%" cy="50%" r="62%">'
               '<stop offset="0" stop-color="#FFC928"/><stop offset="1" stop-color="#FFA114"/>'
               '</radialGradient></defs>')
    out.append('<rect width="%d" height="%d" fill="url(#g)"/>' % (W, H))

    def wedge(a, w, r0, r1):
        pts = []
        for aa, rr in ((a - w, r1), (a, r0), (a + w, r1)):
            pts.append('%.1f,%.1f' % (cx + rr * math.cos(aa), cy + rr * 0.62 * math.sin(aa)))
        return '<polygon points="%s"/>' % ' '.join(pts)

    # Speed lines, two tones of orange and a light one, uneven on purpose.
    n = 40
    dark, light = [], []
    for k in range(n):
        a = k * 2 * math.pi / n + 0.035 * math.sin(k * 2.7)
        r0 = 70 + 40 * (0.5 + 0.5 * math.sin(k * 1.9))
        (dark if k % 2 else light).append(wedge(a, 0.05 if k % 2 else 0.035, r0, 280))
    out.append('<g fill="#F26B0F" opacity="0.8">%s</g>' % ''.join(dark))
    out.append('<g fill="#FFE27A" opacity="0.7">%s</g>' % ''.join(light))
    streaks = [wedge(a + 0.07, 0.012, 125, 280) for a in (0.4, 1.3, 2.3, 2.9, 3.6, 4.4, 5.0, 5.9)]
    out.append('<g fill="#FFFFFF" opacity="0.9">%s</g>' % ''.join(streaks))

    # Halftone: heavy in the middle, gone in a ring, back again at the rim.
    pitch = 8.0
    row = pitch * math.sqrt(3) / 2
    dots = []
    i = 0
    y = 0.0
    while y <= H + row:
        x = pitch / 2 if i % 2 else 0.0
        while x <= W + pitch:
            d = math.hypot((x - cx) / (W / 2), (y - cy) / (H / 2))
            r = 0.0
            if d < 0.78:
                r = 3.5 * (1 - d / 0.78) ** 0.6
            elif d > 0.95:
                r = 2.4 * min(1.0, (d - 0.95) / 0.35)
            if r >= 0.4:
                dots.append('<circle cx="%.1f" cy="%.1f" r="%.2f"/>' % (x, y, r))
            x += pitch
        y += row
        i += 1
    out.append('<g fill="#FF9A00">%s</g>' % ''.join(dots))

    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" '
            'preserveAspectRatio="xMidYMid slice">%s</svg>\n' % (W, H, W, H, ''.join(out)))

def main():
    with open(os.path.join(THEMES, 'ben-day-dots.svg'), 'w') as f:
        f.write(dots(DOT))
    with open(os.path.join(THEMES, 'ben-day-dots-yellow.svg'), 'w') as f:
        f.write(dots(DOT_YELLOW, from_bottom=True))
    with open(os.path.join(THEMES, 'ben-day-dots-wash.svg'), 'w') as f:
        f.write(dots(DOT_YELLOW, height=180, fade=170.0))
    with open(os.path.join(THEMES, 'ben-day-zap.svg'), 'w') as f:
        f.write(burst())
    with open(os.path.join(THEMES, 'ben-day-card.svg'), 'w') as f:
        f.write(card())


if __name__ == '__main__':
    main()
