"""Draws Par Avion's postal markings. Run from the repo root:  python3 scripts/gen-par-avion-stamps.py

Nothing here is a picture of a stamp; it is a stamp being made. Rubber stamps are
uneven — the pad is drier at one edge, the hand rocks, the ink skips — so every mark
is laid down twice (a faint full pass for ink that spread, a broken pass off register
for ink that bit) and then bitten into by a grunge MASK, which is the only way to take
chunks out of the lettering as well as the strokes. Every irregularity comes from a
seeded RNG: change a seed, get a different envelope, deterministically.
"""
import math, random

W, H = 64.0, 76.0          # the paper stamp, in its own units
R = 2.9                    # perforation radius
PAD = 15.0

# Four inks, from four offices. None of them is black.
SOOTY, POSTAL, VIOLET, NAVY = '#332E27', '#B0272C', '#5B3A78', '#274465'
# The stamp is not a rubber stamp and does not share their palette. Gummed paper aged
# on a shelf, engraved in sepia, with the garnish in Sidecar's own orange — the one
# place the brand colour appears in this theme.
STAMP_PAPER, STAMP_INK, SIDECAR_ORANGE = '#F1E6CC', '#6B4726', '#EA772F'
AIRBLUE = '#1A5AA8'

# ---- the paper stamp's perforated silhouette ----------------------------------------
def perforated(w, h, r, margin=7.0, n_h=7, n_v=8):
    p = [f'M{margin:.2f} 0']
    def edge(x0, y0, x1, y1, n):
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy); ux, uy = dx / L, dy / L
        step = L / n
        out = []
        for i in range(n):
            c = (i + 0.5) * step
            a = (x0 + ux * (c - r), y0 + uy * (c - r))
            b = (x0 + ux * (c + r), y0 + uy * (c + r))
            out.append(f'L{a[0]:.2f} {a[1]:.2f}A{r} {r} 0 0 0 {b[0]:.2f} {b[1]:.2f}')
        out.append(f'L{x1:.2f} {y1:.2f}')
        return ''.join(out)
    p.append(edge(margin, 0, w - margin, 0, n_h))
    p.append(f'L{w:.2f} 0L{w:.2f} {margin:.2f}')
    p.append(edge(w, margin, w, h - margin, n_v))
    p.append(f'L{w:.2f} {h:.2f}L{w - margin:.2f} {h:.2f}')
    p.append(edge(w - margin, h, margin, h, n_h))
    p.append(f'L0 {h:.2f}L0 {h - margin:.2f}')
    p.append(edge(0, h - margin, 0, margin, n_v))
    p.append('L0 0Z')
    return ''.join(p)

SIL = perforated(W, H, R)

# ---- ink that did not take -----------------------------------------------------------
def grunge(rnd, uid, w, h, specks=130, scratches=7):
    """A mask of small black bites over white. Applied to a whole marking, it eats the
       lettering and the strokes alike — which a stroke-dasharray cannot do, and which
       is most of the difference between a rubber stamp and a printed circle."""
    parts = []
    for _ in range(specks):
        x, y = rnd.uniform(-2, w + 2), rnd.uniform(-2, h + 2)
        parts.append(f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{rnd.uniform(0.3,2.1):.2f}" '
                     f'ry="{rnd.uniform(0.25,1.5):.2f}" transform="rotate({rnd.uniform(0,180):.0f} {x:.1f} {y:.1f})"/>')
    for _ in range(scratches):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{rnd.uniform(7,26):.1f}" '
                     f'height="{rnd.uniform(0.4,1.2):.2f}" transform="rotate({rnd.uniform(0,180):.0f} {x:.1f} {y:.1f})"/>')
    return (f'<mask id="{uid}" maskUnits="userSpaceOnUse" x="-4" y="-4" width="{w+8:.0f}" height="{h+8:.0f}">'
            f'<rect x="-4" y="-4" width="{w+8:.0f}" height="{h+8:.0f}" fill="#fff"/>'
            f'<g fill="#000">{"".join(parts)}</g></mask>')

def strike(rnd, geom, ink, width, opacity=0.5):
    dx, dy = rnd.uniform(-0.7, 0.7), rnd.uniform(-0.7, 0.7)
    dash = ' '.join(f'{rnd.uniform(7,30):.1f} {rnd.uniform(0.4,2.2):.1f}' for _ in range(16))
    return (f'<g fill="none" stroke="{ink}" stroke-linecap="round">'
            f'<g opacity="{opacity*0.34:.2f}" stroke-width="{width*1.3:.2f}">{geom}</g>'
            f'<g opacity="{opacity:.2f}" stroke-width="{width:.2f}" stroke-dasharray="{dash}" '
            f'stroke-dashoffset="{rnd.uniform(0,50):.1f}" transform="translate({dx:.2f} {dy:.2f})">{geom}</g></g>')

