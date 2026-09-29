"""Pack the raw VAT a bake writes (<arm>_vat.bin, uint16 RGBA) into the small file the game downloads.

    python3 tools/vat_pack.py [arm ...] [tol=0.5]      (default: every arm that still has a <arm>_vat.bin)

tools/vat_bake.py runs this itself after each bake; horse bakes (assets/src/units/horse.py) need it run by hand.
Until an arm is packed the game still plays its raw .bin (js/render/figures.js reads whichever the json names).

Encoding "hgv1" (docs/units-pipeline.md), one gzip stream <arm>_vat.hgz, T = frames x nVerts texels:
    refs:      every frame f is predicted from an earlier reference frame refs[f] (json; -1 = from zero). Usually
               f - 1, but a clip variant (idle_bare, walk_pollaxe, press_club...) mostly repeats its base clip's legs
               and body, so the encoder picks whichever earlier frame costs fewest bits.
    positions: each channel quantised to 16 bits in bounds (as the bake writes it), then the low `shift` bits dropped:
               shift is the largest that keeps the error under tol mm (default 0.5 mm; the game rebuilds the dropped
               bits at their midpoint). Stored as the change from the reference frame, minus the same change of the
               previous vertex (neighbouring vertices ride the same bone), zig-zagged int16, low bytes then high
               bytes, x then y then z: 6T bytes.
    normals:   the bake's 8+8-bit octahedral normal, lossless: each byte's change from the reference frame
               (mod 256), x bytes then y bytes: 2T bytes.
Every value is checked by decoding it back before the .bin is removed. Also, since the figures take position and
normal from the VAT alone: the GLB's NORMAL attributes are dropped, and the painted atlas PNGs (<arm>_col/_rough.png,
already embedded in the GLB, never loaded by the game) are moved out of the shipped folder to assets/units-atlas/.
"""
import gzip, json, math, os, struct, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNITS = os.path.join(ROOT, "assets", "units")
ATLAS = os.path.join(ROOT, "assets", "units-atlas")


def zig(x): return ((x << 1) ^ (x >> 31)) & 0xFFFF


def residuals(p, nb, f, r):
    """frame f against reference r: (vertex-differenced position change (V, 3), normal byte change (V, 2))"""
    dt = p[f] - p[r] if r >= 0 else p[f].copy()
    dd = dt.copy(); dd[1:] -= dt[:-1]
    return dd, (nb[f] - nb[r] if r >= 0 else nb[f].copy())


def choose_refs(p, nb, clips):
    """per frame, the earlier frame that predicts it in the fewest (estimated) bits: the previous frame, the same frame
    of every earlier clip, and the six nearest earlier poses (by a coarse L1 over every 7th vertex)"""
    F = p.shape[0]; refs = list(range(-1, F - 1)); sub = p[:, ::7].astype(np.int64)
    cost = lambda dd, nd: np.log2(1 + np.abs(dd)).sum() + 2 * np.count_nonzero(nd)
    cl = sorted(clips.values(), key=lambda c: c["start"])
    for c in cl:
        for k in range(c["frames"]):
            f = c["start"] + k
            if f == 0: continue
            cands = [f - 1] + [b["start"] + k for b in cl if b["start"] < c["start"] and k < b["frames"]]
            if f > 1: cands += np.argsort(np.abs(sub[:f] - sub[f]).sum((1, 2)))[:6].tolist()
            best = min(dict.fromkeys(int(x) for x in cands), key=lambda r: cost(*residuals(p, nb, f, r)))
            refs[f] = best
    return refs


def encode(tex, shift, refs):
    """tex (F, V, 4) uint16 -> hgv1 payload bytes"""
    p = tex[..., :3].astype(np.int32) >> shift
    n = tex[..., 3].astype(np.int32); nb = np.stack([n >> 8, n & 255], -1)
    dd = np.empty_like(p); nd = np.empty_like(nb)
    for f, r in enumerate(refs): dd[f], nd[f] = residuals(p, nb, f, r)
    dd = ((dd + 32768) & 0xFFFF) - 32768             # int16 wrap (decoded mod 2^16)
    z = zig(dd).astype(np.uint16); nd &= 255
    out = []
    for c in range(3): out += [(z[..., c] & 255).astype(np.uint8).tobytes(), (z[..., c] >> 8).astype(np.uint8).tobytes()]
    out += [nd[..., 0].astype(np.uint8).tobytes(), nd[..., 1].astype(np.uint8).tobytes()]
    return b"".join(out)


def decode(buf, F, V, shift, refs):
    """the game's decoder (js/render/figures.js unpackVat), in numpy: payload -> (F, V, 4) uint16"""
    T = F * V; b = np.frombuffer(buf, np.uint8).astype(np.int64)
    half = (1 << (shift - 1)) if shift else 0
    p = np.zeros((F, V, 3), np.int64); nb = np.zeros((F, V, 2), np.int64)
    z = np.stack([(b[2 * c * T:(2 * c + 1) * T] | (b[(2 * c + 1) * T:(2 * c + 2) * T] << 8)).reshape(F, V) for c in range(3)], -1)
    dt = np.cumsum((z >> 1) ^ -(z & 1), 1)
    nd = np.stack([b[6 * T:7 * T].reshape(F, V), b[7 * T:8 * T].reshape(F, V)], -1)
    for f, r in enumerate(refs):
        p[f] = ((p[r] if r >= 0 else 0) + dt[f]) & 0xFFFF
        nb[f] = ((nb[r] if r >= 0 else 0) + nd[f]) & 255
    out = np.zeros((F, V, 4), np.int64)
    out[..., :3] = (p << shift) + half; out[..., 3] = (nb[..., 0] << 8) | nb[..., 1]
    assert out.max() <= 65535
    return out.astype(np.uint16)


