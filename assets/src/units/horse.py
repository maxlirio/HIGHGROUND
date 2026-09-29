"""HIGHGROUND - horses: horse_light (hobby/courser for hobelars & scouts, ~14 hh), horse_destrier
(knight's warhorse, ~15.2 hh, team caparison) and horse_destrier_barded (padded quilted barding).

    blender -b -t 5 -P assets/src/units/horse.py -- light|destrier|barded [sheet] [booth] [nobake]

Everything is procedural: the body is an anatomical signed-distance model (_horse_anat.py) meshed with
OpenVDB, tack is conformed to it by ray-marching the SDF, mane/tail are tapered locks textured from a
numpy strand strip. Skin weights come from the same anatomical primitives; the clips (_horse_anim.py)
are solved per frame (leg IK, flat hooves in stance) and baked to the units pipeline format
(tools/vat_bake.py): <arm>.glb (+LOD1), <arm>_vat.bin/.json, <arm>_col/_rough/_mask.png, with the
rider seat per frame in the json. See docs/units-horse.md.
"""
import sys, os, math, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))
import importlib
import bpy, bmesh
import numpy as np
from mathutils import Vector, kdtree
import _lib as L
import _horse_anat as A
import _horse_geo as HG
import _horse_mat as HM
import _horse_hair as HH
import _horse_anim as AN
for _m in (A, HG, HM, HH, AN): importlib.reload(_m)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["destrier"]
KIND = argv[0]
FLAGS = set(argv[1:])
ANAT = "light" if KIND == "light" else "destrier"
NAME = {"light": "horse_light", "destrier": "horse_destrier", "barded": "horse_destrier_barded"}[KIND]
TEX = 1024
BODY_V = 0.80            # atlas: body/tack/cloth UVs in v < BODY_V, hair strip above
OUT = os.path.join(L.ROOT, "assets", "units")
BOOTH = os.path.join(L.ROOT, "assets", "booth")
BODY_TRIS = {"light": 4300, "destrier": 4000, "barded": 4000}[KIND]
CLOTH_TRIS = {"light": 0, "destrier": 900, "barded": 900}[KIND]
NEUTRAL_LIN = HM.NEUTRAL_LIN

# coat palette = the arm's dyes. d1 (mask B = 1.0) is the body coat, d2 (mask B = 0.5) the points
# (mane, tail, lower legs, ear rims). The lists are PAIRED: index i of d1 and d2 together make one
# coat (bay, chestnut, grey, black, dun, + darker/lighter shades); see docs/units-horse.md.
COATS = [("bay", "7a4526", "1f1916"), ("dark bay", "5e331d", "231c18"), ("chestnut", "8e4b24", "5a2e16"),
         ("light chestnut", "a0612f", "6e3a1c"), ("dapple grey", "aaa69e", "4a4744"),
         ("light grey", "c4c0b8", "5c5955"), ("black", "2e2825", "221e1c"), ("dun", "a88a5c", "352a22")]
DYES = {"d1": [c[1] for c in COATS], "d2": [c[2] for c in COATS]}
COAT_NAMES = [c[0] for c in COATS]


def setup():
    L.reset(seed=5)
    bpy.context.scene.render.threads = 5


# ------------------------------------------------------------------ vertex attributes on the body
def smooth01(x):
    x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)


def body_attributes(ob, an):
    me = ob.data
    P = np.array([v.co[:] for v in me.vertices])
    S = an.S
    ds = np.stack([an.prim_sdf(p, P) for p in an.prims], 1)
    tags = [p["tag"] for p in an.prims]
    def tagd(t):
        idx = [i for i, x in enumerate(tags) if x == t]
        return ds[:, idx].min(1)
    acc = an.weights(P)
    names = A.bone_names(); bi = {n: i for i, n in enumerate(names)}
    tot = acc.sum(1) + 1e-9
    def bw(*bs):
        return sum(acc[:, bi[b]] for b in bs) / tot
    hoof = smooth01((0.012 - tagd("hoof")) / 0.012) * (P[:, 2] < 0.11 * S)
    eye = smooth01((0.008 - tagd("eye")) / 0.008)
    af, az = an.head_axis; nf, nz = an.head_front
    hs = an.v["head"]
    poll = an.P(1.06, 1.74)
    ax = np.array([0.0, -af, az]); fr = np.array([0.0, -nf, nz])
    t = (P - poll) @ ax / (S * hs); n = (P - poll) @ fr / (S * hs)
    headw = bw("head")
    muzzle = 0.75 * smooth01((t - 0.49) / 0.06) * headw
    legs = bw("fcannon_L", "fcannon_R", "fpast_L", "fpast_R", "fhoof_L", "fhoof_R",
              "hcannon_L", "hcannon_R", "hpast_L", "hpast_R", "hhoof_L", "hhoof_R",
              "forearm_L", "forearm_R", "tibia_L", "tibia_R")
    front = -P[:, 1] > 0
    knee = np.where(front, 0.50, 0.56) * S
    points = legs * smooth01((knee - P[:, 2]) / (0.05 * S))
    ear = smooth01((0.006 - tagd("ear")) / 0.01)
    points = np.maximum(points, ear * smooth01((P[:, 2] - (an.P(0, 1.86)[2])) / (0.03 * S)))
    marks = np.zeros(len(P))
    blaze = headw * (n > 0.0) * smooth01((0.03 - np.abs(P[:, 0]) / (S * hs)) / 0.01)
    star = blaze * smooth01(1 - np.abs(t - 0.17) / 0.05)
    marks = np.maximum(marks, 0.90 * star)
    dapzone = (1 - smooth01((0.75 * S - P[:, 2]) / (0.25 * S)) * legs) * (1 - 0.8 * headw)
    for name, arr in (("hoof", hoof), ("eye", eye), ("muzzle", muzzle), ("points", points),
                      ("marks", marks), ("dapzone", dapzone)):
        a = me.attributes.new(name, "FLOAT", "POINT")
        a.data.foreach_set("value", np.asarray(arr, np.float32).tolist())


