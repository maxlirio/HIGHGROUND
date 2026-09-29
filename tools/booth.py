"""Photo booth: renders a GLB under the game's lighting rig from three cameras.

  blender -b -P tools/booth.py -- assets/glb/<name>.glb [outdir]

Writes <outdir>/<name>_close.png, _34.png, _game.png (outdir defaults to assets/booth).
The "game" view matches the in-game eagle camera: 55 deg pitch, long lens, looking down.
"""
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
glb = argv[0]
outdir = argv[1] if len(argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "assets", "booth")
os.makedirs(outdir, exist_ok=True)
name = os.path.splitext(os.path.basename(glb))[0]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
# LOD meshes are exported as siblings named *_LOD1/_LOD2 — only show LOD0
for o in objs:
    if "_LOD" in o.name and not o.name.endswith("_LOD0"):
        o.hide_render = True
objs = [o for o in objs if not o.hide_render]

lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
center = (lo + hi) / 2
size = max((hi - lo).length, 0.5)

sc = bpy.context.scene
# ground: neutral meadow-ish plane so contact shadows read
bpy.ops.mesh.primitive_plane_add(size=size * 12, location=(center.x, center.y, lo.z))
g = bpy.context.object
gm = bpy.data.materials.new("booth_ground"); gm.use_nodes = True
bsdf = gm.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.20, 0.23, 0.13, 1)
bsdf.inputs["Roughness"].default_value = 0.95
g.data.materials.append(gm)

# lighting rig (Art Bible §Lighting): warm sun 42deg elevation from SW + sky fill
sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 4.0; sun_data.color = (1.0, 0.95, 0.86); sun_data.angle = math.radians(1.5)
sun = bpy.data.objects.new("sun", sun_data); sc.collection.objects.link(sun)
sun.rotation_euler = (math.radians(48), 0, math.radians(-135))
world = bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.55, 0.68, 0.85, 1); bg.inputs["Strength"].default_value = 0.9

sc.render.engine = "CYCLES"
sc.render.threads_mode = "FIXED"; sc.render.threads = 2  # shared machine: stay polite
sc.cycles.device = "GPU"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"; prefs.get_devices()
    for d in prefs.devices: d.use = True
except Exception:
    sc.cycles.device = "CPU"
sc.cycles.samples = 48
sc.cycles.transparent_max_bounces = 128  # alpha-card foliage: >8 clipped layers otherwise shadows black
sc.cycles.use_denoising = True
sc.view_settings.view_transform = "AgX"
sc.render.resolution_x = 1024; sc.render.resolution_y = 768
sc.render.film_transparent = False

cam_data = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cam_data)
sc.collection.objects.link(cam); sc.camera = cam

def shoot(tag, direction, fill, lens, target=center, radius=None):
    """fill = fraction of frame height the bounding sphere should occupy."""
    cam_data.lens = lens
    r = radius or size / 2
    fov = 2 * math.atan(cam_data.sensor_width / 2 / lens) * (sc.render.resolution_y / sc.render.resolution_x)
    dist = r / math.tan(fov / 2) / fill
    d = Vector(direction).normalized()
    cam.location = target + d * dist
    cam_data.clip_start = max(0.01, dist - r * 3); cam_data.clip_end = dist + size * 20
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.join(outdir, f"{name}_{tag}.png")
    bpy.ops.render.render(write_still=True)
    print("BOOTH wrote", sc.render.filepath)

h = hi.z - lo.z
shoot("34", (1, -1.1, 0.75), 0.9, 50)
# close: detail crop on the upper-front third of the object
shoot("close", (0.6, -1, 0.35), 1.0, 50, target=center + Vector((0, -(hi.y - lo.y) * 0.3, h * 0.15)), radius=size / 6)
# game camera: 55deg down, long lens; asset fills ~12% of frame like on the map at mid zoom
shoot("game", (0, -math.cos(math.radians(55)), math.sin(math.radians(55))), 0.12, 135)
