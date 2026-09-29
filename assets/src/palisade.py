"""HIGHGROUND - timber palisade kit (procedural, Blender 5.1).

    blender -b -P assets/src/palisade.py -- <module>
    modules: palisade  palisade_b  palisade_build1  palisade_ruin
    (PAL_TEX=<px> overrides the bake size)

A 6.0 m run of split-oak palisade on an earth bank: sharpened stakes (split half-logs, some
still in their bark, a few whole poles) set in the crest of the bank, two pegged rails on the
inside, a plank fighting walk on posts and joists behind, and on the outer (-Y) side the bank
falls to a shallow ditch with a low counterscarp lip beyond it.

KIT CONVENTIONS - identical to the stone wall kit (assets/src/wall_stone.py):
  * pivot = centre of the 6 m cell ON THE STAKE LINE (the wall centreline), z = 0 ground,
    the module runs x = -3..+3, outer face toward -Y, ports at (-3,0,0) and (+3,0,0).
  * the earthwork profile at x = +-3 depends on y only and the earth material samples its
    noise in mirrored port-local coordinates, so any module abuts any other seamlessly.
  * stakes sit on a fixed 0.3 m pitch (x = -2.85 .. 2.85), rails/ledger/deck planks end on the
    ports and walk posts / joists are on a 1.5 m / 3 m pitch that continues across the seam.
  * gate.py (the timber gate, a 12 m two-cell module) reuses this earthwork and timber kit.
"""
import sys, os, math, random
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("HG_STATE", "complete")      # _milkit asserts a building state
import bpy, bmesh
from mathutils import Vector, Matrix
import _lib as L
import _milkit as K
import wall_stone as W                              # port-safe noise builder, MB, heightfield

L.ground_origin = lambda objs: None                 # kit pieces are authored on their snap pivot

TEX = int(os.environ.get("PAL_TEX", "2048"))
PORTS6 = [((-3.0, 0.0), (-1, 0), (0, -1)), ((3.0, 0.0), (1, 0), (0, -1))]

# ------------------------------------------------------------------ dimensions (m)
PITCH = 0.3            # stake pitch
CREST = 0.80           # bank crest height at the stake line
TIP_LO, TIP_HI = 4.45, 5.0     # stake shaft top (the sharpened point adds 0.4-0.65)
RAIL_Y = 0.105
RAILS = (1.75, 3.42)   # rail centre heights
RAIL_R = 0.1
POST_Y = 1.5
DECK = 3.72            # deck top
JOIST_XS = (-2.25, -0.75, 0.75, 2.25)
POST_XS = (-1.5, 1.5)


# ------------------------------------------------------------------ earthwork profile
PROFILE = [(-5.4, 0.0), (-4.9, 0.02), (-4.4, 0.2), (-3.9, 0.4), (-3.45, 0.3), (-3.0, 0.1), (-2.65, 0.05),
           (-2.25, 0.12), (-1.7, 0.36), (-1.0, 0.62), (-0.45, 0.78), (0.0, CREST), (0.35, 0.74),
           (0.8, 0.42), (1.3, 0.16), (1.9, 0.05), (2.5, 0.01), (3.0, 0.0)]
Y0, Y1 = PROFILE[0][0], PROFILE[-1][0]


def prof(y):
    """Catmull-Rom through PROFILE (earth height as a function of y only)."""
    P = PROFILE
    if y <= P[0][0]:
        return P[0][1]
    if y >= P[-1][0]:
        return P[-1][1]
    for i in range(len(P) - 1):
        if P[i][0] <= y <= P[i + 1][0]:
            break
    p0 = P[max(0, i - 1)][1]; p1 = P[i][1]; p2 = P[i + 1][1]; p3 = P[min(len(P) - 1, i + 2)][1]
    t = (y - P[i][0]) / (P[i + 1][0] - P[i][0])
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
                  (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)


def wobble(x, y, seed):
    """Low-amplitude lumpy noise (sum of sines, seeded)."""
    r = random.Random(seed)
    s = 0.0
    for k in range(5):
        fx, fy, ph, a = r.uniform(0.6, 2.6), r.uniform(0.6, 2.6), r.uniform(0, 6.28), r.uniform(0.015, 0.035)
        s += a * math.sin(fx * x + fy * y * r.choice((-1, 1)) + ph)
    return s


def earth_h(x, y, seed, half=3.0, extra=None):
    """Profile + lumps; lumps fade to zero at the ports (x=+-half) and at the outer edges."""
    edge = W.smooth(0.0, 0.9, half - abs(x)) * W.smooth(0.0, 0.5, y - Y0) * W.smooth(0.0, 0.5, Y1 - y)
    h = prof(y) + wobble(x, y, seed) * edge
    if extra:
        h += extra(x, y) * edge
    return max(0.0, h)


