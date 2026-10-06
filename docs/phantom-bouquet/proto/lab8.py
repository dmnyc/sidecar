import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import traced as T
import skeleton as SK
import genleaf as G
src = open('gen-lite.py').read()
LINEN = '#ECE5D6'
DEFS = eval("(" + src.split("DEFS = (")[1].split("IVORY =")[0].strip())
IVORY = ('#FBF7EC', '#FFFDF6')
TINTS = {'madder': ('#A3443A', '#C2584B'), 'ochre': ('#B7832A', '#D4A043'), 'rust': ('#9E4F27', '#C0693A'), 'olive': ('#66733A', '#8A9852'), 'plum': ('#6B3B5A', '#8E5379')}
LEAVES = [
    G.leaf(1.35, 0.36, baseflare=0.38, tipfall=1.0, tiphook=1.9, cordate=1.0, drip=1.0, asym=0.05, notch=0.16, seed=11),
    G.leaf(1.18, 0.32, baseflare=0.38, tipfall=1.0, tiphook=1.9, cordate=1.0, serrate=1.0, asym=0.06, notch=0.16, seed=33),
    G.palmate(5, R=100.0, sinus=0.32, serrate=1.6, asym=0.05, seed=88),
]
T.PALMATE = {2}
T.BROAD = {0, 1}
SK.TOOTHED = {1, 2}
T.BASE_AT_NARROW_END = set()
W, H = 1500, 900
o = [DEFS, '<rect width="%d" height="%d" fill="url(#weave)"/>' % (W, H)]
items = [(0, 'plum'), (1, 'rust'), (2, 'ochre')]
for n, (li, col) in enumerate(items):
    ink, tint = IVORY if col is None else TINTS[col]
    x = 250 + n * 480
    y = 400
    o.append(SK.render(LEAVES[li], x, y, 460, 0, ink, tint, 0.12, 90 + n, li, blend=True))
open('lab8.svg', 'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">%s</svg>' % (W, H, W, H, ''.join(o)))
print(len(open('lab8.svg').read()))
