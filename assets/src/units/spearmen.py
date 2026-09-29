"""Spearmen: quilted linen gambeson to mid-thigh with a field-sign cross (team colour) on breast
and back; padded arming cap under an iron kettle hat; hose and shoes; a 2.65 m ash spear; a
heater shield (part 1, carried by ~80%) painted in the team's field with an accent chevron.

    blender -b -t 5 -P tools/vat_bake.py -- spearmen [sheet] [booth]
"""
import _human as H
import _arms_anims  # noqa: F401
import _combat_anims  # noqa: F401  (guard, blows, reactions, deaths)

SPEC = {
    "family": "spear",
    "parts": {"shield": 1},
    "tex": 1024,
    # natural linen / canvas shades for the gambeson; hose as the villagers'
    "dyes": {"d1": ["c7b995", "b5a47d", "a39068", "bda983", "9d8a66", "a88a52", "b9ad8f", "8f7e5f"],
             "d2": ["5b4634", "6e6a62", "6f4430", "4d5238", "948670", "4e5a6a"]},
    "booth_parts": [1],
    "lineup": [("idle", 0.2, [1]), ("walk", 0.1, [1]), ("walk", 0.6, []), ("run", 0.25, [1]), ("strike", 0.2, [1]),
               ("strike", 0.47, [1]), ("fall", 0.45, [1]), ("fall", 1.0, [1])],
}

def _crowd(r, c, rnd):
    parts = [1] if rnd.random() < 0.8 else []
    if r == 0: return ("strike", rnd.random(), parts)
    return ("idle", rnd.random(), parts)
SPEC["crowd"] = _crowd

KIT = {"wood": "wood", "iron": "iron", "leather": "leather", "leather2": "leather2",
       "paint": "shield_paint", "back": "shield_back", "rim": "shield_rim"}


def build(lod=0):
    body = H.Part("body", 0)
    H.head(body, "skin", lod=lod)
    H.neck(body, "skin", r=0.055)
    H.coif(body, "linen_coif", lod=lod)
    H.kettle_hat(body, "iron", lod=lod)
    for s in ("L", "R"):
        H.leg(body, s, "wool_dye2", segs=8 if lod else 10, thick=0.004, lod=lod)
        H.shoe(body, s, "shoe", segs=6 if lod else 8, lod=lod)
        H.arm(body, s, "gambeson", segs=7 if lod else 10, thick=0.022, cuff=0.006, lod=lod)
        H.hand(body, s, "skin", segs=6 if lod else 8, lod=lod)
    H.torso(body, "gambeson", segs=12 if lod else 18, thick=0.030, z0=0.93, z1=1.47, lod=lod,
            skirt=(0.66, 0.232, 0.188, 2 if lod else 3), n=2.6)
    H.belt(body, "leather", z=1.06, grow=0.036, segs=12 if lod else 18)
    if not lod:
        H.dagger(body, KIT, "R", z=1.05)
    H.spear(body, 0, KIT, lod=lod)
    shield = H.Part("shield", 1); H.heater_shield(shield, 1, KIT, lod=lod)
    return [body, shield]
