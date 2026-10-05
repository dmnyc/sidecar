"""Phantom Bouquet mock-up: skeleton leaves drawn procedurally.

Each leaf: an outline, a marginal vein, primary veins (a midrib, or palmate rays for the
maple), arching secondaries that loop near the margin, and two levels of areole mesh
(Voronoi cells clipped to the blade) for the lace. The membrane keeps a faint tint.
"""
import math, random, sys
import numpy as np
from scipy.spatial import Voronoi
from shapely.geometry import Polygon, LineString, Point, MultiLineString
from shapely import affinity

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'


def f(v):
    return '%d' % round(v)


def catmull(pts, n=12):
    out = []
    p = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in range(2)))
    out.append(pts[-1])
    return out


# Half-width profiles along the midrib, as fractions of the leaf's length. Base at t=0,
# tip at t=1; the leaf points up (negative y).
PROFILES = {
    # bodhi: a heart, broad at the base with a notch, and a long drip tip
    'bodhi': ([-0.07, -0.05, 0.0, 0.08, 0.2, 0.34, 0.48, 0.6, 0.72, 0.82, 0.9, 1.0],
              [0.1, 0.25, 0.39, 0.47, 0.5, 0.46, 0.37, 0.25, 0.13, 0.055, 0.022, 0.0], 0.0),
    # magnolia: a long ellipse, widest past the middle
    'magnolia': ([0, 0.06, 0.25, 0.5, 0.7, 0.88, 1.0],
                 [0.0, 0.07, 0.2, 0.27, 0.25, 0.13, 0.0], 0.0),
    # lanceolate, as in the dyed garland: long and narrow, pointed at both ends
    'lance': ([0, 0.08, 0.3, 0.5, 0.7, 0.9, 1.0],
              [0.0, 0.06, 0.15, 0.18, 0.15, 0.06, 0.0], 0.0),
}


def pinnate_outline(kind, L):
    ts, hs, notch = PROFILES[kind]
    right = catmull([(h * L, -t * L) for t, h in zip(ts, hs)], 10)
    left = [(-x, y) for x, y in reversed(right)]
    pts = right + left[1:]
    if ts[0] < 0:
        # the cordate base: both lobes come round below the petiole to a notch
        pts = [(0, 0)] + pts + [(0, 0)]
    return Polygon(pts).buffer(0)


def maple_outline(R, rnd):
    # Five pointed lobes (top, two upper, two lower) and the deep sinuses between them,
    # interpolated linearly in angle so the tips stay sharp; teeth along every edge.
    # Angles from straight up, clockwise, in degrees.
    ctrl = [(0, 1.0), (24, 0.5), (52, 0.92), (82, 0.48), (112, 0.72), (150, 0.4), (180, 0.16)]
    full = ctrl + [(360 - a, r) for a, r in reversed(ctrl[:-1])]
    pts = []
    n = 540
    for i in range(n):
        a = i * 360 / n
        for (a0, r0), (a1, r1) in zip(full, full[1:]):
            if a0 <= a <= a1:
                r = r0 + (r1 - r0) * (a - a0) / (a1 - a0)
                break
        r *= 1 + 0.05 * abs(math.sin(math.radians(a) * 26))  # teeth
        th = math.radians(a - 90)
        pts.append((R * r * math.cos(th), R * r * math.sin(th) + R * 0.12))
    return Polygon(pts).buffer(0)


