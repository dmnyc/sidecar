"""Skeleton leaves, second structure: built the way a real skeleton leaf is organised.

A leaf's veins form a hierarchy, and a skeleton leaf is nothing else:

  primary     the midrib (or, in a maple, one vein from the stem to each lobe tip),
              tapering from the stem to the tip.
  secondary   branching from the primary, staggered rather than paired, each at its own
              spacing and angle. In a leaf with a smooth edge each one turns and loops into
              the next just inside the margin (brochidodromous); in a toothed leaf it runs
              out to the edge (craspedodromous). Some fork near their ends.
  tertiary    short cross-veins running between neighbouring secondaries, like rungs.
  areoles     the lace: the smallest cells. They are grown INSIDE each space the veins
              enclose, so every strand ends on a vein and none crosses one.

The edge is a fine marginal vein, not a drawn outline, and the tint gathers darker along
the veins, the way dye takes on a real skeleton.

Outlines and stems come from traced.py (the public-domain "Variety of Leaves" SVG).
"""
import math
import random
import numpy as np
from scipy.spatial import Voronoi
from shapely.geometry import Polygon, LineString, Point, MultiPolygon, MultiLineString
from shapely.ops import unary_union, nearest_points, substring

import traced as T

TOOTHED = {1, 3, 7, 8, 12, 13}
fi = T.fi
unit = T.unit


def pstr(pts):
    return 'L'.join('%s %s' % (fi(x), fi(y)) for x, y in pts)


def march(inner, P, d, t_hint, step, max_len, bend, blocked=None):
    # A secondary runs nearly straight out from its parent and turns toward the tip only as
    # it nears the margin. The turn is applied in proportion to how close the next step is
    # to the edge, not at a constant rate, which bent the long ones round until they ran
    # parallel to the midrib.
    pts = [P]
    length = 0.0
    edge = inner.exterior
    while length < max_len:
        near = max(0.0, 1.0 - edge.distance(Point(pts[-1])) / (14 * step))
        d = unit((d[0] + bend * (0.25 + 3.0 * near) * t_hint[0], d[1] + bend * (0.25 + 3.0 * near) * t_hint[1]))
        nxt = (pts[-1][0] + d[0] * step, pts[-1][1] + d[1] * step)
        if not inner.contains(Point(nxt)):
            break
        # Veins never cross: one that reaches a vein already laid down joins it there.
        if blocked is not None and len(pts) > 3 and blocked.intersects(LineString([pts[-1], nxt])):
            pts.append(nxt)
            break
        pts.append(nxt)
        length += step
    return pts


def rot(v, deg):
    a = math.radians(deg)
    return (v[0] * math.cos(a) - v[1] * math.sin(a), v[0] * math.sin(a) + v[1] * math.cos(a))


class _Others:
    # The blocked set, minus the vein's own parent near where it leaves it.
    def __init__(self, blocked, own, start, r):
        self.blocked, self.own, self.zone = blocked, own, Point(start).buffer(r)

    def intersects(self, seg):
        if not self.blocked.intersects(seg):
            return False
        hit = seg.intersection(self.own)
        return hit.is_empty or not self.zone.contains(hit)


