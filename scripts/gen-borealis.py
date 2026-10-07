"""Render Aurora Borealis's original, procedural polar-night landscape.

No reference photograph is sampled or embedded. Aurora emission is integrated from
folded curtains; terrain is a perspective height field with slope-dependent snow.
An opaque composite keeps stars behind mountains, including on reading views.

    python3 -m pip install -r scripts/borealis-requirements.txt
    python3 scripts/gen-borealis.py

Committed AVIFs are used as-is at runtime. No rendering runs in the extension.
Use --output-dir for experiments outside themes/, and --preview for PNG masters.
"""
from argparse import ArgumentParser
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SEED = 20261207
SIZES = {'portrait': (720, 1520), 'wide': (1920, 1200)}


def noise(x, y, seed=0):
    """Continuous seeded value noise, sampled in world coordinates."""
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = x - ix, y - iy
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    def corner(dx, dy):
        n = np.sin((ix + dx) * 127.1 + (iy + dy) * 311.7 + seed * 17.3) * 43758.5453
        return n - np.floor(n)
    return ((1 - fy) * ((1 - fx) * corner(0, 0) + fx * corner(1, 0))
            + fy * ((1 - fx) * corner(0, 1) + fx * corner(1, 1)))


def fbm(x, y, seed=0, octaves=6):
    out = np.zeros(np.broadcast_shapes(np.shape(x), np.shape(y)), dtype=np.float32)
    total = 0
    for i in range(octaves):
        amplitude = 0.5 ** i
        out += amplitude * noise(x * 2 ** i, y * 2 ** i, seed + i * 3)
        total += amplitude
    return out / total


def sky(width, height, seed=SEED, emission_only=False):
    """Linear-light sky and aurora, before terrain occlusion."""
    rng = np.random.default_rng(seed)
    x = np.linspace(0, 1, width, dtype=np.float32)[None, :]
    y = np.linspace(0, 1, height, dtype=np.float32)[:, None]
    haze = np.exp(-((y - .68) / .22) ** 2)
    rgb = np.empty((height, width, 3), np.float32)
    for c, (top, bottom) in enumerate(zip((.003, .007, .019), (.013, .043, .057))):
        rgb[..., c] = top + bottom * haze
    cloud = fbm(x * 4, y * 5, seed=12, octaves=5)
    rgb += (cloud[..., None] - .45) * np.array([.004, .009, .012])

    # Each curtain folds in perspective. The fine vertical structure is advected
    # with height, so it is light inside a volume rather than strokes on an outline.
    aurora = np.zeros_like(rgb)
    for index, (base, tilt, strength, violet) in enumerate([
        (.50, -.36, 1.10, False), (.35, .10, .48, True), (.60, -.10, .27, False)
    ]):
        drift = .027 * np.sin(y * 5.2 + index) + .012 * noise(x * 5, y * 4, 60 + index)
        u = x + drift
        fold = (.041 * np.sin(u * 14 + index * 2)
                + .021 * np.sin(u * 29 + 1.3) + .011 * np.sin(u * 51 + 2.1))
        hem = base + tilt * (u - .5) + fold
        altitude = hem - y
        thickness = .12 + .07 * noise(u * 4, np.zeros_like(u), 8 + index)
        edge = 1 / (1 + np.exp(np.clip(-altitude / .009, -50, 50)))
        envelope = edge * np.exp(-np.maximum(altitude, 0) / thickness)
        envelope *= np.clip(1 - np.maximum(altitude - .16, 0) / .42, 0, 1)
        broad = .25 + 1.2 * noise(u * 11, np.zeros_like(u), 40 + index) ** 2
        strands = (.67 + .33 * noise(u * 170, np.zeros_like(u), 23 + index)
                   + .12 * noise(u * 410, np.zeros_like(u), 19 + index))
        # Local folds brighten where curtains overlap; a soft skirt spills below.
        emission = strength * envelope * broad * strands
        emission += strength * .10 * np.exp(-(altitude / .05) ** 2) * broad
        violet_mix = np.clip((altitude - .08) / .23, 0, 1)
        low = np.array([.023, .52, .16]) if not violet else np.array([.19, .04, .30])
        high = np.array([.10, .035, .23]) if not violet else np.array([.15, .028, .26])
        light = emission[..., None] * (low + violet_mix[..., None] * (high - low))
        rgb += light
        aurora += light

    if emission_only:
        return aurora

    # Small stars with a strongly skewed brightness distribution, never cross icons.
    stars = np.zeros_like(rgb)
    for _ in range(int(width * height / 1400)):
        sx, sy = rng.integers(2, width - 2), rng.integers(2, int(height * .79))
        strength = .016 + rng.random() ** 5 * .26
        tint = np.array([.78, .89, 1.0]) if rng.random() < .8 else np.array([1.0, .87, .73])
        stars[sy, sx] += strength * tint
        stars[sy-1:sy+2, sx-1:sx+2] += strength * .045 * tint
    rgb += stars
    return np.maximum(rgb, 0)


