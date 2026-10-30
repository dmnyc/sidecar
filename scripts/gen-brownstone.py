#!/usr/bin/env python3
"""Generate Brownstone's compact vector masonry and selected 11A frieze."""
from pathlib import Path
from random import Random

ROOT = Path(__file__).resolve().parent.parent / 'themes'


def grain():
    """Fixed seed, small repeat, no bitmap or SVG filter surface."""
    rng = Random(11)
    marks = []
    for _ in range(150):
        x, y = rng.uniform(0, 173), rng.uniform(0, 149)
        marks.append(f'M{x:.1f} {y:.1f}h{rng.uniform(.3, 1.0):.1f}')
    return ('<pattern id="grain" width="173" height="149" patternUnits="userSpaceOnUse">'
            '<path d="' + ''.join(marks) + '" stroke="#d6b18a" stroke-opacity=".085" '
            'stroke-width=".55"/></pattern>')


MOLDING = '''<linearGradient id="molding" x2="0" y2="1">
<stop stop-color="#7e644b"/><stop offset=".09" stop-color="#604a38"/>
<stop offset=".23" stop-color="#3b2d23"/><stop offset=".3" stop-color="#70563f"/>
<stop offset=".46" stop-color="#624b38"/><stop offset=".75" stop-color="#382b23"/>
<stop offset=".8" stop-color="#75563f"/><stop offset="1" stop-color="#221c18"/>
</linearGradient>'''


def frieze():
    # No viewBox: the viewport takes the CSS background size, while carved shapes
    # retain their pixel dimensions. Percentage positions distribute five blooms.
    petals = ''.join(f'<use href="#petal" transform="rotate({a})"/>' for a in range(0, 360, 45))
    flowers = []
    for i, x in enumerate((10, 30, 50, 70, 90)):
        scale = 1 if i == 2 else .64
        flowers.append(f'''<svg x="{x}%" y="65" width="1" height="1" overflow="visible">
<g transform="scale({scale})">
<use href="#flower" x=".8" y="1" fill="#181816" opacity=".6"/>
<use href="#flower" x="-.4" y="-.5" fill="#b4936f" opacity=".3"/>
<use href="#flower" fill="#5c4836"/>
</g></svg>''')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="356">
<!-- Selected 11A: four small open flowers and a larger matching center.
     Opaque molding and bounded panel paths keep joints out of raised stone. -->
<defs>{MOLDING}{grain()}
<path id="petal" d="M0 -5C-5 -10 -5 -20 0 -26C5 -20 5 -10 0 -5Z"/>
<g id="flower">{petals}</g>
<linearGradient id="face" x2=".15" y2="1">
<stop stop-color="#534133"/><stop offset="1" stop-color="#49392e"/>
</linearGradient>
<pattern id="panels" width="300" height="146" patternUnits="userSpaceOnUse" x="50%" y="194">
<rect width="300" height="146" fill="#49392e"/>
<rect x="8" y="10" width="280" height="126" fill="url(#face)"/>
<path d="M8 136V10H288" fill="none" stroke="#e0bb8f" stroke-opacity=".13" stroke-width=".8"/>
<path d="M8 136H288V10" fill="none" stroke="#171311" stroke-opacity=".5" stroke-width="1.6"/>
</pattern>
</defs>
<rect width="100%" height="356" fill="#49392e"/>
<rect width="100%" height="21" fill="url(#molding)"/>
<rect y="22" width="100%" height="10" fill="#523e2e"/>
<path d="M0 24H10000M0 29H10000" stroke="#b29170" stroke-opacity=".28" stroke-width=".7"/>
<rect y="33" width="100%" height="64" fill="#4a3a2e"/>
{''.join(flowers)}
<path d="M0 33H10000M0 98H10000" stroke="#181715" stroke-width="1.5"/>
<rect y="99" width="100%" height="35" fill="url(#molding)"/>
<path d="M0 136H10000" stroke="#101416" stroke-opacity=".7" stroke-width="4"/>
<rect y="157" width="100%" height="35" fill="url(#molding)"/>
<path d="M0 192H10000" stroke="#0c1012" stroke-opacity=".5" stroke-width="3"/>
<rect y="194" width="100%" height="146" fill="url(#panels)"/>
<rect y="343" width="100%" height="12" fill="url(#molding)"/>
<path d="M0 355H10000" stroke="#101113" stroke-opacity=".48"/>
<rect width="100%" height="356" fill="url(#grain)"/>
</svg>
'''


def masonry():
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="640" height="230" viewBox="0 0 640 230">
<!-- Two straight ashlar courses. Repeats only below the opaque frieze. -->
<defs>{grain()}</defs>
<rect width="640" height="230" fill="#49392e"/>
<path d="M0 .7H640M0 115.7H640M213 0V115M519 0V115M66 115V230M365 115V230"
 fill="none" stroke="#0c0e0f" stroke-opacity=".5" stroke-width="1.35"/>
<path d="M0 2H640M0 117H640M214.5 2V114M520.5 2V114M67.5 117V229M366.5 117V229"
 fill="none" stroke="#d1b18c" stroke-opacity=".085" stroke-width=".75"/>
<rect width="640" height="230" fill="url(#grain)"/>
</svg>
'''


if __name__ == '__main__':
    for name, svg in [('brownstone-frieze.svg', frieze()), ('brownstone-pattern.svg', masonry())]:
        (ROOT / name).write_text(svg)
        print(f'{name}: {len(svg.encode()):,} bytes')