# ------------------------------------------------------------------ materials
def m_bark(name, charred=0.0):
    g = K.G(name)
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    off = g.mul(rnd, 23.0)
    # oak bark: blocky plates split by deep vertical furrows
    wv = g.mul(g.sub(g.noise(g.comb(g.mul(lx, 3.0), g.mul(ly, 3.0), g.mul(lz, 0.8)), 1.0, 3), 0.5), 0.35)
    pl = g.vor(g.comb(g.add(g.mul(lx, 26.0), off), g.mul(ly, 26.0), g.add(g.mul(lz, 3.2), wv)), 1.0, "DISTANCE_TO_EDGE")
    furrow = g.inv(g.mr(pl, 0.0, 0.14))
    col = g.ramp(g.add(g.mul(g.noise(g.P, 1.3, 3), 0.7), g.mul(rnd, 0.35)),
                 [(0.25, "#4f473d"), (0.5, "#5f574b"), (0.75, "#6e665a"), (0.95, "#7d756a")])
    fine = g.noise(g.comb(g.mul(lx, 40), g.mul(ly, 40), g.mul(lz, 9)), 1.0, 6, 0.65)
    col = g.mix(0.45, col, fine, "OVERLAY")
    col = g.mix(g.mul(furrow, 0.7), col, "#342c24")
    # grey-green lichen crust on the plates
    li = g.mul(g.inv(g.mr(g.vor(g.P, 7.0), 0.04, 0.2)), g.mr(g.noise(g.P, 0.9, 3), 0.5, 0.64))
    col = g.mix(g.mul(g.mul(li, g.inv(furrow)), 0.7), col, "#8d9275")
    x, y, z = g.sep(g.P)
    col, md, mb = g.ground_grime(col, g.sub(z, CREST - 0.1), 1.0, 1.0, 0.35)
    if charred > 0:
        ch = g.clamp(g.mul(g.add(g.mr(z, 0.3, 1.6), g.mul(g.sub(g.noise(g.P, 1.2, 3), 0.5), 0.9)), charred))
        col = g.mix(ch, col, g.mix(g.mul(furrow, 0.8), "#2d2925", "#1f1c19"))
    height = g.sub(g.mul(fine, 0.4), g.mul(furrow, 1.3))
    return g.out(col, g.add(0.86, g.mul(furrow, 0.08)), height, 1.0, 0.03)


def m_char(name):
    """charcoal-skinned timber: alligator-cracked char, grey ash bloom, unburnt wood lower down."""
    g = K.G(name)
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    x, y, z = g.sep(g.P)
    off = g.mul(rnd, 31.0)
    gat = g.vor(g.comb(g.add(g.mul(lx, 13.0), off), g.mul(ly, 13.0), g.mul(lz, 5.0)), 1.0, "DISTANCE_TO_EDGE")
    crack = g.inv(g.mr(gat, 0.0, 0.07))
    grain = g.noise(g.comb(g.add(g.mul(lx, 16), off), g.mul(ly, 16), g.mul(lz, 0.7)), 1.0, 8, 0.62, 0.35)
    wood = g.ramp(g.add(g.mul(rnd, 0.8), g.mul(g.noise(g.P, 0.7), 0.3)),
                  [(0.0, "#5a4a3a"), (0.5, "#6a5c4c"), (1.0, "#7a6e60")])
    wood = g.mix(0.7, wood, grain, "OVERLAY")
    charc = g.mix(g.mul(crack, 0.9), g.ramp(g.noise(g.P, 3.0, 4), [(0.3, "#2c2825"), (0.7, "#3a3530")]), "#1d1a18")
    ash = g.mr(g.noise(g.comb(g.mul(lx, 4), g.mul(ly, 4), g.mul(lz, 1.5)), 1.0, 4), 0.58, 0.7)
    charc = g.mix(g.mul(g.mul(ash, g.inv(crack)), 0.8), charc, "#7a766f")
    amt = g.clamp(g.add(g.mr(z, 0.35, 1.5), g.mul(g.sub(g.noise(g.P, 0.9, 3), 0.45), 1.3)))
    amt = g.mx(amt, g.mul(g.mr(g.noise(g.P, 2.0, 3), 0.4, 0.5), 0.9))
    col = g.mix(amt, wood, charc)
    col, md, mb = g.ground_grime(col, z, 1.0, 0.25, 0.3)
    height = g.sub(g.mul(grain, 0.3), g.mul(g.mul(crack, amt), 1.5))
    return g.out(col, g.add(0.8, g.mul(amt, 0.12)), height, 1.0, 0.012)


