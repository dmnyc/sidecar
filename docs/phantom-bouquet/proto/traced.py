"""Skeleton leaves from the public-domain "Variety of Leaves" SVG.

Each leaf in the source is a group of filled paths: the blade (the largest), the stem, and
the veins (tapered filled slivers). Here each becomes a skeleton leaf: the blade's own
outline is the margin and the clip, the source's veins are the main veins, and the lace
is grown inside it. Drawn in the source's own coordinates and placed by a transform, so the
hand-drawn curves are kept exactly; the margin and the lace use non-scaling strokes, so
their lines are the same width on screen whatever size a leaf is placed at.
"""
import math
import random
import numpy as np
from scipy.spatial import Voronoi
from shapely.geometry import Polygon, LineString, Point, MultiPolygon
from shapely.ops import unary_union
from svgelements import SVG, Path, Group

import os
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'variety.svg')


def fi(v):
    return ('%.1f' % v).rstrip('0').rstrip('.')


def sample(p, step=1.5):
    out = []
    for sub in p.as_subpaths():
        sp = Path(sub)
        L = sp.length(error=1e-2)
        n = max(8, int(L / step))
        pts = [sp.point(i / n) for i in range(n + 1)]
        out.append([(q.x, q.y) for q in pts if q is not None])
    return out


