"""Draws Speakeasy's wall. Run from the repo root:

    python3 scripts/gen-speakeasy.py

Writes themes/speakeasy-quilt.svg: diamond-quilted velvet, a booth's wall. Each diamond is
a padded panel, lit faintly in its middle and falling to a crease along every seam, with a
row of lavender stitches on either side of it, the double stitching of quilted upholstery.
No buttons and no shine: the gold is kept for the wallet and the accents, never the wall.

THE BRIGHTNESS IS A MEASURED CEILING, NOT A DESIGN VALUE. Hints in Settings sit on the wall
with no surface of their own, so the thread and the padding come straight out of their
contrast (test/theme-svg-assets.test.js): THREAD keeps --muted at AA and --faint at 3:1
where a hint crosses a stitch, and PAD keeps --muted at AA where a padded middle sits
under the top glow.
"""

import math
import os

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'themes', 'speakeasy-quilt.svg')

W, H = 40, 56            # one diamond, taller than wide, as tufting is cut
THREAD = '#bda1ff'       # --lav
THREAD_ALPHA = 0.14      # the ceiling: --muted 5.24 and --faint 3.04 on a stitch over --bg
PAD_ALPHA = 0.03         # the ceiling: --muted 4.64 on a padded middle under the top glow
CREASE_ALPHA = 0.42
INSET = 1.7              # the stitches' distance from the seam
STITCHES = 8             # whole stitches per side, so each side ends on one


def diamond(cx, cy, a, b):
    return 'M%.2f %.2f L%.2f %.2f L%.2f %.2f L%.2f %.2f Z' % (
        cx, cy - b, cx + a, cy, cx, cy + b, cx - a, cy)


def main():
    a, b = W / 2, H / 2
    # Every diamond the tile shows: its own, and the four whose corners meet in it.
    centers = [(20, 28), (0, 0), (40, 0), (0, 56), (40, 56)]
    scale = 1 - INSET / (a * b / math.hypot(a, b))
    side = math.hypot(a * scale, b * scale) / STITCHES
    dash = '%.2f %.2f' % (side * 0.58, side * 0.42)
    pads = ''.join('<path d="%s" fill="url(#pad)"/>' % diamond(cx, cy, a, b) for cx, cy in centers)
    crease = ('<path d="%s" fill="none" stroke="#000000" stroke-opacity="%s" stroke-width="1"/>'
              % (diamond(20, 28, a, b), CREASE_ALPHA))
    # One group opacity over every stitch, so two rows can never stack into a brighter one.
    stitches = ''.join(
        '<path d="%s" fill="none" stroke="%s" stroke-width="0.7" stroke-dasharray="%s" stroke-linecap="round"/>'
        % (diamond(cx, cy, a * scale, b * scale), THREAD, dash) for cx, cy in centers)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
        '<defs><radialGradient id="pad" cx="0.5" cy="0.45" r="0.62">'
        '<stop offset="0" stop-color="%s" stop-opacity="%s"/>'
        '<stop offset="0.65" stop-color="%s" stop-opacity="%.3f"/>'
        '<stop offset="1" stop-color="#000000" stop-opacity="0.2"/></radialGradient></defs>'
        '%s%s<g opacity="%s">%s</g></svg>\n'
    ) % (W, H, W, H, THREAD, PAD_ALPHA, THREAD, PAD_ALPHA / 4, pads, crease, THREAD_ALPHA, stitches)
    with open(OUT, 'w') as f:
        f.write(svg)


if __name__ == '__main__':
    main()