def earth_material(seed, state, road=None):
    """Port-safe earthwork: grassed bank, bare trodden crest and walk line, wet ditch bottom."""
    m, n, l, bsdf = L.mat("pal_earth")
    B = W.NB(m, seed)
    pos = B.geo.outputs["Position"]
    kind = B.attr("skind").outputs["Fac"]
    sep = n.new("ShaderNodeSeparateXYZ"); l.new(pos, sep.inputs[0]); y = sep.outputs["Y"]
    fresh = 1.0 if state == "build1" else 0.0
    ruin = 1.0 if state == "ruin" else 0.0
    # soil (3 layers: blotch / clods / grit)
    soil = B.ramp(B.snoise(0.55, 4.0), [(0.3, "#4c3b2a"), (0.55, "#5a4632"), (0.8, "#6a5640")])
    clod = B.voronoi(pos, 9.0)
    soil = B.scalec(soil, B.math("ADD", 0.82, B.math("MULTIPLY", B.sm(0.0, 0.6, clod.outputs["Distance"]), 0.3)))
    soil = B.scalec(soil, B.math("ADD", 0.86, B.math("MULTIPLY", B.noise(pos, 28.0, 3.0), 0.28)))
    grit = B.sm(0.72, 0.76, B.noise(B.voronoi(pos, 22.0).outputs["Color"], 1.0, 0.0))
    soil = B.mixc(B.math("MULTIPLY", grit, 0.5), soil, hexlin("#8f8570"))
    if fresh:
        # fresh spoil: lighter, clayey subsoil turned up in streaks
        sub = B.sm(0.45, 0.7, B.snoise(0.9, 4.0, 0.6, aniso=(1.0, 2.2, 1.0)))
        soil = B.mixc(B.math("MULTIPLY", sub, 0.7), soil, B.ramp(B.noise(pos, 4.0), [(0.3, "#7a6446"), (0.7, "#8e7652")]))
    # grass: blotchy coverage, thin on steep faces, gone on the trodden crest / walk line / ditch floor
    gcol = B.ramp(B.snoise(1.4, 4.0), [(0.25, "#4a5528"), (0.5, "#5d6b35"), (0.75, "#6c743d"), (0.95, "#7d7a45")])
    blades = B.noise(B.vm("MULTIPLY", pos, (60.0, 60.0, 14.0)), 1.0, 3.0)
    gcol = B.scalec(gcol, B.math("ADD", 0.72, B.math("MULTIPLY", blades, 0.5)))
    dry = B.sm(0.55, 0.75, B.snoise(0.35, 3.0))
    gcol = B.mixc(B.math("MULTIPLY", dry, 0.45), gcol, hexlin("#8a8150"))
    cover = B.sm(0.32, 0.55, B.math("ADD", B.snoise(0.9, 5.0, 0.6), B.math("MULTIPLY", B.nz, 0.12)))
    cover = B.math("MULTIPLY", cover, B.sm(0.62, 0.9, B.nz))
    crest = B.math("MULTIPLY", B.sm(-0.9, -0.35, y), B.sm(0.55, 0.3, y))           # stake line: packed bare
    walk = B.math("MULTIPLY", B.sm(0.7, 1.1, y), B.sm(2.6, 2.0, y))                 # foot of the walk
    ditch = B.math("MULTIPLY", B.sm(-3.6, -3.05, y), B.sm(-2.1, -2.55, y))
    bare = B.math("MAXIMUM", B.math("MAXIMUM", crest, B.math("MULTIPLY", walk, 0.85)), B.math("MULTIPLY", ditch, 0.9))
    bare = B.math("MULTIPLY", bare, B.sm(0.3, 0.6, B.math("ADD", B.snoise(2.2, 4.0), 0.25)))
    if fresh:
        undisturbed = B.math("MAXIMUM", B.sm(-4.6, -5.1, y), B.sm(2.1, 2.6, y))
        cover = B.math("MULTIPLY", cover, undisturbed)
    xs = sep.outputs["X"]
    if road:
        # the road through the gate: a trodden, rutted track (ruts = two worn lines)
        ax = B.math("ABSOLUTE", xs)
        rmask = B.math("MULTIPLY", B.sm(road + 0.7, road - 0.2, B.math("ADD", ax, B.math("MULTIPLY", B.snoise(1.5, 3.0), 0.8))), 1.0)
        bare = B.math("MAXIMUM", bare, rmask)
        rut = B.math("MULTIPLY", B.sm(0.28, 0.08, B.math("ABSOLUTE", B.math("SUBTRACT", ax, 0.8))), rmask)
        rut = B.math("MAXIMUM", rut, B.math("MULTIPLY", B.sm(0.35, 0.1, ax), B.math("MULTIPLY", rmask, 0.5)))
    cover = B.math("MULTIPLY", cover, B.math("SUBTRACT", 1.0, bare))
    col = B.mixc(cover, soil, gcol)
    if road:
        col = B.mixc(B.math("MULTIPLY", rmask, 0.6), col, B.ramp(B.noise(pos, 3.0), [(0.3, "#6e5e48"), (0.7, "#7f6d52")]))
        col = B.mixc(B.math("MULTIPLY", rut, 0.75), col, hexlin("#3e3125"))
    # wet ditch floor: dark mud, standing water in the lowest patches
    wet = B.math("MULTIPLY", B.sm(0.2, 0.08, B.z), ditch)
    wet = B.math("MULTIPLY", wet, B.sm(0.3, 0.55, B.snoise(1.1, 3.0)))
    col = B.mixc(B.math("MULTIPLY", wet, 0.9), col, B.mixc(B.noise(pos, 5.0), hexlin("#3a2d21"), hexlin("#46382a")))
    if road:
        wet = B.math("MAXIMUM", wet, B.math("MULTIPLY", rut, B.sm(0.5, 0.62, B.snoise(0.7, 3.0))))
    pud = B.math("MULTIPLY", B.sm(0.62, 0.7, B.snoise(0.8, 2.0)), wet)
    col = B.mixc(B.math("MULTIPLY", pud, 0.7), col, hexlin("#4a4538"))
    # boot-scuffed mud along the walk and at the stake foot
    scuff = B.math("MULTIPLY", B.math("MAXIMUM", walk, crest), B.sm(0.5, 0.7, B.noise(B.vm("MULTIPLY", pos, (4.0, 1.0, 1.0)), 1.0, 3.0)))
    col = B.mixc(B.math("MULTIPLY", scuff, 0.4), col, hexlin("#3f3226"))
    if ruin:
        ash = B.math("MULTIPLY", B.math("MULTIPLY", B.sm(-2.4, -0.8, y), B.sm(2.8, 1.6, y)),
                     B.sm(0.35, 0.6, B.snoise(0.9, 4.0)))
        ashc = B.mixc(B.sm(0.4, 0.7, B.noise(pos, 7.0, 3.0)), hexlin("#2e2a26"), hexlin("#77716a"))
        col = B.mixc(B.math("MULTIPLY", ash, 0.9), col, ashc)
        col = B.mixc(0.35, col, B.mixc(1.0, col, hexlin("#8a7a62"), "MULTIPLY"))     # scorched, browned
    l.new(col, bsdf.inputs["Base Color"])
    rough = B.math("SUBTRACT", 0.95, B.math("MULTIPLY", wet, 0.25))
    rough = B.math("SUBTRACT", rough, B.math("MULTIPLY", pud, 0.15))
    l.new(rough, bsdf.inputs["Roughness"])
    hgt = B.math("ADD", B.math("MULTIPLY", B.noise(pos, 16.0, 6.0), 0.5), B.math("MULTIPLY", B.sm(0.0, 0.5, clod.outputs["Distance"]), 0.5))
    hgt = B.math("ADD", hgt, B.math("MULTIPLY", B.math("MULTIPLY", blades, cover), 0.6))
    hgt = B.math("SUBTRACT", hgt, B.math("MULTIPLY", pud, 0.6))
    bump = n.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.6; bump.inputs["Distance"].default_value = 0.03
    l.new(hgt, bump.inputs["Height"]); l.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


