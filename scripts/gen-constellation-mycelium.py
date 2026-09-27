"""Draws the fields for Constellation and Mycelium. Run from the repo root:

    python3 scripts/gen-constellation-mycelium.py

Writes the four Constellation plates, themes/constellation-sky-{orion,leo,cygnus,andromeda}.svg,
and themes/mycelium-hyphae.svg.

CONSTELLATION — a plate from an engraved star atlas of the early nineteenth century:
gold on black, printed from copper. The reference is the Russian Uranographia plates
after Bode, and everything here follows their conventions rather than a modern chart's:

  - A stereographic projection (it keeps constellation shapes true, which is why the
    atlas makers used it), with the graticule engraved as fine lines, the plate circle
    the chart was drawn inside, and a hatched scale rule along the top edge. The plates
    number that rule with the hours of right ascension in Roman numerals; those were
    drawn here too and taken out, because the panel's top bar sits over the rule and
    the numerals landed behind the account chip and the icons.
  - The plates drew each constellation as an engraved allegory and used a DOTTED line
    for its outline. Without the engravings, the traditional figure lines are drawn in
    that dotted line instead, which is what makes Orion recognizable at a glance.
  - Stars as the engraver's symbols, graded by magnitude: the faintest a small
    asterisk, the middle range a five-pointed star, the brightest a white point of light
    with a radiant ring — the plates pick those out in white, and they are the only
    thing on the sheet that is not gold.

There are four plates, one for each season's evening sky, the way an atlas bound them:
the winter sky around Orion, the spring sky around Leo, the Summer Triangle over
Sagittarius, and the autumn sky around the Great Square of Pegasus and Andromeda. The
panel shows the season's plate (sky-plate.js reads the month once, as a page loads). East
is on the left on every one, because you are looking up.

Star positions, magnitudes and constellation figures come from d3-celestial
(Olaf Frohn, BSD-3-Clause; https://github.com/ofrohn/d3-celestial), which derives them
from the Hipparcos catalogue. scripts/data/sky-naked-eye.json is the naked-eye cut of
that data (magnitude < 5.6, the whole sky), kept here so the plate can be regenerated
or re-centered without the source catalogue.

The plate is NOT a repeating tile: constellations are shapes people know, and Orion
twice in one screen would give the repeat away. It is one tall sheet, about 1:2.6, and
the panel covers itself with it (background-size: cover), so the chart always reaches
the bottom however tall the panel is. It was 1:2 and fitted to the panel's width, which
left plain black under it in any panel more than twice as tall as it is wide, and side
panels usually are. The extra length is real sky: south of Orion, through Lepus and
Columba to Puppis and Canopus.

MYCELIUM — the network under a forest floor, after a pen-and-sepia drawing of one:
knots joined by thick, uneven strands that fuse into cells, with hairline hyphae fraying
off everything. See the notes at the head of that section. Tiles seamlessly by the same
nine-offset trick as scripts/gen-japanese-patterns.py.
"""
import json, math, random

# ---- Constellation ----------------------------------------------------------------------
SKY = json.load(open('scripts/data/sky-naked-eye.json'))
PW, PH = 600, 1560              # the sheet, in its own units: 1:2.6, taller than most panels
RA0, DEC0 = 86.0, 4.0           # chart center; set per plate by draw_plates() below
SCALE = 860.0                   # px per radian at the center: Orion about a third of the sheet wide
GOLD = '#C4A468'                # the engraving: an antique, slightly greened gold
WHITE = '#F4EEDC'               # the brightest stars, the one thing not in gold
ORIGIN = (PW / 2, 480)          # where each plate's center lands: the upper third, with the length below it

