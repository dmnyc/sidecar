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
  phantom-bouquet-white.webp       behind everything: leaves bleached white, lighter
                                   than the linen, a few coming in from the top edge
                                   behind the topbar and tabs, larger ones under the
                                   cards.
  phantom-bouquet-drift-<n>.webp   the lock screen: single leaves, one per file, that
                                   drift slowly in and out over the cloth.
  phantom-bouquet-*-wide.webp      the head, floor and white plates in a 900-unit frame for the
                                   expanded composer and any window past a side panel's width.

Rasters, not SVG, because the leaves are rasters: a skeleton leaf's lace is thousands of
connected hairlines, and the study is the source of truth for them. Every plate is drawn
at twice its CSS size so the lace holds on a 2x display, and saved as lossy WebP with
alpha, which keeps the hairlines and costs a fraction of PNG. The white plates are the
exception, brought down to their CSS size when saved: their lace is faint and the
deepest on the cloth, a little softness reads as distance, and at 1x they cost a
quarter as much.

Each leaf is laid as a pressed skeleton leaf lies on cloth: a faint ivory body (the
translucent leaf itself), its lace and veins in ink over that, and a soft shadow under it.
The ivory leaves are sepia-veined; the dyed ones take one of the five autumn dyes for
both body and veins; the white ones are lace bleached past ivory, with no shadow. Every
placement is listed below, so a run draws the same bouquet.
"""

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
WHITE = (0xFF, 0xFD, 0xF6)
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
        _masters[name] = (lace, body)
    return _masters[name]


def leaf(name, height, angle, dye=None, flip=False, shadow=True):
    """One leaf laid on cloth, `height` CSS px tall before turning, turned `angle` degrees
    clockwise. Returns the RGBA image at plate scale, centred on the leaf. Without its
    shadow when `shadow` is false, for a sprite whose shadow the stylesheet casts."""
    lace, body = master(name)
    s = height * SCALE / lace.height
    size = (max(1, round(lace.width * s)), max(1, round(lace.height * s)))
    lace = lace.resize(size, Image.LANCZOS)
    body = body.resize(size, Image.LANCZOS)
    if flip:
        lace = lace.transpose(Image.FLIP_LEFT_RIGHT)
        body = body.transpose(Image.FLIP_LEFT_RIGHT)

    if dye == 'white':
        # Bleached past ivory: lace lighter than the linen it lies on, so it reads as
        # white thread rather than ink, over the faintest body. These lie deepest, under
        # every other leaf, and cast no shadow.
        vein_rgb, vein_a, body_rgb, body_a = WHITE, 1.0, IVORY, 0.32
        shadow = False
    elif dye:
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
    if shadow:
        out.alpha_composite(Image.merge('RGBA', [*Image.new('RGB', (w, h), (0x4A, 0x3A, 0x28)).split(), shadow_a]))
    out.alpha_composite(Image.merge('RGBA', [*Image.new('RGB', (w, h), body_rgb).split(), body]))
    out.alpha_composite(Image.merge('RGBA', [*Image.new('RGB', (w, h), vein_rgb).split(), lace]))

    return out.rotate(-angle, resample=Image.BICUBIC, expand=True)


def plate(w, h, placements):
    """A transparent plate `w` x `h` CSS px. Each placement is
    (leaf, height, angle, x, y, dye, flip): (x, y) in CSS px is where the leaf's centre
    goes. Later placements lie on top."""
    canvas = Image.new('RGBA', (w * SCALE, h * SCALE), (0, 0, 0, 0))
    for p in placements:
        name, height, angle, x, y = p[:5]
        dye = p[5] if len(p) > 5 else None
        flip = p[6] if len(p) > 6 else False
        img = leaf(name, height, angle, dye, flip)
        layer = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
        layer.paste(img, (round(x * SCALE - img.width / 2), round(y * SCALE - img.height / 2)))
        canvas = Image.alpha_composite(canvas, layer)
    return canvas


def save(img, name):
    path = os.path.join(THEMES, name)
    img.save(path, 'WEBP', quality=86, alpha_quality=90, method=6, exact=False)
    print('wrote', name, img.width, 'x', img.height, os.path.getsize(path) // 1024, 'KB')


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
# ONE SCALE FOR EVERY LEAF. The bouquet lies on one plane, so a leaf's size on screen is
# its real size times one figure, PX_PER_CM, everywhere: on the head and floor plates, in
# the wide frames, and in the lock screen's sprites. A maple is a maple's size wherever it
# lies, and an oak beside it is an oak's. LENGTH_CM is each leaf's real length, petiole
# included, for a typical leaf of its kind (sugar maple, white oak, redbud, birch, a
# smooth ovate leaf, willow); each placement then names a size factor, kept within a few
# percent of 1, for the natural difference between one leaf and the next. Two exceptions,
# each marked where it is laid: the ochre leaf the gallery tile shows, and the white leaves.
#
# (leaf, size, angle, x, y, dye, flip). Positions are CSS px in the plate's own frame.
# The panel frame is 360 wide: the topbar is 0-56, the tabs 56-106, and the heading row
# (the tab's title, beside nothing) runs from there to about 262, where the first card
# starts.

PX_PER_CM = 13
LENGTH_CM = {'maple': 17, 'oak': 16, 'cordate': 10.5, 'serrate': 9, 'ovate': 10, 'lanceolate': 12}


def sized(placements):
    """Placements with their size factor turned into a height in CSS px."""
    return [(p[0], LENGTH_CM[p[0]] * PX_PER_CM * p[1]) + tuple(p[2:]) for p in placements]


TOP = (360, 300, [
    # The one whole dyed leaf in the heading row, right of the title, below the tab
    # labels: madder, the serrate leaf, the smallest of the six, lying on its side with
    # its tip toward the title. On its side it fits whole in the row between the tabs and
    # the first card, about 70 px on the Accounts tab; stood up, the card hid most of it.
    ('serrate', 0.9, -84, 286, 140, 'madder'),
])

FLOOR = (360, 560, [
    # Underneath: the ivory oak, cropped by the left edge, and the maple by the right.
    ('oak', 1.0, -30, 34, 404),
    ('maple', 1.05, 24, 318, 336, None, True),
    ('cordate', 0.95, -18, 196, 312),
    ('lanceolate', 1.0, 64, 190, 522),
    # Dyed leaves lying over the pale ones. The ochre leaf is the one the gallery tile
    # and the arrival card show beside the wallet card (the band they crop to starts 170
    # px down this plate), so it is laid larger than one scale allows, and turned.
    ('serrate', 1.3, -38, 74, 252, 'ochre'),
    ('ovate', 0.95, 36, 262, 474, 'plum'),
    ('lanceolate', 0.92, -58, 70, 530, 'rust'),
])

TOP_WIDE = (900, 340, [
    ('serrate', 1.05, 152, 60, 28),
    ('ovate', 1.05, -146, 860, 40, None, True),
    ('cordate', 0.95, -18, 772, 226, 'madder'),
])

FLOOR_WIDE = (900, 520, [
    ('oak', 1.05, -30, 84, 384),
    ('maple', 1.08, 22, 828, 352, None, True),
    ('cordate', 1.0, 68, 330, 480),
    ('lanceolate', 1.05, -54, 612, 468),
    ('lanceolate', 0.92, 30, 200, 252, 'olive'),
    ('maple', 0.9, -16, 700, 258, 'rust'),
    ('serrate', 1.0, 12, 468, 420, 'ochre'),
    ('ovate', 0.95, -40, 762, 482, 'plum'),
])

# THE WHITE LEAVES lie under the whole bouquet, the deepest layer, so they are the one
# exception to one scale: at twice it and more they read as the lace of the cloth's own
# depth rather than as more leaves on it, and they fill the top of the panel, which the
# head and floor plates leave bare. Saved at 1x, so a leaf may be drawn as tall as its
# cut is: the companions to about 620 px, maple and oak to about 1200. Pinned to the top
# like the head plate, and tall enough that every leaf ends inside it: what crops them is
# the panel's edge, never the plate's.
#
# THE ONLY LEAVES UNDER THE TOPBAR AND THE TABS. The first few in each frame come in from
# the top edge, tips down, behind both bars and out below them. They can lie there
# because they are lighter than the linen: white lace under an icon or a label only ever
# lifts the ground behind it, never darkens it (test/phantom-bouquet-plates.test.js).
WHITE_PLATE = (360, 860, [
    ('ovate', 1.7, 198, 54, 62, 'white'),
    ('lanceolate', 1.7, 164, 172, 56, 'white', True),
    ('serrate', 1.7, 192, 326, 66, 'white'),
    ('cordate', 2.0, -28, 26, 214, 'white'),
    ('maple', 2.0, 16, 286, 306, 'white', True),
    ('oak', 2.1, -26, 36, 600, 'white'),
])

WHITE_WIDE = (900, 800, [
    ('lanceolate', 1.7, 196, 300, 58, 'white'),
    ('cordate', 1.7, 168, 470, 60, 'white', True),
    ('serrate', 1.7, 204, 640, 64, 'white'),
    ('oak', 2.1, -22, 150, 330, 'white'),
    ('maple', 2.0, 18, 730, 300, 'white', True),
    ('maple', 1.8, -8, 450, 540, 'white'),
])

# The lock screen's falling leaves: each its own sprite, untilted and unshadowed, so
# the stylesheet can turn it in the plane and the container's one drop-shadow falls the
# same way for all of them as they turn (phantom-bouquet.css). On the same scale as every
# other leaf; while they fall these are the only leaves on the lock screen, and the
# floor plate stands down for them. (leaf, size, dye, flip)
DRIFT = [
    ('maple', 1.0, None, False),
    ('cordate', 1.0, 'madder', False),
    ('oak', 1.0, None, True),
    ('serrate', 1.0, 'ochre', False),
    ('lanceolate', 1.0, None, False),
    ('ovate', 1.0, 'plum', True),
    ('maple', 1.0, 'rust', True),
    ('cordate', 1.0, None, True),
]


def main():
    if '--cut' in sys.argv:
        cut()
    weave()
    for name, (w, h, pl) in (('top', TOP), ('floor', FLOOR), ('top-wide', TOP_WIDE), ('floor-wide', FLOOR_WIDE)):
        save(plate(w, h, sized(pl)), 'phantom-bouquet-%s.webp' % name)
    for name, (w, h, pl) in (('white', WHITE_PLATE), ('white-wide', WHITE_WIDE)):
        img = plate(w, h, sized(pl))
        save(img.resize((w, h), Image.LANCZOS), 'phantom-bouquet-%s.webp' % name)
    for i, (name, size, dye, flip) in enumerate(DRIFT, 1):
        img = leaf(name, LENGTH_CM[name] * PX_PER_CM * size, 0, dye, flip, shadow=False)
        save(img.crop(img.getbbox()), 'phantom-bouquet-drift-%d.webp' % i)


if __name__ == '__main__':
    main()
