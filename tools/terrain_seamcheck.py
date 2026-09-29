"""Seam check for terrain sets: is the wrap edge step unusual compared with EVERY interior
row/column step? Prints the percentile of the wrap step among interior steps (per map, per axis).
A real seam sits at ~100th percentile AND ratio >> 1. Plain python + numpy (reads the PNGs).
  python3 tools/terrain_seamcheck.py [--family B-mineral] [names...]"""
import sys, os, json, glob, zlib, struct
import numpy as np
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TD = os.path.join(ROOT, "assets", "terrain")


def read_png(p):
    d = open(p, "rb").read(); pos = 8; idat = b""
    while pos < len(d):
        n, = struct.unpack(">I", d[pos:pos + 4]); tag = d[pos + 4:pos + 8]; body = d[pos + 8:pos + 8 + n]
        if tag == b"IHDR":
            w, h, bits, ct = struct.unpack(">IIBB", body[:10])
        elif tag == b"IDAT":
            idat += body
        pos += 12 + n
    ch = {0: 1, 2: 3, 6: 4}[ct]; bpp = ch * bits // 8
    raw = zlib.decompress(idat); stride = w * bpp
    out = np.zeros((h, stride), np.int32); prev = np.zeros(stride, np.int32); i = 0
    for r in range(h):
        f = raw[i]; line = np.frombuffer(raw[i + 1:i + 1 + stride], np.uint8).astype(np.int32); i += 1 + stride
        if f == 0: cur = line
        elif f == 2: cur = (line + prev) & 255
        else:  # generic (sub/avg/paeth) – slow path
            cur = np.zeros(stride, np.int32)
            for x in range(stride):
                a = cur[x - bpp] if x >= bpp else 0; b = prev[x]; c = prev[x - bpp] if x >= bpp else 0
                if f == 1: pr = a
                elif f == 3: pr = (a + b) // 2
                else:
                    pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                    pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                cur[x] = (line[x] + pr) & 255
        out[r] = cur; prev = cur
    if bits == 16:
        out = (out[:, 0::2] << 8) | out[:, 1::2]
        return out.reshape(h, w, ch).astype(np.float64) / 65535
    return out.reshape(h, w, ch).astype(np.float64) / 255


def check(a):
    a = a.mean(-1)
    res = []
    for ax in (0, 1):
        b = a if ax == 1 else a.T
        steps = np.abs(np.diff(b, axis=1)).mean(0)          # per interior column boundary
        wrap = np.abs(b[:, 0] - b[:, -1]).mean()
        res.append((float((steps < wrap).mean() * 100), float(wrap / steps.mean())))
    return res


if __name__ == "__main__":
    args = sys.argv[1:]; fam = None
    if "--family" in args:
        i = args.index("--family"); fam = args[i + 1]; del args[i:i + 2]
    names = args or [json.load(open(p))["name"] for p in sorted(glob.glob(os.path.join(TD, "*.json")))
                     if fam is None or json.load(open(p)).get("family") == fam]
    bad = 0
    for n in names:
        row = []
        for k in ("albedo", "height", "normal"):
            r = check(read_png(os.path.join(TD, f"{n}_{k}.png")))
            worst = max(r, key=lambda t: t[1])
            flag = worst[0] > 99.5 and worst[1] > 1.6
            bad += flag
            row.append(f"{k}:p{worst[0]:5.1f} x{worst[1]:4.2f}{' SEAM' if flag else ''}")
        print(f"{n:22s} " + "  ".join(row))
    print("SEAMS FLAGGED:", bad)
