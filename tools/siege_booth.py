"""Pose booth for siege engines: poses the moving-part nodes of a GLB and renders it under the booth rig.

  blender -b -P tools/siege_booth.py -- assets/glb/<name>.glb <tag> [part=deg | part.ty=metres ...] [--out DIR]

Rotations are about each part node's own axis as recorded in assets/glb/<name>_parts.json
(Blender frame; the glTF export maps a Blender +X rotation to a three.js +X rotation).
Writes <out>/<name>_pose_<tag>_{34,side}.png (out defaults to assets/booth).
"""
import bpy, sys, os, math, json
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
glb, tag = argv[0], argv[1]
outdir = os.path.join(os.path.dirname(__file__), "..", "assets", "booth")
poses = {}
i = 2
while i < len(argv):
    if argv[i] == "--out":
        outdir = argv[i + 1]; i += 2; continue
    k, v = argv[i].split("="); poses[k] = float(v); i += 1
os.makedirs(outdir, exist_ok=True)
name = os.path.splitext(os.path.basename(glb))[0]
meta_p = os.path.join(os.path.dirname(glb), name + "_parts.json")
meta = json.load(open(meta_p))["parts"] if os.path.exists(meta_p) else {}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
for pn, deg in poses.items():
    if "." in pn:                      # translation: <part>.tx|ty|tz=<metres>
        nm, ax = pn.split(".")
        o = bpy.data.objects.get(nm)
        if o is not None:
            o.location["xyz".index(ax[-1])] += deg
        continue
    o = bpy.data.objects.get(pn)
    if o is None:
        print("SIEGE_BOOTH no node", pn); continue
    ax = meta.get(pn, {}).get("axis", "X")
    o.rotation_mode = "XYZ"
    idx = "XYZ".index(ax[-1])
    sgn = -1 if ax.startswith("-") else 1
    e = o.rotation_euler.copy(); e[idx] += sgn * math.radians(deg); o.rotation_euler = e
bpy.context.view_layer.update()

objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for o in objs:
    if "_LOD" in o.name and not o.name.endswith("_LOD0"):
        o.hide_render = True
objs = [o for o in objs if not o.hide_render]
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
lo.z = min(lo.z, 0.0)
center = (lo + hi) / 2
size = max((hi - lo).length, 0.5)
sc = bpy.context.scene
bpy.ops.mesh.primitive_plane_add(size=size * 12, location=(center.x, center.y, 0.0))
g = bpy.context.object
gm = bpy.data.materials.new("booth_ground"); gm.use_nodes = True
bs = gm.node_tree.nodes["Principled BSDF"]
bs.inputs["Base Color"].default_value = (0.20, 0.23, 0.13, 1); bs.inputs["Roughness"].default_value = 0.95
g.data.materials.append(gm)
sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 4.0; sun_data.color = (1.0, 0.95, 0.86); sun_data.angle = math.radians(1.5)
sun = bpy.data.objects.new("sun", sun_data); sc.collection.objects.link(sun)
sun.rotation_euler = (math.radians(48), 0, math.radians(-135))
world = bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.55, 0.68, 0.85, 1); bg.inputs["Strength"].default_value = 0.9
sc.render.engine = "CYCLES"
sc.render.threads_mode = "FIXED"; sc.render.threads = 2
sc.cycles.device = "GPU"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"; prefs.get_devices()
    for d in prefs.devices: d.use = True
except Exception:
    sc.cycles.device = "CPU"
sc.cycles.samples = 32
sc.cycles.use_denoising = True
sc.view_settings.view_transform = "AgX"
sc.render.resolution_x = 1024; sc.render.resolution_y = 768
cam_data = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cam_data)
sc.collection.objects.link(cam); sc.camera = cam


def shoot(t, direction, fill, lens):
    cam_data.lens = lens
    r = size / 2
    fov = 2 * math.atan(cam_data.sensor_width / 2 / lens) * (sc.render.resolution_y / sc.render.resolution_x)
    dist = r / math.tan(fov / 2) / fill
    d = Vector(direction).normalized()
    cam.location = center + d * dist
    cam_data.clip_start = max(0.01, dist - r * 3); cam_data.clip_end = dist + size * 20
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.join(outdir, f"{name}_pose_{tag}_{t}.png")
    bpy.ops.render.render(write_still=True)
    print("SIEGE_BOOTH wrote", sc.render.filepath)


shoot("34", (1, -1.1, 0.75), 0.9, 50)
shoot("side", (1, 0, 0.12), 0.95, 50)