ATTRS = ("hoof", "eye", "muzzle", "points", "marks", "dapzone", "tpar")


def ensure_attrs(ob):
    me = ob.data
    for n in ATTRS:
        if n not in me.attributes:
            me.attributes.new(n, "FLOAT", "POINT")


# ------------------------------------------------------------------ materials
def make_materials(an):
    S = an.S
    rough = 1.0 if KIND == "light" else 0.25
    M = {}; MK = {}; MA = {}
    M["coat"] = HM.m_coat("coat", rough, S)
    MK["coat"] = HM.m_coat_mask("coat_mask", S)[0]
    MA["coat"] = HM.m_coat_mask_a("coat_maskA")
    M["strap"] = HM.m_leather("strap", S)
    M["saddle"] = HM.m_saddle("saddle", S)
    M["iron"] = HM.m_iron("iron", S)
    M["saddlecloth"] = HM.m_saddlecloth("saddlecloth", S, False)
    M["pendant"] = HM.m_cloth("pendant", S, quilt=False)
    hem = (0.50 if KIND == "destrier" else 0.72) * S
    M["caparison"] = HM.m_cloth("caparison", S, quilt=False)
    M["barding"] = HM.m_cloth("barding", S, quilt=True)
    M["hair_vis"] = HM.mask_const("hair_vis", 0.4, 0.4, 0.4)   # the strip is pasted after the bake
    for k in M:
        if k not in MK:
            MK[k] = HM.mask_const(k + "_mask")
        if k not in MA:
            MA[k] = HM.mask_const(k + "_maskA")
    MK["pendant"] = HM.mask_const("pendant_mask", gg=1.0)
    MK["caparison"] = HM.m_cloth_mask("caparison_mask", S, hem, charges=((-0.56, 1.10), (0.50, 1.10)))
    MK["barding"] = HM.m_cloth_mask("barding_mask", S, hem, border=0.06, charges=((-0.56, 1.16),))
    return M, MK, MA


# ------------------------------------------------------------------ build
def build():
    setup()
    an = A.Anatomy(ANAT)
    M, MK, MA = make_materials(an)
    body = HG.body_mesh(an, 0.0095, BODY_TRIS, M["coat"])
    body_attributes(body, an)
    cl = None
    objs = [body]
    if KIND in ("destrier", "barded"):
        cl = HG.Cloth(an, "caparison" if KIND == "destrier" else "barding")
        cloth = cl.mesh(M, h=0.018 * an.S)
        dec(cloth, CLOTH_TRIS)
        objs.append(cloth)
        cull_under_cloth(body, an, KIND)
    tk = HG.Tack(an, M, KIND, cl)
    tk.saddle(); tk.breastplate(); tk.bridle()
    if KIND != "light":
        tk.crupper()
    objs += tk.objs
    def uvbox(style, s, t):
        u0 = style / 4.0 + 0.004; u1 = (style + 1) / 4.0 - 0.004
        return (u0 + (u1 - u0) * min(max(s, 0), 1), 1.0 - 0.004 - (1.0 - BODY_V - 0.012) * t)
    hair = HG.hair_locks(an, KIND, uvbox)
    hair.data.materials.append(M["hair_vis"])
    objs.append(hair)
    for o in objs:
        ensure_attrs(o)
    return an, objs, M, MK, MA, tk, cl


def dec(ob, tris):
    m = ob.modifiers.new("dec", "DECIMATE")
    n = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    m.ratio = min(1.0, tris / max(n, 1))
    m.use_symmetry = True; m.symmetry_axis = "X"
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier="dec")


def cull_under_cloth(body, an, kind):
    """delete torso faces the trapper hides at rest (legs are kept: they swing out from under)."""
    me = body.data
    P = np.array([v.co[:] for v in me.vertices])
    acc = an.weights(P)
    names = A.bone_names(); bi = {n: i for i, n in enumerate(names)}
    torso = sum(acc[:, bi[b]] for b in ("root", "chest", "pelvis", "neck1", "neck2", "tail1",
                                          "scap_L", "scap_R", "femur_L", "femur_R")) / (acc.sum(1) + 1e-9)
    S = an.S
    hem = (0.50 if kind == "destrier" else 0.72) * S
    f = -P[:, 1] / S
    hidden = (torso > 0.985) & (P[:, 2] > hem + 0.30 * S) & (f < 0.92) & (f > -0.78)
    bm = bmesh.new(); bm.from_mesh(me)
    kill = [fc for fc in bm.faces if all(hidden[v.index] for v in fc.verts)]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(me); bm.free()


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name; ob.data.name = name
    return ob


