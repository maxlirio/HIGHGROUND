// Castles you go inside (docs/castle-plan.md §3). Draws every castle in w.castles (sim: js/sim/castle.js):
// curtains with a walkable wall-walk, parapet and crenels; round and square towers with floors, a spiral stair
// and an open battlemented top; the gatehouse with its passage, two portcullises and gate leaves; the keep
// with its storeys, stairs and forebuilding; the bailey's buildings. Damage comes from the siege sim: each
// curtain module (b.mods, 6 m) goes intact → pocked → cracked → BREACH (a gap with a rubble slope either side),
// and when one falls there is dust and flying stone. Towers and the gatehouse wear their building's hp.
//
// GEOMETRY. Everything is procedural masonry built from "hexas" (8-corner blocks: a box, a wedge, a sloped
// flight) written straight into world-space buffers, one merged mesh per material per part: a castle is a few
// dozen draw calls whatever its size. Curtains follow the ground (their wall-walk is always walkH above the
// terrain under it, exactly where figures.js stands the men). Pieces of the modular kit (CASTLE-ART,
// assets/castle-kit.json + assets/glb/castle_*.glb) can replace a part's procedural body when they land —
// see KIT below; until then the procedural castle IS the castle, and it is always shippable.
//
// GOING INSIDE (the cut-away). Towers, the gatehouse, the keep and the bailey buildings are built in LAYERS:
// storey s is layer 2s (its floor, and its walls up to 1.2 m) and layer 2s+1 (the rest of its walls). When the
// camera looks closely into / over one of them (the RTS camera's target inside its footprint within 170 m, or the
// lord walking in it in his third-person view) the part is "cut" at a storey k: layers above 2k fade out over
// 0.3 s (material opacity, then hidden) and you look down into storey k — the fight on its floor and stair.
// k = the lord's own storey in his view; otherwise the highest storey with men on it, and PageUp / PageDown step
// it by hand. Parts that are not cut draw as one merged mesh per material; only a cut part is split into its
// layer meshes (built lazily, kept), so the cut costs nothing when you are not looking in.
//
// MEN AT THEIR LEVEL: this module installs w.castleLevelH(i) (metres above the terrain), which figures.js adds to
// a man's height. It is the sim's levelHeight(w, i) (js/sim/castle.js) once S.lvl exists; until then a
// position-based guess (a man standing on a curtain's walk band is on the walk).
import * as THREE from "three";
import { FOG } from "./props.js";
import { kitManifest, kitPiece, kitMeta, kitState, placePiece, pieceGeos } from "./castle-kit.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// ------------------------------------------------------------------ textures (procedural, world-metric UVs)
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvasTex(N, draw, srgb = true) {
  const cv = document.createElement("canvas"); cv.width = cv.height = N; const g = cv.getContext("2d"); draw(g, N);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
function grain(g, N, r, amt, alpha = 0.18) {
  const img = g.getImageData(0, 0, N, N), d = img.data;
  for (let k = 0; k < d.length; k += 4) { const n = (r() - 0.5) * amt; d[k] += n; d[k + 1] += n; d[k + 2] += n * 0.9; }
  g.putImageData(img, 0, 0); void alpha;
}
// ashlar: coursed squared blocks, 4 m × 4 m per tile; returns [albedo, bump]
function ashlar() {
  const N = 1024, px = N / 4, r = rng(7), courses = [];
  let y = 0; while (y < N) { const h = Math.round((0.32 + r() * 0.2) * px); courses.push([y, Math.min(h, N - y)]); y += h; }
  const blocks = [];
  for (const [y0, h] of courses) { let x = -Math.round(r() * px * 0.6); while (x < N) { const w = Math.round((0.55 + r() * 0.7) * px); blocks.push([x, y0, w, h, r()]); x += w; } }
  const alb = canvasTex(N, (g) => {
    g.fillStyle = "#a39d92"; g.fillRect(0, 0, N, N); // mortar
    for (const [x, y0, w, h, v] of blocks) {
      const l = 168 + v * 42, warm = (r() - 0.5) * 16;
      for (const dx of [0, N, -N]) { g.fillStyle = `rgb(${l + 8 + warm},${l + 2},${l - 10 - warm})`; g.fillRect(x + dx + 3, y0 + 3, w - 6, h - 6);
        g.fillStyle = `rgba(0,0,0,${0.06 + r() * 0.08})`; g.fillRect(x + dx + 3, y0 + h - 12, w - 6, 9); // weathered lower edge
        g.fillStyle = `rgba(255,250,235,${0.05 + r() * 0.05})`; g.fillRect(x + dx + 3, y0 + 3, w - 6, 6); }
    }
    for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${r() < 0.5 ? "40,44,30" : "255,250,240"},${0.03 + r() * 0.05})`; const s = 4 + r() * 30; g.beginPath(); g.arc(r() * N, r() * N, s, 0, 7); g.fill(); }
    grain(g, N, r, 26);
  });
  const bump = canvasTex(N, (g) => {
    g.fillStyle = "#202020"; g.fillRect(0, 0, N, N);
    for (const [x, y0, w, h] of blocks) for (const dx of [0, N, -N]) { const gr = g.createLinearGradient(0, y0, 0, y0 + h); gr.addColorStop(0, "#c8c8c8"); gr.addColorStop(0.5, "#e0e0e0"); gr.addColorStop(1, "#a8a8a8"); g.fillStyle = gr; g.fillRect(x + dx + 4, y0 + 4, w - 8, h - 8); }
    grain(g, N, rng(9), 40);
  }, false);
  return [alb, bump];
}
function planks() { // 2 m tile, boards 0.25 m wide running along u
  const N = 512, r = rng(3);
  return canvasTex(N, (g) => {
    const bw = N / 8;
    for (let k = 0; k < 8; k++) { const l = 92 + r() * 30; g.fillStyle = `rgb(${l + 30},${l + 8},${l - 22})`; g.fillRect(0, k * bw, N, bw);
      for (let s = 0; s < 40; s++) { g.fillStyle = `rgba(40,25,10,${0.05 + r() * 0.08})`; g.fillRect(0, k * bw + r() * bw, N, 1 + r() * 2); }
      g.fillStyle = "rgba(20,12,5,.7)"; g.fillRect(0, k * bw, N, 3); const j = r() * N; g.fillRect(j, k * bw, 3, bw); }
    grain(g, N, r, 18);
  });
}
function tiles() { // stone-slate / shingle roof, 2 m tile, courses along u
  const N = 512, r = rng(5);
  return canvasTex(N, (g) => {
    g.fillStyle = "#3d3833"; g.fillRect(0, 0, N, N); const ch = N / 10;
    for (let row = 0; row < 10; row++) { let x = row % 2 ? -ch * 0.4 : 0; while (x < N) { const w = ch * (0.7 + r() * 0.5), l = 70 + r() * 30; g.fillStyle = `rgb(${l + 6},${l},${l - 6})`; g.fillRect(x + 2, row * ch + 2, w - 4, ch - 3); g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x + 2, row * ch + ch - 6, w - 4, 4); x += w; } }
    grain(g, N, r, 22);
  });
}

// ------------------------------------------------------------------ materials
let MATS = null;
function patchFog(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FOG);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vFogW;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n#ifdef USE_INSTANCING\nvFogW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvFogW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vFogW; uniform sampler2D fogTex; uniform float fogOn; uniform float mapSize;")
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
        if (fogOn > .5) { float fv = texture2D(fogTex, vec2(vFogW.x, -vFogW.z) / mapSize).r;
          float g = dot(gl_FragColor.rgb, vec3(.3,.59,.11)); vec3 rem = mix(vec3(g), gl_FragColor.rgb, .35) * .45;
          gl_FragColor.rgb = mix(mix(vec3(.004), rem, smoothstep(.15,.45,fv)), gl_FragColor.rgb, smoothstep(.55,.95,fv)); }`);
  };
  mat.customProgramCacheKey = () => "castle-fog";
  return mat;
}
function mats() {
  if (MATS) return MATS;
  const [alb, bump] = ashlar();
  const rub = new THREE.TextureLoader().load("assets/terrain/ruins_rubble_albedo.png"); rub.wrapS = rub.wrapT = THREE.RepeatWrapping; rub.colorSpace = THREE.SRGBColorSpace; rub.anisotropy = 8;
  const std = (o) => patchFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, ...o }));
  const planksT = planks(), tilesT = tiles();
  // (the scene is lit without tone mapping, sun 2.2 + sky 0.9: a pale limestone needs its albedo lifted past 1 to
  // read as the light stone it is next to the sunlit fields)
  MATS = {
    stone: std({ map: alb, bumpMap: bump, bumpScale: 0.9, color: new THREE.Color(1.55, 1.5, 1.38) }),
    paving: std({ map: alb, bumpMap: bump, bumpScale: 0.5, color: new THREE.Color(1.1, 1.08, 1.02) }),
    wood: std({ map: planksT, roughness: 0.85, color: new THREE.Color(1.3, 1.25, 1.2) }),
    timber: std({ map: planksT, roughness: 0.85, color: new THREE.Color(1.1, 1.05, 1.0) }),
    roof: std({ map: tilesT, roughness: 0.8, color: new THREE.Color(1.25, 1.2, 1.15) }),
    lead: std({ color: new THREE.Color(0.62, 0.64, 0.64), roughness: 0.6 }),
    rubble: std({ map: rub, roughness: 1 }),
    iron: std({ color: "#3a3835", roughness: 0.55, metalness: 0.5 }),
    earth: std({ color: "#6e5b43", roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    water: std({ color: "#57767c", roughness: 0.18, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    dark: std({ color: "#0d0b0a", roughness: 1 }),
  };
  // UVs are written in metres; each map's repeat is 1 / its tile size
  const rep = (t, m) => { if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / m, 1 / m); } };
  rep(alb, 4); rep(bump, 4); rep(planksT, 2); rep(tilesT, 2); rep(rub, 5);
  // CASTLE-ART's tileable sets (assets/tex/castle/<name>_{albedo,normal,rough}.jpg + <name>.json with tile_m) replace
  // the canvas stand-ins as they load; a missing set leaves the stand-in in place
  const KIT = { earth: ["earth", 1.45], stone: ["ashlar", 1.7], paving: ["paving", 1.15], wood: ["planks", 1.25], timber: ["timber", 1.2], roof: ["shingle", 1.3], lead: ["lead", 1.15], rubble: ["debris", 1.15], iron: ["iron", 1] };
  for (const [k, m] of Object.entries(MATS)) MATS_ALL.set(k, [m]);
  for (const [k, [name, lift]] of Object.entries(KIT)) texInto(k, name, lift);
  // the kit's own materials, one per texture key (every GLB material `castle_<key>` is swapped for "k:<key>"). The
  // GLBs' COLOR_0 (ambient occlusion × weathering) multiplies them; the lift is for the untonemapped sun + sky.
  for (const [key, lift] of Object.entries(KIT_LIFT)) {
    const m = std({ color: new THREE.Color(lift, lift * 0.99, lift * 0.97), roughness: 0.9 });
    if (key === "water") { m.color.set("#57767c"); m.roughness = 0.18; }
    if (key === "dark") m.color.set("#0d0b0a");
    MATS["k:" + key] = m; MATS_ALL.set("k:" + key, [m]);
    if (key !== "water" && key !== "dark") texInto("k:" + key, key, lift);
  }
  return MATS;
}
const KIT_LIFT = { ashlar: 1.75, rubble: 1.6, paving: 1.3, planks: 1.3, timber: 1.25, slate: 1.25, shingle: 1.35, lead: 1.2, plaster: 1.15, iron: 1, debris: 1.35, earth: 1.4, water: 1, dark: 1 };
// the shared texture library: each set loads once (promise per name) and is put on every material that wants it
const TEX = new Map();
function kitTex(name) {
  if (!TEX.has(name)) TEX.set(name, fetch(`assets/tex/castle/${name}.json`).then((r) => r.ok ? r.json() : null).then((meta) => {
    if (!meta) return null; const tile = meta.tile_m || 4, L = new THREE.TextureLoader();
    const load = (suf, srgb) => new Promise((res) => L.load(`assets/tex/castle/${name}_${suf}.jpg`, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / tile, 1 / tile); res(t); }, undefined, () => res(null)));
    return Promise.all([load("albedo", true), load("normal", false), load("rough", false)]).then(([a, n, r]) => (a ? { a, n, r, tile } : null));
  }).catch(() => null));
  return TEX.get(name);
}
// (the kit's UVs are already metres / tile_m, so its materials take the maps with no repeat; the procedural geometry
// writes metres and needs the 1 / tile repeat — two texture objects sharing one image)
function texInto(k, name, lift) {
  kitTex(name).then((T) => {
    if (!T) return;
    const kit = k.startsWith("k:"), pick = (t) => { if (!t || !kit) return t; const c = t.clone(); c.repeat.set(1, 1); c.needsUpdate = true; return c; };
    const a = pick(T.a), n = pick(T.n), r = pick(T.r);
    for (const m of MATS_ALL.get(k) || []) { m.map = a; m.bumpMap = null; if (n) { m.normalMap = n; m.normalScale.set(1, 1); } if (r) { m.roughnessMap = r; m.roughness = 1; } m.metalness = /iron/.test(k) ? 0.4 : 0; m.color.setRGB(lift, lift * 0.99, lift * 0.97); m.needsUpdate = true; }
    (TEXSET.get(k) || TEXSET.set(k, { a, n, r, lift }).get(k));
  });
}
const MATS_ALL = new Map(), TEXSET = new Map();

