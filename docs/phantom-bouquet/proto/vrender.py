"""Draw a grown venation (venation.py) as a skeleton leaf, in the leaf's own pixel space."""
import math
import random
import numpy as np
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union

import traced as T
import venation as V
import skeleton as SK
from vtest import leaf_px

fi = lambda v: ('%.1f' % v).rstrip('0').rstrip('.')


def pstr(pts):
    return 'L'.join('%s %s' % (fi(x), fi(y)) for x, y in pts)


def tapered_var(pts, ws):
    """A filled stroke whose width follows ws point by point, round at both ends."""
    if len(pts) < 2:
        return ''
    left, right = [], []
    for k, p in enumerate(pts):
        a = pts[max(0, k - 1)]
        c = pts[min(len(pts) - 1, k + 1)]
        t = T.unit((c[0] - a[0], c[1] - a[1]))
        n = (-t[1], t[0])
        h = ws[k] / 2
        left.append((p[0] + n[0] * h, p[1] + n[1] * h))
        right.append((p[0] - n[0] * h, p[1] - n[1] * h))
    return 'M%sZ' % pstr(left + right[::-1])


def smooth(pts, passes=2):
    for _ in range(passes):
        if len(pts) < 3:
            return pts
        pts = [pts[0]] + [((a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4)
                          for a, b, c in zip(pts, pts[1:], pts[2:])] + [pts[-1]]
    return pts


def build(i, size, seed):
    rnd = random.Random(seed)
    blade, base, tips, stem, k = leaf_px(i, size)
    tree = V.Tree()
    root = tree.add(base, -1)
    if i in T.PALMATE:
        far = max(tips, key=lambda t: math.hypot(t[0] - base[0], t[1] - base[1]))
        for t in tips:
            end = (base[0] + (t[0] - base[0]) * 0.95, base[1] + (t[1] - base[1]) * 0.95)
            mid = ((base[0] + end[0]) / 2 + rnd.uniform(-2, 2), (base[1] + end[1]) / 2 + rnd.uniform(-2, 2))
            V.seed_path(tree, [base, mid, end], root, 3)
    else:
        mid = T.centre_path(blade, base, tips[0])
        end = (mid[-2][0] + (mid[-1][0] - mid[-2][0]) * 0.6, mid[-2][1] + (mid[-1][1] - mid[-2][1]) * 0.6)
        V.seed_path(tree, mid[:-1] + [end], root, 3)
    V.grow(blade.buffer(-1.2), tree, rnd, birth=8.5 if size < 400 else 10.0)
    return rnd, blade, base, tips, stem, tree


def leaf_svg(i, size, seed, ink, tint, tint_alpha, cid):
    rnd, blade, base, tips, stem, tree = build(i, size, seed)
    grow_k = (size / 200.0) ** 0.5
    raw, kids, flow = V.widths(tree, 1.0)
    # Scale so the stem end is as heavy as a 2.8px midrib on a 200px leaf, and the finest
    # vein 0.4px; in between the pipe model decides.
    wmax = raw[0]
    w = [0.4 + (2.8 * grow_k - 0.4) * ((x - 1.0) / (wmax - 1.0)) ** 1.15 if wmax > 1 else 0.4 for x in raw]
    strokes = []
    for chain in V.chains(tree, kids, flow):
        pts = [tree.pos[j] for j in chain]
        ws = [w[j] for j in chain]
        if chain[0] == 0:
            # THE STEM: drawn as the start of the midrib, one shape, so there is no join.
            if stem:
                s = stem if math.hypot(stem[0][0] - base[0], stem[0][1] - base[1]) > math.hypot(stem[-1][0] - base[0], stem[-1][1] - base[1]) else stem[::-1]
                s = list(s[:-1])
            else:
                d = T.unit((base[0] - pts[min(4, len(pts) - 1)][0], base[1] - pts[min(4, len(pts) - 1)][1]))
                s = [(base[0] + d[0] * size * 0.07, base[1] + d[1] * size * 0.07)]
            pts = s + pts
            ws = [w[0] * 1.08] * len(s) + ws
        if len(pts) >= 2:
            # the first point is the branch point on the parent; the rest smoothed
            pts = [pts[0]] + smooth(pts[1:], 2) if len(pts) > 3 else pts
            strokes.append((pts, ws))
    joins = V.loops(tree, kids, rnd, reach=9.0)
    out_tint = []
    vein_geom = unary_union([LineString(p).buffer(max(ws) / 2 + 0.3) for p, ws in strokes if len(p) > 1] +
                            [LineString([tree.pos[a], tree.pos[b]]).buffer(0.5) for a, b in joins])
    inner = blade.buffer(-1.5)
    spaces = inner.difference(vein_geom)
    lace = []
    for r in (spaces.geoms if hasattr(spaces, 'geoms') else [spaces]):
        if r.geom_type == 'Polygon' and r.area > 16:
            lace += SK.areoles(r, 6.0, rnd)
    outline = 'M%sZ' % pstr(blade.exterior.coords)
    o = ['<clipPath id="%s"><path d="%s"/></clipPath>' % (cid, outline),
         '<path d="%s" fill="%s" fill-opacity="%g"/>' % (outline, tint, tint_alpha),
         '<g clip-path="url(#%s)">' % cid]
    halo = vein_geom.buffer(2.0)
    hp = [halo] if halo.geom_type == 'Polygon' else list(halo.geoms)
    o.append('<path d="%s" fill="%s" fill-opacity="%g" fill-rule="evenodd"/>' % (
        ''.join('M%sZ' % pstr(g.exterior.coords) + ''.join('M%sZ' % pstr(h.coords) for h in g.interiors) for g in hp if g.geom_type == 'Polygon'),
        tint, tint_alpha * 0.8))
    o.append('<path d="%s" fill="none" stroke="%s" stroke-width="0.35" stroke-opacity="0.7"/>' % (''.join(lace), ink))
    o.append('<path d="%s" fill="none" stroke="%s" stroke-width="0.45" stroke-linecap="round"/>' % (
        ''.join('M%sL%s' % (pstr([tree.pos[a]]), pstr([tree.pos[b]])) for a, b in joins), ink))
    o.append('</g>')
    # veins: one path; the stem is part of the first stroke and lies partly outside the clip
    o.append('<path d="%s" fill="%s"/>' % (''.join(tapered_var(p, ws) for p, ws in strokes), ink))
    o.append('<path d="%s" fill="none" stroke="%s" stroke-width="0.55" stroke-opacity="0.85"/>' % (outline, ink))
    return ''.join(o), blade, base, tips


CID = [0]


def render(i, x, y, size, tip_deg, ink, tint, tint_alpha, seed, flip=False, blend=True, shadow=False):
    CID[0] += 1
    body, blade, base, tips = leaf_svg(i, size, seed, ink, tint, tint_alpha, 'vl%d' % CID[0])
    far = max(tips, key=lambda t: math.hypot(t[0] - base[0], t[1] - base[1]))
    src = math.degrees(math.atan2(far[0] - base[0], -(far[1] - base[1])))
    if flip:
        src = -src
    c = blade.centroid
    tr = 'translate(%s %s) rotate(%s) scale(%s 1) translate(%s %s)' % (fi(x), fi(y), fi(tip_deg - src), '-1' if flip else '1', fi(-c.x), fi(-c.y))
    return '<g transform="%s"%s%s>%s</g>' % (tr, ' style="mix-blend-mode:multiply"' if blend else '',
                                            ' filter="url(#lift)"' if shadow else '', body)