hexlin = W.hexlin


def build_materials(state):
    ch = state == "ruin"
    K.MAT["oak"] = K.m_wood("pal_oak", [(0.0, "#4e3e2d"), (0.3, "#5e4d3a"), (0.55, "#6b5e4c"), (0.8, "#7a6f60"),
                                         (1.0, "#857b6c")],
                            weather_hex="#7e7466", weathered=0.42, fresh=0.03)
    K.MAT["hewn"] = K.m_wood("pal_hewn", [(0.0, "#66573f"), (0.5, "#76684f"), (1.0, "#857760")],
                             weather_hex="#958c7d", weathered=0.5, fresh=0.25 if state == "build1" else 0.08)
    K.MAT["fresh"] = K.m_wood("pal_fresh", [(0.0, "#a88a62"), (0.5, "#bb9b6f"), (1.0, "#c9a877")],
                              weather_hex="#b39a74", weathered=0.15, fresh=0.0)
    K.MAT["plank"] = K.m_wood("pal_plank", [(0.0, "#675b4a"), (0.5, "#7a6f60"), (1.0, "#8a8072")],
                              weather_hex="#878073", weathered=0.45, fresh=0.02, grain_k=1.2)
    K.MAT["bark"] = m_bark("pal_bark")
    K.MAT["iron"] = K.m_simple("pal_iron", "#35332f", "#45403a", 0.72, rust=True)
    if ch:
        K.MAT["char"] = m_char("pal_char")
        K.MAT["cbark"] = m_bark("pal_cbark", charred=1.0)


# ------------------------------------------------------------------ timber pieces
class SBatch(K.Batch):
    """Batch for open, hand-wound pieces (stake strips, caps): no recalc_face_normals, which
    flips isolated open strips at random."""

    def build(s):
        if not s.V:
            return None
        me = bpy.data.meshes.new(s.name)
        me.from_pydata(s.V, [], s.F)
        a = me.attributes.new("hg_loc", "FLOAT_VECTOR", "POINT")
        a.data.foreach_set("vector", [c for p in s.LOC for c in p])
        b = me.attributes.new("hg_rnd", "FLOAT", "POINT")
        b.data.foreach_set("value", s.RND)
        me.validate()
        ob = bpy.data.objects.new(s.name, me)
        bpy.context.scene.collection.objects.link(ob)
        L.assign(ob, K.MAT[s.mat])
        return ob


def SB(mat):
    key = "stk_" + mat
    if key not in K.BATCHES:
        K.BATCHES[key] = SBatch(key, mat)
    return K.BATCHES[key]


def section(kind, w, rng):
    """Closed CCW outline (seen from +z) of a stake, flat split face toward +y (inside); tags per edge."""
    pts, tags = [], []
    if kind == "round":
        r = w / 2
        n = 8
        ph = rng.uniform(0, 1)
        for i in range(n):
            a = 2 * math.pi * (i + ph) / n
            rr = r * rng.uniform(0.93, 1.05)
            pts.append((math.cos(a) * rr, math.sin(a) * rr)); tags.append("round")
        return pts, tags
    d = w * (rng.uniform(0.48, 0.58) if kind == "half" else rng.uniform(0.3, 0.38))
    n = 6
    for i in range(n + 1):
        a = math.pi + math.pi * i / n
        rr = rng.uniform(0.95, 1.04) if 0 < i < n else 1.0
        pts.append((math.cos(a) * w / 2 * rr, math.sin(a) * d * rr))
        tags.append("round")
    tags[-1] = "flat"            # the closing edge (right -> left along y=0)
    # offset so the flat face sits at y = 0 and the round side bulges to -y
    return pts, tags


