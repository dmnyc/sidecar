"""Parametric leaf outlines, built the way a real leaf is shaped.

A broad-leaved dicot silhouette is remarkably lawful, and this module follows the law
instead of tracing someone else's drawing:

  axis        base (the petiole's attachment) to tip, straight, length L.
  width       a smooth unimodal profile along the axis, widest at `peak` (25-45% of the
              way up for ovate leaves, halfway for elliptic ones), drawn from the beta
              form t^a (1-t)^b: a small exponent a flares the base out, a small b
              draws the tip out long and concave.
  base        rounded for the lanceolate forms; cordate for the hearts - the two sides
              leave the sinus nearly horizontally and dip below it as lobes around the
              petiole.
  tip         acuminate: the profile's small-b tail, stretched a little further for a
              drip tip.
  margin      entire, or serrated: regular teeth, graded to the local blade width,
              each leaning toward the tip - steep on the tipward side, long on the
              baseward side, the way real teeth are cut.
  asymmetry   a few percent of low-frequency difference between the sides, so no leaf
              is a mirror image of itself.

Each leaf is returned in the shape the rest of the pipeline already eats:
{'blade': shapely Polygon, 'stem': (centreline points, width)} - tip pointing up (+y),
base at the origin.
"""
import math
import random
import numpy as np
from shapely.geometry import Polygon


def _profile(t, peak, baseflare, tipfall, tiphook, notch):
    # Two arcs, the way botany draws an ovate side: convex from base to the widest
    # point, concave from there into an acuminate point. baseflare sets how wide the
    # belly sits at its fullest near the base; notch drops the two sides steeply into
    # the petiole's sinus right at the start - without it the base closes as a flat
    # shelf, which no leaf has.
    t = np.asarray(t, dtype=float)
    w = np.empty_like(t)
    lo = t <= peak
    tb = t[lo] / peak
    w[lo] = np.sqrt(baseflare + (1.0 - baseflare) * (1.0 - (1.0 - tb) ** 2))
    w[lo] *= notch + (1.0 - notch) * np.minimum(1.0, tb / 0.16)
    u = (t[~lo] - peak) / (1.0 - peak)
    w[~lo] = (1.0 - u ** tiphook) ** tipfall
    return w / w.max()


def leaf(ratio, peak, baseflare=0.3, tipfall=1.0, tiphook=2.0, cordate=0.0, drip=0.0,
         serrate=0.0, asym=0.05, notch=0.3, seed=1, L=100.0, n=300):
    """Build one leaf. ratio L/W, widest at `peak` of the axis, convex base arc flared
    by baseflare, concave tip arc ending in a point (tipfall, tiphook), cordate lobes,
    drip tip, serrated margin, asymmetry. Returns the pipeline dict."""
    rnd = random.Random(seed)
    t = np.linspace(0.0, 1.0, n)
    w = _profile(t, peak, baseflare, tipfall, tiphook, notch)

    y = L * t
    # cordate: the sides dip below the sinus as lobes around the petiole - broad ones,
    # reaching halfway out the blade, not a narrow collar at the attachment
    if cordate > 0:
        sig = 0.10 + 0.02 * rnd.random()
        y = y - cordate * L * 0.095 * np.exp(-(t / sig) ** 2)
    # drip tip: the last stretch of the axis is drawn out, so the small-b taper ends
    # in a thin curved point
    if drip > 0:
        y = y + drip * L * 0.055 * np.clip((t - 0.82) / 0.18, 0.0, 1.0) ** 1.6

    halfw = 0.5 * L / ratio
    # each side gets its own low-frequency breathing on the profile, and its own
    # widest point, a couple of percent apart
    phL, phR = rnd.uniform(0, 2 * math.pi), rnd.uniform(0, 2 * math.pi)
    fL, fR = rnd.uniform(1.1, 1.7), rnd.uniform(1.1, 1.7)
    eL = 1.0 + asym * np.sin(2 * math.pi * fL * t + phL) * np.exp(-((t - 0.05) / 0.5) ** 2 * 0.3)
    eR = 1.0 + asym * np.sin(2 * math.pi * fR * t + phR) * np.exp(-((t - 0.05) / 0.5) ** 2 * 0.3)
    xR = halfw * w * eR
    xL = -halfw * w * eL

    # right side base->tip, left side tip->base, one closed ring
    ring = [(float(xR[i]), float(y[i])) for i in range(n)]
    ring += [(float(xL[i]), float(y[i])) for i in range(n - 2, 0, -1)]

    widths = np.concatenate([w, w[n - 2:0:-1]])
    if serrate > 0:
        ring = _teeth(ring, widths, w.max(), L, serrate, rnd)
    poly = Polygon(ring).buffer(0)
    if hasattr(poly, 'geoms'):
        poly = max(poly.geoms, key=lambda g: g.area)
    poly = poly.simplify(0.12)

    # the petiole: a gently curved stalk down from the sinus
    bend = rnd.uniform(-0.35, 0.35)
    plen = L * rnd.uniform(0.10, 0.13)
    stem = ([(0.0, 0.0),
             (bend * plen * 0.35, -plen * 0.45),
             (bend * plen, -plen)], 0.0)
    return {'blade': poly, 'stem': stem}


