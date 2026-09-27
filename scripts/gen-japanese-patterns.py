"""Draws the fields for the two Japanese themes. Run from the repo root:

    python3 scripts/gen-japanese-patterns.py

Writes themes/wabi-sabi-seams.svg and themes/ukiyo-e-seigaiha.svg.

WABI-SABI — kintsugi. A glaze that has been broken and mended with lacquer and gold,
so the seams are the one bright thing on a dark, speckled stoneware ground. Cracks are
not drawn, they are GROWN: each is a random walk that drifts off its heading a little at
every step and now and then forks, which is how a fracture actually propagates through
a fired body. Each seam is then drawn as a filled outline whose width is its own: it
runs thick for a stretch and pinches, swells where the lacquer gathered at a fork or a
meeting, and tapers where the crack ran out. Every irregularity comes from a seeded
RNG, so the bowl breaks the same way every time the script runs.

The tile is seamless without any seam handling in the drawing: the whole crack network
is painted nine times, at every offset of one tile width and height, and the viewBox
clips it. A crack that leaves the right edge re-enters on the left because it was drawn
there too.

UKIYO-E — seigaiha, the "blue sea waves" of overlapping concentric arcs, which is the
sea in half the woodblock prints ever cut. Built the way it is printed: whole rows of
discs, each carrying its rings, laid top to bottom so every row covers the lower half of
the row above. The covering is done with masks rather than with discs painted the paper
color, so the tile is TRANSPARENT: the theme grades its sky from blue to yellow in CSS,
under the waves, and a painted disc would have to be one color.
"""
import math, random

# ---- Wabi-sabi -----------------------------------------------------------------------
KW, KH = 520, 1040              # portrait, taller than a panel, so the break never visibly repeats
# The seams are SOLID, never translucent: overlapping translucent shapes stack wherever
# they meet, and that stacking read as patches. Their brightness is capped by the text
# laid over them (hints sit directly on this field): test/theme-svg-assets.test.js holds
# --muted to AA and --faint to 3:1 against the brightest seam pixel, a ceiling near
# luminance 0.038, and these sit just under it at 0.034. Within it the only thing left to
# spend is chroma, so the golds are as saturated as the ceiling allows. A gray bronze at
# the same luminance reads as a stain, not metal.
GOLDS = ('#43300B', '#40320A', '#3D330A')   # hue 40 to 48: any redder is brown, any yellower olive
RUST = '#9A6A45'                # iron spots in the clay
ASH = '#E8E2D4'                 # pale flecks in the glaze
CELL = 20                       # hit-test bucket; divides both tile sides, so buckets wrap
rng = random.Random()           # reseeded for each try by fracture(); see SEED_TRIES


def value_noise():
    """Smooth 1D noise in [-1, 1]: lattice values, cosine-blended between."""
    table = [rng.uniform(-1, 1) for _ in range(256)]
    def f(t):
        i = math.floor(t)
        a, b = table[i % 256], table[(i + 1) % 256]
        u = (1 - math.cos((t - i) * math.pi)) / 2
        return a + (b - a) * u
    return f


def intersect(a, b, p, q):
    """Where segment a-b crosses p-q, as (fraction along a-b, point), or None."""
    rx, ry = b[0] - a[0], b[1] - a[1]
    sx, sy = q[0] - p[0], q[1] - p[1]
    den = rx * sy - ry * sx
    if abs(den) < 1e-9:
        return None
    t = ((p[0] - a[0]) * sy - (p[1] - a[1]) * sx) / den
    u = ((p[0] - a[0]) * ry - (p[1] - a[1]) * rx) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return t, (a[0] + rx * t, a[1] + ry * t)
    return None


