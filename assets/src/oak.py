"""English oak (Quercus robur), mature field / forest-edge tree, 18-22 m.

  blender -b -P assets/src/oak.py -- a        -> assets/glb/oak_a.glb   (b, c likewise)
  blender -b -P assets/src/oak.py -- stump    -> assets/glb/oak_stump.glb (felled lumber state)
  blender -b -P assets/src/oak.py -- all      -> all four
  HG_SEED=77 blender -b -P assets/src/oak.py  -> assets/glb/oak_s77.glb
Leaf atlas: assets/tex/oak_leaves.png (regenerated if missing or with arg 'leaves').
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
import bpy, bmesh
from mathutils import Vector, Quaternion
import _lib as L
import _trees as T

VARIANTS = {"a": 64, "b": 90, "c": 37}
LEAF_PNG = os.path.join(L.TEX_DIR, "oak_leaves.png")


def leaves_image(force=False):
    os.makedirs(L.TEX_DIR, exist_ok=True)
    if force or not os.path.exists(LEAF_PNG):
        return T.leaf_atlas(LEAF_PNG, T.oak_leaf_outline, res=1024, grid=2, leaves=42, seed=5,
                            greens=("#6c7a2e", "#7a8a36", "#88963e", "#627030"),
                            cell_tints=[(1, 1, 1), (0.96, 1.0, 0.92), (1.2, 1.16, 0.85), (0.82, 0.88, 0.84)])
    img = bpy.data.images.load(LEAF_PNG, check_existing=True)
    return img


def trunk_flare(seed):
    """Smooth buttressed root flare: 4-6 irregular buttresses that swell into the ground."""
    rng = random.Random(seed * 7 + 1)
    butt = [(rng.uniform(0, 6.283), rng.uniform(0.35, 0.6), rng.uniform(0.45, 0.75)) for _ in range(rng.randint(4, 6))]
    def f(z, th):
        lob = 0.35
        for a, h, w in butt:
            d = math.atan2(math.sin(th - a), math.cos(th - a))
            lob += h * math.exp(-(d / w) ** 2)
        return 1.0 + 0.8 * math.exp(-z / 0.45) * lob + 0.15 * math.exp(-z / 1.4)
    return f


def build_roots(rng, trunk_r):
    sk = T.Skel(); r = []
    c = sk.add((0, 0, 0.7), -1); r.append(trunk_r)
    n = rng.randint(4, 6); a0 = rng.uniform(0, 6.28)
    for k in range(n):
        a = a0 + k * 2 * math.pi / n + rng.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0))
        L_ = rng.uniform(0.9, 1.7); prev = c; steps = 6
        for s in range(1, steps + 1):
            t = s / steps
            p = d * (trunk_r * 0.5 + L_ * t) + Vector((rng.gauss(0, 0.04), rng.gauss(0, 0.04), 0.62 * (1 - t) ** 1.6 - 0.05))
            prev = sk.add(p, prev); r.append(trunk_r * 0.5 * (1 - t) ** 0.8 + 0.07)
    return sk, r


def build_oak(seed):
    rng = random.Random(seed); random.seed(seed)
    H = rng.uniform(18.5, 21.5)
    hb = rng.uniform(3.2, 4.4)           # clear bole
    sk = T.Skel()
    lean = Vector((rng.gauss(0, 0.06), rng.gauss(0, 0.06), 1)).normalized()
    root = sk.add((0, 0, 0), -1, growable=False)
    trunk = T.polyline(sk, root, lean, hb, 0.35, rng, wander=0.2, kink_every=1.6, kink_deg=8, growable=False)
    top = trunk[-1]
    # leader carries on (crooked) into the crown
    leader = T.polyline(sk, top, Vector((rng.gauss(0, .2), rng.gauss(0, .2), 1)), H - hb - 3.0, 0.5, rng,
                        kink_every=2.0, kink_deg=15)
    lobes = []
    lobes.append((sk.pos[leader[-1]] + Vector((0, 0, 1.0)), (rng.uniform(3.0, 3.8),) * 2 + (2.6,)))
    # heavy, low, near-horizontal scaffold limbs from the bole top and lower leader
    n_limbs = 7; a0 = rng.uniform(0, 6.28)
    for k in range(n_limbs):
        a = a0 + k * 2 * math.pi / n_limbs + rng.uniform(-0.35, 0.35)
        src = top if k < 4 else leader[min(len(leader) - 1, rng.randint(1, max(1, len(leader) // 2)))]
        elev = math.radians(rng.uniform(4, 20) if k < 4 else rng.uniform(30, 50))
        d = Vector((math.cos(a) * math.cos(elev), math.sin(a) * math.cos(elev), math.sin(elev)))
        ln = rng.uniform(8.5, 11.0) if k < 4 else rng.uniform(5.5, 7.5)
        limb = T.polyline(sk, src, d, ln, 0.5, rng, kink_every=1.8, kink_deg=26, up_bias=0.2 if k < 4 else 0.35)
        end = sk.pos[limb[-1]]
        dh = Vector((end.x, end.y, 0)).normalized()
        lobes.append((end + dh * 1.0 + Vector((0, 0, 0.5)),
                      (rng.uniform(2.8, 3.8), rng.uniform(2.8, 3.8), rng.uniform(2.0, 2.7))))
        # extra clumps along/above the limb -> lumpy stacked silhouette with sky gaps
        for f in (0.45, 0.75):
            if rng.random() < 0.8:
                q = sk.pos[limb[int(len(limb) * f)]]
                side = Vector((-dh.y, dh.x, 0)) * rng.uniform(-1.5, 1.5)
                lobes.append((q + side + Vector((0, 0, rng.uniform(1.8, 3.2))),
                              (rng.uniform(2.2, 3.0), rng.uniform(2.2, 3.0), rng.uniform(1.7, 2.3))))
    ztop = max(c.z + r[2] for c, r in lobes)
    s = min(1.0, (H - 0.8 - hb) / (ztop - hb))  # only ever compress: never stretch into a tall broccoli
    lobes = [(Vector((c.x, c.y, hb + (c.z - hb) * s)), (r[0], r[1], r[2] * s)) for c, r in lobes]
    att = T.lobe_attractors(lobes, 9000, rng, shell=0.55, zmin=hb + 0.3)
    T.colonize(sk, att, infl=4.0, kill=0.85, step=0.42, iters=260, tropism=(0, 0, -0.08), jitter=0.18, rng=rng)
    rad = T.pipe_radii(sk, r_tip=0.011, exp=1.9, base_radius=rng.uniform(0.74, 0.86))
    print("OAK limb radii at bole top:", sorted([round(rad[c], 3) for c in sk.children()[top]], reverse=True))

    bark = T.bark_material("oak_bark", along=0.16, plate_scale=5.5, crack_width=0.3,
                           plate="#7d7466", plate2="#6a5d4d")
    # auto-tune min radius so bark mesh fits the 12k budget
    for min_r in (0.02, 0.024, 0.028, 0.03, 0.035, 0.042, 0.05, 0.06, 0.07, 0.085):
        ob = T.build_tubes(sk, rad, min_r=min_r, name="oak_wood", gnarl=0.13, flare=trunk_flare(seed), seed=seed)
        tris = T.tri_count(ob)
        if tris <= 11800: break
        bpy.data.objects.remove(ob, do_unlink=True)
    print(f"OAK seed={seed} nodes={len(sk.pos)} min_r={min_r} wood_tris={tris}")
    L.assign(ob, bark)

    centre = sum((c for c, _ in lobes), Vector()) / len(lobes)
    ext = [max(abs(c[i] - centre[i]) + r[i] for c, r in lobes) for i in range(3)]
    pts = T.tip_points(sk, rad, r_leaf=0.03, stride=1.0, rng=rng)
    pts += T.tip_points(sk, rad, r_leaf=0.05, stride=3.0, rng=rng)  # inner fill
    # atlas cells: 0,1 mid olive, 2 sunlit (yellower), 3 shade (deeper)
    def pick(out, rng):
        if out.z > 0.55 and rng.random() < 0.7: return 2
        if out.z < -0.1 and rng.random() < 0.6: return 3
        return rng.choice((0, 1, 2, 3))
    cards = T.scatter_cards(pts, leaves_image(), centre, ext, rng, size=(0.9, 1.45), name="oak_leaves",
                            per_point=1, jitter=0.45, cell_pick=pick, up_bias=0.35)
    print(f"OAK cards={len(cards.data.polygons)}")
    return ob


def build_stump(seed=11):
    rng = random.Random(seed)
    bark = T.bark_material("oak_bark", along=0.16, plate_scale=5.5, crack_width=0.3, moss_amount=0.7,
                           plate="#7d7466", plate2="#6a5d4d")
    logbark = T.bark_material("oak_logbark", along=0.16, plate_scale=5.5, crack_width=0.3, moss_amount=0.2,
                              plate="#7d7466", plate2="#6a5d4d")
    cut = T.cutwood_material("oak_cut")
    objs = []
    # stump: short flared trunk with an axe-notched top
    sk = T.Skel(); r0 = 0.6; prev = sk.add((0, 0, 0), -1)
    for z in (0.12, 0.25, 0.4, 0.55, 0.7, 0.8): prev = sk.add((rng.gauss(0, .01), rng.gauss(0, .01), z), prev)
    rad = [r0] * len(sk.pos)
    # axe-felled top: two facets meeting at a ragged hinge
    def cutz(x, y): return 0.84 + 0.16 * max(0, -y) / r0 + 0.05 * max(0, y) / r0 + 0.012 * math.sin(x * 23)
    st = T.build_tubes(sk, rad, min_r=0.01, name="stump", gnarl=0.12, flare=trunk_flare(seed), seed=seed,
                       spacing=lambda r: 0.1, sides=lambda r: 24, tip=False, caps=True, cap_z=cutz)
    st.data.materials.append(bark); st.data.materials.append(cut); objs.append(st)
    # logs: two on the ground, one resting on top
    specs = [((1.3, -1.6, 0.30), 0.30, 3.6, 0.35), ((1.55, -0.95, 0.27), 0.27, 3.2, 0.25),
             ((1.45, -1.28, 0.78), 0.24, 2.9, 0.4)]
    for i, (p, r, ln, yaw) in enumerate(specs):
        lo, _ = log(f"log{i}", Vector(p), r, ln, yaw + rng.uniform(-.08, .08), rng, seed + i)
        lo.data.materials.append(logbark); lo.data.materials.append(cut); objs.append(lo)
    # wood chips around the stump
    for k in range(26):
        a = rng.uniform(0, 6.28); d = rng.uniform(0.7, 1.9)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(a) * d, math.sin(a) * d - 0.3, 0.012))
        c = bpy.context.object; c.scale = (rng.uniform(.05, .12), rng.uniform(.03, .06), 0.012)
        c.rotation_euler = (rng.uniform(-.2, .2), rng.uniform(-.2, .2), rng.uniform(0, 6.28))
        L.assign(c, cut)
        c.data.uv_layers.new(name="bk_a"); c.data.uv_layers.new(name="bk_b")
        objs.append(c)
    return objs


def disk_cap(name, c, r, zf, rng, rings=5, seg=20):
    bm = bmesh.new(); uva = bm.loops.layers.uv.new("bk_a"); uvb = bm.loops.layers.uv.new("bk_b")
    centre = bm.verts.new((c.x, c.y, zf(c.x, c.y) + 0.005)); prev = None; ringsv = []
    for i in range(1, rings + 1):
        rr = r * i / rings; ring = []
        for j in range(seg):
            th = 2 * math.pi * j / seg; x = c.x + rr * math.cos(th); y = c.y + rr * math.sin(th)
            ring.append(bm.verts.new((x, y, zf(x, y) + 0.005)))
        ringsv.append(ring)
    for j in range(seg):
        bm.faces.new((centre, ringsv[0][j], ringsv[0][(j + 1) % seg]))
    for a, b in zip(ringsv, ringsv[1:]):
        for j in range(seg):
            bm.faces.new((a[j], b[j], b[(j + 1) % seg], a[(j + 1) % seg]))
    for f in bm.faces:
        for lp in f.loops:
            lp[uva].uv = (lp.vert.co.x - c.x, lp.vert.co.y - c.y); lp[uvb].uv = (0, r)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    return ob


def log(name, p, r, ln, yaw, rng, seed):
    sk = T.Skel(); d = Vector((math.cos(yaw), math.sin(yaw), 0))
    prev = sk.add(p - d * ln / 2, -1)
    for k in range(1, 9): prev = sk.add(p - d * ln / 2 + d * ln * k / 8 + Vector((0, 0, rng.gauss(0, 0.02))), prev)
    rad = [r * (1 - 0.12 * k / 8) for k in range(9)]
    ob = T.build_tubes(sk, rad, min_r=0.01, name=name, gnarl=0.07, seed=seed, spacing=lambda r: 0.45,
                       sides=lambda r: 14, tip=False, caps=True)
    caps = []
    return ob, caps


def main():
    args = [a for a in T.script_args()]
    force = "leaves" in args
    jobs = []
    for a in args:
        if a in VARIANTS or a == "stump": jobs.append(a)
        if a == "all": jobs += ["a", "b", "c", "stump"]
    if not jobs:
        jobs = [f"s{T.get_seed(11)}"]
    for j, job in enumerate(jobs):
        seed = VARIANTS.get(job, int(job[1:]) if job.startswith("s") and job[1:].isdigit() else 11)
        L.reset(seed)
        if j == 0 and force: leaves_image(force=True)
        if job == "stump":
            build_stump(seed)
            L.finish("oak_stump", tex=1024, lods=(1.0, 0.4, 0.15))
        else:
            leaves_image(force=False)
            build_oak(seed)
            L.finish(f"oak_{job}", tex=2048, lods=(1.0, 0.35, 0.1))


main()
