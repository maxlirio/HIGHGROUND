"""HIGHGROUND units — texture painting in numpy.

Instead of Cycles-baking node trees, every texel of the unit's atlas is rasterised back to its rest
position P, normal N, pattern coords (the per-vertex 'pat' attribute) and material, and a Python
material function paints it. That keeps colour, roughness and the TEAM/DYE MASK in lock-step (a
paint chip on a shield is both wood-coloured and unmasked). Cycles is only used for AO.

Mask channels (assets/units/<arm>_mask.png, linear):
    R = team field colour     (surcoat, hood, shield field)   -> tinted with the team's banner colour
    G = team accent colour    (shield charge)                 -> tinted with the banner's accent
    B = 1.0 dye 1 (tunic/gambeson), 0.5 dye 2 (hose)          -> tinted per man from the arm's palette
Masked areas are painted NEUTRAL (sRGB ~0.70, linear NEUTRAL_LIN); the shader does
    albedo * tint / NEUTRAL_LIN   so the weave, dirt and AO survive the tint.
"""
import numpy as np, math

NEUTRAL_SRGB = 0.70
NEUTRAL_LIN = ((NEUTRAL_SRGB + 0.055) / 1.055) ** 2.4


# ------------------------------------------------------------------------------------------ noise
def _h(ix, iy, iz, seed):
    n = ix * 374761393 + iy * 668265263 + iz * 1440662683 + seed * 1013904223
    n = (n ^ (n >> 13)) * 1274126177
    n = n ^ (n >> 16)
    return (n & 0xFFFF).astype(np.float64) / 65535.0

def vnoise(p, seed=0):
    p = np.asarray(p, np.float64)
    i = np.floor(p).astype(np.int64); f = p - i; u = f * f * (3 - 2 * f)
    x, y, z = i[:, 0], i[:, 1], i[:, 2]
    def g(dx, dy, dz): return _h(x + dx, y + dy, z + dz, seed)
    ux, uy, uz = u[:, 0], u[:, 1], u[:, 2]
    a = g(0, 0, 0) * (1 - ux) + g(1, 0, 0) * ux
    b = g(0, 1, 0) * (1 - ux) + g(1, 1, 0) * ux
    c = g(0, 0, 1) * (1 - ux) + g(1, 0, 1) * ux
    d = g(0, 1, 1) * (1 - ux) + g(1, 1, 1) * ux
    return (a * (1 - uy) + b * uy) * (1 - uz) + (c * (1 - uy) + d * uy) * uz

def fbm(p, scale, oct=4, seed=0, lac=2.03, gain=0.5):
    p = np.asarray(p) * scale; s = 0.0; a = 1.0; tot = 0.0
    for o in range(oct):
        s = s + a * vnoise(p, seed + o * 17); tot += a; a *= gain; p = p * lac + 3.7
    return s / tot

def sst(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def hexc(h):
    h = h.lstrip("#"); return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


# ------------------------------------------------------------------------------------------ raster
def rasterize(me, uvname, S):
    """-> tri index per texel (-1 empty) and barycentrics; plus tri->verts/mat arrays."""
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    loops = np.zeros(nt * 3, np.int64); me.loop_triangles.foreach_get("loops", loops)
    verts = np.zeros(nt * 3, np.int64); me.loop_triangles.foreach_get("vertices", verts)
    mats = np.zeros(nt, np.int64); me.loop_triangles.foreach_get("material_index", mats)
    uv = np.zeros(len(me.loops) * 2); me.uv_layers[uvname].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)[loops].reshape(nt, 3, 2) * S
    tid = -np.ones((S, S), np.int64); bary = np.zeros((S, S, 3))
    for t in range(nt):
        a, b, c = uv[t]
        x0 = max(int(math.floor(min(a[0], b[0], c[0]) - 1)), 0); x1 = min(int(math.ceil(max(a[0], b[0], c[0]) + 1)), S - 1)
        y0 = max(int(math.floor(min(a[1], b[1], c[1]) - 1)), 0); y1 = min(int(math.ceil(max(a[1], b[1], c[1]) + 1)), S - 1)
        if x1 < x0 or y1 < y0: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12: continue
        l0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        l1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        l2 = 1 - l0 - l1
        ins = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
        if not ins.any(): continue
        yy = ys[ins].astype(np.int64); xx = xs[ins].astype(np.int64)
        tid[yy, xx] = t
        bary[yy, xx] = np.stack([l0[ins], l1[ins], l2[ins]], -1).clip(0, 1)
    # dilate into the gutters so mips and bilinear never pull in empty texels
    for _ in range(6):
        empty = tid < 0
        if not empty.any(): break
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            src = np.roll(np.roll(tid, dy, 0), dx, 1); sb = np.roll(np.roll(bary, dy, 0), dx, 1)
            m = empty & (src >= 0)
            tid[m] = src[m]; bary[m] = sb[m]; empty = tid < 0
    return tid, bary, verts.reshape(nt, 3), mats


