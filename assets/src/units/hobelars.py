"""Hobelars: light horse from the northern marches: quilted jack, kettle hat over an arming cap, a
spear, and (part 1) a round shield with a team field and accent cross. Rides horse_light.

    blender -b -t 5 -P tools/vat_bake.py -- hobelars [sheet] [booth]
"""
import _human as H
import _arms_anims  # noqa: F401
import _combat_anims  # noqa: F401  (guard, blows, reactions, deaths)
from spearmen import SPEC as _SP
import _anims as A
A.RIDE_FIT = A.RIDE_FITS["light"]      # rides horse_light

SPEC = {
    "family": "rider",
    "parts": {"shield": 1},
    "tex": 1024,
    "dyes": _SP["dyes"],
    "booth_parts": [1],
    "lineup": [("idle", 0.2, [1]), ("walk", 0.1, [1]), ("ride", 0.2, [1]), ("ride_charge", 0.3, [1]), ("ride_strike", 0.5, [1]), ("fall", 1.0, [1])],
}
SPEC["crowd"] = lambda r, c, rnd: ("idle", rnd.random(), [1])
KIT = {"wood": "wood", "iron": "iron", "leather": "leather", "leather2": "leather2",
       "paint": "rshield_paint", "back": "rshield_back", "rim": "shield_rim"}


def build(lod=0):
    body = H.Part("body", 0)
    H.head(body, "skin", lod=lod)
    H.neck(body, "skin", r=0.055)
    H.coif(body, "linen_coif", lod=lod)
    H.kettle_hat(body, "iron", lod=lod)
    for s in ("L", "R"):
        H.leg(body, s, "wool_dye2", segs=8 if lod else 10, thick=0.004, lod=lod)
        H.shoe(body, s, "shoe", segs=6 if lod else 8, lod=lod, boot=0.18)
        H.arm(body, s, "gambeson", segs=7 if lod else 10, thick=0.020, cuff=0.006, lod=lod)
        H.hand(body, s, "skin", segs=6 if lod else 8, lod=lod)
    H.torso(body, "gambeson", segs=12 if lod else 18, thick=0.028, z0=0.93, z1=1.47, lod=lod,
            skirt=(0.70, 0.235, 0.20, 2 if lod else 3), n=2.6)
    H.belt(body, "leather", z=1.06, grow=0.034, segs=12 if lod else 18)
    if not lod: H.dagger(body, KIT, "R", z=1.05)
    H.spear(body, 0, KIT, length=2.9, grip=1.0, lod=lod)
    shield = H.Part("shield", 1); H.round_shield(shield, 1, KIT, lod=lod)
    return [body, shield]
