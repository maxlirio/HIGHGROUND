"""Compose a whole test castle from the kit (the way the renderer will: pieces placed from the sim's layout rules)
and render it: wide 3/4, the game camera, a breach close-up, a cut-away into the keep and a view along a wall-walk.

  tools/heavy.sh /opt/homebrew/bin/blender -t 2 -b -P assets/src/castle/compose.py -- [views] [samples=N]
  views: wide,game,breach,cut,walk,gate,far (default all)

It reads assets/castle-kit.json for the sockets and doors, so a mismatch between manifest and meshes shows up here.
Writes assets/booth/castle/composed_<view>.png.
"""
import bpy, sys, os, math, json
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import castle_booth as B

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ROOT = B.ROOT
KIT = json.load(open(os.path.join(ROOT, "assets", "castle-kit.json")))["pieces"]
GLB = os.path.join(ROOT, "assets", "glb")

_proto = {}


def proto(name):
    """Import a GLB once; keep its mesh objects hidden as prototypes."""
    if name in _proto:
        return _proto[name]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(GLB, f"castle_{name}.glb"))
    new = [o for o in bpy.data.objects if o not in before]
    objs = []
    for o in new:
        if o.type == "MESH":
            o.hide_render = True; o.hide_viewport = True
            objs.append(o)
    _proto[name] = objs
    B.wire_vcol()
    return objs


def place(name, x, y, rot=0.0, hide=(), show=(), sx=1.0, sy=1.0):
    root = bpy.data.objects.new(f"P_{name}", None); bpy.context.scene.collection.objects.link(root)
    root.matrix_world = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(rot, 4, "Z") @ Matrix.Diagonal((sx, sy, 1, 1))
    for p in proto(name):
        nm = p.name.split(".")[0]
        if "_LOD" in nm and not nm.endswith("_LOD0"):
            continue
        base = nm.split("_LOD")[0]
        hidden = base in hide or any(h.endswith("*") and base.startswith(h[:-1]) for h in hide)
        if base in show:
            hidden = False
        if hidden:
            continue
        o = p.copy(); o.data = p.data
        bpy.context.scene.collection.objects.link(o)
        o.hide_render = False; o.hide_viewport = False
        o.parent = root
        o.matrix_parent_inverse = Matrix.Identity(4)
    return root


def circle_exit(cx, cy, r, px, py, u):
    dx, dy = px - cx, py - cy
    b = dx * u[0] + dy * u[1]; c = dx * dx + dy * dy - r * r; disc = b * b - c
    return 0.0 if disc < 0 else max(0.0, -b + math.sqrt(disc))


