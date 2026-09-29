"""Crossbowmen (Genoese-style, c.1340): quilted gambeson with a team field-sign cross, a mail haubergeon over
it for some (part 6, kit bit), an iron kettle hat over the coif (part 5, ~90 %); a spanning belt with its
claw, a leather bolt quiver at the right hip, a sword at the left. A composite-prod crossbow with stirrup
(part 1) whose string/bolt are drawn by helper bones (_arms_kit.xbow_rig). The team-painted pavise rides
on his back on the march (part 3) and is planted in front of him to shoot and span behind (part 4, on the
parentless `ground` bone). Sword in hand for melee (part 2, the crossbow put down).

    blender -b -t 5 -P tools/vat_bake.py -- crossbow [sheet] [booth]
"""
import _human as H
import _arms_anims  # noqa: F401
import _combat_anims  # noqa: F401  (guard, blows, reactions, deaths)
import _arms_kit as K
import _arms_anims as AA

SPEC = {
    "family": "xbow",
    "rig": K.xbow_rig,
    "parts": {"bow": 1, "sword": 2, "pavise_back": 3, "pavise": 4, "helm": 5, "mail": 6},
    "clip_meta": {"shoot": {"loose": AA.LOOSE["xbow"]}},
    "tex": 1024,
    "dyes": {"d1": ["c7b995", "b5a47d", "bda983", "a39068", "d0c4a4", "9d8a66", "b9ad8f", "8f7e5f"],
             "d2": ["7a3b2e", "5b4634", "4e5a6a", "6f4430", "3f4a3a", "6e6a62", "8a5a3a", "4d5238"]},
    "booth_parts": [1, 3, 5, 6],
    "lineup": [("idle", 0.2, [1, 3, 5]), ("walk", 0.1, [1, 3, 5, 6]), ("shoot", 0.35, [1, 4, 5]), ("shoot", 0.6, [1, 4, 5, 6]),
               ("reload", 0.25, [1, 4, 5]), ("reload", 0.5, [1, 4, 5, 6]), ("reload", 0.8, [1, 4, 5]), ("strike", 0.45, [2, 3, 5]),
               ("fall", 1.0, [1, 3, 5])],
}

def _crowd(r, c, rnd):
    kit = [5] + ([6] if rnd.random() < 0.3 else [])
    if r < 2: return (("shoot", rnd.random(), [1, 4] + kit) if rnd.random() < 0.4 else ("reload", rnd.random(), [1, 4] + kit))
    return ("idle", rnd.random(), [1, 3] + kit)
SPEC["crowd"] = _crowd

KIT = {"wood": "wood", "iron": "iron", "leather": "leather", "leather2": "leather2", "string": "string", "horn": "horn",
       "fletch": "fletch", "prod": "prod", "pav": "pavise_paint", "pav_back": "pavise_back", "rim": "shield_rim"}


def build(lod=0):
    body = H.Part("body", 0)
    H.head(body, "skin", lod=lod)
    H.neck(body, "skin", r=0.055)
    H.coif(body, "linen_coif", lod=lod)
    for s in ("L", "R"):
        H.leg(body, s, "wool_dye2", segs=8 if lod else 9, thick=0.004, lod=lod)
        H.shoe(body, s, "shoe", segs=6 if lod else 8, lod=lod)
        H.arm(body, s, "gambeson", segs=7 if lod else 9, thick=0.020, cuff=0.006, lod=lod)
        H.hand(body, s, "skin", segs=6 if lod else 8, lod=lod)
    H.torso(body, "gambeson", segs=12 if lod else 14, thick=0.028, z0=0.93, z1=1.47, lod=lod,
            skirt=(0.68, 0.232, 0.19, 2 if lod else 3), n=2.6)
    H.belt(body, "leather", z=1.05, grow=0.036, segs=12 if lod else 14)
    if not lod: K.belt_claw(body, KIT, z=1.05)
    K.bolt_quiver(body, KIT, "R", z=1.04, lod=lod)
    if not lod: H.scabbard(body, KIT, "L", z=1.04)
    xb = H.Part("bow", 1); K.crossbow(xb, 1, KIT, lod=lod)
    sw = H.Part("sword", 2); H.sword(sw, 2, KIT, lod=lod)
    pb = H.Part("pavise_back", 3); K.pavise(pb, 3, KIT, "back", lod=lod)
    pg = H.Part("pavise", 4); K.pavise(pg, 4, KIT, "ground", lod=lod)
    helm = H.Part("helm", 5); H.kettle_hat(helm, "iron", segs=12, lod=lod)
    mail = H.Part("mail", 6)
    H.torso(mail, "mail", segs=10 if lod else 12, thick=0.048, z0=1.00, z1=1.44, lod=lod, skirt=(0.74, 0.252, 0.212, 1 if lod else 2), n=2.5)
    for s in ("L", "R"):
        # short mail sleeves to above the elbow
        sh, el = H.jp("shoulder", s), H.jp("elbow", s)
        K.tube(mail, [sh + (sh - el).normalized() * 0.02, sh.lerp(el, 0.55)], [0.092, 0.082], "mail",
               [{f"upperarm.{s}": 0.7, "chest": 0.3}, {f"upperarm.{s}": 1}], 7 if lod else 9, cap0=False, cap1=False, pat_len=False)
    return [body, xb, sw, pb, pg, helm, mail]
