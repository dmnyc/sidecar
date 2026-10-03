"""Draws Sleepy Hollow's night. Run from the repo root:

    python3 scripts/gen-sleepy-hollow.py

Writes, in themes/:

  sleepy-hollow-sky.svg      the top of the panel: a harvest moon behind the bare limbs of
                             the great tulip tree, and a few late leaves on the wind.
  sleepy-hollow-hollow.svg   the foot of the panel: the hills of the Hollow with the old
                             Dutch church on its knoll, the bridge over the brook, and the
                             Horseman riding the ridge with his pumpkin alight.
  sleepy-hollow-*-wide.svg   the same two in a wider frame for the expanded composer, so a
                             full tab draws the scene at about the size the panel does.

Two layers rather than one plate, each laid once at the full width and pinned to its own
edge: the moon then sits at the same place under the tab bar however tall the panel is,
and the Horseman stays on the bottom edge, where a single plate sized to cover would move
one or the other with the panel's height. Neither is tiled.

After Washington Irving's tale (1820) and the engravings that illustrated it through the
century after, which drew the Hollow as silhouette against a pale sky: everything here is
the one near-black of the trees, with the moon, its light on the mist, and the pumpkin
the only things lit. Every random choice is seeded, so a run draws the same night.
"""

import math
import os
import random

ROOT = os.path.join(os.path.dirname(__file__), '..')
THEMES = os.path.join(ROOT, 'themes')

INK = '#06050A'        # the trees, the hills, the rider: one silhouette black
FAR = '#141127'        # the far ridge, a step lighter so it reads behind the near one
GROVE = '#0C0A17'      # the trees on the far ridge, between the two
MOON = '#F2DCA8'
MOON_RIM = '#DDB06A'
EMBER = '#F09A3E'      # the pumpkin's light


def f(v):
    return ('%.1f' % v).rstrip('0').rstrip('.')


def svg(w, h, body):
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">%s</svg>\n'
            % (w, h, w, h, ''.join(body)))


# ---- the tree ------------------------------------------------------------------------
# A limb is drawn as a curve with a stroke that thins as it divides, so the tree tapers
# from trunk to twig the way an engraver's line does. Gnarled rather than regular: every
# fork turns by a jittered angle and the limbs droop a little under their own length.

def limb(o, rnd, x, y, ang, length, width, depth, droop=0.05):
    if depth == 0 or length < 3 or width < 0.35:
        return
    bend = rnd.uniform(-0.35, 0.35)
    mx = x + math.cos(ang + bend) * length * 0.5
    my = y + math.sin(ang + bend) * length * 0.5
    ex = x + math.cos(ang) * length
    ey = y + math.sin(ang) * length + droop * length
    o.append('<path d="M%s %sQ%s %s %s %s" stroke-width="%s"/>'
             % (f(x), f(y), f(mx), f(my), f(ex), f(ey), f(width)))
    kids = 2 if rnd.random() < 0.75 else 3
    for k in range(kids):
        turn = rnd.uniform(0.25, 0.7) * (1 if k % 2 else -1) + rnd.uniform(-0.15, 0.15)
        limb(o, rnd, ex, ey, ang + turn, length * rnd.uniform(0.66, 0.82),
             width * rnd.uniform(0.6, 0.72), depth - 1, droop)


def tree(rnd, x, y, ang, length, width, depth, droop=0.05):
    o = ['<g fill="none" stroke="%s" stroke-linecap="round">' % INK]
    limb(o, rnd, x, y, ang, length, width, depth, droop)
    o.append('</g>')
    return ''.join(o)


# ---- the Horseman ----------------------------------------------------------------------
# Drawn facing right with the hooves about y = -20, then placed and scaled. The horse is
# in the "flying gallop" of nineteenth-century prints, forelegs stretched ahead and hind
# legs behind, which is how the illustrators of the tale drew the chase. The rider leans
# into it with his cloak streaming: headless, and his arm up with the pumpkin, the one
# lit thing on him.

HORSE = ('M30 -54C30 -62 42 -64 52 -60C62 -57 72 -58 78 -61C86 -68 92 -76 97 -82'
         'L95 -91L101 -85C106 -80 112 -72 117 -66C119 -63 118 -60 115 -59'
         'C111 -60 107 -63 104 -64C100 -62 96 -56 92 -48C90 -44 86 -40 80 -38'
         'C68 -36 52 -36 42 -40C34 -42 30 -48 30 -54Z')