def centreline(geom, n=24):
    # A stem is a thin curved strip. Its two ends are the pair of outline points farthest
    # apart; the outline splits there into two long sides, and the centreline is the
    # average of the two sides resampled to the same number of points.
    if isinstance(geom, MultiPolygon):
        geom = max(geom.geoms, key=lambda q: q.area)
    ring = list(geom.exterior.coords)[:-1]
    pts = np.array(ring)
    step = max(1, len(pts) // 200)
    sub = pts[::step]
    d = ((sub[:, None, :] - sub[None, :, :]) ** 2).sum(-1)
    i, j = np.unravel_index(d.argmax(), d.shape)
    i, j = sorted((i * step, j * step))
    a = LineString(ring[i:j + 1])
    b = LineString(ring[j:] + ring[:i + 1])
    a_pts = [a.interpolate(t, normalized=True) for t in np.linspace(0, 1, n)]
    b_pts = [b.interpolate(t, normalized=True) for t in np.linspace(1, 0, n)]
    line = [((p.x + q.x) / 2, (p.y + q.y) / 2) for p, q in zip(a_pts, b_pts)]
    width = geom.area / max(1e-6, LineString(line).length)
    return line, width


def load():
    svg = SVG.parse(SRC)
    leaves = []
    for g in [e for e in svg if isinstance(e, Group)]:
        paths = [p for p in g.select(lambda e: isinstance(e, Path)) if len(p)]
        polys = []
        for p in paths:
            rings = [Polygon(r).buffer(0) for r in sample(p) if len(r) > 3]
            geom = unary_union([r for r in rings if not r.is_empty]) if rings else Polygon()
            polys.append((geom.area, p, geom))
        polys.sort(key=lambda t: -t[0])
        blade_geom = polys[0][2]
        if isinstance(blade_geom, MultiPolygon):
            blade_geom = max(blade_geom.geoms, key=lambda q: q.area)
        # SEALED: the source cuts its veins out of the blade as thin slits, so its outline
        # runs in and out of narrow channels. Grown and shrunk back by a few units, the
        # channels close and the outline is the leaf's edge alone. The slits were what bent
        # the midrib off the middle and let the stem run on inside the leaf.
        blade = Polygon(blade_geom.exterior).buffer(6, join_style=2).buffer(-6, join_style=2)
        if isinstance(blade, MultiPolygon):
            blade = max(blade.geoms, key=lambda q: q.area)
        blade = Polygon(blade.exterior).simplify(0.4)
        bx0, by0, bx1, by1 = blade.bounds
        veins, rest = [], []
        for _, p, geom in polys[1:]:
            gx0, gy0, gx1, gy1 = p.bbox()
            # A path as wide and tall as the blade is a ring drawn round its edge, not a
            # vein; filled, it would paint the whole leaf solid.
            if (gx1 - gx0) > 0.9 * (bx1 - bx0) and (gy1 - gy0) > 0.9 * (by1 - by0):
                continue
            veins.append(p)
            rest.append(geom)
        # THE STEM is whatever of those lies outside the blade. Some leaves draw the stem as
        # its own path and some run it on into the midrib as one; either way the part out
        # past the margin is the stem, and everything inside is drawn as veins, clipped.
        outside = unary_union(rest).difference(blade.buffer(0.5))
        pieces = [g for g in (outside.geoms if hasattr(outside, 'geoms') else [outside])
                  if g.geom_type == 'Polygon' and g.area > 1]
        # Five of the source's leaves are drawn without one; they stay without one.
        stem = centreline(max(pieces, key=lambda q: q.area)) if pieces else None
        # A vein whose box spans most of the blade is the drawn network (the maples draw
        # theirs as one path); everything else is a single vein. Either way it is kept.
        leaves.append({'blade': blade, 'stem': stem, 'veins': veins})
    return leaves


def lace(poly, cell, rnd, relax):
    area = poly.area
    n = max(12, int(area / (cell * cell)))
    minx, miny, maxx, maxy = poly.bounds
    pts = []
    while len(pts) < n:
        p = (rnd.uniform(minx, maxx), rnd.uniform(miny, maxy))
        if poly.contains(Point(p)):
            pts.append(p)
    pts = np.array(pts)
    far = [[minx - 9999, miny - 9999], [maxx + 9999, miny - 9999], [minx - 9999, maxy + 9999], [maxx + 9999, maxy + 9999]]
    for _ in range(relax):
        vor = Voronoi(np.vstack([pts, far]))
        new = []
        for i, p in enumerate(pts):
            reg = vor.regions[vor.point_region[i]]
            if -1 in reg or not reg:
                new.append(p)
                continue
            c = Polygon(vor.vertices[reg]).intersection(poly)
            new.append(np.array(c.centroid.coords[0]) if not c.is_empty else p)
        pts = np.array(new)
    vor = Voronoi(np.vstack([pts, far]))
    d = []
    for a, b in vor.ridge_vertices:
        if a < 0 or b < 0:
            continue
        seg = LineString([vor.vertices[a], vor.vertices[b]]).intersection(poly)
        for s in (seg.geoms if hasattr(seg, 'geoms') else [seg]):
            if s.geom_type == 'LineString' and s.length > cell * 0.05:
                (x0, y0), (x1, y1) = s.coords[0], s.coords[-1]
                mx, my = (x0 + x1) / 2, (y0 + y1) / 2
                k = rnd.uniform(-0.18, 0.18)
                d.append('M%s %sQ%s %s %s %s' % (fi(x0), fi(y0), fi(mx - (y1 - y0) * k), fi(my + (x1 - x0) * k), fi(x1), fi(y1)))
    return ''.join(d)


CLIP = [0]


def stem_path(stem, k, size, ink):
    if stem is None:
        return ''
    line, _ = stem
    # Drawn in screen pixels (non-scaling), as heavy as a 2.4px stem on a 200px leaf and
    # growing with the square root of the leaf's size, the rule the veins follow.
    w = 2.4 * (size / 200.0) ** 0.5
    return '<path d="M%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' % (
        'L'.join('%s %s' % (fi(x), fi(y)) for x, y in line), ink, '%.2g' % w)


def render(leaf, x, y, size, tip_deg, ink, tint, tint_alpha, seed, flip=False, blend=True, shadow=False,
           fine_px=13, coarse_px=30, idx=None):
    """Place a leaf with its blade's centre at (x, y), its longest side `size` px, and its
    tip pointing tip_deg degrees clockwise from straight up."""
    rnd = random.Random(seed)
    base, tips = base_and_tips(idx, leaf)
    far = max(tips, key=lambda p: math.hypot(p[0] - base[0], p[1] - base[1]))
    src = math.degrees(math.atan2(far[0] - base[0], -(far[1] - base[1])))
    if flip:
        src = -src
    rot = tip_deg - src
    b = leaf['blade']
    minx, miny, maxx, maxy = b.bounds
    k = size / max(maxx - minx, maxy - miny)
    cx, cy = b.centroid.x, b.centroid.y
    CLIP[0] += 1
    cid = 'lf%d' % CLIP[0]
    outline = 'M%sZ' % 'L'.join('%s %s' % (fi(px), fi(py)) for px, py in b.exterior.coords)
    sx = -k if flip else k
    tr = 'translate(%s %s) rotate(%s) scale(%s %s) translate(%s %s)' % (fi(x), fi(y), fi(rot), '%.4g' % sx, '%.4g' % k, fi(-cx), fi(-cy))
    inner = b.buffer(-0.6 / k)
    o = ['<g transform="%s"%s%s>' % (tr, ' style="mix-blend-mode:multiply"' if blend else '',
                                     ' filter="url(#lift)"' if shadow else ''),
         '<clipPath id="%s"><path d="%s"/></clipPath>' % (cid, outline),
         '<path d="%s" fill="%s" fill-opacity="%g"/>' % (outline, tint, tint_alpha),
         '<g clip-path="url(#%s)">' % cid,
         '<path d="%s" fill="none" stroke="%s" stroke-width="0.4" stroke-opacity="0.55" vector-effect="non-scaling-stroke"/>' % (lace(inner, fine_px / k, rnd, 1), ink),
         '<path d="%s" fill="none" stroke="%s" stroke-width="0.75" stroke-opacity="0.8" vector-effect="non-scaling-stroke"/>' % (lace(inner, coarse_px / k, rnd, 2), ink)]
    for d in vein_paths(idx, leaf, k, size):
        if d:
            o.append('<path d="%s" fill="%s"/>' % (d, ink))
    o += ['</g>',
          '<path d="%s" fill="none" stroke="%s" stroke-width="1" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>' % (outline, ink),
          stem_path(leaf['stem'], k, size, ink),
          '</g>']
    return ''.join(o)


# ---- a connected vein network, grown inside the traced outline -------------------------
#
# The clip-art's own veins are separate strokes floating in the blade; a skeleton leaf is
# nothing but its veins, so those cannot be used. Instead: a midrib that runs from the
# stem along the leaf's own centreline to its tip, and secondaries that start ON the
# midrib and run out toward the margin, bending toward the tip as they go. A palmate leaf
# (the maples) has a primary from the stem to each lobe tip, each with its own
# secondaries. Every vein is a filled shape that narrows along its length: widest where it
# leaves its parent, finest at the margin.

PALMATE = {1, 3, 12, 13}
BASE_AT_NARROW_END = {2}
# Leaves broad for their length (the hearts and the round ovate): their veins spread wide.
BROAD = {0, 5, 9, 10}


def unit(v):
    n = math.hypot(*v) or 1.0
    return (v[0] / n, v[1] / n)


def base_and_tips(i, leaf):
    b = leaf['blade']
    ring = list(b.exterior.coords)[:-1]
    if leaf['stem']:
        line, _ = leaf['stem']
        e = min((line[0], line[-1]), key=lambda p: b.exterior.distance(Point(p)))
        q = b.exterior.interpolate(b.exterior.project(Point(e)))
        c = b.centroid
        base = (q.x + (c.x - q.x) * 0.02, q.y + (c.y - q.y) * 0.02)
    else:
        # No stem: the leaf's long axis is the farthest pair of outline points, and of its
        # two ends the base is the blunter one (wider a little way in).
        pts = np.array(ring[::max(1, len(ring) // 300)])
        d = ((pts[:, None, :] - pts[None, :, :]) ** 2).sum(-1)
        a, c = np.unravel_index(d.argmax(), d.shape)
        A, C = tuple(pts[a]), tuple(pts[c])
        def width_near(P, Q):
            M = (P[0] + (Q[0] - P[0]) * 0.12, P[1] + (Q[1] - P[1]) * 0.12)
            ax = unit((Q[0] - P[0], Q[1] - P[1]))
            n = (-ax[1], ax[0])
            cut = LineString([(M[0] - n[0] * 9999, M[1] - n[1] * 9999), (M[0] + n[0] * 9999, M[1] + n[1] * 9999)]).intersection(b)
            return cut.length
        base = A if width_near(A, C) > width_near(C, A) else C
        # Leaf 2 draws its petiole as part of the blade, a narrow tail that the "blunter
        # end" rule reads as the tip. Its base is the other end.
        if i in BASE_AT_NARROW_END:
            base = C if base is A else A
    radial = [math.hypot(x - base[0], y - base[1]) for x, y in ring]
    if i not in PALMATE:
        j = int(np.argmax(radial))
        return base, [ring[j]]
    # Lobe tips: outline points farther from the base than their neighbours, the far ones
    # only, taken farthest first and kept at least 28 degrees apart.
    n = len(ring)
    w = max(3, n // 60)
    peaks = [j for j in range(n) if radial[j] == max(radial[(j + o) % n] for o in range(-w, w + 1)) and radial[j] > 0.55 * max(radial)]
    peaks.sort(key=lambda j: -radial[j])
    tips = []
    for j in peaks:
        ang = math.atan2(ring[j][0] - base[0], -(ring[j][1] - base[1]))
        apart = lambda t: abs((ang - math.atan2(t[0] - base[0], -(t[1] - base[1])) + math.pi) % (2 * math.pi) - math.pi)
        if all(apart(t) > math.radians(28) for t in tips):
            tips.append(ring[j])
        if len(tips) == 5:
            break
    return base, tips


def centre_path(b, base, tip, n=40):
    # The midrib follows the blade's own middle: at each step along the base-tip axis, the
    # middle of the blade's cross-section there, smoothed.
    ax = unit((tip[0] - base[0], tip[1] - base[1]))
    nrm = (-ax[1], ax[0])
    L = math.hypot(tip[0] - base[0], tip[1] - base[1])
    pts = [base]
    for s in np.linspace(0.06, 0.94, n):
        Q = (base[0] + ax[0] * L * s, base[1] + ax[1] * L * s)
        cut = LineString([(Q[0] - nrm[0] * L, Q[1] - nrm[1] * L), (Q[0] + nrm[0] * L, Q[1] + nrm[1] * L)]).intersection(b)
        segs = list(cut.geoms) if hasattr(cut, 'geoms') else [cut]
        segs = [g for g in segs if g.geom_type == 'LineString' and g.length > 0]
        if not segs:
            continue
        g = min(segs, key=lambda g: g.distance(Point(Q)))
        m = g.interpolate(0.5, normalized=True)
        pts.append((m.x, m.y))
    pts.append(tip)
    sm = [pts[0]]
    for k in range(1, len(pts) - 1):
        sm.append(tuple(np.mean(pts[max(0, k - 2):k + 3], axis=0)))
    sm.append(pts[-1])
    return sm


def tapered(pts, w0, w1):
    # A vein as a filled outline: offset each side by half the width there, which falls
    # linearly from w0 at the first point to w1 at the last; round at the start.
    if len(pts) < 2:
        return ''
    lens = [0.0]
    for a, b in zip(pts, pts[1:]):
        lens.append(lens[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    total = lens[-1] or 1.0
    left, right = [], []
    for k, p in enumerate(pts):
        a = pts[max(0, k - 1)]
        c = pts[min(len(pts) - 1, k + 1)]
        t = unit((c[0] - a[0], c[1] - a[1]))
        n = (-t[1], t[0])
        w = (w0 + (w1 - w0) * lens[k] / total) / 2
        left.append((p[0] + n[0] * w, p[1] + n[1] * w))
        right.append((p[0] - n[0] * w, p[1] - n[1] * w))
    ring = left + right[::-1]
    return 'M%sZ' % 'L'.join('%s %s' % (fi(x), fi(y)) for x, y in ring)


def along(path, f):
    ls = LineString(path)
    p = ls.interpolate(f, normalized=True)
    q = ls.interpolate(min(1, f + 0.01), normalized=True)
    r = ls.interpolate(max(0, f - 0.01), normalized=True)
    return (p.x, p.y), unit((q.x - r.x, q.y - r.y))


def secondary(b, inner, P, t, side, angle, step, max_len, bend=0.035):
    a = math.radians(angle) * side
    d = (t[0] * math.cos(a) - t[1] * math.sin(a), t[0] * math.sin(a) + t[1] * math.cos(a))
    pts = [P]
    length = 0.0
    while length < max_len:
        # bend gently toward the tip as it goes, as a secondary does
        d = unit((d[0] + bend * t[0], d[1] + bend * t[1]))
        nxt = (pts[-1][0] + d[0] * step, pts[-1][1] + d[1] * step)
        if not inner.contains(Point(nxt)):
            break
        pts.append(nxt)
        length += step
    return pts


def vein_paths(i, leaf, k, size):
    b = leaf['blade']
    base, tips = base_and_tips(i, leaf)
    px = 1.0 / k                                  # one screen pixel, in source units
    grow = (size / 200.0) ** 0.5
    inner = b.buffer(-3.5 * px)
    out = []
    primaries = []
    if i in PALMATE:
        far = max(tips, key=lambda p: math.hypot(p[0] - base[0], p[1] - base[1]))
        for tip in tips:
            end = (base[0] + (tip[0] - base[0]) * 0.96, base[1] + (tip[1] - base[1]) * 0.96)
            mid = ((base[0] + end[0]) / 2, (base[1] + end[1]) / 2)
            path = [base, mid, end]
            path = [tuple(p) for p in np.array(LineString(path).segmentize(4 * px).coords)]
            main = tip == far
            primaries.append((path, (2.6 if main else 2.1) * grow * px))
    else:
        path = centre_path(b, base, tips[0])
        primaries.append((path, 2.8 * grow * px))
    for path, w0 in primaries:
        out.append(tapered(path, w0, 0.35 * px))
        L = LineString(path).length
        if i in PALMATE:
            # A maple's primary carries only a few secondaries, each short enough to stay
            # in its own lobe; more read as hatching.
            count = 4 if w0 > 2.3 * grow * px else 3
        else:
            count = max(3, min(12, int(L * 0.86 / (20 * px))))
        for c in range(count):
            f = (0.3 + 0.55 * (c + 0.5) / count) if i in PALMATE else 0.06 + 0.8 * (c + 0.5) / count
            P, t = along(path, f)
            # Broad leaves (the hearts) spread their veins wide and curve them only a
            # little; narrow ones run them at a shallower angle with more curve.
            broad = i in BROAD
            if i in PALMATE:
                angle = 52
            elif broad:
                angle = (100 if f < 0.12 else 72) - 30 * f
            else:
                angle = (95 if f < 0.1 else 66) - 26 * f
            for side in (1, -1):
                pts = secondary(b, inner, P, t, side, angle, 2 * px, L * (0.38 if i in PALMATE else 0.8),
                                bend=0.012 if (i in PALMATE or broad) else 0.03)
                if len(pts) < 4:
                    continue
                wl = w0 + (0.35 * px - w0) * f
                out.append(tapered(pts, wl * 0.6, 0.3 * px))
    return out
