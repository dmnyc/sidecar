"""Lays out Phantom Bouquet's skeleton leaves. Run from the repo root:

    python3 scripts/gen-phantom-bouquet.py            # the plates, from the cut leaves
    python3 scripts/gen-phantom-bouquet.py --cut      # first re-cut the leaves (needs scipy)

THE LEAVES ARE ASTRA'S, not drawn here. The approved studies in docs/phantom-bouquet/
(the maple lace study, the companion plate and the oak) are brown-on-ivory rasters. --cut
lifts each leaf off its paper once, into assets/phantom-bouquet/<leaf>.png: the paper is
measured locally (a max filter over the plate, since the studies are faintly vignetted),
every pixel's darkness against it becomes alpha, and the ink is recovered by
un-compositing it from that paper. Nothing is redrawn, traced or simplified, so every vein
the study has is in the cut, at the study's full 1254px resolution. The companion plate is
split into its four leaves by connected silhouette. assets/ is not packaged; the cut
leaves are the production masters the plates below are made from.

Writes, in themes/:

  phantom-bouquet-weave.webp       the linen's plain weave, a small tile.
  phantom-bouquet-top.webp         the head of the panel: one whole madder-dyed leaf
                                   in the heading row between the tabs and the first
                                   card, clear of the tab labels and the topbar.
  phantom-bouquet-floor.webp       the foot of the panel: large ivory skeleton leaves
                                   cropped by the panel's edges, with a few dyed ones
                                   lying over and under them.
  phantom-bouquet-garland.webp     the lock screen: the leaves on a length of twine.
  phantom-bouquet-*-wide.webp      the same plates in a 900-unit frame for the expanded
                                   composer and any window past a side panel's width.

Rasters, not SVG, because the leaves are rasters: a skeleton leaf's lace is thousands of
connected hairlines, and the study is the source of truth for them. Every plate is drawn
at twice its CSS size so the lace holds on a 2x display, and saved as lossy WebP with
alpha, which keeps the hairlines and costs a fraction of PNG.

Each leaf is laid as a pressed skeleton leaf lies on cloth: a faint ivory body (the
translucent leaf itself), its lace and veins in ink over that, and a soft shadow under it.
The ivory leaves are sepia-veined; the dyed ones take one of the five autumn dyes for
both body and veins. Every placement is listed below, so a run draws the same bouquet.
"""

import math
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
THEMES = os.path.join(ROOT, 'themes')
STUDIES = os.path.join(ROOT, 'docs', 'phantom-bouquet')
CUT = os.path.join(ROOT, 'assets', 'phantom-bouquet')

LEAVES = ['maple', 'oak', 'cordate', 'serrate', 'ovate', 'lanceolate']

# Every plate is drawn at this many pixels per CSS pixel.
SCALE = 2

LINEN = (0xEC, 0xE5, 0xD6)
IVORY = (0xFB, 0xF7, 0xEC)
SEPIA = (0x6E, 0x52, 0x37)
DYES = {
    'madder': (0xA3, 0x44, 0x3A),
    'ochre': (0xB7, 0x83, 0x2A),
    'rust': (0x9E, 0x4F, 0x27),
    'olive': (0x66, 0x73, 0x3A),
    'plum': (0x6B, 0x3B, 0x5A),
}


# ---- the cut (--cut) -------------------------------------------------------------------

