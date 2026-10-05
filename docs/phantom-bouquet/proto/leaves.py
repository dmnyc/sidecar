"""Skeleton leaves, drawn to botanical form.

Every leaf is built straight (base at the origin, tip up the negative y axis), then bent
through one warp: a curve in the midrib and a little lopsidedness, which no real leaf is
without. The outline and every vein go through the same warp, so they bend together. The
veins are drawn clipped to the outline; only the margin and the stem sit outside the clip.

  bodhi     Ficus religiosa: broadly ovate with a truncate-to-cordate base, a pair of
            basal veins rising from the base, and the long ribbon drip tip that starts
            abruptly about two thirds of the way up.
  magnolia  elliptic to obovate, a short point; many secondaries, nearly straight, each
            looping into the next near the margin.
  lance     lanceolate, the commercial skeleton leaf of the dyed garland: narrow, curved
            along its midrib, closely spaced secondaries at a shallow angle.
  maple     Acer saccharum: three main lobes and two small basal ones, a few coarse
            pointed teeth, rounded sinuses; five veins from the base, and a secondary
            running out to the tip of every tooth.
"""
import math, random
import numpy as np
from scipy.spatial import Voronoi
from shapely.geometry import Polygon, LineString, Point

CLIP = [0]


def fi(v):
    return '%d' % round(v)


def catmull(pts, n=8, closed=False):
    if closed:
        p = [pts[-1]] + pts + pts[:2]
    else:
        p = [pts[0]] + pts + [pts[-1]]
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in range(2)))
    if not closed:
        out.append(pts[-1])
    return out


def bez(p0, p1, p2, n=10):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in (i / n for i in range(n + 1))]


# ---- outlines, straight ------------------------------------------------------------------

# Half-width along the midrib, fraction of length; t < 0 is below the petiole (the lobes of
# a cordate base). Interpolated by Catmull-Rom, so the points are where the shape turns.
PROFILES = {
    'bodhi': ([-0.1, -0.09, -0.07, -0.04, 0.0, 0.06, 0.16, 0.28, 0.4, 0.5, 0.58, 0.65, 0.7, 0.75, 0.82, 0.9, 0.96, 1.0],
              [0.0, 0.07, 0.19, 0.31, 0.39, 0.45, 0.47, 0.45, 0.39, 0.31, 0.22, 0.13, 0.075, 0.05, 0.035, 0.024, 0.012, 0.0]),
    'magnolia': ([0.0, 0.03, 0.12, 0.3, 0.5, 0.66, 0.8, 0.9, 0.96, 1.0],
                 [0.0, 0.05, 0.13, 0.22, 0.26, 0.25, 0.19, 0.11, 0.05, 0.0]),
    'lance': ([0.0, 0.04, 0.15, 0.32, 0.5, 0.68, 0.84, 0.94, 1.0],
              [0.0, 0.035, 0.1, 0.15, 0.165, 0.15, 0.1, 0.045, 0.0]),
}


def half_width(kind, t):
    ts, hs = PROFILES[kind]
    return float(np.interp(t, ts, hs))


def pinnate_outline(kind, L):
    ts, hs = PROFILES[kind]
    right = catmull([(h * L, -t * L) for t, h in zip(ts, hs)], 8)
    left = [(-x, y) for x, y in reversed(right)]
    return right + left[1:]


# Sugar maple, built the way the leaf is: five pointed lobes on their own axes (the top,
# two main side lobes angled up at about 50 degrees, two small basal ones angled down),
# each with a couple of coarse forward-leaning teeth on each side, joined to the leaf's
# centre. Closing the union (grow, then shrink back) rounds only the concave corners, so
# the sinuses come out U-shaped while every tip and tooth stays sharp.
# (angle from straight up in degrees, length, width, teeth per side), R = 1.
MAPLE_LOBES = [(0, 1.0, 0.46, 2), (52, 0.92, 0.46, 2), (-52, 0.92, 0.46, 2), (112, 0.52, 0.3, 1), (-112, 0.52, 0.3, 1)]
MAPLE_FEATURES = {}


def lobe(angle, length, width, nteeth, R):
    th = math.radians(angle)
    ax, ay = math.sin(th), -math.cos(th)          # along the lobe
    nx, ny = -ay, ax                               # across it
    half = lambda u: width / 2 * (0.4 + 0.6 * u / 0.6 if u < 0.6 else (1 - u) / 0.4)
    tooth_u = [0.5 + k * 0.2 for k in range(nteeth)]
    side = {}
    teeth = []
    for s in (1, -1):
        pts = []
        n = 24
        for i in range(n + 1):
            u = i / n
            # a tooth replaces the stretch of edge it stands on: up its front from u - 0.06,
            # out to a tip that leans toward the lobe's tip, back down to u + 0.1
            if any(tu - 0.06 < u < tu + 0.1 for tu in tooth_u):
                continue
            pts.append((u, half(u)))
            for tu in tooth_u:
                if abs(u - (tu - 0.06)) < 0.5 / n:
                    tip = (tu + 0.07, half(tu) + 0.08 * length)
                    pts.append(tip)
                    teeth.append((tip[0] * length, s * tip[1]))
        side[s] = [(u * length, s * hw) for u, hw in pts]
    ring = [(0.0, 0.0)] + side[1] + list(reversed(side[-1]))
    to_xy = lambda p: ((p[0] * ax + p[1] * nx) * R, (p[0] * ay + p[1] * ny) * R)
    return Polygon([to_xy(p) for p in ring]).buffer(0), to_xy((length, 0)), [to_xy(t) for t in teeth]


