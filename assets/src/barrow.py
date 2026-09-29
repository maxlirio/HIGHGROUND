"""HIGHGROUND - long barrow on Harrow Ridge crest (Ashby's ley; mana site, ancient, never glowing).

A Neolithic long barrow ~24 m: a grassy trapezoidal mound, high and broad at its east end
(front, -Y) and tapering to a low tail, slumped and sheep-scarred, a few kerbstones of its old
peristalith showing along the flanks and an old thorn rooted on its back. The front is a
crescent facade of upright slabs with dry-stone walling between, horns reaching forward round
a small forecourt; in the middle a stone-lined passage entrance (two portal stones and a
capstone lintel) opens into blackness, its blocking stone dragged aside and left leaning.

    blender -b -t 2 -P assets/src/barrow.py
Front faces -Y. 1 unit = 1 m.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _landkit import *

begin(91)
mat_turf("turf", dry=0.35, flowers=0.35, bare=0.35)
MAT["fore"] = m_ground("fore", grass=0.75, trod=(0.0, -12.6, 0.8, 3.2))
PCOL["fore"] = "#5a5a35"
mat_megalith("megalith", carve=carving(cups=[(0.3, 1.72, 0.045, 2), (-0.35, 1.7, 0.04, 1)], depth=0.9), moss=0.8)
MAT["dry"] = m_stone2("dry", [(0.0, "#6f695e"), (0.35, "#80796b"), (0.7, "#8e8676"), (1.0, "#756e62")], "#3f3a32",
                      rowh=0.13, bw=0.42, moss=1.6, bump=1.2)
MAT["dark"] = m_simple2("dark", "#1e1b18", "#27231e", 0.95)

Y0, Y1 = -10.5, 12.5          # front / tail of the mound
HW0, HW1 = 6.0, 3.3           # half widths
HM0, HM1 = 2.75, 1.2          # heights


def yf(x):                    # facade line: horns reach forward
    return Y0 - 1.5 * (x / HW0) ** 2


def mound_h(x, y):
    if y < yf(x):
        return 0.0
    t = min(1.0, max(0.0, (y - Y0) / (Y1 - Y0)))
    hw = HW0 + (HW1 - HW0) * t
    u = abs(x) / hw
    if u >= 1.0:
        return 0.0
    hm = HM0 + (HM1 - HM0) * t ** 0.85
    body = (1 - u ** 2.4) ** 1.5
    tail = min(1.0, max(0.0, (Y1 - y) / 4.5)) ** 0.8
    h = hm * body * (0.35 + 0.65 * tail) * (tail ** 0.5)
    # the mound leans back from the facade: at the stones it is only as high as they are
    h *= min(1.0, 0.45 + 0.55 * (max(0.0, y - yf(x)) / 3.5) ** 0.7)
    # slumps, lumps and sheep scars
    h += 0.4 * MN.noise(Vector((x * 0.2, y * 0.16, 2.0))) * body
    h += 0.14 * MN.noise(Vector((x * 0.7, y * 0.7, 5.0))) * body
    h -= 0.1 * max(0.0, MN.noise(Vector((x * 0.25 + y * 0.9, 0.3, 7.0)))) * body
    return max(0.0, h)


# heightfield (fine rows near the facade so the retained edge stays crisp)
xs = [(-7.0 + 14.0 * i / 34) for i in range(35)]
ys = []
y = Y0 - 1.9
while y < Y1 + 0.3:
    ys.append(y)
    y += 0.3 if y < Y0 + 1.5 else 0.55
P, F = [], []
for j, y in enumerate(ys):
    for i, x in enumerate(xs):
        P.append((x, y, mound_h(x, y)))
nx_ = len(xs)
for j in range(len(ys) - 1):
    for i in range(nx_ - 1):
        a = j * nx_ + i
        q = (a, a + 1, a + nx_ + 1, a + nx_)
        if max(P[k][2] for k in q) > 0.001:
            F.append(q)
# drop unused verts
used = sorted({k for f in F for k in f}); remap = {k: n for n, k in enumerate(used)}
B("mound", "turf").add([P[k] for k in used], [[remap[k] for k in f] for f in F], None, None)

# forecourt pad
ground_patch(B("fore"), 0.0, Y0 - 2.2, 6.0, 3.2, h=0.06, n=28, rings=4, bump=0.02, seed=4.0)

# ---- facade: orthostats + dry-stone panels along the crescent
dry = B("drywall", "dry")
ms = B("stones", "megalith")
posts = [-5.9, -4.6, -3.3, -2.0, -0.72, 0.72, 2.0, 3.3, 4.6, 5.9]
hts = {-5.9: 1.05, -4.6: 1.3, -3.3: 1.55, -2.0: 1.8, -0.72: 2.2, 0.72: 2.25, 2.0: 1.75, 3.3: 1.5, 4.6: 1.25, 5.9: 0.95}
for k, x in enumerate(posts):
    y = yf(x) - 0.28
    slope = 3.0 * x / HW0 ** 2
    yaw = math.atan(slope)
    w = 1.25 if abs(x) < 1 else R.uniform(0.9, 1.2)
    rock(ms, (x, y, 0), (w, 0.48, hts[x] + 0.3), 9100 + k, yaw=yaw, sink=0.12, blocky=3.2, amp=0.07, cuts=0, sub=3,
         taper=0.2, facets=3, facet_depth=(0.03, 0.08), lean=(jit(0.05), jit(0.05)))
for a, b in zip(posts[:-1], posts[1:]):
    if a == -0.72:
        continue            # the entrance
    n = 3
    for s in range(n):
        x0 = a + (b - a) * (s / n) + 0.35 * (s == 0)
        x1 = a + (b - a) * ((s + 1) / n) - 0.35 * (s == n - 1)
        xm = (x0 + x1) / 2
        hh = min(hts[a], hts[b]) * 0.82 + jit(0.06)
        y0, y1 = yf(x0) - 0.3, yf(x1) - 0.3
        pts = []
        for (xx, yy) in ((x0, y0), (x1, y1)):
            for dd, top in ((-0.22, hh), (0.3, hh + 0.12)):
                pts += [(xx, yy + dd, 0.0), (xx, yy + dd * 0.8, top)]
        prism_hull(dry, pts)
# passage: capstone lintel over the portal stones, a dark throat, side slabs inside
rock(ms, (0.0, yf(0) - 0.25, 1.62), (2.35, 0.95, 0.55), 9200, yaw=0.02, sink=0.0, blocky=3.4, amp=0.06, cuts=0, sub=3,
     facets=3, squash_top=0.2)
box(B("dark"), (-0.46, yf(0) - 0.05, 0.0), (0.46, yf(0) + 2.6, 1.62))
for sgn in (-1, 1):
    rock(ms, (sgn * 0.62, yf(0) + 1.3, 0), (0.28, 2.4, 1.7), 9300 + (sgn > 0), yaw=0.0, sink=0.05, blocky=4, amp=0.05,
         cuts=0, sub=2)
rock(ms, (0.0, yf(0) + 1.4, 1.62), (1.6, 2.6, 0.5), 9310, yaw=0.0, sink=0.0, blocky=4, amp=0.05, cuts=0, sub=2)
# the blocking stone, levered out and left leaning against the facade
rock(ms, (1.45, yf(1.45) - 1.0, 0), (1.3, 0.42, 1.75), 9400, yaw=0.2, sink=0.05, blocky=3.0, amp=0.07, cuts=0, sub=3,
     lean=(0.42, 0.1), facets=2)
scatter_stones(ms, 0.4, Y0 - 1.6, 2.4, 0.7, 7, 0.14, 0.3, 94)

# ---- kerbstones of the old peristalith showing along the flanks
for sgn in (-1, 1):
    for k in range(7):
        y = Y0 + 2.0 + k * 2.9 + jit(0.4)
        t = (y - Y0) / (Y1 - Y0)
        hw = HW0 + (HW1 - HW0) * t
        if R.random() < 0.3:
            continue
        rock(ms, (sgn * (hw + 0.1), y, 0), (0.5, 1.0, 0.75 + R.uniform(0, 0.4)), 9500 + k * 2 + (sgn > 0),
             yaw=jit(0.2), sink=0.3, blocky=3.0, amp=0.1, cuts=0, sub=2, lean=(jit(0.2), sgn * 0.2))

# ---- an old thorn rooted on the barrow's back, and rank grass along its foot
thorn_tree(1.2, 6.5, height=2.9, seed=23, rags=0, lean=(-0.3, 0.35))
for i in range(40):
    sgn = R.choice((-1, 1))
    y = R.uniform(Y0 + 0.5, Y1 - 1.0)
    t = (y - Y0) / (Y1 - Y0)
    hw = HW0 + (HW1 - HW0) * t
    x = sgn * hw * R.uniform(0.92, 1.05)
    tussock(B("tuft", "turf"), x, y, mound_h(x, y), R.uniform(0.9, 1.4), blades=10)
for x in (-4.5, -3.0, 2.8, 4.2, -1.8, 1.9):
    tussock(B("tuft", "turf"), x + jit(0.2), yf(x) - 0.7, 0.03, 1.2, blades=11)

done("barrow", tex=2048, lods=(1.0, 0.4, 0.12))
