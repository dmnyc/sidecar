"""Draws Sleepy Hollow's night. Run from the repo root:

    python3 scripts/gen-sleepy-hollow.py

Writes, in themes/:

  sleepy-hollow-sky.svg      the top of the panel: a harvest moon behind the bare limbs of
                             the great tulip tree, and a few late leaves on the wind.
  sleepy-hollow-clouds.svg   the clouds on their own transparent plate, the sky's exact
                             frame, so the lock screen can drift them (repeat-x, drawn
                             wrapped) without moving the moon.
  sleepy-hollow-hollow.svg   the foot of the panel: the hills of the Hollow with the old
                             Dutch church on its churchyard knoll, gravestones in the
                             foreground, and the Horseman riding the ridge with his
                             pumpkin alight.
  sleepy-hollow-*-wide.svg   the same three in a wider frame for the expanded composer and
                             any window past a side panel's width — 900 units, so its
                             elements render larger than the panel's at the same width.

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
# A limb is drawn in two segments with opposed bends — the gnarl of an old tree, not a
# smooth arc — each stroke thinner than the one before it, so the tree tapers from trunk
# to twig the way an engraver's line does. One dominant continuation with a branch
# leaving it, rarely a third, and a claw of twigs at the tips: what winter leaves.

def limb(o, rnd, x, y, ang, length, width, depth, droop=0.05):
    if depth == 0 or length < 3 or width < 0.35:
        return
    b1 = rnd.uniform(-0.4, 0.4)
    b2 = -b1 * rnd.uniform(0.6, 1.4) + rnd.uniform(-0.18, 0.18)
    l1 = length * rnd.uniform(0.45, 0.6)
    mx = x + math.cos(ang + b1) * l1
    my = y + math.sin(ang + b1) * l1
    ang2 = ang + b1 + b2
    ex = x + math.cos(ang2) * length
    ey = y + math.sin(ang2) * length + droop * length
    c1x = x + math.cos(ang) * l1 * 0.55
    c1y = y + math.sin(ang) * l1 * 0.55
    c2x = mx + math.cos(ang + b1) * (length - l1) * 0.55
    c2y = my + math.sin(ang + b1) * (length - l1) * 0.55
    o.append('<path d="M%s %sQ%s %s %s %s" stroke-width="%s"/>'
             % (f(x), f(y), f(c1x), f(c1y), f(mx), f(my), f(width)))
    o.append('<path d="M%s %sQ%s %s %s %s" stroke-width="%s"/>'
             % (f(mx), f(my), f(c2x), f(c2y), f(ex), f(ey), f(width * 0.68)))
    if depth <= 2 and length < 14:
        for _ in range(3):
            ta = ang2 + rnd.uniform(-0.45, 0.45)
            tl = length * rnd.uniform(0.3, 0.55)
            o.append('<path d="M%s %sL%s %s" stroke-width="0.6"/>'
                     % (f(ex), f(ey), f(ex + math.cos(ta) * tl), f(ey + math.sin(ta) * tl)))
        return
    limb(o, rnd, ex, ey, ang2 + rnd.uniform(-0.2, 0.2),
         length * rnd.uniform(0.68, 0.78), width * rnd.uniform(0.6, 0.68), depth - 1, droop)
    limb(o, rnd, ex, ey, ang2 + rnd.uniform(0.4, 0.85) * (1 if rnd.random() < 0.5 else -1),
         length * rnd.uniform(0.5, 0.62), width * rnd.uniform(0.45, 0.55), depth - 1, droop)
    if rnd.random() < 0.25:
        limb(o, rnd, ex, ey, ang2 - rnd.uniform(0.35, 0.8) * (1 if rnd.random() < 0.5 else -1),
             length * rnd.uniform(0.4, 0.5), width * 0.45, depth - 1, droop)


def tree(rnd, x, y, ang, length, width, depth, droop=0.05, flip=False):
    # flip grows the same tree the other way: the recursion has a handedness (its first
    # fork always turns the same side), so without it every tree gestured alike.
    o = ['<g fill="none" stroke="%s" stroke-linecap="round">' % INK]
    if flip:
        o.append('<g transform="translate(%s 0) scale(-1 1)">' % f(2 * x))
    limb(o, rnd, x, y, ang, length, width, depth, droop)
    if flip:
        o.append('</g>')
    o.append('</g>')
    return ''.join(o)


# ---- the Horseman ----------------------------------------------------------------------
# The figure is one filled silhouette: the horse in the flying gallop of nineteenth-century
# prints, the headless rider leaning into the chase with his cloak streaming and his arm up,
# the pumpkin the one lit thing on him. Cutouts (the mane from the neck, the cloak from the
# body, the legs from each other) are holes in the compound path, so the night shows through
# them the way the engravers' white paper did. Drawn facing right with the ground at y = 0
# and placed on the near ridge; flip mirrors it. The rider and horse were drawn by hand
# against a reference, then simplified to what reads at panel scale; the pumpkin is drawn
# freehand so it can glow.

HORSEMAN_INK = (
  'M159.0 -183.0C157.0 -183.8 156.8 -180.8 154.0 -181.0C151.2 -181.2 144.7 -184.0 142.0 -184.0C139.'
  '3 -184.0 139.0 -183.7 138.0 -181.0C137.0 -178.3 135.0 -171.5 136.0 -168.0C137.0 -164.5 144.5 -16'
  '3.3 144.0 -160.0C143.5 -156.7 136.8 -148.8 133.0 -148.0C129.2 -147.2 122.2 -153.5 121.0 -155.0C1'
  '19.8 -156.5 126.5 -155.7 126.0 -157.0C125.5 -158.3 119.7 -162.3 118.0 -163.0C116.3 -163.7 116.3 '
  '-160.3 116.0 -161.0C115.7 -161.7 117.7 -165.3 116.0 -167.0C114.3 -168.7 113.5 -173.3 106.0 -171.'
  '0C98.5 -168.7 82.0 -155.7 71.0 -153.0C60.0 -150.3 48.3 -155.8 40.0 -155.0C31.7 -154.2 25.2 -150.'
  '8 21.0 -148.0C16.8 -145.2 16.3 -141.5 15.0 -138.0C13.7 -134.5 9.7 -126.5 13.0 -127.0C16.3 -127.5'
  ' 26.2 -138.3 35.0 -141.0C43.8 -143.7 56.2 -139.3 66.0 -143.0C75.8 -146.7 88.0 -159.7 94.0 -163.0'
  'C100.0 -166.3 99.3 -163.8 102.0 -163.0C104.7 -162.2 111.5 -158.5 110.0 -158.0C108.5 -157.5 100.0'
  ' -162.8 93.0 -160.0C86.0 -157.2 76.2 -144.3 68.0 -141.0C59.8 -137.7 50.7 -141.0 44.0 -140.0C37.3'
  ' -139.0 28.7 -137.8 28.0 -135.0C27.3 -132.2 35.2 -124.2 40.0 -123.0C44.8 -121.8 55.0 -127.8 57.0'
  ' -128.0C59.0 -128.2 52.3 -126.0 52.0 -124.0C51.7 -122.0 53.2 -116.5 55.0 -116.0C56.8 -115.5 58.5'
  ' -119.8 63.0 -121.0C67.5 -122.2 77.0 -121.0 82.0 -123.0C87.0 -125.0 91.0 -129.8 93.0 -133.0C95.0'
  ' -136.2 93.3 -143.0 94.0 -142.0C94.7 -141.0 97.5 -131.3 97.0 -127.0C96.5 -122.7 92.7 -117.3 91.0'
  ' -116.0C89.3 -114.7 87.8 -120.2 87.0 -119.0C86.2 -117.8 88.5 -110.5 86.0 -109.0C83.5 -107.5 76.5'
  ' -110.8 72.0 -110.0C67.5 -109.2 63.8 -104.8 59.0 -104.0C54.2 -103.2 47.2 -105.5 43.0 -105.0C38.8'
  ' -104.5 35.8 -102.0 34.0 -101.0C32.2 -100.0 31.7 -99.3 32.0 -99.0C32.3 -98.7 37.2 -100.5 36.0 -9'
  '9.0C34.8 -97.5 29.2 -91.8 25.0 -90.0C20.8 -88.2 12.0 -89.2 11.0 -88.0C10.0 -86.8 20.7 -83.8 19.0'
  ' -83.0C17.3 -82.2 2.8 -84.2 1.0 -83.0C-0.8 -81.8 5.2 -77.3 8.0 -76.0C10.8 -74.7 17.5 -75.7 18.0 '
  '-75.0C18.5 -74.3 11.8 -72.7 11.0 -72.0C10.2 -71.3 10.2 -70.7 13.0 -71.0C15.8 -71.3 24.2 -72.0 28'
  '.0 -74.0C31.8 -76.0 35.2 -83.0 36.0 -83.0C36.8 -83.0 32.3 -74.3 33.0 -74.0C33.7 -73.7 38.2 -77.8'
  ' 40.0 -81.0C41.8 -84.2 41.8 -90.2 44.0 -93.0C46.2 -95.8 52.3 -99.2 53.0 -98.0C53.7 -96.8 49.3 -9'
  '2.0 48.0 -86.0C46.7 -80.0 47.8 -67.5 45.0 -62.0C42.2 -56.5 34.5 -58.3 31.0 -53.0C27.5 -47.7 26.3'
  ' -35.5 24.0 -30.0C21.7 -24.5 19.5 -21.8 17.0 -20.0C14.5 -18.2 10.5 -20.8 9.0 -19.0C7.5 -17.2 5.2'
  ' -9.2 8.0 -9.0C10.8 -8.8 21.5 -12.8 26.0 -18.0C30.5 -23.2 32.0 -35.0 35.0 -40.0C38.0 -45.0 38.3 '
  '-44.8 44.0 -48.0C49.7 -51.2 63.0 -54.7 69.0 -59.0C75.0 -63.3 78.2 -72.5 80.0 -74.0C81.8 -75.5 76'
  '.0 -70.2 80.0 -68.0C84.0 -65.8 99.2 -57.7 104.0 -61.0C108.8 -64.3 107.5 -82.5 109.0 -88.0C110.5 '
  '-93.5 113.5 -98.8 113.0 -94.0C112.5 -89.2 105.3 -65.7 106.0 -59.0C106.7 -52.3 113.7 -54.5 117.0 '
  '-54.0C120.3 -53.5 125.3 -54.2 126.0 -56.0C126.7 -57.8 122.7 -64.8 121.0 -65.0C119.3 -65.2 117.3 '
  '-58.3 116.0 -57.0C114.7 -55.7 111.8 -53.8 113.0 -57.0C114.2 -60.2 121.3 -74.8 123.0 -76.0C124.7 '
  '-77.2 122.0 -67.2 123.0 -64.0C124.0 -60.8 126.7 -58.0 129.0 -57.0C131.3 -56.0 135.8 -56.2 137.0 '
  '-58.0C138.2 -59.8 135.5 -68.2 136.0 -68.0C136.5 -67.8 135.3 -60.3 140.0 -57.0C144.7 -53.7 159.2 '
  '-50.3 164.0 -48.0C168.8 -45.7 169.5 -45.7 169.0 -43.0C168.5 -40.3 163.3 -34.5 161.0 -32.0C158.7 '
  '-29.5 157.2 -28.0 155.0 -28.0C152.8 -28.0 150.3 -32.8 148.0 -32.0C145.7 -31.2 138.3 -24.3 141.0 '
  '-23.0C143.7 -21.7 157.8 -20.8 164.0 -24.0C170.2 -27.2 175.8 -37.8 178.0 -42.0C180.2 -46.2 181.2 '
  '-45.0 177.0 -49.0C172.8 -53.0 156.5 -62.8 153.0 -66.0C149.5 -69.2 149.8 -71.7 156.0 -68.0C162.2 '
  '-64.3 183.5 -50.7 190.0 -44.0C196.5 -37.3 193.5 -31.2 195.0 -28.0C196.5 -24.8 198.7 -26.7 199.0 '
  '-25.0C199.3 -23.3 196.3 -20.0 197.0 -18.0C197.7 -16.0 201.0 -13.8 203.0 -13.0C205.0 -12.2 210.8 '
  '-6.0 209.0 -13.0C207.2 -20.0 198.0 -45.8 192.0 -55.0C186.0 -64.2 176.8 -66.0 173.0 -68.0C169.2 -'
  '70.0 168.5 -64.8 169.0 -67.0C169.5 -69.2 175.0 -77.5 176.0 -81.0C177.0 -84.5 175.7 -87.3 175.0 -'
  '88.0C174.3 -88.7 172.7 -85.0 172.0 -85.0C171.3 -85.0 169.8 -84.7 171.0 -88.0C172.2 -91.3 173.7 -'
  '101.7 179.0 -105.0C184.3 -108.3 198.3 -108.5 203.0 -108.0C207.7 -107.5 205.7 -103.0 207.0 -102.0'
  'C208.3 -101.0 209.3 -101.8 211.0 -102.0C212.7 -102.2 215.5 -101.8 217.0 -103.0C218.5 -104.2 222.'
  '5 -102.5 220.0 -109.0C217.5 -115.5 204.5 -134.8 202.0 -142.0C199.5 -149.2 205.3 -151.0 205.0 -15'
  '2.0C204.7 -153.0 201.0 -147.5 200.0 -148.0C199.0 -148.5 200.5 -155.0 199.0 -155.0C197.5 -155.0 1'
  '94.0 -148.3 191.0 -148.0C188.0 -147.7 183.3 -152.3 181.0 -153.0C178.7 -153.7 177.0 -152.7 177.0 '
  '-152.0C177.0 -151.3 183.0 -149.0 181.0 -149.0C179.0 -149.0 167.0 -152.3 165.0 -152.0C163.0 -151.'
  '7 170.7 -148.0 169.0 -147.0C167.3 -146.0 157.7 -146.5 155.0 -146.0C152.3 -145.5 151.8 -144.5 153'
  '.0 -144.0C154.2 -143.5 162.5 -143.8 162.0 -143.0C161.5 -142.2 152.3 -140.0 150.0 -139.0C147.7 -1'
  '38.0 147.3 -137.3 148.0 -137.0C148.7 -136.7 153.8 -137.7 154.0 -137.0C154.2 -136.3 151.2 -133.7 '
  '149.0 -133.0C146.8 -132.3 141.3 -133.7 141.0 -133.0C140.7 -132.3 147.0 -130.3 147.0 -129.0C147.0'
  ' -127.7 143.0 -124.5 141.0 -125.0C139.0 -125.5 139.2 -129.8 135.0 -132.0C130.8 -134.2 119.5 -138'
  '.7 116.0 -138.0C112.5 -137.3 112.3 -129.7 114.0 -128.0C115.7 -126.3 121.8 -129.5 126.0 -128.0C13'
  '0.2 -126.5 138.0 -121.3 139.0 -119.0C140.0 -116.7 133.0 -113.8 132.0 -114.0C131.0 -114.2 133.5 -'
  '119.0 133.0 -120.0C132.5 -121.0 130.7 -121.3 129.0 -120.0C127.3 -118.7 125.2 -113.3 123.0 -112.0'
  'C120.8 -110.7 119.0 -113.5 116.0 -112.0C113.0 -110.5 108.5 -104.3 105.0 -103.0C101.5 -101.7 91.7'
  ' -101.5 95.0 -104.0C98.3 -106.5 122.0 -114.7 125.0 -118.0C128.0 -121.3 114.2 -122.7 113.0 -124.0'
  'C111.8 -125.3 119.5 -125.0 118.0 -126.0C116.5 -127.0 107.7 -127.2 104.0 -130.0C100.3 -132.8 95.2'
  ' -142.8 96.0 -143.0C96.8 -143.2 106.2 -131.8 109.0 -131.0C111.8 -130.2 113.5 -136.2 113.0 -138.0'
  'C112.5 -139.8 106.8 -140.0 106.0 -142.0C105.2 -144.0 106.7 -150.3 108.0 -150.0C109.3 -149.7 112.'
  '0 -141.8 114.0 -140.0C116.0 -138.2 118.8 -137.2 120.0 -139.0C121.2 -140.8 120.5 -150.3 121.0 -15'
  '1.0C121.5 -151.7 120.7 -145.0 123.0 -143.0C125.3 -141.0 132.3 -139.0 135.0 -139.0C137.7 -139.0 1'
  '38.7 -141.7 139.0 -143.0C139.3 -144.3 136.5 -146.8 137.0 -147.0C137.5 -147.2 140.0 -142.3 142.0 '
  '-144.0C144.0 -145.7 145.3 -153.5 149.0 -157.0C152.7 -160.5 161.2 -161.8 164.0 -165.0C166.8 -168.'
  '2 166.8 -173.0 166.0 -176.0C165.2 -179.0 161.0 -182.2 159.0 -183.0ZM98.0 -118.0C94.0 -114.0 75.0'
  ' -94.0 70.0 -88.0C65.0 -82.0 67.7 -82.7 68.0 -82.0C68.3 -81.3 66.8 -78.8 72.0 -84.0C77.2 -89.2 9'
  '4.3 -107.7 99.0 -113.0C103.7 -118.3 100.7 -116.3 100.0 -116.0C99.3 -115.7 96.0 -111.7 95.0 -111.'
  '0C94.0 -110.3 93.5 -110.8 94.0 -112.0C94.5 -113.2 102.0 -122.0 98.0 -118.0ZM186.0 -132.0C185.5 -'
  '131.2 184.2 -128.5 184.0 -126.0C183.8 -123.5 185.5 -119.5 185.0 -117.0C184.5 -114.5 178.8 -112.0'
  ' 181.0 -111.0C183.2 -110.0 195.8 -110.5 198.0 -111.0C200.2 -111.5 195.5 -113.3 194.0 -114.0C192.'
  '5 -114.7 190.5 -114.2 189.0 -115.0C187.5 -115.8 185.7 -117.2 185.0 -119.0C184.3 -120.8 184.7 -12'
  '4.0 185.0 -126.0C185.3 -128.0 186.8 -130.0 187.0 -131.0C187.2 -132.0 186.5 -132.8 186.0 -132.0ZM'
  '122.0 -110.0C122.0 -109.7 127.8 -102.7 129.0 -100.0C130.2 -97.3 129.5 -95.7 129.0 -94.0C128.5 -9'
  '2.3 127.7 -90.3 126.0 -90.0C124.3 -89.7 119.7 -92.0 119.0 -92.0C118.3 -92.0 120.8 -90.3 122.0 -9'
  '0.0C123.2 -89.7 125.2 -90.3 126.0 -90.0C126.8 -89.7 128.5 -91.7 127.0 -88.0C125.5 -84.3 117.8 -6'
  '9.5 117.0 -68.0C116.2 -66.5 120.5 -76.5 122.0 -79.0C123.5 -81.5 124.7 -80.3 126.0 -83.0C127.3 -8'
  '5.7 129.5 -91.8 130.0 -95.0C130.5 -98.2 130.3 -99.5 129.0 -102.0C127.7 -104.5 122.0 -110.3 122.0'
  ' -110.0ZM137.0 -104.0C136.3 -104.2 150.3 -97.2 155.0 -94.0C159.7 -90.8 163.3 -86.2 165.0 -85.0C1'
  '66.7 -83.8 166.0 -85.7 165.0 -87.0C164.0 -88.3 163.7 -90.2 159.0 -93.0C154.3 -95.8 137.7 -103.8 '
  '137.0 -104.0ZM87.0 -96.0C87.0 -93.8 84.7 -86.3 88.0 -84.0C91.3 -81.7 106.8 -81.8 107.0 -82.0C107'
  '.2 -82.2 92.2 -82.5 89.0 -85.0C85.8 -87.5 88.3 -95.2 88.0 -97.0C87.7 -98.8 87.0 -98.2 87.0 -96.0'
  'ZM133.0 -111.0C132.8 -111.2 133.7 -95.5 133.0 -91.0C132.3 -86.5 128.8 -84.2 129.0 -84.0C129.2 -8'
  '3.8 133.3 -85.5 134.0 -90.0C134.7 -94.5 133.2 -110.8 133.0 -111.0ZM190.0 -132.0C191.7 -129.3 201'
  '.7 -116.0 202.0 -116.0C202.3 -116.0 194.0 -129.3 192.0 -132.0C190.0 -134.7 188.3 -134.7 190.0 -1'
  '32.0ZM92.0 -156.0C91.8 -154.8 91.7 -151.5 92.0 -150.0C92.3 -148.5 92.3 -147.3 94.0 -147.0C95.7 -'
  '146.7 99.8 -147.2 102.0 -148.0C104.2 -148.8 106.2 -151.0 107.0 -152.0C107.8 -153.0 107.5 -154.3 '
  '107.0 -154.0C106.5 -153.7 105.2 -151.0 104.0 -150.0C102.8 -149.0 101.7 -148.3 100.0 -148.0C98.3 '
  '-147.7 95.3 -147.2 94.0 -148.0C92.7 -148.8 92.2 -151.5 92.0 -153.0C91.8 -154.5 93.0 -156.5 93.0 '
  '-157.0C93.0 -157.5 92.2 -157.2 92.0 -156.0ZM176.0 -141.0C176.5 -141.5 170.0 -138.3 167.0 -136.0C'
  '164.0 -133.7 158.5 -127.5 158.0 -127.0C157.5 -126.5 161.0 -130.7 164.0 -133.0C167.0 -135.3 175.5'
  ' -140.5 176.0 -141.0ZM108.0 -127.0C107.0 -126.3 102.8 -121.3 103.0 -121.0C103.2 -120.7 108.2 -12'
  '4.0 109.0 -125.0C109.8 -126.0 109.0 -127.7 108.0 -127.0ZM168.0 -85.0C167.5 -84.5 166.8 -81.8 167'
  '.0 -81.0C167.2 -80.2 168.5 -79.5 169.0 -80.0C169.5 -80.5 170.2 -83.2 170.0 -84.0C169.8 -84.8 168'
  '.5 -85.5 168.0 -85.0ZM199.0 -142.0C197.8 -141.8 194.2 -140.7 193.0 -140.0C191.8 -139.3 190.8 -13'
  '7.8 192.0 -138.0C193.2 -138.2 198.8 -140.3 200.0 -141.0C201.2 -141.7 200.2 -142.2 199.0 -142.0ZM'
  '167.0 -76.0C166.5 -75.3 164.0 -67.8 164.0 -67.0C164.0 -66.2 166.5 -69.5 167.0 -71.0C167.5 -72.5 '
  '167.5 -76.7 167.0 -76.0ZM104.0 -168.0C103.5 -168.2 105.7 -168.2 107.0 -167.0C108.3 -165.8 111.5 '
  '-161.2 112.0 -161.0C112.5 -160.8 111.3 -164.8 110.0 -166.0C108.7 -167.2 104.5 -167.8 104.0 -168.'
  '0ZM205.0 -114.0C204.2 -114.0 202.0 -113.0 202.0 -113.0C202.0 -113.0 204.2 -114.2 205.0 -114.0C20'
  '5.8 -113.8 207.2 -112.8 207.0 -112.0C206.8 -111.2 204.0 -109.3 204.0 -109.0C204.0 -108.7 206.5 -'
  '109.3 207.0 -110.0C207.5 -110.7 207.3 -112.3 207.0 -113.0C206.7 -113.7 205.8 -114.0 205.0 -114.0'
  'Z')

# The rider's leg hangs free below the knee (the stirrup boot), so it is its own shape.
LEG_INK = (
  'M81.0 -65.0C78.0 -65.5 78.7 -65.3 77.0 -64.0C75.3 -62.7 71.5 -59.0 71.0 -57.0C70.5 -55.0 74.5 -5'
  '5.5 74.0 -52.0C73.5 -48.5 66.0 -41.7 68.0 -36.0C70.0 -30.3 82.3 -22.2 86.0 -18.0C89.7 -13.8 88.2'
  ' -12.8 90.0 -11.0C91.8 -9.2 95.8 -8.7 97.0 -7.0C98.2 -5.3 95.0 -2.2 97.0 -1.0C99.0 0.2 107.3 0.8'
  ' 109.0 0.0C110.7 -0.8 111.7 -0.2 107.0 -6.0C102.3 -11.8 85.0 -29.0 81.0 -35.0C77.0 -41.0 80.7 -3'
  '7.7 83.0 -42.0C85.3 -46.3 95.3 -57.2 95.0 -61.0C94.7 -64.8 84.0 -64.5 81.0 -65.0Z')

# The pumpkin, lit: a ribbed body with a curved stem, drawn over the fist in the ember
# color on its halo, with the ribs in the ink. The one warm thing in the whole hollow.
PUMPKIN = ('M151 -180.5C146 -184 138 -183 134.5 -177C130.5 -170 130.5 -160 135 -153.5'
           'C139 -148 147 -146.5 151 -147C155 -146.5 163 -148 167 -153.5C171.5 -160 171.5 -170 167.5 -177'
           'C164 -183 156 -184 151 -180.5Z'
           'M149.5 -180C149 -184.5 151.5 -187.5 155 -188C153 -186 152.5 -183.5 153.5 -180.8Z')
PUMPKIN_RIBS = ['M143.5 -181.5C140 -172 140 -160 144 -150',
                'M158.5 -181.5C162 -172 162 -160 158 -150']
PUMPKIN_AT = (151, -166)   # the halo's center, a little below the body's middle
PUMPKIN_GLOW = 36


def horseman(x, y, s, flip=False):
    sx = -s if flip else s
    g = ['<g transform="translate(%s %s) scale(%s %s)">' % (f(x), f(y), f(sx), f(s)),
         '<circle cx="%s" cy="%s" r="%s" fill="url(#ember)"/>'
         % (f(PUMPKIN_AT[0]), f(PUMPKIN_AT[1]), f(PUMPKIN_GLOW)),
         '<path d="%s" fill="%s" fill-rule="evenodd"/>' % (LEG_INK, INK),
         '<path d="%s" fill="%s" fill-rule="evenodd"/>' % (HORSEMAN_INK, INK),
         '<path d="%s" fill="%s"/>' % (PUMPKIN, EMBER)]
    for rib in PUMPKIN_RIBS:
        g.append('<path d="%s" fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round"/>'
                 % (rib, INK))
    g.append('</g>')
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


def moon_geo(w):
    # Where the moon sits, shared by the sky plate and the cloud plate so the wisps
    # cross the same disc. The narrow frame keeps it below the chrome: the moon's top
    # edge starts at or just under the tab bar's top edge and its bulk hangs in the
    # content sky beneath — nothing reaches up into the icon row, and the arc never
    # kisses a bar edge at any panel width. It stays wholly inside the top band the
    # gallery's card crops to (the first 175 units). The wide frame keeps its own
    # clearance at a composer's widths.
    narrow = w < 600
    return (38 if narrow else 64), (w - 82 if narrow else w * 0.8), (105 if narrow else 155)


def clouds(rnd, w, mx, my, mr, blur):
    # Long, low wisps, stacked in banks: soft-edged (a gaussian blur, which is why the
    # plate carries a filter) and drawn three times each, at x, x-w and x+w, so the layer
    # tiles seamlessly when the lock screen pans it. The first two banks cross the moon's
    # disc. No bright under-strokes: the softness is the whole remark.
    narrow = w < 600
    # The blur runs in sRGB: linearRGB, the filter default, warms the soft edges.
    # The ink is a slate with almost no violet in it, and thick enough that the moon's
    # warm halo behind a wisp cannot tint it — near the disc and away from it, the same
    # desaturated grey.
    o = ['<filter id="cloudsoft" x="-60%" y="-500%" width="220%" height="1200%" color-interpolation-filters="sRGB">'
         '<feGaussianBlur stdDeviation="' + f(blur) + '"/></filter>',
         '<g filter="url(#cloudsoft)">']

    def lens(x, y, L, T, op):
        for dx in (-w, 0, w):
            o.append('<path d="M%s %sQ%s %s %s %sQ%s %s %s %sZ" fill="#13151B" fill-opacity="%s"/>'
                     % (f(x - L + dx), f(y), f(x - L * 0.2 + dx), f(y - T * 2.4), f(x + L + dx), f(y),
                        f(x + L * 0.1 + dx), f(y + T * 0.8), f(x - L + dx), f(y), f(op)))

    n = 3 if narrow else 6
    for i in range(n):
        if i < 2:
            x = mx + rnd.uniform(-mr * 0.9, mr * 0.5)
            y = my + rnd.uniform(-mr * 0.3, mr * 0.4)
            L = rnd.uniform(mr * 0.8, mr * 1.5)
        else:
            x = rnd.uniform(w * 0.05, w * 0.95)
            y = my + rnd.uniform(-mr * 0.8, mr * 1.1)
            L = rnd.uniform(w * 0.05, w * 0.11)
        T = rnd.uniform(4.5, 9)
        lens(x, y, L, T, rnd.uniform(0.72, 0.84))
        # a thinner wisp riding above, as clouds travel in banks
        lens(x + L * rnd.uniform(-0.4, 0.4), y - T * rnd.uniform(1.4, 2.0),
             L * rnd.uniform(0.45, 0.65), T * 0.85, rnd.uniform(0.48, 0.6))
    o.append('</g>')
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


def gravestone(x, y, s, tilt=0.0, tall=False, sx=1.0):
    # A churchyard stone: a weathered slab, round-shouldered or tall and narrow, leaning
    # as the soil has shifted under it — tilt is radians here and degrees on the way into
    # the transform, which is SVG's unit and was quietly flattening every lean. Deliberately
    # nondescript — nothing on any of them names a faith.
    if tall:
        body = '<path d="M0.4 0V-7.6Q0.4 -10.4 2.2 -10.4Q4 -10.4 4 -7.6V0Z"/>'
    else:
        body = '<path d="M0 0V-6.4Q0 -9.2 2.5 -9.2Q5 -9.2 5 -6.4V0Z"/>'
    return ('<g transform="translate(%s %s) rotate(%s) scale(%s %s)" fill="%s">%s</g>'
            % (f(x), f(y), f(math.degrees(tilt)), f(s * sx), f(s), INK, body))


def graves(rnd, x0, x1, pts, n, minsep):
    # A few stones along one stretch of a ridge: varied in height and breadth, leaning
    # ten to eighteen degrees either way (one or two further, as stones go), sunk to
    # different depths — kept apart, a churchyard and not a picket line.
    o = []
    taken = []
    tries = 0
    while len(taken) < n and tries < 60:
        tries += 1
        gx = rnd.uniform(x0, x1)
        if any(abs(gx - t) < minsep for t in taken):
            continue
        taken.append(gx)
        lean = rnd.uniform(-0.28, 0.28) if rnd.random() < 0.7 else rnd.uniform(-0.38, 0.38)
        o.append(gravestone(gx, ridge_y(pts, gx) + rnd.uniform(0.8, 2.4),
                            rnd.uniform(1.2, 2.2), lean, tall=rnd.random() < 0.4,
                            sx=rnd.uniform(0.8, 1.25)))
    return ''.join(o)


def fence(x0, x1, pts, step=17):
    # A post-and-rail fence running along the ground line: the bridge's fencing carrying
    # on along the road, so the span reads as a crossing and not a toy. Posts stand every
    # `step`, a lightly sagging rail runs through their tops.
    xs = []
    x = x0
    while x <= x1:
        xs.append(x)
        x += step
    if not xs:
        return ''
    o = ['<g stroke="%s" fill="none" stroke-linecap="round">' % INK]
    tops = []
    for px in xs:
        gy = ridge_y(pts, px)
        o.append('<path d="M%s %sV%s" stroke-width="1.6"/>' % (f(px), f(gy - 6), f(gy + 1.5)))
        tops.append((px, gy - 6))
    d = 'M%s %s' % (f(tops[0][0]), f(tops[0][1]))
    for (ax, ay), (bx_, by_) in zip(tops, tops[1:]):
        d += 'Q%s %s %s %s' % (f((ax + bx_) / 2), f((ay + by_) / 2 + 0.9), f(bx_), f(by_))
    o.append('<path d="%s" stroke-width="1.2"/>' % d)
    o.append('</g>')
    return ''.join(o)


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
    # A few late leaves on the wind, rust and ochre, faint: they are weather, not
    # ornament. The plate is a still layer everywhere; on the lock screen the leaves
    # come loose and fall (sidepanel.html's .lock-leaves, sleepy-hollow.css).
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


def leaves_plate(w, h, seed):
    # The leaves on their own transparent plate, the sky's exact frame, so they can stand
    # down on the lock screen while the falling ones take over.
    rnd = random.Random(seed)
    return svg(w, h, [leaves(rnd, w, h, 8 if w < 600 else 30)])


def sky(w, h, seed):
    # The top of the frame: the moon and the great tulip tree leaning in with its limbs
    # across the sky. In the tale it stood in the middle of the road and the country
    # people would not pass it after dark. Pinned to the top of the panel, so the moon is
    # always just under the tab bar, where no label sits on it, and rises behind whatever
    # card comes first. The clouds are their own plate (clouds(), below), so the lock
    # screen can drift them without moving the moon.
    rnd = random.Random(seed)
    narrow = w < 600
    o = [defs()]
    mr, mx, my = moon_geo(w)
    o.append(moon(mx, my, mr))
    o.append(tree(random.Random(seed + 1), -14, h * 0.62, -1.05, h * 0.26 if narrow else h * 0.22, 22, 8, 0.04))
    if not narrow:
        o.append(tree(random.Random(seed + 2), w + 10, h * 0.66, -2.05, h * 0.2, 20, 8, 0.04))
    return svg(w, h, o)


def clouds_plate(w, h, seed):
    # The clouds, on a transparent plate of the sky's exact frame, so they sit in the same
    # place over the moon and can be panned by the lock screen without moving anything
    # else. The layer is tiled repeat-x and the wisps are drawn wrapped, so the pan is
    # seamless at any panel width.
    rnd = random.Random(seed)
    mr, mx, my = moon_geo(w)
    return svg(w, h, [clouds(rnd, w, mx, my, mr, 2.2 if w < 600 else 4.5)])


def hollow(w, h, seed):
    # The foot of the frame: the far ridge with its grove and the old Dutch church on its
    # churchyard knoll, mist over the brook, and the near ridge with the bridge, a
    # churchyard's worth of gravestones, and the Horseman. Pinned to the bottom. The
    # church, the graves and the Horseman are kept clear of the trees on either ridge,
    # since a silhouette crossing a silhouette is just a larger blot.
    rnd = random.Random(seed)
    narrow = w < 600
    o = [defs()]
    # The church stands on its own knoll of the far ridge, a quarter of the frame in from
    # one side — small, high, and alone, the way the prints draw it — with two of its
    # gravestones beside it to seat it, and the Horseman riding the near ridge below on
    # the other side, clear of the compose button that sits over the bottom right corner.
    cx = w * (0.7 if narrow else 0.24)
    hx = w * (0.08 if narrow else 0.76)
    hs = 0.6 if narrow else 0.8
    # The foreground gravestones: one graveyard, clustered on the right of the near
    # ridge — stones gathered close, the way a burial ground reads, not scattered singly.
    gy0, gy1 = (274, 352) if narrow else (0.864 * w, 0.974 * w)
    gcount, gsep = (5, 15) if narrow else (7, 24)
    clear = [(cx - 70, cx + 70), (hx - 15, hx + 226 * hs), (gy0 - 10, gy1 + 10)]
    free = lambda x: all(not (a <= x <= b) for a, b in clear)
    # The ridges draw from their own streams, not the trees': a hill line must not move
    # because a keep-clear interval changed which trees were placed on it — that is how
    # the pumpkin wandered out from under its candle.
    far, far_pts = hills(random.Random(seed + 21), w, h, h * 0.5, h * 0.12, FAR, 0.4)
    o.append(far)
    for _ in range(10 if narrow else 18):
        tx = rnd.uniform(0, w)
        if not free(tx):
            continue
        o.append(tree(random.Random(rnd.randint(0, 10 ** 6)), tx, ridge_y(far_pts, tx) + 2,
                      -math.pi / 2 + rnd.uniform(-0.15, 0.15), rnd.uniform(9, 16), 2.4, 5, 0.0,
                      flip=rnd.random() < 0.5)
                 .replace(INK, GROVE))
    ky = ridge_y(far_pts, cx)
    # The church on its knoll: the same broad bump of the far ridge the theme has always
    # had, tall enough that its crest runs an inch past the nave's floor, so the church
    # sits in the hillside and nothing floats — and no nearer landform is needed, which
    # read as a road running into the distance. Its two stones stand on the crest.
    # The church is drawn before its knoll, so the hill's curved crest passes in front
    # of the nave's floor: the base line is the hillside's curve, not a straight edge.
    o.append(church(cx, ky - 7.5, 0.85 if narrow else 1.1, INK))
    o.append('<path d="M%s %sQ%s %s %s %sZ" fill="%s"/>'
             % (f(cx - 78), f(ky + 4), f(cx - 6), f(ky - 25), f(cx + 78), f(ky + 4), FAR))
    o.append('<rect x="0" y="%s" width="%s" height="%s" fill="url(#mist)"/>' % (f(h * 0.38), f(w), f(h * 0.4)))
    near, near_pts = hills(random.Random(seed + 22), w, h, h * 0.8, h * 0.1, INK, 2.2)
    o.append(near)
    # The bridge, bigger so its posts read, and its fence carrying on along the road on
    # either side where there is room. The fence's stretch is kept clear of the trees.
    bx = w * (0.64 if narrow else 0.3)
    bs = 1.1 if narrow else 1.5
    o.append(bridge(bx, ridge_y(near_pts, bx + 30) + 7, bs))
    fl0, fl1 = (bx - 30 * bs - 46, bx - 30 * bs - 2) if narrow else (bx - 30 * bs - 140, bx - 30 * bs - 2)
    fr0, fr1 = (0, 0) if narrow else (bx + 30 * bs + 2, bx + 30 * bs + 46)
    clear.append((fl0 - 8, ((fr1 or fl1) if not narrow else bx + 30 * bs) + 8))
    o.append(fence(fl0, fl1, near_pts))
    if not narrow:
        o.append(fence(fr0, fr1, near_pts))
    for _ in range(5 if narrow else 9):
        tx = rnd.uniform(0, w)
        if not free(tx):
            continue
        o.append(tree(random.Random(rnd.randint(0, 10 ** 6)), tx, ridge_y(near_pts, tx) + 3,
                      -math.pi / 2 + rnd.uniform(-0.2, 0.2), rnd.uniform(16, 28), 3.6, 6, 0.02,
                      flip=rnd.random() < 0.5))
    # Gnarly trees set round the graveyard, deliberate rather than left to chance, and
    # big enough to read as trees: one leaning over it from each end, rising from behind
    # the stones (they are drawn first, so the stones sit in front of the trunk), and a
    # stand of the far grove behind it on the ridge above. A tree clipped by the frame
    # reads as a stump — nothing leans in from an edge here.
    if narrow:
        o.append(tree(random.Random(11), bx + 30 * bs + 5, ridge_y(near_pts, bx + 30 * bs + 5) + 3,
                      -math.pi / 2 + 0.14, 26, 4.2, 7, 0.04, flip=True))
        o.append(tree(random.Random(15), 345, ridge_y(near_pts, 345) + 3,
                      -math.pi / 2 - 0.08, 24, 4, 6, 0.06))
        o.append(tree(random.Random(12), 336, ridge_y(far_pts, 336) + 2,
                      -math.pi / 2 - 0.08, 17, 3, 6, 0.0, flip=True).replace(INK, GROVE))
    else:
        o.append(tree(random.Random(11), 0.86 * w, ridge_y(near_pts, 0.86 * w) + 3,
                      -math.pi / 2 + 0.16, 28, 4.2, 7, 0.05, flip=True))
        o.append(tree(random.Random(15), 0.977 * w, ridge_y(near_pts, 0.977 * w) + 3,
                      -math.pi / 2 - 0.06, 30, 4.4, 7, 0.03))
        o.append(tree(random.Random(13), 0.879 * w, ridge_y(far_pts, 0.879 * w) + 2,
                      -math.pi / 2 + 0.06, 20, 3.2, 6, 0.0).replace(INK, GROVE))
        o.append(tree(random.Random(14), 0.947 * w, ridge_y(far_pts, 0.947 * w) + 2,
                      -math.pi / 2 - 0.1, 21, 3.2, 6, 0.0, flip=True).replace(INK, GROVE))
        o.append(tree(random.Random(15), 0.914 * w, ridge_y(far_pts, 0.914 * w) + 2,
                      -math.pi / 2 + 0.12, 19, 3.1, 6, 0.0).replace(INK, GROVE))
    o.append(graves(rnd, gy0, gy1, near_pts, gcount, gsep))
    o.append(horseman(hx, ridge_y(near_pts, hx + 110 * hs) - 4 * hs, hs))
    return svg(w, h, o)


def main():
    files = {
        'sleepy-hollow-sky.svg': sky(360, 420, 1790),
        'sleepy-hollow-clouds.svg': clouds_plate(360, 420, 1793),
        'sleepy-hollow-leaves.svg': leaves_plate(360, 420, 1794),
        'sleepy-hollow-hollow.svg': hollow(360, 170, 1820),
        'sleepy-hollow-sky-wide.svg': sky(900, 356, 1790),
        'sleepy-hollow-clouds-wide.svg': clouds_plate(900, 356, 1793),
        'sleepy-hollow-leaves-wide.svg': leaves_plate(900, 356, 1794),
        'sleepy-hollow-hollow-wide.svg': hollow(900, 210, 1820),
    }
    for name, body in files.items():
        with open(os.path.join(THEMES, name), 'w') as fh:
            fh.write(body)
        print('wrote themes/%s (%d bytes)' % (name, len(body)))


if __name__ == '__main__':
    main()
