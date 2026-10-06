import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import traced as T
import skeleton as SK
import genleaf as G
src = open('gen-lite.py').read()
LINEN = '#ECE5D6'
DEFS = eval("(" + src.split("DEFS = (")[1].split("IVORY =")[0].strip())
IVORY = ('#FBF7EC', '#FFFDF6')
TINTS = {'madder': ('#A3443A', '#C2584B'), 'ochre': ('#B7832A', '#D4A043'), 'rust': ('#9E4F27', '#C0693A'), 'olive': ('#66733A', '#8A9852'), 'plum': ('#6B3B5A', '#8E5379')}

# Six forms, each after one of the maintainer's reference photos. The generated leaves
# take over the indices the pipeline's type sets know about: hearts are BROAD (a pair of
# basal veins), serrated ones TOOTHED (secondaries run out to the teeth).
LEAVES = [
    G.leaf(1.35, 0.36, baseflare=0.38, tipfall=1.0, tiphook=1.9, cordate=1.0, drip=1.0, asym=0.05, notch=0.16, seed=11),    # 0 the bodhi-like heart
    G.leaf(1.9, 0.33, baseflare=0.16, tipfall=1.05, tiphook=2.0, drip=0.7, asym=0.05, seed=22),                             # 1 ovate-lanceolate
    G.leaf(1.18, 0.32, baseflare=0.38, tipfall=1.0, tiphook=1.9, cordate=1.0, serrate=1.0, asym=0.06, notch=0.16, seed=33), # 2 cordate, serrated
    G.leaf(2.4, 0.46, baseflare=0.10, tipfall=1.05, tiphook=2.0, asym=0.04, seed=44),                                       # 3 lanceolate
    G.leaf(1.06, 0.44, baseflare=0.34, tipfall=1.0, tiphook=2.0, cordate=0.9, serrate=0.9, asym=0.06, notch=0.18, seed=55), # 4 round cordate, serrated
    G.leaf(3.0, 0.52, baseflare=0.08, tipfall=1.0, tiphook=2.2, asym=0.04, seed=66),                                        # 5 the willow
    G.leaf(1.35, 0.36, baseflare=0.38, tipfall=1.0, tiphook=1.9, cordate=1.0, drip=1.0, asym=0.05, notch=0.16, seed=77),    # 6 the heart again, another leaf
    G.palmate(5, R=100.0, sinus=0.32, serrate=1.6, asym=0.05, seed=88),                                                     # 7 the maple
]
T.PALMATE = {7}
T.BROAD = {0, 2, 4, 6}
SK.TOOTHED = {2, 4, 7}
T.BASE_AT_NARROW_END = set()

W, H = 1500, 780
o = [DEFS, '<rect width="%d" height="%d" fill="url(#weave)"/>' % (W, H)]
items = [(0, None), (2, 'rust'), (0, 'plum'), (5, 'olive'), (4, None), (6, 'madder'), (3, 'ochre'), (7, 'rust')]
for n, (li, col) in enumerate(items):
    ink, tint = IVORY if col is None else TINTS[col]
    x = 150 + (n % 4) * 360
    y = 180 + (n // 4) * 400
    o.append(SK.render(LEAVES[li], x, y, 280, 0, ink, tint, 0.3 if col is None else 0.12, 90 + n, li, blend=col is not None, shadow=col is None))
open('lab7.svg', 'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">%s</svg>' % (W, H, W, H, ''.join(o)))
print(len(open('lab7.svg').read()))
