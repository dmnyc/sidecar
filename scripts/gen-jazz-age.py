"""Draws Jazz Age's keyboard and stage lighting. Run from the repo root:

    python3 scripts/gen-jazz-age.py

Writes themes/jazz-age-keys.svg and jazz-age-stage.svg for the panel, and
jazz-age-curtain.svg, jazz-age-lock.svg and jazz-age-lamps.svg for the lock screen, with
-lock-wide and the three -lens files for the full-tab composer.

THE KEYBOARD is one octave of a piano, seven ivory keys and five ebony ones, as a tile the
theme repeats along the top edge of the account bar and the lock screen.

THE CURTAIN is velvet folds, lit on the lock screen by three spot lamps and on every
other view by the same beams faded far back, since prose sits on the panel's field.
test/theme-svg-assets.test.js measures the body inks on the brightest fold under every
panel beam at once.
"""

import math
import os

ROOT = os.path.join(os.path.dirname(__file__), '..')
THEMES = os.path.join(ROOT, 'themes')

# THE PANEL'S LIGHT, the lock screen's look faded back: the same curtain, lit by the
# same three beams at a fraction of the strength, so the folds read as a room behind
# the content rather than a picture under it. Each beam's peak is the share of its color
# added to the room's light at the top of the beam.
BEAMS = [
    # from x (fraction of width), to x, half-width where it fades, length (fraction of height), rgb, peak
    (0.12, 0.62, 70, 0.95, (255, 214, 160), 0.13),
    (0.95, 0.30, 60, 0.9, (255, 90, 90), 0.12),
    (0.55, 0.85, 50, 0.8, (255, 190, 120), 0.07),
]
PANEL_AMBIENT = (30, 26, 24)  # the room's light on the panel's curtain, as rgb


def keys():
    o = ['<svg xmlns="http://www.w3.org/2000/svg" width="98" height="30" viewBox="0 0 98 30">'
         '<defs>'
         '<linearGradient id="iv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBF4E4"/><stop offset="1" stop-color="#D9CDB4"/></linearGradient>'
         '<linearGradient id="eb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A2422"/><stop offset="1" stop-color="#080606"/></linearGradient>'
         '</defs>'
         '<rect width="98" height="30" fill="#1A1411"/>']
    for i in range(7):
        o.append('<rect x="%.1f" y="0" width="13" height="29" rx="1.2" fill="url(#iv)"/>' % (i * 14 + 0.5))
    for x in (9.5, 23.5, 51.5, 65.5, 79.5):
        o.append('<rect x="%.1f" y="0" width="8" height="18" rx="1" fill="url(#eb)"/>' % x)
        o.append('<rect x="%.1f" y="0" width="1.4" height="16" fill="#FFFFFF" fill-opacity="0.18"/>' % (x + 1.2))
    o.append('</svg>\n')
    return ''.join(o)


def stage():
    W, H = 360, 760
    o = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" preserveAspectRatio="none">' % (W, H, W, H),
         '<defs><filter id="soft" x="-30%" y="-10%" width="160%" height="120%"><feGaussianBlur stdDeviation="14"/></filter>']
    for i, (x0, x1, spread, length, rgb, a) in enumerate(BEAMS):
        c = 'rgb(%d,%d,%d)' % rgb
        o.append('<linearGradient id="b%d" gradientUnits="userSpaceOnUse" x1="%.1f" y1="-20" x2="%.1f" y2="%.1f">'
                 '<stop offset="0" stop-color="%s" stop-opacity="%.3f"/>'
                 '<stop offset="0.6" stop-color="%s" stop-opacity="%.3f"/>'
                 '<stop offset="1" stop-color="%s" stop-opacity="0"/></linearGradient>'
                 % (i, x0 * W, x1 * W, length * H, c, a, c, a * 0.5, c))
    o.append('</defs><rect width="%d" height="%d" fill="rgb(%d,%d,%d)"/><g filter="url(#soft)">' % ((W, H) + PANEL_AMBIENT))
    for i, (x0, x1, spread, length, rgb, a) in enumerate(BEAMS):
        fx, tx, L = x0 * W, x1 * W, length * H
        o.append('<polygon points="%.1f,-20 %.1f,-20 %.1f,%.1f %.1f,%.1f" fill="url(#b%d)"/>'
                 % (fx - 5, fx + 5, tx + spread, L, tx - spread, L, i))
    o.append('</g></svg>\n')
    return ''.join(o)