def stake(x, y, top, w, kind, rng, bark=False, tip=True, lean=(0.0, 0.0), broken=None, mats=None,
          z0=0.0, lying=None, flip=False, rot=0.0):
    """One stake. top = shaft top z (tip adds its point).  broken = (zbreak) jagged charred snap.
    lying = (Matrix) places the stake in world after building it upright at the origin.
    mats = dict(wood=, bark=, tipm=) batch keys."""
    mats = mats or dict(wood="oak", bark="bark", tipm="hewn")
    bw, bb, bt = SB(mats["wood"]), SB(mats["bark"]), SB(mats["tipm"])
    pts, tags = section(kind, w, rng)
    if flip:
        pts = [(-px, -py) for px, py in pts]
    if kind == "round" and lying is None:
        pts = [(px, py - w / 2) for px, py in pts]      # whole poles stand in front of the rail line
    if rot:
        cr, sr_ = math.cos(rot), math.sin(rot)
        pts = [(px * cr - py * sr_, px * sr_ + py * cr) for px, py in pts]
    n = len(pts)
    ztop = broken if broken is not None else top
    levels = [z0, z0 + (ztop - z0) * 0.3, z0 + (ztop - z0) * 0.68, ztop]
    bend = (rng.uniform(-0.035, 0.035), rng.uniform(-0.03, 0.03))
    wob = [(0.0, 0.0)] + [(rng.uniform(-0.012, 0.012) + bend[0] * math.sin(math.pi * t),
                           rng.uniform(-0.01, 0.01) + bend[1] * math.sin(math.pi * t)) for t in (0.3, 0.68, 1.0)]
    sc = [1.0, rng.uniform(0.98, 1.01), rng.uniform(0.95, 0.99), rng.uniform(0.93, 0.97)]
    rnd = rng.random()

    def P(i, j, zz=None):
        z = levels[j] if zz is None else zz
        px, py = pts[i]
        return Vector((x + px * sc[j] + wob[j][0] + lean[0] * (z - z0), y + py * sc[j] + wob[j][1] + lean[1] * (z - z0), z))

    rings = [[P(i, j) for i in range(n)] for j in range(len(levels))]
    # the top ring: axe-chopped point (3-4 planes through the tip) or a jagged charred snap
    topz = [ztop] * n
    if broken is None and tip:
        tl = rng.uniform(0.42, 0.65)
        cx = sum(p.x for p in rings[-1]) / n + rng.uniform(-0.03, 0.03)
        cy = sum(p.y for p in rings[-1]) / n + rng.uniform(-0.02, 0.02)
        T = Vector((cx, cy, ztop + tl * 0.62))
        k = rng.choice((3, 4, 4))
        a0 = rng.uniform(0, 6.28)
        planes = []
        for c in range(k):
            a = a0 + 2 * math.pi * c / k + rng.uniform(-0.25, 0.25)
            planes.append((math.cos(a), math.sin(a), (w / 2) / tl * rng.uniform(0.85, 1.15)))
        for i in range(n):
            p = rings[-1][i]
            zc = min(T.z - (nx * (p.x - T.x) + ny * (p.y - T.y)) / nz for nx, ny, nz in planes)
            topz[i] = min(zc, T.z)
        # the chop starts below the shaft top: lower the last ring where planes cut deeper
        levels_top = [min(ztop, z) for z in topz]
        rings[-1] = [Vector((rings[-1][i].x, rings[-1][i].y, levels_top[i])) for i in range(n)]
        cap = ("tip", T)
    else:
        cz = ztop - rng.uniform(0.02, 0.08)
        if broken is not None:
            rings[-1] = [Vector((p.x, p.y, ztop + rng.uniform(-0.22, 0.2))) for p in rings[-1]]
            cz = ztop - rng.uniform(0.05, 0.25)
        cap = ("flat", Vector((sum(p.x for p in rings[-1]) / n, sum(p.y for p in rings[-1]) / n, cz)))

    def add(bt_, quad_pts, faces):
        loc = [(p.x - x, p.y - y, p.z) for p in quad_pts]
        if lying is not None:
            quad_pts = [lying @ p for p in quad_pts]
        bt_.add([tuple(p) for p in quad_pts], faces, None, rnd, loc)

    for i in range(n):
        i2 = (i + 1) % n
        is_bark = bark and tags[i] == "round"
        target = bb if is_bark else bw
        strip = []
        for j in range(len(levels)):
            strip += [rings[j][i], rings[j][i2]]
        faces = [(2 * j, 2 * j + 1, 2 * j + 3, 2 * j + 2) for j in range(len(levels) - 1)]
        add(target, strip, faces)
    kind_c, C = cap
    capb = bt if broken is None else SB(mats.get("snap", mats["tipm"]))
    ring = rings[-1]
    add(capb, ring + [C], [(i, (i + 1) % n, n) for i in range(n)])
    if z0 > 0.01 or lying is not None:
        add(bw, rings[0], [tuple(range(n - 1, -1, -1))])


def rail(x0, x1, z, rng, y=RAIL_Y, r=RAIL_R, mat="oak", joint=None):
    """split-log rail on the inner face, optionally in two lengths with a joint at `joint`."""
    xs = [x0, joint, x1] if joint else [x0, x1]
    for a, b in zip(xs, xs[1:]):
        dz = rng.uniform(-0.02, 0.02)
        K.cyl(K.B(mat), (a + 0.004, y, z + dz), (b - 0.004, y, z + dz + rng.uniform(-0.015, 0.015)), r * rng.uniform(0.95, 1.05),
              n=7)


def peg(x, y, z, rng, mat="hewn"):
    K.cyl(K.B(mat), (x, y - 0.02, z), (x + rng.uniform(-0.01, 0.01), y + 0.05, z + rng.uniform(-0.01, 0.01)),
          0.022 * rng.uniform(0.9, 1.15), n=5)


def plank(p0, p1, w, t, rng, mat="plank", side=(0, 0, 1)):
    K.beam(K.B(mat), p0, p1, w, t, 0.006, side=side)