def texel_attrs(me, tid, bary, tverts):
    """rest position, normal and pat for every covered texel."""
    nv = len(me.vertices)
    co = np.zeros(nv * 3); me.vertices.foreach_get("co", co); co = co.reshape(nv, 3)
    no = np.zeros(nv * 3); me.vertex_normals.foreach_get("vector", no); no = no.reshape(nv, 3)
    pat = np.zeros(nv * 3); me.attributes["pat"].data.foreach_get("vector", pat); pat = pat.reshape(nv, 3)
    m = tid >= 0
    t = tid[m]; b = bary[m]; vv = tverts[t]
    def interp(A): return (A[vv[:, 0]] * b[:, :1] + A[vv[:, 1]] * b[:, 1:2] + A[vv[:, 2]] * b[:, 2:3])
    N = interp(no); N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-9
    # pat is a per-part quantity: take the dominant vertex, not a blend (shield face vs back = 1 vs 2)
    dom = vv[np.arange(len(vv)), np.argmax(b, 1)]
    return m, interp(co), N, interp(pat), pat[dom]


# ------------------------------------------------------------------------------------------ materials
# each painter: (P, N, pat, patd) -> rgb (n,3 sRGB), rough (n,), mask (n,3)
def _out(n): return np.zeros((n, 3)), np.full(n, 0.8), np.zeros((n, 3))

def cloth(P, base, var=0.10, weave=0.035, seed=1, dirt=1.0, scale_mid=22.0):
    n = len(P)
    big = fbm(P, 2.2, 3, seed) - 0.5
    mid = fbm(P, scale_mid, 3, seed + 5) - 0.5
    fine = vnoise(P * np.array([420, 420, 160]), seed + 9) - 0.5          # yarn / weave slubs
    folds = vnoise(P * np.array([34.0, 34.0, 2.6]), seed + 13) - 0.5   # long hanging folds: vertical light/dark streaks
    k = 1 + var * 1.8 * big + var * 1.1 * mid + weave * 2 * fine + 0.16 * folds
    rgb = np.clip(base[None, :] * k[:, None], 0, 1)
    # grime: mud splashed up from the ground, darker in the lower 45 cm, sweat/soot higher up
    z = P[:, 2]
    mud = sst(0.55, 0.05, z) * (0.45 + 0.55 * fbm(P, 9, 3, seed + 21)) * dirt
    soot = (fbm(P, 5, 3, seed + 31) - 0.55).clip(0, 1) * 0.6
    MUD = hexc("5a4632")
    rgb = rgb * (1 - 0.55 * mud[:, None]) + MUD[None, :] * 0.55 * mud[:, None]
    rgb *= (1 - soot)[:, None]
    return rgb, mud

def neutral_cloth(P, seed, dirt=1.0, var=0.10):
    rgb, mud = cloth(P, np.full(3, NEUTRAL_SRGB), var, 0.04, seed, dirt)
    return rgb, mud

