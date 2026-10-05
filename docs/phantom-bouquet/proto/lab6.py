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
# Closeups for checking the stem-to-spine join and the vein taper: two rows, hearts and
# maples at the sizes the panel actually places them at, so the joins can be judged.
items = [(5, 'plum'), (9, 'madder'), (1, 'rust'), (12, 'ochre'), (7, None), (6, 'olive')]
W, H = 1500, 900
o = [DEFS, '<rect width="%d" height="%d" fill="url(#weave)"/>' % (W, H)]
for n, (li, col) in enumerate(items):
    ink, tint = IVORY if col is None else TINTS[col]
    x = 190 + (n % 3) * 480
    y = 230 + (n // 3) * 460
    o.append(SK.render(L[li], x, y, 400, 0, ink, tint, 0.3 if col is None else 0.12, 90 + n, li, blend=col is not None, shadow=col is None))
open('lab6.svg', 'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">%s</svg>' % (W, H, W, H, ''.join(o)))
print(len(open('lab6.svg').read()))
