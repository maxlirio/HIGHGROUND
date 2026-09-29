"""Batch photo booth for the castle kit: 3/4, close-up and a mid-zoom game camera per piece, in one Blender.

  tools/heavy.sh /opt/homebrew/bin/blender -t 2 -b -P assets/src/castle/booth_all.py -- <start> <count>

Pieces are taken in sorted order from assets/castle-kit.json. Towers are shown with the door sectors of a
straight run of curtain open. Writes assets/booth/castle/<piece>_{34,close,gamenear}.png.
"""
import bpy, sys, os, math, json
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import castle_booth as B

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
start = int(argv[0]) if argv else 0
count = int(argv[1]) if len(argv) > 1 else 999
kit = json.load(open(os.path.join(B.ROOT, "assets", "castle-kit.json")))["pieces"]
names = sorted(kit)[start:start + count]
for name in names:
    meta = kit[name]
    hide, show = [], []
    if meta.get("sockets"):
        hide = ["upper_2_d*"]
        socks = [s for s in meta["sockets"] if s.get("door")]
        if meta.get("shape") == "square":
            pick = [s for s in socks if s["face"] in ("e", "w") and s["k"] % 3 == 1]
        else:
            pick = [s for s in socks if s["k"] in (1, 10)]
        for s in pick:
            hide.append(s["plain"]); show.append(s["door"])
    sc = B.setup_scene(); sc.cycles.samples = 32
    objs = B.import_glb(os.path.join(B.ROOT, "assets", "glb", meta["file"]), hide=hide, show=show)
    lo, hi = B.bounds(objs)
    center = (lo + hi) / 2; size = (hi - lo).length
    below = meta.get("kind") in ("ditch", "moat", "revetment")
    B.ground(center, max(60, size * 8), z=(lo.z - 0.3) if below else 0.0)
    cam, cd = B.camera()
    h = hi.z - max(lo.z, 0)
    P = lambda v: os.path.join(B.OUT, f"{name}_{v}.png")
    B.shoot(cam, cd, P("34"), center, (1, -1.1, 0.75), B.fit_dist(size / 2, 50, 0.9, cd), 50)
    t = Vector((center.x * 0.5 + lo.x * 0.5 + (hi.x - lo.x) * 0.15, lo.y, lo.z + max(h, 1.0) * 0.62))
    B.shoot(cam, cd, P("close"), t, (0.55, -1, 0.18), max(3.0, min(8.0, size * 0.35)), 35)
    B.shoot(cam, cd, P("gamenear"), center, (0, -math.cos(math.radians(55)), math.sin(math.radians(55))), B.fit_dist(size / 2, 50, 0.55, cd), 50)