def voronoi_edges(poly, n, rnd, relax=2):
    minx, miny, maxx, maxy = poly.bounds
    pts = []
    while len(pts) < n:
        p = (rnd.uniform(minx, maxx), rnd.uniform(miny, maxy))
        if poly.contains(Point(p)):
            pts.append(p)
    pts = np.array(pts)
    for _ in range(relax):  # Lloyd relaxation, so the cells are even, like areoles
        vor = Voronoi(np.vstack([pts, [[minx - 999, miny - 999], [maxx + 999, miny - 999], [minx - 999, maxy + 999], [maxx + 999, maxy + 999]]]))
        new = []
        for i, p in enumerate(pts):
            reg = vor.regions[vor.point_region[i]]
            if -1 in reg or not reg:
                new.append(p)
                continue
            cell = Polygon(vor.vertices[reg]).intersection(poly)
            new.append(np.array(cell.centroid.coords[0]) if not cell.is_empty else p)
        pts = np.array(new)
    vor = Voronoi(np.vstack([pts, [[minx - 999, miny - 999], [maxx + 999, miny - 999], [minx - 999, maxy + 999], [maxx + 999, maxy + 999]]]))
    lines = []
    for (a, b) in vor.ridge_vertices:
        if a < 0 or b < 0:
            continue
        seg = LineString([vor.vertices[a], vor.vertices[b]]).intersection(poly)
        if seg.is_empty:
            continue
        geoms = seg.geoms if hasattr(seg, 'geoms') else [seg]
        for g in geoms:
            if g.geom_type == 'LineString' and g.length > 0.3:
                # a vein is never ruler-straight: bow it a little
                (x0, y0), (x1, y1) = g.coords[0], g.coords[-1]
                mx, my = (x0 + x1) / 2, (y0 + y1) / 2
                dx, dy = x1 - x0, y1 - y0
                k = rnd.uniform(-0.18, 0.18)
                lines.append((x0, y0, mx - dy * k, my + dx * k, x1, y1))
    return lines


def path_q(lines):
    return ''.join('M%s %sQ%s %s %s %s' % tuple(f(v) for v in l) for l in lines)


