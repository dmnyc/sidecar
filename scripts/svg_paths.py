"""Writes an SVG's straight-line paths in their shortest exact form. Used by the theme
generators just before they save a file, and runnable on its own for art that has no
generator:

    python3 scripts/svg_paths.py themes/par-avion-map.svg

A path made only of M, L and Z with coordinates at one decimal or fewer is rewritten in
relative moves (m and l, each the step from the point before) with the repeated command
letter and leading zeros left out: `M1875.8 1587.4L1849.5 1575.3` becomes
`M1875.8 1587.4l-26.3-12.1`. Nothing is rounded: every step is taken between the
coordinates already in the file, counted in whole tenths, so adding the steps back up
lands on exactly those coordinates. Each rewritten path is decoded again and compared
before it is used, and the run stops rather than write one that differs. A path with
curves, arcs or finer coordinates is left as it was.

Most of what this saves is in the download. Relative steps are short and similar, which
compresses far better than a run of four-digit absolutes: the Constellation plates and
the Wabi-sabi seams come out at well under half their compressed size, pixel for pixel
the same drawing.
"""

import re
import sys

_NUM = r'-?\d+(?:\.\d)?'
_TOKEN = re.compile(r'[MLZ]|' + _NUM)
_PLAIN = re.compile(r'(?:[MLZ]|' + _NUM + r'|[\s,])*')


def _tenths(s):
    neg = s.startswith('-')
    whole, _, frac = s.lstrip('-').partition('.')
    v = int(whole or '0') * 10 + int(frac or '0')
    return -v if neg else v


def _fmt(v):
    """Whole tenths as the shortest number SVG reads back to the same value."""
    neg, v = v < 0, abs(v)
    whole, frac = divmod(v, 10)
    s = (str(whole) if whole else '') + (f'.{frac}' if frac else '')
    s = s or '0'
    return '-' + s if neg and s != '0' else s


def _join(nums):
    """Numbers run together the way an SVG parser splits them: a minus sign or a leading
    point starts a new number, so a separator is needed only where neither does."""
    out = ''
    for n in nums:
        if out and not (n.startswith('-') or (n.startswith('.') and '.' in _last(out))):
            out += ' '
        out += n
    return out


def _last(s):
    m = re.search(r'-?[\d.]+$', s)
    return m.group(0) if m else ''


def _points(d):
    """The path as absolute points in tenths: ('M'|'L', x, y) and ('Z',)."""
    toks = _TOKEN.findall(d)
    pts, cmd, i = [], None, 0
    x = y = sx = sy = 0
    while i < len(toks):
        t = toks[i]
        if t in 'MLZ':
            cmd, i = t, i + 1
            if t == 'Z':
                pts.append(('Z',))
                x, y = sx, sy
            continue
        if cmd not in ('M', 'L') or i + 1 >= len(toks) or toks[i + 1] in 'MLZ':
            raise ValueError('not a plain polyline')
        x, y = _tenths(toks[i]), _tenths(toks[i + 1])
        i += 2
        if cmd == 'M':
            pts.append(('M', x, y))
            sx, sy = x, y
            cmd = 'L'  # numbers after a moveto are linetos
        else:
            pts.append(('L', x, y))
    return pts


def _decode(d):
    """Reads a path written by _encode back to absolute points in tenths."""
    toks = re.findall(r'[MmLlZz]|-?(?:\d+\.?\d*|\.\d+)', d)
    pts, cmd, i = [], None, 0
    x = y = sx = sy = 0
    while i < len(toks):
        t = toks[i]
        if t in 'MmLlZz':
            cmd, i = t, i + 1
            if t in 'Zz':
                pts.append(('Z',))
                x, y = sx, sy
            continue
        a, b = round(float(toks[i]) * 10), round(float(toks[i + 1]) * 10)
        i += 2
        if cmd in 'ml':
            a, b = x + a, y + b
        x, y = a, b
        if cmd in 'Mm':
            pts.append(('M', x, y))
            sx, sy = x, y
            cmd = 'l' if cmd == 'm' else 'L'
        else:
            pts.append(('L', x, y))
    return pts


def _encode(pts):
    out, prev, x, y = [], None, 0, 0
    sx = sy = 0
    for p in pts:
        if p[0] == 'Z':
            out.append('z')
            prev = None
            x, y = sx, sy
            continue
        kind, px, py = p
        if not out:
            out.append('M' + _join([_fmt(px), _fmt(py)]))
            prev = None  # numbers after this would be absolute: the first step names its l
        else:
            cmd = 'm' if kind == 'M' else 'l'
            nums = [_fmt(px - x), _fmt(py - y)]
            if cmd == prev:
                body = _join(nums)
                tail = out[-1]
                if not (body.startswith('-') or (body.startswith('.') and '.' in _last(tail))):
                    body = ' ' + body
                out.append(body)
            else:
                out.append(cmd + _join(nums))
            prev = 'l'
        if kind == 'M':
            sx, sy = px, py
        x, y = px, py
    return ''.join(out)


def compact_path(d):
    """The shortest exact form of one path's d, or d unchanged if it is not a plain
    polyline at one decimal or fewer."""
    if not _PLAIN.fullmatch(d) or re.search(r'\.\d\d|[eE]', d):
        return d
    try:
        pts = _points(d)
    except ValueError:
        return d
    if not pts:
        return d
    short = _encode(pts)
    if _decode(short) != pts:
        raise AssertionError(f'relative path does not decode to the original: {d[:80]}')
    return short if len(short) < len(d) else d


def compact_svg(svg):
    """Every d="…" in an SVG document through compact_path."""
    return re.sub(r'(?<=\sd=")([^"]*)(?=")', lambda m: compact_path(m.group(1)), svg)


if __name__ == '__main__':
    for name in sys.argv[1:]:
        with open(name) as f:
            src = f.read()
        out = compact_svg(src)
        with open(name, 'w') as f:
            f.write(out)
        print(f'{name}: {len(src)} -> {len(out)} bytes')
