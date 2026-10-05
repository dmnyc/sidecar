"""Leaf venation by space colonisation, after Runions et al., "Modeling and visualization of
leaf venation patterns" (SIGGRAPH 2005).

Veins are not placed; they grow. Points standing for the hormone sources a real leaf's
tissue releases are scattered over the blade, each vein tip grows toward the sources
nearest to it, and a source is used up once a vein reaches it. The leaf grows meanwhile:
the simulation runs in the leaf's final coordinates with every distance divided by the
current scale, so early on, when the leaf is small, there are few sources far apart and the
first veins become the long, thick ones; later, finer veins fill in between them. That
order is what produces the hierarchy of a real leaf without anyone drawing it.

The primary veins (a midrib, or a maple's veins to its lobe tips) are seeded, so the main
structure is botanically right; everything else grows from them. Afterwards:

  widths  the pipe model: a vein's cross-section is the sum of its branches' (w^n = sum
          w_i^n, n = 2.6), so every vein is thickest where it leaves the stem and thins
          toward the margin, and a branch can never be heavier than the vein it leaves.
  loops   most free vein ends are joined to the nearest vein of another branch, closing
          the network into loops as a real leaf's minor veins do.
  stem    drawn as the start of the midrib, one continuous shape: there is no join.

Everything here is in the leaf's own pixel space at its rendered size.
"""
import math
import random
import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import Point, Polygon, LineString
from shapely.prepared import prep


class Tree:
    def __init__(self):
        self.pos = []      # node positions
        self.parent = []   # parent index, -1 for the root

    def add(self, p, parent):
        self.pos.append((float(p[0]), float(p[1])))
        self.parent.append(parent)
        return len(self.pos) - 1


def seed_path(tree, pts, parent, step):
    """Add a polyline as a chain of nodes `step` apart, starting from node `parent`."""
    ls = LineString(pts)
    n = max(2, int(ls.length / step))
    last = parent
    for k in range(1, n + 1):
        q = ls.interpolate(k / n, normalized=True)
        last = tree.add((q.x, q.y), last)
    return last


def grow(blade, tree, rnd, D=1.6, kill=2.2, birth=9.0, s0=0.1, steps=46, sub=4, darts=260):
    poly = prep(blade)
    minx, miny, maxx, maxy = blade.bounds
    sources = []
    for st in range(steps):
        s = s0 * (1.0 / s0) ** (st / (steps - 1))   # exponential growth, s0 -> 1
        Dt, kt, bt = D / s, kill / s, birth / s
        # new sources by dart throwing: inside the blade, away from other sources and veins
        nodes = np.array(tree.pos)
        ntree = cKDTree(nodes)
        stree = cKDTree(np.array(sources)) if sources else None
        added = []
        for _ in range(darts):
            p = (rnd.uniform(minx, maxx), rnd.uniform(miny, maxy))
            if not poly.contains(Point(p)):
                continue
            if ntree.query(p)[0] < bt:
                continue
            if stree is not None and stree.query(p)[0] < bt:
                continue
            if any((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2 < bt * bt for a in added):
                continue
            added.append(p)
        sources += added
        for _ in range(sub):
            if not sources:
                break
            nodes = np.array(tree.pos)
            ntree = cKDTree(nodes)
            src = np.array(sources)
            _, nearest = ntree.query(src)
            pull = {}
            for si, ni in enumerate(nearest):
                v = src[si] - nodes[ni]
                n = np.hypot(*v)
                if n > 0:
                    pull.setdefault(ni, np.zeros(2))
                    pull[ni] += v / n
            for ni, v in pull.items():
                n = np.hypot(*v)
                if n < 1e-6:
                    continue
                q = nodes[ni] + v / n * Dt
                if poly.contains(Point(q)):
                    tree.add(q, ni)
            nodes = np.array(tree.pos)
            d, _ = cKDTree(nodes).query(src)
            sources = [tuple(p) for p, dd in zip(src, d) if dd > kt]
    return tree


def widths(tree, w_tip, n=2.6):
    N = len(tree.pos)
    kids = [[] for _ in range(N)]
    for i, p in enumerate(tree.parent):
        if p >= 0:
            kids[p].append(i)
    order = []
    stack = [0]
    while stack:
        i = stack.pop()
        order.append(i)
        stack.extend(kids[i])
    w = [0.0] * N
    flow = [0] * N
    for i in reversed(order):
        if not kids[i]:
            w[i] = w_tip ** n
            flow[i] = 1
        else:
            w[i] = sum(w[c] for c in kids[i])
            flow[i] = sum(flow[c] for c in kids[i])
    w = [x ** (1.0 / n) for x in w]
    return w, kids, flow


def chains(tree, kids, flow):
    """Split the tree into long strokes: from each node, follow its heaviest child."""
    out = []
    starts = [(0, None)]
    while starts:
        i, parent = starts.pop()
        chain = ([parent] if parent is not None else []) + [i]
        while kids[i]:
            ordered = sorted(kids[i], key=lambda c: -flow[c])
            for c in ordered[1:]:
                starts.append((c, i))
            i = ordered[0]
            chain.append(i)
        out.append(chain)
    return out


def loops(tree, kids, rnd, reach, prob=0.75):
    """Join free vein ends to the nearest vein of another branch, closing loops."""
    nodes = np.array(tree.pos)
    kd = cKDTree(nodes)
    depth_anc = {}
    joins = []
    for i in range(len(nodes)):
        if kids[i] or rnd.random() > prob:
            continue
        anc = set()
        a = i
        for _ in range(40):
            anc.add(a)
            a = tree.parent[a]
            if a < 0:
                break
        best = None
        for d, j in zip(*kd.query(nodes[i], k=12, distance_upper_bound=reach)):
            if not np.isfinite(d) or j in anc:
                continue
            best = j
            break
        if best is not None:
            joins.append((i, best))
    return joins