def attr_np(ob, name, dtype=np.float32):
    me = ob.data
    a = np.zeros(len(me.vertices), dtype)
    me.attributes[name].data.foreach_get("value", a)
    return a


# ------------------------------------------------------------------ UV + bake
HAIR_PARTS = {HG.PART["mane"], HG.PART["tail"], HG.PART["forelock"], HG.PART["feather"]}


def unwrap(ob):
    me = ob.data
    part = attr_np(ob, "part", np.int32)
    if "bake" not in me.uv_layers:
        me.uv_layers.new(name="bake")
    for u in list(me.uv_layers):
        if u.name != "bake": me.uv_layers.remove(u)
    me.uv_layers.active = me.uv_layers["bake"]
    is_hair = np.array([part[p.vertices[0]] in HAIR_PARTS for p in me.polygons])
    nl = len(me.loops)
    saved = np.zeros(nl * 2, np.float32); me.uv_layers["bake"].data.foreach_get("uv", saved)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(me)
    bm.faces.ensure_lookup_table()
    for f in bm.faces: f.select_set(not is_hair[f.index])
    bm.select_flush_mode()
    bmesh.update_edit_mesh(me)
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.004, area_weight=1.0)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(margin=3.0 / TEX, margin_method="FRACTION", shape_method="CONVEX")
    bpy.ops.object.mode_set(mode="OBJECT")
    uvd = np.zeros(nl * 2, np.float32); me.uv_layers["bake"].data.foreach_get("uv", uvd)
    uvd = uvd.reshape(-1, 2); saved = saved.reshape(-1, 2)
    li_hair = np.zeros(nl, bool)
    for p in me.polygons:
        if is_hair[p.index]: li_hair[list(p.loop_indices)] = True
    uvd[~li_hair, 1] *= (BODY_V - 0.004)
    uvd[li_hair] = saved[li_hair]
    me.uv_layers["bake"].data.foreach_set("uv", uvd.ravel())
    for p in me.polygons: p.select = True


def bake(ob, M, MK, MA, shaggy):
    sc = bpy.context.scene
    imgs = {k: bpy.data.images.new(f"{NAME}_{k}_raw", TEX, TEX, alpha=False, float_buffer=True)
            for k in ("col", "rough", "ao", "mask", "maskA")}
    for k in ("rough", "mask", "maskA", "ao"):
        imgs[k].colorspace_settings.name = "Non-Color"
    sc.cycles.samples = 16
    L._bake(ob, imgs["col"], "DIFFUSE", pass_filter={"COLOR"})
    L._bake(ob, imgs["rough"], "ROUGHNESS")
    if not sc.world: sc.world = bpy.data.worlds.new("w")
    sc.world.light_settings.distance = 0.25
    sc.cycles.samples = 64
    L._bake(ob, imgs["ao"], "AO")
    orig = [s.material for s in ob.material_slots]
    def swap(table):
        for s, m in zip(ob.material_slots, orig):
            s.material = table[m.name.split(".")[0]]
    sc.cycles.samples = 1
    swap(MK); L._bake(ob, imgs["mask"], "EMIT")
    swap(MA); L._bake(ob, imgs["maskA"], "EMIT")
    for s, m in zip(ob.material_slots, orig): s.material = m
    def px(img):
        a = np.empty(TEX * TEX * 4, np.float32); img.pixels.foreach_get(a)
        return a.reshape(TEX, TEX, 4)
    col = px(imgs["col"])[..., :3]           # linear (float buffer)
    ao = px(imgs["ao"])[..., 0]; rough = px(imgs["rough"])[..., 0]
    mk = px(imgs["mask"]); ma = px(imgs["maskA"])
    col = col * (0.30 + 0.70 * ao[..., None])
    # final pipeline mask: R team, G accent, B dye (1.0 coat / 0.5 points) - binary dye bands
    coatw = mk[..., 2]; pts = ma[..., 0]
    B = np.where(coatw > 0.5, np.where(pts > 0.5, 0.5, 1.0), 0.0)
    mask = np.stack([np.clip(mk[..., 0], 0, 1), np.clip(mk[..., 1], 0, 1), B], -1)
    # hair strip rows (v >= BODY_V): generated strands, points dye
    h0 = int(math.floor(BODY_V * TEX))
    lum, _ = HH.hair_strip(TEX, TEX - h0, shaggy)
    lum_lin = np.where(lum <= 0.04045, lum / 12.92, ((lum + 0.055) / 1.055) ** 2.4)
    col[h0:] = lum_lin[..., None]
    rough[h0:] = 0.62
    mask[h0:] = (0.0, 0.0, 0.5)
    return col, rough, mask