# ------------------------------------------------------------------ earth
def earth(seed, state, half=3.0, extra=None, cull=None, step=0.22, kind=0, hf=None):
    mb = W.MB()
    flat = lambda q: max(p[2] for p in q) < 0.015 and not (-4.0 < q[0][1] < 1.8)   # outer flat skirt only (z-fights)
    W.heightfield(mb, -half, half, Y0, Y1, step, hf or (lambda x, y: earth_h(x, y, seed, half, extra)), kind,
                  sr_fn=lambda x, y, z: 0.5, cull=(lambda q: flat(q) or cull(q)) if cull else flat)
    return mb


def finish_earth(mb, ports, seed, state, road=None):
    o = mb.obj("pal_earth", earth_material(seed, state, road))
    qp, qw = W.port_coords(mb, ports)
    W.attach_qp(o, qp, qw)
    return o


# ------------------------------------------------------------------ the palisade run
def stake_row(rng, x0, x1, state, gaps=(), lows=None):
    """stakes centred on the fixed pitch between x0 and x1 (x0/x1 on the pitch grid edges)."""
    n = int(round((x1 - x0) / PITCH))
    out = []
    for i in range(n):
        x = x0 + (i + 0.5) * PITCH
        out.append(x)
    return out


def stake_kind(rng):
    r = rng.random()
    return "round" if r < 0.18 else ("slab" if r < 0.3 else "half")


def build_run(rng, x0, x1, state, seed, walk=True, ladder_x=None):
    """The complete palisade over [x0, x1] (used by the 6 m modules and the gate's wing stubs)."""
    xs = stake_row(rng, x0, x1, state)
    ruin = state == "ruin"
    for x in xs:
        w = PITCH * rng.uniform(1.04, 1.14)
        kind = stake_kind(rng)
        if kind == "round":
            w = PITCH * rng.uniform(0.98, 1.06)
        bark = kind != "slab" and rng.random() < 0.45
        top = rng.uniform(TIP_LO, TIP_HI)
        if rng.random() < 0.08:
            top -= rng.uniform(0.2, 0.35)          # an older, rotted-back stake
        lean = (rng.uniform(-0.02, 0.02), rng.uniform(-0.012, 0.02))
        yoff = rng.uniform(-0.015, 0.02)
        if not ruin:
            stake(x + rng.uniform(-0.01, 0.01), yoff, top, w, kind, rng, bark=bark, lean=lean)
    if not walk:
        return
    # rails, pegged to every other stake
    for z in RAILS:
        rail(x0, x1, z, rng, joint=round(rng.uniform(x0 + 1.5, x1 - 1.5) / PITCH) * PITCH)
        for x in xs[rng.randint(0, 1)::2]:
            peg(x + rng.uniform(-0.03, 0.03), RAIL_Y + RAIL_R - 0.03, z + rng.uniform(-0.03, 0.03), rng)
    walkway(rng, x0, x1, ladder_x)


def walkway(rng, x0, x1, ladder_x=None, posts=POST_XS, joists=JOIST_XS):
    oak, hewn = K.B("oak"), K.B("hewn")
    ledger_z = DECK - 0.045 - 0.16 - 0.09
    for px in posts:
        if not (x0 < px < x1):
            continue
        px += rng.uniform(-0.03, 0.03)
        top = ledger_z - 0.09
        K.beam(oak, (px, POST_Y + rng.uniform(-0.02, 0.02), 0.0), (px + rng.uniform(-0.02, 0.02), POST_Y, top), 0.2, 0.2, 0.02)
        # knee braces post -> ledger along x, and post -> joist toward the wall
        for s in (-1, 1):
            K.beam(oak, (px, POST_Y, top - 0.75), (px + s * 0.62, POST_Y, top - 0.02), 0.11, 0.11, 0.012)
    # ledger (runner) along the posts
    K.beam(oak, (x0 + 0.003, POST_Y, ledger_z), (x1 - 0.003, POST_Y, ledger_z + rng.uniform(-0.015, 0.015)), 0.18, 0.18, 0.015)
    jz = DECK - 0.045 - 0.08
    for jx in joists:
        if not (x0 < jx < x1):
            continue
        jx += rng.uniform(-0.04, 0.04)
        K.beam(hewn, (jx, RAIL_Y - 0.06, jz), (jx + rng.uniform(-0.03, 0.03), POST_Y + 0.2, jz + rng.uniform(-0.01, 0.01)),
               0.13, 0.16, 0.012, side=(0, 0, 1))
    # deck: 5 planks along x, each in two lengths meeting on a joist
    ys = [RAIL_Y + 0.08]
    for k in range(5):
        ys.append(ys[-1] + rng.uniform(0.26, 0.3))
    for a, b in zip(ys, ys[1:]):
        yc = (a + b) / 2
        jx = rng.choice([j for j in JOIST_XS if x0 < j < x1] or [0.5 * (x0 + x1)])
        for u0, u1 in ((x0, jx), (jx, x1)):
            if u1 - u0 < 0.3:
                continue
            dz = rng.uniform(-0.008, 0.012)
            plank((u0 + 0.006, yc, DECK - 0.022 + dz), (u1 - 0.006, yc + rng.uniform(-0.01, 0.01), DECK - 0.022 + dz),
                  (b - a) - 0.012, 0.045, rng)
    if ladder_x is not None:
        K.ladder((ladder_x, POST_Y + 1.55, 0.0), (ladder_x + 0.05, POST_Y + 0.12, DECK), mat="oak")