// ------------------------------------------------------------------ geometry builder (world space, no merges)
// A GB collects triangles per material per layer. hexa() takes 4 base corners (world XZ) and their bottom/top
// heights; faces are oriented outward from the block's centroid, so corner order does not matter.
class GB {
  constructor() { this.buf = new Map(); }
  arr(mat, layer) { const k = mat + "|" + layer; let b = this.buf.get(k); if (!b) this.buf.set(k, b = { mat, layer, p: [], n: [], u: [], c: [] }); return b; }
  quad(B, a, b, c, d, cx, cy, cz, col, tile) {
    // a,b,c,d: [x,y,z] around the face
    let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    let L = Math.hypot(nx, ny, nz);
    if (L < 1e-6) { ux = c[0] - b[0]; uy = c[1] - b[1]; uz = c[2] - b[2]; vx = a[0] - b[0]; vy = a[1] - b[1]; vz = a[2] - b[2]; nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx; L = Math.hypot(nx, ny, nz); if (L < 1e-6) return; nx = -nx; ny = -ny; nz = -nz; }
    nx /= L; ny /= L; nz /= L;
    const fx = (a[0] + b[0] + c[0] + d[0]) / 4 - cx, fy = (a[1] + b[1] + c[1] + d[1]) / 4 - cy, fz = (a[2] + b[2] + c[2] + d[2]) / 4 - cz;
    let flip = fx * nx + fy * ny + fz * nz < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; const t = b; b = d; d = t; }
    const s = 1, horiz = Math.abs(ny) > 0.7; void tile; let tx = -nz, tz = nx; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const uv = (q) => horiz ? [q[0] * s, q[2] * s] : [(q[0] * tx + q[2] * tz) * s, q[1] * s];
    for (const q of [a, b, c, a, c, d]) { B.p.push(q[0], q[1], q[2]); B.n.push(nx, ny, nz); const t = uv(q); B.u.push(t[0], t[1]); B.c.push(col[0], col[1], col[2]); }
  }
  // corners: [[x,z]×4], y0: number|[4], y1: number|[4]
  hexa(mat, layer, cs, y0, y1, col = WHITE) {
    const B = this.arr(mat, layer), tile = 1;
    const lo = cs.map((c, k) => [c[0], typeof y0 === "number" ? y0 : y0[k], c[1]]), hi = cs.map((c, k) => [c[0], typeof y1 === "number" ? y1 : y1[k], c[1]]);
    let cx = 0, cy = 0, cz = 0; for (const q of [...lo, ...hi]) { cx += q[0]; cy += q[1]; cz += q[2]; } cx /= 8; cy /= 8; cz /= 8;
    this.quad(B, lo[0], lo[1], lo[2], lo[3], cx, cy, cz, col, tile); this.quad(B, hi[0], hi[1], hi[2], hi[3], cx, cy, cz, col, tile);
    for (let k = 0; k < 4; k++) { const j = (k + 1) & 3; this.quad(B, lo[k], lo[j], hi[j], hi[k], cx, cy, cz, col, tile); }
  }
  // triangles of a height-field grid (rubble mounds)
  grid(mat, layer, nu, nv, fn, col = WHITE) {
    const B = this.arr(mat, layer), s = 1, P = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) P.push(fn(i / nu, j / nv));
    const at = (i, j) => P[j * (nu + 1) + i];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      for (const tri of [[a, c, b], [a, d, c]]) { let [p, q, r] = tri;
        let ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; [q, r] = [r, q]; } // (keep it facing up)
        const L = Math.hypot(nx, ny, nz) || 1;
        for (const t of [p, q, r]) { B.p.push(t[0], t[1], t[2]); B.n.push(nx / L, ny / L, nz / L); B.u.push(t[0] * s, t[2] * s); const k = t[3] ?? 1; B.c.push(col[0] * k, col[1] * k, col[2] * k); }
      }
    }
  }
  // → Map(layer → Map(mat → BufferGeometry)), and whole: Map(mat → BufferGeometry)
  build() {
    const layers = new Map(), whole = new Map(), acc = new Map();
    for (const B of this.buf.values()) {
      if (!B.p.length) continue;
      if (!layers.has(B.layer)) layers.set(B.layer, new Map());
      layers.get(B.layer).set(B.mat, B);
      const A = acc.get(B.mat) || { p: [], n: [], u: [], c: [] }; acc.set(B.mat, A);
      for (const k of ["p", "n", "u", "c"]) for (let i = 0; i < B[k].length; i++) A[k].push(B[k][i]);
    }
    for (const [m, A] of acc) whole.set(m, toGeo(A));
    return { layers, whole };
  }
}
const WHITE = [1, 1, 1];
function toGeo(A) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(A.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(A.n, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(A.u, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(A.c, 3));
  g.computeBoundingSphere(); g.computeBoundingBox(); return g;
}

// ------------------------------------------------------------------ polygons
function area(P) { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
// inset a convex polygon (world XZ) by d, mitred
function inset(P, d) {
  const s = area(P) > 0 ? 1 : -1, n = P.length, out = [];
  const off = (i) => { const p = P[i], q = P[(i + 1) % n]; let ex = q[0] - p[0], ez = q[1] - p[1]; const L = Math.hypot(ex, ez) || 1; ex /= L; ez /= L; const nx = -ez * s, nz = ex * s; return [p[0] + nx * d, p[1] + nz * d, ex, ez]; };
  for (let i = 0; i < n; i++) {
    const A = off((i - 1 + n) % n), B = off(i);
    const den = A[2] * B[3] - A[3] * B[2];
    if (Math.abs(den) < 1e-6) { out.push([B[0], B[1]]); continue; }
    const t = ((B[0] - A[0]) * B[3] - (B[1] - A[1]) * B[2]) / den;
    out.push([A[0] + A[2] * t, A[1] + A[3] * t]);
  }
  return out;
}
// a masonry ring: the wall between polygon P and P inset by th, from y0 to y1. gaps: Map(edge → door top | {top, f0, f1})
// (a number leaves the whole edge open up to the door top; {f0, f1} only that stretch of it, as fractions of the edge);
// skip(edge) leaves an edge out entirely.
function shell(gb, mat, layer, P, th, y0, y1, { gaps = null, skip = null, col = WHITE, Q = null } = {}) {
  const I = Q || inset(P, th), n = P.length;
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  for (let i = 0; i < n; i++) {
    if (skip && skip(i)) continue;
    const j = (i + 1) % n, g = gaps?.get(i);
    if (g !== undefined && typeof g === "object") {
      for (const [u0, u1, lo] of [[0, g.f0, y0], [g.f0, g.f1, Math.max(y0, g.top)], [g.f1, 1, y0]]) {
        if (u1 - u0 < 1e-3 || y1 - lo < 0.01) continue;
        gb.hexa(mat, layer, [lerp2(P[i], P[j], u0), lerp2(P[i], P[j], u1), lerp2(I[i], I[j], u1), lerp2(I[i], I[j], u0)], lo, y1, col);
      }
      continue;
    }
    let a = y0; if (g !== undefined) { if (g >= y1) continue; a = Math.max(a, g); }
    if (y1 - a < 0.01) continue;
    gb.hexa(mat, layer, [P[i], P[j], I[j], I[i]], a, y1, col);
  }
}
// a door of width wd centred at distance c along edge i of P (c omitted: the middle)
function door(P, i, top, wd, c) { const j = (i + 1) % P.length, L = Math.hypot(P[j][0] - P[i][0], P[j][1] - P[i][1]) || 1, m = c ?? L / 2; return { top, f0: Math.max(0, (m - wd / 2) / L), f1: Math.min(1, (m + wd / 2) / L) }; }
// split long edges so battlements and doors can be made edge by edge
function subdiv(P, maxL) { const out = []; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length], n = Math.max(1, Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) / maxL)); for (let k = 0; k < n; k++) out.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]); } return out; }
const circle = (cx, cz, r, n = 20, a0 = 0) => Array.from({ length: n }, (_, k) => [cx + Math.cos(a0 + k / n * Math.PI * 2) * r, cz + Math.sin(a0 + k / n * Math.PI * 2) * r]);

// ------------------------------------------------------------------ the sim data, normalised (castle-plan §1)
const num = (...v) => { for (const x of v) if (typeof x === "number" && isFinite(x)) return x; return undefined; };
// floors: absolute floor heights (m above the part's ground), the last one the top (roof walk / battlements)
function floorsOf(p, dflt) {
  let f = p.floors ?? p.storeys ?? p.levels;
  if (Array.isArray(f) && f.length) {
    f = f.map((q) => typeof q === "number" ? q : num(q.h, q.z, q.floorH, q.height, 0));
    const inc = f.every((v, k) => k === 0 || v > f[k - 1]);
    if (!inc || f[0] > 0.5) { const acc = [0]; for (const v of f) acc.push(acc.at(-1) + v); f = acc; } // (storey heights → floor heights)
    if (f[0] !== 0) f.unshift(0);
    const top = num(p.topH, p.top, p.roofH);
    if (top !== undefined && top > f.at(-1) + 0.5) f.push(top);
    return f;
  }
  return dflt;
}
function normalise(C, map) {
  const parts = [], bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of C.parts || []) {
    const k = p.kind, q = { src: p, kind: k, id: p.id, bid: p.bid };
    if (k === "curtain") {
      const x0 = num(p.x0, p.x1), y0 = num(p.y0, p.y1), x1 = p.x0 !== undefined ? p.x1 : p.x2, y1 = p.x0 !== undefined ? p.y1 : p.y2;
      Object.assign(q, { x0, y0, x1, y1, th: num(p.thick, p.thickness, p.th, 2.8), walkH: num(p.walkH, p.walk, 8), hoarding: !!(p.hoarding || p.hoard) });
      q.H = num(p.height, p.H, q.walkH + 2.2);
    } else {
      const shape = p.shape || (p.r !== undefined && p.w === undefined ? "round" : "rect");
      Object.assign(q, { x: p.x, y: p.y, rot: num(p.rot, p.ang, p.angle, 0), shape, r: num(p.r, p.radius), w: num(p.w, p.width, p.len), d: num(p.d, p.h !== undefined && p.h < 60 && k !== "tower" && k !== "keep" && k !== "gatehouse" ? p.h : undefined, p.depth, p.w) });
      if (k === "tower" && shape !== "round" && p.d === undefined && p.w === undefined && p.r !== undefined) q.w = q.d = p.r * 2;
      if (k === "tower") { if (shape === "round") q.r ??= 5; else { q.w ??= 10; q.d ??= q.w; } const wh = num(p.walkH, C.walkH, 8); q.floors = floorsOf(p, [0, Math.round(wh * 0.525 * 10) / 10, wh, wh + 4]); q.walkH = wh; q.hoarding = !!(p.hoarding || p.hoard); }
      else if (k === "gatehouse") { q.w = num(p.w, p.width > 8 ? p.width : undefined, 16); q.d = num(p.d, p.len, p.length, 12); q.pw = num(p.passage, p.passageW, p.width < 8 ? p.width : undefined, 3.6); const wh = num(p.walkH, C.walkH, 8); q.floors = floorsOf(p, [0, wh, wh + 5.5]); q.walkH = wh; }
      else if (k === "keep") { q.w ??= 20; q.d ??= q.w; q.floors = floorsOf(p, [0, 6, 13.5, 20]); q.fore = p.forebuilding ?? p.fore ?? true; }
      else if (k === "hall" || k === "chapel" || k === "stable" || k === "kitchen") { q.w ??= { hall: 20, chapel: 13, stable: 16, kitchen: 9 }[k]; q.d ??= { hall: 10, chapel: 7, stable: 6, kitchen: 8 }[k]; q.floors = [0, num(p.wallH, p.height, { hall: 7, chapel: 7.5, stable: 4, kitchen: 5 }[k])]; }
      else if (k === "well") { q.r ??= 1.2; }
      else if (k === "postern") { /* a small door in a curtain: drawn with the curtain */ }
      else if (k === "ditch" || k === "moat") { q.segs = p.segs || []; q.width = num(p.width, 9); q.wet = k === "moat" || !!p.wet; }
    }
    parts.push(q);
    const xs = q.kind === "curtain" ? [q.x0, q.x1] : [q.x], ys = q.kind === "curtain" ? [q.y0, q.y1] : [q.y];
    for (const x of xs) if (x !== undefined) { bb[0] = Math.min(bb[0], x); bb[2] = Math.max(bb[2], x); } for (const y of ys) if (y !== undefined) { bb[1] = Math.min(bb[1], y); bb[3] = Math.max(bb[3], y); }
  }
  const keep = parts.find((p) => p.kind === "keep"), towers = parts.filter((p) => p.kind === "tower" || p.kind === "gatehouse");
  let cx = C.bailey?.x ?? C.cx ?? keep?.x, cy = C.bailey?.y ?? C.cy ?? keep?.y;
  if (cx === undefined) { cx = (bb[0] + bb[2]) / 2; cy = (bb[1] + bb[3]) / 2; if (towers.length) { cx = towers.reduce((a, t) => a + t.x, 0) / towers.length; cy = towers.reduce((a, t) => a + t.y, 0) / towers.length; } }
  return { C, parts, cx, cy, bb };
}

// ------------------------------------------------------------------ the builders
// (sim x,y) ↔ world: X = x, Z = -y
function frame(p) { const c = Math.cos(p.rot), s = Math.sin(p.rot); return (a, b) => [p.x + a * c - b * s, -(p.y + a * s + b * c)]; }
function footprintPoly(p, pad = 0) {
  if (p.shape === "round" || p.kind === "well") return circle(p.x, -p.y, (p.r || 1) + pad, p.r > 3 ? 20 : 12);
  const F = frame(p), hw = p.w / 2 + pad, hd = p.d / 2 + pad; return [F(-hw, -hd), F(hw, -hd), F(hw, hd), F(-hw, hd)];
}
function inside(p, x, y, pad = 0) {
  if (p.kind === "curtain") return false;
  if (p.shape === "round" || p.kind === "well") return Math.hypot(x - p.x, y - p.y) < (p.r || 1) + pad;
  const c = Math.cos(p.rot), s = Math.sin(p.rot), dx = x - p.x, dy = y - p.y, a = dx * c + dy * s, b = -dx * s + dy * c;
  return Math.abs(a) < p.w / 2 + pad && Math.abs(b) < p.d / 2 + pad;
}
function groundOf(map, p) { // [centre ground, lowest ground under the footprint]
  let lo = Infinity; for (const [X, Z] of footprintPoly(p, 1)) lo = Math.min(lo, map.h(X, -Z));
  const g = map.h(p.x, p.y); return [g, Math.min(lo, g)];
}
const TONE = { pocked: [0.86, 0.84, 0.82], cracked: [0.7, 0.68, 0.66], scorch: [0.5, 0.47, 0.44] };
const lerpc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function stoneTint(r, base = WHITE) { const v = 0.92 + r() * 0.14; return [base[0] * v, base[1] * v, base[2] * v * 0.99]; }

// damage state of a building (0 intact, 1 pocked, 2 cracked, 3 gone) and of its modules
function modState(b, k) {
  if (!b) return 0; if (b.ruin) return 3;
  if (b.mstate && k < b.mstate.length) return b.mstate[k]; // (siege.js keeps the state with its hysteresis and events)
  if (!b.mods) return 0;
  const per = (b.hpMax || b.hp || 1) / b.mods.length, f = b.mods[k] / per;
  return f <= 0 ? 3 : f < 0.35 ? 2 : f < 0.72 ? 1 : 0;
}
function hpState(b) { if (!b) return 0; if (b.ruin) return 3; if (b.mstate?.length === 1) return b.mstate[0]; const f = b.hp / (b.hpMax || b.hp || 1); return f < 0.3 ? 2 : f < 0.7 ? 1 : 0; }