def areoles(region, cell, rnd):
    """Voronoi cells grown inside one space between veins; lines clipped to it."""
    area = region.area
    n = int(area / (cell * cell))
    if n < 2:
        return []
    minx, miny, maxx, maxy = region.bounds
    pts = []
    tries = 0
    while len(pts) < n and tries < n * 30:
        tries += 1
        p = (rnd.uniform(minx, maxx), rnd.uniform(miny, maxy))
        if region.contains(Point(p)):
            pts.append(p)
    if len(pts) < 2:
        return []
    pts = np.array(pts)
    far = [[minx - 9999, miny - 9999], [maxx + 9999, miny - 9999], [minx - 9999, maxy + 9999], [maxx + 9999, maxy + 9999]]
    vor = Voronoi(np.vstack([pts, far]))
    # one round of relaxation, so cells are even like real areoles
    new = []
    for i, p in enumerate(pts):
        reg = vor.regions[vor.point_region[i]]
        if -1 in reg or not reg:
            new.append(p)
            continue
        c = Polygon(vor.vertices[reg]).intersection(region)
        new.append(np.array(c.centroid.coords[0]) if not c.is_empty else p)
    vor = Voronoi(np.vstack([np.array(new), far]))
    out = []
    for a, b in vor.ridge_vertices:
        if a < 0 or b < 0:
            continue
        seg = LineString([vor.vertices[a], vor.vertices[b]]).intersection(region)
        for s in (seg.geoms if hasattr(seg, 'geoms') else [seg]):
            if s.geom_type == 'LineString' and s.length > cell * 0.08:
                (x0, y0), (x1, y1) = s.coords[0], s.coords[-1]
                mx, my = (x0 + x1) / 2, (y0 + y1) / 2
                k = rnd.uniform(-0.15, 0.15)
                out.append('M%s %sQ%s %s %s %s' % (fi(x0), fi(y0), fi(mx - (y1 - y0) * k), fi(my + (x1 - x0) * k), fi(x1), fi(y1)))
    return out