class Net:
    """Every segment laid so far, on the torus the tile wraps into, bucketed so a new
    step only tests its neighbors, so a crack knows when it has reached another."""

    def __init__(self):
        self.segs = []
        self.grid = {}
        self.nx, self.ny = KW // CELL, KH // CELL

    def key(self, x, y):
        return int((x % KW) // CELL), int((y % KH) // CELL)

    def add(self, a, b):
        self.segs.append((a, b))
        k = self.key((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        self.grid.setdefault(k, []).append(len(self.segs) - 1)
        return len(self.segs) - 1

    def hit(self, a, b, skip):
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        kx, ky = self.key(mx, my)
        best = None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for idx in self.grid.get(((kx + dx) % self.nx, (ky + dy) % self.ny), ()):
                    if idx in skip:
                        continue
                    p, q = self.segs[idx]
                    ox = round((mx - (p[0] + q[0]) / 2) / KW) * KW
                    oy = round((my - (p[1] + q[1]) / 2) / KH) * KH
                    r = intersect(a, b, (p[0] + ox, p[1] + oy), (q[0] + ox, q[1] + oy))
                    # A step starting ON a crack (the fork it grew from, or the one it
                    # just left) is not a meeting: only a crossing ahead of it counts.
                    if r and r[0] > 0.02 and (best is None or r[0] < best[0]):
                        best = r
        return best


def grow(net, cracks, x, y, heading, length, base, depth, parent_skip=(), bend=0.0):
    """One fracture, walked in short steps: a course it keeps, a slow wander off it,
    small grit at every step, and now and then a hard turn where it met a flaw. A main
    break is pulled gently back to the line it started on, so it crosses the tile
    instead of curling into a river, and it may run straight through another break,
    pooling lacquer at the crossing. A branch stops at the first break it meets, the T
    a fracture makes when it reaches one that already relieved the stress. Anything
    that simply runs out tapers."""
    wander = value_noise()
    pts = [(x, y)]
    idxs, pools = [], []
    course, travelled, joined = heading, 0.0, False
    pull = 0.0 if bend else (0.03 if depth == 0 else 0.012)
    next_fork = rng.uniform(40, 110)
    crossed_at = -99
    while travelled < length:
        step = rng.uniform(3.0, 4.6)
        if rng.random() < 0.045:
            course += rng.choice((-1, 1)) * rng.uniform(0.2, 0.6)
        course += bend * step + (heading - course) * pull
        h = course + wander(travelled / 70.0) * 0.5 + rng.gauss(0, 0.09)
        nx, ny = x + math.cos(h) * step, y + math.sin(h) * step
        skip = set(idxs[-3:])
        if travelled < 14:
            skip |= set(parent_skip)
        r = net.hit((x, y), (nx, ny), skip)
        if r and travelled - crossed_at > 12:
            if depth == 0 and travelled > 30 and rng.random() < 0.5:
                pools.append(travelled + math.dist((x, y), r[1]))
                crossed_at = travelled
            else:
                pts.append(r[1])
                idxs.append(net.add((x, y), r[1]))
                joined = True
                break
        idxs.append(net.add((x, y), (nx, ny)))
        x, y = nx, ny
        pts.append((x, y))
        travelled += step
        if depth < 2 and travelled > next_fork and travelled < length - 30:
            next_fork = travelled + rng.uniform(60, 150) * (1 + depth)
            side = rng.choice((-1, 1))
            loop = depth == 0 and rng.random() < 0.3
            pools.append(travelled)
            grow(net, cracks, x, y, h + side * rng.uniform(0.5, 1.2),
                 rng.uniform(60, 260) / (1 + depth * 1.6),
                 base * rng.uniform(0.42, 0.62), depth + 1,
                 parent_skip=idxs[-4:],
                 # A branch that bends back toward its parent closes a small piece, the
                 # little cells a real break leaves near where it forked.
                 bend=(-side * rng.uniform(0.006, 0.012)) if loop else 0.0)
    cracks.append({'pts': pts, 'base': base, 'pools': pools,
                   'start_joined': bool(parent_skip), 'end_joined': joined})


def outline(c):
    """The seam as a filled shape. Width swells and thins along it (lacquer is laid by
    hand, never ruled), pools where the crack forks or meets another, and tapers to a
    point where a crack simply runs out."""
    pts, base = c['pts'], c['base']
    n = len(pts)
    if n < 3:
        return None
    s = [0.0]
    for i in range(1, n):
        s.append(s[-1] + math.dist(pts[i - 1], pts[i]))
    L = s[-1]
    swell, envelope = value_noise(), value_noise()
    bumps = [(rng.uniform(0, L), rng.uniform(0.6, 1.6), rng.uniform(2.5, 7.0))
             for _ in range(int(L / 120) + (1 if rng.random() < 0.5 else 0))]
    # Lacquer gathers where the crack forked or crossed another.
    bumps += [(at, rng.uniform(0.8, 1.5), rng.uniform(3.0, 5.5)) for at in c.get('pools', ())]
    T = min(26.0, L / 3)
    w = []
    for i in range(n):
        # Two scales of unevenness: a slow one, so a seam runs thick for a stretch and then
        # pinches, and a quick one, the beading of lacquer laid by hand.
        v = base * (1 + 0.5 * envelope(s[i] / 220.0)) * (1 + 0.35 * swell(s[i] / 40.0))
        for cpos, amp, sig in bumps:
            v += base * amp * math.exp(-((s[i] - cpos) / sig) ** 2)
        d0, d1 = s[i], L - s[i]
        if c['start_joined']:
            v *= 1 + 1.8 * math.exp(-d0 / 6.0)
        else:
            v *= min(1.0, (d0 / T) ** 0.8) if T > 0 else 1.0
        if c['end_joined']:
            v *= 1 + 1.8 * math.exp(-d1 / 6.0)
        else:
            v *= min(1.0, (d1 / T) ** 0.8) if T > 0 else 1.0
        w.append(max(v, 0.1))
    left, right = [], []
    for i in range(n):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, n - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        m = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / m, tx / m
        half = w[i] / 2
        jl = rng.uniform(-0.18, 0.18) * half
        jr = rng.uniform(-0.18, 0.18) * half
        left.append((pts[i][0] + nx * (half + jl), pts[i][1] + ny * (half + jl)))
        right.append((pts[i][0] - nx * (half + jr), pts[i][1] - ny * (half + jr)))
    ring = left + right[::-1]
    return 'M' + 'L'.join(f'{x:.1f} {y:.1f}' for x, y in ring) + 'Z'


def fracture(seed):
    """One way the bowl could break, from one seed."""
    global rng
    rng = random.Random(seed)
    net, cracks = Net(), []
    # Four main breaks, laid in different directions from different quarters of the
    # tile: a bowl breaks into a few large shards, not into gravel.
    starts = ((0.0, 0.4, 0.04, 0.18, rng.uniform(0.15, 0.45)),
              (0.35, 0.65, 0.26, 0.44, rng.uniform(1.3, 1.8)),
              (0.0, 0.3, 0.52, 0.68, rng.uniform(0.2, 0.55)),
              (0.7, 1.0, 0.76, 0.94, rng.uniform(2.35, 2.85)))
    for x0, x1, y0, y1, heading in starts:
        grow(net, cracks, rng.uniform(x0, x1) * KW, rng.uniform(y0, y1) * KH, heading,
             rng.uniform(900, 1300), rng.uniform(1.8, 3.4), 0)
    # Hairline crazing between them: short, faint, tapered at both ends.
    for _ in range(10):
        grow(net, cracks, rng.uniform(0, KW), rng.uniform(0, KH), rng.uniform(0, math.tau),
             rng.uniform(40, 130), rng.uniform(0.45, 0.7), 2)
    return cracks


def fits(cracks):
    """Whether the nine copies the tile is painted with cover every crack. A point more
    than one tile width outside the tile has no copy that lands inside it, so a crack
    that ran that far would stop short at the edge."""
    return all(-KW <= x < 2 * KW and -KH <= y < 2 * KH for c in cracks for x, y in c['pts'])


def largest_gap(cracks):
    """The widest stretch of bare glaze, in px: the distance from the emptiest point of
    the tile to the nearest seam, measured on the torus the tile wraps into."""
    step = 10
    points = [p for c in cracks if c['base'] > 0.8 for p in c['pts'][::3]]
    worst = 0.0
    for gx in range(0, KW, step):
        for gy in range(0, KH, step):
            near = min(math.hypot((gx - px + KW / 2) % KW - KW / 2,
                                  (gy - py + KH / 2) % KH - KH / 2) for px, py in points)
            worst = max(worst, near)
    return worst


# The seed is chosen, not lucky: of forty tries, the break that leaves the smallest
# bare gap anywhere on the tile, so no screenful of the panel is empty glaze.
SEED_TRIES = range(1590, 1630)   # 1590: when Rikyu's tea bowls were being made


def wabi_sabi():
    def score(seed):
        cracks = fracture(seed)
        return largest_gap(cracks) if fits(cracks) else math.inf
    best = min(SEED_TRIES, key=score)
    cracks = fracture(best)
    print(f'wabi-sabi: seed {best}, largest gap {largest_gap(cracks):.0f}px')

    seams = [f'<path d="{d}"/>' for d in (outline(c) for c in cracks) if d]

    spots = []
    for _ in range(190):
        x, y = rng.uniform(0, KW), rng.uniform(0, KH)
        if rng.random() < 0.7:
            spots.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rng.uniform(0.5, 1.6):.1f}" fill="{RUST}"/>')
        else:
            spots.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rng.uniform(0.4, 1.0):.1f}" fill="{ASH}"/>')

    def tiled(ref):
        return ''.join(f'<use href="#{ref}" x="{dx * KW}" y="{dy * KH}"/>'
                       for dx in (-1, 0, 1) for dy in (-1, 0, 1))

    return f'''<!-- Sidecar, Wabi-sabi background: kintsugi seams on speckled stoneware.
     Generated by scripts/gen-japanese-patterns.py; edit the script, not this file.
     The seams are solid, so shapes that overlap cannot stack into brighter patches, and
     their golds sit at the brightness the hints laid over them allow: a mend is meant to
     be found, not announced. -->
<svg xmlns="http://www.w3.org/2000/svg" width="{KW}" height="{KH}" viewBox="0 0 {KW} {KH}">
<defs>
<linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="{KW // 2}" y2="{KH // 2}" spreadMethod="reflect">
<stop offset="0" stop-color="{GOLDS[0]}"/><stop offset="0.5" stop-color="{GOLDS[1]}"/><stop offset="1" stop-color="{GOLDS[2]}"/>
</linearGradient>
<g id="specks">{''.join(spots)}</g>
<g id="seams">{''.join(seams)}</g>
</defs>
<g opacity="0.16">{tiled('specks')}</g>
<g fill="url(#gold)">{tiled('seams')}</g>
</svg>
'''


# ---- Ukiyo-e -------------------------------------------------------------------------
R = 20                          # one wave's radius, px
INDIGO = '#1D4674'              # Prussian blue, the theme's --gold
RINGS = (1.0, 0.78, 0.56, 0.34)


def ukiyo_e():
    w, h = 4 * R, 2 * R         # two periods each way; the pattern repeats every 2R x R
    rows = []
    k = -2
    while k * R / 2 <= h + R:
        y = k * R / 2
        off = R if k % 2 else 0
        xs, x = [], off - 2 * R
        while x <= w + 2 * R:
            xs.append(x)
            x += 2 * R
        rows.append((y, xs))
        k += 1
    # Each row is masked by every disc laid after it that reaches it, cut at the full
    # radius so the later ring's own stroke covers the join. Rows are R/2 apart, so a
    # disc is reached by the three rows below it.
    pad = 3 * R
    box = f'x="{-pad}" y="{-pad}" width="{w + 2 * pad}" height="{h + 2 * pad}"'
    masks, groups = [], []
    for i, (y, xs) in enumerate(rows):
        later = ''.join(f'<circle cx="{lx:g}" cy="{ly:g}" r="{R}"/>'
                        for ly, lxs in rows[i + 1:] if ly - y < 2 * R for lx in lxs)
        masks.append(f'<mask id="m{i}" maskUnits="userSpaceOnUse" {box}>'
                     f'<rect {box} fill="#fff"/><g fill="#000">{later}</g></mask>')
        rings = ''.join(f'<circle cx="{x:g}" cy="{y:g}" r="{R * f - 0.6:.2f}"/>'
                        for x in xs for f in RINGS)
        groups.append(f'<g mask="url(#m{i})">{rings}</g>')
    return f'''<!-- Sidecar, Ukiyo-e background: seigaiha, the blue sea waves.
     Generated by scripts/gen-japanese-patterns.py; edit the script, not this file.
     Transparent on purpose: each row hides the rings of the row above with a mask
     rather than with a painted disc, so the graded sky in CSS shows through the whole
     tile. -->
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
<defs>{''.join(masks)}</defs>
<g stroke="{INDIGO}" stroke-opacity="0.075" stroke-width="1.2" fill="none">{''.join(groups)}</g>
</svg>
'''


if __name__ == '__main__':
    with open('themes/wabi-sabi-seams.svg', 'w') as f:
        f.write(wabi_sabi())
    with open('themes/ukiyo-e-seigaiha.svg', 'w') as f:
        f.write(ukiyo_e())
    print('wrote themes/wabi-sabi-seams.svg and themes/ukiyo-e-seigaiha.svg')
