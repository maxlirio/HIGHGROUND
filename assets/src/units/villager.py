"""Villager: wool tunic to the knee, belted; hose; turnshoes; a hood-and-cape (chaperon) in the
team's colour; and the kit for his JOB (the engine switches parts per man, js/render/figures.js VILLAGER_JOBS):
hoe, felling axe, pick, mallet + stake, sickle, sack, pail or fishing rod. Clips: _work_anims.py.

    blender -b -t 5 -P tools/vat_bake.py -- villager [sheet] [close] [gripcheck] [booth]
"""
import _human as H
import _work_kit as K
import _work_anims  # noqa: F401  (registers the "tool" clip family)
from _arms_kit import ground_rig

SPEC = {
    "family": "tool",
    "parts": {"hoe": 1, "axe": 2, "pick": 3, "mallet": 4, "stake": 5, "sickle": 6, "sack": 7, "pail": 8, "rod": 9},
    "tex": 1024,
    "rig": ground_rig,          # the planted stake (part 5) hangs on a parentless "ground" bone
    # undyed, oatmeal, russet, madder, faded woad, dun green, brown, grey
    "dyes": {"d1": ["a39478", "b7aa8c", "7b4b33", "8d4b3b", "5b6b7d", "5d6443", "5f4a37", "7d7a72"],
             "d2": ["5b4634", "6e6a62", "6f4430", "4d5238", "948670", "4e5a6a"]},
    "booth_parts": [2],
    # which kit the pose sheets show for each clip (the loadout that plays it)
    "clip_parts": {"idle": [1], "walk": [3], "run": [2], "strike": [2], "fall": [1], "idle_hand": [6], "walk_hand": [6],
                   "idle_talk": [], "idle_pail": [8], "walk_pail": [8], "walk_carry": [7], "work_hoe": [1], "work_axe": [2],
                   "work_pick": [3], "work_mallet": [4, 5], "work_sickle": [6], "work_fish": [9], "work_adept": [],
                   "work_bucket": [8]},
    "lineup": [("work_axe", 0.40, [2]), ("work_axe", 0.52, [2]), ("work_hoe", 0.30, [1]), ("work_pick", 0.38, [3]),
               ("work_pick", 0.50, [3]), ("work_mallet", 0.42, [4, 5]), ("work_sickle", 0.5, [6]), ("work_fish", 0.6, [9]),
               ("work_bucket", 0.52, [8]), ("walk_carry", 0.2, [7]), ("walk", 0.6, [1]), ("work_adept", 0.3, [])],
}

def _crowd(r, c, rnd):
    k = rnd.random()
    for p, clip, parts in ((0.18, "work_hoe", [1]), (0.34, "work_axe", [2]), (0.48, "work_pick", [3]), (0.58, "work_mallet", [4, 5]),
                           (0.68, "work_sickle", [6]), (0.78, "walk_carry", [7]), (0.86, "walk", [1]), (0.93, "idle_talk", [])):
        if k < p: return (clip, rnd.random(), parts)
    return ("walk_pail", rnd.random(), [8])
SPEC["crowd"] = _crowd

KIT = {"wood": "wood", "iron": "iron", "leather": "leather", "leather2": "leather2", "wood_dark": "wood_dark",
       "bag": "bag", "pail": "pail", "string": "string"}


def build(lod=0):
    body = H.Part("body", 0)
    H.head(body, "skin", lod=lod)
    H.neck(body, "skin", r=0.055)
    for s in ("L", "R"):
        H.leg(body, s, "wool_dye2", segs=8 if lod else 10, thick=0.004, lod=lod)
        H.shoe(body, s, "shoe", segs=6 if lod else 8, lod=lod)
        H.arm(body, s, "wool_dye1", segs=7 if lod else 10, thick=0.010, cuff=0.004, lod=lod)
        H.hand(body, s, "skin", segs=6 if lod else 8, lod=lod)
    H.torso(body, "wool_dye1", segs=12 if lod else 18, thick=0.014, z0=0.93, z1=1.47, lod=lod, table=H.TUNIC,
            skirt=(0.50, 0.245, 0.205, 2 if lod else 4))
    H.hood(body, "wool_team", lod=lod)
    H.belt(body, "leather", z=1.035, grow=0.019, segs=12 if lod else 18, table=H.TUNIC)
    if not lod:
        H.pouch(body, KIT, "L", z=1.03)
        H.dagger(body, KIT, "R", z=1.02)
    parts = [body]
    for name, pid, fn in (("hoe", 1, H.hoe), ("axe", 2, K.axe), ("pick", 3, K.pick), ("mallet", 4, K.mallet),
                          ("sickle", 6, K.sickle), ("pail", 8, K.pail), ("rod", 9, K.rod)):
        p = H.Part(name, pid); fn(p, pid, KIT, lod=lod); parts.append(p)
    for name, pid, fn in (("stake", 5, K.stake), ("sack", 7, K.sack)):
        p = H.Part(name, pid); fn(p, pid, KIT, lod=lod); parts.append(p)
    return parts