def network(i, leaf, k, size, rnd):
    """Return (filled vein paths, thin vein polylines, lace path strings, vein union geom)."""
    b = leaf['blade']
    base, tips = T.base_and_tips(i, leaf)
    px = 1.0 / k
    grow = (size / 200.0) ** 0.5
    inner = b.buffer(-2.5 * px)
    margin_track = b.buffer(-4.5 * px)
    if margin_track.geom_type != 'Polygon':
        margin_track = max(margin_track.geoms, key=lambda g: g.area)
    track = margin_track.exterior
    toothed = i in TOOTHED
    filled = []          # (polyline, w0, w1)
    thin = []            # (polyline, width)
    primaries = []
    if i in T.PALMATE:
        far = max(tips, key=lambda p: math.hypot(p[0] - base[0], p[1] - base[1]))
        for tip in tips:
            end = (base[0] + (tip[0] - base[0]) * 0.97, base[1] + (tip[1] - base[1]) * 0.97)
            mid = ((base[0] + end[0]) / 2 + rnd.uniform(-3, 3) * px, (base[1] + end[1]) / 2 + rnd.uniform(-3, 3) * px)
            path = [tuple(p) for p in np.array(LineString([base, mid, end]).segmentize(4 * px).coords)]
            primaries.append((path, (2.7 if tip == far else 2.1) * grow * px, (1, -1), 0.1))
        # The small lower lobes: outline points well out from the stem, at least 40
        # degrees from every main lobe, get a short primary of their own.
        ring = list(b.exterior.coords)[:-1]
        radial = [math.hypot(px_ - base[0], py_ - base[1]) for px_, py_ in ring]
        ang = lambda p: math.atan2(p[0] - base[0], -(p[1] - base[1]))
        gap = lambda a1, a2: abs((a1 - a2 + math.pi) % (2 * math.pi) - math.pi)
        extra = []
        for j in sorted(range(len(ring)), key=lambda j: -radial[j]):
            if radial[j] < 0.3 * max(radial):
                break
            if all(gap(ang(ring[j]), ang(t)) > math.radians(40) for t in tips + extra):
                extra.append(ring[j])
            if len(extra) == 2:
                break
        for tip in extra:
            end = (base[0] + (tip[0] - base[0]) * 0.92, base[1] + (tip[1] - base[1]) * 0.92)
            path = [tuple(p) for p in np.array(LineString([base, end]).segmentize(4 * px).coords)]
            primaries.append((path, 1.5 * grow * px, (1, -1), 0.15))
    else:
        mid = T.centre_path(b, base, tips[0])
        w0 = 2.9 * grow * px
        primaries.append((mid, w0, (1, -1), 0.04))
        if i in T.BROAD:
            # A heart-shaped leaf sends a pair of strong veins from the notch out into its
            # two lower lobes, each with veins of its own on its outer side.
            # Started a little way up the midrib: the notch itself is at the margin, and a
            # vein started there stops before it has begun.
            P0, t0 = T.along(mid, 0.035)
            for side in (1, -1):
                d = rot(t0, side * rnd.uniform(100, 112))
                bp = [P0] + march(inner, P0, d, t0, 2 * px, LineString(mid).length * 0.7, 0.02)[1:]
                if len(bp) > 8:
                    primaries.append((bp, w0 * 0.62, (1, -1), 0.06))

    from shapely.prepared import prep
    laid = [LineString(p) for p, _, _, _ in primaries]
    for path, w0, _, _ in primaries:
        filled.append((path, w0, 0.35 * px))
    for path, w0, sides, start_f in primaries:
        blocked = prep(unary_union(laid))
        own = LineString(path)
        L = LineString(path).length
        palm = i in T.PALMATE
        spacing = (15 if palm else 19) * px
        start, stop = start_f, 0.9
        if sides == 'outer':
            # only the side facing away from the leaf's tip, where the lobe is
            tipdir = unit((tips[0][0] - base[0], tips[0][1] - base[1]))
            _, tm = T.along(path, 0.4)
            sides = tuple(s_ for s_ in (1, -1) if (lambda v: v[0] * tipdir[0] + v[1] * tipdir[1])(rot(tm, 60 * s_)) < 0) or (1,)
        for side in sides:
            sec = []
            # staggered: one side starts half a spacing later than the other
            f = start + (0.5 * spacing / L if side < 0 else 0.0)
            while f < stop:
                P, t = T.along(path, f)
                broad = i in T.BROAD
                if palm:
                    ang = 50
                elif broad:
                    ang = (96 if f < 0.1 else 70) - 30 * f
                else:
                    ang = (88 if f < 0.08 else 64) - 26 * f
                ang += rnd.uniform(-7, 7)
                d = rot(t, ang * side)
                bend = (0.012 if (palm or broad) else 0.028) * rnd.uniform(0.7, 1.3)
                pts = march(inner, P, d, t, 2 * px, L * (0.42 if palm else 0.9), bend,
                            blocked=_Others(blocked, own, P, 6 * px))
                if len(pts) >= 5:
                    laid.append(LineString(pts))
                    wl = (w0 + (0.35 * px - w0) * f) * 0.62
                    filled.append((pts, wl, 0.32 * px))
                    sec.append((f, pts, wl))
                    # a fork near the end, toward the margin, now and then
                    if len(pts) > 14 and rnd.random() < 0.35:
                        j = int(len(pts) * rnd.uniform(0.62, 0.78))
                        q0, q1 = pts[j - 1], pts[j]
                        dd = unit((q1[0] - q0[0], q1[1] - q0[1]))
                        fork = march(inner, q1, rot(dd, side * rnd.uniform(18, 30)), dd, 2 * px, L * 0.3, 0.0)
                        if len(fork) >= 4:
                            thin.append((fork, 0.7))
                f += (spacing / L) * rnd.uniform(0.78, 1.25)
            # smooth edge: each secondary loops into the next one up, along the inside of
            # the margin
            if not toothed:
                for (fa, a, _), (fb, c, _) in zip(sec, sec[1:]):
                    da = track.project(Point(a[-1]))
                    db = track.project(Point(c[-1]))
                    lo, hi = sorted((da, db))
                    seg = substring(track, lo, hi)
                    if seg.length > track.length / 2:
                        continue
                    if seg.length < 60 * px:
                        thin.append((list(seg.coords), 0.75))
            # tertiaries: rungs between neighbouring secondaries
            for (_, a, _), (_, c, _) in zip(sec, sec[1:]):
                A, C = LineString(a), LineString(c)
                u = 0.12
                while True:
                    u += (9 * px / max(A.length, 1e-6)) * rnd.uniform(0.7, 1.45)
                    if u > 0.9:
                        break
                    if rnd.random() < 0.25:
                        continue
                    p = A.interpolate(u, normalized=True)
                    q = nearest_points(p, C)[1]
                    if p.distance(q) > 34 * px or p.distance(q) < 3 * px:
                        continue
                    mx, my = (p.x + q.x) / 2, (p.y + q.y) / 2
                    nx, ny = -(q.y - p.y), (q.x - p.x)
                    w = rnd.uniform(-0.22, 0.22)
                    rung = [(p.x, p.y), (mx + nx * w, my + ny * w), (q.x, q.y)]
                    if b.contains(LineString(rung)):
                        thin.append((rung, 0.5))

    # the lace: inside every space the veins enclose
    vein_geom = unary_union(
        [LineString(p).buffer((w0 + w1) / 4 + 0.2 * px) for p, w0, w1 in filled] +
        [LineString(p).buffer(0.35 * px) for p, w in thin])
    spaces = inner.difference(vein_geom)
    regions = list(spaces.geoms) if hasattr(spaces, 'geoms') else [spaces]
    lace = []
    for r in regions:
        if r.geom_type == 'Polygon' and r.area > (4 * px) ** 2:
            lace += areoles(r, 6.5 * px, rnd)
    return filled, thin, lace, vein_geom