def save_png(name, arr, color, directory=None):
    """arr HxWx3 linear (colour) or raw (data) -> <directory>/<name>.png (8 bit)"""
    H_, W_ = arr.shape[:2]
    img = bpy.data.images.new(name, W_, H_, alpha=False)
    img.colorspace_settings.name = "sRGB" if color else "Non-Color"
    px = np.ones((H_, W_, 4), np.float32)
    if color:
        x = np.clip(arr, 0, 1)
        px[..., :3] = np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)
    else:
        px[..., :3] = arr if arr.ndim == 3 else arr[..., None]
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = os.path.join(directory or OUT, name + ".png"); img.file_format = "PNG"; img.save()
    img2 = bpy.data.images.load(img.filepath_raw, check_existing=False)
    img2.colorspace_settings.name = "sRGB" if color else "Non-Color"
    bpy.data.images.remove(img)
    return img2


def baked_material(col_img, rough_img):
    m = bpy.data.materials.new(NAME); m.use_nodes = True
    n, l = m.node_tree.nodes, m.node_tree.links
    b = n["Principled BSDF"]
    uvn = n.new("ShaderNodeUVMap"); uvn.uv_map = "bake"
    tc = n.new("ShaderNodeTexImage"); tc.image = col_img
    tr = n.new("ShaderNodeTexImage"); tr.image = rough_img
    for t in (tc, tr): l.new(uvn.outputs["UV"], t.inputs["Vector"])
    l.new(tc.outputs["Color"], b.inputs["Base Color"])
    sep = n.new("ShaderNodeSeparateColor"); l.new(tr.outputs["Color"], sep.inputs["Color"])
    l.new(sep.outputs["Green"], b.inputs["Roughness"])
    b.inputs["Metallic"].default_value = 0.0
    m.use_backface_culling = False
    return m


# ------------------------------------------------------------------ skin weights
def skin_weights(ob, an, cloth):
    """(N,4) bone indices + (N,4) weights for every vertex of the joined mesh."""
    me = ob.data
    nv = len(me.vertices)
    P = np.zeros(nv * 3); me.vertices.foreach_get("co", P); P = P.reshape(nv, 3)
    part = attr_np(ob, "part", np.int32); tpar = attr_np(ob, "tpar")
    names = A.bone_names(); bi = {n: i for i, n in enumerate(names)}
    NB = len(names)
    W = np.zeros((nv, NB))
    body = part == HG.PART["body"]
    W[body] = an.weights(P[body])
    m = part == HG.PART["cloth"]
    if m.any():
        W[m] = an.weights(P[m], sigma=0.05, prims=cloth.torso)
    W = W / (W.sum(1, keepdims=True) + 1e-12)
    ed = np.zeros(len(me.edges) * 2, np.int64); me.edges.foreach_get("vertices", ed); ed = ed.reshape(-1, 2)
    smooth_m = body | m
    for _ in range(3):
        acc = np.zeros_like(W); cnt = np.zeros(nv)
        np.add.at(acc, ed[:, 0], W[ed[:, 1]]); np.add.at(acc, ed[:, 1], W[ed[:, 0]])
        np.add.at(cnt, ed[:, 0], 1); np.add.at(cnt, ed[:, 1], 1)
        nb = acc / np.maximum(cnt, 1)[:, None]
        W[smooth_m] = 0.5 * W[smooth_m] + 0.5 * nb[smooth_m]
    # tack, mane, forelock: copy the nearest body vertex
    kd = kdtree.KDTree(int(body.sum()))
    bidx = np.nonzero(body)[0]
    for k, i in enumerate(bidx): kd.insert(P[i], k)
    kd.balance()
    for i in np.nonzero(~body & ~m)[0]:
        co, k, d = kd.find(P[i])
        W[i] = W[bidx[k]]
    m = part == HG.PART["iron"]
    W[m] = 0; W[m, bi["root"]] = 1.0
    m = part == HG.PART["rein"]
    if m.any():
        t = tpar[m]
        wh = np.clip(1 - t / 0.35, 0, 1); wc = np.clip((t - 0.55) / 0.45, 0, 1); wn = 1 - wh - wc
        W[m] = 0; W[m, bi["head"]] = wh; W[m, bi["neck2"]] = wn * 0.6; W[m, bi["neck1"]] = wn * 0.4
        W[m, bi["chest"]] = wc
    m = part == HG.PART["tail"]
    if m.any():
        t = tpar[m]
        W[m] = 0
        w1 = np.clip(1 - t / 0.15, 0, 1); w3 = np.clip((t - 0.25) / 0.5, 0, 1)
        W[m, bi["tail1"]] = w1; W[m, bi["tail3"]] = w3; W[m, bi["tail2"]] = 1 - w1 - w3
    idx = np.argsort(-W, axis=1)[:, :4]
    w = np.take_along_axis(W, idx, 1)
    w = w / (w.sum(1, keepdims=True) + 1e-12)
    return idx, w


def lbs(P, N, idx, w, G, names, drape=None):
    """linear blend skinning with global bone matrices G (name -> 4x4 rest-relative); `drape` (make_drape) lets the
    trapper's skirt fall under gravity once the body tilts (rearing, falling, lying dead)."""
    M = np.stack([G[n] for n in names])
    Mi = M[idx]
    Pw = np.einsum("nkij,nj->nki", Mi[..., :3, :3], P) + Mi[..., :3, 3]
    Nw = np.einsum("nkij,nj->nki", Mi[..., :3, :3], N)
    Pn = (Pw * w[..., None]).sum(1)
    Nn = (Nw * w[..., None]).sum(1)
    Nn /= np.linalg.norm(Nn, axis=1, keepdims=True) + 1e-9
    if drape is not None:
        Pn, Nn = apply_drape(drape, Pn, Nn, Mi, w, M, idx, G)
    return Pn, Nn