def _teeth(ring, widths, wmax, L, serrate, rnd, e1=0.7, e2=0.12):
    """Serrate a closed margin. Teeth are graded to the local blade width, spaced
    evenly in arc length, and each leans tipward: a long baseward slope and a sharp
    drop - the profile peaks late, so the tooth reads as cut, not as a wobble."""
    P = np.array(ring)
    d = np.hypot(*(P[1:] - P[:-1]).T)
    s = np.concatenate([[0.0], np.cumsum(d)])
    total = s[-1]
    # margin direction flips halfway (up the right side, down the left); the tooth's
    # lean has to flip with it, or the left side's teeth point baseward
    half = 0.5 * total
    S = L / rnd.uniform(17.0, 20.0)
    g = np.linspace(0.0, 1.0, 1001)
    norm = ((g ** e1) * ((1.0 - g) ** e2)).max()
    P = np.array(ring)
    # which way is out: on a clockwise ring the outside is to the left of travel, on a
    # counterclockwise one to the right (n = (-ty, tx) is the left of travel)
    a2 = float((P[:-1, 0] * P[1:, 1] - P[1:, 0] * P[:-1, 1]).sum())
    flip = 1.0 if a2 < 0 else -1.0
    out = []
    n = len(P)
    for i in range(n):
        a, c = P[max(0, i - 1)], P[min(n - 1, i + 1)]
        tx, ty = c[0] - a[0], c[1] - a[1]
        tl = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / tl * flip, tx / tl * flip
        cx, cy = P[i]
        # grade the tooth by the local blade width
        grade = (widths[i] / wmax) ** 0.6
        frac = ((s[i] / S) % 1.0)
        gg = frac if s[i] < half else 1.0 - frac
        h = serrate * L * 0.022 * grade
        amp = h * (gg ** e1) * ((1.0 - gg) ** e2) / norm
        out.append((cx + nx * amp, cy + ny * amp))
    return out


def palmate(lobes=5, R=100.0, sinus=0.32, serrate=1.4, asym=0.05, seed=1, m=48):
    """A maple: lobe tips fan out from the base, and between them the margin dips into
    rounded sinuses. Each lobe carries its own radius (the central one longest, the
    outer shortest) and every control point is jittered a few percent, so the leaf is
    not a star symmetry. Returns the pipeline dict, tip up, base at the origin."""
    rnd = random.Random(seed)
    spread = 138 + rnd.uniform(-7, 7)
    ang = [-spread, -spread * 0.5, 0.0, spread * 0.5, spread][:lobes] if lobes == 5 else [0.0]
    rl = [(1.0 - 0.24 * (a / spread) ** 2) * R for a in ang]
    rl = [r * rnd.uniform(0.95, 1.05) for r in rl]
    ang = [a + rnd.uniform(-3, 3) for a in ang]
    rs = [sinus * R * rnd.uniform(0.92, 1.08) for _ in ang[:-1]]
    rb = R * rnd.uniform(0.12, 0.17)
    # controls from the base bottom (-180) up the right side and back down to (+180)
    seq = [(-180.0, rb)]
    for k, a in enumerate(ang):
        if k:
            seq.append(((ang[k - 1] + a) / 2.0, rs[k - 1]))
        seq.append((a, rl[k]))
    seq.append((180.0, rb))
    ring = []
    for (a0, r0), (a1, r1) in zip(seq, seq[1:]):
        to_lobe = r1 > r0
        for i in range(1, m + 1):
            u = i / float(m)
            th = math.radians(a0 + (a1 - a0) * u)
            w = (1.0 + math.cos(math.pi * u)) / 2.0
            if to_lobe:
                r = r0 + (r1 - r0) * (1.0 - w ** 0.75)
            else:
                r = r1 + (r0 - r1) * w ** 0.8
            ring.append((r * math.sin(th), r * math.cos(th) + rb))
    ring = _teeth(ring, [math.hypot(px, py - 0.0) for px, py in ring], R, R, serrate, rnd, e2=0.09)
    poly = Polygon(ring).buffer(0)
    if hasattr(poly, 'geoms'):
        poly = max(poly.geoms, key=lambda g: g.area)
    poly = poly.simplify(0.12)
    bend = rnd.uniform(-0.35, 0.35)
    plen = R * rnd.uniform(0.16, 0.20)
    stem = ([(0.0, 0.0),
             (bend * plen * 0.35, -plen * 0.45),
             (bend * plen, -plen)], 0.0)
    return {'blade': poly, 'stem': stem}