def build_castle():
    S = 33.0                                    # half side of the square enceinte
    poly = [(-S, -S), (S, -S), (S, S), (-S, S)]  # CCW
    n = len(poly)
    cen = (0.0, 0.0)
    R = 5.5; PROJ = 0.45
    towers = []
    for k in range(n):
        vx, vy = poly[k]
        bx, by = vx - cen[0], vy - cen[1]; bl = math.hypot(bx, by)
        tx, ty = vx + bx / bl * R * PROJ, vy + by / bl * R * PROJ
        towers.append({"v": (vx, vy), "c": (tx, ty), "in": (-bx / bl, -by / bl), "ends": []})
    stations = []
    for k in range(n):
        stations.append(("tower", k))
        if k == 0:
            stations.append(("gate", k))
    placed_curt = []
    breach_done = False
    for si in range(len(stations)):
        s0 = stations[si]; s1 = stations[(si + 1) % len(stations)]
        k0 = s0[1]
        a = poly[k0]; b = poly[(k0 + 1) % n]
        dx, dy = b[0] - a[0], b[1] - a[1]; ll = math.hypot(dx, dy); u = (dx / ll, dy / ll)
        # start / end points along this side
        if s0[0] == "tower":
            T = towers[k0]; t0 = circle_exit(T["c"][0], T["c"][1], R, a[0], a[1], u); p0 = a
        else:
            t0 = ll / 2 + 8.5; p0 = a
        if s1[0] == "tower":
            T1 = towers[s1[1]]; t1 = ll - circle_exit(T1["c"][0], T1["c"][1], R, b[0], b[1], (-u[0], -u[1]))
        else:
            t1 = ll / 2 - 8.5
        L_ = t1 - t0
        m = max(1, round(L_ / 6.0)); sc = L_ / m / 6.0
        rot = math.atan2(u[1], u[0])
        for j in range(m):
            t = t0 + (j + 0.5) * L_ / m
            x, y = a[0] + u[0] * t, a[1] + u[1] * t
            piece = "curtain" if (j + k0) % 2 == 0 else "curtain_b"
            # damage & dressing for the review: a breach on the east side, hoardings on the west, pocks near the gate
            if k0 == 1 and j == m // 2:
                piece = "curtain_breach"
            elif k0 == 1 and j == m // 2 + 1:
                piece = "curtain_cracked"
            elif k0 == 0 and j in (m - 1, 0):
                piece = "curtain_pocked"
            place(piece, x, y, rot, sx=sc)
            if k0 == 3:
                place("hoarding", x, y, rot, sx=sc)
            placed_curt.append((piece, x, y, rot))
        if s0[0] == "tower":
            towers[k0]["ends"].append((p0[0] + u[0] * t0, p0[1] + u[1] * t0))
        if s1[0] == "tower":
            towers[s1[1]]["ends"].append((a[0] + u[0] * t1, a[1] + u[1] * t1))
    # the gatehouse on the south side
    a, b = poly[0], poly[1]
    place("gatehouse", (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.0, hide=())
    # towers: rotate +y to the inside; open the door sectors that meet each curtain's walk
    for k, T in enumerate(towers):
        rot = math.atan2(T["in"][1], T["in"][0]) - math.pi / 2
        name = "tower_round" if k != 2 else "tower_round_collapsed"
        hide, show = ["upper_2_d*"], []
        for (ex, ey) in T["ends"]:
            # bearing of the walk entry in the tower's frame
            wx, wy = ex - T["c"][0], ey - T["c"][1]
            c, s = math.cos(-rot), math.sin(-rot)
            lx, ly = wx * c - wy * s, wx * s + wy * c
            bdeg = math.degrees(math.atan2(ly, lx)) % 360
            kk = int(round((bdeg - 7.5) / 15.0)) % 24
            hide.append(f"upper_2_w{kk:02d}"); show.append(f"upper_2_d{kk:02d}")
        place(name, T["c"][0], T["c"][1], rot, hide=hide, show=show)
    # keep (its forebuilding toward the bailey centre), bailey buildings, well
    kx, ky = -12.0, 10.0
    bx, by = cen[0] - kx, cen[1] - ky
    side = (1 if bx > 0 else 3) if abs(bx) > abs(by) else (2 if by > 0 else 0)
    place("keep", kx, ky, side * math.pi / 2)
    place("hall", 15.0, 16.0, 0.0)
    place("kitchen", 15.0, 5.0, 0.0)
    place("chapel", 16.0, -12.0, 0.0)
    place("stable", -19.0, -14.0, math.pi / 2)
    place("well", 2.0, -6.0, 0.0)


def mannequins(pts):
    """1.75 m grey figures for scale."""
    m = bpy.data.materials.new("man"); m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.35, 0.12, 0.1, 1)
    for (x, y, z) in pts:
        bpy.ops.mesh.primitive_cylinder_add(radius=0.22, depth=1.45, location=(x, y, z + 0.725), vertices=10)
        o = bpy.context.object; o.data.materials.append(m)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.14, location=(x, y, z + 1.6), segments=10, ring_count=6)
        bpy.context.object.data.materials.append(m)


def ground():
    g = B.ground(Vector((0, 0, 0)), 600)
    # a ditch hint: darker band round the walls
    return g


if __name__ == "__main__":
    views = (argv[0] if argv and "=" not in argv[0] else "wide,game,breach,cut,walk,gate,far").split(",")
    samples = 40
    for a in argv:
        if a.startswith("samples="):
            samples = int(a[8:])
    sc = B.setup_scene(); sc.cycles.samples = samples
    build_castle()
    ground()
    mannequins([(x, -33 + 0.3, 8.0) for x in (-20, -18.8, -17.6, 12, 13.1)] + [(33 - 0.3, y, 8.0) for y in (-20, -10.5, 9, 10.2)] +
               [(-33 - 7, y, 0) for y in (-6, -4.8, -3.5)] + [(40.5, 0, 0), (39.4, 1, 0), (38, -0.8, 1.2)] + [(-2, -45, 0), (0.5, -44, 0)])
    cam, cd = B.camera()
    out = os.path.join(ROOT, "assets", "booth", "castle")
    P = lambda v: os.path.join(out, f"composed_{v}.png")
    for v in views:
        if v == "wide":
            B.shoot(cam, cd, P(v), Vector((0, 0, 4)), (0.75, -1.0, 0.62), 125, 35)
        elif v == "game":
            B.shoot(cam, cd, P(v), Vector((0, -2, 0)), (0, -math.cos(math.radians(55)), math.sin(math.radians(55))), 260, 45)
        elif v == "far":
            B.shoot(cam, cd, P(v), Vector((0, -2, 0)), (0, -math.cos(math.radians(55)), math.sin(math.radians(55))), 520, 45)
        elif v == "breach":
            B.shoot(cam, cd, P(v), Vector((33, 0, 4)), (1.0, -0.55, 0.32), 30, 30)
        elif v == "gate":
            B.shoot(cam, cd, P(v), Vector((0, -38, 5)), (0.35, -1.0, 0.3), 30, 30)
        elif v == "walk":
            B.shoot(cam, cd, P(v), Vector((-33.3, 10, 9.0)), (0.12, -1.0, 0.18), 22, 24)
        elif v == "cut":
            # hide the keep's roof and chamber, look down into the hall
            for o in bpy.data.objects:
                if o.parent and o.parent.name.startswith("P_keep") and o.name.split(".")[0].split("_LOD")[0] in ("roof", "upper_2"):
                    o.hide_render = True
            B.shoot(cam, cd, P(v), Vector((-12, 10, 6)), (0.35, -0.55, 1.0), 48, 35)