def make_drape(ob, an, cloth):
    """per-mesh data for apply_drape: which vertices hang (the skirt below the barrel), their anchor at the top
    of the skirt, and the triangles (to re-light the moved cloth)."""
    if cloth is None:
        return None
    P, _ = mesh_PN(ob)
    part = attr_np(ob, "part", np.int32)
    S = an.S; top = 1.06 * S
    m = (part == HG.PART["cloth"]) & (P[:, 2] < top)
    if not m.any():
        return None
    k = np.clip((top - P[:, 2]) / (top - cloth.hem), 0, 1)
    A = P.copy(); A[:, 2] = np.maximum(P[:, 2], top)
    me = ob.data; me.calc_loop_triangles()
    T = np.zeros(len(me.loop_triangles) * 3, np.int64); me.loop_triangles.foreach_get("vertices", T)
    return {"m": np.nonzero(m)[0], "k": k, "A": A, "T": T.reshape(-1, 3), "an": an, "S": S}


def apply_drape(D, Pn, Nn, Mi, w, M, idx, G):
    """the skirt hangs from its anchor (carried rigidly with the barrel); as the barrel tilts away from upright its
    hang direction swings toward world down, it is kept outside the body, and it lies on the ground rather than
    standing out stiffly like a board (a dead caparisoned horse read as a box on its side)."""
    Rb = G["root"][:3, :3]
    tilt = 1.0 - float(np.clip((Rb @ np.array([0, 0, 1.0]))[2], -1, 1))     # 0 upright .. 1 on its side
    g = float(np.clip(tilt * 1.6, 0.0, 0.92))
    if g < 0.01:
        return Pn, Nn
    ii = D["m"]
    Mv = Mi[ii]; wv = w[ii]
    Aw = ((np.einsum("nkij,nj->nki", Mv[..., :3, :3], D["A"][ii]) + Mv[..., :3, 3]) * wv[..., None]).sum(1)
    h = Pn[ii] - Aw
    L = np.linalg.norm(h, axis=1, keepdims=True)
    hd = h * (1 - g) + np.array([0, 0, -1.0]) * L * g
    hd = hd / (np.linalg.norm(hd, axis=1, keepdims=True) + 1e-9) * L
    q = Aw + hd
    # outside the body: test in the rest frame of each vertex's main bone
    an = D["an"]; S = D["S"]
    b0 = idx[ii, 0]
    Minv = np.linalg.inv(M)[b0]
    qr = np.einsum("nij,nj->ni", Minv[:, :3, :3], q) + Minv[:, :3, 3]
    off = 0.03 * S
    for _ in range(3):
        d = an.sdf(qr)
        push = np.maximum(off - d, 0)
        if not push.any(): break
        qr = qr + HG.grad(an, qr) * push[:, None]
    q = np.einsum("nij,nj->ni", M[b0][:, :3, :3], qr) + M[b0][:, :3, 3]
    q[:, 2] = np.maximum(q[:, 2], 0.012 + 0.01 * D["k"][ii])                 # lying on the ground, not through it
    Pn = Pn.copy(); Pn[ii] = q
    # re-light: normals of the moved cloth from its triangles
    T = D["T"]
    fn = np.cross(Pn[T[:, 1]] - Pn[T[:, 0]], Pn[T[:, 2]] - Pn[T[:, 0]])
    vn = np.zeros_like(Pn)
    for c in range(3): np.add.at(vn, T[:, c], fn)
    vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
    Nn = Nn.copy(); Nn[ii] = vn[ii]
    return Pn, Nn


# ------------------------------------------------------------------ clips -> VAT (pipeline format)
def clip_table(an):
    S = an.S
    t = {}
    for name in AN.CLIPS:
        if name in AN.GAITS:
            g = AN.GAITS[name]
            t[name] = (g["frames"], round(g["frames"] / g["T"], 3), True,
                       round(g["sweep"] * S / (g["duty"] * g["T"]), 3))
        elif name == "idle": t[name] = (16, 6.0, True, None)
        elif name == "rear": t[name] = (16, 10.0, False, None)
        elif name == "fall": t[name] = (14, 10.0, False, None)
        elif name == "dead": t[name] = (1, 1.0, True, None)
    return t


def to_three(v):
    v = np.asarray(v)
    return np.stack([v[..., 0], v[..., 2], -v[..., 1]], -1)


