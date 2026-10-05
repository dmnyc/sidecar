import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vrender as VR
src = open('gen-lite.py').read()
LINEN = '#ECE5D6'
DEFS = eval("(" + src.split("DEFS = (")[1].split("IVORY =")[0].strip())
IVORY = ('#FBF7EC', '#FFFDF6')
TINTS = {'madder': ('#A3443A', '#C2584B'), 'ochre': ('#B7832A', '#D4A043'), 'rust': ('#9E4F27', '#C0693A'), 'olive': ('#66733A', '#8A9852'), 'plum': ('#6B3B5A', '#8E5379')}
W, H = 1500, 660
o = [DEFS, '<rect width="%d" height="%d" fill="url(#weave)"/>' % (W, H)]
items = [(0, None), (9, 'madder'), (5, 'plum'), (7, 'olive'), (6, 'ochre'), (1, 'rust'), (12, 'ochre'), (0, 'madder')]
for n, (li, col) in enumerate(items):
    ink, tint = IVORY if col is None else TINTS[col]
    x = 150 + (n % 4) * 360
    y = 170 + (n // 4) * 330
    o.append(VR.render(li, x, y, 290, 0, ink, tint, 0.3 if col is None else 0.12, 10 + n, blend=col is not None, shadow=col is None))
open('lab4.svg', 'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">%s</svg>' % (W, H, W, H, ''.join(o)))
print(len(open('lab4.svg').read()))
