"""Close-up check for terrain surfaces: each surface on a 2 x 2 m patch (true scale, real
displacement) seen from 1.8 m away at 40 deg, 6 per sheet, labelled.
  blender -b -P tools/terrain_closeups_B.py -- [--family B-mineral] [--per 6] [names...]
-> assets/booth/terrain_close_B_<k>.png"""
import bpy, sys, os, json, math, glob
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "assets", "src"))
import _terrain_tex as T

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
fam, per, names, i = "B-mineral", 6, [], 0
while i < len(argv):
    if argv[i] == "--family": fam = argv[i + 1]; i += 2
    elif argv[i] == "--per": per = int(argv[i + 1]); i += 2
    else: names.append(argv[i]); i += 1
if not names:
    names = [json.load(open(p))["name"] for p in sorted(glob.glob(os.path.join(T.OUT_DIR, "*.json")))
             if json.load(open(p)).get("family") == fam]
CELL, PATCH = 480, 2.0
tmp = os.path.join(os.environ.get("TMPDIR", "/tmp"), "hg_close_B"); os.makedirs(tmp, exist_ok=True)


def render_one(n):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    meta = json.load(open(os.path.join(T.OUT_DIR, n + ".json")))
    rep = 12.0 / meta["tile_m"]  # 12 m plane at true scale
    ob, _ = T.add_surface_plane(n, 12.0, repeat=rep, subdiv=10)
    for m in ob.modifiers:
        if m.type == "DISPLACE":
            m.strength = meta["height_range_m"]
    T.setup_rig(CELL, CELL, 64)
    T.game_camera((0, 0, 0), 1.8, lens=35, pitch_deg=40)
    cu = bpy.data.curves.new("lab", "FONT"); cu.body = f"{n} (close, ~2 m)"; cu.size = 0.06
    tx = bpy.data.objects.new("lab", cu); bpy.context.scene.collection.objects.link(tx)
    cam = bpy.context.scene.camera; tx.parent = cam; tx.location = (-0.3, -0.3, -1.0)
    em = bpy.data.materials.new("e"); em.use_nodes = True; nt = em.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"]); e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (1, 1, 0.9, 1); e.inputs["Strength"].default_value = 3
    nt.links.new(e.outputs[0], nt.nodes["Material Output"].inputs["Surface"]); tx.data.materials.append(em)
    p = os.path.join(tmp, n + ".png")
    bpy.context.scene.render.filepath = p
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(p); a = np.array(im.pixels[:], np.float32).reshape(CELL, CELL, 4)
    return a


for s in range(0, len(names), per):
    grp = names[s:s + per]
    cols = 3; rows = math.ceil(len(grp) / cols)
    sheet = np.zeros((rows * CELL, cols * CELL, 4), np.float32); sheet[..., 3] = 1
    for k, n in enumerate(grp):
        a = render_one(n)
        r, c = k // cols, k % cols
        y0 = (rows - 1 - r) * CELL  # bpy pixel rows are bottom-up
        sheet[y0:y0 + CELL, c * CELL:(c + 1) * CELL] = a
    out = os.path.join(T.BOOTH_DIR, f"terrain_close_B_{s // per + 1}.png")
    img = bpy.data.images.new("sheet", cols * CELL, rows * CELL, alpha=True)
    img.pixels.foreach_set(sheet.ravel()); img.filepath_raw = out; img.file_format = "PNG"; img.save()
    print("HG_CLOSE", out, grp)