# THE LOCK SCREEN is a velvet curtain lit by three spot lamps, in three layers the theme
# stacks. The curtain is drawn as it would look under full light and repeats across the
# width, so its folds keep their size in a wider panel. The light is multiplied onto it,
# as light is onto fabric: the crests of the folds catch it and the troughs stay dark,
# and beyond the beams the curtain drops into the room's dark. The lamps sit on top,
# suggested only by their lenses, so the blend cannot tint them.
LAMPS = [
    # lamp x, aim x where the beam fades, half-width there, rgb, strength
    (0.16, 0.66, 95, (255, 214, 160), 0.95),
    (0.84, 0.30, 90, (255, 90, 90), 0.9),
    (0.50, 0.52, 70, (255, 190, 120), 0.55),
]
AMBIENT = ('#171210', '#060404')  # the room's light on the curtain, top and bottom
LAMP_Y = 44.0      # where the lamps hang, just under the keyboard strip
FADE = 0.94        # the fraction of the height where the beams have faded out

# The folds across one 240px tile, in px, deliberately uneven so the repeat does not show.
FOLDS = [22, 30, 18, 34, 26, 20, 32, 24, 34]
TROUGH, SHADE, CREST, SHEEN = '#1A050B', '#78162A', '#A8283E', '#C84A62'
# The composer's velvet, brighter: no prose sits on it there, so its folds can take more light.
LIT_FOLDS = ('#22060E', '#9A1E34', '#D0364E', '#F4788E')


def curtain(colors=(TROUGH, SHADE, CREST, SHEEN)):
    trough, shade, crest, sheen = colors
    W, H = sum(FOLDS), 760
    stops, x = [], 0
    for w in FOLDS:
        for off, col in ((0, trough), (0.3, shade), (0.46, crest), (0.54, sheen), (0.7, shade), (1, trough)):
            stops.append('<stop offset="%.4f" stop-color="%s"/>' % ((x + off * w) / W, col))
        x += w
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" preserveAspectRatio="none">'
            '<defs><linearGradient id="f" x1="0" y1="0" x2="1" y2="0">%s</linearGradient></defs>'
            '<rect width="%d" height="%d" fill="url(#f)"/></svg>\n' % (W, H, W, H, ''.join(stops), W, H))


# THE COMPOSER TAB gets the lock screen's full light rather than the panel's faded one:
# nothing on that page is lettered on the curtain (the note is a card, the bar is its
# own surface). The same three lamps, their beams held narrow for a wide frame so each
# stays a focused spot, crossing through the middle above and below the card.
WIDE_LAMPS = [
    (0.16, 0.66, 340, (255, 214, 160), 1.0),
    (0.84, 0.34, 340, (255, 90, 90), 1.0),
    (0.50, 0.50, 240, (255, 190, 120), 0.95),
]
WIDE_LAMP_Y = 64.0  # just under the page's bar, on a 900px-tall frame


def lock_light(W=360, H=760, LAMPS=LAMPS, LAMP_Y=LAMP_Y, AMBIENT=AMBIENT, HOLD=0.5):
    floor = H * FADE
    o = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" preserveAspectRatio="none">' % (W, H, W, H),
         '<defs><filter id="soft" x="-30%" y="-10%" width="160%" height="120%"><feGaussianBlur stdDeviation="14"/></filter>',
         '<linearGradient id="amb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient>' % AMBIENT]
    for i, (lx, ax, spread, rgb, a) in enumerate(LAMPS):
        c = 'rgb(%d,%d,%d)' % rgb
        o.append('<linearGradient id="L%d" gradientUnits="userSpaceOnUse" x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f">'
                 '<stop offset="0" stop-color="%s" stop-opacity="%.3f"/>'
                 '<stop offset="0.6" stop-color="%s" stop-opacity="%.3f"/>'
                 '<stop offset="1" stop-color="%s" stop-opacity="0"/></linearGradient>'
                 % (i, lx * W, LAMP_Y, ax * W, floor, c, a, c, a * HOLD, c))
    o.append('</defs><rect width="%d" height="%d" fill="url(#amb)"/><g filter="url(#soft)">' % (W, H))
    for i, (lx, ax, spread, rgb, a) in enumerate(LAMPS):
        x0, x1 = lx * W, ax * W
        o.append('<polygon points="%.1f,%.1f %.1f,%.1f %.1f,%.1f %.1f,%.1f" fill="url(#L%d)"/>'
                 % (x0 - 6, LAMP_Y, x0 + 6, LAMP_Y, x1 + spread, floor, x1 - spread, floor, i))
    # Where each beam lands on the fabric it makes a hot pool, an oval brighter than the
    # beam around it.
    for lx, ax, spread, rgb, a in LAMPS:
        t = 0.38
        cx, cy = lx * W + (ax - lx) * W * t, LAMP_Y + (floor - LAMP_Y) * t
        o.append('<ellipse cx="%.1f" cy="%.1f" rx="%.1f" ry="%.1f" fill="rgb(%d,%d,%d)" fill-opacity="%.3f"/>'
                 % ((cx, cy, spread * 0.55, spread * 0.9) + rgb + (a * 0.45,)))
    o.append('</g></svg>\n')
    return ''.join(o)