def mat_to_quat_three(R):
    C = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)
    Rt = C @ R @ C.T
    tr = np.trace(Rt)
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        w = 0.25 * s; x = (Rt[2, 1] - Rt[1, 2]) / s; y = (Rt[0, 2] - Rt[2, 0]) / s; z = (Rt[1, 0] - Rt[0, 1]) / s
    elif Rt[0, 0] > Rt[1, 1] and Rt[0, 0] > Rt[2, 2]:
        s = math.sqrt(1.0 + Rt[0, 0] - Rt[1, 1] - Rt[2, 2]) * 2
        w = (Rt[2, 1] - Rt[1, 2]) / s; x = 0.25 * s; y = (Rt[0, 1] + Rt[1, 0]) / s; z = (Rt[0, 2] + Rt[2, 0]) / s
    elif Rt[1, 1] > Rt[2, 2]:
        s = math.sqrt(1.0 + Rt[1, 1] - Rt[0, 0] - Rt[2, 2]) * 2
        w = (Rt[0, 2] - Rt[2, 0]) / s; x = (Rt[0, 1] + Rt[1, 0]) / s; y = 0.25 * s; z = (Rt[1, 2] + Rt[2, 1]) / s
    else:
        s = math.sqrt(1.0 + Rt[2, 2] - Rt[0, 0] - Rt[1, 1]) * 2
        w = (Rt[1, 0] - Rt[0, 1]) / s; x = (Rt[0, 2] + Rt[2, 0]) / s; y = (Rt[1, 2] + Rt[2, 1]) / s; z = 0.25 * s
    q = np.array([x, y, z, w]); return q / np.linalg.norm(q)


def oct_encode(n):
    n = n / (np.abs(n).sum(1, keepdims=True) + 1e-9)
    x, y = n[:, 0].copy(), n[:, 1].copy()
    neg = n[:, 2] < 0
    x2 = (1 - np.abs(y)) * np.sign(x + 1e-12); y2 = (1 - np.abs(x)) * np.sign(y + 1e-12)
    x[neg], y[neg] = x2[neg], y2[neg]
    qx = np.clip(np.round((x * 0.5 + 0.5) * 255), 0, 255).astype(np.uint16)
    qy = np.clip(np.round((y * 0.5 + 0.5) * 255), 0, 255).astype(np.uint16)
    return (qx << 8) | qy


def mesh_PN(ob):
    me = ob.data; n = len(me.vertices)
    P = np.zeros(n * 3); me.vertices.foreach_get("co", P)
    N = np.zeros(n * 3); me.vertex_normals.foreach_get("vector", N)
    return P.reshape(n, 3), N.reshape(n, 3)


def all_frames(rig, anim):
    """[(clip, frame, globals)] in VAT order"""
    table = clip_table(rig.an)
    out = []
    for name in AN.CLIPS:
        poses = AN.clip_poses(anim, name)
        assert len(poses) == table[name][0], (name, len(poses))
        for f, p in enumerate(poses):
            out.append((name, f, AN.evaluate(rig, p)))
    return out, table


def bake_vat(lods, skins, frames, table, seat_rest):
    names = A.bone_names()
    pos, nrm = [], []
    PN = [mesh_PN(o) for o in lods]
    for (clip, f, G) in frames:
        ps, ns = [], []
        for (P, N), (idx, w, dr) in zip(PN, skins):
            p, n = lbs(P, N, idx, w, G, names, dr)
            ps.append(p); ns.append(n)
        pos.append(to_three(np.concatenate(ps))); nrm.append(to_three(np.concatenate(ns)))
    pos = np.stack(pos); nrm = np.stack(nrm)
    lo = pos.reshape(-1, 3).min(0) - 0.01; hi = pos.reshape(-1, 3).max(0) + 0.01
    q = np.clip(np.round((pos - lo) / (hi - lo) * 65535), 0, 65535).astype(np.uint16)
    F, V = pos.shape[:2]
    on = oct_encode(nrm.reshape(-1, 3)).reshape(F, V)
    tex = np.zeros((F, V, 4), np.uint16); tex[..., :3] = q; tex[..., 3] = on
    W = 2048; total = F * V; Hh = (total + W - 1) // W
    flat = np.zeros((W * Hh, 4), np.uint16); flat[:total] = tex.reshape(-1, 4)
    with open(os.path.join(OUT, f"{NAME}_vat.bin"), "wb") as fh:
        fh.write(flat.astype("<u2").tobytes())
    clips = {}; start = 0; seat = {}
    for name in AN.CLIPS:
        nf, fps, loop, speed = table[name]
        clips[name] = {"start": start, "frames": nf, "fps": fps, "loop": loop, "speed": speed}
        start += nf
    for (clip, f, G) in frames:
        M = G["seat"]
        p = M[:3, :3] @ seat_rest + M[:3, 3]
        qt = mat_to_quat_three(M[:3, :3])
        seat.setdefault(clip, []).append([round(float(x), 4) for x in list(to_three(p)) + list(qt)])
    return clips, seat, (lo, hi), W, Hh, F


def set_vid_uv(lods):
    off = 0
    for o in lods:
        me = o.data
        uv = me.uv_layers.new(name="vid")
        n = len(me.loops)
        vi = np.zeros(n, np.int64); me.loops.foreach_get("vertex_index", vi)
        arr = np.zeros((n, 2), np.float32); arr[:, 0] = vi + off; arr[:, 1] = 0.0
        uv.data.foreach_set("uv", arr.ravel())
        me.uv_layers.active = me.uv_layers["bake"]
        off += len(me.vertices)


