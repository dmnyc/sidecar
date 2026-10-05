import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import traced as T
src = open('gen-lite.py').read()
LINEN = '#ECE5D6'
DEFS = eval("(" + src.split("DEFS = (")[1].split("IVORY =")[0].strip())
IVORY = ('#FBF7EC', '#FFFDF6')
TINTS = {'madder': ('#A3443A', '#C2584B'), 'ochre': ('#B7832A', '#D4A043'), 'rust': ('#9E4F27', '#C0693A'), 'olive': ('#66733A', '#8A9852'), 'plum': ('#6B3B5A', '#8E5379')}
L = T.load()
uniq = [0, 1, 2, 4, 5, 6, 7, 9, 12]
cols = [None, 'rust', 'madder', 'ochre', 'plum', 'olive', None, 'madder', 'ochre']
W, H = 1500, 640
o = [DEFS, '<rect width="%d" height="%d" fill="url(#weave)"/>' % (W, H)]
for i, (li, col) in enumerate(zip(uniq, cols)):
    ink, tint = IVORY if col is None else TINTS[col]
    x = 120 + (i % 5) * 290
    y = 160 + (i // 5) * 320
    o.append(T.render(L[li], x, y, 260, 0, ink, tint, 0.35 if col is None else 0.16, 50 + i, blend=col is not None, shadow=col is None, idx=li))
open('lab2.svg', 'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">%s</svg>' % (W, H, W, H, ''.join(o)))
print(len(open('lab2.svg').read()))
