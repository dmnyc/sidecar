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
W, H = 360, 760
o = [DEFS, '<rect width="%d" height="%d" fill="url(#weave)"/>' % (W, H)]
# (leaf, centre x, centre y, longest side, tip direction in degrees from up, colour or None
# for ivory, flip)
for i, (li, x, y, size, tip, col, flip) in enumerate([
    (9, 190, 640, 560, 20, None, False),        # the big ivory heart behind the lower half
    (7, 300, 380, 400, -30, None, True),        # an ivory serrated oval behind the cards
    (2, 292, 118, 136, -96, 'madder', False),   # one whole leaf lying across the heading row
    (12, 62, 690, 170, -15, 'rust', False),     # the foot: a maple
    # Two at the foot, not three: a third had to sit under the compose button or be cut
    # away by the bottom edge, and either way it read as a fragment.
    (4, 178, 716, 150, 50, 'ochre', False),     # a drop, turned off the maple
]):
    ink, tint = IVORY if col is None else TINTS[col]
    o.append(SK.render(L[li], x, y, size, tip, ink, tint, 0.3 if col is None else 0.12, 70 + i, li, flip=flip,
                      blend=col is not None, shadow=col is None))
open('lite/panel.svg', 'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">%s</svg>' % (W, H, W, H, ''.join(o)))
print(len(open('lite/panel.svg').read()))