def render(leaf, x, y, size, tip_deg, ink, tint, tint_alpha, seed, idx, flip=False, blend=True, shadow=False):
    rnd = random.Random(seed)
    b = leaf['blade']
    minx, miny, maxx, maxy = b.bounds
    k = size / max(maxx - minx, maxy - miny)
    cx, cy = b.centroid.x, b.centroid.y
    base, tips = T.base_and_tips(idx, leaf)
    far = max(tips, key=lambda p: math.hypot(p[0] - base[0], p[1] - base[1]))
    src = math.degrees(math.atan2(far[0] - base[0], -(far[1] - base[1])))
    if flip:
        src = -src
    rotate = tip_deg - src
    sx = -k if flip else k
    tr = 'translate(%s %s) rotate(%s) scale(%s %s) translate(%s %s)' % (fi(x), fi(y), fi(rotate), '%.4g' % sx, '%.4g' % k, fi(-cx), fi(-cy))
    T.CLIP[0] += 1
    cid = 'sk%d' % T.CLIP[0]
    outline = 'M%sZ' % pstr(b.exterior.coords)
    filled, thin, lace, vein_geom = network(idx, leaf, k, size, rnd)
    o = ['<g transform="%s"%s%s>' % (tr, ' style="mix-blend-mode:multiply"' if blend else '', ' filter="url(#lift)"' if shadow else ''),
         '<clipPath id="%s"><path d="%s"/></clipPath>' % (cid, outline),
         '<path d="%s" fill="%s" fill-opacity="%g"/>' % (outline, tint, tint_alpha),
         '<g clip-path="url(#%s)">' % cid]
    # dye gathers along the veins
    halo = vein_geom.buffer(2.5 / k)
    hp = [halo] if halo.geom_type == 'Polygon' else list(halo.geoms)
    o.append('<path d="%s" fill="%s" fill-opacity="%g" fill-rule="evenodd"/>' % (
        ''.join('M%sZ' % pstr(g.exterior.coords) + ''.join('M%sZ' % pstr(h.coords) for h in g.interiors) for g in hp if g.geom_type == 'Polygon'),
        tint, tint_alpha * 0.8))
    o.append('<path d="%s" fill="none" stroke="%s" stroke-width="0.35" stroke-opacity="0.7" vector-effect="non-scaling-stroke"/>' % (''.join(lace), ink))
    for pts, w in thin:
        o.append('<path d="M%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' % (pstr(pts), ink, w))
    for pts, w0, w1 in filled:
        d = T.tapered(pts, w0, w1)
        if d:
            o.append('<path d="%s" fill="%s"/>' % (d, ink))
    o += ['</g>',
          # the marginal vein: fine, not an outline
          '<path d="%s" fill="none" stroke="%s" stroke-width="0.55" stroke-opacity="0.85" vector-effect="non-scaling-stroke"/>' % (outline, ink),
          T.stem_path(leaf['stem'], k, size, ink),
          '</g>']
    return ''.join(o)
