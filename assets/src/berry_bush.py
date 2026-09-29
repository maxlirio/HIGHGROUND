"""HIGHGROUND - bramble & bilberry patch (forage resource; placed at scale 2.0 -> a ~7 m thicket).

A low sprawling mound of bramble: arching purple-red canes that loop up and root their tips
again, dense leaf of three-to-five leaflet sprays touched with autumn red, blackberries ripe,
red and green together; a fringe of low bilberry with blue-black berries at its skirts, over a
pad of leaf litter and trodden earth where people come to pick.

    blender -b -t 2 -P assets/src/berry_bush.py            (HG_LEAVES=1 re-renders the atlas)
Front faces -Y. 1 unit = 1 m.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _landkit import *
import _trees as T, _veg as V

begin(101)
MAT["litter"] = m_loose("litter", [(0.0, "#3e3022"), (0.35, "#5a4430"), (0.65, "#6e5436"), (1.0, "#4a3a28")], lump=22.0,
                        grass=0.45, pebble=0.1)
mat_turf("turf", dry=0.4)


def bramble_outline(rng, n=70):
    """one bramble leaflet: ovate, sharply serrate, pointed."""
    out = []
    for i in range(n + 1):
        t = i / n
        env = math.sin(math.pi * t ** 0.85) ** 0.8 * 0.36 * (1.05 - 0.25 * t)
        out.append((V.serrate(env, t, 13, 0.16), t))
    out[0] = (0.02, 0.0); out[-1] = (0.0, 1.0)
    return out


def bilberry_outline(rng, n=40):
    out = []
    for i in range(n + 1):
        t = i / n
        out.append((V.serrate(math.sin(math.pi * t ** 0.9) ** 0.7 * 0.3, t, 9, 0.05), t))
    out[0] = (0.02, 0.0); out[-1] = (0.0, 1.0)
    return out


blk = ["#1f1a22", "#2a2030", "#241c26", "#3a2530"]       # ripe
red = ["#7a2a2a", "#8e3530", "#5a2230"]                   # ripening
grn = ["#7d8a40", "#8a9448"]
br = dict(kind="spray", outline=bramble_outline, greens=("#65903c", "#729a42", "#5a8038", "#7d9a46"), tint=(1.1, 1.08, 1.0), leaf_len=0.085,
          leaves=60, per_tip=9, spread=0.42, twig="#5a2e2e", twig_w=0.005, dry="#8a3a2a", dry_p=0.1)
cells = [br,
         dict(br, fruit=(40, 0.02, blk * 3 + red + grn)),
         dict(br, greens=("#5a5a2a", "#6b4a2a", "#7a3a2a", "#4f6b2e"), dry_p=0.25, fruit=(24, 0.02, blk + red)),
         dict(kind="spray", outline=bilberry_outline, greens=("#6c9a42", "#78a448", "#628d3c", "#8a9a44"),
              leaf_len=0.045, leaves=110, per_tip=14, spread=0.44, twig="#4a6a30", twig_w=0.004, dry="#8a4a2a", dry_p=0.12,
              fruit=(22, 0.014, ["#2c3048", "#343a58", "#262a3c"]))]
img = leaf_atlas("bramble_leaves.png", cells, force=bool(os.environ.get("HG_LEAVES")), seed=31)

rng = random.Random(7)
sk = T.Skel()
root = sk.add((0, 0, 0), -1, growable=False)
lobes = []
# arching canes from a few crowns: up, over, and down to root again
crowns = [Vector((rng.uniform(-0.8, 0.8), rng.uniform(-0.6, 0.6), 0.0)) for _ in range(4)]
for c in crowns:
    ci = sk.add(c, root, growable=False)
    for k in range(rng.randint(3, 5)):
        a = rng.uniform(0, 6.283)
        d = Vector((math.cos(a) * 0.9, math.sin(a) * 0.9, 0.7))
        seg = T.polyline(sk, ci, d, rng.uniform(0.5, 0.7), 0.14, rng, wander=0.3, kink_every=0.3, kink_deg=14,
                         growable=True)
        T.polyline(sk, seg[-1], Vector((math.cos(a), math.sin(a), -0.35)), rng.uniform(0.8, 1.3), 0.14, rng,
                   wander=0.25, kink_every=0.3, kink_deg=12, droop=0.25, growable=True)
for k in range(6):
    a = k * 1.05 + rng.uniform(-0.3, 0.3); r = rng.uniform(0.5, 1.1) if k else 0.0
    lobes.append((Vector((math.cos(a) * r, math.sin(a) * r * 0.8, rng.uniform(0.4, 0.5))),
                  (rng.uniform(0.9, 1.2), rng.uniform(0.8, 1.0), rng.uniform(0.35, 0.45))))
att = T.lobe_attractors(lobes, 3500, rng, shell=0.5, zmin=0.12)
T.colonize(sk, att, infl=1.4, kill=0.28, step=0.14, iters=140, tropism=(0, 0, -0.04), jitter=0.3, rng=rng)
rad = T.pipe_radii(sk, r_tip=0.005, exp=2.4, base_radius=0.03)
bark = T.bark_material("cane", plate="#5a3232", plate2="#4a2a2e", crack="#2a1a1c", lichen="#7a6a5a",
                       moss="#4e5a27", plate_scale=30.0, along=0.2, crack_width=0.05, moss_amount=0.2,
                       lichen_amount=0.05, smooth_below_r=0.05)
PCOL["cane"] = "#5a3232"
V.wood(sk, rad, "canes", bark, 1400, min_rs=(0.006, 0.008, 0.01, 0.012, 0.015), gnarl=0.1, seed=7)
centre, ext = V.crown_frame(lobes)
pts = T.tip_points(sk, rad, r_leaf=0.009, stride=1.1, rng=rng)
pts += T.tip_points(sk, rad, r_leaf=0.016, stride=2.5, rng=rng)


def pick(out, rng):
    if out.z > 0.3:
        return rng.choice((1, 1, 0, 2))
    return rng.choice((0, 0, 2, 1))


cs = V.card_lods(pts, img, centre, ext, rng, "bramble", size=(0.5, 0.75), cell_pick=pick, up_bias=0.45,
                 lod_keep=(1.0, 0.3, 0.08), lod_grow=(1.0, 1.6, 2.6), jitter=0.15, spread=0.12)
# bilberry skirt: low cards round the edge
sk2 = []
for i in range(90):
    a = rng.uniform(0, 6.283)
    r = rng.uniform(1.0, 1.55)
    p = Vector((math.cos(a) * r * 1.1, math.sin(a) * r * 0.9, rng.uniform(0.12, 0.3)))
    sk2.append((p, Vector((math.cos(a), math.sin(a), 0.6))))
cs2 = V.card_lods(sk2, img, Vector((0, 0, 0.1)), (1.7, 1.5, 0.4), rng, "bilberry", size=(0.34, 0.46),
                  cell_pick=lambda o, r: 3, up_bias=0.8, lod_keep=(1.0, 0.35, 0.0), lod_grow=(1.0, 1.5, 2.0),
                  jitter=0.05, spread=0.05)
for o in cs + cs2:
    o["hg_tag"] = "cards" if o in cs else "bilberry"
# keep the thicket low: ~1.15 m (the map places it at scale 2)
for o in bpy.context.scene.objects:
    if o.type == "MESH" and (o.name.startswith("canes") or o.name.startswith("bramble")):
        o.scale = (0.85, 0.85, 0.6)
# leaf litter / trodden picking ground
ground_patch(B("pad", "litter"), 0.0, 0.0, 2.0, 1.75, h=0.07, n=26, rings=4, bump=0.03, seed=5.0)
for i in range(10):
    a = rng.uniform(0, 6.283)
    tussock(B("tuft", "turf"), math.cos(a) * rng.uniform(1.7, 2.0), math.sin(a) * rng.uniform(1.4, 1.7), 0.0,
            rng.uniform(0.8, 1.2), blades=10)
done("berry_bush", tex=1024, lods=(1.0, 0.3, 0.1))