def arced(cx, cy, r, txt, ink, size, up, uid, op, ls=1.4, weight='normal'):
    d = f'M{cx-r} {cy}A{r} {r} 0 0 {1 if up else 0} {cx+r} {cy}'
    return (f'<path id="{uid}" d="{d}" fill="none"/>'
            f'<text font-family="Georgia,serif" font-weight="{weight}" font-size="{size}" '
            f'letter-spacing="{ls}" fill="{ink}" opacity="{op}" text-anchor="middle">'
            f'<textPath href="#{uid}" startOffset="50%">{txt}</textPath></text>')

def star(cx, cy, r, ink, op):
    pts = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.44
        pts.append(f'{cx + rr*math.cos(a):.1f},{cy - rr*math.sin(a):.1f}')
    return f'<polygon points="{" ".join(pts)}" fill="{ink}" opacity="{op}"/>'

def killers(rnd, x0, x1, y0, n, thick, cycles=4, gap=9.5):
    """Killer bars, cut into ONE rubber die.

    Which is the whole correction: every bar carries the same wave, in phase, evenly
    spaced, because they are one block of rubber and not five separate strokes. The
    first version randomised each bar's amplitude, length and droop independently and
    read as five lazy S-curves that happened to be stacked — real ones roll through
    four or five full cycles and their crests line up vertically down the block.

    What DOES vary is the ink. A die rocks as the hand comes down, so it bites hardest
    along one edge and starves toward the other: the weight falls off bar by bar, with
    a little jitter, and the grunge mask takes the rest.

    Amplitude is 7% of the wavelength — measured off the reference cancels, where the
    wave rises a bit less than half the gap between bars. Push it past that and it
    stops being a postal marking and starts being a squiggle."""
    span = x1 - x0
    wl = span / cycles
    amp = wl * 0.07
    halves = cycles * 2
    out = []
    for i in range(n):
        y = y0 + i * gap
        d = [f'M{x0:.1f} {y:.1f}']
        for k in range(halves):
            sign = -1 if k % 2 == 0 else 1
            d.append(f'q{wl*0.25:.1f} {sign*amp:.1f} {wl*0.5:.1f} 0')
        w = max(thick * (1.18 - i * 0.14) * rnd.uniform(0.9, 1.1), thick * 0.42)
        out.append((''.join(d), w))
    return ''.join(f'<path d="{d}" stroke-width="{w:.2f}"/>' for d, w in out)

# ---- the markings ---------------------------------------------------------------------
def postal_cancel(rnd, uid):
    # POSTAL red rather than sooty black, at lower opacities than the handstamps below:
    # this is the mark that lands ON the stamp, so it has to read as ink laid over
    # printing rather than as a second drawing sitting beside it.
    """The machine cancel, modelled on a real one: a double rim, the office legend arced
       between the rims with stars either side, a dated inner circle, and killer bars
       running right through the whole thing and off across the envelope."""
    cx, cy = 36.0, 37.0
    rims = (f'<circle cx="{cx}" cy="{cy}" r="33.5"/>'
            f'<circle cx="{cx+rnd.uniform(-.5,.5):.1f}" cy="{cy+rnd.uniform(-.5,.5):.1f}" r="31"/>'
            f'<circle cx="{cx+rnd.uniform(-.6,.6):.1f}" cy="{cy+rnd.uniform(-.6,.6):.1f}" r="21.5"/>')
    bars = killers(rnd, 74, 214, 15, 6, 3.4)
    # No legend in the band. It carried SIDECAR over the top and NOSTR under it, and
    # a real canceller's ring is mostly empty — the office name is small and the date
    # is the thing you read. Two ornaments and the date is the whole mark now.
    return (strike(rnd, rims, POSTAL, 1.9, 0.44)
            + star(cx - 26.5, cy + 1, 3.4, POSTAL, 0.4)
            + star(cx + 26.5, cy + 1, 3.4, POSTAL, 0.4)
            + f'<g font-family="Georgia,serif" text-anchor="middle" fill="{POSTAL}" opacity="0.42">'
              f'<text x="{cx}" y="{cy-5}" font-size="8.5">JAN</text>'
              f'<text x="{cx}" y="{cy+4.5}" font-size="9.5">03</text>'
              f'<text x="{cx}" y="{cy+15}" font-size="8.5">2009</text></g>'
            + f'<g fill="none" stroke="{POSTAL}" stroke-linecap="round" opacity="0.38">{bars}</g>')

