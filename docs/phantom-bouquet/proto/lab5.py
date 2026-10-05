import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import traced as T
import skeleton as SK
src = open('gen-lite.py').read()
LINEN = '#ECE5D6'
DEFS = eval("(" + src.split("DEFS = (")[1].split("IVORY =")[0].strip())
IVORY = ('#FBF7EC', '#FFFDF6')
TINTS = {'madder': ('#A3443A', '#C2584B'), 'ochre': ('#B7832A', '#D4A043'), 'rust': ('#9E4F27', '#C0693A'), 'olive': ('#66733A', '#8A9852'), 'plum': ('#6B3B5A', '#8E5379')}
L = T.load()
# The fifth-turn curation: the hearts (0, 5, 9), the serrated oval (7) and the willow (6)
# stay; the curled drops (2, 4) are dropped; the maples (1, 12) are on trial.
items = [(0, None), (1, 'rust'), (5, 'plum'), (6, 'olive'), (7, None), (9, 'madder'), (12, 'ochre')]
W, H = 1500, 780
o = [DEFS, '<rect width="%d" height="%d" fill="url(#weave)"/>' % (W, H)]
for n, (li, col) in enumerate(items):
    ink, tint = IVORY if col is None else TINTS[col]
    x = 150 + (n % 4) * 360
    y = 180 + (n // 4) * 400
    o.append(SK.render(L[li], x, y, 280, 0, ink, tint, 0.3 if col is None else 0.12, 90 + n, li, blend=col is not None, shadow=col is None))
open('lab5.svg', 'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">%s</svg>' % (W, H, W, H, ''.join(o)))
print(len(open('lab5.svg').read()))