// ---- CURTAIN: extruded along stations, following the ground; modules in their damage state
function buildCurtain(gb, map, K, p, b, clip) {
  const len = Math.hypot(p.x1 - p.x0, p.y1 - p.y0), ux = (p.x1 - p.x0) / len, uy = (p.y1 - p.y0) / len;
  let nx = -uy, ny = ux; const mx = (p.x0 + p.x1) / 2, my = (p.y0 + p.y1) / 2;
  if ((mx - K.cx) * nx + (my - K.cy) * ny < 0) { nx = -nx; ny = -ny; } // n = outward
  const nm = b?.mods?.length || Math.max(1, Math.round(len / 6)), ML = len / nm;
  const st = []; for (let k = 0; k < nm; k++) st.push(modState(b, k));
  const [ta, tb] = clip;
  const doorsT = K.parts.filter((o) => o.kind === "postern" && o.x !== undefined && (o.src.curtain === p.id || Math.abs((o.x - p.x0) * -uy + (o.y - p.y0) * ux) < p.th)).map((o) => (o.x - p.x0) * ux + (o.y - p.y0) * uy).filter((t) => t > 1 && t < len - 1);
  const r = rng((p.bid ?? p.id ?? 1) * 7919 + 13);
  const th = p.th, wh = p.walkH, pt = 0.6; // parapet thickness
  const P = (t, a) => { const x = p.x0 + ux * t + nx * a, y = p.y0 + uy * t + ny * a; return [x, -y]; };
  const G = (t) => map.h(p.x0 + ux * t, p.y0 + uy * t);
  // per-station top cap (a broken parapet or a ragged breach edge lowers it)
  const capAt = (t) => {
    const k = Math.min(nm - 1, Math.max(0, Math.floor(t / ML))), s = st[k], f = (t - k * ML) / ML, h = Math.sin((t * 1.7 + (p.bid || 0)) * 2.3) * 0.5 + 0.5;
    let cap = wh + 1.1;
    if (s === 1 && h > 0.7) cap = wh + 0.55;
    if (s === 2) cap = wh + (h > 0.4 ? -0.2 : 0.4) - 0.3 * Math.sin(f * Math.PI);
    for (const [kk, side] of [[k - 1, 1 - f], [k + 1, f]]) if (kk >= 0 && kk < nm && st[kk] === 3 && side < 0.3) cap = Math.min(cap, wh * (0.45 + side * 1.6) + h * 1.2); // ragged edge by a breach
    return cap;
  };
  // runs of standing modules
  let k = 0;
  while (k < nm) {
    if (st[k] === 3) { k++; continue; }
    let e = k; while (e + 1 < nm && st[e + 1] !== 3) e++;
    const t0 = Math.max(ta, k * ML), t1 = Math.min(tb, (e + 1) * ML);
    if (t1 - t0 > 0.1) {
      const n = Math.max(1, Math.ceil((t1 - t0) / 1.5)), T = [];
      for (let i = 0; i <= n; i++) T.push(t0 + (t1 - t0) * i / n);
      for (const d of doorsT) for (const e of [d - 0.7, d + 0.7]) if (e > t0 + 0.05 && e < t1 - 0.05) T.push(e);
      T.sort((x, y) => x - y);
      for (let i = 0; i < T.length - 1; i++) {
        const a = T[i], c = T[i + 1], ga = G(a), gc = G(c), ca = capAt(a), cc = capAt(c), mid = (a + c) / 2;
        if (c - a < 0.02) continue;
        const km = Math.min(nm - 1, Math.floor(mid / ML)), tone = st[km] === 2 ? TONE.cracked : st[km] === 1 ? TONE.pocked : WHITE, col = stoneTint(r, tone);
        const inDoor = doorsT.some((d) => Math.abs(mid - d) < 0.7); // a postern: the passage through the wall's foot
        const bot = inDoor ? [ga + 2.4, gc + 2.4, gc + 2.4, ga + 2.4] : [ga - 2, gc - 2, gc - 2, ga - 2];
        const walkA = Math.min(wh, ca), walkC = Math.min(wh, cc);
        // body (inner face to parapet's inner face), then the parapet on the outer edge, then the battered plinth
        gb.hexa("stone", 0, [P(a, -th / 2), P(c, -th / 2), P(c, th / 2 - pt), P(a, th / 2 - pt)], bot, [ga + walkA, gc + walkC, gc + walkC, ga + walkA], col);
        gb.hexa("stone", 0, [P(a, th / 2 - pt), P(c, th / 2 - pt), P(c, th / 2), P(a, th / 2)], bot, [ga + ca, gc + cc, gc + cc, ga + ca], col);
        if (!inDoor) gb.hexa("stone", 0, [P(a, th / 2), P(c, th / 2), P(c, th / 2 + 0.6), P(a, th / 2 + 0.6)], bot, [ga + 2.2, gc + 2.2, gc + 0.2, ga + 0.2], stoneTint(r, lerpc(tone, [0.8, 0.8, 0.76], 0.4)));
        // the wall-walk's flagstones (a slightly lighter band, so the walk reads from above)
        if (walkA >= wh - 0.01 && walkC >= wh - 0.01) gb.hexa("stone", 0, [P(a, -th / 2 + 0.05), P(c, -th / 2 + 0.05), P(c, th / 2 - pt), P(a, th / 2 - pt)], [ga + wh, gc + wh, gc + wh, ga + wh], [ga + wh + 0.04, gc + wh + 0.04, gc + wh + 0.04, ga + wh + 0.04], lerpc(tone, [1.12, 1.1, 1.05], 0.8));
      }
      // merlons (1.5 m) and crenels (1 m), each with an arrow loop
      for (let t = t0 + 0.45; t + 2.1 <= t1 - 0.2; t += 3.0) {
        const c = t + 2.1, ga = G(t), gc = G(c), cap = Math.min(capAt(t), capAt(c));
        if (cap < wh + 1.05) continue;
        const km = Math.min(nm - 1, Math.floor((t + 1.05) / ML)); if (st[km] === 1 && r() < 0.3) continue; if (st[km] === 2 && r() < 0.7) continue;
        const col = stoneTint(r, st[km] === 2 ? TONE.cracked : st[km] === 1 ? TONE.pocked : WHITE);
        gb.hexa("stone", 0, [P(t, th / 2 - pt), P(c, th / 2 - pt), P(c, th / 2), P(t, th / 2)], [ga + wh + 1.1, gc + wh + 1.1, gc + wh + 1.1, ga + wh + 1.1], [ga + wh + 2.2, gc + wh + 2.2, gc + wh + 2.2, ga + wh + 2.2], col);
        const m = t + 1.05, gm = G(m); // the loop: a dark slit on the outer face
        gb.hexa("dark", 0, [P(m - 0.06, th / 2 + 0.01), P(m + 0.06, th / 2 + 0.01), P(m + 0.06, th / 2 + 0.03), P(m - 0.06, th / 2 + 0.03)], gm + wh + 1.25, gm + wh + 2.0);
      }
      // hoardings: a timber gallery out over the wall's face (drop holes over the wall foot)
      if (p.hoarding) for (let t = t0 + 0.3; t + 3 <= t1 - 0.3; t += 3) {
        const c = t + 3, ga = G(t), gc = G(c);
        gb.hexa("timber", 0, [P(t, th / 2), P(c, th / 2), P(c, th / 2 + 1.6), P(t, th / 2 + 1.6)], [ga + wh + 0.9, gc + wh + 0.9, gc + wh + 0.9, ga + wh + 0.9], [ga + wh + 1.05, gc + wh + 1.05, gc + wh + 1.05, ga + wh + 1.05]);
        gb.hexa("timber", 0, [P(t, th / 2 + 1.5), P(c, th / 2 + 1.5), P(c, th / 2 + 1.62), P(t, th / 2 + 1.62)], [ga + wh + 1.05, gc + wh + 1.05, gc + wh + 1.05, ga + wh + 1.05], [ga + wh + 2.9, gc + wh + 2.9, gc + wh + 2.9, ga + wh + 2.9]);
        gb.hexa("roof", 0, [P(t, th / 2 - 0.9), P(c, th / 2 - 0.9), P(c, th / 2 + 1.9), P(t, th / 2 + 1.9)], [ga + wh + 3.6, gc + wh + 3.6, gc + wh + 2.8, ga + wh + 2.8], [ga + wh + 3.75, gc + wh + 3.75, gc + wh + 2.95, ga + wh + 2.95]);
      }
    }
    k = e + 1;
  }
  // breaches: a stump, and the rubble slope either side (the way men climb in)
  for (let m = 0; m < nm; m++) {
    if (st[m] !== 3) continue;
    const a = Math.max(ta, m * ML), c = Math.min(tb, (m + 1) * ML); if (c - a < 0.5) continue;
    const ga = G(a), gc = G(c);
    for (let i = 0; i < 4; i++) { const s0 = a + (c - a) * i / 4, s1 = a + (c - a) * (i + 1) / 4, h0 = 0.8 + r() * 1.6; gb.hexa("stone", 0, [P(s0, -th / 2), P(s1, -th / 2), P(s1, th / 2), P(s0, th / 2)], [G(s0) - 2, G(s1) - 2, G(s1) - 2, G(s0) - 2], G((s0 + s1) / 2) + h0, stoneTint(r, TONE.cracked)); }
    rubble(gb, map, (a + c) / 2, (c - a) + 3, (t, s) => { const x = p.x0 + ux * t + nx * s, y = p.y0 + uy * t + ny * s; return [x, y]; }, 3.2, 9, r);
    void ga; void gc;
  }
  return { nx, ny, len, ux, uy, nm, ML, states: st };
}
// a rubble cone: centred at along-coordinate tc, length L, spreading S either side, peak H; at(t, s) → sim x,y
function rubble(gb, map, tc, L, at, H, S, r) {
  const seed = r() * 100;
  gb.grid("rubble", 0, 14, 12, (u, v) => {
    const t = tc + (u - 0.5) * (L + 4), s = (v - 0.5) * 2 * S, [x, y] = at(t, s);
    const fu = Math.max(0, 1 - Math.pow(Math.abs(u - 0.5) * 2, 2.2)), fv = Math.max(0, 1 - Math.abs(s) / S);
    const n = 0.8 + 0.4 * (Math.sin(u * 17 + seed) * Math.cos(v * 13 + seed * 0.7) * 0.5 + 0.5);
    const h = H * fu * Math.pow(fv, 1.25) * n;
    return [x, map.h(x, y) + h - 0.1, -y, 0.85 + 0.25 * fu * fv];
  });
  for (let k = 0; k < 16; k++) { // tumbled blocks on the slope
    const t = tc + (r() - 0.5) * L, s = (r() - 0.5) * 2 * S * 0.8, [x, y] = at(t, s), fv = 1 - Math.abs(s) / S, h = map.h(x, y) + H * Math.pow(Math.max(0, fv), 1.25) * 0.8;
    const w = 0.5 + r() * 0.7, d = 0.35 + r() * 0.4, a = r() * 6.28, ca = Math.cos(a), sa = Math.sin(a);
    const cs = [[-w, -d], [w, -d], [w, d], [-w, d]].map(([p, q]) => [x + p * ca - q * sa, -(y + p * sa + q * ca)]);
    gb.hexa("stone", 0, cs, h - 0.3, [h + 0.2 + r() * 0.3, h + 0.35, h + 0.1 + r() * 0.3, h + 0.3], stoneTint(r, TONE.cracked));
  }
}