def paint_skin(P, N, pat, patd):
    n = len(P); rgb, rough, mask = _out(n)
    from _human import HEAD_C
    base = hexc("b98569")
    blot = fbm(P, 14, 3, 3) - 0.5
    rgb[:] = base * (1 + 0.14 * blot)[:, None]
    d = P - np.array(HEAD_C)
    onhead = P[:, 2] > 1.45
    front = sst(0.0, -0.06, d[:, 1]) * onhead
    # weathered, ruddy nose and cheeks
    ruddy = np.exp(-((np.abs(d[:, 0]) - 0.035) / 0.03) ** 2 - ((d[:, 2] + 0.03) / 0.03) ** 2) * front
    ruddy += np.exp(-(d[:, 0] / 0.015) ** 2 - ((d[:, 2] + 0.025) / 0.025) ** 2) * front * 0.7
    rgb = rgb * (1 - 0.25 * ruddy[:, None]) + hexc("a85a48")[None] * 0.25 * ruddy[:, None]
    # stubble / short beard over jaw, chin and upper lip
    beard = sst(-0.035, -0.07, d[:, 2]) * sst(0.07, 0.02, np.abs(d[:, 1] - 0.02) * 0 + d[:, 1] + 0.06) * onhead
    beard = np.clip(beard + np.exp(-(d[:, 0] / 0.03) ** 2 - ((d[:, 2] + 0.045) / 0.008) ** 2) * front, 0, 1)
    beard *= 0.55 + 0.45 * vnoise(P * 300, 7)
    rgb = rgb * (1 - 0.62 * beard[:, None]) + hexc("3e3027")[None] * 0.62 * beard[:, None]
    # eyes: dark sockets, brows
    for sx in (-1, 1):
        e = np.exp(-((d[:, 0] - sx * 0.032) / 0.013) ** 2 - ((d[:, 2] - 0.002) / 0.007) ** 2) * front
        rgb *= (1 - 0.55 * e)[:, None]
        br = np.exp(-((d[:, 0] - sx * 0.034) / 0.018) ** 2 - ((d[:, 2] - 0.017) / 0.005) ** 2) * front
        rgb = rgb * (1 - 0.6 * br[:, None]) + hexc("3a2c22")[None] * 0.6 * br[:, None]
    lips = np.exp(-(d[:, 0] / 0.018) ** 2 - ((d[:, 2] + 0.060) / 0.005) ** 2) * front
    rgb = rgb * (1 - 0.3 * lips[:, None]) + hexc("8a4c42")[None] * 0.3 * lips[:, None]
    # hands: grubby knuckles
    hands = P[:, 2] < 1.0
    rgb[hands] *= (0.86 + 0.14 * fbm(P[hands], 30, 2, 11))[:, None]
    rough[:] = 0.62
    return rgb, rough, mask

def paint_wool_dye1(P, N, pat, patd):
    rgb, mud = neutral_cloth(P, 41)
    n = len(P); mask = np.zeros((n, 3)); mask[:, 2] = 1.0   # masks stay exact: mud lives in the albedo (a weakened B channel slips out of its dye band)
    return rgb, np.full(n, 0.92), mask

def paint_wool_dye2(P, N, pat, patd):
    rgb, mud = neutral_cloth(P, 43, dirt=1.4)
    n = len(P); mask = np.zeros((n, 3)); mask[:, 2] = 0.5
    # knees and seat worn
    return rgb, np.full(n, 0.92), mask

def paint_wool_team(P, N, pat, patd):
    rgb, mud = neutral_cloth(P, 47, dirt=0.4)
    n = len(P); mask = np.zeros((n, 3)); mask[:, 0] = 1.0
    return rgb, np.full(n, 0.9), mask

def paint_linen_coif(P, N, pat, patd):
    rgb, mud = cloth(P, hexc("c9bea4"), 0.08, 0.03, 51, 0.3)
    return rgb, np.full(len(P), 0.85), np.zeros((len(P), 3))