def terrain(width, height, seed=SEED + 1):
    """Project solid terrain front-to-back, with surface normals and snow cover.

    World-space noise is continuous across depth slices. The column horizon buffer
    provides actual occlusion; dimming is applied after compositing the landscape.
    """
    horizon = .79 if width < height else .78
    focal = height * .90
    camera = .48
    z = np.geomspace(.55, 24, 2600).astype(np.float32)[:, None]
    screen_x = np.linspace(-.5, .5, width, dtype=np.float32)[None, :]
    x = screen_x * z * (width / height) / .90
    # A coastal ridge, broken into overlapping massifs at different depths.
    h = np.zeros_like(x)
    for px, pz, peak, spread in [
        (-5.8, 9.5, 2.7, 1.8), (-3.1, 7.4, 3.0, 1.8), (-1.1, 8.8, 2.1, 1.4),
        (.7, 8.0, 2.35, 1.5), (2.6, 7.5, 3.3, 1.8), (4.9, 9.4, 2.6, 1.9),
        (7.6, 10.6, 3.1, 2.0), (-8.9, 11.0, 2.8, 2.1),
    ]:
        radius = np.sqrt(((x - px) / (spread * 1.18)) ** 2 + ((z - pz) / (spread * .90)) ** 2)
        massif = peak * np.maximum(1 - radius ** 1.35, 0) ** 1.15
        h = np.maximum(h, massif)
    rough = fbm(x * 1.8, z * 1.8, seed=seed % 997, octaves=7)
    # Ridge erosion cuts connected gullies through the mass rather than capping it.
    h *= .72 * (.60 + .64 * rough)
    h += np.minimum(h, .4) * (fbm(x * 6, z * 4, seed=81, octaves=5) - .5) * .45
    dx = z * (width / height) / (.90 * (width - 1))
    hx = np.gradient(h, axis=1) / dx
    hz = np.gradient(h, z[:, 0], axis=0) - hx * screen_x * (width / height) / .90
    slope = np.sqrt(hx * hx + hz * hz)
    light = np.clip((-.65 * hx - .30 * hz + .7) / np.sqrt(1 + slope * slope), 0, 1)
    snow_noise = fbm(x * 11, z * 11, seed=93, octaves=5)
    snow = np.clip((1.9 - slope) * 1.4 + (snow_noise - .5) * 3 + (h - .45) * .7, 0, 1)
    snow *= np.clip(h / .20, 0, 1)
    ambient = .32 + .68 * light
    rock = np.array([.009, .016, .021])
    ice = np.array([.12, .18, .21])
    color = rock + snow[..., None] * (ice - rock)
    color *= ambient[..., None]
    # The same green light that fills the sky falls on north-facing snow.
    color += snow[..., None] * np.array([.003, .017, .012]) * (.4 + .6 * light[..., None])
    mist = np.clip((z - 5) / 28, 0, .35)
    color = color * (1 - mist[..., None]) + np.array([.022, .047, .062]) * mist[..., None]
    projected = (horizon * height + (camera - h) / z * focal).astype(np.int32)
    waterline = int(horizon * height)
    pixels = np.zeros((height, width, 3), np.float32)
    mask = np.zeros((height, width), bool)
    ceiling = np.full(width, height, np.int32)
    for depth in range(len(z)):
        ys = np.clip(projected[depth], 0, height)
        visible = (ys < ceiling) & (h[depth] > .025)
        for col in np.flatnonzero(visible):
            start = ys[col]
            shoreline = int(horizon * height + camera / z[depth, 0] * focal)
            end = min(ceiling[col], shoreline)
            if end <= start:
                continue
            t = np.linspace(0, 1, end - start, dtype=np.float32)[:, None]
            pixels[start:end, col] = color[depth, col] * (1 - t) + color[max(0, depth - 1), col] * t
            mask[start:end, col] = True
        ceiling[visible] = ys[visible]
    return pixels, mask, waterline


