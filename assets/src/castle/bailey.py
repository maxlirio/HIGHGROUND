"""Bailey buildings: great hall, chapel, kitchen, stables and the well.

    tools/heavy.sh /opt/homebrew/bin/blender -t 2 -b -P assets/src/castle/bailey.py -- [hall chapel kitchen stable well]

LOCAL FRAME = the sim's rect frame (js/sim/castle.js: a along rot = x, b = y), origin at the centre, ground z=0.
Nominal footprints (sim layouts vary by a few metres: scale x,y to the part's w,d): hall 18 x 9, chapel 12 x 7,
kitchen 9 x 7, stable 15 x 6; well r 1.2. Every building's roof (and gable tops, trusses) is the node 'roof' so the
renderer can lift it to look in; everything else is 'base'. Doors face -y unless noted.
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import _castle as L
import _damage as D
from _dims import *

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def stone_box(sol, w, d, h, th, key="rubble", inner="plaster", res=0.9, found=-1.2):
    hw, hd = w / 2, d / 2
    sol.box(-hw, hw, -hd, -hd + th, found, h, key, res=res, keys={"+y": inner, "+z": "ashlar"})
    sol.box(-hw, hw, hd - th, hd, found, h, key, res=res, keys={"-y": inner, "+z": "ashlar"})
    sol.box(-hw, -hw + th, -hd + th, hd - th, found, h, key, res=res, keys={"+x": inner, "+z": "ashlar"})
    sol.box(hw - th, hw, -hd + th, hd - th, found, h, key, res=res, keys={"-x": inner, "+z": "ashlar"})


def gable(sol, x, y0, y1, z0, z1, th, key="rubble", inner="plaster", outward=1):
    """Triangular gable wall in the y-z plane at x (thickness along x)."""
    prof = [(y0, z0), (y1, z0), ((y0 + y1) / 2, z1)]
    xa, xb = (x - th, x) if outward > 0 else (x, x + th)
    s = L.Solid("gable")
    s.extrude(prof, (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), xa, xb, key)
    for f in s.bm.faces:
        pass
    sol.merge(L._welded(s))


def roof(sol, x0, x1, y0, y1, z_eave, z_ridge, key="slate", over=0.5, gable_over=0.35, thick=0.2):
    L.gable_roof(sol, x0, x1, y0, y1, z_eave, z_ridge, key=key, over=over, thick=thick, gable_over=gable_over, fascia_key="timber")
    # ridge tiles/roll
    s = L.Solid("ridge")
    ring = [(0.12 * math.cos(2 * math.pi * i / 8), 0.12 * math.sin(2 * math.pi * i / 8)) for i in range(8)]
    s.extrude(ring, (x0 - gable_over, (y0 + y1) / 2, z_ridge + 0.02), (0, 1, 0), (0, 0, 1), (1, 0, 0), 0, (x1 - x0) + 2 * gable_over, "lead" if key != "shingle" else "timber")
    sol.merge(L._welded(s))


def trusses(sol, xs, y0, y1, z_eave, z_ridge, w=0.25):
    """Arch-braced collar trusses (seen when the roof is lifted? no - they lift with it; seen from inside)."""
    cy = (y0 + y1) / 2
    for x in xs:
        for s in (-1, 1):
            ye = cy + s * (cy - y0)
            # principal rafter as a sloped box: extrude a thin quad profile in y-z
            prof = [(ye, z_eave - 0.2), (ye - s * 0.25, z_eave - 0.2), (cy, z_ridge - 0.35), (cy, z_ridge - 0.1)]
            t = L.Solid("raf"); t.extrude(prof, (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), x - w / 2, x + w / 2, "timber")
            sol.merge(L._welded(t))
        zc = z_eave + (z_ridge - z_eave) * 0.62
        half = (cy - y0) * (1 - 0.62) + 0.1
        sol.box(x - w / 2, x + w / 2, cy - half, cy + half, zc - 0.12, zc + 0.12, "timber", res=9)


def benches(sol, x0, x1, y, z=0.0):
    sol.box(x0, x1, y - 0.45, y + 0.45, z + 0.72, z + 0.8, "timber", res=2)
    for yy in (y - 0.9, y + 0.9):
        sol.box(x0, x1, yy - 0.17, yy + 0.17, z + 0.42, z + 0.48, "timber", res=2)
    for x in (x0 + 0.3, (x0 + x1) / 2, x1 - 0.3):
        sol.box(x - 0.07, x + 0.07, y - 0.35, y + 0.35, z, z + 0.72, "timber", res=9)


def hall():
    L.reset(201); rng = random.Random(201)
    W, Dd, H, TH = 18.0, 9.0, 7.0, 1.2
    hw, hd = W / 2, Dd / 2
    base, rf = [], []
    s = L.Solid("walls")
    stone_box(s, W, Dd, H, TH, key="ashlar")
    # buttresses between the bays (4 bays) on both long sides
    for x in (-4.5, 0.0, 4.5):
        for sy in (-1, 1):
            y0, y1 = sorted((sy * hd, sy * (hd + 0.7)))
            s.prism([(x - 0.5, y0), (x + 0.5, y0), (x + 0.5, y1), (x - 0.5, y1)], -1.2, H - 0.6, "ashlar",
                    top=lambda X, Y, sy=sy: H - 0.6 - abs(Y - sy * hd) * 1.2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x0, x1 = sorted((sx * hw, sx * (hw + 0.6))); y0, y1 = sorted((sy * (hd - 0.6), sy * (hd + 0.6)))
            s.box(x0, x1, y0, y1, -1.2, H - 1.0, "ashlar", res=9)
    walls = s.to_object()
    cuts = []
    # tall two-light transomed windows: bays on both sides (not the porch bay)
    for x in (-6.75, -2.25, 2.25, 6.75):
        for sy in (-1, 1):
            if sy < 0 and x < -6:
                continue
            for dx in (-0.35, 0.35):
                cuts.append(L.opening_cutter((x + dx, sy * hd), (1, 0), (0, -sy), 0.5, 2.6, -0.3, 0.6, kind="pointed", z0=2.6))
            cuts.append(L.opening_cutter((x, sy * hd), (1, 0), (0, -sy), 1.9, 2.9, 0.5, TH + 0.4, kind="pointed", z0=2.3, key="plaster"))
    # the door (through a porch on the -y side, west bay), service doors at the west gable to the kitchen
    cuts.append(L.opening_cutter((-6.75, -hd), (1, 0), (0, 1), 1.5, 2.3, -1.0, TH + 0.5, kind="pointed"))
    cuts.append(L.opening_cutter((-hw, -1.5), (0, 1), (1, 0), 1.1, 2.0, -0.5, TH + 0.5, kind="pointed"))
    cuts.append(L.opening_cutter((-hw, 1.5), (0, 1), (1, 0), 1.1, 2.0, -0.5, TH + 0.5, kind="pointed"))
    # a great window in the east gable over the dais
    for dy in (-0.8, 0.0, 0.8):
        cuts.append(L.opening_cutter((hw, dy), (0, 1), (-1, 0), 0.55, 3.2, -0.3, 0.6, kind="pointed", z0=3.0))
    cuts.append(L.opening_cutter((hw, 0.0), (0, 1), (-1, 0), 3.0, 3.4, 0.5, TH + 0.4, kind="pointed", z0=2.7, key="plaster"))
    L.cut(walls, cuts)
    base.append(walls)
    # porch
    p = L.Solid("porch")
    p.box(-8.3, -5.2, -hd - 3.0, -hd, -1.2, 4.2, "ashlar", res=0.9)
    po = p.to_object()
    L.cut(po, [L.box_cutter(-7.7, -5.8, -hd - 2.4, -hd + 0.1, 0.0, 3.2, key="plaster"),
               L.opening_cutter((-6.75, -hd - 3.0), (1, 0), (0, 1), 1.6, 2.2, -0.5, 1.0, kind="pointed")])
    base.append(po)
    pr = L.Solid("porchroof")
    L.gable_roof(pr, -8.3, -5.2, -hd - 3.2, -hd + 0.2, 4.2, 5.8, key="slate", over=0.3, ridge_axis="y", fascia_key="timber")
    pgf = L.Solid("porchgable")
    pgf.extrude([(-8.3, 4.2), (-5.2, 4.2), (-6.75, 5.75)], (0, -hd - 3.0, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0, 0.6, "ashlar")
    pr.merge(L._welded(pgf))
    # floor, hearth, dais, tables
    fl = L.Solid("floor")
    fl.box(-hw + TH, hw - TH, -hd + TH, hd - TH, -0.3, 0.02, "paving", res=1.2, skip=("-z",))
    fl.box(hw - TH - 2.8, hw - TH, -hd + TH, hd - TH, 0.02, 0.35, "planks", res=1.2)
    fl.box(-0.9, 0.9, -0.7, 0.7, 0.02, 0.12, "ashlar", res=9)
    fl.box(-0.8, 0.8, -0.6, 0.6, 0.12, 0.14, "dark", res=9)
    benches(fl, -6.0, 3.8, -2.2)
    benches(fl, -6.0, 3.8, 2.2)
    fl.box(hw - TH - 2.4, hw - TH - 1.6, -2.8, 2.8, 1.07, 1.15, "timber", res=2)
    fl.box(hw - TH - 2.4, hw - TH - 1.6, -2.8, 2.8, 0.35, 1.07, "planks", res=2)
    # the screens passage: a timber screen across the west end
    fl.box(-hw + TH + 2.2, -hw + TH + 2.35, -hd + TH, -1.0, 0.0, 3.2, "planks", res=1.2)
    fl.box(-hw + TH + 2.2, -hw + TH + 2.35, 1.0, hd - TH, 0.0, 3.2, "planks", res=1.2)
    base.append(fl.to_object())
    # roof: steep slate, gables, trusses, a louvre over the hearth
    r = L.Solid("roof")
    zr = H + 5.8
    roof(r, -hw, hw, -hd, hd, H, zr, key="slate")
    for sx in (-1, 1):
        g = L.Solid("gable")
        g.extrude([(-hd, H), (hd, H), (0, zr + 0.25)], (sx * hw if sx < 0 else hw - TH, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), 0, TH, "ashlar")
        r.merge(L._welded(g))
        # gable coping + a finial
        r.box(sx * hw - 0.3 if sx > 0 else -hw - 0.1, sx * hw + 0.1 if sx > 0 else -hw + 0.3, -0.3, 0.3, zr + 0.1, zr + 1.1, "ashlar", res=9)
    trusses(r, (-6.75, -2.25, 2.25, 6.75), -hd + TH, hd - TH, H, zr)
    lv = L.Solid("louvre")
    lv.box(-0.9, 0.9, -0.9, 0.9, zr - 0.5, zr + 0.9, "planks", res=9)
    L.gable_roof(lv, -0.9, 0.9, -0.9, 0.9, zr + 0.9, zr + 1.7, key="lead", over=0.25, fascia_key="timber")
    r.merge(L._welded(lv))
    rf.append(r.to_object()); rf.append(pr.to_object())
    meta = {"kind": "hall", "w": W, "d": Dd, "eave": H, "ridge": zr,
            "frame": "sim rect frame (x = a along rot, y = b); scale x,y to the part's w,d; door (porch) on -y at the west bay",
            "walks": [{"id": "floor", "lvl": 0, "z": 0.0, "kind": "poly", "poly": [[-hw + TH, -hd + TH], [hw - TH, -hd + TH], [hw - TH, hd - TH], [-hw + TH, hd - TH]]}],
            "doors": [{"id": "porch", "p_out": L.V3((-6.75, -hd - 3.6, 0)), "p_in": L.V3((-6.75, -hd + TH + 0.6, 0)), "width": 1.5},
                      {"id": "service_s", "p_out": L.V3((-hw - 0.8, -1.5, 0)), "p_in": L.V3((-hw + TH + 0.6, -1.5, 0)), "width": 1.0},
                      {"id": "service_n", "p_out": L.V3((-hw - 0.8, 1.5, 0)), "p_in": L.V3((-hw + TH + 0.6, 1.5, 0)), "width": 1.0}],
            "links": [], "cutaway": "hide 'roof' to look in",
            "bbox": [[-hw - 0.9, -hd - 3.2, -1.2], [hw + 0.9, hd + 0.9, zr + 1.7]]}
    L.finish_piece("hall", {"base": base, "roof": rf}, {}, meta=meta, lods=(1.0, 0.45), soot=[(0, 0, zr - 1.0, 0.8, 1.5)], grime_h=1.2)


def chapel():
    L.reset(211); rng = random.Random(211)
    W, Dd, H, TH = 12.0, 7.0, 6.2, 1.0
    hw, hd = W / 2, Dd / 2
    s = L.Solid("walls")
    stone_box(s, W, Dd, H, TH, key="ashlar")
    for x in (-2.0, 2.0):
        for sy in (-1, 1):
            y0, y1 = sorted((sy * hd, sy * (hd + 0.6)))
            s.prism([(x - 0.4, y0), (x + 0.4, y0), (x + 0.4, y1), (x - 0.4, y1)], -1.2, H - 0.8, "ashlar", top=lambda X, Y, sy=sy: H - 0.8 - abs(Y - sy * hd) * 1.3)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x0, x1 = sorted((sx * hw, sx * (hw + 0.6))); y0, y1 = sorted((sy * (hd - 0.5), sy * (hd + 0.5)))
            s.box(x0, x1, y0, y1, -1.2, H - 1.2, "ashlar", res=9)
    walls = s.to_object()
    cuts = []
    for x in (-4.0, 0.0, 4.0):
        for sy in (-1, 1):
            cuts.append(L.opening_cutter((x, sy * hd), (1, 0), (0, -sy), 0.42, 2.4, -0.3, 0.45, kind="pointed", z0=2.4))
            cuts.append(L.opening_cutter((x, sy * hd), (1, 0), (0, -sy), 1.3, 2.7, 0.4, TH + 0.4, kind="pointed", z0=2.1, key="plaster"))
    # east: a three-light lancet group; west: the door, a small window above
    for dy, hh in ((-0.9, 2.8), (0.0, 3.4), (0.9, 2.8)):
        cuts.append(L.opening_cutter((hw, dy), (0, 1), (-1, 0), 0.45, hh, -0.3, 0.45, kind="pointed", z0=2.2))
    cuts.append(L.opening_cutter((hw, 0.0), (0, 1), (-1, 0), 3.0, 3.6, 0.4, TH + 0.4, kind="pointed", z0=2.0, key="plaster"))
    cuts.append(L.opening_cutter((-hw, 0.0), (0, 1), (1, 0), 1.4, 2.4, -0.5, TH + 0.5, kind="pointed"))
    cuts.append(L.opening_cutter((-hw, 0.0), (0, 1), (1, 0), 0.4, 1.0, -0.5, TH + 0.5, kind="pointed", z0=4.6))
    L.cut(walls, cuts)
    fl = L.Solid("floor")
    fl.box(-hw + TH, hw - TH, -hd + TH, hd - TH, -0.3, 0.02, "paving", res=1.2, skip=("-z",))
    fl.box(hw - TH - 2.6, hw - TH, -hd + TH, hd - TH, 0.02, 0.32, "paving", res=1.2)          # sanctuary step
    fl.box(hw - TH - 1.2, hw - TH - 0.2, -1.1, 1.1, 0.32, 1.35, "ashlar", res=9)               # altar
    fl.box(hw - TH - 1.3, hw - TH - 0.1, -1.2, 1.2, 1.35, 1.45, "ashlar", res=9)
    L.lathe(fl, -hw + TH + 1.3, -hd + TH + 1.0, [(0, 0.02), (0.35, 0.02), (0.25, 0.2), (0.25, 0.8), (0.45, 0.9), (0.45, 1.1), (0.0, 1.1)], "ashlar", segs=12)  # font
    base = [walls, fl.to_object()]
    r = L.Solid("roof")
    zr = H + 4.4
    roof(r, -hw, hw, -hd, hd, H, zr, key="slate")
    for sx in (-1, 1):
        g = L.Solid("gable")
        g.extrude([(-hd, H), (hd, H), (0, zr + 0.25)], (-hw if sx < 0 else hw - TH, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), 0, TH, "ashlar")
        r.merge(L._welded(g))
    # bellcote on the west gable: two piers and a gabled cap with a bell
    for dy in (-0.55, 0.55):
        r.box(-hw - 0.05, -hw + 0.75, dy - 0.2, dy + 0.2, zr - 0.2, zr + 1.6, "ashlar", res=9)
    bc = L.Solid("bc")
    L.gable_roof(bc, -hw - 0.1, -hw + 0.8, -0.85, 0.85, zr + 1.6, zr + 2.2, key="slate", over=0.1, ridge_axis="y", fascia_key="ashlar")
    L.lathe(bc, -hw + 0.35, 0.0, [(0.0, zr + 0.75), (0.26, zr + 0.75), (0.2, zr + 1.1), (0.1, zr + 1.3), (0.0, zr + 1.3)], "iron", segs=10)
    r.merge(L._welded(bc))
    r.box(hw - 0.3, hw + 0.1, -0.08, 0.08, zr + 0.1, zr + 1.1, "ashlar", res=9)       # east cross
    r.box(hw - 0.3, hw + 0.1, -0.35, 0.35, zr + 0.62, zr + 0.78, "ashlar", res=9)
    trusses(r, (-3.0, 0.0, 3.0), -hd + TH, hd - TH, H, zr)
    meta = {"kind": "chapel", "w": W, "d": Dd, "eave": H, "ridge": zr, "frame": "sim rect frame; altar at +x (east), door at -x",
            "walks": [{"id": "floor", "lvl": 0, "z": 0.0, "kind": "poly", "poly": [[-hw + TH, -hd + TH], [hw - TH, -hd + TH], [hw - TH, hd - TH], [-hw + TH, hd - TH]]}],
            "doors": [{"id": "west", "p_out": L.V3((-hw - 0.8, 0, 0)), "p_in": L.V3((-hw + TH + 0.6, 0, 0)), "width": 1.4}],
            "links": [], "cutaway": "hide 'roof' to look in", "bbox": [[-hw - 0.7, -hd - 0.7, -1.2], [hw + 0.7, hd + 0.7, zr + 2.2]]}
    L.finish_piece("chapel", {"base": base, "roof": [r.to_object()]}, {}, meta=meta, lods=(1.0, 0.45), grime_h=1.2)


def kitchen():
    L.reset(221); rng = random.Random(221)
    W, Dd, H, TH = 9.0, 7.0, 5.0, 1.1
    hw, hd = W / 2, Dd / 2
    s = L.Solid("walls")
    stone_box(s, W, Dd, H, TH, key="rubble", inner="rubble")
    # two great fireplaces in the end walls, their chimney breasts outside
    for sx in (-1, 1):
        x0, x1 = sorted((sx * hw, sx * (hw + 0.9)))
        s.box(x0, x1, -1.6, 1.6, -1.2, H + 0.5, "rubble", res=0.9)
    walls = s.to_object()
    cuts = []
    for sx in (-1, 1):
        x0, x1 = sorted((sx * (hw - TH - 0.1), sx * (hw + 0.5)))
        cuts.append(L.box_cutter(x0, x1, -1.2, 1.2, 0.0, 2.2, key="dark"))
    cuts.append(L.opening_cutter((1.5, -hd), (1, 0), (0, 1), 1.2, 2.0, -0.5, TH + 0.5, kind="pointed"))
    cuts.append(L.opening_cutter((-1.5, hd), (1, 0), (0, -1), 1.1, 1.9, -0.5, TH + 0.5, kind="pointed"))
    for x in (-2.2, 2.2):
        cuts.append(L.opening_cutter((x, hd), (1, 0), (0, -1), 0.35, 1.0, -0.3, TH + 0.4, kind="round", z0=2.5))
    cuts.append(L.opening_cutter((-2.0, -hd), (1, 0), (0, 1), 0.35, 1.0, -0.3, TH + 0.4, kind="round", z0=2.5))
    L.cut(walls, cuts)
    fl = L.Solid("floor")
    fl.box(-hw + TH, hw - TH, -hd + TH, hd - TH, -0.3, 0.02, "paving", res=1.2, skip=("-z",))
    fl.box(-1.8, 1.8, -0.6, 0.6, 0.85, 0.95, "timber", res=2)
    for x in (-1.6, 1.6):
        for y in (-0.5, 0.5):
            fl.box(x - 0.07, x + 0.07, y - 0.07, y + 0.07, 0.0, 0.85, "timber", res=9)
    for sx in (-1, 1):
        L.lathe(fl, sx * (hw - TH - 0.6), 0.0, [(0.0, 0.25), (0.42, 0.3), (0.5, 0.6), (0.46, 0.85), (0.0, 0.85)], "iron", segs=14)
        fl.box(sx * (hw - TH - 0.6) - 0.05, sx * (hw - TH - 0.6) + 0.05, -0.05, 0.05, 0.85, 2.1, "iron", res=9)
    base = [walls, fl.to_object()]
    r = L.Solid("roof")
    zr = H + 3.8
    roof(r, -hw, hw, -hd, hd, H, zr, key="slate")
    for sx in (-1, 1):
        g = L.Solid("gable")
        g.extrude([(-hd, H), (hd, H), (0, zr + 0.25)], (-hw if sx < 0 else hw - TH, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), 0, TH, "rubble")
        r.merge(L._welded(g))
        # chimney stacks
        x0, x1 = sorted((sx * (hw - 0.3), sx * (hw + 0.9)))
        r.box(x0, x1, -0.7, 0.7, H + 0.5, zr + 1.4, "rubble", res=0.9)
        r.box(x0 - 0.08, x1 + 0.08, -0.78, 0.78, zr + 1.4, zr + 1.6, "ashlar", res=9)
    lv = L.Solid("louvre")
    lv.box(-0.8, 0.8, -0.8, 0.8, zr - 0.4, zr + 0.7, "planks", res=9)
    L.gable_roof(lv, -0.8, 0.8, -0.8, 0.8, zr + 0.7, zr + 1.4, key="lead", over=0.2, fascia_key="timber")
    r.merge(L._welded(lv))
    trusses(r, (-1.5, 1.5), -hd + TH, hd - TH, H, zr)
    soot = [(sx * (hw - TH - 0.2), 0.0, 1.8, 1.4, 3.5) for sx in (-1, 1)] + [(sx * (hw + 0.3), 0.0, zr + 1.0, 0.8, 1.0) for sx in (-1, 1)]
    meta = {"kind": "kitchen", "w": W, "d": Dd, "eave": H, "ridge": zr, "frame": "sim rect frame; doors on -y and +y",
            "walks": [{"id": "floor", "lvl": 0, "z": 0.0, "kind": "poly", "poly": [[-hw + TH, -hd + TH], [hw - TH, -hd + TH], [hw - TH, hd - TH], [-hw + TH, hd - TH]]}],
            "doors": [{"id": "s", "p_out": L.V3((1.5, -hd - 0.8, 0)), "p_in": L.V3((1.5, -hd + TH + 0.6, 0)), "width": 1.2},
                      {"id": "n", "p_out": L.V3((-1.5, hd + 0.8, 0)), "p_in": L.V3((-1.5, hd - TH - 0.6, 0)), "width": 1.1}],
            "links": [], "cutaway": "hide 'roof' to look in", "bbox": [[-hw - 1.0, -hd - 0.6, -1.2], [hw + 1.0, hd + 0.6, zr + 1.6]]}
    L.finish_piece("kitchen", {"base": base, "roof": [r.to_object()]}, {}, meta=meta, lods=(1.0, 0.45), soot=soot, grime_h=1.2)


def stable():
    """Timber-framed range on a stone sill wall, open stalls behind wide doors, oak shingle roof, hay loft."""
    L.reset(231); rng = random.Random(231)
    W, Dd, H = 15.0, 6.0, 3.6
    hw, hd = W / 2, Dd / 2
    s = L.Solid("frame")
    # sill wall
    for (x0, x1, y0, y1) in ((-hw, hw, -hd, -hd + 0.5), (-hw, hw, hd - 0.5, hd), (-hw, -hw + 0.5, -hd + 0.5, hd - 0.5), (hw - 0.5, hw, -hd + 0.5, hd - 0.5)):
        s.box(x0, x1, y0, y1, -0.6, 0.55, "rubble", res=0.9)
    bays = [-hw + 0.25 + i * (W - 0.5) / 5 for i in range(6)]
    for x in bays:
        for y in (-hd + 0.25, hd - 0.25):
            s.box(x - 0.14, x + 0.14, y - 0.14, y + 0.14, 0.55, H, "timber", res=9)
    for y in (-hd + 0.25, hd - 0.25):
        s.box(-hw, hw, y - 0.15, y + 0.15, 0.55, 0.8, "timber", res=2)          # sole plate
        s.box(-hw, hw, y - 0.16, y + 0.16, H - 0.25, H, "timber", res=2)        # wall plate
        s.box(-hw, hw, y - 0.12, y + 0.12, 1.9, 2.1, "timber", res=2)           # mid rail
    for x in (-hw + 0.25, hw - 0.25):
        s.box(x - 0.15, x + 0.15, -hd, hd, 0.55, 0.8, "timber", res=2)
        s.box(x - 0.15, x + 0.15, -hd, hd, H - 0.25, H, "timber", res=2)
        s.box(x - 0.14, x + 0.14, -0.14, 0.14, 0.55, H, "timber", res=9)
    # braces (diagonal) in the end bays
    # infill panels: wattle and daub (plaster), set back; the front (-y) is open between posts 2..4 behind doors
    for i in range(5):
        xa, xb = bays[i] + 0.14, bays[i + 1] - 0.14
        for y, face in ((hd - 0.25, 1), (-hd + 0.25, -1)):
            if face < 0 and i in (1, 2, 3):
                continue
            for (z0, z1) in ((0.8, 1.9), (2.1, H - 0.25)):
                s.box(xa, xb, y - 0.06, y + 0.06, z0, z1, "plaster", res=1.2)
    for x in (-hw + 0.25, hw - 0.25):
        for (y0, y1) in ((-hd + 0.39, -0.14), (0.14, hd - 0.39)):
            for (z0, z1) in ((0.8, 1.9), (2.1, H - 0.25)):
                s.box(x - 0.06, x + 0.06, y0, y1, z0, z1, "plaster", res=1.2)
    # stalls: partitions, mangers along the back wall, straw
    for i in range(1, 9):
        x = -hw + i * W / 9
        s.box(x - 0.05, x + 0.05, 0.6, hd - 0.5, 0.0, 1.5, "planks", res=1.2)
        s.box(x - 0.07, x + 0.07, 0.5, 0.64, 0.0, 1.7, "timber", res=9)
    s.box(-hw + 0.5, hw - 0.5, hd - 1.0, hd - 0.5, 0.6, 1.1, "planks", res=1.2)
    s.box(-hw + 0.5, hw - 0.5, -hd + 0.5, hd - 0.5, -0.3, 0.03, "debris", res=1.2, skip=("-z",))
    # hay loft floor
    s.box(-hw + 0.4, hw - 0.4, 0.4, hd - 0.4, H - 0.4, H - 0.28, "planks", res=1.2)
    base_o = s.to_object()
    # the stable doors (moving: three pairs along the front)
    moving = {}
    for i in (1, 2, 3):
        xa, xb = bays[i] + 0.14, bays[i + 1] - 0.14
        for side, (x0, x1, piv) in (("l", (xa, (xa + xb) / 2 - 0.01, xa)), ("r", ((xa + xb) / 2 + 0.01, xb, xb))):
            d = L.Solid(f"door{i}{side}")
            d.box(x0, x1, -hd + 0.12, -hd + 0.2, 0.62, H - 0.3, "planks", res=1.2)
            d.box(x0, x1, -hd + 0.06, -hd + 0.12, 1.2, 1.32, "timber", res=9)
            d.box(x0, x1, -hd + 0.06, -hd + 0.12, H - 1.2, H - 1.08, "timber", res=9)
            moving[f"door_{i}{side}"] = ([d.to_object()], (piv, -hd + 0.16, 0.0))
    r = L.Solid("roof")
    zr = H + 3.4
    roof(r, -hw, hw, -hd, hd, H, zr, key="shingle", over=0.7)
    for sx in (-1, 1):
        # boarded gables
        g = L.Solid("g")
        g.extrude([(-hd, H), (hd, H), (0, zr)], (sx * (hw - 0.25) - 0.06, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), 0, 0.12, "planks")
        r.merge(L._welded(g))
    for x in bays:
        trusses(r, (x,), -hd + 0.25, hd - 0.25, H, zr, w=0.2)
    hay = L.Solid("hay")
    for i in range(6):
        L.chunk(hay, (rng.uniform(-hw + 1, hw - 1), rng.uniform(1.0, hd - 0.8), H - 0.1), (1.6, 1.1, 0.9), rng, "debris", tilt=0.1)
    meta = {"kind": "stable", "w": W, "d": Dd, "eave": H, "ridge": zr, "frame": "sim rect frame; open stalls behind three pairs of doors on -y",
            "walks": [{"id": "floor", "lvl": 0, "z": 0.0, "kind": "poly", "poly": [[-hw + 0.5, -hd + 0.5], [hw - 0.5, -hd + 0.5], [hw - 0.5, hd - 0.5], [-hw + 0.5, hd - 0.5]]}],
            "doors": [{"id": f"bay{i}", "p_out": L.V3(((bays[i] + bays[i + 1]) / 2, -hd - 0.8, 0)), "p_in": L.V3(((bays[i] + bays[i + 1]) / 2, -hd + 0.8, 0)), "width": 2.0,
                       "leaves": [f"door_{i}l", f"door_{i}r"], "open_deg_z": {"l": -100, "r": 100}} for i in (1, 2, 3)],
            "links": [], "cutaway": "hide 'roof' to look in", "bbox": [[-hw - 0.4, -hd - 0.9, -0.6], [hw + 0.4, hd + 0.9, zr + 0.2]]}
    L.finish_piece("stable", {"base": [base_o, hay.to_object()], "roof": [r.to_object()]}, moving, meta=meta, lods=(1.0, 0.45), grime_h=0.8)


def well():
    L.reset(241); rng = random.Random(241)
    s = L.Solid("well", uv="cyl", uvc=(0, 0, 1.2))
    L.lathe(s, 0, 0, [(0.78, -3.0), (1.2, -3.0), (1.2, 0.72), (1.25, 0.72), (1.25, 0.86), (0.75, 0.86), (0.75, 0.72), (0.78, 0.72)], "ashlar", segs=28,
            inner_key="rubble", cap_key="ashlar")
    s.disc(0, 0, 0.8, -2.0, "water", segs=20, rings=2)
    # paving apron
    s.disc(0, 0, 2.2, 0.03, "paving", segs=28, rings=3, hole=(0, 0, 1.2))
    for sx in (-1, 1):
        s.box(sx * 1.0 - 0.1, sx * 1.0 + 0.1, -0.1, 0.1, 0.86, 2.6, "timber", res=9)
    ax = L.Solid("axle")
    ring = [(0.1 * math.cos(2 * math.pi * i / 8), 0.1 * math.sin(2 * math.pi * i / 8)) for i in range(8)]
    ax.extrude(ring, (-1.15, 0, 2.2), (0, 1, 0), (0, 0, 1), (1, 0, 0), 0, 2.3, "timber")
    s.merge(L._welded(ax))
    s.box(1.15, 1.2, -0.03, 0.03, 1.8, 2.25, "iron", res=9)
    s.box(1.15, 1.2, -0.03, 0.4, 1.78, 1.84, "iron", res=9)
    L.lathe(s, 0.0, 0.0, [(0.0, 1.2), (0.18, 1.2), (0.22, 1.6), (0.0, 1.6)], "planks", segs=10)
    s.box(-0.012, 0.012, -0.012, 0.012, 1.6, 2.15, "timber", res=9)
    base = s.to_object()
    r = L.Solid("roof")
    L.gable_roof(r, -1.3, 1.3, -0.9, 0.9, 2.55, 3.5, key="shingle", over=0.25, fascia_key="timber")
    meta = {"kind": "well", "r": 1.2, "frame": "centre", "walks": [], "doors": [], "links": [], "bbox": [[-2.2, -2.2, -3], [2.2, 2.2, 3.6]],
            "note": "blocks a 1.3 m disc; the windlass roof is 'roof'"}
    L.finish_piece("well", {"base": [base], "roof": [r.to_object()]}, {}, meta=meta, lods=(1.0, 0.5), grime_h=0.6, ao_dist=1.2)


ALL = {"hall": hall, "chapel": chapel, "kitchen": kitchen, "stable": stable, "well": well}
if __name__ == "__main__":
    for n in (argv or list(ALL)):
        ALL[n]()