# (file name, center RA, center Dec, the months it is the evening sky of, what it shows).
# Centers were checked against the stars each plate is named for, so its signature
# pattern lands whole on the sheet: Scorpius sits too far west to share the summer plate
# with the Triangle, and Almach, Andromeda's third star, meets the autumn plate's edge.
PLATES = (
    ('orion', 86.0, 4.0, 'December to February', 'the winter sky around Orion'),
    ('leo', 165.0, 14.0, 'March to May', 'the spring sky around Leo'),
    ('cygnus', 290.0, 22.0, 'June to August', 'the Summer Triangle over Sagittarius'),
    ('andromeda', 5.0, 28.0, 'September to November', 'the autumn sky around Pegasus and Andromeda'),
)


def project(ra, dec):
    """Stereographic, centered on (RA0, DEC0). None if on the far side."""
    d = math.radians(((ra - RA0 + 180) % 360) - 180)
    p, p0 = math.radians(dec), math.radians(DEC0)
    cosc = math.sin(p0) * math.sin(p) + math.cos(p0) * math.cos(p) * math.cos(d)
    if cosc < -0.2:
        return None
    k = 2 * SCALE / (1 + cosc)
    x = -k * math.cos(p) * math.sin(d)          # east is left, looking up
    y = -k * (math.cos(p0) * math.sin(p) - math.sin(p0) * math.cos(p) * math.cos(d))
    return ORIGIN[0] + x, ORIGIN[1] + y


def inside(pt, pad=40):
    return pt and -pad <= pt[0] <= PW + pad and -pad <= pt[1] <= PH + pad


def polyline(points):
    """Path through projected points, broken wherever a point falls off the sheet."""
    out, run = [], []
    for pt in points:
        if inside(pt, 200):
            run.append(pt)
        else:
            if len(run) > 1:
                out.append(run)
            run = []
    if len(run) > 1:
        out.append(run)
    return ''.join('M' + 'L'.join(f'{x:.1f} {y:.1f}' for x, y in r) for r in out)


def densify(seg, step=1.0):
    """Boundaries are stored as corners; curve them properly under the projection."""
    out = []
    for (a, b), (c, d) in zip(seg, seg[1:]):
        dra = ((c - a + 180) % 360) - 180
        n = max(1, int(max(abs(dra), abs(d - b)) / step))
        out += [(a + dra * i / n, b + (d - b) * i / n) for i in range(n)]
    out.append(seg[-1])
    return out


def star5(x, y, r):
    """The engraver's five-pointed star."""
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.45
        pts.append(f'{x + math.cos(a) * rr:.1f} {y + math.sin(a) * rr:.1f}')
    return 'M' + 'L'.join(pts) + 'Z'


def asterisk(x, y, r):
    """The faintest stars: three crossed strokes."""
    d = ''
    for i in range(3):
        a = math.pi / 2 + i * math.pi / 3
        dx, dy = math.cos(a) * r, math.sin(a) * r
        d += f'M{x - dx:.1f} {y - dy:.1f}L{x + dx:.1f} {y + dy:.1f}'
    return d


def radiant(x, y, r):
    """The ring of short rays the plates draw round a first-magnitude star."""
    d = ''
    for i in range(12):
        a = i * math.pi / 6
        d += (f'M{x + math.cos(a) * r * 1.5:.1f} {y + math.sin(a) * r * 1.5:.1f}'
              f'L{x + math.cos(a) * r * 2.5:.1f} {y + math.sin(a) * r * 2.5:.1f}')
    return d