def strip_glb_normals(path):
    """drop the NORMAL attributes from a GLB (the figure shader takes its normals from the VAT); returns bytes saved"""
    b = open(path, "rb").read()
    jl = struct.unpack("<I", b[12:16])[0]; j = json.loads(b[20:20 + jl])
    bl = struct.unpack("<I", b[20 + jl:24 + jl])[0]; binc = b[28 + jl:28 + jl + bl]
    prims = [p for m in j["meshes"] for p in m["primitives"]]
    if not any("NORMAL" in p["attributes"] for p in prims): return 0
    for p in prims: p["attributes"].pop("NORMAL", None)
    used_acc = sorted({a for p in prims for a in list(p["attributes"].values()) + ([p["indices"]] if "indices" in p else [])})
    amap = {o: k for k, o in enumerate(used_acc)}
    for p in prims:
        p["attributes"] = {k: amap[a] for k, a in p["attributes"].items()}
        if "indices" in p: p["indices"] = amap[p["indices"]]
    j["accessors"] = [j["accessors"][o] for o in used_acc]
    used_bv = sorted({a["bufferView"] for a in j["accessors"]} | {im["bufferView"] for im in j.get("images", []) if "bufferView" in im})
    vmap = {o: k for k, o in enumerate(used_bv)}; views = []; blob = bytearray()
    for o in used_bv:
        v = dict(j["bufferViews"][o]); data = binc[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]
        while len(blob) % 4: blob.append(0)
        v["byteOffset"] = len(blob); blob += data; views.append(v)
    while len(blob) % 4: blob.append(0)
    for a in j["accessors"]: a["bufferView"] = vmap[a["bufferView"]]
    for im in j.get("images", []):
        if "bufferView" in im: im["bufferView"] = vmap[im["bufferView"]]
    j["bufferViews"] = views; j["buffers"][0]["byteLength"] = len(blob)
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)) + struct.pack("<II", len(js), 0x4E4F534A) + js \
        + struct.pack("<II", len(blob), 0x004E4942) + bytes(blob)
    open(path, "wb").write(out)
    return len(b) - len(out)


def pack(arm, tol_mm):
    jp, bp = os.path.join(UNITS, f"{arm}_vat.json"), os.path.join(UNITS, f"{arm}_vat.bin")
    meta = json.load(open(jp)); V = sum(meta["verts"]); F = meta["frames"]
    raw = np.fromfile(bp, "<u2"); tex = raw[:F * V * 4].reshape(F, V, 4)
    ext = max(np.array(meta["bounds"]["max"]) - np.array(meta["bounds"]["min"]))   # metres over 65535 steps
    step0 = ext / 65535 * 1000                                                      # mm
    shift = max(0, min(8, int(math.floor(math.log2(2 * tol_mm / step0))))) if tol_mm > 0 else 0
    p = tex[..., :3].astype(np.int32) >> shift; n = tex[..., 3].astype(np.int32)
    refs = choose_refs(p, np.stack([n >> 8, n & 255], -1), meta["clips"])
    payload = encode(tex, shift, refs)
    back = decode(payload, F, V, shift, refs)
    err = np.abs(back[..., :3].astype(np.int64) - tex[..., :3].astype(np.int64)).max() * step0
    assert err <= tol_mm + 1e-6 or shift == 0, (arm, err)
    assert (back[..., 3] == tex[..., 3]).all(), arm + ": normals must round-trip exactly"
    name = f"{arm}_vat.hgz"
    with open(os.path.join(UNITS, name), "wb") as fh: fh.write(gzip.compress(payload, 9, mtime=0))
    meta["vat"] = {"file": name, "enc": "hgv1", "shift": shift, "errMm": round(float(err), 3), "refs": refs}
    with open(jp, "w") as fh: json.dump(meta, fh, indent=1)
    os.remove(bp)
    os.makedirs(ATLAS, exist_ok=True)
    for k in ("col", "rough"):
        src = os.path.join(UNITS, f"{arm}_{k}.png")
        if os.path.exists(src): os.replace(src, os.path.join(ATLAS, f"{arm}_{k}.png"))
    glb = strip_glb_normals(os.path.join(UNITS, f"{arm}.glb"))
    size = os.path.getsize(os.path.join(UNITS, name))
    print(f"HG_VATPACK {arm}: {raw.nbytes / 1e6:.2f} MB -> {size / 1e6:.2f} MB  shift {shift} (max err {err:.3f} mm), "
          f"{sum(r != f - 1 for f, r in enumerate(refs))}/{F} frames off another clip; glb -{glb / 1e3:.0f} kB")


def main(argv):
    tol = 0.5; arms = []
    for a in argv:
        if a.startswith("tol="): tol = float(a[4:])
        else: arms.append(a)
    if not arms: arms = sorted(f[:-8] for f in os.listdir(UNITS) if f.endswith("_vat.bin"))
    for a in arms: pack(a, tol)


if __name__ == "__main__":
    main(sys.argv[1:])