# ------------------------------------------------------------------ states
def mod_palisade(seed, ladder=True):
    rng = random.Random(seed); K.R.seed(seed)
    build_run(rng, -3.0, 3.0, "complete", seed, ladder_x=rng.uniform(-0.6, 0.6) if ladder else None)
    return earth(seed, "complete")


def mod_build1(seed):
    rng = random.Random(seed); K.R.seed(seed)
    xs = stake_row(rng, -3.0, 3.0, "build1")
    mats = dict(wood="fresh", bark="bark", tipm="fresh")
    # a few stakes already rammed in at the east end, the trench open along the rest of the crest
    for x in xs[-5:]:
        kind = stake_kind(rng)
        stake(x + rng.uniform(-0.01, 0.01), 0.0, rng.uniform(TIP_LO, TIP_HI), PITCH * rng.uniform(1.0, 1.08), kind, rng,
              bark=kind != "slab" and rng.random() < 0.5, lean=(rng.uniform(-0.02, 0.02), rng.uniform(-0.01, 0.02)), mats=mats)
    # one propped at an angle, waiting to be rammed
    stake(0, 0, 4.6, 0.3, "half", rng, bark=True, mats=mats,
          lying=Matrix.Translation((1.0, -0.05, 0.25)) @ Matrix.Rotation(math.radians(-24), 4, "Y"))
    # the stake pile inside: sharpened, stacked, in bark
    for row in range(3):
        for i in range(5 - row):
            L_ = rng.uniform(4.9, 5.4)
            y = 1.55 + i * 0.3 + row * 0.15 + rng.uniform(-0.02, 0.02)
            z = 0.14 + row * 0.25
            kind = rng.choice(("half", "round", "half"))
            M = (Matrix.Translation((-2.75 + rng.uniform(-0.15, 0.15), y, z)) @
                 Matrix.Rotation(math.radians(90), 4, "Y") @ Matrix.Rotation(rng.uniform(-0.4, 0.4), 4, "Z"))
            stake(0, 0, L_, 0.29, kind, rng, bark=rng.random() < 0.6, mats=mats, lying=M)
    for s in (-1.9, 1.0):          # bearers under the pile
        K.beam(K.B("hewn"), (s - 1.7, 1.35, 0.05), (s - 1.7 + rng.uniform(-0.1, 0.1), 3.0, 0.07), 0.12, 0.12, 0.01)
    # rails waiting on the ground
    for k in range(2):
        K.cyl(K.B("fresh"), (-2.6 + k * 0.2, 2.85 + k * 0.18, 0.1), (2.5, 2.8 + k * 0.22, 0.1), 0.09, n=7)
    # spade stuck in the spoil + a rammer (a weighted beetle with two handles)
    K.beam(K.B("hewn"), (-0.9, -1.2, 0.25), (-0.95, -1.35, 1.35), 0.04, 0.04, 0.008)
    K.beam(K.B("plank"), (-0.9, -1.18, 0.05), (-0.9, -1.2, 0.36), 0.2, 0.03, 0.005, side=(0, 1, 0))
    K.cyl(K.B("oak"), (0.6, 0.55, 0.0), (0.6, 0.55, 0.6), 0.14, n=8)
    for s in (-1, 1):
        K.cyl(K.B("hewn"), (0.6 + s * 0.12, 0.55, 0.4), (0.6 + s * 0.42, 0.55, 0.42), 0.025, n=5)

    def extra(x, y):
        # the stake trench: an open slot along the crest where no stakes stand yet, spoil either side
        slot = -0.32 * math.exp(-(y / 0.22) ** 2) * W.smooth(1.7, 1.4, x)
        spoil = 0.12 * math.exp(-((y - 0.45) / 0.2) ** 2) + 0.1 * math.exp(-((y + 0.5) / 0.22) ** 2)
        return slot + spoil * W.smooth(1.8, 1.3, x)
    return earth(seed, "build1", extra=extra)


