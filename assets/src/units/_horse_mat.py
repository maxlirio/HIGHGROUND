"""HIGHGROUND horse materials (Cycles node trees, baked to the unit atlas by horse.py).

Every visual material has a *mask twin* (emission) that is baked alongside it. The final mask follows
the units pipeline (tools/vat_bake.py, assets/src/units/_paint.py):
    R = team field colour   (caparison / barding field)
    G = team accent colour  (trapper border, breast-strap pendants)
    B = 1.0 dye 1 = COAT colour (body), 0.5 dye 2 = POINTS colour (mane, tail, lower legs, ear rims)
Masked texels are painted around NEUTRAL (sRGB 0.70); the shader does albedo * tint / NEUTRAL_LIN.
Twin bake 1 writes (team, accent, coat weight); twin bake 2 writes (points weight, 0, 0); horse.py
combines them into a binary dye mask (the engine's dye bands leave a gap between 0.7 and 0.75).
"""
import bpy
import math

NEUTRAL_SRGB = 0.70
NEUTRAL_LIN = ((NEUTRAL_SRGB + 0.055) / 1.055) ** 2.4
COAT_REF_SRGB = NEUTRAL_SRGB


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c) + (1.0,)


def lin(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


class G:
    def __init__(s, name, emit=False):
        s.m = bpy.data.materials.new(name); s.m.use_nodes = True
        s.n = s.m.node_tree.nodes; s.l = s.m.node_tree.links
        s.b = s.n.get("Principled BSDF")
        geo = s.n.new("ShaderNodeNewGeometry")
        s.P = geo.outputs["Position"]; s.N = geo.outputs["Normal"]

    def _set(s, sock, v):
        if isinstance(v, bpy.types.NodeSocket): s.l.new(v, sock)
        elif isinstance(v, str): sock.default_value = srgb(v)
        elif v is not None: sock.default_value = v

    def node(s, t, ins=(), **props):
        nd = s.n.new(t)
        for k, v in props.items(): setattr(nd, k, v)
        for k, v in ins: s._set(nd.inputs[k], v)
        return nd

    def math(s, op, a, b=0.0, clamp=False):
        return s.node("ShaderNodeMath", [(0, a), (1, b)], operation=op, use_clamp=clamp).outputs[0]
    def add(s, a, b): return s.math("ADD", a, b)
    def sub(s, a, b): return s.math("SUBTRACT", a, b)
    def mul(s, a, b): return s.math("MULTIPLY", a, b)
    def mx(s, a, b): return s.math("MAXIMUM", a, b)
    def mn(s, a, b): return s.math("MINIMUM", a, b)
    def absv(s, a): return s.math("ABSOLUTE", a)
    def inv(s, a): return s.math("SUBTRACT", 1.0, a, clamp=True)

    def sep(s, v):
        nd = s.node("ShaderNodeSeparateXYZ", [(0, v)]); return nd.outputs[0], nd.outputs[1], nd.outputs[2]

    def comb(s, x, y, z):
        return s.node("ShaderNodeCombineXYZ", [(0, x), (1, y), (2, z)]).outputs[0]

    def crgb(s, r, g, b):
        return s.node("ShaderNodeCombineColor", [(0, r), (1, g), (2, b)]).outputs[0]

    def attr(s, name):
        return s.node("ShaderNodeAttribute", attribute_name=name).outputs["Fac"]

    def vscale(s, v, sc):
        return s.node("ShaderNodeVectorMath", [(0, v), (1, sc)], operation="MULTIPLY").outputs[0]

    def noise(s, v, scale, detail=4.0, rough=0.55):
        return s.node("ShaderNodeTexNoise", [("Vector", v), ("Scale", scale), ("Detail", detail),
                                             ("Roughness", rough)]).outputs[0]

    def vor(s, v, scale, feature="F1", rand=1.0):
        return s.node("ShaderNodeTexVoronoi", [("Vector", v), ("Scale", scale), ("Randomness", rand)],
                      feature=feature).outputs[0]

    def wave(s, v, scale, dist=4.0, bands="BANDS", direction="Z"):
        nd = s.node("ShaderNodeTexWave", [("Vector", v), ("Scale", scale), ("Distortion", dist),
                                          ("Detail", 3.0)], wave_type=bands)
        try: nd.bands_direction = direction
        except Exception: pass
        return nd.outputs["Fac"]

    def ramp(s, f, stops):
        nd = s.node("ShaderNodeValToRGB", [(0, f)])
        el = nd.color_ramp.elements
        for i, (p, c) in enumerate(stops):
            e = el[i] if i < 2 else el.new(p)
            e.position = p
            e.color = srgb(c) if isinstance(c, str) else c
        return nd.outputs["Color"]

    def mix(s, f, a, b, blend="MIX"):
        nd = s.node("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        s._set(nd.inputs[0], f); s._set(nd.inputs[6], a); s._set(nd.inputs[7], b)
        return nd.outputs[2]

    def mr(s, v, a, b, c=0.0, d=1.0):
        return s.node("ShaderNodeMapRange", [(0, v), (1, a), (2, b), (3, c), (4, d)], clamp=True,
                      interpolation_type="SMOOTHSTEP").outputs[0]

    def out(s, col, rough, height=None, strength=1.0, dist=0.02):
        s._set(s.b.inputs["Base Color"], col)
        s._set(s.b.inputs["Roughness"], rough)
        if height is not None:
            bp = s.node("ShaderNodeBump", [("Height", height), ("Strength", strength), ("Distance", dist)])
            s.l.new(bp.outputs["Normal"], s.b.inputs["Normal"])
        return s.m

    def emit(s, col):
        """replace the BSDF with an emission shader (mask twins)"""
        o = s.n.get("Material Output")
        em = s.node("ShaderNodeEmission", [("Strength", 1.0)])
        s._set(em.inputs["Color"], col)
        s.l.new(em.outputs[0], o.inputs["Surface"])
        return s.m


def grey(v):
    return (lin(v), lin(v), lin(v), 1.0)


# ------------------------------------------------------------------ coat (body)
def m_coat(name, rough_coat, S):
    """body: neutral coat detail + fixed-colour hoof/eye/muzzle skin (by vertex attributes)."""
    g = G(name)
    P = g.P
    x, y, z = g.sep(P)
    big = g.noise(P, 1.6 / S, 3)
    mid = g.noise(P, 7.0 / S, 4)
    # hair lie: noise stretched along the body (coat flows backwards / downwards)
    hair = g.noise(g.vscale(P, (60.0, 22.0, 60.0)), 1.0, 6, 0.7)
    shag = g.noise(g.vscale(P, (26.0, 9.0, 14.0)), 1.0, 5, 0.75)
    v = g.add(COAT_REF_SRGB, g.mul(g.sub(big, 0.5), 0.14))
    v = g.add(v, g.mul(g.sub(mid, 0.5), 0.09))
    v = g.add(v, g.mul(g.sub(hair, 0.5), 0.08 + 0.08 * rough_coat))
    v = g.add(v, g.mul(g.sub(shag, 0.5), 0.12 * rough_coat))
    # faint dapples (read as a dapple-grey, a subtle bloom on bays), stronger over the quarters
    dap = g.mr(g.vor(P, 8.0 / S, "F1", 0.9), 0.08, 0.40)
    v = g.add(v, g.mul(g.mul(g.sub(dap, 0.6), 0.07), g.attr("dapzone")))
    # lighter belly / inner legs (mealy underside), darker top line
    nx, ny, nz = g.sep(g.N)
    v = g.add(v, g.mul(g.mr(nz, -0.2, -0.9), 0.06))
    v = g.sub(v, g.mul(g.mr(nz, 0.5, 0.95), 0.04))
    v = g.math("POWER", g.math("MAXIMUM", v, 0.05), 2.2)     # sRGB-ish detail -> linear
    coat = g.crgb(v, v, v)
    # fixed-colour areas
    horn = g.ramp(g.wave(g.vscale(P, (1.0, 1.0, 0.05)), 30.0 / S, 2.0, "BANDS", "X"),
                  [(0.0, "#241f1b"), (0.5, "#3a3029"), (1.0, "#2c2520")])
    skin = g.ramp(g.noise(P, 30.0 / S, 4), [(0.3, "#2e2927"), (0.8, "#463d39")])
    eye = "#1e1a17"
    hoof = g.attr("hoof"); muz = g.attr("muzzle"); eyew = g.attr("eye")
    col = g.mix(muz, coat, skin)
    col = g.mix(hoof, col, horn)
    col = g.mix(eyew, col, eye)
    star = g.mr(g.attr("marks"), 0.8, 0.88)
    col = g.mix(star, col, g.ramp(g.noise(P, 40.0 / S, 3), [(0.3, "#d6d0c4"), (0.8, "#e4dfd4")]))
    rough = g.add(0.62 + 0.1 * rough_coat, g.mul(g.sub(hair, 0.5), 0.2))
    rough = g.math("MINIMUM", g.add(g.mul(eyew, -0.5), rough), 1.0)
    height = g.add(g.mul(hair, 0.4 + 0.6 * rough_coat), g.mul(mid, 0.6))
    height = g.add(height, g.mul(horn if False else hoof, g.wave(P, 40.0 / S, 2.0)))
    return g.out(col, rough, height, 0.35, 0.004 * S)


def m_coat_mask(name, S, stripe_w=0.0):
    """twin 1: (team 0, accent 0, coat weight)"""
    g = G(name)
    hoof = g.attr("hoof"); muz = g.attr("muzzle"); eyew = g.attr("eye")
    star = g.mr(g.attr("marks"), 0.8, 0.88)
    fixed = g.mx(g.mx(hoof, eyew), g.mx(g.mul(muz, 0.9), star))
    return g.emit(g.crgb(0.0, 0.0, g.inv(fixed))), g


def m_coat_mask_a(name):
    """twin 2: (points weight, 0, 0)"""
    g = G(name)
    return g.emit(g.crgb(g.attr("points"), 0.0, 0.0))


# ------------------------------------------------------------------ tack
def m_leather(name, S, base="#4a3222", dark="#2e1f16", worn="#6a4a31"):
    g = G(name)
    P = g.P
    col = g.ramp(g.noise(P, 3.0 / S, 4), [(0.3, dark), (0.7, base)])
    fine = g.noise(P, 90.0 / S, 5)
    col = g.mix(0.25, col, g.crgb(fine, fine, fine), "OVERLAY")
    wear = g.mr(g.noise(P, 14.0 / S, 4), 0.58, 0.72)
    col = g.mix(g.mul(wear, 0.6), col, worn)
    return g.out(col, g.add(0.55, g.mul(wear, -0.1)), fine, 0.4, 0.003 * S)


def m_saddle(name, S):
    g = G(name)
    P = g.P
    col = g.ramp(g.noise(P, 4.0 / S, 4), [(0.25, "#5a3822"), (0.75, "#7a5132")])
    tool = g.wave(P, 30.0 / S, 6.0, "RINGS")
    fine = g.noise(P, 120.0 / S, 5)
    col = g.mix(0.2, col, g.crgb(tool, tool, tool), "OVERLAY")
    edge = g.mr(g.noise(P, 10.0 / S, 3), 0.55, 0.7)
    col = g.mix(g.mul(edge, 0.5), col, "#77563a")
    return g.out(col, 0.58, g.add(fine, g.mul(tool, 0.5)), 0.4, 0.003 * S)


def m_iron(name, S):
    g = G(name)
    P = g.P
    col = g.ramp(g.noise(P, 20.0 / S, 4), [(0.3, "#2f2e2c"), (0.7, "#4a4744")])
    rust = g.mr(g.noise(P, 8.0 / S, 5), 0.56, 0.7)
    col = g.mix(rust, col, "#5c3c29")
    s = g.out(col, 0.55, g.noise(P, 80.0 / S, 4), 0.3, 0.002 * S)
    g.b.inputs["Metallic"].default_value = 0.6
    return s


def m_cloth(name, S, base="#c9b99a", quilt=False):
    """linen/wool for the saddle cloth and the trapper field (field colour is replaced by the team
    colour through mask.R, so the stored albedo is a light neutral carrying the weave shading)."""
    g = G(name)
    P = g.P
    x, y, z = g.sep(P)
    weave = g.noise(g.vscale(P, (300.0, 300.0, 40.0)), 1.0, 2)
    blot = g.noise(P, 2.5 / S, 3)
    v = g.add(NEUTRAL_SRGB, g.mul(g.sub(blot, 0.5), 0.10))
    v = g.add(v, g.mul(g.sub(weave, 0.5), 0.08))
    height = g.mul(weave, 0.3)
    if quilt:
        # diamond quilting: two sets of diagonal lines
        a = g.add(g.mul(y, 11.0 / S), g.mul(z, 11.0 / S))
        b = g.sub(g.mul(y, 11.0 / S), g.mul(z, 11.0 / S))
        la = g.absv(g.sub(g.math("FRACT", a), 0.5)); lb = g.absv(g.sub(g.math("FRACT", b), 0.5))
        q = g.mr(g.mn(la, lb), 0.0, 0.12)
        v = g.sub(v, g.mul(g.inv(q), 0.18))
        height = g.add(height, g.mul(q, 2.5))
    # mud splash toward the hem
    mud = g.mul(g.mr(z, 0.95 * S, 0.45 * S), g.mr(g.noise(P, 9.0 / S, 4), 0.45, 0.7))
    v = g.math("POWER", v, 2.2)
    c = g.crgb(v, g.mul(v, 0.96), g.mul(v, 0.88))
    c = g.mix(g.mul(mud, 0.6), c, "#5a4632")
    return g.out(c, 0.9, height, 0.6 if quilt else 0.25, (0.01 if quilt else 0.002) * S)


def m_cloth_mask(name, S, hem, border=0.09, charges=()):
    """trapper: team field, a band of the team accent along the hem, and the arms: a chevron of the accent
    (the device on the knights' shields) on each flank at every (f, apex z) in `charges` (units of S), so a
    caparisoned horse reads as its side's from any angle and at a distance."""
    g = G(name)
    x, y, z = g.sep(g.P)
    field = g.mr(z, hem + border * 0.8 * S, hem + border * 1.1 * S)
    edge = g.mul(g.inv(field), g.mr(z, hem + 0.012 * S, hem + 0.02 * S))
    chev = None
    for fc, az in charges:
        u = g.absv(g.add(y, fc * S))                          # metres along the body from the charge's centre line
        v = g.add(g.sub(z, az * S), g.mul(u, 0.85))            # 0 on the chevron's centre line (arms fall 0.85 m/m)
        band = g.inv(g.mr(g.absv(v), 0.062 * S, 0.072 * S))    # ~13 cm wide arms
        span = g.inv(g.mr(u, 0.29 * S, 0.31 * S))
        side = g.mr(g.absv(g.sep(g.N)[0]), 0.45, 0.65)         # the flanks only, not across the back or chest
        c = g.mul(g.mul(band, span), side)
        chev = c if chev is None else g.mx(chev, c)
    if chev is not None:
        field = g.mul(field, g.inv(chev)); edge = g.mx(edge, g.mul(chev, g.mr(z, hem + border * 1.1 * S, hem + border * 1.3 * S)))
    return g.emit(g.crgb(field, edge, 0.0))


def m_saddlecloth(name, S, team):
    g = G(name)
    P = g.P
    col = g.ramp(g.noise(P, 5.0 / S, 4), [(0.3, "#6b5a45"), (0.7, "#7d6a52")])
    return g.out(col, 0.9, g.noise(P, 200.0 / S, 2), 0.2, 0.002 * S)


def mask_const(name, r=0.0, gg=0.0, b=0.0):
    g = G(name)
    return g.emit((r, gg, b, 1.0))
