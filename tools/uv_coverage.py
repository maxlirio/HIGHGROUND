"""Estimate baked-texture coverage of each asset's LOD0 mesh.

  python3 tools/uv_coverage.py [assets/glb/*.glb] [--below 0.15]

Coverage = sum of UV-triangle areas of the <name>_LOD0 mesh (the one carrying the baked
atlas), as a fraction of the unit UV square.  Assets baked before the pack_islands fix in
_lib.finish() sit at ~2% and look blurry; freshly baked ones reach ~40%.
Pure numpy: parses the GLB directly, no Blender needed.
"""
import json, struct, sys, glob, os
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    b = open(path, "rb").read()
    magic, ver, total = struct.unpack_from("<4sII", b, 0)
    assert magic == b"glTF", path
    off = 12; js = None; binc = None
    while off < total:
        ln, typ = struct.unpack_from("<II", b, off); off += 8
        chunk = b[off:off + ln]; off += ln
        if typ == 0x4E4F534A: js = json.loads(chunk)
        elif typ == 0x004E4942: binc = chunk
    return js, binc


def accessor(js, binc, i):
    a = js["accessors"][i]; bv = js["bufferViews"][a["bufferView"]]
    dt = np.dtype(CT[a["componentType"]]); n = NC[a["type"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", 0) or dt.itemsize * n
    raw = np.frombuffer(binc, dtype=np.uint8, count=stride * (a["count"] - 1) + dt.itemsize * n, offset=start)
    rows = np.lib.stride_tricks.as_strided(raw, (a["count"], dt.itemsize * n), (stride, 1))
    out = np.ascontiguousarray(rows).view(dt).reshape(a["count"], n)
    if a.get("normalized") and dt != np.float32:
        out = out.astype(np.float32) / np.iinfo(dt).max
    return out.astype(np.float64)


def coverage(path):
    js, binc = read_glb(path)
    mats = [m.get("name", "") for m in js.get("materials", [])]
    lod0 = [n for n in js.get("nodes", []) if n.get("name", "").endswith("_LOD0") and "mesh" in n]
    if not lod0:  # fall back to every mesh
        lod0 = [n for n in js.get("nodes", []) if "mesh" in n]
    prims = [p for n in lod0 for p in js["meshes"][n["mesh"]]["primitives"]]
    # only the baked atlas counts (leaf cards etc. use tiling atlases of their own)
    baked = [p for p in prims if "material" in p and mats[p["material"]].endswith("_baked")]
    area = 0.0
    for p in baked or prims:
        if "TEXCOORD_0" not in p["attributes"] or p.get("mode", 4) != 4: continue
        uv = accessor(js, binc, p["attributes"]["TEXCOORD_0"])
        idx = accessor(js, binc, p["indices"]).astype(np.int64).ravel() if "indices" in p \
            else np.arange(len(uv))
        t = uv[idx.reshape(-1, 3)]
        e1 = t[:, 1] - t[:, 0]; e2 = t[:, 2] - t[:, 0]
        area += 0.5 * np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]).sum()
    return area


def main():
    args = sys.argv[1:]; below = 0.15
    if "--below" in args:
        i = args.index("--below"); below = float(args[i + 1]); del args[i:i + 2]
    here = os.path.dirname(os.path.abspath(__file__))
    files = args or sorted(glob.glob(os.path.join(here, "..", "assets", "glb", "*.glb")))
    low = []
    for f in files:
        c = coverage(f); name = os.path.splitext(os.path.basename(f))[0]
        flag = "  LOW" if c < below else ""
        print(f"{name:28s} {c * 100:6.1f}%{flag}")
        if c < below: low.append(name)
    print(f"\n{len(low)} below {below * 100:.0f}%: {' '.join(low)}")


if __name__ == "__main__":
    main()