// ---- TOWER (round or square): storeys as layers, a spiral stair, floors, doors onto the walks, open top
function buildTower(gb, map, K, p, b) {
  const [g0, glo] = groundOf(map, p), F = p.floors, top = F.at(-1), th = p.shape === "round" ? Math.min(2.2, p.r * 0.38) : 2, r = rng((p.bid ?? p.id ?? 3) * 31 + 5);
  const hs = hpState(b), ruined = hs === 3, tone = hs === 2 ? TONE.cracked : hs === 1 ? TONE.pocked : WHITE;
  const P = p.shape === "round" ? circle(p.x, -p.y, p.r, 20) : subdiv(footprintPoly(p), 1.4), I = inset(P, th);
  if (ruined) { // mined and fallen: a ragged stump and a great heap
    shell(gb, "stone", 0, P, th, glo - 2, g0 + 2.5, { col: stoneTint(r, TONE.cracked) });
    rubble(gb, map, 0, (p.r || p.w / 2) * 2 + 4, (t, s) => [p.x + t, p.y + s], 5, (p.r || p.w / 2) + 7, r);
    return;
  }
  // doors: edges whose outward direction points along a curtain meeting this tower, at the wall-walk
  const doors = new Map(), groundDoor = new Map();
  for (const q of K.parts) if (q.kind === "curtain") for (const [ex, ey, ox, oy] of [[q.x0, q.y0, q.x1, q.y1], [q.x1, q.y1, q.x0, q.y0]]) {
    if (!inside(p, ex, ey, 1.5)) continue;
    let best = -1, bd = -Infinity; const dx = ox - p.x, dy = oy - p.y, dl = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length, mx = (P[i][0] + P[j][0]) / 2 - p.x, my = -(P[i][1] + P[j][1]) / 2 - p.y, d = (mx * dx + my * dy) / (Math.hypot(mx, my) * dl); if (d > bd) { bd = d; best = i; } }
    doors.set(best, q.walkH);
  }
  // a ground door toward the bailey
  { let best = -1, bd = -Infinity; const dx = K.cx - p.x, dy = K.cy - p.y, dl = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length, mx = (P[i][0] + P[j][0]) / 2 - p.x, my = -(P[i][1] + P[j][1]) / 2 - p.y, d = (mx * dx + my * dy) / (Math.hypot(mx, my) * dl); if (d > bd) { bd = d; best = i; } }
    groundDoor.set(best, 0); }
  shell(gb, "stone", 0, P, th + 0.4, glo - 2, g0 + 0.2, { col: stoneTint(r, tone) }); // footing
  // the stair: a newel against the wall on the side away from the bailey
  const ri = p.shape === "round" ? p.r - th : Math.min(p.w, p.d) / 2 - th, ax = p.x - K.cx, ay = p.y - K.cy, al = Math.hypot(ax, ay) || 1;
  const sr = Math.min(1.25, ri * 0.45), nxs = p.x + ax / al * (ri - sr - 0.05), nys = p.y + ay / al * (ri - sr - 0.05), sa0 = Math.atan2(ay, ax) + Math.PI;
  for (let s = 0; s < F.length - 1; s++) {
    const f0 = g0 + F[s], f1 = g0 + F[s + 1], mid = Math.min(f1, f0 + 1.2), L0 = 2 * s, L1 = 2 * s + 1;
    const gaps = new Map(); for (const [e, h] of doors) if (Math.abs(h - F[s]) < 0.6) gaps.set(e, f0 + 2.3);
    if (s === 0) for (const [e] of groundDoor) gaps.set(e, f0 + 2.3);
    const lowGaps = new Map([...gaps].map(([e, h]) => [e, h]));
    shell(gb, "stone", L0, P, th, f0 + (s === 0 ? 0.2 : 0), mid, { gaps: lowGaps, Q: I, col: stoneTint(r, tone) });
    shell(gb, "stone", L1, P, th, mid, f1, { gaps, Q: I, col: stoneTint(r, tone) });
    // loops in the high part of each storey
    for (let i = 0; i < P.length; i += p.shape === "round" ? 5 : 1) { if (gaps.has(i)) continue; const j = (i + 1) % P.length, mx = (P[i][0] + P[j][0]) / 2, mz = (P[i][1] + P[j][1]) / 2, ox = mx - p.x, oz = mz + p.y, ol = Math.hypot(ox, oz) || 1;
      const tx = -oz / ol * 0.07, tz = ox / ol * 0.07, o1 = 0.03 / ol;
      gb.hexa("dark", L1, [[mx - tx + ox * o1, mz - tz + oz * o1], [mx + tx + ox * o1, mz + tz + oz * o1], [mx + tx + ox * o1 * 2, mz + tz + oz * o1 * 2], [mx - tx + ox * o1 * 2, mz - tz + oz * o1 * 2]], f0 + 1.6, f0 + 2.8); }
    // the floor of this storey (timber; the ground floor beaten earth/stone), with the stairwell left open
    const inWell = (x, y) => Math.hypot(x - nxs, y - nys) < sr + 0.25;
    if (p.shape !== "round") floorSq(gb, s > 0 ? "wood" : "paving", L0, p, ri + 0.2, f0 - (s > 0 ? 0.25 : 0.3), f0 + (s > 0 ? 0 : 0.02), s > 0 ? inWell : () => false, s > 0 ? WHITE : [0.8, 0.78, 0.74]);
    else if (s > 0) floorWedges(gb, "wood", L0, p.x, p.y, ri, f0 - 0.25, f0, inWell);
    else floorWedges(gb, "paving", L0, p.x, p.y, ri, f0 - 0.3, f0 + 0.02, () => false, [0.8, 0.78, 0.74]);
    // spiral stair from this floor to the next (0.2 m risers, 24° a step), with its newel
    if (s < F.length - 1) {
      const n = Math.max(4, Math.round((F[s + 1] - F[s]) / 0.2)), rise = (F[s + 1] - F[s]) / n;
      for (let q = 0; q < n; q++) {
        const a0 = sa0 + q * 0.42 + s * 1.3, a1 = a0 + 0.46, y = f0 + q * rise;
        const cs = [[nxs + Math.cos(a0) * 0.18, -(nys + Math.sin(a0) * 0.18)], [nxs + Math.cos(a0) * sr, -(nys + Math.sin(a0) * sr)], [nxs + Math.cos(a1) * sr, -(nys + Math.sin(a1) * sr)], [nxs + Math.cos(a1) * 0.18, -(nys + Math.sin(a1) * 0.18)]];
        gb.hexa("stone", y + rise - f0 > 1.9 ? L1 : L0, cs, y, y + rise + 0.05, stoneTint(r, [0.9, 0.88, 0.84]));
      }
      shell(gb, "stone", L0, circle(nxs, -nys, 0.2, 8), 0.19, f0, mid); shell(gb, "stone", L1, circle(nxs, -nys, 0.2, 8), 0.19, mid, f1 - 0.3);
    }
  }
  // the top: a floor (lead over timber) and battlements (merlons on alternate edges)
  const ft = g0 + top, TL = 2 * (F.length - 1);
  if (p.shape !== "round") floorSq(gb, "lead", TL, p, ri + 0.2, ft - 0.35, ft, (x, y) => Math.hypot(x - nxs, y - nys) < sr * 0.8, [0.72, 0.72, 0.74]);
  else floorWedges(gb, "lead", TL, p.x, p.y, ri, ft - 0.35, ft, (x, y) => Math.hypot(x - nxs, y - nys) < sr * 0.8, [0.72, 0.72, 0.74]);
  shell(gb, "stone", TL, P, 0.7, ft - 0.4, ft + 1.05, { col: stoneTint(r, tone) });
  const merl = inset(P, 0.7);
  shell(gb, "stone", TL, P, 0.7, ft + 1.05, ft + 2.2, { Q: merl, skip: (i) => i % 2 === 1 || (hs >= 1 && r() < 0.3 * hs), col: stoneTint(r, tone) });
  // a hatch-house over the stair head
  shell(gb, "stone", TL, circle(nxs, -nys, sr + 0.35, 10), 0.3, ft, ft + 2.3, { skip: (i) => i === 0 });
  gb.hexa("roof", TL, circle(nxs, -nys, sr + 0.5, 4, Math.PI / 4), ft + 2.3, [ft + 2.5, ft + 2.5, ft + 2.5, ft + 2.5]);
  if (p.hoarding) { const Hq = inset(P, -1.4); shell(gb, "timber", TL, Hq, 1.3, ft + 0.5, ft + 0.62, { Q: P }); shell(gb, "timber", TL, Hq, 0.12, ft + 0.62, ft + 2.8); }
}
// a floor of wedges from the centre (round or polygonal rooms), leaving out the cells hole(x,y) says
function floorWedges(gb, mat, layer, x, y, ri, y0, y1, hole, col = WHITE) {
  const n = 20, rings = [0, 0.5, 1];
  for (let k = 0; k < n; k++) for (let j = 0; j < 2; j++) {
    const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2, r0 = ri * rings[j], r1 = ri * rings[j + 1] + 0.05;
    const am = (a0 + a1) / 2, rm = (r0 + r1) / 2; if (hole(x + Math.cos(am) * rm, y + Math.sin(am) * rm)) continue;
    gb.hexa(mat, layer, [[x + Math.cos(a0) * r0, -(y + Math.sin(a0) * r0)], [x + Math.cos(a0) * r1, -(y + Math.sin(a0) * r1)], [x + Math.cos(a1) * r1, -(y + Math.sin(a1) * r1)], [x + Math.cos(a1) * r0, -(y + Math.sin(a1) * r0)]], y0, y1, col);
  }
}
// a square tower's floor (tiles in the part's frame), holes by world test
function floorSq(gb, mat, layer, p, half, y0, y1, hole, col) {
  const F = frame(p), n = Math.max(2, Math.round(half * 2 / 1.5)), c = half * 2 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const a0 = -half + i * c, b0 = -half + j * c, [mx, mz] = F(a0 + c / 2, b0 + c / 2); if (hole(mx, -mz)) continue; gb.hexa(mat, layer, [F(a0, b0), F(a0 + c, b0), F(a0 + c, b0 + c), F(a0, b0 + c)], y0, y1, col); }
}
// a rectangular floor of tiles (keep, gatehouse), leaving a stairwell rect [a0,a1]×[b0,b1] in part-local coords open
function floorTiles(gb, mat, layer, F, hw, hd, y0, y1, well = null, col = WHITE, cell = 2.5) {
  const nu = Math.max(1, Math.round(hw * 2 / cell)), nv = Math.max(1, Math.round(hd * 2 / cell));
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a0 = -hw + i * hw * 2 / nu, a1 = a0 + hw * 2 / nu, b0 = -hd + j * hd * 2 / nv, b1 = b0 + hd * 2 / nv;
    if (well && (a0 + a1) / 2 > well[0] && (a0 + a1) / 2 < well[1] && (b0 + b1) / 2 > well[2] && (b0 + b1) / 2 < well[3]) continue;
    gb.hexa(mat, layer, [F(a0, b0), F(a1, b0), F(a1, b1), F(a0, b1)], y0, y1, col);
  }
}
// a straight stair flight in part-local coords from (a0,b) to (a1,b), width wd, rising from y0 to y1
function flight(gb, layer, F, a0, a1, b, wd, y0, y1, col = [0.92, 0.9, 0.86]) {
  const n = Math.max(3, Math.round((y1 - y0) / 0.2)), da = (a1 - a0) / n, rise = (y1 - y0) / n;
  for (let q = 0; q < n; q++) { const s0 = a0 + da * q, s1 = s0 + da, top = y0 + rise * (q + 1); gb.hexa("stone", layer % 2 === 0 && top - y0 > 1.9 ? layer + 1 : layer, [F(s0, b - wd / 2), F(s1, b - wd / 2), F(s1, b + wd / 2), F(s0, b + wd / 2)], y0 + rise * q - 0.4, top, col); }
}
// ---- KEEP: a great tower of storeys (store, hall, chamber, roof walk), stairs, the forebuilding stair
function buildKeep(gb, map, K, p, b) {
  const [g0, glo] = groundOf(map, p), F = p.floors, top = F.at(-1), th = 3, r = rng((p.bid ?? p.id ?? 5) * 17 + 1);
  const hs = hpState(b), tone = hs === 2 ? TONE.cracked : hs === 1 ? TONE.pocked : WHITE;
  const L2W = frame(p), hw = p.w / 2, hd = p.d / 2, P = footprintPoly(p), I = inset(P, th), ihw = hw - th, ihd = hd - th;
  // the face toward the bailey centre carries the forebuilding (the entrance is on the first floor)
  const c = Math.cos(p.rot), s = Math.sin(p.rot), bx = (K.cx - p.x) * c + (K.cy - p.y) * s, by = -(K.cx - p.x) * s + (K.cy - p.y) * c;
  const side = Math.abs(bx) > Math.abs(by) ? (bx > 0 ? 1 : 3) : (by > 0 ? 2 : 0); // P's edges: 0 b=-hd, 1 a=+hw, 2 b=+hd, 3 a=-hw
  const along = side % 2 === 0, sg = side === 0 || side === 3 ? -1 : 1, half = along ? hw : hd;
  const LL = (u, v) => along ? L2W(u, sg * (hd + v)) : L2W(sg * (hw + v), u);        // the bailey face: u along it, v out from it
  const edgeDist = (u) => side === 0 ? u + hw : side === 1 ? u + hd : side === 2 ? hw - u : hd - u;
  const run = Math.max(3, (F[1] - 0.2) / 0.2 * 0.3), u0 = -half + 1.2, u1 = u0 + run, doorU = Math.min(half - 2, u1 + 1.6);
  shell(gb, "stone", 0, inset(P, -0.8), th + 0.8, glo - 2, g0 + 1.0, { col: stoneTint(r, [0.9, 0.88, 0.85]) }); // the battered plinth
  // stairs climb along the a=+ihw wall, alternately toward +b and -b, through a stairwell left open in each floor
  const SW = 1.5, sa = ihw - SW / 2 - 0.1, wellB = [-ihd + 0.3, ihd - 0.3], fl0 = -ihd + 0.5, fl1 = ihd - 0.5;
  const well = [ihw - SW - 0.3, ihw + 0.3, -ihd - 1, ihd + 1];
  for (let st = 0; st < F.length - 1; st++) {
    const f0 = g0 + F[st], f1 = g0 + F[st + 1], mid = Math.min(f1, f0 + 1.2), L0 = 2 * st, L1 = 2 * st + 1;
    const gaps = new Map(); if (st === 1 && p.fore) gaps.set(side, door(P, side, f0 + 2.8, 1.8, edgeDist(doorU)));
    if (st === 0) gaps.set(side, door(P, side, f0 + 2.0, 1.1, edgeDist(half - 2.5))); // the store's door (barred in a siege)
    shell(gb, "stone", L0, P, th, f0 + (st === 0 ? 0.02 : 0), mid, { gaps, Q: I, col: stoneTint(r, tone) });
    shell(gb, "stone", L1, P, th, mid, f1, { gaps, Q: I, col: stoneTint(r, tone) });
    // pilaster buttresses and windows (slits in the store and chamber, two-light windows in the hall)
    for (let e = 0; e < 4; e++) {
      const alA = e % 2 === 0, sgn = e === 0 || e === 3 ? -1 : 1, hl = alA ? hw : hd;
      const pp = (t, u, v) => alA ? L2W(t + u, sgn * (hd + v)) : L2W(sgn * (hw + v), t + u);
      for (const t of [-hl * 0.5, hl * 0.5]) { const wd = st === 1 ? 0.55 : 0.12; if (st > 0 || e !== side) gb.hexa("dark", L1, [pp(t, -wd, 0.02), pp(t, wd, 0.02), pp(t, wd, 0.06), pp(t, -wd, 0.06)], f0 + (st === 1 ? 2.2 : 2.4), f0 + (st === 1 ? 4.6 : 3.6)); }
      for (const t of [-hl, 0, hl]) gb.hexa("stone", L1, [pp(t, -0.9, -0.02), pp(t, 0.9, -0.02), pp(t, 0.9, 0.5), pp(t, -0.9, 0.5)], mid, f1, stoneTint(r, tone));
      for (const t of [-hl, 0, hl]) gb.hexa("stone", L0, [pp(t, -0.9, -0.02), pp(t, 0.9, -0.02), pp(t, 0.9, 0.5), pp(t, -0.9, 0.5)], f0, mid, stoneTint(r, tone));
    }
    // the floor: flags in the store, boards above (the stairwell left open)
    if (st === 0) floorTiles(gb, "paving", L0, L2W, ihw + 0.1, ihd + 0.1, f0 - 0.3, f0 + 0.02, null, [0.78, 0.76, 0.72]);
    else floorTiles(gb, "wood", L0, L2W, ihw + 0.1, ihd + 0.1, f0 - 0.3, f0, well);
    // the flight up to the next floor (the last comes out on the roof walk)
    const up = st % 2 === 0; flight(gb, L0, (a, bb) => L2W(bb, a), up ? fl0 : fl1, up ? fl1 : fl0, sa, SW, f0, f1);
    // furnishing: the hall's hearth, table and benches; barrels in the store; a bed in the chamber
    if (st === 1) {
      gb.hexa("stone", L0, [L2W(-ihw, -2), L2W(-ihw + 1.2, -2), L2W(-ihw + 1.2, 2), L2W(-ihw, 2)], f0, f0 + 2.6, [0.85, 0.83, 0.8]);
      gb.hexa("dark", L0, [L2W(-ihw + 1.2, -1.2), L2W(-ihw + 1.25, -1.2), L2W(-ihw + 1.25, 1.2), L2W(-ihw + 1.2, 1.2)], f0, f0 + 1.3);
      gb.hexa("timber", L0, [L2W(-4, -1), L2W(3, -1), L2W(3, 0.2), L2W(-4, 0.2)], f0 + 0.75, f0 + 0.85);
      for (const bb of [-1.7, 0.9]) gb.hexa("timber", L0, [L2W(-4, bb), L2W(3, bb), L2W(3, bb + 0.35), L2W(-4, bb + 0.35)], f0 + 0.4, f0 + 0.48);
    } else if (st === 0) {
      for (let q = 0; q < 8; q++) { const [X, Z] = L2W(-ihw + 1 + (q % 4) * 1.2, ihd - 1 - Math.floor(q / 4) * 1.2); shell(gb, "timber", L0, circle(X, Z, 0.45, 8), 0.44, f0, f0 + 1.0); }
    } else if (st === F.length - 2) {
      gb.hexa("timber", L0, [L2W(-ihw + 0.3, -ihd + 0.3), L2W(-ihw + 2.3, -ihd + 0.3), L2W(-ihw + 2.3, -ihd + 3), L2W(-ihw + 0.3, -ihd + 3)], f0, f0 + 0.6);
    }
  }
  // the roof walk: leads between the parapets, merlons, corner turrets
  const ft = g0 + top, TL = 2 * (F.length - 1);
  floorTiles(gb, "lead", TL, L2W, ihw + 0.2, ihd + 0.2, ft - 0.4, ft, (F.length - 1) % 2 ? well : well, [0.7, 0.71, 0.74], 3.5);
  shell(gb, "stone", TL, P, 0.8, ft - 0.4, ft + 1.1, { col: stoneTint(r, tone) });
  for (let e = 0; e < 4; e++) {
    const alA = e % 2 === 0, sgn = e === 0 || e === 3 ? -1 : 1, hl = alA ? hw : hd;
    for (let t = -hl + 4.3; t + 1.4 < hl - 4; t += 2.4) {
      const pp = (u, v) => alA ? L2W(t + u, sgn * (hd - v)) : L2W(sgn * (hw - v), t + u);
      if (hs >= 1 && r() < 0.35 * hs) continue;
      gb.hexa("stone", TL, [pp(0, 0), pp(1.4, 0), pp(1.4, 0.8), pp(0, 0.8)], ft + 1.1, ft + 2.2, stoneTint(r, tone));
    }
  }
  for (const [sa2, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { // corner turrets
    const tp = subdiv([L2W(sa2 * hw, sb * hd), L2W(sa2 * (hw - 4), sb * hd), L2W(sa2 * (hw - 4), sb * (hd - 4)), L2W(sa2 * hw, sb * (hd - 4))], 1.4);
    shell(gb, "stone", TL, tp, 0.7, ft - 0.4, ft + 3.4, { col: stoneTint(r, tone) });
    floorTiles(gb, "lead", TL, (a, bb) => L2W(sa2 * (hw - 2) + a, sb * (hd - 2) + bb), 1.5, 1.5, ft + 3.0, ft + 3.2, null, [0.7, 0.7, 0.72], 3);
    shell(gb, "stone", TL, tp, 0.6, ft + 3.4, ft + 4.4, { skip: (i) => i % 2 === 1 });
  }
  // the forebuilding: a stone stair up the bailey face to the first-floor door, walled on its open side
  if (p.fore && F.length > 2) {
    const f1 = g0 + F[1];
    flight(gb, 2, LL, u0, u1, 1.6, 2.6, g0 + 0.02, f1 - 0.02);
    gb.hexa("stone", 2, [LL(u1, 0.2), LL(doorU + 1.2, 0.2), LL(doorU + 1.2, 3.0), LL(u1, 3.0)], glo - 1, f1, stoneTint(r, tone)); // the landing before the door
    const n = 8; for (let q = 0; q < n; q++) { const a0 = u0 + run * q / n, a1 = u0 + run * (q + 1) / n, y0 = g0 + (f1 - g0) * q / n, y1 = g0 + (f1 - g0) * (q + 1) / n; gb.hexa("stone", 2, [LL(a0, 2.9), LL(a1, 2.9), LL(a1, 3.4), LL(a0, 3.4)], glo - 1, [y0 + 1.1, y1 + 1.1, y1 + 1.1, y0 + 1.1], stoneTint(r, tone)); }
    gb.hexa("stone", 3, [LL(u1, 2.9), LL(doorU + 1.2, 2.9), LL(doorU + 1.2, 3.4), LL(u1, 3.4)], f1, f1 + 1.1, stoneTint(r, tone));
  }
}
// ---- GATEHOUSE: two flanking towers with round fronts, the passage between them, a chamber over it, a roof walk
function buildGatehouse(gb, map, K, p, b) {
  const [g0, glo] = groundOf(map, p), F = p.floors, top = F.at(-1), r = rng((p.bid ?? p.id ?? 9) * 13 + 3);
  { const c = Math.cos(p.rot), s = Math.sin(p.rot), by = -(K.cx - p.x) * s + (K.cy - p.y) * c; if (by > 0) p.rot += Math.PI; } // local +b points out of the castle
  const hs = hpState(b), tone = hs === 2 ? TONE.cracked : hs === 1 ? TONE.pocked : WHITE;
  const L2W = frame(p), hw = p.w / 2, pw = p.pw / 2, b0 = -p.d * 0.42, b1 = p.d * 0.58, th = 1.8, R = (hw - pw) / 2;
  const wh = p.walkH ?? F[1], walk = g0 + wh, pass = g0 + Math.min(5, wh - 2.2);
  const towerPoly = (sg) => { // the back as a rectangle, the front (outward, +b) a half-round
    const ac = sg * (pw + R), pts = sg > 0 ? [L2W(pw, b0), L2W(hw, b0)] : [L2W(-hw, b0), L2W(-pw, b0)];
    for (let k = 0; k <= 8; k++) { const a = sg > 0 ? k / 8 * Math.PI : k / 8 * Math.PI; pts.push(L2W(ac + Math.cos(a) * R, b1 - R + Math.sin(a) * R)); }
    return subdiv(pts, 1.6);
  };
  { const F2 = (a, bb) => L2W(a, bb); shell(gb, "stone", 0, [F2(-hw - 0.7, b0 - 0.7), F2(hw + 0.7, b0 - 0.7), F2(hw + 0.7, b1 - R), F2(-hw - 0.7, b1 - R)], 1.2, glo - 2, g0 + 0.1, { col: stoneTint(r, [0.9, 0.88, 0.85]) }); }
  for (const sg of [-1, 1]) {
    const T = towerPoly(sg), TI = inset(T, th), room = (a, bb) => L2W(sg * (pw + R) + a, (b0 + b1 - R) / 2 + bb), rhw = R - th + 0.2, rhd = (b1 - b0 - R) / 2 - th + 0.2;
    const fa = sg * (R - th - 0.7), fb0 = b0 + th + 0.2, fb1 = fb0 + 3.4, mb = (b0 + b1 - R) / 2;
    const well = sg > 0 ? [fa - 0.9, R, fb0 - mb - 1, fb1 - mb - 0.6] : [-R, fa + 0.9, fb0 - mb - 1, fb1 - mb - 0.6];
    for (let st = 0; st < F.length - 1; st++) {
      const f0 = g0 + F[st], f1 = g0 + F[st + 1], mid = Math.min(f1, f0 + 1.2);
      const gaps = new Map(); if (st === 0) gaps.set(0, door(T, 0, f0 + 2.2, 1.2));
      shell(gb, "stone", 2 * st, T, th, f0 + (st ? 0 : 0.1), mid, { gaps, Q: TI, col: stoneTint(r, tone) });
      shell(gb, "stone", 2 * st + 1, T, th, mid, f1, { gaps, Q: TI, col: stoneTint(r, tone) });
      floorTiles(gb, st ? "wood" : "paving", 2 * st, room, rhw, rhd, f0 - (st ? 0.3 : 0), f0 + 0.02, st ? well : null, st ? WHITE : [0.8, 0.78, 0.74], 1.6);
      flight(gb, 2 * st, (a, bb) => L2W(sg * (pw + R) + bb, a), fb0, fb1, fa, 1.2, f0, f1);
      for (let k = 3; k < T.length - 1; k += 3) { const [X, Z] = T[k], [CX, CZ] = L2W(sg * (pw + R), b1 - R), ox = X - CX, oz = Z - CZ, ol = Math.hypot(ox, oz) || 1, tx = -oz / ol * 0.08, tz = ox / ol * 0.08, e = 0.04 / ol;
        gb.hexa("dark", 2 * st + 1, [[X - tx + ox * e, Z - tz + oz * e], [X + tx + ox * e, Z + tz + oz * e], [X + tx + ox * e * 2, Z + tz + oz * e * 2], [X - tx + ox * e * 2, Z - tz + oz * e * 2]], f0 + 1.6, f0 + 2.9); }
    }
  }
  // over the passage: the vault (murder holes in its soffit), the chamber floor at the walk, the chamber's end walls
  gb.hexa("stone", 1, [L2W(-pw, b0), L2W(pw, b0), L2W(pw, b1 - R + 0.3), L2W(-pw, b1 - R + 0.3)], pass, walk - 0.3, stoneTint(r, tone));
  for (let k = 0; k < 4; k++) { const bb = b0 + 2 + k * (b1 - R - b0 - 3) / 3; gb.hexa("dark", 1, [L2W(-0.3, bb - 0.3), L2W(0.3, bb - 0.3), L2W(0.3, bb + 0.3), L2W(-0.3, bb + 0.3)], pass - 0.02, pass + 0.01); }
  floorTiles(gb, "wood", 2, (a, bb) => L2W(a, (b0 + b1 - R) / 2 + bb), pw + 0.1, (b1 - R - b0) / 2 - 0.6, walk - 0.3, walk, null);
  for (const [bb0, bb1] of [[b0, b0 + 0.9], [b1 - R - 0.6, b1 - R + 0.3]]) {
    const cs = [L2W(-pw, bb0), L2W(pw, bb0), L2W(pw, bb1), L2W(-pw, bb1)];
    gb.hexa("stone", 2, cs, walk - 0.3, walk + 1.2, stoneTint(r, tone)); gb.hexa("stone", 3, cs, walk + 1.2, g0 + top, stoneTint(r, tone));
  }
  // the windlass that raises the outer portcullis
  gb.hexa("timber", 2, [L2W(-pw + 0.3, b1 - R - 1.6), L2W(pw - 0.3, b1 - R - 1.6), L2W(pw - 0.3, b1 - R - 1.2), L2W(-pw + 0.3, b1 - R - 1.2)], walk + 0.6, walk + 1.0);
  // the roof walk: flat over everything, a parapet round the outside, merlons
  const ft = g0 + top, TL = 2 * (F.length - 1);
  floorTiles(gb, "lead", TL, (a, bb) => L2W(a, (b0 + b1 - R) / 2 + bb), hw - 0.3, (b1 - R - b0) / 2 - 0.3, ft - 0.4, ft, null, [0.72, 0.72, 0.74], 2.5);
  for (const sg of [-1, 1]) { const T = towerPoly(sg), TI = inset(T, th);
    floorTiles(gb, "lead", TL, (a, bb) => L2W(sg * (pw + R) + a, b1 - R + bb), R - 0.3, R * 0.7, ft - 0.4, ft, null, [0.72, 0.72, 0.74], 1.5);
    shell(gb, "stone", TL, T, 0.7, ft - 0.4, ft + 1.05, { col: stoneTint(r, tone), skip: (i) => { const j = (i + 1) % T.length; const mx = (T[i][0] + T[j][0]) / 2, mz = (T[i][1] + T[j][1]) / 2, c = Math.cos(p.rot), s2 = Math.sin(p.rot), dx = mx - p.x, dy = -mz - p.y, a = dx * c + dy * s2; return Math.abs(Math.abs(a) - pw) < 0.3; } });
    shell(gb, "stone", TL, T, 0.7, ft + 1.05, ft + 2.2, { skip: (i) => { const j = (i + 1) % T.length; const mx = (T[i][0] + T[j][0]) / 2, mz = (T[i][1] + T[j][1]) / 2, c = Math.cos(p.rot), s2 = Math.sin(p.rot), dx = mx - p.x, dy = -mz - p.y, a = dx * c + dy * s2; return i % 2 === 1 || Math.abs(Math.abs(a) - pw) < 0.3 || (hs >= 1 && r() < 0.3 * hs); }, col: stoneTint(r, tone) });
    void TI; }
  for (const bb of [b0, b1 - R - 0.2]) gb.hexa("stone", TL, [L2W(-pw, bb), L2W(pw, bb), L2W(pw, bb + 0.7), L2W(-pw, bb + 0.7)], ft - 0.4, ft + 1.05, stoneTint(r, tone));
  for (let a = -pw + 0.2; a + 1.2 < pw; a += 2.2) gb.hexa("stone", TL, [L2W(a, b1 - R - 0.2), L2W(a + 1.2, b1 - R - 0.2), L2W(a + 1.2, b1 - R + 0.5), L2W(a, b1 - R + 0.5)], ft + 1.05, ft + 2.2, stoneTint(r, tone));
  return { L2W, pw, b0, b1, pass, g0, gP: [b1 - R, b0 + 0.6], gL: b1 - R - 1.0 }; // (the grooves where castle.js puts p.portcullises)
}
// the moving parts of a gatehouse: two portcullises and two gate leaves, each its own small mesh
function gateParts(G, M, rot) {
  const { L2W, pw, pass, g0 } = G, H = pass - g0, grp = new THREE.Group();
  const toMeshes = (gb) => { const { whole } = gb.build(), g = new THREE.Group(); for (const [m, geo] of whole) g.add(new THREE.Mesh(geo, M[m])); return g; };
  const port = G.gP.map((bb) => { // a lattice of iron-shod timber in the part's frame (x along the passage width), hung in its groove
    const gb = new GB(), wd = pw * 2 + 0.3;
    for (let a = -wd / 2 + 0.12; a <= wd / 2 - 0.05; a += 0.36) gb.hexa("timber", 0, [[a - 0.07, -0.08], [a + 0.07, -0.08], [a + 0.07, 0.08], [a - 0.07, 0.08]], -0.1, H + 0.2);
    for (let y = 0.35; y < H; y += 0.45) gb.hexa("timber", 0, [[-wd / 2, -0.06], [wd / 2, -0.06], [wd / 2, 0.06], [-wd / 2, 0.06]], y, y + 0.12);
    for (let a = -wd / 2 + 0.12; a <= wd / 2 - 0.05; a += 0.36) gb.hexa("iron", 0, [[a - 0.08, -0.09], [a + 0.08, -0.09], [a + 0.08, 0.09], [a - 0.08, 0.09]], -0.35, -0.05);
    const g = toMeshes(gb), [X, Z] = L2W(0, bb); g.position.set(X, g0, Z); g.rotation.y = rot; grp.add(g); return g;
  });
  const leaves = [-1, 1].map((sg) => { // a leaf hinged at the passage side (a = -sg·pw), spanning toward the middle; it swings in (toward -b)
    const gb = new GB();
    gb.hexa("timber", 0, [[0, -0.09], [sg * pw, -0.09], [sg * pw, 0.09], [0, 0.09]], 0, H - 0.15);
    for (const y of [0.5, H * 0.5, H - 0.8]) gb.hexa("iron", 0, [[0, -0.12], [sg * pw * 0.95, -0.12], [sg * pw * 0.95, 0.12], [0, 0.12]], y, y + 0.14);
    const g = toMeshes(gb), [X, Z] = L2W(-sg * pw, G.gL); g.position.set(X, g0, Z); g.rotation.y = rot; g.userData = { base: rot, sg }; grp.add(g); return g;
  });
  return { grp, port, leaves, H };
}
// ---- BAILEY BUILDINGS: stone walls, a pitched roof, a door; storey 0 only (roof = layer 1 up)
function buildHouse(gb, map, K, p, b) {
  const [g0, glo] = groundOf(map, p), r = rng((p.id ?? 11) * 7 + 2), L2W = frame(p), hw = p.w / 2, hd = p.d / 2, wallH = p.floors[1], th = p.kind === "stable" ? 0.5 : 0.8;
  const P = footprintPoly(p), I = inset(P, th), gaps = new Map([[0, door(P, 0, g0 + 2.4, 1.6)]]);
  if (hpState(b) === 3) { shell(gb, "stone", 0, P, th, glo - 1, g0 + 1.2, { col: stoneTint(r, TONE.scorch) }); return; }
  shell(gb, "stone", 0, P, th + 0.3, glo - 1, g0 + 0.1);
  shell(gb, "stone", 0, P, th, g0, g0 + 1.2, { gaps, Q: I, col: stoneTint(r, [1.02, 1, 0.96]) });
  shell(gb, "stone", 1, P, th, g0 + 1.2, g0 + wallH, { gaps, Q: I, col: stoneTint(r, [1.02, 1, 0.96]) });
  floorTiles(gb, p.kind === "hall" ? "wood" : "paving", 0, L2W, hw - th + 0.1, hd - th + 0.1, g0 - 0.2, g0 + 0.05, null, p.kind === "hall" ? WHITE : [0.7, 0.66, 0.6], 3);
  // gables and the roof (steeper on the chapel), eaves out 0.5 m
  const pitch = p.kind === "chapel" ? 1.2 : 0.8, ridge = g0 + wallH + hd * pitch, e = 0.5;
  for (const sa of [-1, 1]) { // gable triangles (a wedge per end)
    const a0 = sa * hw, a1 = sa * (hw - th);
    gb.hexa("stone", 2, [L2W(a0, -hd), L2W(a1, -hd), L2W(a1, 0), L2W(a0, 0)], g0 + wallH, [g0 + wallH, g0 + wallH, ridge, ridge], stoneTint(r));
    gb.hexa("stone", 2, [L2W(a0, 0), L2W(a1, 0), L2W(a1, hd), L2W(a0, hd)], g0 + wallH, [ridge, ridge, g0 + wallH, g0 + wallH], stoneTint(r));
  }
  for (const sb of [-1, 1]) gb.hexa("roof", 3, [L2W(-hw - e, 0), L2W(hw + e, 0), L2W(hw + e, sb * (hd + e)), L2W(-hw - e, sb * (hd + e))], [ridge, ridge, g0 + wallH - e * pitch, g0 + wallH - e * pitch].map((v) => v - 0.2), [ridge, ridge, g0 + wallH - e * pitch, g0 + wallH - e * pitch]);
  if (p.kind === "hall") { gb.hexa("stone", 0, [L2W(-hw + th, -1.2), L2W(-hw + th + 1, -1.2), L2W(-hw + th + 1, 1.2), L2W(-hw + th, 1.2)], g0, g0 + 2.2, [0.8, 0.78, 0.75]);
    gb.hexa("timber", 0, [L2W(-hw + 3, -1), L2W(hw - 2, -1), L2W(hw - 2, 0.2), L2W(-hw + 3, 0.2)], g0 + 0.75, g0 + 0.85); }
  if (p.kind === "chapel") gb.hexa("timber", 0, [L2W(hw - th - 1.5, -1), L2W(hw - th - 0.6, -1), L2W(hw - th - 0.6, 1), L2W(hw - th - 1.5, 1)], g0, g0 + 1.0);
  for (let t = -hw + 2.5; t < hw - 1.5; t += 3.5) for (const sb of [-1, 1]) gb.hexa("dark", 1, [L2W(t - 0.3, sb * (hd + 0.02)), L2W(t + 0.3, sb * (hd + 0.02)), L2W(t + 0.3, sb * (hd + 0.05)), L2W(t - 0.3, sb * (hd + 0.05))], g0 + 2.2, g0 + (p.kind === "chapel" ? 5 : 4));
}
// ---- DITCH / MOAT: the terrain is not dug, so a ditch is dark trodden earth deepening to its middle, and a moat a band
// of still water between earth banks, both laid on the ground along castle.js's segments (a causeway before each gate)
// A moat FILLED by the besiegers (siege-war.js fillMoat: part.fills [{x, y, r}]) has no water across the causeway:
// packed fascines and earth there instead, a little proud of the banks.
function buildDitch(gb, map, p) {
  const fills = p.src?.fills || [];
  for (const [x0, y0, x1, y1] of p.segs) {
    const L = Math.hypot(x1 - x0, y1 - y0); if (L < 1) continue; const ux = (x1 - x0) / L, uy = (y1 - y0) / L, nx = -uy, ny = ux, W = p.width;
    const at = (u, v, lift, k) => { const x = x0 + ux * u * L + nx * v, y = y0 + uy * u * L + ny * v; return [x, map.h(x, y) + lift, -y, k]; };
    // the stretches of this segment with water (the fills cut gaps in it), as [u0, u1] in 0..1
    const gaps = [];
    for (const f of fills) { const t = (f.x - x0) * ux + (f.y - y0) * uy, d = Math.abs((f.x - x0) * nx + (f.y - y0) * ny); if (d < W && t > -f.r && t < L + f.r) gaps.push([Math.max(0, (t - f.r) / L), Math.min(1, (t + f.r) / L)]); }
    gaps.sort((a, b) => a[0] - b[0]);
    const runs = []; let u = 0; for (const [g0, g1] of gaps) { if (g0 > u) runs.push([u, g0]); u = Math.max(u, g1); } if (u < 1) runs.push([u, 1]);
    for (const [ua, ub] of runs) {
      const span = (ub - ua) * L; if (span < 0.3) continue; const nu = Math.max(1, Math.round(span / 3)), uu = (s) => ua + s * (ub - ua);
      if (p.wet) {
        gb.grid("water", 0, nu, 2, (s, v) => at(uu(s), (v - 0.5) * (W - 2), 0.14, 1));
        for (const sd of [-1, 1]) gb.grid("earth", 0, nu, 2, (s, v) => at(uu(s), sd * (W / 2 - 1.2 + v * 2.2), 0.1, 0.55 + 0.45 * v));
      } else gb.grid("earth", 0, Math.max(nu, Math.round(span / 1.5)), 8, (s, v) => { const c = Math.abs(v - 0.5) * 2; return at(uu(s), (v - 0.5) * W, 0.2, 0.6 + 0.4 * c * c); });
    }
    for (const [g0, g1] of gaps) { // the causeway: earth over bundles of brushwood, bank to bank
      const nu = Math.max(1, Math.round((g1 - g0) * L / 3)), uu = (s) => g0 + s * (g1 - g0);
      gb.grid("earth", 0, nu, 4, (s, v) => { const c = Math.abs(v - 0.5) * 2; return at(uu(s), (v - 0.5) * (W + 1), 0.22 - 0.06 * c, 0.8 + 0.15 * (1 - c)); });
      for (let s = 0.08; s < 1; s += 0.14) { const a = at(uu(s), -(W / 2 - 0.4), 0.2, 1), b = at(uu(s), W / 2 - 0.4, 0.2, 1), hw = 0.22;
        gb.hexa("timber", 0, [[a[0] - ux * hw, a[2] + uy * hw], [a[0] + ux * hw, a[2] - uy * hw], [b[0] + ux * hw, b[2] - uy * hw], [b[0] - ux * hw, b[2] + uy * hw]], Math.min(a[1], b[1]) + 0.02, Math.min(a[1], b[1]) + 0.2); }
    }
  }
}
function buildWell(gb, map, p) { const g = map.h(p.x, p.y); shell(gb, "stone", 0, circle(p.x, -p.y, p.r, 12), 0.3, g - 0.3, g + 0.9); gb.hexa("dark", 0, circle(p.x, -p.y, p.r - 0.3, 4, Math.PI / 4), g + 0.5, g + 0.52);
  for (const s of [-1, 1]) gb.hexa("timber", 0, [[p.x + s * p.r - 0.1, -p.y - 0.1], [p.x + s * p.r + 0.1, -p.y - 0.1], [p.x + s * p.r + 0.1, -p.y + 0.1], [p.x + s * p.r - 0.1, -p.y + 0.1]], g + 0.9, g + 2.2);
  gb.hexa("timber", 0, [[p.x - p.r, -p.y - 0.12], [p.x + p.r, -p.y - 0.12], [p.x + p.r, -p.y + 0.12], [p.x - p.r, -p.y + 0.12]], g + 1.7, g + 1.95); }

// ------------------------------------------------------------------ the renderer
const CUT_DIST = 170, FADE_S = 0.3;
export function makeCastles(scene, map, fx = null) {
  // (materials, the texture library and the kit are loaded only when a castle exists: ensureAssets)
  const M = {}, group = new THREE.Group(); group.name = "castles"; scene.add(group);
  let chips = null;
  function ensureAssets() {
    if (chips) return;
    Object.assign(M, mats()); kitManifest();
    chips = new THREE.InstancedMesh(chipGeo, M.stone, 300); chips.count = 0; chips.frustumCulled = false; group.add(chips);
  }
  const shown = new Map();    // castle id → render state
  let simLH = null; import("../sim/castle.js").then((m) => { simLH = m.levelHeight || null; }).catch(() => {});
  let props = null; const cleared = new Set();
  let manualCut = 0;          // PageUp / PageDown: step the cut storey by hand (relative to the automatic choice)
  addEventListener("keydown", (e) => { if (e.target.closest?.("input,textarea")) return; if (e.key === "PageUp") { manualCut++; e.preventDefault(); } if (e.key === "PageDown") { manualCut--; e.preventDefault(); } });
  const stats = { castles: 0, parts: 0, tris: 0, draws: 0, cut: [], rebuilds: 0, buildMs: 0 };
  // fallen stone: an instanced pool (no allocation per frame)
  const chipGeo = new THREE.BoxGeometry(0.5, 0.4, 0.6);
  const CH = { n: 0, x: new Float32Array(300), y: new Float32Array(300), z: new Float32Array(300), vx: new Float32Array(300), vy: new Float32Array(300), vz: new Float32Array(300), g: new Float32Array(300), age: new Float32Array(300), s: new Float32Array(300) };
  const tmp = new THREE.Object3D();

  function meshesOf(built, M2, parent, shadows = true) {
    const out = [];
    for (const [m, geo] of built) { const o = new THREE.Mesh(geo, M2[m] || M[m]); o.castShadow = shadows && m !== "dark"; o.receiveShadow = true; o.matrixAutoUpdate = false; parent.add(o); out.push(o); }
    return out;
  }
  function tris(built) { let n = 0; for (const g of built.values()) n += g.attributes.position.count / 3; return n; }
  // ---- the KIT (CASTLE-ART's modelled pieces, js/render/castle-kit.js): which piece a part wants, and its placement.
  // A part is drawn from the kit once every piece it needs has loaded; until then (or for a piece the kit lacks) the
  // procedural builders below draw it, so a castle is always on screen.
  const SUF = ["", "_pocked", "_cracked"], clsOf = (walkH) => (walkH >= 9 ? "inner" : walkH < 7 ? "outer" : "main");
  const cx_ = (c) => (c === "main" ? "" : "_" + c);
  // → tpl | null (loading) | false (no such piece); a damage state the kit lacks falls back to the intact piece
  function want(name, intact) { const t = kitPiece(name); if (t === false && intact && intact !== name) return kitPiece(intact); return t; }
  const HOUSE = { hall: [18, 9], chapel: [12, 7], kitchen: [9, 7], stable: [15, 6] };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _v = new THREE.Vector3();
  const placeM = (x, y, h, th, sx = 1, sy = 1) => { _p.set(x, h, -y); _e.set(0, th, 0); _q.setFromEuler(_e); _s.set(sx, 1, sy); return new THREE.Matrix4().compose(_p, _q, _s); };
  function curtainPlan(K, q, b) {
    const len = Math.hypot(q.x1 - q.x0, q.y1 - q.y0), ux = (q.x1 - q.x0) / len, uy = (q.y1 - q.y0) / len;
    let nx = -uy, ny = ux; if (((q.x0 + q.x1) / 2 - K.cx) * nx + ((q.y0 + q.y1) / 2 - K.cy) * ny < 0) { nx = -nx; ny = -ny; }
    const nm = b?.mods?.length || Math.max(1, Math.round(len / 6)), cls = clsOf(q.walkH), base = cls === "main" ? null : "curtain_" + cls;
    // each end runs ~1 m into a round tower's face (the flat end would leave a sliver of sky against the curve)
    const nearT = (x, y) => K.parts.some((o) => o.kind === "tower" && Math.hypot(o.x - x, o.y - y) < (o.r || 5) + 2.5);
    const e0 = nearT(q.x0, q.y0) ? 1 : 0, e1 = nearT(q.x1, q.y1) ? 1 : 0, ML = (len + e0 + e1) / nm;
    const posterns = K.parts.filter((o) => o.kind === "postern" && o.x !== undefined && (o.src.curtain === q.id || Math.abs((o.x - q.x0) * -uy + (o.y - q.y0) * ux) < q.th)).map((o) => (o.x - q.x0) * ux + (o.y - q.y0) * uy);
    const mods = [];
    for (let k = 0; k < nm; k++) {
      const t = -e0 + (k + 0.5) * ML, st = modState(b, k), intact = base || (((k * 7 + (q.bid || 0)) % 3 === 1) ? "curtain_b" : "curtain");
      let name = st === 3 ? intact + "_breach" : intact + SUF[st];
      if (cls === "main" && st === 0 && posterns.some((pt) => Math.abs(pt - t) < ML / 2)) name = "postern";
      mods.push({ k, t, name, intact, st });
      if (q.hoarding && st < 3) mods.push({ k, t, name: cls === "main" ? "hoarding" : "hoarding_" + cls, intact: "hoarding", st, hoard: true });
    }
    return { len, ux, uy, nx, ny, nm, ML, e0, mods, th: Math.atan2(nx, -ny) };
  }
  function towerName(q, b) { const st = hpState(b); return q.shape === "round" ? ["tower_round" + cx_(clsOf(q.walkH)), st === 3 ? "_collapsed" : SUF[st]] : ["tower_square", st === 3 ? "_collapsed" : SUF[st]]; }
  const RUINSUF = ["", "_pocked", "_cracked", "_ruin"];
  // is everything this part needs from the kit loaded?  "K" yes · "" not (yet), or not in the kit
  function kitKey(K, q, b) {
    if (!kitMeta("curtain")) { kitManifest(); return ""; }
    const ok = (...ts) => ts.every((t) => t) ? "K" : "";
    if (q.kind === "curtain") { const P = curtainPlan(K, q, b); return ok(...P.mods.map((m) => want(m.name, m.intact))); }
    if (q.kind === "tower") { const [n, sf] = towerName(q, b); return ok(want(n + sf, n)); }
    if (q.kind === "gatehouse" || q.kind === "keep") { const st = hpState(b); return ok(want(q.kind + RUINSUF[st], q.kind)); }
    if (HOUSE[q.kind] || q.kind === "well") return hpState(b) === 3 ? "" : ok(want(q.kind));
    return "";
  }
  // the kit version of a part: a render record like the procedural one (whole/whole1 groups, lazy layers) or, for a
  // curtain, the list of module instances (drawn instanced castle-wide by mergeStatic)
  function kitPart(K, q, b) {
    const g = map.h(q.x0 ?? q.x, q.y0 ?? q.y);
    if (q.kind === "curtain") {
      const P = curtainPlan(K, q, b), mods = [];
      for (const md of P.mods) {
        const t = md.t, x = q.x0 + P.ux * t, y = q.y0 + P.uy * t, tpl = want(md.name, md.intact); if (!tpl) return null;
        mods.push({ tpl, x, y, m: placeM(x, y, map.h(x, y) - (md.hoard ? 0 : 0.05), P.th, P.ML / 6, 1).elements.slice(), lod: -1 });
      }
      return { kitMods: mods, extra: { ux: P.ux, uy: P.uy, ML: P.len / P.nm, nm: P.nm } };
    }
    let tpl = null, place = null, doors = null, extra = null, moving = null, th = 0, sx = 1, sy = 1;
    const top = (q.floors?.length || 2) - 1;
    if (q.kind === "tower") {
      const [n, sf] = towerName(q, b); tpl = want(n + sf, n); if (!tpl) return null;
      // +y into the castle: the inward bisector of the two curtains leaving it (a mid-curtain tower: toward the bailey)
      let dx = 0, dy = 0; const ends = [];
      for (const o of K.parts) if (o.kind === "curtain") for (const [ex, ey, fx2, fy2] of [[o.x0, o.y0, o.x1, o.y1], [o.x1, o.y1, o.x0, o.y0]]) {
        if (Math.hypot(ex - q.x, ey - q.y) > (q.r || 5) + 3) continue; const l = Math.hypot(fx2 - ex, fy2 - ey) || 1; dx += (fx2 - ex) / l; dy += (fy2 - ey) / l; ends.push([ex, ey]); }
      const cx = K.cx - q.x, cy = K.cy - q.y;
      if (Math.hypot(dx, dy) < 0.35) { dx = cx; dy = cy; } else if (dx * cx + dy * cy < 0) { dx = -dx; dy = -dy; }
      th = Math.atan2(dy, dx) - Math.PI / 2;
      sx = sy = q.shape === "round" ? (q.r || 5.5) / 5.5 : (q.w || 10) / 10;
      // the doorway sector nearest where each curtain's walk meets the tower
      const socks = (tpl.meta.sockets || kitMeta(n)?.sockets || []).filter((k) => k.door); doors = new Set();
      for (const [ex, ey] of ends) {
        const vx = ex - q.x, vy = ey - q.y, lx = vx * Math.cos(th) + vy * Math.sin(th), ly = -vx * Math.sin(th) + vy * Math.cos(th);
        const brg = (Math.atan2(ly, lx) * 180 / Math.PI + 360) % 360; let best = null, bd = 1e9;
        for (const k of socks) { const d = Math.abs(((k.bearing_deg - brg + 540) % 360) - 180); if (d < bd) { bd = d; best = k; } }
        if (best) doors.add(best.k);
      }
      place = placeM(q.x, q.y, map.h(q.x, q.y), th, sx, sy);
    } else if (q.kind === "gatehouse" || q.kind === "keep") {
      const st = hpState(b); tpl = want(q.kind + RUINSUF[st], q.kind); if (!tpl) return null;
      const c = Math.cos(q.rot), s2 = Math.sin(q.rot);
      if (q.kind === "gatehouse") {
        if (-(K.cx - q.x) * s2 + (K.cy - q.y) * c > 0) q.rot += Math.PI; // (+b out of the castle, as castle.js has it)
        th = q.rot + Math.PI; sx = (q.w || 17) / 17; sy = (q.d || 15) / 15; // the kit's outside is −y = sim +b
      } else {
        const bx = (K.cx - q.x) * c + (K.cy - q.y) * s2, by = -(K.cx - q.x) * s2 + (K.cy - q.y) * c;
        const side = Math.abs(bx) > Math.abs(by) ? (bx > 0 ? 1 : 3) : (by > 0 ? 2 : 0); // the forebuilding faces the bailey (castle.js picks the same face)
        th = q.rot + side * Math.PI / 2; sx = (side % 2 ? q.d : q.w) / 20; sy = (side % 2 ? q.w : q.d) / 20;
      }
      place = placeM(q.x, q.y, map.h(q.x, q.y), th, sx, sy);
    } else if (HOUSE[q.kind] || q.kind === "well") {
      tpl = want(q.kind); if (!tpl || hpState(b) === 3) return null;
      if (q.kind === "well") { sx = sy = (q.r || 1.2) / 1.2; th = 0; } else { th = q.rot; sx = q.w / HOUSE[q.kind][0]; sy = q.d / HOUSE[q.kind][1]; }
      place = placeM(q.x, q.y, map.h(q.x, q.y), th, sx, sy);
    } else return null;
    void g;
    const out = placePiece(tpl, place, { top, doors });
    if (tpl.moving.length) { // portcullises and gate leaves: their own small meshes, pivoting where the kit says
      moving = {};
      for (const mv of tpl.moving) {
        const grp = new THREE.Group(); _v.copy(mv.pivot).applyMatrix4(place); grp.position.copy(_v); grp.rotation.y = th; grp.scale.set(sx, 1, sy);
        for (const pt of mv.parts) { const o = new THREE.Mesh(pt.geo, M[pt.mat] || M["k:ashlar"]); grp.add(o); }
        grp.userData.y0 = _v.y; moving[mv.name] = grp;
      }
      const gm = tpl.meta.gate || {};
      extra = { g0: map.h(q.x, q.y), lift: gm.portcullis_outer?.lift || 5.2, th };
    }
    return { out, moving, extra };
  }
  // one part → its render object: { whole: Group, layers: [{ idx, group, mats, op }] (lazy), gb data, gate }
  function buildPart(K, q, w) {
    const b = q.bid !== undefined ? byId.get(q.bid) : null;
    const kk = kitKey(K, q, b);
    if (kk === "K") {
      const t0 = performance.now(), kp = kitPart(K, q, b); stats.buildMs += performance.now() - t0;
      if (kp) {
        const enter = (q.kind === "tower" || q.kind === "keep" || q.kind === "gatehouse" || q.kind === "hall" || q.kind === "chapel" || q.kind === "stable" || q.kind === "kitchen");
        if (kp.kitMods) return { q, b, kit: true, whole: new THREE.Group(), kitMods: kp.kitMods, extra: kp.extra, key: damageKey(q, b) + "K", enter: false, tris: 0, cutK: Infinity };
        const o = kp.out, R = { q, b, kit: true, whole: new THREE.Group(), whole1: new THREE.Group(), layerData: null, layersFn: o.layersFn, layers: null, cutK: Infinity, fading: false,
          extra: kp.extra, key: damageKey(q, b) + "K", enter: enter && o.layerKeys.length > 1, tris: o.tris, lod: 0, g0: map.h(q.x, q.y) };
        R.w0 = o.whole0; R.w1 = o.whole1; // (drawn merged castle-wide: mergeStatic / setVis)
        R.whole1.userData.lod1 = true;
        if (kp.moving) R.gate = { kit: true, port: [kp.moving.portcullis_outer, kp.moving.portcullis_inner], leaves: [kp.moving.gate_l, kp.moving.gate_r], H: kp.extra.lift, pos: [0, 0], leaf: [0, 0], grp: new THREE.Group() };
        if (R.gate) for (const o2 of [...R.gate.port, ...R.gate.leaves]) if (o2) R.gate.grp.add(o2);
        return R;
      }
    }
    const gb = new GB(); let extra = null;
    const t0 = performance.now();
    if (q.kind === "curtain") extra = buildCurtain(gb, map, K, q, b, clipCurtain(K, q));
    else if (q.kind === "tower") buildTower(gb, map, K, q, b);
    else if (q.kind === "keep") buildKeep(gb, map, K, q, b);
    else if (q.kind === "gatehouse") extra = buildGatehouse(gb, map, K, q, b);
    else if (q.kind === "well") buildWell(gb, map, q);
    else if (q.kind === "ditch" || q.kind === "moat") buildDitch(gb, map, q);
    else if (q.kind === "hall" || q.kind === "chapel" || q.kind === "stable" || q.kind === "kitchen") buildHouse(gb, map, K, q, b);
    stats.buildMs += performance.now() - t0;
    const { layers, whole } = gb.build();
    const R = { q, b, whole: new THREE.Group(), layerData: layers, layers: null, cutK: Infinity, fading: false, extra, key: damageKey(q, b) + kk, enter: (q.kind === "tower" || q.kind === "keep" || q.kind === "gatehouse" || q.kind === "hall" || q.kind === "chapel" || q.kind === "stable" || q.kind === "kitchen") && layers.size > 1, tris: tris(whole) };
    if (R.enter || q.kind === "gatehouse") meshesOf(whole, M, R.whole); else R.wholeGeo = whole; // (walls, ditches, wells: merged castle-wide, see mergeStatic)
    R.whole.userData.part = q.id;
    if (q.kind === "gatehouse" && extra) { R.gate = gateParts(extra, M, q.rot); R.gate.pos = [0, 0]; R.gate.leaf = [0, 0]; }
    return R;
  }
  function damageKey(q, b) {
    if (q.kind === "ditch" || q.kind === "moat") return "f" + (q.src?.fills?.length || 0); // (filled across: siege-war.js fillMoat)
    if (!b) return "-";
    if (q.kind === "curtain") { let s = ""; const n = b.mods?.length || 0; for (let k = 0; k < n; k++) s += modState(b, k); return s + (b.ruin ? "R" : ""); }
    return "" + hpState(b);
  }
  // a curtain stops at the face of the tower / gatehouse it runs into (so there is no masonry inside a tower)
  function clipCurtain(K, q) {
    const len = Math.hypot(q.x1 - q.x0, q.y1 - q.y0), ux = (q.x1 - q.x0) / len, uy = (q.y1 - q.y0) / len; let ta = 0, tb = len;
    for (const o of K.parts) { if (o.kind !== "tower" && o.kind !== "gatehouse" && o.kind !== "keep") continue;
      while (ta < len && inside(o, q.x0 + ux * ta, q.y0 + uy * ta, -0.6)) ta += 0.25;
      while (tb > 0 && inside(o, q.x0 + ux * tb, q.y0 + uy * tb, -0.6)) tb -= 0.25; }
    return [ta, tb];
  }
  // the parts nobody goes inside (curtains, ditches, wells) are one mesh per material per castle: rebuilt only when
  // one of them changes (a module falls), which keeps a big concentric castle to a few dozen draw calls
  function mergeStatic(S) {
    if (S.static) { S.obj.remove(S.static); S.static.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); }
    const by = new Map();
    for (const R of S.parts.values()) if (R.wholeGeo) for (const [m, g] of R.wholeGeo) { if (!by.has(m)) by.set(m, []); by.get(m).push(g); }
    const out = new Map();
    for (const [m, gs] of by) {
      let n = 0; for (const g of gs) n += g.attributes.position.count;
      const A = { p: new Float32Array(n * 3), n: new Float32Array(n * 3), u: new Float32Array(n * 2), c: new Float32Array(n * 3) }; let o = 0;
      for (const g of gs) { const c = g.attributes.position.count; A.p.set(g.attributes.position.array, o * 3); A.n.set(g.attributes.normal.array, o * 3); A.u.set(g.attributes.uv.array, o * 2); A.c.set(g.attributes.color.array, o * 3); o += c; }
      const G = new THREE.BufferGeometry(); G.setAttribute("position", new THREE.BufferAttribute(A.p, 3)); G.setAttribute("normal", new THREE.BufferAttribute(A.n, 3)); G.setAttribute("uv", new THREE.BufferAttribute(A.u, 2)); G.setAttribute("color", new THREE.BufferAttribute(A.c, 3));
      G.computeBoundingSphere(); out.set(m, G);
    }
    S.static = new THREE.Group(); meshesOf(out, M, S.static); S.obj.add(S.static);
    // the kit's curtain modules (and hoardings): one InstancedMesh per piece per material per LOD for the whole castle
    const byP = new Map();
    for (const R of S.parts.values()) if (R.kitMods) for (const md of R.kitMods) { if (!byP.has(md.tpl)) byP.set(md.tpl, []); byP.get(md.tpl).push(md); }
    S.inst = [];
    for (const [tpl, mods] of byP) {
      const I = { mods, lods: [[], []], dirty: true };
      for (const lod of [0, 1]) for (const [m, geo] of pieceGeos(tpl, lod)) {
        const im = new THREE.InstancedMesh(geo, M[m] || M["k:ashlar"], mods.length); im.count = 0; im.frustumCulled = true; im.visible = false; S.static.add(im); I.lods[lod].push(im);
      }
      for (const md of mods) md.lod = -1;
      S.inst.push(I);
    }
    S.instT = -1;
    // every other kit part (towers, gatehouse, keep, bailey buildings): merged castle-wide per material per LOD, with a
    // per-vertex part id; a part is hidden (the other LOD, or cut away and drawn by its layers) by a flag the vertex
    // shader reads — so a castle is a few dozen draw calls, and looking into a tower costs no re-merge
    if (S.merged) { S.obj.remove(S.merged); S.merged.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); }
    S.merged = new THREE.Group(); S.obj.add(S.merged);
    S.hid ||= [{ value: new Float32Array(MAXP) }, { value: new Float32Array(MAXP) }]; S.hid[0].value.fill(1); S.hid[1].value.fill(1);
    const kp = [...S.parts.values()].filter((R) => R.w0).slice(0, MAXP);
    kp.forEach((R, i) => { R.pid = i; R.S = S; });
    for (const lod of [0, 1]) {
      const byM = new Map();
      for (const R of kp) for (const [m, g] of (lod ? R.w1 : R.w0)) {
        if (!g.attributes.pid) g.setAttribute("pid", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(R.pid), 1));
        else g.attributes.pid.array.fill(R.pid), g.attributes.pid.needsUpdate = true;
        if (!byM.has(m)) byM.set(m, []); byM.get(m).push(g);
      }
      for (const [m, gs] of byM) { const g = mergeGeometries(gs, false); if (!g) continue; g.computeBoundingSphere(); const o = new THREE.Mesh(g, mergedMat(S, lod, m)); o.matrixAutoUpdate = false; o.userData.lod = lod; S.merged.add(o); }
    }
    for (const R of kp) R.cutK !== Infinity || R.fading ? setVis(R, false, false) : setVis(R, R.lod !== 1, R.lod === 1);
  }
  const MAXP = 128;
  function setVis(R, a, b) { if (!R.S?.hid || R.pid === undefined) return; R.S.hid[0].value[R.pid] = a ? 0 : 1; R.S.hid[1].value[R.pid] = b ? 0 : 1; R.S.visDirty = true; }
  // a merged LOD nobody is drawn at is not submitted at all (the flag only saves the fragments, not the vertices)
  function mergedLods(S) {
    if (!S.visDirty || !S.merged) return; S.visDirty = false;
    const any = [false, false]; for (const l of [0, 1]) { const a = S.hid[l].value; for (let i = 0; i < MAXP; i++) if (a[i] < 0.5) { any[l] = true; break; } }
    for (const o of S.merged.children) o.visible = any[o.userData.lod];
  }
  // a castle's merged material: the shared one + the part-hiding flag (and the fog of war)
  function mergedMat(S, lod, key) {
    S.mm ||= new Map(); const k = lod + "|" + key; if (S.mm.has(k)) return S.mm.get(k);
    const base = M[key] || M["k:ashlar"], c = base.clone(), hid = S.hid[lod], fog = patchFog(c).onBeforeCompile;
    c.onBeforeCompile = (sh) => { fog(sh); sh.uniforms.hid = hid;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float pid; uniform float hid[" + MAXP + "];")
        .replace("#include <project_vertex>", "#include <project_vertex>\nif (hid[int(pid + 0.5)] > 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);"); };
    c.customProgramCacheKey = () => "castle-merged";
    MATS_ALL.get(key)?.push(c); S.mm.set(k, c); return c;
  }
  // per-module LOD for the instanced pieces: LOD0 within 150 m of the camera (10 m of hysteresis), rewritten only
  // when a module changes side
  function instLod(S, cam) {
    if (!S.inst) return;
    const cx = cam.position.x, cy = -cam.position.z, ch = cam.position.y;
    for (const I of S.inst) {
      let changed = I.dirty; I.dirty = false;
      for (const md of I.mods) { const d = Math.hypot(md.x - cx, md.y - cy, map.h(md.x, md.y) - ch), l = md.lod === 0 ? (d > 160 ? 1 : 0) : md.lod === 1 ? (d < 140 ? 0 : 1) : (d < 150 ? 0 : 1); if (l !== md.lod) { md.lod = l; changed = true; } }
      if (!changed) continue;
      for (const lod of [0, 1]) {
        let n = 0; for (const md of I.mods) if (md.lod === lod) { for (const im of I.lods[lod]) im.instanceMatrix.array.set(md.m, n * 16); n++; }
        for (const im of I.lods[lod]) { im.count = n; im.visible = n > 0; im.instanceMatrix.needsUpdate = true; if (n) im.computeBoundingSphere(); }
      }
    }
  }
  // split a part into layer meshes (each with its own material clones, for the fade) the first time it is cut
  function ensureLayers(R) {
    if (R.layers) return;
    R.layers = [];
    const data = R.layerData || R.layersFn();
    const idx = [...data.keys()].sort((a, b) => a - b);
    for (const L of idx) {
      const g = new THREE.Group(), mats = {};
      // (kit parts: each layer has its own clipping plane — the storey in view is cut 1.6 m above its floor, the
      // dollhouse section the procedural parts get from their low/high wall layers)
      const clip = R.kit ? new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e5) : null;
      for (const m of data.get(L).keys()) { const c = M[m].clone(); patchFog(c); if (clip) { c.clippingPlanes = [clip]; c.clipShadows = true; c.side = THREE.DoubleSide; } MATS_ALL.get(m)?.push(c); mats[m] = c; }
      const built = new Map([...data.get(L)].map(([m, B]) => [m, B.isBufferGeometry ? B : toGeo(B)]));
      meshesOf(built, mats, g); g.visible = false; R.obj.add(g);
      R.layers.push({ L, g, mats: Object.values(mats), op: 1, clip });
    }
  }
  // the castle's ground and a field of fire round it are cleared of trees (the props are hidden there)
  function clearGround(w) {
    if (!props) return;
    for (const S of shown.values()) { if (cleared.has(S.K.C.id)) continue; cleared.add(S.K.C.id);
      const K = S.K; let R = 0; for (const q of K.parts) for (const [x, y] of q.kind === "curtain" ? [[q.x0, q.y0], [q.x1, q.y1]] : [[q.x, q.y]]) if (x !== undefined) R = Math.max(R, Math.hypot(x - K.cx, y - K.cy));
      const R2 = (R + 30) ** 2; props.clearArea((x, y) => (x - K.cx) ** 2 + (y - K.cy) ** 2 < R2); }
  }
  const byId = new Map();
  function sync(w) {
    if (w.castles?.length) ensureAssets();
    const live = new Set();
    byId.clear(); for (const b of w.buildings || []) byId.set(b.id, b);
    const own = (w.castleBids ||= new Set()); // buildings.js leaves these to us (curtains, towers, the gatehouse)
    for (const C of w.castles || []) for (const p of C.parts || []) if (p.bid !== undefined) own.add(p.bid);
    for (const C of w.castles || []) {
      live.add(C.id);
      let S = shown.get(C.id);
      if (!S) {
        const K = normalise(C, map); S = { K, parts: new Map(), obj: new THREE.Group() }; S.obj.name = "castle:" + C.id; group.add(S.obj); shown.set(C.id, S);
      }
      for (const q of S.K.parts) {
        const b = q.bid !== undefined ? byId.get(q.bid) : null;
        const R = S.parts.get(q);
        const key = damageKey(q, b) + kitKey(S.K, q, b);
        if (R && R.key === key) continue;
        if (R) { // it changed: rebuild the part (and throw dust and stones where a module fell)
          stats.rebuilds++;
          if (q.kind === "curtain" && b?.mods) for (let k = 0; k < key.length; k++) if (key[k] === "3" && R.key[k] !== "3") falling(q, b, k, R.extra);
          if (q.kind !== "curtain" && key[0] === "3" && R.key[0] !== "3") falling(q, b, -1, null);
          S.obj.remove(R.obj); R.obj.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } }); for (const W of [R.w0, R.w1]) if (W) for (const g of W.values()) g.dispose();
        }
        const N = buildPart(S.K, q, w); N.obj = new THREE.Group(); N.obj.add(N.whole); if (N.whole1) N.obj.add(N.whole1); if (N.gate) N.obj.add(N.gate.grp);
        if (R?.gate && N.gate && !!R.gate.kit === !!N.gate.kit) { N.gate.pos = R.gate.pos; N.gate.leaf = R.gate.leaf; }
        S.obj.add(N.obj); S.parts.set(q, N);
        if (N.wholeGeo || R?.wholeGeo || N.kitMods || R?.kitMods || N.w0 || R?.w0) S.staticDirty = true;
      }
      if (S.staticDirty) { S.staticDirty = false; mergeStatic(S); }
    }
    for (const [id, S] of shown) if (!live.has(id)) { group.remove(S.obj); shown.delete(id); }
    clearGround(w);
  }
  function falling(q, b, k, ex) {
    let x, y, h;
    if (k >= 0 && ex) { const t = (k + 0.5) * ex.ML; x = q.x0 + ex.ux * t; y = q.y0 + ex.uy * t; h = map.h(x, y) + q.walkH * 0.5; }
    else { x = q.x; y = q.y; h = map.h(x, y) + 6; }
    for (let s = 0; s < 6; s++) fx?.dust?.(x + (Math.random() - 0.5) * 6, h - 2 + Math.random() * 4, y + (Math.random() - 0.5) * 6, 2.5);
    for (let s = 0; s < 40 && CH.n < 300; s++) { const i = CH.n++; CH.x[i] = x + (Math.random() - 0.5) * 6; CH.y[i] = h + Math.random() * 4; CH.z[i] = -(y + (Math.random() - 0.5) * 6); CH.vx[i] = (Math.random() - 0.5) * 9; CH.vy[i] = Math.random() * 5; CH.vz[i] = (Math.random() - 0.5) * 9; CH.g[i] = map.h(x, y); CH.age[i] = 0; CH.s[i] = 0.5 + Math.random() * 1.3; }
  }

  // ---- which storey is in view, per enterable part
  function levelOfHeight(R, hRel) { const F = R.q.floors; let k = 0; for (let s = 0; s < F.length; s++) if (hRel >= F[s] - 0.8) k = s; return k; }
  const cnt = new Float32Array(16);
  function autoCut(R, w) { // the storey where most men are fighting (else where most men are); nobody inside: the first floor
    const S = w.S, q = R.q, F = q.floors; cnt.fill(0); let any = false;
    if (S && w.castleLevelH) for (let i = 0; i < S.n; i++) { if (!S.alive[i]) continue; const x = S.x[i], y = S.y[i]; if (!inside(q, x, y, 0.3)) continue; const k = Math.min(15, levelOfHeight(R, w.castleLevelH(i))); cnt[k] += S.state[i] === 2 ? 10 : 1; /* (S_FIGHT) */ any = true; }
    if (!any) return Math.min(1, F.length - 2);
    let best = 0; for (let k = 1; k < F.length; k++) if (cnt[k] > cnt[best]) best = k;
    return best >= F.length - 1 ? Infinity : best; // (the roof walk / tower top is open to the sky already)
  }
  let simT = 0, lastSync = -1;
  function update(w, camera, dt) {
    if (!w.castles?.length) { if (shown.size) sync(w); return; }
    ensureAssets(); installLevelHook(w);
    simT += dt;
    if (simT - lastSync > 0.25 || lastSync < 0) { lastSync = simT; sync(w); }
    const st = camera.st, cam = camera.cam, A = w.avatar, lordView = !!st.drive && A;
    const fx0 = st.tx, fy0 = st.ty, close = lordView || st.dist < CUT_DIST;
    cutParts.length = 0; let draws = 0, tr = 0;
    for (const S of shown.values()) if (S.inst && simT - S.instT > 0.25) { S.instT = simT; instLod(S, cam); }
    const ccx = cam.position.x, ccy = -cam.position.z, cch = cam.position.y;
    for (const S of shown.values()) for (const R of S.parts.values()) {
      const q = R.q; tr += R.tris; draws += R.whole.children.length;
      // LOD (kit parts): the _LOD1 twin beyond ~150 m, unless the part is cut away (the layers are LOD0)
      if (R.w0) {
        const d = Math.hypot(q.x - ccx, q.y - ccy, map.h(q.x, q.y) - cch), l = R.lod === 0 ? (d > 160 ? 1 : 0) : (d < 140 ? 0 : 1);
        if (l !== R.lod) { R.lod = l; if (R.cutK === Infinity && !R.fading) setVis(R, l === 0, l === 1); }
      }
      // the kit gatehouse: portcullises slide up into the chamber (+lift), the leaves swing in about their hinges
      if (R.gate?.kit) {
        const b = byId.get(q.bid), shut = !!b?.shut && !b?.gateBroken, leavesGone = (b?.gl ?? 1) <= 0 || !!b?.gateBroken, portGone = (b?.gpc ?? 1) <= 0 || !!b?.gateBroken;
        const down = b ? (b.portDown ?? shut) && !portGone : false, G = R.gate;
        // sectioned with the passage when the gatehouse is cut at the ground storey (no lattice over cut walls)
        const clipH = R.cutK !== Infinity && R.layers?.[0]?.clip ? R.layers[0].clip.constant : Infinity, fit = (P, h) => { const f = (clipH - P.position.y) / h; P.scale.y = f < 1 ? Math.max(0.01, f) : 1; return f > 0.02; };
        for (let k = 0; k < 2; k++) {
          const P = G.port[k]; if (!P) continue;
          const want = (k === 0 ? down : shut && !portGone) ? 0 : G.H, cur = G.pos[k], sp = want < cur ? 2.8 : 0.6; // it drops fast and is wound up slowly
          G.pos[k] = cur + Math.sign(want - cur) * Math.min(Math.abs(want - cur), sp * dt);
          P.position.y = P.userData.y0 + G.pos[k]; P.rotation.z = portGone && k === 0 ? 0.12 : 0;
          // gone, or raised into the chamber while the chamber is cut away: not drawn
          P.visible = !(portGone && k === 0 && G.pos[k] < 1) && !(R.cutK === 0 && G.pos[k] > 2) && fit(P, 5);
        }
        const wl = shut && !leavesGone ? 0 : leavesGone ? 1.62 : 1.5;
        for (let k = 0; k < 2; k++) { const P = G.leaves[k]; if (!P) continue; const cur = G.leaf[k], v = cur + Math.sign(wl - cur) * Math.min(Math.abs(wl - cur), 0.9 * dt); G.leaf[k] = v;
          P.rotation.y = R.extra.th + (k === 0 ? v : -v); P.rotation.z = leavesGone ? (k ? 0.4 : -0.15) : 0; P.position.y = P.userData.y0 - (leavesGone && k ? 0.4 : 0); P.visible = fit(P, 4.6); }
      }
      // gates: the portcullises drop when the gate is shut and rise when it opens; the leaves swing in
      else if (R.gate) {
        // siege.js: b.shut (barred), b.portDown (the outer portcullis dropped), b.gl / b.gpc (leaves / portcullis left, 1 → 0)
        const b = byId.get(q.bid), shut = !!b?.shut && !b?.gateBroken, leavesGone = (b?.gl ?? 1) <= 0 || !!b?.gateBroken, portGone = (b?.gpc ?? 1) <= 0 || !!b?.gateBroken;
        const down = b ? (b.portDown ?? shut) && !portGone : false;
        for (let k = 0; k < 2; k++) {
          const want = (k === 0 ? down : shut && !portGone) ? 0 : R.gate.H + 0.3, cur = R.gate.pos[k], sp = want < cur ? 2.8 : 0.6; // it drops fast and is wound up slowly
          R.gate.pos[k] = cur + Math.sign(want - cur) * Math.min(Math.abs(want - cur), sp * dt);
          const P = R.gate.port[k]; P.position.y = R.extra.g0 + R.gate.pos[k]; P.rotation.z = portGone && k === 0 ? 0.12 : 0; P.visible = !(portGone && k === 0 && R.gate.pos[k] < 1);
          // cut away with the storey it hangs in: no lattice standing above walls that have faded (layer 2k: walls to 1.2 m)
          const cutTop = R.cutK !== Infinity ? (q.floors[R.cutK] ?? 0) + 1.2 - R.gate.pos[k] : Infinity;
          if (cutTop < R.gate.H + 0.2) { P.scale.y = Math.max(0.01, cutTop / (R.gate.H + 0.2)); if (cutTop < 0.05) P.visible = false; } else P.scale.y = 1;
        }
        const wl = shut && !leavesGone ? 0 : leavesGone ? 1.5 : 1.45;
        const leafTop = R.cutK !== Infinity ? (q.floors[R.cutK] ?? 0) + 1.2 : Infinity;
        for (let k = 0; k < 2; k++) { const cur = R.gate.leaf[k], v = cur + Math.sign(wl - cur) * Math.min(Math.abs(wl - cur), 0.9 * dt); R.gate.leaf[k] = v; const P = R.gate.leaves[k]; P.rotation.y = P.userData.base - P.userData.sg * v; P.rotation.z = leavesGone ? (k ? 0.45 : -0.2) : 0; P.position.y = R.extra.g0 - (leavesGone && k ? 0.4 : 0); P.scale.y = leafTop < R.gate.H ? Math.max(0.05, leafTop / R.gate.H) : 1; }
      }
      if (!R.enter) continue;
      // cut-away: is the camera looking into this part?
      let want = Infinity;
      if (close) {
        // the camera itself inside the walls (a low view): cut at the storey the eye is in
        const eyeIn = inside(q, cam.position.x, -cam.position.z, 0.5), eh = cam.position.y - map.h(q.x, q.y);
        if (lordView) { const L = A.lord; if (inside(q, w.S.x[L], w.S.y[L], 0.6)) want = levelOfHeight(R, w.castleLevelH ? w.castleLevelH(L) : 0); }
        else if (eyeIn && eh < q.floors.at(-1)) want = Math.max(0, levelOfHeight(R, eh) + manualCut);
        else if (inside(q, fx0, fy0, 1.5)) { const a = autoCut(R, w), base = a === Infinity ? q.floors.length - 1 : a, k = base + manualCut; want = k >= q.floors.length - 1 ? Infinity : Math.max(0, k); }
        if (want === Infinity && eyeIn && eh < q.floors.at(-1)) want = Math.max(0, levelOfHeight(R, eh));
      }
      if (want !== Infinity || R.fading || R.cutK !== Infinity) fadeCut(R, want, dt);
      if (R.cutK !== Infinity) cutParts.push(R);
    }
    for (const S of shown.values()) { mergedLods(S); if (S.static) for (const o of S.static.children) if (o.visible) draws++; if (S.merged) for (const o of S.merged.children) if (o.visible) draws++; }
    stats.draws = draws; stats.tris = tr; stats.castles = shown.size;
    // falling stone
    let n = 0;
    for (let i = 0; i < CH.n; i++) {
      CH.age[i] += dt; if (CH.age[i] > 4) continue;
      CH.vy[i] -= 9.8 * dt; CH.x[i] += CH.vx[i] * dt; CH.y[i] += CH.vy[i] * dt; CH.z[i] += CH.vz[i] * dt;
      if (CH.y[i] < CH.g[i]) { CH.y[i] = CH.g[i]; CH.vx[i] *= 0.4; CH.vz[i] *= 0.4; CH.vy[i] = Math.abs(CH.vy[i]) * 0.2; }
      tmp.position.set(CH.x[i], CH.y[i], CH.z[i]); tmp.rotation.set(CH.age[i] * 3 + i, CH.age[i] * 2, 0); tmp.scale.setScalar(CH.s[i]); tmp.updateMatrix(); chips.setMatrixAt(n, tmp.matrix);
      if (n !== i) for (const a of ["x", "y", "z", "vx", "vy", "vz", "g", "age", "s"]) CH[a][n] = CH[a][i];
      n++;
    }
    CH.n = n; if (chips) { chips.count = n; if (n) chips.instanceMatrix.needsUpdate = true; }
  }
  // men above the cut storey of a cut part are not drawn (you are looking at the floor below them)
  const cutParts = [];
  function hides(w, i) {
    if (!cutParts.length || !w.castleLevelH) return false;
    const x = w.S.x[i], y = w.S.y[i];
    for (let k = 0; k < cutParts.length; k++) { const R = cutParts[k]; if (!inside(R.q, x, y, 0.2)) continue; return w.castleLevelH(i) > R.q.floors[R.cutK] + 1.9; }
    return false;
  }
  // fade layers above the cut in/out over FADE_S; the whole mesh stands in whenever the part is fully uncut
  function fadeCut(R, want, dt) {
    ensureLayers(R);
    if (want !== Infinity) R.cutK = want;
    const k = want, step = dt / FADE_S; let moving = false;
    R.whole.visible = false; if (R.w0) setVis(R, false, false);
    for (const Ly of R.layers) {
      const target = k === Infinity ? 1 : (Ly.L <= 2 * k ? 1 : 0);
      if (Ly.op !== target) { Ly.op += Math.sign(target - Ly.op) * Math.min(Math.abs(target - Ly.op), step); moving = true; }
      if (Ly.clip) { // the storey in view: its walls come down to 1.6 m over 0.3 s (and go back up as the cut lifts)
        const F = R.q.floors, g0 = R.g0 ?? map.h(R.q.x, R.q.y), cut = k !== Infinity && Ly.L === 2 * k;
        const top = g0 + (F[(Ly.L >> 1) + 1] ?? F.at(-1) + 6) + 2, want = cut ? g0 + F[k] + 1.6 : top, cur = Math.min(Ly.clip.constant, top);
        if (Math.abs(want - cur) > 0.01) { Ly.clip.constant = cur + Math.sign(want - cur) * Math.min(Math.abs(want - cur), (top - (g0 + F[Ly.L >> 1] + 1.6)) * step); moving = true; }
        else Ly.clip.constant = cut ? want : 1e5;
      }
      const op = Ly.op, tr = op < 0.999;
      for (const m of Ly.mats) { if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } m.opacity = op; m.depthWrite = op > 0.5; }
      Ly.g.visible = op > 0.001;
    }
    R.fading = moving;
    if (k === Infinity && !moving) { R.cutK = Infinity; R.whole.visible = true; if (R.w0) setVis(R, R.lod !== 1, R.lod === 1); for (const Ly of R.layers) Ly.g.visible = false; }
  }
  // ---- men at their level: the figure hook (figures.js adds w.castleLevelH(i) to a man's height)
  let hookFor = null, grid = null;
  const wallOut = [0, 0];
  function installLevelHook(w) {
    if (hookFor === w) return; hookFor = w;
    // engines.js: ladders and siege-tower bridges meet a curtain's wall-walk → [walk height, half thickness] (reused)
    w.castleWallAt = (x, y) => {
      for (const S of shown.values()) for (const q of S.K.parts) {
        if (q.kind !== "curtain") continue;
        const dx = q.x1 - q.x0, dy = q.y1 - q.y0, L2 = dx * dx + dy * dy, t = ((x - q.x0) * dx + (y - q.y0) * dy) / L2; if (t < -0.02 || t > 1.02) continue;
        const px = q.x0 + dx * t - x, py = q.y0 + dy * t - y; if (px * px + py * py > (q.th / 2 + 1.5) ** 2) continue;
        wallOut[0] = q.walkH; wallOut[1] = q.th / 2; return wallOut;
      }
      return null;
    };
    w.castleLevelH = (i) => {
      const S = w.S;
      const d = w.castleDemoH?.get(i); if (d !== undefined) return d; // (?demo=castle pins men to their floors)
      // (castle.js's levelHeight is valid for EVERY man — one low on a stair or a castle ladder is level 0 but already
      // off the ground; a man on a siege.js ladder rises with his climb: w.siege.climbH)
      if (S.lvl && simLH) { const h = simLH(w, i); if (h > 0 || S.lvl[i]) return h; return w.siege?.climbH?.get(i) ?? 0; }
      return guessLevel(w, S.x[i], S.y[i]);
    };
  }
  // before the sim has levels: a man on a curtain's walk band (or on a tower) is up on it
  function guessLevel(w, x, y) {
    if (!grid) { grid = []; for (const S of shown.values()) for (const q of S.K.parts) grid.push(q); }
    for (let k = 0; k < grid.length; k++) {
      const q = grid[k];
      if (q.kind === "curtain") { const dx = q.x1 - q.x0, dy = q.y1 - q.y0, L2 = dx * dx + dy * dy, t = ((x - q.x0) * dx + (y - q.y0) * dy) / L2; if (t < 0 || t > 1) continue; const px = q.x0 + dx * t - x, py = q.y0 + dy * t - y; if (px * px + py * py < (q.th / 2) * (q.th / 2)) return q.walkH; }
      else if (q.kind === "tower" && inside(q, x, y, -0.5)) return q.floors.at(-1);
    }
    return 0;
  }
  const pick = (() => { const ray = new THREE.Raycaster(); return (ndc, cam) => { ray.setFromCamera(ndc, cam); const h = ray.intersectObject(group, true)[0]; return h ? h.point : null; }; })();
  return { group, update, sync, pick, hides, setProps: (p) => { props = p; }, clearGround: (w) => clearGround(w), stats: () => ({ ...stats, cut: cutParts.map((R) => R.q.kind + (R.q.id ?? "") + "@" + R.cutK), chips: CH.n }), setManualCut: (k) => { manualCut = k; }, invalidate: () => { grid = null; } };
}
