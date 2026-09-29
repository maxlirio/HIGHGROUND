"""Scouts (prickers): unarmoured riders in a padded jack and a team-coloured hood, sword in hand,
no shield. Ride horse_light.

    blender -b -t 5 -P tools/vat_bake.py -- scouts [sheet] [booth]
"""
import _human as H
import _arms_anims  # noqa: F401
import _combat_anims  # noqa: F401  (family "knight")
from spearmen import SPEC as _SP
import _anims as A
A.RIDE_FIT = A.RIDE_FITS["light"]      # rides horse_light

SPEC = {
    "family": "knight",
    "parts": {},
    "tex": 1024,
    "dyes": _SP["dyes"],
    "booth_parts": [],
    "lineup": [("idle", 0.2, []), ("walk", 0.1, []), ("ride", 0.2, []), ("ride_charge", 0.3, []), ("ride_strike", 0.5, []), ("fall", 1.0, [])],
}
SPEC["crowd"] = lambda r, c, rnd: ("idle", rnd.random(), [])
KIT = {"wood": "wood", "iron": "iron", "leather": "leather", "leather2": "leather2"}


def build(lod=0):
    body = H.Part("body", 0)
    H.head(body, "skin", lod=lod)
    H.neck(body, "skin", r=0.055)
    H.hood(body, "wool_team", lod=lod, cape_hem=1.30)
    for s in ("L", "R"):
        H.leg(body, s, "wool_dye2", segs=8 if lod else 10, thick=0.004, lod=lod)
        H.shoe(body, s, "shoe", segs=6 if lod else 8, lod=lod, boot=0.20)
        H.arm(body, s, "gambeson", segs=7 if lod else 10, thick=0.016, cuff=0.005, lod=lod)
        H.hand(body, s, "skin", segs=6 if lod else 8, lod=lod)
    H.torso(body, "gambeson", segs=12 if lod else 16, thick=0.022, z0=0.93, z1=1.47, lod=lod,
            skirt=(0.72, 0.23, 0.20, 2 if lod else 3), n=2.5)
    H.belt(body, "leather", z=1.06, grow=0.030, segs=12 if lod else 16)
    if not lod: H.scabbard(body, KIT, "L", z=1.05)
    H.sword(body, 0, KIT, lod=lod)
    return [body]
