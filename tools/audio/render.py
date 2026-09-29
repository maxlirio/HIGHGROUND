"""Render every HIGHGROUND sound from scratch into assets/audio/ (AAC .m4a — decodes in Chrome, Safari/WebKit
and Firefox) plus assets/audio/manifest.json, which the runtime engine (js/audio/) loads.

  python tools/audio/render.py              # everything (≈ a few minutes on 10 cores)
  python tools/audio/render.py clash bow    # only sounds whose name starts with one of these
  python tools/audio/render.py --wav        # also keep the mastered 24-bit WAVs in status/audio/wav/

Needs numpy + scipy (a venv is fine) and macOS `afconvert` (or ffmpeg) for AAC.
Mastering: one-shots are normalised to a common MOMENTARY-MAX loudness, loops to a common INTEGRATED loudness,
true peak ≤ -1 dBTP; the runtime mix gains (js/audio/bank.js) then set the balance between kinds.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from multiprocessing import Pool

import numpy as np
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "assets", "audio")

from dsp import SR, hp, make_ir, master, trim_tail, loudness, momentary_max, true_peak_db, fade  # noqa: E402
import sfx_combat as C  # noqa: E402
import sfx_missile as M  # noqa: E402
import sfx_horse as H  # noqa: E402
import sfx_siege as G  # noqa: E402
import sfx_signal as SG  # noqa: E402
import sfx_ambience as A  # noqa: E402
import beds as B  # noqa: E402
import voice as V  # noqa: E402
import sfx_lord as LD  # noqa: E402
import sfx_castle as K  # noqa: E402

ONE = -14.0   # LUFS momentary max for one-shots
LOOP = -20.0  # LUFS integrated for beds
CUE = -16.0   # LUFS integrated for cues

# name: (generator(rng) or generator(rng, ir), variations, kind)   kind: one | loop | cue | ir
SOUNDS = {
    # --- close combat
    "clash": (C.sword_clash, 10, "one"),
    "shield": (C.sword_shield, 8, "one"),
    "bash": (C.shield_bash, 4, "one"),
    "plate": (C.plate_hit, 6, "one"),
    "mail": (C.mail_rattle, 4, "one"),
    "body": (C.body_hit, 6, "one"),
    "shaft": (C.shaft_clack, 4, "one"),
    "grunt": (V.grunt, 10, "one"),
    "cry": (V.cry, 8, "one"),
    "groan": (V.groan, 5, "one"),
    "shout": (V.shout, 8, "one"),
    "warcry_blue": (lambda r: B.warcry(r, "blue"), 3, "one"),
    "warcry_red": (lambda r: B.warcry(r, "red"), 3, "one"),
    "rout_cry": (B.rout_cry, 3, "one"),
    # --- missiles
    "bow": (M.bow_release, 8, "one"),
    "xbow": (M.crossbow_release, 6, "one"),
    "windlass": (B.windlass, 3, "one"),
    "whoosh": (M.arrow_whoosh, 6, "one"),
    "arr_ground": (M.arrow_ground, 6, "one"),
    "arr_shield": (M.arrow_shield, 5, "one"),
    "arr_armour": (M.arrow_armour, 5, "one"),
    "arr_flesh": (M.arrow_flesh, 4, "one"),
    "volley": (M.volley_release, 4, "one"),
    "xvolley": (lambda r: M.volley_release(r, None, True), 3, "one"),
    # --- horses
    "whinny": (H.whinny, 4, "one"),
    "snort": (H.snort, 3, "one"),
    "horse_scream": (H.horse_scream, 4, "one"),
    "cav_impact": (B.cavalry_impact, 4, "one"),
    # --- siege & destruction
    "trebuchet": (K.trebuchet, 3, "one"),
    "mangonel": (G.mangonel, 3, "one"),
    "springald": (lambda r: M.crossbow_release(r, True), 3, "one"),
    "stone_ground": (K.stone_earth, 4, "one"),
    "stone_wall": (K.stone_masonry, 4, "one"),
    "wall_collapse": (G.wall_collapse, 2, "one"),
    "splinter": (G.splinter, 5, "one"),
    "ram": (K.ram_oak, 4, "one"),
    "gate_break": (G.gate_break, 2, "one"),
    "tower_dock": (G.tower_dock, 2, "one"),
    "ladder": (G.ladder, 3, "one"),
    "collapse": (G.building_collapse, 2, "one"),
    "ignite": (G.fire_ignite, 3, "one"),
    "creak": (G.creak, 4, "one"),
    # --- castles and sieges (tools/audio/sfx_castle.py, docs/siege-audio.md)
    "stone_fly": (K.stone_fly, 4, "one"),
    "stone_men": (K.stone_men, 3, "one"),
    "masonry_crack": (K.masonry_crack, 3, "one"),
    "tower_collapse": (K.tower_collapse, 2, "one"),
    "leaves_break": (K.leaves_break, 2, "one"),
    "portcullis_drop": (K.portcullis_drop, 2, "one"),
    "portcullis_raise": (K.portcullis_raise, 1, "one"),
    "portcullis_break": (K.portcullis_break, 2, "one"),
    "ladder_push": (K.ladder_push, 3, "one"),
    "mine_fire": (K.mine_fire, 2, "one"),
    "mine_collapse": (K.mine_collapse, 2, "one"),
    "drop_stone": (K.drop_stone, 4, "one"),
    "drop_sand": (K.drop_sand, 3, "one"),
    "hammer": (K.hammering, 3, "one"),
    "assault_trumpets": (K.assault_trumpets, 2, "one"),
    "bed_belfry": (K.belfry_loop, 1, "loop"),
    "bed_mining": (K.mining_loop, 1, "loop"),
    "bed_wallwalk": (K.wallwalk_loop, 1, "loop"),
    "bed_camp": (K.camp_loop, 1, "loop"),
    "ir_hall": (K.ir_hall, 1, "ir"),
    "ir_passage": (K.ir_passage, 1, "ir"),
    # --- signals (diegetic) and cues (optional music)
    **{f"horn_{c}_{t}": ((lambda c, t: lambda r: SG.horn_call(r, c, t))(c, t), 2, "one")
       for c in SG.CALLS for t in ("blue", "red")},
    "horns_massed": (B.horns_massed, 3, "one"),
    "cue_battle": (SG.cue_battle, 1, "cue"),
    "cue_charge": (SG.cue_charge, 1, "cue"),
    "cue_rout": (SG.cue_rout, 1, "cue"),
    "cue_victory": (SG.cue_victory, 1, "cue"),
    "cue_defeat": (SG.cue_defeat, 1, "cue"),
    # --- ambience one-shots
    "skylark": (A.skylark, 3, "one"),
    "blackbird": (A.blackbird, 4, "one"),
    "chaffinch": (A.chaffinch, 3, "one"),
    "cuckoo": (A.cuckoo, 2, "one"),
    "crow": (A.crow, 4, "one"),
    "anvil": (A.anvil, 3, "one"),
    "axe": (A.axe, 4, "one"),
    "dog": (A.dog, 3, "one"),
    "bell": (A.bell, 1, "one"),
    "cow": (A.cow, 2, "one"),
    "sheep": (A.sheep, 3, "one"),
    # --- beds (looped density layers)
    "bed_surge": (B.din_surge, 1, "loop"),
    "bed_grind": (B.din_grind, 1, "loop"),
    "bed_roar": (B.roar, 1, "loop"),
    "bed_arrows": (B.arrow_storm, 1, "loop"),
    "bed_march": (B.march, 1, "loop"),
    "bed_trot": (lambda r, ir: B.cavalry(r, ir, "trot"), 1, "loop"),
    "bed_gallop": (lambda r, ir: B.cavalry(r, ir, "gallop"), 1, "loop"),
    "bed_rout": (B.rout, 1, "loop"),
    "bed_fire": (B.fire_bed, 1, "loop"),
    "bed_wind": (B.wind_bed, 1, "loop"),
    "bed_after": (B.aftermath, 1, "loop"),
    # --- the lord (the player's avatar): his voice, his blows, his horse and steps, close
    "lord_grunt": (LD.lord_grunt, 5, "one"),
    "lord_cry": (LD.lord_cry, 3, "one"),
    "lord_shout": (LD.lord_shout, 6, "one"),
    "swing": (LD.swing, 6, "one"),
    "couch": (LD.couch, 2, "one"),
    "crunch": (LD.crunch, 4, "one"),
    "lord_gallop": (lambda r, ir: LD.horse_loop(r, ir, "gallop"), 1, "loop"),
    "lord_trot": (lambda r, ir: LD.horse_loop(r, ir, "trot"), 1, "loop"),
    "lord_canter": (lambda r, ir: LD.horse_loop(r, ir, "canter"), 1, "loop"),
    "lord_steps": (LD.steps_loop, 1, "loop"),
    "ir_vale": (None, 1, "ir"),
}


def seed_of(name, k):
    return (sum((i + 1) * ord(c) for i, c in enumerate(name)) * 7919 + k * 104729) % (2 ** 31)


_IR = None


def get_ir():
    global _IR
    if _IR is None:
        _IR = make_ir(np.random.default_rng(424242))
    return _IR


def encode(x, path, stereo):
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    wavfile.write(tmp, SR, x.astype(np.float32))
    br = "160000" if stereo else "96000"
    if shutil.which("afconvert"):
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", br, "-q", "127", tmp, path], check=True, capture_output=True)
    else:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-c:a", "aac", "-b:a", br, path], check=True)
    os.unlink(tmp)


def render_one(job):
    name, k, keep_wav = job
    gen, nvar, kind = SOUNDS[name]
    rng = np.random.default_rng(seed_of(name, k))
    if kind == "ir":
        x = gen(rng) if gen else get_ir()
        x = x / np.max(np.abs(x)) * 0.7  # stored peak-normalised for the codec; the engine restores unit energy
    elif kind == "loop":
        x = gen(rng, get_ir())
    else:
        x = np.asarray(gen(rng), float)
    x = np.nan_to_num(x)
    if kind != "ir":
        x = hp(x, 28, 2)  # nothing useful lives below ~30 Hz; subsonic drift only eats headroom
    if kind == "one":
        x = trim_tail(x)
        x = master(x, ONE, "momentary")
    elif kind == "cue":
        x = trim_tail(fade(x, 0, 0.3))
        x = master(x, CUE, "integrated")
    elif kind == "loop":
        x = master(x, LOOP, "integrated")
    stereo = x.ndim == 2
    fn = f"{name}_{k}.m4a" if nvar > 1 else f"{name}.m4a"
    encode(x, os.path.join(OUT, fn), stereo)
    if keep_wav:
        d = os.path.join(ROOT, "status", "audio", "wav")
        os.makedirs(d, exist_ok=True)
        wavfile.write(os.path.join(d, fn.replace(".m4a", ".wav")), SR, x.astype(np.float32))
    meas = {"tp": round(true_peak_db(x), 2), "mm": round(momentary_max(x), 1), "int": round(loudness(x), 1)}
    return name, k, fn, len(x) / SR, kind, stereo, meas


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keep_wav = "--wav" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    names = [n for n in SOUNDS if not args or any(n.startswith(a) for a in args)]
    jobs = [(n, k, keep_wav) for n in names for k in range(SOUNDS[n][1])]
    jobs.sort(key=lambda j: SOUNDS[j[0]][2] != "loop")  # the long beds first
    man_path = os.path.join(OUT, "manifest.json")
    man = json.load(open(man_path)) if os.path.exists(man_path) else {"sounds": {}}
    got = {}
    with Pool(min(10, os.cpu_count() or 4)) as pool:
        for name, k, fn, dur, kind, stereo, meas in pool.imap_unordered(render_one, jobs):
            got.setdefault(name, {})[k] = (fn, dur, kind, stereo, meas)
            print(f"{fn:28s} {dur:6.2f}s  tp {meas['tp']:6.2f}  M {meas['mm']:6.1f}  I {meas['int']:6.1f}", flush=True)
    for name, vs in got.items():
        ks = sorted(vs)
        man["sounds"][name] = {
            "files": [vs[k][0] for k in ks], "dur": [round(vs[k][1], 3) for k in ks],
            "kind": vs[ks[0]][2], "stereo": vs[ks[0]][3], "meas": [vs[k][4] for k in ks],
        }
    man["sounds"] = {k: man["sounds"][k] for k in SOUNDS if k in man["sounds"]}
    man["sr"] = SR
    man["targets"] = {"one": ONE, "loop": LOOP, "cue": CUE, "truePeak": -1.0}
    json.dump(man, open(man_path, "w"), indent=1)
    tot = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f"manifest: {len(man['sounds'])} sounds, {sum(len(s['files']) for s in man['sounds'].values())} files, {tot / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
