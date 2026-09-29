"""Levy spearmen (county levies, c.1300-40): a patched wool tunic or an old, darned gambeson (both dye 1 with
a team field-sign cross sewn on), hose, turnshoes; a linen coif under an old kettle hat (part 4, the kit's
helmet bit, ~40 %) or a close wool cap (part 5, the rest); a 2.5 m spear (part 1, 75 %) or a cudgel (part 2);
a few carry a heater shield (part 3, ~30 %). Without a shield they hold the spear two-handed (clips *_bare);
the club men fight overarm (clips *_club).

    blender -b -t 5 -P tools/vat_bake.py -- levy [sheet] [booth]
"""
import _human as H
import _arms_anims  # noqa: F401
import _combat_anims  # noqa: F401  (guard, blows, reactions, deaths)
import _arms_kit as K
import _arms_anims as AA

SPEC = {
    "family": "levy",
    "parts": {"spear": 1, "club": 2, "shield": 3, "helm": 4, "cap": 5},
    "tex": 1024,
    # undyed wool, oatmeal, russet, faded madder, dun, brown, grey, faded woad
    "dyes": {"d1": ["a39478", "b7aa8c", "7b4b33", "7a6a55", "8f8460", "6a5440", "7d7a72", "8a7f6a"],
             "d2": ["5b4634", "6e6a62", "6f4430", "4d5238", "948670", "4e5a6a", "3f3a33", "7a6a50"]},
    "booth_parts": [1, 5],
    "lineup": [("idle_bare", 0.2, [1, 5]), ("idle", 0.2, [1, 3, 4]), ("walk_bare", 0.1, [1, 4]), ("run_bare", 0.25, [1, 5]),
               ("strike_bare", 0.3, [1, 5]), ("strike_bare", 0.5, [1, 4]), ("strike", 0.47, [1, 3, 5]), ("idle_club", 0.3, [2, 5]),
               ("strike_club", 0.35, [2, 4]), ("fall", 1.0, [1, 5])],
}

def _crowd(r, c, rnd):
    head = [4] if rnd.random() < 0.4 else [5]
    if rnd.random() < 0.25: return ("strike_club" if r == 0 else "idle_club", rnd.random(), [2] + head)
    if rnd.random() < 0.3: return ("strike" if r == 0 else "idle", rnd.random(), [1, 3] + head)
    return ("strike_bare" if r == 0 else "idle_bare", rnd.random(), [1] + head)
SPEC["crowd"] = _crowd

KIT = {"wood": "wood", "iron": "iron", "leather": "leather", "leather2": "leather2",
       "paint": "shield_paint", "back": "shield_back", "rim": "shield_rim"}


def build(lod=0):
    body = H.Part("body", 0)
    H.head(body, "skin", lod=lod)
    H.neck(body, "skin", r=0.055)
    H.coif(body, "linen_coif", lod=lod)
    for s in ("L", "R"):
        H.leg(body, s, "wool_dye2", segs=8 if lod else 9, thick=0.004, lod=lod)
        H.shoe(body, s, "shoe", segs=6 if lod else 8, lod=lod)
        H.arm(body, s, "levy_wool", segs=7 if lod else 9, thick=0.012, cuff=0.004, lod=lod)
        H.hand(body, s, "skin", segs=6 if lod else 8, lod=lod)
    H.torso(body, "levy_quilt", segs=12 if lod else 16, thick=0.022, z0=0.93, z1=1.47, lod=lod,
            skirt=(0.60, 0.240, 0.200, 2 if lod else 3), n=2.5)
    H.belt(body, "leather2", z=1.05, grow=0.028, segs=12 if lod else 16)
    if not lod:
        H.pouch(body, KIT, "L", z=1.04)
        H.dagger(body, KIT, "R", z=1.04)
    sp = H.Part("spear", 1); H.spear(sp, 1, KIT, length=2.5, grip=0.95, lod=lod)
    cl = H.Part("club", 2); K.club(cl, 2, KIT, lod=lod)
    sh = H.Part("shield", 3); H.heater_shield(sh, 3, KIT, lod=lod)
    helm = H.Part("helm", 4); H.kettle_hat(helm, "iron", segs=12, lod=lod)
    cap = H.Part("cap", 5); K.felt_cap(cap, "felt", lod=lod)
    return [body, sp, cl, sh, helm, cap]