def paint_gambeson(P, N, pat, patd):
    """quilted linen: vertical channels on the body and skirt, rings round the sleeves; stitch lines
    darker, the puffed channels lighter. A team-coloured cross is sewn on breast and back."""
    n = len(P)
    rgb, mud = neutral_cloth(P, 61, dirt=0.8, var=0.08)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    sleeve = np.abs(x) > 0.205
    ang = np.arctan2(y, x)
    u = np.where(sleeve, z / 0.045, ang * 0.17 / 0.042)
    ph = np.abs((u % 1.0) - 0.5) * 2                 # 0 at stitch, 1 mid-channel
    puff = sst(0.0, 0.5, ph)
    k = 0.80 + 0.22 * puff
    k *= 1 + 0.05 * (vnoise(P * 60, 63) - 0.5)
    rgb *= k[:, None]
    mask = np.zeros((n, 3)); mask[:, 2] = 1.0
    # field-sign cross (St George style) on breast and back
    torso = ~sleeve & (z > 1.05) & (z < 1.46)
    cx = np.abs(x) < 0.028; cz = np.abs(z - 1.315) < 0.026
    cross = torso & (((cx & (z > 1.10) & (z < 1.44)) | (cz & (np.abs(x) < 0.115))))
    cross &= np.abs(y) > 0.03
    rgb[cross] = neutral_cloth(P[cross], 67, dirt=0.3, var=0.06)[0] * 1.02
    mask[cross] = (0.95, 0, 0)
    return rgb, np.full(n, 0.9), mask

def paint_leather(P, N, pat, patd, base="4a3322"):
    n = len(P)
    b = hexc(base)
    k = 1 + 0.25 * (fbm(P, 18, 3, 71) - 0.5) + 0.12 * (vnoise(P * 150, 73) - 0.5)
    rgb = np.clip(b[None] * k[:, None], 0, 1)
    scuff = (fbm(P, 40, 2, 77) - 0.6).clip(0, 1) * 1.6
    rgb = rgb * (1 - scuff[:, None]) + (b * 1.6)[None] * scuff[:, None]
    mud = sst(0.08, 0.0, P[:, 2]) * 0.7
    rgb = rgb * (1 - mud[:, None]) + hexc("4e3e2c")[None] * mud[:, None]
    return rgb, np.full(n, 0.62) - 0.15 * scuff, np.zeros((n, 3))

def paint_leather2(P, N, pat, patd): return paint_leather(P, N, pat, patd, "6e4c30")
def paint_shoe(P, N, pat, patd):
    rgb, r, m = paint_leather(P, N, pat, patd, "3a2a1d")
    mud = sst(0.07, 0.0, P[:, 2]) * (0.5 + 0.5 * fbm(P, 30, 2, 79))
    rgb = rgb * (1 - 0.6 * mud[:, None]) + hexc("574530")[None] * 0.6 * mud[:, None]
    return rgb, r, m

def paint_iron(P, N, pat, patd):
    n = len(P)
    base = hexc("45443f")
    k = 1 + 0.18 * (fbm(P, 25, 3, 81) - 0.5)
    rgb = base[None] * k[:, None]
    rust = (fbm(P, 16, 4, 83) - 0.52).clip(0, 1) * 3.0
    rust = np.clip(rust, 0, 1)
    rgb = rgb * (1 - 0.7 * rust[:, None]) + hexc("6b4a32")[None] * 0.7 * rust[:, None]
    # kettle hat rivets: a ring of dots round the crown's base
    ang = np.arctan2(P[:, 1] - 0.008, P[:, 0])
    riv = (np.abs(P[:, 2] - 1.662) < 0.006) & (np.abs(((ang / (2 * np.pi) * 18) % 1) - 0.5) > 0.38)
    rgb[riv] *= 1.5
    # a brighter, sharpened edge on blades (thin parts)
    rough = 0.48 + 0.35 * rust
    return np.clip(rgb, 0, 1), rough, np.zeros((n, 3))

def paint_wood(P, N, pat, patd):
    """ash haft: grain along its length (pat.x = metres from the butt), dark greasy grip."""
    n = len(P)
    base = hexc("8d6f4c")
    along = pat[:, 0]
    grain = vnoise(np.stack([along * 6, P[:, 0] * 180 + P[:, 2] * 180, P[:, 1] * 3], -1), 91)
    k = 0.86 + 0.26 * grain + 0.10 * (fbm(P, 8, 2, 93) - 0.5)
    rgb = base[None] * k[:, None]
    return np.clip(rgb, 0, 1), np.full(n, 0.7), np.zeros((n, 3))