def constellation(plate):
    global RA0, DEC0
    name, RA0, DEC0, months, what = plate
    grid = []
    for dec in range(-80, 90, 10):               # parallels every ten degrees, as the plates
        grid.append(polyline([project(ra, dec) for ra in range(0, 361, 2)]))
    for ra in range(0, 360, 15):                 # an hour line per hour of right ascension
        grid.append(polyline([project(ra, dec) for dec in range(-80, 81, 2)]))

    # The figures, in the plates' dotted line. The plates carried the constellations as
    # engraved allegories and marked their extent with dotted boundaries; the modern IAU
    # boundaries were tried here first and read as stepped boxes, because they run along
    # 1875 parallels. The traditional figure lines are what make Orion recognizable
    # without the engraving, so they take the dotted line instead.
    borders = [polyline([project(ra, dec) for ra, dec in densify(seg, 0.5)])
               for segs in SKY['lines'].values() for seg in segs]

    faint, middle, bright, rays, lights = [], [], [], [], []
    for ra, dec, mag in SKY['stars']:
        pt = project(ra, dec)
        if not inside(pt, 8) or mag >= 5.2:
            continue
        x, y = pt
        # Sized for the sheet being drawn at about 0.6x in a 360px panel: every symbol
        # has to survive that and still read as a symbol rather than as dust.
        if mag < 1.6:
            lights.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="15" fill="url(#light)"/>'
                          f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.6"/>')
            rays.append(radiant(x, y, 4.6))
        elif mag < 4.2:
            (bright if mag < 2.8 else middle).append(star5(x, y, 11.5 - 1.9 * mag))
        else:
            faint.append(asterisk(x, y, 3.0))

    # The plate circle: the chart was always engraved inside one, and its arc leaving
    # the sheet at both sides is what says "plate" before anything else does.
    circle = f'<circle cx="{ORIGIN[0]:.0f}" cy="{ORIGIN[1] + 40:.0f}" r="360"/>'

    # The scale rule along the top edge: two fine rules with the hatched band between.
    hatch = ''.join(f'M{x} 10L{x + 4} 4' for x in range(-4, PW + 4, 3))
    return f'''<!-- Sidecar, Constellation background: a plate from an engraved star atlas,
     {what} in gold on black, the evening sky of {months}.
     Generated by scripts/gen-constellation-mycelium.py; edit the script, not this file.
     Star data: d3-celestial by Olaf Frohn (BSD-3-Clause), from the Hipparcos catalogue. -->
<svg xmlns="http://www.w3.org/2000/svg" width="{PW}" height="{PH}" viewBox="0 0 {PW} {PH}">
<defs>
<radialGradient id="light"><stop offset="0" stop-color="{WHITE}" stop-opacity="0.55"/><stop offset="1" stop-color="{WHITE}" stop-opacity="0"/></radialGradient>
</defs>
<g fill="none" stroke="{GOLD}" stroke-width="0.55" stroke-opacity="0.22">{''.join(f'<path d="{d}"/>' for d in grid if d)}{circle}</g>
<g fill="none" stroke="{GOLD}" stroke-width="1.5" stroke-opacity="0.45" stroke-dasharray="0.1 4.5" stroke-linecap="round">{''.join(f'<path d="{d}"/>' for d in borders if d)}</g>
<g stroke="{GOLD}" stroke-opacity="0.5">
<path d="M0 2.5H{PW}M0 11.5H{PW}M0 34.5H{PW}" stroke-width="0.7"/>
<path d="{hatch}" stroke-width="0.9" transform="translate(0 0.5)"/>
</g>
<path d="{''.join(faint)}" fill="none" stroke="{GOLD}" stroke-width="1" stroke-opacity="0.55" stroke-linecap="round"/>
<path d="{''.join(middle)}" fill="{GOLD}" fill-opacity="0.62"/>
<path d="{''.join(bright)}" fill="{GOLD}" fill-opacity="0.85"/>
<path d="{''.join(rays)}" fill="none" stroke="{GOLD}" stroke-width="1.1" stroke-opacity="0.75" stroke-linecap="round"/>
<g fill="{WHITE}">{''.join(lights)}</g>
</svg>
'''