def lamps(W=360, H=760, LAMPS=LAMPS, LAMP_Y=LAMP_Y, SIZE=1.0):
    # SIZE scales the lenses: the composer tab's frame is four times the panel's width, and
    # lenses drawn at the panel's size were pinpricks on it.
    o = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" preserveAspectRatio="none">' % (W, H, W, H),
         # The blur is in the lens's own units, so the scale below enlarges it with the lens;
         # the region is wide enough that its edge never cuts the falloff (a tighter one
         # showed as a square round each lens).
         '<defs><filter id="glow" x="-300%" y="-500%" width="700%" height="1100%"><feGaussianBlur stdDeviation="3"/></filter></defs>']
    for lx, ax, spread, rgb, a in LAMPS:
        x = lx * W
        ang = math.degrees(math.atan2(H * FADE - LAMP_Y, ax * W - x)) - 90
        o.append('<g transform="translate(%.1f %.1f) rotate(%.1f) scale(%.2f)">'
                 '<ellipse cx="0" cy="2" rx="8" ry="3.5" fill="rgb(%d,%d,%d)" fill-opacity="0.9" filter="url(#glow)"/>'
                 '<ellipse cx="0" cy="2" rx="5" ry="2" fill="#FFF4E2"/>'
                 '</g>' % ((x, LAMP_Y, ang, SIZE) + rgb))
    o.append('</svg>\n')
    return ''.join(o)


def lens(lx, ax, rgb, W=1440, H=900, LAMP_Y=WIDE_LAMP_Y, SIZE=2.0, BOX=96):
    # One of the composer tab's lamps on its own, drawn at its true proportions in a small
    # square the theme pins where the lamp hangs. The tab's beams are stretched to the
    # window, but a lens drawn into that same stretched picture stretched with it, unevenly
    # on a tall window, so the tilted side lenses looked bigger than the center one.
    ang = math.degrees(math.atan2(H * FADE - LAMP_Y, (ax - lx) * W)) - 90
    c = BOX / 2
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
            '<defs><filter id="glow" x="-300%%" y="-500%%" width="700%%" height="1100%%"><feGaussianBlur stdDeviation="3"/></filter></defs>'
            '<g transform="translate(%.1f %.1f) rotate(%.1f) scale(%.2f)">'
            '<ellipse cx="0" cy="0" rx="8" ry="3.5" fill="rgb(%d,%d,%d)" fill-opacity="0.9" filter="url(#glow)"/>'
            '<ellipse cx="0" cy="0" rx="5" ry="2" fill="#FFF4E2"/>'
            '</g></svg>\n' % ((BOX, BOX, BOX, BOX, c, c, ang, SIZE) + rgb))


def main():
    with open(os.path.join(THEMES, 'jazz-age-keys.svg'), 'w') as f:
        f.write(keys())
    with open(os.path.join(THEMES, 'jazz-age-stage.svg'), 'w') as f:
        f.write(stage())
    wide = dict(W=1440, H=900, LAMPS=WIDE_LAMPS, LAMP_Y=WIDE_LAMP_Y)
    wide_light = dict(wide, AMBIENT=('#3A302C', '#1A1412'), HOLD=0.8)
    for side, (lx, ax, spread, rgb, a) in zip(('left', 'right', 'center'), WIDE_LAMPS):
        with open(os.path.join(THEMES, 'jazz-age-lens-%s.svg' % side), 'w') as f:
            f.write(lens(lx, ax, rgb))
    for name, draw in (('curtain', curtain), ('lock', lock_light), ('lamps', lamps),
                       ('curtain-lit', lambda: curtain(LIT_FOLDS)),
                       ('lock-wide', lambda: lock_light(**wide_light))):
        with open(os.path.join(THEMES, 'jazz-age-%s.svg' % name), 'w') as f:
            f.write(draw())


if __name__ == '__main__':
    main()