def leaf(kind, size, seed, ink, tint, tint_alpha=0.16, mesh=(55, 420)):
    """Return (svg group string, polygon) for a leaf at the origin, pointing up."""
    rnd = random.Random(seed)
    # Vein widths, in px at a 200px leaf, grow with the square root of the leaf's size:
    # a leaf three times as big gets veins under twice as heavy, as a real big leaf does.
    # The lace (the two meshes) does not grow at all: its cells are a fixed size on
    # screen, so its lines are too.
    sw = lambda w: w * (size / 200.0) ** 0.5
    if kind == 'maple':
        poly = maple_outline(size / 2, rnd)
    else:
        poly = pinnate_outline(kind, size)
    o = []
    o.append('<path d="M%sZ" fill="%s" fill-opacity="%s"/>' % (
        'L'.join('%s %s' % (f(x), f(y)) for x, y in poly.exterior.coords), tint, '%g' % tint_alpha))
    # EVERY VEIN STAYS INSIDE THE BLADE: the veins are drawn clipped to the leaf's own
    # outline, so a secondary's curve, an arch's bulge or a round cap at the tip can never
    # poke past the edge. Only the margin (which IS the edge) and the stem are drawn
    # outside the clip, in m.
    global CLIP_N
    CLIP_N += 1
    cid = 'leaf%d' % CLIP_N
    outline = 'M%sZ' % 'L'.join('%s %s' % (f(x), f(y)) for x, y in poly.exterior.coords)
    o.append('<clipPath id="%s"><path d="%s"/></clipPath>' % (cid, outline))
    g = ['<g fill="none" stroke="%s" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#%s)">' % (ink, cid)]
    m = ['<g fill="none" stroke="%s" stroke-linecap="round" stroke-linejoin="round">' % ink]
    # areoles: two levels, coarse then fine
    inner = poly.buffer(-size * 0.006)
    g.append('<path d="%s" stroke-width="%s" stroke-opacity="0.55"/>' % (path_q(voronoi_edges(inner, mesh[1], rnd, 1)), 0.4))
    g.append('<path d="%s" stroke-width="%s" stroke-opacity="0.8"/>' % (path_q(voronoi_edges(inner, mesh[0], rnd, 2)), 0.75))
    # marginal vein
    m.append('<path d="%s" stroke-width="%s"/>' % (outline, '%.2g' % sw(0.9)))
    if kind == 'maple':
        R = size / 2
        for k, a in enumerate([-90, -90 - 52, -90 + 52, -90 - 112, -90 + 112]):
            th = math.radians(a)
            rr = [1.0, 0.92, 0.92, 0.72, 0.72][k] * 0.93
            ex, ey = rr * R * math.cos(th), rr * R * math.sin(th) + R * 0.12
            g.append('<path d="M0 %sQ%s %s %s %s" stroke-width="%s"/>' % (f(R * 0.12), f(ex * 0.5), f(ey * 0.5 + R * 0.06), f(ex), f(ey), '%.2g' % sw(2.2 if k == 0 else 1.8)))
        # the stem, from the heart of the leaf out through the sinus
        m.append('<path d="M0 %sL0 %s" stroke-width="%s"/>' % (f(R * 0.12), f(R * 0.62), '%.2g' % sw(2.0)))
    else:
        L = size
        tip = PROFILES[kind][0][-1]
        # midrib, tapering: drawn as three strokes of falling width
        # the stem, short, below the blade
        m.append('<path d="M0 %sL0 %s" stroke-width="%s"/>' % (f(0.08 * L), f(-0.02 * L), '%.2g' % sw(2.4)))
        for (t0, t1, w) in [(-0.02, 0.35, 0.013), (0.35, 0.7, 0.009), (0.7, 1.0, 0.005)]:
            g.append('<path d="M0 %sL0 %s" stroke-width="%s"/>' % (f(-t0 * L), f(-t1 * L), '%.2g' % sw(w * 200)))
        # secondaries: up and out at ~55 degrees, curving toward the tip, each ending
        # inside the margin and joined to the next by an arch (the looping margin of a
        # bodhi or magnolia leaf)
        ts, hs, _ = PROFILES[kind]
        def half(t):
            return float(np.interp(t, ts, hs)) * L
        n = 7 if kind == 'bodhi' else 9
        ends = []
        for i in range(n):
            t = 0.08 + i * (0.78 / n) + rnd.uniform(-0.015, 0.015)
            for side in (1, -1):
                y0 = -t * L
                ex = side * half(t + 0.08) * 0.82
                ey = -(t + 0.1 + 0.05 * (1 - t)) * L
                g.append('<path d="M0 %sQ%s %s %s %s" stroke-width="%s"/>' % (f(y0), f(ex * 0.55), f(y0 - L * 0.05), f(ex), f(ey), '%.2g' % sw(1.1)))
                ends.append((side, i, ex, ey))
        for side in (1, -1):
            pts = [(ex, ey) for s, i, ex, ey in ends if s == side]
            for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                g.append('<path d="M%s %sQ%s %s %s %s" stroke-width="%s"/>' % (f(x0), f(y0), f(x1 * 1.12), f((y0 + y1) / 2), f(x1), f(y1), '%.2g' % sw(0.7)))
    g.append('</g>')
    m.append('</g>')
    return ''.join(o + g + m), poly


def place(body, x, y, rot, scale=1.0, blend=True, shadow=False):
    style = ' style="mix-blend-mode:multiply"' if blend else ''
    flt = ' filter="url(#lift)"' if shadow else ''
    return '<g transform="translate(%s %s) rotate(%s) scale(%s)"%s%s>%s</g>' % (f(x), f(y), f(rot), f(scale), style, flt, body)


LINEN = '#ECE5D6'
CLIP_N = 0
DEFS = ('<defs>'
        '<filter id="lift" x="-10%%" y="-10%%" width="120%%" height="120%%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.2" flood-color="#6B5A3E" flood-opacity="0.28"/></filter>'
        '<pattern id="weave" width="6" height="6" patternUnits="userSpaceOnUse">'
        '<rect width="6" height="6" fill="%s"/>'
        '<path d="M0 1.5H6M0 4.5H6" stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="0.8"/>'
        '<path d="M1.5 0V6M4.5 0V6" stroke="#8A7A5C" stroke-opacity="0.06" stroke-width="0.8"/>'
        '</pattern></defs>' % LINEN)

# Ivory for the bleached skeletons, and the autumn tints.
IVORY = ('#FBF7EC', '#FFFDF6')
TINTS = {
    'madder': ('#A3443A', '#C2584B'),
    'ochre': ('#B7832A', '#D4A043'),
    'rust': ('#9E4F27', '#C0693A'),
    'olive': ('#66733A', '#8A9852'),
    'plum': ('#6B3B5A', '#8E5379'),
}