# Limbs as strokes: [points], width at the top. Upper leg thick, cannon thin.
LIMBS = [
    ([(84, -44), (99, -36), (117, -31)], 6.5, 3.2),   # far foreleg, reaching
    ([(80, -42), (93, -28), (111, -22)], 7, 3.4),     # near foreleg
    ([(40, -47), (22, -38), (4, -38)], 9, 3.4),       # far hind leg, thrown back
    ([(44, -44), (28, -29), (9, -24)], 9.5, 3.6),     # near hind leg
]
TAIL = 'M32 -57C22 -64 10 -66 -6 -60C6 -61 16 -58 24 -52C14 -52 6 -48 -2 -44C12 -46 24 -48 31 -50Z'
RIDER = ('M58 -58L62 -63C64 -72 68 -82 72 -89L80 -86C77 -78 72 -68 70 -58Z'
         # the cloak, from the shoulders back on the wind, its hem torn
         'M73 -89C62 -93 46 -92 30 -86L38 -83L28 -77L40 -77L35 -70L48 -73L52 -67L62 -73L66 -64Z')
ARM = 'M76 -86L84 -94L85 -105'


def horseman(x, y, s, flip=False):
    sx = -s if flip else s
    g = ['<g transform="translate(%s %s) scale(%s %s)" fill="%s" stroke="%s" stroke-linecap="round" stroke-linejoin="round">'
         % (f(x), f(y), f(sx), f(s), INK, INK),
         '<path d="%s" stroke="none"/>' % HORSE, '<path d="%s" stroke="none"/>' % TAIL,
         '<ellipse cx="41" cy="-50" rx="12" ry="10" stroke="none"/>',
         '<ellipse cx="82" cy="-49" rx="8" ry="9" stroke="none"/>']
    for pts, w0, w1 in LIMBS:
        (ax, ay), (bx, by), (cx, cy) = pts
        g.append('<path d="M%s %sL%s %s" fill="none" stroke-width="%s"/>' % (f(ax), f(ay), f(bx), f(by), f(w0)))
        g.append('<path d="M%s %sL%s %s" fill="none" stroke-width="%s"/>' % (f(bx), f(by), f(cx), f(cy), f(w1)))
        g.append('<circle cx="%s" cy="%s" r="%s" stroke="none"/>' % (f(cx), f(cy), f(w1 * 0.8)))
    g += ['<path d="%s" stroke="none"/>' % RIDER,
          '<path d="%s" fill="none" stroke-width="4.5"/>' % ARM, '</g>']
    # The pumpkin, lit, with the glow round it, drawn after so nothing covers it.
    px, py = x + 85.5 * sx, y - 111 * s
    g.append('<circle cx="%s" cy="%s" r="%s" fill="url(#ember)"/>' % (f(px), f(py), f(20 * s)))
    g.append('<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="%s"/>' % (f(px), f(py), f(6 * s), f(5 * s), EMBER))
    g.append('<path d="M%s %sv%s" stroke="%s" stroke-width="%s" stroke-linecap="round"/>'
             % (f(px), f(py - 4.6 * s), f(-2 * s), INK, f(1.4 * s)))
    return ''.join(g)


def defs():
    return ('<defs>'
            '<radialGradient id="moon" cx="0.42" cy="0.4" r="0.62">'
            '<stop offset="0" stop-color="%s"/><stop offset="0.75" stop-color="%s"/>'
            '<stop offset="1" stop-color="%s"/></radialGradient>'
            '<radialGradient id="halo">'
            '<stop offset="0" stop-color="%s" stop-opacity="0.26"/>'
            '<stop offset="0.35" stop-color="%s" stop-opacity="0.08"/>'
            '<stop offset="1" stop-color="%s" stop-opacity="0"/></radialGradient>'
            '<radialGradient id="ember">'
            '<stop offset="0" stop-color="%s" stop-opacity="0.55"/>'
            '<stop offset="1" stop-color="%s" stop-opacity="0"/></radialGradient>'
            '<linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">'
            '<stop offset="0" stop-color="#B9B3D6" stop-opacity="0"/>'
            '<stop offset="0.55" stop-color="#B9B3D6" stop-opacity="0.07"/>'
            '<stop offset="1" stop-color="#B9B3D6" stop-opacity="0"/></linearGradient>'
            '</defs>' % (MOON, MOON, MOON_RIM, MOON, MOON, MOON, EMBER, EMBER))