def cut():
    from scipy import ndimage as ndi
    os.makedirs(CUT, exist_ok=True)
    plan = [('maple-lace-study.png', ['maple']),
            ('oak-lace-study.png', ['oak']),
            # The companion plate, read top-left, top-right, bottom-left, bottom-right.
            ('companion-leaves-study.png', ['cordate', 'serrate', 'ovate', 'lanceolate'])]
    for study, names in plan:
        im = Image.open(os.path.join(STUDIES, study)).convert('RGB')
        a = np.asarray(im).astype(np.float32)
        lum = a.mean(2)
        # The paper, measured where it is: the brightest level in each neighbourhood.
        small = Image.fromarray(lum.astype(np.uint8)).resize((157, 157), Image.BOX)
        small = small.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(4))
        paper_l = np.asarray(small.resize(im.size, Image.BICUBIC)).astype(np.float32)
        dark = np.clip(1 - lum / np.maximum(paper_l, 1), 0, 1)
        tint = a[:24, :24].reshape(-1, 3).mean(0)
        paper = paper_l[..., None] * (tint / tint.mean())[None, None, :]
        # Silhouettes: the outline is closed, so filling it gives each leaf whole.
        solid = ndi.binary_fill_holes(ndi.binary_dilation(dark > 0.30, iterations=2))
        lab, n = ndi.label(solid)
        sizes = ndi.sum(solid, lab, range(1, n + 1))
        comps = [lab == (i + 1) for i in np.argsort(-sizes) if sizes[i] > 20000]
        if len(names) > 1:
            def where(c):
                ys, xs = np.nonzero(c)
                return (ys.min() > a.shape[0] * 0.48, xs.min() > a.shape[1] * 0.52)
            comps.sort(key=where)
        assert len(comps) == len(names), study + ': found %d leaves' % len(comps)
        for name, c in zip(names, comps):
            m = ndi.binary_dilation(c, iterations=3)
            soft = ndi.gaussian_filter(m.astype(np.float32), 1.2)
            alpha = np.clip((dark - 0.015) / 0.985, 0, 1) * soft
            with np.errstate(divide='ignore', invalid='ignore'):
                ink = (a - paper * (1 - alpha[..., None])) / np.maximum(alpha[..., None], 1e-3)
            ink = np.clip(np.nan_to_num(ink), 0, 255)
            ys, xs = np.nonzero(m)
            y0, y1 = max(ys.min() - 6, 0), ys.max() + 7
            x0, x1 = max(xs.min() - 6, 0), xs.max() + 7
            rgba = np.dstack([ink, alpha * 255])[y0:y1, x0:x1].round().astype(np.uint8)
            Image.fromarray(rgba, 'RGBA').save(os.path.join(CUT, name + '.png'), optimize=True)
            print('cut', name, rgba.shape[1], 'x', rgba.shape[0])


# ---- laying a leaf ---------------------------------------------------------------------

_masters = {}


def master(name):
    """The cut leaf: its lace as alpha, and its silhouette (the leaf body) as a mask."""
    if name not in _masters:
        im = Image.open(os.path.join(CUT, name + '.png')).convert('RGBA')
        lace = im.getchannel('A')
        # The body: the outline flooded from outside, and everything not reached.
        edge = lace.point(lambda v: 255 if v > 70 else 0).filter(ImageFilter.MaxFilter(5))
        pad = Image.new('L', (edge.width + 4, edge.height + 4), 0)
        pad.paste(edge, (2, 2))
        ImageDraw.floodfill(pad, (0, 0), 128)
        body = pad.crop((2, 2, pad.width - 2, pad.height - 2)).point(lambda v: 0 if v == 128 else 255)
        body = body.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.5))
        # The petiole's tip: the lowest solid ink, which is where a hanging leaf is tied.
        arr = np.asarray(lace)
        ys, xs = np.nonzero(arr > 128)
        tip = (float(xs[ys.argmax()]), float(ys.max()))
        _masters[name] = (lace, body, tip)
    return _masters[name]


