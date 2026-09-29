"""Men-at-arms (c.1340): a mail hauberk to the knee with mail sleeves and chausses, iron poleyns, a coat of
plates over the body (cloth-covered in the team's colour, an accent stripe, rows of rivets), a bascinet
with a mail aventail, mitten gauntlets, sword belt and scabbard. Kit: sword (part 1) and heater shield
(part 3), or a pollaxe (part 2, two-handed, no shield); a pig-faced visor closed over the face (part 4,
the kit's visor bit).

    blender -b -t 5 -P tools/vat_bake.py -- menatarms [sheet] [booth]
"""
import _human as H
import _arms_anims  # noqa: F401
import _combat_anims  # noqa: F401  (guard, blows, reactions, deaths)
import _arms_kit as K
import _arms_anims as AA

SPEC = {
    "family": "maa",
    "parts": {"sword": 1, "pollaxe": 2, "shield": 3, "visor": 4},
    "tex": 1024,
    "dyes": {"d1": ["5b4634"], "d2": ["4b4a45"]},
    "booth_parts": [1, 3],
    "lineup": [("idle", 0.2, [1, 3]), ("walk", 0.1, [1, 3, 4]), ("idle_pollaxe", 0.3, [2]), ("walk_pollaxe", 0.6, [2, 4]),
               ("strike", 0.3, [1, 3]), ("strike", 0.5, [1, 3, 4]), ("strike_pollaxe", 0.25, [2]), ("strike_pollaxe", 0.48, [2]),
               ("run", 0.25, [1, 3]), ("fall", 1.0, [1, 3])],
}

def _crowd(r, c, rnd):
    pa = rnd.random() < 0.45; vis = [4] if rnd.random() < 0.35 else []
    kit = ([2] if pa else [1, 3]) + vis
    if r == 0: return ("strike_pollaxe" if pa else "strike", rnd.random(), kit)
    return ("idle_pollaxe" if pa else "idle", rnd.random(), kit)
SPEC["crowd"] = _crowd

KIT = {"wood": "wood", "iron": "iron", "leather": "leather", "leather2": "leather2",
       "paint": "shield_paint", "back": "shield_back", "rim": "shield_rim"}


def build(lod=0):
    body = H.Part("body", 0)
    H.head(body, "skin", lod=lod)
    H.neck(body, "skin", r=0.055)
    K.aventail(body, "mail", lod=lod)
    K.bascinet(body, "bascinet", lod=lod)
    for s in ("L", "R"):
        H.leg(body, s, "mail", segs=8 if lod else 9, thick=0.010, lod=lod)
        H.shoe(body, s, "shoe", segs=6 if lod else 8, lod=lod)
        H.poleyn(body, "iron", s, lod=lod)
        H.arm(body, s, "mail", segs=7 if lod else 9, thick=0.020, cuff=0.006, lod=lod)
        K.gauntlet_hand(body, s, "gauntlet", segs=6 if lod else 7, lod=lod)
    H.torso(body, "mail", segs=12 if lod else 14, thick=0.030, z0=0.93, z1=1.47, lod=lod,
            skirt=(0.60, 0.245, 0.210, 2 if lod else 3), n=2.4)
    K.coat_of_plates(body, "coat_plates", segs=12 if lod else 14, lod=lod)
    H.belt(body, "leather", z=0.90, grow=0.075, segs=12 if lod else 14)
    if not lod: H.scabbard(body, KIT, "L", z=0.92)
    sw = H.Part("sword", 1); H.sword(sw, 1, KIT, lod=lod)
    pa = H.Part("pollaxe", 2); K.pollaxe(pa, 2, KIT, lod=lod)
    sh = H.Part("shield", 3); H.heater_shield(sh, 3, KIT, lod=lod)
    vi = H.Part("visor", 4); K.visor(vi, "visor", lod=lod)
    return [body, sw, pa, sh, vi]