def svg(w, h, body):
    return '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">%s</svg>\n' % (w, h, w, h, body)


def specimen():
    W, H = 900, 640
    o = [DEFS, '<rect width="%d" height="%d" fill="url(#weave)"/>' % (W, H)]
    b, _ = leaf('bodhi', 300, 1, *IVORY, tint_alpha=0.35)
    o.append(place(b, 160, 470, -12, blend=False, shadow=True))
    m, _ = leaf('magnolia', 330, 2, *TINTS['madder'])
    o.append(place(m, 360, 520, 14))
    l, _ = leaf('lance', 320, 3, *TINTS['ochre'])
    o.append(place(l, 470, 540, 28))
    p, _ = leaf('maple', 260, 4, *TINTS['rust'])
    o.append(place(p, 720, 300, 8))
    q, _ = leaf('bodhi', 220, 5, *TINTS['plum'])
    o.append(place(q, 640, 600, -30))
    r, _ = leaf('lance', 260, 6, *TINTS['olive'])
    o.append(place(r, 560, 560, 50))
    return svg(W, H, ''.join(o))


def closeup():
    W, H = 600, 600
    o = [DEFS, '<rect width="%d" height="%d" fill="url(#weave)"/>' % (W, H)]
    b, _ = leaf('bodhi', 640, 11, *IVORY, tint_alpha=0.35, mesh=(110, 900))
    o.append(place(b, 300, 610, 0, blend=False, shadow=True))
    return svg(W, H, ''.join(o))


def mesh_for(kind, size, coarse=30.0, fine=15.0):
    # Cell counts from the blade's area, so a cell is about the same size on screen
    # whatever the leaf's size: a big leaf gets more lace, not bigger lace.
    area = {'bodhi': 0.62, 'magnolia': 0.36, 'lance': 0.24, 'maple': 0.42}[kind] * size * size
    return (max(8, int(area / coarse ** 2)), max(30, int(area / fine ** 2)))


import leaves as LV


def compose(W, H, leaves):
    o = [DEFS, '<rect width="%d" height="%d" fill="url(#weave)"/>' % (W, H)]
    for kind, size, seed, col, x, y, rot in leaves:
        ink, tint = IVORY if col is None else TINTS[col]
        body, _ = LV.leaf(kind, size, seed, ink, tint, 0.35 if col is None else 0.16)
        o.append(place(body, x, y, rot, blend=col is not None, shadow=col is None))
    return svg(W, H, ''.join(o))


def panel():
    # Two large ivory skeletons fill the field behind the content; they are as pale as
    # the cards, so they read as texture where they show between them and cost the text
    # nothing. The tinted leaves are bigger and cropped by the panel's edges, which is
    # what makes them read as near and large rather than as stickers.
    return compose(360, 760, [
        ('bodhi', 560, 31, None, 150, 840, 16),
        ('magnolia', 420, 32, None, 330, 470, -24),
        # The spray fans out from one point off the right edge, beside the heading: each
        # leaf turned about 30 degrees from the next, so they overlap only near their
        # stems and every blade shows nearly whole.
        # One tinted leaf beside the heading: the row between the tab bar (y 88) and the
        # first card (y 148) is 60px, room for one blade shown whole, not two.
        ('lance', 160, 22, 'madder', 378, 132, -82),
        # The foot fans out from the bottom left: the maple by its centre, up and left,
        # then each blade turned well off the last so they overlap only near the stems.
        ('maple', 160, 25, 'rust', 44, 740, -14),
        ('lance', 165, 23, 'ochre', 78, 815, 16),
        ('bodhi', 190, 26, 'olive', 122, 830, 62),
        ('lance', 190, 27, 'plum', 200, 836, 88),
    ])


for name, fn in [('specimen', specimen), ('closeup', closeup), ('panel', panel)]:
    s = fn()
    open('%s/%s.svg' % (OUT, name), 'w').write(s)
    print(name, len(s))