def leaf(name, height, angle, dye=None, flip=False):
    """One leaf laid on cloth, `height` CSS px tall before turning, turned `angle` degrees
    clockwise. Returns the RGBA image at plate scale, and where the petiole's tip lands in
    it (the hanging point) and where the leaf's centre lands."""
    lace, body, tip = master(name)
    s = height * SCALE / lace.height
    size = (max(1, round(lace.width * s)), max(1, round(lace.height * s)))
    lace = lace.resize(size, Image.LANCZOS)
    body = body.resize(size, Image.LANCZOS)
    tip = (tip[0] * s, tip[1] * s)
    if flip:
        lace = lace.transpose(Image.FLIP_LEFT_RIGHT)
        body = body.transpose(Image.FLIP_LEFT_RIGHT)
        tip = (size[0] - tip[0], tip[1])

    if dye:
        d = DYES[dye]
        vein_rgb = tuple(int(c * 0.78) for c in d)
        vein_a, body_rgb, body_a = 0.92, d, 0.20
    else:
        # A small leaf's lace is finer on screen than a large one's, so it is inked a
        # little stronger: 0.58 at 140px and up, rising to 0.83 at 60px.
        small = min(1.0, max(0.0, (140 - height) / 80))
        vein_rgb, vein_a, body_rgb, body_a = SEPIA, 0.58 + 0.25 * small, IVORY, 0.62

    # Pad so the shadow and the turn have room.
    m = int(8 * SCALE)
    w, h = size[0] + 2 * m, size[1] + 2 * m

    def padded(img):
        out = Image.new('L', (w, h), 0)
        out.paste(img, (m, m))
        return out

    lace, body = padded(lace), padded(body)
    # Hairlines thinner than a device pixel after the downscale lose their weight; a touch
    # of gain on the lace keeps the finest veins as visible as they are in the study.
    lace = lace.point(lambda v: min(255, int((v / 255) ** 0.85 * 255 * vein_a)))
    body = body.point(lambda v: int(v * body_a))

    # The shadow of a leaf lying on cloth: its body, soft, a little down and to the right.
    shadow_a = body.point(lambda v: int(v / max(body_a, 1e-3) * 0.10))
    shadow_a = ImageChops.offset(shadow_a, int(1.5 * SCALE), int(3 * SCALE)).filter(ImageFilter.GaussianBlur(3 * SCALE))
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    out.alpha_composite(Image.merge('RGBA', [*Image.new('RGB', (w, h), (0x4A, 0x3A, 0x28)).split(), shadow_a]))
    out.alpha_composite(Image.merge('RGBA', [*Image.new('RGB', (w, h), body_rgb).split(), body]))
    out.alpha_composite(Image.merge('RGBA', [*Image.new('RGB', (w, h), vein_rgb).split(), lace]))

    cx, cy = w / 2, h / 2
    turned = out.rotate(-angle, resample=Image.BICUBIC, expand=True)
    # Where the tip and the centre went: rotate about the image centre, then shift by the
    # growth `expand` added.
    rad = math.radians(angle)
    tx, ty = tip[0] + m - cx, tip[1] + m - cy
    rx = tx * math.cos(rad) - ty * math.sin(rad)
    ry = tx * math.sin(rad) + ty * math.cos(rad)
    ncx, ncy = turned.width / 2, turned.height / 2
    return turned, (ncx + rx, ncy + ry), (ncx, ncy)


def plate(w, h, placements, twine=None):
    """A transparent plate `w` x `h` CSS px. Each placement is
    (leaf, height, angle, x, y, dye, flip, anchor): (x, y) in CSS px is where the leaf's
    centre goes, or its petiole tip when anchor is 'tip'. Later placements lie on top."""
    canvas = Image.new('RGBA', (w * SCALE, h * SCALE), (0, 0, 0, 0))
    if twine:
        canvas.alpha_composite(twine)
    for p in placements:
        name, height, angle, x, y = p[:5]
        dye = p[5] if len(p) > 5 else None
        flip = p[6] if len(p) > 6 else False
        anchor = p[7] if len(p) > 7 else 'centre'
        img, tip, centre = leaf(name, height, angle, dye, flip)
        ax, ay = tip if anchor == 'tip' else centre
        layer = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
        layer.paste(img, (round(x * SCALE - ax), round(y * SCALE - ay)))
        canvas = Image.alpha_composite(canvas, layer)
    return canvas