def maple_outline(R):
    shape = Point(0, -0.12 * R).buffer(0.24 * R)
    tips, teeth = [], []
    for a, l, w, n in MAPLE_LOBES:
        poly, tip, ts = lobe(a, l, w, n, R)
        shape = shape.union(poly)
        tips.append(tip)
        teeth += ts
    r = 0.06 * R
    shape = shape.buffer(r, join_style=2).buffer(-r, join_style=2)
    MAPLE_FEATURES[R] = (tips, teeth)
    return list(shape.exterior.coords)[:-1]


# ---- the warp ------------------------------------------------------------------------------

def make_warp(L, bend, asym):
    def w(p):
        x, y = p
        t = max(0.0, -y / L)
        x = x * (1 + asym if x > 0 else 1 - asym)
        return (x + bend * L * t * t, y)
    return w


# ---- lace -----------------------------------------------------------------------------------

def voronoi_edges(poly, n, rnd, relax=2):
    minx, miny, maxx, maxy = poly.bounds
    pts = []
    tries = 0
    while len(pts) < n and tries < n * 50:
        tries += 1
        p = (rnd.uniform(minx, maxx), rnd.uniform(miny, maxy))
        if poly.contains(Point(p)):
            pts.append(p)
    pts = np.array(pts)
    far = [[minx - 999, miny - 999], [maxx + 999, miny - 999], [minx - 999, maxy + 999], [maxx + 999, maxy + 999]]
    for _ in range(relax):
        vor = Voronoi(np.vstack([pts, far]))
        new = []
        for i, p in enumerate(pts):
            reg = vor.regions[vor.point_region[i]]
            if -1 in reg or not reg:
                new.append(p)
                continue
            cell = Polygon(vor.vertices[reg]).intersection(poly)
            new.append(np.array(cell.centroid.coords[0]) if not cell.is_empty else p)
        pts = np.array(new)
    vor = Voronoi(np.vstack([pts, far]))
    out = []
    for a, b in vor.ridge_vertices:
        if a < 0 or b < 0:
            continue
        seg = LineString([vor.vertices[a], vor.vertices[b]]).intersection(poly)
        for g in (seg.geoms if hasattr(seg, 'geoms') else [seg]):
            if g.geom_type == 'LineString' and g.length > 0.3:
                (x0, y0), (x1, y1) = g.coords[0], g.coords[-1]
                mx, my = (x0 + x1) / 2, (y0 + y1) / 2
                k = rnd.uniform(-0.18, 0.18)
                out.append('M%s %sQ%s %s %s %s' % (fi(x0), fi(y0), fi(mx - (y1 - y0) * k), fi(my + (x1 - x0) * k), fi(x1), fi(y1)))
    return ''.join(out)


AREA = {'bodhi': 0.6, 'magnolia': 0.36, 'lance': 0.22, 'maple': 0.42}


def mesh_for(kind, size, coarse=30.0, fine=15.0):
    area = AREA[kind] * size * size
    return (max(8, int(area / coarse ** 2)), max(30, int(area / fine ** 2)))


# ---- veins, straight -----------------------------------------------------------------------

def pinnate_veins(kind, L, rnd):
    """Return [(points, width_at_200px)] in straight space."""
    v = []
    tip_t = 1.0
    # the midrib, in three tapering runs
    for t0, t1, w in [(0.0, 0.35, 2.6), (0.35, 0.7, 1.8), (0.7, tip_t, 1.0)]:
        v.append(([(0, -t0 * L), (0, -t1 * L)], w))
    if kind == 'bodhi':
        # the basal pair: out from the very base, nearly level, then up along the margin
        for s in (1, -1):
            v.append((bez((0, -0.005 * L), (s * 0.3 * L, -0.0 * L), (s * 0.4 * L, -0.24 * L), 12), 1.4))
        tsec = [0.1, 0.18, 0.26, 0.34, 0.42, 0.5, 0.58]
        reach, rise = 0.86, 0.11
    elif kind == 'magnolia':
        tsec = [0.06 + i * 0.075 for i in range(11)]
        reach, rise = 0.86, 0.07
    else:
        tsec = [0.05 + i * 0.062 for i in range(14)]
        reach, rise = 0.84, 0.09
    ends = {1: [], -1: []}
    for t in tsec:
        t += rnd.uniform(-0.012, 0.012)
        for s in (1, -1):
            te = t + rise
            hx = half_width(kind, te) * L
            if hx < 0.012 * L:
                continue
            p0 = (0, -t * L)
            p2 = (s * reach * hx, -te * L)
            p1 = (s * 0.45 * hx, -(t + rise * 0.25) * L)
            v.append((bez(p0, p1, p2, 10), 1.1))
            ends[s].append((te, p2))
    # each secondary loops into the next one up, just inside the margin
    for s in (1, -1):
        e = sorted(ends[s])
        for (ta, a), (tb, b) in zip(e, e[1:]):
            tm = (ta + tb) / 2
            c = (s * half_width(kind, tm) * L * 0.93, -tm * L)
            v.append((bez(a, c, b, 8), 0.7))
    return v