def moon(cx, cy, r):
    o = ['<circle cx="%s" cy="%s" r="%s" fill="url(#halo)"/>' % (f(cx), f(cy), f(r * 4.2)),
         '<circle cx="%s" cy="%s" r="%s" fill="url(#moon)"/>' % (f(cx), f(cy), f(r))]
    # The seas, faint: enough that it is the moon and not a lamp.
    rnd = random.Random(1820)
    for dx, dy, rr in [(-0.3, -0.2, 0.28), (0.15, -0.35, 0.18), (0.25, 0.15, 0.24), (-0.1, 0.35, 0.16), (-0.42, 0.18, 0.12)]:
        o.append('<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="%s" fill-opacity="%s"/>'
                 % (f(cx + dx * r), f(cy + dy * r), f(rr * r), f(rr * r * rnd.uniform(0.75, 0.95)),
                    MOON_RIM, f(rnd.uniform(0.08, 0.14))))
    return ''.join(o)


def clouds(rnd, w, y0, y1, n):
    # Long low wisps across the sky, darker than the sky where they cross the moon.
    o = []
    for _ in range(n):
        x = rnd.uniform(-w * 0.2, w)
        y = rnd.uniform(y0, y1)
        lw = rnd.uniform(w * 0.25, w * 0.55)
        o.append('<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="#0D0B18" fill-opacity="%s"/>'
                 % (f(x), f(y), f(lw / 2), f(rnd.uniform(2.2, 5)), f(rnd.uniform(0.55, 0.8))))
    return ''.join(o)


def hills(rnd, w, h, base, amp, color, seed_shift=0.0):
    # A ridge line from a few summed sines, closed down to the bottom edge.
    pts = []
    step = 6
    phase = [rnd.uniform(0, 6.28) for _ in range(3)]
    for i in range(0, int(w) + step, step):
        t = i / w
        yv = base - amp * (0.55 * math.sin(t * 5.1 + phase[0] + seed_shift)
                           + 0.3 * math.sin(t * 11.3 + phase[1])
                           + 0.15 * math.sin(t * 23.7 + phase[2]))
        pts.append('%s %s' % (f(i), f(yv)))
    return '<path d="M0 %sL%sL%s %sL0 %sZ" fill="%s"/>' % (f(h), 'L'.join(pts), f(w), f(h), f(h), color), pts