def save(img, name):
    path = os.path.join(THEMES, name)
    img.save(path, 'WEBP', quality=86, alpha_quality=90, method=6, exact=False)
    print('wrote', name, img.width, 'x', img.height, os.path.getsize(path) // 1024, 'KB')


# ---- the garland -----------------------------------------------------------------------

def sag(x0, y0, x1, y1, depth, t):
    """A point on a length of twine hung between two nails: a shallow catenary, close
    enough to a parabola at this sag."""
    x = x0 + (x1 - x0) * t
    y = y0 + (y1 - y0) * t + depth * 4 * t * (1 - t)
    return x, y


def twine(w, h, spans):
    """The twine itself: two plies of warm jute twisted together, drawn at four times
    the plate's resolution and brought down, so the cord is smooth and its twist reads
    as cord rather than as a rule."""
    k = 4 * SCALE
    img = Image.new('RGBA', (w * k, h * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for (x0, y0, x1, y1, depth) in spans:
        pts = [sag(x0, y0, x1, y1, depth, i / 400) for i in range(401)]
        d.line([(x * k, y * k) for x, y in pts], fill=(0x8E, 0x72, 0x4F, 240), width=int(1.8 * k), joint='curve')
        # The twist: short dark strokes across the cord, slanted, every 2.4 CSS px.
        run = 0.0
        for i in range(400):
            (xa, ya), (xb, yb) = pts[i], pts[i + 1]
            run += math.hypot(xb - xa, yb - ya)
            if run < 2.4:
                continue
            run = 0.0
            dx, dy = xb - xa, yb - ya
            n = math.hypot(dx, dy) or 1
            ux, uy = dx / n, dy / n
            px, py = -uy, ux
            a = (xa + 0.55 * ux - 0.8 * px, ya + 0.55 * uy - 0.8 * py)
            b = (xa - 0.55 * ux + 0.8 * px, ya - 0.55 * uy + 0.8 * py)
            d.line([(a[0] * k, a[1] * k), (b[0] * k, b[1] * k)], fill=(0x5E, 0x47, 0x2E, 170), width=int(0.5 * k))
        # A highlight along the upper ply.
        d.line([(x * k, (y - 0.45) * k) for x, y in pts], fill=(0xC8, 0xAE, 0x84, 120), width=int(0.5 * k), joint='curve')
    return img.resize((w * SCALE, h * SCALE), Image.LANCZOS)


def knot(img, x, y):
    d = ImageDraw.Draw(img)
    r = 1.9 * SCALE
    d.ellipse([x * SCALE - r, y * SCALE - r, x * SCALE + r, y * SCALE + r], fill=(0x7A, 0x5E, 0x3E, 240))


def garland(w, h, spans, hung):
    """Leaves tied along the twine. `hung` is (span index, t along it, leaf, height,
    swing in degrees from straight down, dye, flip)."""
    cord = twine(w, h, spans)
    placements = []
    ties = []
    for (si, t, name, height, swing, dye, flip) in hung:
        x, y = sag(*spans[si], t)
        # A hanging leaf is turned upside down, petiole up at the knot, and swings a
        # little off plumb.
        placements.append((name, height, 180 + swing, x, y + 1.5, dye, flip, 'tip'))
        ties.append((x, y))
    img = plate(w, h, placements, twine=cord)
    for x, y in ties:
        knot(img, x, y)
    return img


# ---- the linen -------------------------------------------------------------------------

def weave():
    """The linen: a 160px tile of plain weave, drawn at plate scale. Warp and weft each
    get their own uneven thread weights, a few slubs (the thicker runs that make linen
    linen rather than cotton), and the over-under of the weave as a faint checker, all as
    a dark ink at a few percent so the cloth reads up close and vanishes at arm's length.
    Every thread's weight is a function of its index alone, so the tile wraps cleanly."""
    n = 160 * SCALE
    rng = np.random.default_rng(1862)
    def threads(count):
        # One weight per thread (a thread is one CSS px), slubs stretched along some.
        w = rng.normal(0, 1, count)
        slubs = rng.random(count) < 0.08
        w[slubs] += rng.uniform(1.2, 2.2, slubs.sum())
        return np.repeat(w, SCALE)
    warp = threads(160)
    weft = threads(160)
    # Along each thread its weight wanders a little, so no line is ruled.
    wander_x = np.repeat(rng.normal(0, 0.6, (160, 160)), SCALE, 0).repeat(SCALE, 1)
    wander_y = np.repeat(rng.normal(0, 0.6, (160, 160)), SCALE, 0).repeat(SCALE, 1)
    yy, xx = np.mgrid[0:n, 0:n]
    over = ((yy // SCALE + xx // SCALE) % 2).astype(np.float32)
    v = (0.55 * (warp[None, :] + wander_x) * over + 0.55 * (weft[:, None] + wander_y) * (1 - over))
    v += rng.normal(0, 0.35, (n, n))
    alpha = np.clip(0.030 + v * 0.016, 0, 0.09)
    rgba = np.zeros((n, n, 4), np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = 0x5A, 0x48, 0x30
    rgba[..., 3] = (alpha * 255).round().astype(np.uint8)
    save(Image.fromarray(rgba, 'RGBA'), 'phantom-bouquet-weave.webp')


# ---- the compositions ------------------------------------------------------------------
#
# (leaf, height, angle, x, y, dye, flip). Heights and positions are CSS px in the plate's
# own frame. The panel frame is 360 wide: the topbar is 0-56, the tabs 56-106, and the
# heading row (the tab's title, beside nothing) runs from there to about 262, where the
# first card starts.

TOP = (360, 300, [
    # The one whole dyed leaf in the heading row, right of the title, below the tab
    # labels: madder, the cordate leaf, its drip tip pointing up and out.
    ('cordate', 66, 22, 306, 222, 'madder'),
])

FLOOR = (360, 560, [
    # Underneath: the ivory oak, cropped by the left edge, and the maple by the right.
    ('oak', 300, -34, 18, 380),
    ('maple', 320, 26, 338, 318, None, True),
    ('lanceolate', 230, 62, 196, 526),
    # Dyed leaves lying over the pale ones.
    ('serrate', 118, -14, 70, 330, 'ochre'),
    ('ovate', 104, 38, 268, 462, 'plum'),
    ('lanceolate', 128, -58, 74, 520, 'rust'),
])

TOP_WIDE = (900, 340, [
    ('serrate', 250, 152, 70, 26),
    ('ovate', 230, -146, 862, 40, None, True),
    ('cordate', 92, -18, 772, 222, 'madder'),
])

FLOOR_WIDE = (900, 520, [
    ('oak', 360, -30, 70, 360),
    ('maple', 380, 22, 834, 330, None, True),
    ('cordate', 250, 68, 330, 492),
    ('lanceolate', 300, -54, 612, 470),
    ('lanceolate', 150, 30, 196, 236, 'olive'),
    ('maple', 124, -16, 700, 246, 'rust'),
    ('serrate', 130, 12, 468, 420, 'ochre'),
    ('ovate', 112, -40, 902 - 140, 482, 'plum'),
])

# The lock screen's garland: twine hung across the top of the panel, leaves tied along it.
GARLAND = (360, 230, [(-12, 24, 372, 34, 64)], [
    (0, 0.10, 'oak', 62, 8, None, False),
    (0, 0.23, 'cordate', 54, -6, 'madder', False),
    (0, 0.36, 'maple', 70, 4, None, True),
    (0, 0.50, 'lanceolate', 66, -3, 'olive', False),
    (0, 0.63, 'serrate', 60, 6, None, False),
    (0, 0.76, 'ovate', 56, -5, 'ochre', True),
    (0, 0.89, 'maple', 58, 7, 'plum', False),
])

GARLAND_WIDE = (900, 260, [(-20, 26, 452, 30, 74), (448, 30, 920, 22, 70)], [
    (0, 0.12, 'serrate', 66, 6, None, False),
    (0, 0.25, 'maple', 74, -4, 'rust', True),
    (0, 0.38, 'oak', 70, 5, None, False),
    (0, 0.51, 'cordate', 58, -7, 'madder', False),
    (0, 0.64, 'lanceolate', 72, 3, None, False),
    (0, 0.77, 'ovate', 60, -4, 'ochre', False),
    (0, 0.90, 'maple', 66, 6, None, False),
    (1, 0.12, 'cordate', 60, -5, None, True),
    (1, 0.25, 'oak', 68, 4, 'olive', True),
    (1, 0.38, 'lanceolate', 70, -6, None, False),
    (1, 0.51, 'serrate', 62, 6, 'plum', False),
    (1, 0.64, 'maple', 72, -3, None, False),
    (1, 0.77, 'ovate', 58, 5, 'madder', True),
    (1, 0.90, 'oak', 64, -6, None, False),
])


def main():
    if '--cut' in sys.argv:
        cut()
    weave()
    for name, (w, h, pl) in (('top', TOP), ('floor', FLOOR), ('top-wide', TOP_WIDE), ('floor-wide', FLOOR_WIDE)):
        save(plate(w, h, pl), 'phantom-bouquet-%s.webp' % name)
    for name, (w, h, spans, hung) in (('garland', GARLAND), ('garland-wide', GARLAND_WIDE)):
        save(garland(w, h, spans, hung), 'phantom-bouquet-%s.webp' % name)


if __name__ == '__main__':
    main()