def transit_mark(rnd, cx, cy, uid):
    geom = (f'<circle cx="{cx}" cy="{cy}" r="15.5"/>'
            + ''.join(f'<path d="M{cx-11+i*5.5:.1f} {cy-11}L{cx-11+i*5.5:.1f} {cy+11}"/>' for i in range(5)))
    return strike(rnd, geom, NAVY, 1.5, 0.46)

def plane(cx, cy, ink, s, op=0.85):
    """An airliner from above, nose right: fuselage, swept wings, tailplane. Drawn
       symmetrically about its own axis rather than as a dart — the dart shape that was
       here read as a cursor or a paper plane, never as an aircraft."""
    pts = [(16,0),(2,-1.8),(-7,-9.5),(-10,-9.5),(-5,-1.8),(-11,-2.6),(-13.5,-5.5),
           (-15.5,-5.5),(-15,-1.2),(-16.5,0),(-15,1.2),(-15.5,5.5),(-13.5,5.5),
           (-11,2.6),(-5,1.8),(-10,9.5),(-7,9.5),(2,1.8)]
    d = 'M' + 'L'.join(f'{cx+x*s:.2f} {cy+y*s:.2f}' for x, y in pts) + 'Z'
    return f'<path d="{d}" fill="{ink}" fill-opacity="{op}"/>'

# The garnish from icons/avatar-default.svg — the orange slice the app already uses
# wherever an account has no picture. Same geometry, byte for byte, re-inked to the
# stamp's colour: a stamp's vignette should be the thing the app puts on its own
# faces, not a second drawing of the same idea. Its viewBox is 32x32, so it arrives
# scaled and centred rather than in stamp units.
GARNISH = '''<path d="M27.9893 16.5233H19.6552C19.1602 16.5233 18.7552 16.9283 18.7552 17.4233C18.7552 17.6663 18.8542 17.8913 19.0162 18.0623L25.1093 24.1553C26.9812 22.0583 28.0162 19.3403 27.9982 16.5323L27.9893 16.5233Z"/><path d="M27.8992 15.1643C27.5482 12.3472 26.1532 9.75525 23.9842 7.91925L18.2692 13.6343C17.9182 13.9853 17.9182 14.5523 18.2692 14.9033C18.4402 15.0743 18.6652 15.1643 18.9082 15.1643H27.8902H27.8992Z"/><path d="M24.1463 25.1002L18.0533 19.0072C17.7023 18.6562 17.1353 18.6562 16.7843 19.0072C16.6133 19.1782 16.5233 19.4032 16.5233 19.6462V27.9802C19.3313 27.9982 22.0493 26.9722 24.1463 25.1002Z"/><path d="M15.1642 27.8992V18.9082C15.1642 18.4132 14.7592 18.0082 14.2642 18.0082C14.0212 18.0082 13.7962 18.1072 13.6252 18.2692L7.90125 23.9932C9.74625 26.1622 12.3382 27.5572 15.1642 27.8902V27.8992Z"/><path d="M26.9183 6.26325C26.5673 5.91225 26.0003 5.91225 25.6493 6.26325L24.9563 6.95625C30.2753 11.5823 30.8243 19.6463 26.1983 24.9653C21.5722 30.2843 13.5083 30.8333 8.18925 26.2073C7.74825 25.8203 7.33425 25.4063 6.94725 24.9653L6.26325 25.6493C5.91225 26.0003 5.91225 26.5673 6.26325 26.9183C11.9693 32.6243 21.2123 32.6243 26.9183 26.9183C32.6243 21.2123 32.6243 11.9693 26.9183 6.26325Z"/>'''

def garnish(cx, cy, ink, size=27.5):
    k = size / 32.0
    return (f'<g transform="translate({cx-size/2:.2f} {cy-size/2:.2f}) scale({k:.4f})" '
            f'fill="{ink}">{GARNISH}</g>')

def key(cx, cy, ink, size=None):
    return (f'<g stroke="{ink}" stroke-width="1.9" fill="none" stroke-linecap="round">'
            f'<circle cx="{cx-4}" cy="{cy-4}" r="6"/>'
            f'<path d="M{cx+0.5} {cy+0.5}L{cx+10} {cy+10}"/>'
            f'<path d="M{cx+7} {cy+7}L{cx+10.5} {cy+3.5}"/>'
            f'<path d="M{cx+3.5} {cy+3.5}L{cx+7} {cy}"/></g>')