def render(width, height):
    rgb = sky(width, height)
    ground, mask, waterline = terrain(width, height)
    rgb[mask] = ground[mask]
    coast = waterline
    # A fjord carries stretched, broken reflections with perspective ripples.
    x = np.arange(width, dtype=np.float32)[None, :]
    y = np.arange(height - coast, dtype=np.float32)[:, None]
    if len(y):
        distance = y / max(1, height - coast)
        sy = np.clip((waterline - y * 1.6).astype(int), 0, height - 1)
        displacement = (2 + 11 * distance) * np.sin(y * .55 + noise(x * .03, y * .03, 99) * 3)
        sx = np.clip((x + displacement).astype(int), 0, width - 1)
        reflected = rgb[sy, sx]
        ripple = .64 + .25 * noise(x * .014, y * .8, 59) + .12 * np.sin(y * 1.6)
        rgb[coast:] = reflected * (.13 + .25 * distance[..., None]) * ripple[..., None]
        rgb[coast:] += np.array([.004, .010, .014])
    rgb[mask] = ground[mask]
    # Exposure is resolved once, after all light and opaque terrain are composed.
    rgb = np.clip(rgb, 0, 1)
    srgb = np.where(rgb <= .0031308, rgb * 12.92, 1.055 * rgb ** (1/2.4) - .055)
    return Image.fromarray(np.uint8(np.clip(srgb * 255, 0, 255)))


def save(image, name, directory):
    path = directory / name
    image.save(path, 'AVIF', quality=72, speed=6, subsampling='4:4:4', max_threads=1)
    print(f'{name}: {path.stat().st_size:,} bytes')


def shimmer_mask(width, height):
    """Small luminance mask for light only; no stars, terrain or water can move.

    Fade well above each column's skyline before reducing the mask. The clearance
    prevents interpolation from spreading light onto mountain edges at any size.
    """
    light = sky(width, height, emission_only=True).max(axis=2)
    _, land, coast = terrain(width, height)
    skyline = np.where(land.any(axis=0), land.argmax(axis=0), coast)
    y = np.arange(height)[:, None]
    clearance = np.clip((skyline[None, :] - y - height * .035) / (height * .08), 0, 1)
    intensity = np.clip(light * 3, 0, 1) * clearance
    mask = Image.fromarray(np.uint8(intensity * 255))
    return mask.resize((width // 4, height // 4), Image.Resampling.LANCZOS)


def water_mask(width, height):
    """Reflect the curtain emission using the still scene's water projection.

    Exclude both opaque land and its reflection; dilate the excluded region before
    downsampling so interpolation cannot spread moving light onto the shoreline.
    """
    light = sky(width, height, emission_only=True).max(axis=2)
    _, land, coast = terrain(width, height)
    x = np.arange(width, dtype=np.float32)[None, :]
    y = np.arange(height - coast, dtype=np.float32)[:, None]
    distance = y / max(1, height - coast)
    sy = np.clip((coast - y * 1.6).astype(int), 0, height - 1)
    displacement = (2 + 11 * distance) * np.sin(y * .55 + noise(x * .03, y * .03, 99) * 3)
    sx = np.clip((x + displacement).astype(int), 0, width - 1)
    excluded = land.copy()
    excluded[:coast] = True
    excluded[coast:] |= land[sy, sx]
    guard = np.asarray(Image.fromarray(np.uint8(excluded) * 255).filter(ImageFilter.MaxFilter(25))) > 0
    intensity = np.zeros((height, width), np.float32)
    intensity[coast:] = np.clip(light[sy, sx] * 4, 0, 1) * np.clip(distance * 8, 0, 1)
    # Keep an additional soft buffer below the last land pixel in each column.
    # This also protects the visible shore under browser image resampling.
    shoreline = np.where(land.any(axis=0), height - 1 - land[::-1].argmax(axis=0), coast)
    rows = np.arange(height)[:, None]
    intensity *= np.clip((rows - shoreline[None, :] - height * .025) / (height * .04), 0, 1)
    intensity[guard] = 0
    return Image.fromarray(np.uint8(intensity * 255)).resize(
        (width // 4, height // 4), Image.Resampling.LANCZOS)


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'themes')
    parser.add_argument('--preview', action='store_true')
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for layout, (width, height) in SIZES.items():
        image = render(width, height)
        suffix = '-wide' if layout == 'wide' else ''
        save(image, f'borealis-night{suffix}.avif', args.output_dir)
        mask_path = args.output_dir / f'borealis-shimmer{suffix}.png'
        shimmer_mask(width, height).save(mask_path, optimize=True)
        print(f'{mask_path.name}: {mask_path.stat().st_size:,} bytes')
        water_path = args.output_dir / f'borealis-water{suffix}.png'
        water_mask(width, height).save(water_path, optimize=True)
        print(f'{water_path.name}: {water_path.stat().st_size:,} bytes')
        if args.preview:
            image.save(args.output_dir / f'borealis-night{suffix}.png')


if __name__ == '__main__':
    main()
