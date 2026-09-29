"""HIGHGROUND - village gallows (prop). Grim, not gory: an empty noose.

Two weathered oak uprights on a cross-footing over padstones, a crossbeam with knee braces, an
empty noose, a ladder leaning on one post, all on a low grassy mound with a trodden bare crown,
and a crude crooked fingerpost at the foot of the mound.

    blender -b -P assets/src/gallows.py            (complete only)

Front faces -Y. 1 unit = 1 m.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _parish_kit as K
from _parish_kit import B, box, beam, cyl, prism_hull, jit, R, TRS

K.begin(seed=53)
M = K.MAT
M["oak"] = K.m_wood("oak", [(0.0, "#4a3a2a"), (0.5, "#5a4a38"), (1.0, "#665440")], weather_hex="#86806f",
                    weathered=0.6)
M["plank"] = K.m_wood("plank", [(0.0, "#6f6353"), (0.5, "#80766a"), (1.0, "#8d8272")], weather_hex="#938c7f",
                      weathered=0.7, grain_k=1.3)
M["stone"] = K.m_stone("stone", [(0.0, "#857d6c"), (0.5, "#9e937d"), (1.0, "#7a7365")], "#6f675b", joints=False,
                       moss=1.4)
M["iron"] = K.m_simple("iron", "#35332f", "#45403a", 0.72, rust=True)
M["rope"] = K.m_rope("rope")
M["weed"] = K.m_foliage("weed", dark="#4a5228", light="#7d7f43")
M["mound"] = K.m_ground("mound", wet=0.2, grass=0.85, trod=(0.0, 0.0, 1.3, 2.4))

# ------------------------------------------------------------------ mound
MH = 1.0
mound = lambda t, a: MH * (1 - t * t) ** 1.4 * (1 + 0.1 * math.sin(3 * a + 1.0))
K.ground_patch(B("mound"), 0.0, 0.0, 4.6, 4.0, h=0.0, n=34, rings=6, bump=0.07, feather=False, seed=5.0,
               shape=mound)


def gz(x, y):
    """mound height under (x, y)."""
    t = min(1.0, math.sqrt((x / 4.6) ** 2 + (y / 4.0) ** 2))
    return MH * (1 - t * t) ** 1.4


# a few half-buried stones in the flank
for (x, y, s) in ((2.6, -1.9, 0.4), (-2.9, -1.2, 0.33), (1.2, 2.7, 0.38), (-1.6, 2.3, 0.28)):
    K.blob(B("stone"), (x, y, gz(x, y) - s * 0.35), s, s * 0.8, s * 0.55, sub=1, amp=0.2, seed=x)

# rank grass, nettles and docks in tussocks round the flanks and the post feet
for i in range(18):
    a = R.uniform(0, 2 * math.pi)
    rr = R.uniform(0.6, 1.0)
    x, y = math.cos(a) * 4.3 * rr, math.sin(a) * 3.7 * rr
    K.tussock(B("weed"), x, y, gz(x, y) - 0.02, R.uniform(0.8, 1.3), seed=i * 2.3)
for (x, y) in ((-1.25, 0.95), (-1.25, -0.95), (1.25, 0.95), (1.25, -0.95), (-3.0, -2.0)):
    K.tussock(B("weed"), x + jit(0.15), y + jit(0.1), gz(x, y) - 0.02, 0.9, seed=x * 3 + y)

# ------------------------------------------------------------------ frame
X = 1.25                 # half span between posts
TOPZ = 3.75
base = gz(0, 0)
for sx in (-1, 1):
    x = sx * X
    # padstones + sill (cross-footing) so the posts don't rot in the earth
    for dy in (-0.75, 0.75):
        box(B("stone"), (x - 0.22, dy - 0.2, base - 0.15), (x + 0.22, dy + 0.2, base + 0.12), 0.03,
            rot=(0, 0, jit(0.2)))
    beam(B("oak"), (x, -0.95, base + 0.2), (x, 0.95, base + 0.2), 0.24, 0.2, 0.02)
    # post, slightly out of true
    top = Vector((x + sx * 0.03 + jit(0.02), jit(0.03), TOPZ))
    beam(B("oak"), (x, 0.0, base + 0.2), tuple(top), 0.26, 0.26, 0.025)
    # raking struts from sill to post
    for dy in (-0.85, 0.85):
        beam(B("oak"), (x, dy, base + 0.3), (x, 0.0, base + 1.45), 0.14, 0.13, 0.015, ext=0.03)
# crossbeam, oversailing both posts
beam(B("oak"), (-X - 0.45, 0.0, TOPZ + 0.12), (X + 0.45, jit(0.02), TOPZ + 0.12 + jit(0.03)), 0.26, 0.28, 0.025)
# knee braces
for sx in (-1, 1):
    beam(B("oak"), (sx * X, 0.0, TOPZ - 0.75), (sx * (X - 0.62), 0.0, TOPZ), 0.13, 0.14, 0.012, ext=0.02)
# iron staples and a wedge where the brace meets
for sx in (-1, 1):
    box(B("iron"), (sx * X - 0.14, -0.15, TOPZ - 0.06), (sx * X + 0.14, -0.13, TOPZ + 0.3), 0.0)

# ------------------------------------------------------------------ the noose (empty)
nx = 0.25
beam(B("rope"), (nx - 0.02, -0.15, TOPZ + 0.26), (nx + 0.02, 0.15, TOPZ + 0.26), 0.04, 0.04, 0.0)
for sy in (-1, 1):
    beam(B("rope"), (nx, sy * 0.15, TOPZ + 0.26), (nx, sy * 0.15, TOPZ - 0.0), 0.035, 0.035, 0.0)
drop_top = TOPZ - 0.02
coil_z = TOPZ - 0.95
cyl(B("rope"), (nx, 0.0, drop_top), (nx + 0.01, 0.0, coil_z), 0.018, n=5)
cyl(B("rope"), (nx + 0.01, 0.0, coil_z + 0.02), (nx + 0.01, 0.0, coil_z - 0.2), 0.036, 0.034, n=7)   # the knot's coils
for k in range(4):
    z = coil_z + 0.0 - k * 0.05
    cyl(B("rope"), (nx + 0.01, 0.0, z - 0.012), (nx + 0.01, 0.0, z + 0.012), 0.042, n=7)
# loop
r = 0.15
cz = coil_z - 0.2 - r
pts = [(nx + 0.01 + r * math.sin(2 * math.pi * i / 10) * 0.75, r * 0.1 * math.sin(2 * math.pi * i / 10),
        cz + r * math.cos(2 * math.pi * i / 10)) for i in range(11)]
for i in range(10):
    beam(B("rope"), pts[i], pts[i + 1], 0.024, 0.024, 0.0, ext=0.008)

# ------------------------------------------------------------------ ladder leaning on the east post
lb = Vector((X + 1.25, -0.2, gz(X + 1.25, -0.2) - 0.02))
lt = Vector((X + 0.18, -0.2, TOPZ - 0.35))
d = (lt - lb)
side = Vector((0, 1, 0))
for s in (-0.21, 0.21):
    beam(B("plank"), tuple(lb + side * s), tuple(lt + side * s), 0.065, 0.075, 0.01)
n = int(d.length / 0.32)
for i in range(1, n):
    p = lb + d * (i / n)
    if i == 6:
        continue                  # a missing rung
    cyl(B("plank"), tuple(p - side * 0.24), tuple(p + side * 0.24), 0.022, n=5)

# ------------------------------------------------------------------ crude fingerpost at the foot of the mound
sp = Vector((-3.0, -2.3, gz(-3.0, -2.3) - 0.05))
top = sp + Vector((0.06, 0.04, 2.4))
beam(B("oak"), tuple(sp + Vector((0, 0, -0.1))), tuple(top), 0.14, 0.13, 0.012)
box(B("stone"), (sp.x - 0.25, sp.y - 0.2, 0.0), (sp.x + 0.2, sp.y + 0.22, 0.2), 0.03, rot=(0.1, 0, 0.4))
for (z, yaw, L_, droop) in ((2.05, 0.35, 1.05, -0.05), (1.72, 2.6, 0.9, 0.07)):
    Mx = TRS((sp.x + 0.03, sp.y + 0.02, z), (0.0, droop, yaw))
    w, t = 0.2, 0.035
    prof = [(0.0, -w / 2), (L_ - 0.18, -w / 2), (L_, 0.0), (L_ - 0.18, w / 2), (0.0, w / 2)]
    prism_hull(B("plank"), [tuple(Mx @ Vector((u, dd, v))) for (u, v) in prof for dd in (-t / 2, t / 2)])
    # iron nail heads
    cyl(B("iron"), tuple(Mx @ Vector((0.05, -0.03, 0.0))), tuple(Mx @ Vector((0.05, 0.03, 0.0))), 0.02, n=5)
# a crow-picked cap on the post
prism_hull(B("oak"), [(top.x + a, top.y + b, top.z) for a in (-0.08, 0.08) for b in (-0.075, 0.075)] +
           [(top.x, top.y, top.z + 0.1)])

K.finalize("gallows", tex=1024, lods=(1.0, 0.4, 0.15))