def export(lods):
    for o in lods:
        for a in [a.name for a in o.data.attributes if a.name in ATTRS or a.name == "part"]:
            o.data.attributes.remove(o.data.attributes[a])
    bpy.ops.object.select_all(action="DESELECT")
    for o in lods: o.select_set(True)
    bpy.context.view_layer.objects.active = lods[0]
    path = os.path.join(OUT, NAME + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_apply=True, export_skins=False,
                              export_animations=False, export_morph=False, export_attributes=False,
                              export_image_format="JPEG", export_jpeg_quality=92, export_yup=True)
    return path


def update_index():
    arms = sorted(f[:-9] for f in os.listdir(OUT) if f.endswith("_vat.json"))
    with open(os.path.join(OUT, "index.json"), "w") as fh: json.dump({"arms": arms}, fh)


# ------------------------------------------------------------------ previews
def hexlin(h):
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def palette_col(col_lin, mask, coat_i, team="2a55a5", accent="d9a927"):
    """numpy twin of the engine tint: albedo * mix(1, tint/NEUTRAL, mask) per channel"""
    out = col_lin.copy()
    def tint(out, colour, fac):
        return out * (1 - fac[..., None]) + out * (colour / NEUTRAL_LIN) * fac[..., None]
    B = mask[..., 2]
    band = lambda x, a0, a1: np.clip((x - a0) / (a1 - a0), 0, 1)
    out = tint(out, hexlin(team), mask[..., 0])
    out = tint(out, hexlin(accent), mask[..., 1])
    out = tint(out, hexlin(DYES["d1"][coat_i]), band(B, 0.75, 0.95))
    out = tint(out, hexlin(DYES["d2"][coat_i]), band(B, 0.3, 0.45) * (1 - band(B, 0.55, 0.7)))
    return out


def preview_glb(ob, col, rough_img, mask, coat_i, path, team="2a55a5", accent="d9a927"):
    c = palette_col(col, mask, coat_i, team, accent)
    img = save_png(os.path.splitext(os.path.basename(path))[0], c, True, os.path.dirname(path))
    m = baked_material(img, rough_img)
    saved = [s.material for s in ob.material_slots]
    ob.data.materials.clear(); ob.data.materials.append(m)
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_apply=True, export_attributes=False,
                              export_image_format="JPEG", export_jpeg_quality=92)
    ob.data.materials.clear()
    for s in saved: ob.data.materials.append(s)
    return c