def maple_veins(R, rnd):
    # Five veins from the base to the lobe tips, and from each a secondary running out to
    # every tooth on its lobe, the way a maple's veins end in its teeth.
    v = []
    tips, teeth = MAPLE_FEATURES[R]
    prim = []
    for k, tip in enumerate(tips):
        mid = (tip[0] * 0.5 + rnd.uniform(-0.02, 0.02) * R, tip[1] * 0.5)
        pts = bez((0, 0.02 * R), mid, (tip[0] * 0.97, tip[1] * 0.97), 12)
        v.append((pts, 2.0 if k < 3 else 1.3))
        prim.append(pts)
    for tip in teeth:
        _, i, j = min((math.hypot(px - tip[0], py - tip[1]), i, j) for i, pts in enumerate(prim) for j, (px, py) in enumerate(pts))
        a = prim[i][max(2, int(j * 0.75))]
        c = (a[0] * 0.4 + tip[0] * 0.6, a[1] * 0.4 + tip[1] * 0.6)
        v.append((bez(a, c, tip, 8), 0.9))
    return v


# ---- one leaf -------------------------------------------------------------------------------

def leaf(kind, size, seed, ink, tint, tint_alpha, bend=None, asym=None):
    rnd = random.Random(seed)
    bend = rnd.uniform(-0.07, 0.07) if bend is None else bend
    asym = rnd.uniform(-0.05, 0.05) if asym is None else asym
    if kind == 'maple':
        R = size / 2
        outline = maple_outline(R)
        veins = maple_veins(R, rnd)
        warp = make_warp(R, bend * 0.4, asym)
        stem = [(0, 0.02 * R), (0.02 * R, 0.55 * R)]
    else:
        L = size
        outline = pinnate_outline(kind, L)
        veins = pinnate_veins(kind, L, rnd)
        warp = make_warp(L, bend, asym)
        stem = [(0, 0.0), (-0.01 * L, 0.09 * L)]
    outline = [warp(p) for p in outline]
    poly = Polygon(outline).buffer(0)
    if poly.geom_type != 'Polygon':
        poly = max(poly.geoms, key=lambda g: g.area)
    sw = lambda w: '%.2g' % (w * (size / 200.0) ** 0.5)
    d_outline = 'M%sZ' % 'L'.join('%s %s' % (fi(x), fi(y)) for x, y in poly.exterior.coords)
    CLIP[0] += 1
    cid = 'leaf%d' % CLIP[0]
    o = ['<clipPath id="%s"><path d="%s"/></clipPath>' % (cid, d_outline),
         '<path d="%s" fill="%s" fill-opacity="%g"/>' % (d_outline, tint, tint_alpha)]
    g = ['<g fill="none" stroke="%s" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#%s)">' % (ink, cid)]
    mc, mf = mesh_for(kind, size)
    inner = poly.buffer(-1.0)
    g.append('<path d="%s" stroke-width="0.4" stroke-opacity="0.55"/>' % voronoi_edges(inner, mf, rnd, 1))
    g.append('<path d="%s" stroke-width="0.75" stroke-opacity="0.8"/>' % voronoi_edges(inner, mc, rnd, 2))
    for pts, w in veins:
        wp = [warp(p) for p in pts]
        g.append('<path d="M%s" stroke-width="%s"/>' % ('L'.join('%s %s' % (fi(x), fi(y)) for x, y in wp), sw(w)))
    g.append('</g>')
    ws = [warp(p) for p in stem]
    m = ['<g fill="none" stroke="%s" stroke-linecap="round" stroke-linejoin="round">' % ink,
         '<path d="%s" stroke-width="%s"/>' % (d_outline, sw(0.9)),
         '<path d="M%s" stroke-width="%s"/>' % ('L'.join('%s %s' % (fi(x), fi(y)) for x, y in ws), sw(2.4)),
         '</g>']
    return ''.join(o + g + m), poly
