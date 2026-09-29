"""HIGHGROUND - gold vein: a quartz-gold stringer at the Blackfell crag foot (resource node).

A low crag of dark slaty greywacke, rust-stained with gossan (limonite weathered out of the
pyrite round the lode), cut across by a white quartz reef that stands proud as a rib because it
weathers slower than the country rock; the quartz carries grey sulphide streaks and specks of
free gold. Three old prospect pits with rings of rusty upcast and quartz spalls, a small heap of
picked quartz. Footprint ~10 x 8 m. Front faces -Y.

    blender -b -t 2 -P assets/src/gold_vein.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _landkit import *

begin(111)


def gold(g, col, h):
    P = g.P
    vn = g.node("ShaderNodeTexVoronoi", [("Vector", P), ("Scale", 45.0), ("Randomness", 1.0)], feature="F1")
    cr = g.sep(vn.outputs["Color"])[0]
    fl = g.mul(g.inv(g.mr(vn.outputs["Distance"], 0.08, 0.2)), g.gt(cr, 0.9))
    fl = g.mul(fl, g.mr(g.noise(P, 1.5, 3), 0.45, 0.6))
    col = g.mix(fl, col, g.ramp(g.noise(P, 90.0, 2), [(0.3, "#b8902e"), (0.8, "#d8b048")]))
    # grey sulphide streaks along the reef
    x, y, z = g.sep(P)
    st = g.noise(g.comb(g.mul(x, 0.6), g.mul(y, 6.0), g.mul(z, 6.0)), 1.0, 4)
    col = g.mix(g.mul(g.mr(st, 0.58, 0.68), 0.6), col, "#5d5a57")
    g._fl = fl
    return col, g.add(h, g.mul(fl, 0.3))


def reefband(g, col, h):
    """the reef where it crosses the crag: a white quartz band along the line y = -1.15 x + 0.3 (world)."""
    x, y, z = g.sep(g.P)
    d = g.math("ABSOLUTE", g.add(g.sub(y, g.add(g.mul(x, -1.15), 0.3)), g.mul(g.sub(g.noise(g.P, 0.7, 3), 0.5), 0.5)))
    d = g.mul(d, 0.66)
    wmod = g.add(0.55, g.mul(g.noise(g.P, 0.8, 3), 0.9))          # the reef pinches and swells
    band = g.inv(g.mr(g.math("DIVIDE", d, wmod), 0.2, 0.3))
    # thin quartz stringers branching off it, and host rock showing through in pods
    xs = g.add(g.sub(y, g.add(g.mul(x, -1.15), 0.3)), g.mul(g.sub(g.noise(g.P, 1.6, 3), 0.5), 1.4))
    str_ = g.inv(g.mr(g.math("ABSOLUTE", g.sub(g.math("FRACT", g.mul(xs, 0.9)), 0.5)), 0.015, 0.05))
    str_ = g.mul(str_, g.mul(g.inv(g.mr(d, 0.6, 1.8)), g.mr(g.noise(g.P, 2.5, 3), 0.45, 0.6)))
    band = g.mx(g.mul(band, g.inv(g.mul(g.mr(g.noise(g.P, 3.0, 3), 0.6, 0.66), 0.8))), str_)
    halo = g.inv(g.mr(d, 0.3, 1.3))
    col = g.mix(g.mul(halo, 0.7), col, g.ramp(g.noise(g.P, 3.0, 4), [(0.3, "#7a3a18"), (0.8, "#a8622a")]))
    qc = g.ramp(g.noise(g.P, 4.0, 4), [(0.3, "#aaa294"), (0.75, "#cbc4b4")])
    qc = g.mix(g.mul(g.mr(g.noise(g.P, 2.0, 3), 0.55, 0.7), 0.7), qc, "#a8662e")
    col = g.mix(band, col, qc)
    return col, g.add(h, g.mul(band, 0.5))


MAT["host"] = m_rock("host", [(0.0, "#474540"), (0.3, "#55524b"), (0.6, "#625d54"), (1.0, "#4d4a45")], speck=0.15,
                     strata=0.3, strata_scale=3.0, extra=reefband, strata_tones=[(0.2, "#3f3c38"), (0.8, "#6a645a")], lichen_d=0.4,
                     lichen_amt=0.75, moss=0.6, cracks=0.8, streaks=0.8,
                     stain=("#7a3f1c", "#a0602c", 0.85, 0.45))
MAT["quartz"] = m_rock("quartz", [(0.0, "#bdb6a8"), (0.35, "#d0c9ba"), (0.7, "#dcd5c6"), (1.0, "#c4bba9")], speck=0.0,
                       lichen_d=0.3, lichen_amt=0.5, moss=0.2, cracks=0.9, streaks=0.5, rough=0.62,
                       stain=("#9a5a28", "#b87a3a", 0.6, 0.8), extra=gold, preview="#d0c9ba")
MAT["spoil"] = m_loose("spoil", [(0.0, "#5a3d27"), (0.3, "#6e4a2c"), (0.6, "#7d5a38"), (1.0, "#5a4c3e")], lump=11.0,
                       grass=0.6, pebble=0.55, peb_tones=("#8a8378", "#cfc7b6"))
MAT["pitfloor"] = m_loose("pitfloor", [(0.0, "#2f2820"), (0.5, "#3b3127"), (1.0, "#4a3d2e")], lump=8.0, grass=0.2)
MAT["puddle"] = m_pool("puddle", deep="#231a12", shallow="#4a2f18")
mat_turf("turf", dry=0.4)

host = B("host")
q = B("reef", "quartz")
# country rock: a low crag running east-west, highest at the back (the crag foot)
rock(host, (-1.2, 1.4, 0), (6.5, 3.6, 2.6), 1101, yaw=0.08, sink=0.2, blocky=3.4, amp=0.12, cuts=2, sub=4, facets=8,
     cut_up=(-0.2, 0.3), chamfer=0.02, ridged=0.06)
rock(host, (2.9, 1.0, 0), (3.6, 3.0, 1.9), 1102, yaw=-0.2, sink=0.2, blocky=3.4, amp=0.12, cuts=1, sub=3, facets=6)
rock(host, (-4.1, 0.2, 0), (2.4, 2.2, 1.2), 1103, yaw=0.5, sink=0.25, blocky=3.0, amp=0.12, cuts=1, sub=3, facets=5)
# the reef: a proud, broken rib of quartz running NE-SW off the crag and down across the flat
# (its line y = -1.15 x + 0.3 matches the painted band on the crag)
pts = []
x = -0.3
k = 0
while x < 2.9:
    y = -1.15 * x + 0.3
    ln = R.uniform(1.0, 1.5)
    hh = R.uniform(0.45, 0.8) * (1.0 if x < 1.8 else 0.7)
    rock(q, (x + jit(0.08), y + jit(0.08), 0), (ln, R.uniform(0.5, 0.7), hh), 1110 + k, yaw=math.atan2(-1.15, 1.0) + jit(0.12),
         sink=0.2, blocky=3.6, amp=0.1, cuts=2, cut_up=(-0.1, 0.4), sub=3, facets=5, chamfer=0.015)
    x += ln * 0.55
    k += 1
# prospect pits dug into the reef's run
pit(-0.4, -2.0, 1.6, 0.32, B("pits", "spoil"), B("pf", "pitfloor"), seed=1.0, puddle=B("pud", "puddle"))
pit(3.2, -1.3, 1.3, 0.28, B("pits", "spoil"), B("pf", "pitfloor"), seed=2.0)
pit(1.4, -4.0, 1.5, 0.3, B("pits", "spoil"), B("pf", "pitfloor"), seed=3.0, puddle=B("pud", "puddle"))
lumps(B("reef", "quartz"), -0.4, -2.0, 1.4, 9, 0.1, 0.25, 11, zfn=lambda x, y: 0.15)
lumps(B("reef", "quartz"), 1.4, -4.0, 1.3, 6, 0.1, 0.22, 12, zfn=lambda x, y: 0.15)
# heap of picked quartz by the lower pit
spoil_heap(B("pits", "spoil"), -2.4, -3.2, 0.9, 0.7, 0.35, seed=5.0)
lumps(B("reef", "quartz"), -2.4, -3.2, 0.6, 12, 0.08, 0.2, 13, zfn=lambda x, y: 0.28)
scatter_stones(B("host"), -0.8, -3.6, 3.5, 0.9, 12, 0.12, 0.3, 14)
base_tufts(-0.5, 1.2, 5.0, 2.4, 22, 15)
done("gold_vein", tex=2048, lods=(1.0, 0.4, 0.12))