# ---- Mycelium --------------------------------------------------------------------------
# After a pen-and-sepia drawing of a mycelial network: knots where threads meet, thick
# ink-drawn strands running between them and fusing into a web of irregular cells, and
# fine hairline hyphae fraying off every knot. Three things make it read as a network
# rather than as scribble, and each is a step below:
#   1. It is a GRAPH. Knots are scattered evenly, and each is joined to its nearest
#      neighbours, so the strands close into cells the way real hyphae fuse
#      (anastomosis) instead of wandering off into space.
#   2. Strands are FILLED SHAPES, not strokes: a wobbling centerline with a width that
#      swells and pinches along it, so every edge is uneven the way a pen's is.
#   3. A HIERARCHY of weight: trunks, then a finer braid beside some of them, then
#      hairlines. One weight everywhere is what made the first pass look like hair.
# The tile is a torus: neighbours are found across the wrap, and the whole drawing is
# painted at nine offsets so a strand leaving one edge arrives at the other.
MW = 520                        # tile size, px
SEPIA = '#6E4A2C'               # the ink: a warm sepia, the theme's humus family
rng = random.Random(1859)       # any seed works; this one gives an even web


def wrap_delta(a, b):
    d = b - a
    return d - MW * round(d / MW)


def knots(n=38, min_gap=52):
    pts = []
    while len(pts) < n:
        x, y = rng.uniform(0, MW), rng.uniform(0, MW)
        if all(math.hypot(wrap_delta(x, px), wrap_delta(y, py)) > min_gap for px, py in pts):
            pts.append((x, y))
    return pts


def wander(x0, y0, x1, y1, rough):
    """Midpoint displacement: a hand-drawn line between two points, wandering by an
    amount that halves at every level, then corner-cut so it flows."""
    pts = [(x0, y0), (x1, y1)]
    amp = math.hypot(x1 - x0, y1 - y0) * rough
    for _ in range(4):
        out = [pts[0]]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            mx, my = (ax + bx) / 2, (ay + by) / 2
            dx, dy = bx - ax, by - ay
            L = math.hypot(dx, dy) or 1
            off = rng.gauss(0, amp)
            out += [(mx - dy / L * off, my + dx / L * off), (bx, by)]
        pts = out
        amp *= 0.5
    for _ in range(1):
        sm = [pts[0]]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            sm += [(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25), (ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75)]
        sm.append(pts[-1])
        pts = sm
    return pts


def ribbon(pts, w0, w1, swell):
    """A filled strand along pts: width runs from w0 to w1 with a slow swell and a
    fine jitter, so the edges are as uneven as a pen line."""
    n = len(pts)
    phase = rng.uniform(0, math.tau)
    left, right = [], []
    for i, (x, y) in enumerate(pts):
        t = i / (n - 1)
        ax, ay = pts[max(i - 1, 0)]
        bx, by = pts[min(i + 1, n - 1)]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        w = (w0 + (w1 - w0) * t) * (1 + swell * math.sin(phase + t * math.tau * 1.5))
        w = max(0.25, w * rng.uniform(0.85, 1.15)) / 2
        left.append((x + nx * w, y + ny * w))
        right.append((x - nx * w, y - ny * w))
    ring = left + right[::-1]
    return 'M' + 'L'.join(f'{x:.0f} {y:.0f}' for x, y in ring) + 'Z'


def hair(x, y, heading, length, out, depth=0):
    """A hairline hypha fraying off a knot or a strand: thin, curving, forking."""
    pts = [(x, y)]
    turn, travelled = 0.0, 0.0
    while travelled < length:
        step = rng.uniform(5, 9)
        turn = turn * 0.75 + rng.gauss(0, 0.06)
        heading += turn
        x += math.cos(heading) * step
        y += math.sin(heading) * step
        travelled += step
        pts.append((x, y))
        if depth < 2 and rng.random() < 0.08:
            hair(x, y, heading + rng.choice((-1, 1)) * rng.uniform(0.3, 0.8),
                 (length - travelled) * 0.6, out, depth + 1)
    out.append('M' + 'L'.join(f'{px:.0f} {py:.0f}' for px, py in pts))