def air_box(rnd, w, h):
    """The PAR AVION handstamp: a rough box, the legend, and a plane flying out of it.
       Blue, because the airmail handstamp is the one marking on an envelope that is
       neither the canceller's black nor the clerk's violet."""
    geom = f'<rect x="2.5" y="2.5" width="{w-5}" height="{h-5}"/>'
    return (strike(rnd, geom, AIRBLUE, 2.4, 0.62)
            + f'<text x="{w/2-7}" y="{h/2+5.5:.1f}" text-anchor="middle" font-family="Georgia,serif" '
              f'font-size="15" letter-spacing="3" fill="{AIRBLUE}" opacity="0.66">PAR AVION</text>'
            + plane(w - 22, h / 2 - 1, AIRBLUE, 0.62, 0.6))

def clerk_oval(rnd, cx, cy):
    geom = (f'<ellipse cx="{cx}" cy="{cy}" rx="41" ry="24"/>'
            f'<ellipse cx="{cx}" cy="{cy}" rx="36" ry="19.5"/>')
    return (strike(rnd, geom, VIOLET, 1.5, 0.5)
            + f'<text x="{cx}" y="{cy-1.5}" text-anchor="middle" font-family="Georgia,serif" '
              f'font-weight="bold" font-size="10.5" letter-spacing="2.4" fill="{VIOLET}" opacity="0.6">SIGNED</text>'
            + f'<text x="{cx}" y="{cy+10}" text-anchor="middle" font-family="Georgia,serif" '
              f'font-size="5.6" letter-spacing="1.8" fill="{VIOLET}" opacity="0.52">ON DEVICE</text>')

HDR = '''<!--
  Sidecar — Par Avion. {what}
  Generated by scripts/gen-par-avion-stamps.py; edit that, not this. The header there
  explains the two-pass strike and the grunge mask, which are what keep these from
  looking printed. CSS cannot rotate a background image, so each file bakes its own
  tilt and pads its viewBox to hold it.
-->
'''

def wrap(path, what, w, h, rot, body, mask_uid, rnd, specks=130, pad=3.0):
    """Write one rubber-stamp file, with a viewBox big enough to hold its own tilt.

    THIS IS WHY EVERY MARK USED TO HAVE A FLAT SIDE. The body is drawn to a w x h box
    and then rotated about that box's centre, but the viewBox was left at w x h — and a
    rotated rectangle does not fit in its own footprint. Anything far from the centre of
    rotation swings furthest: the cancel's dial sits 74 units left of centre, so a mere
    1.5deg tilt dropped it 1.9 units and put its bottom edge on the crop line, and PAR
    AVION's 6.5deg pushed its top-right corner 7 units above the box and its bottom-left
    7 below. Distress is welcome on these; a straight razor cut is not, and that is what
    a viewBox edge looks like.

    So the box is computed from the rotation rather than assumed:

        W' = w|cos O| + h|sin O|      H' = w|sin O| + h|cos O|

    which is the true bounding box of the rotated rectangle, plus `pad` all round for
    the stroke halo (the faint pass is drawn 1.25x wide) and for the grunge, which bites
    outward as well as in. The content is then centred in the larger box, so it lands
    where it did before.

    CHANGING A ROTATION CHANGES THE ASPECT RATIO, and the CSS sizes these by height —
    so the run below prints the height each mark now needs to render at its previous
    width. Re-tilt one of these and read the new numbers off that output rather than
    guessing at them."""
    a = math.radians(rot)
    ca, sa = abs(math.cos(a)), abs(math.sin(a))
    W = w * ca + h * sa + 2 * pad
    H = w * sa + h * ca + 2 * pad
    ox, oy = (W - w) / 2, (H - h) / 2
    svg = (HDR.format(what=what)
           + f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" '
             f'width="{W:.0f}" height="{H:.0f}">{grunge(rnd, mask_uid, W, H, specks)}'
             f'<g mask="url(#{mask_uid})" transform="translate({ox:.2f} {oy:.2f}) '
             f'rotate({rot} {w/2:.1f} {h/2:.1f})">{body}</g></svg>\n')
    open(path, 'w').write(svg)
    name = path.rsplit('/', 1)[-1]
    print(f'  {name:28s} viewBox {W:5.0f} x {H:4.0f}   was {w} x {h}   '
          f'css height x{H/h:.3f} to hold width; content inset {ox:.1f},{oy:.1f} units')
    return len(svg)

