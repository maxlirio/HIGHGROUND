"""Knights: great helm over a mail aventail, mail sleeves and chausses with iron poleyns, a surcoat
in the team's colours with an accent hem, sword belt and scabbard; lance (part 1, mounted), sword
(part 2, unhorsed), heater shield (part 3). Rides horse_destrier / horse_destrier_barded.

    blender -b -t 5 -P tools/vat_bake.py -- knights [sheet] [booth]
"""
import _human as H
import _arms_anims  # noqa: F401
import _combat_anims  # noqa: F401  (family "knight")
import _anims as A
A.RIDE_FIT = A.RIDE_FITS["destrier"]   # the seat and leathers of the destrier (legs round its caparison)

SPEC = {
    "family": "knight",
    "parts": {"lance": 1, "sword": 2, "shield": 3},
    "tex": 1024,
    "dyes": {"d1": ["5b4634"], "d2": ["4b4a45"]},
    "booth_parts": [1, 3],
    "lineup": [("idle", 0.2, [2, 3]), ("walk", 0.1, [2, 3]), ("strike", 0.45, [2, 3]), ("ride", 0.2, [1, 3]), ("ride_charge", 0.3, [1, 3]),
               ("ride_strike", 0.5, [1, 3]), ("fall", 1.0, [2, 3])],
}
SPEC["crowd"] = lambda r, c, rnd: ("idle", rnd.random(), [2, 3])
KIT = {"wood": "wood", "iron": "iron", "leather": "leather", "leather2": "leather2",
       "paint": "shield_paint", "back": "shield_back", "rim": "shield_rim"}


def build(lod=0):
    body = H.Part("body", 0)
    H.great_helm(body, "helm", lod=lod)
    H.mail_hood(body, "mail", segs=10 if lod else 14)
    for s in ("L", "R"):
        H.leg(body, s, "mail", segs=8 if lod else 10, thick=0.010, lod=lod)
        H.shoe(body, s, "mail", segs=6 if lod else 8, lod=lod)
        H.poleyn(body, "iron", s, lod=lod)
        H.arm(body, s, "mail", segs=7 if lod else 10, thick=0.018, cuff=0.006, lod=lod)
        H.hand(body, s, "leather", segs=6 if lod else 8, lod=lod)
    H.torso(body, "surcoat", segs=12 if lod else 18, thick=0.034, z0=0.93, z1=1.47, lod=lod,
            skirt=(0.56, 0.250, 0.215, 2 if lod else 4), n=2.4)
    H.belt(body, "leather", z=1.04, grow=0.040, segs=12 if lod else 18)
    if not lod: H.scabbard(body, KIT, "L", z=1.04)
    lance = H.Part("lance", 1); H.lance(lance, 1, KIT, lod=lod)
    sword = H.Part("sword", 2); H.sword(sword, 2, KIT, lod=lod)
    shield = H.Part("shield", 3); H.heater_shield(shield, 3, KIT, lod=lod)
    return [body, lance, sword, shield]