def mod_ruin(seed):
    rng = random.Random(seed); K.R.seed(seed)
    xs = stake_row(rng, -3.0, 3.0, "ruin")
    mats = dict(wood="char", bark="cbark", tipm="char", snap="char")
    # a burnt-out stretch: most stakes snapped off low, a few gaps, a couple standing blackened
    gap_c = rng.uniform(-1.2, 1.0)
    for x in xs:
        if abs(x - gap_c) < 0.75 and rng.random() < 0.85:
            continue                                   # burnt right through: gap
        r = rng.random()
        kind = stake_kind(rng)
        w = PITCH * rng.uniform(0.9, 1.05)
        if r < 0.14:
            stake(x, 0, rng.uniform(TIP_LO - 0.3, TIP_HI), w, kind, rng, bark=rng.random() < 0.3, mats=mats,
                  lean=(rng.uniform(-0.03, 0.03), rng.uniform(-0.05, 0.02)))
        else:
            zb = CREST + rng.uniform(0.2, 2.6) * (0.45 if abs(x - gap_c) < 1.4 else 1.0)
            stake(x, 0, zb, w * rng.uniform(0.85, 1.0), kind, rng, bark=rng.random() < 0.3, mats=mats,
                  broken=zb, lean=(rng.uniform(-0.02, 0.02), rng.uniform(-0.03, 0.03)))
    # fallen stakes: outward down the bank and across the ditch, a couple inside
    for k in range(5):
        L_ = rng.uniform(2.2, 4.6)
        out = k < 3
        yb = -0.4 if out else 0.6
        ang = rng.uniform(-0.5, 0.5)
        x = gap_c + rng.uniform(-1.6, 1.6)
        pitch = math.radians(rng.uniform(93, 99) if out else rng.uniform(91, 95))
        yaw = (-math.pi / 2 if out else math.pi / 2) + ang
        M = (Matrix.Translation((x, yb, earth_h(x, yb, seed) + 0.05)) @ Matrix.Rotation(yaw, 4, "Z") @
             Matrix.Rotation(pitch, 4, "Y"))
        stake(0, 0, L_, 0.28, stake_kind(rng), rng, bark=rng.random() < 0.3, mats=mats, lying=M,
              broken=L_ if rng.random() < 0.6 else None)
    # lower rail survives in two charred pieces, upper rail fell
    K.cyl(K.B("char"), (-3.0, RAIL_Y, RAILS[0]), (gap_c - 0.9, RAIL_Y + 0.02, RAILS[0] - 0.05), RAIL_R, n=7)
    K.cyl(K.B("char"), (gap_c + 1.1, RAIL_Y, RAILS[0] - 0.02), (3.0, RAIL_Y, RAILS[0]), RAIL_R, n=7)
    K.cyl(K.B("char"), (gap_c - 0.9, RAIL_Y + 0.05, RAILS[0] - 0.08), (gap_c - 0.1, 0.9, 0.62), RAIL_R * 0.9, n=7)
    K.cyl(K.B("char"), (-2.8, 1.0, 0.45), (-0.4, 1.3, 0.2), RAIL_R, n=7)
    # walk: one post still standing (burnt to a stump top), the other a low stump; deck fallen
    K.beam(K.B("char"), (POST_XS[0], POST_Y, 0.0), (POST_XS[0] + 0.03, POST_Y, 2.4), 0.2, 0.2, 0.02)
    K.beam(K.B("char"), (POST_XS[0], POST_Y, 2.1), (POST_XS[0] + 0.55, POST_Y, 2.75), 0.1, 0.1, 0.01)
    K.beam(K.B("char"), (POST_XS[1], POST_Y, 0.0), (POST_XS[1], POST_Y, 0.55), 0.2, 0.2, 0.02)
    K.beam(K.B("char"), (-3.0, POST_Y + 0.35, 0.3), (-1.55, POST_Y + 0.05, 2.35), 0.16, 0.16, 0.015)   # ledger dropped on the stump
    for k in range(9):
        x = rng.uniform(-2.7, 2.7); y = rng.uniform(0.5, 2.8)
        a = rng.uniform(-0.6, 0.6)
        ln = rng.uniform(0.8, 2.2)
        d = Vector((math.cos(a), math.sin(a), 0)) * ln / 2
        z = earth_h(x, y, seed) + 0.03 + (k % 3) * 0.04
        plank((x - d.x, y - d.y, z + rng.uniform(0, 0.12)), (x + d.x, y + d.y, z + rng.uniform(0, 0.08)),
              rng.uniform(0.22, 0.3), 0.045, rng, mat="char")
    # charcoal / ember debris along the burnt line
    for k in range(40):
        x = rng.uniform(-2.8, 2.8); y = rng.uniform(-1.4, 1.8)
        s = rng.uniform(0.05, 0.16)
        z = earth_h(x, y, seed)
        K.box(K.B("char"), (x - s, y - s * 0.6, z - 0.02), (x + s, y + s * 0.6, z + s * 0.5), 0.01,
              rot=(rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(0, 3)))

    def extra(x, y):   # soft ash heaps along the line
        return 0.1 * math.exp(-((y - 0.4) / 0.6) ** 2) * (0.5 + 0.5 * math.sin(x * 2.3 + 1.0))
    return earth(seed, "ruin", extra=extra)


BUILDERS = {
    "palisade": (lambda: mod_palisade(11, ladder=True), "complete"),
    "palisade_b": (lambda: mod_palisade(29, ladder=False), "complete"),
    "palisade_build1": (lambda: mod_build1(47), "build1"),
    "palisade_ruin": (lambda: mod_ruin(61), "ruin"),
}


def update_kit(name, ports):
    import json
    kit_path = os.path.join(L.GLB_DIR, "palisade_kit.json")
    kit = {}
    if os.path.exists(kit_path):
        try:
            kit = json.load(open(kit_path))
        except Exception:
            kit = {}
    kit.setdefault("modules", {})
    kit["module_length"] = 6.0
    kit["note"] = ("Same conventions as wall_stone_kit.json: pivot = centre of the module's cell on the stake line "
                   "(wall centreline), z=0 ground, outer (ditch) side -Y. Straight modules are 6 m (ports +-3); "
                   "gate is a 12 m two-cell module (ports +-6). Snap port to port.")
    kit["modules"][name] = {"ports": [dict(pos=[p[0], p[1], 0.0], axis=[a[0], a[1], 0.0], outer=[o[0], o[1], 0.0])
                                      for p, a, o in ports]}
    json.dump(kit, open(kit_path, "w"), indent=1)


def run(name, builder, state, ports, seed):
    earth_mb = builder()
    build_materials(state)
    finish_earth(earth_mb, ports, seed, state)
    K.finalize(name, tex=TEX, lods=(1.0, 0.4, 0.12))
    update_kit(name, ports)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    name = argv[0] if argv else "palisade"
    fn, state = BUILDERS[name]
    run(name, fn, state, PORTS6, sum(map(ord, name)))
