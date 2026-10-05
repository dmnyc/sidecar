import sys, math, random, time
sys.path.insert(0, '.')
import numpy as np
import traced as T, venation as V
from shapely.geometry import Polygon, LineString
from shapely import affinity

L = T.load()

def leaf_px(i, size):
    lf = L[i]; b = lf['blade']
    base, tips = T.base_and_tips(i, lf)
    minx, miny, maxx, maxy = b.bounds
    k = size / max(maxx - minx, maxy - miny)
    f = lambda p: ((p[0] - minx) * k, (p[1] - miny) * k)
    blade = Polygon([f(p) for p in b.exterior.coords])
    stem = [f(p) for p in lf['stem'][0]] if lf['stem'] else None
    return blade, f(base), [f(t) for t in tips], stem, k

def build(i, size, seed=1):
    rnd = random.Random(seed)
    blade, base, tips, stem, k = leaf_px(i, size)
    tree = V.Tree()
    root = tree.add(base, -1)
    if i in T.PALMATE:
        for t in tips:
            end = (base[0] + (t[0] - base[0]) * 0.95, base[1] + (t[1] - base[1]) * 0.95)
            V.seed_path(tree, [base, end], root, 4)
    else:
        # midrib along the blade's middle (centre_path works in any units)
        mid = T.centre_path(blade, base, tips[0])
        V.seed_path(tree, mid[:-1] + [(mid[-2][0] + (mid[-1][0] - mid[-2][0]) * 0.6, mid[-2][1] + (mid[-1][1] - mid[-2][1]) * 0.6)], root, 4)
    t0 = time.time()
    V.grow(blade.buffer(-1.2), tree, rnd)
    return blade, base, stem, tree, time.time() - t0

if __name__ == '__main__':
    for i in [9, 1]:
        blade, base, stem, tree, dt = build(i, 300)
        print(i, len(tree.pos), 'nodes', round(dt, 1), 's')
