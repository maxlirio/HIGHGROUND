"""Pikemen (c.1300-40, Flemish / Scots style): a quilted gambeson to mid-thigh with a team field-sign cross,
hose, ankle boots, a sword at the hip; an iron kettle hat over the coif (part 2, the kit's helmet bit, ~80 %);
a 5 m ash pike with long langets (part 1, always carried). Pike at the order on the march, levelled at the
shoulder for the push of pike, and grounded behind the right foot to receive horse (clip `brace`).

    blender -b -t 5 -P tools/vat_bake.py -- pikemen [sheet] [booth]
"""
import _human as H
import _arms_anims  # noqa: F401
import _combat_anims  # noqa: F401  (guard, blows, reactions, deaths)
import _arms_kit as K
import _arms_anims as AA

SPEC = {
    "family": "pike",
    "parts": {"pike": 1, "helm": 2},
    "tex": 1024,
    # gambesons: linen, canvas, a few dyed (Flemish blue-grey, russet, green)
    "dyes": {"d1": ["c7b995", "b5a47d", "a39068", "bda983", "7d8a94", "8e6e4a", "6f7456", "b9ad8f"],
             "d2": ["5b4634", "6e6a62", "6f4430", "4d5238", "3c4658", "4e5a6a", "7a3b2e", "5a4a3a"]},
    "booth_parts": [1, 2],
    "lineup": [("idle", 0.2, [1, 2]), ("walk", 0.1, [1, 2]), ("walk", 0.6, [1]), ("run", 0.25, [1, 2]), ("strike", 0.3, [1, 2]),
               ("strike", 0.55, [1, 2]), ("brace", 0.2, [1, 2]), ("level", 0.2, [1, 2]), ("fall", 1.0, [1, 2])],
}

def _crowd(r, c, rnd):
    kit = [1] + ([2] if rnd.random() < 0.8 else [])
    if r == 0: return ("brace", rnd.random(), kit)
    if r == 1: return ("strike", rnd.random(), kit)
    return ("idle", rnd.random(), kit)
SPEC["crowd"] = _crowd

KIT = {"wood": "wood", "iron": "iron", "leather": "leather", "leather2": "leather2"}


def build(lod=0):
    body = H.Part("body", 0)
    H.head(body, "skin", lod=lod)
    H.neck(body, "skin", r=0.055)
    H.coif(body, "linen_coif", lod=lod)
    for s in ("L", "R"):
        H.leg(body, s, "wool_dye2", segs=8 if lod else 10, thick=0.004, lod=lod)
        H.shoe(body, s, "shoe", segs=6 if lod else 8, lod=lod, boot=0.12)
        H.arm(body, s, "pike_quilt", segs=7 if lod else 10, thick=0.022, cuff=0.006, lod=lod)
        H.hand(body, s, "skin", segs=6 if lod else 8, lod=lod)
    H.torso(body, "pike_quilt", segs=12 if lod else 18, thick=0.030, z0=0.93, z1=1.47, lod=lod,
            skirt=(0.64, 0.236, 0.192, 2 if lod else 3), n=2.6)
    H.belt(body, "leather", z=1.06, grow=0.036, segs=12 if lod else 18)
    if not lod:
        H.scabbard(body, KIT, "L", z=1.05)
        H.dagger(body, KIT, "R", z=1.05)
    pike = H.Part("pike", 1); K.pike(pike, 1, KIT, lod=lod)
    helm = H.Part("helm", 2); H.kettle_hat(helm, "iron", lod=lod)
    return [body, pike, helm]