def paper_stamp(path, what, vig, ink, paper, vig_ink, rot, seed):
    rnd = random.Random(seed)
    stamp = (f'<g transform="rotate({rot} {W/2} {H/2})">'
             # The two rules on the paper are the quietest lines on the envelope. The
             # perforated edge is a torn paper edge, not a drawn one — it wants to be
             # only just visible where the cream meets the manila — and the printed
             # frame is a hairline around a vignette, not a box around a button. Both
             # came down (0.34 to 0.16, 0.55 to 0.3) once the engraving inside them was
             # dark enough to carry the stamp on its own.
             f'<path d="{SIL}" fill="{paper}" stroke="{ink}" stroke-opacity="0.16" stroke-width="0.7"/>'
             f'<rect x="6" y="6" width="{W-12}" height="{H-12}" fill="none" '
             f'stroke="{ink}" stroke-opacity="0.3" stroke-width="1"/>'
             # Everything lives inside the printed frame, which runs y 6..70 in these
             # units. SATS used to sit at y=72 — printed across the perforations, i.e.
             # off the edge of the stamp. Georgia's caps are ~0.69em, so each baseline
             # below is its cap height plus a margin off the frame it sits nearest:
             #   SIDECAR  16.8  caps from 12.7 — 6.7 below the frame top
             #   21       57.0  caps from 49.4
             #   SATS     63.0  caps from 59.8 — 7.0 above the frame foot
             # Top and bottom margins are 6.7 and 7.0, which is the point: the block
             # used to run to 67 and sat visibly low, jammed against the perforations
             # with all the slack left at the top. The garnish is then 27.5 units centred
             # at 33.1, the midpoint of what the type leaves (16.8 to 49.4), so its own
             # gaps come out even at 2.8 rather than being eyeballed. The legend gave up
             # 0.7 of its top margin to buy the vignette that size; on a stamp the
             # picture is the thing you look at and the country name is a caption.
             f'<text x="{W/2}" y="16.8" text-anchor="middle" font-family="Georgia,serif" '
             f'font-size="6" letter-spacing="1.2" fill="{ink}">SIDECAR</text>'
             f'{vig(W/2, 33.1, vig_ink, 27.5)}'
             f'<text x="{W/2}" y="57" text-anchor="middle" font-family="Georgia,serif" '
             f'font-size="11" font-weight="bold" fill="{ink}">21</text>'
             f'<text x="{W/2}" y="63" text-anchor="middle" font-family="Georgia,serif" '
             f'font-size="4.6" letter-spacing="0.9" fill="{ink}" fill-opacity="0.8">SATS</text></g>')
    # No cancel ON the stamp. It wore a transit mark of its own, which put two rings
    # within an inch of each other once the machine cancel landed beside it; one strike
    # per envelope corner is what a real one has.
    mark = ''
    svg = (HDR.format(what=what)
           + f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W+2*PAD:.0f} {H+2*PAD:.0f}" '
             f'width="{W+2*PAD:.0f}" height="{H+2*PAD:.0f}">'
             f'<g transform="translate({PAD} {PAD})">{stamp}{mark}</g></svg>\n')
    open(path, 'w').write(svg)
    return len(svg)

tot = 0
r = random.Random(21)
tot += wrap('themes/par-avion-cancel.svg', 'The machine cancel: dated rings and killer bars.',
            220, 74, -1.5, postal_cancel(r, 'pc'), 'mpc', random.Random(210), specks=210)
r = random.Random(7)
tot += wrap('themes/par-avion-mark-air.svg', 'The PAR AVION handstamp, in airmail blue.',
            176, 44, -6.5, air_box(r, 176, 44), 'mab', random.Random(70))
r = random.Random(9)
tot += wrap('themes/par-avion-mark-oval.svg', "The receiving clerk's violet oval.",
            # 88x54, not 80x44: the ellipse is rx 41 / ry 24, which did not fit the
            # half-width of the box it was nominally drawn in. wrap() pads for the
            # tilt, not for content that overflows before it is even rotated.
            88, 54, 4.5, clerk_oval(r, 44, 27), 'mov', random.Random(90))
# Aged cream paper, sepia engraving, orange garnish. The cancel that lands on it is the
# red one, so the stamp itself keeps out of that hue entirely — a red mark on a red
# stamp is a mark you cannot see.
tot += paper_stamp('themes/par-avion-stamp-a.svg', 'The garnish, engraved on aged cream.',
                   garnish, STAMP_INK, STAMP_PAPER, SIDECAR_ORANGE, -9.5, 21)
print('five files,', tot, 'bytes')
