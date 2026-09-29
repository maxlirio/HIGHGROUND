"""Archers (English longbowmen, c.1340): a quilted jack (lozenge-stitched, a team field-sign cross), hose,
ankle boots, a linen arrow bag at the right hip, a sword/falchion scabbard at the left; a 1.8 m yew
longbow in the left hand (part 1) with a drawable string and a nocked arrow (helper bones, _arms_kit.bow_rig).
Head: an iron kettle hat over the coif (part 8, ~50 %) or a brimmed felt hat (part 9).
Sidearms in the right hand when fighting (the bow is put down): sword or falchion 3 (one blade) / mallet 4 / axe 5,
buckler in the left fist (6) — otherwise hung at the hip (7).

    blender -b -t 5 -P tools/vat_bake.py -- archers [sheet] [booth]
"""
import _human as H
import _arms_anims  # noqa: F401
import _combat_anims  # noqa: F401  (guard, blows, reactions, deaths)
import _arms_kit as K
import _arms_anims as AA

SPEC = {
    "family": "bow",
    "rig": K.bow_rig,
    "parts": {"bow": 1, "sword": 3, "falchion": 3, "mallet": 4, "axe": 5, "buckler": 6, "buckler_belt": 7, "helm": 8, "hat": 9},
    "clip_meta": {"shoot": {"loose": AA.LOOSE["bow"]}},
    "tex": 1024,
    # jacks: undyed linen, fustian, faded russet, murrey, dun, green-grey; hose/hat: browns, greens, reds
    "dyes": {"d1": ["c2b28c", "a8976f", "8e6e4a", "7a5a44", "b8a47a", "6f6a4f", "9c8a66", "a58e62"],
             "d2": ["5b4634", "4d5238", "6f4430", "3f4a3a", "6e6a62", "7a3b2e", "4e5a6a", "5a4a3a"]},
    "booth_parts": [1, 7, 9],
    "lineup": [("idle", 0.2, [1, 7, 9]), ("walk", 0.1, [1, 7, 8]), ("shoot", 0.12, [1, 7, 9]), ("shoot", 0.3, [1, 7, 8]),
               ("shoot", 0.6, [1, 7, 9]), ("shoot", 0.7, [1, 7, 9]), ("strike", 0.45, [3, 6, 8]), ("run", 0.25, [1, 7, 9]),
               ("fall", 1.0, [1, 7, 9])],
}

def _crowd(r, c, rnd):
    head = [8] if rnd.random() < 0.5 else [9]
    if r < 3: return ("shoot", rnd.random(), [1, 7] + head)
    return ("idle", rnd.random(), [1, 7] + head)
SPEC["crowd"] = _crowd

KIT = {"wood": "wood", "iron": "iron", "leather": "leather", "leather2": "leather2", "lead": "lead",
       "yew": "yew", "string": "string", "horn": "horn", "fletch": "fletch", "bag": "bag"}


def build(lod=0):
    body = H.Part("body", 0)
    H.head(body, "skin", lod=lod)
    H.neck(body, "skin", r=0.055)
    H.coif(body, "linen_coif", lod=lod)
    for s in ("L", "R"):
        H.leg(body, s, "wool_dye2", segs=8 if lod else 9, thick=0.004, lod=lod)
        H.shoe(body, s, "shoe", segs=6 if lod else 8, lod=lod, boot=0.10)
        H.arm(body, s, "jack", segs=7 if lod else 9, thick=0.018, cuff=0.005, lod=lod)
        H.hand(body, s, "skin", segs=6 if lod else 8, lod=lod)
    H.torso(body, "jack", segs=12 if lod else 14, thick=0.026, z0=0.93, z1=1.47, lod=lod,
            skirt=(0.72, 0.230, 0.192, 2 if lod else 3), n=2.6)
    H.belt(body, "leather", z=1.05, grow=0.034, segs=12 if lod else 16)
    K.arrow_bag(body, KIT, "R", z=1.04, lod=lod)
    if not lod: H.scabbard(body, KIT, "L", z=1.04)
    bow = H.Part("bow", 1); K.longbow(bow, 1, KIT, lod=lod)
    fal = H.Part("falchion", 3); K.falchion(fal, 3, KIT, lod=lod)
    mal = H.Part("mallet", 4); K.mallet(mal, 4, KIT, lod=lod)
    axe = H.Part("axe", 5); H.axe(axe, 5, KIT, lod=lod)
    buck = H.Part("buckler", 6); K.buckler(buck, 6, KIT, "L", "hand", lod=lod)
    buckb = H.Part("buckler_belt", 7); K.buckler(buckb, 7, KIT, "L", "belt", lod=lod)
    helm = H.Part("helm", 8); H.kettle_hat(helm, "iron", segs=12, lod=lod)
    hat = H.Part("hat", 9); K.brimmed_hat(hat, "felt", lod=lod)
    return [body, bow, fal, mal, axe, buck, buckb, helm, hat]