def ridge_y(pts, x):
    xs = [(float(p.split()[0]), float(p.split()[1])) for p in pts]
    for (x0, y0), (x1, y1) in zip(xs, xs[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return xs[-1][1]


def church(x, y, s, color):
    # The old Dutch church on its knoll: a gabled nave and a steeple with a spire.
    return ('<g transform="translate(%s %s) scale(%s)" fill="%s">'
            '<path d="M0 0V-14L11 -22L22 -14V0Z"/>'
            '<path d="M18 0V-26H26V0Z"/><path d="M17 -26L22 -31L27 -26Z"/>'
            '<path d="M19.5 -31L22 -46L24.5 -31Z"/>'
            '<rect x="21.4" y="-52" width="1.2" height="7"/><rect x="19.6" y="-50.4" width="4.8" height="1.1"/>'
            '</g>') % (f(x), f(y), f(s), color)


def bridge(x, y, s):
    # The bridge over the brook, where the Horseman's chase ended: a low wooden span on
    # posts, with a hand rail.
    o = ['<g transform="translate(%s %s) scale(%s)" fill="%s" stroke="%s" stroke-linecap="round">' % (f(x), f(y), f(s), INK, INK),
         '<path d="M0 0Q30 -9 60 0L60 3Q30 -6 0 3Z" stroke="none"/>',
         '<path d="M2 -5Q30 -14 58 -5" fill="none" stroke-width="1.3"/>']
    for px in (4, 15, 30, 45, 56):
        top = -5 - 9 * (1 - ((px - 30) / 30.0) ** 2)
        o.append('<path d="M%s %sV%s" stroke-width="1.2"/>' % (f(px), f(top + 1), f(9 if px in (4, 56) else 1)))
    o.append('</g>')
    return ''.join(o)


def leaves(rnd, w, h, n):
    # A few late leaves on the wind, rust and ochre, faint: they are weather, not ornament.
    o = []
    for _ in range(n):
        x, y = rnd.uniform(0, w), rnd.uniform(h * 0.12, h * 0.8)
        a = rnd.uniform(0, 360)
        s = rnd.uniform(0.7, 1.3)
        c = rnd.choice(['#B5652E', '#9C5A2A', '#C2893E', '#8A4A26'])
        o.append('<path d="M0 -3.4C2.2 -1.6 2.2 1.6 0 3.4C-2.2 1.6 -2.2 -1.6 0 -3.4Z" fill="%s" fill-opacity="%s" '
                 'transform="translate(%s %s) rotate(%s) scale(%s)"/>'
                 % (c, f(rnd.uniform(0.28, 0.45)), f(x), f(y), f(a), f(s)))
    return ''.join(o)


def sky(w, h, seed):
    # The top of the frame: the moon, the cloud across it, and the great tulip tree leaning
    # in with its limbs across the sky. In the tale it stood in the middle of the road and
    # the country people would not pass it after dark. Pinned to the top of the panel, so
    # the moon is always just under the tab bar, where no label sits on it, and rises
    # behind whatever card comes first.
    rnd = random.Random(seed)
    narrow = w < 600
    o = [defs()]
    mr = 38 if narrow else 64
    mx, my = (w - 82, 150) if narrow else (w * 0.8, 210)
    o.append(moon(mx, my, mr))
    o.append(clouds(rnd, w, my - mr * 0.1, my + mr * 0.8, 3 if narrow else 6))
    o.append(tree(random.Random(seed + 1), -14, h * 0.62, -1.05, h * 0.26 if narrow else h * 0.22, 22, 8, 0.04))
    if not narrow:
        o.append(tree(random.Random(seed + 2), w + 10, h * 0.66, -2.05, h * 0.2, 20, 8, 0.04))
    o.append(leaves(rnd, w, h, 8 if narrow else 30))
    return svg(w, h, o)


def hollow(w, h, seed):
    # The foot of the frame: the far ridge with its grove and the old Dutch church, mist
    # over the brook, the near ridge with the bridge, and the Horseman. Pinned to the
    # bottom. The church and the Horseman are kept clear of the trees on either ridge,
    # since a silhouette crossing a silhouette is just a larger blot.
    rnd = random.Random(seed)
    narrow = w < 600
    o = [defs()]
    # The Horseman rides the left of the panel, clear of the compose button that sits
    # over the bottom right corner.
    cx = w * (0.47 if narrow else 0.6)
    hx = w * (0.08 if narrow else 0.76)
    hs = 0.6 if narrow else 0.8
    clear = [(cx - 40, cx + 64), (hx - 10, hx + 125 * hs)]
    free = lambda x: all(not (a <= x <= b) for a, b in clear)
    far, far_pts = hills(rnd, w, h, h * 0.5, h * 0.12, FAR, 0.4)
    o.append(far)
    for _ in range(10 if narrow else 18):
        tx = rnd.uniform(0, w)
        if not free(tx):
            continue
        o.append(tree(random.Random(rnd.randint(0, 10 ** 6)), tx, ridge_y(far_pts, tx) + 2,
                      -math.pi / 2 + rnd.uniform(-0.15, 0.15), rnd.uniform(9, 16), 2.4, 5, 0.0)
                 .replace(INK, GROVE))
    o.append(church(cx, ridge_y(far_pts, cx + 11) + 2, 0.85 if narrow else 1.1, INK))
    o.append('<rect x="0" y="%s" width="%s" height="%s" fill="url(#mist)"/>' % (f(h * 0.38), f(w), f(h * 0.4)))
    near, near_pts = hills(rnd, w, h, h * 0.8, h * 0.1, INK, 2.2)
    o.append(near)
    bx = w * (0.64 if narrow else 0.3)
    o.append(bridge(bx, ridge_y(near_pts, bx + 30) + 7, 0.9 if narrow else 1.2))
    for _ in range(5 if narrow else 9):
        tx = rnd.uniform(0, w)
        if not free(tx):
            continue
        o.append(tree(random.Random(rnd.randint(0, 10 ** 6)), tx, ridge_y(near_pts, tx) + 3,
                      -math.pi / 2 + rnd.uniform(-0.2, 0.2), rnd.uniform(16, 28), 3.6, 6, 0.02))
    o.append(horseman(hx, ridge_y(near_pts, hx + 60 * hs) + 8 * hs, hs))
    return svg(w, h, o)


def main():
    files = {
        'sleepy-hollow-sky.svg': sky(360, 420, 1790),
        'sleepy-hollow-hollow.svg': hollow(360, 170, 1820),
        'sleepy-hollow-sky-wide.svg': sky(1920, 760, 1790),
        'sleepy-hollow-hollow-wide.svg': hollow(1920, 300, 1820),
    }
    for name, body in files.items():
        with open(os.path.join(THEMES, name), 'w') as fh:
            fh.write(body)
        print('wrote themes/%s (%d bytes)' % (name, len(body)))


if __name__ == '__main__':
    main()