def mycelium():
    ks = knots()
    size = [rng.uniform(2.2, 4.6) for _ in ks]
    edges = set()
    for i, (x, y) in enumerate(ks):
        near = sorted(
            (math.hypot(wrap_delta(x, qx), wrap_delta(y, qy)), j)
            for j, (qx, qy) in enumerate(ks) if j != i
        )
        for d, j in near[:4]:
            if d < 150:
                edges.add((min(i, j), max(i, j)))

    trunks, braids, hairs = [], [], []
    for i, j in sorted(edges):
        (x0, y0), (qx, qy) = ks[i], ks[j]
        x1, y1 = x0 + wrap_delta(x0, qx), y0 + wrap_delta(y0, qy)   # the nearest copy of j
        w = rng.uniform(1.6, 3.8)
        line = wander(x0, y0, x1, y1, 0.12)
        trunks.append(ribbon(line, w, w * rng.uniform(0.6, 1.0), 0.35))
        # Most strands carry a finer braid alongside, the way parallel
        # hyphae bundle into cords.
        if rng.random() < 0.75:
            braids.append(ribbon(wander(x0, y0, x1, y1, 0.13), w * 0.35, w * 0.3, 0.5))
        # Hairlines fray off the strand at a few points along it.
        for _ in range(rng.randint(3, 6)):
            k = rng.randrange(len(line) // 5, len(line) * 4 // 5)
            (ax, ay), (bx, by) = line[k - 1], line[k + 1]
            h = math.atan2(by - ay, bx - ax) + rng.choice((-1, 1)) * rng.uniform(0.6, 1.3)
            hair(line[k][0], line[k][1], h, rng.uniform(20, 55), hairs)

    # Every knot throws out a spray of hairlines, the fine radiating threads round each
    # hub in the drawing.
    for (x, y) in ks:
        for _ in range(rng.randint(6, 10)):
            hair(x, y, rng.uniform(0, math.tau), rng.uniform(24, 70), hairs)

    dots = ''.join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}"/>' for (x, y), r in zip(ks, size))
    uses = ''.join(
        f'<use href="#web" x="{dx * MW}" y="{dy * MW}"/>'
        for dx in (-1, 0, 1) for dy in (-1, 0, 1)
    )
    # ONE INK, ONE ALPHA. Every strand, braid, hair and knot is drawn solid in the
    # sepia, and the whole web, all nine copies, takes its transparency once, from the
    # group round it. Each layer used to carry its own alpha, and wherever a braid ran
    # beside its trunk or a hair crossed a strand the two stacked into a darker patch;
    # a pen drawing has one ink, and a line that crosses another is not darker there.
    # The group's alpha is a measured ceiling: prose sits directly on this field, and
    # test/theme-svg-assets.test.js measures it against --faint over the darkest point
    # of the gradient under it.
    return f'''<!-- Sidecar, Mycelium background: a mycelial network in sepia, after a pen drawing.
     Generated by scripts/gen-constellation-mycelium.py; edit the script, not this file.
     Solid inks under one group opacity, so crossings never stack. The opacity is a
     measured ceiling: see test/theme-svg-assets.test.js. -->
<svg xmlns="http://www.w3.org/2000/svg" width="{MW}" height="{MW}" viewBox="0 0 {MW} {MW}">
<defs>
<g id="web">
<path d="{''.join(hairs)}" fill="none" stroke="{SEPIA}" stroke-width="0.7" stroke-linecap="round"/>
<path d="{''.join(braids)}" fill="{SEPIA}"/>
<path d="{''.join(trunks)}" fill="{SEPIA}"/>
<g fill="{SEPIA}">{dots}</g>
</g>
</defs>
<g opacity="0.11">{uses}</g>
</svg>
'''


if __name__ == '__main__':
    for plate in PLATES:
        with open(f'themes/constellation-sky-{plate[0]}.svg', 'w') as f:
            f.write(constellation(plate))
    with open('themes/mycelium-hyphae.svg', 'w') as f:
        f.write(mycelium())
    print('wrote the four Constellation plates and themes/mycelium-hyphae.svg')