def paint_shield(P, N, pat, patd):
    """painted face: team field with an accent chevron; paint chipped at the edges and in blows,
    showing the wood; a dark rim line where the leather facing turns over."""
    n = len(P)
    u, v = pat[:, 0], pat[:, 1]
    rgb, _ = neutral_cloth(P, 97, dirt=0.0, var=0.06)
    streak = vnoise(np.stack([u * 3, v * 40, u * 0], -1), 99) - 0.5
    rgb *= (1 + 0.07 * streak)[:, None]
    mask = np.zeros((n, 3))
    # chevron: an inverted V band, apex high in the middle
    cy = 0.30 + np.abs(u) * 0.42
    chev = (v > cy) & (v < cy + 0.17)
    mask[:, 0] = 1.0; mask[chev, 0] = 0; mask[chev, 1] = 1.0
    # wear: edge band + chips + a few hacks
    edge = np.clip(np.maximum(np.abs(u) - 0.86, (v - 0.9) * 0.5) * 10, 0, 1) + (0.035 - v).clip(0, 1) * 30
    chips = ((fbm(P, 30, 3, 101) - 0.62) * 6).clip(0, 1)
    hack = ((vnoise(P * np.array([6, 160, 60]), 103) - 0.93) * 20).clip(0, 1)
    wear = np.clip(edge * (0.5 + fbm(P, 50, 2, 105)) + chips + hack, 0, 1)
    wood = paint_wood(P, N, np.stack([v * 3, u, v], -1), patd)[0] * 0.85
    rgb = rgb * (1 - wear[:, None]) + wood * wear[:, None]
    mask *= (1 - wear)[:, None]
    # the back (patd.z == 2): planks + leather straps
    back = patd[:, 2] > 1.5
    if back.any():
        wb = paint_wood(P[back], N[back], np.stack([v[back] * 2.5, u[back], v[back]], -1), patd[back])[0] * 0.8
        plank = (np.abs(((u[back] * 3.5) % 1) - 0.5) > 0.47)
        wb[plank] *= 0.6
        strap = (np.abs(v[back] - 0.28) < 0.03) | (np.abs(v[back] - 0.46) < 0.03)
        wb[strap] = hexc("3d2a1c")
        rgb[back] = wb; mask[back] = 0
    rough = np.where(wear > 0.5, 0.8, 0.7)
    return np.clip(rgb, 0, 1), rough, mask

def paint_rim(P, N, pat, patd):
    return paint_leather(P, N, pat, patd, "2e2118")

def paint_mail(P, N, pat, patd):
    """riveted mail: dark iron, rows of rings (catching light on their crowns), rust in the folds."""
    n = len(P)
    base = hexc("4b4a45")
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    ang = np.arctan2(y, x)
    u = (ang * 0.16 / 0.009) + (np.floor(z / 0.007) % 2) * 0.5
    ringp = np.abs(((u % 1.0) - 0.5)) * 2
    rows = np.abs(((z / 0.007) % 1.0) - 0.5) * 2
    lit = (1 - ringp) * (1 - rows)
    k = 0.72 + 0.55 * lit + 0.18 * (fbm(P, 20, 3, 111) - 0.5)
    rgb = base[None] * k[:, None]
    rust = np.clip((fbm(P, 12, 3, 113) - 0.55) * 3, 0, 1)
    rgb = rgb * (1 - 0.6 * rust[:, None]) + hexc("6a4630")[None] * 0.6 * rust[:, None]
    return np.clip(rgb, 0, 1), 0.5 + 0.3 * rust, np.zeros((n, 3))

def paint_surcoat(P, N, pat, patd):
    """a knight's surcoat in his colours: team field, an accent band at the hem and armholes."""
    rgb, mud = neutral_cloth(P, 121, dirt=0.6, var=0.07)
    n = len(P); mask = np.zeros((n, 3)); mask[:, 0] = 1.0
    z = P[:, 2]
    hem = z < 0.64
    arm = (np.abs(P[:, 0]) > 0.15) & (z > 1.30)
    band = hem | arm
    mask[band] = (0, 1, 0)
    return rgb, np.full(n, 0.88), mask

