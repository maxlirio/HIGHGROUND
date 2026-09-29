"""Terrain contact sheet: every surface as a 3x3-tiled square under the art-bible sun,
seen from the game camera (55 deg down), labelled with name + tile size.

  blender -b -P tools/terrain_board.py -- [--out assets/booth/terrain_board_A.png] [--family A-vegetated]
                                         [--cols 6] [--cell 420] [--scale true] [names ...]

Every square is shown at the same display size (label gives the real 3x3 extent) unless
--scale true, in which case squares are drawn at true relative world size.
"""
import bpy, sys, os, json, math, glob
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "assets", "src"))
import _terrain_tex as T

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {"--out": os.path.join(T.BOOTH_DIR, "terrain_board_A.png"), "--family": "A-vegetated", "--cols": "6",
       "--cell": "420", "--scale": "false", "--samples": "48"}
names = []
i = 0
while i < len(argv):
    if argv[i] in opt:
        opt[argv[i]] = argv[i + 1]; i += 2
    else:
        names.append(argv[i]); i += 1
if not names:
    for p in sorted(glob.glob(os.path.join(T.OUT_DIR, "*.json"))):
        m = json.load(open(p))
        if opt["--family"] in ("all", m.get("family")):
            names.append(m["name"])
cols = int(opt["--cols"]); cell = int(opt["--cell"])
true_scale = opt["--scale"] == "true"

bpy.ops.wm.read_factory_settings(use_empty=True)
D, GAP, LAB = 10.0, 1.2, 1.6
metas = {n: json.load(open(os.path.join(T.OUT_DIR, n + ".json"))) for n in names}
maxext = max(m["tile_m"] * 3 for m in metas.values())
rows = math.ceil(len(names) / cols)
pitch = 55
for k, n in enumerate(names):
    c, r = k % cols, k // cols
    cx = (c - (cols - 1) / 2) * (D + GAP)
    cy = ((rows - 1) / 2 - r) * (D + GAP + LAB)
    size = D * (metas[n]["tile_m"] * 3 / maxext) if true_scale else D
    ob, meta = T.add_surface_plane(n, size, location=(cx, cy + LAB / 2, 0), repeat=3, subdiv=8)
    cu = bpy.data.curves.new("lab_" + n, "FONT")
    cu.body = f"{n}   {meta['tile_m']:g} m tile ({meta['tile_m'] * 3:g} m shown)"
    cu.size = 0.55; cu.align_x = "CENTER"
    tx = bpy.data.objects.new("lab_" + n, cu); bpy.context.scene.collection.objects.link(tx)
    tx.visible_shadow = False
    tx.location = (cx, cy + LAB / 2 - D / 2 - 0.95, 0.05)
    tx.rotation_euler = (math.radians(90 - pitch), 0, 0)
    em = bpy.data.materials.new("lab"); em.use_nodes = True
    nt = em.node_tree; nt.nodes.remove(nt.nodes["Principled BSDF"])
    e = nt.nodes.new("ShaderNodeEmission"); e.inputs["Color"].default_value = (0.85, 0.85, 0.82, 1)
    e.inputs["Strength"].default_value = 1.0
    nt.links.new(e.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    tx.data.materials.append(em)

# neutral backdrop
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, -0.3))
bd = bpy.context.object
bm = bpy.data.materials.new("bd"); bm.use_nodes = True
bm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.035, 0.035, 0.038, 1)
bd.data.materials.append(bm)

W = cols * (D + GAP)
Hs = rows * (D + GAP + LAB) * math.sin(math.radians(pitch)) + 2
res_x = cols * cell
res_y = int(res_x * Hs / W)
T.setup_rig(res_x, res_y, int(opt["--samples"]))
T.game_camera((0, 0, 0), 300, pitch_deg=pitch, ortho_scale=W + 0.5)
out = opt["--out"]
bpy.context.scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print("HG_BOARD", out, len(names), "surfaces")