def pose_sheet(ob, P, N, idx, w, frames, tag, direction, img, per_row=8, clips=None, drape=None):
    """Workbench contact sheet: one row per clip (<= per_row frames), textured with a coat."""
    sc = bpy.context.scene
    names = A.bone_names()
    clips = clips or AN.CLIPS
    d = Vector(direction).normalized(); right = Vector((0, 0, 1)).cross(d).normalized()
    S = 2.9
    rows = {}
    for (clip, f, G) in frames:
        rows.setdefault(clip, []).append((f, G))
    snaps = []; maxn = 0
    m = bpy.data.materials.new("sheet"); m.use_nodes = True
    tn = m.node_tree.nodes.new("ShaderNodeTexImage"); tn.image = img
    uvn = m.node_tree.nodes.new("ShaderNodeUVMap"); uvn.uv_map = "bake"
    m.node_tree.links.new(uvn.outputs["UV"], tn.inputs["Vector"])
    m.node_tree.links.new(tn.outputs["Color"], m.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    for r, clip in enumerate(clips):
        fr = rows[clip]
        step = max(1, math.ceil(len(fr) / per_row))
        k = 0
        for f, G in fr[::step]:
            p, _ = lbs(P, N, idx, w, G, names, drape)
            me = ob.data.copy(); o = bpy.data.objects.new(f"s_{clip}_{f}", me)
            sc.collection.objects.link(o)
            me.vertices.foreach_set("co", p.ravel()); me.update()
            me.materials.clear(); me.materials.append(m)
            o.location = right * (k * S) + Vector((0, 0, -r * 2.6))
            snaps.append(o); k += 1
        maxn = max(maxn, k)
    ob.hide_render = True
    for o in bpy.data.objects:
        if o.name.endswith("_LOD1"): o.hide_render = True
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"; sc.display.shading.color_type = "TEXTURE"
    sc.display.shading.show_cavity = True
    wm, hm = maxn * S + 0.5, len(clips) * 2.6 + 0.4
    sc.render.resolution_x = 2200; sc.render.resolution_y = int(2200 * hm / wm)
    cam_d = bpy.data.cameras.new("c"); cam_d.type = "ORTHO"; cam_d.ortho_scale = max(wm, hm)
    cam = bpy.data.objects.new("c", cam_d); sc.collection.objects.link(cam); sc.camera = cam
    centre = right * ((maxn - 1) * S / 2) + Vector((0, 0, -(len(clips) - 1) * 2.6 / 2 + 1.0))
    cam.location = centre + d * 30
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam_d.clip_end = 100
    sc.render.filepath = os.path.join(BOOTH, f"unit_{NAME}_sheet_{tag}.png")
    bpy.ops.render.render(write_still=True)
    for s in snaps: bpy.data.objects.remove(s)
    ob.hide_render = False
    sc.render.engine = "CYCLES"
    print("SHEET", sc.render.filepath)


# ------------------------------------------------------------------ main
def main():
    an, objs, M, MK, MA, tk, cloth = build()
    lod0 = join(objs, NAME + "_LOD0")
    unwrap(lod0)
    an.joints["seat"] = np.array(tk.seat)          # rider seat (docs/units-horse.md)
    rig = AN.Rig(an); anim = AN.Animator(rig)
    frames, table = all_frames(rig, anim)
    col = rough = mask = None
    if "nobake" not in FLAGS:
        col, rough, mask = bake(lod0, M, MK, MA, an.v["shaggy"])
    if "debuguv" in FLAGS and col is not None:
        me = lod0.data; uv = me.uv_layers["bake"]; part = attr_np(lod0, "part", np.int32)
        bad = {}
        for p in me.polygons:
            c = sum((Vector(uv.data[li].uv) for li in p.loop_indices), Vector((0, 0))) / len(p.loop_indices)
            x = min(TEX - 1, int(c.x * TEX)); y = min(TEX - 1, int(c.y * TEX))
            if col[y, x].max() < 0.002:
                k = int(part[p.vertices[0]]); bad[k] = bad.get(k, 0) + 1
                if bad[k] < 3: print("BAD", k, [tuple(round(a, 3) for a in uv.data[li].uv) for li in p.loop_indices], p.area)
        print("BADUV", bad, "of", len(me.polygons))
    lod1 = lod0.copy(); lod1.data = lod0.data.copy(); lod1.name = NAME + "_LOD1"; lod1.data.name = lod1.name
    bpy.context.scene.collection.objects.link(lod1)
    dec(lod1, 0.42 * sum(len(p.vertices) - 2 for p in lod0.data.polygons))
    tris = [sum(len(p.vertices) - 2 for p in o.data.polygons) for o in (lod0, lod1)]
    print(f"UNIT {NAME} tris LOD0={tris[0]} LOD1={tris[1]} verts={[len(o.data.vertices) for o in (lod0, lod1)]}")
    for o in (lod0, lod1):
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.select_all(action="DESELECT"); o.select_set(True)
        bpy.ops.object.shade_smooth()
    skins = [skin_weights(o, an, cloth) + (make_drape(o, an, cloth),) for o in (lod0, lod1)]
    if col is not None:
        col_img = save_png(NAME + "_col", col, True)
        rough_img = save_png(NAME + "_rough", np.stack([rough] * 3, -1), False)
        save_png(NAME + "_mask", mask, False)
    if "sheet" in FLAGS:
        if col is not None:
            img = save_png("_sheet_tmp", palette_col(col, mask, 0), True, bpy.app.tempdir)
        else:
            img = bpy.data.images.new("flat", 4, 4); img.pixels.foreach_set(np.full(64, 0.45, np.float32))
        P, N = mesh_PN(lod0)
        only = [f[5:].split(",") for f in FLAGS if f.startswith("only=")]
        pose_sheet(lod0, P, N, skins[0][0], skins[0][1], frames, "side", (1, 0, 0.1), img,
                   clips=only[0] if only else None, drape=skins[0][2])
        pose_sheet(lod0, P, N, skins[0][0], skins[0][1], frames, "front", (0.7, -1, 0.35), img,
                   clips=only[0] if only else None, drape=skins[0][2])
    if col is None:
        return
    bm = baked_material(col_img, rough_img)
    for o in (lod0, lod1):
        o.data.materials.clear(); o.data.materials.append(bm)
    clips, seat, (lo, hi), W, Hh, F = bake_vat([lod0, lod1], skins, frames, table, an.joints["seat"])
    if "booth" in FLAGS:
        tmp = os.environ.get("HG_PREVIEW_DIR", bpy.app.tempdir)
        for ci in ([0, 4, 6] if KIND != "light" else [0, 2, 7]):
            p = os.path.join(tmp, f"{NAME}_{COAT_NAMES[ci].split()[-1]}.glb")
            preview_glb(lod0, col, rough_img, mask, ci, p)
            print("PREVIEW", p)
    set_vid_uv([lod0, lod1])
    nverts = [len(o.data.vertices) for o in (lod0, lod1)]
    path = export([lod0, lod1])
    meta = {"arm": NAME, "family": "horse", "clips": clips, "verts": nverts, "texWidth": W, "texHeight": Hh,
            "frames": F, "bounds": {"min": lo.tolist(), "max": hi.tolist()}, "parts": {},
            "dyes": DYES, "pairedDyes": True, "coats": COAT_NAMES, "neutral": NEUTRAL_LIN, "tris": tris,
            "height": round(an.v["height"], 3),
            "seat": seat, "seatRest": [round(float(x), 4) for x in to_three(an.joints["seat"])],
            "seatFormat": "per clip, per frame: [x, y, z, qx, qy, qz, qw] in the horse's model space "
                          "(three.js axes, metres): the saddle seat point and the saddle's rotation"}
    with open(os.path.join(OUT, f"{NAME}_vat.json"), "w") as fh: json.dump(meta, fh, indent=1)
    update_index()
    print(f"HG_UNIT {path} tris={tris} verts={nverts} frames={F} vat={W}x{Hh}")


main()