def paint_rshield(P, N, pat, patd):
    """round shield face: team field, an accent cross; chipped; planks and grip on the back."""
    n = len(P); u, v = pat[:, 0], pat[:, 1]
    rgb, _ = neutral_cloth(P, 131, dirt=0.0, var=0.06)
    mask = np.zeros((n, 3)); mask[:, 0] = 1
    cross = (np.abs(u) < 0.13) | (np.abs(v) < 0.13)
    mask[cross] = (0, 1, 0)
    r = np.sqrt(u * u + v * v)
    chips = ((fbm(P, 30, 3, 133) - 0.62) * 6).clip(0, 1) + ((r - 0.9) * 8).clip(0, 1) * (fbm(P, 60, 2, 135) > 0.45)
    wear = np.clip(chips, 0, 1)
    wood = paint_wood(P, N, np.stack([u * 3, v, u], -1), patd)[0] * 0.85
    rgb = rgb * (1 - wear[:, None]) + wood * wear[:, None]; mask *= (1 - wear)[:, None]
    back = patd[:, 2] > 1.5
    if back.any():
        wb = paint_wood(P[back], N[back], np.stack([u[back] * 3, v[back], u[back]], -1), patd[back])[0] * 0.75
        wb[(np.abs(((v[back] * 3) % 1) - 0.5) > 0.46)] *= 0.6
        rgb[back] = wb; mask[back] = 0
    return np.clip(rgb, 0, 1), np.full(n, 0.72), mask

def paint_helm(P, N, pat, patd):
    """great helm: dark iron, a black eye-slit band across the front, breaths on the right cheek."""
    rgb, rough, mask = paint_iron(P, N, pat, patd)
    front = P[:, 1] < -0.03
    slit = front & (np.abs(P[:, 2] - 1.64) < 0.009) & (np.abs(P[:, 0]) > 0.012)
    br = front & (P[:, 0] < -0.02) & (P[:, 2] > 1.47) & (P[:, 2] < 1.58) & (np.abs(((P[:, 2] / 0.018) % 1) - 0.5) < 0.18) & (np.abs(((P[:, 0] / 0.014) % 1) - 0.5) < 0.22)
    cross = front & (np.abs(P[:, 0]) < 0.012) & (P[:, 2] > 1.45) & (P[:, 2] < 1.72)
    rgb[cross] *= 1.35
    rgb[slit | br] = hexc("121110")
    return rgb, rough, mask

PAINTERS = {
    "skin": paint_skin, "wool_dye1": paint_wool_dye1, "wool_dye2": paint_wool_dye2, "wool_team": paint_wool_team,
    "linen_coif": paint_linen_coif, "gambeson": paint_gambeson, "leather": paint_leather, "leather2": paint_leather2,
    "shoe": paint_shoe, "iron": paint_iron, "wood": paint_wood, "shield_paint": paint_shield, "shield_back": paint_shield,
    "shield_rim": paint_rim, "mail": paint_mail, "surcoat": paint_surcoat, "rshield_paint": paint_rshield, "rshield_back": paint_rshield,
    "helm": paint_helm,
}
# flat colours for quick Workbench pose sheets
FLAT = {"skin": "b98569", "wool_dye1": "8a7a5e", "wool_dye2": "5b4634", "wool_team": "2a55a5", "linen_coif": "c9bea4",
        "gambeson": "b5a47d", "leather": "4a3322", "leather2": "6e4c30", "shoe": "3a2a1d", "iron": "45443f", "wood": "8d6f4c",
        "shield_paint": "b0282a", "shield_back": "7a6040", "shield_rim": "2e2118", "mail": "55544e", "surcoat": "2a55a5",
        "rshield_paint": "b0282a", "rshield_back": "7a6040", "helm": "3e3d3a"}


def paint(me, uvname, S, slot_names):
    tid, bary, tverts, tmats = rasterize(me, uvname, S)
    m, P, N, pat, patd = texel_attrs(me, tid, bary, tverts)
    mat_of = tmats[tid[m]]
    col = np.zeros((S, S, 3)); col[:] = 0.5
    rough = np.full((S, S), 0.8); mask = np.zeros((S, S, 3))
    idx = np.argwhere(m)
    for mi, name in enumerate(slot_names):
        sel = mat_of == mi
        if not sel.any(): continue
        rgb, r, mk = PAINTERS[name](P[sel], N[sel], pat[sel], patd[sel])
        yy, xx = idx[sel, 0], idx[sel, 1]
        col[yy, xx] = rgb; rough[yy, xx] = r; mask[yy, xx] = mk
    return col, rough, mask, m
